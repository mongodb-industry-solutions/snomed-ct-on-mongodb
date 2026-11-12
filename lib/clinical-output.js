import {clinicalAttributes,discussionOnly} from './clinical-fields.js';
// FHIR R4 previews preserve reviewed clinical context and action state.
export function codingToFhirResource(c) {
  c={...c,attributes:clinicalAttributes(c.attributes)};
  const resource = resourceForCoding(c);
  if (!resource) return null;
  const context = [c.phrase ? `Source: ${c.phrase}` : '',
    ...Object.entries(c.attributes || {}).map(([key,value]) => `${key.replace(/_/g,' ')}: ${typeof value === 'object' ? JSON.stringify(value) : String(value)}`),
    ...(c.sourceSpans||[]).map(s=>`Evidence: ${s.text||''}`)
  ].filter(Boolean).join('; ');
  return context ? {...resource,note:[{text:context}]} : resource;
}

function resourceForCoding(c) {
  if(discussionOnly(c))return null;
  const code = { coding: [{ system: 'http://snomed.info/sct', code: c.conceptId, display: c.term }], text: c.term };
  const subject = { reference: 'Patient/example' };
  const site=c.attributes?.site;
  const bodySite=site?{bodySite:[{text:[c.attributes?.laterality,site].filter(Boolean).join(' ')}]}:{};
  const future = c.assertion === 'planned' || ['planned', 'conditional'].includes(c.workflow);
  if (c.subject === 'family') {
    const relationship = c.attributes?.familyRelationship || c.attributes?.relationship;
    return { resourceType:'FamilyMemberHistory', status:'partial', patient:subject, relationship:{text:relationship?String(relationship):'Relative not specified'}, condition:[{code}] };
  }
  if(c.kind==='observation'||c.codeRole==='observation'){
    const raw=c.attributes?.value??c.attributes?.result;
    const quantity=String(raw??'').match(/^(-?\d+(?:\.\d+)?)\s*(%|mmHg)?$/);
    const bp=String(raw??'').match(/^(\d+(?:\.\d+)?)\s*\/\s*(\d+(?:\.\d+)?)\s*mmHg$/i);
    const value=bp?{component:['systolic blood pressure','diastolic blood pressure'].map((text,i)=>({code:{text},valueQuantity:{value:Number(bp[i+1]),unit:'mmHg',system:'http://unitsofmeasure.org',code:'mm[Hg]'}}))}
      :quantity?{valueQuantity:{value:Number(quantity[1]),...(quantity[2]?{unit:quantity[2],system:'http://unitsofmeasure.org',code:quantity[2]==='mmHg'?'mm[Hg]':quantity[2]}:{})}}
      :raw!=null?{valueString:String(raw)}:{valueBoolean:c.assertion!=='absent'};
    return {resourceType:'Observation',status:c.workflow==='completed'?'final':'unknown',code,subject,...(site?{bodySite:bodySite.bodySite[0]}:{}),...value};
  }
  if (c.codeRole === 'procedure' || c.codeRole === 'test' || c.codeRole === 'referral') {
    if (future) return { resourceType:'ServiceRequest', status:'draft', intent:'proposal', code, subject,...bodySite };
    return { resourceType:'Procedure', status:c.workflow === 'completed' ? 'completed' : 'unknown', code, subject,...bodySite };
  }
  if (c.codeRole === 'medication') {
    const a=c.attributes||{},quantity=String(a.dose||'').match(/^(\d+(?:\.\d+)?)\s*(mg|g|mL)$/i);
    const dosage=[a.route,a.dose,a.frequency].some(Boolean)?[{text:[a.dose,a.route,a.frequency].filter(Boolean).join('; '),...(a.route?{route:{text:String(a.route)}}:{}),...(a.frequency?{timing:{code:{text:String(a.frequency)}}}:{}),...(quantity?{doseAndRate:[{doseQuantity:{value:Number(quantity[1]),unit:quantity[2]}}]}:{})}]:null;
    if (future) return { resourceType:'MedicationRequest', status:'draft', intent:'proposal', medicationCodeableConcept:code, subject,...(dosage?{dosageInstruction:dosage}:{}) };
    return { resourceType:'MedicationStatement', status:c.workflow==='completed'?'completed':['current','continuation'].includes(c.workflow) ? 'active' : 'unknown', medicationCodeableConcept:code, subject,...(dosage?{dosage}:{}) };
  }
  if (c.codeRole !== 'diagnosis') return null;
  const verification = c.assertion === 'absent' ? 'refuted' : c.assertion === 'suspected' ? 'provisional' : 'confirmed';
  const current = c.assertion === 'present' && c.temporality === 'current';
  return { resourceType:'Condition', code, subject,...bodySite,...(c.attributes?.stage?{stage:[{summary:{text:String(c.attributes.stage)}}]}:{}),
    ...(c.clinicalStatus==='resolved'||current ? { clinicalStatus:{coding:[{system:'http://terminology.hl7.org/CodeSystem/condition-clinical',code:c.clinicalStatus==='resolved'?'resolved':'active'}]} } : {}),
    verificationStatus:{coding:[{system:'http://terminology.hl7.org/CodeSystem/condition-ver-status',code:verification}]}
  };
}
