import {test} from "node:test";
import assert from "node:assert/strict";
import {POST} from "../src/app/api/speak/route";
const request = (language="hi-IN", origin="https://shop.example") => new Request("https://shop.example/api/speak", {method:"POST",headers:{origin,"content-type":"application/json"},body:JSON.stringify({text:language === "en-IN" ? "Review 500 rupees." : "कृपया 500 रुपये की जाँच करें।",language})});
function wav() {
  const b=Buffer.alloc(48); b.write("RIFF",0); b.writeUInt32LE(40,4); b.write("WAVEfmt ",8); b.writeUInt32LE(16,16); b.writeUInt16LE(1,20); b.writeUInt16LE(1,22); b.writeUInt32LE(24000,24); b.writeUInt32LE(48000,28); b.writeUInt16LE(2,32); b.writeUInt16LE(16,34); b.write("data",36); b.writeUInt32LE(4,40); return b;
}
test("replies synthesize in their explicit language and do not substitute an English voice", async () => {
  const oldFetch=globalThis.fetch;
  const old=Object.fromEntries(["SARVAM_API_KEY","GNANI_API_KEY","GNANI_AI"].map(k=>[k,process.env[k]]));
  process.env.SARVAM_API_KEY="sarvam-test-placeholder";
  process.env.GNANI_API_KEY="gnani-test-placeholder";
  try {
    let calls=0;
    globalThis.fetch=async (url,init) => {
      calls++; assert.equal(String(url),"https://api.sarvam.ai/text-to-speech");
      assert.equal(new Headers(init?.headers).get("api-subscription-key"),process.env.SARVAM_API_KEY);
      const body=JSON.parse(String(init?.body));
      assert.equal(body.model,"bulbul:v3"); assert.equal(body.speaker,"shubh"); assert.equal(body.language_code,"hi-IN"); assert.equal(body.speech_sample_rate,24000); assert.equal(body.output_audio_codec,"wav"); assert.match(body.text,/500/);
      return Response.json({audios:[wav().toString("base64")]});
    };
    const hindi=await POST(request()); assert.equal(hindi.status,200); assert.equal(hindi.headers.get("X-Speech-Language"),"hi-IN"); assert.deepEqual(Buffer.from(await hindi.arrayBuffer()),wav());
    const unavailable=await POST(request("ur-IN")); assert.equal(unavailable.status,501); assert.equal((await unavailable.json()).code,"speech_language_unavailable"); assert.equal(calls,1);
    assert.equal((await POST(request("auto"))).status,400);
    assert.equal((await POST(request("hi-IN","https://foreign.example"))).status,403);
    globalThis.fetch=async (url,init) => {
      assert.equal(String(url),"https://api.vachana.ai/api/v1/tts/inference");
      assert.equal(new Headers(init?.headers).get("X-API-Key-ID"),process.env.GNANI_API_KEY);
      assert.equal(JSON.parse(String(init?.body)).language,"en-IN");
      return new Response(new Uint8Array(wav()));
    };
    const english=await POST(request("en-IN")); assert.equal(english.status,200); assert.equal(english.headers.get("X-Speech-Provider"),"Gnani Timbre v3.0");
    globalThis.fetch=async (_url,init) => {assert.equal(JSON.parse(String(init?.body)).language_code,"od-IN");return Response.json({audios:[wav().toString("base64")]});};
    assert.equal((await POST(request("or-IN"))).status,200);
    for(const status of [400,429,500]) {
      globalThis.fetch=async()=>new Response("private sarvam-test-placeholder",{status});
      const result=await POST(request()); assert.equal(result.status,status===429?429:502); assert.equal((await result.text()).includes("sarvam-test-placeholder"),false);
    }
    globalThis.fetch=async()=>Response.json({audios:["invalid"]}); assert.equal((await POST(request())).status,503);
    globalThis.fetch=async()=>{throw new Error("sarvam-test-placeholder");};
    const failed=await POST(request()); assert.equal(failed.status,503); assert.equal((await failed.text()).includes("sarvam-test-placeholder"),false);
  } finally {globalThis.fetch=oldFetch;for(const [k,v] of Object.entries(old)){if(v===undefined)delete process.env[k];else process.env[k]=v;}}
});
