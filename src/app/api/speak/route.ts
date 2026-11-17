import { z } from "zod";
import { isSameOriginRequest } from "@/lib/origin";
import { finalizeWav } from "@/lib/audio";
import { gnaniKey, assertProviderKey } from "@/lib/provider-config";
export async function POST(req: Request) {
  if (!isSameOriginRequest(req))
    return Response.json({ error: "Invalid origin." }, { status: 403 });
  const apiKey = gnaniKey();
  if (!apiKey)
    return Response.json(
      { error: "Gnani is not configured. Use browser voice demo mode." },
      { status: 503 },
    );
  try {
    assertProviderKey(apiKey, "Gnani");
    const { text, language } = z
      .object({
        text: z.string().min(1).max(700),
        language: z
          .enum(["auto", "en-IN", "hi-IN", "kn-IN", "te-IN"])
          .default("en-IN"),
      })
      .parse(await req.json());
    // Official contract: https://docs.gnani.ai/api/TTS/tts-inference
    const response = await fetch(
      "https://api.vachana.ai/api/v1/tts/inference",
      {
        method: "POST",
        headers: {
          "X-API-Key-ID": apiKey,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          text,
          voice: process.env.GNANI_VOICE_ID || "Shivani",
          model: "timbre-v3.0",
          language,
          speed: 1,
          audio_config: {
            sample_rate: 24000,
            num_channels: 1,
            sample_width: 2,
            encoding: "linear_pcm",
            container: "wav",
          },
        }),
        signal: AbortSignal.timeout(25000),
      },
    );
    if (!response.ok)
      return Response.json(
        {
          error:
            "Gnani speech synthesis failed. Check your key and voice access.",
        },
        { status: 502 },
      );
    return new Response(finalizeWav(await response.arrayBuffer()), {
      headers: { "Content-Type": "audio/wav", "Cache-Control": "no-store" },
    });
  } catch {
    return Response.json(
      { error: "Could not generate speech. Try again." },
      { status: 400 },
    );
  }
}
