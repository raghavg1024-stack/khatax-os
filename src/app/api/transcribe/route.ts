import { isSameOriginRequest } from "@/lib/origin";
import { LANGUAGES } from "@/lib/languages";
import { sarvamKey, assertProviderKey } from "@/lib/provider-config";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 45;
const maximumBytes = 44 + 28 * 16000 * 2;
const error = (message: string, code: string, status = 400) =>
  Response.json({ error: message, code }, { status });

/** Short, bounded PCM recordings recover recognition without a persistent socket. */
export async function POST(request: Request) {
  if (!isSameOriginRequest(request))
    return error("Only same-origin requests are allowed.", "speech_origin", 403);
  const language = new URL(request.url).searchParams.get("language") || "auto";
  if (language !== "auto" && !LANGUAGES.some((item) => item.code === language))
    return error("Choose a supported voice language.", "speech_language_invalid");
  const key = sarvamKey();
  if (!key)
    return error("Sarvam speech-to-text is not configured.", "speech_configuration", 503);
  try { assertProviderKey(key, "Sarvam"); }
  catch { return error("Check the server speech key configuration.", "speech_configuration", 503); }
  if (Number(request.headers.get("content-length")) > maximumBytes)
    return error("Record a command shorter than 28 seconds.", "speech_audio_too_large", 413);
  if (!request.body)
    return error("No microphone recording was received.", "speech_audio_invalid");
  const chunks: Uint8Array[] = [];
  let length = 0;
  const reader = request.body.getReader();
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      length += value.byteLength;
      if (length > maximumBytes) {
        await reader.cancel();
        return error("Record a command shorter than 28 seconds.", "speech_audio_too_large", 413);
      }
      chunks.push(value);
    }
  } catch {
    return error("The microphone recording was interrupted. Retry.", "speech_audio_invalid");
  }
  const wav = Buffer.concat(chunks, length);
  if (length < 46 || wav.toString("ascii", 0, 4) !== "RIFF" ||
      wav.readUInt32LE(4) !== length - 8 || wav.toString("ascii", 8, 16) !== "WAVEfmt " ||
      wav.readUInt32LE(16) !== 16 || wav.readUInt16LE(20) !== 1 ||
      wav.readUInt16LE(22) !== 1 || wav.readUInt32LE(24) !== 16000 ||
      wav.readUInt32LE(28) !== 32000 || wav.readUInt16LE(32) !== 2 ||
      wav.readUInt16LE(34) !== 16 || wav.toString("ascii", 36, 40) !== "data" ||
      wav.readUInt32LE(40) !== length - 44 || (length - 44) % 2 !== 0)
    return error("Use a mono 16 kHz, 16-bit WAV microphone recording.", "speech_audio_invalid");
  const form = new FormData();
  form.set("file", new Blob([new Uint8Array(wav)], { type: "audio/wav" }), "command.wav");
  form.set("model", "saaras:v4");
  form.set("mode", "codemix");
  // REST calls auto-detection 'unknown'; realtime calls it 'auto'.
  form.set("language_code", language === "auto" ? "unknown" : language === "or-IN" ? "od-IN" : language);
  let response: Response;
  try {
    response = await fetch("https://api.sarvam.ai/speech-to-text", {
      method: "POST",
      headers: { "api-subscription-key": key },
      body: form,
      signal: AbortSignal.timeout(25000),
    });
  } catch {
    return error("Speech-to-text could not connect. Retry the recording.", "speech_unavailable", 503);
  }
  if (!response.ok) {
    await response.body?.cancel().catch(() => {});
    return response.status === 429
      ? error("Speech-to-text quota or rate limit reached. Try again shortly.", "speech_rate_limited", 429)
      : error("Speech-to-text failed. Check provider access and retry.", "speech_provider_error", 502);
  }
  try {
    const result = await response.json();
    const text = typeof result.transcript === "string" ? result.transcript.trim() : "";
    if (!text || text.length > 2000)
      return error("No complete speech was recognized. Check the microphone and retry.", "speech_empty", 422);
    const detected = result.language_code === "od-IN" ? "or-IN" : result.language_code;
    return Response.json({ text, ...(LANGUAGES.some((item) => item.code === detected) ? { language: detected } : {}), provider: "Sarvam Saaras v4" });
  } catch {
    return error("Speech-to-text returned an invalid response. Retry.", "speech_invalid_output", 502);
  }
}
