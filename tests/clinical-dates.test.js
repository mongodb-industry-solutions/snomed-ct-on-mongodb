import { test } from 'node:test';
import assert from 'node:assert/strict';
import { clinicalDemoReferenceDate, resolveClinicalDateContext } from '../lib/clinical-date-context.js';
import { parseClinicalQuery, compileClinicalFilter } from '../lib/clinical-query.js';
import { generateSyntheticNotes } from '../lib/demo-clinical-corpus.js';

const reference = '2026-10-29T12:00:00.000Z';
const corpus = { demoReferenceDate: reference, demoReleaseId: '20260601' };
test('the generated dataset carries a fixed reference, including a stable legacy fallback', () => {
  const notes = generateSyntheticNotes({ now: new Date(reference) });
  assert.ok(notes.every(note => note.demoReferenceDate.toISOString() === reference));
  const latest = new Date(Math.max(...notes.map(note => note.encounter.occurredAt.getTime())));
  assert.equal(clinicalDemoReferenceDate(null,latest).toISOString(),reference);
  assert.equal(clinicalDemoReferenceDate(reference,new Date('2040-01-01')).toISOString(),reference);
  assert.equal(clinicalDemoReferenceDate(null,null),null);
});
test('the demo time window stays fixed years later while other notes retain real recency', () => {
  const plan = parseClinicalQuery('Find notes from the last 90 days with diabetes or heart failure');
  const codes = { c1: ['73211009'], c2: ['84114007'] };
  const now = new Date('2026-10-30T18:00:00Z'), later = new Date('2040-10-30T18:00:00Z');
  const compile = date => compileClinicalFilter(plan,codes,'demo',true,date,resolveClinicalDateContext(corpus,'demo',date));
  const current = compile(now), future = compile(later);
  assert.deepEqual(future.$and[0].$or[0],current.$and[0].$or[0]);
  assert.equal(future.$and[0].$or[0]['encounter.occurredAt'].$gte.toISOString(),'2026-07-31T12:00:00.000Z');
  assert.equal(future.$and[0].$or[0]['encounter.occurredAt'].$lte.toISOString(),reference);
  assert.equal(future.$and[0].$or[0].releaseId,'20260601');
  assert.equal(future.$and[0].$or[1]['encounter.occurredAt'].$lte.toISOString(),later.toISOString());
  assert.deepEqual(future.$and[0].$or[1].$nor,[{ synthetic: true, source: 'clinical-demo-v1', releaseId: '20260601' }]);
  assert.deepEqual(future.$or,current.$or);
});
test('today remains available, and a corpus without demo notes uses today', () => {
  const now = new Date('2040-10-30T18:00:00Z');
  const context = resolveClinicalDateContext(corpus,'today',now);
  const query = compileClinicalFilter(parseClinicalQuery('Find notes from the last 30 days with diabetes'),{c1:['73211009']},'demo',true,now,context);
  assert.equal(query['encounter.occurredAt'].$lte.toISOString(),now.toISOString());
  assert.equal(query['encounter.occurredAt'].$gte.toISOString(),'2040-09-30T18:00:00.000Z');
  assert.equal(resolveClinicalDateContext({},'demo',now).mode,'today');
  assert.throws(() => resolveClinicalDateContext(corpus,'invalid',now));
});
