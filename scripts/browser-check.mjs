import puppeteer from "puppeteer-core";
import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
const url = process.env.QA_URL || "http://localhost:3001";
mkdirSync("test-results", { recursive: true });
const browser = await puppeteer.launch({
  executablePath: "C:/Program Files/Google/Chrome/Application/chrome.exe",
  headless: true,
  args: ["--no-sandbox", "--disable-dev-shm-usage"],
});
const page = await browser.newPage();
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));
const clickText = async (text, selector = "button") => {
  const found = await page.evaluate(
    (text, selector) => {
      const element = [...document.querySelectorAll(selector)].find(
        (el) => el.textContent.trim() === text,
      );
      if (!element) return false;
      element.click();
      return true;
    },
    text,
    selector,
  );
  assert.ok(found, `Missing ${selector}: ${text}`);
};
const state = async () => {
  const r = await fetch(`${url}/api/state`);
  assert.equal(r.status, 200);
  return r.json();
};
try {
  await new Promise((resolve, reject) => {
    const ws = new WebSocket(url.replace("http:", "ws:") + "/api/voice");
    const timer = setTimeout(
      () => reject(new Error("Voice WebSocket timed out")),
      5000,
    );
    ws.onmessage = (e) => {
      try {
        assert.equal(JSON.parse(e.data).type, "demo");
        clearTimeout(timer);
        ws.close();
        resolve();
      } catch (err) {
        reject(err);
      }
    };
    ws.onerror = reject;
  });
  await page.setViewport({ width: 1440, height: 1000, deviceScaleFactor: 1 });
  await page.goto(url, { waitUntil: "networkidle0" });
  await page.waitForSelector(".stats");
  await page.screenshot({
    path: "test-results/overview-desktop.png",
    fullPage: true,
  });
  assert.equal(
    await page.$eval("h1", (el) => el.textContent),
    "Your shop, in good books.",
  );
  const before = await state();
  await clickText("Add customer");
  await page.waitForSelector('[role="dialog"]');
  await page.type('input[name="name"]', "QA Customer");
  await page.type('input[name="phone"]', "9876543210");
  await page.type('input[name="nicknames"]', "QATest");
  await page.click('[role="dialog"] button[type="submit"]');
  await page.waitForSelector('[role="dialog"]', { hidden: true });
  const customer = (await state()).customers.find(
    (c) => c.name === "QA Customer",
  );
  assert.ok(customer);
  await clickText("New entry");
  await page.waitForSelector('select[name="customer"]');
  await page.select('select[name="customer"]', customer.id);
  await page.type('input[name="amount"]', "123.45");
  await page.type('input[name="note"]', "Browser verification");
  await page.click('[role="dialog"] button[type="submit"]');
  await page.waitForSelector(".preview-area");
  assert.equal(
    (await state()).entries.length,
    before.entries.length,
    "Review must not write entries",
  );
  await page.screenshot({
    path: "test-results/entry-review.png",
    fullPage: true,
  });
  await clickText("Confirm & record");
  await page.waitForSelector(".preview-area", { hidden: true });
  assert.equal(
    (await state()).customers.find((c) => c.id === customer.id).balancePaise,
    12345,
  );
  await page.type(
    'textarea[aria-label="Type a ledger command"]',
    "QATest 100 credit; Sunita paid 50",
  );
  await page.click('button[aria-label="Understand command"]');
  await page.waitForSelector(".preview-area");
  assert.equal(await page.$$eval(".preview-action", (els) => els.length), 2);
  const ack = await page.$('.safety-warning input[type="checkbox"]');
  if (ack) await ack.click();
  await clickText("Confirm & record");
  await page.waitForSelector(".preview-area", { hidden: true });
  assert.equal(
    (await state()).customers.find((c) => c.id === customer.id).balancePaise,
    22345,
  );
  await page.type(
    'textarea[aria-label="Type a ledger command"]',
    "Ramesh ka teen sau chaalis udhaar add karo",
  );
  await page.click('button[aria-label="Understand command"]');
  await page.waitForSelector(".clarification select");
  const option = await page.$eval(
    ".clarification select option:nth-child(2)",
    (el) => el.value,
  );
  await page.select(".clarification select", option);
  await clickText("Check again");
  await page.waitForFunction(
    () =>
      document.querySelector(".preview-heading h2")?.textContent ===
      "Heard you. Let’s check.",
  );
  await clickText("Discard");
  await page.waitForSelector(".preview-area", { hidden: true });
  await clickText("Ledger");
  await page.waitForSelector('input[aria-label="Search transactions"]');
  await page.type('input[aria-label="Search transactions"]', "QA Customer");
  assert.ok(page.url().includes("q="));
  await page.waitForFunction(
    () => document.querySelectorAll("tbody tr").length === 2,
  );
  await page.click('button[aria-label="Undo QA Customer transaction"]');
  await page.waitForSelector(".safety-warning input");
  await page.click(".safety-warning input");
  await clickText("Confirm & record");
  await page.waitForSelector(".preview-area", { hidden: true });
  assert.equal(
    (await state()).customers.find((c) => c.id === customer.id).balancePaise,
    12345,
  );
  await clickText("Customers");
  await page.waitForSelector('input[aria-label="Search customers"]');
  await page.type('input[aria-label="Search customers"]', "QA Customer");
  await page.waitForFunction(
    () => document.querySelectorAll(".customer-row").length === 1,
  );
  await page.click('button[aria-label="Edit QA Customer"]');
  await page.waitForSelector('input[name="nicknames"]');
  await page.type('input[name="nicknames"]', ", QA nickname");
  await page.click('[role="dialog"] button[type="submit"]');
  await page.waitForSelector('[role="dialog"]', { hidden: true });
  assert.ok(
    (await state()).customers
      .find((c) => c.id === customer.id)
      .nicknames.includes("QA nickname"),
  );
  await clickText("Insights");
  await page.waitForSelector("meter");
  await clickText("KhataGuard");
  await page.waitForSelector(".audit-item");
  await page.click(".audit-item button");
  await page.waitForSelector(".audit-item pre");
  await page.screenshot({
    path: "test-results/audit-desktop.png",
    fullPage: true,
  });
  const csv = await fetch(`${url}/api/export`);
  assert.ok(csv.headers.get("content-type").includes("text/csv"));
  assert.ok((await csv.text()).includes("QA Customer"));
  const bad = await fetch(`${url}/api/actions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Origin: "https://untrusted.example",
    },
    body: JSON.stringify({ op: "preview", text: "Ravi 100" }),
  });
  assert.equal(bad.status, 403);
  await page.evaluate(() => {
    window.webkitSpeechRecognition = class {
      start() {
        setTimeout(
          () =>
            this.onresult?.({
              resultIndex: 0,
              results: [
                {
                  isFinal: true,
                  0: { transcript: "QATest 25 credit" },
                  length: 1,
                },
              ],
            }),
          30,
        );
      }
      stop() {}
      abort() {}
    };
    window.SpeechRecognition = undefined;
  });
  const beforeVoice = (await state()).entries.length;
  await page.click('button[aria-label="Start voice command"]');
  await page.waitForSelector(".preview-area");
  assert.ok(
    (await page.$eval(".preview-action b", (el) => el.textContent)).includes(
      "25",
    ),
  );
  assert.equal((await state()).entries.length, beforeVoice);
  await clickText("Discard");
  await page.waitForSelector(".preview-area", { hidden: true });
  await clickText("Overview");
  await page.evaluate(() =>
    document
      .querySelector('button[aria-label="Dismiss notification"]')
      ?.click(),
  );
  await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 1 });
  await page.screenshot({
    path: "test-results/overview-mobile.png",
    fullPage: true,
  });
  assert.equal(
    await page.evaluate(
      () => document.documentElement.scrollWidth > window.innerWidth,
    ),
    false,
    "Mobile must not overflow horizontally",
  );
  await page.setViewport({ width: 1280, height: 800, deviceScaleFactor: 1 });
  await page.screenshot({
    path: "test-results/overview-1280.png",
    fullPage: true,
  });
  assert.equal(errors.length, 0, errors.join("\n"));
  const report = {
    passed: true,
    checks: [
      "Desktop dashboard",
      "Create/edit customer",
      "Manual review does not write",
      "Exact payment and credit arithmetic",
      "Multi-action command",
      "Identity clarification",
      "Row reversal",
      "Search URL state",
      "Customer search",
      "Insights chart",
      "Audit disclosure",
      "CSV export",
      "Cross-origin rejection",
      "Mobile overflow",
      "No browser exceptions",
    ],
    screenshots: [
      "overview-desktop.png",
      "entry-review.png",
      "audit-desktop.png",
      "overview-mobile.png",
      "overview-1280.png",
    ],
  };
  writeFileSync(
    "test-results/browser-report.json",
    JSON.stringify(report, null, 2),
  );
  console.log(JSON.stringify(report, null, 2));
} finally {
  await browser.close();
}
