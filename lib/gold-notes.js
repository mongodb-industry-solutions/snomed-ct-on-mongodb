// Gold-note pack — the curated fixtures for the extraction benchmark.
//
// The benchmark evaluates the LLM's EVIDENCE GRAPH: for each note we record the
// facts a good clinician-coder would extract — every clinical mention with its
// assertion (present / absent / suspected / planned), subject (patient / family),
// and document section. Scoring the evidence graph measures the LLM directly and
// is decoupled from MongoDB retrieval (a concept the demo's scoped dataset can't
// resolve is a *retrieval* limitation, not an extraction error).
//
// A fact may also carry a conceptId/term — the concept it SHOULD resolve to.
// Those feed the optional RETRIEVAL axis (does grounding find the concept under
// a given search mode). Facts without a conceptId are scored on the graph only.
//
// fact = {
//   phrase,                       // the span the LLM should surface
//   assertion,                    // present | absent | suspected | planned
//   subject,                      // patient | family
//   section,                      // chief_complaint | history | active |
//                                 //   procedures | medications | family_history | plan | other
//   conceptId?, term?             // expected SNOMED resolution (retrieval axis)
// }

export const GOLD_NOTES = [
  {
    id: "gold-en-diabetes",
    title: "Diabetes with complications (EN)",
    languageCode: "en",
    text: [
      "HPI: Patient with type 2 diabetes mellitus.",
      "Assessment: Diabetic nephropathy. No evidence of diabetic retinopathy on current review.",
      "Family history: Mother with type 2 diabetes.",
      "Plan: Continue metformin and repeat urine albumin."
    ].join("\n"),
    facts: [
      { phrase: "type 2 diabetes mellitus", assertion: "present", subject: "patient", section: "history", conceptId: "44054006", term: "Type 2 diabetes mellitus" },
      { phrase: "diabetic nephropathy", assertion: "present", subject: "patient", section: "active", conceptId: "127013003", term: "Disorder of kidney due to diabetes mellitus" },
      { phrase: "diabetic retinopathy", assertion: "absent", subject: "patient", section: "active" },
      { phrase: "mother with type 2 diabetes", assertion: "present", subject: "family", section: "family_history" },
      { phrase: "metformin", assertion: "planned", subject: "patient", section: "plan" }
    ]
  },
  {
    id: "gold-es-diabetes",
    title: "Diabetes con complicaciones (ES)",
    languageCode: "es",
    text: [
      "Motivo: Paciente con diabetes mellitus tipo 2.",
      "Evaluación: Nefropatía diabética. Sin evidencia de retinopatía diabética en el control actual.",
      "Antecedentes familiares: Madre con diabetes tipo 2.",
      "Plan: Continuar metformina y repetir albúmina en orina."
    ].join("\n"),
    facts: [
      { phrase: "diabetes mellitus tipo 2", assertion: "present", subject: "patient", section: "history", conceptId: "44054006", term: "Diabetes mellitus type II" },
      { phrase: "nefropatía diabética", assertion: "present", subject: "patient", section: "active", conceptId: "127013003", term: "Diabetic renal disease" },
      { phrase: "retinopatía diabética", assertion: "absent", subject: "patient", section: "active" },
      { phrase: "madre con diabetes tipo 2", assertion: "present", subject: "family", section: "family_history" },
      { phrase: "metformina", assertion: "planned", subject: "patient", section: "plan" }
    ]
  },
  {
    id: "gold-en-oncology",
    title: "Breast oncology (EN)",
    languageCode: "en",
    text: [
      "Assessment: Carcinoma of breast.",
      "No evidence of metastatic carcinoma.",
      "Plan: Refer to tumor board."
    ].join("\n"),
    facts: [
      { phrase: "carcinoma of breast", assertion: "present", subject: "patient", section: "active", conceptId: "254838004", term: "Carcinoma of breast" },
      { phrase: "metastatic carcinoma", assertion: "absent", subject: "patient", section: "active" }
    ]
  },
  {
    id: "gold-en-cardiology",
    title: "Cardiology, secondary complication (EN)",
    languageCode: "en",
    text: [
      "Assessment: Acute myocardial infarction complicated by heart failure.",
      "History of atrial fibrillation.",
      "Denies chest pain at present."
    ].join("\n"),
    facts: [
      { phrase: "myocardial infarction", assertion: "present", subject: "patient", section: "active", conceptId: "22298006", term: "Myocardial infarction" },
      { phrase: "heart failure", assertion: "present", subject: "patient", section: "active", conceptId: "84114007", term: "Heart failure" },
      { phrase: "atrial fibrillation", assertion: "present", subject: "patient", section: "history", conceptId: "49436004", term: "Atrial fibrillation" },
      { phrase: "chest pain", assertion: "absent", subject: "patient", section: "active" }
    ]
  },
  {
    id: "gold-en-cardio-renal",
    title: "Cardio-renal, ED workup (EN)",
    languageCode: "en",
    text: [
      "Chief complaint: Shortness of breath.",
      "History: Known heart failure and chronic kidney disease. Hypertension on treatment.",
      "The patient denies chest pain and has no fever.",
      "Assessment: Acute decompensated heart failure. Suspected pneumonia pending chest X-ray.",
      "Plan: IV furosemide, admit for monitoring."
    ].join("\n"),
    facts: [
      { phrase: "shortness of breath", assertion: "present", subject: "patient", section: "chief_complaint" },
      { phrase: "heart failure", assertion: "present", subject: "patient", section: "history", conceptId: "84114007", term: "Heart failure" },
      { phrase: "chronic kidney disease", assertion: "present", subject: "patient", section: "history", conceptId: "709044004", term: "Chronic kidney disease" },
      { phrase: "hypertension", assertion: "present", subject: "patient", section: "history", conceptId: "38341003", term: "Hypertensive disorder" },
      { phrase: "chest pain", assertion: "absent", subject: "patient", section: "active" },
      { phrase: "fever", assertion: "absent", subject: "patient", section: "active" },
      { phrase: "acute decompensated heart failure", assertion: "present", subject: "patient", section: "active" },
      { phrase: "pneumonia", assertion: "suspected", subject: "patient", section: "active" },
      { phrase: "furosemide", assertion: "planned", subject: "patient", section: "plan" }
    ]
  },
  {
    id: "gold-en-ischemic",
    title: "Ischemic heart disease, procedure & meds (EN)",
    languageCode: "en",
    text: [
      "History: Stable angina and type 2 diabetes mellitus. Father had myocardial infarction.",
      "Assessment: Coronary artery disease.",
      "Procedure: Coronary angiography performed today.",
      "Plan: Start aspirin and atorvastatin. No evidence of active bleeding."
    ].join("\n"),
    facts: [
      { phrase: "stable angina", assertion: "present", subject: "patient", section: "history" },
      { phrase: "type 2 diabetes mellitus", assertion: "present", subject: "patient", section: "history", conceptId: "44054006", term: "Type 2 diabetes mellitus" },
      { phrase: "father had myocardial infarction", assertion: "present", subject: "family", section: "family_history" },
      { phrase: "coronary artery disease", assertion: "present", subject: "patient", section: "active", conceptId: "53741008", term: "Coronary arteriosclerosis" },
      { phrase: "coronary angiography", assertion: "present", subject: "patient", section: "procedures" },
      { phrase: "aspirin", assertion: "planned", subject: "patient", section: "plan" },
      { phrase: "atorvastatin", assertion: "planned", subject: "patient", section: "plan" },
      { phrase: "active bleeding", assertion: "absent", subject: "patient", section: "plan" }
    ]
  },
  {
    id: "gold-en-respiratory",
    title: "Respiratory, COPD exacerbation (EN)",
    languageCode: "en",
    text: [
      "Chief complaint: Productive cough and wheezing for three days.",
      "History: Chronic obstructive pulmonary disease. Ex-smoker.",
      "Assessment: Acute exacerbation of COPD. No signs of pneumonia on examination.",
      "Plan: Nebulized salbutamol and a course of prednisolone."
    ].join("\n"),
    facts: [
      { phrase: "productive cough", assertion: "present", subject: "patient", section: "chief_complaint" },
      { phrase: "wheezing", assertion: "present", subject: "patient", section: "chief_complaint" },
      { phrase: "chronic obstructive pulmonary disease", assertion: "present", subject: "patient", section: "history", conceptId: "13645005", term: "Chronic obstructive lung disease" },
      { phrase: "acute exacerbation of COPD", assertion: "present", subject: "patient", section: "active" },
      { phrase: "pneumonia", assertion: "absent", subject: "patient", section: "active" },
      { phrase: "salbutamol", assertion: "planned", subject: "patient", section: "plan" },
      { phrase: "prednisolone", assertion: "planned", subject: "patient", section: "plan" }
    ]
  }
];

export function getGoldNote(id) {
  return GOLD_NOTES.find((note) => note.id === id) || null;
}

// Facts a good extraction should surface (the whole evidence graph).
export function goldFacts(note) {
  return Array.isArray(note?.facts) ? note.facts : [];
}

// Present-patient facts that carry an expected concept id (retrieval axis).
export function goldExpectedConcepts(note) {
  return goldFacts(note).filter((f) => f.conceptId && f.assertion === "present" && f.subject === "patient");
}

// Facts that must NOT be coded as present-patient (negated or family history).
export function goldExcluded(note) {
  return goldFacts(note).filter((f) => f.assertion === "absent" || f.subject === "family");
}
