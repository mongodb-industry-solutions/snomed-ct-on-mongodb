import './loadEnv.mjs';
import assert from 'node:assert/strict';
import { MongoClient } from 'mongodb';
import { CLINICAL_SEARCH_CASES } from '../lib/clinical-search-examples.js';
import { parseClinicalQuery, clinicalClauses, compileClinicalFilter } from '../lib/clinical-query.js';
import { normalizeSearchText } from '../lib/search-normalization.js';
import { getMongoConfig, getSemanticsConfig } from '../lib/config.js';
import { clinicalCorpusStats } from '../lib/clinical-corpus-stats.js';
import { resolveClinicalDateContext } from '../lib/clinical-date-context.js';
const ids = {
  '73211009': ['diabetes'], '90708001': ['kidney disease','enfermedad renal'], '84114007': ['heart failure','insuficiencia cardíaca'],
  '38341003': ['hypertension','hipertensión'], '254837009': ['breast cancer','cáncer de mama'], '195967001': ['asthma','asma'],
  '13645005': ['chronic obstructive pulmonary disease','enfermedad pulmonar obstructiva crónica'], '233604007': ['pneumonia','neumonía'],
  '267036007': ['shortness of breath','disnea'], '128462008': ['metastatic cancer','cáncer metastásico'], '1287742003': ['radiotherapy','radioterapia'],
  '22298006': ['myocardial infarction','infarto de miocardio'], '372567009': ['metformin','metformina'], '84757009': ['epilepsy','epilepsia'],
  '422504002': ['ischemic stroke','ictus isquémico'], '80394007': ['high blood sugar','azúcar alta en sangre'],
  '53741008': ['coronary artery disease','enfermedad de las arterias coronarias'], '29857009': ['chest pain','dolor torácico'],
  '49436004': ['atrial fibrillation','fibrilación auricular'], '386661006': ['fever','fiebre']
};
const byPhrase = new Map(Object.entries(ids).flatMap(([id,phrases]) => phrases.map(phrase => [normalizeSearchText(phrase),id])));
const config = getMongoConfig(), client = new MongoClient(config.uri);
const base = process.env.CLINICAL_QA_URL || 'http://127.0.0.1:3015';
const only = process.env.CLINICAL_QA_CASES?.split(',');
const languages = process.env.CLINICAL_QA_LANGUAGES?.split(',') || ['en','es'];
let checked = 0;
await client.connect();
try {
  const notes = client.db(config.dbName).collection('grounded_notes');
  const corpus = await clinicalCorpusStats(notes,'demo-hospital',getSemanticsConfig().releaseId);
  const dateMode = process.env.CLINICAL_QA_DATE_MODE || 'demo';
  for (const example of CLINICAL_SEARCH_CASES.filter(example => !only || only.includes(example.id))) for (const languageCode of languages) {
    const query = example[languageCode], plan = parseClinicalQuery(query);
    const resolved = Object.fromEntries(clinicalClauses(plan).map(clause => {
      const id = byPhrase.get(normalizeSearchText(clause.phrase));
      assert.ok(id, `Missing expected scope for ${clause.phrase}`);
      return [clause.id,[id]];
    }));
    const now = new Date(), context = resolveClinicalDateContext(corpus,dateMode,now);
    const expected = compileClinicalFilter(plan,resolved,'demo-hospital',true,now,context);
    const expectedCount = await notes.countDocuments(expected);
    assert.ok(expectedCount > 0, `${example.id} ${languageCode}: the seeded corpus lacks a positive match`);
    const started = Date.now();
    const response = await fetch(base+'/api/clinical-search',{ method:'POST',headers:{'content-type':'application/json'},signal:AbortSignal.timeout(60000),
      body:JSON.stringify({ action:'search',query,languageCode,dateMode,...(process.env.CLINICAL_QA_PLANNER ? {planner:process.env.CLINICAL_QA_PLANNER} : {}) }) });
    const actual = await response.json();
    assert.equal(response.status,200,`${example.id} ${languageCode}: ${actual.error}`);
    assert.equal(actual.dateContext.mode,context.mode);
    assert.equal(actual.dateContext.demoReferenceDate,context.demoReferenceDate);
    assert.deepEqual(actual.plan.filters || {},plan.filters || {},`${example.id} ${languageCode}: demographic or date intent changed`);
    assert.equal(actual.count,expectedCount,`${example.id} ${languageCode}: count differs from the clinical truth (${JSON.stringify(actual.resolved)})`);
    const filter = actual.filter;
    const reviveDates = node => {
      if (!node || typeof node !== 'object') return;
      if (node['encounter.occurredAt']) for (const key of ['$gte','$lte']) if (node['encounter.occurredAt'][key]) node['encounter.occurredAt'][key] = new Date(node['encounter.occurredAt'][key]);
      for (const [key,value] of Object.entries(node)) if (key !== 'encounter.occurredAt') {
        if (Array.isArray(value)) value.forEach(reviveDates); else reviveDates(value);
      }
    };
    reviveDates(filter);
    const falsePositives = await notes.countDocuments({ $and:[filter,{$nor:[expected]}] });
    const falseNegatives = await notes.countDocuments({ $and:[expected,{$nor:[filter]}] });
    assert.equal(falsePositives,0,`${example.id} ${languageCode}: unrelated notes matched`);
    assert.equal(falseNegatives,0,`${example.id} ${languageCode}: valid matching notes were missed`);
    console.log(JSON.stringify({ id:example.id,languageCode,matches:actual.count,planner:actual.planner,ms:Date.now()-started }));
    checked++;
  }
  console.log(JSON.stringify({ verifiedExamples:checked, falsePositives:0, falseNegatives:0 }));
} finally { await client.close(); }
