# Design: Cmd/Ctrl+K Multi-Entity Search Palette

**Date:** 2026-04-12
**Status:** Draft — two review rounds applied (code-reviewer + review-skill audit + Gallery design-language audit)
**Research:** [`docs/plans/research/2026-04-12-cmdk-search.md`](./research/2026-04-12-cmdk-search.md)
**Scope:** Web v1. Desktop palette with preview pane; mobile gets the palette without preview.

---

## Goal

Replace Gallery's inline header search bar (desktop) with a keyboard-first **global palette** opened via `Ctrl+K` / `Cmd+K`. The palette returns **mixed entity results** — photos, people, places, tags — in a single view with a right-hand preview pane on wide viewports, streaming results per-section as each backend responds. `/search` remains the depth view for overflow on the Photos section.

## Non-goals (v1)

- Albums and Spaces sections — deferred to v1.1
- **SUGGESTED empty-state section** seeded from `getExploreData()` — deferred to v1.1. v1 ships only RECENT as the empty-state content; when RECENT is empty the palette shows the helper row directly.
- **Static map tile in place preview** — deferred to v1.1 pending a decision on tile source. v1's place preview shows place name + country + recent-photos strip filtered by city.
- **Add to album quick action in photo preview** — deferred to v1.1. Needs the album picker modal which is out of scope.
- **Ctrl+Enter / Cmd+Enter "open in new tab"** — unit-testable coverage isn't possible through `Command.Item.onSelect` (no modifier state exposed). Plan defers assertion to E2E — acceptable but noted.
- Prefix scoping (`@person`, `#tag`, `/album`, `>command`) — deferred to v1.2
- Frecency ranking across sections — deferred
- Bridging `@immich/ui`'s `CommandPaletteDefaultProvider` action registry — deferred to v1.5
- Context-aware page suggestions (Linear-style) — deferred to v1.5
- Mobile preview pane — palette opens on mobile tap but no preview below ~1024 px

---

## User-facing behavior

### Opening

- **`Ctrl+K` / `Cmd+K`** toggles the palette globally. When focus is inside a text input, textarea, or contenteditable, the shortcut still opens the palette — power users expect `Ctrl+K` to be universally available.
- **Desktop trigger (≥ 640 px).** The header's inline `<SearchBar grayTheme />` (`navigation-bar.svelte:86–89`) is replaced by a compact **"Search… ⌘K"** button. The existing SearchBar slot spans `hidden w-full max-w-5xl flex-1 tall:ps-0 sm:block` — the new trigger is narrower, which **will visibly reflow the navbar layout**; we keep the trigger left-anchored in the same slot and let the right-side icons float closer, rather than introducing a spacer. Worth showing in PR review.
- **Mobile entry (< 640 px).** The mobile magnify `<IconButton>` at `navigation-bar.svelte:93–105` currently navigates directly to `Route.search()` via an `href`. We **keep the href-based mobile button unchanged** and mount `<GlobalSearchTrigger />` only in the `sm:block` desktop slot. Mobile users keep their direct link to the full `/search` page; the palette is reachable on mobile by following that link and using the existing inline search there. Rationale: the palette without a preview pane offers mobile users no value over the existing full-page search, and stealing the direct link would be a regression.
- Both paths are gated on the existing `featureFlagsManager.value.search` flag — when search is disabled server-side, the trigger hides and the global `Ctrl+K` binding is a no-op.
- **ML health probe.** On first palette open after login, the client fires one `getServerMlHealth()` call (new endpoint — see [ML health](#ml-health-and-banner)) to seed the banner state. Cached for the palette session.

### Empty state (no query typed)

Two sections, rendered in this priority:

1. **RECENT** — up to 8 entries from the `localStorage`-backed store `cmdk.recent`. Each entry is either a text query (written when a query is submitted or re-run) or an entity activation (photo / person / place / tag). Entries are mixed, sorted by `lastUsed` desc, displayed top 8 of a max 20. RECENT rows **reuse the same row components** as query-time results — a photo entry in RECENT looks identical to a photo entry in a result section.
2. **SUGGESTED** — _deferred to v1.1_ (see § Non-goals). Would have been seeded from `getExploreData()` showing place rows from the largest city buckets. v1 shows the helper row directly when RECENT is empty.

**Helper-row fall-through.** When RECENT is empty **and** SUGGESTED is also empty (tiny library, no explore data), show a single helper row: **"Start typing — photos, people, places, tags."** When RECENT has entries but SUGGESTED would be empty, show RECENT alone — no helper row.

**Why one RECENT section, not two.** Gallery's existing `savedSearchTerms` store (`web/src/lib/stores/search.svelte.ts`) is in-memory Svelte `$state`, **not persisted** — it clears on reload and on logout. Writing text queries into `cmdk.recent` alongside entity activations replaces it with something durable.

**Auto-highlight on open.** When the palette opens, the cursor is placed on the **first visible row** so the preview pane has content to render. On a cold open with no RECENT and no SUGGESTED, the helper row is highlighted but the preview pane shows a neutral "nothing to preview yet" state (a faded Gallery logo is fine).

### Querying

1. **Debounce 150 ms.** The previous pending timer is cancelled on new input.
2. **Input max length 256 characters.** Enforced via `<input maxlength="256">` — prevents pathological pastes, protects the tag-filter hot path.
3. **`searchQueryType` sanity check.** On load, if the stored mode value isn't one of `'smart' | 'metadata' | 'description' | 'ocr'`, fall back to `'smart'` and overwrite.
4. **Query length < 2** — only the Photos provider fires. People/Places/Tags providers require ≥ 2 chars (pg_trgm trigram similarity below 2 chars almost never clears the 0.5 threshold in `person.repository.ts:getByName`, and place/tag name matches are similarly noisy).
5. **On debounce fire**, abort the previous batch's `AbortController`, create a new one, and fan out to the enabled providers in parallel. Each provider gets its own signal composed of `AbortSignal.any([batch.signal, AbortSignal.timeout(5000)])`. (`AbortSignal.any` ships in Chrome 116+/Firefox 124+/Safari 17.4+ — adequate for Gallery's target.)
6. **Skeleton rows** (3 per enabled section) render immediately.
7. **Results replace skeletons** as each provider resolves.
8. **Cancellation source matters.** Silent abort (new batch) → stale result discarded. Timeout abort (5 s) → `{ status: 'timeout' }` with a "Search is slow — results may be incomplete" row.
9. **"No results" empty state** renders only when _every_ enabled provider has resolved (or timed out / errored) with zero items — never mid-stream.

### Navigating

- `ArrowDown` / `ArrowUp` move a single cursor across all sections, wrapping at the ends.
- `Ctrl+N` / `Ctrl+P` — same as arrow keys (Bits UI default, free).
- `Ctrl+J` and the VIM `Ctrl+K` aliases are **disabled** so `Ctrl+K` only ever means "toggle palette."
- `Home` / `End` jump to first / last item.
- Cursor is tracked via `aria-activedescendant` on the combobox input; DOM focus never leaves the input.
- Per-row hover moves the cursor but does not steal focus.
- After an in-place re-run (clicking a RECENT text entry), the cursor moves to the first result row.

**Cursor identity on out-of-order section resolution.** Typical timing: People/Places/Tags resolve in < 100 ms; Photos (smart search) resolves in 200–600 ms. If the user's cursor has moved to "People row 2" before Photos resolves and Photos then renders 5 rows _above_ People, the cursor **stays on the same item** — identity-tracked by `item.id`, not by positional index. If the tracked id disappears from results (e.g., after a new keystroke), the cursor falls back to the first row of the current top section.

### Activating

`Enter` activates the highlighted row. Behavior by type:

| Row type                 | Action on Enter                                                                    |
| ------------------------ | ---------------------------------------------------------------------------------- |
| Photo                    | Opens the asset viewer at that asset (reuses existing viewer route)                |
| Person                   | Navigates to `/people/:personId`                                                   |
| Place                    | Navigates to `/map` with the coordinate pre-selected                               |
| Tag                      | Navigates to `/search` via `Route.search({ query: '', tagIds: [tag.id] })`         |
| "See all N photos →"     | Navigates to `/search` via `Route.search(buildSearchPayloadForMode(query, mode))`  |
| RECENT text query        | Re-runs the query in-place (populates input, triggers fan-out); palette stays open |
| RECENT entity (any type) | Same as the underlying type                                                        |

`Ctrl+Enter` / `Cmd+Enter` opens the target in a new tab, skipped for re-runs.

**Enter-vs-late-result race.** The activated item is captured by reference at `Enter` time. If a later provider result has already replaced the item in `sections[*]` before the navigation runs, the capture is still valid and the navigation still happens against the captured item. Only if the cursor-tracked id has been lost entirely (e.g., `Enter` fires after a new keystroke and a fresh batch is mid-flight) does `Enter` no-op and the cursor falls back to the first row of the new results.

**Only Photos has a "See all" overflow row.** People/Places/Tags cap at top N and don't offer overflow — `/people` is a full face browser with no query-scoped view, `/map` doesn't support place-name search, and `/tags` doesn't support substring filtering in the URL. If a user needs deeper browse, they use those dedicated pages directly.

Activating any row writes a `RecentEntry` into `cmdk.recent` (trimmed to 20).

### Closing

- **`Esc` first press:** clears the input if non-empty; **second press:** closes the palette (APG two-stage behavior).
- `Ctrl+K` while open: closes.
- Click outside the modal: closes.
- **`close()` aborts the batch controller AND any in-flight preview controller**, clears the debounce timer, **resets `sections[*]` to `{ status: 'idle' }`**, clears the active item, sets `open = false`. On re-open the palette starts from a clean slate — no residual skeletons or stale data from the previous session.
- After close, DOM focus returns to the element that was focused before the palette opened (standard modal focus restore, provided by Bits UI).

### Search mode selector

The palette footer shows a segmented control: **Smart · Filename · Description · OCR**.

- Default: **Smart**.
- Persisted in `localStorage` under the existing key **`searchQueryType`** (used today by `search-bar.svelte:184/196` and `SearchFilterModal.svelte:40/44`). Valid values are `'smart' | 'metadata' | 'description' | 'ocr'` — note that the UI label "Filename" maps to the stored value `'metadata'`. We preserve this mapping so the setting carries across from the old header bar without a migration.
- `Ctrl+/` cycles forward through modes.
- **Switching mode** aborts the in-flight Photos provider call (silent abort) and re-runs Photos against the current query with the new mode. People/Places/Tags keep their current results. **If a debounce is pending** when mode changes, the debounce timer restarts with the new mode — the pending batch will use the new mode consistently across all providers when it fires.
- Mode affects the **Photos section only**. Smart → `searchSmart`; Filename / Description / OCR → `searchAssets` with appropriate DTO flags (reuses the payload builder from `search-bar.svelte`).

---

## Architecture

### New files

```
web/src/lib/components/global-search/
  global-search.svelte                 — root palette (Bits UI Command.Dialog wrapper)
  global-search-trigger.svelte         — header button that opens the palette
  global-search-section.svelte         — one section (heading + items + skeletons + "See all")
  global-search-preview.svelte         — right-hand preview pane (type-dispatched)
  global-search-footer.svelte          — mode selector + keyboard hints
  rows/
    photo-row.svelte
    person-row.svelte
    place-row.svelte
    tag-row.svelte
  previews/
    photo-preview.svelte
    person-preview.svelte
    place-preview.svelte
    tag-preview.svelte
  __tests__/
    global-search.spec.ts
    photo-row.spec.ts + one spec per row component
    photo-preview.spec.ts + one spec per preview component

web/src/lib/services/
  global-search.service.svelte.ts      — GlobalSearchService singleton
  global-search.service.spec.ts        — service unit tests (next to service, per Gallery convention)
  global-search-provider-tags.spec.ts  — tag provider + client-filter + cache behavior

web/src/lib/stores/
  cmdk-recent.ts
  cmdk-recent.spec.ts

e2e/src/specs/web/global-search.e2e-spec.ts
```

`GlobalSearchService` exposes `open()`, `close()`, `toggle()`, `setQuery(text)`, `setMode(mode)`, `activate(item)`. Private: `runProviders()`, `abortCurrentBatch()`, `probeMlHealth()`, `onStorageEvent()`. Rune-based `$state`: `open`, `query`, `mode`, `sections`, `activeItemId`, `mlHealthy`, `tagsCache`, `tagsCacheLoadedAt`.

### Modified files

- **`web/package.json`** — add `bits-ui` as a direct dependency (pin to the version `@immich/ui` uses, currently `^2.15.7`). It exists in the lockfile transitively but is not hoisted to `web/node_modules` under pnpm's strict hoisting, so `import { Command } from 'bits-ui'` does not resolve without an explicit entry.
- **`web/src/routes/+layout.svelte`** — register the global `Ctrl+K` shortcut on `<svelte:document>` (matches the `Ctrl+Shift+M` pattern at lines 234–238), mount `<GlobalSearch />` once at the root, and **re-register `Ctrl+Shift+K`** (currently owned by `search-bar.svelte:247`) to open `SearchFilterModal`. Without that re-register, removing the header `<SearchBar />` would silently delete the `Ctrl+Shift+K` binding.
- **`web/src/lib/components/shared-components/navigation-bar/navigation-bar.svelte`** — replace the desktop `<SearchBar grayTheme />` at line 88 with `<GlobalSearchTrigger />`. **Leave the mobile `<IconButton>` at lines 93–105 unchanged** — mobile users keep their direct `href={Route.search()}` link. Document the navbar-reflow expectation.
- **`web/src/lib/modals/ShortcutsModal.svelte`** — update the `Ctrl+K` row to "Open global search," add a `Ctrl+/` row for "Cycle search mode." `Ctrl+Shift+K` stays as "Open search filters."
- **`web/src/lib/components/shared-components/search-bar/search-bar.svelte`** — **delete the document-level `Ctrl+K` binding at line 246** (`{ ctrl: true, key: 'k' } → input?.select()`). The rest of the file is unchanged — it still backs the `/search` depth-view page's own input. Without this deletion, the file's `<svelte:document>` handler would fight the global palette binding whenever the `/search` route is mounted.
- **`web/src/lib/stores/search.svelte.ts`** — `savedSearchTerms` is left as-is. The palette does not depend on it.
- **`server/src/repositories/machine-learning.repository.ts`** — **targeted** AbortSignal fix in `predict()`. Called by five ML tasks (`detectFaces` :223, `encodeImage` :233, `encodeText` :239, `ocr` :250, `detectPets` :260). Thread `{ timeoutMs?: number }` through `predict(payload, config, { timeoutMs })`, default to no timeout (existing behavior), set `timeoutMs: 15_000` only at `encodeText`. Unit tests verify `encodeText` aborts on timeout, the other four callers don't, **and that a second caller (e.g. test-only) can pass a different `timeoutMs` to prove the option is truly per-call, not an `encodeText`-only hardcode**.
- **`server/src/controllers/server.controller.ts`** (+ `server/src/services/server.service.ts` + `server/src/dtos/server.dto.ts`) — add `GET /api/server/ml-health` returning `{ smartSearchHealthy: boolean }`. See [ML health](#ml-health-and-banner) for auth and caching details. OpenAPI + Dart + TypeScript SDK regen per `feedback_openapi_dart_and_sql`. (Note: controller prefix is `'server'`, not `'server-info'` — the plan corrected this after codebase verification.)

### Libraries

- **Bits UI `Command`** — already available transitively via `@immich/ui`. Provides `Command.Root`, `Input`, `List`, `Viewport`, `Group`, `GroupHeading`, `GroupItems`, `Item`, `Empty`, `Loading`, `Dialog`, with ARIA combobox wiring. Svelte 5 native.
- No new server-side libraries.

---

## Data flow

### Provider contract

```ts
type ProviderStatus<T> =
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'ok'; items: T[]; total: number }
  | { status: 'timeout' }
  | { status: 'error'; message: string }
  | { status: 'empty' };

interface Provider<T> {
  key: 'photos' | 'people' | 'places' | 'tags';
  run(query: string, mode: SearchMode, signal: AbortSignal): Promise<ProviderStatus<T>>;
  topN: number;
  minQueryLength: number;
}
```

### The four v1 providers

| Provider | SDK call(s)                                         | topN | minLen | Notes                                                                      |
| -------- | --------------------------------------------------- | ---- | ------ | -------------------------------------------------------------------------- |
| photos   | `searchSmart` (smart) or `searchAssets` (non-smart) | 5    | 1      | DTO shape mirrors what `search-bar.svelte` currently builds per mode       |
| people   | `searchPerson({ name, withHidden: false })`         | 5    | 2      | Returns user-owned faces only (inherited quirk)                            |
| places   | `searchPlaces({ name })`                            | 3    | 2      | Global geocoder lookup, not user-scoped (inherited quirk)                  |
| tags     | Client-side filter over cached `getAllTags()`       | 5    | 2      | See "Tag provider" below for scope, cache semantics, and the 20 k hard cap |

**Tag provider.** `getTagSuggestions` has no `name` parameter, so on the first keystroke the service calls `getAllTags()` once, caches the result for the palette session, and filters client-side by case-insensitive substring. Scope: `getAllTags()` returns tags the caller owns (does **not** include shared-space-only tags); this mirrors how Gallery's filter-panel tag UI behaves today. **Hard cap:** if `getAllTags()` returns > 20 000 entries, the tag provider disables itself for the session and logs a console warning — the tag section renders an "Too many tags to search in-browser — use the Tags page" helper row. Warning threshold: 5 000 (log only). Above 20 000 the UX degrades to uselessness anyway; a follow-up would add a server-side `name` parameter.

**Cross-tab tag cache invalidation.** The service listens for `window` `storage` events on a known key (`cmdk.tags.version`, bumped by the tag management pages when a tag is created, edited, or deleted). On invalidation, the cache is cleared; the next keystroke re-fetches. This is best-effort — Gallery's current tag pages don't write that key yet, so v1 ships with cache invalidation on palette close/reopen as the baseline, and the follow-up for tag pages bumps the version key.

### `GlobalSearchService.setQuery(text)` algorithm

```
on setQuery(text):
  clear pending debounce timer
  if text === current query: return
  current query = text
  abort current batch (if any)
  if text.trim() === '':
    sections[*] = { status: 'idle' }
    render empty state (RECENT if non-empty, else helper row)
    return
  sections[*] = { status: 'loading' }
  start debounce timer (150 ms)

on debounce timer fires:
  batch = new AbortController()
  for each provider p:
    if text.length < p.minQueryLength:
      sections[p.key] = { status: 'idle' }
      continue
    signal = AbortSignal.any([batch.signal, AbortSignal.timeout(5000)])
    p.run(text, mode, signal)
      .then(result => sections[p.key] = result)
      .catch(err => {
        if err.name === 'AbortError':
          if signal.reason === 'TimeoutError': sections[p.key] = { status: 'timeout' }
          // else: batch was superseded, no-op
        else:
          sections[p.key] = { status: 'error', message: err.message }
      })

on setMode(newMode):
  if newMode === mode: return
  mode = newMode
  persist to localStorage['searchQueryType']
  if debounce timer pending:
    // restart the debounce; on fire the new batch uses the new mode
    clear debounce; start new 150 ms timer
  else if sections.photos.status in { loading, ok, empty, error, timeout }:
    abort only the in-flight photos call (if any)
    signal = new composed signal for photos only
    photosProvider.run(query, mode, signal).then(...).catch(...)
    // people/places/tags keep their current results

on close():
  clear pending debounce
  abort current batch controller
  abort current preview controller (if any)
  sections[*] = { status: 'idle' }
  clear active item
  open = false
```

**Socket.IO isolation.** The service does not subscribe to Socket.IO events. Real-time timeline updates, notifications, and background job events have no effect on palette state. Other subsystems may still react to Socket.IO events; this is intentional isolation.

### ML health and banner

Because `MachineLearningRepository.isHealthy()` returns `true` unconditionally when `availabilityChecks.enabled` is `false` (`machine-learning.repository.ts:178–184`), reading the server's `healthyMap` is not a reliable signal. The browser also can't probe the ML container directly — it lives on the internal Docker network. So we add one small server endpoint:

- **`GET /api/server/ml-health`** — new authenticated route on `server-info` controller. Handler performs an on-demand `fetch('/ping', { signal: AbortSignal.timeout(2000) })` against the first configured ML URL. Success criterion: HTTP 2xx **and** response content-type is `application/json` (protects against a reverse proxy returning an HTML error page with 200). Returns `{ smartSearchHealthy: boolean }`.
- **Auth + rate limiting.** The endpoint requires a valid session (standard `AuthGuard`) — unauthenticated callers would otherwise have a free way to probe the internal ML URL on every request. Server-side caches the probe result for **30 seconds** in-process, with a single-flight guard so concurrent callers share one in-flight probe. This bounds the amplification factor of an authenticated attacker to 1 request per 30 s regardless of client hits.
- **Client.** On first palette open per session, call `getServerMlHealth()` once, cache for the palette session.
- **Retroactive promotion.** The banner is also shown when the Photos provider (mode = Smart) returns `timeout` or `error` during the session, regardless of the initial probe. This covers mid-session degradation. Once set, the banner persists across mode switches within the session — switching back to Smart still shows the banner.
- **Non-Smart failures don't affect the banner.** A Photos `timeout` or `error` in mode = Filename/Description/OCR renders a generic section-level error and does not promote the banner (the banner is Smart-specific messaging).
- **Rendering.** When `mlHealthy === false` and `mode === smart`, the Photos section renders a persistent banner: **"Smart search is unavailable — try Filename mode"** with a button that calls `setMode('metadata')`. Switching to any non-Smart mode hides the banner visually; the `mlHealthy` flag stays false so switching back to Smart re-shows it.

### Preview pane

The preview pane is a pure function of the highlighted row. For each entity type:

- **Photo** — thumbnail via `createUrl()` (per `feedback_filter_thumbnail_createUrl` — bare paths get intercepted by SvelteKit) at full pane width (~240×180 `object-cover`). Below: filename in GoogleSans 14/500, then a 2-row metadata block in GoogleSans 12/410 / `text-gray-500 dark:text-gray-400`: "March 2024 · Santa Cruz, CA" and "Canon R5 · f/2.8 · 1/500". Below: two ghost-style pill buttons ("Open" / "Add to album").
- **Person** — face crop via `createUrl()` on `faceAssetId` at 120×120 rounded-full, centered. Name in GoogleSans 18/600, face count in 12/410 subtle. Below: 4-wide 48×48 strip of recent photos from `searchAssets({ personIds: [person.id], size: 4 })`.
- **Place** — static map tile at 240×160 with a 1 px `border-gray-200 dark:border-gray-700` border (reuses existing Gallery map tile source). Place name in GoogleSans 16/600, country in 12/410 subtle. Below: a 4-wide 48×48 recent-photos strip from `searchAssets({ latitude, longitude, size: 4 })`. **When the strip comes back empty** (the global geocoder returned a place the user has zero photos in — see [inherited quirks](#known-quirks-inherited-from-v0)), the preview shows "No photos here yet" in place of the strip and hides the photo count, rather than rendering an empty row of gray boxes.
- **Tag** — a 2×3 grid of 72×72 thumbnails with 8 px gaps from `searchAssets({ tagIds: [tag.id], size: 6 })`. Tag name in GoogleSans 16/600 with a 8×8 rounded color dot prefix (tag's stored color). Empty state same as Place — "No photos tagged yet" in place of the grid.

**Preview staleness handling.** Each preview has its own `AbortController`, separate from the batch controller. When the active item changes or the query changes or the palette closes, the current preview's controller is aborted and a new one is created (if still relevant). A late-arriving response for a stale item is discarded via a generation counter check. The preview render is deferred **300 ms after cursor stop** — quickly cursoring past a row doesn't fire content fetches. **Below 1024 px viewport the preview pane is hidden entirely** and no preview fetches happen (matches the dimensions table below).

**No-highlight on open.** When the palette opens with nothing highlighted (empty RECENT + empty SUGGESTED + helper-row state), the preview pane renders a neutral "nothing to preview" state: a faded Gallery logo centered in the pane, no metadata, no actions. Auto-highlight (described under [Empty state](#empty-state-no-query-typed)) avoids this state in most real sessions.

### `cmdk.recent` localStorage shape

```ts
// key: 'cmdk.recent'
type RecentEntry =
  | { kind: 'query'; id: string; text: string; mode: SearchMode; lastUsed: number }
  | { kind: 'photo'; id: `photo:${string}`; assetId: string; label: string; lastUsed: number }
  | {
      kind: 'person';
      id: `person:${string}`;
      personId: string;
      label: string;
      thumbnailAssetId?: string;
      lastUsed: number;
    }
  | { kind: 'place'; id: string; latitude: number; longitude: number; label: string; lastUsed: number }
  | { kind: 'tag'; id: `tag:${string}`; tagId: string; label: string; lastUsed: number };
```

- **Photo `id` is `photo:${assetId}`** — photo rows render their thumbnail from `assetId` directly; the previously-listed separate `thumbnailAssetId` field was redundant and is removed.
- **Place `id`** is computed as `` `place:${lat.toFixed(4)}:${lng.toFixed(4)}` `` — fixed 4-decimal precision (~11 m resolution) to avoid floating-point drift creating duplicate keys for the same user-perceived place across queries.
- **Max 20 entries stored, top 8 displayed.** `id` is the stable dedup key; activating the same item twice updates `lastUsed` in place.

**Quota and corruption handling.**

- Read: try-catch around `JSON.parse(localStorage.getItem(…))`. On `SyntaxError` or `null`, treat as empty `[]`, log once.
- Write: try-catch around `setItem`. On `QuotaExceededError`, **keep the previous in-memory copy** (do not zero it out) and log once. The store silently fails to persist the new entry but the session's existing RECENT stays intact.
- localStorage unavailable entirely (e.g., privacy-mode browser that throws on any access): the store returns `[]` and every write is a no-op. Logged once per session.

**Two-tab concurrent writes.** `cmdk.recent` uses read-modify-write with no locking. If two tabs activate entries simultaneously, the second write wins and the first may be lost. We accept this as a trivial data-loss case — the entries are hints, not state.

---

## Accessibility

- Input: `role="combobox"`, `aria-expanded="true"` when open, `aria-controls={listboxId}`, `aria-autocomplete="list"`, `aria-activedescendant={activeItemId}`.
- List: `role="listbox"`, `aria-label={t('search_results')}`.
- Sections: `role="group"`, `aria-labelledby={headingId}`.
- Items: `role="option"`, `aria-selected={isActive}`, stable `id` for `aria-activedescendant`.
- The outer modal is a `Command.Dialog` — `role="dialog"`, `aria-modal="true"`, `aria-label={t('global_search')}` — without replacing the combobox role on the input.
- Focus trap is provided by Bits UI; focus returns to the opener on close.
- Skeleton rows are `aria-hidden="true"` with no `option` role.
- **Live region.** An `aria-live="polite"` region announces **only the final aggregate** once all enabled providers have settled per query — "342 photos, 5 people, 3 places, 2 tags." We deliberately do not announce per-section as results stream in; rapid typers would produce an unlistenable torrent. The live-region announcement **still fires under `prefers-reduced-motion`** — motion and screen-reader announcements are independent concerns.
- **New accessibility primitive.** This feature introduces `prefers-reduced-motion` handling to Gallery for the first time — there is no existing precedent elsewhere in the codebase. Implementation uses Tailwind's `motion-reduce:` utility classes or a CSS-level media query wrapper. Worth calling out in PR review so reviewers know it's a deliberate new convention.

---

## Visual identity and motion

**Aesthetic direction: cool, restrained, editorial.** Gallery's actual palette is neutral and cool in both light and dark modes (hue 0 or 271 in OKLCH — see `@immich/ui/dist/theme/default.css`). The palette should _lean into_ that cool restraint rather than invent a warm editorial tone that doesn't exist anywhere else in the app. Quiet, keyboard-first, typographically precise.

### Typography

Uses Gallery's already-loaded fonts — **GoogleSans** (variable, weight range 410–900) for all UI and **GoogleSansCode** for monospace accents. Both are defined in `app.css:87–101` and exposed as `--font-sans`. GoogleSansCode has real precedent in Gallery UI already (e.g. `breadcrumbs.svelte:54`, `tree.svelte:45`, `ApiKeySecretModal.svelte:18`, `geolocation/+page.svelte:141–146`), so using it for the `⌘K` chip and mode labels is consistent with existing patterns.

GoogleSans's minimum weight is **410**, not 400 — that's the "regular" baseline in Gallery. Numbers below are real variable-font weights.

| Element                       | Font           | Size  | Weight | Color / treatment                   |
| ----------------------------- | -------------- | ----- | ------ | ----------------------------------- |
| Section heading ("PHOTOS")    | GoogleSans     | 11 px | 600    | uppercase, `tracking-wider`, subtle |
| Row title                     | GoogleSans     | 14 px | 500    | default foreground                  |
| Row subtitle                  | GoogleSans     | 12 px | 410    | `text-gray-500 dark:text-gray-400`  |
| "See all N photos →"          | GoogleSans     | 12 px | 500    | primary accent for chevron          |
| Preview title                 | GoogleSans     | 16 px | 600    | Person preview promotes to 18/600   |
| Preview metadata              | GoogleSans     | 12 px | 410    | `text-gray-500 dark:text-gray-400`  |
| Mode label ("Smart · …")      | GoogleSansCode | 11 px | 500    | uppercase, tabular                  |
| Keybind chip (`⌘K`, `Ctrl+/`) | GoogleSansCode | 11 px | 500    | `bg-subtle/60` pill, 1 px border    |
| Helper / empty rows           | GoogleSans     | 13 px | 410    | subtle                              |

The `tracking-wider` uppercase heading pattern matches existing Gallery eyebrows at `space-activity-feed.svelte:157`, `spaces-table.svelte:90`, and `trim-tool.svelte:65` — the palette's section headings will feel native. **No em-dash on section headings** — Gallery headings are plain labels, and a novel em-dash ornament in this one surface would feel foreign. Plain "PHOTOS", "PEOPLE", "PLACES", "TAGS".

### Dimensions

| Viewport    | Palette width                                                    | Preview pane | Notes                 |
| ----------- | ---------------------------------------------------------------- | ------------ | --------------------- |
| ≥ 1024 px   | **767 px** (Modal `size="large"` → `md:max-w-(--breakpoint-md)`) | 280 px right | Two-pane layout       |
| 768–1023 px | **767 px** (same Modal constraint, preview hidden)               | hidden       | List-only             |
| < 768 px    | full − 16 px margin (Modal's native responsive width)            | hidden       | Mobile / small tablet |

Snapping to the @immich/ui Modal size tokens avoids introducing a bespoke width convention — the palette is one size up from `SearchFilterModal` and looks like a family member.

Inside the palette:

- Row height **52 px** — thumbnails breathe, 5 rows per section fit on a 14″ screen without scroll
- Row padding **`px-3 py-2`** (matches Gallery filter-panel row padding at `people-filter.svelte:92`)
- Row radius **`rounded-lg`** (matches filter-panel rows)
- Section gap **16 px**
- Preview pane padding **20 px**
- **Palette shell radius: `rounded-2xl`** — matches @immich/ui Modal's `sm:rounded-2xl` at `Modal.svelte:50`. Not `rounded-md`.
- Thumbnails: photos 40×40 `rounded-md` (6 px), people 40×40 `rounded-full`, places and tags icon-only 32×32
- Divider between list and preview: single 1 px hairline `border-gray-200 dark:border-gray-700`, no shadow

### Color

**95 % neutral, 5 % accent.** Dominant neutrals with a single sharp accent.

- **Palette chrome:** `bg-light dark:bg-subtle`. This matches @immich/ui's Modal surface (`Modal.svelte:50`) — not `dark:bg-dark`, which resolves to a near-white color in dark mode (Gallery's dark token is text-colored, not surface-colored).
- **Hairline border:** `border-gray-200 dark:border-gray-700`.
- **Elevation:** inherits from `@immich/ui` Modal (`shadow-sm shadow-primary/20` per `Modal.svelte:50`). Earlier draft proposed `shadow-2xl`; verification showed Modal ships its own lighter shadow, and we accept the inherited value rather than override to keep the palette consistent with every other modal in Gallery.
- **Backdrop:** `bg-black/30` — **no `backdrop-blur`**. This matches `@immich/ui` Modal's default overlay (`bg-black/30`, zero blur) at `Modal.svelte:118`. Every other Gallery modal uses this treatment; a blurred backdrop here would read as foreign.
- **Primary accent token:** `primary` (the `@immich/ui` token, not the fork-legacy `immich-primary`). Grep confirms 163 hits for `bg-primary`/`text-primary`/`border-primary` in Gallery code. The "faint tint + accent text" pattern is established at `active-filters-bar.svelte:102`, which uses `bg-primary/10 text-primary` for selected chips — the active row adopts the same mechanic.

Every color goes through Gallery's `@immich/ui` tokens with `dark:` prefixes per `feedback_match_gallery_design`. No hardcoded hex.

### Motion

**All motion drops to instant when `prefers-reduced-motion: reduce` matches.** No exceptions. (Screen-reader `aria-live` announcements still fire — they're not motion.)

**What's inherited vs. what's specified.** Palette enter/exit animation is inherited from `@immich/ui` Modal (which wraps bits-ui Dialog) — we do not override these. The values in the table below for Palette enter/exit are aspirational targets; if Modal's defaults match reasonably they stand, otherwise the palette uses whatever Modal ships and we annotate any divergence during the visual QA pass (Task 21). Specific durations we **do** actively set: active-row tint (`transition-colors duration-[80ms] ease-out`), mode selector pill slide (`transition-colors duration-[180ms] ease-out`), and preview swap cross-fade. Skeleton pulse is inherited from Gallery's `Skeleton.svelte` element directly (2 s cubic-bezier(0.4, 0, 0.6, 1) per `Skeleton.svelte:45`).

| Moment                              | Duration | Easing                                  | Detail                                                                                  |
| ----------------------------------- | -------- | --------------------------------------- | --------------------------------------------------------------------------------------- |
| Palette enter                       | 180 ms   | `ease-out` (Tailwind default)           | Backdrop fades in; palette scales 0.98 → 1.0 + fades in + 4 px translate-from-top       |
| Palette exit                        | 120 ms   | `ease-out`                              | Faster out than in — dismissal feels snappy                                             |
| Section heading + rows on resolve   | 100 ms   | linear                                  | Stagger: 20 ms per row index; heading leads by 40 ms                                    |
| Skeleton → real row                 | 120 ms   | `ease-out`                              | Cross-fade in place; no layout jump                                                     |
| Active row highlight                | 80 ms    | `ease-out`                              | Background tint (`bg-primary/10`) fades in                                              |
| Preview swap (type change)          | 120 ms   | `ease-out`                              | Full content cross-fade                                                                 |
| Preview swap (same type, diff item) | 60 ms    | `ease-out`                              | Opacity blink 0.85 → 1.0                                                                |
| Mode selector pill                  | 180 ms   | `ease-out`                              | Selected pill slides between positions                                                  |
| Skeleton pulse                      | 2000 ms  | `cubic-bezier(0.4, 0, 0.6, 1)` infinite | **Matches Gallery's existing `Skeleton.svelte:45` exactly** — opacity pulse, no shimmer |

Durations stick to Gallery's existing 100/120/150/180/200 ms vocab (confirmed by grep). No custom `cubic-bezier` in Tailwind classes — the `ease-out` default is what Gallery uses everywhere.

### Atmosphere and detail

Small touches that signal the palette cares about detail without diverging from Gallery's design language:

- **Single hairline divider** between list and preview — not a shadow, not a gap. One surface, split.
- **`⌘K` trigger chip** (in the header trigger button): GoogleSansCode, `bg-subtle/60`, 1 px `border-gray-200 dark:border-gray-700`, `rounded-sm`. Clickable-but-not-screaming.
- **Right-aligned chevron** on "See all N photos →" with `tabular-nums` so counts align vertically across sections.
- **Active row highlight.** `bg-primary/10` tint on the active row, full width, `rounded-lg`. **No left border, no scale, no shadow, no glow.** This matches how `active-filters-bar.svelte` renders its selected chip and will feel native. A 3 px accent left border (as proposed in an earlier draft) is not used — it would be a novel visual mechanic with no precedent elsewhere in Gallery.

**Not included in v1:** grain/noise texture (no existing Gallery surface uses one; at 2 % opacity over pure neutrals it would either be invisible or read as a render bug), em-dashes on headings (novel ornament), bespoke warm-tint chrome (Gallery is cool-neutral). These were in an earlier draft but removed after the design-language audit.

### Empty-state voice

Replace the generic placeholder with something with a bit of character:

> **"Start typing — photos, people, places, tags."**

Tiny nod to the entity set; still short enough to fit on one line.

---

## Error handling

| Failure                                                 | Behavior                                                                                          |
| ------------------------------------------------------- | ------------------------------------------------------------------------------------------------- |
| One provider 5xx / network error                        | Section shows "Couldn't load [entity] — retry" row; other sections unaffected                     |
| One provider times out (5 s client cap)                 | Section shows "Search is slow — results may be incomplete"; skeleton hides                        |
| All enabled providers error                             | Palette shows "Something went wrong" with a retry button                                          |
| ML unhealthy at palette open (Smart mode)               | Banner: "Smart search is unavailable — try Filename mode" with quick-switch button                |
| ML becomes unhealthy mid-session (Smart, any failure)   | First timeout/error from Photos promotes the banner; persists across mode switches within session |
| Photos timeout in non-Smart mode                        | Generic timeout row; banner stays hidden (Smart-specific messaging)                               |
| `ml-health` endpoint returns non-JSON content-type      | Treated as unhealthy; banner shown; logged                                                        |
| User has empty `cmdk.recent`                            | Skip RECENT; fall through to SUGGESTED                                                            |
| `getExploreData()` returns zero cities                  | Skip SUGGESTED; if RECENT is also empty, show a single "Start typing — …" helper row              |
| RECENT non-empty, SUGGESTED empty                       | Show RECENT alone; no helper row                                                                  |
| `localStorage` unavailable (privacy mode)               | Treat as empty; writes are no-ops; logged once                                                    |
| `localStorage` QuotaExceededError on write              | **Keep in-memory copy intact**; fail to persist; logged once                                      |
| `localStorage` JSON parse failure                       | Treat as empty; logged once                                                                       |
| `getAllTags()` call fails                               | Tags section renders error row; retry on next keystroke                                           |
| `getAllTags()` returns > 20 000 entries                 | Disable tag provider for the session; tags section shows "Too many tags to search in-browser" row |
| `searchQueryType` localStorage value corrupted          | Fall back to `'smart'`, overwrite the stored value                                                |
| Query length 1                                          | Only Photos fires; People/Places/Tags render `idle` (no skeleton, no error)                       |
| Query > 256 chars                                       | Blocked at input via `maxlength="256"`                                                            |
| Mode switch while Photos in flight                      | Abort Photos (silent), re-run with new mode; People/Places/Tags untouched                         |
| Mode switch during 150 ms debounce                      | Debounce timer restarts; fresh batch uses the new mode                                            |
| Palette closed while providers in flight                | `close()` aborts batch AND preview controllers; sections reset to `idle`                          |
| Enter on a stale / lost cursor item                     | No-op; cursor falls back to first row of current top section                                      |
| Place preview strip empty (geocoder hit with no photos) | Shows "No photos here yet" instead of empty thumbnail row                                         |
| Tag preview grid empty                                  | Shows "No photos tagged yet" instead of empty grid                                                |

---

## Testing

### Unit (vitest + happy-dom)

- **`global-search.service.spec.ts`** — fan-out fires enabled providers; short queries skip pg_trgm providers; debounce coalesces rapid keystrokes; new keystroke aborts prior batch silently; timeout → `timeout` status; provider error → `error` status; mode switch aborts Photos only and re-runs with new mode; **mode switch during debounce restarts the timer with the new mode**; `close()` aborts batch AND preview controllers, resets `sections[*]` to `idle`; cursor-identity fallback when a tracked id disappears; `searchQueryType` corruption falls back to `'smart'`.
- **`global-search-provider-tags.spec.ts`** — client-side filter correctness with various query shapes; cache hit on second keystroke; cache bust on palette close/reopen; **cache invalidated by `storage` event on `cmdk.tags.version`**; **tag provider disables itself at > 20 000 tags**; graceful retry on `getAllTags()` failure.
- **`cmdk-recent.spec.ts`** — read/write, trim to 20, top 8 display, corrupt JSON tolerance, **`QuotaExceededError` preserves in-memory copy** (regression test — do NOT zero out), **localStorage entirely unavailable path** (mock `localStorage.getItem` throwing), entity dedup by stable id, **place id precision** (`48.85664567` and `48.85669999` produce the same key `place:48.8566:2.3522`).
- **`global-search.spec.ts`** — component mounts, keyboard nav across sections (wrap), Enter dispatch per type, **Enter on stale cursor is a no-op**, Esc two-stage, mode selector persists to `searchQueryType`, feature-flag gate hides trigger, **`prefers-reduced-motion` media query removes animation classes** (JSDOM `matchMedia` mock), **auto-highlight on open places cursor on first visible row**, **no-highlight preview state renders the neutral fallback**.
- **`global-search-trigger.spec.ts`** — **global `Ctrl+K` binding is no-op when `featureFlagsManager.value.search === false`**; trigger hides when flag is off.
- **Row and preview components** — each row renders its entity shape, thumbnails use `createUrl()`, ARIA attributes correct; **place preview shows "No photos here yet" on empty strip**; **tag preview shows "No photos tagged yet" on empty grid**; below 640 px preview components don't mount.

### Server

- **`machine-learning.repository.spec.ts`** — `encodeText` aborts with `AbortError` after 15 s when mock ML never responds; `detectFaces` / `encodeImage` / `ocr` / `detectPets` do **not** abort (blast-radius); **a second caller passing `{ timeoutMs: 30_000 }` gets a 30 s timeout** (proves the option is per-call, not hardcoded).
- **`server.controller.spec.ts`** — new test file (or add to existing) — `GET /api/server/ml-health`:
  - Returns `{ smartSearchHealthy: true }` when the mocked `/ping` responds 200 with JSON.
  - Returns `{ smartSearchHealthy: false }` when `/ping` times out at 2 s.
  - Returns `{ smartSearchHealthy: false }` when `/ping` responds 200 but with HTML content-type (reverse-proxy error page).
  - **Requires authentication** — unauth call returns 401.
  - **30 s server-side cache** — two consecutive calls in < 30 s hit the cache (one actual `/ping` fetch); after 30 s a fresh probe fires.
  - Single-flight — concurrent callers share one in-flight probe.

No changes to `search.service.spec.ts` — server search logic is unchanged.

### E2E (Playwright + real server, `e2e/src/specs/web/global-search.e2e-spec.ts`)

Per `feedback_e2e_mock_filterpanel`, real server not mocks. Per `feedback_e2e_metadata_extraction_wait`, drain metadata extraction before asserting on tag/rating results. Per `feedback_playwright_hover_menus`, keyboard nav only (no hover-based preview assertions).

- Open with `Ctrl+K`; verify dialog role and input focus.
- Type a seeded query; verify skeletons then per-section results.
- Arrow-nav across section boundaries.
- `Enter` on photo → asset viewer; on person → `/people/:id`; on "See all N photos" → `/search?…`.
- `Ctrl+/` switches mode; Photos re-renders; People unchanged.
- Esc clears input, second Esc closes palette.
- Cold-open (no `cmdk.recent`) shows SUGGESTED if explore data exists, else the helper row.
- **ML-health banner E2E.** Gallery's CI runs with ML disabled (per `feedback_ci_preexisting_failures`, `project_unified_space_search`) — which is exactly the environment where the banner should fire. Test: open palette, assert the "Smart search is unavailable" banner appears in the Photos section, click the "try Filename mode" button, assert the mode switches and the banner hides.
- **Feature-flag off.** With `features.search = false` in server config, the trigger does not render and `Ctrl+K` does nothing.

### Visual QA (manual)

Responsive breakpoints are where motion and layout details break. Eyeball at **1024 px, 720 px, and 480 px** in **both light and dark modes** before PR:

- Two-pane layout at ≥ 1024 px renders the 280 px preview without overflow; divider is a single hairline.
- Mid-viewport (640–1023 px) hides the preview cleanly — no layout jump.
- Mobile (< 640 px) renders edge-to-edge minus 16 px margin. Navbar still shows the existing magnify `IconButton` link (unchanged).
- Active row tint (`bg-primary/10`) is visible in both modes.
- Skeleton pulse visible in both modes; matches global `Skeleton.svelte` cadence.
- Motion feels right at the specified durations; `prefers-reduced-motion` drops everything to instant.
- **Navbar reflow.** Confirm the trigger button sitting where the old wide SearchBar used to live doesn't push other navbar elements around awkwardly on medium viewports.

---

## Migration and rollout

1. **No palette-specific feature flag** — `featureFlagsManager.value.search` already gates the whole surface.
2. **`/search` route untouched** — deep links, bookmarks, and the mobile href all keep working.
3. **`searchQueryType` localStorage key reused verbatim.**
4. **`predict()` AbortSignal fix** can ship standalone or with the palette PR.
5. **`ShortcutsModal.svelte`** updated in the same PR.
6. **i18n keys** — every user-visible string (headings, "See all N", banner text, helper rows, ARIA labels) goes through i18n. Run `pnpm --filter=immich-i18n format:fix` before committing.

## Known quirks inherited from v0

- **`searchPlaces` is a global geocoder**, not user-scoped. Matches can be places the user has zero photos in. The palette's place preview handles this explicitly with an empty-state message.
- **`searchPerson` returns only user-owned faces.** Shared-space-only faces aren't surfaced. Follow-up can intersect with `withSharedSpaces`.
- **Tag name match is case-insensitive substring on a cached list.** Hard cap at 20 000 tags; follow-up adds a server-side `name` parameter if deployments exceed that.

## Risks

1. **`bits-ui` direct-dep version may drift from `@immich/ui`'s transitive version.** Pin to the exact version `@immich/ui` depends on.
2. **`predict()` per-caller timeout plumbing** touches a hot path. Default is `undefined`; tests verify the four other callers behave identically to today and that a second caller can pass a different `timeoutMs`.
3. **Tag cache size at scale.** Hard cap at 20 000 (degrade), warning at 5 000 (log).
4. **`AbortSignal.any`** — Chrome 116 / Firefox 124 / Safari 17.4. Safe for Gallery's target; manual controller fallback is trivial.
5. **ML health endpoint** — small new surface with auth and 30 s cache; retroactive-promotion path covers the failure mode anyway.
6. **Navbar layout reflow.** Replacing the wide `<SearchBar />` with a compact trigger will visibly re-flow the desktop navbar. Confirm in PR visual review.
7. **`cmdk.tags.version` cross-tab invalidation** — v1 ships with palette-close/reopen invalidation as the baseline; the follow-up for tag management pages writes the version key. In the meantime a tag created in one tab won't appear in another tab's palette until the palette is reopened.
8. **Two-tab `cmdk.recent` writes** — acknowledged data-loss case. Entries are hints, not state.

## Implementation sequence (skeleton for the follow-up plan)

Not a plan doc — rough order for when we move to `writing-plans`:

1. **Server: `predict()` gains `{ timeoutMs }` option;** `encodeText` sets 15 s; unit tests cover abort + per-call usability + blast radius. Lands standalone or bundled.
2. **Server: `GET /api/server/ml-health` endpoint** with auth guard, 30 s cache, single-flight probe, content-type validation. Unit tests cover all cases.
3. **Regen OpenAPI + Dart + TypeScript SDKs** for the new endpoint.
4. **`bits-ui` added to `web/package.json`** at the pinned version.
5. **`GlobalSearchService`** — four providers, rune store, debounce, abort, timeout, min-query-length, cursor identity, mode/debounce interaction, `searchQueryType` sanity. Unit tests cover the state machine.
6. **`cmdk.recent` store** — quota, corruption, place-id precision, dedup, localStorage unavailable path.
7. **Row components + section component + palette root** (`Command.Dialog`). Per-component unit tests including `prefers-reduced-motion` and feature-flag gating.
8. **`GlobalSearchTrigger`** replaces the desktop `<SearchBar />` mount only. `+layout.svelte` registers `Ctrl+K` and re-registers `Ctrl+Shift+K`. **Delete the `Ctrl+K` binding from `search-bar.svelte:246`.** `ShortcutsModal` updated.
9. **Preview pane components** with generation-counter staleness check, 300 ms dwell, empty-state fallbacks.
10. **Empty-state wire-up** — RECENT from `cmdk.recent`, helper row fallback when RECENT is empty, auto-highlight on open, no-highlight preview state. (SUGGESTED deferred to v1.1 per Non-goals.)
11. **ML health client wire-up** — probe on open, retroactive promotion on Photos failure, banner rendering and mode-switch button.
12. **i18n keys** added and sorted via `pnpm --filter=immich-i18n format:fix`.
13. **E2E tests** — full flow plus the ML-unhealthy banner case plus feature-flag gating.
14. **Manual visual QA** at 1024/720/480 px in light and dark, with and without `prefers-reduced-motion`.
15. `make lint-web`, `make check-web`, full `pnpm test` suite green before PR.
