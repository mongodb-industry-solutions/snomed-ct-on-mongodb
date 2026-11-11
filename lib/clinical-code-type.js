// Classify the retrieved SNOMED concept, never the words in the mention.
const CLINICAL_FINDING_ROOT = "404684003";
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

export function canonicalSemanticTag(value) {
  const tag = String(value || "").trim().toLowerCase();
  return LOCALIZED_TAGS.find(([pattern]) => pattern.test(tag))?.[1] || tag;
}

export function isClinicalFinding(candidate) {
  if (!candidate || candidate.active === false) return false;
  const tag = canonicalSemanticTag(candidate.semanticTag || candidate.tag);
  // Known non-finding types cannot qualify through a score or text match.
  if (tag) return tag === "disorder" || tag === "finding";
  return String(candidate.conceptId) === CLINICAL_FINDING_ROOT
    || (candidate.ancestorIds || []).map(String).includes(CLINICAL_FINDING_ROOT);
}

export function clinicalCodeRole(candidate) {
  if (isClinicalFinding(candidate)) return "diagnosis";
  const tag = canonicalSemanticTag(candidate?.semanticTag || candidate?.tag);
  if (["procedure", "regime/therapy"].includes(tag)) return "procedure";
  if (["product", "medicinal product", "clinical drug", "medicinal product form", "substance"].includes(tag)) return "medication";
  return "other";
}

export function isPrincipalMention(mention, candidate) {
  return isClinicalFinding(candidate) && mention?.assertion === "present"
    && (mention.subject || mention.experiencer || "patient") === "patient";
}

export function eligiblePrimaryConceptIds(mentions, decisions = []) {
  const choices = new Map(decisions.map(decision => [String(decision.mentionId), String(decision.conceptId)]));
  const ids = new Set();
  for (const mention of mentions) {
    const chosen = choices.get(String(mention.mentionId));
    for (const candidate of mention.candidates || []) {
      if ((!chosen || chosen === String(candidate.conceptId)) && isPrincipalMention(mention, candidate)) ids.add(String(candidate.conceptId));
    }
  }
  return ids;
}
