"use client";
import { Fragment, useEffect, useState } from 'react';
import dynamic from 'next/dynamic';
import { CLINICAL_SEARCH_CASES } from '@/lib/clinical-search-examples';
import { clinicalClauses } from '@/lib/clinical-query';
import { formatFind } from '@/lib/mongosh-format';
import styles from './ClinicalSearchWorkbench.module.css';
const Code = dynamic(() => import('@leafygreen-ui/code'), { ssr: false });

// Search Coded Notes. After a search the page walks through what the server
// actually ran: the AND/OR plan, the SNOMED families each condition grounded
// to, the MongoDB filter compiled from both, and the notes it returned — with
// the stored coding that satisfied each condition.

const sameIds = (left = [], right = []) => left.length === right.length && left.every(id => right.includes(id));
const displayDate = value => new Date(value).toLocaleDateString('en-GB',{ day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });
const plural = (n, word) => `${n.toLocaleString()} ${word}${n === 1 ? '' : 's'}`;
const EXAMPLE_GROUPS = [['simple', 'Simple'], ['complex', 'Complex'], ['context', 'Age, history & timing']];
const OPERATOR_WORDS = new Set(['and', 'or', 'but', 'without', 'y', 'e', 'o', 'pero', 'sin']);
const ASSERTION_LABEL = { absent: 'documented absent', suspected: 'suspected', historical: 'history of', planned: 'planned' };
const SETTING_LABEL = { 'primary-care': 'Primary care', outpatient: 'Outpatient', inpatient: 'Inpatient', emergency: 'Emergency' };
const PLANNER = {
  rules: ['Rule-based parser', 'The request uses the “Find notes with … and / or / without …” command form, so a deterministic parser built the tree. No language-model call.'],
  'language-model': ['Language model', 'Free-form wording, so the session model rewrote it as a JSON plan. The server validates that plan (at most ten conditions, known assertions and filters only); the model never writes the database query.'],
  'rules-fallback': ['Rule-based parser (fallback)', 'The language model was unavailable, so the deterministic parser built the tree instead.']
};
const HOW_IT_WORKS = [
  { title: 'Plan', where: 'Rules or LLM', text: 'Your request becomes an AND / OR / NOT tree of short clinical conditions, plus any age, sex, setting or date filters.' },
  { title: 'Ground', where: 'MongoDB Search + Vector', mongo: true, text: 'Each condition is matched to SNOMED CT concept families with hybrid search over the terminology.' },
  { title: 'Compile', where: 'Server', text: 'The validated plan and the chosen concepts become one MongoDB filter. No model writes the query.' },
  { title: 'Retrieve', where: 'MongoDB', mongo: true, text: 'One indexed query over the confirmed codings of every note. Stored ancestor paths let a family match all of its subtypes.' }
];

const qualifiers = clause => [clause.subject === 'family' ? 'family history' : '', ASSERTION_LABEL[clause.assertion] || ''].filter(Boolean);
function filterLabels(filters = {}) {
  const { minAge, maxAge } = filters;
  const age = minAge !== undefined && maxAge !== undefined ? `Age ${minAge}–${maxAge}` : minAge !== undefined ? `Age ≥ ${minAge}` : maxAge !== undefined ? `Age ≤ ${maxAge}` : '';
  return [age, filters.sex ? `Sex: ${filters.sex}` : '', filters.sinceDays ? `Encounter in the last ${filters.sinceDays} days` : '',
    filters.setting ? `${SETTING_LABEL[filters.setting] || filters.setting} encounters` : ''].filter(Boolean);
}

// The same test the server's $elemMatch ran, repeated on the returned codings
// so each note can show which coding satisfied which condition.
function explainMatch(record, clauses, resolved, descendants) {
  const accepted = record.codings.filter(coding => coding.status === 'accepted');
  const used = new Set(), matches = [];
  for (const clause of clauses.filter(c => !c.exclude)) {
    const ids = (resolved[clause.id] || []).map(String);
    for (const coding of accepted) {
      if (coding.assertion !== clause.assertion || coding.subject !== clause.subject) continue;
      const hit = descendants ? (coding.ancestorIds || []).some(id => ids.includes(String(id))) : ids.includes(String(coding.conceptId));
      if (hit) { matches.push({ clause, coding }); used.add(coding); }
    }
  }
  return { matches, excluded: clauses.filter(c => c.exclude), others: accepted.filter(coding => !used.has(coding)) };
}

function ExampleText({ text }) {
  return text.split(/(\s+)/).map((word, i) => OPERATOR_WORDS.has(word.toLowerCase()) ? <span key={i} className={styles.kw}>{word}</span> : word);
}

function PlanNode({ node }) {
  const items = node.all || node.any;
  if (!items) return <span className={`${styles.leaf} ${node.exclude ? styles.leafExclude : ''}`}>
    {node.exclude ? <span className={styles.not}>NOT</span> : null}{node.phrase}
    {qualifiers(node).map(q => <span key={q} className={styles.qualifier}>{q}</span>)}
  </span>;
  if (items.length === 1) return <PlanNode node={items[0]} />;
  return <span className={styles.group}><PlanItems node={node} /></span>;
}
function PlanItems({ node }) {
  const items = node.all || node.any;
  return items.map((child, i) => <Fragment key={i}>{i ? <span className={styles.op}>{node.all ? 'AND' : 'OR'}</span> : null}<PlanNode node={child} /></Fragment>);
}
function PlanTree({ plan }) {
  let node = plan;
  while ((node.all || node.any)?.length === 1) node = (node.all || node.any)[0];
  return <div className={styles.planRoot}>{node.all || node.any ? <PlanItems node={node} /> : <PlanNode node={node} />}</div>;
}

function Step({ n, mongo, title, where, summary, action, children }) {
  return <li className={styles.step}>
    <span className={`${styles.num} ${mongo ? styles.numMongo : ''}`}>{n}</span>
    <section className={styles.stepCard}>
      <header className={styles.stepHead}>
        <h3 className={styles.stepTitle}>{title}</h3>
        <span className={`${styles.where} ${mongo ? styles.whereMongo : ''}`}>{where}</span>
        {action ? <span className={styles.stepAction}>{action}</span> : null}
        {summary ? <p className={styles.stepSummary}>{summary}</p> : null}
      </header>
      <div className={styles.stepContent}>{children}</div>
    </section>
  </li>;
}

function ConditionCard({ clause, chosenIds, descendants, fineTune, busy, onChange }) {
  const broad = sameIds(chosenIds, clause.scope.conceptIds);
  const byId = new Map(clause.candidates.map(candidate => [candidate.conceptId, candidate]));
  const chosen = broad ? clause.scope.families : clause.candidates.filter(candidate => chosenIds?.includes(candidate.conceptId));
  const basis = !broad ? 'narrowed by you' : clause.scope.basis === 'description-families' ? 'anchored on an exact description match' : 'chosen by meaning (rerank score)';
  return <div className={`${styles.condition} ${clause.exclude ? styles.conditionExclude : ''}`}>
    <div className={styles.conditionHead}>
      {clause.exclude ? <span className={styles.not}>NOT</span> : null}
      <span className={styles.phrase}>{clause.phrase}</span>
      {qualifiers(clause).map(q => <span key={q} className={styles.qualifier}>{q}</span>)}
      <span className={`${styles.scopeTag} ${broad ? '' : styles.scopeTagRefined}`}>{broad ? 'Broad scope' : 'Narrowed'}</span>
    </div>
    {clause.error ? <div className={styles.warn}>Terminology search failed: {clause.error}</div> : null}
    {!chosen.length ? <div className={styles.warn}>No active SNOMED concept matched this phrase. Try different wording.</div> : null}
    {chosen.map(family => {
      const hit = byId.get(family.conceptId);
      return <div key={family.conceptId} className={styles.family}>
        <span className={styles.familyTerm}>{family.term}</span>
        <span className={styles.familyMeta}><code>{family.conceptId}</code>{family.semanticTag ? ` · ${family.semanticTag}` : ''}
          {hit?.matchReason ? ` · found via ${hit.matchReason.toLowerCase()}` : ''}{Number.isFinite(hit?.rerankScore) ? ` · rerank ${hit.rerankScore.toFixed(2)}` : ''}</span>
      </div>;
    })}
    <p className={styles.note}>{plural(clause.candidates.length, 'candidate')} · {basis} · {descendants ? 'includes every more specific concept' : 'exact codes only'}</p>
    {fineTune ? <select className={styles.select} aria-label={`Search scope for ${clause.phrase}`} disabled={busy}
      value={broad ? 'broad' : chosenIds?.[0] || ''} onChange={e => onChange(e.target.value === 'broad' ? clause.scope.conceptIds : [e.target.value])}>
      <option value="broad">Broad: all matching families and subtypes</option>
      {clause.candidates.map(candidate => <option key={candidate.conceptId} value={candidate.conceptId}>{candidate.term} · {candidate.conceptId}</option>)}
    </select> : null}
  </div>;
}

function RecordCard({ record, clauses, resolved, descendants }) {
  const { matches, excluded, others } = explainMatch(record, clauses, resolved, descendants);
  return <article className={styles.record}>
    <div className={styles.recordMeta}>
      <span className={`${styles.metaTag} ${record.synthetic ? '' : styles.metaTagSaved}`}>{record.synthetic ? 'Synthetic demo note' : 'Saved from Ground a Note'}</span>
      {record.patient ? <span>{record.patient.age} y · {record.patient.sex}</span> : null}
      {record.patient ? <span className={styles.dot}>•</span> : null}
      <span>{record.encounter ? `${String(record.encounter.occurredAt).slice(0, 10)} · ${SETTING_LABEL[record.encounter.setting] || record.encounter.setting}` : `Saved ${String(record.recordedAt || '').slice(0, 10)}`}</span>
    </div>
    <p className={styles.snippet}>{record.snippet.replace(/\s+/g, ' ')}{record.text.length > record.snippet.length ? '…' : ''}</p>
    <div className={styles.codingRow}>
      <span className={styles.label}>Matched</span>
      <div className={styles.codingList}>
        {matches.map(({ clause, coding }, i) => <span key={i} className={styles.match} title={`SNOMED ${coding.conceptId} · ${coding.assertion} · ${coding.subject}`}>
          <em>{clause.phrase}</em>{coding.display || coding.conceptId}</span>)}
        {excluded.map(clause => <span key={clause.id} className={styles.absentMatch} title="No accepted coding in this note falls inside the excluded scope">no confirmed {clause.phrase}</span>)}
      </div>
    </div>
    {others.length ? <div className={styles.codingRow}>
      <span className={styles.label}>Also coded</span>
      <div className={styles.codingList}>{others.map((coding, i) => <span key={i} className={styles.coding}>
        {coding.display || coding.conceptId}{ASSERTION_LABEL[coding.assertion] ? ` · ${ASSERTION_LABEL[coding.assertion]}` : ''}{coding.subject === 'family' ? ' · family' : ''}</span>)}</div>
    </div> : null}
    {record.text ? <details className={styles.disclosure}><summary>Read full note</summary><p className={styles.fullText}>{record.text}</p></details> : null}
  </article>;
}

export default function ClinicalSearchWorkbench({ sessionModel }) {
  const [query, setQuery] = useState(''), [language, setLanguage] = useState('en');
  const [grounding, setGrounding] = useState(null), [resolved, setResolved] = useState({}), [result, setResult] = useState(null);
  const [busy, setBusy] = useState(''), [error, setError] = useState(''), [descendants, setDescendants] = useState(true);
  const [corpus, setCorpus] = useState(null), [exampleGroup, setExampleGroup] = useState('simple'), [fineTune, setFineTune] = useState(false);
  const [dateMode, setDateMode] = useState('demo');
  useEffect(() => {
    let cancelled = false;
    fetch('/api/clinical-search').then(response => response.json()).then(data => {
      if (!cancelled && data.ok && data.corpus) {
        setCorpus(data.corpus);
        if (!data.corpus.demoReferenceDate) setDateMode('today');
      }
    }).catch(() => {});
    return () => { cancelled = true; };
  }, []);
  const resetSearch = () => { setGrounding(null); setResolved({}); setResult(null); setError(''); setFineTune(false); };
  const run = async (action) => {
    setBusy(action); setError(''); setResult(null);
    if (action === 'broad') { setGrounding(null); setResolved({}); setDescendants(true); setFineTune(false); }
    try {
      const response = await fetch('/api/clinical-search', { method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify(action === 'broad' ? { action: 'search', query, languageCode: language, model: sessionModel, dateMode } :
          { action: 'search', plan: grounding.plan, resolved, includeDescendants: descendants, dateMode }) });
      const data = await response.json();
      if (!response.ok || data.ok === false) throw new Error(data.error || 'Search failed');
      if (action === 'broad') { setGrounding(data); setResolved(data.resolved); }
      if (data.corpus) setCorpus(data.corpus);
      if (data.dateContext) setDateMode(data.dateContext.mode);
      setResult(data);
    } catch (e) { setError(e.message); } finally { setBusy(''); }
  };
  const switchLanguage = next => {
    const example = CLINICAL_SEARCH_CASES.find(item => item[language] === query);
    if (example) setQuery(example[next]);
    setLanguage(next); resetSearch();
  };
  const canRefine = grounding && !busy && !grounding.clauses.some(clause => !resolved[clause.id]?.length);
  const planner = PLANNER[grounding?.planner] || PLANNER.rules;
  const filters = filterLabels(grounding?.plan.filters);
  const scopedFamilies = grounding ? grounding.clauses.reduce((n, clause) => n + (resolved[clause.id]?.length || 0), 0) : 0;
  const resultClauses = result ? clinicalClauses(result.plan) : [];

  return <div className={styles.shell}>
    <header className={styles.hero}>
      <span className={styles.eyebrow}>Query by meaning</span>
      <h2 className={styles.title}>Find clinical records by meaning</h2>
      <p className={styles.lede}>Describe the findings you need in English or Spanish. Each condition is grounded in SNOMED CT, then MongoDB searches
        the confirmed codings of every stored note, including all of their more specific concepts.</p>
      <div className={styles.stats} role="status">
        {corpus ? <>
          <span className={styles.stat}><strong>{corpus.totalNotes.toLocaleString()}</strong> searchable notes</span>
          <span className={styles.stat}><strong>{corpus.syntheticNotes.toLocaleString()}</strong> synthetic demo</span>
          <span className={styles.stat}><strong>{(corpus.totalNotes - corpus.syntheticNotes).toLocaleString()}</strong> saved from Ground a Note</span>
          {corpus.english + corpus.spanish ? <span className={styles.stat}><strong>{corpus.english.toLocaleString()}</strong> EN · <strong>{corpus.spanish.toLocaleString()}</strong> ES</span> : null}
        </> : <span className={styles.stat}>Counting searchable notes…</span>}
      </div>
    </header>

    <section className={styles.searchCard}>
      <div className={styles.examplesHead}>
        <label className={styles.label} htmlFor="clinical-date-reference">Relative dates</label>
        <select id="clinical-date-reference" className={styles.select} style={{ width: 'auto', margin: 0 }} aria-label="Relative date reference"
          value={dateMode} disabled={!!busy} onChange={e => { setDateMode(e.target.value); resetSearch(); }}>
          <option value="demo" disabled={!!corpus && !corpus.demoReferenceDate}>Demo reference{corpus?.demoReferenceDate ? ` · ${displayDate(corpus.demoReferenceDate)}` : ''}</option>
          <option value="today">Today</option>
        </select>
        <span className={styles.note} style={{ margin: 0 }}>{dateMode === 'demo' ? corpus?.demoReferenceDate ?
          `Synthetic notes use ${displayDate(corpus.demoReferenceDate)}; other saved notes use today.` : 'Loading the synthetic dataset’s reference date…' :
          'Relative dates use today for all notes.'}</span>
      </div>
      <form className={styles.searchRow} onSubmit={e => { e.preventDefault(); run('broad'); }}>
        <input className={styles.searchInput} aria-label="Clinical search request" value={query} disabled={!!busy}
          onChange={e => { setQuery(e.target.value); resetSearch(); }}
          placeholder={language === 'es' ? 'Busca notas con diabetes y enfermedad renal…' : 'Find notes with diabetes and kidney disease…'} />
        <div className={styles.segmented} role="group" aria-label="Query language">
          {[['en', 'EN'], ['es', 'ES']].map(([code, label]) => <button key={code} type="button" aria-pressed={language === code} disabled={!!busy}
            onClick={() => language !== code && switchLanguage(code)}>{label}</button>)}
        </div>
        <button className={styles.primary} disabled={!!busy || !query.trim()}>{busy === 'broad' ? 'Searching…' : 'Search coded notes'}</button>
      </form>
      <div className={styles.examplesHead}>
        <span className={styles.label}>Try an example</span>
        <div className={styles.tabs} role="tablist" aria-label="Clinical search examples">
          {EXAMPLE_GROUPS.map(([group, label]) => <button key={group} type="button" role="tab" className={styles.tab} aria-selected={exampleGroup === group}
            onClick={() => setExampleGroup(group)}>{label}<span className={styles.tabCount}>{CLINICAL_SEARCH_CASES.filter(example => example.group === group).length}</span></button>)}
        </div>
      </div>
      <div className={styles.exampleGrid}>
        {CLINICAL_SEARCH_CASES.filter(example => example.group === exampleGroup).map(example => <button key={example.id} type="button" disabled={!!busy}
          className={`${styles.example} ${query === example[language] ? styles.exampleActive : ''}`}
          onClick={() => { setQuery(example[language]); resetSearch(); }}><ExampleText text={example[language]} /></button>)}
      </div>
    </section>

    {error ? <p role="alert" className={styles.error}>{error}</p> : null}
    {busy ? <div className={styles.working} aria-live="polite"><span className={styles.pulse} />
      {busy === 'broad' ? 'Planning the request, grounding each condition in SNOMED CT, then querying coded notes…' : 'Compiling the refined scope and re-running the MongoDB query…'}</div> : null}

    {!grounding && !busy ? <section aria-label="How it works">
      <div className={styles.examplesHead} style={{ marginBottom: 10 }}><span className={styles.label}>How a search runs</span></div>
      <div className={styles.flow}>
        {HOW_IT_WORKS.map((step, i) => <div key={step.title} className={styles.flowStep}>
          <span className={styles.flowTitle}><span className={`${styles.num} ${step.mongo ? styles.numMongo : ''}`}>{i + 1}</span>{step.title}</span>
          <span className={`${styles.where} ${step.mongo ? styles.whereMongo : ''}`}>{step.where}</span>
          <p>{step.text}</p>
        </div>)}
      </div>
    </section> : null}

    {grounding ? <ol className={styles.timeline}>
      <Step n={1} title="Plan the request" where={planner[0]}
        summary={`${plural(grounding.clauses.length, 'condition')}${filters.length ? ` and ${plural(filters.length, 'filter')}` : ''}, with your AND / OR / NOT grouping preserved.`}>
        <PlanTree plan={grounding.plan} />
        {filters.length ? <div className={styles.filters}><span className={styles.label}>Filters</span>{filters.map(label => <span key={label} className={styles.filter}>{label}</span>)}</div> : null}
        <p className={styles.note}>{planner[1]}</p>
        <details className={styles.disclosure}><summary>Validated plan (JSON)</summary><div className={styles.code}><Code language="json">{JSON.stringify(grounding.plan, null, 2)}</Code></div></details>
      </Step>

      <Step n={2} mongo title="Ground each condition in SNOMED CT" where="MongoDB Search + Vector Search"
        summary={`${plural(grounding.clauses.length, 'condition')} → ${scopedFamilies.toLocaleString()} concept famil${scopedFamilies === 1 ? 'y' : 'ies'}${descendants ? ', each with all of its subtypes' : ', exact codes only'}.`}
        action={<button type="button" className={styles.secondary} aria-expanded={fineTune} onClick={() => setFineTune(open => !open)}>{fineTune ? 'Done' : 'Fine-tune scope'}</button>}>
        <div className={styles.conditions}>
          {grounding.clauses.map(clause => <ConditionCard key={clause.id} clause={clause} chosenIds={resolved[clause.id]} descendants={descendants}
            fineTune={fineTune} busy={!!busy} onChange={ids => { setResolved({ ...resolved, [clause.id]: ids }); setResult(null); }} />)}
        </div>
        {fineTune ? <div className={styles.refineBar}>
          <label className={styles.check}><input type="checkbox" disabled={!!busy} checked={descendants}
            onChange={e => { setDescendants(e.target.checked); setResult(null); }} /> Include more specific SNOMED concepts</label>
          <button type="button" className={styles.primary} style={{ padding: '8px 16px' }} disabled={!canRefine} onClick={() => run('refine')}>Apply refinements</button>
        </div> : null}
        <ul className={styles.notes}>
          <li>Each phrase runs through the same <strong>hybrid terminology search</strong> as the Navigation tab: MongoDB Search for keywords and
            Vector Search for meaning, fused with reciprocal rank fusion and reranked when available.</li>
          <li>The scope keeps <strong>whole concept families</strong> rather than the single top hit: concepts whose own descriptions match the phrase,
            otherwise the closest meanings, collapsed to their broadest ancestor among the candidates.</li>
        </ul>
      </Step>

      {result ? <>
        <Step n={3} title="Compile one MongoDB filter" where="Server"
          summary={`The plan and the chosen concept IDs become a single find() on grounded_notes. Nothing here is written by a model or sent from the browser.`}>
          <div className={styles.code}><Code language="javascript">{formatFind(result.filter, 'grounded_notes')}</Code></div>
          <ul className={styles.notes}>
            <li>Each condition is an <code>$elemMatch</code> on <code>codings</code>, so the concept, assertion, subject and <code>status: &apos;accepted&apos;</code> must
              all hold on the <strong>same coding</strong>. A negated or family-history mention can&apos;t satisfy a “present” condition.</li>
            {result.includeDescendants
              ? <li><code>ancestorIds</code> stores each coding&apos;s own ID plus all of its inferred ancestors, stamped when the note was saved. One equality
                match on a family ID therefore finds <strong>every subtype</strong>, with no hierarchy walk at query time.</li>
              : <li><code>conceptId</code> is matched directly, so only the <strong>exact codes</strong> chosen above count; subtypes are ignored.</li>}
            <li>AND / OR become <code>$and</code> / <code>$or</code>. “Without” becomes <code>$nor</code>: no confirmed matching coding, which is not the same as a documented absence.</li>
            {filters.length ? <li>Age, sex, setting and date filter plain fields on the note: <code>patient.age</code>, <code>patient.sex</code>, <code>encounter.setting</code>, <code>encounter.occurredAt</code>.</li> : null}
            <li>The compound index <code>tenant_coding_ancestors</code> (tenant + ancestor IDs + assertion + subject + status) serves the coding lookups.</li>
          </ul>
        </Step>

        <Step n={4} mongo title={`${plural(result.count, 'matching note')}`} where="MongoDB · grounded_notes"
          summary={result.count > result.records.length
            ? `Showing the newest ${result.records.length} of ${result.count.toLocaleString()}. The count and the page of notes run in parallel, each capped at 6 s.`
            : 'Newest first. Each note shows the stored coding that satisfied each condition.'}>
          {!result.count ? <p className={styles.empty}>No confirmed codings match these conditions. Ground and save a note in Ground a Note, or try a different search.</p> : null}
          <div className={styles.records}>
            {result.records.map(record => <RecordCard key={record.id} record={record} clauses={resultClauses} resolved={result.resolved} descendants={result.includeDescendants} />)}
          </div>
        </Step>
      </> : !busy ? <li className={styles.stale}>
        The scope changed. Apply it to compile and run the MongoDB query again.
        <button type="button" className={styles.primary} style={{ padding: '7px 14px', marginLeft: 'auto' }} disabled={!canRefine} onClick={() => run('refine')}>Apply refinements</button>
      </li> : null}
    </ol> : null}
  </div>;
}
