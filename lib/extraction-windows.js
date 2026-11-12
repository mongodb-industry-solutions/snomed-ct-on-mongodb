// Preserve every source character, cutting only at sentence/line boundaries.
// Long sentences remain intact; extraction must never split a clinical phrase.
export function buildExtractionWindows(text, maxChars=800) {
  const target=Math.ceil(text.length/Math.max(1,Math.ceil(text.length/maxChars)));
  const boundaries=new Set([text.length]);
  // Attach separating whitespace to the preceding sentence so a long sentence
  // cannot leave a newline-only passage that requires a separate model call.
  for(const m of text.matchAll(/[.!?](?=\s+\p{Lu})\s*|\n+\s*/gu))boundaries.add(m.index+m[0].length);
  const ends=[...boundaries].sort((a,b)=>a-b),windows=[];
  let start=0;
  for(let i=0;i<ends.length;){
    let end=ends[i++];
    while(i<ends.length&&ends[i]-start<=target)end=ends[i++];
    windows.push({start,end,text:text.slice(start,end)});start=end;
  }
  return windows;
}
