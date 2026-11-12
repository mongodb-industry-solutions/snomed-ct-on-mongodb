# Kanopy handoff for the Grove release

Scope: standalone SNOMED demo, namespace `industrysolutions`; staging release `snomed-mongodb`, production release `snomed-mongodb-prod`. Drone deploys staging on a push to `staging` and production on a push to `main`.

## Operator request after the compatible code is deployed

Please update these **three values together** in each environment's `snomed-secrets` group:

| Secret-group key | New value |
| --- | --- |
| `LLM_BASE_URL` | `https://ai-gateway.corp.mongodb.com` |
| `LLM_AUTH_HEADER` | `authorization-bearer` |
| `LLM_API_KEY` | New Grove key supplied through the approved secret channel |

The key must be permitted to list the OpenAI-compatible and Anthropic catalogs and invoke the intended text models. Do not place the key in a Git commit or PR comment.

The release retains these secret mappings and supports both the legacy unified capability catalog and the new split catalogs. Compatible code can therefore deploy with existing secrets first; operators can switch the three values afterward. Do not mix an Azure endpoint with the new Grove key, or the new endpoint with an old Azure key. Rotate all three values in one operation, then restart/roll out the application pods so they read the updated environment. Existing pods retain their environment until restart.

Validate staging's code and gateway transition first. After the staging-to-main promotion and successful production deployment, perform the same transition in production. Keep the preceding image/configuration available for rollback, subject to the old key's expiry.

Keep each environment's existing **`MONGODB_URI`, `MONGODB_DB` and `VOYAGE_API_KEY`** in `snomed-secrets`. Voyage still powers the reranker/manual embedding client; the Grove generation key does not replace it. No database migration is required by this code release.

## Public settings already supplied by the release manifests

| Variable | Value |
| --- | --- |
| `ENABLE_LLM_GROUNDING` | `true` |
| `LLM_API_STYLE` | `auto` |
| `LLM_GROUNDING_MODEL` | `gpt-5.4-nano` |
| `LLM_LOG_IO` | `false` |
| `NODE_ENV` | `production` |
| `SNOMED_RELEASE_ID` | `20260601` |

Do not set `NEXT_PUBLIC_LLM_GROUNDING_MODELS`; it is retired. `LLM_GROUNDING_MODELS` is optional display priority/fallback and is omitted from the release manifests. Both selectors discover the gateway catalog. `STAGING_*` and `PROT_*` local reference names are not application variables; deployment uses the unprefixed names above.

## Verification

Confirm the actual deployed image/build SHA and Drone deployment result. Through authenticated access, check `/api/health`, `/api/readiness` and `/api/llm-config`. A fresh session should default to Nano. After switching to the new gateway, the locally observed catalog contains 40 text IDs; gateway availability can change. Before that switch, the legacy catalog can contain more IDs.

Run `npm run demo:verify` in the deployed container using its actual secrets. Run `CLINICAL_QA_URL=http://127.0.0.1:8080 npm run notes:verify` for all 44 authored bilingual searches. Check a small GPT/Claude Benchmark comparison and source evidence/review behavior in grounding.

Nano's full 16-note local review had seven degraded runs due to rejected evidence or malformed output. It remains the requested demo default; uncertain results require review and are not clinically qualified automatic coding. No projection or index rebuild is included in this rollout.
