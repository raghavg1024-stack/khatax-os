import { test } from "node:test";
import assert from "node:assert/strict";
import { POST } from "../src/app/api/reply/route";
const request = (text = "Review ₹500.25 for 2026-11-20.", language = "hi-IN", origin = "https://shop.example") => new Request("https://shop.example/api/reply", { method: "POST", headers: { origin, "Content-Type": "application/json" }, body: JSON.stringify({ text, language }) });

test("reply translation preserves money/date tokens, maps languages and masks provider errors", async () => {
  const previousFetch = globalThis.fetch, previousKey = process.env.SARVAM_API_KEY;
  process.env.SARVAM_API_KEY = "sarvam-test-placeholder";
  let calls = 0;
  try {
    globalThis.fetch = async (url, init) => {
      calls++;
      assert.equal(url, "https://api.sarvam.ai/translate");
      assert.equal(new Headers(init?.headers).get("api-subscription-key"), "sarvam-test-placeholder");
      const body = JSON.parse(String(init?.body));
      assert.equal(body.model, "sarvam-translate:v1");
      assert.equal(body.source_language_code, "en-IN");
      assert.equal(body.target_language_code, "hi-IN");
      assert.equal(/\p{N}/u.test(body.input), false);
      return Response.json({ translated_text: "हिन्दी: " + body.input });
    };
    const result = await POST(request());
    assert.equal(result.status, 200);
    assert.deepEqual(await result.json(), { text: "हिन्दी: Review ₹500.25 for 2026-11-20.", language: "hi-IN", translated: true });
    const english = await POST(request("Review ₹500.", "en-IN"));
    assert.deepEqual(await english.json(), { text: "Review ₹500.", language: "en-IN", translated: false });
    assert.equal((await POST(request("test", "auto"))).status, 400);
    assert.equal((await POST(request("test", "hi-IN", "https://foreign.example"))).status, 403);
    assert.equal((await POST(request("x".repeat(701)))).status, 400);
    assert.equal(calls, 1);
    globalThis.fetch = async (_url, init) => {
      const body = JSON.parse(String(init?.body));
      assert.equal(body.input, "Choose __A__ option __B__ or option __C__.");
      return Response.json({ translated_text: "ಆಯ್ಕೆ __A__ __B__ ಅಥವಾ __C__." });
    };
    const collision = await POST(request("Choose __A__ option 1 or option 2.", "kn-IN"));
    assert.equal(collision.status, 200);
    assert.deepEqual(await collision.json(), {text:"ಆಯ್ಕೆ __A__ 1 ಅಥವಾ 2.",language:"kn-IN",translated:true});
    globalThis.fetch = async (_url, init) => {
      const body = JSON.parse(String(init?.body));
      assert.equal(body.target_language_code, "od-IN");
      return Response.json({ translated_text: "ଠିକ୍ ଅଛି" });
    };
    assert.equal((await POST(request("Review transaction.", "or-IN"))).status, 200);
    for (const translated_text of ["Changed to 900", "No tokens", ""]) {
      globalThis.fetch = async () => Response.json({ translated_text });
      const unsafe = await POST(request());
      assert.equal(unsafe.status, 502);
      assert.equal((await unsafe.json()).code, "reply_invalid_output");
    }
    globalThis.fetch = async () => new Response("sarvam-test-placeholder private data", { status: 403 });
    const failure = await POST(request());
    assert.equal(failure.status, 502);
    assert.equal((await failure.text()).includes("sarvam-test-placeholder"), false);
    globalThis.fetch = async () => { throw new Error("sarvam-test-placeholder"); };
    assert.equal((await POST(request())).status, 503);
  } finally {
    globalThis.fetch = previousFetch;
    if (previousKey === undefined) delete process.env.SARVAM_API_KEY; else process.env.SARVAM_API_KEY = previousKey;
  }
});
