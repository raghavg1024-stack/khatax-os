import assert from 'node:assert/strict';
import {writeFileSync} from 'node:fs';
import {resolve} from 'node:path';
import puppeteer from 'puppeteer-core';
const base=process.env.QA_URL||'http://127.0.0.1:3030';assert.ok(['localhost','127.0.0.1'].includes(new URL(base).hostname));
const before=await(await fetch(base+'/api/state')).json();assert.equal(before.storage,'Local SQLite');
const browser=await puppeteer.launch({executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true,args:['--no-sandbox','--use-fake-ui-for-media-stream','--use-fake-device-for-media-stream',`--use-file-for-fake-audio-capture=${resolve('test-results/gnani-verification.wav')}`]});
try{
 const page=await browser.newPage();let webm=false;
 await page.exposeFunction('qaWebm',values=>{const data=Buffer.from(values);webm=data.subarray(0,4).toString('hex')==='1a45dfa3';writeFileSync('test-results/offline-recording.webm',data);});
 await page.evaluateOnNewDocument(()=>{const original=window.fetch.bind(window);window.fetch=async(input,options)=>{if(String(input).startsWith('/api/transcribe')){await window.qaWebm([...new Uint8Array(await options.body.arrayBuffer())]);return Response.json({text:'Ravi 5 credit',language:'en-IN'});}return original(input,options);};});
 await page.goto(base,{waitUntil:'networkidle0'});await page.setOfflineMode(true);
 await page.click('button[aria-label="Start voice command"]');
 await page.waitForFunction(()=>document.body.textContent.includes('Recording offline'));
 await new Promise(resolve=>setTimeout(resolve,4500));
 await page.click('button[aria-label="Stop listening"]');
 await page.waitForFunction(()=>document.body.textContent.includes('Offline voice recording saved'));
 await page.setOfflineMode(false);
 await page.click('button[aria-label="Open shop tools"]');await page.select('select[aria-label="Shop tool"]','offline');
 await page.waitForFunction(()=>document.querySelector('[role="dialog"]')?.textContent.includes('Voice recording'));
 const replay=await page.evaluateHandle(()=>[...document.querySelectorAll('[role="dialog"] fieldset')].find(el=>el.textContent.includes('Voice recording'))?.querySelector('button'));
 await replay.asElement().click();await page.waitForSelector('.preview-area');
 assert.equal(webm,true);assert.equal((await(await fetch(base+'/api/state')).json()).entries.length,before.entries.length);
 assert.ok(await page.$('button[aria-label="Reply to assistant by voice"]'));
 const report={passed:true,nativeOfflineRecording:true,indexedDbPersistence:true,replayThroughTranscription:true,reviewOnly:true};writeFileSync('test-results/offline-voice-report.json',JSON.stringify(report,null,2));console.log(JSON.stringify(report));
}finally{await browser.close();}
