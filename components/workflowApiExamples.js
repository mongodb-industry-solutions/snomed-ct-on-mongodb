const DEFAULT_CLINICAL_TEXT = [
  "HPI: Patient with type 2 diabetes.",
  "Assessment: History of diabetic nephropathy. No evidence of retinopathy on current review.",
  "Family history: Mother with type 2 diabetes.",
  "Plan: Continue metformin and repeat urine albumin."
].join("\n");

function toPrettyJson(value) {
  return JSON.stringify(value, null, 2);
}

function shellEscapeSingleQuotes(value) {
  return String(value || "").replace(/'/g, `'"'"'`);
}

function buildCurlCommand({ method = "GET", path, body = null }) {
  if (!body) {
    return `curl -s '${shellEscapeSingleQuotes(path)}'`;
  }

  return [
    `curl -s -X ${method.toUpperCase()} '${shellEscapeSingleQuotes(path)}'`,
    `  -H 'Content-Type: application/json'`,
    `  -d '${shellEscapeSingleQuotes(toPrettyJson(body))}'`
  ].join(" \\\n");
}

export function formatApiPayload(value) {
  return toPrettyJson(value);
}

export function buildWorkflowApiExamples({
  activeTab,
  conceptIdInput,
  selectedConcept,
  languageCode,
  smartEcl,
  scopeReleaseId,
  targetContext,
  retrievalProfile,
  query,
  clinicalText
}) {
  const selectedConceptId = String(selectedConcept?.conceptId || conceptIdInput || "404684003").trim() || "404684003";
  const selectedTerm = selectedConcept?.preferredTerm || selectedConcept?.term || "Clinical finding";
  const activeLanguage = String(languageCode || "en").toLowerCase() || "en";
  const scopedEcl = String(smartEcl || "<<404684003").trim() || "<<404684003";
  const scopedReleaseId = String(scopeReleaseId || "latest").trim() || "latest";
  const encodedEcl = encodeURIComponent(scopedEcl);
  const encodedReleaseId = encodeURIComponent(scopedReleaseId);
  const noteText = String(clinicalText || DEFAULT_CLINICAL_TEXT).trim() || DEFAULT_CLINICAL_TEXT;
  const searchText = String(activeTab === "intelligent" ? noteText : query || "breast carcinoma").trim() || "breast carcinoma";
  const codingContext = String(targetContext || "Condition.code").trim() || "Condition.code";
  const retrievalMode = String(retrievalProfile || "lexical_exact").trim() || "lexical_exact";

  const examplesByTab = {
    navigate: [
      {
        key: "navigator-search",
        label: "Concept search",
        method: "POST",
        path: "/api/navigator-search",
        body: {
          query: searchText,
          languageCode: activeLanguage,
          limit: 10
        },
        response: {
          ok: true,
          pattern: "navigator-search",
          results: [
            { conceptId: selectedConceptId, term: selectedTerm, score: 12.4 }
          ]
        }
      },
      {
        key: "hierarchy",
        label: "Concept hierarchy",
        method: "POST",
        path: "/api/hierarchy",
        body: {
          conceptId: selectedConceptId,
          languageCode: activeLanguage
        },
        response: {
          ok: true,
          pattern: "hierarchy",
          concept: { conceptId: selectedConceptId, term: selectedTerm },
          parents: [{ conceptId: "404684003", term: "Clinical finding" }],
          children: []
        }
      }
    ],
    intelligent: [
      {
        key: "nlp-map",
        label: "Note grounding",
        method: "POST",
        path: "/api/nlp-map",
        body: {
          text: noteText,
          languageCode: activeLanguage,
          ecl: scopedEcl,
          releaseId: scopedReleaseId,
          targetContext: codingContext,
          retrievalProfile: retrievalMode,
          maxPhrases: 8,
          searchTimeoutMs: 1500
        },
        response: {
          ok: true,
          pattern: "clinical-nlp-mapping",
          degraded: false,
          language: {
            detectedLanguageCode: activeLanguage
          },
          stats: {
            acceptedCount: 1,
            reviewCount: 2,
            abstainCount: 0,
            timedOutPhrases: 0
          }
        }
      },
      {
        key: "coding-confirm",
        label: "Save confirmed codings",
        method: "POST",
        path: "/api/coding-confirm",
        body: {
          text: noteText,
          languageCode: activeLanguage,
          tenantId: "demo-hospital",
          codings: [
            {
              conceptId: selectedConceptId,
              display: selectedTerm,
              target: codingContext,
              assertion: "present",
              subject: "patient"
            }
          ]
        },
        response: {
          ok: true,
          pattern: "coding-confirm",
          collection: "grounded_notes",
          savedCodings: 1,
          sampleAncestorIds: [selectedConceptId, "404684003"]
        }
      }
    ]
  };

  return (examplesByTab[activeTab] || []).map((example) => ({
    ...example,
    curl: buildCurlCommand(example)
  }));
}
