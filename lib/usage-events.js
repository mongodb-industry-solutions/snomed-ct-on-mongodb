import { createHash, randomUUID } from "node:crypto";

import { getCollection } from "@/lib/mongo";
import { getMongoConfig, getSemanticsConfig } from "@/lib/config";

function normalize(value) {
  return String(value || "").trim();
}

function normalizeConceptIds(values) {
  if (!Array.isArray(values)) return [];
  const seen = new Set();
  const result = [];
  for (const value of values) {
    const id = normalize(value);
    if (!id || seen.has(id)) continue;
    seen.add(id);
    result.push(id);
  }
  return result.slice(0, 200);
}

function queryPreview(value) {
  const text = normalize(value).replace(/\s+/g, " ");
  if (!text) return "";
  return text.length > 120 ? `${text.slice(0, 117)}...` : text;
}

function queryHash(value) {
  const text = normalize(value).toLowerCase();
  if (!text) return "";
  return createHash("sha1").update(text).digest("hex").slice(0, 16);
}

export async function emitUsageEvent({
  eventType,
  tenantId,
  actorId,
  source,
  status,
  releaseId,
  languageCode,
  conceptId,
  conceptIds,
  query,
  resultCount,
  durationMs,
  metadata
}) {
  const type = normalize(eventType);
  if (!type) {
    throw new Error("eventType is required");
  }

  const { usageEventCollection } = getMongoConfig();
  const { releaseId: defaultReleaseId } = getSemanticsConfig();
  const collection = await getCollection(usageEventCollection);

  const doc = {
    _id: randomUUID(),
    at: new Date(),
    eventType: type,
    tenantId: normalize(tenantId) || "demo-minister",
    actorId: normalize(actorId) || "demo-user",
    source: normalize(source) || "api",
    status: normalize(status) || "ok",
    releaseId: normalize(releaseId) || defaultReleaseId || "latest",
    languageCode: normalize(languageCode) || null,
    conceptId: normalize(conceptId) || null,
    conceptIds: normalizeConceptIds(conceptIds),
    queryPreview: queryPreview(query) || null,
    queryHash: queryHash(query) || null,
    resultCount: Number.isFinite(Number(resultCount)) ? Number(resultCount) : null,
    durationMs: Number.isFinite(Number(durationMs)) ? Number(durationMs) : null,
    metadata: metadata && typeof metadata === "object" ? metadata : {}
  };

  await collection.insertOne(doc);
  return doc;
}

export async function emitUsageEventSafe(input) {
  try {
    await emitUsageEvent(input);
  } catch {
    // Non-blocking telemetry by design.
  }
}
