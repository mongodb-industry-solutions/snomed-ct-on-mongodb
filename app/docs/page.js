import ApiDocsPanel from "@/components/ApiDocsPanel";

export const metadata = {
  title: "Product Scope & API Docs — SNOMED CT on MongoDB",
  description: "V1 product contract, UX guardrails, and OpenAPI documentation for SNOMED navigation and grounded clinical-note workflows."
};

const scopeCards = [
  {
    title: "V1 promise",
    text: "Deterministic SNOMED navigation plus bounded clinical-note grounding for clinical workflows."
  },
  {
    title: "Primary users",
    text: "Clinicians, terminology leads, and governance reviewers working with explainable SNOMED CT terminology."
  },
  {
    title: "Core contract",
    text: "Search first, inspect the concept, ground the note, and keep every proposed coding reviewable."
  }
];

const workflowCards = [
  {
    title: "Navigate",
    points: ["Deterministic lexical search", "Scope filters", "Hierarchy and graph view", "Concept history"]
  },
  {
    title: "Ground Notes",
    points: ["Evidence-grounded spans", "Accepted / review / abstain", "Proposed principal diagnosis", "No silent coding"]
  },
  {
    title: "Operate",
    points: ["Readiness checks", "Usage telemetry", "Scoped rebuild scripts", "Retired collection cleanup"]
  }
];

const uxGuardrails = [
  "Product-like UX at all times",
  "Flat layout, little text, clear blocks",
  "Actions separated from reading panels",
  "One primary action per block",
  "Evidence visible before commitment",
  "Fast paths first, advanced detail on demand"
];

const outOfScope = [
  "LLM-first hot path",
  "Full Athena-style warehouse browser",
  "Ontology-distance ranking as the default",
  "Automatic code assignment without human review",
  "Refset, binding, mapping, patient cohort, or secondary-use workflows"
];

const doneChecklist = [
  "Users can find and confirm the right concept deterministically",
  "The note workflow proposes a principal diagnosis with visible evidence",
  "Confirmed diagnoses can be persisted as grounded clinical knowledge",
  "Retired workflow collections are not required by app code",
  "The product remains fast, understandable, and stable"
];

const postV1 = [
  {
    title: "Release pinning",
    text: "Make release context fully visible and shareable in the navigator."
  },
  {
    title: "Saved navigator views",
    text: "Persist table facets, scope, and selected concept in URL or app state."
  },
  {
    title: "Richer relationship semantics",
    text: "Improve defining-vs-other classification with deeper source metadata."
  },
  {
    title: "History diffs",
    text: "Show what changed between releases for a concept, not only the snapshots."
  },
  {
    title: "Lexical expansion",
    text: "Grow Spanish and Catalan normalization with governed term variants."
  },
  {
    title: "Outcome metrics",
    text: "Track acceptance, overrides, latency, and action-bundle usage."
  }
];

export default function DocsPage() {
  return (
    <main className="docsShell">
      <header className="docsHeader">
        <div className="docsHeaderInner">
          <div className="docsBrand">
            <span className="docsEyebrow">Product Contract</span>
            <h1 className="docsTitle">SNOMED CT on MongoDB V1</h1>
            <p className="docsSubtext">
              Deterministic navigation and evidence-grounded note mapping on a small, active MongoDB model.
            </p>
          </div>
          <div className="docsHeaderActions">
            <a className="docsLinkButton docsLinkMuted" href="#api-docs">
              Jump To API
            </a>
            <a className="docsLinkButton docsLinkMuted" href="/openapi.json" target="_blank" rel="noreferrer">
              Open OpenAPI JSON
            </a>
            <a className="docsLinkButton" href="/">
              Return To Console
            </a>
          </div>
        </div>
      </header>

      <section className="docsIntroBand">
        {scopeCards.map((card) => (
          <div key={card.title} className="docsIntroCard">
            <strong>{card.title}</strong>
            <span>{card.text}</span>
          </div>
        ))}
      </section>

      <section className="docsScopeBand">
        <section className="docsSection">
          <div className="docsSectionHead">
            <span className="docsSectionEyebrow">Included In V1</span>
            <h2 className="docsSectionTitle">Workflows</h2>
          </div>
          <div className="docsCardGrid">
            {workflowCards.map((card) => (
              <article key={card.title} className="docsBlockCard">
                <strong>{card.title}</strong>
                <ul className="docsMiniList">
                  {card.points.map((point) => (
                    <li key={point}>{point}</li>
                  ))}
                </ul>
              </article>
            ))}
          </div>
        </section>

        <section className="docsSection">
          <div className="docsSectionHead">
            <span className="docsSectionEyebrow">UX Guardrails</span>
            <h2 className="docsSectionTitle">Product Rules</h2>
          </div>
          <div className="docsCardGrid docsCardGridTight">
            <article className="docsBlockCard docsBlockCardAccent">
              <strong>Design principle</strong>
              <p>Flatten. Little text. Clear actions. Clear blocks.</p>
            </article>
            <article className="docsBlockCard">
              <strong>Always true</strong>
              <ul className="docsMiniList">
                {uxGuardrails.map((item) => (
                  <li key={item}>{item}</li>
                ))}
              </ul>
            </article>
          </div>
        </section>

        <section className="docsSection docsSectionSplit">
          <article className="docsBlockCard">
            <strong>Out of scope</strong>
            <ul className="docsMiniList">
              {outOfScope.map((item) => (
                <li key={item}>{item}</li>
              ))}
            </ul>
          </article>
          <article className="docsBlockCard">
            <strong>Definition of done</strong>
            <ul className="docsMiniList">
              {doneChecklist.map((item) => (
                <li key={item}>{item}</li>
              ))}
            </ul>
          </article>
        </section>

        <section className="docsSection">
          <div className="docsSectionHead">
            <span className="docsSectionEyebrow">Post V1</span>
            <h2 className="docsSectionTitle">Short Backlog</h2>
          </div>
          <div className="docsCardGrid">
            {postV1.map((item) => (
              <article key={item.title} className="docsBlockCard">
                <strong>{item.title}</strong>
                <p>{item.text}</p>
              </article>
            ))}
          </div>
        </section>
      </section>

      <section className="docsFrame" id="api-docs">
        <ApiDocsPanel />
      </section>
    </main>
  );
}
