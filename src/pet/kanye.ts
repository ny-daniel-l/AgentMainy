// The pet's idle chatter: real Kanye West quotes from the free, no-key,
// CORS-open api.kanye.rest (one quote per request). We prime a batch on launch,
// cache it for a day, and fall back to the built-in idle lines when offline.

const KEY = "ap_kanye";
const DAY = 86_400_000;
let quotes: string[] = load();

function load(): string[] {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) || "{}");
    return Array.isArray(raw.q) ? raw.q : [];
  } catch { return []; }
}

/// Cached Kanye quotes, or [] until the first prime lands.
export function kanyeLines(): string[] { return quotes; }

/// Fetch a fresh batch once a day (best-effort; silent when offline). Resolves
/// true when the cache changed, so the caller can re-pick the idle line.
export async function primeKanye(): Promise<boolean> {
  let stamp = 0;
  try { stamp = Number(JSON.parse(localStorage.getItem(KEY) || "{}").t) || 0; } catch {}
  if (quotes.length && Date.now() - stamp < DAY) return false;
  const got = new Set<string>();
  for (let i = 0; i < 24 && got.size < 15; i++) {
    try {
      const r = await fetch("https://api.kanye.rest", { cache: "no-store" });
      const q = ((await r.json()) as { quote?: string }).quote?.trim();
      if (q) got.add(q);
    } catch { break; } // offline: keep the existing cache / built-in fallback
  }
  if (!got.size) return false;
  quotes = [...got];
  try { localStorage.setItem(KEY, JSON.stringify({ q: quotes, t: Date.now() })); } catch {}
  return true;
}
