// History for the small charts, fetched once and kept for 5 minutes.
import { ha } from "./home-assistant";

type Points = { t: number; v: number }[];
const cache = new Map<string, { at: number; points: Points }>();
const loading = new Set<string>();

/** Cached points (or undefined while loading); calls `ready` when a fetch lands. */
export function cachedHistory(entityId: string, hours: number, ready: () => void): Points | undefined {
  const key = `${entityId}@${hours}`;
  const hit = cache.get(key);
  if ((!hit || Date.now() - hit.at > 300_000) && !loading.has(key)) {
    loading.add(key);
    ha.history(entityId, hours)
      .then((points) => cache.set(key, { at: Date.now(), points }))
      .catch(() => cache.set(key, { at: Date.now(), points: [] }))
      .finally(() => { loading.delete(key); ready(); });
  }
  return hit?.points;
}
