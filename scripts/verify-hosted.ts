import nextEnv from "@next/env";
import assert from "node:assert/strict";
import { createClient } from "@libsql/client";
nextEnv.loadEnvConfig(process.cwd(), false);
const { db } = await import("../src/lib/db");
const { snapshot } = await import("../src/lib/ledger");
try {
  const data = await snapshot();
  assert.equal(data.storage, "Hosted SQLite");
  assert.ok(data.customers.length);
  const original = await db.entry.findFirstOrThrow();
  await assert.rejects(() =>
    db.entry.update({
      where: { id: original.id },
      data: { note: "should never overwrite" },
    }),
  );
  const count = await db.customer.count();
  await assert.rejects(() =>
    db.$transaction(async (tx) => {
      await tx.customer.create({ data: { name: "Rollback verification" } });
      throw new Error("intentional rollback");
    }),
  );
  assert.equal(await db.customer.count(), count);
  const key = `persistence-${Date.now()}`,
    value = crypto.randomUUID();
  const first = createClient({
    url: process.env.TURSO_DATABASE_URL!,
    authToken: process.env.TURSO_AUTH_TOKEN,
  });
  await first.execute(
    'CREATE TABLE IF NOT EXISTS "_KhataXHealth" (id TEXT PRIMARY KEY, value TEXT NOT NULL)',
  );
  await first.execute({
    sql: 'INSERT INTO "_KhataXHealth" (id,value) VALUES (?,?)',
    args: [key, value],
  });
  first.close();
  const second = createClient({
    url: process.env.TURSO_DATABASE_URL!,
    authToken: process.env.TURSO_AUTH_TOKEN,
  });
  assert.equal(
    (
      await second.execute({
        sql: 'SELECT value FROM "_KhataXHealth" WHERE id=?',
        args: [key],
      })
    ).rows[0].value,
    value,
  );
  second.close();
  console.log(
    JSON.stringify({
      hostedPrisma: true,
      persistsAcrossClients: true,
      immutableEntries: true,
      atomicRollback: true,
      customers: data.customers.length,
      entries: data.entries.length,
    }),
  );
} catch {
  console.error(
    "Hosted database verification failed. No credentials or record contents are logged.",
  );
  process.exitCode = 1;
} finally {
  await db.$disconnect();
}
