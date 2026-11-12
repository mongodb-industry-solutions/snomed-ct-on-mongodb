import { getCollection } from "@/lib/mongo";
import { getMongoConfig, getSemanticsConfig } from "@/lib/config";
import { getRuntimeLlmConfig, benchmarkModels } from "@/lib/runtime-llm-config";
import { publicLlmConfig } from "@/lib/llm-models";
import { goldFacts, goldExpectedConcepts, goldDiagnosisSummary } from "@/lib/gold-notes";
import { getAllGoldNotes } from "@/lib/gold-store";
import { ok, fail, parseJson, elapsedMs } from "@/lib/http";
import { postJson } from "@/lib/json-http-client";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Extraction-model benchmark. The headline score is the LLM EVIDENCE GRAPH: for
// each gold note we compare the facts the model extracts (mentions + assertion +
// subject) against the note's expected facts. This measures the LLM directly and
// is independent of MongoDB retrieval — a concept the scoped dataset can't
// resolve is a retrieval limitation, not an extraction error.
//
// A separate RETRIEVAL axis reports whether the extracted mentions resolve to the
// expected SNOMED concepts under the chosen search mode (lexical / hybrid) — that
// measures MongoDB retrieval, holding extraction constant.
//
// A DIAGNOSIS axis scores the note-level proposal against the coder's summary:
// is the proposed principal the gold principal (top-1, and within the top 3),
// and do the proposed comorbidities match the gold ones (precision / recall).
// Exact identifiers are scored; hierarchy proximity is reported separately.

// Total per-note deadline includes extraction and source-based verification.
const NOTE_TIMEOUT_MS = Number(process.env.BENCHMARK_NOTE_TIMEOUT_MS) || 600000;
const SEARCH_MODES = new Set(["lexical", "hybrid"]);

async function ancestorSet(collection, id, cache) {
  const k = String(id);
  if (cache.has(k)) return cache.get(k);
  const doc = await collection.findOne({ conceptId: k,releaseId:getSemanticsConfig().releaseId }, { projection: { _id: 0, inferredAncestorIds: 1 } });
  const set = new Set([k, ...((doc?.inferredAncestorIds || []).map(String))]);
  cache.set(k, set);
  return set;
}
async function subsumes(collection, expectedId, groundedIds, cache) {
  for (const g of groundedIds) {
    if (String(g) === String(expectedId)) return true;
    if ((await ancestorSet(collection, g, cache)).has(String(expectedId))) return true;
    if ((await ancestorSet(collection, expectedId, cache)).has(String(g))) return true;
  }
  return false;
}

function norm(s) {
  return String(s || "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9 ]/g, " ").replace(/\s+/g, " ").trim();
}
const STOP = new Set(["of", "the", "a", "an", "with", "and", "or", "to", "for", "on", "in", "at", "current", "present", "no", "not", "evidence", "signs", "review"]);
function sigTokens(s) { return norm(s).split(" ").filter((t) => t && !STOP.has(t)); }
// Order-insensitive, abbreviation-tolerant match: exact/substring OR ≥60% of the
// shorter phrase's significant tokens overlap. So "breast carcinoma" ≡ "carcinoma
// of breast", and "acute exacerbation of COPD" ≡ the spelled-out form.
function phraseMatch(a, b) {
  const x = norm(a); const y = norm(b);
  if (!x || !y) return false;
  if (x === y || x.includes(y) || y.includes(x)) return true;
  const ta = sigTokens(a); const tb = sigTokens(b);
  if (!ta.length || !tb.length) return false;
  const setB = new Set(tb);
  const overlap = ta.filter((t) => setB.has(t)).length;
  return overlap / Math.min(ta.length, tb.length) >= 0.6;
}
// Reduce assertion vocabulary to the clinically load-bearing polarity.
function polarity(assertion) {
  const a = String(assertion || "present");
  if (a === "absent") return "absent";
  if (a === "suspected") return "suspected";
  if (a === "planned") return "planned";
  return "present";
}
function mean(arr) { return arr.length ? arr.reduce((s, x) => s + x, 0) / arr.length : 0; }

// Hierarchy proximity does not establish equivalence: descendants can add an
// undocumented cause/site/stage, and ancestors can omit a defining qualifier.
async function scoreDiagnosis(gold, data, matches) {
  if (!gold) return null;
  const candidates = (data.principalDiagnosisCandidates || []).map((c) => String(c.conceptId));
  const proposedPrincipal = data.principalDiagnosis ? String(data.principalDiagnosis.conceptId) : null;
  const proposedComorbidities = (data.comorbidities || []).map((c) => String(c.conceptId));

  const principalTop1 = gold.principalScorable === false ? null : proposedPrincipal && await matches(gold.principal.conceptId, [proposedPrincipal]) ? 1 : 0;
  const principalTop3 = gold.principalScorable === false ? null : candidates.length && await matches(gold.principal.conceptId, candidates.slice(0, 3)) ? 1 : 0;

  const expected = gold.comorbidities.map((c) => String(c.conceptId));
  let found = 0;
  for (const id of expected) if (await matches(id, proposedComorbidities)) found += 1;
  let correct = 0;
  for (const id of proposedComorbidities) {
    // A proposed comorbidity is correct when it matches a gold comorbidity. One
    // that matches the gold principal instead is a principal/secondary swap.
    for (const exp of expected) { if (await matches(exp, [id])) { correct += 1; break; } }
  }
  return {
    principalTop1,
    principalTop3,
    principalReferenceStatus: gold.principalScorable === false ? 'needs-adjudication' : 'scored',
    // Empty gold list + empty proposal is a perfect answer, not undefined.
    comorbidityRecall: expected.length ? found / expected.length : 1,
    comorbidityPrecision: proposedComorbidities.length ? correct / proposedComorbidities.length : (expected.length ? 0 : 1),
    gold: { principal: gold.principal, comorbidities: gold.comorbidities },
    proposed: {
      principal: data.principalDiagnosis ? { conceptId: String(data.principalDiagnosis.conceptId), term: data.principalDiagnosis.term } : null,
      candidates: (data.principalDiagnosisCandidates || []).map((c) => ({ conceptId: String(c.conceptId), term: c.term, score: c.score })),
      comorbidities: (data.comorbidities || []).map((c) => ({ conceptId: String(c.conceptId), term: c.term }))
    }
  };
}

export async function POST(request) {
  const startedAt = process.hrtime.bigint();
  try {
    const body = await parseJson(request).catch(() => ({}));
    const llm = await getRuntimeLlmConfig();
    const models = body?.metaOnly ? [] : benchmarkModels(llm, body?.models);
    const searchMode = SEARCH_MODES.has(body?.searchMode) ? body.searchMode : "hybrid";
    // Session hybrid tuning, forwarded to every grounding call so a hybrid
    // benchmark measures the same fusion settings the user searches with.
    const tuning = searchMode === "hybrid" && body?.tuning && typeof body.tuning === "object" ? body.tuning : null;

    const ALL_GOLD = await getAllGoldNotes();
    const goldSummary = ALL_GOLD.map((g) => ({
      id: g.id, title: g.title || g.id, languageCode: g.languageCode, text: g.text, source: g.source || "builtin",
      facts: goldFacts(g).map((f) => ({ phrase: f.phrase, assertion: f.assertion, subject: f.subject, section: f.section || "other", conceptId: f.conceptId || null, term: f.term || null })),
      factCount: goldFacts(g).length,
      conceptCount: goldExpectedConcepts(g).length
    }));
    if (body?.metaOnly) {
      return ok({ ok: true, ...publicLlmConfig(llm), goldNotes: goldSummary, latencyMs: elapsedMs(startedAt) });
    }

    const noteIds = Array.isArray(body?.noteIds) && body.noteIds.length ? body.noteIds.map(String) : null;
    const notesToRun = noteIds ? ALL_GOLD.filter((g) => noteIds.includes(g.id)) : ALL_GOLD;

    const origin = new URL(request.url).origin;
    const { sourceCollection, termSearchCollection } = getMongoConfig();
    const {releaseId} = getSemanticsConfig();
    const source = await getCollection(sourceCollection);
    const sidecar = await getCollection(termSearchCollection);
    const cache = new Map();
    // Coverage gaps remain in the end-to-end denominator. The in-scope score
    // is a diagnostic metric, so pruning the database cannot improve accuracy.
    const scopeCache = new Map();
    const inSidecar = async (id,languageCode) => {
      const k = `${languageCode}|${id}`;
      if (scopeCache.has(k)) return scopeCache.get(k);
      const doc = await sidecar.findOne({ conceptId:String(id), languageCode,releaseId, active:true, conceptActive:true,typeId:{$in:['900000000000003001','900000000000013009']} }, { projection: { _id: 1 } });
      const v = Boolean(doc);
      scopeCache.set(k, v);
      return v;
    };

    const groundOne = async (note, model) => {
      const t0 = Date.now();
      let data = {};
      let error = null;
      try {
        const res = await postJson(`${origin}/api/nlp-map`, { text: note.text, languageCode: note.languageCode, model, searchMode, ...(tuning ? { tuning } : {}), searchTimeoutMs: 12000, noCache: true, includeLlmIO: true }, NOTE_TIMEOUT_MS);
        data = res.body;
      } catch (e) { error = e?.message || "request failed"; }

      const ms = Date.now() - t0;
      const results = Array.isArray(data.results) ? data.results : [];
      const extractor = data.extractor || (error ? "error" : "unknown");
      const u = data.extractorUsage || {};
      const tokens = u.total_tokens ?? u.totalTokens ?? 0;
      if (extractor !== "llm") {
        return { noteId: note.id, scored: false, extractor, error: error || data.extractorError || null, timedOut: Boolean(error && /timeout/i.test(error)), tokens, ms };
      }

      // Every mention the LLM produced (the model's evidence graph). We keep the
      // verbatim span (exact note text, always in the note's language) AND the
      // normalized phrase (which the model may translate to English) — matching
      // uses verbatim first so a Spanish note isn't missed when the model
      // normalizes "nefropatía diabética" → "diabetic nephropathy".
      const mentions = results.map((r) => ({
        phrase: r.phrase || r.span?.text || "",
        verbatim: r.verbatim || r.span?.text || r.phrase || "",
        assertion: r.assertion || "present",
        subject: r.experiencer || "patient",
        section: r.llmSection || "other",
        conceptId: r.topCandidate ? String(r.topCandidate.conceptId) : null,
        term: r.topCandidate?.term || null,
        accepted:r.status==='accepted',
        present: ['present','historical'].includes(r.assertion) && (r.experiencer || "patient") === "patient"
      }));
      const factMatch = (m, f) => phraseMatch(m.verbatim, f.phrase) || phraseMatch(m.phrase, f.phrase);

      // ── Evidence-graph scoring: match each expected fact to a mention. ──
      const facts = goldFacts(note);
      const usedMention = new Set();
      const factHits = facts.map((f) => {
        // Prefer a mention that also matches subject + polarity, so a repeated
        // term (patient vs family) isn't cross-assigned by phrase alone.
        const pick = (pred) => mentions.findIndex((m, i) => !usedMention.has(i) && pred(m));
        let idx = pick((m) => factMatch(m, f) && (m.subject || "patient") === f.subject && polarity(m.assertion) === polarity(f.assertion));
        if (idx < 0) idx = pick((m) => factMatch(m, f) && (m.subject || "patient") === f.subject);
        if (idx < 0) idx = pick((m) => factMatch(m, f));
        const got = idx >= 0 ? mentions[idx] : null;
        if (idx >= 0) usedMention.add(idx);
        const detected = Boolean(got);
        const assertionOk = detected && polarity(got.assertion) === polarity(f.assertion);
        const subjectOk = detected && (got.subject || "patient") === f.subject;
        return {
          phrase: f.phrase, assertion: f.assertion, subject: f.subject, section: f.section || "other",
          detected, assertionOk, subjectOk,
          got: got ? { assertion: got.assertion, subject: got.subject, term: got.term, conceptId: got.conceptId } : null,
          full: detected && assertionOk && subjectOk
        };
      });
      const detection = facts.length ? factHits.filter((h) => h.detected).length / facts.length : 1;
      const assertionAcc = facts.length ? factHits.filter((h) => h.assertionOk).length / facts.length : 1;
      const subjectAcc = facts.length ? factHits.filter((h) => h.subjectOk).length / facts.length : 1;
      const graphRecall = facts.length ? factHits.filter((h) => h.full).length / facts.length : 1;
      // Precision: mentions that matched an expected fact vs all mentions produced.
      const matchedMentions = usedMention.size;
      const precision = mentions.length ? matchedMentions / mentions.length : 1;
      const extraMentions = mentions.length - matchedMentions;
      // Headline = graph recall (each expected fact detected with correct
      // assertion + subject). Precision is reported as a KPI but NOT folded into
      // the headline: the gold pack isn't exhaustive, so we can't tell a
      // legitimate extra mention (e.g. "urine albumin") from genuine noise —
      // penalising would unfairly hit models that extract more valid detail.
      const evidenceComposite = graphRecall;

      // ── Retrieval axis: do present-patient facts resolve to their concept? ──
      const presentIds = new Set(mentions.filter((m) => m.present && m.conceptId).map((m) => m.conceptId));
      const acceptedIds = new Set(mentions.filter(m=>m.present&&m.accepted&&m.conceptId).map(m=>m.conceptId));
      const expectedConcepts = goldExpectedConcepts(note);
      let retHits = 0;
      let inScopeCount = 0;
      const retrievalHits = [];
      for (const exp of expectedConcepts) {
        const inScope = await inSidecar(exp.conceptId,note.languageCode);
        const exact = presentIds.has(String(exp.conceptId));
        const hierarchyRelated = exact || await subsumes(source, exp.conceptId, presentIds, cache);
        const hit = exact;
        if (inScope) { inScopeCount += 1; if (hit) retHits += 1; }
        retrievalHits.push({ conceptId: exp.conceptId, term: exp.term, hit, exact, hierarchyRelated, accepted:acceptedIds.has(String(exp.conceptId)), inScope });
      }
      const outOfScopeCount = expectedConcepts.length - inScopeCount;
      const inScopeRetrievalRecall = inScopeCount ? retHits / inScopeCount : null;
      const retrievalRecall = expectedConcepts.length ? retrievalHits.filter(h=>h.exact).length/expectedConcepts.length : null;
      const acceptedMappingRecall = expectedConcepts.length ? retrievalHits.filter(h=>h.accepted).length/expectedConcepts.length : null;

      // ── Diagnosis axis: principal + comorbidities vs the coder's summary. ──
      const diagnosis = await scoreDiagnosis(goldDiagnosisSummary(note), data, (expectedId, ids) => ids.some(id=>String(id)===String(expectedId)));

      return {
        noteId: note.id, scored: true, extractor,
        detection, assertionAcc, subjectAcc, graphRecall, precision, evidenceComposite,
        extraMentions, factCount: facts.length,
        retrievalRecall, inScopeRetrievalRecall, acceptedMappingRecall, retrievalHits, expectedConceptCount: expectedConcepts.length, inScopeCount, outOfScopeCount,
        semanticFailures:data.stats?.semanticFailureCount||0,
        diagnosis,
        principalTop1: diagnosis?.principalTop1 ?? null,
        principalTop3: diagnosis?.principalTop3 ?? null,
        comorbidityPrecision: diagnosis?.comorbidityPrecision ?? null,
        comorbidityRecall: diagnosis?.comorbidityRecall ?? null,
        factHits, mentions,
        llmPrompt: data.extractorPrompt || null,
        llmRaw: data.extractorRaw || null,
        tokens, ms
      };
    };

    const perModel = [];
    for (const model of models) {
      const notes=[];
      for(const note of notesToRun)notes.push(await groundOne(note,model));
      const scored = notes.filter((n) => n.scored);
      const s = scored.length;
      const avg = (sel) => mean(scored.map(sel).filter((x) => x != null));
      const tokensPerNote = s ? Math.round(scored.reduce((a, n) => a + n.tokens, 0) / s) : 0;
      const evidenceComposite = avg((n) => n.evidenceComposite);
      perModel.push({
        model,
        errored: s === 0,
        scoredNotes: s,
        fallbacks: notes.filter((n) => !n.scored).length,
        evidenceComposite,
        detection: avg((n) => n.detection),
        assertionAcc: avg((n) => n.assertionAcc),
        subjectAcc: avg((n) => n.subjectAcc),
        precision: avg((n) => n.precision),
        retrievalRecall: avg((n) => n.retrievalRecall),
        acceptedMappingRecall:avg(n=>n.acceptedMappingRecall),
        semanticFailures:notes.reduce((n,row)=>n+(row.semanticFailures||0),0),
        principalTop1: avg((n) => n.principalTop1),
        principalTop3: avg((n) => n.principalTop3),
        comorbidityPrecision: avg((n) => n.comorbidityPrecision),
        comorbidityRecall: avg((n) => n.comorbidityRecall),
        tokens: notes.reduce((a, n) => a + (n.tokens || 0), 0),
        tokensPerNote,
        avgLatencyMs: notes.length ? Math.round(notes.reduce((a, n) => a + (n.ms || 0), 0) / notes.length) : 0,
        qualityPer1kTokens: tokensPerNote > 0 ? evidenceComposite / (tokensPerNote / 1000) : null,
        notes
      });
    }

    // Recommendation: cheapest model within 2 points of the top evidence composite.
    const scoredModels = perModel.filter((m) => !m.errored);
    let recommended = null;
    if (scoredModels.length) {
      const top = Math.max(...scoredModels.map((m) => m.evidenceComposite));
      const topModel = scoredModels.slice().sort((a, b) => b.evidenceComposite - a.evidenceComposite)[0];
      const best = scoredModels.filter((m) => m.evidenceComposite >= top - 0.02)
        .sort((a, b) => (a.tokensPerNote - b.tokensPerNote) || (a.avgLatencyMs - b.avgLatencyMs))[0];
      recommended = best ? { model: best.model, evidenceComposite: best.evidenceComposite, tokensPerNote: best.tokensPerNote, avgLatencyMs: best.avgLatencyMs, matchesTop: best.model !== topModel.model, topModel: topModel.model, topComposite: top } : null;
    }

    return ok({
      ok: true,
      enabled: llm.enabled,
      availableModels: llm.models,
      searchMode,
      tuning,
      scoringPolicy:'exact-concept-v1; coverage gaps included; hierarchy proximity diagnostic only',
      goldNotes: goldSummary,
      models: perModel,
      recommended,
      latencyMs: elapsedMs(startedAt)
    });
  } catch (error) {
    return fail("Benchmark failed", error?.status || 500, { code: error?.code, detail: error?.message, latencyMs: elapsedMs(startedAt) });
  }
}
