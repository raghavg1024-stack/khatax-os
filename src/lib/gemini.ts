import { z } from "zod";
import { extractionSchema } from "./shared";
import { UserInputError } from "./errors";
import { assertProviderKey } from "./provider-config";

/** Native REST keeps the existing ledger schema and requires no additional SDK. */
export async function extractGemini(text: string, instruction: string, key: string) {
  assertProviderKey(key, "Gemini");
  const model = process.env.GEMINI_MODEL || "gemini-3.5-flash-lite";
  let response: Response;
  try {
    response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-goog-api-key": key },
        body: JSON.stringify({
          systemInstruction: { parts: [{ text: instruction }] },
          contents: [{ role: "user", parts: [{ text }] }],
          generationConfig: {
            responseMimeType: "application/json",
            responseJsonSchema: z.toJSONSchema(extractionSchema),
            maxOutputTokens: 4096,
          },
        }),
        signal: AbortSignal.timeout(25000),
      },
    );
  } catch {
    throw new UserInputError("Gemini could not connect in time. Retry or use a manual entry.", "gemini_unavailable", 503);
  }
  // Never forward raw provider errors: they may echo request data or credentials.
  if (!response.ok) {
    await response.body?.cancel().catch(() => {});
    if (response.status === 429)
      throw new UserInputError("Gemini quota or rate limit reached. Check your Google AI Studio quota, wait, then retry. Manual entries still work.", "gemini_rate_limited", 429);
    if ([400, 401, 403, 404].includes(response.status))
      throw new UserInputError("Gemini rejected the request. Check the API key, project access, and GEMINI_MODEL setting.", "gemini_configuration", 502);
    throw new UserInputError("Gemini is temporarily unavailable. Retry or use a manual entry.", "gemini_unavailable", 503);
  }
  try {
    const body = await response.json();
    const candidate = body?.candidates?.[0];
    if (candidate?.finishReason !== "STOP" || !Array.isArray(candidate?.content?.parts))
      throw new Error("Incomplete response");
    const output = candidate.content.parts
      .filter((part: { thought?: boolean; text?: unknown }) => !part.thought && typeof part.text === "string")
      .map((part: { text: string }) => part.text)
      .join("");
    return extractionSchema.parse(JSON.parse(output)).actions;
  } catch {
    throw new UserInputError("Gemini did not return a complete, valid ledger instruction. Rephrase or use a manual entry.", "gemini_invalid_output", 502);
  }
}
