import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { buildNativeHybridFusionPipeline, buildNavigatorSearchPipeline } from '../lib/pipelines.js';

// Replace only the external reranker at the module boundary; execute the real
// hybrid orchestration against an aggregate spy, without network or secrets.
const source = (await readFile(new URL('../lib/hybrid-search.js', import.meta.url), 'utf8'))
  .replace('import { rerankDocuments } from "@/lib/voyage-rerank";', 'const rerankDocuments = (...args) => globalThis.nativeRetrievalRerankSpy(...args);')
  .replaceAll(/"@\/lib\/([^"\n]+)"/g, (_, name) => JSON.stringify(new URL(`../lib/${name}.js`, import.meta.url).href));
const { runHybridSearch } = await import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`);
const config = { fusionMode: 'rankFusion', candidatePool: 20, rerankPool: 20, lexicalWeight: .55,
  semanticWeight: .45, rrfK: 60, nativeFusionMaxTimeMs: 8000, rerankEnabled: true, rerankMode: 'voyage' };
const args = { query: 'a clinical condition', vectorQuery: 'a clinical condition\nAssessment: a clinical condition.',
  languageCode: 'en', effectiveReleaseId: 'test-release', textIndex: 'text', limit: 4,
  searchConfig: { vectorIndex: 'vector', vectorPath: 'embedText', vectorMode: 'autoEmbed' } };
const pipelineArgs = { query: args.query, vectorQuery: args.vectorQuery, languageCode: 'en', releaseId: 'test-release',
  textIndex: 'text', vectorIndex: 'vector', vectorPath: 'embedText', vectorMode: 'autoEmbed', limit: 4, candidatePool: 20, includeExactMatches: true };
const candidate = { conceptId: 'test-concept', term: 'a clinical condition', exactDescriptionMatch: true, fusionScore: .01 };

test('native grounding returns candidates from one aggregation, then one external rerank call', async () => {
  const calls = []; let rerankCalls = 0;
  globalThis.nativeRetrievalRerankSpy = async () => { rerankCalls++; return [{ index: 0, relevanceScore: .9 }]; };
  const collection = { aggregate: (pipeline) => { calls.push(pipeline); return { toArray: async () => [candidate] }; } };
  const result = await runHybridSearch({ ...args, collection, hybridConfig: config });
  assert.equal(calls.length, 1); assert.equal(rerankCalls, 1);
  assert.equal(result.results[0].conceptId, candidate.conceptId);
  assert.equal(result.stats.rerankMode, 'voyage');
  const exact = calls[0][0].$rankFusion.input.pipelines.exactDescriptions;
  assert.equal(exact[0].$match.normalizedTerm, args.query);
  assert.equal(exact[0].$match.conceptActive, true);
  assert.equal(exact[0].$match.active, true);
  assert.equal(exact[0].$match.releaseId, 'test-release');
  assert.equal(exact[0].$match.languageCode, 'en');
  assert.equal(exact[0].$match.conceptId, undefined);
  assert.ok(!exact.some(stage => stage.$project || stage.$group));
});

test('native reranking occurs after concept grouping and preserves fusion provenance, without an external call', async () => {
  let pipeline; let rerankCalls = 0;
  globalThis.nativeRetrievalRerankSpy = async () => { rerankCalls++; };
  const collection = { aggregate: p => { pipeline = p; return { toArray: async () => [{ ...candidate, rerankScore: .8 }] }; } };
  const result = await runHybridSearch({ ...args, collection, hybridConfig: { ...config, rerankMode: 'native' } });
  assert.equal(rerankCalls, 0); assert.equal(result.stats.rerankMode, 'native');
  const rerankIndex = pipeline.findIndex(s => s.$rerank);
  assert.ok(rerankIndex > pipeline.findIndex(s => s.$group));
  assert.ok(rerankIndex > pipeline.findIndex(s => s.$addFields?.fusionScore));
  assert.equal(pipeline[rerankIndex].$rerank.query.text, args.vectorQuery);
  assert.equal(pipeline[rerankIndex].$rerank.numDocsToRerank, 20);
  assert.equal(pipeline.at(-1).$project.scoreDetails, 1);
  assert.equal(pipeline.at(-1).$project.rerankScore, 1);
});

test('an unsupported native rerank fails visibly and does not launch application fallback queries', async () => {
  let calls = 0;
  const collection = { aggregate: () => { calls++; return { toArray: async () => { throw new Error("Unrecognized pipeline stage name: '$rerank'"); } }; } };
  await assert.rejects(runHybridSearch({ ...args, collection, hybridConfig: { ...config, rerankMode: 'native' } }), { code: 'NATIVE_FUSION_UNAVAILABLE', status: 503 });
  assert.equal(calls, 1);
  // A rejected $rerank must not disable supported rankFusion + external Voyage.
  const supported = { aggregate: () => ({ toArray: async () => [candidate] }) };
  globalThis.nativeRetrievalRerankSpy = async () => null;
  const result = await runHybridSearch({ ...args, collection: supported, hybridConfig: config });
  assert.equal(result.stats.nativeFusion, true);
});

test('exact descriptions obey a caller-supplied hierarchy scope without inventing a target code', () => {
  const p = buildNativeHybridFusionPipeline({ ...pipelineArgs, conceptIdScope: ['scope-a', 'scope-b'] });
  assert.deepEqual(p[0].$rankFusion.input.pipelines.exactDescriptions[0].$match.conceptId, { $in: ['scope-a', 'scope-b'] });
});

test('lexical search bounds search-engine results before materializing highlights', () => {
  const p = buildNavigatorSearchPipeline({ query: args.query, indexName: 'text', limit: 20, languageCode: 'en', releaseId: 'test-release' });
  assert.deepEqual(p[0].$search.sort, { score: { $meta: 'searchScore' }, conceptId: 1 });
  assert.equal(p[1].$limit, 20);
  assert.ok(p[2].$project.highlights);
  assert.ok(!p.some(s => s.$sort));
});
