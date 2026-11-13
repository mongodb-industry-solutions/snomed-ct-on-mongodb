export const SNOMED_SYSTEM = 'http://snomed.info/sct';
export const MAPPING_SYSTEMS = [
  { label: 'SNOMED CT', uri: SNOMED_SYSTEM },
  { label: 'ICD-10 (WHO)', uri: 'http://hl7.org/fhir/sid/icd-10' },
  { label: 'ICD-10-CM', uri: 'http://hl7.org/fhir/sid/icd-10-cm' },
  { label: 'ICPC-2', uri: 'http://hl7.org/fhir/sid/icpc-2' },
  { label: 'CTV3', uri: 'http://read.info/ctv3' }
];
export function mappingRequiresContext(mapping) {
  return !!mapping.mapRule && !/^(TRUE|OTHERWISE TRUE)$/i.test(mapping.mapRule.trim());
}
export function translationParameters(rows, { reverse = false, truncated = false } = {}) {
  const contextual = rows.some(row => mappingRequiresContext(row.mapping));
  const message = !rows.length ? 'No published mapping is loaded for this code and target system.'
    : reverse ? 'Reverse lookup returns candidates from a directional map. It does not establish equivalent meaning.'
    : contextual ? 'Conditional mapping candidates: evaluate the published rules and group priorities before assigning target codes.'
    : 'Published mapping targets. Preserve their map groups, advice and classification version.';
  return { resourceType: 'Parameters', parameter: [
    { name: 'result', valueBoolean: rows.length > 0 }, { name: 'message', valueString: message + (truncated ? ' Results were limited.' : '') },
    ...rows.map(row => ({ name: 'match', part: [
      { name: 'equivalence', valueCode: reverse || contextual ? 'relatedto' : row.mapping.equivalence || 'relatedto' },
      { name: 'concept', valueCoding: { system: row.targetSystem, code: row.targetCode, ...(row.targetVersion ? { version: row.targetVersion } : {}), ...(row.display ? { display: row.display } : {}) } },
      { name: 'source', valueUri: `http://snomed.info/sct?fhir_cm=${row.mapping.refsetId}` }
    ], extension: [
      { url: 'urn:snomed-demo:map-group', valueInteger: Number(row.mapping.mapGroup) || 1 },
      { url: 'urn:snomed-demo:map-priority', valueInteger: Number(row.mapping.mapPriority) || 1 },
      ...(row.mapping.mapRule ? [{ url: 'urn:snomed-demo:map-rule', valueString: row.mapping.mapRule }] : []),
      ...(row.mapping.mapAdvice ? [{ url: 'urn:snomed-demo:map-advice', valueString: row.mapping.mapAdvice }] : [])
    ] })) ] };
}
