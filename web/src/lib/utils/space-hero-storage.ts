import { browser } from '$app/environment';

const STORAGE_KEY = 'gallery-space-hero-collapsed';

export function loadHeroCollapsed(spaceId: string): boolean {
  if (browser) {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        const record = JSON.parse(raw) as Record<string, boolean>;
        return record[spaceId] ?? false;
      }
    } catch {
      /* corrupted JSON — fall through */
    }
  }
  return false;
}

export function persistHeroCollapsed(spaceId: string, collapsed: boolean): void {
  if (browser) {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      const record: Record<string, boolean> = raw ? (JSON.parse(raw) as Record<string, boolean>) : {};
      record[spaceId] = collapsed;
      localStorage.setItem(STORAGE_KEY, JSON.stringify(record));
    } catch {
      /* localStorage unavailable */
    }
  }
}
