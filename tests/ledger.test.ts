import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync } from "node:fs";
import { resolve } from "node:path";
import { spawnSync } from "node:child_process";

mkdirSync("test-results", { recursive: true });
process.env.DATABASE_URL = `file:${resolve("test-results", `ledger-${Date.now()}.db`).replaceAll("\\", "/")}`;
delete process.env.OPENAI_API_KEY;
delete process.env.OPEN_AI;
delete process.env.NVIDIA_API_KEY;
delete process.env.NVIDIA_NIM_API_KEY;
delete process.env.GEMINI_API_KEY;
delete process.env.GOOGLE_API_KEY;
delete process.env.GOOGLE_GENERATIVE_AI_API_KEY;
process.env.TURSO_DATABASE_URL = "";
process.env.TURSO_AUTH_TOKEN = "";
const migration = spawnSync(
  process.execPath,
  ["node_modules/prisma/build/index.js", "migrate", "deploy"],
  { env: process.env, encoding: "utf8" },
);
assert.equal(migration.status, 0, migration.stderr);
const { db } = await import("../src/lib/db");
const { prepare, commit, snapshot, signed } = await import("../src/lib/ledger");
const { localExtract, spokenAmount } = await import("../src/lib/intent");
const { indiaDate, toPaise, dateSchema } = await import("../src/lib/shared");

test("exact paise, multilingual parsing, and safe ledger lifecycle", async () => {
  try {
    assert.equal(toPaise("340.10"), 34010);
    assert.equal(toPaise("0.01"), 1);
    for (const value of ["-1", "1.001", "NaN", "0", "1e3", "1000001"])
      assert.throws(() => toPaise(value));
    assert.equal(dateSchema.safeParse("2026-02-30").success, false);
    assert.equal(spokenAmount("teen sau chaalis"), "340");
    assert.equal(spokenAmount("three hundred forty"), "340");
    assert.equal(spokenAmount("500 or 350"), null);
    assert.equal(spokenAmount("one fifty"), null);
    assert.equal(localExtract("Ravi one hundred and fifty credit").length, 1);
    assert.equal(
      localExtract("Ravi one hundred and fifty credit")[0].amount,
      "150",
    );
    assert.equal(
      localExtract("Ravi ka 500 add karo, nahi 350.")[0].amount,
      "350",
    );
    assert.equal(localExtract("Suresh ne kal 200 diye.")[0].kind, "payment");
    assert.equal(
      localExtract("Suresh ne kal 200 diye.")[0].needsClarification,
      true,
    );
    assert.equal(
      localExtract("Ravi ka 100 add karo; Sunita paid 50").length,
      2,
    );
    const ravi = await db.customer.create({
      data: { name: "Ravi Sharma", nicknames: "Ravi,ರವಿ,రవి" },
    });
    const r1 = await db.customer.create({
      data: { name: "Ramesh Kumar", nicknames: "Ramesh,रमेश" },
    });
    await db.customer.create({
      data: { name: "Ramesh Patel", nicknames: "Ramesh,रमेश" },
    });
    await db.customer.create({
      data: { name: "Sunita Devi", nicknames: "Sunita" },
    });
    const preview = await prepare(
      "Ravi ka 500 add karo, nahi 350.",
      localExtract("Ravi ka 500 add karo, nahi 350."),
      "test",
    );
    assert.equal(preview.blocked, false);
    assert.equal(preview.actions[0].amountPaise, 35000);
    assert.equal(await db.entry.count(), 0, "Preview must not post any entry");
    await commit(preview.id, false);
    await commit(preview.id, false);
    assert.equal(await db.entry.count(), 1, "Retry is idempotent");
    assert.equal(
      (await snapshot()).customers.find((c) => c.id === ravi.id)?.balancePaise,
      35000,
    );
    const duplicate = await prepare(
      "Ravi ka 350 add karo",
      localExtract("Ravi ka 350 add karo"),
      "test",
    );
    assert.ok(duplicate.warnings.some((w) => w.includes("duplicate")));
    await assert.rejects(() => commit(duplicate.id, false), /acknowledge/);
    await commit(duplicate.id, true);
    const identity = await prepare(
      "Ramesh ka 340 add karo",
      localExtract("Ramesh ka 340 add karo"),
      "test",
    );
    assert.equal(identity.blocked, true);
    assert.equal(identity.actions[0].candidates?.length, 2);
    await assert.rejects(() => commit(identity.id, false), /clarification/);
    const resolved = await prepare(
      identity.transcript,
      identity.actions,
      "test",
      { "0": { customerId: r1.id } },
    );
    assert.equal(
      resolved.blocked,
      false,
      "Selecting identity must clear its clarification",
    );
    await commit(resolved.id, false);
    for (const transcript of ["Ramesh ka 340 add karo", "रमेश का 340 उधार जोड़ो"]) {
      const guessed = await prepare(
        transcript,
        [{ ...localExtract("Ramesh ka 340 add karo")[0], customerName: "Ramesh Kumar" }],
        "NVIDIA Nemotron",
      );
      assert.equal(guessed.blocked, true, "A model cannot choose a full name from a shared spoken nickname");
      assert.equal(guessed.actions[0].candidates?.length, 2);
      await assert.rejects(() => commit(guessed.id, true), /clarification/);
    }
    const exactIdentity = await prepare(
      "Ramesh Kumar ka 340 add karo",
      [{ ...localExtract("Ramesh ka 340 add karo")[0], customerName: "Ramesh Kumar" }],
      "NVIDIA Nemotron",
    );
    assert.equal(exactIdentity.blocked, false, "An explicitly spoken full name stays unambiguous");
    const identityAndAmount = await prepare(
      "Ramesh 100 or 200 credit",
      [{ ...localExtract("Ramesh 100 credit")[0], customerName: "Ramesh Kumar", needsClarification: true, question: "What is the amount, 100 or 200?" }],
      "NVIDIA Nemotron",
    );
    const justIdentity = await prepare(identityAndAmount.transcript, identityAndAmount.actions, "NVIDIA Nemotron", {
      "0": { customerId: r1.id },
    });
    assert.equal(justIdentity.blocked, true, "Choosing a customer must not clear amount ambiguity");
    assert.deepEqual(justIdentity.actions[0].clarificationFields, ["amount"]);
    const fullyClarified = await prepare(justIdentity.transcript, justIdentity.actions, "NVIDIA Nemotron", {
      "0": { amount: "200" },
    });
    assert.equal(fullyClarified.blocked, false, "Resolved identity survives a later amount edit");
    assert.equal(fullyClarified.actions[0].customerId, r1.id);
    const multi = await prepare(
      "Ravi ka 100 add karo; Sunita paid 50",
      localExtract("Ravi ka 100 add karo; Sunita paid 50"),
      "test",
    );
    assert.equal(multi.actions.length, 2);
    await commit(multi.id, true);
    const undo = await prepare("undo Ravi", localExtract("undo Ravi"), "test");
    const target = undo.actions[0].targetId!;
    assert.ok(target);
    await commit(undo.id, true);
    const original = await db.entry.findUniqueOrThrow({
      where: { id: target },
      include: { reversedBy: true },
    });
    assert.ok(original.reversedBy);
    const reversal = await db.entry.findUniqueOrThrow({
      where: { reversesId: target },
    });
    assert.equal(signed(original) + signed(reversal), 0);
    const beforeCorrect = (await snapshot()).customers.find(
      (c) => c.id === ravi.id,
    )!.balancePaise;
    const correct = await prepare(
      "correct Ravi to 120",
      localExtract("correct Ravi to 120"),
      "test",
    );
    assert.equal(correct.blocked, false);
    const correcting = await db.entry.findUniqueOrThrow({
      where: { id: correct.actions[0].targetId },
    });
    await commit(correct.id, true);
    assert.equal(
      (await snapshot()).customers.find((c) => c.id === ravi.id)!.balancePaise,
      beforeCorrect - signed(correcting) + 12000,
    );
    const amount = await prepare(
      "Ravi 100 or 200",
      localExtract("Ravi 100 or 200"),
      "test",
    );
    assert.equal(amount.blocked, true);
    const date = await prepare(
      "Suresh ne kal 200 diye",
      [{ ...localExtract("Suresh ne kal 200 diye")[0], customerName: "Ravi" }],
      "test",
    );
    assert.equal(date.blocked, true);
    const dateResolved = await prepare(date.transcript, date.actions, "test", {
      "0": { date: indiaDate() },
    });
    assert.equal(dateResolved.blocked, false);
    const ambiguousDateAndAmount = await prepare(
      "Ravi 100 or 200 credit kal",
      [{ ...localExtract("Ravi 100 credit")[0], date: null, needsClarification: true, question: "Which amount and date did you mean?" }],
      "NVIDIA Nemotron",
    );
    const justAmount = await prepare(ambiguousDateAndAmount.transcript, ambiguousDateAndAmount.actions, "NVIDIA Nemotron", {
      "0": { amount: "100" },
    });
    assert.equal(justAmount.blocked, true, "An amount edit must not turn an ambiguous date into today");
    assert.deepEqual(justAmount.actions[0].clarificationFields, ["date"]);
    await assert.rejects(() => commit(justAmount.id, true), /clarification/);
    const bothResolved = await prepare(justAmount.transcript, justAmount.actions, "NVIDIA Nemotron", {
      "0": { date: indiaDate() },
    });
    assert.equal(bothResolved.blocked, false);
    for (const transcript of ["Ravi kal 100 credit", "ரவி 100 கடன்"]) {
      const omittedDate = await prepare(
        transcript,
        [{ ...localExtract("Ravi 100 credit")[0], date: null, needsClarification: false }],
        "NVIDIA Nemotron + Gemini",
      );
      assert.equal(omittedDate.blocked, true, "An omitted model date cannot silently become today in any language");
      assert.deepEqual(omittedDate.actions[0].clarificationFields, ["date"]);
      assert.equal(omittedDate.actions[0].occurredOn, undefined);
    }
    const uncertainIntent = await prepare(
      "Ravi maybe 100",
      [{ ...localExtract("Ravi 100 credit")[0], needsClarification: true, question: "Should this be a payment or credit?" }],
      "NVIDIA Nemotron",
      { "0": { amount: "100" } },
    );
    assert.equal(uncertainIntent.blocked, true, "An amount edit cannot resolve uncertain business intent");
    const expired = await prepare("Ravi 7 credit", localExtract("Ravi 7 credit"), "test");
    await db.command.update({ where: { id: expired.id }, data: { createdAt: new Date(Date.now() - 16 * 60 * 1000) } });
    const beforeExpired = await db.entry.count();
    await assert.rejects(() => commit(expired.id, true), /expired/);
    await db.command.update({ where: { id: expired.id }, data: { state: "cancelled" } });
    await assert.rejects(() => commit(expired.id, true), /no longer available/);
    assert.equal(await db.entry.count(), beforeExpired, "Expired and cancelled previews cannot post");
    const racing = await prepare("Ravi 0.01 credit", localExtract("Ravi 0.01 credit"), "test");
    const beforeRacing = await db.entry.count();
    const racingResults = await Promise.allSettled([commit(racing.id, false), commit(racing.id, false)]);
    assert.ok(racingResults.some((result) => result.status === "fulfilled"));
    assert.equal(await db.entry.count(), beforeRacing + 1, "Concurrent confirmation creates exactly one financial entry");
    assert.equal((await commit(racing.id, false)).idempotent, true);
    const beforeQuery = await db.entry.count();
    const query = await prepare(
      "Ravi balance",
      localExtract("Ravi balance"),
      "test",
    );
    assert.ok(query.answers.length);
    await commit(query.id, false);
    assert.equal(await db.entry.count(), beforeQuery);
    const prior = (await snapshot()).customers.find(
      (c) => c.id === ravi.id,
    )!.balancePaise;
    const mixed = await prepare(
      "Ravi 1 credit; Ravi balance",
      localExtract("Ravi 1 credit; Ravi balance"),
      "test",
    );
    const mixedResult = await commit(mixed.id, false);
    assert.ok(mixedResult.answers?.length);
    assert.equal(
      (await snapshot()).customers.find((c) => c.id === ravi.id)!.balancePaise,
      prior + 100,
    );
    const active = await db.entry.findFirstOrThrow({
      where: { reversedBy: null, reversesId: null },
    });
    const invalid = await db.command.create({
      data: {
        transcript: "atomic rollback test",
        provider: "test",
        warnings: "[]",
        actions: JSON.stringify([
          {
            kind: "credit",
            customerId: ravi.id,
            amount: "12",
            occurredOn: indiaDate(),
            note: "",
            needsClarification: false,
          },
          {
            kind: "undo",
            customerId: ravi.id,
            targetId: "missing",
            needsClarification: false,
          },
        ]),
      },
    });
    const beforeAtomic = await db.entry.count();
    await assert.rejects(() => commit(invalid.id, true));
    assert.equal(
      await db.entry.count(),
      beforeAtomic,
      "An invalid action rolls back the entire batch",
    );
    assert.equal(
      (await db.command.findUniqueOrThrow({ where: { id: invalid.id } })).state,
      "pending",
    );
    await assert.rejects(() =>
      db.entry.update({ where: { id: active.id }, data: { amountPaise: 1 } }),
    );
    await assert.rejects(() => db.entry.delete({ where: { id: active.id } }));
    const audit = await db.audit.findFirstOrThrow();
    await assert.rejects(() => db.audit.delete({ where: { id: audit.id } }));
    assert.ok((await db.audit.count()) >= (await db.entry.count()));
  } finally {
    await db.$disconnect();
  }
});
