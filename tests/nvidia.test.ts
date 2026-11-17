import {test} from "node:test";
import assert from "node:assert/strict";
import {extractNvidia,reviewWithNvidia} from "../src/lib/nvidia";
import {UserInputError} from "../src/lib/errors";

test("Nemotron uses NVIDIA's endpoint and rejects unsafe or incomplete JSON", async () => {
  const originalFetch=globalThis.fetch;
  const key="nvidia-key-placeholder";
  const action={kind:"credit" as const,customerName:"Ravi",amount:"350",date:"2026-11-16",note:"",needsClarification:false,question:null};
  const completion=(value:unknown,finish_reason="stop")=>({id:"test-completion",object:"chat.completion",created:0,model:"nvidia/nemotron-3.5-lightning-30b-a3b",choices:[{index:0,finish_reason,message:{role:"assistant",content:JSON.stringify(value)}}]});
  try{
    globalThis.fetch=async(url,options)=>{
      assert.equal(String(url),"https://integrate.api.nvidia.com/v1/chat/completions");
      assert.equal(new Headers(options?.headers).get("Authorization"),`Bearer ${key}`);
      const body=JSON.parse(String(options?.body));
      assert.equal(body.model,process.env.NVIDIA_MODEL||"nvidia/nemotron-3.5-lightning-30b-a3b");
      assert.equal(body.response_format.type,"json_schema");
      assert.equal(body.response_format.json_schema.strict,true);
      assert.equal(body.temperature,0);
      assert.equal(body.chat_template_kwargs.enable_thinking,false);
      assert.equal(body.messages[1].content,"Ravi 500 nahi 350");
      return Response.json(completion({actions:[action]}));
    };
    assert.deepEqual(await extractNvidia("Ravi 500 nahi 350","instruction",key),[action]);
    for(const value of [{actions:[]},{actions:[{...action,kind:"delete_all"}]},{actions:[{...action,amount:350}]}]){
      globalThis.fetch=async()=>Response.json(completion(value));
      await assert.rejects(()=>extractNvidia("command","instruction",key),{code:"nvidia_invalid_output"});
    }
    globalThis.fetch=async()=>Response.json(completion({actions:[action]},"length"));
    await assert.rejects(()=>extractNvidia("command","instruction",key),{code:"nvidia_invalid_output"});
    globalThis.fetch=async()=>Response.json(completion({actions:[{...action,amount:"350.00"}]}));
    assert.deepEqual(await reviewWithNvidia([action],"instruction",key),[action]);
    globalThis.fetch=async()=>Response.json(completion({actions:[{...action,amount:"300"}]}));
    await assert.rejects(()=>reviewWithNvidia([action],"instruction",key),{code:"intent_disagreement"});
    globalThis.fetch=async()=>Response.json(completion({actions:[{...action,customerName:"Wrong full name"}]}));
    assert.equal((await reviewWithNvidia([action],"instruction",key))[0].customerName,"Ravi");
    for(const [status,code] of [[429,"nvidia_rate_limited"],[403,"nvidia_configuration"],[500,"nvidia_unavailable"]] as const){
      globalThis.fetch=async()=>Response.json({error:{message:`Provider echoed ${key}`}},{status});
      await assert.rejects(()=>extractNvidia("command","instruction",key),(error:unknown)=>error instanceof UserInputError&&error.code===code&&!error.message.includes(key));
    }
  }finally{globalThis.fetch=originalFetch;}
});
