# Design: Cmd/Ctrl+K Multi-Entity Search Palette

**Date:** 2026-04-12
**Status:** Draft — reviewed by `superpowers:code-reviewer`, blockers fixed
**Research:** [`docs/plans/research/2026-04-12-cmdk-search.md`](./research/2026-04-12-cmdk-search.md)
**Scope:** Web v1 only. Mobile gets a functional palette but no preview pane.

---

## Goal

Replace Gallery's inline header search bar with a keyboard-first **global palette** opened via `Ctrl+K` / `Cmd+K`. The palette returns **mixed entity results** — photos, people, places, tags — in a single view with a right-hand preview pane, streaming results per-section as each backend responds. `/search` remains the depth view for overflow on the Photos section.

## Non-goals (v1)

- Albums and Spaces sections — deferred to v1.1
- Prefix scoping (`@person`, `#tag`, `/album`, `>command`) — deferred to v1.2
- Frecency ranking across sections — deferred
- Bridging `@immich/ui`'s `CommandPaletteDefaultProvider` action registry — deferred to v1.5
- Context-aware page suggestions (Linear-style) — deferred to v1.5
- Mobile-native UX — palette opens on mobile tap but no preview pane below ~720 px

---

## User-facing behavior

### Opening

- `Ctrl+K` / `Cmd+K` toggles the palette globally. When focus is inside a text input, textarea, or contenteditable, the shortcut **still opens the palette** — power users expect `Ctrl+K` to be universally available. If that conflicts with any existing in-editor hotkey we discover during implementation, we'll revisit.
- The header's inline `<SearchBar />` and its mobile magnify `<IconButton>` counterpart are both replaced by a compact trigger labelled **"Search… ⌘K"** that opens the palette on click/tap. Both replacements live in `navigation-bar.svelte:86–105` and are gated on the existing `featureFlagsManager.value.search` flag — when search is disabled server-side, the trigger hides and the global `Ctrl+K` binding no-ops.
- On first open after login, a lightweight `GET /ping` probe to the ML server runs in the background (cached for the palette session) to seed the health banner; see [ML health](#ml-health-and-banner) below.

### Empty state (no query typed)

Two sections, in order, each rendered only if non-empty:

1. **RECENT** — up to 8 entries from a new `localStorage`-backed store `cmdk.recent`. Each entry is either a text query (written when the user hits `Enter` on plain text that matched nothing, or re-ran a prior query) or an entity activation (photo / person / place / tag). Entries are mixed, sorted by `lastUsed` desc, displayed top 8 out of a max 20.
2. **SUGGESTED** — fallback when RECENT is empty (first-run or cleared). Seeded from `getExploreData()` cached on first palette open. Verified: `getExploreData` returns city-name groupings only (see `search.service.ts:45–51` — no people data), so SUGGESTED shows up to 6 place rows pulled from the largest city buckets. If the user has fewer than 6 places, we show what's available. If the result is still empty (tiny library), we fall back to a single "Start typing — photos, people, places, tags." helper row.

This collapses what I originally drafted as two separate recent sections. The reason: Gallery's existing `savedSearchTerms` store (`web/src/lib/stores/search.svelte.ts`) is in-memory Svelte `$state`, **not persisted** — it clears on reload and on logout. Seeding from it would give users a section that's usually empty. Writing text queries into `cmdk.recent` alongside entity activations solves both problems with one store.

### Querying

On every input change:

1. **Debounce 150 ms.** The previous pending timer is cancelled.
2. **Query length < 2** — only the Photos provider fires (CLIP can handle 1-char queries, mostly). People/Places/Tags providers require ≥ 2 chars (pg_trgm trigram similarity below 2 chars almost never clears the 0.5 threshold in `person.repository.ts:getByName`, and place/tag name matches are similarly noisy).
3. **On debounce fire**, abort the previous batch's `AbortController`, create a new one, and fan out to the enabled providers in parallel. Each provider gets its own signal composed of `AbortSignal.any([batch.signal, AbortSignal.timeout(5000)])`. (`AbortSignal.any` ships in Chrome 116+/Firefox 124+/Safari 17.4+ — adequate for Gallery's target.)
4. **Skeleton rows** (3 per enabled section) render immediately.
5. **Results replace skeletons** as each provider resolves.
6. **Cancellation source matters.** An abort that originates from "new batch" is silent (the stale result is discarded). An abort from the 5 s timeout sets the section to `{ status: 'timeout' }` and shows a "Search is slow — results may be incomplete" row instead of a skeleton.
7. **"No results" empty state** renders only when _every_ enabled provider has resolved (or timed out / errored) with zero items — never mid-stream.

### Navigating

- `ArrowDown` / `ArrowUp` move a single cursor across all sections, wrapping at the ends.
- `Ctrl+N` / `Ctrl+P` — same as arrow keys (Bits UI defaults, free).
- `Ctrl+J` and the VIM `Ctrl+K` aliases are **disabled** so `Ctrl+K` only ever means "toggle palette."
- `Home` / `End` jump to first / last item.
- Cursor is tracked via `aria-activedescendant` on the combobox input; DOM focus never leaves the input.
- Per-row hover moves the cursor but does not steal focus.
- After an in-place re-run (clicking a RECENT text entry), the cursor moves to the first result row so the next arrow press is predictable.

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

**Only Photos has a "See all" overflow row.** People/Places/Tags cap at top N and don't offer overflow — `/people` is a full face browser with no query-scoped view, `/map` doesn't support place-name search, and `/tags` doesn't support substring filtering in the URL. v1 accepts this; if a user needs deeper browse, they use the relevant dedicated page directly.

Activating any row writes a `RecentEntry` into `cmdk.recent` (trimmed to 20; see [localStorage shape](#localstorage-shape)).

### Closing

- `Esc` first press: clears the input if non-empty; second press: closes the palette (APG two-stage behavior).
- `Ctrl+K` while open: closes.
- Click outside the modal: closes.
- **Closing aborts the current batch's `AbortController`** so slow in-flight requests stop consuming server resources.
- After close, DOM focus returns to the element that was focused before the palette opened (standard modal focus restore, provided by Bits UI).

### Search mode selector

The palette footer shows a segmented control: **Smart · Filename · Description · OCR**.

- Default: **Smart**.
- Persisted in `localStorage` under the existing key **`searchQueryType`** (used today by `search-bar.svelte:184/196` and `SearchFilterModal.svelte:40/44`). The valid values are `'smart' | 'metadata' | 'description' | 'ocr'` — note that the UI label "Filename" maps to the stored value `'metadata'`. We preserve this mapping so the setting carries across from the old header bar without a migration.
- `Ctrl+/` cycles forward through modes.
- Switching mode **aborts the in-flight Photos provider call** and re-runs the Photos provider against the current query with the new mode. People/Places/Tags are untouched. If a debounce is pending when the mode changes, the debounce timer resets and fires with the new mode.
- Mode affects the **Photos section only**. Smart → `searchSmart`; Filename / Description / OCR → `searchAssets` with the appropriate DTO flags (reuses whatever payload builder the current bar uses in `search-bar.svelte`).

The footer placement risks being missed (users ignore chrome), but `Ctrl+/` + the same muscle-memory location the current bar's dropdown occupies mitigate that.

---

## Architecture

### New files

```
web/src/lib/components/global-search/
  global-search.svelte                 — root palette (Bits UI Command.Dialog wrapper)
  global-search-trigger.svelte         — header button that opens the palette
  global-search-section.svelte         — one section (heading + items + skeletons + optional "See all")
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

web/src/lib/services/global-search.svelte.ts
  class GlobalSearchService (singleton)
    — rune-based $state: open, query, mode, sections, activeItemId, mlHealthy, tagsCache
    — public: open(), close(), toggle(), setQuery(text), setMode(mode), activate(item)
    — private: runProviders(), abortCurrentBatch(), probeMlHealth()

web/src/lib/stores/cmdk-recent.ts
  — localStorage-backed store for RecentEntry[]
  — addEntry, getEntries, clearEntries, migrate

web/src/lib/components/global-search/__tests__/
  global-search.spec.ts
  global-search-service.spec.ts
  cmdk-recent.spec.ts
  photo-row.spec.ts + one spec per row/preview component

e2e/src/specs/web/global-search.e2e-spec.ts
```

### Modified files

- `web/package.json` — add `bits-ui` as a **direct dependency** (pin to the same minor that `@immich/ui` uses; currently `^2.15.7`). It exists in the lockfile as a transitive dep via `@immich/ui`, but it is not hoisted to `web/node_modules` under pnpm's strict hoisting, so `import { Command } from 'bits-ui'` from `web/src` does not resolve without an explicit entry.
- `web/src/routes/+layout.svelte` — register the global `Ctrl+K` shortcut on `<svelte:document>` (matches the existing `Ctrl+Shift+M` pattern at lines 234–238), mount `<GlobalSearch />` once at the root, and — **important** — re-register `Ctrl+Shift+K` (currently owned by `search-bar.svelte:247`) to open the `SearchFilterModal`. Without this, removing the header `<SearchBar />` would silently delete the `Ctrl+Shift+K` binding.
- `web/src/lib/components/shared-components/navigation-bar/navigation-bar.svelte` — replace both the desktop `<SearchBar grayTheme />` (line 88) and the mobile magnify `<IconButton>` (lines 93–105) with `<GlobalSearchTrigger />`. The trigger respects the existing `featureFlagsManager.value.search` feature flag and renders nothing when the flag is off.
- `web/src/lib/modals/ShortcutsModal.svelte` — update the `Ctrl+K` row to describe "Open global search" and add a `Ctrl+/` row for "Cycle search mode." `Ctrl+Shift+K` stays as "Open search filters."
- `web/src/lib/components/shared-components/search-bar/search-bar.svelte` — **not modified, not deleted.** It continues to back the `/search` depth-view page's own input. Only the header mount is removed.
- `web/src/lib/stores/search.svelte.ts` — the in-memory `savedSearchTerms` store is left as-is. The palette does not depend on it.
- `server/src/repositories/machine-learning.repository.ts` — **targeted** AbortSignal fix in `predict()`. The method is called by five different ML tasks (`detectFaces` :223, `encodeImage` :233, `encodeText` :239, `ocr` :250, `detectPets` :260) — a blanket timeout on the shared `predict()` path would add aborts to long-running background jobs. Instead, thread a `{ timeoutMs?: number }` option through `predict(payload, config, { timeoutMs })`, default to no timeout (existing behavior), and set `timeoutMs: 15_000` only at the `encodeText` call site. A small unit test verifies `encodeText` aborts on timeout and the other callers still see no timeout.
- `server/src/controllers/server-info.controller.ts` (and corresponding service) — add `GET /api/server-info/ml-health` returning `{ smartSearchHealthy: boolean }`, implemented by firing a 2 s `/ping` probe to the configured ML URL. DTO added in `server/src/dtos/server-info.dto.ts`; OpenAPI spec regen + Dart + TypeScript SDK regen per `feedback_openapi_dart_and_sql`.

### Libraries

- **Bits UI `Command`** — added directly to `web/package.json` per the note above. Provides `Command.Root`, `Input`, `List`, `Viewport`, `Group`, `GroupHeading`, `GroupItems`, `Item`, `Empty`, `Loading`, `Dialog`, with ARIA combobox wiring. Svelte 5 native.
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
  minQueryLength: number; // 1 for photos, 2 for the rest
}
```

### The four v1 providers

| Provider | SDK call(s)                                           | `topN` | `minQueryLength` | Notes                                                                                                                                                                                                                                                                                              |
| -------- | ----------------------------------------------------- | ------ | ---------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| photos   | `searchSmart` (mode=smart) or `searchAssets` (others) | 5      | 1                | DTO shape mirrors what `search-bar.svelte` currently builds per mode                                                                                                                                                                                                                               |
| people   | `searchPerson({ name, withHidden: false })`           | 5      | 2                | Returns matches owned by the current user; the global-faces quirk is inherited from the existing header bar                                                                                                                                                                                        |
| places   | `searchPlaces({ name })`                              | 3      | 2                | Global geocoder lookup, not user-scoped — inherited quirk. Activating a place can land on an empty map spot; see [open quirks](#known-quirks-inherited-from-v0)                                                                                                                                    |
| tags     | _client-side filter_ over a cached `getAllTags()`     | 5      | 2                | `getTagSuggestions` has no `name` parameter. On first keystroke we call `getAllTags()` once, cache in the service for the palette session, filter client-side by substring. Assumes < ~10k tags per user. If we exceed that, we add a `name` parameter to the suggestions endpoint as a follow-up. |

### `GlobalSearchService.setQuery(text)` algorithm

```
on setQuery(text):
  clear pending debounce timer
  if text === current query: return
  current query = text
  abort current batch (if any)
  if text.trim() === '':
    sections[*] = { status: 'idle' }
    render empty state (RECENT + SUGGESTED fallback)
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
  if debounce timer pending: clear and restart with current query
  else: abort photos provider only, re-run photos provider with new mode
        (people/places/tags keep their current results)

on close():
  clear pending debounce
  abort current batch
  clear active item
  open = false
```

### ML health and banner

Because `MachineLearningRepository.isHealthy()` returns `true` unconditionally when `availabilityChecks.enabled` is `false` (see `machine-learning.repository.ts:178–184`), reading the server's `healthyMap` is not a reliable signal. The browser also can't probe the ML container directly — it lives on the internal Docker network. So **we add one small server endpoint**:

- **`GET /api/server-info/ml-health`** — new route on the existing `server-info` controller. Handler performs an on-demand `fetch('/ping', { signal: AbortSignal.timeout(2000) })` against the first configured ML URL, returns `{ smartSearchHealthy: boolean }`. No caching on the server side (the palette caches client-side). OpenAPI regen + Dart client regen required per `feedback_openapi_dart_and_sql`.
- **Palette client:** on first palette open per session, call `getServerMlHealth()` (the new SDK method) once, cache the result for the palette session. If unhealthy, set `mlHealthy = false`.
- **Retroactive promotion:** the banner is also shown when the Photos provider (mode = Smart) returns `{ status: 'timeout' }` or `{ status: 'error' }` during the session, regardless of the initial probe result. This covers mid-session ML degradation.
- **Rendering:** when `mlHealthy === false` and `mode === smart`, the Photos section renders a persistent banner: **"Smart search is unavailable — try Filename mode"** with a button that calls `setMode('metadata')`. Switching to any non-Smart mode hides the banner.

Committing to this endpoint now (rather than deferring) avoids scope creep during implementation and ensures first-time Smart searchers get the proactive banner on a broken ML container instead of silently hitting a timeout.

### Preview pane

The preview pane is a pure function of the highlighted row. For each entity type:

- **Photo** — thumbnail via `createUrl()` (per `feedback_filter_thumbnail_createUrl` memory — bare paths get intercepted by SvelteKit) at full pane width (~240×180 `object-cover`). Below: filename in GoogleSans 14/500, then a 2-row metadata block in GoogleSans 12/410 / `text-gray-500 dark:text-gray-400`: "March 2024 · Santa Cruz, CA" and "Canon R5 · f/2.8 · 1/500". Below that: two ghost-style pill buttons ("Open" / "Add to album"), not filled.
- **Person** — face crop via `createUrl()` on `faceAssetId` at 120×120 rounded-full, centered. Name in GoogleSans 18/600, face count in 12/410 subtle. Below: 4-wide 48×48 strip of recent photos from `searchAssets({ personIds: [person.id], size: 4 })`.
- **Place** — static map tile at 240×160 with a 1 px `border-gray-200 dark:border-gray-700` border (reuses existing Gallery map tile source). Place name in GoogleSans 16/600, country in 12/410 subtle, "412 photos" metadata. Below: 4-wide 48×48 recent-photos strip from `searchAssets({ latitude, longitude, size: 4 })`.
- **Tag** — a 2×3 grid of 72×72 thumbnails with 8 px gaps from `searchAssets({ tagIds: [tag.id], size: 6 })`. Tag name in GoogleSans 16/600 with a 8×8 rounded color dot prefix (tag's stored color), "98 photos" metadata below the grid.

**Preview staleness handling.** Each preview has its own `AbortController`, separate from the batch controller. When the active item changes or the query changes, the current preview's controller is aborted and a new one is created. A late-arriving response for a stale item is discarded via a generation counter check (`if (thisGeneration !== currentGeneration) return`). The preview render is also deferred for **300 ms** after cursor stop — quickly cursoring past a tag row does not fire a tag-content fetch. Below 720 px viewport the preview pane is hidden entirely and no preview fetches happen.

### localStorage shape

```ts
// key: 'cmdk.recent'
type RecentEntry =
  | { kind: 'query'; id: string; text: string; mode: SearchMode; lastUsed: number }
  | { kind: 'photo'; id: `photo:${string}`; assetId: string; label: string; thumbnailAssetId: string; lastUsed: number }
  | {
      kind: 'person';
      id: `person:${string}`;
      personId: string;
      label: string;
      thumbnailAssetId?: string;
      lastUsed: number;
    }
  | {
      kind: 'place';
      id: `place:${number}:${number}`;
      latitude: number;
      longitude: number;
      label: string;
      lastUsed: number;
    }
  | { kind: 'tag'; id: `tag:${string}`; tagId: string; label: string; lastUsed: number };

// Max 20 entries stored, top 8 displayed in RECENT.
// id is the stable dedup key; activating the same thing twice updates lastUsed in place.
// Place ids are composite because PlacesResponseDto has no server-side id.
```

Read/write is wrapped in try-catch. On JSON parse error or `QuotaExceededError`, the store treats itself as empty and logs once to the console — it does not crash the palette.

---

## Accessibility

- Input: `role="combobox"`, `aria-expanded="true"` when open, `aria-controls={listboxId}`, `aria-autocomplete="list"`, `aria-activedescendant={activeItemId}`.
- List: `role="listbox"`, `aria-label={t('search_results')}`.
- Sections: `role="group"`, `aria-labelledby={headingId}`.
- Items: `role="option"`, `aria-selected={isActive}`, stable `id` for `aria-activedescendant`.
- The outer modal is a `Command.Dialog` — `role="dialog"`, `aria-modal="true"`, `aria-label={t('global_search')}` — without replacing the combobox role on the input.
- Focus trap is provided by Bits UI; focus returns to the opener on close.
- Skeleton rows are `aria-hidden="true"` with no `option` role.
- An `aria-live="polite"` region announces **only the final aggregate** once all four providers have settled per query — "342 photos, 5 people, 3 places, 2 tags." We deliberately do **not** announce each section as it streams in; rapid typers would trigger an unlistenable torrent of announcements.

---

## Visual identity and motion

**Aesthetic direction: "library archive," editorial-leaning.** Gallery is a personal archive, not an enterprise dashboard. The palette should feel closer to a museum catalog interface than a sysadmin console — quietly confident, editorial, typographically refined without being loud. The concept guides every decision below.

### Typography

Uses Gallery's existing loaded fonts — **GoogleSans** (variable, weight range 410–900) for all UI and **GoogleSansCode** for monospace accents. Both are already available via `--font-sans` (`app.css:87–101`). No new font files.

GoogleSans's minimum weight is 410, not 400 — that's the "regular" baseline in Gallery. Numbers below refer to real variable-font weights.

| Element                       | Font           | Size  | Weight | Color / treatment                        |
| ----------------------------- | -------------- | ----- | ------ | ---------------------------------------- |
| Section heading ("PHOTOS —")  | GoogleSans     | 11 px | 600    | uppercase, letter-spacing 0.08em, subtle |
| Row title                     | GoogleSans     | 14 px | 500    | tracking -0.01em                         |
| Row subtitle                  | GoogleSans     | 12 px | 410    | `text-gray-500 dark:text-gray-400`       |
| "See all N photos →"          | GoogleSans     | 12 px | 500    | accent color for chevron                 |
| Preview title                 | GoogleSans     | 16 px | 600    | Person preview promotes to 18/600        |
| Preview metadata              | GoogleSans     | 12 px | 410    | `text-gray-500 dark:text-gray-400`       |
| Mode label ("Smart · …")      | GoogleSansCode | 11 px | 500    | uppercase, tabular                       |
| Keybind chip (`⌘K`, `Ctrl+/`) | GoogleSansCode | 11 px | 500    | `bg-subtle/60` pill, 1 px border         |
| Empty state / helper rows     | GoogleSans     | 13 px | 410    | subtle                                   |

Section headings get a small em-dash after the label — "PHOTOS —" — as a deliberate editorial accent. Cheap to render, tells the user the palette cares about detail.

### Dimensions

| Viewport    | Palette width | Preview pane | Notes                 |
| ----------- | ------------- | ------------ | --------------------- |
| ≥ 1024 px   | 720 px        | 280 px right | Two-pane layout       |
| 640–1023 px | 560 px        | hidden       | List only             |
| < 640 px    | full − 16 px  | hidden       | Mobile / small laptop |

Inside the palette:

- Row height **52 px** (thumbnails breathe, 5 rows per section fit on a 14″ screen without scroll)
- Row padding **12 px horizontal, 8 px vertical**
- Section gap **16 px**
- Preview pane padding **20 px**
- Thumbnail sizes: photos 40×40 `rounded-md` (6 px), people 40×40 `rounded-full`, places and tags icon-only 32×32
- Divider between list and preview: single 1 px hairline `border-gray-200 dark:border-gray-700`, no shadow — they're one surface, not two floating cards

### Color philosophy

**95 % neutral, 5 % accent.** Dominant neutrals with a single sharp accent tell the eye where to look. No accent gradients, no tinted backdrop, no secondary accents.

- Palette chrome: `bg-light dark:bg-dark` with an off-warm tint (not cold white; cold white reads "SaaS")
- Hairline border: `border-gray-200 dark:border-gray-700`
- Elevation: a single elevated shadow layer (`shadow-2xl` or equivalent Gallery token) with a slightly warm cast
- Backdrop: `bg-black/30 backdrop-blur-md` — the blur signals the palette is _floating_, not opaque-dimmed
- **Accent** (Gallery's existing `accent-primary` token) appears in only two places: the active-row 3 px left border + faint tint, and the "See all" chevron. Nowhere else.

Every color goes through Gallery's `@immich/ui` tokens with `dark:` prefixes per `feedback_match_gallery_design` — no hardcoded hex, no bespoke palette.

### Motion

All motion drops to instant when `prefers-reduced-motion: reduce` matches. No exceptions.

| Moment                              | Duration | Easing                                               | Detail                                                                                                               |
| ----------------------------------- | -------- | ---------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| Palette enter                       | 180 ms   | `cubic-bezier(0.22, 1, 0.36, 1)` (ease-out-quint)    | Backdrop fades in; palette scales 0.98 → 1.0 + fades in + 4 px translate-from-top — reads as "descending into place" |
| Palette exit                        | 120 ms   | same, reversed                                       | Faster out than in — dismissal feels snappy                                                                          |
| Section heading + rows on resolve   | 100 ms   | linear                                               | Stagger: 20 ms per row index; heading leads by 40 ms                                                                 |
| Skeleton → real row                 | 120 ms   | ease-out                                             | Cross-fade in place; no layout jump                                                                                  |
| Active row highlight                | 80 ms    | ease-out                                             | Left border grows 0 → 3 px; background tint fades in                                                                 |
| Preview swap (type change)          | 120 ms   | ease-out                                             | Full content cross-fade                                                                                              |
| Preview swap (same type, diff item) | 60 ms    | ease-out                                             | Opacity blink 0.85 → 1.0 — "blink of recognition" without lag                                                        |
| Mode selector pill                  | 180 ms   | `cubic-bezier(0.34, 1.56, 0.64, 1)` (mild overshoot) | The one place mild playfulness is allowed; footer is otherwise dead space                                            |
| Skeleton pulse                      | 1600 ms  | ease-in-out infinite                                 | Opacity 0.4 → 0.7 → 0.4. **Pulse, not shimmer** — shimmer reads "AI loading"                                         |

### Atmosphere and detail

Small touches that signal "designed," not "generated":

- **Grain texture** on the palette surface — a 1 px SVG noise pattern at 2 % opacity. Costs ~50 bytes, reads expensive. "Archive, not SaaS."
- **Single hairline divider** between list and preview — not a shadow, not a gap. The two panes read as one surface split internally.
- **Em-dash on section headings** ("PHOTOS —") — tiny editorial signal.
- **`⌘K` trigger chip** (in the header trigger button): GoogleSansCode, `bg-subtle/60`, 1 px `border-gray-200 dark:border-gray-700`, `rounded-sm`. Clickable-but-not-screaming.
- **Right-aligned chevron** on "See all N photos →" with `tabular-nums` so counts align vertically across sections.
- **Active row highlight** is a 3 px accent-colored left border + very subtle `bg-accent-primary/5` tint. No scale, no shadow, no glow. Restraint is the whole point — this row is seen constantly.

### Empty-state voice

Replace the generic placeholder with something with a bit of character:

> **"Start typing — photos, people, places, tags."**

Same byte count, less corporate. The em-dash matches the section-heading treatment.

## Error handling

| Failure                                                 | Behavior                                                                                           |
| ------------------------------------------------------- | -------------------------------------------------------------------------------------------------- |
| One provider 5xx / network error                        | Section shows "Couldn't load [entity] — retry" row; other sections unaffected                      |
| One provider times out (5 s client cap)                 | Section shows "Search is slow — results may be incomplete" and hides the skeleton                  |
| All four providers error                                | Palette shows "Something went wrong" with a retry button                                           |
| ML unhealthy at palette open (Smart mode)               | Banner: "Smart search is unavailable — try Filename mode" with quick-switch button                 |
| ML becomes unhealthy mid-session                        | First timeout/error from Photos promotes the same banner retroactively                             |
| Photos timeout during non-Smart mode                    | Section shows generic timeout message; banner does not appear (it's Smart-specific)                |
| User has empty `cmdk.recent`                            | Skip RECENT section; fall through to SUGGESTED                                                     |
| `getExploreData()` returns zero cities (tiny library)   | Skip SUGGESTED; show a single "Start typing — photos, people, places, tags." helper row            |
| `localStorage` unavailable / quota exceeded / corrupted | Try-catch on read/write; treat as empty; log once to console                                       |
| `getAllTags()` call fails (tag cache miss)              | Tags section renders error row; retry on next keystroke                                            |
| User types query of length 1                            | Only Photos fires; People/Places/Tags sections render `idle` (no skeleton, no error)               |
| Mode switch while Photos is in flight                   | Abort the in-flight Photos call (silent abort, no timeout message), re-run with new mode           |
| Palette closed while providers in flight                | `close()` aborts the batch; sections are reset to `idle`; pending responses are discarded silently |

---

## Testing

### Unit (vitest + happy-dom)

- **`global-search-service.spec.ts`** — fan-out fires enabled providers; short queries skip pg_trgm providers; debounce coalesces rapid keystrokes; new keystroke aborts prior batch silently; timeout sets section to `timeout`; provider error sets section to `error`; mode switch aborts photos only and re-runs with new mode; `close()` aborts in-flight batch.
- **`cmdk-recent.spec.ts`** — read/write, trim to 20, top 8 display, corrupt JSON tolerance, QuotaExceeded tolerance, entity dedup by stable id (same photo activated twice → one entry with updated `lastUsed`).
- **`global-search.spec.ts`** — component mounts, keyboard navigation moves cursor across sections (wrap), Enter activates correct row type, Esc two-stage clear/close, mode selector persists to `searchQueryType`, feature-flag gate hides trigger.
- **`photo-row.spec.ts` / `person-row.spec.ts` / `place-row.spec.ts` / `tag-row.spec.ts`** — each row renders its entity shape, thumbnails use `createUrl()`, ARIA attributes set correctly.
- **`photo-preview.spec.ts` / etc.** — type dispatch renders correct preview; late response after cursor change is discarded via generation counter; below 720 px preview component does not mount.
- **`global-search-provider-tags.spec.ts`** — client-side tag name filter correctness with various query shapes; cache is used on second keystroke; bust on palette close/reopen.

### Server

- **`machine-learning.repository.spec.ts`** — add cases:
  - `encodeText` aborts with `AbortError` after 15 s when the mock ML server never responds.
  - `detectFaces` / `encodeImage` / `ocr` / `detectPets` do **not** abort after 15 s (blast-radius verification that the `{ timeoutMs }` option is per-caller).
- No changes to `search.service.spec.ts` — server logic is unchanged.

### E2E (Playwright + real server, `e2e/src/specs/web/global-search.e2e-spec.ts`)

Per `feedback_e2e_mock_filterpanel`, real server not mocks. Per `feedback_e2e_metadata_extraction_wait`, drain metadata extraction before asserting on tag/rating results.

- Open with `Ctrl+K`, verify dialog role and focus in the input.
- Type `"beach"` (or whatever seeds the test DB), verify skeletons then real results in each section.
- Arrow-nav across section boundaries, verify cursor moves through Photos → People → Places → Tags.
- `Enter` on a photo opens the asset viewer.
- `Enter` on a person navigates to `/people/:id`.
- `Enter` on the "See all N photos" row navigates to `/search?query=...`.
- Switch mode via `Ctrl+/`, verify Photos section re-renders and People stays unchanged.
- `Esc` clears input, second `Esc` closes palette.
- Cold-open (no `cmdk.recent`) shows SUGGESTED if explore data exists, or the helper row if not.
- Hover-based preview tests are avoided per `feedback_playwright_hover_menus` (flaky in headless) — preview assertions use keyboard navigation only.

### Visual QA (manual)

Responsive breakpoints are where the motion and layout details break. Before the PR, eyeball the palette at **1024 px, 720 px, and 480 px** widths in **both light and dark modes**:

- Two-pane layout at ≥ 1024 px renders the 280 px preview without overflow; divider is a single hairline, no shadow.
- Mid-viewport (640–1023 px) hides the preview pane cleanly — no layout jump, no empty right column.
- Mobile (< 640 px) renders edge-to-edge minus 16 px margin; trigger button collapses to an icon if navbar real estate is tight.
- Active row highlight is visible in both modes (neither theme drops the 3 px accent border into invisibility).
- Skeleton pulse visible in both modes (opacity range tuned against `bg-subtle`, not hardcoded).
- Grain texture reads at 2 % opacity without banding on either theme.
- Motion feels right at the specified durations — not jerky, not sluggish. Verify `prefers-reduced-motion` drops everything to instant.

---

## Migration and rollout

1. **No feature flag for the palette itself** — this is a fork-only change iterating on `main`. The `featureFlagsManager.search` flag already exists and gates the whole feature end-to-end.
2. **`/search` route untouched** — deep links and bookmarks continue to work. "See all" rows navigate there.
3. **`searchQueryType` localStorage key reused verbatim** — mode preference migrates seamlessly.
4. **`predict()` AbortSignal fix** can ship standalone as a precursor PR or bundled with the palette PR. If bundled, it reviews in the same commit as a small server-side change. If standalone, the palette PR's implementation step 1 becomes "depend on [link to the merged fix PR]."
5. **`ShortcutsModal.svelte` updated in the same PR** so the `?` help dialog reflects the new bindings.
6. **i18n keys** — every user-visible string (section headings, "See all N", "Smart search is unavailable," mode labels, error rows, helper rows, ARIA labels) goes through `i18n`. Per `feedback_i18n_key_sorting`, run `pnpm --filter=immich-i18n format:fix` before committing the translation file.

## Known quirks inherited from v0

These aren't new problems, but the design surfaces them and the review should flag them for the user:

- **`searchPlaces` is global, not user-scoped.** Matches return a geocoder hit for any known place name, not just places the user has photos in. Activating can land on an empty `/map` spot. The current header bar has this same behavior, so it's not a regression — but worth noting.
- **`searchPerson` returns only faces owned by the calling user.** Shared-space faces are not surfaced in the People section. Future work can intersect with `withSharedSpaces` when the server endpoint gains that option.
- **Tag name match is case-insensitive substring on a cached list.** A user with > ~10k tags will hit a cache growth issue; we add a server-side `name` parameter as a follow-up if that comes up.

## Risks

1. **`bits-ui` direct-dep addition** may cause `@immich/ui` to see a different bits-ui version in hoisting. Mitigation: pin to exactly the version `@immich/ui` depends on. If the internal `@immich/ui` build breaks, the PR reverts and we ship the palette with a different primitive.
2. **`predict()` per-caller timeout plumbing** touches a hot path. Mitigation: default is `undefined` (no change), only `encodeText` opts in; tests verify the other four callers behave identically to today.
3. **Tag cache size.** Mitigation: the service measures tag count on first `getAllTags()` call and logs a warning at > 5k; a follow-up plan adds a server-side `name` param if we see deployments over that threshold.
4. **`AbortSignal.any` support** — Chrome 116 / Firefox 124 / Safari 17.4. Gallery doesn't formally declare a browser baseline, but these all shipped ~2024 and are safe. If we want older-browser support, the service can fall back to a manual controller wrapper (trivial).
5. **ML health probe endpoint** — small server surface addition committed to above. The retroactive-promotion path still covers mid-session degradation, so even if the probe itself fails the banner still appears after a real failure.
6. **The SUGGESTED section on a tiny library** — if `getExploreData` returns nothing, we fall through to the "Start typing — photos, people, places, tags." helper row. Documented.

## Implementation sequence (rough order for the follow-up plan)

Not a plan doc — this is the skeleton for when we move to `writing-plans`:

1. **Server, standalone.** `predict()` gains `{ timeoutMs }` option; `encodeText` sets `15_000`; unit tests cover encodeText abort + other-callers unchanged. Lands as its own commit/PR.
2. **`bits-ui` added to `web/package.json`.** Pinned to `@immich/ui`'s dep version. Verify web build still passes.
3. **`GlobalSearchService` skeleton.** Four providers, rune store, debounce, abort, timeout, min-query-length gating. Unit tests cover the state machine.
4. **`cmdk.recent` store.** With quota + corrupt-JSON handling and dedup.
5. **Row components + section component + palette root** (`Command.Dialog`). Per-component unit tests.
6. **`GlobalSearchTrigger`** replaces both header mounts (desktop + mobile). `+layout.svelte` registers `Ctrl+K` and re-registers `Ctrl+Shift+K` at layout level. `ShortcutsModal` updated.
7. **Preview pane components** with generation-counter staleness check and 300 ms dwell.
8. **Empty-state sections** wire-up: RECENT from `cmdk.recent`, SUGGESTED from cached `getExploreData`, helper row fallback.
9. **ML health endpoint + banner.** Add `GET /api/server-info/ml-health` on the server, regenerate OpenAPI + Dart + TypeScript SDKs, wire up the client probe and the Photos-section banner (both proactive-on-open and retroactive-on-timeout paths).
10. **i18n keys** added and sorted.
11. **E2E tests.**
12. **Manual QA** with `make dev` against every section, mode, keyboard path, and the ML-down error path.
13. `make lint-web`, `make check-web`, full `pnpm test` suite pass before PR.
