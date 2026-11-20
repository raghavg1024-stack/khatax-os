import assert from "node:assert/strict";
import puppeteer from "puppeteer-core";
import {writeFileSync} from "node:fs";
const base=process.env.QA_URL||"http://127.0.0.1:3022";
assert.ok(["localhost","127.0.0.1"].includes(new URL(base).hostname));
const state=async()=> (await fetch(base+"/api/state")).json();
const before=await state(); assert.equal(before.storage,"Local SQLite"); assert.equal(before.providers.llm,"Local parser · demo");
const name="Voice Customer "+Date.now().toString().replace(/\d/g,d=>String.fromCharCode(97+Number(d)));
const browser=await puppeteer.launch({executablePath:"C:/Program Files/Google/Chrome/Application/chrome.exe",headless:true,args:["--no-sandbox"]});
try {
 const page=await browser.newPage();
 await page.evaluateOnNewDocument(()=>{
  window.replyLanguages=[];window.spokenLanguages=[];window.nextSpeech="";
  window.Audio=class {pause(){} async play(){if(window.qaAuto)setTimeout(()=>this.onended?.(),100);}};
  window.SpeechRecognition=window.webkitSpeechRecognition=class {
   start(){setTimeout(()=>{const transcript=window.qaAuto ? window.speechQueue.shift() : window.nextSpeech;if(!transcript)return;this.onresult?.({resultIndex:0,results:[{isFinal:true,0:{transcript},length:1}]});this.onend?.();},40);}
   stop(){} abort(){}
  };
  const original=window.fetch.bind(window);
  window.fetch=async(input,options)=>{
   if(input==="/api/reply"){const body=JSON.parse(options.body);window.replyLanguages.push(body.language);return Response.json({text:"कृपया जवाब दें।",language:body.language,translated:true});}
   if(input==="/api/speak"){window.spokenLanguages.push(JSON.parse(options.body).language);return new Response(new Blob(["mock-audio"]));}
   const res=await original(input,options);
   if(input==="/api/state"){const body=await res.json();body.providers.sarvamVoice=true;body.providers.streamingVoice=true;body.providers.gnaniVoice=true;return Response.json(body);}
   return res;
  };
 });
 await page.goto(base,{waitUntil:"networkidle0"});
 await page.select('select[aria-label="Voice language"]',"hi-IN");
 await page.select('select[aria-label="Speech recognition"]',"browser");
 const say=async(text,preview=false)=>{
  await page.evaluate(t=>window.nextSpeech=t,text);
  await page.click(preview?'button[aria-label="Answer assistant by voice"]':'button[aria-label="Start voice command"]');
  await page.waitForFunction(()=>!document.querySelector('.mic-instruction')?.textContent?.includes('Listening'));
  await new Promise(r=>setTimeout(r,180));
 };
 await say("नया ग्राहक जोड़ो");
 await page.waitForSelector(".assistant .answer");
 await say(`नाम ${name} है`);
 await say("skip"); await say("skip");
 assert.equal((await state()).customers.length,before.customers.length,"Draft must not create customer");
 await say("हाँ");
 await page.waitForFunction(async n=>(await (await fetch('/api/state')).json()).customers.some(c=>c.name===n),{},name);
 const created=(await state()).customers.find(c=>c.name===name);assert.ok(created,"Spoken confirmation saves supplied customer details");
 const command=async(text)=>{await page.$eval('textarea[aria-label="Type a ledger command"]',el=>el.value="");await page.type('textarea[aria-label="Type a ledger command"]',text);await page.click('button[aria-label="Understand command"]');await page.waitForSelector('.preview-area');};
 await command(`${name} 50 credit`);
 assert.equal((await state()).entries.length,before.entries.length);
 await say("हाँ",true);
 await page.waitForSelector('.preview-area',{hidden:true});
 assert.equal((await state()).customers.find(c=>c.id===created.id).balancePaise,5000);
 await command("Ramesh 40 credit");
 await page.waitForSelector('.clarification select');
 await say("दो",true);
 await page.waitForSelector('.clarification select',{hidden:true});
 await say("नहीं",true);
 await page.waitForSelector('.preview-area',{hidden:true});
 assert.equal((await state()).entries.length,before.entries.length+1);
 const autoName=name+" Auto";
 await page.evaluate(n=>{window.qaAuto=true;window.speechQueue=["नया ग्राहक जोड़ो",`नाम ${n} है`,"skip","skip","हाँ"];},autoName);
 await page.click('button[aria-label="Start voice command"]');
 await page.waitForFunction(async n=>(await (await fetch('/api/state')).json()).customers.some(c=>c.name===n),{},autoName);
 const languages=await page.evaluate(()=>({reply:window.replyLanguages,spoken:window.spokenLanguages}));
 assert.ok(languages.reply.length>=5);assert.ok(languages.reply.every(l=>l==="hi-IN"));assert.ok(languages.spoken.every(l=>l==="hi-IN"));
 const report={passed:true,guidedCustomerCreation:true,automaticFollowupListening:true,noWriteBeforeConfirmation:true,spokenLedgerConfirmation:true,spokenCustomerDisambiguation:true,spokenCancellation:true,sameLanguageReply:true};
 writeFileSync('test-results/conversation-report.json',JSON.stringify(report,null,2));console.log(JSON.stringify(report));
} finally {await browser.close();}
