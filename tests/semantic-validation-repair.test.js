import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const source=(await readFile(new URL('../lib/semantic-grounding.js',import.meta.url),'utf8'))
  .replace("import {getRuntimeLlmConfig,withLlmModel} from './runtime-llm-config.js';", "const getRuntimeLlmConfig=async()=>({enabled:true,model:'test-model',maxTokens:100}); const withLlmModel=cfg=>cfg;")
  .replace("import {callLlmGateway,parseLooseJson} from './llm.js';", "const callLlmGateway=(...args)=>globalThis.semanticRepairGatewaySpy(...args); const parseLooseJson=JSON.parse;")
  .replaceAll(/from '(.+\.js)'/g,(_,name)=>`from '${new URL(name,new URL('../lib/',import.meta.url)).href}'`);
const {verifyGroundingSemantics}=await import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`);
const entry={mentionId:'m1',kind:'condition',assertion:'present',experiencer:'patient',temporality:'current',
  status:'review',evidenceStatus:'anchored',verbatim:'a documented condition',sentence:'Assessment: a documented condition.',
  topCandidate:{conceptId:'test-concept',term:'a condition',fsn:'a condition (disorder)',semanticTag:'disorder',active:true},matches:[]};
const decision={mentionId:'m1',conceptId:'test-concept',relation:'equivalent',evidence:[entry.verbatim],missingQualifiers:[]};
const response=decisions=>({ok:true,text:JSON.stringify({decisions})});

test('a citation repair requires a second validated model decision, never an app-generated quote',async()=>{
 let calls=0;
 globalThis.semanticRepairGatewaySpy=async(_cfg,prompt)=>{
  calls++;assert.ok(prompt.includes('copyableEvidence'));
  return response([{...decision,evidence:calls===1?['a paraphrased source']:decision.evidence}]);
 };
 const result=await verifyGroundingSemantics([entry],{languageCode:'en'});
 assert.equal(calls,2);assert.equal(result.validationRepairs,1);assert.equal(result.repairedDecisions,1);
 assert.equal(result.results[0].status,'accepted');
 assert.deepEqual(result.results[0].semanticReview.evidence,[entry.verbatim]);
});

test('repeated invalid decisions remain in review after one bounded repair',async()=>{
 let calls=0;
 globalThis.semanticRepairGatewaySpy=async()=>{calls++;return response([{...decision,conceptId:'invented-code'}]);};
 const result=await verifyGroundingSemantics([entry],{languageCode:'en'});
 assert.equal(calls,2);assert.equal(result.repairedDecisions,0);
 assert.equal(result.results[0].status,'review');assert.equal(result.results[0].semanticReview.status,'invalid');
});

test('a valid broader mapping is reviewable without unnecessary validation calls',async()=>{
 let calls=0;
 globalThis.semanticRepairGatewaySpy=async()=>{calls++;return response([{...decision,relation:'broader',missingQualifiers:['documented subtype']}]);};
 const result=await verifyGroundingSemantics([entry],{languageCode:'en'});
 assert.equal(calls,1);assert.equal(result.validationRepairs,0);assert.equal(result.results[0].status,'review');
});
