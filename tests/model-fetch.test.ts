import{test}from'node:test';import assert from'node:assert/strict';import{modelFetch}from'../src/lib/model-fetch';
test('read-only inference retries temporary service failures but never authentication or quota',async()=>{
 const previous=globalThis.fetch;let calls=0;
 try{globalThis.fetch=async()=>++calls===1?new Response('',{status:503}):Response.json({ok:true});assert.equal((await modelFetch('https://model.example',{})).status,200);assert.equal(calls,2);
 for(const status of[401,403,429]){calls=0;globalThis.fetch=async()=>{calls++;return new Response('',{status});};assert.equal((await modelFetch('https://model.example',{})).status,status);assert.equal(calls,1);}}
 finally{globalThis.fetch=previous;}
});
