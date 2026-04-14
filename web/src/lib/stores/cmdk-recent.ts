import type { SearchMode } from '$lib/managers/global-search-manager.svelte';

const STORAGE_KEY = 'cmdk.recent';
const MAX_ENTRIES = 20;

// Register a 'storage' listener once at module load (browser only) so that another
// tab's updates to cmdk.recent drop our in-memory cache and the next read re-fetches
// from localStorage. Without this, two tabs silently diverge until one of them clears
// or mutates its own entries.
if (globalThis.window !== undefined) {
  globalThis.addEventListener('storage', (event) => {
    const storageEvent = event as StorageEvent;
    if (storageEvent.key === STORAGE_KEY || storageEvent.key === null) {
      memory = null;
    }
  });
}

export type RecentEntry =
  | { kind: 'query'; id: string; text: string; mode: SearchMode; lastUsed: number }
  | { kind: 'photo'; id: string; assetId: string; label: string; lastUsed: number }
  | { kind: 'person'; id: string; personId: string; label: string; thumbnailAssetId?: string; lastUsed: number }
  | { kind: 'place'; id: string; latitude: number; longitude: number; label: string; lastUsed: number }
  | { kind: 'tag'; id: string; tagId: string; label: string; lastUsed: number }
  | {
      kind: 'navigate';
      id: string;
      route: string;
      labelKey: string;
      icon: string;
      adminOnly: boolean;
      lastUsed: number;
    };

let memory: RecentEntry[] | null = null;
let warnedOnce = false;

function warn(err: unknown) {
  if (warnedOnce) {
    return;
  }
  warnedOnce = true;

  console.warn('[cmdk.recent]', err);
}

function rawRead(): RecentEntry[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw === null) {
      return [];
    }
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as RecentEntry[]) : [];
  } catch (error) {
    warn(error);
    return [];
  }
}

function rawWrite(entries: RecentEntry[]) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(entries));
  } catch (error) {
    warn(error);
  }
}

export function getEntries(): RecentEntry[] {
  if (memory === null) {
    memory = rawRead();
  }
  return [...memory].sort((a, b) => b.lastUsed - a.lastUsed);
}

export function addEntry(entry: RecentEntry) {
  if (memory === null) {
    memory = rawRead();
  }
  const deduped = memory.filter((e) => e.id !== entry.id);
  deduped.push(entry);
  deduped.sort((a, b) => b.lastUsed - a.lastUsed);
  memory = deduped.slice(0, MAX_ENTRIES);
  rawWrite(memory);
}

export function clearEntries() {
  memory = [];
  rawWrite([]);
}

export function removeEntry(id: string) {
  if (memory === null) {
    memory = rawRead();
  }
  const before = memory.length;
  memory = memory.filter((e) => e.id !== id);
  if (memory.length !== before) {
    rawWrite(memory);
  }
}

export function makePlaceId(lat: number, lng: number): string {
  return `place:${lat.toFixed(4)}:${lng.toFixed(4)}`;
}

// Test-only escape hatch: reset the in-memory cache so tests get a clean slate
// without leaking state across `localStorage.clear()`.
export function __resetForTests() {
  memory = null;
  warnedOnce = false;
}
