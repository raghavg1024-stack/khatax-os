import { spawn, spawnSync } from "node:child_process";
import { mkdirSync } from "node:fs";
import { resolve } from "node:path";
mkdirSync("test-results", { recursive: true });
process.env.DATABASE_URL = `file:${resolve("test-results", `browser-${Date.now()}.db`).replaceAll("\\", "/")}`;
process.env.OPENAI_API_KEY = "";
process.env.TURSO_DATABASE_URL = "";
process.env.TURSO_AUTH_TOKEN = "";
process.env.GNANI_API_KEY = "";
process.env.PORT = "3001";
for (const args of [
  ["node_modules/prisma/build/index.js", "migrate", "deploy"],
  ["node_modules/tsx/dist/cli.mjs", "prisma/seed.ts"],
]) {
  const result = spawnSync(process.execPath, args, {
    env: process.env,
    stdio: "inherit",
  });
  if (result.status) process.exit(result.status);
}
const server = spawn(
  process.execPath,
  ["node_modules/tsx/dist/cli.mjs", "server.ts", "--production"],
  { env: process.env, stdio: "inherit" },
);
server.on("exit", (code) => process.exit(code ?? 0));
for (const signal of ["SIGINT", "SIGTERM"])
  process.on(signal, () => server.kill(signal));
