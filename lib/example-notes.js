// Synthetic-but-realistic demo notes for the Ground Clinical Note screen.
// Grouped by complexity to exercise section detection, present/absent findings,
// history, family history, procedures, plans, and "do not over-code" cases.
// (The stricter, concept-id-scored fixtures live in lib/gold-notes.js.)
//
// IMPORTANT: every note here is scoped to the branches that actually exist in
// the `snomed-term-search` sidecar (cardiovascular / oncology / diabetes +
// closely related findings). Respiratory (COPD/pneumonia) and general-surgery
// (appendicitis) notes were removed because those concepts are not projected,
// so they grounded to unrelated cardiac/procedure concepts. If the projection
// scope is widened later, matching example notes can be added back.

export const EXAMPLE_GROUPS = [
  {
    group: "Simple note",
    notes: [
      {
        id: "ex-diabetes-en",
        title: "Diabetes follow-up (EN)",
        languageCode: "en",
        recommendedPrimary: "Type 2 diabetes mellitus",
        text: `Reason for visit: Follow-up for type 2 diabetes mellitus.
History of present illness: The patient has had type 2 diabetes mellitus for 12 years. Recent laboratory results showed increased urine albumin. The patient reports intermittent numbness in both feet but denies foot ulcers. No symptoms of hypoglycemia were reported.
Assessment:
1. Type 2 diabetes mellitus with suspected diabetic nephropathy.
2. Peripheral neuropathy symptoms, likely related to diabetes.
3. No evidence of diabetic retinopathy on ophthalmology review last month.
4. Hypertension, controlled.
Past medical history: Hyperlipidemia. No history of type 1 diabetes mellitus or diabetic ketoacidosis.
Family history: Father with type 2 diabetes mellitus.
Plan: Continue metformin. Start SGLT2 inhibitor if renal function remains stable. Repeat urine albumin-creatinine ratio in 3 months. Refer to podiatry for foot risk assessment.`
      },
      {
        id: "ex-diabetes-es",
        title: "Diabetes seguimiento (ES)",
        languageCode: "es",
        recommendedPrimary: "Diabetes mellitus tipo 2",
        text: `Motivo de consulta: Revisión de diabetes mellitus tipo 2.
Enfermedad actual: Paciente con diabetes mellitus tipo 2 de 12 años de evolución. En el último control se observa aumento de albúmina en orina. Refiere hormigueo intermitente en ambos pies, sin úlceras ni lesiones cutáneas. No ha presentado episodios recientes de hipoglucemia.
Evaluación:
1. Diabetes mellitus tipo 2.
2. Sospecha de nefropatía diabética por albuminuria persistente.
3. Síntomas compatibles con neuropatía periférica diabética.
4. Sin evidencia de retinopatía diabética en la revisión oftalmológica reciente.
5. Hipertensión arterial controlada.
Antecedentes personales: Dislipemia. Sin antecedentes de diabetes mellitus tipo 1 ni cetoacidosis diabética.
Antecedentes familiares: Padre con diabetes mellitus tipo 2.
Plan: Continuar metformina. Valorar inicio de inhibidor SGLT2 si la función renal se mantiene estable. Repetir cociente albúmina-creatinina en orina en 3 meses. Derivar a podología para valoración del riesgo de pie diabético.`
      }
    ]
  },
  {
    group: "Discharge summary",
    notes: [
      {
        id: "ex-hf-en",
        title: "Heart failure discharge (EN)",
        languageCode: "en",
        recommendedPrimary: "Acute decompensated heart failure",
        text: `Discharge summary
Reason for admission: Progressive shortness of breath and ankle swelling for 5 days.
History of present illness: The patient was admitted with acute decompensated heart failure. On arrival, oxygen saturation was 89% on room air, with bilateral basal crackles and peripheral edema. Chest X-ray showed pulmonary congestion. Troponin was not elevated. There was no evidence of acute myocardial infarction.
Past medical history: Chronic heart failure with reduced ejection fraction, hypertension, chronic kidney disease stage 3, and atrial fibrillation. No previous stroke.
Hospital course: The patient was treated with intravenous furosemide with good diuresis and clinical improvement. Echocardiogram showed left ventricular ejection fraction of 35%. Atrial fibrillation remained rate controlled. Renal function worsened transiently during diuresis but returned near baseline before discharge.
Discharge assessment:
1. Acute decompensated heart failure on chronic heart failure with reduced ejection fraction.
2. Atrial fibrillation, rate controlled.
3. Chronic kidney disease stage 3.
4. Hypertension.
5. Acute myocardial infarction ruled out.
Discharge plan: Continue oral furosemide, beta blocker, ACE inhibitor, and anticoagulation. Heart failure clinic follow-up in 2 weeks. Repeat renal function blood test in 1 week.`
      },
      {
        id: "ex-hf-es",
        title: "Alta cardiología (ES)",
        languageCode: "es",
        recommendedPrimary: "Insuficiencia cardíaca aguda descompensada",
        text: `Informe de alta
Motivo de ingreso: Disnea progresiva y edemas en extremidades inferiores de varios días de evolución.
Enfermedad actual: Paciente que ingresa por insuficiencia cardíaca aguda descompensada. A la llegada presenta saturación de oxígeno del 89% basal, crepitantes bibasales y edemas maleolares. La radiografía de tórax muestra signos de congestión pulmonar. La troponina no presenta elevación significativa. No hay datos de infarto agudo de miocardio.
Antecedentes personales: Insuficiencia cardíaca crónica con fracción de eyección reducida, fibrilación auricular, hipertensión arterial y enfermedad renal crónica estadio 3. Sin antecedentes de ictus.
Evolución durante el ingreso: Se inicia tratamiento con furosemida intravenosa, con buena respuesta diurética y mejoría clínica progresiva. El ecocardiograma muestra fracción de eyección del ventrículo izquierdo del 35%. La fibrilación auricular se mantiene con frecuencia controlada. La función renal empeora de forma transitoria durante la diuresis y vuelve a valores cercanos a los basales antes del alta.
Diagnóstico al alta:
1. Insuficiencia cardíaca aguda descompensada sobre insuficiencia cardíaca crónica con fracción de eyección reducida.
2. Fibrilación auricular con frecuencia controlada.
3. Enfermedad renal crónica estadio 3.
4. Hipertensión arterial.
5. Infarto agudo de miocardio descartado.
Plan al alta: Continuar furosemida oral, betabloqueante, inhibidor de la enzima convertidora de angiotensina y anticoagulación. Control en consulta de insuficiencia cardíaca en 2 semanas. Repetir analítica con función renal en 1 semana.`
      },
      {
        id: "ex-full-report-en",
        title: "Cardiology discharge — full multi-section (EN)",
        languageCode: "en",
        recommendedPrimary: "Acute decompensated heart failure",
        text: `Cardiology discharge summary
Reason for admission: acute decompensated heart failure.
History of present illness: acute decompensated heart failure on a background of chronic systolic heart failure and ischemic heart disease.
Past medical history: coronary artery disease, type 2 diabetes mellitus, essential hypertension, and chronic kidney disease.
Family history: father with myocardial infarction; mother with breast cancer.
Procedures during admission: percutaneous coronary intervention.
Discharge diagnoses:
1. Acute decompensated heart failure.
2. Atrial fibrillation.
3. Coronary artery disease.
4. Type 2 diabetes mellitus.
5. Chronic kidney disease.
6. Acute myocardial infarction ruled out.
7. Pulmonary embolism excluded.
Medications on discharge: aspirin.`
      },
      {
        id: "ex-oncology-en",
        title: "Breast oncology discharge (EN)",
        languageCode: "en",
        recommendedPrimary: "Invasive ductal carcinoma of left breast",
        text: `Oncology discharge summary
Reason for admission: Elective surgery for biopsy-proven invasive ductal carcinoma of the left breast.
Clinical background: The patient was diagnosed with invasive ductal carcinoma of the left breast after abnormal screening mammography and core needle biopsy. Estrogen receptor was positive, progesterone receptor was positive, and HER2 was negative. There was no clinical evidence of distant metastatic disease before surgery. Family history is significant for mother with breast cancer at age 52.
Procedure performed: Left breast lumpectomy with sentinel lymph node biopsy.
Hospital course: The procedure was uncomplicated. Postoperative pain was controlled with oral analgesia. No wound infection was observed. Final pathology confirmed invasive ductal carcinoma with negative surgical margins. One sentinel lymph node was negative for metastatic carcinoma.
Discharge assessment:
1. Invasive ductal carcinoma of the left breast, status post lumpectomy.
2. No evidence of metastatic carcinoma.
3. Family history of breast cancer.
4. Postoperative wound infection not present.
Plan: Refer to multidisciplinary tumor board. Arrange oncology follow-up for adjuvant radiotherapy and endocrine therapy discussion. Review final pathology in clinic.`
      },
      {
        id: "ex-stroke-en",
        title: "Stroke discharge (EN)",
        languageCode: "en",
        recommendedPrimary: "Acute ischemic stroke",
        text: `Neurology discharge summary
Reason for admission: Sudden onset right arm weakness and difficulty speaking.
History of present illness: The patient presented within 2 hours of symptom onset. Neurological examination showed expressive aphasia and right-sided weakness. CT brain showed no intracranial hemorrhage. CT angiography did not show large vessel occlusion. MRI brain later confirmed acute ischemic stroke in the left middle cerebral artery territory.
Past medical history: Paroxysmal atrial fibrillation, hypertension, and hyperlipidemia. No history of intracranial bleeding.
Hospital course: Intravenous thrombolysis was given after exclusion of hemorrhage. Symptoms improved partially. Cardiac monitoring showed intermittent atrial fibrillation.
Discharge assessment:
1. Acute ischemic stroke in the left middle cerebral artery territory.
2. Expressive aphasia, improving.
3. Paroxysmal atrial fibrillation, likely embolic source.
4. Intracranial hemorrhage ruled out.
Plan: Start oral anticoagulation after repeat brain imaging. Continue statin and antihypertensive therapy. Outpatient stroke clinic follow-up and community physiotherapy.`
      }
    ]
  },
  {
    group: "Ambiguous / safety (do not over-code)",
    notes: [
      {
        id: "ex-chestpain-en",
        title: "Chest pain ED note (EN)",
        languageCode: "en",
        recommendedPrimary: "Possible unstable angina",
        text: `Emergency department note
Chief complaint: Chest pain.
History: The patient reports central chest discomfort lasting 20 minutes while walking upstairs. Pain resolved before arrival. The patient denies current chest pain, shortness of breath, syncope, or palpitations. Past medical history includes hypertension and type 2 diabetes mellitus. Father had myocardial infarction at age 60.
Examination: Blood pressure 158/92 mmHg. Heart sounds normal. Lungs clear.
Investigations: Initial ECG shows no ST elevation. First troponin is normal. Chest X-ray is normal.
Assessment: Chest pain, possible unstable angina. Acute myocardial infarction not confirmed at this time.
Plan: Repeat ECG and troponin in 3 hours. Admit to observation unit for cardiac monitoring. Continue aspirin and statin.`
      },
      {
        id: "ex-chestpain-es",
        title: "Dolor torácico urgencias (ES)",
        languageCode: "es",
        recommendedPrimary: "Posible angina inestable",
        text: `Nota de urgencias
Motivo de consulta: Dolor torácico.
Enfermedad actual: Paciente que refiere opresión centrotorácica de 20 minutos de duración mientras subía escaleras. El dolor cede antes de la llegada a urgencias. Niega dolor torácico actual, disnea, síncope o palpitaciones. Antecedentes de hipertensión arterial y diabetes mellitus tipo 2. Padre con infarto de miocardio a los 60 años.
Exploración física: Presión arterial 158/92 mmHg. Auscultación cardíaca sin soplos. Auscultación pulmonar normal.
Pruebas complementarias: Electrocardiograma inicial sin elevación del segmento ST. Primera troponina normal. Radiografía de tórax sin hallazgos patológicos.
Evaluación: Dolor torácico, posible angina inestable. Infarto agudo de miocardio no confirmado en este momento.
Plan: Repetir electrocardiograma y troponina en 3 horas. Ingreso en unidad de observación para monitorización cardíaca. Continuar aspirina y estatina.`
      }
    ]
  }
];
