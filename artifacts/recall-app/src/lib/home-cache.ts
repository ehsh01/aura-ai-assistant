import { fetchHome, type HomeBriefingResponse } from "./recall-api";

/**
 * Shared home-briefing cache: Today and the nav badges both need the briefing,
 * but /home is expensive (aggregation + digest). One fetch, fan-out to
 * subscribers; force-refresh after user actions keeps badges honest.
 */

const FRESH_MS = 60_000;

type Listener = (home: HomeBriefingResponse) => void;

let cache: HomeBriefingResponse | null = null;
let cacheAt = 0;
let inflight: Promise<HomeBriefingResponse> | null = null;
const listeners = new Set<Listener>();

function notify(home: HomeBriefingResponse): void {
  for (const listener of listeners) {
    try {
      listener(home);
    } catch {
      /* listener errors must not break others */
    }
  }
}

export function getCachedHome(): HomeBriefingResponse | null {
  return cache;
}

export async function loadHome(opts?: { force?: boolean }): Promise<HomeBriefingResponse> {
  if (!opts?.force && cache && Date.now() - cacheAt < FRESH_MS) return cache;
  if (inflight) return inflight;
  inflight = fetchHome()
    .then((home) => {
      cache = home;
      cacheAt = Date.now();
      notify(home);
      return home;
    })
    .finally(() => {
      inflight = null;
    });
  return inflight;
}

/** Subscribe to briefing updates; replays the cached value immediately. */
export function subscribeHome(listener: Listener): () => void {
  listeners.add(listener);
  if (cache) listener(cache);
  return () => {
    listeners.delete(listener);
  };
}
