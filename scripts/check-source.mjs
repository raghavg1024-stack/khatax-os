import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import nextEnv from "@next/env";

nextEnv.loadEnvConfig(process.cwd());
const listed = spawnSync("git", ["ls-files", "-z"], {
  encoding: "utf8",
  windowsHide: true,
});
if (listed.status) {
  console.error("Could not inspect tracked source.");
  process.exit(1);
}
const files = listed.stdout.split("\0").filter(Boolean);
const secrets = [
  "OPENAI_API_KEY",
  "GEMINI_API_KEY",
  "GOOGLE_API_KEY",
  "GOOGLE_GENERATIVE_AI_API_KEY",
  "GNANI_API_KEY",
  "TURSO_AUTH_TOKEN",
  "VERCEL_OIDC_TOKEN",
]
  .map((key) => process.env[key])
  .filter((value) => value?.length >= 16);
const failures = [];
for (const file of files) {
  if (
    (/(^|\/)\.env(?:\.|$)/.test(file) && file !== ".env.example") ||
    /(^|\/)(?:\.vercel|node_modules|test-results)\//.test(file) ||
    /\.db(?:-shm|-wal|-journal)?$/.test(file)
  ) {
    failures.push({
      file,
      reason: "Private environment/runtime file is tracked",
    });
    continue;
  }
  const data = readFileSync(file);
  if (secrets.some((secret) => data.includes(Buffer.from(secret))))
    failures.push({
      file,
      reason: "Configured secret found in tracked source",
    });
  if (
    /\.(?:[cm]?[jt]sx?|json|md|ya?ml|env\.example)$/.test(file) &&
    /\bsk-(?:proj-)?[A-Za-z0-9_-]{24,}/.test(data.toString("utf8"))
  )
    failures.push({ file, reason: "Potential API credential found" });
}
if (failures.length) {
  console.error(JSON.stringify({ passed: false, failures }, null, 2));
  process.exit(1);
}
console.log(
  JSON.stringify({
    passed: true,
    trackedFiles: files.length,
    secretsExcluded: true,
  }),
);
