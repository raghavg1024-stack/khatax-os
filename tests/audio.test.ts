import { test } from "node:test";
import assert from "node:assert/strict";
import { finalizeWav } from "../src/lib/audio";

test("finalizes a real provider's unknown-length WAV headers without changing PCM", () => {
  const audio = new ArrayBuffer(48),
    bytes = new Uint8Array(audio),
    view = new DataView(audio);
  const text = (offset: number, value: string) =>
    bytes.set(new TextEncoder().encode(value), offset);
  text(0, "RIFF");
  view.setUint32(4, 0xffffffff, true);
  text(8, "WAVE");
  text(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, 24000, true);
  view.setUint16(34, 16, true);
  text(36, "data");
  view.setUint32(40, 0xffffffff, true);
  bytes.set([1, 2, 3, 4], 44);
  const normalized = finalizeWav(audio);
  assert.equal(new DataView(normalized).getUint32(4, true), 40);
  assert.equal(new DataView(normalized).getUint32(40, true), 4);
  assert.deepEqual([...new Uint8Array(normalized).slice(44)], [1, 2, 3, 4]);
  assert.deepEqual(finalizeWav(normalized.slice(0)), normalized);
  assert.throws(() => finalizeWav(new ArrayBuffer(8)), /Invalid WAV/);
  view.setUint32(40, 100, true);
  assert.throws(() => finalizeWav(audio), /Truncated/);
});
