import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mergeClinicalCodings} from '../lib/clinical-fields.js';
import {codingToFhirResource} from '../lib/clinical-output.js';
const base={conceptId:'100001',term:'documented fact',assertion:'present',subject:'patient',temporality:'current',workflow:'current'};
test('repeated diagnoses retain later duration and source evidence',()=>{
 const merged=mergeClinicalCodings([{...base,phrase:'first occurrence',attributes:{}},{...base,phrase:'second occurrence',attributes:{duration:'12 years'}}]);
 assert.equal(merged.length,1);assert.equal(merged[0].attributes.duration,'12 years');assert.equal(merged[0].sourceSpans.length,2);
 assert.equal(mergeClinicalCodings([{...base,attributes:{value:'35%'}},{...base,attributes:{value:'40%'}}]).length,2);
 assert.equal(mergeClinicalCodings([{...base,role:'secondary'},{...base,role:'principal'}])[0].role,'principal');
});
test('a hidden current ancestor is not saved as an extra diagnosis, and its evidence survives',()=>{
 const parent={...base,kind:'condition',role:'secondary',phrase:'generic occurrence',attributes:{duration:'12 years'}};
 const child={...base,conceptId:'100002',kind:'condition',role:'principal',ancestorIds:['100001'],phrase:'specific occurrence',attributes:{}};
 const merged=mergeClinicalCodings([parent,child]);
 assert.equal(merged.length,1);assert.equal(merged[0].conceptId,'100002');
 assert.equal(merged[0].sourceSpans.length,2);assert.equal(merged[0].attributes.duration,'12 years');
 assert.equal(mergeClinicalCodings([{...parent,assertion:'suspected'},child]).length,2);
 assert.equal(mergeClinicalCodings([{...parent,temporality:'historical'},child]).length,2);
 assert.equal(mergeClinicalCodings([{...parent,role:'principal'},child]).length,2);
});
test('different relatives never collapse into one family fact',()=>{
 assert.equal(mergeClinicalCodings([{...base,subject:'family',attributes:{family_relationship:'father'}},{...base,subject:'family',attributes:{relationship:'mother'}}]).length,2);
});
test('measurement values remain structured observations in either language',()=>{
 const fraction=codingToFhirResource({...base,kind:'observation',attributes:{valor:'35%'}});
 assert.equal(fraction.resourceType,'Observation');assert.equal(fraction.valueQuantity.value,35);assert.equal(fraction.valueQuantity.code,'%');
 const pressure=codingToFhirResource({...base,kind:'observation',attributes:{value:'158/92 mmHg'}});
 assert.deepEqual(pressure.component.map(c=>c.valueQuantity.value),[158,92]);
});
test('family relationship normalization supplies the required FHIR field',()=>{
 const family=codingToFhirResource({...base,subject:'family',attributes:{'family relationship':'father'}});
 assert.equal(family.relationship.text,'father');
});
test('resolved presenting symptoms stay resolved and discussion never becomes an order',()=>{
 const condition=codingToFhirResource({...base,codeRole:'diagnosis',clinicalStatus:'resolved'});
 assert.equal(condition.clinicalStatus.coding[0].code,'resolved');
 assert.equal(codingToFhirResource({...base,codeRole:'procedure',assertion:'planned',workflow:'discussion'}),null);
 assert.equal(codingToFhirResource({...base,codeRole:'medication',assertion:'planned',attributes:{planned_action:'discussion'}}),null);
});
test('documented medication dose and route survive a conditional proposal without inventing extra instructions',()=>{
 const r=codingToFhirResource({...base,codeRole:'medication',assertion:'planned',workflow:'conditional',attributes:{dosis:'500 mg',via:'oral',condition:'if renal function remains stable'}});
 assert.equal(r.dosageInstruction[0].route.text,'oral');
 assert.equal(r.dosageInstruction[0].doseAndRate[0].doseQuantity.value,500);
 assert.equal(r.dosageInstruction[0].timing,undefined);
 assert.match(r.note[0].text,/if renal function remains stable/);
});
