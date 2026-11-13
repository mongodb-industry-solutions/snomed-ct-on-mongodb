import { buildSearchQueryVariants, normalizeSearchText } from './search-normalization.js';

function familyRoots(candidates) {
  const ids = new Set(candidates.map(candidate => candidate.conceptId));
  return candidates.filter(candidate => !(candidate.ancestorIds || []).some(id => id !== candidate.conceptId && ids.has(id)));
}
function lexicalSupport(phrase, candidate) {
  const stopwords = new Set(['of','the','an','de','del','la','el','las','los','un','una','en','con','a']);
  return buildSearchQueryVariants(phrase).some(variant => {
    const words = variant.split(' ').filter(word => !stopwords.has(word));
    return words.length && (candidate.descriptionTerms || []).some(term => {
      const tokens = new Set(normalizeSearchText(term).split(' '));
      return words.every(word => tokens.has(word));
    });
  });
}
function clinicalKind(tag) {
  const normalized = normalizeSearchText(tag);
  if (['disorder','finding','observable entity','trastorno','hallazgo','entidad observable'].includes(normalized)) return 'clinical';
  if (['substance','medicinal product','clinical drug','product','sustancia','producto medicinal','producto'].includes(normalized)) return 'medication';
  return normalized;
}

// Choose families, rather than the highest-ranked specific subtype. A real
// description match anchors the requested meaning; its descendants cover all
// subtypes, even when those subtypes are absent from the search projection.
// Semantic-only requests retain multiple close matches instead of forcing a
// single code, but unrelated lower-ranked suggestions remain refinement options.
export function buildBroadClinicalScope(phrase, candidates) {
  const query = normalizeSearchText(phrase);
  const anchors = candidates.filter(candidate => candidate.conceptId === phrase ||
    (candidate.descriptionTerms || []).some(term => normalizeSearchText(term.replace(/\s*\([^()]*\)\s*$/, '')) === query));
  let matches = anchors;
  if (!anchors.length) {
    const scored = candidates.filter(candidate => Number.isFinite(candidate.rerankScore));
    let strongest;
    if (scored.length) {
      const best = Math.max(...scored.map(candidate => candidate.rerankScore));
      strongest = scored.find(candidate => candidate.rerankScore === best);
      matches = scored.filter(candidate => candidate.rerankScore >= Math.max(0.45, best - 0.12));
    } else {
      matches = candidates.filter(candidate => lexicalSupport(phrase,candidate)).slice(0, 3);
      strongest = matches[0];
    }
    // Semantic similarity also returns associated diagnoses and procedures.
    // Keep the best meaning and its subtypes; other families need evidence in
    // their real descriptions. A broader family ranked above a literal subtype
    // may cover that subtype's branch. High glucose must not imply diabetes.
    const supported = matches.filter(candidate => lexicalSupport(phrase,candidate));
    matches = matches.filter(candidate => {
      if (candidate === strongest) return true;
      if (strongest?.semanticTag && clinicalKind(candidate.semanticTag) !== clinicalKind(strongest.semanticTag)) return false;
      if ((candidate.ancestorIds || []).includes(strongest?.conceptId) || supported.includes(candidate)) return true;
      return supported.some(child => (child.ancestorIds || []).includes(candidate.conceptId) &&
        Number.isFinite(candidate.rerankScore) && candidate.rerankScore >= child.rerankScore);
    });
  }
  const families = familyRoots(matches).map(({ conceptId, term, semanticTag }) => ({ conceptId, term, semanticTag }));
  return { mode: 'broad', conceptIds: families.map(family => family.conceptId), families,
    basis: anchors.length ? 'description-families' : 'semantic-families', includeDescendants: true };
}
