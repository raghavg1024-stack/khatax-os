import {test} from "node:test";
import assert from "node:assert/strict";
import {extractGemini} from "../src/lib/gemini";
import {UserInputError} from "../src/lib/errors";

test("Gemini boundary validates structured output and masks provider errors", async () => {
  const originalFetch = globalThis.fetch;
  const key = "gemini-key-placeholder";
  const action = {kind:"credit",customerName:"Ravi",amount:"350",date:"2026-11-16",note:"",needsClarification:false,question:null};
  const envelope = (value: unknown, finishReason="STOP") => ({candidates:[{finishReason,content:{parts:[{text:JSON.stringify(value)}]}}]});
  try {
    globalThis.fetch = async (url, options) => {
      assert.equal(new URL(String(url)).hostname, "generativelanguage.googleapis.com");
      assert.equal(String(url).includes(key), false);
      assert.equal(new Headers(options?.headers).get("x-goog-api-key"), key);
      const request = JSON.parse(String(options?.body));
      assert.equal(request.generationConfig.responseMimeType,"application/json");
      assert.equal(request.generationConfig.responseJsonSchema.properties.actions.maxItems,12);
      assert.equal(request.contents[0].parts[0].text,"Ravi 500 nahi 350");
      return Response.json(envelope({actions:[action]}));
    };
    assert.deepEqual(await extractGemini("Ravi 500 nahi 350","System instructions",key),[action]);
    for(const value of [{actions:[]},{actions:[{...action,kind:"delete_all"}]},{actions:[{...action,amount:350}]}]){
      globalThis.fetch = async () => Response.json(envelope(value));
      await assert.rejects(()=>extractGemini("command","instruction",key),(error:unknown)=>error instanceof UserInputError&&error.code==="gemini_invalid_output");
    }
    globalThis.fetch = async () => Response.json(envelope({actions:[action]},"MAX_TOKENS"));
    await assert.rejects(()=>extractGemini("command","instruction",key),{code:"gemini_invalid_output"});
    for(const [status,code] of [[429,"gemini_rate_limited"],[403,"gemini_configuration"],[500,"gemini_unavailable"]] as const){
      globalThis.fetch = async () => new Response(`Provider echoed ${key}`,{status});
      await assert.rejects(()=>extractGemini("command","instruction",key),(error:unknown)=>error instanceof UserInputError&&error.code===code&&!error.message.includes(key));
    }
    globalThis.fetch = async () => {throw new Error(key);};
    await assert.rejects(()=>extractGemini("command","instruction",key),(error:unknown)=>error instanceof UserInputError&&!error.message.includes(key));
  } finally {
    globalThis.fetch=originalFetch;
  }
});
