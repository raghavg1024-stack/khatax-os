import { z } from "zod";
import { isSameOriginRequest } from "@/lib/origin";
import { finalizeWav } from "@/lib/audio";
import { gnaniKey, sarvamKey, assertProviderKey } from "@/lib/provider-config";
import { LANGUAGES } from "@/lib/languages";

export const maxDuration = 45;
const supportedSarvam = new Set(["en-IN", "hi-IN", "bn-IN", "gu-IN", "kn-IN", "ml-IN", "mr-IN", "or-IN", "pa-IN", "ta-IN", "te-IN"]);
const failure = (error: string, code: string, status: number) => Response.json({error, code}, {status});
export async function POST(req: Request) {
  if (!isSameOriginRequest(req)) return failure("Invalid origin.", "speech_origin", 403);
  try {
    const raw = await req.text();
    if (raw.length > 4000) return failure("Speech request is too large.", "speech_input_invalid", 413);
    const { text, language } = z.object({
      text: z.string().trim().min(1).max(700),
      language: z.string().default("en-IN").refine(value => LANGUAGES.some(item => item.code === value)),
    }).parse(JSON.parse(raw));
    const gnani = language === "en-IN" ? gnaniKey() : undefined;
    const sarvam = sarvamKey();
    if (!gnani && !supportedSarvam.has(language))
      return failure("A server voice is unavailable for this language. The written reply is available; use a matching browser voice if installed.", "speech_language_unavailable", 501);
    const key = gnani || sarvam;
    if (!key) return failure("Speech synthesis is not configured for this language.", "speech_configuration", 503);
    assertProviderKey(key, gnani ? "Gnani" : "Sarvam");
    // Official contracts: docs.gnani.ai/api/TTS/tts-inference and
    // docs.sarvam.ai/api/api-guides-tutorials/text-to-speech/rest-api.
    const response = await fetch(gnani ? "https://api.vachana.ai/api/v1/tts/inference" : "https://api.sarvam.ai/text-to-speech", {
      method: "POST",
      headers: {"Content-Type":"application/json", ...(gnani ? {"X-API-Key-ID":key} : {"api-subscription-key":key})},
      body: JSON.stringify(gnani ? {
        text, voice: process.env.GNANI_VOICE_ID || "Shivani", model:"timbre-v3.0", language, speed:1,
        audio_config:{sample_rate:24000,num_channels:1,sample_width:2,encoding:"linear_pcm",container:"wav"},
      } : {
        text, language_code:language === "or-IN" ? "od-IN" : language,
        model:"bulbul:v3", speaker:"shubh", speech_sample_rate:24000, output_audio_codec:"wav",
      }),
      signal: AbortSignal.timeout(20000),
    });
    if (!response.ok) {
      await response.body?.cancel().catch(() => {});
      return failure("Speech synthesis failed. The written reply is available.", "speech_provider_error", response.status === 429 ? 429 : 502);
    }
    let bytes: ArrayBuffer;
    if (gnani) bytes = await response.arrayBuffer();
    else {
      const result = await response.json();
      const encoded = result?.audios?.[0];
      if (typeof encoded !== "string" || !encoded || encoded.length > 8_000_000 || !/^[A-Za-z0-9+/]*={0,2}$/.test(encoded))
        return failure("Speech synthesis returned invalid audio.", "speech_invalid_output", 502);
      bytes = new Uint8Array(Buffer.from(encoded, "base64")).buffer;
    }
    return new Response(finalizeWav(bytes), {
      headers:{"Content-Type":"audio/wav","Cache-Control":"no-store","X-Speech-Language":language,"X-Speech-Provider":gnani ? "Gnani Timbre v3.0" : "Sarvam Bulbul v3"},
    });
  } catch (error) {
    return error instanceof z.ZodError || error instanceof SyntaxError
      ? failure("Use a valid speech text and explicit reply language.", "speech_input_invalid", 400)
      : failure("Could not generate speech. The written reply is available.", "speech_unavailable", 503);
  }
}
