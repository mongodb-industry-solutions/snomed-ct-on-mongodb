// Render the manually adjudicated evaluation data. No runtime mapping changes.
import fs from 'node:fs/promises';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {EXAMPLE_GROUPS} from '../../../lib/example-notes.js';
import {GOLD_NOTES} from '../../../lib/gold-notes.js';

const folder=path.dirname(new URL(import.meta.url).pathname);
const option=(key,fallback)=>process.argv.includes(key)?process.argv[process.argv.indexOf(key)+1]:fallback;
const appliedRuns=option('--applied-runs','/Users/francesc.mateu/Documents/GitHub/AI-Ready-Clinical-Semantics/docs/reviews/runs/semantic-order-20261112');
const pairedRuns=option('--paired-runs','/Users/francesc.mateu/Documents/GitHub/AI-Ready-Clinical-Semantics/docs/reviews/runs/validated-20261112');
const manual=JSON.parse(await fs.readFile(path.join(folder,'manual-annotations.json'),'utf8'));
const summaries=JSON.parse(await fs.readFile(path.join(folder,'note-summaries.json'),'utf8'));
const coverage=JSON.parse(await fs.readFile(path.join(folder,'canonical-source-audit.json'),'utf8'));
const checks=await Promise.all([path.join(appliedRuns,'validation-checks.json'),path.join(folder,'benchmark-runs/validation-checks.json')].map(async p=>JSON.parse(await fs.readFile(p,'utf8'))));
const examples=[...EXAMPLE_GROUPS.flatMap(g=>g.notes).map(n=>({...n,set:'applied'})),...GOLD_NOTES.map(n=>({...n,set:'benchmark'}))];
const escape=value=>String(value??'—').replace(/\|/g,'\\|').replace(/\n/g,' ');
const link=(label,target)=>`[${label}](<${target}>)`;
const countBy=(list,key)=>list.reduce((out,row)=>(out[key(row)]=(out[key(row)]??0)+1,out),{});
const hash=text=>createHash('sha256').update(text).digest('hex');
await fs.mkdir(path.join(folder,'notes'),{recursive:true});
const reviewed=[];
for(const example of examples){
 const runFile=path.join(example.set==='applied'?appliedRuns:path.join(folder,'benchmark-runs'),example.id+'-hybrid.json');
 const raw=await fs.readFile(runFile,'utf8');const run=JSON.parse(raw);
 if(!run.response.ok||run.request.text!==example.text)throw new Error('Source/run mismatch: '+example.id);
 const ann=manual.notes[example.id];
 if(!ann||ann.length!==run.response.results.length||ann.some((r,i)=>r[0]!==i))throw new Error('Incomplete manual review: '+example.id);
 let lexical=null;
 if(example.set==='applied')lexical=JSON.parse(await fs.readFile(path.join(pairedRuns,example.id+'-lexical.json'),'utf8'));
 const rows=ann.map(([index,verdict,rationale,recommendedCandidateId])=>{
  const r=run.response.results[index];
  const candidate=c=>c?{conceptId:c.conceptId,term:c.term,fsn:c.fsn,semanticTag:c.semanticTag,matchedTerm:c.matchedTerm,rerankScore:c.rerankScore}:null;
  const proof=recommendedCandidateId?coverage.candidateConcepts.find(c=>c.conceptId===recommendedCandidateId):null;
  return {index,mentionId:r.mentionId,source:r.span,phrase:r.phrase,kind:r.kind,section:r.section,assertion:r.assertion,subject:r.experiencer,temporality:r.temporality,workflow:r.workflow,attributes:r.attributes,applicationStatus:r.status,top:candidate(r.topCandidate),alternatives:(r.alternatives??[]).map(candidate),manual:{verdict,rationale,...(recommendedCandidateId?{recommendedCandidateId,canonicalActive:proof?proof.active===true:null,canonicalVerification:proof?'read-only source audit':(r.alternatives??[]).some(c=>c.conceptId===recommendedCandidateId)?'Active membership verified in the run candidate-pool check':'Not independently checked',projectedLanguages:proof?.projectedLanguages??[]}:{} )},...(lexical?{lexicalTop:candidate(lexical.response.results[index]?.topCandidate),lexicalStatus:lexical.response.results[index]?.status}:{})};
 });
 const check=checks.flatMap(c=>c.rows).find(c=>c.file===example.id+'-hybrid.json');
 const item={id:example.id,title:example.title,set:example.set,sourceText:example.text,sourceSha256:hash(example.text),runFile,runSha256:hash(raw),summary:summaries[example.id],principal:run.response.principalDiagnosis?{conceptId:run.response.principalDiagnosis.conceptId,term:run.response.principalDiagnosis.term}:null,comorbidities:run.response.comorbidities.map(c=>({conceptId:c.conceptId,term:c.term})),contractCheck:check,verdictCounts:countBy(rows,r=>r.manual.verdict),rows};
 reviewed.push(item);
 const body=[`# ${example.title}`, '', `Reviewed 12 November 2026. Set: ${example.set}. ${rows.length} mentions; every row manually annotated.`, '', `Expected encounter problem: **${item.summary.expectedPrincipal}**. Automatic principal: **${item.principal?.term??'unset'}**. Principal review: **${item.summary.principalReview}**.`, '', item.summary.comorbidities, '', item.summary.keyFindings, '', 'The verdict concerns the top proposal and source context. Supported proposals can still require manual mapping acceptance or better structured output. Suspected/absent/family/planned facts never become confirmed current patient diagnoses merely because a code matches.', '', '## Source note', '', '```text',example.text,'```','', '## Mention-by-mention review', '', '| # | Source evidence | Search phrase | Top code and term | App decision | Manual verdict and required interpretation |','|---:|---|---|---|---|---|'];
 for(const r of rows)body.push(`| ${r.index+1} | ${escape(r.source.text)} | ${escape(r.phrase)} | ${escape(r.top?`${r.top.conceptId} · ${r.top.term}`:'Uncoded')} | ${r.applicationStatus} | **${r.manual.verdict}** — ${escape(r.manual.rationale)}${r.manual.recommendedCandidateId?` Review candidate ${r.manual.recommendedCandidateId}.`:''} |`);
 body.push('', '## Evidence and candidate context', '', 'Exact offsets, assertion, subject, temporality, workflow, qualifiers, displayed alternatives, scores, and lexical comparison (where captured) are retained in the structured review.', '', link('Structured full review',path.join(folder,'full-review.json')), '',link('Raw hybrid run',runFile),'');
 await fs.writeFile(path.join(folder,'notes',example.id+'.md'),body.join('\n'));
}
const rows=reviewed.flatMap(n=>n.rows);
const review={reviewedAt:'2026-11-12',scope:manual.scope,verdictDefinitions:manual.verdicts,notesReviewed:reviewed.length,mentionsReviewed:rows.length,verdictCounts:countBy(rows,r=>r.manual.verdict),applicationVsManual:countBy(rows,r=>`${r.applicationStatus}/${r.manual.verdict}`),principalReviewCounts:countBy(reviewed,n=>n.summary.principalReview),technicalChecks:{runCount:checks.reduce((s,c)=>s+c.runs,0),contractIssues:checks.reduce((s,c)=>s+c.contractIssues,0),lexicalBranches:checks.flatMap(c=>c.rows).reduce((s,c)=>s+c.lexicalBranches,0),vectorBranches:checks.flatMap(c=>c.rows).reduce((s,c)=>s+c.vectorBranches,0),timeouts:checks.flatMap(c=>c.rows).reduce((s,c)=>s+c.timeouts,0),canonicalCandidateCodesBySet:checks.map(c=>c.sourceCodesChecked),meaning:'Structural execution/source checks, not clinical accuracy; candidate counts by set overlap.'},notes:reviewed};
await fs.writeFile(path.join(folder,'full-review.json'),JSON.stringify(review,null,2)+'\n');
const table=['| Example | Mentions | Principal review | Supported | Partial | Reject | Unresolved | Context |','|---|---:|---|---:|---:|---:|---:|---:|',...reviewed.map(n=>`| ${link(n.title,path.join(folder,'notes',n.id+'.md'))} | ${n.rows.length} | ${n.summary.principalReview} | ${n.verdictCounts.supported??0} | ${n.verdictCounts.partial??0} | ${n.verdictCounts.reject??0} | ${n.verdictCounts.unresolved??0} | ${n.verdictCounts.context??0} |`)];
await fs.writeFile(path.join(folder,'README.md'),['# Full example review','',`Reviewed all **${reviewed.length} built-in clinical notes and ${rows.length} returned mentions**: nine applied examples and seven benchmark notes. The live benchmark inventory had no custom notes on this review date.`, '', `Manual counts: ${Object.entries(review.verdictCounts).map(([k,v])=>`${v} ${k}`).join('; ')}. These include repeats, negatives, family and plans; they are not a clinical accuracy percentage.`, '', ...table, '', link('Findings and next corrections',path.resolve(folder,'../../FULL_EXAMPLE_REVIEW.md')), '',link('Structured evidence for every mention',path.join(folder,'full-review.json')),''].join('\n'));
console.log(JSON.stringify({notes:reviewed.length,mentions:rows.length,verdicts:review.verdictCounts,applicationVsManual:review.applicationVsManual,principal:review.principalReviewCounts,technicalChecks:review.technicalChecks}));
