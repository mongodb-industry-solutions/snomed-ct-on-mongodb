const GLOBAL_KEY = "__SNOMED_INDEX_INIT_CACHE_V1__";

function getState() {
  const root = globalThis;
  if (!root[GLOBAL_KEY]) {
    root[GLOBAL_KEY] = {
      ready: new Set(),
      inFlight: new Map()
    };
  }
  return root[GLOBAL_KEY];
}

export async function ensureCollectionIndexesOnce({ collection, cacheKey, specs }) {
  const state = getState();
  if (state.ready.has(cacheKey)) {
    return;
  }

  if (state.inFlight.has(cacheKey)) {
    await state.inFlight.get(cacheKey);
    return;
  }

  const task = collection
    .createIndexes(specs)
    .then(() => {
      state.ready.add(cacheKey);
      state.inFlight.delete(cacheKey);
    })
    .catch((error) => {
      state.inFlight.delete(cacheKey);
      throw error;
    });

  state.inFlight.set(cacheKey, task);
  await task;
}
