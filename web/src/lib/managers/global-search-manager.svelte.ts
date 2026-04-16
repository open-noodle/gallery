import { browser } from '$app/environment';
import { goto } from '$app/navigation';
import { featureFlagsManager } from '$lib/managers/feature-flags-manager.svelte';
import { themeManager } from '$lib/managers/theme-manager.svelte';
import { Route } from '$lib/route';
import { addEntry, getEntries, makePlaceId, removeEntry, type RecentEntry } from '$lib/stores/cmdk-recent';
import { user } from '$lib/stores/user.store';
import {
  getAllTags,
  getMlHealth,
  searchAssets,
  searchPerson,
  searchPlaces,
  searchSmart,
  type MetadataSearchDto,
  type TagResponseDto,
} from '@immich/sdk';
import { computeCommandScore } from 'bits-ui';
import { locale as i18nLocale, t, type Translations } from 'svelte-i18n';
import { SvelteMap } from 'svelte/reactivity';
import { get } from 'svelte/store';
import { isAlmostExactNavMatch, NAVIGATION_ITEMS, type NavigationItem } from './navigation-items';

export type SearchMode = 'smart' | 'metadata' | 'description' | 'ocr';

export type ProviderStatus<T = unknown> =
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'ok'; items: T[]; total: number }
  | { status: 'timeout' }
  | { status: 'error'; message: string }
  | { status: 'empty' };

/**
 * Common shape for entity section items. Each entity DTO (photo / person / place /
 * tag) satisfies this structurally — photos/people/tags have `id`, places have
 * `latitude`/`longitude`. Using this as the Sections generic argument matches the
 * shape `GlobalSearchSection` expects and keeps svelte-check happy; plain
 * `ProviderStatus` (default generic `unknown`) would not satisfy the component's
 * `T extends { id?; latitude?; longitude? }` constraint.
 */
export type EntityItem = {
  id?: string;
  latitude?: number;
  longitude?: number;
};

export type Sections = {
  photos: ProviderStatus<EntityItem>;
  people: ProviderStatus<EntityItem>;
  places: ProviderStatus<EntityItem>;
  tags: ProviderStatus<EntityItem>;
  navigation: ProviderStatus<NavigationItem>;
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
  | { kind: 'tag'; data: unknown }
  | { kind: 'nav'; data: NavigationItem };

const VALID_MODES: ReadonlySet<SearchMode> = new Set(['smart', 'metadata', 'description', 'ocr']);
// Narrow literal type so it can be assigned to both `ProviderStatus<unknown>` and
// `ProviderStatus<NavigationItem>` without the generic T widening fighting the assignment.
// Frozen so a future engineer cannot accidentally mutate the shared reference and
// cross-contaminate all five sections.
const idle = Object.freeze({ status: 'idle' as const });

function isValidRecentEntry(e: RecentEntry): boolean {
  switch (e.kind) {
    case 'query': {
      return typeof e.text === 'string' && e.text.length > 0 && VALID_MODES.has(e.mode);
    }
    case 'photo': {
      return typeof e.assetId === 'string' && e.assetId.length > 0;
    }
    case 'person': {
      return typeof e.personId === 'string' && e.personId.length > 0;
    }
    case 'place': {
      return Number.isFinite(e.latitude) && Number.isFinite(e.longitude);
    }
    case 'tag': {
      return typeof e.tagId === 'string' && e.tagId.length > 0;
    }
    case 'navigate': {
      return (
        typeof e.route === 'string' &&
        e.route.length > 0 &&
        typeof e.labelKey === 'string' &&
        e.labelKey.length > 0 &&
        typeof e.icon === 'string' &&
        e.icon.length > 0
      );
    }
    default: {
      return false;
    }
  }
}

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
  sections = $state<Sections>({ photos: idle, people: idle, places: idle, tags: idle, navigation: idle });
  activeItemId = $state<string | null>(null);
  mlHealthy = $state(true);
  /**
   * Monotonic counter bumped on every mid-session mutation of the cmdk-recent
   * store (e.g. `removeRecent`). The component's `recentEntries` $derived reads
   * it so deleting a highlighted entry re-evaluates the derived in the same
   * tick — without it, the DOM would show the deleted row until the palette
   * closed and reopened. The counter value itself is not meaningful; its role
   * is purely to register a reactive dependency on mutations the cmdk-recent
   * store cannot signal on its own (plain functions, not a Svelte store).
   */
  recentsRevision = $state(0);
  /**
   * True while any provider in the current batch (or a mode-switch re-run) is in flight.
   * Drives the progress stripe on the palette header.
   */
  batchInFlight = $state(false);

  protected providers: Record<keyof Sections, Provider>;
  protected debounceTimer: ReturnType<typeof setTimeout> | null = null;
  protected batchController: AbortController | null = null;
  protected photosController: AbortController | null = null;
  /**
   * Count of providers currently in flight. runBatch resets this at entry so a stale
   * batch's decrements cannot corrupt the new batch's bookkeeping (onSettle checks
   * `batch !== this.batchController` before decrementing — see the stale-batch guard).
   */
  private inFlightCounter = 0;
  /**
   * When the current batchInFlight window started (performance.now()). Set by runBatch
   * at debounce-fire time, not setQuery time — the debounce would eat most of the
   * component-side 200ms grace window otherwise.
   */
  private _batchInFlightStartedAt = 0;
  get batchInFlightStartedAt() {
    return this._batchInFlightStartedAt;
  }

  private tagsCache: TagResponseDto[] | null = null;
  private tagsDisabled = false;
  private storageListener?: (e: StorageEvent) => void;
  private mlProbed = false;

  /**
   * Locale-keyed memo cache for navigation item search strings.
   * Keys: locale code (e.g. 'en'). Values: Map<navItemId, searchableString> where
   * searchableString is `${label} ${description}`. Rebuilt on locale change.
   */
  // SvelteMap used per the svelte/prefer-svelte-reactivity lint rule. This is a
  // non-reactive memoization cache — the reactivity machinery isn't needed here, but
  // using the Svelte-aware type keeps the rule happy and has negligible overhead.
  private navigationSearchCache: SvelteMap<string, SvelteMap<string, string>> = new SvelteMap();
  private localeUnsubscribe?: () => void;

  constructor() {
    this.providers = this.buildProviders();
    if (browser) {
      this.storageListener = (e) => {
        if (e.key === 'cmdk.tags.version') {
          this.tagsCache = null;
        }
      };
      globalThis.addEventListener('storage', this.storageListener);

      // Invalidate the navigation search cache when the locale changes.
      // The unsubscribe handle is stored on `this.localeUnsubscribe` for test isolation.
      // In production it is never called — the singleton lives for the tab's lifetime.
      this.localeUnsubscribe = i18nLocale.subscribe(() => {
        this.navigationSearchCache.clear();
      });
    }
  }

  destroy() {
    if (this.storageListener) {
      globalThis.removeEventListener('storage', this.storageListener);
    }
    if (this.localeUnsubscribe) {
      this.localeUnsubscribe();
    }
  }

  /**
   * Build or fetch the memoized search-string table for the current locale. Called
   * synchronously from runNavigationProvider. O(1) cache hit; O(NAVIGATION_ITEMS.length)
   * rebuild on locale change or first call.
   */
  private getNavigationSearchStrings(): SvelteMap<string, string> {
    const currentLocale = (get(i18nLocale) ?? 'en') as string;
    const cached = this.navigationSearchCache.get(currentLocale);
    if (cached) {
      return cached;
    }
    const translate = get(t);
    const table = new SvelteMap<string, string>();
    for (const item of NAVIGATION_ITEMS) {
      // labelKey/descriptionKey are typed `string` on NavigationItem but every value is a
      // valid i18n key generated at build time — cast to Translations to satisfy the
      // Gallery-augmented MessageFormatter signature.
      const label = translate(item.labelKey as Translations);
      const description = translate(item.descriptionKey as Translations);
      table.set(item.id, `${label} ${description}`);
    }
    this.navigationSearchCache.set(currentLocale, table);
    return table;
  }

  /**
   * Synchronously filter NAVIGATION_ITEMS for a query. Applies admin + feature-flag gates,
   * scores via `computeCommandScore`, and returns a flat `ProviderStatus` (no grouping).
   * Runs on every keystroke off the main path — bypasses the 150 ms debounce.
   */
  private runNavigationProvider(query: string): ProviderStatus<NavigationItem> {
    if (query.length === 0) {
      return { status: 'empty' };
    }
    const u = get(user);
    const isAdmin = u?.isAdmin ?? false;
    const flags = featureFlagsManager.valueOrUndefined;
    const searchStrings = this.getNavigationSearchStrings();

    const scored: Array<{ item: NavigationItem; score: number }> = [];
    for (const item of NAVIGATION_ITEMS) {
      if (item.adminOnly && !isAdmin) {
        continue;
      }
      if (item.featureFlag && !flags?.[item.featureFlag]) {
        continue;
      }
      const corpus = searchStrings.get(item.id);
      if (!corpus) {
        continue;
      }
      const score = computeCommandScore(corpus, query);
      if (score <= 0) {
        continue;
      }
      scored.push({ item, score });
    }
    if (scored.length === 0) {
      return { status: 'empty' };
    }
    scored.sort((a, b) => b.score - a.score);
    const items = scored.map((s) => s.item);
    return { status: 'ok', items, total: items.length };
  }

  open() {
    this.isOpen = true;
    if (!this.mlProbed) {
      this.mlProbed = true;
      void this.probeMlHealth();
    }
  }

  private async probeMlHealth() {
    try {
      const result = await getMlHealth();
      // If the palette was closed while the probe was in flight, discard the result.
      // Otherwise a slow probe could flip mlHealthy on a hidden manager and corrupt
      // the next-open state.
      if (!this.isOpen) {
        return;
      }
      this.mlHealthy = result.smartSearchHealthy;
    } catch {
      // Retroactive promotion (onPhotosSettled) handles mid-session failure.
    }
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
    this.sections = { photos: idle, people: idle, places: idle, tags: idle, navigation: idle };
    this.activeItemId = null;
    this.tagsCache = null;
    // Clear batch bookkeeping. Without this, closing mid-batch leaves batchInFlight=true
    // (the stale-batch guard in onSettle prevents stale decrements, so counter never
    // returns to zero naturally) which would flash the progress stripe on reopen.
    this.batchInFlight = false;
    this.inFlightCounter = 0;
    this._batchInFlightStartedAt = 0;
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
    // Empty-query branch: the list is showing recents, not live section results. If
    // the active id matches a recent entry, synthesize a lightweight preview payload
    // from its stored fields. Fall through to the section lookup below if no recent
    // matches — that path is still used by direct-state tests that poke sections with
    // an empty query.
    if (this.query.trim() === '') {
      const entry = getEntries().find((e) => e.id === id);
      if (entry) {
        return this.activeItemFromRecent(entry);
      }
    }
    // Navigation item IDs are themselves prefixed `nav:...` so the split-on-first-colon
    // trick is inverted: the whole id is the cursor value, and the kind prefix is the
    // string BEFORE the first colon. For nav items, the "kind prefix" is literally `nav`.
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

    if (kind === 'nav') {
      // For navigation items, the activeItemId IS the full NavigationItem.id (e.g.
      // `nav:theme`, `nav:systemSettings:classification`). Match on the full id.
      const navItems = section.items as NavigationItem[];
      const navMatch = navItems.find((n) => n.id === id);
      return navMatch ? { kind: 'nav', data: navMatch } : null;
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
    return { kind: kind as 'photo' | 'person' | 'place' | 'tag', data: match };
  }

  /**
   * Build a lightweight ActiveItem from a RecentEntry. Recent entries only store the
   * minimum fields needed for row rendering (id, label, a thumbnail hint), not the
   * full API DTO — so the resulting preview payload is intentionally sparse. The per-
   * kind preview components tolerate missing fields via optional chaining.
   *
   *   - photo/person/place/tag → return a `{ kind, data }` pair suitable for their
   *     existing preview components.
   *   - query/navigate → no preview (nothing interesting to show beyond the row itself).
   */
  private activeItemFromRecent(entry: RecentEntry): ActiveItem | null {
    switch (entry.kind) {
      case 'photo': {
        return {
          kind: 'photo',
          data: { id: entry.assetId, originalFileName: entry.label } as unknown,
        };
      }
      case 'person': {
        return {
          kind: 'person',
          data: {
            id: entry.personId,
            name: entry.label,
            faceAssetId: entry.thumbnailAssetId,
          } as unknown,
        };
      }
      case 'place': {
        return {
          kind: 'place',
          data: { name: entry.label, latitude: entry.latitude, longitude: entry.longitude } as unknown,
        };
      }
      case 'tag': {
        return {
          kind: 'tag',
          data: { id: entry.tagId, name: entry.label } as unknown,
        };
      }
      case 'query':
      case 'navigate': {
        return null;
      }
    }
  }

  private sectionForKind(kind: string): ProviderStatus<unknown> | null {
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
      case 'nav': {
        return this.sections.navigation;
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
    const order = ['photos', 'people', 'places', 'tags', 'navigation'] as const;
    const kindOf: Record<keyof Sections, string> = {
      photos: 'photo',
      people: 'person',
      places: 'place',
      tags: 'tag',
      navigation: 'nav',
    };
    for (const key of order) {
      const s = this.sections[key];
      if (s.status === 'ok' && s.items.length > 0) {
        const first = s.items[0] as { id?: string; latitude?: number; longitude?: number };
        if (first.id !== undefined) {
          // Navigation item IDs are already fully-qualified (`nav:<category>:<slug>`).
          // Other entity IDs are just the raw entity id and need the kind prefix.
          this.activeItemId = key === 'navigation' ? first.id : `${kindOf[key]}:${first.id}`;
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

  /**
   * Navigate to a NavigationItem route. If the target's pathname matches the current
   * pathname (only query params differ), SvelteKit's client-side `goto` updates the
   * URL without re-running the page component — URL-backed component state such as
   * `SettingAccordionState` in the system-settings page would then be stuck on its
   * stale initial value. Fall back to a full browser navigation in that case so
   * every component remounts with the fresh URL and re-reads its query params.
   */
  private navigateNav(route: string) {
    if (!browser) {
      return;
    }
    try {
      // Plain URL parsing, not reactive state — the instance is discarded after the
      // pathname comparison. SvelteURL would be overkill here.
      // eslint-disable-next-line svelte/prefer-svelte-reactivity
      const target = new URL(route, globalThis.location.href);
      if (target.pathname === globalThis.location.pathname) {
        globalThis.location.href = route;
        return;
      }
    } catch {
      // Fall through to goto if URL parsing fails.
    }
    void goto(route);
  }

  activate(kind: 'photo' | 'person' | 'place' | 'tag' | 'nav', item: unknown) {
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
      case 'nav': {
        const n = item as NavigationItem;
        if (n.category === 'actions') {
          // Actions are stateless side-effect handlers. Dispatch by id so future
          // actions can be added without falling through to the goto path (which
          // would navigate to `route: ''` and persist a broken recent).
          if (n.id === 'nav:theme') {
            themeManager.toggleTheme();
          } else {
            console.warn('[cmdk] unknown action navigation item', n.id);
          }
        } else {
          addEntry({
            kind: 'navigate',
            id: n.id,
            route: n.route,
            labelKey: n.labelKey,
            icon: n.icon,
            adminOnly: n.adminOnly,
            lastUsed: now,
          });
          this.navigateNav(n.route);
        }
        break;
      }
    }
    this.close();
  }

  activateRecent(entry: RecentEntry) {
    // Guard against corrupt or truncated entries (user-tampered localStorage, legacy
    // schema from an older version). Missing the kind-specific id fields would cause
    // goto('/photos/undefined') or similar bad URLs, so bail out silently.
    if (!isValidRecentEntry(entry)) {
      console.warn('[cmdk] ignoring corrupt recent entry', entry);
      this.close();
      return;
    }
    // Stale-state re-check for navigate entries. Three failure modes, all treated
    // the same way (warn + purge + close):
    //   1. The navigation item was removed from NAVIGATION_ITEMS (upgrade dropped it).
    //   2. It's adminOnly and the user has been demoted since the recent was saved.
    //   3. It's feature-flag gated and the flag was disabled since the recent was saved.
    // Using the LIVE NavigationItem (not the saved entry fields) ensures we pick up
    // adminOnly / featureFlag / route changes made upstream.
    let liveNavItem: NavigationItem | undefined;
    if (entry.kind === 'navigate') {
      liveNavItem = NAVIGATION_ITEMS.find((n) => n.id === entry.id);
      const isAdmin = get(user)?.isAdmin ?? false;
      const flags = featureFlagsManager.valueOrUndefined;
      if (!liveNavItem) {
        console.warn('[cmdk] purging stale recent — unknown nav item', entry.id);
        removeEntry(entry.id);
        this.close();
        return;
      }
      if (liveNavItem.adminOnly && !isAdmin) {
        console.warn('[cmdk] purging stale admin recent', entry.id);
        removeEntry(entry.id);
        this.close();
        return;
      }
      if (liveNavItem.featureFlag && !flags?.[liveNavItem.featureFlag]) {
        console.warn('[cmdk] purging stale recent — feature flag disabled', entry.id);
        removeEntry(entry.id);
        this.close();
        return;
      }
    }
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
      case 'navigate': {
        // Use the LIVE NavigationItem route — an upstream rename would otherwise
        // leave the user stranded on a 404 even though we just validated the entry.
        // liveNavItem is guaranteed set here (unknown-item branch returned early),
        // but fall back to entry.route for defensive robustness.
        this.navigateNav(liveNavItem?.route ?? entry.route);
        break;
      }
    }
    this.close();
  }

  /**
   * Removes a recent entry from the cmdk-recent store and re-homes the highlight
   * if the caller deleted the currently-active row. Called from Delete/Backspace
   * key handling and the per-row X button. No-op on unknown ids so a stale cursor
   * from an out-of-date view does not accidentally bump the revision.
   */
  removeRecent(id: string) {
    const before = getEntries();
    if (!before.some((e) => e.id === id)) {
      return;
    }
    removeEntry(id);
    this.recentsRevision++;
    // If the deleted row was the active one, pick the next-newest remaining
    // entry so keyboard users are not stranded on a dead cursor. `getEntries`
    // returns newest-first, and since `id` is guaranteed present in `before`
    // but absent from the post-removal list, we just take the first survivor.
    if (this.activeItemId === id) {
      const next = before.find((e) => e.id !== id);
      this.activeItemId = next?.id ?? null;
    }
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

    // SWR: only flip to loading if the previous photos are not ok.
    if (this.sections.photos.status !== 'ok') {
      this.sections.photos = { status: 'loading' };
    }

    // Capture the batchController at setMode-call time. A stale setMode straggler
    // that resolves AFTER a new runBatch has taken over must not decrement the new
    // batch's counter — same stale-batch-guard pattern as runBatch.onSettle.
    const setModeBatch = this.batchController;

    // Join the in-flight counter so mode switches share bookkeeping with any active
    // main batch. Without this, a mode switch during an active batch would drop the
    // stripe the moment its own photos settle, even though the main batch is still
    // pending.
    this.inFlightCounter++;
    if (!this.batchInFlight) {
      this.batchInFlight = true;
      this._batchInFlightStartedAt = performance.now();
    }

    this.photosController?.abort();
    const photos = new AbortController();
    this.photosController = photos;
    const signal = AbortSignal.any([
      ...(setModeBatch ? [setModeBatch.signal] : []),
      photos.signal,
      AbortSignal.timeout(5000),
    ]);

    const onSetModeSettle = () => {
      // Same stale-batch guard as runBatch.onSettle.
      if (this.batchController !== setModeBatch) {
        return;
      }
      this.inFlightCounter--;
      if (this.inFlightCounter === 0) {
        this.batchInFlight = false;
      }
    };

    // Promise.resolve().then(...) guarantees that a provider which synchronously
    // throws (not just returns a rejected promise) still lands in the .catch handler.
    // Symmetric with runBatch's defensive wrapper.
    Promise.resolve()
      .then(() => this.providers.photos.run(this.query, this.mode, signal))
      .then((result) => {
        if (setModeBatch !== this.batchController) {
          return;
        }
        // Stale setMode race: if a later setMode aborted OUR photosController before
        // we resolved, a newer photos run is already in flight (or has already written
        // fresh results). Skip the write to avoid clobbering the newer data, but still
        // decrement the counter we incremented above.
        if (signal.aborted) {
          onSetModeSettle();
          return;
        }
        // Providers return `ProviderStatus<unknown>` because each one handles its own
        // concrete DTO type internally. The Sections type uses `EntityItem` — a
        // structural superset that every entity DTO (photo/person/place/tag)
        // satisfies. The cast is sound because runBatch's key iteration and the
        // provider contract ensure we never write a NavigationItem here.
        this.sections.photos = result as ProviderStatus<EntityItem>;
        this.onPhotosSettled();
        this.reconcileCursor();
        onSetModeSettle();
      })
      .catch((error: unknown) => {
        if (setModeBatch !== this.batchController) {
          return;
        }
        if (error instanceof Error && error.name === 'AbortError') {
          if (signal.aborted && signal.reason instanceof DOMException && signal.reason.name === 'TimeoutError') {
            this.sections.photos = { status: 'timeout' };
            this.onPhotosSettled();
          }
          onSetModeSettle();
          return;
        }
        this.sections.photos = {
          status: 'error',
          message: error instanceof Error ? error.message : 'unknown error',
        };
        this.onPhotosSettled();
        onSetModeSettle();
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

  /**
   * Top navigation result — the single most confident nav-item promotion for
   * the current query. Null when the query is empty or when no item's label
   * passes the almost-exact gate. The palette renders this above photos/
   * places/etc. so power users who know the page they want jump straight to
   * it without scrolling past content results.
   *
   * Scans the FULL catalog (filtered by admin + feature flags), not just
   * whatever `sections.navigation` currently holds — cmdk's fuzzy scorer
   * discards items with weak char-overlap even when a compound query contains
   * the literal label word (e.g. `auto-classification` vs `Classification
   * Settings`), and the almost-exact rule is strict enough that scanning the
   * unfiltered catalog is still safe.
   */
  topNavigationMatch = $derived.by<NavigationItem | null>(() => {
    const q = this.query.trim();
    if (q.length === 0) {
      return null;
    }
    const isAdmin = get(user)?.isAdmin ?? false;
    const flags = featureFlagsManager.valueOrUndefined;
    const translate = get(t);
    for (const item of NAVIGATION_ITEMS) {
      if (item.adminOnly && !isAdmin) {
        continue;
      }
      if (item.featureFlag && !flags?.[item.featureFlag]) {
        continue;
      }
      const label = translate(item.labelKey as Translations);
      if (isAlmostExactNavMatch(q, label)) {
        return item;
      }
    }
    return null;
  });

  announcementText = $derived.by(() => {
    const s = this.sections;
    const allSettled =
      s.photos.status !== 'loading' &&
      s.people.status !== 'loading' &&
      s.places.status !== 'loading' &&
      s.tags.status !== 'loading' &&
      s.navigation.status !== 'loading';
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
    if (count(s.navigation) > 0) {
      parts.push(`${count(s.navigation)} pages`);
    }
    return parts.join(', ');
  });

  setQuery(text: string) {
    // In production setQuery only fires through global-search.svelte's $effect, which
    // is only mounted while the palette is open. Calling this method on a closed
    // manager is safe — sections mutate but no side effects escape — but should be
    // considered an implementation detail of the component, not a public entry point.
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
      this.sections = { photos: idle, people: idle, places: idle, tags: idle, navigation: idle };
      this.batchInFlight = false;
      this.inFlightCounter = 0;
      this._batchInFlightStartedAt = 0;
      return;
    }

    // SWR (stale-while-revalidate): only flip sections that are NOT already 'ok' to
    // loading. Preserving ok content across keystrokes fixes the jitter bug where the
    // palette flashed skeletons between every character.
    for (const key of ['photos', 'people', 'places', 'tags'] as const) {
      if (this.sections[key].status !== 'ok') {
        this.sections[key] = { status: 'loading' };
      }
    }
    // Navigation runs synchronously on every keystroke, bypassing the 150ms debounce.
    // It's a pure in-memory scan — no rate-limit or network concern. runBatch does NOT
    // iterate over navigation; its hardcoded tuple is `photos/people/places/tags`.
    this.sections.navigation = this.runNavigationProvider(text);
    // The prior cursor may point at a nav/entity item that no longer exists in the new
    // results. Reconcile synchronously so the highlight doesn't lag the displayed list.
    this.reconcileCursor();

    this.batchInFlight = true;
    // During the 150ms debounce window, `batchInFlight` is true but no request has
    // actually fired. We want the component-side 200ms grace check
    // `now - batchInFlightStartedAt > 200` to be FALSE so the stripe stays hidden.
    // Setting startedAt to +Infinity makes `now - Infinity = -Infinity`, which is not
    // greater than 200. runBatch overwrites this with `performance.now()` at fire-time.
    this._batchInFlightStartedAt = Number.POSITIVE_INFINITY;
    this.debounceTimer = setTimeout(() => this.runBatch(text, this.mode), 150);
  }

  protected runBatch(text: string, mode: SearchMode) {
    this.debounceTimer = null;
    this._batchInFlightStartedAt = performance.now();
    const batch = new AbortController();
    const photosLocal = new AbortController();
    this.batchController = batch;
    this.photosController = photosLocal;

    // Reset the counter — this batch owns the bookkeeping from here on. Stale onSettle
    // calls from prior batches no-op via the check-before-decrement guard below,
    // preventing them from corrupting this batch's counter (which would deadlock
    // batchInFlight at true).
    this.inFlightCounter = 0;

    for (const key of ['photos', 'people', 'places', 'tags'] as const) {
      const provider = this.providers[key];
      if (text.length < provider.minQueryLength) {
        this.sections[key] = idle;
        continue;
      }
      this.inFlightCounter++;
      const controllers = key === 'photos' ? [batch.signal, photosLocal.signal] : [batch.signal];
      const signal = AbortSignal.any([...controllers, AbortSignal.timeout(5000)]);

      const onSettle = () => {
        // Stale-batch guard: if a new batch has taken over the batchController, this
        // settle belongs to a superseded batch and must NOT decrement the new batch's
        // counter.
        if (batch !== this.batchController) {
          return;
        }
        this.inFlightCounter--;
        if (this.inFlightCounter === 0) {
          this.batchInFlight = false;
        }
      };

      // Promise.resolve().then(...) guarantees that a provider which synchronously
      // throws (not just returns a rejected promise) still lands in the .catch handler.
      Promise.resolve()
        .then(() => provider.run(text, mode, signal))
        .then((result) => {
          if (batch !== this.batchController) {
            return;
          }
          // Cast from `ProviderStatus<unknown>` to the entity section's concrete
          // generic. See the comment on EntityItem — every entity DTO structurally
          // satisfies it, and runBatch only iterates entity keys (not navigation).
          this.sections[key] = result as ProviderStatus<EntityItem>;
          if (key === 'photos') {
            this.onPhotosSettled();
          }
          this.reconcileCursor();
          onSettle();
        })
        .catch((error: unknown) => {
          if (batch !== this.batchController) {
            return;
          }
          if (error instanceof Error && error.name === 'AbortError') {
            if (signal.aborted && signal.reason instanceof DOMException && signal.reason.name === 'TimeoutError') {
              this.sections[key] = { status: 'timeout' };
              if (key === 'photos') {
                this.onPhotosSettled();
              }
            }
            onSettle();
            return;
          }
          const message = error instanceof Error ? error.message : 'unknown error';
          this.sections[key] = { status: 'error', message };
          if (key === 'photos') {
            this.onPhotosSettled();
          }
          onSettle();
        });
    }

    if (this.inFlightCounter === 0) {
      // All providers were below minQueryLength — nothing scheduled, flip off.
      this.batchInFlight = false;
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

          console.warn('[cmdk] tag cache > 20k, disabling tag provider for session');
          return { status: 'error', message: 'tag_cache_too_large' };
        }
        if (all.length > 5000) {
          console.warn(`[cmdk] tag cache is large (${all.length} entries)`);
        }
        this.tagsCache = all;
      } catch (error: unknown) {
        if (error instanceof Error && error.name === 'AbortError') {
          throw error;
        }
        return { status: 'error', message: error instanceof Error ? error.message : 'getAllTags failed' };
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
            // withSharedSpaces:true mirrors Gallery's main search page so palette
            // results include shared-space content the user can access.
            const response = await searchSmart(
              { smartSearchDto: { query, size: 5, withSharedSpaces: true } },
              { signal },
            );
            const items = response.assets.items;
            return items.length === 0 ? { status: 'empty' } : { status: 'ok', items, total: items.length };
          }
          // MetadataSearchDto does not have a withSharedSpaces field — shared-space
          // scoping for metadata search would require passing spaceId, which we do not
          // have in the palette. Only smart search includes shared-space content in v1.
          const metadataSearchDto: MetadataSearchDto = {
            size: 5,
            ...(mode === 'metadata' ? { originalFileName: query } : {}),
            ...(mode === 'description' ? { description: query } : {}),
            ...(mode === 'ocr' ? { ocr: query } : {}),
          };
          const response = await searchAssets({ metadataSearchDto }, { signal });
          const items = response.assets.items;
          return items.length === 0 ? { status: 'empty' } : { status: 'ok', items, total: items.length };
        } catch (error: unknown) {
          if (error instanceof Error && error.name === 'AbortError') {
            throw error;
          }
          return { status: 'error', message: error instanceof Error ? error.message : 'unknown error' };
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
        } catch (error: unknown) {
          if (error instanceof Error && error.name === 'AbortError') {
            throw error;
          }
          return { status: 'error', message: error instanceof Error ? error.message : 'unknown error' };
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
        } catch (error: unknown) {
          if (error instanceof Error && error.name === 'AbortError') {
            throw error;
          }
          return { status: 'error', message: error instanceof Error ? error.message : 'unknown error' };
        }
      },
    };

    const tags: Provider = {
      key: 'tags',
      topN: 5,
      minQueryLength: 2,
      run: (query, _mode, signal) => this.runTagsProvider(query, signal),
    };

    // Navigation provider is a stub. Task 10 wires runNavigationProvider into setQuery
    // directly (synchronous, bypassing the 150ms debounce). runBatch iterates only over
    // entity keys, so this stub is never invoked at runtime — it exists to satisfy the
    // Record<keyof Sections, Provider> contract. Regression test in Task 10 pins this.
    const navigationStub: Provider<NavigationItem> = {
      key: 'navigation',
      topN: 5,
      minQueryLength: 2,
      run: () => Promise.resolve({ status: 'empty' as const }),
    };

    return { photos, people, places, tags, navigation: navigationStub };
  }
}

export const globalSearchManager = new GlobalSearchManager();
