// Discover terminology coverage from clinical search phrases; no example-code map.
// Dry run by default. --apply invokes the canonical projection builder additively.
import './loadEnv.mjs';
import { readFile, readdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { MongoClient } from 'mongodb';
import { getMongoConfig, getSemanticsConfig } from '../lib/config.js';
import { getSearchConfig } from '../lib/config.js';
import { measureProjectionModel, writeModelState, PROJECTION_STATE_ID } from '../lib/model-state.js';
import { normalizeSearchText, tokenizeSearchText } from '../lib/search-normalization.js';
import { candidateKindCompatible, TERM_DESCRIPTION_TYPES } from '../lib/grounding-policy.js';

const directory = process.argv[2];
if (!directory) throw new Error('Usage: node scripts/ensureMentionProjection.mjs <run-directory> [--apply]');
const apply = process.argv.includes('--apply');
const reusePlan = process.argv.includes('--reuse-plan');
const phrases = new Map();
for (const file of await readdir(directory)) {
  if (!file.endsWith('-extraction.json')) continue;
  const run = JSON.parse(await readFile(path.join(directory, file), 'utf8'));
  const response = run.response || run;
  let mentions = response.mentions || [];
  if (response.extractorRaw) {
    try { mentions = JSON.parse(response.extractorRaw).mentions || mentions; } catch {}
  }
  for (const mention of mentions) {
    if (mention.kind === 'context') continue;
    const languageCode = run.request?.languageCode || response.languageCode;
    const normalized = normalizeSearchText(mention.phrase);
    if (normalized) phrases.set(`${languageCode}|${normalized}`, { ...mention, normalized, languageCode });
  }
}
const stop = new Set(['the','of','in','with','and','for','due','to','a','de','del','en','con','la','el','los','las','por','para','y','or','on','both','ambos','bilateral']);
// These variants widen offline candidate discovery only. The semantic grounder
// must still check every source qualifier before accepting a mapping.
const neutral = new Set(['test','tests','measurement','measurements','level','procedure','review','referral','repeat','visit','follow','up','medicion','prueba','analitica','revision','derivacion','consulta','repetir','valoracion','control']);
function pattern(phrase) {
  const tokens = tokenizeSearchText(phrase).filter(t => !stop.has(t));
  const escape = token => token.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/a/g, '[aáàâäã]').replace(/e/g, '[eéèêë]').replace(/i/g, '[iíìîï]').replace(/o/g, '[oóòôöõ]').replace(/u/g, '[uúùûü]').replace(/n/g, '[nñ]');
  if (tokens.length < 2) return `\\b${escape(tokens[0] || phrase)}\\b`;
  return '^' + tokens.slice(0, 8).map(token => `(?=.*\\b${escape(token)}\\b)`).join('') + '.*$';
}
const queries = [...phrases.values()].map(p => {
 const all=tokenizeSearchText(p.normalized).filter(t=>!stop.has(t));
 const core=all.filter(t=>!neutral.has(t));
 const variants=[all,core,...core.map((_,i)=>core.filter((t,j)=>j!==i)),core.slice().sort((a,b)=>b.length-a.length).slice(0,1)]
  .filter(v=>v.length).map(v=>new RegExp(pattern(v.join(' ')),'i'));
 return {...p,variants};
});
const config = getMongoConfig();
const { releaseId } = getSemanticsConfig();
const client = new MongoClient(config.uri, { serverSelectionTimeoutMS: 15000 });
await client.connect();
let report = reusePlan ? JSON.parse(await readFile(path.join(directory,'projection-expansion-plan.json'),'utf8')) : null;
if(reusePlan && (report.releaseId!==releaseId || !Array.isArray(report.selectedConcepts) || report.selectedConcepts.length>500 || report.selectedConcepts.some(id=>!/^\d+$/.test(id))))throw new Error('Projection plan is invalid or belongs to another release.');
try {
  if(!reusePlan){
  const db = client.db(config.dbName), source = db.collection(config.sourceCollection), terms = db.collection(config.termSearchCollection);
  // One canonical scan with a cheap token prefilter. Full phrase matching and
  // kind checks below select the bounded candidates; the prefilter accepts none.
  const prefilterTokens = [...new Set(queries.map(q => tokenizeSearchText(q.normalized).filter(t => !stop.has(t)).sort((a,b) => b.length-a.length)[0]).filter(Boolean))];
  const combined = prefilterTokens.map(token => pattern(token)).map(p => p.replace(/^\^/, '').replace(/\$$/, '')).join('|');
  const descriptionFilter = { active: { $in: [true, 1, '1'] }, typeId: { $in: TERM_DESCRIPTION_TYPES }, languageCode: { $in: ['en','es'] }, term: { $regex: combined, $options: 'i' } };
  const concepts = await source.aggregate([
    { $match: { releaseId, active: { $in: [true, 1, '1'] }, descriptions: { $elemMatch: descriptionFilter } } },
    { $project: { _id:0, conceptId:1, descriptions: { $filter: { input:'$descriptions', as:'d', cond: { $and: [ { $in:['$$d.active',[true,1,'1']] }, { $in:['$$d.typeId',TERM_DESCRIPTION_TYPES] }, { $in:['$$d.languageCode',['en','es']] }, { $or:[ { $eq:['$$d.typeId',TERM_DESCRIPTION_TYPES[0]] }, { $regexMatch:{ input:'$$d.term', regex:combined, options:'i' } } ] } ] } } } } }
  ], { maxTimeMS:300000 }).toArray();
  console.log(JSON.stringify({ scannedPhrases:queries.length, canonicalPrefilterMatches:concepts.length }));
  const selected = new Set();
  const perPhrase = [];
  for (const query of queries) {
    const matches = [];
    for (const concept of concepts) {
      const fsn = concept.descriptions.find(d => d.typeId === TERM_DESCRIPTION_TYPES[0] && d.languageCode === 'en' && [true,1,'1'].includes(d.active))?.term || '';
      const semanticTag = fsn.match(/\(([^()]+)\)$/)?.[1];
      // Recall discovery can include disorder-tagged symptom/observation
      // descriptions. They cannot become diagnoses without semantic review.
      const recallKind=['symptom','observation'].includes(query.kind)?'condition':query.kind;
      if (!candidateKindCompatible({...query,kind:recallKind}, { semanticTag })) continue;
      for (const d of concept.descriptions) {
        if (![true,1,'1'].includes(d.active) || d.languageCode !== query.languageCode || !TERM_DESCRIPTION_TYPES.includes(d.typeId)) continue;
        const discoveryTier=query.variants.findIndex(re=>re.test(d.term));
        if(discoveryTier<0)continue;
        const exact = normalizeSearchText(d.term) === query.normalized;
        matches.push({ conceptId: String(concept.conceptId), descriptionId: String(d.descriptionId || d.id || ''), term: d.term, exact, discoveryTier, semanticTag, extraTokens: tokenizeSearchText(d.term).filter(t=>!stop.has(t)&&!neutral.has(t)).length });
      }
    }
    matches.sort((a,b) => Number(b.exact)-Number(a.exact) || a.discoveryTier-b.discoveryTier || a.extraTokens-b.extraTokens || a.term.localeCompare(b.term));
    const seen = new Set();
    const candidates = matches.filter(m => !seen.has(m.conceptId) && seen.add(m.conceptId)).slice(0, 12);
    perPhrase.push({ phrase: query.phrase, languageCode: query.languageCode, kind: query.kind || null, candidates, totalMatchingConcepts: seen.size });
  }
  // Every phrase gets its best candidate before adding any deeper alternatives.
  // A bounded budget never lets a common disease's subtypes consume the scope.
  const budget=500;
  for(let rank=0;rank<12;rank++)for(const row of perPhrase){const c=row.candidates[rank];if(c&&(selected.has(c.conceptId)||selected.size<budget))selected.add(c.conceptId);}
  const projected = new Set(await terms.distinct('conceptId', { releaseId, conceptId: { $in: [...selected] }, typeId: { $in: TERM_DESCRIPTION_TYPES } }));
  const projectedIds = new Set(await terms.distinct('_id', { releaseId, conceptId: { $in: [...selected] } }));
  let requiredRows = 0, missingRows = 0;
  const selectedSource = await source.find({ releaseId, conceptId:{ $in:[...selected] } }, { projection:{_id:0,conceptId:1,descriptions:1} }).toArray();
  for (const c of selectedSource) {
    for (const d of c.descriptions) {
      if (![true,1,'1'].includes(d.active) || !['en','es'].includes(d.languageCode) || !TERM_DESCRIPTION_TYPES.includes(d.typeId)) continue;
      const id = `${releaseId}|${c.conceptId}|${d.descriptionId || d.id}|${d.languageCode}`;
      requiredRows++; if (!projectedIds.has(id)) missingRows++;
    }
  }
  report = { releaseId, apply, inputPhrases: queries.length, candidateBudget:budget, budgetReached:selected.size===budget, selectedConcepts: [...selected], missingConcepts: [...selected].filter(id => !projected.has(id)), requiredDescriptionRows: requiredRows, missingDescriptionRows: missingRows, perPhrase, selectionMeaning: 'retrieval candidates from canonical descriptions, not accepted clinical mappings' };
  await writeFile(path.join(directory,'projection-expansion-plan.json'), JSON.stringify(report,null,2)+'\n');
  console.log(JSON.stringify({ releaseId, apply, inputPhrases: queries.length, selectedConcepts: selected.size, missingConcepts: report.missingConcepts.length, requiredDescriptionRows: requiredRows, missingDescriptionRows: missingRows, report: path.join(directory,'projection-expansion-plan.json') }));
  }
} finally { await client.close(); }
if (apply && report.missingDescriptionRows && report.selectedConcepts.length) {
  Object.assign(process.env, { PROJECTION_BUILD_ENABLED: 'true', PROJECTION_RESET_BEFORE_BUILD: 'false', PROJECTION_REPLACE_RELEASE_DOCS: 'false', PROJECTION_CLEAR_TERM_DOCS: 'false', PROJECTION_INCLUDE_ALL_RELEASES: 'false', PROJECTION_CONCEPT_IDS: report.selectedConcepts.join(','), PROJECTION_LANGUAGE_CODES: 'en,es', SNOMED_RELEASE_ID: report.releaseId, EMBED_ENABLED: 'false' });
  delete process.env.PROJECTION_AREA_CONCEPT_ID; delete process.env.PROJECTION_AREA_CONCEPT_IDS;
  const { projectionBuildRun } = await import('./buildProjection.mjs');
  await projectionBuildRun;
  const { vectorPath, manualVectorPath } = getSearchConfig();
  const stateClient = new MongoClient(config.uri);
  await stateClient.connect();
  try {
    const db = stateClient.db(config.dbName);
    const facts = await measureProjectionModel(db.collection(config.projectionCollection), { vectorPath, manualVectorPath });
    await writeModelState(db.collection(config.modelStateCollection), { id: PROJECTION_STATE_ID, collection: config.projectionCollection, facts, releaseId: report.releaseId, recordedBy: 'scripts/ensureMentionProjection.mjs', vectorPaths: { vectorPath, manualVectorPath } });
    console.log('Recorded refreshed projection readiness.');
  } finally { await stateClient.close(); }
}
