// Render an aggregation pipeline the way you'd type it in mongosh or Compass,
// rather than as raw JSON: unquoted keys, single-quoted strings, and short
// arrays/objects kept on one line, wrapped in db.getCollection(...).aggregate().

const INDENT = "  ";
const INLINE_WIDTH = 88;
const SAFE_KEY = /^[A-Za-z_$][\w$]*$/;

function formatKey(key) {
  return SAFE_KEY.test(key) ? key : `'${String(key).replace(/\\/g, "\\\\").replace(/'/g, "\\'")}'`;
}

function formatScalar(value) {
  if (typeof value === "string") return `'${value.replace(/\\/g, "\\\\").replace(/'/g, "\\'").replace(/\n/g, "\\n")}'`;
  if (value === null || value === undefined) return "null";
  return String(value);
}

function formatValue(value, depth) {
  if (value === null || typeof value !== "object") return formatScalar(value);

  const isArray = Array.isArray(value);
  const entries = isArray ? value.map((item) => [null, item]) : Object.entries(value);
  const [open, close] = isArray ? ["[", "]"] : ["{", "}"];
  if (entries.length === 0) return `${open}${close}`;

  const parts = entries.map(([key, item]) => {
    const rendered = formatValue(item, depth + 1);
    return key === null ? rendered : `${formatKey(key)}: ${rendered}`;
  });

  // Keep small nodes on one line: { in: { path: 'releaseId', value: ['20260601'] } }
  const inline = isArray ? `[${parts.join(", ")}]` : `{ ${parts.join(", ")} }`;
  if (!inline.includes("\n") && inline.length + depth * INDENT.length <= INLINE_WIDTH) return inline;

  const pad = INDENT.repeat(depth + 1);
  // A long list of plain values (tags, ids) packs onto as few lines as fit,
  // instead of one value per line.
  if (isArray && value.every((item) => item === null || typeof item !== "object")) {
    const lines = [];
    let line = "";
    for (const part of parts) {
      const next = line ? `${line}, ${part}` : part;
      // Deep nesting gets at least 48 columns of content so lists don't wrap one-per-line.
      if (line && next.length > Math.max(INLINE_WIDTH - pad.length, 48)) { lines.push(line); line = part; }
      else line = next;
    }
    if (line) lines.push(line);
    return `[\n${lines.map((text) => `${pad}${text}`).join(",\n")}\n${INDENT.repeat(depth)}]`;
  }
  return `${open}\n${parts.map((part) => `${pad}${part}`).join(",\n")}\n${INDENT.repeat(depth)}${close}`;
}

export function formatAggregate(pipeline, collection = "collection") {
  const stages = (Array.isArray(pipeline) ? pipeline : []).map((stage) => `${INDENT}${formatValue(stage, 1)}`);
  return `db.getCollection('${collection}').aggregate([\n${stages.join(",\n")}\n])`;
}

export function formatFind(filter, collection = "collection") {
  return `db.getCollection('${collection}').find(${formatValue(filter || {}, 0)})`;
}
