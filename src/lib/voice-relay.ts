import { WebSocket, type ClientOptions, type RawData } from "ws";
import { gnaniKey, sarvamKey, assertProviderKey } from "./provider-config";
import { AUTO_LANGUAGE, LANGUAGES } from "./languages";

/** Bounded streaming session; only transcript/control events cross into the browser. */
export async function relayVoice(
  client: WebSocket,
  requestedLanguage: string | null,
  connect = (url: string, options: ClientOptions) => new WebSocket(url, options),
): Promise<void> {
  const send = (data: unknown) => {
    if (client.readyState === WebSocket.OPEN) client.send(JSON.stringify(data));
  };
  const reject = (code: string, message: string) => {
    send({ type: "error", code, message });
    client.close();
  };
  const language = requestedLanguage || "hi-IN";
  const selected = [...LANGUAGES, AUTO_LANGUAGE].find((item) => item.code === language);
  if (!selected) {
    reject("speech_language_invalid", "Choose a supported voice language.");
    return;
  }
  const sarvam = sarvamKey();
  if (!sarvam && !selected.gnani) {
    reject("speech_language_unavailable", `${selected.name} voice requires the Sarvam speech key. You can still type your command.`);
    return;
  }
  const key = sarvam || gnaniKey();
  if (!key) {
    send({ type: "demo", message: "Server speech is not configured. Browser speech demo is available." });
    client.close();
    return;
  }
  try {
    assertProviderKey(key, sarvam ? "Sarvam" : "Gnani");
  } catch {
    reject("speech_configuration", "The speech key must contain only one key on one line.");
    return;
  }
  // Contracts: docs.sarvam.ai/api/api-guides-tutorials/speech-to-text/realtime-streaming
  // and docs.gnani.ai/api/STT/stt-websocket. Sarvam realtime uses or-IN for Odia.
  const sarvamUrl = new URL("wss://api.sarvam.ai/speech-to-text-realtime/ws");
  sarvamUrl.search = new URLSearchParams({
    model: process.env.SARVAM_STT_MODEL || "saaras:v4",
    language_code: language,
    mode: "codemix",
    encoding: "linear16",
    sample_rate: "16000",
    stream_type: "balanced",
    endpointing: "vad",
    silence_duration_ms: "1000",
  }).toString();
  let upstream: WebSocket;
  try {
    upstream = connect(sarvam ? sarvamUrl.toString() : "wss://api.vachana.ai/stt/v3/stream", {
      headers: sarvam ? { "Api-Subscription-Key": key } : {
        "x-api-key-id": key,
        model: "prisma-v3.0",
        language_code: language,
        format: "codemix",
        "x-sample-rate": "16000",
        "x-min-silence-ms": "700",
      },
      handshakeTimeout: 15000,
      maxPayload: 128 * 1024,
    });
  } catch {
    reject("speech_connection_failed", "Could not start speech recognition. Check speech configuration and retry.");
    return;
  }
  return new Promise((resolve) => {
    let finished = false, ready = false, ending = false, hasTranscript = false;
    const finish = () => {
      if (finished) return;
      finished = true;
      clearTimeout(sessionTimer);
      clearTimeout(readyTimer);
      client.removeListener("message", onClientMessage);
      if (upstream.readyState === WebSocket.CONNECTING) upstream.terminate();
      else if (upstream.readyState === WebSocket.OPEN) upstream.close();
      if (client.readyState === WebSocket.OPEN) client.close();
      resolve();
    };
    const fail = (code: string, message: string) => {
      if (finished) return;
      send({ type: "error", code, message });
      finish();
    };
    const sessionTimer = setTimeout(() => finish(), 120000);
    const readyTimer = setTimeout(() => fail("speech_start_timeout", "Speech recognition did not start in time. Retry or type your command."), 15000);
    const onClientMessage = (data: RawData, isBinary: boolean) => {
      if (finished || ending) return;
      if (isBinary) {
        const frame = Array.isArray(data) ? Buffer.concat(data) : Buffer.from(data as ArrayBuffer);
        if (frame.byteLength !== 1024) {
          fail("speech_audio_invalid", "Invalid microphone audio frame. Retry the recording.");
          return;
        }
        if (!ready || upstream.readyState !== WebSocket.OPEN) return;
        if (upstream.bufferedAmount > 256 * 1024) {
          fail("speech_connection_slow", "The speech connection is too slow. Retry or type your command.");
          return;
        }
        if (sarvam) upstream.send(JSON.stringify({ event: "audio_input", audio: frame.toString("base64") }));
        else upstream.send(frame, { binary: true });
        return;
      }
      try {
        if (JSON.parse(data.toString()).type !== "commit") throw new Error("Invalid control frame");
        if (ready && upstream.readyState === WebSocket.OPEN) {
          ending = true;
          upstream.send(JSON.stringify(sarvam ? { event: "end" } : { type: "commit" }));
        }
      } catch {
        fail("speech_control_invalid", "Invalid voice control message.");
      }
    };
    client.on("message", onClientMessage);
    client.once("close", finish);
    client.once("error", finish);
    upstream.on("message", (raw) => {
      if (finished) return;
      try {
        const event = JSON.parse(raw.toString());
        const type = sarvam ? event.event : event.type;
        if (type === "error") {
          fail("speech_provider_error", "Speech recognition could not process this session. Check provider access and quota, or type your command.");
          return;
        }
        if (type === (sarvam ? "session.begin" : "connected")) {
          if (ready) return;
          ready = true;
          clearTimeout(readyTimer);
          send({ type: "connected", provider: sarvam ? "Sarvam Saaras v4" : "Gnani Prisma v3.0" });
        }
        if (["transcript", "transcript.partial", "transcript.final"].includes(type)) {
          if (typeof event.text !== "string" || !event.text.trim()) return;
          if (event.text.length > 2000) {
            fail("speech_transcript_too_long", "That voice command is too long. Record a shorter command or type it.");
            return;
          }
          const final = type !== "transcript.partial";
          if (final) hasTranscript = true;
          const detected = LANGUAGES.find((item) => item.code === event.language)?.code;
          send({ type: final ? "transcript" : "interim", text: event.text.trim(), ...(detected ? { language: detected } : {}) });
        }
        if (sarvam && type === "session.end") {
          if (!hasTranscript) fail("speech_empty", "No speech was recognized. Retry or type your command.");
          else finish();
        }
      } catch {
        fail("speech_response_invalid", "Invalid speech provider response. Retry the recording.");
      }
    });
    upstream.on("error", () => fail("speech_connection_failed", "Speech connection failed. Check the provider key and connectivity, or type your command."));
    upstream.once("close", () => {
      if (!finished && !hasTranscript) {
        send({ type: "error", code: "speech_closed", message: "Speech recognition closed before a transcript was ready. Retry or type your command." });
      }
      finish();
    });
  });
}
