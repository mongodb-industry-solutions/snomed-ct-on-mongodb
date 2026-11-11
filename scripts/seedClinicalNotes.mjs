import './loadEnv.mjs';
import { MongoClient } from 'mongodb';
import { getMongoConfig, getSemanticsConfig } from '../lib/config.js';
import { pickPreferredTerm } from '../lib/concept-summaries.js';
import { generateSyntheticNotes, legacySyntheticNoteId, SYNTHETIC_DEMO_CONCEPT_IDS, SYNTHETIC_CORPUS_VERSION } from '../lib/demo-clinical-corpus.js';
import { clinicalCorpusStats } from '../lib/clinical-corpus-stats.js';
const { uri, dbName, sourceCollection } = getMongoConfig();
const { releaseId } = getSemanticsConfig();
if (!uri || !releaseId) throw new Error('Configure MongoDB and a pinned SNOMED release before seeding notes.');
const tenantId = process.env.SYNTHETIC_NOTES_TENANT_ID || 'demo-hospital';
const dryRun = process.argv.includes('--dry-run'), refreshDates = process.argv.includes('--refresh-dates'), now = new Date();
const client = new MongoClient(uri);
await client.connect();
try {
  const db = client.db(dbName), source = db.collection(sourceCollection), notes = db.collection('grounded_notes');
  const corpus = await clinicalCorpusStats(notes,tenantId,releaseId);
  const referenceDate = !refreshDates && corpus.demoReferenceDate ? new Date(corpus.demoReferenceDate) : now;
  const documents = await source.find({ releaseId, conceptId: { $in: SYNTHETIC_DEMO_CONCEPT_IDS }, active: { $in: [true,1,'1'] } },
    { projection: { conceptId: 1, descriptions: 1, inferredAncestorIds: 1 } }).toArray();
  const byId = new Map(documents.map(document => [String(document.conceptId),document]));
  const missing = SYNTHETIC_DEMO_CONCEPT_IDS.filter(id => !byId.has(id));
  if (missing.length) throw new Error(`Synthetic facts lack active source concepts: ${missing.join(', ')}`);
  const generated = generateSyntheticNotes({ now: referenceDate, releaseId, tenantId }).map(note => ({ ...note, codings: note.codings.map(coding => {
    const document = byId.get(coding.conceptId), preferred = pickPreferredTerm(document,note.languageCode);
    const finding = ['finding','hallazgo'].includes(String(preferred.semanticTag || '').toLowerCase());
    return { ...coding, semanticTag: preferred.semanticTag,
      target: coding.subject === 'family' ? 'FamilyMemberHistory.condition.code' : coding.target === 'Condition.code' && finding ? 'Observation.code' : coding.target,
      ancestorIds: [...new Set([coding.conceptId,...(document.inferredAncestorIds || []).map(String)])] };
  }) }));
  const collisions = await notes.countDocuments({ _id: { $in: generated.map(note => note._id) }, $or: [{ source: { $ne: SYNTHETIC_CORPUS_VERSION } }, { tenantId: { $ne: tenantId } }] });
  if (collisions) throw new Error('A synthetic note ID overlaps a differently sourced or differently tenanted note; preserve the existing records.');
  const legacyIds = generated.map(legacySyntheticNoteId).filter((id, index) => id !== generated[index]._id);
  const legacyFilter = { _id: { $in: legacyIds }, tenantId, source: SYNTHETIC_CORPUS_VERSION, synthetic: true };
  const legacyNotes = legacyIds.length ? await notes.countDocuments(legacyFilter) : 0;
  const before = await notes.countDocuments({ tenantId });
  if (dryRun) console.log(JSON.stringify({ dryRun, releaseId, demoReferenceDate: generated[0]?.demoReferenceDate, refreshDates, existingNotes: before, legacyIdentitiesToMigrate: legacyNotes, generatedNotes: generated.length, clinicalProfiles: new Set(generated.map(note => note.profileId)).size, verifiedConcepts: documents.length }));
  else {
    await notes.createIndex({ tenantId: 1, 'codings.ancestorIds': 1, 'codings.assertion': 1, 'codings.subject': 1, 'codings.status': 1 }, { name: 'tenant_coding_ancestors' });
    await notes.createIndex({ tenantId: 1, 'encounter.occurredAt': -1, 'patient.sex': 1, 'patient.age': 1 }, { name: 'tenant_encounter_demographics' });
    const result = await notes.bulkWrite(generated.map(({ _id, ...document }) => ({ updateOne: {
      filter: { _id, source: SYNTHETIC_CORPUS_VERSION, tenantId }, update: { $set: document, $setOnInsert: { createdAt: now } }, upsert: true
    } })), { ordered: false });
    // New identities are written successfully before old, tenant-scoped synthetic
    // copies are removed. A failed bulk write leaves the old records untouched.
    if (legacyNotes) await notes.deleteMany(legacyFilter);
    const total = await notes.countDocuments({ tenantId });
    console.log(JSON.stringify({ releaseId, demoReferenceDate: generated[0]?.demoReferenceDate, refreshDates, generatedNotes: generated.length, migratedLegacyIdentities: legacyNotes, added: result.upsertedCount, refreshed: result.matchedCount, before, total,
      syntheticNotes: await notes.countDocuments({ tenantId, synthetic: true }), verifiedConcepts: documents.length }));
  }
} finally { await client.close(); }
