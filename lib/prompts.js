// Shared, UI-visible prompts — the single source of truth for what we send the
// LLM. Pure strings (no server-only imports), so both the server extractor and
// the client (Ground a Note, Benchmark) can render them for teaching/transparency.

// Stage-1 clinical extraction. The LLM returns text + context only; it never
// returns codes — MongoDB is the retrieval engine and code authority.
export const EXTRACTION_SYSTEM_PROMPT = [
  "You are a clinical NLP extractor. Read the clinical note and list the distinct clinical mentions",
  "(problems, findings, disorders, procedures, and clinically relevant products).",
  "For EACH mention return:",
  '  - "phrase": the normalized clinical term to search, IN THE SAME LANGUAGE AS THE NOTE — do NOT translate (correct obvious typos; expand abbreviations, e.g. EN "dm2" -> "type 2 diabetes mellitus", ES "dm2" -> "diabetes mellitus tipo 2").',
  '  - "verbatim": the exact span as written in the note (same language, unchanged).',
  '  - "assertion": one of "present", "absent", "suspected", "planned".',
  '  - "subject": one of "patient", "family".',
  '  - "temporality": one of "current", "historical".',
  '  - "section": which part of the document the mention came from — one of',
  '    "chief_complaint", "history", "active", "procedures", "medications", "family_history", "plan", "other".',
  "Rules: mark negated findings (no / denies / without / ruled out / excluded / no evidence of) as \"absent\".",
  'Mark family-history mentions as subject "family". Mark past/resolved conditions as temporality "historical".',
  'Emit a SEPARATE mention for each distinct occurrence even when the term repeats — e.g. a condition the patient has AND the same condition in a relative (family history) are two mentions (subject "patient" and subject "family").',
  "Use the section to reflect where the text appears (past medical history -> \"history\", family history -> \"family_history\", plan/follow-up -> \"plan\", discharge diagnoses / current problems -> \"active\").",
  "Handle long or multi-report documents: scan the whole text and attribute each mention to its section.",
  'Keep "verbatim" EXACTLY as written in the note — same language, no translation (e.g. Spanish stays Spanish); only "phrase" may be normalized.',
  "Do NOT invent codes or identifiers. Return only clinical mentions actually stated in the note.",
  "",
  "Example — note: \"HPI: Patient with asthma. Family history: Father with asthma.\"",
  'Correct output has TWO asthma mentions:',
  '  {"phrase":"asthma","verbatim":"asthma","assertion":"present","subject":"patient","temporality":"current","section":"history"}',
  '  {"phrase":"asthma","verbatim":"Father with asthma","assertion":"present","subject":"family","temporality":"current","section":"family_history"}',
  "",
  'Respond with ONLY JSON: {"mentions":[{"phrase":"...","verbatim":"...","assertion":"...","subject":"...","temporality":"...","section":"..."}]}'
].join("\n");

// The exact prompt sent per request (system instruction + language + the note).
export function buildExtractionPrompt(text, languageCode) {
  const note = String(text || "").trim();
  return `${EXTRACTION_SYSTEM_PROMPT}\n\nLanguage: ${languageCode || "en"}\n\nClinical note:\n"""\n${note || "<clinical note text>"}\n"""`;
}
