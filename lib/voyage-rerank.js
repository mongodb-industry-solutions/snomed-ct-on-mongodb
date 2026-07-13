import { getVoyageRerankConfig } from "@/lib/config";

// Thin, graceful client for the Voyage reranker (a cross-encoder that re-scores
// a candidate list against the query for semantic relevance). Used as the final
// ordering stage of the hybrid search. Never throws: on any failure (no key,
// network, non-2xx) it returns null so the caller can fall back to fusion order.
//
// Request/response shape follows the Voyage /rerank contract:
//   POST {base}/rerank { model, query, documents:[string], top_k }
//   -> { data|results: [{ index, relevance_score|score }] }

async function postJson(url, apiKey, body, timeoutMs) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify(body),
      signal: controller.signal
    });
    const data = await res.json().catch(() => ({}));
    return { status: res.status, data };
  } catch (error) {
    return { status: 0, data: null, error: error?.message || "network error" };
  } finally {
    clearTimeout(timer);
  }
}

// Returns an array of { index, relevanceScore } ordered best-first (subset of
// the input, length <= topK), or null if reranking is unavailable/failed.
export async function rerankDocuments({ query, documents, topK }) {
  const cfg = getVoyageRerankConfig();
  if (!cfg.enabled || !Array.isArray(documents) || documents.length === 0) {
    return null;
  }
  const body = {
    model: cfg.model,
    query: String(query || ""),
    documents,
    top_k: Math.min(topK || documents.length, documents.length)
  };

  for (const base of cfg.baseUrls) {
    const url = `${base.replace(/\/$/, "")}/rerank`;
    const { status, data, error } = await postJson(url, cfg.apiKey, body, cfg.timeoutMs);
    // 401/403 -> wrong host for this key; try the next base. Other failures also
    // fall through to the next base, then ultimately return null.
    if (status === 401 || status === 403 || status === 0 || error) {
      continue;
    }
    const rows = Array.isArray(data?.data)
      ? data.data
      : (Array.isArray(data?.results) ? data.results : null);
    if (!rows) {
      continue;
    }
    const ranked = rows
      .map((r) => ({
        index: Number(r.index ?? r.document_index),
        relevanceScore: Number(r.relevance_score ?? r.score)
      }))
      .filter((r) => Number.isInteger(r.index) && Number.isFinite(r.relevanceScore))
      .sort((a, b) => b.relevanceScore - a.relevanceScore);
    return ranked.length > 0 ? ranked : null;
  }
  return null;
}
