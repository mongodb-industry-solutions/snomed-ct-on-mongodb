import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fixedDemoTenantId, optionalVersion } from '../lib/demo-request-validation.js';
import { validateClinicalPlan } from '../lib/clinical-query.js';
import { generateSyntheticNotes, legacySyntheticNoteId } from '../lib/demo-clinical-corpus.js';

test('demo records cannot be selected through another tenant or Mongo operator', () => {
  assert.equal(fixedDemoTenantId(undefined), 'demo-hospital');
  assert.equal(fixedDemoTenantId('demo-hospital'), 'demo-hospital');
  for (const value of ['other-hospital', { $ne: 'demo-hospital' }, ['demo-hospital']]) assert.throws(() => fixedDemoTenantId(value));
});

test('mapping and graph versions must be bounded scalar strings', () => {
  assert.equal(optionalVersion(' 20260601 ', 'releaseId'), '20260601');
  assert.equal(optionalVersion(undefined, 'version'), '');
  for (const name of ['releaseId', 'sourceVersion', 'targetVersion', 'version']) {
    for (const value of [{ $ne: '20260601' }, ['20260601'], 20260601, 'a'.repeat(81)]) assert.throws(() => optionalVersion(value, name));
  }
});

test('ambiguous or malformed Boolean nodes cannot silently lose a branch', () => {
  assert.throws(() => validateClinicalPlan({ all: [{ phrase: 'diabetes' }], any: [{ phrase: 'heart failure' }] }));
  assert.throws(() => validateClinicalPlan({ all: 'diabetes', phrase: 'heart failure' }));
  assert.throws(() => validateClinicalPlan({ all: [{ any: [{ phrase: 'diabetes' }], all: [{ phrase: 'heart failure' }] }] }));
});
test('Boolean groups cannot discard leaf condition fields', () => {
  for(const key of ['all','any'])for(const leaf of [{phrase:'heart failure'},{assertion:'absent'},{subject:'family'},{exclude:true}])
    assert.throws(()=>validateClinicalPlan({[key]:[{phrase:'diabetes'}],...leaf}));
  assert.deepEqual(validateClinicalPlan({all:[{phrase:'diabetes'}],filters:{minAge:65}}).filters,{minAge:65});
});

test('synthetic corpus identities stay stable in the default tenant and cannot collide across tenants', () => {
  const options = { now: new Date('2026-10-29T12:00:00Z'), releaseId: '20260601' };
  const legacy = generateSyntheticNotes(options);
  assert.match(legacy[0]._id, /^clinical-demo-v1:20260601:/);
  assert.equal(legacySyntheticNoteId(legacy[0]), legacy[0]._id);
  const other = generateSyntheticNotes({ ...options, tenantId: 'hospital:one' });
  assert.equal(legacySyntheticNoteId(other[0]), legacy[0]._id);
  const third = generateSyntheticNotes({ ...options, tenantId: 'hospital%3Aone' });
  const ids = [...legacy, ...other, ...third].map(note => note._id);
  assert.equal(new Set(ids).size, ids.length);
  assert.deepEqual(other.map(note => note._id), generateSyntheticNotes({ ...options, tenantId: 'hospital:one' }).map(note => note._id));
});
