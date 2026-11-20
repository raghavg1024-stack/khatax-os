import { test } from "node:test";
import assert from "node:assert/strict";
import { POST } from "../src/app/api/transcribe/route";

function wav() {
  const data = Buffer.alloc(44 + 1024);
  data.write("RIFF", 0); data.writeUInt32LE(data.length - 8, 4);
  data.write("WAVEfmt ", 8); data.writeUInt32LE(16, 16);
  data.writeUInt16LE(1, 20); data.writeUInt16LE(1, 22);
  data.writeUInt32LE(16000, 24); data.writeUInt32LE(32000, 28);
  data.writeUInt16LE(2, 32); data.writeUInt16LE(16, 34);
  data.write("data", 36); data.writeUInt32LE(data.length - 44, 40);
  return data;
}
const request = (audio = wav(), language = "auto", origin = "https://shop.example") =>
  new Request(`https://shop.example/api/transcribe?language=${language}`, {
    method: "POST", headers: { origin, "content-type": "audio/wav" }, body: new Uint8Array(audio),
  });

test("file STT validates bounded audio, preserves auto detection, and masks provider failures", async () => {
  const previousFetch = globalThis.fetch, previousKey = process.env.SARVAM_API_KEY;
  const key = "sarvam-test-placeholder";
  process.env.SARVAM_API_KEY = key;
  let calls = 0;
  try {
    globalThis.fetch = async (url, init) => {
      calls++;
      assert.equal(String(url), "https://api.sarvam.ai/speech-to-text");
      assert.equal(new Headers(init?.headers).get("api-subscription-key"), key);
      assert.equal(init?.method, "POST");
      const form = init?.body as FormData;
      assert.equal(form.get("model"), "saaras:v4");
      assert.equal(form.get("mode"), "codemix");
      assert.equal(form.get("language_code"), "unknown");
      const file = form.get("file") as File;
      assert.equal(file.type, "audio/wav");
      assert.deepEqual(Buffer.from(await file.arrayBuffer()), wav());
      return Response.json({ transcript: " Ravi paid 350 rupees. ", language_code: "en-IN", request_id: "private-not-forwarded" });
    };
    const result = await POST(request());
    assert.equal(result.status, 200);
    assert.deepEqual(await result.json(), { text: "Ravi paid 350 rupees.", language: "en-IN", provider: "Sarvam Saaras v4" });
    const malformed = wav(); malformed.writeUInt32LE(48000, 24);
    assert.equal((await POST(request(malformed))).status, 400);
    assert.equal((await POST(request(Buffer.alloc(2)))).status, 400);
    assert.equal((await POST(request(wav(), "xx-IN"))).status, 400);
    assert.equal((await POST(request(wav(), "auto", "https://foreign.example"))).status, 403);
    assert.equal((await POST(request(Buffer.alloc(44 + 28 * 32000 + 2)))).status, 413);
    assert.equal(calls, 1, "Invalid recordings must not reach the provider");
    globalThis.fetch = async (_url, init) => {
      assert.equal((init?.body as FormData).get("language_code"), "od-IN");
      return Response.json({ transcript: "recognized", language_code: "od-IN" });
    };
    assert.equal((await (await POST(request(wav(), "or-IN"))).json()).language, "or-IN");
    for (const [status, expected] of [[403, 502], [429, 429], [500, 502]]) {
      globalThis.fetch = async () => new Response(`private ${key}`, { status });
      const failed = await POST(request());
      assert.equal(failed.status, expected);
      assert.equal((await failed.text()).includes(key), false);
    }
    for (const transcript of ["", "a".repeat(2001), null]) {
      globalThis.fetch = async () => Response.json({ transcript });
      assert.equal((await POST(request())).status, 422);
    }
    globalThis.fetch = async () => { throw new Error(key); };
    const unavailable = await POST(request());
    assert.equal(unavailable.status, 503);
    assert.equal((await unavailable.text()).includes(key), false);
    delete process.env.SARVAM_API_KEY;
    assert.equal((await POST(request())).status, 503);
  } finally {
    globalThis.fetch = previousFetch;
    if (previousKey === undefined) delete process.env.SARVAM_API_KEY;
    else process.env.SARVAM_API_KEY = previousKey;
  }
});
