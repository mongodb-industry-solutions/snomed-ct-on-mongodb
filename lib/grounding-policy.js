import { canonicalSemanticTag } from './clinical-code-type.js';
import { normalizeSearchText } from './search-normalization.js';

export const TERM_DESCRIPTION_TYPES = ['900000000000003001', '900000000000013009'];

// Exact means a complete terminology description, never the highlighted tokens.
export function exactDescriptionMatch(phrase, candidate) {
  const query = normalizeSearchText(phrase);
  if (!query) return null;
  const descriptions = [candidate?.matchedTerm, candidate?.term, candidate?.displayTerm, candidate?.preferredTerm, candidate?.fsn, ...(candidate?.synonyms || [])];
  return descriptions.find(text => normalizeSearchText(text) === query) || null;
}

export function candidateKindCompatible(mention, candidate) {
  const kind = mention?.kind || mention?.expectedKind;
  const tag = canonicalSemanticTag(candidate?.semanticTag);
  if (!kind || !tag) return true;
  if (mention?.semanticReview?.status === 'verified' && mention.semanticReview.relation === 'equivalent'
    && ['condition','symptom','observation'].includes(kind) && ['disorder','finding','observable entity'].includes(tag)) return true;
  const allowed = {
    condition: ['disorder', 'finding'],
    symptom: ['finding'],
    observation: ['finding', 'observable entity'],
    medication: ['substance', 'product', 'medicinal product', 'medicinal product form', 'clinical drug'],
    procedure: ['procedure', 'regime/therapy'],
    test: ['procedure', 'observable entity'],
    referral: ['procedure', 'regime/therapy'],
    context: []
  };
  return !allowed[kind] || allowed[kind].includes(tag);
}

// A negative finding code plus an absent assertion would negate the absence.
// Keep that unresolved rather than silently reversing the documented result.
export function candidateWouldInvertNegation(mention, candidate) {
  if (mention?.assertion !== 'absent' || canonicalSemanticTag(candidate?.semanticTag) !== 'finding') return false;
  const description = String(candidate.fsn || candidate.preferredTerm || candidate.term || '').trim();
  return /^(?:no|without|sin|absence of|ausencia de|lack of)\b/i.test(description)
    || /\b(?:absent|negative|not detected|not present|ausente|negativ[oa]|no detectad[oa])(?:\s*\([^)]*\))*$/i.test(description);
}

// A visible side in the quoted source cannot disappear from an automatically
// accepted mapping. This is a conservative evidence guard, not concept
// resolution: terminology candidates still come only from the release.
export function missingExplicitLaterality(mention, candidate) {
  const sides = text => {
    const tokens = normalizeSearchText(text).split(/\s+/);
    return new Set(tokens.flatMap(token => {
      if (['left', 'izquierdo', 'izquierda', 'izquierdos', 'izquierdas'].includes(token)) return ['left'];
      if (['right', 'derecho', 'derecha', 'derechos', 'derechas'].includes(token)) return ['right'];
      if (['bilateral', 'bilaterales'].includes(token)) return ['bilateral'];
      return [];
    }));
  };
  const source = sides(mention.verbatim || mention.span?.text || '');
  const target = sides(candidate?.fsn || candidate?.preferredTerm || candidate?.term || '');
  return [...source].filter(side => !target.has(side));
}

export function mappingCanSupportDiagnosis(entry) {
  if (entry?.mappingReviewed === true || entry?.manual === true) return true;
  const status = entry?.decision || entry?.status;
  return status == null || ['accepted', 'accepted-inferred'].includes(status);
}

// Full descriptions retain priority. For nonliteral candidates, the semantic
// rerank must survive the final grounding pass rather than lose to brevity.
export function compareGroundingEvidence(left, right) {
  const exact = Number(Boolean(right._fullDescriptionMatch)) - Number(Boolean(left._fullDescriptionMatch));
  if (exact) return exact;
  if (!left._fullDescriptionMatch && !right._fullDescriptionMatch
    && typeof left.rerankScore === 'number' && typeof right.rerankScore === 'number'
    && Number.isFinite(left.rerankScore) && Number.isFinite(right.rerankScore)) {
    return right.rerankScore - left.rerankScore;
  }
  return 0;
}

export function buildExactTermPipeline({ phrase, languageCode, releaseId, conceptIdScope = [], areaConceptId, limit = 100 }) {
  const match = {
    releaseId,
    languageCode,
    active: true,
    conceptActive: true,
    typeId: { $in: TERM_DESCRIPTION_TYPES },
    normalizedTerm: normalizeSearchText(phrase)
  };
  if (conceptIdScope.length) match.conceptId = { $in: conceptIdScope };
  else if (areaConceptId) match.$or = [{ conceptId: areaConceptId }, { topRoots: areaConceptId }, { areaTags: areaConceptId }];
  return [
    { $match: match },
    { $sort: { preferred: -1, termRank: -1, conceptId: 1 } },
    { $limit: limit },
    { $project: { _id: 0, conceptId: 1, descriptionId: 1, term: 1, matchedTerm: { $ifNull: ['$matchedTerm', '$term'] }, displayTerm: 1, preferredTerm: 1, fsn: 1, semanticTag: 1, synonyms: 1, languageCode: 1, active: 1, conceptActive: 1, releaseId: 1, ancestorIds: 1, typeId: 1, isPreferred: { $ifNull: ['$isPreferred', '$preferred'] }, termRank: 1, score: { $literal: 1 } } }
  ];
}
