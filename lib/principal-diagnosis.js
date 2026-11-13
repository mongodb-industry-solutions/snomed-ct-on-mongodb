import { canonicalSemanticTag, isClinicalFinding } from "./clinical-code-type.js";
import { mappingCanSupportDiagnosis } from "./grounding-policy.js";
import { normalizeSearchText } from './search-normalization.js';
export { canonicalSemanticTag } from "./clinical-code-type.js";
export const DIAGNOSIS_POLICY_VERSION='source-priority-v5';

// Principal-diagnosis + comorbidity proposal over the grounded mentions of a note.
//
// Each patient mention is scored on WHERE it appears (section), HOW it is
// asserted, how strong its grounding evidence is, and WHAT kind of concept it
// resolved to (semantic tag). Only mentions of the same code, assertion and time
// are grouped. Taxonomic ancestry alone cannot establish clinical equivalence.

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
  const label = normalize(section).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/_/g, " ");
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

function encounterPriorityForEntry(entry, candidate = candidateFromEntry(entry)) {
  const section = sectionLabel(entry).replace(/_/g, " ");
  const condition = entry?.kind === "condition" || (!entry?.kind && canonicalSemanticTag(candidate?.semanticTag) === "disorder");
  const reason = /(chief complaint|reason for|motivo)/i.test(section);
  const assessment = sectionWeight(section) === 22;
  const firstListed = /^\s*1[.)]\s/.test(entry?.sentence || "");
  const priority=condition&&reason?5:condition&&assessment&&(firstListed||entry.assessmentPrimary===true)?4:reason?3:condition&&assessment?2:0;
  return Math.max(priority,entry.encounterPriorityHint||0);
}

// Source order also identifies the leading diagnosis in an unnumbered
// assessment. Retrieval status must not turn its presenting symptom into the
// principal when the diagnosis itself is still awaiting a code.
function withAssessmentOrder(entries) {
  const first = new Map();
  for (const entry of entries || []) {
    if (entry.assertion !== 'present' || (entry.experiencer || entry.subject || 'patient') !== 'patient'
      || entry.kind !== 'condition' || entry.temporality === 'unknown'
      || sectionWeight(sectionLabel(entry)) !== 22 || !Number.isInteger(entry.start)) continue;
    const key = `${sectionLabel(entry)}|${entry.sectionStart ?? ''}`;
    first.set(key, Math.min(first.get(key) ?? Infinity, entry.start));
  }
  const ordered=(entries || []).map(entry => ({...entry, assessmentPrimary: !/^\s*\d+[.)]\s/.test(entry.sentence||'')
    && Number.isInteger(entry.start) && first.get(`${sectionLabel(entry)}|${entry.sectionStart ?? ''}`) === entry.start}));
  const key=entry=>JSON.stringify([normalizeSearchText(entry.phrase),entry.kind,entry.assertion,entry.temporality,entry.experiencer||entry.subject||'patient']);
  const priorities=new Map();
  for(const entry of ordered){
    if(!normalizeSearchText(entry.phrase)||entry.kind!=='condition'||entry.assertion!=='present'||entry.temporality!=='current'||(entry.experiencer||entry.subject||'patient')!=='patient')continue;
    priorities.set(key(entry),Math.max(priorities.get(key(entry))||0,encounterPriorityForEntry({...entry,encounterPriorityHint:0})));
  }
  return ordered.map(entry=>({...entry,encounterPriorityHint:priorities.get(key(entry))||0}));
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
    ancestorIds: Array.from(item.ancestorIds),
    kind: item.kind || null,
    encounterPriority: item.encounterPriority || 0,
    temporality: item.temporality || null,
    clinicalStatus:item.clinicalStatus||'unknown',
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
    principalEligible: item.temporality !== "unknown" && assertions.some((value) => PRINCIPAL_ASSERTIONS.has(value.toLowerCase()))
  };
}

function compareCandidates(left, right) {
  const encounterDiff = (right.encounterPriority || 0) - (left.encounterPriority || 0);
  if (encounterDiff !== 0) return encounterDiff;
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

  for (const entry of withAssessmentOrder(Array.isArray(entries) ? entries : [])) {
    const candidate = candidateFromEntry(entry);
    const conceptId = normalize(candidate?.conceptId);
    if (!conceptId) { skip(entry, candidate, "no-code"); continue; }
    if (entry.kind && !['condition','symptom'].includes(entry.kind)) { skip(entry, candidate, 'not-a-diagnostic-mention'); continue; }
    if (candidate?.active === false) { skip(entry, candidate, "inactive-concept"); continue; }
    if (!isClinicalFinding(candidate)) { skip(entry, candidate, "not-a-clinical-finding"); continue; }
    if (!mappingCanSupportDiagnosis(entry)) { skip(entry, candidate, "mapping-needs-review"); continue; }
    if (normalize(entry?.experiencer || "patient").toLowerCase() !== "patient") { skip(entry, candidate, "not-the-patient"); continue; }

    const { section, parts, score } = scoreEntry(entry, candidate, targetContext);
    if (score <= 0) { skip(entry, candidate, "non-positive-score", { section, parts, score: Number(score.toFixed(2)) }); continue; }

    // A code shared by current, historical and provisional evidence is not one
    // fact. Hierarchy membership alone never confirms a suspected descendant.
    const bucketKey = `${conceptId}|${entry.assertion || "present"}|${entry.temporality || ""}|${entry.kind || ""}|${entry.clinicalStatus||'unknown'}`;
    const current = buckets.get(bucketKey) || newBucket(conceptId, candidate);
    current.temporality = entry.temporality || null;
    current.kind = entry.kind || null;
    current.clinicalStatus=entry.clinicalStatus||'unknown';
    const encounterPriority = encounterPriorityForEntry(entry, candidate);
    current.encounterPriority = Math.max(current.encounterPriority || 0, encounterPriority);
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

    buckets.set(bucketKey, current);
  }

  return Array.from(buckets.values())
    .map(finalize)
    .sort((left, right) => Number(right.principalEligible) - Number(left.principalEligible) || compareCandidates(left, right));
}

export function computePrimaryDiagnosisCandidates(entries, { targetContext = "", limit = 3 } = {}) {
  return computeDiagnosisProposal(entries, { targetContext, limit }).candidates;
}

// Principal plus the rest of the note's diagnoses, split by clinical status:
// active comorbidities (disorders), presenting symptoms (findings, usually
// explained by a diagnosis), past history, and suspected (not yet confirmed).
export function computeDiagnosisProposal(entries, { targetContext = "", limit = 3 } = {}) {
  entries = withAssessmentOrder(Array.isArray(entries) ? entries : []);
  const excluded = [];
  const ranked = rankDiagnosisConcepts(entries, { targetContext, excluded });
  // Missing terminology for the documented encounter problem must not silently
  // promote an unrelated, easy-to-match comorbidity into its place.
  const unresolvedPriority = Math.max(0, ...(entries || []).filter(entry =>
    entry.assertion === "present" && entry.temporality !== "unknown"
    && (entry.experiencer || "patient") === "patient" && !mappingCanSupportDiagnosis(entry)
    && !entries.some(other=>other!==entry && normalizeSearchText(entry.phrase) && mappingCanSupportDiagnosis(other) && candidateFromEntry(other)
      && other.assertion===entry.assertion && other.temporality===entry.temporality && other.kind===entry.kind
      && (other.experiencer||'patient')===(entry.experiencer||'patient')
      && normalizeSearchText(other.phrase)===normalizeSearchText(entry.phrase))
  ).map(entry => entry.kind==='condition'&&entry.evidenceStatus==='unanchored'&&sectionWeight(sectionLabel(entry))===22
    ? Math.max(4,encounterPriorityForEntry(entry)) : encounterPriorityForEntry(entry)));
  const candidates = ranked.filter(item => item.principalEligible && item.encounterPriority >= unresolvedPriority).slice(0, Math.max(Number(limit) || 0, 1));
  const principal = candidates[0] || null;
  const isTag = (item, tags) => tags.includes(canonicalSemanticTag(item.semanticTag));
  const others = ranked.filter((item) => item !== principal);
  const has = (item, value) => item.assertions.some((assertion) => assertion.toLowerCase() === value);
  const active = others.filter(item => item.principalEligible && !ranked.some(other =>
    other !== item && other.principalEligible && other.conceptId !== item.conceptId
    && other.temporality === item.temporality && other.kind === item.kind
    && other.assertions.join('|') === item.assertions.join('|')
    && other.ancestorIds.includes(item.conceptId)
  ));
  const relatedDiagnoses=principal?active.filter(item=>sourceLinksConditionDescriptions(entries,principal.conceptId,item.conceptId)):[];

  return {
    principal,
    candidates,
    comorbidities: active.filter((item) => !relatedDiagnoses.includes(item)&&item.kind!=='symptom'&&item.clinicalStatus!=='resolved'&&!isTag(item, ["finding"])),
    relatedDiagnoses:relatedDiagnoses.map(item=>({...item,reviewReason:'Source links this description to the encounter condition; review whether it is a component or a separate comorbidity.'})),
    symptoms: active.filter((item) => item.kind==='symptom'||isTag(item, ["finding"])),
    history: others.filter((item) => !item.principalEligible && (has(item, "historical") || (has(item,'present')&&item.temporality === "unknown"))),
    suspected: others.filter((item) => !item.principalEligible && !has(item, "historical") && has(item, "suspected")),
    explanation: explainDiagnosis({ ranked, principal, excluded, targetContext })
  };
}

// A source sentence can connect two descriptions of an acute/chronic episode
// even when terminology ancestry does not connect their identifiers. Keep such
// grouping for review rather than automatically counting another comorbidity.
function sourceLinksConditionDescriptions(entries, principalId, otherId) {
 const current=entries.filter(e=>e.kind==='condition'&&e.assertion==='present'&&e.temporality==='current'
   && (e.experiencer||'patient')==='patient'&&mappingCanSupportDiagnosis(e));
 const headWords=s=>new Set(normalizeSearchText(s).split(' ').filter(w=>w.length>2&&!['the','with','and','for','con','del','los','las','una','por'].includes(w)));
 return current.filter(e=>String(candidateFromEntry(e)?.conceptId)===String(principalId)).some(main=>{
  const sentence=main.sourceSentence||main.sentence||'';
  const connector=/\b(?:on(?: a background of)?|sobre)\b/i.exec(sentence);
  if(!connector)return false;
  const left=normalizeSearchText(sentence.slice(0,connector.index)),right=normalizeSearchText(sentence.slice(connector.index+connector[0].length));
  if(!left.includes(normalizeSearchText(main.verbatim||main.phrase)))return false;
  return current.filter(e=>String(candidateFromEntry(e)?.conceptId)===String(otherId)).some(other=>{
   const source=normalizeSearchText(other.verbatim||other.phrase);
   if(!source||!right.includes(source))return false;
   const a=headWords(left),b=headWords(source);
   return [...a].filter(w=>b.has(w)).length>=2;
  });
 });
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
    if (!isTag(item, ["disorder", "finding"])) return "not-a-diagnosis";
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
