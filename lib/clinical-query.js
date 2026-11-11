// A small, validated query language. Clinical words become sets of SNOMED IDs;
// only this module constructs the MongoDB filter, never an LLM or browser.
import { CLINICAL_SEARCH_CASES } from './clinical-search-examples.js';
import { clinicalDateFilter, resolveClinicalDateContext } from './clinical-date-context.js';
const ASSERTIONS = new Set(['present', 'absent', 'suspected', 'historical', 'planned']);
export function validateClinicalFilters(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('Invalid clinical search filters.');
  const allowed = new Set(['minAge','maxAge','sex','sinceDays','setting']);
  if (Object.keys(input).some(key => !allowed.has(key))) throw new Error('Unsupported clinical search filter.');
  const filters = {};
  for (const key of ['minAge','maxAge','sinceDays']) if (input[key] !== undefined) {
    const value = input[key], age = key !== 'sinceDays';
    if (!Number.isInteger(value) || value < (age ? 0 : 1) || value > (age ? 120 : 3650)) throw new Error(`Invalid ${key} filter.`);
    filters[key] = value;
  }
  if (filters.minAge !== undefined && filters.maxAge !== undefined && filters.minAge > filters.maxAge) throw new Error('The age range is reversed.');
  if (input.sex !== undefined) {
    if (!['female','male','other'].includes(input.sex)) throw new Error('Invalid sex filter.');
    filters.sex = input.sex;
  }
  if (input.setting !== undefined) {
    if (!['primary-care','outpatient','inpatient','emergency'].includes(input.setting)) throw new Error('Invalid encounter setting.');
    filters.setting = input.setting;
  }
  return filters;
}
export function validateClinicalPlan(input) {
  let count = 0;
  const visit = (node, depth = 0) => {
    if (depth > 4 || !node || typeof node !== 'object' || Array.isArray(node)) throw new Error('The clinical query is too complex.');
    if ('all' in node && 'any' in node) throw new Error('A clinical query node cannot contain both all and any.');
    if (('all' in node && !Array.isArray(node.all)) || ('any' in node && !Array.isArray(node.any))) throw new Error('Clinical Boolean groups must be arrays.');
    if (Array.isArray(node.all) || Array.isArray(node.any)) {
      const key = Array.isArray(node.all) ? 'all' : 'any';
      if (!node[key].length || node[key].length > 10) throw new Error('Use between one and ten clinical conditions.');
      return { [key]: node[key].map(n => visit(n, depth + 1)) };
    }
    const phrase = String(node.phrase || '').trim();
    if (!phrase || phrase.length > 160 || ++count > 10) throw new Error('Use up to ten short clinical conditions.');
    return { id: `c${count}`, phrase, assertion: ASSERTIONS.has(node.assertion) ? node.assertion : 'present',
      subject: node.subject === 'family' ? 'family' : 'patient', exclude: node.exclude === true };
  };
  const plan = visit(input);
  if (input.filters != null) {
    const filters = validateClinicalFilters(input.filters);
    if (Object.keys(filters).length) plan.filters = filters;
  }
  return plan;
}
export function clinicalClauses(plan) {
  return plan.all ? plan.all.flatMap(clinicalClauses) : plan.any ? plan.any.flatMap(clinicalClauses) : [plan];
}
export function clinicalConceptIds(value, phrase = 'this condition') {
  const values = Array.isArray(value) ? Array.from(value) : [value];
  if (!values.length || values.length > 40 || values.some(id => typeof id !== 'string' || !/^\d{6,18}$/.test(id))) {
    throw new Error(`No valid SNOMED search scope for “${phrase}”.`);
  }
  return [...new Set(values)];
}
export function parseClinicalQuery(query) {
  let text = String(query || '').trim().replace(/[?.]+$/, '');
  const filters = {};
  text = text.replace(/\b(?:from\s+|in\s+|during\s+|within\s+|de\s+|en\s+|durante\s+)?(?:the\s+|los\s+)?(?:last|past|últimos|ultimos)\s+(\d{1,4})\s+(?:days?|días?|dias?)\b/giu, (_match,days) => { filters.sinceDays = Number(days); return ' '; });
  text = text.replace(/\b(?:aged\s+|de\s+)(\d{1,3})\s+(?:to|a)\s+(\d{1,3})(?:\s+años)?\b/giu, (_match,min,max) => { filters.minAge = Number(min); filters.maxAge = Number(max); return ' '; });
  text = text.replace(/\b(?:over|older than|mayores de|más de|mas de)\s+(\d{1,3})(?:\s+(?:years old|años))?\b/giu, (_match,age) => { filters.minAge = Number(age) + 1; return ' '; });
  text = text.replace(/\b(women|female patients|mujeres|men|male patients|hombres)\b/giu, word => { filters.sex = /^(women|female|mujeres)/i.test(word) ? 'female' : 'male'; return ' '; });
  text = text.replace(/\b(emergency|inpatient|outpatient|primary-care)\s+(notes|records)\b/gi, (_match,setting,noun) => { filters.setting = setting.toLowerCase(); return noun; });
  text = text.replace(/\b(notas|registros)\s+de\s+(urgencias|hospitalización|atención primaria)\b/giu, (_match,noun,setting) => { filters.setting = setting === 'urgencias' ? 'emergency' : setting === 'hospitalización' ? 'inpatient' : 'primary-care'; return noun; });
  text = text.replace(/^(find|show|search|retrieve|buscar|busca|mostrar|muestra)\s+(?:me\s+)?(?:all\s+)?(?:clinical\s+)?(?:notes|records|observations|notas|registros|observaciones)\b\s*/i, '').trim();
  let previous;
  do { previous = text; text = text.replace(/^(?:that\s+(?:mention|have)|talking\s+about|with|about|for|from|in|con|sobre|de|para|en|patients|pacientes)\b\s*/i, '').trim(); } while (text !== previous);
  text = text.replace(/\s+(?=(?:without|excluding|sin|excepto)\s)/gi, (space,offset) => /\b(and|or|but|y|e|o|pero)$|\($/i.test(text.slice(0,offset).trim()) ? space : ' and ');
  const tokens = text.split(/(\(|\)|\b(?:and|or|but|y|e|o|pero)\b)/i).map(token => token.trim()).filter(Boolean);
  let position = 0;
  const leaf = part => {
    let phrase = part.trim(), exclude = false, assertion = 'present', subject = 'patient';
    if (/^(without|excluding|exclude|not with|not|no|sin|excepto)\s+/i.test(phrase)) { exclude = true; phrase = phrase.replace(/^(without|excluding|exclude|not with|not|no|sin|excepto)\s+/i, ''); }
    if (/^(documented absence of|documented no|ausencia documentada de)\s+/i.test(phrase)) { assertion = 'absent'; phrase = phrase.replace(/^(documented absence of|documented no|ausencia documentada de)\s+/i, ''); }
    else if (/^(suspected|possible|sospecha de)\s+/i.test(phrase)) { assertion = 'suspected'; phrase = phrase.replace(/^(suspected|possible|sospecha de)\s+/i, ''); }
    else if (/^(?:a\s+)?(?:family history of|antecedentes familiares de)\s+/i.test(phrase)) { subject = 'family'; phrase = phrase.replace(/^(?:a\s+)?(?:family history of|antecedentes familiares de)\s+/i, ''); }
    else if (/^(?:a\s+)?(?:history of|past history of|previous|historical|antecedentes personales de|antecedentes de)\s+/i.test(phrase)) { assertion = 'historical'; phrase = phrase.replace(/^(?:a\s+)?(?:history of|past history of|previous|historical|antecedentes personales de|antecedentes de)\s+/i, ''); }
    else if (/^(planned|scheduled|programada|planificada)\s+/i.test(phrase)) { assertion = 'planned'; phrase = phrase.replace(/^(planned|scheduled|programada|planificada)\s+/i, ''); }
    else if (/\s+(programada|planificada|prevista)$/i.test(phrase)) { assertion = 'planned'; phrase = phrase.replace(/\s+(programada|planificada|prevista)$/i, ''); }
    phrase = phrase.replace(/^(confirmed|active|current|confirmada)\s+/i, '').replace(/\s+confirmada$/i, '');
    phrase = phrase.replace(/^(with|about|con|sobre|both|ambos)\s+/i, '');
    return { phrase, assertion, subject, exclude };
  };
  const primary = () => {
    const token = tokens[position++];
    if (token === '(') { const group = disjunction(); if (tokens[position++] !== ')') throw new Error('Close every parenthesized clinical group.'); return group; }
    if (!token || /^(\)|and|or|but|y|e|o|pero)$/i.test(token)) throw new Error('Add a clinical condition on each side of AND/OR.');
    return leaf(token);
  };
  const conjunction = () => { const all = [primary()]; while (/^(and|but|y|e|pero)$/i.test(tokens[position] || '')) { position++; all.push(primary()); } return { all }; };
  const disjunction = () => { const any = [conjunction()]; while (/^(or|o)$/i.test(tokens[position] || '')) { position++; any.push(conjunction()); } return any.length === 1 ? any[0] : { any }; };
  const plan = disjunction();
  if (position !== tokens.length) throw new Error('Check the clinical query grouping.');
  return validateClinicalPlan({ ...plan, ...(Object.keys(filters).length ? { filters } : {}) });
}
export function parseStructuredClinicalQuery(query) {
  if (!/^(find|show|search|retrieve|buscar|busca|mostrar|muestra)\s+(?:me\s+)?(?:all\s+)?(?:(?:clinical|emergency|inpatient|outpatient|primary-care)\s+)?(?:notes|records|observations|notas|registros|observaciones)\b/i.test(String(query || '').trim())) return null;
  try {
    const plan = parseClinicalQuery(query);
    // These residual words signal freer prose or a clinical relationship that
    // the command grammar should leave to the language-model planner.
    const prose = /\b(who|that|have|has|had|having|taking|takes|receiving|treated|diagnosed|presenting|requiring|because|with|people|patients|que|tienen|tiene|tomando|toman|reciben|tratados|diagnosticados|con)\b/i;
    return clinicalClauses(plan).some(clause => prose.test(clause.phrase)) ? null : plan;
  } catch (_error) { return null; }
}
export function compileClinicalFilter(plan, resolved, tenantId, includeDescendants = true, now = new Date(), dateContext = null) {
  const visit = node => {
    if (node.all) return { $and: node.all.map(visit) };
    if (node.any) return { $or: node.any.map(visit) };
    const conceptIds = clinicalConceptIds(resolved[node.id], node.phrase);
    const coding = { [includeDescendants ? 'ancestorIds' : 'conceptId']: conceptIds.length === 1 ? conceptIds[0] : { $in: conceptIds }, assertion: node.assertion, subject: node.subject, status: 'accepted' };
    const filter = { codings: { $elemMatch: coding } };
    // Exclusion means no confirmed matching coding; it does not assert that an
    // absent finding was explicitly documented.
    return node.exclude ? { $nor: [filter] } : filter;
  };
  const filters = plan.filters ? validateClinicalFilters(plan.filters) : {};
  const query = { tenantId, ...visit(plan) };
  if (filters.minAge !== undefined || filters.maxAge !== undefined) query['patient.age'] = { ...(filters.minAge !== undefined ? { $gte: filters.minAge } : {}), ...(filters.maxAge !== undefined ? { $lte: filters.maxAge } : {}) };
  if (filters.sex) query['patient.sex'] = filters.sex;
  if (filters.setting) query['encounter.setting'] = filters.setting;
  if (filters.sinceDays) {
    const context = resolveClinicalDateContext(dateContext || {},dateContext?.mode || 'today',now);
    const dateFilter = clinicalDateFilter(filters.sinceDays,context);
    if (dateFilter.$or) query.$and = [...(query.$and || []),dateFilter];
    else Object.assign(query,dateFilter);
  }
  return query;
}
export const CLINICAL_SEARCH_EXAMPLES = CLINICAL_SEARCH_CASES.map(example => example.en);
