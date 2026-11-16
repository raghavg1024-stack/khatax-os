import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { setTimeout as delay } from "node:timers/promises";
import { WebSocket } from "ws";

// Calls only the local app. Credentials stay in the server's environment.
const base = process.env.VERIFY_URL || "http://localhost:3000";
const report = {
  checkedAt: new Date().toISOString(),
  providers: {},
  checks: [],
};
const state = async () => {
  const response = await fetch(`${base}/api/state`, {
    signal: AbortSignal.timeout(10000),
  });
  assert.equal(response.status, 200, "Local app state could not be read");
  return response.json();
};
const action = async (body) => {
  const response = await fetch(`${base}/api/actions`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(60000),
  });
  if (!response.ok)
    throw new Error(`Local action endpoint returned HTTP ${response.status}`);
  return response.json();
};
async function check(name, fn) {
  try {
    await fn();
    report.checks.push({ name, passed: true });
    console.log(`${name}: PASS`);
  } catch (error) {
    // Do not print provider errors or arbitrary exception objects: they can contain credentials.
    const safe =
      error instanceof assert.AssertionError
        ? error.message.split("\n")[0]
        : /^Local |^Gnani |^Voice |^Invalid WAV|^Unsupported WAV|^No final|^Unexpected/.test(
              error.message || "",
            )
          ? error.message
          : "Connection or validation failed";
    report.checks.push({ name, passed: false, reason: safe });
    console.log(`${name}: FAIL (${safe})`);
  }
}
function pcm16k(wav) {
  if (
    wav.toString("ascii", 0, 4) !== "RIFF" ||
    wav.toString("ascii", 8, 12) !== "WAVE"
  )
    throw new Error("Invalid WAV response");
  let rate = 0,
    channels = 0,
    width = 0,
    format = 0,
    samples;
  for (let offset = 12; offset + 8 <= wav.length; ) {
    const tag = wav.toString("ascii", offset, offset + 4),
      size = wav.readUInt32LE(offset + 4),
      start = offset + 8;
    if (tag === "data" && size === 0xffffffff) {
      samples = wav.subarray(start);
      break;
    }
    if (start + size > wav.length) break;
    if (tag === "fmt ") {
      format = wav.readUInt16LE(start);
      channels = wav.readUInt16LE(start + 2);
      rate = wav.readUInt32LE(start + 4);
      width = wav.readUInt16LE(start + 14);
      if (format === 65534 && size >= 40) format = wav.readUInt16LE(start + 24);
    }
    if (tag === "data") samples = wav.subarray(start, start + size);
    offset = start + size + (size % 2);
  }
  if (
    !samples ||
    channels !== 1 ||
    !rate ||
    !(
      (format === 1 && [16, 24, 32].includes(width)) ||
      (format === 3 && [32, 64].includes(width))
    )
  )
    throw new Error(
      `Unsupported WAV encoding (format=${format}, channels=${channels}, width=${width}, rate=${rate}, data=${!!samples})`,
    );
  const bytes = width / 8,
    sampleCount = samples.length / bytes;
  const read = (index) =>
    format === 3
      ? width === 32
        ? samples.readFloatLE(index * bytes)
        : samples.readDoubleLE(index * bytes)
      : samples.readIntLE(index * bytes, bytes) / 2 ** (width - 1);
  const count = Math.floor((sampleCount * 16000) / rate),
    out = Buffer.alloc(count * 2);
  for (let i = 0; i < count; i++) {
    const position = (i * rate) / 16000,
      lo = Math.floor(position),
      hi = Math.min(lo + 1, sampleCount - 1),
      weight = position - lo;
    const sample = Math.max(
      -1,
      Math.min(1, read(lo) * (1 - weight) + read(hi) * weight),
    );
    out.writeInt16LE(Math.round(sample * 32767), i * 2);
  }
  return out;
}
async function transcribe(pcm) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(
      `${base.replace("http:", "ws:")}/api/voice?language=en-IN`,
    );
    let done = false,
      sending = false;
    const finish = (error, result) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      ws.close();
      error ? reject(error) : resolve(result);
    };
    const timer = setTimeout(
      () => finish(new Error("Voice streaming timed out")),
      55000,
    );
    ws.on("error", () =>
      finish(new Error("Voice WebSocket connection failed")),
    );
    ws.on("close", () => {
      if (!done)
        finish(new Error("Voice connection closed before a final transcript"));
    });
    ws.on("message", async (raw) => {
      let event;
      try {
        event = JSON.parse(raw.toString());
      } catch {
        return finish(new Error("Unexpected voice response"));
      }
      if (event.type === "error")
        return finish(new Error("Gnani streaming returned an error"));
      if (event.type === "demo")
        return finish(new Error("Gnani key was not loaded by the server"));
      if (event.type === "transcript" && event.text)
        return finish(null, event.text);
      if (event.type !== "connected" || sending) return;
      sending = true;
      try {
        const audio = Buffer.concat([
          Buffer.alloc(6400),
          pcm,
          Buffer.alloc(32000),
        ]);
        for (let offset = 0; offset < audio.length && !done; offset += 1024) {
          const frame = Buffer.alloc(1024);
          audio.copy(frame, 0, offset, Math.min(offset + 1024, audio.length));
          if (ws.readyState !== WebSocket.OPEN) break;
          ws.send(frame, { binary: true });
          await delay(32);
        }
        if (!done && ws.readyState === WebSocket.OPEN)
          ws.send(JSON.stringify({ type: "commit" }));
      } catch {
        finish(new Error("Voice audio streaming failed"));
      }
    });
  });
}

try {
  const before = await state();
  report.providers = before.providers;
  console.log("Configured providers:", JSON.stringify(before.providers));
  const cases = [
    {
      name: `${before.providers.llm} Hindi self-correction`,
      text: "Ravi ka paanch sau add karo, nahi teen sau pachaas.",
      expected: [["credit", 35000]],
    },
    {
      name: `${before.providers.llm} Kannada-English`,
      text: "Ravi ge eradu nooru rupees udhaar add maadi.",
      expected: [["credit", 20000]],
    },
    {
      name: `${before.providers.llm} Telugu`,
      text: "రవి ఖాతాలో మూడు వందల యాభై రూపాయల బాకీ జోడించు.",
      expected: [["credit", 35000]],
    },
    {
      name: `${before.providers.llm} multiple actions`,
      text: "Add 125.50 credit to Ravi and record a 50 rupee payment from Sunita.",
      expected: [
        ["credit", 12550],
        ["payment", 5000],
      ],
    },
    {
      name: `${before.providers.llm} customer identity clarification`,
      text: "Ramesh ka teen sau chaalis udhaar add karo.",
      ambiguous: true,
    },
  ];
  const speechOnly = process.argv.includes("--speech-only");
  for (const c of speechOnly ? [] : cases)
    await check(c.name, async () => {
      const preview = await action({ op: "preview", text: c.text });
      try {
        assert.equal(
          preview.provider,
          before.providers.llm,
          "Expected the configured live provider",
        );
        assert.ok(["NVIDIA Nemotron", "Gemini", "OpenAI"].includes(preview.provider), "A demo parser is not a live provider check");
        if (c.ambiguous) {
          assert.equal(
            preview.blocked,
            true,
            "Shared customer name must be clarified",
          );
          assert.equal(
            preview.actions[0].candidates?.length,
            2,
            "Both matching customers should be offered",
          );
        } else {
          assert.equal(
            preview.blocked,
            false,
            "Unambiguous sample should produce a review",
          );
          assert.deepEqual(
            preview.actions.map((a) => [a.kind, a.amountPaise]),
            c.expected,
            "Extracted actions differ from the spoken instruction",
          );
        }
      } finally {
        await action({ op: "cancel", commandId: preview.id });
      }
    });
  let wav;
  await check("Gnani Timbre v3.0 synthesis", async () => {
    const response = await fetch(`${base}/api/speak`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        text: "Ravi paid three hundred and fifty rupees.",
        language: "en-IN",
      }),
      signal: AbortSignal.timeout(35000),
    });
    if (!response.ok)
      throw new Error(
        `Gnani synthesis endpoint returned HTTP ${response.status}`,
      );
    wav = Buffer.from(await response.arrayBuffer());
    mkdirSync("test-results", { recursive: true });
    writeFileSync("test-results/gnani-verification.wav", wav);
    pcm16k(wav);
    assert.ok(wav.length > 1000, "Speech audio is unexpectedly short");
  });
  if (wav)
    await check("Gnani Prisma v3.0 streaming round-trip", async () => {
      const transcript = await transcribe(pcm16k(wav));
      assert.ok(
        /ravi/i.test(transcript),
        "Expected customer name in synthesized speech transcript",
      );
      assert.ok(
        /paid/i.test(transcript),
        "Expected payment instruction in speech transcript",
      );
      assert.ok(
        /350|three hundred(?: and)? fifty/i.test(transcript),
        "Expected amount in speech transcript",
      );
      if (speechOnly) return;
      const preview = await action({ op: "preview", text: transcript });
      try {
        assert.equal(
          preview.blocked,
          false,
          "Speech transcript should produce a review",
        );
        assert.deepEqual(
          preview.actions.map((a) => [a.kind, a.amountPaise]),
          [["payment", 35000]],
          "Speech round-trip must preserve payment and amount",
        );
      } finally {
        await action({ op: "cancel", commandId: preview.id });
      }
    });
  if (wav && process.argv.includes("--browser"))
    await check("Browser speech audio decoding", async () => {
      const { default: puppeteer } = await import("puppeteer-core");
      const browser = await puppeteer.launch({
        executablePath: "C:/Program Files/Google/Chrome/Application/chrome.exe",
        headless: true,
        args: ["--no-sandbox"],
      });
      try {
        const page = await browser.newPage();
        await page.goto(base, { waitUntil: "networkidle0" });
        await page.waitForSelector(".stats");
        assert.equal(
          await page.$(".demo-badge"),
          null,
          "Live Gnani mode should replace the browser speech demo label",
        );
        const decoded = await page.evaluate(
          async (numbers) => {
            const context = new AudioContext();
            try {
              const audio = await context.decodeAudioData(
                Uint8Array.from(numbers).buffer,
              );
              return {
                duration: audio.duration,
                channels: audio.numberOfChannels,
              };
            } finally {
              await context.close();
            }
          },
          [...wav],
        );
        assert.ok(
          decoded.duration > 1,
          "Browser should decode playable speech audio",
        );
        assert.equal(decoded.channels, 1);
      } finally {
        await browser.close();
      }
    });
  await check("Ledger unchanged during provider verification", async () => {
    const after = await state();
    assert.equal(
      after.entries.length,
      before.entries.length,
      "Provider verification must not post financial entries",
    );
    assert.deepEqual(
      after.customers.map((c) => [c.id, c.balancePaise]),
      before.customers.map((c) => [c.id, c.balancePaise]),
      "Provider verification must preserve balances",
    );
  });
  mkdirSync("test-results", { recursive: true });
  writeFileSync(
    "test-results/live-provider-report.json",
    JSON.stringify(report, null, 2),
  );
  process.exitCode = report.checks.some((c) => !c.passed) ? 1 : 0;
} catch {
  console.error(
    "Local application connection failed. Check the server and retry.",
  );
  process.exitCode = 1;
}
