function clone(value) {
  if (typeof structuredClone === "function") {
    return structuredClone(value);
  }
  return JSON.parse(JSON.stringify(value));
}

function walk(node) {
  if (!node || typeof node !== "object") {
    return;
  }

  if (Array.isArray(node)) {
    for (const item of node) {
      walk(item);
    }
    return;
  }

  if (
    node.path === "conceptId" &&
    Array.isArray(node.value) &&
    node.value.length > 50
  ) {
    node.value = [`<${node.value.length} conceptIds>`];
  }

  if (
    node.conceptId &&
    typeof node.conceptId === "object" &&
    Array.isArray(node.conceptId.$in) &&
    node.conceptId.$in.length > 50
  ) {
    node.conceptId = {
      ...node.conceptId,
      $in: [`<${node.conceptId.$in.length} conceptIds>`]
    };
  }

  if (Array.isArray(node.queryVector) && node.queryVector.length > 12) {
    node.queryVector = [`<${node.queryVector.length} dimensions>`];
  }

  for (const value of Object.values(node)) {
    walk(value);
  }
}

export function redactLargeConceptScopes(pipeline) {
  const copied = clone(Array.isArray(pipeline) ? pipeline : []);
  walk(copied);
  return copied;
}

export function redactLargeConceptScopesInObject(value) {
  const copied = clone(value && typeof value === "object" ? value : {});
  walk(copied);
  return copied;
}
