import { test } from "node:test";
import assert from "node:assert/strict";
import {
  openAIKey,
  gnaniKey,
  geminiKey,
  nvidiaKey,
  llmProvider,
  assertProviderKey,
} from "../src/lib/provider-config";

test("Production aliases resolve and canonical names take precedence", () => {
  const keys = [
    "OPENAI_API_KEY",
    "OPEN_AI",
    "NVIDIA_API_KEY",
    "NVIDIA_NIM_API_KEY",
    "GEMINI_API_KEY",
    "GOOGLE_API_KEY",
    "GOOGLE_GENERATIVE_AI_API_KEY",
    "GNANI_API_KEY",
    "GNANI_AI",
  ] as const;
  const before = Object.fromEntries(keys.map((key) => [key, process.env[key]]));
  try {
    keys.forEach((key) => delete process.env[key]);
    assert.equal(openAIKey(), undefined);
    assert.equal(gnaniKey(), undefined);
    assert.equal(llmProvider(), "Local parser · demo");
    process.env.OPEN_AI = "openai-alias-placeholder";
    process.env.GNANI_AI = "gnani-alias-placeholder";
    assert.equal(openAIKey(), "openai-alias-placeholder");
    assert.equal(gnaniKey(), "gnani-alias-placeholder");
    assert.equal(llmProvider(), "OpenAI");
    process.env.OPENAI_API_KEY = "openai-canonical-placeholder";
    process.env.GNANI_API_KEY = "gnani-canonical-placeholder";
    assert.equal(openAIKey(), "openai-canonical-placeholder");
    assert.equal(gnaniKey(), "gnani-canonical-placeholder");
    process.env.GOOGLE_API_KEY = "google-alias-placeholder";
    assert.equal(geminiKey(), "google-alias-placeholder");
    process.env.GEMINI_API_KEY = "gemini-canonical-placeholder";
    assert.equal(geminiKey(), "gemini-canonical-placeholder");
    assert.equal(llmProvider(), "Gemini");
    process.env.NVIDIA_NIM_API_KEY = "nvidia-alias-placeholder";
    assert.equal(nvidiaKey(), "nvidia-alias-placeholder");
    process.env.NVIDIA_API_KEY = "nvidia-canonical-placeholder";
    assert.equal(nvidiaKey(), "nvidia-canonical-placeholder");
    assert.equal(llmProvider(), "NVIDIA Nemotron + Gemini");
  } finally {
    for (const key of keys) {
      if (before[key] === undefined) delete process.env[key];
      else process.env[key] = before[key];
    }
  }
});

test("malformed credential is rejected without including it in the API response", async () => {
  const keys = [
    "OPENAI_API_KEY",
    "OPEN_AI",
    "NVIDIA_API_KEY",
    "NVIDIA_NIM_API_KEY",
    "GEMINI_API_KEY",
    "GOOGLE_API_KEY",
    "GOOGLE_GENERATIVE_AI_API_KEY",
    "TURSO_DATABASE_URL",
    "TURSO_AUTH_TOKEN",
  ] as const;
  const before = Object.fromEntries(keys.map((key) => [key, process.env[key]]));
  const malformed = "credential-placeholder\nextra-label-and-value";
  try {
    delete process.env.OPENAI_API_KEY;
    delete process.env.NVIDIA_API_KEY;
    delete process.env.NVIDIA_NIM_API_KEY;
    delete process.env.GEMINI_API_KEY;
    delete process.env.GOOGLE_API_KEY;
    delete process.env.GOOGLE_GENERATIVE_AI_API_KEY;
    process.env.OPEN_AI = malformed;
    process.env.TURSO_DATABASE_URL = "";
    process.env.TURSO_AUTH_TOKEN = "";
    assert.throws(
      () => assertProviderKey(malformed, "OpenAI"),
      (error) =>
        error instanceof Error &&
        !error.message.includes(malformed) &&
        !error.message.includes("credential-placeholder"),
    );
    const { POST } = await import("../src/app/api/actions/route");
    const response = await POST(
      new Request("http://localhost:3000/api/actions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ op: "preview", text: "Ravi 350 credit" }),
      }),
    );
    assert.ok(response);
    const body = await response.json();
    assert.equal(response.status, 400);
    assert.equal(body.code, "provider_configuration");
    assert.equal(
      JSON.stringify(body).includes("credential-placeholder"),
      false,
    );
    assert.match(body.error, /only one API key/);
  } finally {
    for (const key of keys) {
      if (before[key] === undefined) delete process.env[key];
      else process.env[key] = before[key];
    }
  }
});
