# Runtime Configuration

`.env.local` is reserved for local credentials and environment-specific overrides. Do not commit it.

The supported variable contract is:

- [../dotenv.lock.json](../dotenv.lock.json): machine-readable list of supported variables.
- [../.env.example](../.env.example): editable template that mirrors the lock file.

If a variable is not in the lock file, treat it as unsupported or retired.

## Required Local Value

Only one value is required to start the app against an existing database:

```bash
MONGODB_URI=mongodb+srv://<user>:<password>@<cluster>.mongodb.net/terminology?retryWrites=true&w=majority
```

The default database and collections are:

- `MONGODB_DB=terminology`
- `MONGODB_COLLECTION=snomed-irbd`
- `MONGODB_TERM_SEARCH_COLLECTION=snomed-term-search`
- `MONGODB_USAGE_EVENT_COLLECTION=snomed-usage-events`
- `MONGODB_MODEL_STATE_COLLECTION=snomed-model-state`

`snomed-model-state` holds the record of how far the canonical collection has been migrated. It is written by `npm run model:stamp-state`, which must run after the last migration step; every script that changes a described field deletes the record so a stale one is never served. Until a record exists, `/api/readiness` reports the model checks as `unknown` rather than inferring them from a sample.

## Optional Capabilities

`STAGING_MONGODB_URI`, `STAGING_VOYAGE_API_KEY`, `PROT_MONGODB_URI` and `PROT_VOYAGE_API_KEY` are not read by the app or this repository's deployment pipeline. If retained as deployment reference values, manage them separately from local runtime configuration. Kanopy injects `MONGODB_URI`, `MONGODB_DB`, `VOYAGE_API_KEY`, `LLM_BASE_URL`, `LLM_AUTH_HEADER` and `LLM_API_KEY` from each environment's `snomed-secrets` group.

LLM-assisted note grounding:

```bash
ENABLE_LLM_GROUNDING=true
LLM_BASE_URL=https://ai-gateway.corp.mongodb.com
LLM_API_KEY=<key>
LLM_AUTH_HEADER=authorization-bearer
LLM_API_STYLE=auto
LLM_GROUNDING_MODEL=gpt-5.4-nano
LLM_GROUNDING_MODELS=gpt-5.4-nano,gpt-5.4-mini,gpt-5.4,gpt-5.5
```

Auto routing reads `/openai/v1/models` and `/anthropic/v1/models` and chooses each request protocol from catalog/provider metadata. The OpenAI-compatible endpoints use Bearer authorization. Anthropic uses the same key in `x-api-key`, with `anthropic-version: 2023-06-01`. Model selection, response text and token usage share one adapter across extraction, semantic review, assist and query planning. A bare gateway URL is sufficient; endpoint-specific URLs are normalized to avoid duplicating API paths.

The browser reads the discovered catalog from `/api/llm-config` and benchmark metadata. `LLM_GROUNDING_MODELS` controls display priority and fallback, while a successful catalog controls availability. Auto mode will not guess a route if discovery fails. `NEXT_PUBLIC_LLM_GROUNDING_MODELS` is retired. Explicit `responses`, `chat` and `anthropic` API styles remain available for a single-protocol gateway; legacy APIM can continue using `LLM_AUTH_HEADER=api-key`. See [Grove migration](GROVE_GATEWAY_MIGRATION.md) for deployment-secret updates.

`LLM_LOG_IO` is a supported debugging option, disabled when omitted. Set `LLM_LOG_IO=false` for normal operation. Enabling it logs extraction prompts, including clinical note text, and model responses to the server console.

Voyage rerank/manual embedding fallback:

```bash
VOYAGE_API_KEY=<key>
VOYAGE_RERANK_MODEL=rerank-2.5
```

Automated embeddings are configured in MongoDB. The app-side defaults are:

- `MONGODB_VECTOR_MODE=autoEmbed`
- `MONGODB_VECTOR_PATH=embedText`
- `MONGODB_VECTOR_AUTO_EMBED_MODEL=voyage-4`

## Sidecar Scope

The term sidecar rebuild is scoped by default so small clusters are safe:

```bash
TERM_PROJECTION_SCOPE=demo
PROJECTION_MAX_CONCEPT_IDS=8000
PROJECTION_MAX_TOTAL_CONCEPT_IDS=25000
```

Useful overrides:

```bash
TERM_PROJECTION_SCOPE=smoke npm run terms:rebuild
TERM_PROJECTION_SCOPE=area PROJECTION_AREA_CONCEPT_ID=404684003 npm run terms:rebuild
TERM_PROJECTION_SCOPE=explicit PROJECTION_CONCEPT_IDS=44054006,84114007 npm run terms:rebuild
TERM_PROJECTION_SCOPE=full npm run terms:rebuild
```

Use `full` only when the MongoDB deployment has enough storage, index capacity, and time budget.

## Maintenance

Common setup sequence after loading canonical SNOMED CT documents:

```bash
npm run indexes:build
NORMALIZE_APPLY=true npm run model:harden
RELEASE_ID_TARGET=20260601 RELEASE_ID_OVERWRITE=true npm run releaseid:stamp
SNOMED_RELEASE_ID=20260601 TERM_PROJECTION_SCOPE=demo TERM_PROJECTION_REPLACE_RELEASE=true npm run terms:rebuild
npm run indexes:build
```

`npm run model:harden` is dry-run by default. It reports numeric SCTIDs, stored `inferredDescendantIds`, and missing `relationshipAttributeKeys`. Set `NORMALIZE_APPLY=true` only after reviewing the counters and running against a backup or safe staging copy.

`npm run collections:retire` is also dry-run by default. It reports retired collections from older demo scopes, then drops them only with:

```bash
npm run collections:retire -- --apply
```

## Retired Variables

The public contract intentionally excludes older cohort, refset-authoring, binding, mapping, ancestor-index, and deployment variables. The current demo uses five collections:

- `snomed-irbd`
- `snomed-term-search`
- `grounded_notes`
- `snomed-usage-events`
- `snomed-model-state`

Keep new variables out of `.env.example` unless a live app route or supported script reads them.
