import assert from "node:assert/strict";
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import puppeteer from "puppeteer-core";

// Explicit live-provider check: fake microphone audio, real worklet and STT.
// Never run financial test flows against a hosted shop.
const base = process.env.VERIFY_URL || "http://127.0.0.1:3005";
assert.ok(["localhost", "127.0.0.1"].includes(new URL(base).hostname));
const state = async () => (await fetch(`${base}/api/state`)).json();
const before = await state();
assert.equal(before.storage, "Local SQLite");
assert.equal(before.providers.streamingVoice, true);
// Use the speech-only verifier first to generate this known payment recording.
const wav = readFileSync("test-results/gnani-verification.wav");
assert.equal(wav.toString("ascii", 0, 4), "RIFF");
let offset = 12, rate, dataOffset;
while (offset + 8 <= wav.length) {
  const size = wav.readUInt32LE(offset + 4);
  if (wav.toString("ascii", offset, offset + 4) === "fmt ") rate = wav.readUInt32LE(offset + 12);
  if (wav.toString("ascii", offset, offset + 4) === "data") { dataOffset = offset; break; }
  offset += 8 + size + (size % 2);
}
assert.ok(rate && dataOffset);
const silence = Buffer.alloc(rate * 2 * 8);
const audio = Buffer.concat([wav.subarray(0, dataOffset + 8), silence, wav.subarray(dataOffset + 8), silence]);
audio.writeUInt32LE(audio.length - 8, 4);
audio.writeUInt32LE(audio.length - dataOffset - 8, dataOffset + 4);
const audioPath = resolve("test-results/microphone-input.wav");
writeFileSync(audioPath, audio);
const browser = await puppeteer.launch({
  executablePath: "C:/Program Files/Google/Chrome/Application/chrome.exe",
  headless: true,
  args: ["--no-sandbox", "--use-fake-ui-for-media-stream", "--use-fake-device-for-media-stream", `--use-file-for-fake-audio-capture=${audioPath}`],
});
try {
  const page = await browser.newPage();
  let frames = 0;
  const session = await page.createCDPSession();
  await session.send("Network.enable");
  session.on("Network.webSocketFrameSent", ({response}) => { if (response.opcode === 2) frames++; });
  await page.goto(base, {waitUntil: "networkidle0"});
  await page.select('select[aria-label="Voice language"]', "en-IN");
  await page.click('button[aria-label="Start voice command"]');
  await page.waitForFunction(() => document.querySelector(".mic-instruction")?.textContent.includes("Listening"), {timeout: 20000});
  await page.waitForSelector(".preview-area", {timeout: 60000});
  assert.ok(frames > 30, "Actual browser capture must send PCM frames");
  const text = await page.$eval(".preview-area", (el) => el.textContent);
  assert.match(text, /350/);
  assert.match(text, /payment/i);
  const discard = await page.$$("button");
  for (const button of discard) if ((await button.evaluate(el => el.textContent)).trim() === "Discard") { await button.click(); break; }
  const after = await state();
  assert.equal(after.entries.length, before.entries.length);
  assert.deepEqual(after.customers.map(c=>[c.id,c.balancePaise]), before.customers.map(c=>[c.id,c.balancePaise]));
  const report = {passed:true, actualBrowserMicrophone:true, pcmFrames:frames, realSpeechProvider:true, paymentPaise:35000, ledgerUnchanged:true};
  writeFileSync("test-results/microphone-report.json", JSON.stringify(report,null,2));
  console.log(JSON.stringify(report));
} finally { await browser.close(); }
