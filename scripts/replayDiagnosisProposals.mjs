// Evaluate the deterministic diagnosis stage on frozen, real grounding output.
// This does not regenerate retrieval or model decisions and never saves codes.
import {readFile,readdir,writeFile} from 'node:fs/promises';
import path from 'node:path';
import {computeDiagnosisProposal,DIAGNOSIS_POLICY_VERSION} from '../lib/principal-diagnosis.js';

const directory=process.argv[2];
if(!directory)throw new Error('Usage: node scripts/replayDiagnosisProposals.mjs <run-directory>');
const files=(await readdir(directory)).filter(f=>/-(hybrid|lexical)\.json$/.test(f));
const rows=[];
for(const file of files){
 const capture=JSON.parse(await readFile(path.join(directory,file),'utf8'));
 const response=capture.response;
 const replay=computeDiagnosisProposal(response.results||[],{targetContext:'condition.code',limit:3});
 rows.push({file,groundingHealthy:response.ok&&!response.degraded,capturedDiagnosisPolicy:response.diagnosisPolicyVersion||null,
  capturedPrincipal:response.principalDiagnosis||null,principal:replay.principal,comorbidities:replay.comorbidities,
  relatedDiagnoses:replay.relatedDiagnoses,history:replay.history,suspected:replay.suspected,
  changedPrincipal:String(response.principalDiagnosis?.conceptId||'')!==String(replay.principal?.conceptId||'')});
}
const report={replayedAt:new Date().toISOString(),diagnosisPolicyVersion:DIAGNOSIS_POLICY_VERSION,
 basis:'Frozen results from actual retrieval and semantic verification; diagnosis selection replayed without another model call',
 runs:rows.length,semanticAccuracyClaim:false,rows};
await writeFile(path.join(directory,'diagnosis-replay.json'),JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify({runs:rows.length,diagnosisPolicyVersion:DIAGNOSIS_POLICY_VERSION,changedPrincipals:rows.filter(r=>r.changedPrincipal).map(r=>r.file)},null,2));
