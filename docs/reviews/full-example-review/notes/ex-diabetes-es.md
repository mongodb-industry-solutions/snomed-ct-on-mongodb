# Diabetes seguimiento (ES)

Reviewed 12 November 2026. Set: applied. 24 mentions; every row manually annotated.

Expected encounter problem: **Diabetes mellitus tipo 2**. Automatic principal: **diabetes mellitus tipo 2**. Principal review: **supported**.

Hipertensión arterial is current. Dislipemia activity unspecified. Nephropathy and peripheral diabetic neuropathy remain suspected.

Reject profuse pigmented skin lesions, trabeculectomy revision, and hospital-specific podiatry. The urine ACR and class-level SGLT2 proposals are appropriate but still require mapping review.

The verdict concerns the top proposal and source context. Supported proposals can still require manual mapping acceptance or better structured output. Suspected/absent/family/planned facts never become confirmed current patient diagnoses merely because a code matches.

## Source note

```text
Motivo de consulta: Revisión de diabetes mellitus tipo 2.
Enfermedad actual: Paciente con diabetes mellitus tipo 2 de 12 años de evolución. En el último control se observa aumento de albúmina en orina. Refiere hormigueo intermitente en ambos pies, sin úlceras ni lesiones cutáneas. No ha presentado episodios recientes de hipoglucemia.
Evaluación:
1. Diabetes mellitus tipo 2.
2. Sospecha de nefropatía diabética por albuminuria persistente.
3. Síntomas compatibles con neuropatía periférica diabética.
4. Sin evidencia de retinopatía diabética en la revisión oftalmológica reciente.
5. Hipertensión arterial controlada.
Antecedentes personales: Dislipemia. Sin antecedentes de diabetes mellitus tipo 1 ni cetoacidosis diabética.
Antecedentes familiares: Padre con diabetes mellitus tipo 2.
Plan: Continuar metformina. Valorar inicio de inhibidor SGLT2 si la función renal se mantiene estable. Repetir cociente albúmina-creatinina en orina en 3 meses. Derivar a podología para valoración del riesgo de pie diabético.
```

## Mention-by-mention review

| # | Source evidence | Search phrase | Top code and term | App decision | Manual verdict and required interpretation |
|---:|---|---|---|---|---|
| 1 | diabetes mellitus tipo 2 | diabetes mellitus tipo 2 | 44054006 · diabetes mellitus tipo 2 | accepted | **supported** — T2DM is the encounter problem. |
| 2 | diabetes mellitus tipo 2 de 12 años de evolución | diabetes mellitus tipo 2 | 44054006 · diabetes mellitus tipo 2 | accepted | **supported** — T2DM with 12-year duration preserved. |
| 3 | aumento de albúmina en orina | albuminuria | 274769005 · albuminuria | accepted | **supported** — Albuminuria matches increased urinary albumin; no renal diagnosis inferred. |
| 4 | hormigueo intermitente en ambos pies | hormigueo | 15037002 · hormigueo | accepted | **supported** — Hormigueo matches tingling, with intermittent bilateral-foot context retained. |
| 5 | úlceras | úlceras | 95345008 · úlcera del pie | review | **supported** — Foot-ulcer candidate is supported by the foot-symptom context and remains absent. |
| 6 | lesiones cutáneas | lesiones cutáneas | 1145367001 · lesiones cutáneas pigmentadas profusas | review | **reject** — Generic denied skin lesions are not profuse pigmented lesions or self-inflicted lesions. |
| 7 | episodios recientes de hipoglucemia | hipoglucemia | 302866003 · hipoglucemia | accepted | **supported** — No recent hypoglycemia episodes are reported; preserve that reporting/time scope. |
| 8 | Diabetes mellitus tipo 2 | diabetes mellitus tipo 2 | 44054006 · diabetes mellitus tipo 2 | accepted | **supported** — T2DM confirmed in evaluation. |
| 9 | Sospecha de nefropatía diabética | nefropatía diabética | 127013003 · nefropatía diabética | accepted | **supported** — Diabetic nephropathy remains suspected despite a good code match. |
| 10 | albuminuria persistente | albuminuria | 274769005 · albuminuria | accepted | **supported** — Persistent albuminuria is a finding with persistence retained. |
| 11 | neuropatía periférica diabética | neuropatía periférica diabética | 424736006 · neuropatía periférica diabética | accepted | **supported** — Diabetic peripheral neuropathy is a provisional interpretation of compatible symptoms, not a confirmed comorbidity. |
| 12 | retinopatía diabética | retinopatía diabética | 4855003 · retinopatía diabética | accepted | **partial** — Negative retinopathy evidence is limited to the recent review; the result is labelled current without a dated evidence object. |
| 13 | revisión oftalmológica reciente | revisión oftalmológica | 1344703007 · revisión de trabeculectomía, bilateral | abstain | **reject** — A recent eye review is not bilateral trabeculectomy revision or another surgical revision, even though the mapper abstains. |
| 14 | Hipertensión arterial controlada | hipertensión arterial | 38341003 · hipertensión arterial | accepted | **supported** — Generic hypertension with controlled status retained. |
| 15 | Dislipemia | dislipemia | 370992007 · dislipemia | accepted | **supported** — Dislipemia maps to dyslipidemia with activity unspecified; it is not identical to every narrower hyperlipidemia subtype. |
| 16 | diabetes mellitus tipo 1 | diabetes mellitus tipo 1 | 46635009 · diabetes mellitus tipo 1 | accepted | **supported** — T1DM remains absent from personal history. |
| 17 | cetoacidosis diabética | cetoacidosis diabética | 420422005 · cetoacidosis diabética | accepted | **supported** — DKA remains absent from personal history. |
| 18 | Padre con diabetes mellitus tipo 2 | diabetes mellitus tipo 2 | 44054006 · diabetes mellitus tipo 2 | accepted | **partial** — Father's T2DM is family evidence; the relative's current activity is not documented. |
| 19 | metformina | metformina | 372567009 · metformina | accepted | **supported** — Continue metformin, with no unsupported brand/dose. |
| 20 | inhibidor SGLT2 | inhibidor del cotransportador sodio-glucosa tipo 2 | 703673007 · inhibidor del cotransportador de sodio-glucosa tipo 2 | review | **supported** — Correct class-level SGLT2 proposal; initiation is conditional, not already administered. |
| 21 | la función renal se mantiene estable | función renal estable | Uncoded | abstain | **context** — Renal stability is a treatment prerequisite, not a measured result. |
| 22 | cociente albúmina-creatinina en orina | cociente albúmina-creatinina en orina | 271075006 · medición urinaria del índice albúmina/creatinina | review | **supported** — Urine albumin/creatinine measurement is the correct candidate and remains a future repeat test; wedge resection must be rejected. |
| 23 | Derivar a podología | derivación a podología | 306162002 · derivación a servicio de podología hospitalario | review | **reject** — The note does not specify hospital podiatry. The displayed general podiatry referral is preferable. Review candidate 306160005. |
| 24 | valoración del riesgo de pie diabético | valoración del riesgo de pie diabético | 394683006 · evaluación de riesgo de pie diabético | review | **supported** — Diabetic foot risk assessment is the planned purpose; no foot operation is implied. |

## Evidence and candidate context

Exact offsets, assertion, subject, temporality, workflow, qualifiers, displayed alternatives, scores, and lexical comparison (where captured) are retained in the structured review.

[Structured full review](../full-review.json)

[Raw hybrid run](</Users/francesc.mateu/Documents/GitHub/AI-Ready-Clinical-Semantics/docs/reviews/runs/semantic-order-20261112/ex-diabetes-es-hybrid.json>)
