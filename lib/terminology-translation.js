import { getCollection } from '@/lib/mongo';
import { getMongoConfig, getSemanticsConfig } from '@/lib/config';
import { SNOMED_SYSTEM, mappingRequiresContext, translationParameters } from '@/lib/code-mappings';
export async function translateCode(body) {
  body = { ...body, sourceVersion: body.sourceVersion || body.version };
  const code = String(body.code || '').trim(), system = String(body.system || SNOMED_SYSTEM).trim(), targetSystem = String(body.targetSystem || body.targetsystem || '').trim();
  if (!code || code.length > 80 || !targetSystem) throw new Error('A source code, source system and target system are required.');
  const { sourceCollection } = getMongoConfig(), { releaseId } = getSemanticsConfig();
  const source = await getCollection(sourceCollection), reverse = system !== SNOMED_SYSTEM;
  if (reverse && targetSystem !== SNOMED_SYSTEM) throw new Error('Translate through SNOMED CT as the hub.');
  if (reverse && !(await source.listIndexes().toArray()).some(index => index.key['mappings.mapTarget'])) return { ok: true, reverse, rows: [], fhir: translationParameters([], { reverse }) };
  const match = { targetSystem: reverse ? system : targetSystem, ...(body.targetVersion && !reverse ? { targetVersion: body.targetVersion } : {}), ...(body.sourceVersion && reverse ? { targetVersion: body.sourceVersion } : {}) };
  const filter = { ...(releaseId ? { releaseId } : {}), ...(reverse ? { mappings: { $elemMatch: { ...match, mapTarget: code, active: true } } } : { conceptId: code }) };
  const docs = await source.find(filter, { projection: { conceptId: 1, mappings: 1, descriptions: 1 } }).limit(101).maxTimeMS(8000).toArray();
  const rows = [];
  for (const doc of docs.slice(0, 100)) for (const mapping of doc.mappings || []) {
    if (mapping.active !== true || mapping.targetSystem !== match.targetSystem || (reverse && mapping.mapTarget !== code) ||
      (match.targetVersion && mapping.targetVersion !== match.targetVersion)) continue;
    const display = reverse ? doc.descriptions?.find(d => d.active && d.languageCode === 'en' && d.typeId === '900000000000013009')?.term : null;
    rows.push({ conceptId: doc.conceptId, mapping, targetCode: reverse ? String(doc.conceptId) : mapping.mapTarget,
      targetSystem, targetVersion: reverse ? releaseId : mapping.targetVersion, display, requiresContext: mappingRequiresContext(mapping) });
  }
  rows.sort((a, b) => Number(a.mapping.mapGroup) - Number(b.mapping.mapGroup) || Number(a.mapping.mapPriority) - Number(b.mapping.mapPriority));
  return { ok: true, reverse, rows, fhir: translationParameters(rows, { reverse, truncated: docs.length > 100 }) };
}
