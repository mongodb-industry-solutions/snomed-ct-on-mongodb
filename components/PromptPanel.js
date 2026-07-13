"use client";

import { useState } from "react";
import { EXTRACTION_SYSTEM_PROMPT } from "@/lib/prompts";

const INK = "#001E2B";
const VIOLET = "#8F4FBF";
const BORDER = "#e3e7ea";

// Teaching transparency: the exact Stage-1 extraction instruction we send the
// LLM. Same string the server uses (lib/prompts.js) — single source of truth.
export default function PromptPanel({ note = "", languageCode = "en", defaultOpen = false }) {
  const [open, setOpen] = useState(defaultOpen);
  const full = `${EXTRACTION_SYSTEM_PROMPT}\n\nLanguage: ${languageCode || "en"}\n\nClinical note:\n"""\n${(note || "").trim() || "<the clinical note text is appended here>"}\n"""`;
  return (
    <div style={{ border: `1px solid ${BORDER}`, borderRadius: 10, background: "#FBF9FE", margin: "12px 0" }}>
      <button type="button" onClick={() => setOpen((v) => !v)} aria-expanded={open}
        style={{ width: "100%", display: "flex", alignItems: "center", gap: 8, background: "none", border: "none", cursor: "pointer", padding: "10px 14px", textAlign: "left" }}>
        <span style={{ fontSize: 12, fontWeight: 800, color: VIOLET }}>✦ Extraction prompt</span>
        <span style={{ fontSize: 12, color: "#5C6C75" }}>the exact instruction sent to the LLM (Stage 1)</span>
        <span style={{ marginLeft: "auto", fontSize: 12, fontWeight: 700, color: VIOLET }}>{open ? "Hide" : "Show"}</span>
      </button>
      {open ? (
        <div style={{ padding: "0 14px 14px" }}>
          <p style={{ fontSize: 12, color: "#5C6C75", margin: "0 0 8px" }}>
            The LLM returns clinical mentions + context (assertion, subject, section) as JSON — never codes. MongoDB
            retrieves the SNOMED candidates downstream, so the model only decides <em>what to look up</em>.
          </p>
          <pre style={{ whiteSpace: "pre-wrap", wordBreak: "break-word", fontSize: 12, lineHeight: 1.55, color: INK, background: "#fff", border: `1px solid ${BORDER}`, borderRadius: 8, padding: "12px 14px", margin: 0, fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace" }}>{full}</pre>
        </div>
      ) : null}
    </div>
  );
}
