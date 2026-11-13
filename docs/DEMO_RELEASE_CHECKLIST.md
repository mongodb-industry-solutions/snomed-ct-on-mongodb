# Standalone demo release — 12 November 2026

This release covers `snomed-ct-on-mongodb`. The current release PR targets `staging`; a push to `staging` deploys staging and a push to `main` deploys production through the existing Drone pipelines. Git commits ship code and configuration, not MongoDB data or index state.

## Final application behavior

- Grounding preserves source occurrences, assertion, family context, clinical activity and workflow. Only accepted source-supported clinical findings/disorders can become principal diagnoses or comorbidities. Unresolved encounter diagnoses do not promote unrelated comorbidities.
- Retrieval uses canonical active FSN/synonym descriptions with real lexical/vector execution. Semantically unsupported matches require review or abstention; incomplete projection coverage remains visible. Graph nodes show codes after grounding and source highlighting remains the extraction view.
- Local configuration uses the new Grove gateway at `https://ai-gateway.corp.mongodb.com` with `LLM_API_STYLE=auto` and Bearer authorization. Deployment keeps its existing endpoint/auth/key secrets until Kanopy switches them together; auto mode also recognizes the legacy unified capability catalog. Separate catalogs drive Responses, Chat Completions and Anthropic Messages routing. The session and Benchmark share the discovered text-model catalog; no browser roster variable is required.
- A fresh session defaults to `gpt-5.4-nano`; explicit saved choices remain selected when available. The local gateway exposes 40 text models, and all 40 passed minimal structured-output routing checks.
- Clinical search rejects unsupported unscored retrieval results and ambiguous Boolean/leaf mixtures. The API schema advertises the fixed demo tenant. Projection coverage checks exclude inactive concepts/descriptions and definition-only rows.
- Staging and production use `NODE_ENV=production` and disable raw LLM I/O logging. Endpoint, authentication strategy and key remain in each environment's `snomed-secrets` group to support a code-first rollout.

## Local evidence and limits

The full 16-note GPT-5.5 review anchored 300 mentions; its final runs had no retrieval/semantic failures. The subsequent Nano review captured 270 mentions, anchored 261, and produced 20 rejected semantic decisions and one malformed decision-JSON response. Seven Nano runs were degraded; affected mappings remain review/abstention. Nano is the requested default but is not clinically qualified as an equivalent replacement for the prior model. These are demo review proposals requiring human approval, not automatic clinical coding.

The local canonical inventory contains 550,426 concepts, including 399,045 active concepts. The search sidecar contains 132,788 description documents representing 25,619 active/searchable concepts: 6.42% of all active canonical concepts. This gap comes from the capped demo projection. No full projection rebuild, dataset replacement or database rename is performed by this release. A broad projection needs separate capacity sizing, index creation and clinical validation.

Model and grounding evidence is documented in `GROVE_GATEWAY_MIGRATION.md`, `GROUNDING_ACCURACY_IMPROVEMENTS.md` and `MODELS_AND_PROJECTION_COVERAGE.md`. All 94 tests, the production build, the read-only database audit and all 44 authored bilingual clinical-search requests passed locally. The database audit found all 87 required concepts in active FSN/synonym projections, READY lexical/vector indexes and no missing synthetic notes/codings or stale ancestry. See [release evidence](reviews/release-2026-11-12/summary.json). Local evidence does not confirm the deployed database identity or secret values.

## Required rollout order

1. Resolve actionable review findings and obtain the independent latest-push approval required by GitHub for `staging`. Signed commits and resolved review threads are required. The author cannot supply that approval.
2. Merge the release PR into `staging` with existing staging secrets and wait for Drone deployment success. Verify the actual deployed build SHA, health, readiness and discovered model catalog through authenticated access.
3. From the deployed staging container, run `npm run demo:verify` and `CLINICAL_QA_URL=http://127.0.0.1:8080 npm run notes:verify`. Confirm the pinned release, READY text/vector indexes, synthetic codings/ancestry and all 44 authored queries. Check an English and Spanish grounding note and a small benchmark using available models on the existing gateway. Review Nano's known quality limitations.
4. After staging passes, merge a `staging` → `main` promotion PR using the established merge method. Keep existing production secrets, wait for production Drone deployment and repeat the smoke checks. A merge to main alone does not prove successful deployment.
5. After the compatible code is confirmed in production, send the Kanopy handoff. Have operators switch staging's endpoint, authentication strategy and key together, restart/roll out the pods and verify the new catalog and GPT/Claude routing. Then repeat the secret transition and checks in production. Existing MongoDB and Voyage secrets keep their roles. See `KANOPY_RELEASE_HANDOFF.md` for exact settings.
6. Keep the preceding production SHA and configuration available for rollback. Retire the feature branch after staging merge; retain `staging` and `main` as long-lived branches.

Database audit failures are investigated against the licensed source and intended database. Do not seed, rebuild projections or alter indexes silently as part of the release. Maintenance commands that write data require a deliberate separate operation.
