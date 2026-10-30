import './loadEnv.mjs';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { DEMO_REQUIRED_CONCEPT_IDS } from '../lib/demo-concept-requirements.js';
const release = process.env.SNOMED_RELEASE_ID || '20260601';
const root = (process.env.SNOMED_MAP_SERVICE_URL || 'https://browser.ihtsdotools.org/snowstorm/snomed-ct').replace(/\/$/, '');
const branch = process.env.SNOMED_MAP_BRANCH || `MAIN/${release.slice(0,4)}-${release.slice(4,6)}-${release.slice(6,8)}`;
const refset = process.env.SNOMED_MAP_REFSET || '447562003';
const header = ['id','effectiveTime','active','moduleId','refsetId','referencedComponentId','mapGroup','mapPriority','mapRule','mapAdvice','mapTarget','correlationId','mapCategoryId'];
const rows = [];
for (const conceptId of DEMO_REQUIRED_CONCEPT_IDS) {
  const url = new URL(`${root}/${encodeURIComponent(branch)}/members`);
  url.search = new URLSearchParams({referenceSet:refset,referencedComponentId:conceptId,limit:'1000'});
  const response = await fetch(url, { headers: { accept:'application/json', ...(process.env.SNOMED_MAP_SERVICE_TOKEN ? { authorization:`Bearer ${process.env.SNOMED_MAP_SERVICE_TOKEN}` } : {}) }, signal:AbortSignal.timeout(20000) });
  if (!response.ok) throw new Error(`SNOMED mapping service returned HTTP ${response.status}. Obtain the licensed map Snapshot through your National Release Centre/MLDS, or configure an authorized Snowstorm service. No mapping targets were invented or imported.`);
  const data = await response.json();
  for (const member of data.items || []) {
    const fields = { ...member, id:member.memberId || member.id, active:member.active ? '1':'0', ...member.additionalFields };
    if (!fields.mapTarget) continue;
    rows.push(header.map(key => String(fields[key] ?? '').replace(/[\t\r\n]/g,' ')).join('\t'));
  }
}
if (!rows.length) throw new Error('This service/release did not return any mapping targets.');
const directory = path.resolve('tmp/terminology-maps');
await mkdir(directory,{recursive:true});
const file = path.join(directory,`der2_iisssccRefset_ExtendedMapSnapshot_demo_${release}.txt`);
await writeFile(file,[header.join('\t'),...rows].join('\n')+'\n');
await writeFile(file+'.provenance.json',JSON.stringify({service:root,branch,refset,sourceReleaseId:release,retrievedAt:new Date().toISOString(),requiredConcepts:DEMO_REQUIRED_CONCEPT_IDS.length,mapMembers:rows.length},null,2));
console.log(`Downloaded ${rows.length} published map members to ${file}. Import with mappings:import using the map's actual target classification/version.`);
