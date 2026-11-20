import {test} from "node:test";
import assert from "node:assert/strict";
import {conversationFollowup,replyLanguage} from "../src/lib/conversation";
import type {Preview} from "../src/lib/shared";
test("spoken confirmations are explicit and clarification never bypasses guards",()=>{
  const p={blocked:false,actions:[]} as unknown as Preview;
  assert.equal(conversationFollowup("हाँ",p).kind,"confirm");
  assert.equal(conversationFollowup("yes add 500 to Ravi",p).kind,"unresolved");
  assert.equal(conversationFollowup("नहीं",p).kind,"cancel");
  const blocked={...p,blocked:true,actions:[{needsClarification:true,clarificationFields:["customer"],candidates:[{id:"a",name:"Ravi Sharma"},{id:"b",name:"Ravi Kumar"}]}]} as Preview;
  assert.equal(conversationFollowup("confirm",blocked).kind,"unresolved");
  assert.deepEqual(conversationFollowup("Ravi Kumar",blocked),{kind:"clarify",overrides:{0:{customerId:"b"}}});
  assert.equal(conversationFollowup("Ravi",blocked).kind,"unresolved");
  assert.equal(replyLanguage("राहुल को 500"),"hi-IN");
  assert.equal(replyLanguage("ರವಿ 500"),"kn-IN");
  assert.equal(replyLanguage("Ravi ge", "kn-IN"),"kn-IN");
});
