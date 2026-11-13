// Function-level evidence using reviewed captures. Does not save/export codes.
import {readFile,writeFile} from 'node:fs/promises';
import {codingToFhirResource} from '../../../lib/clinical-output.js';
import {clinicalCodeRole} from '../../../lib/clinical-code-type.js';

const review=JSON.parse(await readFile(new URL('./full-review.json',import.meta.url),'utf8'));
const issues=[];
for(const note of review.notes){
 const seen=new Map();
 for(const r of note.rows){
  if(r.applicationStatus!=='accepted'||!r.top)continue;
  const c={conceptId:r.top.conceptId,term:r.top.term,codeRole:clinicalCodeRole(r.top),subject:r.subject,assertion:r.assertion,temporality:r.temporality,workflow:r.workflow,attributes:r.attributes,phrase:r.source.text};
  const resource=codingToFhirResource(c);
  const issue=type=>issues.push({noteId:note.id,index:r.index,mentionId:r.mentionId,issue:type,attributes:r.attributes});
  if(r.subject==='family'&&!resource?.relationship)issue('family-relationship-not-structured');
  if(r.kind==='observation'&&(r.attributes.value||r.attributes.valor)&&!resource)issue('measurement-has-no-export-resource');
  if(r.kind==='symptom'&&r.assertion==='present'&&resource?.clinicalStatus?.coding?.some(c=>c.code==='active')&&note.id.includes('chestpain'))issue('encounter-pain-exported-as-active-despite-resolution');
  const key=[c.conceptId,c.assertion,c.subject,c.temporality,c.workflow].join('|');
  const first=seen.get(key);
  if(first&&Object.entries(c.attributes??{}).some(([k,v])=>JSON.stringify(first.attributes?.[k])!==JSON.stringify(v)))issues.push({noteId:note.id,index:r.index,mentionId:r.mentionId,issue:'later-qualifiers-lost-with-first-row-deduplication',firstMentionId:first.mentionId,laterAttributes:r.attributes});
  if(!first)seen.set(key,r);
 }
}
const report={checkedAt:new Date().toISOString(),notes:review.notes.length,scope:'Read-only function-level probes using accepted captured results and the workbench deduplication key. Not browser observation, actual output selection, saving, or full FHIR conformance validation.',issueCounts:issues.reduce((out,r)=>(out[r.issue]=(out[r.issue]??0)+1,out),{}),issues};
await writeFile(new URL('./output-audit.json',import.meta.url),JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify({notes:report.notes,counts:report.issueCounts}));
