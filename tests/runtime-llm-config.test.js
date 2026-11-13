import { test } from "node:test";
import assert from "node:assert/strict";
import { createRuntimeLlmConfigResolver, languageModelIds, withLlmModel, benchmarkModels } from "../lib/runtime-llm-config.js";
import { publicLlmConfig } from "../lib/llm-models.js";

const config = { enabled: true, baseUrl: "https://gateway.invalid/openai/v1/responses", apiKey: "test-only-secret",
  authHeader: "api-key", model: "configured-text-model", models: ["configured-text-model", "old-model"] };
const textModel = (id) => ({ id, capabilities: { inference: true, chat_completion: true, embeddings: false } });
const catalogResponse = (rows) => ({ ok: true, json: async () => ({ data: rows }) });

test("capability metadata discovers arbitrary text-model IDs and excludes non-text and disabled inference", () => {
  assert.deepEqual(languageModelIds([textModel("new-provider-model"), textModel("new-provider-model"),
    { id: "embedding-model", capabilities: { inference: true, embeddings: true, chat_completion: false } },
    { id: "image-model", capabilities: { inference: true, chat_completion: false } },
    { id: "not-enabled", capabilities: { inference: false, chat_completion: true } }, { id: "unknown-capability" }]), ["new-provider-model"]);
});

test("runtime discovery is shared by concurrent requests, preserves order and refreshes after expiry", async () => {
  let calls = 0, clock = 0;
  const resolve = createRuntimeLlmConfigResolver({ now: () => clock, ttlMs: 1000, fetchImpl: async (url, options) => {
    calls++;
    assert.equal(url, "https://gateway.invalid/openai/v1/models");
    if (options.headers.authorization) assert.equal(options.headers.authorization, "Bearer new-test-key");
    else assert.equal(options.headers["api-key"], config.apiKey);
    return catalogResponse([textModel("new-provider-model"), textModel(config.model)]);
  } });
  const results = await Promise.all([resolve(config), resolve(config)]);
  assert.equal(calls, 1);
  assert.deepEqual(results[0].models, [config.model, "new-provider-model"]);
  assert.equal(results[0].modelCatalog.source, "gateway");
  assert.equal(withLlmModel(results[0], "new-provider-model").model, "new-provider-model");
  await resolve(config); assert.equal(calls, 1);
  clock = 1001; await resolve(config); assert.equal(calls, 2);
  await resolve({ ...config, apiKey: "new-test-key", authHeader: "authorization-bearer" });
  assert.equal(calls, 3);
});

test("catalog failure is visible, never leaks upstream details and recovers after the short retry period", async () => {
  let clock = 0, healthy = false;
  const resolve = createRuntimeLlmConfigResolver({ now: () => clock, fetchImpl: async () => {
    if (!healthy) throw new Error(`Upstream error contains ${config.apiKey}`);
    return catalogResponse([textModel(config.model), textModel("recovered-model")]);
  } });
  const unavailable = await resolve(config);
  assert.deepEqual(unavailable.models, config.models);
  assert.equal(unavailable.modelCatalog.state, "unavailable");
  assert.ok(!JSON.stringify(publicLlmConfig(unavailable)).includes(config.apiKey));
  healthy = true; clock = 15001;
  assert.equal((await resolve(config)).modelCatalog.state, "ready");
});

test("missing and malformed capability data does not fabricate a successful discovered roster", async () => {
  for (const rows of [undefined, [], [{ id: "unqualified" }]]) {
    const resolve = createRuntimeLlmConfigResolver({ fetchImpl: async () => catalogResponse(rows) });
    assert.equal((await resolve(config)).modelCatalog.state, "unavailable");
  }
});

test("a temporary catalog outage retains recently verified choices with a visible stale state", async () => {
  let clock = 0, healthy = true;
  const resolve = createRuntimeLlmConfigResolver({ now: () => clock, ttlMs: 1000, fetchImpl: async () => {
    if (!healthy) throw new Error("Unavailable");
    return catalogResponse([textModel(config.model), textModel("new-provider-model")]);
  } });
  await resolve(config); healthy = false; clock = 1001;
  const stale = await resolve(config);
  assert.equal(stale.modelCatalog.state, "stale");
  assert.ok(stale.models.includes("new-provider-model"));
  assert.ok(stale.modelCatalog.reason);
  clock = 1800001;
  assert.equal((await resolve(config)).modelCatalog.source, "configured");
});

test("unavailable selection and unavailable default fail instead of running another model", () => {
  assert.throws(() => withLlmModel(config, "unavailable-model"), (error) => error.status === 400 && error.code === "llm-model-unavailable");
  assert.throws(() => withLlmModel({ ...config, models: ["different-model"] }), (error) => error.status === 503);
  assert.throws(() => withLlmModel(config, 123), (error) => error.status === 400);
});

test("a benchmark without explicit model choices runs one default, and invalid choices cannot expand into an all-model run", () => {
  const many = { ...config, models: [config.model, "another-model"] };
  assert.deepEqual(benchmarkModels(many), [config.model]);
  assert.deepEqual(benchmarkModels(many, ["another-model", "another-model"]), ["another-model"]);
  for (const invalid of [[], ["bad-model"], [null], [""], Array(33).fill(config.model)]) assert.throws(() => benchmarkModels(many, invalid));
});

test("public catalog metadata cannot expose credentials, gateway URLs or extra provider properties", () => {
  const result = publicLlmConfig({ ...config, modelCatalog: { source: "gateway", state: "ready", count: 2,
    checkedAt: "2026-11-12T00:00:00.000Z", defaultAvailable: true, apiKey: config.apiKey, endpoint: config.baseUrl } });
  const serialized = JSON.stringify(result);
  assert.ok(!serialized.includes(config.apiKey)); assert.ok(!serialized.includes(config.baseUrl));
  assert.equal(result.modelCatalog.count, 2);
});

test("native gateway catalogs combine text models and determine routes from catalog metadata", async () => {
  const cfg = { ...config, apiStyle: "auto", authHeader: "authorization-bearer" };
  const resolve = createRuntimeLlmConfigResolver({ fetchImpl: async (url, options) => {
    if (url.includes("/anthropic/")) {
      assert.equal(options.headers["x-api-key"], cfg.apiKey);
      assert.equal(options.headers["anthropic-version"], "2023-06-01");
      return catalogResponse([{ id: "future-native-model", type: "model" }]);
    }
    assert.equal(options.headers.authorization, `Bearer ${cfg.apiKey}`);
    return catalogResponse([
      { id: cfg.model, object: "model", owned_by: "openai" },
      { id: "future-other-model", object: "model", owned_by: "new-lab" },
      { id: "provider-embed-v3", object: "model", owned_by: "new-lab" },
      { id: "unknown-modality", object: "model", owned_by: "new-lab", capabilities: { embeddings: true } }
    ]);
  } });
  const result = await resolve(cfg);
  assert.deepEqual(result.models, [cfg.model, "future-native-model", "future-other-model"]);
  assert.equal(withLlmModel(result, "future-native-model").modelRoutes["future-native-model"].style, "anthropic");
  assert.equal(result.modelRoutes[cfg.model].style, "responses");
  assert.equal(result.modelRoutes["future-other-model"].style, "chat");
  assert.ok(!result.models.includes("old-model"));
  assert.ok(!JSON.stringify(publicLlmConfig(result)).includes("modelRoutes"));
});

test("native catalogs follow pagination and exclude explicit non-text capabilities", async () => {
  let nativeCalls = 0;
  const resolve = createRuntimeLlmConfigResolver({ fetchImpl: async (url) => {
    if (!url.includes("/anthropic/")) return catalogResponse([{ id: config.model, object: "model", owned_by: "openai" }]);
    nativeCalls++;
    if (!url.includes("after_id")) return { ok: true, json: async () => ({ data: [{ id: "first-native", type: "model" }], has_more: true, last_id: "first-native" }) };
    assert.ok(url.endsWith("?after_id=first-native"));
    return catalogResponse([{ id: "second-native", type: "model" }, { id: "not-text", type: "model", capabilities: { chat_completion: false } }]);
  } });
  const result = await resolve({ ...config, apiStyle: "auto" });
  assert.equal(nativeCalls, 2); assert.ok(result.models.includes("second-native")); assert.ok(!result.models.includes("not-text"));
});

test("one unavailable native catalog exposes only verified routes and a visible partial warning", async () => {
  const resolve = createRuntimeLlmConfigResolver({ fetchImpl: async (url) => {
    if (url.includes("/anthropic/")) throw Error("Unavailable");
    return catalogResponse([{ id: config.model, object: "model", owned_by: "openai" }]);
  } });
  const result = await resolve({ ...config, apiStyle: "auto" });
  assert.deepEqual(result.models, [config.model]); assert.equal(result.modelCatalog.state, "partial"); assert.ok(result.modelCatalog.reason);
});

test("auto routing never guesses a protocol from a configured fallback model name", async () => {
  const resolve = createRuntimeLlmConfigResolver({ fetchImpl: async () => { throw Error("Unavailable"); } });
  const result = await resolve({ ...config, apiStyle: "auto" });
  assert.equal(result.modelCatalog.source, "configured");
  assert.throws(() => withLlmModel(result), (error) => error.status === 503 && error.code === "llm-routing-unavailable");
});

test("auto discovery preserves the legacy unified catalog until operators switch gateway secrets", async () => {
  const cfg = { ...config, apiStyle: "auto", baseUrl: "https://gateway.invalid/legacy/openai/v1/responses" };
  const resolve = createRuntimeLlmConfigResolver({ fetchImpl: async (url, options) => {
    if (url.includes('/anthropic/')) return { ok: false, status: 404 };
    assert.equal(url, 'https://gateway.invalid/legacy/openai/v1/models');
    assert.equal(options.headers['api-key'], cfg.apiKey);
    return catalogResponse([textModel(cfg.model),textModel('legacy-provider-model'),
      {id:'embedding-model',capabilities:{inference:true,chat_completion:false,embeddings:true}}]);
  } });
  const result = await resolve(cfg);
  assert.equal(result.modelCatalog.state, 'ready');
  assert.deepEqual(result.models,[cfg.model,'legacy-provider-model']);
  assert.equal(result.modelRoutes['legacy-provider-model'].style,'responses');
  assert.equal(result.modelRoutes['legacy-provider-model'].root,'https://gateway.invalid/legacy/openai/v1');
});
