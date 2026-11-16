import { WebSocket } from "ws";
import { gnaniKey } from "./provider-config";

/** One bounded Node.js voice session. No financial or conversation state lives in this process. */
export function relayVoice(
  client: WebSocket,
  requestedLanguage: string | null,
): Promise<void> {
  return new Promise((resolve) => {
    const send = (data: unknown) => {
      if (client.readyState === WebSocket.OPEN)
        client.send(JSON.stringify(data));
    };
    const apiKey = gnaniKey();
    if (!apiKey) {
      send({
        type: "demo",
        message: "Gnani is not configured. Browser speech demo is available.",
      });
      client.close();
      resolve();
      return;
    }
    const language = ["en-IN", "hi-IN", "kn-IN", "te-IN"].includes(
      requestedLanguage || "",
    )
      ? requestedLanguage!
      : "hi-IN";
    // Provider contract: https://docs.gnani.ai/api/STT/stt-websocket
    const upstream = new WebSocket("wss://api.vachana.ai/stt/v3/stream", {
      headers: {
        "x-api-key-id": apiKey,
        model: "prisma-v3.0",
        language_code: language === "en-IN" ? "en-IN" : `${language},en-IN`,
        format: "codemix",
        "x-sample-rate": "16000",
        "x-min-silence-ms": "700",
      },
      handshakeTimeout: 15000,
    });
    let ready = false;
    upstream.on("message", (raw) => {
      try {
        const event = JSON.parse(raw.toString());
        if (event.type === "connected") ready = true;
        send(event);
      } catch {
        send({ type: "error", message: "Invalid speech provider response." });
      }
    });
    upstream.on("error", () => {
      send({
        type: "error",
        message: "Gnani connection failed. Check your key and connectivity.",
      });
      client.close();
    });
    upstream.on("close", () => client.close());
    client.on("message", (data, isBinary) => {
      if (isBinary) {
        const frame = Array.isArray(data) ? Buffer.concat(data) : data;
        if (
          ready &&
          frame.byteLength === 1024 &&
          upstream.readyState === WebSocket.OPEN
        )
          upstream.send(frame, { binary: true });
        return;
      }
      try {
        const message = JSON.parse(data.toString());
        if (
          message.type === "commit" &&
          ready &&
          upstream.readyState === WebSocket.OPEN
        )
          upstream.send(JSON.stringify({ type: "commit" }));
      } catch {
        client.close(1003, "Invalid control frame");
      }
    });
    const timer = setTimeout(() => client.close(1000, "Session limit"), 120000);
    client.on("close", () => {
      clearTimeout(timer);
      upstream.close();
      resolve();
    });
    client.on("error", () => {
      clearTimeout(timer);
      upstream.close();
      resolve();
    });
  });
}
