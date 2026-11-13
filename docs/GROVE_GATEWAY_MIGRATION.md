# New Grove gateway migration

Reviewed on 12 November 2026, following the user's migration to a new `grove_` key. The adapter is shared by extraction, semantic verification, optional assist and language-model clinical query planning. Clinical code selection continues to use MongoDB terminology.

## Configuration

```dotenv
ENABLE_LLM_GROUNDING=true
LLM_BASE_URL=https://ai-gateway.corp.mongodb.com
LLM_API_KEY=<your Grove key>
LLM_AUTH_HEADER=authorization-bearer
LLM_API_STYLE=auto
LLM_GROUNDING_MODEL=gpt-5.4-nano
```

`LLM_GROUNDING_MODELS` is optional display priority/fallback; it does not limit a successfully discovered catalog. The local priority list is Nano, Mini, GPT-5.4 and GPT-5.5. Duplicate default-model assignments and the retired `NEXT_PUBLIC_LLM_GROUNDING_MODELS` were removed. Existing saved session choices are preserved while available; a fresh session defaults to Nano.

## Protocol discovery

| Catalog/provider | Generation endpoint | Authentication |
| --- | --- | --- |
| OpenAI-owned models from `/openai/v1/models` | `/openai/v1/responses` | `Authorization: Bearer <key>` |
| Other text providers from `/openai/v1/models` | `/openai/v1/chat/completions` | `Authorization: Bearer <key>` |
| Models from `/anthropic/v1/models` | `/anthropic/v1/messages` | `x-api-key: <key>` and `anthropic-version: 2023-06-01` |

The same Grove key is used throughout. Protocol selection uses the source catalog and `owned_by` metadata, without a per-model endpoint table. Exact case-sensitive model IDs are retained. Anthropic response content blocks are parsed separately from thinking blocks. Usage from all protocols is normalized, including Anthropic cache input tokens.

The new OpenAI-compatible catalog returned 27 IDs: 26 text models and one embedding model. The Anthropic catalog returned 14 text models. The selector therefore contains **40 text models**: 18 Responses, 8 Chat Completions and 14 Anthropic Messages. The pasted 44-model display also includes four embedding models; embeddings are a separate capability from clinical text generation. Mistral and Grok are absent from these current generation catalogs and are not retained from the old configured roster.

Some standard catalog rows omit modality metadata. The adapter prefers explicit capability/type information and otherwise excludes embedding/reranking ID markers. Complete modality metadata from the gateway would remove that fallback; catalog discovery does not make paid generation probes on every refresh. Every currently selected ID was separately verified with a minimal synthetic JSON request during this migration.

Catalog results are cached for five minutes, with concurrent discovery shared. A full refresh outage retains a verified catalog for up to 30 minutes with a warning. A partial outage exposes the verified catalog that is still available and shows a warning. Without a verified route, auto mode returns an error rather than guessing an endpoint. Explicit legacy `responses`, `chat` and direct `anthropic` modes remain supported.

## Verification and rollout

All 91 tests and the Next.js production build passed. All 40 discovered text models accepted their routed request and returned valid JSON on the synthetic smoke prompt. This establishes routing and basic structured output, not equivalent clinical accuracy across models. Evidence is in [routing checks](reviews/grove-migration/routing-checks.json).

All 16 grounding notes were rerun with Nano against real MongoDB hybrid retrieval. Both lexical and vector branches completed 259 times, with no branch errors or retrieval timeouts. Canonical checks examined 1,078 candidate codes. The only seven contract issues were degraded-run flags; no returned-code or accepted-source contract violation was found.

Nano produced 270 mentions, of which 261 were anchored. Its outputs included 20 rejected semantic decisions and one malformed decision-JSON response. Seven notes were degraded; the affected results were left for review or abstention. Overall, 180 mappings were accepted, 54 required review and 36 abstained. These are pipeline outcomes, not measured clinical precision/recall. The earlier GPT-5.5 run anchored all 300 extracted mentions and had no semantic failures, so Nano is **not clinically qualified as an equivalent production replacement**. It remains the requested local default, with stronger models available for selection and benchmarking.

Results are in [the Nano example summary](reviews/grove-migration/nano-example-summary.json) and [canonical contract checks](reviews/grove-migration/nano-contract-checks.json). No clinical codes were saved and no terminology projections or indexes were rebuilt.

Staging and production manifests set auto routing and Nano as the default, while retaining endpoint, authentication strategy and key in `snomed-secrets`. Auto mode recognizes the legacy unified capability catalog and the new split catalogs, so compatible code can land before operators switch `LLM_BASE_URL`, `LLM_AUTH_HEADER` and `LLM_API_KEY` together. Local configuration already uses the new gateway. Production promotion still requires staging approval and deployed checks; see `KANOPY_RELEASE_HANDOFF.md` for the operator transition.
