# Alta cardiología (ES)

Reviewed 12 November 2026. Set: applied. 35 mentions; every row manually annotated.

Expected encounter problem: **Insuficiencia cardíaca aguda descompensada sobre IC crónica con FE reducida**. Automatic principal: **unset**. Principal review: **unresolved**.

AF and hypertension are supported. CKD should retain stage 3 rather than generic CKD. Do not select 3a/3b without evidence.

Reject undocumented cardiomyopathy, chest-and-abdomen X-ray, 20 mg oral furosemide, ST elevation for troponin and urine ACR for renal blood testing. Preserve admission/discharge time scopes.

The verdict concerns the top proposal and source context. Supported proposals can still require manual mapping acceptance or better structured output. Suspected/absent/family/planned facts never become confirmed current patient diagnoses merely because a code matches.

## Source note

```text
Informe de alta
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
Plan al alta: Continuar furosemida oral, betabloqueante, inhibidor de la enzima convertidora de angiotensina y anticoagulación. Control en consulta de insuficiencia cardíaca en 2 semanas. Repetir analítica con función renal en 1 semana.
```

## Mention-by-mention review

| # | Source evidence | Search phrase | Top code and term | App decision | Manual verdict and required interpretation |
|---:|---|---|---|---|---|
| 1 | Disnea progresiva | disnea | 267036007 · disnea | accepted | **partial** — Dyspnea belongs to the admission episode; discharge persistence is not stated. |
| 2 | edemas en extremidades inferiores | edema en extremidades inferiores | Uncoded | abstain | **unresolved** — Leg edema is a clinically meaningful presenting finding; keep it uncoded rather than invent vascular disease. |
| 3 | insuficiencia cardíaca aguda descompensada | insuficiencia cardíaca aguda descompensada | 195111005 · insuficiencia cardíaca descompensada (trastorno) | review | **partial** — Decompensated HF candidate is relevant but does not preserve all acute-on-chronic/HFrEF information. |
| 4 | saturación de oxígeno del 89% basal | saturación de oxígeno baja | 449171008 · baja saturación de oxígeno | review | **partial** — Low saturation is clinically consistent with 89%, but arrival measurement time must not become current discharge status. |
| 5 | crepitantes bibasales | crepitantes bibasales | Uncoded | abstain | **unresolved** — Bibasal crackles are not coded; preserve the arrival finding. |
| 6 | edemas maleolares | edema maleolar | 26237000 · edema maleolar | accepted | **partial** — Ankle edema meaning is correct; it is an arrival finding, not evidence of persistence at discharge. |
| 7 | radiografía de tórax | radiografía de tórax | 420233006 · radiografía de tórax y abdomen | review | **reject** — Chest radiography does not establish abdominal imaging. Plain chest X-ray is a displayed suitable alternative. Review candidate 399208008. |
| 8 | signos de congestión pulmonar | congestión pulmonar | 55044005 · reflejo de congestión pulmonar | review | **reject** — Radiographic congestion is not a pulmonary reflex. |
| 9 | La troponina no presenta elevación significativa | elevación significativa de troponina | 76388001 · sobreelevación del segmento ST | review | **reject** — Troponin without significant elevation is not a ST-segment result. |
| 10 | No hay datos de infarto agudo de miocardio | infarto agudo de miocardio | 57054005 · infarto agudo de miocardio | accepted | **supported** — No AMI evidence; negative diagnosis retained. |
| 11 | Insuficiencia cardíaca crónica con fracción de eyección reducida | insuficiencia cardíaca crónica con fracción de eyección reducida | 703275009 · insuficiencia cardíaca con fracción de eyección disminuida debida a miocardiopatía | review | **reject** — Chronic HFrEF does not establish cardiomyopathy or a hypertensive/coronary cause. Review the unqualified HFrEF candidate. Review candidate 703272007. |
| 12 | fibrilación auricular | fibrilación auricular | 49436004 · fibrilación auricular | accepted | **supported** — PMH AF has unspecified activity in this occurrence; later current evidence is separate. |
| 13 | hipertensión arterial | hipertensión arterial | 38341003 · hipertensión arterial | accepted | **supported** — PMH hypertension activity unspecified here, current in discharge assessment later. |
| 14 | enfermedad renal crónica estadio 3 | enfermedad renal crónica | 709044004 · enfermedad renal crónica | accepted | **partial** — Generic CKD loses documented stage 3 because the normalized phrase omitted the stage. Stage 3a/3b must not be substituted. Review candidate 433144002. |
| 15 | Sin antecedentes de ictus | ictus | 230690007 · ictus | accepted | **supported** — No prior stroke is negative history. |
| 16 | furosemida intravenosa | furosemida intravenosa | 779337009 · producto que contiene furosemida en forma farmacéutica para administración parenteral como único ingrediente | review | **supported** — Parenteral furosemide product class is suitable with IV route retained, without dose/combination drug inference. |
| 17 | buena respuesta diurética | respuesta diurética | 60309003 · diuresis | review | **supported** — Diuresis observable with good response retained is a reasonable representation of the treatment response. |
| 18 | mejoría clínica progresiva | mejoría clínica | Uncoded | abstain | **unresolved** — General clinical improvement remains uncoded; no specific improved symptom should be invented. |
| 19 | ecocardiograma | ecocardiograma | 40701008 · ecocardiografía | review | **supported** — Echocardiography candidate is correct although nonliteral; completed during admission. |
| 20 | fracción de eyección del ventrículo izquierdo del 35% | fracción de eyección del ventrículo izquierdo | 250908004 · fracción de eyección del ventrículo izquierdo | accepted | **supported** — LVEF observable with 35% retained; avoid estimated reference limits. |
| 21 | La fibrilación auricular se mantiene con frecuencia controlada | fibrilación auricular | 49436004 · fibrilación auricular | accepted | **supported** — AF remains current with controlled ventricular rate. |
| 22 | La función renal empeora de forma transitoria durante la diuresis | empeoramiento de la función renal | 128435000 · forma de onda hemodinámica de la saturación de oxígeno | review | **reject** — Renal worsening is not an oxygen-saturation waveform. |
| 23 | vuelve a valores cercanos a los basales antes del alta | función renal cercana a valores basales | Uncoded | abstain | **unresolved** — Recovery near renal baseline has no adequate code; it does not imply normal renal function. |
| 24 | Insuficiencia cardíaca aguda descompensada | insuficiencia cardíaca aguda descompensada | 195111005 · insuficiencia cardíaca descompensada (trastorno) | review | **partial** — Primary discharge problem is acute decompensated HF; the broad candidate needs acute-on-chronic/HFrEF qualifiers. |
| 25 | insuficiencia cardíaca crónica con fracción de eyección reducida | insuficiencia cardíaca crónica con fracción de eyección reducida | 703275009 · insuficiencia cardíaca con fracción de eyección disminuida debida a miocardiopatía | review | **reject** — Cardiomyopathy is unsupported in the current chronic HFrEF candidate. Review candidate 703272007. |
| 26 | Fibrilación auricular con frecuencia controlada | fibrilación auricular | 49436004 · fibrilación auricular | accepted | **supported** — AF is a current comorbidity with rate control retained. |
| 27 | Enfermedad renal crónica estadio 3 | enfermedad renal crónica | 709044004 · enfermedad renal crónica | accepted | **partial** — Current CKD stage 3 is under-specified as generic CKD; retain stage in coded meaning rather than only free-text attributes. Review candidate 433144002. |
| 28 | Hipertensión arterial | hipertensión arterial | 38341003 · hipertensión arterial | accepted | **supported** — Hypertension is a current comorbidity. |
| 29 | Infarto agudo de miocardio descartado | infarto agudo de miocardio | 57054005 · infarto agudo de miocardio | accepted | **supported** — AMI ruled out, no confirmed infarct. |
| 30 | furosemida oral | furosemida oral | 317971007 · furosemida 20 mg por cada comprimido para administración oral | review | **reject** — Oral furosemide does not specify 20 mg, 40 mg, 500 mg, or solution concentration. Review the ingredient/general oral-product concept. |
| 31 | betabloqueante | betabloqueante | 373254001 · agente betabloqueante | abstain | **supported** — The beta-blocker class candidate is clinically suitable despite abstention; no named beta-blocker is documented. |
| 32 | inhibidor de la enzima convertidora de angiotensina | inhibidor de la enzima convertidora de angiotensina | 372733002 · inhibidor de la enzima convertidora de angiotensina | accepted | **supported** — ACE inhibitor class is correctly retained. |
| 33 | anticoagulación | anticoagulación | 372862008 · anticoagulante | review | **supported** — Anticoagulant class is a reasonable representation of continued anticoagulation; coagulation-factor products are unsuitable. |
| 34 | Control en consulta de insuficiencia cardíaca | consulta de insuficiencia cardíaca | 134378009 · control de insuficiencia cardíaca congestiva | review | **partial** — HF monitoring is broader/different from a clinic visit in two weeks. |
| 35 | Repetir analítica con función renal | analítica con función renal | 271075006 · medición urinaria del índice albúmina/creatinina (procedimiento) | review | **reject** — Renal blood laboratory testing is not a urine ACR test or renal vascular intervention. |

## Evidence and candidate context

Exact offsets, assertion, subject, temporality, workflow, qualifiers, displayed alternatives, scores, and lexical comparison (where captured) are retained in the structured review.

[Structured full review](../full-review.json)

[Raw hybrid run](</Users/francesc.mateu/Documents/GitHub/AI-Ready-Clinical-Semantics/docs/reviews/runs/semantic-order-20261112/ex-hf-es-hybrid.json>)
