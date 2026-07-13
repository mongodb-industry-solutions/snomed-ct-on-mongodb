import "./loadEnv.mjs";

const SMOKE_CONCEPT_IDS = [
  // Search & Navigate examples.
  "44054006", // Type 2 diabetes mellitus
  "254838004", // Breast carcinoma
  "22298006", // Myocardial infarction
  "84114007", // Heart failure
  "422034002", // Diabetic retinopathy
  "127013003", // Diabetic nephropathy
  // Broad roots and common hierarchy anchors shown in the demo.
  "138875005", // SNOMED CT Concept
  "404684003", // Clinical finding
  "71388002", // Procedure
  "123037004", // Body structure
  "373873005", // Pharmaceutical / biologic product
  "105590001", // Substance
  "64572001", // Disease
  "73211009", // Diabetes mellitus
  "105981003" // Disorder of cardiac function
];

const DEMO_BRANCH_CONCEPT_IDS = [
  "49601007", // Cardiovascular disorder
  "363346000", // Malignant neoplastic disease
  "73211009", // Diabetes mellitus
  "84114007", // Heart failure
  "254838004", // Breast carcinoma
  "387713003", // Surgical procedure
  "373873005" // Pharmaceutical / biologic product
];

const DEFAULT_SNOMED_RELEASE_ID = "20260601";
const VALID_SCOPES = new Set(["smoke", "demo", "explicit", "area", "full"]);

function envBoolean(name, defaultValue = false) {
  const raw = process.env[name];
  if (raw == null || raw === "") {
    return defaultValue;
  }
  return ["1", "true", "yes", "on"].includes(String(raw).trim().toLowerCase());
}

function envList(name) {
  return String(process.env[name] || "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

function clearEnv(name) {
  delete process.env[name];
}

// Rebuild the existing search sidecar as a term-level SNOMED projection.
//
// Default mode is intentionally non-destructive: it upserts one document per
// active description into the configured MONGODB_TERM_SEARCH_COLLECTION. Set
// TERM_PROJECTION_REPLACE_RELEASE=true to replace the sidecar docs for the
// selected release without dropping MongoDB Search index definitions.
process.env.PROJECTION_BUILD_ENABLED = "true";
process.env.PROJECTION_RESET_BEFORE_BUILD = envBoolean("TERM_PROJECTION_RESET", false) ? "true" : "false";
process.env.PROJECTION_INCLUDE_ALL_RELEASES = envBoolean("TERM_PROJECTION_INCLUDE_ALL_RELEASES", false) ? "true" : "false";
process.env.PROJECTION_CLEAR_TERM_DOCS = envBoolean("TERM_PROJECTION_CLEAR_TERMS", false) ? "true" : "false";
process.env.PROJECTION_REPLACE_RELEASE_DOCS = envBoolean("TERM_PROJECTION_REPLACE_RELEASE", false) ? "true" : "false";
process.env.EMBED_ENABLED = envBoolean("TERM_PROJECTION_EMBED", false) ? "true" : "false";
const releaseIdDefaulted = !process.env.SNOMED_RELEASE_ID && !process.env.RELEASE_ID_TARGET;
process.env.SNOMED_RELEASE_ID = process.env.SNOMED_RELEASE_ID || process.env.RELEASE_ID_TARGET || DEFAULT_SNOMED_RELEASE_ID;

const hasExplicitIds = envList("PROJECTION_CONCEPT_IDS").length > 0;
const hasAreaScope = Boolean(String(process.env.PROJECTION_AREA_CONCEPT_ID || "").trim());
const hasMultiAreaScope = envList("PROJECTION_AREA_CONCEPT_IDS").length > 0;
const requestedScope = String(process.env.TERM_PROJECTION_SCOPE || "").trim().toLowerCase();
let scope = requestedScope || (hasAreaScope || hasMultiAreaScope ? "area" : hasExplicitIds ? "explicit" : "demo");

if (!VALID_SCOPES.has(scope)) {
  throw new Error(`Invalid TERM_PROJECTION_SCOPE=${scope}. Expected one of: ${Array.from(VALID_SCOPES).join(", ")}`);
}

if (scope === "smoke") {
  process.env.PROJECTION_CONCEPT_IDS = SMOKE_CONCEPT_IDS.join(",");
  clearEnv("PROJECTION_AREA_CONCEPT_ID");
  clearEnv("PROJECTION_AREA_CONCEPT_IDS");
} else if (scope === "demo") {
  clearEnv("PROJECTION_CONCEPT_IDS");
  clearEnv("PROJECTION_AREA_CONCEPT_ID");
  process.env.PROJECTION_AREA_CONCEPT_IDS = process.env.PROJECTION_AREA_CONCEPT_IDS || DEMO_BRANCH_CONCEPT_IDS.join(",");
  process.env.PROJECTION_AREA_RELATION = process.env.PROJECTION_AREA_RELATION || "descendants";
  process.env.PROJECTION_MAX_CONCEPT_IDS = process.env.PROJECTION_MAX_CONCEPT_IDS || "8000";
  process.env.PROJECTION_MAX_TOTAL_CONCEPT_IDS = process.env.PROJECTION_MAX_TOTAL_CONCEPT_IDS || "25000";
} else if (scope === "explicit") {
  if (!hasExplicitIds) {
    throw new Error("TERM_PROJECTION_SCOPE=explicit requires PROJECTION_CONCEPT_IDS.");
  }
  clearEnv("PROJECTION_AREA_CONCEPT_ID");
  clearEnv("PROJECTION_AREA_CONCEPT_IDS");
} else if (scope === "area") {
  if (!hasAreaScope && !hasMultiAreaScope) {
    throw new Error("TERM_PROJECTION_SCOPE=area requires PROJECTION_AREA_CONCEPT_ID or PROJECTION_AREA_CONCEPT_IDS.");
  }
} else if (scope === "full") {
  clearEnv("PROJECTION_CONCEPT_IDS");
  clearEnv("PROJECTION_AREA_CONCEPT_ID");
  clearEnv("PROJECTION_AREA_CONCEPT_IDS");
}

const scopeConceptIds = envList("PROJECTION_CONCEPT_IDS");
const areaConceptId = String(process.env.PROJECTION_AREA_CONCEPT_ID || "").trim();
const areaConceptIds = envList("PROJECTION_AREA_CONCEPT_IDS");
const areaRelation = String(process.env.PROJECTION_AREA_RELATION || "descendants").trim();
const areaMax = String(process.env.PROJECTION_MAX_CONCEPT_IDS || "5000").trim();
const areaTotalMax = String(process.env.PROJECTION_MAX_TOTAL_CONCEPT_IDS || "25000").trim();

console.log("Term projection rebuild wrapper");
console.log(`  releaseId=${process.env.SNOMED_RELEASE_ID}`);
if (releaseIdDefaulted) {
  console.log(`  releaseIdDefault=${DEFAULT_SNOMED_RELEASE_ID}`);
}
console.log(`  scopeMode=${scope}`);
if (scopeConceptIds.length > 0) {
  console.log(`  conceptIds=${scopeConceptIds.length}`);
}
if (areaConceptId) {
  console.log(`  areaConceptId=${areaConceptId}`);
}
if (areaConceptIds.length > 0) {
  console.log(`  areaConceptIds=${areaConceptIds.length}`);
}
if (areaConceptId || areaConceptIds.length > 0) {
  console.log(`  areaRelation=${areaRelation}`);
  console.log(`  areaMaxConceptIdsPerBranch=${areaMax}`);
  console.log(`  areaMaxTotalConceptIds=${areaTotalMax}`);
}
if (scope === "full") {
  console.log("  fullReleaseWarning=true");
}
console.log(`  reset=${process.env.PROJECTION_RESET_BEFORE_BUILD}`);
console.log(`  clearTermDocs=${process.env.PROJECTION_CLEAR_TERM_DOCS}`);
console.log(`  replaceReleaseDocs=${process.env.PROJECTION_REPLACE_RELEASE_DOCS}`);
console.log(`  includeAllReleases=${process.env.PROJECTION_INCLUDE_ALL_RELEASES}`);
console.log(`  embeddings=${process.env.EMBED_ENABLED}`);

await import("./buildProjection.mjs");
