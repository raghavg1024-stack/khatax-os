import { test } from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { WebSocket, type ClientOptions } from "ws";
import { relayVoice } from "../src/lib/voice-relay";

class Socket extends EventEmitter {
  readyState: number = WebSocket.OPEN;
  bufferedAmount = 0;
  sent: (string | Buffer)[] = [];
  terminated = false;
  send(data: string | Buffer) { this.sent.push(data); }
  close() { if (this.readyState !== WebSocket.CLOSED) { this.readyState = WebSocket.CLOSED; this.emit("close"); } }
  terminate() { this.terminated = true; this.close(); }
  message(data: unknown) { this.emit("message", Buffer.from(JSON.stringify(data)), false); }
  get ws() { return this as unknown as WebSocket; }
  get events() { return this.sent.filter((data) => typeof data === "string").map((data) => JSON.parse(data as string)); }
}

test("speech bridge streams documented Sarvam audio and finalizes without leaking provider fields", async () => {
  const names = ["SARVAM_API_KEY", "GNANI_API_KEY", "GNANI_AI", "SARVAM_STT_MODEL"];
  const before = Object.fromEntries(names.map((name) => [name, process.env[name]]));
  try {
    process.env.SARVAM_API_KEY = "sarvam-placeholder";
    process.env.SARVAM_STT_MODEL = "saaras:v4";
    const client = new Socket(), upstream = new Socket();
    const session = relayVoice(client.ws, "ur-IN", (url, options) => {
      const target = new URL(url);
      assert.equal(target.origin, "wss://api.sarvam.ai");
      assert.equal(target.pathname, "/speech-to-text-realtime/ws");
      assert.equal(target.searchParams.get("language_code"), "ur-IN");
      assert.equal(target.searchParams.get("model"), "saaras:v4");
      assert.equal(target.searchParams.get("encoding"), "linear16");
      assert.equal(target.searchParams.get("sample_rate"), "16000");
      assert.equal(new Headers(options.headers as Record<string, string>).get("Api-Subscription-Key"), "sarvam-placeholder");
      assert.equal(url.includes("sarvam-placeholder"), false);
      return upstream.ws;
    });
    upstream.message({ event: "session.begin", private_provider_field: "must-not-cross" });
    assert.equal(client.events[0].type, "connected");
    const pcm = Buffer.alloc(1024, 7);
    client.emit("message", pcm, true);
    assert.deepEqual(upstream.events[0], { event: "audio_input", audio: pcm.toString("base64") });
    upstream.message({ event: "transcript.partial", text: "راوی", language: "ur-IN" });
    assert.equal(client.events.at(-1).type, "interim");
    client.message({ type: "commit" });
    assert.deepEqual(upstream.events.at(-1), { event: "end" });
    const sent = upstream.sent.length;
    client.emit("message", pcm, true);
    assert.equal(upstream.sent.length, sent);
    upstream.message({ event: "transcript.final", text: "راوی کو تین سو روپے", language: "ur-IN", private_provider_field: "must-not-cross" });
    assert.deepEqual(client.events.at(-1), { type: "transcript", text: "راوی کو تین سو روپے", language: "ur-IN" });
    assert.equal(JSON.stringify(client.events).includes("must-not-cross"), false);
    client.close();
    await session;
    assert.equal(upstream.readyState, WebSocket.CLOSED);

    const failedClient = new Socket(), failedUpstream = new Socket();
    const failed = relayVoice(failedClient.ws, "auto", () => failedUpstream.ws);
    failedUpstream.emit("error", new Error("Provider echoed sarvam-placeholder"));
    await failed;
    assert.equal(failedClient.events[0].type, "error");
    assert.equal(JSON.stringify(failedClient.events).includes("sarvam-placeholder"), false);
    assert.equal(failedClient.readyState, WebSocket.CLOSED);
  } finally {
    for (const name of names) {
      if (before[name] === undefined) delete process.env[name];
      else process.env[name] = before[name];
    }
  }
});

test("Gnani language limits are explicit, valid PCM remains binary, and early close cleans up", async () => {
  const names = ["SARVAM_API_KEY", "GNANI_API_KEY", "GNANI_AI"];
  const before = Object.fromEntries(names.map((name) => [name, process.env[name]]));
  try {
    delete process.env.SARVAM_API_KEY;
    delete process.env.GNANI_AI;
    process.env.GNANI_API_KEY = "gnani-placeholder";
    for (const code of ["ur-IN", "as-IN", "or-IN", "auto", "not-a-language"]) {
      const client = new Socket();
      await relayVoice(client.ws, code, () => { throw new Error("Must not silently select another language"); });
      assert.equal(client.events[0].type, "error");
      assert.equal(client.events[0].code, code === "not-a-language" ? "speech_language_invalid" : "speech_language_unavailable");
    }
    const client = new Socket(), upstream = new Socket();
    const session = relayVoice(client.ws, "ta-IN", (url, options: ClientOptions) => {
      assert.equal(url, "wss://api.vachana.ai/stt/v3/stream");
      assert.equal((options.headers as Record<string, string>).language_code, "ta-IN");
      return upstream.ws;
    });
    upstream.message({ type: "connected" });
    const pcm = Buffer.alloc(1024, 3);
    client.emit("message", pcm, true);
    assert.deepEqual(upstream.sent[0], pcm);
    client.emit("message", Buffer.alloc(4), true);
    await session;
    assert.equal(client.events.at(-1).code, "speech_audio_invalid");
    assert.equal(upstream.readyState, WebSocket.CLOSED);

    const closingClient = new Socket(), connecting = new Socket();
    connecting.readyState = WebSocket.CONNECTING;
    const closing = relayVoice(closingClient.ws, "hi-IN", () => connecting.ws);
    closingClient.close();
    await closing;
    assert.equal(connecting.terminated, true);
  } finally {
    for (const name of names) {
      if (before[name] === undefined) delete process.env[name];
      else process.env[name] = before[name];
    }
  }
});
