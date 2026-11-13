// Read-only audit of canonical concepts and the search projection.
import './loadEnv.mjs';
import { MongoClient } from 'mongodb';
import { getMongoConfig, getSearchConfig, getSemanticsConfig } from '../lib/config.js';

const config = getMongoConfig();
const search = getSearchConfig();
const { releaseId } = getSemanticsConfig();
const client = new MongoClient(config.uri, { serverSelectionTimeoutMS: 15000 });
await client.connect();
try {
  const db = client.db(config.dbName);
  const source = db.collection(config.sourceCollection);
  const terms = db.collection(config.termSearchCollection);
  const options = { maxTimeMS: 120000, allowDiskUse: true };
  const active = { $in: [true, 1, '1'] };
  const sourceCount = await source.countDocuments({ releaseId }, options);
  const activeSourceCount = await source.countDocuments({ releaseId, active }, options);
  const projection = await terms.aggregate([
    { $match: { releaseId } },
    { $group: { _id: { conceptId: '$conceptId', languageCode: '$languageCode' }, descriptions: { $sum: 1 } } },
    { $group: { _id: '$_id.languageCode', concepts: { $sum: 1 }, descriptions: { $sum: '$descriptions' } } },
    { $sort: { _id: 1 } }
  ], options).toArray();
  const projectionConcepts = await terms.aggregate([
    { $match: { releaseId } }, { $group: { _id: '$conceptId' } }, { $count: 'count' }
  ], options).toArray();
  const searchableFilter = { releaseId, active:true, conceptActive:true, typeId:{$in:['900000000000003001','900000000000013009']} };
  const searchable = await terms.aggregate([
    {$match:searchableFilter}, {$group:{_id:'$conceptId'}}, {$count:'count'}
  ], options).toArray();
  const searchableDescriptions = await terms.countDocuments(searchableFilter, options);
  let orphanedOrInactiveProjectedConcepts = null;
  if (process.argv.includes('--check-source-membership')) {
    const missing = await terms.aggregate([
      {$match:searchableFilter}, {$group:{_id:'$conceptId'}},
      {$lookup:{from:config.sourceCollection,let:{conceptId:'$_id'},pipeline:[
        {$match:{releaseId,active:{$in:[true,1,'1']},$expr:{$eq:['$conceptId','$$conceptId']}}},
        {$limit:1},{$project:{_id:0,conceptId:1}}
      ],as:'canonical'}},
      {$match:{'canonical.0':{$exists:false}}}, {$count:'count'}
    ], options).toArray();
    orphanedOrInactiveProjectedConcepts = missing[0]?.count || 0;
  }
  const indexes = await terms.listIndexes().toArray();
  const searchIndexes = await terms.listSearchIndexes().toArray();
  const sample = await terms.find({ releaseId }, { projection: { _id: 0, conceptId: 1, descriptionId: 1, term: 1, displayTerm: 1, preferredTerm: 1, fsn: 1, typeId: 1, active: 1, conceptActive: 1, normalizedTerm: 1, normalizedDisplay: 1, languageCode: 1, synonyms: 1, semanticTag: 1 }, limit: 2 }).toArray();
  console.log(JSON.stringify({ checkedAt: new Date().toISOString(), releaseId, sourceCollection: config.sourceCollection, termCollection: config.termSearchCollection, sourceCount, activeSourceCount, projectedConcepts: projectionConcepts[0]?.count || 0, searchableConcepts:searchable[0]?.count || 0, searchableDescriptions, orphanedOrInactiveProjectedConcepts, projectionByLanguage: projection, conventionalIndexes: indexes.map(i => ({ name: i.name, key: i.key })), searchIndexes: searchIndexes.map(i => ({ name: i.name, type: i.type, status: i.status, queryable: i.queryable, configured: [search.textIndex, search.vectorIndex].includes(i.name), definition: i.latestDefinition })), sample }, null, 2));
} finally {
  await client.close();
}
