import './loadEnv.mjs';
import { createReadStream } from 'node:fs';
import { createInterface } from 'node:readline';
import { MongoClient } from 'mongodb';
const args = Object.fromEntries(process.argv.slice(2).reduce((pairs, value, i, all) => value.startsWith('--') ? [...pairs, [value.slice(2), all[i + 1]]] : pairs, []));
if (!args.file || !args['target-system'] || !args['target-version']) throw new Error('Usage: npm run mappings:import -- --file <RF2 Snapshot map file> --target-system <URI> --target-version <version>');
if (!/snapshot/i.test(args.file)) throw new Error('Use an RF2 Snapshot map file so every member has one current state.');
const releaseId = args.release || process.env.SNOMED_RELEASE_ID || '20260601';
const client = new MongoClient(process.env.MONGODB_URI);
await client.connect();
try {
  const db = client.db(process.env.MONGODB_DB || 'terminology'), source = db.collection(process.env.MONGODB_COLLECTION || 'snomed-irbd');
  const projected = new Set(await db.collection(process.env.MONGODB_TERM_SEARCH_COLLECTION || 'snomed-term-search').distinct('conceptId', { releaseId }));
  const byConcept = new Map(), lines = createInterface({ input: createReadStream(args.file), crlfDelay: Infinity });
  let header, read = 0;
  for await (const line of lines) {
    if (!header) { header = line.replace(/^\uFEFF/, '').split('\t'); if (!header.includes('mapTarget') || !header.includes('referencedComponentId')) throw new Error('The file does not contain RF2 map targets.'); continue; }
    if (!line.trim()) continue;
    const row = Object.fromEntries(line.split('\t').map((value, i) => [header[i], value])); read++;
    if (!projected.has(row.referencedComponentId)) continue;
    if (!byConcept.has(row.referencedComponentId)) byConcept.set(row.referencedComponentId, []);
    byConcept.get(row.referencedComponentId).push({ memberId: row.id, refsetId: row.refsetId, active: row.active === '1', sourceReleaseId: releaseId,
      targetSystem: args['target-system'], targetVersion: args['target-version'], mapTarget: row.mapTarget,
      mapGroup: Number(row.mapGroup) || 1, mapPriority: Number(row.mapPriority) || 1, mapRule: row.mapRule || 'TRUE', mapAdvice: row.mapAdvice || '',
      mapCategoryId: row.mapCategoryId || null, correlationId: row.correlationId || null, effectiveTime: row.effectiveTime });
  }
  let modified = 0;
  // One atomic update per concept; keep map products imported from other sets.
  for (const [conceptId, entries] of byConcept) {
    const refsetIds = [...new Set(entries.map(e => e.refsetId))];
    const result = await source.updateOne({ conceptId, releaseId }, [{ $set: { mappings: { $concatArrays: [
      { $filter: { input: { $ifNull: ['$mappings', []] }, as: 'mapping', cond: { $not: [{ $in: ['$$mapping.refsetId', refsetIds] }] } } },
      { $literal: entries } ] } } }]);
    modified += result.modifiedCount;
  }
  await source.createIndex({ releaseId: 1, 'mappings.targetSystem': 1, 'mappings.mapTarget': 1, 'mappings.targetVersion': 1 }, { name: 'release_mapping_target' });
  console.log(JSON.stringify({ read, projectedConcepts: projected.size, mappedConcepts: byConcept.size, modified }));
} finally { await client.close(); }
