import { browser } from '$app/environment';

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

export function isSuggestionSnoozed(personId: string, total: number): boolean {
  const entry = read()[personId];
  if (!entry) {
    return false;
  }
  if (Date.now() >= entry.until) {
    return false;
  }
  // resurface as soon as there are more suggestions than when the user snoozed
  return total <= entry.count;
}

export function snoozeSuggestions(personId: string, total: number): void {
  if (!browser) {
    return;
  }
  try {
    const record = read();
    record[personId] = { until: Date.now() + SUGGESTION_SNOOZE_MS, count: total };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(record));
  } catch {
    /* localStorage unavailable */
  }
}
