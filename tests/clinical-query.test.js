import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseClinicalQuery, parseStructuredClinicalQuery, validateClinicalPlan, clinicalClauses, clinicalConceptIds, compileClinicalFilter } from '../lib/clinical-query.js';
import { buildBroadClinicalScope } from '../lib/clinical-scope.js';
import { CLINICAL_SEARCH_CASES } from '../lib/clinical-search-examples.js';
import { generateSyntheticNotes } from '../lib/demo-clinical-corpus.js';
import { translationParameters } from '../lib/code-mappings.js';
test('AND/OR precedence and exclusions compile to coding predicates, never note text', () => {
  const plan = parseClinicalQuery('Find notes with diabetes and kidney disease or heart failure but without pneumonia');
  assert.equal(plan.any.length, 2);
  assert.deepEqual(clinicalClauses(plan).map(c => [c.phrase, c.exclude]), [['diabetes',false],['kidney disease',false],['heart failure',false],['pneumonia',true]]);
  const query = compileClinicalFilter(plan,{c1:'73211009',c2:'709044004',c3:'84114007',c4:'233604007'},'hospital');
  assert.equal(query.tenantId,'hospital');
  assert.equal(query.$or[0].$and[0].codings.$elemMatch.ancestorIds,'73211009');
  assert.equal(query.$or[1].$and[1].$nor[0].codings.$elemMatch.assertion,'present');
  assert.equal(JSON.stringify(query).includes('text'),false);
});
test('documented absence is different from excluding a present diagnosis', () => {
  const plan=parseClinicalQuery('Find notes with documented absence of pneumonia');
  const clause=clinicalClauses(plan)[0];
  assert.equal(clause.assertion,'absent');assert.equal(clause.exclude,false);
});
test('clinical context belongs to the same coding, and exact lookup is selectable', () => {
  const query=compileClinicalFilter(validateClinicalPlan({phrase:'diabetes'}),{c1:'73211009'},'t',false);
  assert.deepEqual(query.codings.$elemMatch,{conceptId:'73211009',assertion:'present',subject:'patient',status:'accepted'});
});
test('reject unresolved codes, empty boolean groups, excessive clauses and arbitrary operators', () => {
  assert.throws(()=>validateClinicalPlan({all:[]}));
  assert.throws(()=>validateClinicalPlan({all:Array.from({length:11},()=>({phrase:'diabetes'}))}));
  assert.throws(()=>validateClinicalPlan({$where:'malicious'}));
  assert.throws(()=>compileClinicalFilter(validateClinicalPlan({phrase:'diabetes'}),{c1:{$gt:0}},'t'));
});
test('FHIR preserves conditional rules, map groups and directional ambiguity', () => {
  const fhir=translationParameters([{targetSystem:'urn:test:icd',targetCode:'A00',mapping:{refsetId:'test',mapGroup:2,mapPriority:1,mapRule:'IFA AGE < 18',mapAdvice:'Check age'}}]);
  const match=fhir.parameter.find(p=>p.name==='match');
  assert.equal(match.part.find(p=>p.name==='equivalence').valueCode,'relatedto');
  assert.equal(match.extension.find(e=>e.url==='urn:snomed-demo:map-group').valueInteger,2);
  assert.match(fhir.parameter.find(p=>p.name==='message').valueString,/Conditional/);
});
test('broad hypertension includes the general family despite a higher-ranked specific subtype', () => {
  const scope=buildBroadClinicalScope('hypertension',[
    {conceptId:'59621000',term:'Essential hypertension',descriptionTerms:['Essential hypertension','Primary hypertension'],ancestorIds:['38341003'],rerankScore:0.8},
    {conceptId:'38341003',term:'Hypertensive disorder',descriptionTerms:['Hypertension'],ancestorIds:[],rerankScore:0.7},
    {conceptId:'31992008',term:'Secondary hypertension',descriptionTerms:['Secondary hypertension'],ancestorIds:['38341003'],rerankScore:0.7}
  ]);
  assert.deepEqual(scope.conceptIds,['38341003']);
  assert.equal(scope.includeDescendants,true);
});
test('broad scopes preserve multiple concept families and remove redundant subtypes', () => {
  const scope=buildBroadClinicalScope('renal impairment',[
    {conceptId:'90708001',term:'Kidney disease',descriptionTerms:['Renal impairment disorder'],ancestorIds:[],rerankScore:0.8},
    {conceptId:'709044004',term:'Chronic kidney disease',ancestorIds:['90708001'],rerankScore:0.79},
    {conceptId:'12345678',term:'Abnormal renal function',descriptionTerms:['Renal impairment finding'],ancestorIds:[],rerankScore:0.75},
    {conceptId:'87654321',term:'Unrelated suggestion',ancestorIds:[],rerankScore:0.3}
  ]);
  assert.deepEqual(scope.conceptIds,['90708001','12345678']);
});
test('explicitly specific requests retain their meaning and exclude related procedures', () => {
  const scope=buildBroadClinicalScope('type 2 diabetes mellitus',[
    {conceptId:'44054006',term:'Type 2 diabetes mellitus',descriptionTerms:['Type 2 diabetes mellitus'],ancestorIds:['73211009'],rerankScore:0.9},
    {conceptId:'73211009',term:'Diabetes mellitus',descriptionTerms:['Diabetes mellitus'],ancestorIds:[],rerankScore:0.85}
  ]);
  assert.deepEqual(scope.conceptIds,['44054006']);
  const cancer=buildBroadClinicalScope('breast cancer',[
    {conceptId:'254837009',term:'Malignant neoplasm of breast',descriptionTerms:['Breast cancer'],ancestorIds:[],rerankScore:0.87},
    {conceptId:'392021009',term:'Lumpectomy',descriptionTerms:['Breast lumpectomy'],ancestorIds:[],rerankScore:0.7}
  ]);
  assert.deepEqual(cancer.conceptIds,['254837009']);
});
test('nonliteral glucose phrasing includes its family without inferring related diabetes', () => {
  const scope=buildBroadClinicalScope('azúcar alta en sangre',[
    {conceptId:'80394007',term:'Hiperglucemia',descriptionTerms:['Hiperglucemia'],semanticTag:'trastorno',ancestorIds:[],rerankScore:0.8},
    {conceptId:'73211009',term:'Diabetes mellitus',descriptionTerms:['Diabetes mellitus'],semanticTag:'trastorno',ancestorIds:[],rerankScore:0.76},
    {conceptId:'12345678',term:'Subtipo de hiperglucemia',descriptionTerms:['Subtipo de hiperglucemia'],semanticTag:'trastorno',ancestorIds:['80394007'],rerankScore:0.75}
  ]);
  assert.deepEqual(scope.conceptIds,['80394007']);
});
test('a close broader family can cover a literal subtype supported by the source hierarchy', () => {
  const scope=buildBroadClinicalScope('enfermedad de las arterias coronarias',[
    {conceptId:'414545008',term:'Enfermedad coronaria',descriptionTerms:['Enfermedad coronaria'],semanticTag:'trastorno',ancestorIds:[],rerankScore:0.82},
    {conceptId:'53741008',term:'Arteriosclerosis coronaria',descriptionTerms:['Arteriosclerosis coronaria'],semanticTag:'trastorno',ancestorIds:['414024009'],rerankScore:0.81},
    {conceptId:'371803003',term:'Enfermedad de múltiples arterias coronarias',descriptionTerms:['Enfermedad de múltiples arterias coronarias'],semanticTag:'trastorno',ancestorIds:['53741008','414024009'],rerankScore:0.80},
    {conceptId:'414024009',term:'Trastorno de arteria coronaria',descriptionTerms:['Trastorno de arteria coronaria'],semanticTag:'trastorno',ancestorIds:[],rerankScore:0.77}
  ]);
  assert.deepEqual(scope.conceptIds,['414545008','53741008']);
});
test('each broad phrase matches any of its families while retaining AND/OR, exclusions and coding context', () => {
  const plan=parseClinicalQuery('Find notes with diabetes and kidney disease or heart failure but without hypertension');
  const filter=compileClinicalFilter(plan,{c1:['73211009','405749004'],c2:['90708001'],c3:['84114007'],c4:['38341003','12345678']},'hospital');
  assert.deepEqual(filter.$or[0].$and[0].codings.$elemMatch,{ancestorIds:{$in:['73211009','405749004']},assertion:'present',subject:'patient',status:'accepted'});
  assert.deepEqual(filter.$or[1].$and[1].$nor[0].codings.$elemMatch.ancestorIds,{$in:['38341003','12345678']});
  assert.equal(JSON.stringify(filter).includes('text'),false);
  const exact=compileClinicalFilter(validateClinicalPlan({phrase:'kidney disease'}),{c1:['90708001','709044004']},'hospital',false);
  assert.deepEqual(exact.codings.$elemMatch.conceptId,{$in:['90708001','709044004']});
});
test('validate bounded code sets and reject unsafe or unresolved scopes', () => {
  assert.deepEqual(clinicalConceptIds(['73211009','73211009']),['73211009']);
  for (const value of [[],Array(1),['73211009',{$gt:0}],Array(41).fill('73211009'),['invalid']]) assert.throws(()=>clinicalConceptIds(value));
  assert.deepEqual(buildBroadClinicalScope('unrecognized phrase',[{conceptId:'12345678',term:'Unrelated',rerankScore:0.1}]).conceptIds,[]);
});
test('missing rerank scores cannot turn unrelated retrieval results into a clinical scope', () => {
  const unrelated=[{conceptId:'12345678',term:'Unrelated finding',descriptionTerms:['Unrelated finding'],semanticTag:'finding',ancestorIds:[]},
    {conceptId:'87654321',term:'Unrelated subtype',descriptionTerms:['Unrelated subtype'],semanticTag:'finding',ancestorIds:['12345678']}];
  assert.deepEqual(buildBroadClinicalScope('unrecognized request',unrelated).conceptIds,[]);
  const supported={conceptId:'56789012',term:'Persistent renal impairment',descriptionTerms:['Persistent renal impairment'],semanticTag:'finding',ancestorIds:[]};
  assert.deepEqual(buildBroadClinicalScope('renal impairment',[...unrelated,supported]).conceptIds,[supported.conceptId]);
});
test('parentheses preserve alternatives inside conjunctions, and malformed grouping is rejected', () => {
  const plan=parseClinicalQuery('Find notes with (diabetes or heart failure) and kidney disease but without pneumonia');
  assert.equal(plan.all[0].any.length,2);
  assert.deepEqual(clinicalClauses(plan).map(clause=>clause.phrase),['diabetes','heart failure','kidney disease','pneumonia']);
  assert.equal(clinicalClauses(plan)[3].exclude,true);
  for(const query of ['diabetes and','diabetes or ()','(diabetes or heart failure','diabetes)']) assert.throws(()=>parseClinicalQuery(query));
});
test('age, sex and encounter recency compile separately from the same-coding clinical predicate', () => {
  const plan=parseClinicalQuery('Find notes from the last 30 days for women over 60 with breast cancer and hypertension');
  assert.deepEqual(plan.filters,{minAge:61,sinceDays:30,sex:'female'});
  const now=new Date('2026-10-29T12:00:00Z');
  const filter=compileClinicalFilter(plan,{c1:['254837009'],c2:['38341003']},'demo',true,now);
  assert.deepEqual(filter['patient.age'],{$gte:61});assert.equal(filter['patient.sex'],'female');
  assert.equal(filter['encounter.occurredAt'].$gte.toISOString(),'2026-09-29T12:00:00.000Z');
  assert.equal(filter['encounter.occurredAt'].$lte.toISOString(),now.toISOString());
  assert.equal(filter.$and[0].codings.$elemMatch.assertion,'present');
  assert.deepEqual(parseClinicalQuery('Busca notas de mujeres de 40 a 70 años con diabetes e hipertensión').filters,{minAge:40,maxAge:70,sex:'female'});
});
test('past and family history, suspected versus confirmed, and planned procedures retain their context', () => {
  const plan=parseClinicalQuery('heart failure and a history of myocardial infarction and a family history of breast cancer and planned radiotherapy');
  assert.deepEqual(clinicalClauses(plan).map(clause=>[clause.assertion,clause.subject]),[['present','patient'],['historical','patient'],['present','family'],['planned','patient']]);
  const suspected=parseClinicalQuery('suspected pneumonia but without confirmed pneumonia');
  assert.deepEqual(clinicalClauses(suspected).map(clause=>[clause.phrase,clause.assertion,clause.exclude]),[['pneumonia','suspected',false],['pneumonia','present',true]]);
});
test('reject arbitrary metadata operators, reversed ages and unbounded date filters', () => {
  for(const filters of [{minAge:{$gt:60}},{minAge:90,maxAge:40},{sinceDays:0},{sinceDays:5000},{sex:'any'},{'$where':'unsafe'}])
    assert.throws(()=>validateClinicalPlan({phrase:'diabetes',filters}));
});
test('all English and Spanish search examples have the same context and filters', () => {
  for(const example of CLINICAL_SEARCH_CASES) {
    const english=parseClinicalQuery(example.en),spanish=parseClinicalQuery(example.es);
    assert.deepEqual(english.filters,spanish.filters,example.id);
    const context=plan=>clinicalClauses(plan).map(({assertion,subject,exclude})=>({assertion,subject,exclude}));
    assert.deepEqual(context(english),context(spanish),example.id);
  }
});
test('structured examples use the fast planner while freer prose is left to the language model', () => {
  for(const example of CLINICAL_SEARCH_CASES)for(const language of ['en','es']) assert.deepEqual(parseStructuredClinicalQuery(example[language]),parseClinicalQuery(example[language]),example.id);
  assert.equal(parseStructuredClinicalQuery('Which records describe patients taking metformin with impaired kidney function?'),null);
  assert.equal(parseStructuredClinicalQuery('Find notes with diabetes requiring insulin'),null);
  assert.equal(parseStructuredClinicalQuery('Find notes with heart failure with reduced ejection fraction'),null);
});
test('synthetic notes have stable IDs, diverse dates and demographics, and coded assertion evidence', () => {
  const now=new Date('2026-10-29T12:00:00Z'),notes=generateSyntheticNotes({now});
  assert.equal(notes.length,512);assert.equal(new Set(notes.map(note=>note._id)).size,512);
  assert.deepEqual(generateSyntheticNotes({now}),notes);
  assert.equal(notes.filter(note=>note.languageCode==='en').length,256);
  assert.ok(notes.some(note=>note.patient.age>65&&note.encounter.occurredAt<new Date('2026-08-01')));
  for(const note of notes) {
    assert.equal(note.synthetic,true);assert.ok(note.text.includes(note.languageCode==='en'?'Synthetic':'sintética'));
    for(const coding of note.codings) { assert.ok(note.text.includes(coding.display));assert.equal(coding.status,'accepted'); }
  }
  const screening=notes.find(note=>note.profileId==='breast-screening'&&note.languageCode==='en');
  assert.ok(screening.codings.some(coding=>coding.conceptId==='254837009'&&coding.subject==='family'&&coding.assertion==='present'));
  assert.ok(screening.codings.some(coding=>coding.conceptId==='254837009'&&coding.subject==='patient'&&coding.assertion==='absent'));
});
