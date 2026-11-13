// Read-only evidence for the manual review. These are evaluation probes, not
// runtime mappings or a projection allowlist. Run from the repository root.
import '../../../scripts/loadEnv.mjs';
import {writeFile} from 'node:fs/promises';
import {MongoClient} from 'mongodb';
import {getMongoConfig,getSemanticsConfig} from '../../../lib/config.js';
import {TERM_DESCRIPTION_TYPES} from '../../../lib/grounding-policy.js';

const probes = [
 ['crackles', 'crackle|crepitant|crepitantes|rales'],
 ['troponin', 'troponin'],
 ['renal laboratory', 'renal function|funci[oó]n renal|kidney function'],
 ['receptor results', 'estrogen receptor|progesterone receptor|HER2|human epidermal growth factor receptor 2'],
 ['normal auscultation', 'heart murmur|soplo card|breath sounds normal|normal breath sounds|ruidos respiratorios normales'],
 ['oncology follow-up', 'oncology follow|oncology referral|multidisciplinary tumor|tumour board|tumor board'],
 ['drug classes', 'antihypertensive|analgesic'],
 ['adjuvant discussion', 'adjuvant radiotherapy|endocrine therapy'],
 ['weakness', 'weakness of arm|arm weakness|right.sided weakness|right.*weakness'],
 ['screening mammography', 'screening mammograph'],
 ['respiratory medicines', '^(?:salbutamol|albuterol|prednisolone)(?: \\([^)]*\\))?$'],
 ['coronary angiography', '^coronary angiography(?: \\([^)]*\\))?$'],
 ['urinary albumin testing', '^urine albumin (?:measurement|concentration|level)'],
 ['wheezing', '^(?:wheeze|wheezing)(?: \\([^)]*\\))?$']
];
const ids = ['195111005','56675007','10633002','443253003','703272007','1306575001','422504002','34227000','816077007','441986001','472191000119101','433144002','392021009','44578009','306160005','372862008'];
const cfg=getMongoConfig(),{releaseId}=getSemanticsConfig();
const client=new MongoClient(cfg.uri,{serverSelectionTimeoutMS:15000});
await client.connect();
try {
 const db=client.db(cfg.dbName),source=db.collection(cfg.sourceCollection),projection=db.collection(cfg.termSearchCollection);
 const regex=probes.map(p=>`(?:${p[1]})`).join('|');
 const active={$in:[true,1,'1']};
 const desc={active,typeId:{$in:TERM_DESCRIPTION_TYPES},languageCode:{$in:['en','es']},term:{$regex:regex,$options:'i'}};
 const matched=await source.aggregate([
  {$match:{releaseId,active,$or:[{conceptId:{$in:ids}},{descriptions:{$elemMatch:desc}}]}},
  {$project:{_id:0,conceptId:1,active:1,descriptions:{$filter:{input:'$descriptions',as:'d',cond:{$and:[{$in:['$$d.active',[true,1,'1']]},{$in:['$$d.typeId',TERM_DESCRIPTION_TYPES]},{$in:['$$d.languageCode',['en','es']]},{$or:[{$in:['$conceptId',ids]},{$eq:['$$d.typeId',TERM_DESCRIPTION_TYPES[0]]},{$regexMatch:{input:'$$d.term',regex,options:'i'}}]}]}}}}}
 ],{maxTimeMS:300000}).toArray();
 const projected=await projection.aggregate([
  {$match:{releaseId,conceptId:{$in:matched.map(c=>String(c.conceptId))},active:true,conceptActive:true,typeId:{$in:TERM_DESCRIPTION_TYPES}}},
  {$group:{_id:{conceptId:'$conceptId',languageCode:'$languageCode'},rows:{$sum:1}}}
 ]).toArray();
 const rows=matched.map(c=>({...c,projectedLanguages:projected.filter(p=>p._id.conceptId===String(c.conceptId)).map(p=>({languageCode:p._id.languageCode,rows:p.rows}))}));
 const out={checkedAt:new Date().toISOString(),releaseId,operation:'read-only',probeMeaning:'Manual evaluation discovery; no runtime replacements or projection writes',probes:probes.map(([label,pattern])=>({label,pattern})),candidateConcepts:rows};
 await writeFile(new URL('./canonical-source-audit.json',import.meta.url),JSON.stringify(out,null,2)+'\n');
 console.log(JSON.stringify({releaseId,sourceConcepts:rows.length,projected:rows.filter(c=>c.projectedLanguages.length).length,requestedCandidateCodes:ids.map(id=>({id,exists:rows.some(c=>c.conceptId===id),projected:rows.find(c=>c.conceptId===id)?.projectedLanguages}))}));
} finally {await client.close();}
