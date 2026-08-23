# cmdk Navigation Provider + Stale-While-Revalidate — Design

**Status:** Approved after 2-round brainstorm + code-reviewer pass.
**Depends on:** `research/cmdk-search` branch (cmdk palette v1 — photos, people, places, tags).
**Supersedes:** implicit assumption in `2026-04-12-cmdk-search-plan.md` that Gallery has no pre-existing global cmdk palette.

## Goals

1. When the user types `auto-class` into Ctrl+K, `Auto-Classification` (a system settings accordion) appears as a result; pressing Enter lands on `/admin/system-settings?isOpen=classification` with the accordion open.
2. The palette also surfaces Gallery's top-level admin pages (Users, Libraries, Queues, Maintenance, Server Stats), user-facing pages (Photos, Albums, People, Map, ...), and the Theme toggle action.
3. The palette no longer jitters between skeleton and content on every keystroke when entity results are already on screen (root cause of the bug Pierre hit while typing `asdfasdf`).
4. Ctrl+K only opens _our_ palette, not the legacy `@immich/ui` `CommandPaletteDefaultProvider`.

## Non-goals

- Indexing settings sub-fields (e.g. "Machine Learning → URLs" — just the top-level accordion).
- Supporting generic "quick launch" browsing on cold open — empty query still shows Recent or helper only.
- Migrating the per-page `CommandPaletteDefaultProvider` mounts (asset viewer, album, map, etc.) into the new palette. They stay in place as dead code for upstream-rebase safety.
- Adding a copy-my-immich-link command (upstream branding, not worth forking).
- Cross-locale memo eviction or LRU. Cache grows with visited locales; each locale adds ~36 strings.

## Architecture

### Disabling the legacy palette

The `@immich/ui` command palette binds `Ctrl+K` / `Cmd+K` / `/` through its `commandPaletteManager.enable()` singleton, which Gallery explicitly calls in `web/src/routes/+layout.ts:25`. Removing that one call unbinds the shortcut for the entire document. The `<CommandPaletteDefaultProvider>` mount in `+layout.svelte:195` and the 19 per-page mounts continue to compile and mount — they just feed providers to a singleton with no keyboard binding, so nothing ever opens. Zero fork drift in upstream files other than the single `.enable()` deletion.

A new `use:shortcut` in `+layout.svelte` re-binds `Shift+T` to `themeManager.toggleTheme()` because that shortcut rode along with the old palette and would otherwise regress.

### Navigation provider

A new `Provider` entry under key `navigation` added to `GlobalSearchManager.buildProviders()`. Follows the same interface as the four existing entity providers:

```ts
const navigation: Provider = {
  key: 'navigation',
  topN: 5,
  minQueryLength: 2,
  run: async (query) => this.runNavigationProvider(query),
};
```

### Item data

A new module `web/src/lib/managers/navigation-items.ts` exports a readonly `NAVIGATION_ITEMS` array, 36 entries:

- **19 system settings** — one per accordion in `web/src/routes/admin/system-settings/+page.svelte`. Route pattern: `/admin/system-settings?isOpen=<key>`. `adminOnly: true`. Keys must match the real accordion keys; a unit test greps the source file at test time to guard against drift during upstream rebases.
- **5 admin pages** — Users, External Libraries, Queues, Maintenance, Server Stats. Routes start with `/admin/`. `adminOnly: true`.
- **11 user pages** — Photos, Albums, People, Tags, Map, Sharing, Spaces, Trash, Favorites, Archive, Memories. `adminOnly: false`.
- **1 action** — `id: 'nav:theme'`, `category: 'actions'`, empty route. This is the only item whose activation does not navigate.

```ts
export type NavigationCategory = 'systemSettings' | 'admin' | 'userPages' | 'actions';
export type NavigationItem = {
  id: string;
  category: NavigationCategory;
  labelKey: string;
  descriptionKey: string;
  icon: string;
  route: string;
  adminOnly: boolean;
  featureFlag?: keyof ServerFeaturesDto; // optional gate; item hidden when flag is false
};
export const NAVIGATION_ITEMS: readonly NavigationItem[];
```

Items that depend on a feature flag declare it at build time (e.g. Spaces, Memories — verify which flags exist in `ServerFeaturesDto` at implementation time). `runNavigationProvider` filters these out whenever `featureFlagsManager.valueOrUndefined?.[item.featureFlag]` is falsy, in addition to the `adminOnly` gate.

### Filtering & scoring

`runNavigationProvider(query)` runs synchronously inside the manager (async signature only to match the `Provider` interface):

1. Read `get(user)?.isAdmin` once and `featureFlagsManager.valueOrUndefined` once.
2. Filter `NAVIGATION_ITEMS`:
   - Drop `adminOnly: true` items for non-admins.
   - Drop items with `featureFlag` set when `featureFlagsManager.valueOrUndefined?.[item.featureFlag]` is falsy. If `featureFlagsManager` hasn't been initialised yet (SSR-hydration window), `valueOrUndefined` is `undefined` and flagged items are dropped — they reappear once flags load and the next keystroke re-runs the filter.
3. Look up a locale-keyed memoized cache of translated searchable strings: `Map<locale, Map<itemId, string>>` where the string is `` `${$t(labelKey)} ${$t(descriptionKey)}` `` — single concatenated string, matching `bits-ui`'s real `computeCommandScore(command, search, aliases?)` signature (the reviewer caught an earlier draft that misused the `aliases` parameter as a weighted-context array). If a locale is not yet cached, build the full table on first use.
4. For each surviving item, `score = computeCommandScore(searchString, query)`. Drop `score === 0`.
5. Sort the surviving items descending by score.
6. Return `{ status: 'ok', items, total: items.length }` — a flat `ProviderStatus<NavigationItem>`, no custom extended type. The items carry their `category` field; grouping into sub-sections happens at render time.
7. Empty result: `{ status: 'empty' }`.

`computeCommandScore` is imported from `bits-ui` top-level. It's the same fuzzy scorer the @immich/ui palette was using under the hood — characters can be non-contiguous, transpositions are penalised less than misses, case-insensitive.

### Locale change handling

The memo cache is invalidated when `svelte-i18n`'s `locale` store changes. The manager subscribes to `locale` in its constructor (inside the `if (browser)` guard already used for the storage listener) and clears `this.navigationSearchCache` on each change. Tests pin this behaviour with a mocked locale store.

**Singleton lifetime note.** The locale subscription's unsubscribe handler is intentionally never called. `GlobalSearchManager` is a module-level singleton exported from `$lib/managers/global-search-manager.svelte`; it lives for the tab's lifetime and is never torn down during normal navigation. The existing `destroy()` method (which removes the storage listener) is effectively dead code in production — it exists only for test isolation via `resetForTests()` helpers. The locale subscription follows the same pattern: the handle is stored on `this.localeUnsubscribe` so tests can invoke it, but production never does. Memory impact is one subscription for tab-life.

### Rendering

The navigation section sits **below** the four entity sections in the palette scroll:

```
Photos → People → Places → Tags → [Navigation sub-sections]
```

A new `GlobalSearchNavigationSections.svelte` component (separate from `GlobalSearchSection`) receives `status: ProviderStatus<NavigationItem>` and:

- If `status.status !== 'ok'`, renders nothing (`empty` and `idle` are both invisible for this section — there is never a "no results" message for navigation because the entity sections above already carry that burden).
- If `status.status === 'ok'`, buckets `status.items` by `category` at render time, then emits up to four `<Command.Group>`s in fixed order: `systemSettings → admin → userPages → actions`. Empty categories emit nothing — no heading, no placeholder. Each group slices to `topN = 5` items. Each row is rendered by a new `navigation-row.svelte` (icon + translated label + translated description, same 52 px height and `data-[selected=true]` tinting as the existing rows).

The preview pane (≥ 1024 px) does **not** render a preview for navigation items. When the cursor is on a `nav:*` item, `getActiveItem()` returns `{ kind: 'nav', data }` but `GlobalSearchPreview` has no `nav` branch, so it falls through to the existing `activeItem === null` empty state ("Select a result to preview"). Navigation preview is non-goal for v1.

### Manager touchpoints for the new section

Adding a fifth section key requires consistent updates across the manager. The code-reviewer enumerated these explicitly:

- `Sections` type — add `navigation: ProviderStatus<NavigationItem>`.
- `announcementText` — add navigation count to the aria-live aggregate.
- `reconcileCursor.order` — append `'navigation'`. `kindOf` gets `navigation: 'nav'`.
- `sectionForKind` — new `case 'nav'` returning `this.sections.navigation`.
- `ActiveItem` type — add `'nav'` to the kind union.
- `getActiveItem` — new branch matching `nav:<id>` against `items[i].id`.

### Activation

`activate('navigation', item)` in the manager branches on whether the item is a command or a navigation:

```ts
case 'navigation': {
  const n = item as NavigationItem;
  if (n.category === 'actions' && n.id === 'nav:theme') {
    themeManager.toggleTheme();
    // Theme toggle is stateless — do not persist to Recents.
  } else {
    addEntry({ kind: 'navigate', id: n.id, route: n.route, labelKey: n.labelKey, icon: n.icon, adminOnly: n.adminOnly, lastUsed: Date.now() });
    void goto(n.route);
  }
  this.close();
  break;
}
```

### Recent store

`RecentEntry` grows one new kind:

```ts
| { kind: 'navigate'; id: string; route: string; labelKey: string; icon: string; adminOnly: boolean; lastUsed: number }
```

Theme-toggle is intentionally not persistable — a stateless command in the Recents list is UX noise ("recently toggled theme" means nothing).

`isValidRecentEntry` gets a `navigate` branch requiring non-empty `route`, `labelKey`, `icon`.

`recent-row.svelte` dispatcher gets a `navigate` branch that renders the navigation row.

### Admin gating on stale recents

Two defences, both necessary:

**Render-time filter.** `global-search.svelte:44` currently reads `recentEntries = getEntries()` unconditionally. After this change it filters the returned entries to hide `navigate` entries with `adminOnly: true` for non-admin users:

```ts
const recentEntries = $derived<RecentEntry[]>(() => {
  if (inputValue.trim() !== '') return [];
  const isAdmin = $user?.isAdmin ?? false;
  return getEntries().filter((e) => !(e.kind === 'navigate' && e.adminOnly && !isAdmin));
});
```

A demoted admin never sees their old admin-only entries in the Recent section.

**Activate-time guard + purge.** `activateRecent` re-checks admin status as defence in depth. If a navigate entry with `adminOnly: true` is activated by a non-admin (e.g. via a direct manager call, or if the render-time filter misses an edge case), the entry is **purged from the store** so it doesn't accumulate and palette closes silently with a warn:

```ts
if (entry.kind === 'navigate' && entry.adminOnly && !get(user)?.isAdmin) {
  console.warn('[cmdk] purging stale admin recent', entry);
  removeEntry(entry.id);
  this.close();
  return;
}
```

This requires a new `removeEntry(id: string)` export on `cmdk-recent.ts` that filters the in-memory + persisted list by id.

This prevents a demoted admin from hitting a 403 by re-activating a stored admin route AND prevents stale admin entries from lingering in localStorage forever.

## Stale-while-revalidate loading

### Manager state

```ts
batchInFlight = $state(false);
private batchInFlightStartedAt = 0;  // perf.now() at debounce start
private inFlightCounter = 0;         // providers still running for the current batch
```

### `setQuery(text)` — new rules

1. Early-return if query unchanged.
2. Assign `this.query = text`. Clear debounce. Abort previous controllers.
3. **Run navigation synchronously** by calling `runNavigationProvider(text)` immediately. Bypasses the 150 ms debounce — navigation is client-side and should feel instant. If `text.length < 2`, navigation goes to `{ status: 'idle' }`.
4. For each entity section (`photos / people / places / tags`):
   - If `sections[key].status === 'ok'` → **leave it visible**. SWR.
   - Otherwise (`idle | empty | error | timeout | loading`) → set to `{ status: 'loading' }`. Errors, timeouts, and empties do not persist across queries.
5. If `text.trim() === ''`: reset all sections to idle (existing behaviour preserved).
6. `batchInFlight = true`. `batchInFlightStartedAt = performance.now()`.
7. Start the 150 ms debounce → `runBatch`.

### `runBatch`

**`runBatch` continues to iterate only over the four entity provider keys: `['photos', 'people', 'places', 'tags']`. The `navigation` key is never passed through the debounce pipeline — it is handled synchronously in `setQuery` (step 3 below) and the navigation provider's `run` is never called from `runBatch`.** A regression test pins this: after `setQuery('x')`, the navigation provider has been invoked exactly once via the synchronous path, not again after the 150 ms debounce.

Structure otherwise unchanged, except for the in-flight counter: each entity provider's settle path (success or failure) decrements `inFlightCounter`, and when it hits zero, `batchInFlight = false`. Individual sections still update incrementally as providers return (keeps the streaming UX we already have).

`setMode`'s photos-only re-run path applies the same SWR rule and increments/decrements the counter.

### Progress stripe

A 2 px top-edge gradient stripe lives in `global-search.svelte` directly below `Command.Input`:

```svelte
{#if showProgressStripe}
  <div aria-hidden="true" class="h-0.5 bg-gradient-to-r from-transparent via-primary to-transparent animate-cmdk-shimmer"></div>
{/if}
```

`showProgressStripe = $derived.by(() => manager.batchInFlight && performance.now() - manager.batchInFlightStartedAt > 200)`. The 200 ms grace means fast queries never flash the stripe. A small `@keyframes cmdk-shimmer` in `app.css` animates `background-position`.

The stripe is plain HTML — bits-ui's `Command.Loading` is a semantic `role="progressbar"` wrapper with no visuals, and threading it through adds no value for a purely presentational 2 px bar.

### First-search cold-open exception

Cold open — all four entity sections are `idle`. The first keystroke flips them to `loading` (step 4 above) because the `idle` branch is not SWR-eligible. Skeletons appear for ~150 ms while the debounce ticks. This is intentional: there's nothing to preserve on cold open, and the skeletons provide the "something is happening" affordance. SWR kicks in from the second keystroke onward.

### Side-fix: `empty` branch missing in `GlobalSearchSection`

The existing `global-search-section.svelte` (shipped in v1) has no `empty` branch in its `#if` chain. On `empty` status it renders a bare `<Command.GroupHeading>` followed by an empty `<Command.GroupItems>` — a visible heading with no content. This is a pre-existing bug the SWR change exposes more often (because `empty` persists one more render cycle in some transitions). Fix as a side-quest in this same PR:

- Update the outer guard from `{#if status.status !== 'idle'}` to `{#if status.status !== 'idle' && status.status !== 'empty'}` so an empty section renders nothing at all.
- Add a unit test asserting that an `{ status: 'empty' }` provider state produces no `Command.GroupHeading` or `Command.Group` in the DOM.

One-line production change, one test.

## File changes

### New

- `web/src/lib/managers/navigation-items.ts` — `NAVIGATION_ITEMS` + `NavigationItem`, `NavigationCategory` types.
- `web/src/lib/managers/navigation-items.spec.ts` — schema validation + keys-match-source test.
- `web/src/lib/components/global-search/global-search-navigation-sections.svelte` — groups + renders 1–4 nav sub-sections from a flat `ProviderStatus<NavigationItem>`.
- `web/src/lib/components/global-search/rows/navigation-row.svelte` — icon + translated label + translated description.
- `web/src/lib/components/global-search/__tests__/navigation-row.spec.ts`
- `web/src/lib/components/global-search/__tests__/global-search-navigation-sections.spec.ts`

### Modified

- `web/src/lib/managers/global-search-manager.svelte.ts` — navigation provider, `runNavigationProvider`, memo cache, locale subscription (with `localeUnsubscribe` stored for test teardown), SWR rule in `setQuery`, `batchInFlight` + `inFlightCounter`, `activate` navigation branch, six section-consistency touchpoints. Feature-flag filter reads `featureFlagsManager.valueOrUndefined?.<flag>` for gated user pages.
- `web/src/lib/managers/global-search-manager.svelte.spec.ts` — new describe blocks for navigation provider, SWR, cursor integration, activate/activateRecent navigation cases, admin gating on recents, runBatch-excludes-navigation regression test, feature-flag gating test.
- `web/src/lib/components/global-search/global-search.svelte` — mount `<GlobalSearchNavigationSections>` below the four entity sections, render progress stripe, widen `ActiveItem` handling for `nav` kind, **render-time filter on `recentEntries` to drop stale admin-only `navigate` entries**.
- `web/src/lib/components/global-search/__tests__/global-search.spec.ts` — progress stripe visibility test, navigation section order test, admin vs non-admin render test, stale-admin-recent render-time filter test.
- **`web/src/lib/components/global-search/global-search-section.svelte` — side-fix: add `empty` to the outer render guard so empty sections produce no DOM.**
- **`web/src/lib/components/global-search/__tests__/global-search-section.spec.ts` (new) — pins the empty-state render-nothing behaviour.**
- `web/src/lib/components/global-search/rows/recent-row.svelte` — `navigate` kind branch.
- `web/src/lib/stores/cmdk-recent.ts` — `navigate` kind in `RecentEntry` union, `isValidRecentEntry` branch, **new `removeEntry(id)` export for admin demotion purge**.
- `web/src/lib/stores/cmdk-recent.spec.ts` — `navigate` roundtrip + validation tests + `removeEntry` tests.
- `web/src/routes/+layout.ts` — delete `commandPaletteManager.enable()` (one-line).
- `web/src/routes/+layout.svelte` — add `Shift+T` shortcut binding for theme toggle.
- `web/src/app.css` — `@keyframes cmdk-shimmer`.
- `i18n/en.json` — four section heading keys (`cmdk_section_system_settings`, `cmdk_section_admin`, `cmdk_section_user_pages`, `cmdk_section_actions`).

## Test plan

### Unit

**`navigation-items.spec.ts`:**

- `NAVIGATION_ITEMS.length === 36`.
- Per-item shape validation (non-empty required fields).
- System-settings items route pattern matches `^/admin/system-settings\?isOpen=[a-z-]+$`.
- Every system-settings `isOpen=<key>` corresponds to a real accordion key in `web/src/routes/admin/system-settings/+page.svelte` (grep-based runtime check).
- `adminOnly` correctness per category.
- Exactly one `actions` entry, id `nav:theme`, empty route.

**`global-search-manager.svelte.spec.ts` additions:**

_Navigation provider:_

- Admin user sees system-settings and admin items for matching queries.
- Non-admin user never sees admin-only items.
- **Fuzzy match inclusion, not ranking.** Typing `class` returns a result set that includes `Auto-Classification`. Typing `classific` (a strong prefix match unique to Auto-Classification) places it in the top position. Typing `storage templ` uniquely identifies Storage Template Settings as the top result. Avoid assertions on the relative ordering of two items that both match the query with similar quality — the exact scoring is an implementation detail of `bits-ui`'s `computeCommandScore` and changes between library versions.
- `minQueryLength: 2` respected: single-char query → navigation stays idle.
- Empty query → navigation stays idle, no provider call.
- Hyphenated query (`auto-class`) matches `Auto-Classification`.
- Locale change invalidates the memo cache — re-run after locale swap produces re-translated strings (mocked `svelte-i18n`). The mocked `locale` store is a `writable('en')` that tests can `set('de')` to trigger invalidation.
- **runBatch does NOT double-run navigation:** after `setQuery('x')`, the spied `runNavigationProvider` has been called exactly once (via the synchronous path in `setQuery`), not again after the 150 ms debounce tick.
- **Feature-flag gating for user pages:** items gated on `featureFlagsManager.valueOrUndefined?.<flag>` are filtered out when the flag is false. Cover at least Spaces and Memories if they are flag-gated at current Gallery — verify at implementation time. Test shape: mock `featureFlagsManager.valueOrUndefined = { search: true, spaces: false, ... }`, run provider, assert Spaces item absent.

_SWR:_

- Typing a second query while `sections.photos.status === 'ok'` does NOT flip photos to loading. Photos stay on screen until the new batch resolves.
- Typing a second query while `sections.photos.status` is `error` / `empty` / `timeout` DOES flip to loading. Those states do not SWR.
- `batchInFlight` flips true on setQuery, stays true until every provider settles, then flips false.
- Cold-open first keystroke: all sections flip to loading (idle is not SWR-eligible).

_Cursor integration:_

- `reconcileCursor` picks the first navigation item when all entity sections are empty and nav has matches.
- `getActiveItem` returns `{ kind: 'nav', data }` for `activeItemId === 'nav:<id>'`.
- `sectionForKind('nav')` returns `sections.navigation`.
- `announcementText` includes a nav count when nav has `ok` results.

_Activate / ActivateRecent:_

- `activate('navigation', themeItem)` calls `themeManager.toggleTheme()` and does NOT add a recent entry.
- `activate('navigation', settingsItem)` calls `goto(route)` and adds a `navigate` recent entry with `adminOnly: true`.
- `activateRecent` on a valid `navigate` entry: calls `goto(route)`, closes palette.
- `activateRecent` on a `navigate` entry with `adminOnly: true` and non-admin user: warns, calls `removeEntry` to purge the stale entry, does NOT navigate, closes palette. Pin both the warn and the purge.

**`cmdk-recent.spec.ts` additions:**

- `navigate` kind roundtrip (add, dedup, 20-cap, ordering).
- `isValidRecentEntry` rejects `navigate` with empty `route`, `labelKey`, or `icon`.
- **New** `removeEntry(id)` export: removes the matching entry in memory and persists the new list. Missing id is a no-op. Preserves order of remaining entries.

**`global-search-section.spec.ts` (new):**

- On `{ status: 'empty' }` the component renders nothing — no `<Command.GroupHeading>` node, no `<Command.Group>` wrapper. Pins C3 side-fix as a regression test.
- On `{ status: 'ok', items: [] }` (degenerate but possible) the component ALSO renders nothing. (Defensive.)

**`navigation-row.spec.ts`:**

- Renders translated label and description.
- Does not set `role="option"` (Command.Item wraps).

**`global-search-navigation-sections.spec.ts`:**

- Groups flat items by category at render time.
- Fixed order: systemSettings → admin → userPages → actions.
- Empty categories render nothing.
- `topN = 5` slicing per category.

**`global-search.spec.ts` additions:**

- Navigation sub-sections render below the four entity sections (DOM order).
- Admin user vs non-admin user: correct sub-sections visible.
- Progress stripe renders when `batchInFlight === true` AND elapsed > 200 ms.
- Progress stripe hidden for fast queries that settle in < 200 ms.
- Cold open → first keystroke → skeletons appear (SWR does not activate on first search).
- **Stale admin recent render-time filter:** mock a non-admin user, seed `cmdk-recent` with a `navigate` entry that has `adminOnly: true`, open the palette, confirm the Recent section does NOT include that entry's label.
- **`× N more` affordance is currently absent:** when a category returns > 5 items, the render shows exactly 5 items and no "see all" link or "+N more" indicator. Pins the current "not implemented" behaviour so a future deliberate addition is a deliberate test change.

### E2E (`global-search.e2e-spec.ts` additions)

- Type `auto` → `Auto-Classification` appears in System Settings section → Enter → URL is `/admin/system-settings?isOpen=classification` → classification accordion is visible on the page.
- Type `theme` → Theme command appears in Actions section → Enter → `document.documentElement.classList` contains the expected theme class (toggles).
- Type `asdfasdf` then type through several more characters while the entity sections are populated (seed with data first) → no skeleton elements appear between keystrokes (regression test for the jitter bug).
- Non-admin login: open palette, confirm System Settings + Admin sub-sections are absent.

### Not tested

- Per-page `CommandPaletteDefaultProvider` mounts as dead code — no pre-existing E2E coverage, so no regression to catch.
- Locale memo cache eviction — unbounded by design (~36 strings per locale, trivial).

## Known regressions (accepted)

1. **Per-page action palettes are non-functional.** The 19 per-page `CommandPaletteDefaultProvider` mounts still compile but the `Ctrl+K` binding is gone, so they cannot open. Pages that had per-page actions in the palette (asset viewer: Tag, TagPeople; album: AddAssets, Upload, Close; etc.) now only expose those actions via their existing standalone keyboard shortcuts (e.g. `t` on asset viewer for Tag) or buttons. Files are untouched to minimise fork drift against upstream rebases.
2. **`Shift+T` theme toggle** is reimplemented via `use:shortcut` in `+layout.svelte` (3 lines) because it rode along with the deleted `commandPaletteManager.enable()` call.

## Open at implementation time

- Exact labels and icons for the four section headings in `i18n/en.json`. Draft: `System Settings`, `Admin`, `User Pages`, `Actions`.
- Whether `GlobalSearchNavigationSections` renders a "× N more" affordance per category when results exceed `topN = 5`. **Deferred to v1.1** — there is no "See all" target for navigation (unlike entity sections which can link to the search page). v1 pins "no affordance" as the current behaviour via a test so the future addition is deliberate.
- **Final `NAVIGATION_ITEMS` list** — the shape is locked (category / labelKey / descriptionKey / icon / route / adminOnly / featureFlag?). What is NOT locked: which Gallery user pages declare a `featureFlag` gate. Concrete task at implementation time: inspect `ServerFeaturesDto` for the flags that gate Spaces, Memories, Sharing, Partner, etc., and set `featureFlag` on those items accordingly. The total count may dip below 36 if any user pages are collapsed (e.g. Archive / Favorites / Trash live under a single "Library" sidebar entry).
