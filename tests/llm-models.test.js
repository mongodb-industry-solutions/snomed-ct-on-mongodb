import { test } from "node:test";
import assert from "node:assert/strict";
import { resolveLlmModels, publicLlmConfig } from "../lib/llm-models.js";

test("a fresh deployment defaults to mini and offers comparison models", () => {
  assert.deepEqual(resolveLlmModels(), { defaultModel: "gpt-5.4-mini", availableModels: ["gpt-5.4-mini", "gpt-5.4", "gpt-5.5"] });
});
test("runtime gateway roster preserves exact provider IDs and puts the default first", () => {
  assert.deepEqual(resolveLlmModels("gpt-5.4-mini", " gpt-5.5,DeepSeek-V3.2,gpt-5.4-mini,DeepSeek-V3.2,, "), {
    defaultModel: "gpt-5.4-mini", availableModels: ["gpt-5.4-mini", "gpt-5.5", "DeepSeek-V3.2"]
  });
});
test("public model metadata cannot expose gateway credentials or URLs", () => {
  const config = { enabled: true, model: "gpt-5.4-mini", models: ["gpt-5.4-mini", "gpt-5.5"], apiKey: "private", baseUrl: "private", authHeader: "private" };
  assert.deepEqual(publicLlmConfig(config), { enabled: true, defaultModel: config.model, availableModels: config.models });
});
