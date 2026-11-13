// Verify captured run contracts against canonical terminology, not expected
// phrase-to-code overrides. Clinical accuracy still requires source-note review.
import './loadEnv.mjs';
import {readFile,readdir,writeFile} from 'node:fs/promises';
import path from 'node:path';
import {MongoClient} from 'mongodb';
import {getMongoConfig,getSemanticsConfig} from '../lib/config.js';
import {normalizeSearchText} from '../lib/search-normalization.js';
import {TERM_DESCRIPTION_TYPES,candidateKindCompatible,candidateWouldInvertNegation} from '../lib/grounding-policy.js';
import {isClinicalFinding} from '../lib/clinical-code-type.js';

const directory=process.argv[2];
if(!directory)throw new Error('Usage: node scripts/checkGroundingRuns.mjs <run-directory>');
const files=(await readdir(directory)).filter(f=> /-(hybrid|lexical)\.json$/.test(f));
const runs=await Promise.all(files.map(async file=>({file,...JSON.parse(await readFile(path.join(directory,file),'utf8'))})));
const config=getMongoConfig(),{releaseId}=getSemanticsConfig(),client=new MongoClient(config.uri);
await client.connect();
let report;
try {
  const candidatesFor = r => [r.topCandidate,...(r.alternatives||[]),...(r.matches||[])].filter(Boolean);
  const ids=[...new Set(runs.flatMap(run=>(run.response.results||[]).flatMap(r=>candidatesFor(r).map(c=>c.conceptId))).filter(Boolean).map(String))];
  const concepts=await client.db(config.dbName).collection(config.sourceCollection).find({releaseId,conceptId:{$in:ids}},{projection:{_id:0,conceptId:1,active:1,descriptions:1}}).toArray();
  const byId=new Map(concepts.map(c=>[String(c.conceptId),c]));
  const rows=[];
  for(const run of runs){
    const issues=[],response=run.response,results=response.results||[],text=run.request.text;
    if(!response.ok)issues.push('request-failed');
    if(response.degraded)issues.push('degraded-run');
    if(response.stats?.truncatedMentions)issues.push('mentions-truncated');
    if(results.length!==(run.request.groundMentions||[]).length)issues.push('mention-count-changed');
    let canonicalMatches=0, semanticMatches=0;
    for(const r of results){
      const label=r.mentionId||r.phrase;
      if(r.evidenceStatus==='anchored' && (!Number.isInteger(r.span?.start)||!Number.isInteger(r.span?.end)||text.slice(r.span.start,r.span.end)!==r.span.text))issues.push(`${label}:source-span-mismatch`);
      if(r.evidenceStatus==='unanchored' && r.status==='accepted')issues.push(`${label}:unanchored-accepted`);
      for(const candidate of candidatesFor(r)){
        if(candidate.releaseId!==response.releaseId)issues.push(`${label}:${candidate.conceptId}:candidate-release-missing-or-mismatched`);
        const source=byId.get(String(candidate.conceptId));
        if(!source||![true,1,'1'].includes(source.active))issues.push(`${label}:${candidate.conceptId}:retrieved-code-missing-or-inactive-in-release`);
      }
      const c=r.topCandidate;
      if(!c)continue;
      const source=byId.get(String(c.conceptId));
      if(!source||![true,1,'1'].includes(source.active))issues.push(`${label}:code-missing-or-inactive-in-release`);
      if(!candidateKindCompatible(r,c))issues.push(`${label}:incompatible-semantic-kind`);
      if(r.status==='accepted'){
        if(candidateWouldInvertNegation(r,c))issues.push(`${label}:accepted-code-inverts-source-negation`);
        const canonical=source?.descriptions?.some(d=>[true,1,'1'].includes(d.active)&&TERM_DESCRIPTION_TYPES.includes(d.typeId)&&d.languageCode===run.request.languageCode&&normalizeSearchText(d.term)===normalizeSearchText(r.phrase));
        const verified=r.semanticReview?.status==='verified' && r.semanticReview.relation==='equivalent'
          && r.semanticReview.missingQualifiers?.length===0 && r.semanticReview.evidence?.length>0
          && r.semanticReview.evidence.every(q=>typeof q==='string' && [r.sentence,r.verbatim,r.span?.text].some(s=>s?.includes(q)));
        if(verified)semanticMatches++;
        if(!canonical&&!verified)issues.push(`${label}:accepted-without-canonical-or-verified-source-equivalence`);
        else canonicalMatches++;
      }
    }
    for(const c of [response.principalDiagnosis,...(response.comorbidities||[])].filter(Boolean)){
      if(!isClinicalFinding(c))issues.push(`${c.conceptId}:nonclinical-diagnosis`);
      const supported=results.some(r=>String(r.topCandidate?.conceptId)===String(c.conceptId)&&r.status==='accepted'&&r.assertion==='present'&&r.experiencer==='patient'&&r.temporality==='current');
      if(!supported)issues.push(`${c.conceptId}:diagnosis-lacks-current-accepted-patient-evidence`);
    }
    const steps=(response.retrievalTraces||[]).flatMap(t=>t.steps||[]);
    const branches=role=>steps.filter(s=>s.role===role&&s.outcome==='ok').length;
    const branchErrors=steps.filter(s=>['app-rrf-vector','app-rrf-lexical'].includes(s.role)&&['error','timeout'].includes(s.outcome)).length;
    rows.push({file:run.file,ok:response.ok,mentions:results.length,anchored:results.filter(r=>r.evidenceStatus==='anchored').length,accepted:response.stats?.acceptedCount,review:response.stats?.reviewCount,abstain:response.stats?.abstainCount,timeouts:response.stats?.timedOutPhrases,canonicalAcceptedMatches:canonicalMatches,semanticAcceptedMatches:semanticMatches,semanticFailures:response.stats?.semanticFailureCount||0,principal:response.principalDiagnosis?.term||null,comorbidities:(response.comorbidities||[]).map(c=>c.term),lexicalBranches:branches('app-rrf-lexical'),vectorBranches:branches('app-rrf-vector'),branchErrors,issues});
  }
  report={checkedAt:new Date().toISOString(),releaseId,runs:rows.length,sourceCodesChecked:ids.length,contractIssues:rows.flatMap(r=>r.issues).length,semanticAccuracyClaim:false,rows};
  await writeFile(path.join(directory,'validation-checks.json'),JSON.stringify(report,null,2)+'\n');
  console.log(JSON.stringify(report,null,2));
  if(report.contractIssues)process.exitCode=1;
}finally{await client.close()}
