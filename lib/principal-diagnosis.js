// Principal-diagnosis + comorbidity proposal over the grounded mentions of a note.
//
// Each patient mention is scored on WHERE it appears (section), HOW it is
// asserted, how strong its grounding evidence is, and WHAT kind of concept it
// resolved to (semantic tag). Mentions are then grouped by concept, and concepts
// on the same SNOMED branch are merged: when one coded concept is an ancestor of
// another (e.g. "heart failure" and "decompensated chronic heart failure"), the
// parent's evidence folds into the more specific descendant instead of the two
// competing. The ancestor ids already travel on every candidate, so this needs
// no extra queries.

function normalize(value) {
  return String(value || "").trim();
}

function toNumber(value, fallback = 0) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : fallback;
}

// The LLM extractor labels sections with a fixed enum, while the deterministic
// path uses the note's own headers. Both are accepted here. Family history is
// checked before general history so "Family history" isn't read as "History".
export function sectionWeight(section) {
  const label = normalize(section).toLowerCase().replace(/_/g, " ");
  if (!label) return 0;
  if (/(family|familiar)/.test(label)) return -18;
  if (/(assessment|diagnos|impression|problem list|problemas|evaluaci|valoraci|juicio cl|\bactive\b)/.test(label)) return 22;
  if (/(chief complaint|reason for|motivo|hpi|present illness|enfermedad actual|consulta)/.test(label)) return 12;
  if (/(exam|explor|findings|resultados|investigation|pruebas)/.test(label)) return 6;
  if (/(plan|follow|seguimiento|treatment|tratamiento|medication|procedure|procedimiento)/.test(label)) return -12;
  if (/(history|antecedentes)/.test(label)) return -8;
  return 2;
}

function assertionWeight(assertion) {
  const value = normalize(assertion).toLowerCase();
  if (value === "present") return 20;
  if (value === "suspected") return 8;
  if (value === "historical") return -10;
  if (value === "planned") return -18;
  if (value === "absent") return -30;
  if (value === "family-history") return -36;
  return 0;
}

// Grounding status restates match quality, which confidence already carries, so
// between usable codes (accepted vs review) it is only a tiebreaker. It still
// sinks codes the grounder could not stand behind (abstain / rejected).
function evidenceWeight(evidenceType, decision) {
  const evidence = normalize(evidenceType).toLowerCase();
  const resolvedDecision = normalize(decision).toLowerCase();
  let score = 0;

  if (resolvedDecision === "accepted") score += 6;
  if (resolvedDecision === "accepted-inferred") score += 5;
  if (resolvedDecision === "review") score += 3;
  if (resolvedDecision === "abstain" || resolvedDecision === "timed-out") score -= 12;
  if (resolvedDecision === "no-code" || resolvedDecision === "rejected") score -= 22;

  if (evidence === "direct") score += 3;
  if (evidence === "inferred") score += 2;
  if (evidence === "context") score -= 10;
  if (evidence === "system") score -= 14;

  return score;
}

// Semantic tags are parsed from the FSN in the note's language, so a Spanish
// release returns "trastorno" where an English one returns "disorder".
const LOCALIZED_TAGS = [
  [/^trastorno$/, "disorder"],
  [/^hallazgo$/, "finding"],
  [/^evento$/, "event"],
  [/^anomal[ií]a morfol[oó]gica$/, "morphologic abnormality"],
  [/^estructura corporal$/, "body structure"],
  [/^procedimiento$/, "procedure"],
  [/^r[eé]gimen\/tratamiento$/, "regime/therapy"],
  [/^sustancia$/, "substance"],
  [/^entidad observable$/, "observable entity"],
  [/(producto|f[aá]rmaco|presentaci[oó]n farmac[eé]utica|forma farmac[eé]utica)/, "product"]
];

export function canonicalSemanticTag(semanticTag) {
  const tag = normalize(semanticTag).toLowerCase();
  for (const [pattern, canonical] of LOCALIZED_TAGS) {
    if (pattern.test(tag)) return canonical;
  }
  return tag;
}

function semanticTagWeight(semanticTag, targetContext) {
  const tag = canonicalSemanticTag(semanticTag);
  // A principal diagnosis is a condition, so that is the default lens.
  const context = (normalize(targetContext) || "condition.code").toLowerCase();
  if (!tag) return 0;

  if (context.includes("condition")) {
    // A finding is usually a symptom that a disorder in the same note explains,
    // so it only leads when no disorder is documented.
    if (tag.includes("disorder")) return 18;
    if (tag.includes("finding")) return 2;
    if (tag.includes("event")) return 4;
    if (tag.includes("morphologic abnormality")) return -8;
    if (tag.includes("body structure")) return -18;
    if (tag.includes("procedure")) return -24;
    if (tag.includes("regime") || tag.includes("therapy")) return -24;
    if (tag.includes("substance") || tag.includes("product") || tag.includes("clinical drug")) return -30;
  }

  if (context.includes("observation")) {
    if (tag.includes("finding")) return 14;
    if (tag.includes("observable entity")) return 12;
    if (tag.includes("procedure")) return -10;
  }

  if (context.includes("procedure")) {
    if (tag.includes("procedure")) return 18;
    if (tag.includes("regime") || tag.includes("therapy")) return 10;
    if (tag.includes("disorder")) return -12;
  }

  return 0;
}

// Match confidence says the code fits the text, not that the condition is the
// main problem, so it is capped below the clinical signals it would otherwise
// outweigh (an exact match on "cough" vs a fuzzier match on the real diagnosis).
const CONFIDENCE_WEIGHT = 0.3;
// Repeated mentions add a little, not a full score each, so a symptom repeated
// across HPI and hospital course can't outrun a diagnosis stated once.
const REPEAT_BONUS = 4;
const MAX_REPEAT_BONUS = 12;
// The principal must be an active, present problem — not history or a suspicion.
const PRINCIPAL_ASSERTIONS = new Set(["present"]);

function candidateFromEntry(entry) {
  return entry?.selectedCandidate || entry?.topCandidate || null;
}

function supportingSpan(entry) {
  return normalize(entry?.span?.text || entry?.phrase);
}

function supportingMatchedTerm(entry) {
  return normalize(entry?.selectedCandidate?.matchedText || entry?.topCandidate?.matchedText || "");
}

function sectionLabel(entry) {
  // LLM-extracted mentions carry a placeholder "note" section; their real
  // section is the extractor's own label.
  const section = normalize(entry?.section);
  const llmSection = normalize(entry?.llmSection);
  if (llmSection && (!section || section.toLowerCase() === "note")) return llmSection;
  return section || llmSection || "Note";
}

function scoreEntry(entry, candidate, targetContext) {
  const section = sectionLabel(entry);
  const parts = {
    confidence: toNumber(entry?.confidencePct, 0) * CONFIDENCE_WEIGHT,
    section: sectionWeight(section),
    assertion: assertionWeight(entry?.assertion),
    evidence: evidenceWeight(entry?.evidenceType, entry?.decision || entry?.status),
    semanticTag: semanticTagWeight(candidate?.semanticTag, targetContext)
  };
  return { section, parts, score: Object.values(parts).reduce((sum, value) => sum + value, 0) };
}

function newBucket(conceptId, candidate) {
  return {
    conceptId,
    // Per-mention score breakdown for the explanation view (see explainDiagnosis).
    contributions: [],
    term: candidate?.term || conceptId,
    semanticTag: candidate?.semanticTag || null,
    ancestorIds: new Set((Array.isArray(candidate?.ancestorIds) ? candidate.ancestorIds : []).map(String)),
    bestScore: -Infinity,
    confidencePct: 0,
    supportingSpanCount: 0,
    supportingSpans: [],
    matchedTerms: [],
    supportingSections: new Set(),
    evidenceTypes: new Set(),
    assertions: new Set(),
    rationale: new Set(),
    mergedConcepts: []
  };
}

function addSpan(bucket, text, field = "supportingSpans") {
  if (text && !bucket[field].includes(text) && bucket[field].length < 5) bucket[field].push(text);
}

function absorb(target, source) {
  target.bestScore = Math.max(target.bestScore, source.bestScore);
  target.confidencePct = Math.max(target.confidencePct, source.confidencePct);
  target.supportingSpanCount += source.supportingSpanCount;
  source.supportingSpans.forEach((text) => addSpan(target, text));
  source.matchedTerms.forEach((text) => addSpan(target, text, "matchedTerms"));
  for (const key of ["supportingSections", "evidenceTypes", "assertions", "rationale"]) {
    source[key].forEach((value) => target[key].add(value));
  }
  target.mergedConcepts.push({ conceptId: source.conceptId, term: source.term }, ...source.mergedConcepts);
  target.contributions.push(...source.contributions.map((c) => ({ ...c, mergedFrom: c.mergedFrom || source.term })));
}

// Fold each concept into its most specific coded descendant on the same branch.
function mergeHierarchy(buckets) {
  const list = Array.from(buckets.values());
  // Deepest first, so a grandparent folds into the leaf rather than the middle.
  const byDepth = list.slice().sort((left, right) => right.ancestorIds.size - left.ancestorIds.size);
  const absorbed = new Set();
  for (const ancestor of list.slice().sort((left, right) => left.ancestorIds.size - right.ancestorIds.size)) {
    const descendant = byDepth.find((item) => (
      item !== ancestor &&
      !absorbed.has(item.conceptId) &&
      item.ancestorIds.has(ancestor.conceptId)
    ));
    if (!descendant) continue;
    absorb(descendant, ancestor);
    descendant.rationale.add(`merged:${ancestor.term}`);
    absorbed.add(ancestor.conceptId);
  }
  return list.filter((item) => !absorbed.has(item.conceptId));
}

function finalize(item) {
  const repeatBonus = Math.min(Math.max(item.supportingSpanCount - 1, 0) * REPEAT_BONUS, MAX_REPEAT_BONUS);
  const assertions = Array.from(item.assertions).filter(Boolean);
  return {
    conceptId: item.conceptId,
    term: item.term,
    semanticTag: item.semanticTag,
    score: Number((item.bestScore + repeatBonus).toFixed(2)),
    confidencePct: item.confidencePct,
    supportingSpanCount: item.supportingSpanCount,
    supportingSpans: item.supportingSpans,
    matchedTerms: item.matchedTerms,
    supportingSections: Array.from(item.supportingSections).filter(Boolean),
    evidenceTypes: Array.from(item.evidenceTypes).filter(Boolean),
    assertions,
    rationale: Array.from(item.rationale).filter(Boolean),
    mergedConcepts: item.mergedConcepts,
    // How the score was built: the best single-mention score plus the repeat
    // bonus, and each supporting mention's weighted parts.
    scoreBreakdown: {
      bestMentionScore: Number(item.bestScore.toFixed(2)),
      repeatBonus,
      contributions: item.contributions
    },
    principalEligible: assertions.some((value) => PRINCIPAL_ASSERTIONS.has(value.toLowerCase()))
  };
}

function compareCandidates(left, right) {
  const scoreDiff = Number(right.score || 0) - Number(left.score || 0);
  if (scoreDiff !== 0) return scoreDiff;
  const supportDiff = Number(right.supportingSpanCount || 0) - Number(left.supportingSpanCount || 0);
  if (supportDiff !== 0) return supportDiff;
  const confidenceDiff = Number(right.confidencePct || 0) - Number(left.confidencePct || 0);
  if (confidenceDiff !== 0) return confidenceDiff;
  return String(left.term || "").localeCompare(String(right.term || ""));
}

// Ranked diagnosis concepts for a note: principal-eligible (present) first.
// Pass `excluded` (an array) to collect the mentions that never reached
// ranking and why — used only to explain the proposal.
export function rankDiagnosisConcepts(entries, { targetContext = "", excluded = null } = {}) {
  const buckets = new Map();
  const skip = (entry, candidate, reason, extra = {}) => {
    if (!Array.isArray(excluded)) return;
    excluded.push({
      phrase: supportingSpan(entry),
      conceptId: candidate?.conceptId ? String(candidate.conceptId) : null,
      term: candidate?.term || null,
      assertion: normalize(entry?.assertion || "present"),
      reason,
      ...extra
    });
  };

  for (const entry of Array.isArray(entries) ? entries : []) {
    const candidate = candidateFromEntry(entry);
    const conceptId = normalize(candidate?.conceptId);
    if (!conceptId) { skip(entry, candidate, "no-code"); continue; }
    if (candidate?.active === false) { skip(entry, candidate, "inactive-concept"); continue; }
    if (normalize(entry?.experiencer || "patient").toLowerCase() !== "patient") { skip(entry, candidate, "not-the-patient"); continue; }

    const { section, parts, score } = scoreEntry(entry, candidate, targetContext);
    if (score <= 0) { skip(entry, candidate, "non-positive-score", { section, parts, score: Number(score.toFixed(2)) }); continue; }

    const current = buckets.get(conceptId) || newBucket(conceptId, candidate);
    current.bestScore = Math.max(current.bestScore, score);
    current.confidencePct = Math.max(current.confidencePct, toNumber(entry?.confidencePct, 0));
    current.supportingSpanCount += 1;
    current.supportingSections.add(section);
    current.evidenceTypes.add(normalize(entry?.evidenceType || "inferred"));
    current.assertions.add(normalize(entry?.assertion || "present"));
    addSpan(current, supportingSpan(entry));
    addSpan(current, supportingMatchedTerm(entry), "matchedTerms");
    current.contributions.push({
      phrase: supportingSpan(entry),
      section,
      assertion: normalize(entry?.assertion || "present"),
      parts: Object.fromEntries(Object.entries(parts).map(([k, v]) => [k, Number(v.toFixed(2))])),
      score: Number(score.toFixed(2))
    });

    if (parts.section > 0) current.rationale.add(`section:${section}`);
    if (parts.assertion > 0) current.rationale.add(`assertion:${normalize(entry?.assertion || "present")}`);
    if (parts.semanticTag > 0) current.rationale.add(`semanticTag:${normalize(candidate?.semanticTag)}`);

    buckets.set(conceptId, current);
  }

  return mergeHierarchy(buckets)
    .map(finalize)
    .sort((left, right) => Number(right.principalEligible) - Number(left.principalEligible) || compareCandidates(left, right));
}

export function computePrimaryDiagnosisCandidates(entries, { targetContext = "", limit = 3 } = {}) {
  return rankDiagnosisConcepts(entries, { targetContext })
    .filter((item) => item.principalEligible)
    .slice(0, Math.max(Number(limit) || 0, 1));
}

// Principal plus the rest of the note's diagnoses, split by clinical status:
// active comorbidities (disorders), presenting symptoms (findings, usually
// explained by a diagnosis), past history, and suspected (not yet confirmed).
export function computeDiagnosisProposal(entries, { targetContext = "", limit = 3 } = {}) {
  const excluded = [];
  const ranked = rankDiagnosisConcepts(entries, { targetContext, excluded });
  const candidates = ranked.filter((item) => item.principalEligible).slice(0, Math.max(Number(limit) || 0, 1));
  const principal = candidates[0] || null;
  const isTag = (item, tags) => tags.includes(canonicalSemanticTag(item.semanticTag));
  const others = ranked.filter((item) => item !== principal && isTag(item, ["disorder", "finding", "event"]));
  const has = (item, value) => item.assertions.some((assertion) => assertion.toLowerCase() === value);
  const active = others.filter((item) => item.principalEligible);

  return {
    principal,
    candidates,
    comorbidities: active.filter((item) => !isTag(item, ["finding"])),
    symptoms: active.filter((item) => isTag(item, ["finding"])),
    history: others.filter((item) => !item.principalEligible && has(item, "historical")),
    suspected: others.filter((item) => !item.principalEligible && !has(item, "historical") && has(item, "suspected")),
    explanation: explainDiagnosis({ ranked, principal, excluded, targetContext })
  };
}

// The rules and constants actually applied, plus this note's ranking and the
// mentions that were left out — so the UI can show how the proposal was built
// rather than describe it. Weights come from the same functions the scorer
// calls, so they can't drift from the implementation.
function explainDiagnosis({ ranked, principal, excluded, targetContext }) {
  const context = normalize(targetContext) || "condition.code";
  const sample = (fn, values) => values.map((value) => ({ value, weight: fn(value) }));
  const isTag = (item, tags) => tags.includes(canonicalSemanticTag(item.semanticTag));
  const has = (item, value) => item.assertions.some((assertion) => assertion.toLowerCase() === value);
  const bucketOf = (item) => {
    if (item === principal) return "principal";
    if (!isTag(item, ["disorder", "finding", "event"])) return "not-a-diagnosis";
    if (item.principalEligible) return isTag(item, ["finding"]) ? "symptom" : "comorbidity";
    if (has(item, "historical")) return "history";
    if (has(item, "suspected")) return "suspected";
    return "unclassified";
  };
  return {
    targetContext: context,
    rules: {
      formula: "mention score = confidence × 0.3 + section + assertion + evidence + semantic tag; concept score = best mention score + min((mentions − 1) × 4, 12)",
      confidenceWeight: CONFIDENCE_WEIGHT,
      repeatBonus: REPEAT_BONUS,
      maxRepeatBonus: MAX_REPEAT_BONUS,
      principalAssertions: Array.from(PRINCIPAL_ASSERTIONS),
      section: sample(sectionWeight, ["assessment", "chief complaint", "hpi", "exam", "other", "history", "plan", "family history"]),
      assertion: sample(assertionWeight, ["present", "suspected", "historical", "planned", "absent", "family-history"]),
      evidence: [
        { value: "accepted · direct", weight: evidenceWeight("direct", "accepted") },
        { value: "review · inferred", weight: evidenceWeight("inferred", "review") },
        { value: "abstain · context", weight: evidenceWeight("context", "abstain") }
      ],
      semanticTag: sample((tag) => semanticTagWeight(tag, context), ["disorder", "event", "finding", "morphologic abnormality", "body structure", "procedure", "substance"])
    },
    ranking: ranked.map((item, index) => ({
      rank: index + 1,
      conceptId: item.conceptId,
      term: item.term,
      semanticTag: item.semanticTag,
      score: item.score,
      principalEligible: item.principalEligible,
      bucket: bucketOf(item),
      assertions: item.assertions,
      mergedConcepts: item.mergedConcepts,
      scoreBreakdown: item.scoreBreakdown
    })),
    excluded
  };
}
