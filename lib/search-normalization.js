const DIRECT_TOKEN_VARIANTS = {
  diabetis: ["diabetes"],
  cancer: ["cancer"],
  canceres: ["cancer"],
  càncer: ["cancer"],
  tumoracio: ["tumoracion"],
  tumefaccio: ["tumefaccion"],
  inflamatori: ["inflamatorio"],
  inflamatoria: ["inflamatoria"],
  inflamatoris: ["inflamatorios"],
  inflamatories: ["inflamatorias"],
  proliferatiu: ["proliferativo"],
  proliferativa: ["proliferativa"],
  proliferatius: ["proliferativos"],
  proliferatives: ["proliferativas"]
};

const RELATIONAL_TERM_PATTERNS = [
  /\bdue to\b/,
  /\bassociated with\b/,
  /\bwith\b/,
  /\bwithout\b/,
  /\bfollowing\b/,
  /\bsecondary to\b/,
  /\bcomplicating\b/,
  /\bcaused by\b/,
  /\bresulting from\b/,
  /\bde\b/,
  /\bcon\b/,
  /\bsecundaria a\b/,
  /\bdebido a\b/
];

function stripDiacritics(value) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
}

export function normalizeSearchText(value) {
  return stripDiacritics(value)
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function tokenizeSearchText(value) {
  return normalizeSearchText(value)
    .split(/\s+/)
    .map((token) => token.trim())
    .filter(Boolean);
}

function singularizeToken(token) {
  const value = String(token || "");
  if (value.length <= 4) return value;
  if (value.endsWith("es") && value.length > 5) return value.slice(0, -2);
  if (value.endsWith("s") && value.length > 4) return value.slice(0, -1);
  return value;
}

function lemmatizeToken(token) {
  const singular = singularizeToken(token);
  if (singular.endsWith("icas")) return `${singular.slice(0, -4)}ico`;
  if (singular.endsWith("icos")) return singular;
  if (singular.endsWith("ica")) return `${singular.slice(0, -3)}ico`;
  if (singular.endsWith("iques")) return `${singular.slice(0, -5)}ic`;
  if (singular.endsWith("ies") && singular.length > 5) return `${singular.slice(0, -3)}y`;
  return singular;
}

export function lemmatizeSearchText(value) {
  return tokenizeSearchText(value).map(lemmatizeToken).join(" ").trim();
}

export function buildSearchQueryVariants(value) {
  const normalized = normalizeSearchText(value);
  if (!normalized) return [];

  const tokens = tokenizeSearchText(normalized);
  const variants = new Set([normalized]);

  const lemmaVariant = lemmatizeSearchText(normalized);
  if (lemmaVariant) {
    variants.add(lemmaVariant);
  }

  tokens.forEach((token, index) => {
    const directVariants = DIRECT_TOKEN_VARIANTS[token] || [];
    const lemmaToken = lemmatizeToken(token);
    const tokenVariants = new Set([lemmaToken, ...directVariants].filter(Boolean));

    for (const variant of tokenVariants) {
      if (!variant || variant === token) continue;
      const phraseTokens = [...tokens];
      phraseTokens[index] = variant;
      variants.add(phraseTokens.join(" "));
    }
  });

  return Array.from(variants).filter(Boolean).slice(0, 6);
}

function getHighlightHits(item) {
  const highlights = Array.isArray(item?.highlights) ? item.highlights : [];
  const hits = [];

  for (const entry of highlights) {
    const path = String(entry?.path || "");
    const texts = Array.isArray(entry?.texts) ? entry.texts : [];
    const hitText = texts
      .filter((part) => part?.type === "hit" && String(part?.value || "").trim())
      .map((part) => String(part.value).trim())
      .join(" ");

    if (hitText) {
      hits.push({ path, text: hitText });
    }
  }

  return hits;
}

function scoreLengthDistance(text, target) {
  return Math.abs(String(text || "").length - String(target || "").length);
}

function countTokens(text) {
  return tokenizeSearchText(text).length;
}

function scoreContainmentRank(value, variants) {
  const normalized = normalizeSearchText(value);
  if (!normalized) return 99;
  for (const variant of variants) {
    if (!variant) continue;
    if (normalized === variant) return 0;
    if (normalized.startsWith(`${variant} `) || normalized.startsWith(variant)) return 1;
    if (normalized.includes(` ${variant} `) || normalized.endsWith(` ${variant}`) || normalized.includes(variant)) return 3;
  }
  return 8;
}

function scoreSpecificity(item, query, queryVariants) {
  const variants = Array.isArray(queryVariants) && queryVariants.length > 0
    ? queryVariants.map((value) => normalizeSearchText(value)).filter(Boolean)
    : [normalizeSearchText(query)].filter(Boolean);
  const normalizedQuery = variants[0] || "";
  const queryTokens = tokenizeSearchText(normalizedQuery);
  const term = String(item?.matchedTerm || item?.term || item?.displayTerm || "").trim();
  const fsn = String(item?.fsn || "").trim();
  const termContainment = scoreContainmentRank(term, variants);
  const fsnContainment = scoreContainmentRank(fsn, variants);
  const bestContainment = Math.min(termContainment, fsnContainment);
  const bestText = termContainment <= fsnContainment ? term : fsn;
  const bestNormalized = normalizeSearchText(bestText);
  const extraTokens = Math.max(countTokens(bestNormalized) - countTokens(normalizedQuery), 0);
  const relationPenalty = RELATIONAL_TERM_PATTERNS.reduce((sum, pattern) => (
    pattern.test(bestNormalized) ? sum + 2 : sum
  ), 0);
  const contradictionPenalty = queryTokens.reduce((sum, token) => {
    if (token.length < 5) return sum;
    return bestNormalized.includes(`non${token}`) && !normalizedQuery.includes(`non${token}`)
      ? sum + 8
      : sum;
  }, 0);
  const lengthPenalty = Math.min(scoreLengthDistance(bestNormalized, normalizedQuery), 40) / 10;

  return Number((bestContainment * 10 + extraTokens * 1.5 + relationPenalty + contradictionPenalty + lengthPenalty).toFixed(4));
}

function buildMatchInfo(item, query) {
  const queryText = String(query || "").trim();
  const normalizedQuery = normalizeSearchText(queryText);
  const queryVariants = buildSearchQueryVariants(queryText);
  const queryVariantSet = new Set(queryVariants);
  const lemmaQuery = lemmatizeSearchText(queryText);
  const isConceptIdQuery = /^\d{4,}$/.test(queryText);

  const term = String(item?.matchedTerm || item?.term || item?.displayTerm || "").trim();
  const fsn = String(item?.fsn || "").trim();
  const normalizedTerm = normalizeSearchText(term);
  const normalizedFsn = normalizeSearchText(fsn);
  const lemmaTerm = lemmatizeSearchText(term);
  const lemmaFsn = lemmatizeSearchText(fsn);
  const hits = getHighlightHits(item);
  const prefixPreferredVariant = Array.from(queryVariantSet).find((variant) => normalizedTerm.startsWith(`${variant} `) || normalizedTerm === variant);
  const nearExactPreferred = prefixPreferredVariant && Math.max(countTokens(normalizedTerm) - countTokens(prefixPreferredVariant), 0) <= 1;

  const exactHighlight = hits.find((entry) => queryVariantSet.has(normalizeSearchText(entry.text)));
  const prefixHighlight = hits.find((entry) => {
    const normalized = normalizeSearchText(entry.text);
    return normalized && Array.from(queryVariantSet).some((variant) => normalized.startsWith(variant));
  });

  const exactConceptId = isConceptIdQuery && String(item?.conceptId || "") === queryText;
  if (exactConceptId) {
    return { tier: 0, reason: "SCTID", matchedText: String(item?.conceptId || "") };
  }

  if (normalizedTerm && queryVariantSet.has(normalizedTerm)) {
    return { tier: 1, reason: item?.preferred || item?.isPreferred ? "Exact preferred" : "Exact term", matchedText: term };
  }

  if (nearExactPreferred) {
    return { tier: 2, reason: "Near-exact preferred", matchedText: term };
  }

  if (exactHighlight?.path === "synonyms") {
    return { tier: 3, reason: "Exact synonym", matchedText: exactHighlight.text };
  }

  if (normalizedFsn && queryVariantSet.has(normalizedFsn)) {
    return { tier: 4, reason: "Exact FSN", matchedText: fsn };
  }

  if (lemmaQuery && (lemmaTerm === lemmaQuery || lemmaFsn === lemmaQuery)) {
    return {
      tier: 5,
      reason: lemmaTerm === lemmaQuery ? "Lemma preferred" : "Lemma FSN",
      matchedText: lemmaTerm === lemmaQuery ? term : fsn
    };
  }

  if (normalizedTerm && Array.from(queryVariantSet).some((variant) => normalizedTerm.startsWith(variant))) {
    return { tier: 6, reason: "Prefix preferred", matchedText: term };
  }

  if (prefixHighlight?.path === "synonyms") {
    return { tier: 7, reason: "Prefix synonym", matchedText: prefixHighlight.text };
  }

  if (normalizedTerm && normalizedQuery && (normalizedTerm.includes(normalizedQuery) || normalizedQuery.includes(normalizedTerm))) {
    return { tier: 8, reason: "Lexical contains", matchedText: term };
  }

  if (normalizedFsn && normalizedQuery && (normalizedFsn.includes(normalizedQuery) || normalizedQuery.includes(normalizedFsn))) {
    return { tier: 9, reason: "FSN contains", matchedText: fsn };
  }

  if (exactHighlight) {
    const path = exactHighlight.path === "fsn" ? "FSN hit" : "Lexical hit";
    return { tier: 10, reason: path, matchedText: exactHighlight.text };
  }

  return {
    tier: 11,
    reason: "Fuzzy lexical",
    matchedText: term || fsn || String(item?.conceptId || ""),
    fuzzy: true
  };
}

export function rerankNavigatorResults({ query, results, limit }) {
  const targetLimit = Math.max(Number(limit) || 0, 1);
  const queryVariants = buildSearchQueryVariants(query);
  const ranked = [...(Array.isArray(results) ? results : [])].map((item) => {
    const match = buildMatchInfo(item, query);
    return {
      ...item,
      matchTier: match.tier,
      matchReason: match.reason,
      matchedText: match.matchedText,
      _matchLengthDistance: scoreLengthDistance(match.matchedText || item?.term || "", query),
      _specificityScore: scoreSpecificity(item, query, queryVariants)
    };
  });

  ranked.sort((left, right) => {
    const tierDiff = Number(left.matchTier || 99) - Number(right.matchTier || 99);
    if (tierDiff !== 0) return tierDiff;

    const specificityDiff = Number(left?._specificityScore || 0) - Number(right?._specificityScore || 0);
    if (specificityDiff !== 0) return specificityDiff;

    const preferredDiff = Number(right?.isPreferred ? 1 : 0) - Number(left?.isPreferred ? 1 : 0);
    if (preferredDiff !== 0) return preferredDiff;

    const distanceDiff = Number(left?._matchLengthDistance || 0) - Number(right?._matchLengthDistance || 0);
    if (distanceDiff !== 0) return distanceDiff;

    const rankDiff = Number(right?.termRank || 0) - Number(left?.termRank || 0);
    if (rankDiff !== 0) return rankDiff;

    const scoreDiff = Number(right?.score || 0) - Number(left?.score || 0);
    if (scoreDiff !== 0) return scoreDiff;

    const termDiff = String(left?.term || "").localeCompare(String(right?.term || ""));
    if (termDiff !== 0) return termDiff;

    return String(left?.conceptId || "").localeCompare(String(right?.conceptId || ""));
  });

  const deduped = [];
  const seenConceptIds = new Set();
  for (const item of ranked) {
    const conceptId = String(item?.conceptId || "").trim();
    if (conceptId && seenConceptIds.has(conceptId)) continue;
    if (conceptId) seenConceptIds.add(conceptId);
    deduped.push(item);
    if (deduped.length >= targetLimit) break;
  }

  return deduped.map((item) => {
    const { _matchLengthDistance, _specificityScore, ...rest } = item;
    return rest;
  });
}
