import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeExtractedMentions, anchorMentions } from '../lib/clinical-mentions.js';
import { exactDescriptionMatch, candidateKindCompatible, compareGroundingEvidence, buildExactTermPipeline } from '../lib/grounding-policy.js';
import { rerankNavigatorResults } from '../lib/search-normalization.js';
import { computeDiagnosisProposal } from '../lib/principal-diagnosis.js';
import { codingToFhirResource } from '../lib/clinical-output.js';

test('distinct source occurrences survive normalization and get separate valid anchors', () => {
  const text = 'Reason: asthma. HPI: asthma. Family: father with asthma.';
  const raw = [
    { phrase: 'asthma', verbatim: 'asthma', assertion: 'present', subject: 'patient', temporality: 'current', section: 'chief_complaint' },
    { phrase: 'asthma', verbatim: 'asthma', assertion: 'present', subject: 'patient', temporality: 'current', section: 'present_illness' },
    { phrase: 'asthma', verbatim: 'father with asthma', assertion: 'present', subject: 'family', temporality: 'unknown', section: 'family_history' }
  ];
  const normalized = normalizeExtractedMentions(raw);
  assert.equal(normalized.length, 3);
  const anchored = anchorMentions(text, normalized);
  assert.deepEqual(anchored.map(m => m.start), [8, 21, 37]);
  assert.ok(anchored.every(m => text.slice(m.start, m.end) === m.verbatim));
  assert.equal(anchorMentions(text, normalizeExtractedMentions([{ phrase: 'missing', verbatim: 'not in the note' }]))[0].start, null);
});

test('background disease activity stays unspecified unless the source states it', () => {
  const text = 'Past medical history: a condition.';
  const mention = normalizeExtractedMentions([{phrase:'a condition',verbatim:'a condition',assertion:'present',temporality:'current',kind:'condition'}]);
  const [anchored] = anchorMentions(text,mention,[{title:'Past medical history',start:0,end:text.length}]);
  assert.equal(anchored.temporality,'unknown');
  assert.equal(anchored.assertion,'present');
});

test('a highlighted token in a longer synonym is never an exact synonym', () => {
  const candidate = { conceptId: '100001', term: 'Combined systolic and diastolic hypertension', synonyms: ['Combined systolic and diastolic hypertension'], highlights: [{ path: 'synonyms', texts: [{ type: 'text', value: 'Combined systolic and diastolic ' }, { type: 'hit', value: 'hypertension' }] }] };
  const [result] = rerankNavigatorResults({ query: 'hypertension', results: [candidate], limit: 1 });
  assert.notEqual(result.matchReason, 'Exact synonym');
  assert.equal(exactDescriptionMatch('hypertension', candidate), null);
  assert.equal(exactDescriptionMatch('hypertension', { ...candidate, synonyms: ['Hypertension'] }), 'Hypertension');
});

test('source semantic kind rejects drug products for laboratory findings and disorders for symptoms', () => {
  assert.equal(candidateKindCompatible({ kind: 'observation' }, { semanticTag: 'clinical drug' }), false);
  assert.equal(candidateKindCompatible({ kind: 'symptom' }, { semanticTag: 'disorder' }), false);
  assert.equal(candidateKindCompatible({ kind: 'test' }, { semanticTag: 'observable entity' }), true);
});

test('a short unrelated procedure cannot displace the semantically stronger laboratory test', () => {
  const lab = {term:'Urinary albumin/creatinine ratio measurement',rerankScore:0.797,_fullDescriptionMatch:false};
  const surgery = {term:'Wedge resection',rerankScore:0.242,_fullDescriptionMatch:false};
  assert.deepEqual([surgery,lab].sort(compareGroundingEvidence),[lab,surgery]);
  const exact = {term:'Exact description',rerankScore:0.1,_fullDescriptionMatch:true};
  assert.deepEqual([lab,exact].sort(compareGroundingEvidence),[exact,lab]);
});

test('exact lookup uses release and language scoped full descriptions and active concepts', () => {
  const pipeline = buildExactTermPipeline({ phrase: ' Hypertension ', releaseId: 'release-a', languageCode: 'en', conceptIdScope: ['100001'] });
  assert.equal(pipeline[0].$match.normalizedTerm, 'hypertension');
  assert.equal(pipeline[0].$match.releaseId, 'release-a');
  assert.equal(pipeline[0].$match.conceptActive, true);
  assert.deepEqual(pipeline[0].$match.conceptId, { $in: ['100001'] });
  assert.ok(pipeline.every(stage => !stage.$search));
});

const entry = (id, extra = {}) => ({ assertion: 'present', experiencer: 'patient', status: 'accepted', confidencePct: 100, evidenceType: 'direct', section: 'Assessment', topCandidate: { conceptId: id, term: id, semanticTag: 'disorder', active: true, ancestorIds: [] }, ...extra });

test('unreviewed mappings cannot become principal or comorbidities', () => {
  const proposal = computeDiagnosisProposal([entry('100001', { status: 'review' }), entry('100002')]);
  assert.equal(proposal.principal.conceptId, '100002');
  assert.deepEqual(proposal.comorbidities, []);
  assert.equal(proposal.explanation.excluded[0].reason, 'mapping-needs-review');
});

test('a current parent does not confirm a suspected or planned descendant', () => {
  const parent = entry('100001', { section: 'Reason for visit' });
  const suspected = entry('100002', { assertion: 'suspected', topCandidate: { conceptId: '100002', term: 'suspected descendant', semanticTag: 'disorder', ancestorIds: ['100001'] } });
  const plan = entry('100003', { assertion: 'planned', topCandidate: { conceptId: '100003', term: 'planned descendant', semanticTag: 'disorder', ancestorIds: ['100001'] } });
  const proposal = computeDiagnosisProposal([parent, suspected, plan]);
  assert.equal(proposal.principal.conceptId, '100001');
  assert.deepEqual(proposal.suspected.map(c => c.conceptId), ['100002']);
  assert.deepEqual(proposal.comorbidities, []);
});

test('a current generic ancestor is not counted as a separate comorbidity', () => {
  const child = entry('100002', {section:'Reason for visit',topCandidate:{conceptId:'100002',term:'specific condition',semanticTag:'disorder',ancestorIds:['100001']}});
  const proposal = computeDiagnosisProposal([entry('100001'),child]);
  assert.equal(proposal.principal.conceptId,'100002');
  assert.deepEqual(proposal.comorbidities,[]);
});

test('the explicit encounter condition outranks a separate assessment comorbidity', () => {
  const proposal = computeDiagnosisProposal([entry('100001', { section: 'Reason for visit' }), entry('100002', { section: 'Assessment' })]);
  assert.equal(proposal.principal.conceptId, '100001');
  assert.deepEqual(proposal.comorbidities.map(c => c.conceptId), ['100002']);
});

test('an unresolved encounter problem cannot be replaced by an unrelated comorbidity', () => {
  const proposal = computeDiagnosisProposal([entry('100001', { section:'Reason for admission', kind:'condition', status:'review' }), entry('100002')]);
  assert.equal(proposal.principal, null);
  assert.deepEqual(proposal.comorbidities.map(c => c.conceptId), ['100002']);
});

test('a presenting symptom can lead when the proposed cause remains suspected', () => {
  const symptom = entry('100001', { section:'Chief complaint', kind:'symptom', topCandidate:{conceptId:'100001', term:'symptom', semanticTag:'finding'} });
  const proposal = computeDiagnosisProposal([symptom, entry('100002', {assertion:'suspected'}), entry('100003')]);
  assert.equal(proposal.principal.conceptId, '100001');
});

test('a first-listed confirmed discharge diagnosis outranks the admission symptoms', () => {
  const symptom = entry('100001', { section:'Reason for admission', kind:'symptom', topCandidate:{conceptId:'100001', term:'symptom', semanticTag:'finding'} });
  const proposal = computeDiagnosisProposal([symptom, entry('100002', {section:'Discharge assessment', sentence:'1. Confirmed diagnosis.', kind:'condition'})]);
  assert.equal(proposal.principal.conceptId, '100002');
});

test('accented Spanish discharge headings retain encounter priority and unresolved status', () => {
  const symptom = entry('100001', { section:'Motivo de ingreso', kind:'symptom', topCandidate:{conceptId:'100001',term:'síntoma',semanticTag:'finding'} });
  const unresolved = entry('100002', {section:'Diagnóstico al alta',sentence:'1. Diagnóstico principal.',kind:'condition',status:'review'});
  assert.equal(computeDiagnosisProposal([symptom,unresolved]).principal,null);
});

test('future actions never become completed procedures or active medication use in FHIR', () => {
  const base = { conceptId:'100001', term:'test', subject:'patient', assertion:'planned', workflow:'conditional' };
  assert.equal(codingToFhirResource({ ...base, codeRole:'procedure' }).resourceType, 'ServiceRequest');
  assert.equal(codingToFhirResource({ ...base, codeRole:'medication' }).resourceType, 'MedicationRequest');
  assert.equal(codingToFhirResource({ ...base, codeRole:'procedure' }).status, 'draft');
  assert.equal(codingToFhirResource({ ...base, codeRole:'procedure', assertion:'present', workflow:'unknown' }).status, 'unknown');
  assert.equal(codingToFhirResource({ ...base, codeRole:'diagnosis', assertion:'suspected' }).verificationStatus.coding[0].code, 'provisional');
  const conditional = codingToFhirResource({...base,codeRole:'medication',attributes:{condition:'if renal function remains stable'}});
  assert.match(conditional.note[0].text,/if renal function remains stable/);
  assert.equal(codingToFhirResource({...base,codeRole:'diagnosis',subject:'family',attributes:{relationship:'father'}}).resourceType,'FamilyMemberHistory');
});
