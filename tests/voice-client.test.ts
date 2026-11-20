import { test } from "node:test";
import assert from "node:assert/strict";
import { streamingRecognition } from "../src/lib/voice";

test("microphone tracks close on socket startup failure and cancellation cannot restart capture", async () => {
  const names = ["navigator", "location", "window", "WebSocket", "AudioContext"];
  const before = new Map(names.map((name) => [name, Object.getOwnPropertyDescriptor(globalThis, name)]));
  const set = (name: string, value: unknown) => Object.defineProperty(globalThis, name, { configurable: true, writable: true, value });
  let stops = 0, ends = 0, errors = 0, closes = 0;
  const startup: string[] = [];
  const stream = { getTracks: () => [{ stop: () => stops++ }] };
  try {
    set("AudioContext", class {
      state = "running";
      constructor() { startup.push("context"); }
      async resume() { startup.push("resume"); }
      async close() { this.state = "closed"; closes++; }
    });
    set("navigator", { mediaDevices: { getUserMedia: async () => { startup.push("permission"); return stream; } } });
    set("location", { protocol: "https:", host: "shop.example" });
    set("window", { setTimeout: (fn: () => void, ms: number) => setTimeout(fn, ms) });
    set("WebSocket", class { constructor() { throw new Error("Private constructor details"); } });
    await assert.rejects(() => streamingRecognition("hi-IN", () => {}, () => ends++, () => errors++, () => {}), /Could not start the voice connection/);
    assert.equal(stops, 1);
    assert.equal(closes, 1);
    assert.deepEqual(startup, ["context", "resume", "permission"], "Audio must unlock before the first permission/network await");

    let instance: Socket | undefined;
    class Socket {
      static OPEN = 1;
      readyState = 0;
      onmessage: ((event: { data: string }) => unknown) | null = null;
      onclose: (() => void) | null = null;
      onerror: (() => void) | null = null;
      constructor() { instance = this; }
      close() {
        this.readyState = 3;
        this.onclose?.();
        this.onerror?.(); // Browsers can emit an error when cancelling CONNECTING.
      }
      send() { assert.fail("A cancelled startup must not send a commit or audio"); }
    }
    set("WebSocket", Socket);
    const handle = await streamingRecognition("ur-IN", () => assert.fail("No transcript after cancellation"), () => ends++, () => errors++, () => {});
    handle.stop();
    assert.equal(stops, 2);
    assert.equal(closes, 2);
    assert.equal(ends, 1);

    set("navigator", { mediaDevices: { getUserMedia: async () => { throw new Error("Permission denied"); } } });
    await assert.rejects(() => streamingRecognition("hi-IN", () => {}, () => {}, () => {}, () => {}), /Permission denied/);
    assert.equal(closes, 3, "Permission denial must release the pre-unlocked audio context");
    assert.equal(errors, 0);
    await instance?.onmessage?.({ data: JSON.stringify({ type: "connected" }) });
    handle.stop();
    assert.equal(stops, 2);
    assert.equal(ends, 1);
  } finally {
    for (const [name, descriptor] of before) {
      if (descriptor) Object.defineProperty(globalThis, name, descriptor);
      else Reflect.deleteProperty(globalThis, name);
    }
  }
});

test("streaming readiness waits for running capture and startup cancellation releases audio", async () => {
  const names = ["navigator", "location", "window", "WebSocket", "AudioContext", "AudioWorkletNode"];
  const before = new Map(names.map((name) => [name, Object.getOwnPropertyDescriptor(globalThis, name)]));
  const set = (name: string, value: unknown) => Object.defineProperty(globalThis, name, { configurable: true, writable: true, value });
  let moduleReady: () => void = () => {};
  let timeout: () => void = () => {};
  let ready = 0, stops = 0, closes = 0, errors = 0, connections = 0;
  let socket: Socket;
  class Socket {
    static OPEN = 1;
    readyState = 1;
    onmessage: ((event: { data: string }) => Promise<void>) | null = null;
    onclose: (() => void) | null = null;
    onerror: (() => void) | null = null;
    constructor() { socket = this; }
    close() { this.readyState = 3; this.onclose?.(); }
    send() {}
  }
  try {
    set("navigator", { mediaDevices: { getUserMedia: async () => ({ getTracks: () => [{ stop: () => stops++ }] }) } });
    set("location", { protocol: "https:", host: "shop.example" });
    set("window", { setTimeout: (fn: () => void) => { timeout = fn; return 0; } });
    set("WebSocket", Socket);
    set("AudioContext", class {
      state = "running";
      destination = {};
      audioWorklet = { addModule: () => new Promise<void>((resolve) => { moduleReady = resolve; }) };
      async resume() {}
      async close() { this.state = "closed"; closes++; }
      createMediaStreamSource() { return { connect() { connections++; }, disconnect() {} }; }
    });
    set("AudioWorkletNode", class {
      port = { onmessage: null };
      connect() { connections++; }
      disconnect() {}
    });
    const start = () => streamingRecognition("en-IN", () => {}, () => {}, () => errors++, () => {}, () => ready++);
    const handle = await start();
    assert.equal(ready, 0);
    const connecting = socket!.onmessage!({ data: '{"type":"connected"}' });
    assert.equal(ready, 0, "Provider connection alone must not announce microphone readiness");
    moduleReady();
    await connecting;
    assert.equal(ready, 1);
    assert.equal(connections, 2);
    handle.stop();
    await socket!.onmessage!({ data: '{"type":"transcript","text":"Ravi 200 credit"}' });
    assert.equal(closes, 1);
    assert.equal(errors, 0);

    await start();
    const pending = socket!.onmessage!({ data: '{"type":"connected"}' });
    timeout();
    moduleReady();
    await pending;
    assert.equal(ready, 1, "Timed-out worklet startup must not become ready later");
    assert.equal(errors, 1);
    assert.equal(closes, 2);
    assert.ok(stops >= 2);
  } finally {
    for (const [name, descriptor] of before) {
      if (descriptor) Object.defineProperty(globalThis, name, descriptor);
      else Reflect.deleteProperty(globalThis, name);
    }
  }
});
