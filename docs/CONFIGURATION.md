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

## Optional Capabilities

LLM-assisted note grounding:

```bash
ENABLE_LLM_GROUNDING=true
LLM_BASE_URL=<openai-compatible-responses-api-base>
LLM_API_KEY=<key>
LLM_AUTH_HEADER=api-key
LLM_API_STYLE=chat
LLM_GROUNDING_MODEL=<model-id>
```

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

The public contract intentionally excludes older cohort, refset-authoring, binding, mapping, ancestor-index, and deployment variables. The current demo uses four collections:

- `snomed-irbd`
- `snomed-term-search`
- `grounded_notes`
- `snomed-usage-events`

Keep new variables out of `.env.example` unless a live app route or supported script reads them.
