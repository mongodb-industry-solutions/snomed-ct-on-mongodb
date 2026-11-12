# Runtime models and terminology projection coverage

Initial review on 12 November 2026. The legacy gateway measurements below were subsequently superseded by [the new Grove migration](GROVE_GATEWAY_MIGRATION.md), which uses separate protocol catalogs and defaults to GPT-5.4 Nano. The terminology inventory remains applicable. Neither review deploys production or rebuilds MongoDB data.

## Gateway and model selection

The initial local demo called the Grove gateway's Responses API at `grove-gateway-prod.azure-api.net/grove-foundry-prod/openai/v1/responses`, hosted behind Azure API Management, and defaulted to `gpt-5.5`. The new configuration uses `ai-gateway.corp.mongodb.com` and defaults to `gpt-5.4-nano`.

At the initial check, staging and production loaded their endpoint and credentials from `snomed-secrets`. Their `/api/llm-config` URLs redirected to sign-in, and there was no configured Kubernetes context locally. The subsequent migration prepares manifests with auto routing and Nano as the default, retaining endpoint/auth/key secret mappings for a compatible code-first deployment. The deployed credentials and release remain unverified.

The updated app obtains the gateway catalog at runtime using the server's existing credentials. The local Grove catalog advertised 547 IDs, of which 376 advertised both `inference` and `chat_completion` capabilities. These include aliases and pinned versions; they are not 376 independently evaluated clinical models. The implementation selects models by advertised capabilities, with no provider-name or example-specific model mapping.

- Both the session selector and Benchmark use this full text-model catalog. GPT-5.4 and IDs absent from the configured fallback roster are selectable.
- `LLM_GROUNDING_MODELS` supplies display priority and a fallback when the gateway cannot provide capability metadata. It no longer caps a successful discovered catalog.
- Catalog results are cached for five minutes. Concurrent discovery requests share one fetch. Refresh failures retain a recently verified catalog for up to 30 minutes and show a warning, then fall back visibly to configured choices.
- The chosen session model reaches extraction, semantic verification, optional assist and language-model clinical query planning. Invalid/unavailable choices return a model-selection error. Benchmark requests without explicit choices run one default model.
- Credentials and gateway URLs do not cross the public model-config boundary.

Verification: 82 tests passed and the Next.js production build passed. Local built-server checks confirmed that GPT-5.4, GPT-4.1 and Claude Opus 4.8 each executed as requested on a short synthetic extraction note. GPT-4.1 was absent from the configured fallback roster, confirming that discovery also controls execution. Session and Benchmark metadata returned the same 376 IDs. Unavailable selections returned HTTP 400. This verifies routing, not the clinical accuracy of every advertised model; the existing full 16-note grounding review used GPT-5.5.

To release the selector changes, deploy the updated code to staging, verify that the deployed secret targets the intended Grove gateway and that its key can read the catalog and run the chosen models, then repeat the routing and clinical example checks before promotion. Production is unchanged by this local work.

## Meaning of 6.42% coverage

| Layer | Measured count |
| --- | ---: |
| Canonical concepts in `snomed-irbd` | 550,426 |
| Active canonical concepts | 399,045 |
| Description rows in `snomed-term-search` | 132,788 |
| Active searchable FSN/synonym rows | 131,347 |
| Distinct active/searchable projected concepts | 25,619 |

Active concept projection coverage is **25,619 / 399,045 = 6.42%**. It measures whether an active source concept is represented in the search projection. It does not measure extraction accuracy or completeness of the licensed canonical release. Concept counts and description-row counts are different: a concept can have several terms and languages. The 1,441 remaining projection rows are legacy definitions excluded from retrieval.

The source has far more terms than the projection. A read-only inventory found 1,022,282 active English FSN/synonym descriptions and 952,299 Spanish descriptions: **1,974,581 source descriptions** before the projection builder's metadata-tag exclusions. English descriptions cover 383,561 active concepts and Spanish descriptions cover 399,045. This inventory does not prove completeness against the official release manifest.

The small ratio follows from the rebuild's default `demo` scope. It selects several clinical branches, caps each branch at 8,000 concepts and caps their combined selection at roughly 25,000, with required demo concepts added. Later additive repairs brought the projection to 25,619 concepts. Active filtering explains the difference between 550,426 total and 399,045 active concepts; the demo scope explains the much larger source-to-projection gap.

## Broad projection rebuild

The existing full rebuild supports all active concepts in the configured release, emitting active FSNs and synonyms in English and Spanish. Nonclinical metadata tags are excluded by the projection builder. Definitions remain embedding context, and the embedded-synonym-array cap does not cap the emitted description rows. A full projection requires rebuilding the search sidecar from the existing source; it does not require reimporting SNOMED solely because the current sidecar is small.

Current collection measurements are about 271 MiB logical data, 115 MiB compressed storage and 98 MiB ordinary indexes. These figures exclude Atlas Search/Vector index storage. The full source description inventory is about 15 times the current projection row count, so the current size is insufficient evidence that the cluster can hold a full search/vector projection.

The next rebuild should proceed as follows:

1. Measure eligible full-scope rows after exclusions and allocate collection, Search, Vector and embedding capacity for the intended languages. Track coverage against eligible concepts per language as well as all active concepts.
2. Build into a separate, release-versioned collection so the working projection remains available. The existing entry point is `npm run terms:rebuild:full`; set `MONGODB_TERM_SEARCH_COLLECTION` to the new collection and keep reset/clear/replace flags false. This command writes data and is not a dry run.
3. Build the required ordinary and Search/Vector indexes on that collection using the same embedding configuration as query-time hybrid search. Verify index readiness, row/concept coverage and genuine lexical/vector execution.
4. Run the complete 16-note grounding review and all clinical-search examples against the new projection. Evaluate wrong mappings, review/abstention rates and retrieval recall separately; a larger candidate pool can change rankings.
5. Switch the application collection configuration after validation, retaining the previous collection for rollback. Do not silently fall back to a nearby clinical condition when a projection term is missing.

No projections or indexes were created or modified during this inventory. Evidence is recorded in [runtime checks](reviews/runtime-models/model-routing-checks.json) and [projection inventory](reviews/runtime-models/full-projection-inventory.json).
