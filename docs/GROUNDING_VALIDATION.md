# Grounding validation

Extraction, terminology matching, clinical certainty, and encounter diagnosis selection are separate decisions. A matching SNOMED description does not confirm a suspected diagnosis. A lexical or reranker score is not a calibrated probability of clinical correctness.

Grounding defaults to hybrid retrieval: an indexed exact-description lookup plus MongoDB Search and Vector Search, followed by fusion and optional reranking. Exact lookup is pinned to the release, language, active concept, and active FSN/synonym descriptions. Complete description matches retain priority; nonliteral candidates retain their semantic reranker order instead of being reordered by term length. Broader candidates remain review proposals. Nonliteral mappings undergo a separate source-entailment check against the actual retrieved candidates and full note. Unknown codes, unsupported qualifiers, type mismatches, unconfirmed symptom interpretations, and reversed result polarity cannot be accepted automatically. A failed semantic check remains visibly incomplete. A documented encounter problem that remains unresolved cannot be replaced automatically by a comorbidity.

The Extraction graph is a view of mention evidence and context without codes. Grounding shows codes, match status, source spans, and candidate review. Missing verbatim evidence stays unanchored. Repeated occurrences remain separate evidence. Generic current ancestors may be omitted from comorbidity proposals only when an accepted descendant has the same assertion, temporality, and mention kind; their clinical assertions are never merged.

## Capture all examples

```sh
npm run grounding:validate -- --all --url http://localhost:3015 --output artifacts/grounding-review
```

This extracts all 16 built-in applied and benchmark notes once and uses the same mentions for lexical and hybrid retrieval. Bounded source passages retain the full note as context; every passage must succeed before the extraction is considered complete. It records prompts, responses, actual query traces, failures, and a manifest. It never saves codings. To review your own notes, pass `--notes notes.json`, containing an array of `{id, text, languageCode}` objects. To repeat retrieval with frozen mentions, use `--reuse-extraction`. `--reuse-grounding` reuses only healthy captures with the current retrieval/semantic policy and correct release metadata. The default concurrency is one note; raise it explicitly only after checking gateway capacity. Treat HTTP success as execution evidence, not clinical accuracy.

Run `npm run grounding:check -- artifacts/grounding-review` to verify source anchors, mention counts, active release membership, semantic kinds, full canonical descriptions or verified source entailment for accepted mappings, result polarity, and current patient evidence for diagnoses. The report also counts successful lexical/vector branches and query failures. These contracts complement manual clinical review; they do not measure clinical accuracy.

## Audit and extend the projection

```sh
npm run terms:audit-coverage
npm run terms:ensure-mentions -- artifacts/grounding-review
npm run terms:ensure-mentions -- artifacts/grounding-review --apply
```

The extension is a bounded offline operation, not a fallback on every request. It discovers candidates from active canonical descriptions for the extracted phrases, checks semantic kinds, records a reviewable plan, and caps each run at 500 concepts. `--apply` uses the existing source projection builder additively. It does not reset collections or recreate search indexes. Atlas auto-embedding uses the resulting `embedText`; the script does not send manual embedding requests. Description projection alone does not ensure semantic equivalence, comprehensive recall, or completed asynchronous indexing.

Use the coverage audit to distinguish total source concepts, active source concepts, unique projected concepts, description documents, and language coverage. A collection document count is not a concept count. A constrained projection requires explicit abstention/review for missing or uncertain matches.

## Manual review

For every mention review the source span, subject, assertion, activity/time, section, semantic kind, action state, qualifiers, candidate descriptions, code/release, and mapping decision. Review principal selection against the reason for the encounter and documented assessment. Keep symptoms, provisional diagnoses, background conditions of unspecified activity, negatives, relatives, and future actions separate.

The example notes are test inputs; their display hints do not drive retrieval or diagnosis selection. Human reference labels and expected codes belong in evaluation data, never in production phrase-to-code rules. The ambiguous chest-pain examples retain suspected angina rather than treating it as a confirmed principal diagnosis. Coding conventions may require further setting-specific adjudication.

## Output and evaluation

Retain all source occurrences when combining codings. Structured output preserves clinical activity, family relationship, measurement values, sites, stage, dose/route and relative time. Proposed or conditional actions remain draft proposals; discussion alone does not create an order. The FHIR bundle is a preview, not a validated production profile.

Benchmark headline retrieval and diagnosis scores use exact identifiers. Hierarchy proximity and recall within the projected subset are diagnostics; absent concepts remain in the end-to-end denominator. Clinical reference labels must be adjudicated and held out from projection tuning before these results can support an accuracy claim.
