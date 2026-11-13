const aliases={familyrelationship:'familyRelationship',familyrelation:'familyRelationship',relative:'familyRelationship',sitio:'site',sitioanatomico:'site',laterality:'laterality',lateralidad:'laterality',valor:'value',value:'value',result:'result',resultado:'result',stage:'stage',estadio:'stage',via:'route',route:'route',dose:'dose',dosis:'dose',frequency:'frequency',frecuencia:'frequency',relativetime:'relativeTime',tiempo:'relativeTime',momento:'relativeTime',condition:'condition',condicion:'condition',plannedaction:'plannedAction'};
export function clinicalAttributes(input={}) {
 const out={};
 for(const [key,value]of Object.entries(input||{})){
  const folded=key.normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/[^a-z0-9]/gi,'').toLowerCase();
  out[aliases[folded]||key]=value;
 }
 return out;
}
export function discussionOnly(c) {
 const attrs=clinicalAttributes(c.attributes);
 return c.workflow==='discussion'||/^(discussion|discusion)$/i.test(String(attrs.plannedAction||''));
}

export function codingCoveredBy(c, other) {
 if (c === other || c.role === 'principal' || c.assertion !== 'present' || c.temporality !== 'current'
   || !['condition',undefined,null].includes(c.kind) || c.subject !== 'patient') return false;
 if (other.assertion !== c.assertion || other.subject !== c.subject || other.temporality !== c.temporality
   || other.kind !== c.kind || other.workflow !== c.workflow || other.clinicalStatus !== c.clinicalStatus
   || String(c.conceptId) === String(other.conceptId)
   || !(other.ancestorIds||[]).map(String).includes(String(c.conceptId))) return false;
 const left=clinicalAttributes(c.attributes),right=clinicalAttributes(other.attributes);
 return ['site','laterality','stage','value','result','relativeTime'].every(k=>JSON.stringify(left[k]??null)===JSON.stringify(right[k]??null));
}

// Merge duplicate facts, retaining complementary source qualifiers and every
// evidence occurrence. Different specimens, times, values or relatives remain
// separate facts even if their concept identifier is identical.
export function mergeClinicalCodings(codings) {
 const map=new Map();
 for(const c of codings||[]){
  const attrs=clinicalAttributes(c.attributes);
  const discriminators=['site','laterality','stage','value','result','relativeTime','familyRelationship','route','condition'].map(k=>attrs[k]??null);
  if(c.subject==='family')discriminators.push(attrs.relationship??null);
  const key=JSON.stringify([c.conceptId,c.assertion,c.subject,c.temporality,c.workflow,c.kind,c.clinicalStatus,...discriminators]);
  const evidence=[...(c.sourceSpans||[]),...(c.evidence?[c.evidence]:[]),...(c.phrase?[{text:c.phrase}]:[])];
  const prev=map.get(key);
  if(!prev){map.set(key,{...c,attributes:{...attrs},sourceSpans:evidence});continue;}
  for(const[k,v]of Object.entries(attrs)){
   if(prev.attributes[k]===undefined)prev.attributes[k]=v;
   else if(JSON.stringify(prev.attributes[k])!==JSON.stringify(v)){
    prev.attributeConflicts={...(prev.attributeConflicts||{}),[k]:[prev.attributes[k],v]};
   }
  }
  for(const span of evidence)if(!prev.sourceSpans.some(s=>JSON.stringify(s)===JSON.stringify(span)))prev.sourceSpans.push(span);
  prev.accepted=prev.accepted||c.accepted;
  if(c.role==='principal')prev.role='principal';
 }
 const merged=[...map.values()];
 const covered=new Set();
 for(const c of merged){
  const child=merged.filter(other=>codingCoveredBy(c,other)).sort((a,b)=>(b.ancestorIds?.length||0)-(a.ancestorIds?.length||0))[0];
  if(!child)continue;
  covered.add(c);
  for(const[k,v]of Object.entries(c.attributes||{}))if(child.attributes[k]===undefined)child.attributes[k]=v;
  for(const span of c.sourceSpans||[])if(!child.sourceSpans.some(s=>JSON.stringify(s)===JSON.stringify(span)))child.sourceSpans.push(span);
 }
 return merged.filter(c=>!covered.has(c));
}
