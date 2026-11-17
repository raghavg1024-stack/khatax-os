import { test } from "node:test";
import assert from "node:assert/strict";
import { streamingRecognition } from "../src/lib/voice";

test("microphone tracks close on socket startup failure and cancellation cannot restart capture", async () => {
  const names = ["navigator", "location", "window", "WebSocket"];
  const before = new Map(names.map((name) => [name, Object.getOwnPropertyDescriptor(globalThis, name)]));
  const set = (name: string, value: unknown) => Object.defineProperty(globalThis, name, { configurable: true, writable: true, value });
  let stops = 0, ends = 0, errors = 0;
  const stream = { getTracks: () => [{ stop: () => stops++ }] };
  try {
    set("navigator", { mediaDevices: { getUserMedia: async () => stream } });
    set("location", { protocol: "https:", host: "shop.example" });
    set("window", { setTimeout: (fn: () => void, ms: number) => setTimeout(fn, ms) });
    set("WebSocket", class { constructor() { throw new Error("Private constructor details"); } });
    await assert.rejects(() => streamingRecognition("hi-IN", () => {}, () => ends++, () => errors++, () => {}), /Could not start the voice connection/);
    assert.equal(stops, 1);

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
    assert.equal(ends, 1);
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
