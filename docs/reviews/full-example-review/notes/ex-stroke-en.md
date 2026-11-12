# Stroke discharge (EN)

Reviewed 12 November 2026. Set: applied. 32 mentions; every row manually annotated.

Expected encounter problem: **Acute ischemic stroke, left MCA territory**. Automatic principal: **unset**. Principal review: **unresolved**.

Paroxysmal AF is current; embolic attribution is likely rather than confirmed. Hypertension/hyperlipidemia appear in PMH with continued therapy as further evidence for review. Aphasia/weakness are findings.

Reject small-artery stroke subtype, coronary thrombolysis, dabigatran/combination antihypertensive drugs, functional MRI and edema reduction. Safer ischemic-stroke and cerebral-thrombolysis candidates are already projected.

The verdict concerns the top proposal and source context. Supported proposals can still require manual mapping acceptance or better structured output. Suspected/absent/family/planned facts never become confirmed current patient diagnoses merely because a code matches.

## Source note

```text
Neurology discharge summary
Reason for admission: Sudden onset right arm weakness and difficulty speaking.
History of present illness: The patient presented within 2 hours of symptom onset. Neurological examination showed expressive aphasia and right-sided weakness. CT brain showed no intracranial hemorrhage. CT angiography did not show large vessel occlusion. MRI brain later confirmed acute ischemic stroke in the left middle cerebral artery territory.
Past medical history: Paroxysmal atrial fibrillation, hypertension, and hyperlipidemia. No history of intracranial bleeding.
Hospital course: Intravenous thrombolysis was given after exclusion of hemorrhage. Symptoms improved partially. Cardiac monitoring showed intermittent atrial fibrillation.
Discharge assessment:
1. Acute ischemic stroke in the left middle cerebral artery territory.
2. Expressive aphasia, improving.
3. Paroxysmal atrial fibrillation, likely embolic source.
4. Intracranial hemorrhage ruled out.
Plan: Start oral anticoagulation after repeat brain imaging. Continue statin and antihypertensive therapy. Outpatient stroke clinic follow-up and community physiotherapy.
```

## Mention-by-mention review

| # | Source evidence | Search phrase | Top code and term | App decision | Manual verdict and required interpretation |
|---:|---|---|---|---|---|
| 1 | right arm weakness | right arm weakness | Uncoded | abstain | **unresolved** — Sudden right-arm weakness is uncoded. Preserve site/laterality/onset; do not infer paralysis or a vascular cause from the symptom alone. |
| 2 | difficulty speaking | difficulty speaking | 286378009 · Difficulty speaking | accepted | **supported** — Difficulty speaking is supported without inventing a particular speech disorder subtype. |
| 3 | symptom onset | symptom onset | Uncoded | abstain | **context** — Arrival within two hours of onset is temporal context, not a coded disease. |
| 4 | Neurological examination | neurological examination | 84728005 · Neurological examination | accepted | **supported** — Completed neurological examination is supported. |
| 5 | expressive aphasia | expressive aphasia | 229665008 · Expressive aphasia | accepted | **supported** — Expressive aphasia finding is suitable. |
| 6 | right-sided weakness | right-sided weakness | Uncoded | abstain | **unresolved** — Right-sided weakness remains uncoded; retain laterality. |
| 7 | CT brain | CT brain | 34227000 · CT of brain | review | **supported** — Brain CT is correct; no contrast protocol is specified. |
| 8 | no intracranial hemorrhage | intracranial hemorrhage | 1386000 · Intracranial hemorrhage | accepted | **supported** — CT showed no intracranial hemorrhage; preserve the test-time evidence. |
| 9 | CT angiography | CT angiography | 418272005 · CT angiography with contrast | review | **partial** — CTA is suitable at procedure level; anatomical head/brain context should be linked, and a specific protocol not inferred solely from a generic candidate. |
| 10 | large vessel occlusion | large vessel occlusion | 724993002 · Cerebral ischemic stroke due to occlusion of extracranial large artery | review | **reject** — No large-vessel occlusion on CTA is not absence of ischemic stroke due to extracranial large-artery occlusion. A negative vascular finding is not a negated stroke subtype. |
| 11 | MRI brain | MRI brain | 816077007 · MRI of brain | review | **supported** — Brain MRI is correct; functional imaging/T2-mapping protocol is not stated. |
| 12 | acute ischemic stroke | acute ischemic stroke | 724424009 · Cerebral ischemic stroke due to small artery occlusion | review | **reject** — MRI-confirmed ischemic stroke does not establish small-artery occlusion. The unqualified ischemic-stroke alternative is a safer base, preserving acute course and left MCA territory. Review candidate 422504002. |
| 13 | Paroxysmal atrial fibrillation | paroxysmal atrial fibrillation | 282825002 · Paroxysmal atrial fibrillation | accepted | **supported** — PMH paroxysmal AF has unspecified activity here; current evidence follows separately. |
| 14 | hypertension | hypertension | 38341003 · Hypertension | accepted | **supported** — PMH hypertension activity unspecified; continued therapy should be reviewed as further evidence rather than marking it resolved. |
| 15 | hyperlipidemia | hyperlipidemia | 55822004 · Hyperlipidemia | accepted | **supported** — PMH hyperlipidemia activity unspecified; continued statin therapy is separate evidence. |
| 16 | No history of intracranial bleeding | intracranial bleeding | 1386000 · Intracranial haemorrhage | review | **supported** — No prior intracranial bleeding maps to intracranial hemorrhage with negative historical context. |
| 17 | Intravenous thrombolysis | intravenous thrombolysis | 32912007 · Thrombolysis of coronary artery by intravenous infusion | review | **reject** — IV thrombolysis after brain imaging is not coronary thrombolysis. The displayed cerebral-artery thrombolysis candidate is relevant and needs procedure-context review. Review candidate 472191000119101. |
| 18 | exclusion of hemorrhage | hemorrhage | 131148009 · Hemorrhage | accepted | **partial** — Hemorrhage was excluded in the intracranial stroke workup; generic bleeding code loses that anatomical evidence and must not deny all bleeding. |
| 19 | Symptoms improved partially | partial improvement of symptoms | 711384005 · Reduction of peripheral edema (finding) | review | **reject** — Partial neurological symptom improvement is not reduction of peripheral edema. |
| 20 | Cardiac monitoring | cardiac monitoring | 710839006 · Assessment of cardiac status using monitoring device | abstain | **supported** — Cardiac-status monitoring is a reasonable candidate for completed cardiac monitoring despite mapper abstention; device implantation/removal alternatives are unsupported. |
| 21 | intermittent atrial fibrillation | atrial fibrillation | 49436004 · Atrial fibrillation | accepted | **supported** — Intermittent AF is observed during admission; consolidate with documented paroxysmal AF after review, without changing likely embolic attribution to confirmed. |
| 22 | Acute ischemic stroke | acute ischemic stroke | 724424009 · Cerebral ischemic stroke due to small artery occlusion | review | **reject** — Discharge acute ischemic stroke must not become a small-artery occlusion diagnosis. Review candidate 422504002. |
| 23 | Expressive aphasia | expressive aphasia | 229665008 · Expressive aphasia | accepted | **supported** — Expressive aphasia is still present and improving. |
| 24 | Paroxysmal atrial fibrillation | paroxysmal atrial fibrillation | 282825002 · Paroxysmal atrial fibrillation | accepted | **supported** — Current paroxysmal AF is a comorbidity; embolic mechanism is separately likely. |
| 25 | likely embolic source | embolic source | Uncoded | abstain | **context** — Likely embolic-source attribution is a uncertain relation, not proof of a coded embolism or cause. |
| 26 | Intracranial hemorrhage ruled out | intracranial hemorrhage | 1386000 · Intracranial hemorrhage | accepted | **supported** — Intracranial hemorrhage explicitly ruled out. |
| 27 | oral anticoagulation | oral anticoagulation | 781070002 · Dabigatran only product in oral dose form | review | **reject** — Future oral anticoagulation does not specify dabigatran or any other drug. Ticagrelor is an antiplatelet and is not an interchangeable anticoagulant; retain repeat-imaging prerequisite. |
| 28 | repeat brain imaging | brain imaging | 241603006 · MRI of brain with functional imaging | review | **reject** — Repeat brain imaging does not specify functional MRI. A generic brain-imaging candidate exists for further review. Review candidate 441986001. |
| 29 | statin | statin | 372912004 · Statin | accepted | **supported** — Continue statin class without molecule/dose invention. |
| 30 | antihypertensive therapy | antihypertensive therapy | 779480004 · Hydrochlorothiazide and valsartan only product in oral dose form | review | **reject** — Antihypertensive therapy does not establish hydrochlorothiazide/valsartan or any combination product. |
| 31 | Outpatient stroke clinic follow-up | stroke clinic follow-up | Uncoded | abstain | **unresolved** — Outpatient stroke-clinic follow-up has no adequate code; retain the planned referral. |
| 32 | community physiotherapy | community physiotherapy | 306171006 · Referral to community-based physiotherapy service | review | **supported** — Future community physiotherapy referral is compatible with the stated plan; discharge-from-service alternative is unsuitable. |

## Evidence and candidate context

Exact offsets, assertion, subject, temporality, workflow, qualifiers, displayed alternatives, scores, and lexical comparison (where captured) are retained in the structured review.

[Structured full review](../full-review.json)

[Raw hybrid run](</Users/francesc.mateu/Documents/GitHub/AI-Ready-Clinical-Semantics/docs/reviews/runs/semantic-order-20261112/ex-stroke-en-hybrid.json>)
