import { browser } from '$app/environment';
import { authManager } from '$lib/managers/auth-manager.svelte';

const STORAGE_KEY = 'gallery-face-suggestion-snooze';

export const SUGGESTION_SNOOZE_MS = 30 * 24 * 60 * 60 * 1000; // ~30 days

type SnoozeRecord = Record<string, { until: number; count: number }>;

const read = (): SnoozeRecord => {
  if (!browser) {
    return {};
  }
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? (JSON.parse(raw) as SnoozeRecord) : {};
  } catch {
    return {};
  }
};

const write = (record: SnoozeRecord): void => {
  if (!browser) {
    return;
  }
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(record));
  } catch {
    /* localStorage unavailable */
  }
};

// Entries are keyed by `${userId}:${personId}`, not personId alone, so a shared/demo browser with multiple
// accounts never lets user A's snooze hide user B's suggestions (D17). `browser` guards SSR; a signed-out
// visitor (or the brief pre-load window before `authManager.user` is populated — that getter throws otherwise)
// has no stable key at all, so snoozing is a no-op and nothing ever reads back as snoozed.
const scopedKey = (personId: string): string | undefined => {
  if (!browser || !authManager.authenticated) {
    return undefined;
  }
  return `${authManager.user.id}:${personId}`;
};

export function isSuggestionSnoozed(personId: string, total: number): boolean {
  const storageKey = scopedKey(personId);
  if (!storageKey) {
    return false;
  }
  const record = read();
  const entry = record[storageKey];
  if (!entry) {
    return false;
  }
  if (Date.now() >= entry.until) {
    return false;
  }
  // Rebase the baseline DOWN as suggestions get resolved elsewhere (the admin cleanup console, another
  // session) between banner fetches — otherwise a genuinely NEW suggestion arriving later would stay hidden
  // just because the total is still below the ORIGINAL snooze count (D17).
  if (total < entry.count) {
    entry.count = total;
    write(record);
  }
  // Resurface as soon as there are more suggestions than the (possibly rebased) baseline.
  return total <= entry.count;
}

// Drops every entry whose expiry has already passed. Without this, the record only ever grows — one stale
// entry per person ever snoozed, for every user who ever used a shared/demo browser — since nothing else ever
// removes an entry once `isSuggestionSnoozed` starts reading `false` for it.
const pruneExpired = (record: SnoozeRecord): SnoozeRecord => {
  const now = Date.now();
  const pruned: SnoozeRecord = {};
  for (const [key, entry] of Object.entries(record)) {
    if (entry.until > now) {
      pruned[key] = entry;
    }
  }
  return pruned;
};

export function snoozeSuggestions(personId: string, total: number): void {
  const storageKey = scopedKey(personId);
  if (!storageKey) {
    return;
  }
  const record = pruneExpired(read());
  record[storageKey] = { until: Date.now() + SUGGESTION_SNOOZE_MS, count: total };
  write(record);
}
