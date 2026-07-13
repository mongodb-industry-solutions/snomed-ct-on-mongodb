import { getCollection } from "@/lib/mongo";
import { GOLD_NOTES } from "@/lib/gold-notes";

// DB-backed gold-note store — closes the loop: author a gold record from a real
// grounding (Ground a Note → Gold record panel), persist it here, and the
// benchmark grades every model against it. The static GOLD_NOTES act as the
// built-in seed; DB entries are added/maintained by the app and override a
// built-in with the same id.

const GOLD_COLLECTION = "gold_notes";
const LANGS = new Set(["en", "es"]);
const ASSERTIONS = new Set(["present", "absent", "suspected", "planned"]);
const SUBJECTS = new Set(["patient", "family"]);

export function normalizeGoldEntry(entry) {
  const e = entry || {};
  const facts = (Array.isArray(e.facts) ? e.facts : []).map((f) => {
    const fact = {
      phrase: String(f?.phrase || "").trim(),
      assertion: ASSERTIONS.has(f?.assertion) ? f.assertion : "present",
      subject: SUBJECTS.has(f?.subject) ? f.subject : "patient",
      section: String(f?.section || "other")
    };
    if (f?.conceptId) { fact.conceptId = String(f.conceptId); fact.term = f.term || null; }
    return fact;
  }).filter((f) => f.phrase);
  return {
    id: String(e.id || "").trim(),
    title: String(e.title || e.id || "").trim() || "Custom note",
    languageCode: LANGS.has(e.languageCode) ? e.languageCode : "en",
    text: String(e.text || ""),
    facts,
    source: e.source === "builtin" ? "builtin" : "custom"
  };
}

export async function getDbGoldNotes() {
  try {
    const coll = await getCollection(GOLD_COLLECTION);
    return await coll.find({}, { projection: { _id: 0 } }).sort({ createdAt: 1 }).toArray();
  } catch (_e) {
    return [];
  }
}

// Built-in seed + DB entries (DB overrides a built-in with the same id).
export async function getAllGoldNotes() {
  const byId = new Map(GOLD_NOTES.map((n) => [n.id, { ...n, source: "builtin" }]));
  for (const d of await getDbGoldNotes()) byId.set(d.id, { ...d, source: "custom" });
  return Array.from(byId.values());
}

export async function saveGoldNote(entry) {
  const e = normalizeGoldEntry(entry);
  if (!e.id) throw new Error("id is required");
  if (!e.text) throw new Error("text is required");
  if (!e.facts.length) throw new Error("at least one fact is required");
  const coll = await getCollection(GOLD_COLLECTION);
  await coll.updateOne(
    { id: e.id },
    { $set: { ...e, updatedAt: new Date() }, $setOnInsert: { createdAt: new Date() } },
    { upsert: true }
  );
  try { await coll.createIndex({ id: 1 }, { unique: true, name: "gold_id" }); } catch (_e) { /* exists */ }
  return e;
}

export async function deleteGoldNote(id) {
  const coll = await getCollection(GOLD_COLLECTION);
  const r = await coll.deleteOne({ id: String(id) });
  return r.deletedCount > 0;
}
