import {test} from "node:test";
import assert from "node:assert/strict";
import {isSameOriginRequest} from "../src/lib/origin";

test("origin guard accepts canonicalized local aliases and rejects cross-site/forged destinations",()=>{
  const check=(url:string,origin?:string,host?:string,forwarded?:string)=>isSameOriginRequest(new Request(url,{headers:{...(origin?{Origin:origin}:{}),...(host?{Host:host}:{}),...(forwarded?{"X-Forwarded-Host":forwarded}:{})}}));
  assert.equal(check("http://localhost:3002/api/actions","http://127.0.0.1:3002","127.0.0.1:3002"),true);
  assert.equal(check("http://localhost:3002/api/actions","http://localhost:3002","localhost:3002"),true);
  assert.equal(check("https://khatax-os.vercel.app/api/actions","https://khatax-os.vercel.app","khatax-os.vercel.app"),true);
  assert.equal(check("https://khatax-os.vercel.app/api/actions"),true);
  assert.equal(check("http://localhost:3002/api/actions","https://evil.example","localhost:3002"),false);
  assert.equal(check("http://localhost:3002/api/actions","http://localhost:3001","localhost:3002"),false);
  assert.equal(check("http://localhost:3002/api/actions","http://localhost:3002","127.0.0.1:3002"),false);
  assert.equal(check("https://khatax-os.vercel.app/api/actions","https://evil.example","evil.example"),false);
  assert.equal(check("https://khatax-os.vercel.app/api/actions","https://evil.example",undefined,"evil.example"),false);
  assert.equal(check("http://localhost:3002/api/actions","null","localhost:3002"),false);
  assert.equal(check("http://localhost:3002/api/actions","http://localhost:3002","localhost:3002/path"),false);
});
