# Standalone demo release — 30 October 2026

This release contains only the `snomed-ct-on-mongodb` reference application. Healthcare Data Lab and Kehrnel implementations remain outside this pull request. The branch starts from current `main` and retains its existing Drone, Docker and Kanopy setup.

## Resulting behavior

- Navigation defaults to application-side RRF for responsive hybrid retrieval. Native fusion remains an optional experiment. Search results show canonical preferred terms; only active FSNs/synonyms are candidates, while definitions supply embedding context.
- The graph fits after neighboring nodes finish loading and measuring, and refits when the inspector changes its available width. Ancestor exploration exposes bounded MongoDB `$graphLookup` navigation.
- Clinical-note search starts with broad SNOMED families, preserves Boolean grouping and clinical context, supports demographic and date filters, and allows optional refinement. The demo date reference keeps relative-date examples reproducible.
- The synthetic corpus generator supplies 512 bilingual notes across 32 profiles. Existing reviewed notes remain intact.
- Mapping import, candidate translation and the FHIR R4 `$translate` subset preserve published map rules and versions. Real mapping targets still require an authorized mapping dataset; the UI does not invent translations.
- The session and benchmark model pickers read the server configuration at runtime. `NEXT_PUBLIC_LLM_GROUNDING_MODELS` is retired, eliminating the build-time roster mismatch in containers. A fresh session defaults to `gpt-5.4-mini`; an explicit saved selection is retained if still available.
- Staging and production configure `gpt-5.4-mini`, `gpt-5.4`, `gpt-5.5`, `claude-opus-4-8`, `claude-sonnet-5` and `claude-haiku-4-5`. All six returned output through the configured local gateway. Other previously listed provider IDs were omitted after unavailable deployment responses. These settings select existing gateway deployments; they do not provision new models.

## Database evidence

The read-only audit of the database used by the local demo passed on 30 October 2026:

| Check | Result |
| --- | --- |
| Database and source | `terminology.snomed-irbd` |
| Pinned terminology release | `20260601` |
| Required active demo concepts | 88; none missing |
| Required concepts with searchable FSN/synonym rows | 88; none missing |
| Term projection rows | 129,536 |
| Atlas Search and automatic Voyage vector indexes | `snomed_text_idx` and `snomed_voyage_idx`; READY and queryable |
| Searchable notes | 518 total; 512 synthetic |
| Expected synthetic notes/codings missing | 0 / 0 |
| Synthetic coding ancestor arrays differing from the canonical release | 0 |
| Built-in search cases | 44 English/Spanish requests; no false positives or false negatives |

There are 1,441 legacy definition rows in the sidecar. Runtime lexical, vector and hybrid retrieval filters exclude them using the description type; new projection builds emit only FSNs and synonyms. Definitions remain in the canonical concept and embedding context. This release does not drop or recreate the existing sidecar or Atlas indexes.

This evidence covers the configured local database. The production database identity is supplied by deployment secrets; DevOps must run the same checks with the staging/production connection before approval. Git commits carry application code and repeatable scripts, not MongoDB data or search index state.

## DevOps review and deployment

1. Review this demo-only PR, its runtime model roster and pinned release. Confirm that the deployment gateway serves the configured IDs and that its response budget supports the chosen models. Haiku required more than 1,024 output tokens; the application default is 4,096.
2. With the deployment's actual MongoDB variables/secrets, run `npm run demo:verify`. This command reads concept coverage, index readiness and synthetic-note codings/ancestry without modifying data. Its JSON output includes database/collection names, release ID and index-definition hashes for comparison.
3. If required concepts are absent from the projection, first confirm they exist in the licensed canonical release, then run `TERMS_ENSURE_APPLY=true npm run terms:ensure-demo`. This refreshes the required concepts without clearing the release or rebuilding capped branches. Automatic embeddings use the existing Atlas index; wait for index readiness and rerun the audit.
4. If the synthetic corpus is missing or its ancestry needs refreshing, inspect `npm run notes:seed -- --dry-run`, then run `npm run notes:seed`. Stable IDs preserve other records, and the existing demo reference date is retained. Do not use `--refresh-dates` for an ordinary deployment.
5. Deploy the reviewed branch to the existing staging environment. From the application container, run `CLINICAL_QA_URL=http://127.0.0.1:8080 npm run notes:verify`; adapt the URL to the staging service if testing remotely. All authored cases should match the coded-fact oracle. Check `/api/readiness` and `/api/llm-config` as well.
6. Confirm both browser model pickers show six models and a fresh session defaults to mini. Run a small benchmark before a larger comparison. Review the staging experience, obtain approval, then merge through the established release workflow. Approval and production deployment remain pending; this change does not enable automatic merging.

No full licensed terminology release, mapping dataset, credentials or database dump is committed. No database rename or destructive migration is required.

## Validation

- 25 unit checks passed for clinical plans, date behavior, concept scopes, mapping rule preservation and runtime model configuration.
- Production build succeeded without a browser model-list environment variable. Runtime configuration supplied six models to both pickers; browser verification also retained a manually selected model after reload, with no page errors.
- The database audit and all 44 built-in English/Spanish search requests passed.
- Browser geometry checks found no clipped graph nodes in the immediate neighborhood, after ancestor expansion or after inspector collapse.
- A small benchmark scored the same diabetes gold note with `gpt-5.4-mini` and `claude-haiku-4-5`, without extractor fallback. This is an execution check, not a model-quality research result.

The official [GPT-5.4 mini model documentation](https://developers.openai.com/api/docs/models/gpt-5.4-mini) confirms the model ID and supported API surfaces. The broader semantic interoperability workflow remains deferred in `SEMANTIC_INTEROPERABILITY_DEMO_PLAN.md`.

## Staging promotion update — 11 November 2026

The release PR targets `staging`. Drone deploys staging on a push to `staging`
and production on a push to `main`; retain those two long-lived branches.
The feature branch is temporary and must remain until its staging PR is merged.
GitHub staging rules require one independent approval, approval of the last push,
signed commits and resolved review threads. The author cannot approve this PR.
After the staging deployment and checks below pass, promote with a separate
`staging` → `main` PR. Keep the existing production branch name and pipeline.

Diagnosis proposals and the reviewer worklist now accept only SNOMED clinical
findings and disorders. Medication/substance, procedure, event, structure,
observable and unknown types cannot become principal diagnoses or comorbidities.
The guard also applies to optional LLM principal suggestions and candidate swaps.

The existing review findings are addressed by restricting the new clinical-search
route to `demo-hospital`, validating scalar graph/mapping version parameters,
rejecting ambiguous Boolean plan nodes, and isolating synthetic identities and
upserts by tenant. Existing default-tenant IDs stay unchanged. For legacy custom
tenants, `notes:seed -- --dry-run` reports identities requiring migration; an
ordinary seed writes the new namespace first, then removes only the matching
old synthetic records in that tenant after the write succeeds. It does not
recover records reassigned by an earlier seed; restore those from a backup.

Before production approval, collect evidence using the actual deployed secrets:

1. Run `npm run demo:verify` in both environments to confirm terminology coverage,
   the pinned release, search/vector index readiness and synthetic coding ancestry.
2. On staging, run `CLINICAL_QA_URL=http://127.0.0.1:8080 npm run notes:verify` and
   check `/api/health`, `/api/readiness`, and `/api/llm-config`.
3. Ground a mixed diagnosis/medication/procedure note in English and Spanish.
   Check the principal/comorbidity groups, then swap a principal candidate to a
   medication and verify it leaves the diagnosis group and loses principal status.
   Check the six runtime models and run a small grounding benchmark.
4. Resolve review threads, obtain independent approval and merge staging. After
   its deployment has passed these checks, review and merge `staging` into `main`.
   Verify the production health endpoints and keep the preceding production SHA
   as the rollback target. No database migration was run by this code update.

Validation for this update: 33 unit/regression checks pass; the production build
passes on Next.js 15.5.28; seven live requests reject invalid tenant/version
inputs with HTTP 400; health and runtime model metadata respond successfully.
The local database audit still finds all 88 required concepts, READY text/vector
indexes and 512 synthetic notes with no missing codings or stale ancestry. A
browser run of the mixed cardiology note places aspirin (a substance code) under
Medications and keeps only disorder codes in principal/comorbidity groups.
These local checks do not substitute for checks using deployed environment secrets.
