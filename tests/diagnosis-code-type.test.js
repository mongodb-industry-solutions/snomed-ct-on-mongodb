import { test } from 'node:test';
import assert from 'node:assert/strict';
import { clinicalCodeRole, isClinicalFinding, isPrincipalMention, eligiblePrimaryConceptIds } from '../lib/clinical-code-type.js';
import { computeDiagnosisProposal, computePrimaryDiagnosisCandidates } from '../lib/principal-diagnosis.js';

const entry = (conceptId, semanticTag, extra = {}) => ({
  assertion: 'present', experiencer: 'patient', decision: 'accepted', evidenceType: 'direct',
  confidencePct: 100, section: 'assessment', topCandidate: { conceptId, semanticTag, term: semanticTag }, ...extra
});

test('only clinical findings and disorders qualify in English and Spanish', () => {
  for (const tag of ['finding', 'disorder', 'hallazgo', 'trastorno']) {
    assert.equal(clinicalCodeRole({ semanticTag: tag }), 'diagnosis');
  }
  for (const tag of ['medicinal product', 'clinical drug', 'product', 'substance', 'producto medicinal', 'sustancia', 'fármaco de uso clínico']) {
    assert.equal(clinicalCodeRole({ semanticTag: tag }), 'medication');
  }
  for (const tag of ['procedure', 'procedimiento', 'régimen/tratamiento']) {
    assert.equal(clinicalCodeRole({ semanticTag: tag }), 'procedure');
  }
  for (const tag of ['event', 'evento', 'observable entity', 'body structure', 'morphologic abnormality', '', 'unknown']) {
    assert.equal(clinicalCodeRole({ semanticTag: tag }), 'other');
  }
  assert.equal(isClinicalFinding({ conceptId: '123456', ancestorIds: ['404684003'] }), true);
  assert.equal(isClinicalFinding({ semanticTag: 'finding', active: false }), false);
});

test('high-confidence drugs, procedures, events and unknown types cannot become principal or comorbidities', () => {
  const nonDiagnoses = ['clinical drug', 'substance', 'procedure', 'event', 'observable entity', 'body structure', 'unknown'];
  const entries = nonDiagnoses.map((tag, index) => entry(String(100000 + index), tag));
  entries.push(entry('44054006', 'trastorno', { confidencePct: 20, section: 'history' }));
  entries.push(entry('709044004', 'disorder', { confidencePct: 10, section: 'history' }));
  entries.push(entry('49727002', 'hallazgo', { confidencePct: 10, section: 'history' }));
  const proposal = computeDiagnosisProposal(entries);
  assert.equal(proposal.principal.conceptId, '44054006');
  assert.deepEqual(proposal.comorbidities.map(item => item.conceptId), ['709044004']);
  assert.deepEqual(proposal.symptoms.map(item => item.conceptId), ['49727002']);
  assert.equal(proposal.explanation.excluded.filter(item => item.reason === 'not-a-clinical-finding').length, nonDiagnoses.length);
  assert.deepEqual(computePrimaryDiagnosisCandidates(entries, { targetContext: 'Procedure.code' }).map(item => item.conceptId).sort(), ['44054006', '49727002', '709044004']);
});

test('medication-only notes abstain and a symptom can lead when no disorder is documented', () => {
  assert.equal(computeDiagnosisProposal([entry('100000', 'clinical drug')]).principal, null);
  assert.equal(computeDiagnosisProposal([entry('49727002', 'finding')]).principal.conceptId, '49727002');
  assert.equal(computeDiagnosisProposal([entry('44054006', 'disorder', { assertion: 'historical' })]).principal, null);
});

test('LLM suggestions and reviewer candidate swaps obey concept type and patient context', () => {
  const condition = { conceptId: '44054006', semanticTag: 'disorder' };
  const medication = { conceptId: '100000', semanticTag: 'clinical drug' };
  const mention = { mentionId: 'm1', assertion: 'present', subject: 'patient', candidates: [condition, medication] };
  assert.equal(isPrincipalMention(mention, condition), true);
  assert.equal(isPrincipalMention(mention, medication), false);
  for (const assertion of ['absent', 'planned', 'historical', 'suspected']) {
    assert.equal(isPrincipalMention({ ...mention, assertion }, condition), false);
  }
  assert.equal(isPrincipalMention({ ...mention, subject: 'family' }, condition), false);
  assert.deepEqual([...eligiblePrimaryConceptIds([mention])], ['44054006']);
  assert.deepEqual([...eligiblePrimaryConceptIds([mention], [{ mentionId: 'm1', conceptId: '100000' }])], []);
  assert.deepEqual([...eligiblePrimaryConceptIds([mention], [{ mentionId: 'm1', conceptId: 'none' }])], []);
  const swapped = entry('44054006', 'disorder', { selectedCandidate: medication });
  assert.equal(computeDiagnosisProposal([swapped]).principal, null);
});
