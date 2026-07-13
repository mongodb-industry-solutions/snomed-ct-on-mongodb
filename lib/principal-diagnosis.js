function normalize(value) {
  return String(value || "").trim();
}

function toNumber(value, fallback = 0) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : fallback;
}

function sectionWeight(section) {
  const label = normalize(section).toLowerCase();
  if (!label) return 0;
  if (/(assessment|diagnos|impression|problem list|problemas|diagnostico|diagnòstic)/i.test(label)) return 22;
  if (/(chief complaint|motivo|hpi|present illness|consulta)/i.test(label)) return 12;
  if (/(exam|explor|findings|resultados)/i.test(label)) return 6;
  if (/(history|antecedentes)/i.test(label)) return -8;
  if (/(family|familiares)/i.test(label)) return -18;
  if (/(plan|follow|seguimiento|treatment|tratamiento|medication)/i.test(label)) return -12;
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

function evidenceWeight(evidenceType, decision) {
  const evidence = normalize(evidenceType).toLowerCase();
  const resolvedDecision = normalize(decision).toLowerCase();
  let score = 0;

  if (resolvedDecision === "accepted") score += 16;
  if (resolvedDecision === "accepted-inferred") score += 12;
  if (resolvedDecision === "review") score += 4;
  if (resolvedDecision === "abstain" || resolvedDecision === "timed-out") score -= 12;
  if (resolvedDecision === "no-code" || resolvedDecision === "rejected") score -= 22;

  if (evidence === "direct") score += 10;
  if (evidence === "inferred") score += 5;
  if (evidence === "context") score -= 10;
  if (evidence === "system") score -= 14;

  return score;
}

function semanticTagWeight(semanticTag, targetContext) {
  const tag = normalize(semanticTag).toLowerCase();
  const context = normalize(targetContext).toLowerCase();
  if (!tag) return 0;

  if (context.includes("condition")) {
    if (tag.includes("disorder")) return 18;
    if (tag.includes("finding")) return 8;
    if (tag.includes("event")) return 4;
    if (tag.includes("morphologic abnormality")) return -8;
    if (tag.includes("body structure")) return -18;
    if (tag.includes("procedure")) return -24;
    if (tag.includes("regime") || tag.includes("therapy")) return -24;
    if (tag.includes("substance") || tag.includes("product")) return -30;
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

function candidateFromEntry(entry) {
  return entry?.selectedCandidate || entry?.topCandidate || null;
}

function supportingSpan(entry) {
  return normalize(entry?.span?.text || entry?.phrase);
}

function supportingMatchedTerm(entry) {
  return normalize(entry?.selectedCandidate?.matchedText || entry?.topCandidate?.matchedText || "");
}

export function computePrimaryDiagnosisCandidates(entries, { targetContext = "", limit = 3 } = {}) {
  const buckets = new Map();

  for (const entry of Array.isArray(entries) ? entries : []) {
    const candidate = candidateFromEntry(entry);
    const conceptId = normalize(candidate?.conceptId);
    if (!conceptId) continue;
    if (candidate?.active === false) continue;
    if (normalize(entry?.experiencer || "patient").toLowerCase() !== "patient") continue;

    const score =
      toNumber(entry?.confidencePct, 0) * 0.55 +
      sectionWeight(entry?.section) +
      assertionWeight(entry?.assertion) +
      evidenceWeight(entry?.evidenceType, entry?.decision || entry?.status) +
      semanticTagWeight(candidate?.semanticTag, targetContext);

    if (score <= 0) continue;

    const current = buckets.get(conceptId) || {
      conceptId,
      term: candidate?.term || conceptId,
      semanticTag: candidate?.semanticTag || null,
      score: 0,
      confidencePct: 0,
      supportingSpanCount: 0,
      supportingSpans: [],
      matchedTerms: [],
      supportingSections: new Set(),
      evidenceTypes: new Set(),
      assertions: new Set(),
      rationale: new Set()
    };

    current.score += score;
    current.confidencePct = Math.max(current.confidencePct, toNumber(entry?.confidencePct, 0));
    current.supportingSpanCount += 1;
    current.supportingSections.add(normalize(entry?.section || "Note"));
    current.evidenceTypes.add(normalize(entry?.evidenceType || "inferred"));
    current.assertions.add(normalize(entry?.assertion || "present"));

    const spanText = supportingSpan(entry);
    if (spanText && !current.supportingSpans.includes(spanText) && current.supportingSpans.length < 5) {
      current.supportingSpans.push(spanText);
    }
    const matchedTerm = supportingMatchedTerm(entry);
    if (matchedTerm && !current.matchedTerms.includes(matchedTerm) && current.matchedTerms.length < 5) {
      current.matchedTerms.push(matchedTerm);
    }

    if (sectionWeight(entry?.section) > 0) {
      current.rationale.add(`section:${normalize(entry?.section || "Note")}`);
    }
    if (assertionWeight(entry?.assertion) > 0) {
      current.rationale.add(`assertion:${normalize(entry?.assertion || "present")}`);
    }
    if (semanticTagWeight(candidate?.semanticTag, targetContext) > 0) {
      current.rationale.add(`semanticTag:${normalize(candidate?.semanticTag)}`);
    }

    buckets.set(conceptId, current);
  }

  return Array.from(buckets.values())
    .map((item) => ({
      ...item,
      score: Number(item.score.toFixed(2)),
      supportingSections: Array.from(item.supportingSections).filter(Boolean),
      evidenceTypes: Array.from(item.evidenceTypes).filter(Boolean),
      assertions: Array.from(item.assertions).filter(Boolean),
      rationale: Array.from(item.rationale).filter(Boolean)
    }))
    .sort((left, right) => {
      const scoreDiff = Number(right.score || 0) - Number(left.score || 0);
      if (scoreDiff !== 0) return scoreDiff;
      const supportDiff = Number(right.supportingSpanCount || 0) - Number(left.supportingSpanCount || 0);
      if (supportDiff !== 0) return supportDiff;
      const confidenceDiff = Number(right.confidencePct || 0) - Number(left.confidencePct || 0);
      if (confidenceDiff !== 0) return confidenceDiff;
      return String(left.term || "").localeCompare(String(right.term || ""));
    })
    .slice(0, Math.max(Number(limit) || 0, 1));
}
