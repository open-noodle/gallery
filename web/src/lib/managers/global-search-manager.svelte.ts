import { browser } from '$app/environment';
import { goto } from '$app/navigation';
import { Route } from '$lib/route';
import { addEntry, makePlaceId, type RecentEntry } from '$lib/stores/cmdk-recent';
import {
  getAllTags,
  searchAssets,
  searchPerson,
  searchPlaces,
  searchSmart,
  type MetadataSearchDto,
  type TagResponseDto,
} from '@immich/sdk';

export type SearchMode = 'smart' | 'metadata' | 'description' | 'ocr';

export type ProviderStatus<T = unknown> =
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'ok'; items: T[]; total: number }
  | { status: 'timeout' }
  | { status: 'error'; message: string }
  | { status: 'empty' };

export type Sections = {
  photos: ProviderStatus;
  people: ProviderStatus;
  places: ProviderStatus;
  tags: ProviderStatus;
};

export interface Provider<T = unknown> {
  key: keyof Sections;
  topN: number;
  minQueryLength: number;
  run(query: string, mode: SearchMode, signal: AbortSignal): Promise<ProviderStatus<T>>;
}

export type ActiveItem =
  | { kind: 'photo'; data: unknown }
  | { kind: 'person'; data: unknown }
  | { kind: 'place'; data: unknown }
  | { kind: 'tag'; data: unknown };

const VALID_MODES: ReadonlySet<SearchMode> = new Set(['smart', 'metadata', 'description', 'ocr']);
const idle: ProviderStatus = { status: 'idle' };

function loadSearchQueryType(): SearchMode {
  if (!browser) {
    return 'smart';
  }
  try {
    const stored = localStorage.getItem('searchQueryType');
    if (stored && VALID_MODES.has(stored as SearchMode)) {
      return stored as SearchMode;
    }
    if (stored !== null) {
      localStorage.setItem('searchQueryType', 'smart');
    }
  } catch {
    // localStorage unavailable (privacy mode, SSR shim throwing) — fall through
  }
  return 'smart';
}

export class GlobalSearchManager {
  isOpen = $state(false);
  query = $state('');
  mode = $state<SearchMode>(loadSearchQueryType());
  sections = $state<Sections>({ photos: idle, people: idle, places: idle, tags: idle });
  activeItemId = $state<string | null>(null);
  mlHealthy = $state(true);

  protected providers: Record<keyof Sections, Provider>;
  protected debounceTimer: ReturnType<typeof setTimeout> | null = null;
  protected batchController: AbortController | null = null;
  protected photosController: AbortController | null = null;

  private tagsCache: TagResponseDto[] | null = null;
  private tagsDisabled = false;
  private storageListener?: (e: StorageEvent) => void;

  constructor() {
    this.providers = this.buildProviders();
    if (browser) {
      this.storageListener = (e) => {
        if (e.key === 'cmdk.tags.version') {
          this.tagsCache = null;
        }
      };
      window.addEventListener('storage', this.storageListener);
    }
  }

  destroy() {
    if (this.storageListener) {
      window.removeEventListener('storage', this.storageListener);
    }
  }

  open() {
    this.isOpen = true;
  }

  close() {
    this.isOpen = false;
    if (this.debounceTimer !== null) {
      clearTimeout(this.debounceTimer);
    }
    this.debounceTimer = null;
    this.batchController?.abort();
    this.batchController = null;
    this.photosController?.abort();
    this.photosController = null;
    this.sections = { photos: idle, people: idle, places: idle, tags: idle };
    this.activeItemId = null;
    this.tagsCache = null;
    // Reset query so reopening and re-typing the same string is not a no-op
    // (setQuery short-circuits when `this.query === text`).
    this.query = '';
  }

  toggle() {
    if (this.isOpen) {
      this.close();
    } else {
      this.open();
    }
  }

  setActiveItem(id: string | null) {
    this.activeItemId = id;
  }

  getActiveItem(): ActiveItem | null {
    const id = this.activeItemId;
    if (!id) {
      return null;
    }
    const colon = id.indexOf(':');
    if (colon === -1) {
      return null;
    }
    const kind = id.slice(0, colon);
    const rest = id.slice(colon + 1);
    const section = this.sectionForKind(kind);
    if (!section || section.status !== 'ok') {
      return null;
    }
    const items = section.items as Array<{ id?: string; latitude?: number; longitude?: number }>;
    const match = items.find((it) => {
      if (it.id !== undefined) {
        return it.id === rest;
      }
      if (kind === 'place' && it.latitude !== undefined && it.longitude !== undefined) {
        return `${it.latitude.toFixed(4)}:${it.longitude.toFixed(4)}` === rest;
      }
      return false;
    });
    if (!match) {
      return null;
    }
    return { kind: kind as ActiveItem['kind'], data: match };
  }

  private sectionForKind(kind: string): ProviderStatus | null {
    switch (kind) {
      case 'photo': {
        return this.sections.photos;
      }
      case 'person': {
        return this.sections.people;
      }
      case 'place': {
        return this.sections.places;
      }
      case 'tag': {
        return this.sections.tags;
      }
      default: {
        return null;
      }
    }
  }

  reconcileCursor() {
    if (this.getActiveItem() !== null) {
      return;
    }
    const order = ['photos', 'people', 'places', 'tags'] as const;
    const kindOf: Record<keyof Sections, string> = {
      photos: 'photo',
      people: 'person',
      places: 'place',
      tags: 'tag',
    };
    for (const key of order) {
      const s = this.sections[key];
      if (s.status === 'ok' && s.items.length > 0) {
        const first = s.items[0] as { id?: string; latitude?: number; longitude?: number };
        if (first.id !== undefined) {
          this.activeItemId = `${kindOf[key]}:${first.id}`;
          return;
        }
        if (key === 'places' && first.latitude !== undefined && first.longitude !== undefined) {
          this.activeItemId = `place:${first.latitude.toFixed(4)}:${first.longitude.toFixed(4)}`;
          return;
        }
      }
    }
    this.activeItemId = null;
  }

  activate(kind: 'photo' | 'person' | 'place' | 'tag', item: unknown) {
    const now = Date.now();
    switch (kind) {
      case 'photo': {
        const p = item as { id: string; originalFileName?: string };
        addEntry({
          kind: 'photo',
          id: `photo:${p.id}`,
          assetId: p.id,
          label: p.originalFileName ?? '',
          lastUsed: now,
        });
        void goto(Route.viewAsset({ id: p.id }));
        break;
      }
      case 'person': {
        const p = item as { id: string; name?: string; faceAssetId?: string };
        addEntry({
          kind: 'person',
          id: `person:${p.id}`,
          personId: p.id,
          label: p.name ?? '',
          thumbnailAssetId: p.faceAssetId,
          lastUsed: now,
        });
        void goto(Route.viewPerson({ id: p.id }));
        break;
      }
      case 'place': {
        const p = item as { name?: string; latitude: number; longitude: number };
        addEntry({
          kind: 'place',
          id: makePlaceId(p.latitude, p.longitude),
          latitude: p.latitude,
          longitude: p.longitude,
          label: p.name ?? '',
          lastUsed: now,
        });
        void goto(Route.map({ zoom: 12, lat: p.latitude, lng: p.longitude }));
        break;
      }
      case 'tag': {
        const t = item as { id: string; name?: string };
        addEntry({
          kind: 'tag',
          id: `tag:${t.id}`,
          tagId: t.id,
          label: t.name ?? '',
          lastUsed: now,
        });
        void goto(Route.search({ tagIds: [t.id] }));
        break;
      }
    }
    this.close();
  }

  activateRecent(entry: RecentEntry) {
    const now = Date.now();
    addEntry({ ...entry, lastUsed: now });
    if (entry.kind === 'query') {
      this.setMode(entry.mode);
      this.setQuery(entry.text);
      return;
    }
    switch (entry.kind) {
      case 'photo': {
        void goto(Route.viewAsset({ id: entry.assetId }));
        break;
      }
      case 'person': {
        void goto(Route.viewPerson({ id: entry.personId }));
        break;
      }
      case 'place': {
        void goto(Route.map({ zoom: 12, lat: entry.latitude, lng: entry.longitude }));
        break;
      }
      case 'tag': {
        void goto(Route.search({ tagIds: [entry.tagId] }));
        break;
      }
    }
    this.close();
  }

  setMode(newMode: SearchMode) {
    if (newMode === this.mode) {
      return;
    }
    this.mode = newMode;
    if (browser) {
      try {
        localStorage.setItem('searchQueryType', newMode);
      } catch {
        // ignore — privacy mode
      }
    }

    if (this.debounceTimer !== null) {
      this.clearDebounce();
      this.debounceTimer = setTimeout(() => this.runBatch(this.query, this.mode), 150);
      return;
    }
    if (this.query.trim() === '') {
      return;
    }

    this.photosController?.abort();
    const photos = new AbortController();
    this.photosController = photos;
    const batch = this.batchController;
    const signal = AbortSignal.any([
      ...(batch ? [batch.signal] : []),
      photos.signal,
      AbortSignal.timeout(5000),
    ]);
    this.providers.photos
      .run(this.query, this.mode, signal)
      .then((result) => {
        if (batch !== this.batchController) {
          return;
        }
        this.sections.photos = result;
        this.onPhotosSettled();
        this.reconcileCursor();
      })
      .catch((err: unknown) => {
        if (err instanceof Error && err.name === 'AbortError') {
          if (signal.aborted && signal.reason instanceof DOMException && signal.reason.name === 'TimeoutError') {
            this.sections.photos = { status: 'timeout' };
            this.onPhotosSettled();
          }
          return;
        }
        this.sections.photos = {
          status: 'error',
          message: err instanceof Error ? err.message : 'unknown error',
        };
        this.onPhotosSettled();
      });
  }

  private onPhotosSettled() {
    if (this.mode !== 'smart') {
      return;
    }
    const s = this.sections.photos.status;
    if (s === 'timeout' || s === 'error') {
      this.mlHealthy = false;
    }
  }

  announcementText = $derived.by(() => {
    const s = this.sections;
    const allSettled =
      s.photos.status !== 'loading' &&
      s.people.status !== 'loading' &&
      s.places.status !== 'loading' &&
      s.tags.status !== 'loading';
    if (!allSettled) {
      return '';
    }
    const parts: string[] = [];
    const count = (st: ProviderStatus) => (st.status === 'ok' ? st.total : 0);
    if (count(s.photos) > 0) {
      parts.push(`${count(s.photos)} photos`);
    }
    if (count(s.people) > 0) {
      parts.push(`${count(s.people)} people`);
    }
    if (count(s.places) > 0) {
      parts.push(`${count(s.places)} places`);
    }
    if (count(s.tags) > 0) {
      parts.push(`${count(s.tags)} tags`);
    }
    return parts.join(', ');
  });

  setQuery(text: string) {
    if (this.query === text) {
      return;
    }
    this.query = text;
    this.clearDebounce();
    this.batchController?.abort();
    this.batchController = null;
    this.photosController?.abort();
    this.photosController = null;

    if (text.trim() === '') {
      this.sections = { photos: idle, people: idle, places: idle, tags: idle };
      return;
    }

    this.sections = {
      photos: { status: 'loading' },
      people: { status: 'loading' },
      places: { status: 'loading' },
      tags: { status: 'loading' },
    };
    this.debounceTimer = setTimeout(() => this.runBatch(text, this.mode), 150);
  }

  protected runBatch(text: string, mode: SearchMode) {
    this.debounceTimer = null;
    const batch = new AbortController();
    const photosLocal = new AbortController();
    this.batchController = batch;
    this.photosController = photosLocal;

    for (const key of ['photos', 'people', 'places', 'tags'] as const) {
      const provider = this.providers[key];
      if (text.length < provider.minQueryLength) {
        this.sections[key] = idle;
        continue;
      }
      const controllers = key === 'photos' ? [batch.signal, photosLocal.signal] : [batch.signal];
      const signal = AbortSignal.any([...controllers, AbortSignal.timeout(5000)]);

      // Promise.resolve().then(...) guarantees that a provider which synchronously
      // throws (not just returns a rejected promise) still lands in the .catch handler.
      Promise.resolve()
        .then(() => provider.run(text, mode, signal))
        .then((result) => {
          if (batch !== this.batchController) {
            return;
          }
          this.sections[key] = result;
          if (key === 'photos') {
            this.onPhotosSettled();
          }
          this.reconcileCursor();
        })
        .catch((err: unknown) => {
          if (batch !== this.batchController) {
            return;
          }
          if (err instanceof Error && err.name === 'AbortError') {
            if (signal.aborted && signal.reason instanceof DOMException && signal.reason.name === 'TimeoutError') {
              this.sections[key] = { status: 'timeout' };
              if (key === 'photos') {
                this.onPhotosSettled();
              }
            }
            return;
          }
          const message = err instanceof Error ? err.message : 'unknown error';
          this.sections[key] = { status: 'error', message };
          if (key === 'photos') {
            this.onPhotosSettled();
          }
        });
    }
  }

  private clearDebounce() {
    if (this.debounceTimer !== null) {
      clearTimeout(this.debounceTimer);
      this.debounceTimer = null;
    }
  }

  private async runTagsProvider(query: string, signal: AbortSignal): Promise<ProviderStatus<TagResponseDto>> {
    if (this.tagsDisabled) {
      return { status: 'error', message: 'tag_cache_too_large' };
    }
    if (this.tagsCache === null) {
      try {
        const all = await getAllTags({ signal });
        if (all.length > 20_000) {
          this.tagsDisabled = true;
          // eslint-disable-next-line no-console
          console.warn('[cmdk] tag cache > 20k, disabling tag provider for session');
          return { status: 'error', message: 'tag_cache_too_large' };
        }
        if (all.length > 5_000) {
          // eslint-disable-next-line no-console
          console.warn(`[cmdk] tag cache is large (${all.length} entries)`);
        }
        this.tagsCache = all;
      } catch (err: unknown) {
        if (err instanceof Error && err.name === 'AbortError') {
          throw err;
        }
        return { status: 'error', message: err instanceof Error ? err.message : 'getAllTags failed' };
      }
    }
    const q = query.toLowerCase();
    const matches = this.tagsCache.filter((t) => t.name.toLowerCase().includes(q)).slice(0, 5);
    return matches.length === 0 ? { status: 'empty' } : { status: 'ok', items: matches, total: matches.length };
  }

  protected buildProviders(): Record<keyof Sections, Provider> {
    const photos: Provider = {
      key: 'photos',
      topN: 5,
      minQueryLength: 1,
      run: async (query, mode, signal) => {
        try {
          if (mode === 'smart') {
            const response = await searchSmart({ smartSearchDto: { query, size: 5 } }, { signal });
            const items = response.assets.items;
            return items.length === 0 ? { status: 'empty' } : { status: 'ok', items, total: items.length };
          }
          const metadataSearchDto: MetadataSearchDto = {
            size: 5,
            ...(mode === 'metadata' ? { originalFileName: query } : {}),
            ...(mode === 'description' ? { description: query } : {}),
            ...(mode === 'ocr' ? { ocr: query } : {}),
          };
          const response = await searchAssets({ metadataSearchDto }, { signal });
          const items = response.assets.items;
          return items.length === 0 ? { status: 'empty' } : { status: 'ok', items, total: items.length };
        } catch (err: unknown) {
          if (err instanceof Error && err.name === 'AbortError') {
            throw err;
          }
          return { status: 'error', message: err instanceof Error ? err.message : 'unknown error' };
        }
      },
    };

    const people: Provider = {
      key: 'people',
      topN: 5,
      minQueryLength: 2,
      run: async (query, _mode, signal) => {
        try {
          const results = await searchPerson({ name: query, withHidden: false }, { signal });
          return results.length === 0
            ? { status: 'empty' }
            : { status: 'ok', items: results.slice(0, 5), total: results.length };
        } catch (err: unknown) {
          if (err instanceof Error && err.name === 'AbortError') {
            throw err;
          }
          return { status: 'error', message: err instanceof Error ? err.message : 'unknown error' };
        }
      },
    };

    const places: Provider = {
      key: 'places',
      topN: 3,
      minQueryLength: 2,
      run: async (query, _mode, signal) => {
        try {
          const results = await searchPlaces({ name: query }, { signal });
          return results.length === 0
            ? { status: 'empty' }
            : { status: 'ok', items: results.slice(0, 3), total: results.length };
        } catch (err: unknown) {
          if (err instanceof Error && err.name === 'AbortError') {
            throw err;
          }
          return { status: 'error', message: err instanceof Error ? err.message : 'unknown error' };
        }
      },
    };

    const tags: Provider = {
      key: 'tags',
      topN: 5,
      minQueryLength: 2,
      run: (query, _mode, signal) => this.runTagsProvider(query, signal),
    };

    return { photos, people, places, tags };
  }
}
