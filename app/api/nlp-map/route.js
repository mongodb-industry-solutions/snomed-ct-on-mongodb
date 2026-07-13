import { createHash } from "node:crypto";

import { getCollection } from "@/lib/mongo";
import { getMongoConfig, getSearchConfig, getSemanticsConfig, getHybridSearchConfig, getLlmConfig } from "@/lib/config";
import { extractMentionsWithLlm, llmMentionContext } from "@/lib/clinical-extract";
import { resolveSemanticScope } from "@/lib/semantic-scope";
import { buildNavigatorSearchPipeline } from "@/lib/pipelines";
import { runHybridSearch } from "@/lib/hybrid-search";
import { ensureSearchIndexReady } from "@/lib/search-readiness";
import { buildMongoErrorPayload } from "@/lib/mongo-error";
import { computePrimaryDiagnosisCandidates } from "@/lib/principal-diagnosis";
import { buildSearchQueryVariants, rerankNavigatorResults } from "@/lib/search-normalization";
import { emitUsageEventSafe } from "@/lib/usage-events";
import { elapsedMs, fail, ok, parseJson } from "@/lib/http";

export const runtime = "nodejs";

const STOPWORDS = new Set([
  "the",
  "a",
  "an",
  "and",
  "or",
  "for",
  "with",
  "without",
  "de",
  "del",
  "la",
  "las",
  "el",
  "los",
  "of",
  "on",
  "to",
  "from",
  "at",
  "by",
  "into",
  "under",
  "en",
  "y",
  "o",
  "sin",
  "con",
  "para",
  "por"
]);

const LANGUAGE_HINTS = {
  es: ["paciente", "con", "sin", "para", "retinopatia", "diabetica", "oncologico", "mama", "dolor", "plan"],
  en: ["patient", "with", "without", "follow", "pain", "history", "finding", "procedure", "diabetic", "plan"]
};

// Per-phrase MongoDB Search time caps. Raised from ~1.8–3s because multi-word
// exact phrase lookups on the shared cluster routinely exceed the old caps and
// come back as "timed-out", producing empty/degraded grounding. For a demo the
// correctness of the grounded note matters more than shaving a second, so give
// each phrase enough budget to resolve.
const PROFILE_SETTINGS = {
  lexical_exact: {
    perPhraseLimit: 4,
    timeoutCapMs: 5000
  },
  "hybrid-balanced": {
    perPhraseLimit: 5,
    timeoutCapMs: 6000
  },
  "recall-boost-beta": {
    perPhraseLimit: 6,
    timeoutCapMs: 7000
  }
};

const CACHE_TTL_MS = 10 * 60 * 1000;
const RUN_CACHE = new Map();

const NEGATION_PATTERNS = [
  /\bno evidence of\b/i,
  /\bno\b/i,
  /\bnot\b/i,
  /\bwithout\b/i,
  /\bdenies\b/i,
  /\bdenied\b/i,
  /\bnegative for\b/i,
  /\babsence of\b/i,
  /\bfree of\b/i,
  /\bruled out\b/i,
  /\brule[ds]? out\b/i,
  /\bexcluded\b/i,
  /\bexclude[ds]?\b/i,
  /\bsin evidencia de\b/i,
  /\bsin\b/i,
  /\bniega\b/i,
  /\bdescartad[oa]s?\b/i,
  /\bexcluid[oa]s?\b/i
];

const HISTORY_PATTERNS = [
  /\bhistory of\b/i,
  /\bhx of\b/i,
  /\bpast medical history\b/i,
  /\bantecedentes\b/i,
  /\bprevious\b/i,
  /\bprior\b/i
];

const FAMILY_PATTERNS = [
  /\bfamily history\b/i,
  /\bfamily hx\b/i,
  /\bmother with\b/i,
  /\bfather with\b/i,
  /\bmadre con\b/i,
  /\bpadre con\b/i,
  /\bantecedentes familiares\b/i
];

const PLAN_PATTERNS = [
  /\bplan\b/i,
  /\bcontinue\b/i,
  /\brepeat\b/i,
  /\bfollow[\s-]?up\b/i,
  /\bmonitor\b/i,
  /\bstart\b/i,
  /\bschedule\b/i,
  /\bcontinuar\b/i,
  /\brepetir\b/i,
  /\bseguimiento\b/i,
  /\bcontrol\b/i
];

const HYPOTHETICAL_PATTERNS = [
  /\bsuspected\b/i,
  /\bpossible\b/i,
  /\bprobable\b/i,
  /\brule out\b/i,
  /\bsospecha\b/i,
  /\bposible\b/i,
  /\bprobable\b/i
];

const RELATION_SIGNAL_DEFS = [
  { value: "due-to", patterns: [/\bdue to\b/i, /\bsecondary to\b/i, /\bdebido a\b/i, /\bsecundaria a\b/i] },
  { value: "associated-with", patterns: [/\bassociated with\b/i, /\bwith\b/i, /\bcon\b/i] },
  { value: "caused-by", patterns: [/\bcaused by\b/i, /\bresulting from\b/i] }
];

const LOW_VALUE_ANCHOR_TOKENS = new Set([
  "patient",
  "patients",
  "assessment",
  "current",
  "review",
  "clinical",
  "note",
  "notes",
  "summary",
  "mother",
  "father",
  "today",
  "active",
  "prior",
  "previous",
  "continue",
  "repeat",
  "monitor",
  "schedule",
  "follow",
  "followup",
  "follow-up",
  "history",
  "family",
  "plan",
  // Spanish equivalents — the demo corpus is Spanish-primary, so these must be
  // treated as low-value anchors too (e.g. "paciente" should never ground).
  "paciente",
  "pacientes",
  "madre",
  "padre",
  "hoy",
  "activo",
  "activa",
  "previo",
  "previa",
  "continuar",
  "repetir",
  "seguimiento",
  "control",
  "familia",
  "familiar",
  "familiares",
  "antecedentes",
  "resumen",
  "evaluacion",
  "revision",
  "nota",
  "notas",
  "clinico",
  "clinica",
  "actual"
]);

const ANCHOR_BREAK_TOKENS = new Set(
  Array.from(STOPWORDS).filter((token) => !["with", "without", "con", "sin"].includes(token))
);

const MAX_PHRASE_WINDOWS_PER_SEGMENT = 2;
const MAX_GROUNDER_CONCURRENCY = 2;

const WORKFLOW_TERM_PATTERNS = [
  /\bfollow[\s-]?up\b/i,
  /\breview\b/i,
  /\bevaluation\b/i,
  /\bscreening\b/i,
  /\bmonitoring\b/i,
  /\bcheck\b/i
];

const CANDIDATE_RELATION_PATTERNS = [
  /\bdue to\b/i,
  /\bassociated with\b/i,
  /\bwith\b/i,
  /\bwithout\b/i,
  /\bfollowing\b/i,
  /\bsecondary to\b/i,
  /\bcaused by\b/i,
  /\bresulting from\b/i
];

const LATERALITY_TOKENS = new Set([
  "left",
  "right",
  "bilateral",
  "unilateral"
]);

const POPULATION_CONTEXT_TOKENS = new Set([
  "prematurity",
  "premature",
  "neonatal",
  "neonate",
  "maternal",
  "pregnancy",
  "congenital"
]);

const STATUS_QUALIFIER_TOKENS = new Set([
  "uncontrolled",
  "controlled",
  "poorly",
  "well",
  "stable",
  "unstable",
  "severe",
  "mild",
  "moderate",
  "advanced"
]);

const NEUTRAL_CANDIDATE_EXTRA_TOKENS = new Set([
  "mellitus",
  "type",
  "finding",
  "disorder",
  "disease"
]);

function isQueryTimeoutError(error) {
  const code = Number(error?.code);
  const codeName = String(error?.codeName || "").toLowerCase();
  const message = (error instanceof Error ? error.message : String(error)).toLowerCase();

  return (
    code === 50 ||
    codeName.includes("maxtimems") ||
    message.includes("maxtimems") ||
    message.includes("exceeded time limit") ||
    message.includes("operation exceeded time")
  );
}

function clamp01(value) {
  return Math.min(Math.max(value, 0), 1);
}

function normalizeText(value) {
  return String(value || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeRetrievalProfile(value) {
  const profile = String(value || "").trim().toLowerCase();
  if (profile === "fast-lexical") return "lexical_exact";
  if (profile && PROFILE_SETTINGS[profile]) return profile;
  return "lexical_exact";
}

function detectLanguage(text, requestedLanguageCode = "") {
  const normalized = normalizeText(text);
  const requested = normalizeText(requestedLanguageCode);
  const score = { es: 0, en: 0 };

  for (const hint of LANGUAGE_HINTS.es) {
    if (normalized.includes(hint)) score.es += 1;
  }
  for (const hint of LANGUAGE_HINTS.en) {
    if (normalized.includes(hint)) score.en += 1;
  }
  if (/[áéíóúñ]/i.test(text)) {
    score.es += 2;
  }

  const detectedLanguageCode = score.es === score.en
    ? (requested === "en" || requested === "es" ? requested : "es")
    : (score.es > score.en ? "es" : "en");

  return {
    requestedLanguageCode: requested === "en" || requested === "es" ? requested : null,
    detectedLanguageCode
  };
}

function buildExactPhraseLookupPipeline({
  phrase,
  indexName,
  languageCode,
  releaseId,
  limit
}) {
  const variants = buildSearchQueryVariants(phrase).slice(0, 4);
  const should = [];

  variants.forEach((variant, index) => {
    const baseBoost = index === 0 ? 14 : 10;
    should.push({
      autocomplete: {
        query: variant,
        path: "normalizedDisplay",
        tokenOrder: "sequential",
        score: { boost: { value: baseBoost + 4 } }
      }
    });
    should.push({
      phrase: {
        query: variant,
        path: "displayTerm",
        score: { boost: { value: baseBoost } }
      }
    });
    should.push({
      phrase: {
        query: variant,
        path: "synonyms",
        score: { boost: { value: baseBoost - 1 } }
      }
    });
    should.push({
      phrase: {
        query: variant,
        path: "fsn",
        score: { boost: { value: baseBoost - 2 } }
      }
    });
  });

  const filter = [
    { equals: { path: "active", value: true } }
  ];

  if (releaseId && releaseId !== "latest") {
    filter.push({ equals: { path: "releaseId", value: releaseId } });
  }
  if (languageCode) {
    filter.push({ equals: { path: "languageCode", value: languageCode } });
  }

  return [
    {
      $search: {
        index: indexName,
        compound: {
          filter,
          should,
          minimumShouldMatch: 1
        },
        highlight: {
          path: ["displayTerm", "fsn", "synonyms"]
        }
      }
    },
    { $limit: Math.min(Math.max(limit * 40, 120), 200) },
    {
      $project: {
        _id: 0,
        conceptId: 1,
        term: "$displayTerm",
        fsn: 1,
        semanticTag: 1,
        languageCode: 1,
        active: 1,
        releaseId: 1,
        ancestorIds: 1,
        isPreferred: { $ifNull: ["$isPreferred", false] },
        termRank: { $ifNull: ["$termRank", 0] },
        score: { $meta: "searchScore" },
        highlights: { $meta: "searchHighlights" }
      }
    },
    {
      $sort: {
        score: -1,
        isPreferred: -1,
        termRank: -1,
        term: 1
      }
    }
  ];
}

function applyScopePostFilter(results, conceptIdScope) {
  if (!Array.isArray(conceptIdScope) || conceptIdScope.length === 0) {
    return Array.isArray(results) ? results : [];
  }

  const scopeSet = new Set(conceptIdScope.map((value) => String(value)));
  return (Array.isArray(results) ? results : []).filter((entry) => scopeSet.has(String(entry?.conceptId || "")));
}

function tokenizeWithOffsets(text, baseOffset = 0) {
  return Array.from(text.matchAll(/[\p{L}\p{N}]+/gu)).map((match) => ({
    value: String(match[0] || ""),
    normalized: normalizeText(match[0]),
    start: baseOffset + (match.index || 0),
    end: baseOffset + (match.index || 0) + String(match[0] || "").length
  }));
}

function findEarliestPatternMatch(text, patterns) {
  const input = String(text || "");
  let earliest = null;

  for (const pattern of Array.isArray(patterns) ? patterns : []) {
    const regex = new RegExp(pattern.source, pattern.flags);
    const match = regex.exec(input);
    if (!match || typeof match.index !== "number") continue;

    const candidate = {
      text: String(match[0] || "").trim(),
      start: match.index,
      end: match.index + String(match[0] || "").length
    };

    if (!earliest || candidate.start < earliest.start) {
      earliest = candidate;
    }
  }

  return earliest;
}

function buildSectionRanges(text) {
  const normalizedText = String(text || "").replace(/\r\n/g, "\n");
  const matches = Array.from(normalizedText.matchAll(/(?:^|[\n\r]+|(?<=[.!?])\s+)([A-Za-zÀ-ÿ][A-Za-zÀ-ÿ /()_-]{0,40}):[ \t]*/gm));

  if (matches.length === 0) {
    return [{
      title: "Note",
      slug: "note",
      start: 0,
      contentStart: 0,
      end: normalizedText.length,
      text: normalizedText
    }];
  }

  const sections = [];
  const firstStart = matches[0]?.index || 0;
  if (firstStart > 0) {
    sections.push({
      title: "Note",
      slug: "note",
      start: 0,
      contentStart: 0,
      end: firstStart,
      text: normalizedText.slice(0, firstStart).trim()
    });
  }

  matches.forEach((match, index) => {
    const title = String(match[1] || "Section").trim();
    const start = match.index || 0;
    const contentStart = start + String(match[0] || "").length;
    const nextStart = matches[index + 1]?.index ?? normalizedText.length;
    sections.push({
      title,
      slug: normalizeText(title).replace(/\s+/g, "-") || `section-${index + 1}`,
      start,
      contentStart,
      end: nextStart,
      text: normalizedText.slice(contentStart, nextStart).trim()
    });
  });

  return sections.filter((section) => section.end > section.start);
}

function buildSentenceWindows(text, sections) {
  const windows = [];

  for (const section of sections) {
    const segment = String(text || "").slice(section.contentStart, section.end);
    const matches = Array.from(segment.matchAll(/[^\n.!?]+(?:[.!?]+)?/g));

    if (matches.length === 0 && segment.trim()) {
      const leadingWhitespace = (segment.match(/^\s*/) || [""])[0].length;
      const sentenceText = segment.trim();
      const start = section.contentStart + leadingWhitespace;
      windows.push({
        section: section.title,
        sectionSlug: section.slug,
        text: sentenceText,
        start,
        end: start + sentenceText.length
      });
      continue;
    }

    for (const match of matches) {
      const rawSentence = String(match[0] || "");
      const leadingWhitespace = (rawSentence.match(/^\s*/) || [""])[0].length;
      const sentenceText = rawSentence.trim();
      if (!sentenceText) continue;
      const start = section.contentStart + (match.index || 0) + leadingWhitespace;
      windows.push({
        section: section.title,
        sectionSlug: section.slug,
        text: sentenceText,
        start,
        end: start + sentenceText.length
      });
    }
  }

  return windows;
}

function phraseEntryKey(start, end, normalizedPhrase) {
  return `${start}:${end}:${normalizedPhrase}`;
}

function buildSignal({
  cueType,
  value,
  source,
  text,
  sectionTitle,
  sentenceStart = 0,
  start = null,
  end = null
}) {
  const signalText = String(text || sectionTitle || "").trim();
  return {
    cueType,
    value,
    source,
    text: signalText || null,
    start: Number.isFinite(start) ? sentenceStart + start : null,
    end: Number.isFinite(end) ? sentenceStart + end : null
  };
}

function extractEvidenceSignals({ section, sentenceText, sentenceStart }) {
  const sectionTitle = String(section || "");
  const sentence = String(sentenceText || "");
  const signals = [];
  const familyMatch = findEarliestPatternMatch(sentence, FAMILY_PATTERNS);
  const negationMatch = findEarliestPatternMatch(sentence, NEGATION_PATTERNS);
  const planMatch = findEarliestPatternMatch(sentence, PLAN_PATTERNS);
  const hypotheticalMatch = findEarliestPatternMatch(sentence, HYPOTHETICAL_PATTERNS);
  const historyMatch = findEarliestPatternMatch(sentence, HISTORY_PATTERNS);

  if (FAMILY_PATTERNS.some((pattern) => pattern.test(sectionTitle)) && !familyMatch) {
    signals.push(buildSignal({
      cueType: "family-history",
      value: "family-history",
      source: "section",
      sectionTitle
    }));
  }
  if (familyMatch) {
    signals.push(buildSignal({
      cueType: "family-history",
      value: "family-history",
      source: "sentence",
      text: familyMatch.text,
      sentenceStart,
      start: familyMatch.start,
      end: familyMatch.end
    }));
  }

  if ((/\bhistory\b/i.test(sectionTitle) || /\bantecedentes\b/i.test(sectionTitle)) && !historyMatch) {
    signals.push(buildSignal({
      cueType: "history",
      value: "historical",
      source: "section",
      sectionTitle
    }));
  }
  if (historyMatch) {
    signals.push(buildSignal({
      cueType: "history",
      value: "historical",
      source: "sentence",
      text: historyMatch.text,
      sentenceStart,
      start: historyMatch.start,
      end: historyMatch.end
    }));
  }

  if ((/\bplan\b/i.test(sectionTitle) || /\bseguimiento\b/i.test(sectionTitle)) && !planMatch) {
    signals.push(buildSignal({
      cueType: "plan",
      value: "planned",
      source: "section",
      sectionTitle
    }));
  }
  if (planMatch) {
    signals.push(buildSignal({
      cueType: "plan",
      value: "planned",
      source: "sentence",
      text: planMatch.text,
      sentenceStart,
      start: planMatch.start,
      end: planMatch.end
    }));
  }

  if (negationMatch) {
    signals.push(buildSignal({
      cueType: "negation",
      value: "absent",
      source: "sentence",
      text: negationMatch.text,
      sentenceStart,
      start: negationMatch.start,
      end: negationMatch.end
    }));
  }

  if (hypotheticalMatch) {
    signals.push(buildSignal({
      cueType: "certainty",
      value: "suspected",
      source: "sentence",
      text: hypotheticalMatch.text,
      sentenceStart,
      start: hypotheticalMatch.start,
      end: hypotheticalMatch.end
    }));
  }

  for (const relationDef of RELATION_SIGNAL_DEFS) {
    const relationMatch = findEarliestPatternMatch(sentence, relationDef.patterns);
    if (!relationMatch) continue;
    signals.push(buildSignal({
      cueType: "relation",
      value: relationDef.value,
      source: "sentence",
      text: relationMatch.text,
      sentenceStart,
      start: relationMatch.start,
      end: relationMatch.end
    }));
  }

  return signals;
}

function deriveContextFromSignals(signals) {
  const items = Array.isArray(signals) ? signals : [];

  if (items.some((signal) => signal.cueType === "family-history")) {
    return {
      assertion: "family-history",
      contextType: "family-history",
      experiencer: "family"
    };
  }

  if (items.some((signal) => signal.cueType === "negation")) {
    return {
      assertion: "absent",
      contextType: "negated",
      experiencer: "patient"
    };
  }

  if (items.some((signal) => signal.cueType === "plan")) {
    return {
      assertion: "planned",
      contextType: "plan",
      experiencer: "patient"
    };
  }

  if (items.some((signal) => signal.cueType === "certainty")) {
    return {
      assertion: "suspected",
      contextType: "hypothetical",
      experiencer: "patient"
    };
  }

  if (items.some((signal) => signal.cueType === "history")) {
    return {
      assertion: "historical",
      contextType: "history",
      experiencer: "patient"
    };
  }

  return {
    assertion: "present",
    contextType: "current",
    experiencer: "patient"
  };
}

function scorePhraseCandidate({ normalizedPhrase, tokenCount, contextType }) {
  const tokens = normalizeText(normalizedPhrase).split(/\s+/).filter(Boolean);
  const longTokens = tokens.filter((token) => token.length >= 5).length;
  const lowValueTokens = tokens.filter((token) => LOW_VALUE_ANCHOR_TOKENS.has(token)).length;
  const digitTokens = tokens.filter((token) => /^\d+$/.test(token)).length;
  let score = 0;

  if (tokenCount >= 2 && tokenCount <= 4) {
    score += 24;
  } else if (tokenCount === 1) {
    score += 10;
  } else {
    score += Math.max(16 - (tokenCount - 4) * 3, 0);
  }

  score += longTokens * 6;
  score += digitTokens > 0 ? 2 : 0;
  score -= lowValueTokens * 10;

  if (contextType === "current") score += 4;
  if (contextType === "history" || contextType === "negated") score += 2;
  if (contextType === "plan") score -= 4;
  if (contextType === "family-history") score -= 30;

  if (tokens.length === 1 && tokens[0] && tokens[0].length < 6) {
    score -= 8;
  }
  if (tokens.length > 0 && tokens.every((token) => LOW_VALUE_ANCHOR_TOKENS.has(token))) {
    score -= 40;
  }

  return score;
}

function pushPhraseEntry({
  phraseBucket,
  seen,
  text,
  start,
  end,
  tokenCount,
  sentence,
  evidenceSignals: providedSignals,
  context: providedContext
}) {
  const phrase = String(text || "").slice(start, end).trim();
  const normalizedPhrase = normalizeText(phrase);
  if (!phrase || normalizedPhrase.length < 3) {
    return false;
  }

  if (tokenCount === 1 && normalizedPhrase.length < 5) {
    return false;
  }

  const key = phraseEntryKey(start, end, normalizedPhrase);
  if (seen.has(key)) {
    return false;
  }

  const evidenceSignals = Array.isArray(providedSignals)
    ? providedSignals
    : extractEvidenceSignals({
        section: sentence.section,
        sentenceText: sentence.text,
        sentenceStart: sentence.start
      });
  const context = providedContext || deriveContextFromSignals(evidenceSignals);

  seen.add(key);
  phraseBucket.push({
    phrase,
    normalizedPhrase,
    start,
    end,
    tokenCount,
    section: sentence.section,
    sectionSlug: sentence.sectionSlug || normalizeText(sentence.section).replace(/\s+/g, "-") || "note",
    sentence: sentence.text,
    sentenceStart: sentence.start,
    sentenceEnd: sentence.end,
    evidenceSignals,
    anchorRole: "clinical-term",
    candidateScore: scorePhraseCandidate({
      normalizedPhrase,
      tokenCount,
      contextType: context.contextType
    }),
    ...context
  });
  return true;
}

function tokenOverlapsSignal(token, signals) {
  const start = Number(token?.start);
  const end = Number(token?.end);
  if (!Number.isFinite(start) || !Number.isFinite(end)) return false;

  return (Array.isArray(signals) ? signals : []).some((signal) => {
    const signalStart = Number(signal?.start);
    const signalEnd = Number(signal?.end);
    if (!Number.isFinite(signalStart) || !Number.isFinite(signalEnd)) return false;
    return start < signalEnd && end > signalStart;
  });
}

function buildSentenceSegments(sentence, evidenceSignals) {
  const tokens = tokenizeWithOffsets(sentence.text, sentence.start).filter((token) => token.normalized);
  const segments = [];
  let current = [];

  for (const token of tokens) {
    const normalizedToken = token.normalized;
    const breakToken =
      tokenOverlapsSignal(token, evidenceSignals) ||
      ANCHOR_BREAK_TOKENS.has(normalizedToken) ||
      LOW_VALUE_ANCHOR_TOKENS.has(normalizedToken);

    if (breakToken) {
      if (current.length > 0) {
        segments.push(current);
        current = [];
      }
      continue;
    }

    current.push(token);
  }

  if (current.length > 0) {
    segments.push(current);
  }

  return segments.filter((segment) => segment.length > 0);
}

function buildSegmentWindows(segment) {
  if (!Array.isArray(segment) || segment.length === 0) return [];

  const windows = [];
  const maxWindow = Math.min(segment.length, 4);

  for (let size = maxWindow; size >= 1; size -= 1) {
    for (let index = 0; index <= segment.length - size; index += 1) {
      const tokens = segment.slice(index, index + size);
      const normalizedPhrase = normalizeText(tokens.map((token) => token.value).join(" "));
      if (!normalizedPhrase) continue;

      windows.push({
        tokens,
        score:
          scorePhraseCandidate({
            normalizedPhrase,
            tokenCount: tokens.length,
            contextType: "current"
          }) +
          (index + size === segment.length ? 3 : 0) -
          index
      });
    }
  }

  return windows
    .sort((left, right) => right.score - left.score || right.tokens.length - left.tokens.length)
    .slice(0, MAX_PHRASE_WINDOWS_PER_SEGMENT)
    .map((entry) => entry.tokens);
}

function extractCandidatePhrases(text, maxPhrases) {
  const sections = buildSectionRanges(text);
  const sentences = buildSentenceWindows(text, sections);
  const phrases = [];
  const seen = new Set();

  for (const sentence of sentences) {
    const evidenceSignals = extractEvidenceSignals({
      section: sentence.section,
      sentenceText: sentence.text,
      sentenceStart: sentence.start
    });
    const context = deriveContextFromSignals(evidenceSignals);
    const segments = buildSentenceSegments(sentence, evidenceSignals);

    for (const segment of segments) {
      const windows = segment.length <= 4 ? [segment] : buildSegmentWindows(segment);
      for (const window of windows) {
        if (window.length === 0) continue;
        pushPhraseEntry({
          phraseBucket: phrases,
          seen,
          text,
          start: window[0].start,
          end: window[window.length - 1].end,
          tokenCount: window.length,
          sentence,
          evidenceSignals,
          context
        });
      }
    }
  }

  const rankedPhrases = phrases
    .sort((left, right) => {
      const scoreDiff = Number(right.candidateScore || 0) - Number(left.candidateScore || 0);
      if (scoreDiff !== 0) return scoreDiff;
      const tokenDiff = Number(right.tokenCount || 0) - Number(left.tokenCount || 0);
      if (tokenDiff !== 0) return tokenDiff;
      return Number(left.start || 0) - Number(right.start || 0);
    })
    .slice(0, maxPhrases);

  return { sections, phrases: rankedPhrases };
}

// LLM extraction carries context on the mention rather than as detected trigger
// words, so synthesize the equivalent evidence-cue signals (negation / history /
// family / plan / certainty). This makes the evidence graph render the same
// context bubble on top of each mention as the deterministic path does.
function synthLlmSignals(ctx, start, end) {
  const map = {
    negated: { cueType: "negation", value: "absent", text: "negated" },
    "family-history": { cueType: "family-history", value: "family", text: "family history" },
    history: { cueType: "history", value: "historical", text: "history" },
    plan: { cueType: "plan", value: "planned", text: "plan" },
    hypothetical: { cueType: "certainty", value: "suspected", text: "suspected" }
  };
  const s = map[ctx.contextType];
  if (!s) return [];
  return [{ ...s, start, end, source: "llm" }];
}

// Turn LLM-extracted mentions into the same phrase-entry shape the grounding
// pipeline consumes, so retrieval + scoring + evidence graph are unchanged. The
// LLM supplies the phrase and its context (assertion/subject/temporality); we
// locate the verbatim span in the note for evidence highlighting.
function buildLlmPhraseEntries(text, mentions, maxPhrases) {
  const lowerText = text.toLowerCase();
  const entries = [];
  const seen = new Set();
  for (const m of mentions.slice(0, maxPhrases)) {
    const phrase = String(m.phrase || "").trim();
    const normalizedPhrase = normalizeText(phrase);
    if (!normalizedPhrase) continue;
    // Dedupe by phrase + subject + assertion so a distinct occurrence of the
    // same term survives (e.g. the patient's diabetes AND "mother with diabetes"
    // in family history) — keying on phrase alone silently drops the family one.
    const dedupeKey = `${normalizedPhrase}|${m.subject || "patient"}|${m.assertion || "present"}`;
    if (seen.has(dedupeKey)) continue;
    seen.add(dedupeKey);

    const needle = String(m.verbatim || phrase).toLowerCase();
    let start = needle ? lowerText.indexOf(needle) : -1;
    if (start < 0) start = lowerText.indexOf(normalizedPhrase);
    const spanLen = start >= 0 ? (m.verbatim || phrase).length : phrase.length;
    const safeStart = start >= 0 ? start : 0;
    const end = safeStart + spanLen;

    const lineStart = start >= 0 ? text.lastIndexOf("\n", start) + 1 : 0;
    let lineEnd = start >= 0 ? text.indexOf("\n", start) : -1;
    if (lineEnd < 0) lineEnd = text.length;

    const tokenCount = normalizedPhrase.split(/\s+/).filter(Boolean).length;
    const ctx = llmMentionContext(m);
    entries.push({
      phrase,
      normalizedPhrase,
      start: safeStart,
      end,
      tokenCount,
      section: "note",
      sectionSlug: "note",
      sentence: text.slice(lineStart, lineEnd) || phrase,
      sentenceStart: lineStart,
      sentenceEnd: lineEnd,
      evidenceSignals: synthLlmSignals(ctx, safeStart, end),
      anchorRole: "clinical-term",
      candidateScore: scorePhraseCandidate({ normalizedPhrase, tokenCount, contextType: ctx.contextType }),
      verbatim: m.verbatim || phrase,
      llmSection: m.section || "other",
      ...ctx
    });
  }
  return entries;
}

function inferMatchMode(candidate, normalizedPhrase) {
  const normalizedTerm = normalizeText(candidate?.term);
  if (!normalizedTerm) return "lexical";
  if (normalizedTerm === normalizedPhrase) return "exact-span";
  if (normalizedTerm.includes(normalizedPhrase) || normalizedPhrase.includes(normalizedTerm)) {
    return "lexical-contains";
  }
  return "lexical-broad";
}

function summarizeCandidate(candidate, normalizedPhrase) {
  if (!candidate) return null;
  return {
    conceptId: candidate.conceptId,
    term: candidate.term,
    fsn: candidate.fsn || null,
    semanticTag: candidate.semanticTag || null,
    languageCode: candidate.languageCode || null,
    ancestorIds: Array.isArray(candidate.ancestorIds) ? candidate.ancestorIds.map(String) : [],
    active: candidate.active !== false,
    score: Number.isFinite(Number(candidate.score)) ? Number(candidate.score) : 0,
    highlights: Array.isArray(candidate.highlights) ? candidate.highlights : [],
    scoreDetails: candidate?.scoreDetails || null,
    matchedBy: inferMatchMode(candidate, normalizedPhrase),
    matchedText: candidate?.matchedText || candidate?.term || null,
    matchReason: candidate?.matchReason || null,
    matchTier: Number.isFinite(Number(candidate?.matchTier)) ? Number(candidate.matchTier) : null
  };
}

function analyzeGroundingCandidate(entry, candidate) {
  const normalizedPhrase = normalizeText(entry?.phrase);
  const normalizedTerm = normalizeText(candidate?.term);
  const normalizedMatchedText = normalizeText(candidate?.matchedText || candidate?.term);
  const normalizedSemanticTag = normalizeText(candidate?.semanticTag);
  const queryTokens = normalizedPhrase.split(/\s+/).filter(Boolean);
  const queryTokenSet = new Set(queryTokens);
  const candidateTokens = normalizedTerm.split(/\s+/).filter(Boolean);
  const informativeExtraTokens = candidateTokens.filter((token) => (
    !queryTokenSet.has(token) &&
    !STOPWORDS.has(token) &&
    token.length > 3 &&
    !NEUTRAL_CANDIDATE_EXTRA_TOKENS.has(token)
  ));
  const lateralityTokens = informativeExtraTokens.filter((token) => LATERALITY_TOKENS.has(token));
  const populationTokens = informativeExtraTokens.filter((token) => POPULATION_CONTEXT_TOKENS.has(token));
  const statusQualifierTokens = informativeExtraTokens.filter((token) => STATUS_QUALIFIER_TOKENS.has(token));
  const workflowLike = WORKFLOW_TERM_PATTERNS.some((pattern) => pattern.test(normalizedTerm));
  const relationInTerm = CANDIDATE_RELATION_PATTERNS.some((pattern) => pattern.test(normalizedTerm));
  const relationCuePresent = (Array.isArray(entry?.evidenceSignals) ? entry.evidenceSignals : []).some((signal) => signal?.cueType === "relation");
  const exactTermMatch = normalizedTerm === normalizedPhrase;
  const exactMatchedText = normalizedMatchedText === normalizedPhrase;
  const exactMatch = exactTermMatch || exactMatchedText;
  const matchTier = Number.isFinite(Number(candidate?.matchTier)) ? Number(candidate.matchTier) : 99;
  const contextualMismatch = workflowLike && entry?.contextType !== "plan";
  const lateralityMismatch = lateralityTokens.length > 0 && !lateralityTokens.every((token) => queryTokenSet.has(token));
  const populationMismatch = populationTokens.length > 0 && !populationTokens.every((token) => queryTokenSet.has(token));
  const overSpecific =
    entry?.tokenCount === 1 &&
    informativeExtraTokens.length >= 1 &&
    !exactTermMatch;

  let groundingScore = 0;
  groundingScore += Math.max(50 - matchTier * 8, -22);
  groundingScore += exactTermMatch ? 34 : exactMatchedText ? 16 : normalizedTerm.includes(normalizedPhrase) ? 8 : 0;
  groundingScore += candidate?.isPreferred ? 5 : 0;
  groundingScore += Math.min(Number(candidate?.termRank || 0), 60) / 10;
  groundingScore += Math.min(Number(candidate?.score || 0), 500) / 50;

  if (normalizedSemanticTag === "disorder" || normalizedSemanticTag === "finding") {
    groundingScore += 4;
  } else if (normalizedSemanticTag) {
    groundingScore -= 6;
  }

  groundingScore -= informativeExtraTokens.length * (
    exactTermMatch
      ? 0
      : exactMatchedText
        ? (entry?.tokenCount === 1 ? 14 : 6)
        : (entry?.tokenCount === 1 ? 12 : 4.5)
  );

  if (contextualMismatch) groundingScore -= 18;
  if (relationCuePresent && relationInTerm) groundingScore -= 16;
  else if (relationInTerm && !exactMatch) groundingScore -= 6;
  if (lateralityMismatch) groundingScore -= entry?.contextType === "negated" ? 14 : 9;
  if (populationMismatch) groundingScore -= 14;
  if (statusQualifierTokens.length > 0) groundingScore -= 18;
  if (entry?.tokenCount === 1 && informativeExtraTokens.length >= 1 && !exactTermMatch) groundingScore -= 14;
  if (entry?.contextType === "negated" && (normalizedSemanticTag === "disorder" || normalizedSemanticTag === "finding")) {
    groundingScore += 2;
  }

  return {
    groundingScore: Number(groundingScore.toFixed(4)),
    flags: {
      contextualMismatch,
      relationDuplicated: relationCuePresent && relationInTerm,
      lateralityMismatch,
      populationMismatch,
      statusQualifierMismatch: statusQualifierTokens.length > 0,
      overSpecific
    }
  };
}

function rerankGroundingMatches(entry, matches) {
  return [...(Array.isArray(matches) ? matches : [])]
    .map((candidate, index) => {
      const analysis = analyzeGroundingCandidate(entry, candidate);
      return {
        ...candidate,
        _groundingIndex: index,
        _groundingScore: analysis.groundingScore,
        _groundingFlags: analysis.flags
      };
    })
    .sort((left, right) => {
      const groundingDiff = Number(right?._groundingScore || 0) - Number(left?._groundingScore || 0);
      if (groundingDiff !== 0) return groundingDiff;

      const tierDiff = Number(left?.matchTier || 99) - Number(right?.matchTier || 99);
      if (tierDiff !== 0) return tierDiff;

      const preferredDiff = Number(right?.isPreferred ? 1 : 0) - Number(left?.isPreferred ? 1 : 0);
      if (preferredDiff !== 0) return preferredDiff;

      const rankDiff = Number(right?.termRank || 0) - Number(left?.termRank || 0);
      if (rankDiff !== 0) return rankDiff;

      const scoreDiff = Number(right?.score || 0) - Number(left?.score || 0);
      if (scoreDiff !== 0) return scoreDiff;

      return Number(left?._groundingIndex || 0) - Number(right?._groundingIndex || 0);
    });
}

function buildReviewOutcome(entry) {
  const matches = rerankGroundingMatches(entry, entry.matches);
  const topMatch = matches[0] || null;
  const topCandidate = summarizeCandidate(topMatch, entry.normalizedPhrase);
  const alternatives = matches.slice(1, 4).map((candidate) => summarizeCandidate(candidate, entry.normalizedPhrase)).filter(Boolean);
  const reasons = [];

  if (!topCandidate) {
    return {
      ...entry,
      status: entry.strategy === "mongodb-timeout" ? "timed-out" : "abstain",
      evidenceType: entry.strategy === "mongodb-timeout" ? "system" : "context",
      confidence: 0,
      confidencePct: 0,
      marginToNext: 0,
      decisionReasons: [
        entry.strategy === "mongodb-timeout"
          ? "query-timeout"
          : entry.strategy === "skipped-anchor"
            ? "low-value-anchor"
            : "no-candidate"
      ],
      topCandidate: null,
      alternatives
    };
  }

  const secondGroundingScore = Number(matches[1]?._groundingScore || 0);
  const topGroundingScore = Number(topMatch?._groundingScore || 0);
  const normalizedPhrase = normalizeText(entry.phrase);
  const normalizedTop = normalizeText(topCandidate.term);
  const normalizedMatchedText = normalizeText(topCandidate.matchedText);
  const matchTier = Number.isFinite(Number(topCandidate.matchTier)) ? Number(topCandidate.matchTier) : 99;
  const exactPreferredTermMatch = normalizedPhrase === normalizedTop;
  const exactSynonymMatch = Boolean(normalizedMatchedText) && normalizedMatchedText === normalizedPhrase;
  const groundingFlags = topMatch?._groundingFlags || {};
  const compoundDescendantMatch = [
    `due to ${normalizedPhrase}`,
    `associated with ${normalizedPhrase}`,
    `following ${normalizedPhrase}`,
    `secondary to ${normalizedPhrase}`,
    `with ${normalizedPhrase}`
  ].some((marker) => normalizedTop.includes(marker));
  const exactMatch = normalizedPhrase === normalizedTop || (normalizedMatchedText && normalizedMatchedText === normalizedPhrase);
  const containsMatch =
    exactMatch ||
    (normalizedMatchedText && (normalizedMatchedText.includes(normalizedPhrase) || normalizedPhrase.includes(normalizedMatchedText))) ||
    normalizedTop.includes(normalizedPhrase) ||
    normalizedPhrase.includes(normalizedTop);
  const marginToNext = Math.max(topGroundingScore - secondGroundingScore, 0);
  let confidence = 0.34;

  confidence += Math.min(topCandidate.score * 0.22, 0.24);
  confidence += Math.min(marginToNext / 25, 0.22);
  confidence += exactPreferredTermMatch ? 0.22 : exactSynonymMatch ? 0.12 : containsMatch ? 0.08 : 0;
  confidence += matchTier <= 2 ? 0.18 : matchTier <= 4 ? 0.1 : matchTier <= 6 ? 0.04 : -0.08;
  confidence -= entry.tokenCount === 1 && !exactMatch ? 0.08 : 0;
  confidence -= topCandidate.active ? 0 : 0.3;
  confidence -= groundingFlags.contextualMismatch ? 0.22 : 0;
  confidence -= groundingFlags.relationDuplicated ? 0.16 : 0;
  confidence -= groundingFlags.lateralityMismatch ? 0.12 : 0;
  confidence -= groundingFlags.populationMismatch ? 0.14 : 0;
  confidence -= groundingFlags.statusQualifierMismatch ? 0.16 : 0;
  confidence -= groundingFlags.overSpecific ? (entry.tokenCount === 1 ? 0.32 : 0.18) : 0;

  if (!topCandidate.active) reasons.push("inactive-candidate");
  if (entry.tokenCount === 1 && !exactMatch) reasons.push("short-generic-span");
  if (marginToNext < 0.05 && alternatives.length > 0) reasons.push("ambiguous-top-candidate");
  if (!exactMatch && !containsMatch) reasons.push("lexical-mismatch");
  if (matchTier >= 7) reasons.push("broad-lexical-match");
  if (groundingFlags.contextualMismatch) reasons.push("workflow-term-not-clinical-anchor");
  if (groundingFlags.lateralityMismatch) reasons.push("unattributed-laterality");
  if (groundingFlags.populationMismatch) reasons.push("population-mismatch");
  if (groundingFlags.statusQualifierMismatch) reasons.push("unattributed-clinical-qualifier");
  if (groundingFlags.overSpecific) reasons.push("over-specific-candidate");
  if (compoundDescendantMatch || groundingFlags.relationDuplicated) reasons.push("compound-descendant-match");

  confidence = clamp01(confidence);

  let status = "review";
  if (!topCandidate.active || confidence < 0.42) {
    status = "abstain";
  } else if (
    (exactMatch || matchTier <= 2) &&
    confidence >= 0.68 &&
    marginToNext >= 0.03 &&
    (entry.tokenCount > 1 || exactPreferredTermMatch) &&
    !compoundDescendantMatch &&
    !groundingFlags.contextualMismatch &&
    !groundingFlags.relationDuplicated &&
    !groundingFlags.lateralityMismatch &&
    !groundingFlags.populationMismatch &&
    !groundingFlags.statusQualifierMismatch &&
    !groundingFlags.overSpecific
  ) {
    status = "accepted";
  } else if (
    matchTier <= 4 &&
    confidence >= 0.64 &&
    marginToNext >= 0.05 &&
    entry.tokenCount >= 2 &&
    !compoundDescendantMatch &&
    !groundingFlags.contextualMismatch &&
    !groundingFlags.relationDuplicated &&
    !groundingFlags.lateralityMismatch &&
    !groundingFlags.populationMismatch &&
    !groundingFlags.statusQualifierMismatch
  ) {
    status = "accepted";
  }

  if (status === "accepted") reasons.push(exactMatch ? "exact-clinical-match" : "high-confidence-match");
  if (status === "review" && reasons.length === 0) reasons.push("manual-review-required");
  if (status === "abstain" && reasons.length === 0) reasons.push("low-confidence");

  return {
    ...entry,
    status,
    evidenceType: status === "accepted" ? "direct" : "inferred",
    confidence,
    confidencePct: Math.round(confidence * 100),
    marginToNext: Number(marginToNext.toFixed(4)),
    decisionReasons: reasons,
    topCandidate,
    alternatives
  };
}

function buildSectionId(section, index) {
  const slug = String(section?.slug || "").trim();
  return `sec-${slug || `section-${index + 1}`}`;
}

function buildSentenceId(entry, fallbackIndex = 0) {
  const sectionSlug = String(entry?.sectionSlug || entry?.section || "").trim() || "note";
  const sentenceStart = Number(entry?.sentenceStart ?? entry?.start ?? fallbackIndex);
  return `sent-${sectionSlug}-${Number.isFinite(sentenceStart) ? sentenceStart : fallbackIndex}`;
}

function buildMentionId(entry, index) {
  const start = Number(entry?.span?.start ?? entry?.start ?? index);
  const end = Number(entry?.span?.end ?? entry?.end ?? index);
  return `m-${index + 1}-${Number.isFinite(start) ? start : index}-${Number.isFinite(end) ? end : index}`;
}

function summarizeGraphCandidate(candidate) {
  if (!candidate) return null;
  return {
    conceptId: candidate.conceptId || null,
    term: candidate.term || null,
    semanticTag: candidate.semanticTag || null,
    matchedBy: candidate.matchedBy || null,
    matchedText: candidate.matchedText || null,
    matchReason: candidate.matchReason || null,
    score: Number.isFinite(Number(candidate.score)) ? Number(candidate.score) : null
  };
}

function buildEvidenceGraph({
  documentId,
  languageCode,
  releaseId,
  sections,
  results
}) {
  const sectionNodes = (Array.isArray(sections) ? sections : []).map((section, index) => ({
    sectionId: buildSectionId(section, index),
    title: section.title,
    slug: section.slug,
    start: section.start,
    end: section.end
  }));
  const sectionIdBySlug = new Map(sectionNodes.map((section) => [String(section.slug || ""), section.sectionId]));
  const sectionIdByTitle = new Map(sectionNodes.map((section) => [String(section.title || ""), section.sectionId]));
  const sentenceNodes = new Map();
  const spanNodes = new Map();
  const cueNodes = new Map();
  const mentions = [];
  const mentionsBySentence = new Map();

  for (const [index, entry] of (Array.isArray(results) ? results : []).entries()) {
    const mentionId = buildMentionId(entry, index);
    const sentenceId = buildSentenceId(entry, index);
    const sectionId =
      sectionIdBySlug.get(String(entry?.sectionSlug || "")) ||
      sectionIdByTitle.get(String(entry?.section || "")) ||
      "sec-note";
    const spanStart = Number(entry?.span?.start ?? entry?.start ?? null);
    const spanEnd = Number(entry?.span?.end ?? entry?.end ?? null);
    const anchorText = String(entry?.span?.text || entry?.phrase || "").trim();
    const anchorSpan = {
      spanId: `sp-anchor-${mentionId}`,
      start: Number.isFinite(spanStart) ? spanStart : null,
      end: Number.isFinite(spanEnd) ? spanEnd : null,
      text: anchorText,
      normalizedText: entry?.normalizedPhrase || normalizeText(anchorText),
      spanRole: entry?.anchorRole || "clinical-term",
      sentenceId,
      sectionId
    };
    const mention = {
      mentionId,
      spanId: anchorSpan.spanId,
      anchorSpan,
      text: anchorText,
      sentenceId,
      sectionId,
      sectionTitle: entry?.section || "Note",
      sentenceText: entry?.sentence || anchorText,
      candidateConcepts: [entry?.topCandidate, ...(Array.isArray(entry?.alternatives) ? entry.alternatives : [])]
        .map(summarizeGraphCandidate)
        .filter(Boolean),
      appliedCueIds: [],
      relationIds: [],
      derivedAssertion: entry?.assertion || "present",
      derivedExperiencer: entry?.experiencer || "patient",
      derivedContextType: entry?.contextType || "current",
      review: {
        status: entry?.status || "review",
        reasons: Array.isArray(entry?.decisionReasons) ? entry.decisionReasons : [],
        confidencePct: Number.isFinite(Number(entry?.confidencePct)) ? Number(entry.confidencePct) : 0,
        evidenceType: entry?.evidenceType || "inferred"
      },
      groundedNodeId: `gn-${mentionId}`,
      groundedConcept: summarizeGraphCandidate(entry?.topCandidate)
    };

    spanNodes.set(anchorSpan.spanId, anchorSpan);
    mentions.push(mention);

    if (!sentenceNodes.has(sentenceId)) {
      sentenceNodes.set(sentenceId, {
        sentenceId,
        sectionId,
        sectionTitle: entry?.section || "Note",
        text: entry?.sentence || anchorText,
        start: Number.isFinite(Number(entry?.sentenceStart)) ? Number(entry.sentenceStart) : anchorSpan.start,
        end: Number.isFinite(Number(entry?.sentenceEnd)) ? Number(entry.sentenceEnd) : anchorSpan.end
      });
    }

    if (!mentionsBySentence.has(sentenceId)) {
      mentionsBySentence.set(sentenceId, []);
    }
    mentionsBySentence.get(sentenceId).push(mention);

    for (const signal of Array.isArray(entry?.evidenceSignals) ? entry.evidenceSignals : []) {
      const cueStart = Number(signal?.start);
      const cueEnd = Number(signal?.end);
      const cueKey = [
        sentenceId,
        signal?.cueType || "cue",
        signal?.value || "",
        signal?.source || "",
        Number.isFinite(cueStart) ? cueStart : "na",
        Number.isFinite(cueEnd) ? cueEnd : "na",
        String(signal?.text || "").trim()
      ].join("|");

      if (!cueNodes.has(cueKey)) {
        const cueId = `cue-${cueNodes.size + 1}`;
        const cueSpanId = `sp-cue-${cueId}`;
        const cueNode = {
          cueId,
          cueType: signal?.cueType || "cue",
          value: signal?.value || signal?.cueType || "cue",
          text: signal?.text || null,
          source: signal?.source || "sentence",
          spanId: cueSpanId,
          span: {
            spanId: cueSpanId,
            start: Number.isFinite(cueStart) ? cueStart : null,
            end: Number.isFinite(cueEnd) ? cueEnd : null,
            text: signal?.text || null,
            spanRole: `${signal?.cueType || "cue"}-cue`,
            sentenceId,
            sectionId
          },
          sentenceId,
          sectionId,
          scope: {
            sentenceId,
            targetMentionIds: []
          }
        };
        cueNodes.set(cueKey, cueNode);
        spanNodes.set(cueSpanId, cueNode.span);
      }

      const cueNode = cueNodes.get(cueKey);
      cueNode.scope.targetMentionIds = Array.from(new Set([
        ...cueNode.scope.targetMentionIds,
        mentionId
      ]));
      mention.appliedCueIds = Array.from(new Set([
        ...mention.appliedCueIds,
        cueNode.cueId
      ]));
    }
  }

  const relations = [];
  const seenRelations = new Set();
  const cueList = Array.from(cueNodes.values());

  for (const cue of cueList.filter((item) => item.cueType === "relation")) {
    const sentenceMentions = (mentionsBySentence.get(cue.sentenceId) || [])
      .slice()
      .sort((left, right) => {
        const startDiff = Number(left?.anchorSpan?.start || 0) - Number(right?.anchorSpan?.start || 0);
        if (startDiff !== 0) return startDiff;
        return Number(left?.anchorSpan?.end || 0) - Number(right?.anchorSpan?.end || 0);
      });

    if (sentenceMentions.length < 2) continue;

    const cueStart = Number(cue?.span?.start);
    const cueEnd = Number(cue?.span?.end);
    const leftMention = Number.isFinite(cueStart)
      ? sentenceMentions.filter((mention) => Number(mention?.anchorSpan?.end) <= cueStart).slice(-1)[0] || null
      : null;
    const rightMention = Number.isFinite(cueEnd)
      ? sentenceMentions.find((mention) => Number(mention?.anchorSpan?.start) >= cueEnd) || null
      : null;

    const sourceMention = leftMention || sentenceMentions[0] || null;
    const targetMention = rightMention || sentenceMentions.find((mention) => mention.mentionId !== sourceMention?.mentionId) || null;

    if (!sourceMention || !targetMention || sourceMention.mentionId === targetMention.mentionId) {
      continue;
    }

    const relationKey = [
      cue.cueId,
      sourceMention.mentionId,
      targetMention.mentionId,
      cue.value
    ].join("|");
    if (seenRelations.has(relationKey)) continue;
    seenRelations.add(relationKey);

    const relationId = `rel-${relations.length + 1}`;
    relations.push({
      relationId,
      sourceMentionId: sourceMention.mentionId,
      targetMentionId: targetMention.mentionId,
      relationType: cue.value || "associated-with",
      cueId: cue.cueId,
      cueSpanId: cue.spanId,
      text: cue.text || null,
      sentenceId: cue.sentenceId,
      sectionId: cue.sectionId,
      confidence: leftMention && rightMention ? 0.88 : 0.72
    });

    sourceMention.relationIds = Array.from(new Set([...sourceMention.relationIds, relationId]));
    targetMention.relationIds = Array.from(new Set([...targetMention.relationIds, relationId]));
    cue.scope.targetMentionIds = Array.from(new Set([
      ...cue.scope.targetMentionIds,
      sourceMention.mentionId,
      targetMention.mentionId
    ]));
  }

  const groundedNodes = mentions.map((mention) => ({
    nodeId: mention.groundedNodeId,
    mentionId: mention.mentionId,
    conceptId: mention.groundedConcept?.conceptId || null,
    term: mention.groundedConcept?.term || null,
    semanticTag: mention.groundedConcept?.semanticTag || null,
    assertion: mention.derivedAssertion,
    experiencer: mention.derivedExperiencer,
    contextType: mention.derivedContextType,
    evidence: {
      anchorSpanId: mention.spanId,
      cueIds: mention.appliedCueIds,
      relationIds: mention.relationIds,
      sentenceId: mention.sentenceId,
      sectionId: mention.sectionId
    },
    review: mention.review
  }));

  return {
    document: {
      documentId,
      languageCode,
      releaseId
    },
    sections: sectionNodes,
    sentences: Array.from(sentenceNodes.values()),
    spans: Array.from(spanNodes.values()),
    cueObjects: cueList,
    mentions,
    relations,
    groundedNodes
  };
}

function shouldGroundPhraseForTarget(phraseEntry, targetContext) {
  const normalizedTarget = String(targetContext || "").trim().toLowerCase();
  const contextType = String(phraseEntry?.contextType || "").trim().toLowerCase();

  // Only prune plan/family mentions when the caller asked for a specific target
  // context. In the default flow we ground everything (the output lenses filter
  // by assertion/subject), so the Family-history and Medications lenses work.
  if (normalizedTarget) {
    if (contextType === "plan" && normalizedTarget !== "procedure.code") return false;
    if (contextType === "family-history") return false;
  }

  return true;
}

function buildFingerprint(input) {
  return createHash("sha256")
    .update(JSON.stringify(input))
    .digest("hex");
}

function getCachedPayload(fingerprint) {
  const cached = RUN_CACHE.get(fingerprint);
  if (!cached) return null;
  if (cached.expiresAt <= Date.now()) {
    RUN_CACHE.delete(fingerprint);
    return null;
  }
  return cached.payload;
}

function storeCachedPayload(fingerprint, payload) {
  RUN_CACHE.set(fingerprint, {
    expiresAt: Date.now() + CACHE_TTL_MS,
    payload
  });
}

async function mapWithConcurrency(items, concurrency, iteratee) {
  const values = Array.isArray(items) ? items : [];
  const results = new Array(values.length);
  const limit = Math.max(1, Math.min(Number(concurrency) || 1, values.length || 1));
  let nextIndex = 0;

  async function worker() {
    while (nextIndex < values.length) {
      const currentIndex = nextIndex;
      nextIndex += 1;
      results[currentIndex] = await iteratee(values[currentIndex], currentIndex);
    }
  }

  await Promise.all(Array.from({ length: limit }, () => worker()));
  return results;
}

function shouldSkipPhraseLookup(phraseEntry) {
  return Number(phraseEntry?.candidateScore || 0) < 4;
}

function shouldSkipSearchFallback(phraseEntry) {
  const tokens = normalizeText(phraseEntry?.phrase).split(/\s+/).filter(Boolean);
  if (tokens.length === 0) return true;
  if (tokens.length === 1 && tokens[0].length < 7) return true;
  return Number(phraseEntry?.candidateScore || 0) < 12;
}

function normalizeDeveloperCandidate(candidate) {
  if (!candidate) return null;
  return {
    conceptId: candidate.conceptId,
    term: candidate.term,
    semanticTag: candidate.semanticTag,
    score: candidate.score,
    matchedBy: candidate.matchedBy,
    matchedText: candidate.matchedText || null,
    matchReason: candidate.matchReason || null,
    matchTier: Number.isFinite(Number(candidate.matchTier)) ? Number(candidate.matchTier) : null,
    highlights: candidate.highlights,
    scoreDetails: candidate.scoreDetails
  };
}

// Map a hybrid-search result into the candidate shape the grounding scorer
// expects. Vector-only candidates carry no lexical tier, so synthesize one from
// the Voyage rerank score — a strong semantic match behaves like a high tier, so
// analyzeGroundingCandidate scores it fairly against exact lexical hits while
// its over-specific/laterality/negation penalties still apply.
function synthTierFromRerank(rerankScore) {
  if (!Number.isFinite(rerankScore)) return 8;
  if (rerankScore >= 0.6) return 2;
  if (rerankScore >= 0.45) return 4;
  if (rerankScore >= 0.3) return 6;
  return 8;
}

function normalizeHybridMatch(r) {
  const fromLexical = Array.isArray(r.foundBy) && r.foundBy.includes("lexical");
  const rr = typeof r.rerankScore === "number" ? r.rerankScore : null;
  const matchTier = fromLexical && Number.isFinite(Number(r.matchTier))
    ? Number(r.matchTier)
    : synthTierFromRerank(rr);
  return {
    conceptId: r.conceptId,
    term: r.term,
    displayTerm: r.displayTerm || r.term,
    preferredTerm: r.preferredTerm,
    fsn: r.fsn,
    semanticTag: r.semanticTag,
    languageCode: r.languageCode,
    matchedText: r.matchedText || r.term,
    matchReason: r.matchReason,
    matchTier,
    isPreferred: Boolean(r.isPreferred),
    termRank: Number(r.termRank || 0),
    active: r.active !== false,
    score: rr != null ? rr * 100 : (typeof r.vectorScore === "number" ? r.vectorScore * 100 : Number(r.rrfScore || 0) * 1000),
    rerankScore: rr,
    vectorScore: typeof r.vectorScore === "number" ? r.vectorScore : null,
    foundBy: r.foundBy
  };
}

function mergeCandidatesByConcept(...lists) {
  const seen = new Set();
  const merged = [];
  for (const list of lists) {
    for (const item of Array.isArray(list) ? list : []) {
      const id = String(item?.conceptId || "");
      if (!id || seen.has(id)) continue;
      seen.add(id);
      merged.push(item);
    }
  }
  return merged;
}

async function resolvePhrase(
  collection,
  {
    phraseEntry,
    textIndex,
    languageCode,
    releaseId,
    areaConceptId,
    conceptIdScope,
    scopeTruncated,
    searchTimeoutMs,
    perPhraseLimit,
    includeScoreDetails,
    hybridOverride
  }
) {
  if (shouldSkipPhraseLookup(phraseEntry)) {
    return {
      ...phraseEntry,
      span: {
        start: phraseEntry.start,
        end: phraseEntry.end,
        text: phraseEntry.phrase
      },
      strategy: "skipped-anchor",
      matches: []
    };
  }

  const exactPipeline = buildExactPhraseLookupPipeline({
    phrase: phraseEntry.phrase,
    indexName: textIndex,
    languageCode,
    releaseId,
    limit: perPhraseLimit
  });
  const searchPipeline = buildNavigatorSearchPipeline({
    query: phraseEntry.phrase,
    limit: Math.min(Math.max(perPhraseLimit * 3, perPhraseLimit), 16),
    indexName: textIndex,
    languageCode,
    releaseId,
    areaConceptId,
    conceptIdScope,
    includeScoreDetails
  });

  const span = {
    start: phraseEntry.start,
    end: phraseEntry.end,
    text: phraseEntry.phrase
  };
  const hybridCfg = getHybridSearchConfig();
  const useHybrid = typeof hybridOverride === "boolean" ? hybridOverride : hybridCfg.groundingEnabled;

  try {
    let exactResults = [];
    try {
      const exactRawResults = await collection.aggregate(exactPipeline, { maxTimeMS: Math.min(searchTimeoutMs, 900) }).toArray();
      exactResults = rerankNavigatorResults({
        query: phraseEntry.phrase,
        results: scopeTruncated ? exactRawResults : applyScopePostFilter(exactRawResults, conceptIdScope),
        limit: perPhraseLimit
      });

      // Legacy path: exact lexical hit wins outright. With hybrid grounding on,
      // we instead fold exact hits into the fused pool below so a strong
      // semantic candidate can compete with a weak exact-token match.
      if (!useHybrid && exactResults.length > 0) {
        return { ...phraseEntry, span, strategy: "exact-lookup", matches: exactResults };
      }
    } catch (error) {
      if (!isQueryTimeoutError(error)) {
        throw error;
      }
    }

    if (useHybrid && !shouldSkipSearchFallback(phraseEntry)) {
      try {
        const hybrid = await runHybridSearch({
          collection,
          query: phraseEntry.phrase,
          languageCode,
          effectiveReleaseId: releaseId,
          areaConceptId,
          conceptIdScope,
          textIndex,
          searchConfig: getSearchConfig(),
          hybridConfig: {
            ...hybridCfg,
            candidatePool: hybridCfg.groundingCandidatePool,
            rerankPool: hybridCfg.groundingCandidatePool
          },
          limit: Math.max(perPhraseLimit * 3, 8)
        });
        const hybridMatches = (hybrid.results || []).map(normalizeHybridMatch);
        // Exact lexical hits first (most precise), then fused/reranked semantic
        // candidates; the grounding scorer re-ranks the merged pool and applies
        // its negation/laterality/over-specific safeguards.
        const merged = mergeCandidatesByConcept(exactResults, hybridMatches);
        if (merged.length > 0) {
          return {
            ...phraseEntry,
            span,
            strategy: hybrid.reranked ? "hybrid-rerank" : "hybrid-fusion",
            matches: merged
          };
        }
      } catch (error) {
        if (!isQueryTimeoutError(error)) {
          // Non-timeout hybrid failure: fall through to lexical behavior below.
        }
      }
    }

    // Hybrid disabled/skipped/empty: fall back to exact hits if any.
    if (exactResults.length > 0) {
      return { ...phraseEntry, span, strategy: "exact-lookup", matches: exactResults };
    }

    if (shouldSkipSearchFallback(phraseEntry)) {
      return {
        ...phraseEntry,
        span: {
          start: phraseEntry.start,
          end: phraseEntry.end,
          text: phraseEntry.phrase
        },
        strategy: "skipped-anchor",
        matches: []
      };
    }

    const rawResults = await collection.aggregate(searchPipeline, { maxTimeMS: searchTimeoutMs }).toArray();
    const results = rerankNavigatorResults({
      query: phraseEntry.phrase,
      results: rawResults,
      limit: perPhraseLimit
    });
    return {
      ...phraseEntry,
      span: {
        start: phraseEntry.start,
        end: phraseEntry.end,
        text: phraseEntry.phrase
      },
      strategy: "mongodb-search",
      matches: results
    };
  } catch (error) {
    if (isQueryTimeoutError(error)) {
      return {
        ...phraseEntry,
        span: {
          start: phraseEntry.start,
          end: phraseEntry.end,
          text: phraseEntry.phrase
        },
        strategy: "mongodb-timeout",
        matches: [],
        error: error instanceof Error ? error.message : String(error)
      };
    }

    throw error;
  }
}

export async function POST(request) {
  const startedAt = process.hrtime.bigint();

  try {
    const body = await parseJson(request);
    const text = typeof body.text === "string" ? body.text.trim() : "";
    const requestedLanguageCode = typeof body.languageCode === "string" ? body.languageCode : "es";
    const areaConceptId = typeof body.areaConceptId === "string" ? body.areaConceptId.trim() : "";
    const ecl = typeof body.ecl === "string" ? body.ecl.trim() : "";
    const releaseIdInput = typeof body.releaseId === "string" ? body.releaseId.trim() : "";
    const targetContext = typeof body.targetContext === "string" ? body.targetContext.trim() : "";
    const retrievalProfile = normalizeRetrievalProfile(body.retrievalProfile);
    // Optional per-request grounding retrieval mode (benchmark retrieval axis):
    // "hybrid" forces hybrid fusion, "lexical" forces deterministic lexical,
    // anything else keeps the configured default.
    const searchModeOverride = body.searchMode === "hybrid" ? true : body.searchMode === "lexical" ? false : undefined;
    const forceScopeRefresh = body.forceScopeRefresh === true;
    const developerMode = body.developerMode === true;
    const maxPhrases = Math.min(Math.max(Number(body.maxPhrases) || 20, 1), 40);
    const requestedTimeoutMs = Math.min(Math.max(Number(body.searchTimeoutMs) || 1500, 250), 15000);

    if (!text) {
      return fail("text is required", 400);
    }

    const { projectionCollection } = getMongoConfig();
    const { textIndex } = getSearchConfig();
    const { releaseId: defaultReleaseId } = getSemanticsConfig();

    const collection = await getCollection(projectionCollection);

    const searchReadiness = await ensureSearchIndexReady({
      collection,
      indexName: textIndex
    });
    if (!searchReadiness.ok) {
      return fail(searchReadiness.message, searchReadiness.status, {
        code: searchReadiness.code,
        index: searchReadiness.details,
        latencyMs: elapsedMs(startedAt)
      });
    }

    const { conceptIdScope, scope } = await resolveSemanticScope({
      areaConceptId,
      ecl,
      releaseIdInput,
      forceRefresh: forceScopeRefresh
    });

    const effectiveReleaseId = scope?.releaseId || releaseIdInput || defaultReleaseId || "latest";
    const profileSettings = PROFILE_SETTINGS[retrievalProfile] || PROFILE_SETTINGS.lexical_exact;
    const searchTimeoutMs = Math.min(requestedTimeoutMs, profileSettings.timeoutCapMs);
    const language = detectLanguage(text, requestedLanguageCode);
    const languageCode = language.detectedLanguageCode;

    const requestFingerprint = buildFingerprint({
      noteHash: buildFingerprint({ text }),
      languageCode,
      requestedLanguageCode,
      areaConceptId,
      ecl,
      releaseId: effectiveReleaseId,
      targetContext,
      retrievalProfile,
      maxPhrases,
      searchTimeoutMs,
      developerMode,
      // The extraction model changes the output, so it must key the cache —
      // otherwise a per-model benchmark returns the first model's cached run.
      extractor: body.extractor === "deterministic" ? "deterministic" : "llm",
      model: typeof body.model === "string" ? body.model.trim() : ""
    });

    // Benchmark passes noCache so every cell is a real, timed call (a cache hit
    // would report ~ms latency and mask true model speed).
    const bypassCache = body.noCache === true;
    const cached = bypassCache ? null : getCachedPayload(requestFingerprint);
    if (cached) {
      return ok({
        ...cached,
        cache: {
          fingerprint: requestFingerprint,
          hit: true
        }
      });
    }

    // ── Stage 1: extraction. Default to the LLM (it reads negation, assertion,
    // patient-vs-family, typos far better than the deterministic layer). It
    // returns TEXT + CONTEXT only — MongoDB still retrieves every code below.
    // Falls back to deterministic extraction when the gateway is off or fails.
    const llmCfg = getLlmConfig();
    const wantLlmExtract = llmCfg.enabled && body.extractor !== "deterministic";
    let sections;
    let candidatePhrases;
    let extractor = "deterministic";
    let extractorModel = null;
    let extractorError = null;
    let extractorUsage = null;
    let extractorPrompt = null;
    let extractorRaw = null;
    const includeLlmIO = body.includeLlmIO === true;

    const modelOverride = typeof body.model === "string" ? body.model.trim() : "";
    // The normalized mentions (evidence graph) — returned by extractOnly so the
    // client can hand them back for the separate retrieval step.
    let extractedMentions = null;

    if (Array.isArray(body.groundMentions)) {
      // Retrieval-only: ground previously-extracted mentions (no LLM call).
      sections = buildSectionRanges(text);
      candidatePhrases = buildLlmPhraseEntries(text, body.groundMentions, maxPhrases)
        .filter((entry) => shouldGroundPhraseForTarget(entry, targetContext));
      extractor = "llm";
    } else {
      if (wantLlmExtract) {
        const ext = await extractMentionsWithLlm({ text, languageCode, model: modelOverride });
        if (ext.ok) {
          extractor = "llm";
          extractorModel = ext.model;
          extractorUsage = ext.usage || null;
          extractedMentions = ext.mentions;
          if (includeLlmIO) { extractorPrompt = ext.prompt || null; extractorRaw = ext.raw || null; }
          sections = buildSectionRanges(text);
          candidatePhrases = buildLlmPhraseEntries(text, ext.mentions, maxPhrases)
            .filter((entry) => shouldGroundPhraseForTarget(entry, targetContext));
        } else {
          extractorError = ext.error || "LLM extraction failed";
        }
      }
      if (extractor !== "llm") {
        const extracted = extractCandidatePhrases(text, maxPhrases);
        sections = extracted.sections;
        candidatePhrases = extracted.phrases.filter((entry) => shouldGroundPhraseForTarget(entry, targetContext));
        extractedMentions = candidatePhrases.map((pe) => ({
          phrase: pe.phrase,
          verbatim: pe.verbatim || pe.phrase,
          assertion: pe.assertion === "absent" ? "absent" : pe.assertion === "suspected" ? "suspected" : pe.assertion === "planned" ? "planned" : "present",
          subject: pe.experiencer === "family" ? "family" : "patient",
          temporality: pe.assertion === "historical" ? "historical" : "current",
          section: pe.llmSection || pe.sectionSlug || "other"
        }));
      }
    }

    // extractOnly: return the evidence graph without grounding (fast Stage 1).
    if (body.extractOnly === true) {
      const ungrounded = candidatePhrases.map((pe) => ({ ...pe, span: { start: pe.start, end: pe.end, text: pe.phrase }, strategy: "extract-only", matches: [] }));
      const reviewed = ungrounded.map(buildReviewOutcome).map((entry, index) => ({ ...entry, mentionId: buildMentionId(entry, index) }));
      const evidenceGraph = buildEvidenceGraph({ documentId: requestFingerprint, languageCode, releaseId: effectiveReleaseId, sections, results: reviewed });
      const gmap = new Map(evidenceGraph.mentions.map((m) => [m.mentionId, m]));
      const rwg = reviewed.map((e) => { const m = gmap.get(e.mentionId); return { ...e, cueIds: m?.appliedCueIds || [], relationIds: m?.relationIds || [], groundedNodeId: m?.groundedNodeId || null }; });
      return ok({ ok: true, pattern: "nlp-map", extractOnly: true, retrieved: false, extractor, extractorModel, extractorError, extractorUsage, extractorPrompt, extractorRaw, languageCode, results: rwg, evidenceGraph, mentions: extractedMentions || [], latencyMs: elapsedMs(startedAt) });
    }
    const mapped = await mapWithConcurrency(
      candidatePhrases,
      MAX_GROUNDER_CONCURRENCY,
      (phraseEntry) =>
        resolvePhrase(collection, {
          phraseEntry,
          textIndex,
          languageCode,
          releaseId: effectiveReleaseId,
          areaConceptId,
          conceptIdScope,
          scopeTruncated: scope?.truncated === true,
          searchTimeoutMs,
          perPhraseLimit: profileSettings.perPhraseLimit,
          includeScoreDetails: developerMode,
          hybridOverride: searchModeOverride
        })
    );

    const timedOutPhrases = mapped.filter((item) => item.strategy === "mongodb-timeout").length;
    const reviewedResults = mapped.map(buildReviewOutcome);
    const results = reviewedResults.map((entry, index) => ({
      ...entry,
      mentionId: buildMentionId(entry, index)
    }));

    // Retrieval-only run: also return the MQL pipeline used per mention, so the
    // UI can show exactly what MongoDB queries the grounding ran.
    const mqlByMention = Array.isArray(body.groundMentions)
      ? results.map((r, i) => {
        const pe = candidatePhrases[i];
        return {
          mentionId: r.mentionId,
          phrase: pe?.phrase || "",
          pipeline: buildNavigatorSearchPipeline({ query: pe?.phrase || "", limit: profileSettings.perPhraseLimit, indexName: textIndex, languageCode, releaseId: effectiveReleaseId, areaConceptId, conceptIdScope })
        };
      })
      : null;

    const evidenceGraph = buildEvidenceGraph({
      documentId: requestFingerprint,
      languageCode,
      releaseId: effectiveReleaseId,
      sections,
      results
    });
    const mentionGraphLookup = new Map(evidenceGraph.mentions.map((mention) => [mention.mentionId, mention]));
    const resultsWithGraph = results.map((entry) => {
      const mention = mentionGraphLookup.get(entry.mentionId);
      return {
        ...entry,
        cueIds: Array.isArray(mention?.appliedCueIds) ? mention.appliedCueIds : [],
        relationIds: Array.isArray(mention?.relationIds) ? mention.relationIds : [],
        groundedNodeId: mention?.groundedNodeId || null
      };
    });
    const principalDiagnosisCandidates = computePrimaryDiagnosisCandidates(resultsWithGraph, {
      targetContext,
      limit: 3
    });
    const principalDiagnosis = principalDiagnosisCandidates[0] || null;
    const acceptedCount = resultsWithGraph.filter((item) => item.status === "accepted").length;
    const reviewCount = resultsWithGraph.filter((item) => item.status === "review").length;
    const abstainCount = resultsWithGraph.filter((item) => item.status === "abstain").length;
    const latencyMs = elapsedMs(startedAt);

    const payload = {
      ok: true,
      pattern: "clinical-nlp-mapping",
      extractor,
      extractorModel,
      extractorError,
      extractorUsage,
      extractorPrompt,
      extractorRaw,
      retrievalProfile,
      releaseId: effectiveReleaseId,
      targetContext: targetContext || null,
      scope,
      language,
      sections: sections.map((section) => ({
        title: section.title,
        slug: section.slug,
        start: section.start,
        end: section.end
      })),
      stats: {
        candidatePhrases: candidatePhrases.length,
        mappedPhrases: results.filter((entry) => entry.topCandidate).length,
        acceptedCount,
        reviewCount,
        abstainCount,
        timedOutPhrases,
        principalDiagnosisCandidates: principalDiagnosisCandidates.length,
        scopeCount: conceptIdScope.length,
        perPhraseLimit: profileSettings.perPhraseLimit,
        searchTimeoutMs,
        latencyMs
      },
      results: resultsWithGraph,
      evidenceGraph,
      principalDiagnosis,
      principalDiagnosisCandidates,
      retrieved: true,
      mql: mqlByMention,
      degraded: timedOutPhrases > 0,
      cache: {
        fingerprint: requestFingerprint,
        hit: false
      },
      developer: developerMode ? {
        request: {
          languageCode,
          requestedLanguageCode,
          areaConceptId: areaConceptId || null,
          ecl: ecl || null,
          releaseId: effectiveReleaseId,
          targetContext: targetContext || null,
          retrievalProfile,
          maxPhrases,
          perPhraseLimit: profileSettings.perPhraseLimit,
          searchTimeoutMs
        },
        sections: sections.map((section) => ({
          title: section.title,
          start: section.start,
          contentStart: section.contentStart,
          end: section.end
        })),
        extractedWindows: candidatePhrases.map((entry) => ({
          phrase: entry.phrase,
          start: entry.start,
          end: entry.end,
          tokenCount: entry.tokenCount,
          candidateScore: entry.candidateScore,
          section: entry.section,
          sentence: entry.sentence,
          assertion: entry.assertion,
          contextType: entry.contextType,
          experiencer: entry.experiencer,
          evidenceSignals: entry.evidenceSignals
        })),
        diagnostics: resultsWithGraph.map((entry) => ({
          phrase: entry.phrase,
          span: entry.span,
          section: entry.section,
          assertion: entry.assertion,
          contextType: entry.contextType,
          evidenceSignals: entry.evidenceSignals,
          mentionId: entry.mentionId,
          cueIds: entry.cueIds,
          relationIds: entry.relationIds,
          strategy: entry.strategy,
          reasons: entry.decisionReasons,
          topCandidate: normalizeDeveloperCandidate(entry.topCandidate),
          alternatives: entry.alternatives.map(normalizeDeveloperCandidate),
          error: entry.error || null
        }))
      } : null
    };

    if (!bypassCache) storeCachedPayload(requestFingerprint, payload);

    await emitUsageEventSafe({
      eventType: "mapping.nlp.executed",
      source: "api/nlp-map",
      releaseId: effectiveReleaseId,
      languageCode,
      query: text,
      resultCount: acceptedCount + reviewCount,
      durationMs: latencyMs,
      conceptIds: results
        .flatMap((entry) => (entry.topCandidate ? [entry.topCandidate.conceptId] : []))
        .slice(0, 25),
      metadata: {
        areaConceptId: areaConceptId || null,
        ecl: ecl || null,
        requestedLanguageCode,
        detectedLanguageCode: language.detectedLanguageCode,
        targetContext: targetContext || null,
        retrievalProfile,
        scopeMode: scope?.mode || "none",
        scopeCount: Array.isArray(conceptIdScope) ? conceptIdScope.length : 0,
        candidatePhrases: candidatePhrases.length,
        mappedPhrases: results.filter((entry) => entry.topCandidate).length,
        acceptedCount,
        reviewCount,
        abstainCount,
        timedOutPhrases,
        searchTimeoutMs,
        degraded: timedOutPhrases > 0
      }
    });

    return ok(payload);
  } catch (error) {
    return fail("NLP mapping failed", 500, {
      ...buildMongoErrorPayload(error),
      latencyMs: elapsedMs(startedAt)
    });
  }
}
