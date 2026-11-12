import './loadEnv.mjs';
import { MongoClient } from 'mongodb';
import { DEMO_REQUIRED_CONCEPT_IDS } from '../lib/demo-concept-requirements.js';
import { getMongoConfig, getSearchConfig } from '../lib/config.js';
import { measureProjectionModel, writeModelState, PROJECTION_STATE_ID } from '../lib/model-state.js';
import { TERM_DESCRIPTION_TYPES } from '../lib/grounding-policy.js';
const releaseId = process.env.SNOMED_RELEASE_ID || '20260601';
const client = new MongoClient(process.env.MONGODB_URI);
await client.connect();
try {
  const db = client.db(process.env.MONGODB_DB || 'terminology'), source = db.collection(process.env.MONGODB_COLLECTION || 'snomed-irbd'),
    terms = db.collection(process.env.MONGODB_TERM_SEARCH_COLLECTION || 'snomed-term-search');
  const known = await source.find({ releaseId, conceptId: { $in: DEMO_REQUIRED_CONCEPT_IDS }, active: { $in: [true, 1, '1'] } }, { projection: { conceptId: 1 } }).toArray();
  const missingSource = DEMO_REQUIRED_CONCEPT_IDS.filter(id => !known.some(d => String(d.conceptId) === id));
  if (missingSource.length) throw new Error(`Required concepts missing from the active release: ${missingSource.join(', ')}`);
  const covered = new Set(await terms.distinct('conceptId', { releaseId, conceptId: { $in: DEMO_REQUIRED_CONCEPT_IDS },
    active: true, conceptActive: true, typeId: { $in: TERM_DESCRIPTION_TYPES } }));
  console.log(JSON.stringify({ releaseId, requiredConcepts: DEMO_REQUIRED_CONCEPT_IDS.length, missingProjection: DEMO_REQUIRED_CONCEPT_IDS.filter(id => !covered.has(id)), apply: process.env.TERMS_ENSURE_APPLY === 'true' }));
} finally { await client.close(); }
if (process.env.TERMS_ENSURE_APPLY === 'true') {
  Object.assign(process.env, { PROJECTION_BUILD_ENABLED: 'true', PROJECTION_CONCEPT_IDS: DEMO_REQUIRED_CONCEPT_IDS.join(','),
    PROJECTION_RESET_BEFORE_BUILD: 'false', PROJECTION_REPLACE_RELEASE_DOCS: 'false', PROJECTION_CLEAR_TERM_DOCS: 'false', PROJECTION_INCLUDE_ALL_RELEASES: 'false', SNOMED_RELEASE_ID: releaseId });
  delete process.env.PROJECTION_AREA_CONCEPT_ID; delete process.env.PROJECTION_AREA_CONCEPT_IDS;
  // Auto-embedding is performed by the existing Atlas vector index. Never drop
  // it or rebuild all branches just to add the demo's missing concepts.
  process.env.EMBED_ENABLED = 'false';
  const { projectionBuildRun } = await import('./buildProjection.mjs');
  await projectionBuildRun;
  const config = getMongoConfig(), { vectorPath, manualVectorPath } = getSearchConfig();
  const stateClient = new MongoClient(process.env.MONGODB_URI);
  await stateClient.connect();
  try {
    const db = stateClient.db(config.dbName);
    const facts = await measureProjectionModel(db.collection(config.projectionCollection), { vectorPath, manualVectorPath });
    await writeModelState(db.collection(config.modelStateCollection), { id: PROJECTION_STATE_ID, collection: config.projectionCollection,
      facts, releaseId, recordedBy: 'scripts/ensureDemoProjection.mjs', vectorPaths: { vectorPath, manualVectorPath } });
    console.log('Recorded refreshed projection readiness.');
  } finally { await stateClient.close(); }
}
