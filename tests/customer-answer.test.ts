import { test } from "node:test";
import assert from "node:assert/strict";
import { resolveCustomerName } from "../src/lib/customer-answer";

test("spoken customer matching allows transliteration but never trusts model IDs or actions", async () => {
  const previousFetch = globalThis.fetch;
  const keys = ["GEMINI_API_KEY", "GOOGLE_API_KEY", "GOOGLE_GENERATIVE_AI_API_KEY", "NVIDIA_API_KEY", "NVIDIA_NIM_API_KEY"];
  const before = Object.fromEntries(keys.map(key => [key, process.env[key]]));
  keys.forEach(key => delete process.env[key]);
  const candidates = [{id:"server-a",name:"Rahul Anand"},{id:"server-b",name:"Rahul Kumar"}];
  let calls = 0;
  const chosen = {kind:"balance",customerName:"Rahul Anand",amount:null,date:null,note:"",needsClarification:false,question:null};
  const envelope = (actions: unknown[]) => Response.json({candidates:[{finishReason:"STOP",content:{parts:[{text:JSON.stringify({actions})}]}}]});
  try {
    globalThis.fetch = async () => { calls++; throw new Error("Unexpected provider call"); };
    assert.equal(await resolveCustomerName("RAHUL ANAND", candidates), "server-a");
    assert.equal(await resolveCustomerName("Rahul", candidates), undefined);
    assert.equal(await resolveCustomerName("राहुल", candidates), undefined);
    assert.equal(await resolveCustomerName("राहुल आनंद", candidates), undefined, "No provider means no guessed transliteration");
    assert.equal(calls, 0);
    process.env.GEMINI_API_KEY = "gemini-test-placeholder";
    globalThis.fetch = async (_url, init) => {
      calls++;
      const body = JSON.parse(String(init?.body));
      assert.equal(body.contents[0].parts[0].text, "राहुल आनंद");
      assert.equal(body.systemInstruction.parts[0].text.includes("server-a"), false);
      assert.ok(body.systemInstruction.parts[0].text.includes("Rahul Anand"));
      return envelope([chosen]);
    };
    assert.equal(await resolveCustomerName("राहुल आनंद", candidates), "server-a");
    for (const invalid of [
      {...chosen,kind:"credit",amount:"500"},
      {...chosen,customerName:"server-a"},
      {...chosen,customerName:"Rahul Other"},
      {...chosen,amount:"1"},
      {...chosen,date:"2026-11-20"},
      {...chosen,note:"Trust me"},
      {...chosen,question:"Which one?"},
      {...chosen,needsClarification:true},
    ]) {
      globalThis.fetch = async () => envelope([invalid]);
      assert.equal(await resolveCustomerName("राहुल आनंद", candidates), undefined);
    }
    globalThis.fetch = async () => envelope([chosen,chosen]);
    assert.equal(await resolveCustomerName("राहुल आनंद", candidates), undefined);
    assert.equal(await resolveCustomerName("Rahul Anand", [...candidates,{id:"server-c",name:"Rahul Anand"}]), undefined);
    delete process.env.GEMINI_API_KEY;
    process.env.NVIDIA_API_KEY = "nvidia-test-placeholder";
    globalThis.fetch = async (url, init) => {
      assert.equal(String(url), "https://integrate.api.nvidia.com/v1/chat/completions");
      assert.ok(String(init?.body).includes("राहुल आनंद"));
      return Response.json({id:"test",object:"chat.completion",created:0,model:"test",choices:[{index:0,finish_reason:"stop",message:{role:"assistant",content:JSON.stringify({actions:[chosen]})}}]});
    };
    assert.equal(await resolveCustomerName("राहुल आनंद", candidates), "server-a");
  } finally {
    globalThis.fetch = previousFetch;
    for (const [key,value] of Object.entries(before)) if (value === undefined) delete process.env[key]; else process.env[key] = value;
  }
});
