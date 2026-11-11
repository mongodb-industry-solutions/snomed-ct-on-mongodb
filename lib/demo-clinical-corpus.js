// Synthetic facts are authored first; prose is rendered from those facts.
// The seeder validates every SCTID and stamps the licensed release's ancestry.
export const SYNTHETIC_CORPUS_VERSION = 'clinical-demo-v1';
export const SYNTHETIC_CONCEPTS = {
  diabetes2: { id: '44054006', en: ['type 2 diabetes mellitus', 'type 2 diabetes'], es: ['diabetes mellitus tipo 2', 'diabetes tipo 2'] },
  diabetes1: { id: '46635009', en: ['type 1 diabetes mellitus', 'type 1 diabetes'], es: ['diabetes mellitus tipo 1', 'diabetes tipo 1'] },
  hyperglycemia: { id: '80394007', en: ['hyperglycemia', 'high blood glucose'], es: ['hiperglucemia', 'glucosa elevada en sangre'] },
  kidney: { id: '709044004', en: ['chronic kidney disease', 'chronic renal disease'], es: ['enfermedad renal crónica', 'enfermedad crónica del riñón'] },
  kidney3: { id: '433144002', en: ['stage 3 chronic kidney disease', 'chronic kidney disease stage 3'], es: ['enfermedad renal crónica estadio 3', 'enfermedad renal crónica de grado 3'] },
  nephropathy: { id: '127013003', en: ['diabetic nephropathy', 'kidney disease due to diabetes'], es: ['nefropatía diabética', 'enfermedad renal debida a diabetes'] },
  neuropathy: { id: '424736006', en: ['diabetic peripheral neuropathy'], es: ['neuropatía periférica diabética'] },
  retinopathy: { id: '4855003', en: ['diabetic retinopathy'], es: ['retinopatía diabética'] },
  footUlcer: { id: '95345008', en: ['foot ulcer'], es: ['úlcera del pie'] },
  heartFailure: { id: '84114007', en: ['heart failure', 'cardiac failure'], es: ['insuficiencia cardíaca', 'fallo cardíaco'] },
  chronicHeartFailure: { id: '441481004', en: ['chronic systolic heart failure'], es: ['insuficiencia cardíaca sistólica crónica'] },
  acuteHeartFailure: { id: '56675007', en: ['acute heart failure'], es: ['insuficiencia cardíaca aguda'] },
  hypertension: { id: '59621000', en: ['essential hypertension', 'primary hypertension'], es: ['hipertensión esencial', 'hipertensión arterial primaria'] },
  secondaryHypertension: { id: '31992008', en: ['secondary hypertension'], es: ['hipertensión secundaria'] },
  atrialFibrillation: { id: '49436004', en: ['atrial fibrillation'], es: ['fibrilación auricular'] },
  infarction: { id: '22298006', en: ['myocardial infarction', 'heart attack'], es: ['infarto de miocardio', 'infarto cardíaco'] },
  acuteInfarction: { id: '57054005', en: ['acute myocardial infarction'], es: ['infarto agudo de miocardio'] },
  coronaryDisease: { id: '53741008', en: ['coronary artery disease'], es: ['enfermedad de las arterias coronarias'] },
  hyperlipidemia: { id: '55822004', en: ['hyperlipidemia'], es: ['hiperlipidemia'] },
  asthma: { id: '195967001', en: ['asthma'], es: ['asma'] },
  copd: { id: '13645005', en: ['chronic obstructive pulmonary disease', 'COPD'], es: ['enfermedad pulmonar obstructiva crónica', 'EPOC'] },
  pneumonia: { id: '233604007', en: ['pneumonia'], es: ['neumonía'] },
  dyspnea: { id: '267036007', en: ['shortness of breath', 'dyspnea'], es: ['dificultad para respirar', 'disnea'] },
  fever: { id: '386661006', en: ['fever'], es: ['fiebre'] },
  cough: { id: '49727002', en: ['cough'], es: ['tos'] },
  chestPain: { id: '29857009', en: ['chest pain'], es: ['dolor torácico'] },
  breastCancer: { id: '254837009', en: ['breast cancer', 'malignant tumor of breast'], es: ['cáncer de mama', 'tumor maligno de mama'] },
  ductalCancer: { id: '408643008', en: ['invasive ductal carcinoma of breast'], es: ['carcinoma ductal infiltrante de mama'] },
  metastasis: { id: '128462008', en: ['metastatic cancer', 'metastatic disease'], es: ['cáncer metastásico', 'enfermedad metastásica'] },
  lungCancer: { id: '448993007', en: ['lung carcinoma'], es: ['carcinoma de pulmón'] },
  metformin: { id: '372567009', en: ['metformin'], es: ['metformina'], target: 'MedicationStatement.medicationCodeableConcept' },
  insulin: { id: '67866001', en: ['insulin'], es: ['insulina'], target: 'MedicationStatement.medicationCodeableConcept' },
  furosemide: { id: '387475002', en: ['furosemide'], es: ['furosemida'], target: 'MedicationStatement.medicationCodeableConcept' },
  aspirin: { id: '387458008', en: ['aspirin'], es: ['ácido acetilsalicílico'], target: 'MedicationStatement.medicationCodeableConcept' },
  atorvastatin: { id: '373444002', en: ['atorvastatin'], es: ['atorvastatina'], target: 'MedicationStatement.medicationCodeableConcept' },
  anticoagulant: { id: '372862008', en: ['an anticoagulant'], es: ['un anticoagulante'], target: 'MedicationStatement.medicationCodeableConcept' },
  lumpectomy: { id: '392021009', en: ['breast lumpectomy'], es: ['tumorectomía de mama'], target: 'Procedure.code' },
  radiotherapy: { id: '1287742003', en: ['radiotherapy'], es: ['radioterapia'], target: 'Procedure.code' },
  bypass: { id: '232717009', en: ['coronary artery bypass graft'], es: ['bypass de arterias coronarias'], target: 'Procedure.code' },
  coronaryIntervention: { id: '415070008', en: ['percutaneous coronary intervention'], es: ['intervención coronaria percutánea'], target: 'Procedure.code' },
  electrocardiogram: { id: '29303009', en: ['electrocardiogram'], es: ['electrocardiograma'], target: 'Procedure.code' },
  mammography: { id: '71651007', en: ['mammography'], es: ['mamografía'], target: 'Procedure.code' },
  coreBiopsy: { id: '9911007', en: ['core needle biopsy'], es: ['biopsia con aguja gruesa'], target: 'Procedure.code' },
  embolism: { id: '59282003', en: ['pulmonary embolism'], es: ['embolia pulmonar'] },
  postoperativePain: { id: '213299007', en: ['postoperative pain'], es: ['dolor postoperatorio'] },
  woundInfection: { id: '58126003', en: ['postoperative wound infection'], es: ['infección de herida postoperatoria'] },
  valveRegurgitation: { id: '48724000', en: ['mitral valve regurgitation'], es: ['insuficiencia de la válvula mitral'] },
  weakness: { id: '278286009', en: ['right-sided weakness'], es: ['debilidad del lado derecho'] },
  aphasia: { id: '229665008', en: ['expressive aphasia'], es: ['afasia expresiva'] },
  transientIschemia: { id: '266257000', en: ['transient ischemic attack'], es: ['accidente isquémico transitorio'] },
  syncope: { id: '271594007', en: ['syncope'], es: ['síncope'] },
  ketoacidosis: { id: '420422005', en: ['diabetic ketoacidosis'], es: ['cetoacidosis diabética'] },
  stroke: { id: '422504002', en: ['ischemic stroke'], es: ['ictus isquémico'] },
  epilepsy: { id: '84757009', en: ['epilepsy'], es: ['epilepsia'] },
  depression: { id: '35489007', en: ['depressive disorder'], es: ['trastorno depresivo'] }
};
const absent = key => ({ key, assertion: 'absent' });
const suspected = key => ({ key, assertion: 'suspected' });
const historical = key => ({ key, assertion: 'historical' });
const planned = key => ({ key, assertion: 'planned' });
const family = key => ({ key, subject: 'family' });
export const SYNTHETIC_PROFILES = [
  { id: 'diabetes-renal', specialty: 'metabolic', setting: 'outpatient', facts: ['diabetes2','kidney3','hypertension','nephropathy','hyperglycemia','metformin',absent('heartFailure')] },
  { id: 'diabetes-cardio-renal', specialty: 'metabolic', setting: 'inpatient', facts: ['diabetes2','chronicHeartFailure','kidney','hypertension','dyspnea','furosemide','insulin',absent('pneumonia')] },
  { id: 'diabetes-primary-care', specialty: 'metabolic', setting: 'primary-care', facts: ['diabetes2','hypertension','metformin',absent('kidney'),absent('heartFailure'),family('breastCancer')] },
  { id: 'type1-diabetes', specialty: 'metabolic', setting: 'outpatient', facts: ['diabetes1','hyperglycemia','retinopathy','insulin',absent('neuropathy')] },
  { id: 'diabetic-foot', specialty: 'metabolic', setting: 'outpatient', facts: ['diabetes2','neuropathy','footUlcer','insulin','hypertension',absent('heartFailure')] },
  { id: 'heart-failure-renal', specialty: 'cardiology', setting: 'emergency', facts: ['acuteHeartFailure','chronicHeartFailure','kidney3','hypertension','dyspnea','furosemide',historical('infarction'),absent('pneumonia')] },
  { id: 'heart-failure-ischemic', specialty: 'cardiology', setting: 'inpatient', facts: ['heartFailure','coronaryDisease','atrialFibrillation','hypertension',historical('infarction'),'aspirin','atorvastatin',absent('pneumonia'),absent('chestPain')] },
  { id: 'secondary-hypertension', specialty: 'cardiology', setting: 'outpatient', facts: ['secondaryHypertension','kidney3','diabetes2','hyperlipidemia','atorvastatin',absent('heartFailure')] },
  { id: 'atrial-fibrillation', specialty: 'cardiology', setting: 'outpatient', facts: ['atrialFibrillation','hypertension','dyspnea','anticoagulant',historical('infarction'),absent('heartFailure')] },
  { id: 'coronary-disease', specialty: 'cardiology', setting: 'outpatient', facts: ['coronaryDisease','hyperlipidemia','diabetes2',historical('infarction'),historical('bypass'),'aspirin','atorvastatin',absent('chestPain')] },
  { id: 'asthma-suspected-infection', specialty: 'respiratory', setting: 'emergency', facts: ['asthma','dyspnea','cough','fever',suspected('pneumonia'),absent('heartFailure')] },
  { id: 'copd-suspected-infection', specialty: 'respiratory', setting: 'emergency', facts: ['copd','cough','dyspnea',suspected('pneumonia'),absent('heartFailure'),absent('fever')] },
  { id: 'confirmed-pneumonia', specialty: 'respiratory', setting: 'inpatient', facts: ['pneumonia','fever','cough','dyspnea','copd',absent('heartFailure'),family('diabetes2')] },
  { id: 'asthma-controlled', specialty: 'respiratory', setting: 'primary-care', facts: ['asthma','hypertension',absent('dyspnea'),absent('cough'),absent('pneumonia'),family('diabetes2')] },
  { id: 'breast-localized', specialty: 'oncology', setting: 'outpatient', sex: 'female', facts: ['ductalCancer','hypertension','lumpectomy',planned('radiotherapy'),absent('metastasis'),absent('diabetes2')] },
  { id: 'breast-cardiometabolic', specialty: 'oncology', setting: 'outpatient', sex: 'female', facts: ['breastCancer','diabetes2','hypertension','metformin',absent('heartFailure'),absent('metastasis'),family('breastCancer')] },
  { id: 'breast-metastatic', specialty: 'oncology', setting: 'inpatient', sex: 'female', facts: ['breastCancer','metastasis','diabetes2','hypertension',planned('radiotherapy'),absent('heartFailure')] },
  { id: 'lung-oncology', specialty: 'oncology', setting: 'outpatient', facts: ['lungCancer','metastasis','copd','cough','dyspnea',absent('pneumonia')] },
  { id: 'stroke-follow-up', specialty: 'neurology', setting: 'outpatient', facts: [historical('stroke'),'hypertension','atrialFibrillation','diabetes2','aspirin','atorvastatin',absent('dyspnea')] },
  { id: 'epilepsy-follow-up', specialty: 'neurology', setting: 'outpatient', facts: ['epilepsy','hypertension','depression',historical('stroke'),family('diabetes2')] },
  { id: 'diabetes-depression', specialty: 'primary-care', setting: 'primary-care', facts: ['diabetes2','depression','hypertension','metformin',absent('kidney'),family('breastCancer')] },
  { id: 'renal-respiratory', specialty: 'respiratory', setting: 'emergency', facts: ['kidney3','copd','hypertension','dyspnea',suspected('pneumonia'),historical('infarction'),absent('heartFailure')] },
  { id: 'metabolic-follow-up', specialty: 'primary-care', setting: 'primary-care', facts: ['diabetes2','hypertension','metformin',historical('infarction'),absent('heartFailure'),absent('dyspnea')] },
  { id: 'cardiorespiratory-infection', specialty: 'cardiology', setting: 'inpatient', facts: ['chronicHeartFailure','copd','pneumonia','hypertension','kidney3','dyspnea','furosemide'] },
  { id: 'pulmonary-embolism', specialty: 'respiratory', setting: 'emergency', facts: ['embolism','dyspnea','chestPain','anticoagulant',absent('pneumonia'),absent('heartFailure')] },
  { id: 'acute-stroke', specialty: 'neurology', setting: 'emergency', facts: ['stroke','weakness','aphasia','hypertension','atrialFibrillation',historical('infarction')] },
  { id: 'postoperative-infection', specialty: 'surgery', setting: 'inpatient', facts: ['woundInfection','postoperativePain','fever','diabetes2',historical('bypass'),absent('kidney')] },
  { id: 'valve-disease', specialty: 'cardiology', setting: 'outpatient', facts: ['valveRegurgitation','chronicHeartFailure','atrialFibrillation','dyspnea','furosemide',absent('stroke')] },
  { id: 'acute-infarction', specialty: 'cardiology', setting: 'emergency', facts: ['acuteInfarction','chestPain','electrocardiogram','coronaryIntervention','aspirin','atorvastatin',absent('heartFailure')] },
  { id: 'transient-ischemia', specialty: 'neurology', setting: 'emergency', facts: ['transientIschemia','syncope','hypertension','atrialFibrillation',absent('stroke')] },
  { id: 'breast-screening', specialty: 'oncology', setting: 'outpatient', sex: 'female', facts: ['mammography',planned('coreBiopsy'),family('breastCancer'),absent('breastCancer')] },
  { id: 'diabetic-ketoacidosis', specialty: 'metabolic', setting: 'emergency', facts: ['ketoacidosis','diabetes1','hyperglycemia','insulin',absent('heartFailure')] }
];
export const SYNTHETIC_DEMO_CONCEPT_IDS = [...new Set(SYNTHETIC_PROFILES.flatMap(profile => profile.facts.map(fact => SYNTHETIC_CONCEPTS[typeof fact === 'string' ? fact : fact.key].id)))];
const AGES = [38,49,61,66,72,78,82,59], DAYS_AGO = [2,7,14,21,35,60,120,240];
export const SYNTHETIC_REFERENCE_OFFSET_DAYS = Math.min(...DAYS_AGO);
function renderFact(fact, languageCode, variant) {
  const terms = fact[languageCode], term = terms[variant % terms.length];
  if (fact.subject === 'family') return languageCode === 'es' ? `Antecedentes familiares: un familiar de primer grado tiene ${term}.` : `Family history: a first-degree relative has ${term}.`;
  if (fact.assertion === 'absent') return languageCode === 'es' ? `Evaluación actual: sin evidencia de ${term}.` : `Current review: no evidence of ${term}.`;
  if (fact.assertion === 'suspected') return languageCode === 'es' ? `Diagnóstico de trabajo: sospecha de ${term}; estudio pendiente.` : `Working diagnosis: suspected ${term}; investigations pending.`;
  if (fact.assertion === 'historical') return languageCode === 'es' ? `Antecedentes personales: ${term} en el pasado.` : `Past history: previous ${term}.`;
  if (fact.assertion === 'planned') return languageCode === 'es' ? `Plan: ${term} programada.` : `Plan: ${term} planned.`;
  if (fact.target?.startsWith('Medication')) return languageCode === 'es' ? `Medicación actual: ${term}.` : `Current medication: ${term}.`;
  if (fact.target === 'Procedure.code') return languageCode === 'es' ? `Procedimiento: ${term} realizado.` : `Procedure: ${term} performed.`;
  return languageCode === 'es' ? `Evaluación: ${term}.` : `Assessment: ${term}.`;
}
export function generateSyntheticNotes({ now = new Date(), releaseId = '20260601', tenantId = 'demo-hospital' } = {}) {
  const anchor = new Date(now); anchor.setUTCHours(12,0,0,0);
  const notes = [];
  for (const [profileIndex, profile] of SYNTHETIC_PROFILES.entries()) for (const languageCode of ['en','es']) for (let variant = 0; variant < AGES.length; variant++) {
    const occurredAt = new Date(anchor.getTime() - DAYS_AGO[variant] * 86400000);
    const sex = profile.sex || ((variant + profileIndex) % 2 ? 'male' : 'female');
    const facts = profile.facts.map(input => {
      const spec = typeof input === 'string' ? { key: input } : input;
      return { ...SYNTHETIC_CONCEPTS[spec.key], assertion: 'present', subject: 'patient', ...spec };
    });
    const primaryIndex = facts.findIndex(fact => fact.assertion === 'present' && fact.subject === 'patient' && !fact.target);
    const introduction = languageCode === 'es' ? `Nota sintética de demostración. ${sex === 'female' ? 'Mujer' : 'Hombre'} de ${AGES[variant]} años. Visita: ${occurredAt.toISOString().slice(0,10)}.` :
      `Synthetic demonstration note. ${AGES[variant]}-year-old ${sex === 'female' ? 'woman' : 'man'}. Encounter: ${occurredAt.toISOString().slice(0,10)}.`;
    // Retain deployed default-tenant IDs; namespace every other tenant.
    const namespace = tenantId === 'demo-hospital' ? '' : `tenant=${encodeURIComponent(tenantId)}:`;
    notes.push({ _id: `${SYNTHETIC_CORPUS_VERSION}:${namespace}${releaseId}:${profile.id}:${languageCode}:${variant}`, tenantId, releaseId,
      synthetic: true, source: SYNTHETIC_CORPUS_VERSION, demoReferenceDate: new Date(anchor), profileId: profile.id, specialty: profile.specialty, languageCode,
      patient: { age: AGES[variant], sex }, encounter: { occurredAt, setting: profile.setting }, recordedAt: occurredAt.toISOString(),
      text: [introduction,...facts.map(fact => renderFact(fact,languageCode,variant))].join('\n'),
      codings: facts.map((fact,index) => ({ conceptId: fact.id, system: 'http://snomed.info/sct', display: fact[languageCode][variant % fact[languageCode].length],
        role: index === primaryIndex ? 'primary' : 'secondary', target: fact.target || 'Condition.code', assertion: fact.assertion, subject: fact.subject, status: 'accepted' })) });
  }
  return notes;
}

// Only used to migrate pre-namespace synthetic notes in their own tenant.
export function legacySyntheticNoteId(note) {
  const prefix = `${SYNTHETIC_CORPUS_VERSION}:tenant=${encodeURIComponent(note.tenantId)}:`;
  return note._id.startsWith(prefix) ? `${SYNTHETIC_CORPUS_VERSION}:${note._id.slice(prefix.length)}` : note._id;
}
