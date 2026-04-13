import { browser } from '$app/environment';

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

  constructor() {
    this.providers = this.buildProviders();
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
  }

  toggle() {
    if (this.isOpen) {
      this.close();
    } else {
      this.open();
    }
  }

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
        })
        .catch((err: unknown) => {
          if (batch !== this.batchController) {
            return;
          }
          if (err instanceof Error && err.name === 'AbortError') {
            if (signal.aborted && signal.reason instanceof DOMException && signal.reason.name === 'TimeoutError') {
              this.sections[key] = { status: 'timeout' };
            }
            return;
          }
          const message = err instanceof Error ? err.message : 'unknown error';
          this.sections[key] = { status: 'error', message };
        });
    }
  }

  private clearDebounce() {
    if (this.debounceTimer !== null) {
      clearTimeout(this.debounceTimer);
      this.debounceTimer = null;
    }
  }

  protected buildProviders(): Record<keyof Sections, Provider> {
    const stub = (key: keyof Sections, topN: number, minLen: number): Provider => ({
      key,
      topN,
      minQueryLength: minLen,
      run: async () => ({ status: 'empty' }),
    });
    return {
      photos: stub('photos', 5, 1),
      people: stub('people', 5, 2),
      places: stub('places', 3, 2),
      tags: stub('tags', 5, 2),
    };
  }
}
