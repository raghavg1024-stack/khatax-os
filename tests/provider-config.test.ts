import { test } from "node:test";
import assert from "node:assert/strict";
import { openAIKey, gnaniKey } from "../src/lib/provider-config";

test("Production aliases resolve and canonical names take precedence", () => {
  const keys = [
    "OPENAI_API_KEY",
    "OPEN_AI",
    "GNANI_API_KEY",
    "GNANI_AI",
  ] as const;
  const before = Object.fromEntries(keys.map((key) => [key, process.env[key]]));
  try {
    keys.forEach((key) => delete process.env[key]);
    assert.equal(openAIKey(), undefined);
    assert.equal(gnaniKey(), undefined);
    process.env.OPEN_AI = "openai-alias-placeholder";
    process.env.GNANI_AI = "gnani-alias-placeholder";
    assert.equal(openAIKey(), "openai-alias-placeholder");
    assert.equal(gnaniKey(), "gnani-alias-placeholder");
    process.env.OPENAI_API_KEY = "openai-canonical-placeholder";
    process.env.GNANI_API_KEY = "gnani-canonical-placeholder";
    assert.equal(openAIKey(), "openai-canonical-placeholder");
    assert.equal(gnaniKey(), "gnani-canonical-placeholder");
  } finally {
    for (const key of keys) {
      if (before[key] === undefined) delete process.env[key];
      else process.env[key] = before[key];
    }
  }
});
