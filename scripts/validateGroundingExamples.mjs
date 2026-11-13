// Run the built-in notes through the real API; record evidence, never save codes.
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { EXAMPLE_GROUPS } from '../lib/example-notes.js';
import { GOLD_NOTES } from '../lib/gold-notes.js';
import { SEMANTIC_POLICY_VERSION } from '../lib/semantic-grounding.js';
import { postJson } from '../lib/json-http-client.js';
import { DIAGNOSIS_POLICY_VERSION } from '../lib/principal-diagnosis.js';

const args = process.argv.slice(2);
const option = (name, fallback) => args.includes(name) ? args[args.indexOf(name) + 1] : fallback;
const baseUrl = option('--url', 'http://localhost:3015');
const output = option('--output', path.resolve('artifacts/grounding-validation'));
const modes = option('--modes', 'hybrid,lexical').split(',');
const extractOnly = args.includes('--extract-only');
const concurrency = Math.max(1, Math.min(4, Number(option('--concurrency', '1')) || 1));
const failures = [];
const notesFile = option('--notes', null);
const examples = notesFile ? JSON.parse(await readFile(notesFile, 'utf8')) : [...EXAMPLE_GROUPS.flatMap(group => group.notes),...(args.includes('--all')?GOLD_NOTES.map(({id,text,languageCode})=>({id,text,languageCode})):[])];
if (!Array.isArray(examples) || examples.some(note => !note.id || !note.text || !note.languageCode)) throw new Error('Notes must be an array of {id, text, languageCode}.');
await mkdir(output, { recursive: true });
async function call(body) {
  const started = Date.now();
  try {
    const response = await postJson(baseUrl + '/api/nlp-map', body, 600000);
    return { request: body, response: response.body, httpStatus: response.status, wallMs: Date.now() - started };
  } catch (error) { return { request: body, response: { ok:false, error:String(error.message) }, wallMs: Date.now() - started }; }
}
async function run(example) {
  const extractionFile = path.join(output, example.id + '-extraction.json');
  let extraction;
  if (args.includes('--reuse-extraction')) {
    try { extraction = JSON.parse(await readFile(extractionFile, 'utf8')); } catch {}
    if(extraction && (!extraction.response.ok || extraction.response.extractor!=='llm'||extraction.request.text!==example.text||extraction.request.languageCode!==example.languageCode))extraction=null;
  }
  extraction ||= await call({ text: example.text, languageCode: example.languageCode, extractOnly:true, noCache:true, includeLlmIO:true });
  await writeFile(extractionFile, JSON.stringify(extraction,null,2)+'\n');
  console.log(JSON.stringify({ note:example.id, stage:'extraction', ok:extraction.response.ok, extractor:extraction.response.extractor, model:extraction.response.extractorModel, mentions:extraction.response.mentions?.length, anchored:extraction.response.results?.filter(r => r.evidenceStatus === 'anchored').length, error:extraction.response.extractorError }));
  if (!extraction.response.ok || extraction.response.extractor !== 'llm' || !Array.isArray(extraction.response.mentions)) {
    failures.push({note:example.id,stage:'extraction',reason:extraction.response.extractorError || extraction.response.error || 'Not an LLM extraction'});
    return;
  }
  if (extractOnly) return;
  for (const searchMode of modes) {
    let run;
    const body={ text:example.text, languageCode:example.languageCode, groundMentions:extraction.response.mentions || [], searchMode, searchTimeoutMs:12000, developerMode:true, noCache:true };
    if(args.includes('--reuse-grounding')){
      try{const previous=JSON.parse(await readFile(path.join(output,example.id+'-'+searchMode+'.json'),'utf8'));
        const candidates=(previous.response.results||[]).flatMap(r=>[r.topCandidate,...(r.alternatives||[]),...(r.matches||[])].filter(Boolean));
        if(previous.response.ok&&!previous.response.degraded&&previous.response.diagnosisPolicyVersion===DIAGNOSIS_POLICY_VERSION&&previous.response.retrieval?.policyVersion==='source-context-v1'&&previous.response.semanticVerification?.enabled&&previous.response.semanticVerification.policyVersion===SEMANTIC_POLICY_VERSION&&candidates.every(c=>c.releaseId===previous.response.releaseId)&&previous.request.text===body.text&&previous.request.languageCode===body.languageCode&&JSON.stringify(previous.request.groundMentions)===JSON.stringify(body.groundMentions))run=previous;
      }catch{}
    }
    run ||= await call(body);
    await writeFile(path.join(output, example.id+'-'+searchMode+'.json'),JSON.stringify(run,null,2)+'\n');
    const response = run.response;
    if (!response.ok || response.degraded || response.semanticVerification?.errors?.length) failures.push({note:example.id,stage:searchMode,reason:response.error || 'Degraded retrieval or semantic verification'});
    console.log(JSON.stringify({ note:example.id, stage:searchMode, ok:response.ok, mentions:response.results?.length, truncated:response.stats?.truncatedMentions, principal:response.principalDiagnosis?.term || null, comorbidities:response.comorbidities?.map(c => c.term), accepted:response.stats?.acceptedCount, review:response.stats?.reviewCount, timeouts:response.stats?.timedOutPhrases }));
  }
}
const queue = [...examples];
await Promise.all(Array.from({length:concurrency}, async () => { while (queue.length) await run(queue.shift()); }));
await writeFile(path.join(output,'manifest.json'),JSON.stringify({ capturedAt:new Date().toISOString(), baseUrl, sourceHash:createHash('sha256').update(JSON.stringify(examples.map(({id,text,languageCode}) => ({id,text,languageCode})))).digest('hex'), exampleCount:examples.length, modes:extractOnly?[]:modes, concurrency, extractedOncePerNote:true, noSavedCodings:true, failures, status:failures.length?'incomplete':'captured_requires_semantic_review' },null,2)+'\n');
if(failures.length)process.exitCode=1;
