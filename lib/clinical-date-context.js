import { SYNTHETIC_CORPUS_VERSION, SYNTHETIC_REFERENCE_OFFSET_DAYS } from './demo-clinical-corpus.js';

function validDate(value) {
  if (!(value instanceof Date) && typeof value !== 'string') return null;
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? date : null;
}

export function clinicalDemoFilter(releaseId) {
  return { synthetic: true, source: SYNTHETIC_CORPUS_VERSION, ...(releaseId ? { releaseId } : {}) };
}

export function clinicalDemoReferenceDate(storedReference, latestEncounter) {
  const stored = validDate(storedReference);
  if (stored) return stored;
  // Legacy notes predate the explicit reference field. Their newest encounter
  // was generated at the fixed minimum offset from the dataset's reference.
  const latest = validDate(latestEncounter);
  return latest ? new Date(latest.getTime() + SYNTHETIC_REFERENCE_OFFSET_DAYS * 86400000) : null;
}

export function resolveClinicalDateContext(corpus, requestedMode = 'demo', now = new Date()) {
  if (!['demo','today'].includes(requestedMode)) throw new Error('Choose demo reference date or today for relative dates.');
  const current = validDate(now);
  if (!current) throw new Error('Invalid current date.');
  const demo = validDate(corpus?.demoReferenceDate);
  const mode = requestedMode === 'demo' && demo ? 'demo' : 'today';
  return { mode, referenceDate: (mode === 'demo' ? demo : current).toISOString(),
    currentDate: current.toISOString(), demoReferenceDate: demo?.toISOString() || null, demoReleaseId: corpus?.demoReleaseId || null };
}

export function clinicalDateFilter(sinceDays, context) {
  const range = reference => {
    const date = validDate(reference);
    if (!date) throw new Error('Invalid relative-date reference.');
    return { 'encounter.occurredAt': { $gte: new Date(date.getTime() - sinceDays * 86400000), $lte: date } };
  };
  if (context.mode !== 'demo') return range(context.currentDate);
  const demo = clinicalDemoFilter(context.demoReleaseId);
  // Only this synthetic dataset uses its frozen reference. Other saved notes
  // retain the usual meaning of "last N days" relative to the current date.
  return { $or: [
    { ...demo, ...range(context.demoReferenceDate) },
    { $nor: [demo], ...range(context.currentDate) }
  ] };
}
