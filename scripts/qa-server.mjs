import { spawn, spawnSync } from "node:child_process";
import { mkdirSync } from "node:fs";
import { resolve } from "node:path";
import nextEnv from "@next/env";
const liveProviders = process.argv.includes("--live-providers");
if (liveProviders) nextEnv.loadEnvConfig(process.cwd(), true, {info(){},error(){}});
mkdirSync("test-results", { recursive: true });
process.env.DATABASE_URL = `file:${resolve("test-results", `browser-${Date.now()}.db`).replaceAll("\\", "/")}`;
if (!liveProviders) {
  for (const key of ["OPENAI_API_KEY","OPEN_AI","SARVAM_API_KEY","NVIDIA_API_KEY","NVIDIA_NIM_API_KEY","GEMINI_API_KEY","GOOGLE_API_KEY","GOOGLE_GENERATIVE_AI_API_KEY","GNANI_AI","GNANI_API_KEY"])
    process.env[key] = "";
}
process.env.TURSO_DATABASE_URL = "";
process.env.TURSO_AUTH_TOKEN = "";
process.env.VERCEL = ""; // Local QA must not inherit the production-only hosted-database requirement.
process.env.PORT = process.env.QA_PORT || (liveProviders ? "3003" : "3001");
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
