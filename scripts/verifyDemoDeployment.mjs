// Read-only release gate. Run against the same secrets/database as the deployed app.
import './loadEnv.mjs';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { MongoClient } from 'mongodb';
import { getMongoConfig, getSearchConfig, getSemanticsConfig } from '../lib/config.js';
import { DEMO_REQUIRED_CONCEPT_IDS } from '../lib/demo-concept-requirements.js';
import { generateSyntheticNotes, SYNTHETIC_CORPUS_VERSION } from '../lib/demo-clinical-corpus.js';
import { clinicalCorpusStats } from '../lib/clinical-corpus-stats.js';

const config = getMongoConfig(), search = getSearchConfig(), { releaseId } = getSemanticsConfig();
const tenantId = process.env.SYNTHETIC_NOTES_TENANT_ID || 'demo-hospital';
const client = new MongoClient(config.uri, { serverSelectionTimeoutMS: 15000 });
await client.connect();
try {
  const db = client.db(config.dbName), source = db.collection(config.sourceCollection), terms = db.collection(config.termSearchCollection), notes = db.collection('grounded_notes');
  const concepts = await source.find({ releaseId, conceptId: { $in: DEMO_REQUIRED_CONCEPT_IDS }, active: { $in: [true, 1, '1'] } },
    { projection: { conceptId: 1, inferredAncestorIds: 1 }, maxTimeMS: 15000 }).toArray();
  const byId = new Map(concepts.map(concept => [String(concept.conceptId), concept]));
  const missingSource = DEMO_REQUIRED_CONCEPT_IDS.filter(id => !byId.has(id));
  const covered = new Set(await terms.distinct('conceptId', { releaseId, conceptId: { $in: DEMO_REQUIRED_CONCEPT_IDS }, conceptActive: true,
    typeId: { $in: ['900000000000003001', '900000000000013009'] } }, { maxTimeMS: 15000 }));
  const missingProjection = DEMO_REQUIRED_CONCEPT_IDS.filter(id => !covered.has(id));
  const indexes = await terms.listSearchIndexes().toArray();
  const searchIndexes = [search.textIndex, search.vectorIndex].map(name => {
    const index = indexes.find(index => index.name === name);
    return { name, status: index?.status || 'missing', queryable: index?.queryable === true,
      definitionSha256: index ? createHash('sha256').update(JSON.stringify(index.latestDefinition || {})).digest('hex') : null };
  });
  const corpus = await clinicalCorpusStats(notes, tenantId, releaseId);
  const expectedNotes = generateSyntheticNotes({ now: new Date(corpus.demoReferenceDate || Date.now()), releaseId, tenantId });
  const stored = await notes.find({ tenantId, source: SYNTHETIC_CORPUS_VERSION, releaseId },
    { projection: { codings: 1 }, maxTimeMS: 15000 }).toArray();
  const storedById = new Map(stored.map(note => [note._id, note]));
  let missingNotes = 0, missingCodings = 0, staleAncestry = 0;
  for (const expected of expectedNotes) {
    const note = storedById.get(expected._id);
    if (!note) { missingNotes++; continue; }
    for (const coding of expected.codings) {
      const actual = (note.codings || []).find(candidate => candidate.conceptId === coding.conceptId && candidate.assertion === coding.assertion &&
        candidate.subject === coding.subject && candidate.status === 'accepted');
      if (!actual) { missingCodings++; continue; }
      const expectedAncestors = new Set([coding.conceptId, ...(byId.get(coding.conceptId)?.inferredAncestorIds || []).map(String)]);
      const actualAncestors = new Set((actual.ancestorIds || []).map(String));
      if (actualAncestors.size !== expectedAncestors.size || [...expectedAncestors].some(id => !actualAncestors.has(id))) staleAncestry++;
    }
  }
  const projectionCount = await terms.countDocuments({ releaseId }, { maxTimeMS: 15000 });
  const legacyDefinitionRows = await terms.countDocuments({ releaseId, typeId: '900000000000550004' }, { maxTimeMS: 15000 });
  console.log(JSON.stringify({ checkedAt: new Date().toISOString(), database: config.dbName, sourceCollection: config.sourceCollection,
    termCollection: config.termSearchCollection, releaseId, requiredConcepts: DEMO_REQUIRED_CONCEPT_IDS.length, missingSource, missingProjection,
    projectionCount, legacyDefinitionRows, searchIndexes, corpus, expectedSyntheticNotes: expectedNotes.length, missingNotes, missingCodings, staleAncestry }, null, 2));
  assert.equal(missingSource.length, 0, 'Required active concepts are missing from the pinned release.');
  assert.equal(missingProjection.length, 0, 'Required concepts lack searchable FSN/synonym rows. Run terms:ensure-demo with TERMS_ENSURE_APPLY=true.');
  assert.ok(searchIndexes.every(index => index.status === 'READY' && index.queryable), 'A configured search index is not ready.');
  assert.equal(missingNotes + missingCodings + staleAncestry, 0, 'Synthetic notes or their coded ancestry need notes:seed.');
} finally {
  await client.close();
}
