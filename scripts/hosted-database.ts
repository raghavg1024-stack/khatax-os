import nextEnv from "@next/env";
import { createClient } from "@libsql/client";
import { PrismaClient } from "@prisma/client";
import { createHash } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

nextEnv.loadEnvConfig(process.cwd(), false);
const url = process.env.TURSO_DATABASE_URL;
if (!url?.startsWith("libsql://") && !url?.startsWith("https://"))
  throw new Error("Hosted database configuration is missing.");
const remote = createClient({
  url: url!,
  authToken: process.env.TURSO_AUTH_TOKEN,
});
const hash = (text: string) => createHash("sha256").update(text).digest("hex");

try {
  await remote.execute(
    'CREATE TABLE IF NOT EXISTS "_KhataXMigrations" (name TEXT PRIMARY KEY, checksum TEXT NOT NULL, appliedAt INTEGER NOT NULL)',
  );
  for (const name of readdirSync("prisma/migrations")
    .filter((n) => /^\d/.test(n))
    .sort()) {
    const sql = readFileSync(
      `prisma/migrations/${name}/migration.sql`,
      "utf8",
    ).replaceAll("\r\n", "\n");
    const checksum = hash(sql);
    const existing = await remote.execute({
      sql: 'SELECT checksum FROM "_KhataXMigrations" WHERE name = ?',
      args: [name],
    });
    if (existing.rows.length) {
      if (existing.rows[0].checksum !== checksum)
        throw new Error(`Applied migration changed: ${name}`);
      continue;
    }
    const tx = await remote.transaction("write");
    try {
      await tx.executeMultiple(sql);
      await tx.execute({
        sql: 'INSERT INTO "_KhataXMigrations" (name,checksum,appliedAt) VALUES (?,?,?)',
        args: [name, checksum, Date.now()],
      });
      await tx.commit();
      console.log(JSON.stringify({ migration: name, applied: true }));
    } finally {
      tx.close();
    }
  }
  if (process.argv.includes("--import-local")) {
    const localPath = resolve("prisma/khatax.db").replaceAll("\\", "/");
    const local = new PrismaClient({
      datasources: { db: { url: `file:${localPath}` } },
    });
    try {
      const [customers, entries, commands, audits] = await Promise.all([
        local.customer.findMany({ orderBy: { id: "asc" } }),
        local.entry.findMany({
          orderBy: [{ createdAt: "asc" }, { id: "asc" }],
        }),
        local.command.findMany({ orderBy: { id: "asc" } }),
        local.audit.findMany({ orderBy: { id: "asc" } }),
      ]);
      const snapshot = {
        Customer: customers,
        Entry: entries,
        Command: commands,
        Audit: audits,
      };
      const checksum = hash(JSON.stringify(snapshot));
      const marker = "local-ledger-import-v1";
      const imported = await remote.execute({
        sql: 'SELECT checksum FROM "_KhataXMigrations" WHERE name = ?',
        args: [marker],
      });
      if (imported.rows.length) {
        if (imported.rows[0].checksum !== checksum)
          throw new Error(
            "Local records changed after the initial import. Automatic overwrite is not allowed.",
          );
        console.log(JSON.stringify({ imported: false, alreadyImported: true }));
      } else {
        const tx = await remote.transaction("write");
        try {
          for (const table of Object.keys(snapshot)) {
            const count = await tx.execute(
              `SELECT COUNT(*) AS n FROM "${table}"`,
            );
            if (Number(count.rows[0].n) !== 0)
              throw new Error(
                "Refusing to import into a non-empty hosted ledger.",
              );
          }
          await tx.execute("PRAGMA defer_foreign_keys = ON");
          for (const [table, rows] of Object.entries(snapshot))
            for (const row of rows) {
              const columns = Object.keys(row);
              await tx.execute({
                sql: `INSERT INTO "${table}" (${columns.map((c) => `"${c}"`).join(",")}) VALUES (${columns.map(() => "?").join(",")})`,
                args: Object.values(row).map((value) =>
                  value instanceof Date ? value.getTime() : value,
                ),
              });
            }
          await tx.execute({
            sql: 'INSERT INTO "_KhataXMigrations" (name,checksum,appliedAt) VALUES (?,?,?)',
            args: [marker, checksum, Date.now()],
          });
          await tx.commit();
          console.log(
            JSON.stringify({
              imported: true,
              counts: Object.fromEntries(
                Object.entries(snapshot).map(([name, rows]) => [
                  name,
                  rows.length,
                ]),
              ),
            }),
          );
        } finally {
          tx.close();
        }
      }
    } finally {
      await local.$disconnect();
    }
  }
  const counts: Record<string, number> = {};
  for (const table of ["Customer", "Entry", "Command", "Audit"])
    counts[table] = Number(
      (await remote.execute(`SELECT COUNT(*) AS n FROM "${table}"`)).rows[0].n,
    );
  const triggers = await remote.execute(
    "SELECT name FROM sqlite_master WHERE type='trigger'",
  );
  console.log(
    JSON.stringify({
      hostedDatabaseReady: true,
      counts,
      immutableTriggers: triggers.rows.length,
    }),
  );
} catch {
  console.error(
    "Hosted database initialization failed. No credentials or records are printed; inspect configuration and migration state before retrying.",
  );
  process.exitCode = 1;
} finally {
  remote.close();
}
