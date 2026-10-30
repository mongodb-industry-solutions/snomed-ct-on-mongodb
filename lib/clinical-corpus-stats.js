import { clinicalDemoFilter, clinicalDemoReferenceDate } from './clinical-date-context.js';

export async function clinicalCorpusStats(notes, tenantId, releaseId) {
  const demo = { $and: Object.entries(clinicalDemoFilter(releaseId)).map(([key,value]) => ({ $eq: [`$${key}`,value] })) };
  const [stats] = await notes.aggregate([
    { $match: { tenantId, 'codings.status': 'accepted' } },
    { $group: { _id: null, totalNotes: { $sum: 1 }, syntheticNotes: { $sum: { $cond: [{ $eq: ['$synthetic',true] },1,0] } },
      english: { $sum: { $cond: [{ $eq: ['$languageCode','en'] },1,0] } }, spanish: { $sum: { $cond: [{ $eq: ['$languageCode','es'] },1,0] } },
      latestDemoReference: { $max: { $cond: [demo,'$demoReferenceDate',null] } },
      latestDemoEncounter: { $max: { $cond: [demo,'$encounter.occurredAt',null] } } } },
    { $project: { _id: 0 } }
  ], { maxTimeMS: 6000 }).toArray();
  const { latestDemoReference, latestDemoEncounter, ...counts } = stats || { totalNotes: 0, syntheticNotes: 0, english: 0, spanish: 0 };
  const reference = clinicalDemoReferenceDate(latestDemoReference,latestDemoEncounter);
  return { ...counts, demoReferenceDate: reference?.toISOString() || null, demoReleaseId: reference ? releaseId || null : null };
}
