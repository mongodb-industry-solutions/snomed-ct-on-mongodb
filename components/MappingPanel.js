"use client";
import { useState } from 'react';
import dynamic from 'next/dynamic';
import { MAPPING_SYSTEMS, SNOMED_SYSTEM } from '@/lib/code-mappings';
const Code = dynamic(() => import('@leafygreen-ui/code'), { ssr: false });
const input = { padding: 8, borderRadius: 6, border: '1px solid #C1C7C6', background: '#fff' };
export default function MappingPanel({ concept }) {
  const loaded = [...new Set((concept.mappings || []).map(m => m.targetSystem))];
  const [system, setSystem] = useState(SNOMED_SYSTEM), [code, setCode] = useState(concept.conceptId);
  const [targetSystem, setTargetSystem] = useState(loaded[0] || MAPPING_SYSTEMS[1].uri), [version, setVersion] = useState('');
  const [data, setData] = useState(null), [busy, setBusy] = useState(false), [error, setError] = useState('');
  const systems = [...MAPPING_SYSTEMS, ...loaded.filter(uri => !MAPPING_SYSTEMS.some(s => s.uri === uri)).map(uri => ({ label: uri, uri }))];
  const run = async e => {
    e.preventDefault(); setBusy(true); setError(''); setData(null);
    try {
      const response = await fetch('/api/translate', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ code, system, targetSystem, ...(version ? system === SNOMED_SYSTEM ? { targetVersion: version } : { sourceVersion: version } : {}) }) });
      const result = await response.json();
      if (!response.ok || result.ok === false) throw new Error(result.error || 'Translation failed');
      setData(result);
    } catch (err) { setError(err.message); } finally { setBusy(false); }
  };
  return <div style={{ border: '1px solid #DFE5E3', borderRadius: 10, padding: 16, background: '#fff' }}>
    <h3 style={{ marginTop: 0 }}>Translate through SNOMED CT</h3>
    <p style={{ color: '#5C6C75', fontSize: 13 }}>Published mapping entries are embedded on the concept document, including groups, priorities, rules and advice.</p>
    {!loaded.length ? <p style={{ fontSize: 13, color: '#8A6D1F' }}>This concept has no imported map targets yet. Refset membership alone does not contain the target codes.</p> : <p style={{ fontSize: 12 }}>{concept.mappings.length} published map entries loaded.</p>}
    <form onSubmit={run} style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
      <select aria-label="Source code system" style={input} value={system} onChange={e => { setSystem(e.target.value); setTargetSystem(e.target.value === SNOMED_SYSTEM ? MAPPING_SYSTEMS[1].uri : SNOMED_SYSTEM); setData(null); }}>{systems.map(s => <option key={s.uri} value={s.uri}>{s.label}</option>)}</select>
      <input aria-label="Source code" value={code} onChange={e => { setCode(e.target.value); setData(null); }} style={input} />
      <span style={{ alignSelf: 'center' }}>→</span>
      <select aria-label="Target code system" style={input} value={targetSystem} onChange={e => { setTargetSystem(e.target.value); setData(null); }}>{systems.filter(s => system === SNOMED_SYSTEM ? s.uri !== SNOMED_SYSTEM : s.uri === SNOMED_SYSTEM).map(s => <option key={s.uri} value={s.uri}>{s.label}</option>)}</select>
      <input aria-label="Classification version" value={version} onChange={e => { setVersion(e.target.value); setData(null); }} placeholder="Classification version (optional)" style={input} />
      <button disabled={busy} style={{ ...input, background: '#00684A', color: '#fff', cursor: 'pointer' }}>{busy ? 'Looking up…' : 'Find mappings'}</button>
    </form>
    {error ? <p role="alert" style={{ color: '#B22222' }}>{error}</p> : null}
    {data ? <div><p style={{ fontSize: 13 }}>{data.fhir.parameter.find(p => p.name === 'message')?.valueString}</p>
      {data.rows.map((row, i) => <div key={i} style={{ padding: '10px 0', borderTop: '1px solid #DFE5E3', fontSize: 13 }}>
        <strong>{row.targetCode}</strong>{row.display ? ` · ${row.display}` : ''}<div style={{ color: '#5C6C75', fontSize: 12 }}>Group {row.mapping.mapGroup || 1} · priority {row.mapping.mapPriority || 1} · {row.targetVersion || 'version unspecified'}</div>
        {row.mapping.mapRule ? <p>Rule: {row.mapping.mapRule}</p> : null}{row.mapping.mapAdvice ? <p>{row.mapping.mapAdvice}</p> : null}
      </div>)}
      <details><summary style={{ cursor: 'pointer', fontSize: 12 }}>FHIR $translate response</summary><Code language="json">{JSON.stringify(data.fhir, null, 2)}</Code></details>
    </div> : null}
  </div>;
}
