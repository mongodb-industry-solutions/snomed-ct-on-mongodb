import { test } from "node:test";
import assert from "node:assert/strict";
import { gatewayCatalogs, resolveGateway, gatewayHeaders, callLlmGateway, normalizeGatewayUsage, extractLlmText } from "../lib/llm.js";

const config = { apiStyle: "auto", baseUrl: "https://gateway.invalid/openai/v1/responses", authHeader: "authorization-bearer",
  apiKey: "test-only-secret", model: "arbitrary-model", maxTokens: 256 };

test("auto catalogs derive both protocol roots without duplicating an existing API path", () => {
  assert.deepEqual(gatewayCatalogs(config), [
    { family: "openai", root: "https://gateway.invalid/openai/v1", style: "responses" },
    { family: "anthropic", root: "https://gateway.invalid/anthropic/v1", style: "anthropic" }
  ]);
  assert.deepEqual(gatewayCatalogs({ ...config, baseUrl: "https://gateway.invalid/" }), gatewayCatalogs(config));
});

test("catalog route selects the protocol without inferring it from a model name", async () => {
  for (const [style, suffix, data] of [
    ["responses", "responses", { output: [{ content: [{ type: "output_text", text: '{"ok":true}' }] }], usage: { input_tokens: 4, output_tokens: 3 } }],
    ["chat", "chat/completions", { choices: [{ message: { content: '{"ok":true}' } }], usage: { prompt_tokens: 4, completion_tokens: 3 } }],
    ["anthropic", "messages", { content: [{ type: "thinking", thinking: "private" }, { type: "text", text: '{"ok":true}' }], usage: { input_tokens: 4, output_tokens: 3 } }]
  ]) {
    const cfg = { ...config, modelRoutes: { [config.model]: { root: `https://gateway.invalid/${style}/v1`, style } } };
    const result = await callLlmGateway(cfg, "Return JSON", { fetchImpl: async (url, options) => {
      assert.equal(url, `https://gateway.invalid/${style}/v1/${suffix}`);
      assert.equal(options.method, "POST");
      const body = JSON.parse(options.body);
      assert.equal(body.model, config.model);
      if (style === "responses") { assert.equal(body.input, "Return JSON"); assert.equal(body.max_output_tokens, 256); }
      else { assert.deepEqual(body.messages, [{ role: "user", content: "Return JSON" }]); assert.equal(body.max_tokens, 256); }
      if (style === "anthropic") {
        assert.equal(options.headers["x-api-key"], config.apiKey);
        assert.equal(options.headers["anthropic-version"], "2023-06-01");
        assert.equal(options.headers.authorization, undefined);
      } else { assert.equal(options.headers.authorization, `Bearer ${config.apiKey}`); assert.equal(options.headers["api-key"], undefined); }
      return { ok: true, status: 200, text: async () => JSON.stringify(data) };
    } });
    assert.equal(result.text, '{"ok":true}');
    assert.equal(result.usage.input_tokens, 4); assert.equal(result.usage.total_tokens, 7);
  }
});

test("explicit legacy Responses/chat and direct Anthropic endpoints retain their configured paths and authentication", () => {
  assert.equal(resolveGateway({ ...config, apiStyle: "responses", baseUrl: "https://gateway.invalid/azure/openai/v1/responses" }).endpoint, "https://gateway.invalid/azure/openai/v1/responses");
  assert.equal(resolveGateway({ ...config, apiStyle: "chat", baseUrl: "https://gateway.invalid/v1/chat/completions" }).endpoint, "https://gateway.invalid/v1/chat/completions");
  assert.equal(resolveGateway({ ...config, apiStyle: "anthropic", baseUrl: "https://gateway.invalid/anthropic/v1/messages" }).endpoint, "https://gateway.invalid/anthropic/v1/messages");
  assert.equal(gatewayHeaders({ ...config, authHeader: "api-key" }, "responses")["api-key"], config.apiKey);
  assert.throws(() => resolveGateway(config), (error) => error.code === "llm-routing-unavailable");
});

test("Anthropic usage counts cache input once and response parsing excludes thinking blocks", () => {
  assert.deepEqual(normalizeGatewayUsage({ input_tokens: 4, output_tokens: 3, cache_read_input_tokens: 10, cache_creation_input_tokens: 2 }),
    { input_tokens: 16, output_tokens: 3, cache_read_input_tokens: 10, cache_creation_input_tokens: 2, total_tokens: 19 });
  assert.equal(normalizeGatewayUsage({ input_tokens: 10, output_tokens: 3, input_tokens_details: { cached_tokens: 8 } }).input_tokens, 10);
  assert.equal(extractLlmText({ content: [{ type: "thinking", thinking: "private" }, { type: "text", text: "a" }, { type: "text", text: "b" }] }), "ab");
});

test("an upstream authentication error returns its status without trying another protocol or model", async () => {
  let calls = 0;
  const result = await callLlmGateway({ ...config, apiStyle: "responses" }, "Return JSON", { fetchImpl: async () => {
    calls++; return { ok: false, status: 401, text: async () => "Unauthorized" };
  } });
  assert.equal(calls, 1); assert.equal(result.status, 401); assert.equal(result.ok, false);
});
