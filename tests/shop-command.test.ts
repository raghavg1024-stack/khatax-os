import {test} from "node:test";
import assert from "node:assert/strict";
import {prepareShopCommand,resolveShopIntent} from "../src/lib/shop-command";

test("inventory speech previews use server IDs prices stock and exact quantities without writing",async()=>{
 const catalog={products:[{id:"product-server",name:"Rice bag",sku:"RICE",unit:"bag",pricePaise:25000,stockMilli:5000}],customers:[{id:"customer-server",name:"Ravi Sharma",nicknames:"Ravi"}]};
 const intent={customerName:"Ravi",mode:"credit",items:[{productName:"Rice bag",quantity:"2",unit:"bag"}],needsClarification:false,question:null};
 const ready=resolveShopIntent({...intent,pricePaise:1,productId:"model-invented-id"},catalog);
 assert.equal(ready.blocked,false);assert.ok(ready.draft);
 if(ready.draft?.op!=="sale")assert.fail();
 assert.equal(ready.draft.customerId,"customer-server");assert.deepEqual(ready.draft.lines,[{productId:"product-server",quantityMilli:2000}]);assert.equal(ready.draft.expectedTotalPaise,50000);
 assert.equal(catalog.products[0].stockMilli,5000,"A preview must never modify stock");
 assert.equal(resolveShopIntent({...intent,items:[{productName:"Rice bag",quantity:"6",unit:"bag"}]},catalog).blocked,true);
 assert.equal(resolveShopIntent({...intent,items:[{productName:"Rice bag",quantity:"2",unit:"kg"}]},catalog).blocked,true);
 assert.equal(resolveShopIntent({...intent,items:[{productName:"Rice bag",quantity:"0.0001",unit:"bag"}]},catalog).blocked,true);
 assert.equal(resolveShopIntent({...intent,items:[{productName:"Imaginary",quantity:"1",unit:null}]},catalog).blocked,true);
 const ambiguous={...catalog,customers:[...catalog.customers,{id:"other",name:"Ravi Anand",nicknames:"Ravi"}]};
 assert.equal(resolveShopIntent(intent,ambiguous).blocked,true);
 assert.equal(resolveShopIntent({...intent,customerName:"Ravi Sharma"},ambiguous,"Ravi took two rice bags on credit").blocked,true,"A model cannot expand a shared spoken name");
 assert.equal(resolveShopIntent({...intent,customerName:"Ravi Sharma"},ambiguous,"Ravi Sharma took two Rice bag on credit").blocked,false);
 const previousFetch=globalThis.fetch,previousKey=process.env.GEMINI_API_KEY;
 try{
  process.env.GEMINI_API_KEY="gemini-placeholder";
  globalThis.fetch=async(url,init)=>{
   assert.match(String(url),/^https:\/\/generativelanguage.googleapis.com\/v1beta\/models\//);
   const body=JSON.parse(String(init?.body));
   assert.ok(body.generationConfig.responseJsonSchema);assert.equal(body.systemInstruction.parts[0].text.includes("product-server"),false);assert.equal(body.systemInstruction.parts[0].text.includes("25000"),false);
   return Response.json({candidates:[{finishReason:"STOP",content:{parts:[{text:JSON.stringify(intent)}]}}]});
  };
  assert.equal((await prepareShopCommand("रवि को दो Rice bag उधार दो",catalog)).blocked,false);
  globalThis.fetch=async()=>Response.json({error:{message:"private provider details"}},{status:429});
  await assert.rejects(()=>prepareShopCommand("Ravi two rice bags credit",catalog),error=>error instanceof Error&&!error.message.includes("private provider details"));
 }finally{globalThis.fetch=previousFetch;if(previousKey===undefined)delete process.env.GEMINI_API_KEY;else process.env.GEMINI_API_KEY=previousKey;}
});
