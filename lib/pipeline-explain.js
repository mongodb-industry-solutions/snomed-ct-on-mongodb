// Plain-language annotations for the aggregation pipelines retrieval runs.
//
// Everything here is derived from the pipeline JSON itself — the clause types,
// paths, boosts, filters and limits it actually contains — so an explanation
// can never describe a query that differs from the one shown next to it. The
// "why" text is the design rationale a team would need to reproduce the
// approach in their own system.

const ROLE_INTROS = {
  "exact-lookup": {
    title: "Exact lookup",
    what: "A strict MongoDB Search query: the mention must appear as a phrase (or an in-order prefix) in a term, synonym or FSN.",
    why: "Most clinical mentions are written the way SNOMED names them. A precise, cheap query resolves those first, so broader (and noisier) retrieval only has to handle what's left."
  },
  "lexical-search": {
    title: "Broad lexical search",
    what: "A wider MongoDB Search query that also scores partial and word-level matches.",
    why: "Runs only when the exact lookup found nothing: it trades precision for recall so a slightly different wording still finds candidates."
  },
  "native-rankFusion": {
    title: "Hybrid search with $rankFusion",
    what: "One aggregation that runs two searches over the same collection — MongoDB Search (keywords) and MongoDB Vector Search (meaning) — and merges their rankings.",
    why: "Keywords nail exact terms, synonyms and identifiers; vectors find concepts that mean the same thing with different words (\"heart attack\" → \"Myocardial infarction\"). Fusing ranks, not raw scores, avoids comparing two incompatible score scales."
  },
  "native-scoreFusion": {
    title: "Hybrid search with $scoreFusion",
    what: "One aggregation that runs MongoDB Search and MongoDB Vector Search and blends their normalized relevance scores.",
    why: "Unlike rank fusion, score fusion keeps how much better one hit is than the next; scores are normalized first so the two engines are comparable."
  },
  "app-rrf-lexical": {
    title: "Lexical input (app-side fusion)",
    what: "The keyword half of hybrid search, run as its own query because native fusion was unavailable or switched off.",
    why: "Runs in parallel with the vector query; the application merges the two rankings with the same formula $rankFusion uses."
  },
  "app-rrf-vector": {
    title: "Semantic input (app-side fusion)",
    what: "The meaning half of hybrid search: an approximate-nearest-neighbour search over term embeddings.",
    why: "Finds concepts whose wording differs from the note but whose meaning matches. Runs in parallel with the lexical query."
  }
};

export function explainRole(role) {
  return ROLE_INTROS[role] || null;
}

function asArray(value) {
  if (value === undefined || value === null) return [];
  return Array.isArray(value) ? value : [value];
}

function list(values) {
  return asArray(values).map((v) => `“${v}”`).join(", ");
}

function boostOf(clause) {
  return clause?.score?.boost?.value ?? null;
}

// ---- $search clauses --------------------------------------------------------

function explainSearchClause(clause) {
  const [type, body] = Object.entries(clause || {})[0] || [];
  const boost = boostOf(body);
  const boostNote = boost != null ? ` Boost ×${boost}.` : "";
  const path = asArray(body?.path).join(", ");
  switch (type) {
    case "phrase":
      return {
        type,
        summary: `Phrase ${list(body.query)} in ${path}${body.slop ? ` (up to ${body.slop} words apart)` : " (words adjacent, in order)"}.${boostNote}`,
        why: path.includes("displayTerm")
          ? "The strongest signal: the mention is the concept's display term, word for word."
          : path.includes("synonyms")
            ? "Same exact wording, but as a synonym — slightly weaker than the preferred term."
            : "Exact wording in the fully specified name — weaker still, FSNs carry qualifiers."
      };
    case "autocomplete":
      return {
        type,
        summary: `Prefix match ${list(body.query)} on ${path}${body.tokenOrder === "sequential" ? ", words in order" : ""}${body.fuzzy ? `, tolerating ${body.fuzzy.maxEdits} typo(s)` : ""}.${boostNote}`,
        why: "Edge-gram matching catches truncated or still-being-typed wording (\"diabet\" → \"diabetes\") without a full-text scan."
      };
    case "text":
      return {
        type,
        summary: `Any of ${asArray(body.query).length} word/phrase variant(s) in ${path}${body.matchCriteria === "any" ? " (any one is enough)" : ""}.${boostNote}`,
        why: "A low-boost recall net: terms that share only some words still score a little, so they can surface when nothing matches exactly."
      };
    case "in":
      return {
        type,
        summary: `${path} is one of ${list(body.value)}.${boostNote}`,
        why: path === "conceptId" ? "The query looks like a SNOMED identifier, so a direct id match is added." : "Restricts to an explicit list of values."
      };
    case "equals":
      return { type, summary: `${path} = ${JSON.stringify(body.value)}.`, why: null };
    case "compound":
      return { type, summary: "Nested compound clause.", why: null, children: explainCompound(body) };
    default:
      return { type: type || "unknown", summary: `${type} clause.`, why: null };
  }
}

function explainFilter(clause) {
  const [type, body] = Object.entries(clause || {})[0] || [];
  const path = asArray(body?.path).join(", ");
  if (type === "equals" && path === "active") return { type, summary: "Only active concepts.", why: "Retired SNOMED concepts must never be proposed as new codes." };
  if (type === "equals" || type === "in") {
    const values = asArray(body?.value);
    const shown = values.length > 6 ? `${values.length} values` : list(values);
    const why = path === "languageCode" ? "Search the terms of the note's language only."
      : path === "releaseId" ? "Pin results to one SNOMED release so codes are reproducible."
        : path === "conceptId" ? "Restricts to the semantic scope (area or ECL) chosen for this search."
          : path === "topRoots" || path === "areaTags" ? "Restricts to the chosen clinical area." : null;
    return { type, summary: `${path} ${type === "equals" ? "=" : "in"} ${shown}.`, why };
  }
  if (type === "compound" && Array.isArray(body?.mustNot)) {
    const inner = body.mustNot.map((c) => Object.values(c)[0]);
    const tags = inner.flatMap((b) => asArray(b?.value));
    return {
      type: "mustNot",
      summary: `Exclude ${tags.length} semantic tag value(s) (${tags.slice(0, 4).join(", ")}${tags.length > 4 ? ", …" : ""}).`,
      why: "Drops SNOMED's metadata and navigation hierarchies — they are not clinical codes and would otherwise match common words."
    };
  }
  return { type: type || "unknown", summary: `${type} filter.`, why: null };
}

function explainCompound(compound) {
  const out = [];
  if (Array.isArray(compound?.should)) {
    out.push({
      group: "should",
      summary: `${compound.should.length} alternative way(s) to match${compound.minimumShouldMatch ? ` — at least ${compound.minimumShouldMatch} must match` : ""}. Every matching clause adds to the score, multiplied by its boost.`,
      clauses: compound.should.map(explainSearchClause)
    });
  }
  if (Array.isArray(compound?.must)) {
    out.push({ group: "must", summary: `${compound.must.length} clause(s) that must all match.`, clauses: compound.must.map(explainSearchClause) });
  }
  if (Array.isArray(compound?.filter)) {
    out.push({
      group: "filter",
      summary: `${compound.filter.length} filter(s): restrict which terms can match, without affecting the score.`,
      clauses: compound.filter.map(explainFilter)
    });
  }
  return out;
}

// ---- stages -----------------------------------------------------------------

function explainVectorFilter(filter) {
  return Object.entries(filter || {}).map(([path, cond]) => {
    if (cond && typeof cond === "object" && Array.isArray(cond.$nin)) {
      return { type: "$nin", summary: `${path} not in ${cond.$nin.length} value(s).`, why: "Same metadata exclusion as the lexical side, applied before the nearest-neighbour search." };
    }
    if (cond && typeof cond === "object" && Array.isArray(cond.$in)) {
      return { type: "$in", summary: `${path} in ${cond.$in.length > 6 ? `${cond.$in.length} values` : list(cond.$in)}.`, why: path === "conceptId" ? "Semantic scope (area or ECL)." : null };
    }
    return { type: "$eq", summary: `${path} = ${JSON.stringify(cond)}.`, why: path === "languageCode" ? "Only the note's language." : path === "releaseId" ? "One pinned SNOMED release." : null };
  });
}

function explainStage(stage, ctx = {}) {
  const [op, body] = Object.entries(stage || {})[0] || [];
  switch (op) {
    case "$search":
      return {
        op,
        summary: `MongoDB Search on index “${body.index}”${body.highlight ? `, returning highlighted fragments of ${asArray(body.highlight.path).join(", ")}` : ""}.`,
        why: "Full-text search runs inside the database on a Lucene index — no separate search engine to keep in sync.",
        details: body.compound ? explainCompound(body.compound) : []
      };
    case "$vectorSearch":
      return {
        op,
        summary: `MongoDB Vector Search on index “${body.index}”, field “${body.path}”: compare ${body.numCandidates} nearest candidates and keep the closest ${body.limit}.`,
        why: body.query
          ? `The query text is embedded by MongoDB itself (automated embedding${body.model ? `, model ${body.model}` : ""}) — the app sends plain text, no embedding call of its own.`
          : "The app sends a precomputed query embedding.",
        details: body.filter ? [{ group: "filter", summary: "Pre-filter applied before the vector search.", clauses: explainVectorFilter(body.filter) }] : []
      };
    case "$rankFusion":
    case "$scoreFusion": {
      const pipelines = body?.input?.pipelines || {};
      const weights = body?.combination?.weights || {};
      return {
        op,
        summary: op === "$rankFusion"
          ? `Merge ${Object.keys(pipelines).length} input pipelines by rank: score = Σ weight / (60 + rank). Weights: ${Object.entries(weights).map(([k, v]) => `${k} ${v}`).join(", ")}.`
          : `Merge ${Object.keys(pipelines).length} input pipelines by score (${body?.input?.normalization || "no"} normalization). Weights: ${Object.entries(weights).map(([k, v]) => `${k} ${v}`).join(", ")}.`,
        why: op === "$rankFusion"
          ? "Rank fusion only needs positions, so it combines engines whose scores aren't comparable. A concept both engines rank highly rises to the top; k = 60 keeps one engine's #1 from dominating."
          : "Score fusion keeps relative score gaps; normalization puts both engines on the same 0–1 scale first.",
        inputs: Object.entries(pipelines).map(([name, pipeline]) => ({
          name,
          weight: weights[name] ?? null,
          stages: asArray(pipeline).map((s) => explainStage(s, ctx))
        }))
      };
    }
    case "$limit":
      return { op, summary: `Keep the first ${body} rows.`, why: ctx.afterSearch ? "Bounds how many candidates the next stages (and the app) have to process." : null };
    case "$sort":
      return {
        op,
        summary: `Sort by ${Object.entries(body).map(([k, v]) => `${k} ${v === -1 ? "↓" : "↑"}`).join(", ")}.`,
        why: Object.keys(body).length > 1 ? "Later keys only break ties, so equal scores get a stable, deterministic order." : null
      };
    case "$project": {
      const metas = Object.entries(body).filter(([, v]) => v && typeof v === "object" && v.$meta).map(([k, v]) => `${k} ← ${v.$meta}`);
      return {
        op,
        summary: `Shape each result (${Object.keys(body).filter((k) => body[k] !== 0).length} fields)${metas.length ? `; attach ${metas.join(", ")}` : ""}.`,
        why: "Return only what the next step needs — smaller payloads and a stable result shape."
      };
    }
    case "$addFields": {
      const fields = Object.entries(body).map(([k, v]) => (v && typeof v === "object" && v.$meta ? `${k} ← ${v.$meta}` : k));
      return { op, summary: `Add ${fields.join(", ")}.`, why: fields.some((f) => f.includes("scoreDetails")) ? "Keeps the per-engine rank and weight, so the UI can show why each concept placed where it did." : null };
    }
    case "$group":
      return { op, summary: `Group by ${JSON.stringify(body._id)}, keeping the first row of each group.`, why: "A concept can match through several of its terms; keep one row per concept (the best-scored, thanks to the preceding sort)." };
    case "$replaceRoot":
      return { op, summary: "Unwrap the kept row back to a plain document.", why: null };
    case "$match":
      return { op, summary: `Filter documents: ${JSON.stringify(body).slice(0, 120)}.`, why: null };
    default:
      return { op: op || "unknown", summary: `${op} stage.`, why: null };
  }
}

export function explainPipeline(pipeline) {
  let afterSearch = false;
  return asArray(pipeline).map((stage) => {
    const op = Object.keys(stage || {})[0];
    const explained = explainStage(stage, { afterSearch });
    if (op === "$search" || op === "$vectorSearch" || op === "$rankFusion" || op === "$scoreFusion") afterSearch = true;
    return explained;
  });
}
