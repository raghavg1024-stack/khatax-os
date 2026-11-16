import OpenAI from "openai";
import {z} from "zod";
import {extractionSchema} from "./shared";
import {UserInputError} from "./errors";
import {assertProviderKey} from "./provider-config";

/** NVIDIA's documented Chat Completions endpoint uses the already-installed SDK. */
export async function extractNvidia(text: string, instruction: string, key: string) {
  assertProviderKey(key, "NVIDIA");
  const client = new OpenAI({
    apiKey: key,
    baseURL: "https://integrate.api.nvidia.com/v1",
    timeout: 25000,
    maxRetries: 0,
  });
  let response;
  try {
    response = await client.chat.completions.create({
      model: process.env.NVIDIA_MODEL || "nvidia/nemotron-3.5-lightning-30b-a3b",
      messages: [
        {role:"system",content:`${instruction}\nReturn only JSON matching this schema: ${JSON.stringify(z.toJSONSchema(extractionSchema))}`},
        {role:"user",content:text},
      ],
      response_format: {type:"json_object"},
      max_tokens: 4096,
      stream: false,
      ...{chat_template_kwargs:{enable_thinking:false}},
    });
  } catch (error) {
    // Raw SDK/provider errors must never reach the browser or logs.
    if (error instanceof OpenAI.APIError && error.status === 429)
      throw new UserInputError("NVIDIA quota or rate limit reached. Check NVIDIA API access, wait, and retry. Manual entries still work.", "nvidia_rate_limited", 429);
    if (error instanceof OpenAI.APIError && [400,401,403,404].includes(error.status ?? 0))
      throw new UserInputError("NVIDIA rejected the request. Check NVIDIA_API_KEY, model access, and NVIDIA_MODEL.", "nvidia_configuration", 502);
    throw new UserInputError("NVIDIA could not complete the request. Retry or use a manual entry.", "nvidia_unavailable", 503);
  }
  try {
    const candidate = response.choices[0];
    if (candidate?.finish_reason !== "stop" || !candidate.message.content || candidate.message.refusal)
      throw new Error("Incomplete output");
    return extractionSchema.parse(JSON.parse(candidate.message.content)).actions;
  } catch {
    throw new UserInputError("NVIDIA did not return a complete, valid ledger instruction. Rephrase or use a manual entry.", "nvidia_invalid_output", 502);
  }
}
