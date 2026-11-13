import {test} from 'node:test';
import assert from 'node:assert/strict';
import {applySemanticDecision,linkRetrievedSourceCandidates,semanticCandidates} from '../lib/semantic-grounding.js';
import {anchorMentions,normalizeExtractedMentions} from '../lib/clinical-mentions.js';
import {computeDiagnosisProposal} from '../lib/principal-diagnosis.js';
import {buildExtractionWindows} from '../lib/extraction-windows.js';
import {buildVectorSearchPipeline,buildNativeHybridFusionPipeline} from '../lib/pipelines.js';

const row={mentionId:'m1',phrase:'condition stage 3',verbatim:'condition stage 3',sentence:'Assessment: condition stage 3.',evidenceStatus:'anchored',kind:'condition',assertion:'present',experiencer:'patient',status:'accepted',topCandidate:{conceptId:'100001',term:'condition',semanticTag:'disorder',active:true},matches:[{conceptId:'100002',term:'condition stage 3',semanticTag:'disorder',active:true}]};
test('semantic decisions cannot invent a code or unquoted supporting evidence',()=>{
 const d={mentionId:'m1',conceptId:'999999',relation:'equivalent',evidence:['condition stage 3'],missingQualifiers:[]};
 assert.equal(applySemanticDecision(row,d).status,'review');
 assert.equal(applySemanticDecision(row,{...d,conceptId:'100002',evidence:['not in the source']}).status,'review');
});
test('a missing source qualifier prevents automatic acceptance even with a valid code',()=>{
 const d={conceptId:'100001',relation:'broader',evidence:['condition stage 3'],missingQualifiers:['stage 3']};
 assert.equal(applySemanticDecision(row,d).status,'review');
 assert.equal(applySemanticDecision(row,{...d,relation:'equivalent'}).status,'review');
 assert.equal(applySemanticDecision(row,{...d,conceptId:'100002',relation:'equivalent',missingQualifiers:[]}).status,'accepted');
});
test('explicit source laterality cannot be omitted by an LLM equivalent decision',()=>{
 for(const [source,term] of [['left limb fracture','Fracture of limb'],['fractura de miembro izquierdo','fractura de miembro']]){
  const entry={...row,verbatim:source,sentence:source,topCandidate:{conceptId:'100001',term,fsn:term,semanticTag:'disorder',active:true}};
  const result=applySemanticDecision(entry,{conceptId:'100001',relation:'equivalent',evidence:[source],missingQualifiers:[]});
  assert.equal(result.status,'review');
  assert.ok(result.semanticReview.missingQualifiers.includes('source laterality: left'));
 }
 const source='left limb fracture';
 const entry={...row,verbatim:source,sentence:source,topCandidate:{conceptId:'100001',term:'Fracture of left limb',fsn:'Fracture of left limb (disorder)',semanticTag:'disorder',active:true}};
 assert.equal(applySemanticDecision(entry,{conceptId:'100001',relation:'equivalent',evidence:[source],missingQualifiers:[]}).status,'accepted');
});
test('a symptom interpreted as compatible with a disease requires review',()=>{
 const entry={...row,kind:'symptom',attributes:{compatible_with:'a disease'}};
 assert.equal(applySemanticDecision(entry,{conceptId:'100001',relation:'equivalent',evidence:['condition stage 3'],missingQualifiers:[]}).status,'review');
});
test('absence alone cannot create a resolved disease history',()=>{
 const text='Patient denies a condition.';
 const mentions=normalizeExtractedMentions([{phrase:'a condition',verbatim:'a condition',sourceSentence:text,assertion:'absent',clinicalStatus:'resolved'}]);
 assert.equal(anchorMentions(text,mentions)[0].clinicalStatus,'unknown');
});
test('a background history list has unspecified activity while an explicitly known condition remains current',()=>{
 for(const [text,time]of [['History: a condition.','unknown'],['History: Known a condition.','current']]){
  const mentions=normalizeExtractedMentions([{phrase:'a condition',verbatim:'a condition',sourceSentence:text,kind:'condition',assertion:'present',temporality:'current',clinicalStatus:'active'}]);
  assert.equal(anchorMentions(text,mentions,[{title:'History',start:0,end:text.length}])[0].temporality,time);
 }
});
test('a resolved chief complaint retains encounter relevance and its physical event timing',()=>{
 const text='Chief complaint: a symptom.\nHistory: It resolved before arrival.';
 const mentions=normalizeExtractedMentions([{phrase:'a symptom',verbatim:'a symptom',sourceSentence:'Chief complaint: a symptom.',kind:'symptom',assertion:'present',temporality:'historical',clinicalStatus:'resolved'}]);
 const [m]=anchorMentions(text,mentions,[{title:'Chief complaint',start:0,end:28}]);
 assert.equal(m.temporality,'current');assert.equal(m.clinicalStatus,'resolved');assert.equal(m.attributes.eventTemporality,'historical');
});
test('no semantically supported candidate leaves source evidence uncoded',()=>{
 const d={conceptId:'none',relation:'unsupported',evidence:[],reason:'Every candidate adds an unsupported cause'};
 const result=applySemanticDecision(row,d);
 assert.equal(result.status,'abstain');assert.equal(result.topCandidate,null);
 assert.equal(result.verbatim,row.verbatim);
});
test('a negative finding code cannot double-negate an absent source finding',()=>{
 for(const term of ['No pathological findings (finding)','sin hallazgos patológicos (hallazgo)','Surgical margin involvement absent (finding)']){
  const entry={...row,kind:'observation',assertion:'absent',topCandidate:{conceptId:'100001',term,fsn:term,semanticTag:'finding'}};
  assert.equal(applySemanticDecision(entry,{conceptId:'100001',relation:'equivalent',evidence:['condition stage 3'],missingQualifiers:[]}).status,'abstain');
 }
});
test('source sentences disambiguate a later repeated word and never fabricate anchors',()=>{
 const text='Assessment: diabetes mellitus. Symptoms likely related to diabetes.';
 const mentions=normalizeExtractedMentions([{phrase:'diabetes',verbatim:'diabetes',sourceSentence:'Symptoms likely related to diabetes.'}]);
 assert.equal(anchorMentions(text,mentions)[0].start,text.lastIndexOf('diabetes'));
 assert.equal(anchorMentions(text,normalizeExtractedMentions([{...mentions[0],sourceSentence:'Nonexistent sentence.'}]))[0].start,null);
});
test('bounded extraction covers all source text and cannot borrow an occurrence from another passage',()=>{
 const text='Assessment: a condition.\nHistory: a condition.\nPlan: review.';
 const windows=buildExtractionWindows(text,27);
 assert.equal(windows.map(w=>w.text).join(''),text);
 assert.ok(windows.every(w=>w.text.trim().length>0));
 const m=normalizeExtractedMentions([{phrase:'a condition',verbatim:'a condition',sourceWindow:windows[1]}]);
 assert.equal(anchorMentions(text,m)[0].start,text.lastIndexOf('a condition'));
 assert.equal(anchorMentions(text,normalizeExtractedMentions([{phrase:'review',verbatim:'review',sourceWindow:windows[0]}]))[0].evidenceStatus,'unanchored');
});
test('vector-only retrieval retains terminology identity and hierarchy for downstream coding',()=>{
 const stages=buildVectorSearchPipeline({query:'a clinical finding',limit:5,indexName:'test',vectorPath:'embedText',vectorMode:'autoEmbed'});
 const projection=stages.find(s=>s.$project)?.$project;
 for(const key of ['releaseId','conceptActive','active','ancestorIds','synonyms','descriptionId'])assert.equal(projection[key],1);
});
test('hybrid retrieval preserves the mention query and uses source context for vectors',()=>{
 const stages=buildNativeHybridFusionPipeline({query:'a condition',vectorQuery:'a condition\nAssessment: acute subtype of a condition.',limit:5,candidatePool:20,textIndex:'text',vectorIndex:'vector',vectorPath:'embedText',vectorMode:'autoEmbed'});
 const pipelines=stages[0].$rankFusion.input.pipelines;
 assert.equal(pipelines.semantic[0].$vectorSearch.query,'a condition\nAssessment: acute subtype of a condition.');
 assert.ok(JSON.stringify(pipelines.lexical[0]).includes('a condition'));
 assert.ok(!JSON.stringify(pipelines.lexical[0]).includes('Assessment:'));
});
test('semantic replacement never inherits the previous candidate score',()=>{
 const result=applySemanticDecision({...row,confidencePct:99},{conceptId:'100002',relation:'equivalent',evidence:['condition stage 3'],missingQualifiers:[]});
 assert.equal(result.confidencePct,0);
});
const diagnosis=(id,extra={})=>({start:20,sectionStart:10,section:'Assessment',kind:'condition',assertion:'present',temporality:'current',experiencer:'patient',status:'accepted',confidencePct:100,topCandidate:{conceptId:id,term:id,semanticTag:'disorder'},...extra});
test('unnumbered confirmed assessments outrank their chief-complaint symptoms',()=>{
 const symptom=diagnosis('100001',{start:0,section:'Chief complaint',kind:'symptom',topCandidate:{conceptId:'100001',term:'symptom',semanticTag:'finding'}});
 const disease=diagnosis('100002');
 assert.equal(computeDiagnosisProposal([symptom,disease]).principal.conceptId,'100002');
 assert.equal(computeDiagnosisProposal([symptom,{...disease,status:'review'}]).principal,null);
});
test('a missing leading assessment does not turn the third numbered diagnosis into the principal',()=>{
 const unresolved=diagnosis('100001',{start:null,section:'active',evidenceStatus:'unanchored',status:'abstain',topCandidate:null,phrase:'encounter condition'});
 const comorbidity=diagnosis('100002',{start:60,sentence:'3. A separate condition.',phrase:'separate condition'});
 assert.equal(computeDiagnosisProposal([unresolved,comorbidity]).principal,null);
});
test('the same documented encounter term can use an accepted occurrence elsewhere without promoting an unrelated comorbidity',()=>{
 const unresolved=diagnosis('100001',{phrase:'a condition',section:'Reason for admission',status:'review'});
 const accepted=diagnosis('100002',{phrase:'a condition'});
 assert.equal(computeDiagnosisProposal([unresolved,accepted]).principal.conceptId,'100002');
 assert.equal(computeDiagnosisProposal([unresolved,{...accepted,phrase:'an unrelated condition'}]).principal,null);
 const history={...accepted,section:'History of present illness',start:10,sectionStart:1};
 const comorbid=diagnosis('100003',{phrase:'a separate condition'});
 assert.equal(computeDiagnosisProposal([unresolved,history,comorbid]).principal.conceptId,'100002');
});
test('explicit acute/chronic source links require grouping review, rather than an extra comorbidity',()=>{
 const sentence='Assessment: acute organ failure on chronic organ failure with reduced function.';
 const main=diagnosis('100001',{phrase:'acute organ failure',verbatim:'acute organ failure',sourceSentence:sentence});
 const background=diagnosis('100002',{phrase:'chronic organ failure with reduced function',verbatim:'chronic organ failure with reduced function',sourceSentence:sentence,start:55});
 const unrelated=diagnosis('100003',{phrase:'another condition',verbatim:'another condition',sourceSentence:'Another condition.',start:90});
 const result=computeDiagnosisProposal([main,background,unrelated]);
 assert.deepEqual(result.comorbidities.map(c=>c.conceptId),['100003']);
 assert.equal(result.relatedDiagnoses[0].conceptId,'100002');
});
test('linked episode queries share retrieved candidates, preserving provenance and excluding unrelated conditions',()=>{
 const sentence='Acute organ failure on chronic organ failure.';
 const main={...row,mentionId:'main',sourceSentence:sentence,verbatim:'Acute organ failure',temporality:'current'};
 const other={...main,mentionId:'background',verbatim:'chronic organ failure',topCandidate:{conceptId:'100003',term:'chronic organ failure',active:true}};
 const unrelated={...other,mentionId:'unrelated',verbatim:'another disease',topCandidate:{conceptId:'100004',term:'another disease',active:true}};
 const [linked]=linkRetrievedSourceCandidates([main,other,unrelated]);
 assert.ok(semanticCandidates(linked).some(c=>c.conceptId==='100003'));
 assert.ok(!semanticCandidates(linked).some(c=>c.conceptId==='100004'));
 assert.equal(linked.sharedCandidateSources[0].mentionId,'background');
 assert.equal(linkRetrievedSourceCandidates([main,{...other,assertion:'suspected'}])[0].sharedCandidateSources,undefined);
});
test('an observation mapped to a disorder description never becomes a diagnosis',()=>{
 assert.equal(computeDiagnosisProposal([diagnosis('100001',{kind:'observation'})]).principal,null);
});
test('a source symptom stays a symptom even when its equivalent concept is disorder-tagged',()=>{
 const main=diagnosis('100001',{section:'Reason for visit'});
 const symptom=diagnosis('100002',{kind:'symptom'});
 const proposal=computeDiagnosisProposal([main,symptom]);
 assert.deepEqual(proposal.comorbidities,[]);
 assert.equal(proposal.symptoms[0].conceptId,'100002');
});
