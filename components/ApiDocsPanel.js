"use client";

import { useEffect, useMemo, useState } from "react";

const METHOD_STYLE = {
  get: { color: "#0B6B3A", background: "#E3FCF2", border: "#B8F0D8" },
  post: { color: "#0B5E6E", background: "#E6F7FB", border: "#B8E7F0" },
  put: { color: "#714900", background: "#FFF4D6", border: "#F6D87C" },
  delete: { color: "#9F1239", background: "#FFE4E6", border: "#FDA4AF" }
};

const STATUS_LABEL = {
  core: "Current demo",
  optional: "Optional",
  demo: "Demo payoff",
  diagnostic: "Diagnostic",
  internal: "Internal"
};

const OPERATION_METHODS = new Set(["get", "post", "put", "patch", "delete"]);

function formatJson(value) {
  if (value == null) return "";
  return JSON.stringify(value, null, 2);
}

function getJsonContent(node) {
  const content = node?.content || {};
  return content["application/json"] || Object.values(content)[0] || null;
}

function getRequestExample(operation) {
  const media = getJsonContent(operation?.requestBody);
  if (!media) return null;
  if (media.example) return media.example;
  const firstExample = media.examples ? Object.values(media.examples)[0] : null;
  return firstExample?.value || null;
}

function getResponseExample(operation) {
  const responses = operation?.responses || {};
  const success = Object.entries(responses).find(([status]) => status.startsWith("2"));
  if (!success) return null;
  const media = getJsonContent(success[1]);
  if (!media) return null;
  if (media.example) return media.example;
  const firstExample = media.examples ? Object.values(media.examples)[0] : null;
  return firstExample?.value || null;
}

function collectOperations(spec) {
  const tagOrder = new Map((spec?.tags || []).map((tag, index) => [tag.name, index]));
  const groups = new Map();

  Object.entries(spec?.paths || {}).forEach(([path, pathItem]) => {
    Object.entries(pathItem || {}).forEach(([method, operation]) => {
      if (!OPERATION_METHODS.has(method)) return;
      const tag = operation.tags?.[0] || "Other";
      const entry = {
        method,
        path,
        operation,
        requestExample: getRequestExample(operation),
        responseExample: getResponseExample(operation)
      };
      if (!groups.has(tag)) {
        groups.set(tag, {
          name: tag,
          description: spec?.tags?.find((item) => item.name === tag)?.description || "",
          operations: []
        });
      }
      groups.get(tag).operations.push(entry);
    });
  });

  return Array.from(groups.values()).sort((a, b) => {
    const left = tagOrder.has(a.name) ? tagOrder.get(a.name) : 999;
    const right = tagOrder.has(b.name) ? tagOrder.get(b.name) : 999;
    return left - right || a.name.localeCompare(b.name);
  });
}

function EndpointExample({ title, value }) {
  if (value == null) return null;

  return (
    <div style={{ minWidth: 0 }}>
      <div style={{ fontSize: 11, fontWeight: 700, color: "#5D6C74", letterSpacing: 0.6, textTransform: "uppercase", marginBottom: 6 }}>
        {title}
      </div>
      <pre
        style={{
          margin: 0,
          padding: 12,
          borderRadius: 8,
          border: "1px solid #E1E7EB",
          background: "#F8FAFB",
          color: "#102535",
          overflow: "auto",
          maxHeight: 260,
          fontSize: 12,
          lineHeight: 1.5
        }}
      >
        {formatJson(value)}
      </pre>
    </div>
  );
}

function EndpointCard({ item }) {
  const { method, path, operation, requestExample, responseExample } = item;
  const methodStyle = METHOD_STYLE[method] || METHOD_STYLE.post;
  const status = operation["x-demoStatus"];

  return (
    <article
      style={{
        border: "1px solid #E1E7EB",
        borderRadius: 10,
        background: "#fff",
        padding: 18,
        boxShadow: "0 8px 24px rgba(16, 37, 53, 0.04)"
      }}
    >
      <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
        <div style={{ minWidth: 0 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
            <span
              style={{
                border: `1px solid ${methodStyle.border}`,
                background: methodStyle.background,
                color: methodStyle.color,
                borderRadius: 999,
                padding: "4px 9px",
                fontSize: 11,
                fontWeight: 800,
                textTransform: "uppercase",
                letterSpacing: 0.6
              }}
            >
              {method}
            </span>
            {status ? (
              <span style={{ color: "#526271", background: "#F2F6F7", border: "1px solid #E1E7EB", borderRadius: 999, padding: "4px 9px", fontSize: 11, fontWeight: 700 }}>
                {STATUS_LABEL[status] || status}
              </span>
            ) : null}
          </div>
          <h3 style={{ margin: "12px 0 4px", color: "#102535", fontSize: 20, lineHeight: 1.25 }}>
            {operation.summary || operation.operationId || path}
          </h3>
          <code style={{ color: "#00684A", fontSize: 13, wordBreak: "break-word" }}>
            {path}
          </code>
        </div>
        {operation.operationId ? (
          <code style={{ color: "#697A83", background: "#F8FAFB", border: "1px solid #E1E7EB", borderRadius: 8, padding: "6px 8px", fontSize: 12 }}>
            {operation.operationId}
          </code>
        ) : null}
      </div>

      {operation.description ? (
        <p style={{ color: "#526271", margin: "12px 0 16px", lineHeight: 1.55 }}>
          {operation.description}
        </p>
      ) : null}

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))", gap: 14 }}>
        <EndpointExample title="Request example" value={requestExample} />
        <EndpointExample title="Success example" value={responseExample} />
      </div>
    </article>
  );
}

export default function ApiDocsPanel({ specUrl = "/openapi.json" }) {
  const [spec, setSpec] = useState(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;

    async function loadSpec() {
      setLoading(true);
      setError("");
      try {
        const response = await fetch(specUrl, { cache: "no-store" });
        if (!response.ok) {
          throw new Error(`OpenAPI request failed with status ${response.status}`);
        }
        const nextSpec = await response.json();
        if (!cancelled) setSpec(nextSpec);
      } catch (nextError) {
        if (!cancelled) setError(nextError.message || "Unable to load OpenAPI specification.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    loadSpec();
    return () => {
      cancelled = true;
    };
  }, [specUrl]);

  const groups = useMemo(() => collectOperations(spec), [spec]);

  return (
    <div>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, marginBottom: 16, flexWrap: "wrap" }}>
        <div>
          <p style={{ margin: 0, fontSize: 14, color: "#526271", lineHeight: 1.5 }}>
            Current API reference for the demo features backed by the SNOMED canonical model and term search projection.
          </p>
          <p style={{ margin: "6px 0 0", fontSize: 13, color: "#697A83", lineHeight: 1.45 }}>
            Legacy FHIR, binding, and patient-cohort contracts are intentionally omitted because they are not part of the current demo.
          </p>
        </div>
        <a
          href={specUrl}
          target="_blank"
          rel="noreferrer"
          style={{ fontSize: 13, fontWeight: 700, color: "#00684A", textDecoration: "none", border: "1px solid #B8F0D8", background: "#E3FCF2", borderRadius: 8, padding: "8px 12px" }}
        >
          Open OpenAPI JSON
        </a>
      </div>

      <div style={{ border: "1px solid #E1E7EB", borderRadius: 12, background: "#F8FAFB", padding: 20, minHeight: "60vh" }}>
        {loading ? (
          <p style={{ color: "#526271", margin: 0 }}>Loading API reference...</p>
        ) : null}

        {error ? (
          <div style={{ border: "1px solid #FDA4AF", background: "#FFF1F2", color: "#9F1239", borderRadius: 10, padding: 16 }}>
            {error}
          </div>
        ) : null}

        {!loading && !error ? (
          <div style={{ display: "grid", gap: 22 }}>
            <header style={{ maxWidth: 960 }}>
              <h2 style={{ margin: 0, color: "#102535", fontSize: 30, lineHeight: 1.2 }}>
                {spec?.info?.title || "API Reference"}
              </h2>
              {spec?.info?.description ? (
                <p style={{ color: "#526271", fontSize: 16, lineHeight: 1.55, margin: "10px 0 0" }}>
                  {spec.info.description}
                </p>
              ) : null}
            </header>

            {groups.map((group) => (
              <section key={group.name} style={{ display: "grid", gap: 12 }}>
                <div>
                  <h3 style={{ margin: 0, color: "#102535", fontSize: 22 }}>
                    {group.name}
                  </h3>
                  {group.description ? (
                    <p style={{ margin: "4px 0 0", color: "#697A83", lineHeight: 1.45 }}>
                      {group.description}
                    </p>
                  ) : null}
                </div>
                <div style={{ display: "grid", gap: 14 }}>
                  {group.operations.map((item) => (
                    <EndpointCard key={`${item.method}:${item.path}`} item={item} />
                  ))}
                </div>
              </section>
            ))}
          </div>
        ) : null}
      </div>
    </div>
  );
}
