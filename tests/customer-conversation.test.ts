import {test} from "node:test";
import assert from "node:assert/strict";
import {beginsCustomerConversation,advanceCustomer} from "../src/lib/customer-conversation";
test("customer conversation collects details and requires explicit save",()=>{
  assert.equal(beginsCustomerConversation("नया ग्राहक जोड़ो"),true);
  assert.equal(beginsCustomerConversation("Rahul 500 credit"),false);
  const start={step:"name",name:"",phone:"",nicknames:""} as const;
  const named=advanceCustomer(start,"Rahul Anand"); assert.equal(named.kind,"next");
  if(named.kind!=="next") return;
  assert.equal(advanceCustomer(named.draft,"123").kind,"error");
  const phone=advanceCustomer(named.draft,"skip"); if(phone.kind!=="next") assert.fail();
  const nick=advanceCustomer(phone.draft,"Rahu"); if(nick.kind!=="next") assert.fail();
  assert.equal(advanceCustomer(nick.draft,"anything").kind,"repeat");
  assert.equal(advanceCustomer(nick.draft,"हाँ").kind,"save");
  assert.equal(advanceCustomer(nick.draft,"haan ji add kar do").kind,"save");
  assert.equal(advanceCustomer(nick.draft,"don't save").kind,"cancel");
});
