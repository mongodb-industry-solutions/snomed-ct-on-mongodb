# Dolor torácico urgencias (ES)

Reviewed 12 November 2026. Set: applied. 27 mentions; every row manually annotated.

Expected encounter problem: **Episodio de dolor torácico; dolor actual resuelto**. Automatic principal: **dolor torácico**. Principal review: **supported**.

Background hypertension and T2DM, current activity unspecified. Angina and MI unconfirmed; paternal MI is family history.

Reject normal heart sounds under a murmur-negation assertion, heart sounds for lung auscultation, anterolateral territory for generic ST change, abdominal X-ray and reinsertion surgery for admission.

The verdict concerns the top proposal and source context. Supported proposals can still require manual mapping acceptance or better structured output. Suspected/absent/family/planned facts never become confirmed current patient diagnoses merely because a code matches.

## Source note

```text
Nota de urgencias
Motivo de consulta: Dolor torácico.
Enfermedad actual: Paciente que refiere opresión centrotorácica de 20 minutos de duración mientras subía escaleras. El dolor cede antes de la llegada a urgencias. Niega dolor torácico actual, disnea, síncope o palpitaciones. Antecedentes de hipertensión arterial y diabetes mellitus tipo 2. Padre con infarto de miocardio a los 60 años.
Exploración física: Presión arterial 158/92 mmHg. Auscultación cardíaca sin soplos. Auscultación pulmonar normal.
Pruebas complementarias: Electrocardiograma inicial sin elevación del segmento ST. Primera troponina normal. Radiografía de tórax sin hallazgos patológicos.
Evaluación: Dolor torácico, posible angina inestable. Infarto agudo de miocardio no confirmado en este momento.
Plan: Repetir electrocardiograma y troponina en 3 horas. Ingreso en unidad de observación para monitorización cardíaca. Continuar aspirina y estatina.
```

## Mention-by-mention review

| # | Source evidence | Search phrase | Top code and term | App decision | Manual verdict and required interpretation |
|---:|---|---|---|---|---|
| 1 | Dolor torácico | dolor torácico | 29857009 · dolor torácico | accepted | **partial** — Dolor torácico is the encounter problem; later denial applies to current physical pain. The code must not conflate those time scopes. |
| 2 | opresión centrotorácica | opresión torácica | 23924001 · opresión torácica | accepted | **supported** — Recent exertional chest tightness retains central site and 20-minute duration. |
| 3 | El dolor cede antes de la llegada a urgencias | dolor torácico | 29857009 · dolor torácico | accepted | **supported** — Pain episode resolved before ED arrival; preserve the completed historical course. |
| 4 | dolor torácico actual | dolor torácico | 29857009 · dolor torácico | accepted | **supported** — Current chest pain denied. |
| 5 | disnea | disnea | 267036007 · disnea | accepted | **supported** — Current dyspnea denied. |
| 6 | síncope | síncope | 271594007 · síncope | accepted | **supported** — Syncope denied. |
| 7 | palpitaciones | palpitaciones | 80313002 · palpitaciones | accepted | **supported** — Palpitations denied. |
| 8 | hipertensión arterial | hipertensión arterial | 38341003 · hipertensión arterial | accepted | **supported** — Background hypertension current activity unspecified, not encounter principal. |
| 9 | diabetes mellitus tipo 2 | diabetes mellitus tipo 2 | 44054006 · diabetes mellitus tipo 2 | accepted | **supported** — Background T2DM current activity unspecified, not encounter principal. |
| 10 | Padre con infarto de miocardio a los 60 años | infarto de miocardio | 22298006 · infarto de miocardio | accepted | **supported** — Father's MI at 60 is family evidence. |
| 11 | Presión arterial 158/92 mmHg | presión arterial | 386534000 · presión arterial | accepted | **supported** — Arterial blood pressure observable matches 158/92 mmHg with no etiological inference. |
| 12 | sin soplos | soplos cardíacos | 301132007 · ruidos cardíacos normales | review | **reject** — Absence of cardiac murmurs is not absence of normal heart sounds; this reverses the meaning of the normal-finding candidate. |
| 13 | Auscultación pulmonar normal | auscultación pulmonar normal | 301132007 · ruidos cardíacos normales (hallazgo) | review | **reject** — Normal lung auscultation is not normal heart sounds; anatomical systems differ. |
| 14 | Electrocardiograma inicial | electrocardiograma | 29303009 · electrocardiograma | accepted | **supported** — Initial ECG completed. |
| 15 | sin elevación del segmento ST | elevación del segmento ST | 705012007 · elevación anterolateral de segmento ST | review | **reject** — Generic absence of ST elevation should not acquire an anterolateral territory. Preserve generic ECG finding scope. |
| 16 | Primera troponina normal | troponina | Uncoded | abstain | **unresolved** — Normal first troponin has no coded proposal; keep analyte/result/sequence. |
| 17 | Radiografía de tórax | radiografía de tórax | 420233006 · radiografía de tórax y abdomen | review | **reject** — Chest radiography does not establish chest-and-abdomen imaging. Plain chest X-ray is an available alternative. Review candidate 399208008. |
| 18 | sin hallazgos patológicos | hallazgos patológicos en radiografía de tórax | Uncoded | abstain | **unresolved** — No pathological chest-X-ray finding remains uncoded; do not infer a specific absent thoracic disorder. |
| 19 | Dolor torácico | dolor torácico | 29857009 · dolor torácico | accepted | **partial** — Encounter chest pain is suitable despite physical resolution; current pain must remain denied in its separate occurrence. |
| 20 | posible angina inestable | angina inestable | 4557003 · angina inestable | accepted | **supported** — Possible unstable angina remains provisional. |
| 21 | Infarto agudo de miocardio no confirmado en este momento | infarto agudo de miocardio | 57054005 · infarto agudo de miocardio | accepted | **supported** — AMI not confirmed at this time remains unconfirmed, not definitively ruled out. |
| 22 | Repetir electrocardiograma | electrocardiograma | 29303009 · electrocardiograma | accepted | **supported** — Repeat ECG is planned in three hours. |
| 23 | troponina | troponina | Uncoded | abstain | **unresolved** — Future repeat troponin is uncoded; do not substitute ECG/monitoring. |
| 24 | Ingreso en unidad de observación | ingreso en unidad de observación | 371547003 · procedimiento de reinserción (procedimiento) | review | **reject** — Observation-unit admission is not a reinsertion operation or a tissue transplant. |
| 25 | monitorización cardíaca | monitorización cardíaca | 710839006 · evaluación del estado cardíaco con dispositivo para monitorización | review | **supported** — General future cardiac monitoring candidate is reasonable; implant or Holter-valve surgery is not implied. |
| 26 | aspirina | aspirina | 387458008 · aspirina | accepted | **supported** — Continue aspirin, ingredient-level without dose. |
| 27 | estatina | estatina | 372912004 · estatina | accepted | **supported** — Continue statin class, no molecule/dose inferred. |

## Evidence and candidate context

Exact offsets, assertion, subject, temporality, workflow, qualifiers, displayed alternatives, scores, and lexical comparison (where captured) are retained in the structured review.

[Structured full review](../full-review.json)

[Raw hybrid run](</Users/francesc.mateu/Documents/GitHub/AI-Ready-Clinical-Semantics/docs/reviews/runs/semantic-order-20261112/ex-chestpain-es-hybrid.json>)
