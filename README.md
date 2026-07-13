# SNOMED CT on MongoDB

Interactive demo showing MongoDB as an operational data store for SNOMED CT navigation and clinical note grounding.

The demo has two product stories:

1. **Navigation**: search, scope, inspect, and browse SNOMED CT concepts.
2. **Ground Clinical Note**: extract clinical mentions from a note, retrieve bounded SNOMED candidates from MongoDB, and store reviewer-confirmed codings with evidence.

MongoDB is the code authority. LLMs are optional helpers for extracting what to look up; they do not invent or assign codes without MongoDB candidate retrieval and reviewer confirmation.

> **New to this demo? Start with the [Solution Overview](docs/SOLUTION_OVERVIEW.md)** — a business and functional view for solution architects and technical sales: the problem it solves, why the document model consolidates four data stores into one, the value drivers, and a suggested demo flow. This README covers the technical setup.

## What Is Included

- Next.js app with UI workbenches for Overview, Navigation, Ground a Note, API, and Benchmark.
- MongoDB data access, MongoDB Search queries, ECL subset evaluation, hierarchy APIs, and note-grounding APIs.
- Term sidecar build scripts, MongoDB search/vector index scripts, release-stamping, and model-hardening scripts.
- Public API contract in [public/openapi.json](public/openapi.json).
- Configuration contract in [dotenv.lock.json](dotenv.lock.json) and [.env.example](.env.example).

## Project Layout

| Path | Purpose |
|---|---|
| `app/` | Next.js App Router pages and API routes |
| `components/` | Workbench UI, concept browsing, grounding, benchmark, and API documentation panels |
| `lib/` | MongoDB access, ECL/scope logic, search, grounding, LLM, rerank, and shared helpers |
| `scripts/` | Index creation, term projection rebuilds, source-model hardening, release stamping, and local demo helpers |
| `docs/` | Configuration notes and data-model hardening/reference plans |
| `public/` | Static assets and the OpenAPI contract |

## What Is Not Included

- SNOMED CT RF2 release files.
- MongoDB database dumps or exports.
- Local `.env.local` secrets.
- Internal deployment pipelines.

SNOMED CT content is licensed. Obtain the release you are allowed to use, load it into your own MongoDB database, and then run the scripts below to harden the model, build indexes, and generate the search sidecar.

## Data Model

Default collections:

| Collection | Purpose |
|---|---|
| `terminology.snomed-irbd` | Canonical concept documents with descriptions, relationships, parents, ancestors, and release metadata |
| `terminology.snomed-term-search` | Term-level search sidecar, one document per active description/language/release |
| `terminology.grounded_notes` | Reviewer-confirmed note codings with evidence/context |
| `terminology.snomed-usage-events` | Lightweight navigation/search telemetry |

The canonical collection is optimized for concept inspection, hierarchy navigation, relationship/ECL logic, and subsumption checks. The term sidecar is optimized for MongoDB Search, vector/hybrid retrieval, semantic filters, and result-card fields.

## Requirements

- Node.js 20 or later
- npm
- MongoDB deployment with MongoDB Search enabled
- A canonical SNOMED CT collection already loaded into MongoDB
- Optional: MongoDB Vector Search automated embedding index
- Optional: Voyage API key for reranking/manual embedding fallback
- Optional: OpenAI-compatible LLM gateway for note extraction assistance

## Install And Run Locally

```bash
cp .env.example .env.local
npm install
npm run dev
```

Open `http://localhost:3015`.

At minimum, set `MONGODB_URI` in `.env.local`. The default database/collection names are in [.env.example](.env.example). Keep secrets in `.env.local`; do not commit them.

For a production-style local build:

```bash
npm run build
npm run start
```

The app listens on port `3015` by default. Override it with `PORT`, for example:

```bash
PORT=8080 npm run dev
```

## Recreate The MongoDB Side

After your canonical SNOMED CT collection exists:

```bash
npm run indexes:build
NORMALIZE_APPLY=true npm run model:harden
RELEASE_ID_TARGET=20260601 RELEASE_ID_OVERWRITE=true npm run releaseid:stamp
SNOMED_RELEASE_ID=20260601 TERM_PROJECTION_SCOPE=demo TERM_PROJECTION_REPLACE_RELEASE=true npm run terms:rebuild
npm run indexes:build
```

`TERM_PROJECTION_SCOPE=demo` builds a curated subset for small clusters. Use `smoke` for connectivity checks, `area` for one or more hierarchy branches, `explicit` for specific concept IDs, or `full` only when the cluster can handle the whole release.

Examples:

```bash
TERM_PROJECTION_SCOPE=smoke npm run terms:rebuild
TERM_PROJECTION_SCOPE=explicit PROJECTION_CONCEPT_IDS=44054006,84114007 npm run terms:rebuild
TERM_PROJECTION_SCOPE=area PROJECTION_AREA_CONCEPT_ID=404684003 PROJECTION_MAX_CONCEPT_IDS=5000 npm run terms:rebuild
TERM_PROJECTION_SCOPE=full npm run terms:rebuild
```

## Main Scripts

| Script | Use |
|---|---|
| `npm run dev` | Run the local Next.js app |
| `npm run build` | Production build validation |
| `npm run indexes:build` | Create/update MongoDB Search, Vector Search, and btree indexes |
| `npm run model:harden` | Dry-run canonical model normalization |
| `NORMALIZE_APPLY=true npm run model:harden` | Apply SCTID/string normalization and remove stored descendant closures |
| `npm run releaseid:stamp` | Stamp `releaseId`, `releaseDate`, and release metadata |
| `npm run terms:rebuild` | Rebuild the term-level search sidecar |
| `npm run collections:retire` | Dry-run cleanup of retired demo collections |

## Search And Navigation

Navigation supports:

- MongoDB Search over SNOMED terms, synonyms, FSNs, and normalized autocomplete fields.
- Semantic filters by language, semantic tag, hierarchy scope, and ECL subset.
- Hybrid retrieval with native MongoDB fusion where available, with application-side fallback.
- Concept detail inspection, hierarchy graph, parents/children, relationships, and release metadata.
- Explainable generated MQL for advanced/demo mode.
- ECL and area scopes are cached in the app process after first expansion; first-run attribute-refined scopes can be slower because the candidate set is being built.

Supported ECL subset:

- concept IDs
- descendants (`<`) and descendants-or-self (`<<`)
- `AND`, `OR`, and `MINUS`
- attribute refinements such as `<< 404684003 : 363698007 = << 80891009`

## Ground Clinical Note

The grounding flow separates clinical extraction from terminology authority:

1. Extract candidate clinical mentions, assertion, temporality, and subject context.
2. Search MongoDB for bounded SNOMED candidates.
3. Let an optional LLM assist with review/primary-diagnosis reasoning.
4. Store only reviewer-confirmed codings.
5. Query grounded notes by concept or ancestor path.

The default sidecar scope is partial. If a realistic note contains concepts outside the curated sidecar, retrieval can miss or over-specialize results. For production-like evaluation, rebuild a broader `area` or `full` sidecar.

## API Surface

Core endpoints:

- `POST /api/navigator-search`
- `POST /api/navigator-suggest`
- `POST /api/ecl`
- `POST /api/hierarchy`
- `GET /api/concept-history`
- `POST /api/nlp-map`
- `POST /api/llm-ground`
- `POST /api/coding-confirm`
- `POST /api/grounded-corpus`

Operations:

- `GET /api/readiness`
- `GET /api/release-diff`
- `POST /api/benchmark`
- `GET /api/health`
- `GET /api/ping`
- `POST /api/explorer-feedback`

Legacy FHIR cohort, mapping-set, refset-authoring, and binding APIs are intentionally not part of the current demo.

## Configuration

Use [.env.example](.env.example) as the editable template and [dotenv.lock.json](dotenv.lock.json) as the public contract for supported environment variables. Additional guidance is in [docs/CONFIGURATION.md](docs/CONFIGURATION.md).

Automated embedding indexes require MongoDB-side model/provider configuration. Local `VOYAGE_API_KEY` is only needed for reranking or manual embedding fallback.

## LLM Models

Stage-1 extraction and the optional LLM assist call an OpenAI-compatible gateway (e.g. Grove / Azure Foundry). One endpoint, one key, many models; MongoDB stays the code authority and the LLM only extracts what to look up. Without a gateway the app uses deterministic extraction.

```bash
ENABLE_LLM_GROUNDING=true
LLM_BASE_URL=https://<gateway>/openai/v1
LLM_API_KEY=<gateway key>
LLM_AUTH_HEADER=api-key            # "authorization-bearer" for stock OpenAI
LLM_API_STYLE=responses            # universal on Grove/Azure (serves every provider); "chat" = OpenAI-only /chat/completions
LLM_GROUNDING_MODEL=gpt-5.5        # session default
LLM_GROUNDING_MODELS=gpt-5.5,claude-opus-4-8,DeepSeek-V3.2,...        # roster for the picker + benchmark
NEXT_PUBLIC_LLM_GROUNDING_MODELS=gpt-5.5,claude-opus-4-8,DeepSeek-V3.2,...  # same list, mirrored to the browser (restart dev)
```

`LLM_API_STYLE=responses` is the surface that reaches every provider on Grove/Azure Foundry (OpenAI, Anthropic, Mistral, DeepSeek, xAI, Kimi, …); `/chat/completions` is OpenAI-only there. Model ids are provider-specific — copy each exactly from the gateway's Model Catalog. Use the **Benchmark** tab to compare models on quality (recall + exclusion), tokens, and latency, then set the winner as the session model.

## Production Boundaries

This is a reference blueprint, not a turnkey product. Before any production or PHI-bearing deployment, address:

- **Authentication & authorization** — the demo APIs are unauthenticated. Put them behind your identity provider and enforce per-route authorization; never expose them publicly as-is.
- **SNOMED CT licensing & attribution** — SNOMED and SNOMED CT are registered trademarks of SNOMED International (IHTSDO). Obtain the license for your country/use case; do not redistribute release content. See the Licensing tab.
- **Multi-tenant separation** — `grounded_notes` carries a `tenantId`, but there is no enforced isolation. Add tenant-scoped access control (and ideally per-tenant databases or field-level rules) before sharing a cluster.
- **PHI handling** — clinical note text is sent to the configured LLM gateway and stored in `grounded_notes`. Confirm your gateway's data-handling/BAA terms, encrypt at rest and in transit, and apply retention/redaction policies.
- **Reviewer accountability & audit logging** — confirmed codings should record who approved them and when. `snomed-usage-events` is lightweight telemetry, not an audit trail; add immutable, attributable audit logging for coding decisions.
- **Index sizing & cost** — MongoDB Search / Vector Search indexes and the ancestor multikey index grow with a full SNOMED release. Size the deployment (and embedding/rerank spend) for your scope; the demo runs a curated subset.
- **Cache behavior** — grounding results are cached in-process by request fingerprint (incl. model) and scope expansions are cached with a TTL. Both are per-instance and non-persistent; plan a shared cache and invalidation strategy for multi-instance deployments.

## Public Repository Hygiene

The repository intentionally ignores:

- `.env.local` and all local secret files
- `node_modules`, `.next`, build output, and logs
- RF2 temp folders and SNOMED release archives
- MongoDB dumps and data exports
- local deployment/debug artifacts

If you add sample data, keep it synthetic, minimal, and license-safe.
