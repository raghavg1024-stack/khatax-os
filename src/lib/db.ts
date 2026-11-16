import { PrismaClient } from "@prisma/client";
import { PrismaLibSQL } from "@prisma/adapter-libsql/web";
const globalDb = globalThis as unknown as { db?: PrismaClient };
const hosted = process.env.TURSO_DATABASE_URL;
if (process.env.VERCEL && !hosted)
  throw new Error("A hosted SQLite database must be configured on Vercel.");
process.env.DATABASE_URL ||= "file:./khatax.db";
export const db =
  globalDb.db ??
  (hosted
    ? new PrismaClient({
        adapter: new PrismaLibSQL(
          { url: hosted, authToken: process.env.TURSO_AUTH_TOKEN },
          { timestampFormat: "unixepoch-ms" },
        ),
      })
    : new PrismaClient());
if (process.env.NODE_ENV !== "production") globalDb.db = db;
