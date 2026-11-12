const ASSERTIONS = new Set(['present', 'absent', 'suspected', 'planned']);
const SUBJECTS = new Set(['patient', 'family']);
const TIMES = new Set(['current', 'historical', 'unknown']);
const KINDS = new Set(['condition', 'symptom', 'observation', 'medication', 'procedure', 'test', 'referral', 'context']);
const WORKFLOWS = new Set(['current','planned','conditional','completed','continuation','discussion','unknown']);

export function normalizeExtractedMentions(raw) {
  return (Array.isArray(raw) ? raw : []).filter(m => String(m?.phrase || '').trim()).map(m => ({
    phrase: String(m.phrase).trim(),
    verbatim: String(m.verbatim || m.phrase).trim(),
    sourceSentence: String(m.sourceSentence || '').trim(),
    assertion: ASSERTIONS.has(m.assertion) ? m.assertion : 'suspected',
    subject: SUBJECTS.has(m.subject) ? m.subject : 'patient',
    temporality: TIMES.has(m.temporality) ? m.temporality : 'unknown',
    section: String(m.section || 'other'),
    kind: KINDS.has(m.kind) ? m.kind : null,
    workflow: WORKFLOWS.has(m.workflow) ? m.workflow : 'unknown',
    clinicalStatus: ['active','resolved','unknown'].includes(m.clinicalStatus) ? m.clinicalStatus : 'unknown',
    attributes: m.attributes && typeof m.attributes === 'object' && !Array.isArray(m.attributes) ? m.attributes : {},
    ...(Number.isInteger(m.sourceWindow?.start)&&Number.isInteger(m.sourceWindow?.end)?{sourceWindow:{start:m.sourceWindow.start,end:m.sourceWindow.end}}:{}),
    ...(Number.isInteger(m.start) && Number.isInteger(m.end) ? { start: m.start, end: m.end } : {})
  }));
}

function sectionClass(title) {
  const value = String(title || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
  if (/family|familiar/.test(value)) return 'family_history';
  if (/present illness|hpi|enfermedad actual/.test(value)) return 'present_illness';
  if (/past medical|antecedentes personales/.test(value)) return 'history';
  if (/reason for|chief complaint|motivo de/.test(value)) return 'chief_complaint';
  if (/assessment|diagnos|evaluaci|impression/.test(value)) return 'active';
  if (/plan/.test(value)) return 'plan';
  return value;
}

// Each occurrence keeps its own evidence. Missing verbatim evidence stays missing.
export function anchorMentions(text, mentions, sections = []) {
  const lower = String(text).toLowerCase();
  const used = new Set();
  const output = [];
  for (const mention of mentions) {
    const needle = mention.verbatim.toLowerCase();
    const candidates = [];
    let cursor = 0;
    while (needle && cursor <= lower.length) {
      const start = lower.indexOf(needle, cursor);
      if (start < 0) break;
      const end = start + needle.length;
      const section = sections.find(s => start >= s.start && start < s.end);
      candidates.push({ start, end, section });
      cursor = Math.max(end, start + 1);
    }
    const semanticKey = [mention.subject, mention.assertion, mention.temporality, mention.kind, mention.workflow].join('|');
    const quotedSentence = mention.sourceSentence;
    const available = candidates.filter(c => !used.has(`${c.start}:${c.end}|${semanticKey}`)
      && (!mention.sourceWindow || (c.start>=mention.sourceWindow.start&&c.end<=mention.sourceWindow.end))
      && (!quotedSentence || (() => { const s = lower.lastIndexOf(quotedSentence.toLowerCase(), c.start); return s >= 0 && c.end <= s + quotedSentence.length; })()));
    const requestedSection = sectionClass(mention.section);
    const selected = available.find(c => Number.isInteger(mention.start) && c.start === mention.start && c.end === mention.end)
      || available.find(c => sectionClass(c.section?.title) === requestedSection)
      || available[0];
    if (!selected) {
      output.push({ ...mention, start: null, end: null, sourceSection: null, evidenceStatus: 'unanchored' });
      continue;
    }
    used.add(`${selected.start}:${selected.end}|${semanticKey}`);
    const lineStart = text.lastIndexOf('\n', selected.start) + 1;
    const nextLine = text.indexOf('\n', selected.end);
    const sourceLine = text.slice(lineStart, nextLine < 0 ? text.length : nextLine);
    const precedingText = text.slice(lineStart, selected.start);
    const backgroundSection = /past medical|antecedentes personales/i.test(selected.section?.title || '')
      || /^(history|antecedentes)$/i.test(selected.section?.title || '')
      || /past medical history|antecedentes (?:personales|de)/i.test(precedingText);
    const activityStated = /\b(currently|ongoing|active|persists|known|actualmente|activo|activa|persiste|conocid[oa])\b/i.test(sourceLine);
    const activityUnspecified = backgroundSection && mention.kind === 'condition' && mention.subject !== 'family' && mention.assertion === 'present' && mention.temporality === 'current' && !activityStated;
    const resolutionUnsupported = mention.assertion === 'absent' && mention.clinicalStatus === 'resolved'
      && !/\b(resolved|subsided|ceased|cleared|resuelt[oa]|cedio|cede|desapareci[oó])\b/i.test(mention.sourceSentence || sourceLine);
    const resolvedEncounterSymptom=mention.kind==='symptom'&&mention.assertion==='present'&&mention.temporality==='historical'
      && mention.clinicalStatus==='resolved'&&sectionClass(selected.section?.title)==='chief_complaint';
    output.push({ ...mention, temporality: activityUnspecified ? 'unknown' : resolvedEncounterSymptom ? 'current' : mention.temporality,
      clinicalStatus: activityUnspecified || resolutionUnsupported ? 'unknown' : mention.clinicalStatus,
      attributes:resolvedEncounterSymptom?{...mention.attributes,eventTemporality:'historical'}:mention.attributes,
      contextReviewReasons: [...(activityUnspecified ? ['background-activity-not-stated'] : []),...(resolutionUnsupported ? ['absence-does-not-establish-resolved-history'] : []),...(resolvedEncounterSymptom?['resolved-presenting-symptom-is-encounter-problem']:[])],
      start: selected.start, end: selected.end, verbatim: text.slice(selected.start, selected.end), sourceSection: selected.section || null, evidenceStatus: 'anchored' });
  }
  return output;
}
