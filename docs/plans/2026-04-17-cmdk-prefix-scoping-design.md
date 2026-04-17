# Design: cmdk Prefix Scoping (v1.2)

**Date:** 2026-04-17
**Status:** Draft — brainstorm + self-review + design-review pass applied
**Research:** [`docs/plans/research/2026-04-12-cmdk-search.md`](./research/2026-04-12-cmdk-search.md)
**Precedent:** v1 design [`2026-04-12-cmdk-search-design.md`](./2026-04-12-cmdk-search-design.md), navigation provider [`2026-04-13-cmdk-navigation-design.md`](./2026-04-13-cmdk-navigation-design.md), v1.1 albums/spaces [`2026-04-16-cmdk-v1.1-design.md`](./2026-04-16-cmdk-v1.1-design.md)
**Mockup:** [`docs/plans/mockups/cmdk-prefix-scoping.html`](./mockups/cmdk-prefix-scoping.html)
**Scope:** Web only. No server or SDK changes (one existing endpoint, `getAllPeople`, gets a new caller).

---

## Goal

Give cmdk users a keyboard-first way to scope a search to a single entity type by typing a prefix character at the start of the query:

| Prefix | Scope       | Rendered sections             |
| ------ | ----------- | ----------------------------- |
| `@`    | people      | People                        |
| `#`    | tags        | Tags                          |
| `/`    | collections | Albums + Spaces               |
| `>`    | navigation  | Navigation (admin/user/pages) |

Under a prefix, only that entity's section renders; every other section, the TopNavigationMatch promotion, and the ML-health banner are hidden. `minQueryLength` relaxes to 1 (`@a` works). Bare prefix (no chars after) renders a small "suggestions" list sorted by a sensible recency/popularity default per scope.

## Non-goals (v1.2)

- Photos and places have no prefix — photos are the headline entity and don't need scoping, places are low-volume.
- Visual chip / pill in the input — raw prefix char stays as typed. Scope hint lives in the footer and ShortcutsModal.
- Tab-to-cycle-scopes keybind — deferred; discoverability comes through the footer hint + ShortcutsModal + placeholder.
- A new endpoint for scoped search — every scoped provider reuses existing SDK methods with the stripped payload.
- Saving scoped queries into RECENT as `query` kind — no scope has a See All / submit affordance, so no new write path. Entity activations under scope still write their entity-kind RECENT entries as today. `activateRecent` replaying a saved `@alice` query works defensively (the parser re-derives from `setQuery`), but no code in v1.2 actively writes such an entry.
- Matching entity names that literally start with `@` / `#` / `/` / `>` while in scoped mode — first char is always the marker. Users must unscope to find `#christmas2025` if a tag is literally named `#christmas2025`.

---

## User-facing behavior

### Parser

Pure function `parseScope(rawText: string): ParsedQuery` at the top of `setQuery`. Trim whitespace; inspect `text[0]`; look up in a 4-entry prefix map; return scope + trimmed payload.

Pinned behavior (all verified by unit tests):

| Input           | Scope         | Payload         | Notes                                        |
| --------------- | ------------- | --------------- | -------------------------------------------- |
| `""`            | `all`         | `""`            | Empty palette state.                         |
| `"  "`          | `all`         | `""`            | Whitespace-only.                             |
| `"alice"`       | `all`         | `"alice"`       | No prefix.                                   |
| `"@alice"`      | `people`      | `"alice"`       | Canonical case.                              |
| `"@ alice"`     | `people`      | `"alice"`       | Payload trim is symmetrical.                 |
| `"@"`           | `people`      | `""`            | Bare prefix → suggestions.                   |
| `"@@alice"`     | `people`      | `"@alice"`      | Only the first char is consumed.             |
| `"abc@def"`     | `all`         | `"abc@def"`     | Prefix must be at position 0.                |
| `"$abc"`        | `all`         | `"$abc"`        | Unsupported char preserved in payload.       |
| `"＠alice"`     | `all`         | `"＠alice"`     | Fullwidth/unicode look-alike does NOT match. |
| `"/2024/trips"` | `collections` | `"/2024/trips"` | Slashes after the first are literal.         |
| `"\t@alice"`    | `people`      | `"alice"`       | Tab is whitespace; stripped by outer trim.   |

### Scope transitions

Each keystroke re-parses. `manager.query` holds the raw user text; `manager.scope` and `manager.payload` are deriveds. On scope change the prior batch is aborted and non-scope sections reset to `idle` synchronously (they do NOT SWR-preserve across scopes — displaying stale photos under `@alice` would be confusing).

Backspace-out reverts naturally: clearing the `@` returns the parser to `{ scope: 'all', payload: 'alice' }`, all sections re-enter their SWR cycle on the next debounce tick. Emptying the input returns the palette to its RECENT / quick-links empty state.

### Bare prefix suggestions

Rendered when `payload === '' && scope !== 'all'`. Each scope has its own sort:

- **`@` people** — up to 10 by face count desc. New SDK call `getAllPeople({ size: 10 })`; memoized on `manager.peopleSuggestionsCache` per open session; cache cleared in `close()`.
- **`#` tags** — top 5 from in-memory `tagsCache` sorted by `updatedAt` desc. Honors the existing `tagsDisabled` (`tagsCache > 20k`) branch.
- **`/` albums + spaces** — **two** sections: top 5 albums by `updatedAt` desc, top 5 spaces by `lastActivityAt ?? createdAt` desc (spaces DTO has no `updatedAt`; `lastActivityAt` is nullable on inactive spaces, `createdAt` is always present).
- **`>` navigation** — ALL nav items passing admin + feature-flag filters, alphabetical by translated label. No slice; typically ~36 rows for admins, ~11 for regular users after filtering.

### Keyboard: `?` opens ShortcutsModal

Pressing `?` while the palette is open — from any focus, including the `Command.Input` — calls `modalManager.show(ShortcutsModal, {})`. The palette stays open behind the modal; dismissing the modal returns focus to the input naturally.

**Explicit override policy:** a literal `?` character is unreachable via keyboard inside the palette input. Users searching for `?` in their library must paste the character. Accepted trade-off — discoverability beats the rare literal-`?` case.

### Activation paths — unchanged

Selecting a People row, Tag row, Album, Space, or nav item under a prefix uses the existing `activate('person', …)` / `activate('tag', …)` / `activateAlbum` / `activateSpace` / `activate('nav', …)` handlers. RECENT entries write as today. The scope never reaches the activation layer.

### Mobile

- **`Ctrl+K` binding** opens the palette on mobile as today.
- **Placeholder text** stays `Search…` (unchanged) — narrow viewports can't absorb the prefix hint without truncation.
- **Footer scope chip** remains visible on all breakpoints; the chip wraps to a second line if the footer overflows.
- **`?` icon button** hides below `sm` (`< 640 px`) — mobile users discover shortcuts via the existing User Settings menu, not the palette.
- **`?` keybind** still works on mobile if a keyboard is attached.

---

## Architecture

### New module: `web/src/lib/managers/cmdk-prefix.ts`

```ts
export type Scope = 'all' | 'people' | 'tags' | 'collections' | 'nav';
export type ParsedQuery = { scope: Scope; payload: string };

const PREFIX_MAP: Record<string, Scope> = {
  '@': 'people',
  '#': 'tags',
  '/': 'collections',
  '>': 'nav',
};

export function parseScope(rawText: string): ParsedQuery {
  const text = rawText.trim();
  if (text.length === 0) {
    return { scope: 'all', payload: '' };
  }
  const scope = PREFIX_MAP[text[0]];
  if (!scope) {
    return { scope: 'all', payload: text };
  }
  return { scope, payload: text.slice(1).trim() };
}
```

Pure. No reactive state. Exported for both the manager and direct unit tests.

### Manager wiring

`GlobalSearchManager` grows three $derived fields and reads them everywhere instead of `this.query`:

```ts
parsedQuery = $derived(parseScope(this.query));
scope = $derived(this.parsedQuery.scope);
payload = $derived(this.parsedQuery.payload);
```

`this.query` still holds the **raw** user text (so bi-directional mirror with `<Command.Input bind:value>` is unchanged).

#### Scope-aware `runBatch`

```ts
const ENTITY_KEYS_BY_SCOPE: Record<Scope, readonly Array<keyof Sections>> = {
  all: ['photos', 'people', 'places', 'tags', 'albums', 'spaces'],
  people: ['people'],
  tags: ['tags'],
  collections: ['albums', 'spaces'],
  nav: [],
};
```

- Iterate only the scope's keys. Every other section is forced to `idle` synchronously.
- Providers receive `this.payload`, not raw `query`.
- The `minQueryLength` check uses `payload.length >= provider.minQueryLength` when `scope === 'all'`, but relaxes to `>= 1` for any prefixed scope — the prefix already declared intent.

#### Per-provider suggestions branch

The existing `Provider.run(query, mode, signal)` contract grows a single internal check at the top:

```ts
run: async (query, mode, signal) => {
  if (query === '' && manager.scope !== 'all') {
    return runSuggestions(signal);
  }
  // existing code
};
```

No new `Provider` method. Reviewer flagged `runSuggestions?` as YAGNI — folded in.

#### Scope-aware navigation

`runNavigationProvider(payload, scope)` replaces the current `runNavigationProvider(text)`. Behavior:

| `scope`                       | `payload` | Returns                                                      |
| ----------------------------- | --------- | ------------------------------------------------------------ |
| `all`                         | any       | existing fuzzy search over admin+flag-filtered items         |
| `nav`                         | `''`      | **all** filtered items, alphabetical by translated label     |
| `nav`                         | non-empty | existing fuzzy search; payload is used in place of raw query |
| `people`/`tags`/`collections` | any       | `{ status: 'empty' }` — navigation section does not render   |

Call-site in `setQuery` updates from `runNavigationProvider(text)` to `runNavigationProvider(this.payload, this.scope)`. `navigation` remains excluded from `runBatch`'s iteration tuple.

#### SWR in scope transitions

`setQuery` is amended: before the existing `ok`-preserving SWR loop, non-scope sections **unconditionally** reset to `idle`. Scope-matching sections keep the existing SWR behavior (preserve `ok`, flip other states to `loading`).

#### `reconcileCursor` scope-aware order

```ts
const RECONCILE_ORDER_BY_SCOPE: Record<Scope, ReadonlyArray<keyof Sections>> = {
  all: ['photos', 'albums', 'spaces', 'people', 'places', 'tags', 'navigation'],
  people: ['people'],
  tags: ['tags'],
  collections: ['albums', 'spaces'],
  nav: ['navigation'],
};
```

The `all` order is pinned to render order (matching `global-search.svelte`). This tangentially fixes a pre-existing miss — the previous order was `['photos', 'people', 'places', 'tags', 'navigation']`, missing `albums` and `spaces` entirely. A regression test asserts the new order.

#### `setMode` early-return under scope

Mode switches (smart ↔ metadata ↔ description ↔ ocr) re-run the photos provider. Under any prefix, photos isn't in scope, so `setMode` early-returns when `this.scope !== 'all'`. The new `mode` value is still persisted to `localStorage` so the next unscoped search uses it — just no request fires.

#### `announcementText`

`announcementText` now emits a translated scope cue in front of the count string when `scope !== 'all'`:

```
"Scoped to People. 12 results"
```

Screen readers get an immediate mode signal on scope change; sighted users see the same change via section visibility.

### Per-scope suggestions details

**People (`@` bare)** — one new SDK caller:

```ts
this.peopleSuggestionsCache ??= await getAllPeople({ size: 10 }, { signal: this.closeSignal });
```

Bound to `closeSignal` (not per-keystroke `batchController`) so toggling `@` ↔ `@a` doesn't re-fetch. Cleared in `close()` alongside the other open-session caches. Server's default sort is face count desc; if that changes, we add an explicit client-side `.sort((a, b) => (b.faceCount ?? 0) - (a.faceCount ?? 0))` — pinned by test.

**Tags (`#` bare)** — reuse `tagsCache` (fetched on first `#` or first unscoped tags search). Sort by `updatedAt` desc, slice top 5. `tagsDisabled` branch (`tagsCache.length > 20_000`) returns the same `error: 'tag_cache_too_large'` as unscoped tag search.

**Albums + Spaces (`/` bare)** — reuse `albumsCache` + `spacesCache`. Each rendered as its own section:

- Albums: `sort by updatedAt desc`, slice 5.
- Spaces: `sort by (lastActivityAt ?? createdAt) desc`, slice 5.

**Navigation (`>` bare)** — runs synchronously off `setQuery`. Apply admin + feature-flag filter; sort alphabetically by translated label. Return every surviving item (no slice). For a typical non-admin user the filtered count is ~11; admin sees ~36.

---

## UI changes

### `global-search.svelte`

Read `manager.scope`. Render tree:

- `scope === 'all'`: unchanged. TopNavigationMatch + Photos + Albums + Spaces + People + Places + Tags + NavigationSections.
- `scope === 'people'`: only People section.
- `scope === 'tags'`: only Tags section.
- `scope === 'collections'`: Albums + Spaces sections.
- `scope === 'nav'`: only NavigationSections (consuming the nav status).

When `scope !== 'all'`:

- TopNavigationMatch promotion hidden.
- ML-health banner hidden (even when `mlHealthy === false`).
- Mode pills in the footer render at `opacity-50`; still clickable (preference persists for next unscoped search).

`onKeyDown` gains one branch: `if (e.key === '?') { modalManager.show(ShortcutsModal, {}); e.preventDefault(); }`.

### `global-search-footer.svelte`

Add a scope-chip group to the right of the existing `Ctrl+/ cycle` hint, and a `?` icon button at the far right:

```
[smart | filename | description | ocr]         Ctrl+/  cycle    @ # / >  scope    [?]
```

Both kbd groups share `font-mono text-[11px] text-gray-500`. No bullet separator. The `?` icon uses `mdiHelpCircleOutline` at `h-4 w-4` inside an `IconButton`-like affordance with `aria-label={$t('cmdk_show_shortcuts')}`. Hidden on `<sm`.

Single `onclick` → `modalManager.show(ShortcutsModal, {})`, same dispatch as the keybind.

### Placeholder

`cmdk_placeholder` stays `Search…`. The footer carries discoverability; the placeholder stays calm.

### `ShortcutsModal.svelte`

New "Scope prefixes" section, four rows using the existing `rounded-lg bg-primary/25 p-2` kbd-box style so they read as peers of the existing `Ctrl+K` / `Shift+T` rows:

```
@   Search people
#   Search tags
/   Search albums & spaces
>   Jump to pages
```

English copy uses "Albums & Spaces", not "Collections" (the internal `Scope` type is `collections`). Heading `$t('cmdk_shortcut_scope_heading')` = "Scope prefixes".

---

## Accessibility

- `announcementText` emits scope cue on scope change (existing `aria-live="polite"` region).
- `?` keybind preserves focus on the input; ShortcutsModal opens on top and returns focus on dismiss.
- Mode pills under scope are visually dim but remain focusable and clickable — no `aria-disabled`. A click updates the durable preference without firing a request.
- Footer scope chip is decorative; a screen-reader walk of the footer still reads `Ctrl+/ cycle, @ # / > scope, Keyboard shortcuts` (the `?` icon has an `aria-label`).

---

## Edge cases

| Case                                                      | Handling                                                                               |
| --------------------------------------------------------- | -------------------------------------------------------------------------------------- |
| `getAllPeople` 5 s timeout on bare `@`                    | section transitions to `{ status: 'timeout' }`; palette shows "Search is slow" hint    |
| `getAllPeople` network failure                            | section transitions to `{ status: 'error' }`                                           |
| `/` while `albumsCache` / `spacesCache` is mid-fetch      | keystrokes join the in-flight promise; last settled run writes results                 |
| Scope transition mid-batch (`al` → `@al`)                 | `batchController.abort()` cancels prior; non-people sections forced idle synchronously |
| Rapid scope thrash (`@`/`#`/`/`)                          | each keystroke re-parses; abort + idle on every transition                             |
| `#` bare with `tagsDisabled === true`                     | returns `error: 'tag_cache_too_large'` same as unscoped tag search                     |
| `>` bare for non-admin with restrictive flags             | returns `{ status: 'empty' }` not `{ status: 'ok', items: [] }`                        |
| `Esc` while ShortcutsModal is open over palette           | modal closes first, focus returns to palette input; palette stays open                 |
| Tag literally named `#christmas` under `#christmas` query | unreachable (first `#` always consumed); user must search unscoped                     |
| Album literally named `@2024` under `@` scope             | unreachable (first `@` always consumed); user must search unscoped                     |

---

## Tests

### Unit — `cmdk-prefix.spec.ts`

Table-driven over the parser behavior table above. Every row → one test case. Additional:

- Input `@` + 255 chars — parser stable.
- Only-prefix + space + space → bare scope.
- `\t@alice` → same as `@alice` (outer trim).
- Fullwidth prefixes (`＠`, `＃`, `／`, `＞`) — unscoped.

### Unit — `global-search-manager.svelte.spec.ts`

_Scope derivations:_

- `setQuery('@alice')` → scope `people`, payload `alice`.
- Clearing to `''` → scope `all`.
- Keystroke-by-keystroke over `@` → `@a` → `@al` preserves `people` scope.

_runBatch gating:_

- Scope `people`: only `providers.people.run` invoked; photos/albums/spaces/places/tags **forced to idle** even if previously `ok`.
- Scope `collections`: albums + spaces providers invoked; others idle.
- Scope `nav`: `runBatch` iteration tuple is empty (`ENTITY_KEYS_BY_SCOPE.nav === []`); nav section populated via synchronous `runNavigationProvider(payload, scope)`.

_Bare-prefix suggestions:_

- `@` bare → `getAllPeople({ size: 10 })` called once. Subsequent `@` re-types read `peopleSuggestionsCache`. `close()` clears the cache.
- `#` bare → tagsCache sorted by updatedAt desc, top 5.
- `#` bare under `tagsDisabled` → `error: 'tag_cache_too_large'`.
- `/` bare → albums sort by `updatedAt`; spaces sort by `lastActivityAt ?? createdAt`. Two independent section writes.
- `>` bare → admin + feature-flag filtered, alphabetical, all items.
- `>` bare for a non-admin with restrictive flags returns `empty`.

_Cursor:_

- `all` reconcile order is `['photos', 'albums', 'spaces', 'people', 'places', 'tags', 'navigation']` (regression pin).
- Scope transition drops the cursor onto the first item of the first in-scope section when prior cursor target exits scope.
- `/trip` lands on the first album (albums before spaces).

_SWR / scope transitions:_

- `all` → `people` flips non-people sections from `ok` to `idle` **immediately** (not preserved).
- Within-scope payload change preserves `ok` sections (existing SWR).
- Scope transition mid-batch aborts prior `batchController`.

_setMode while scoped:_

- `setMode('metadata')` while `scope === 'people'` persists mode to localStorage but does NOT re-run photos.
- Clicking a mode pill under scope updates `manager.mode` without dispatching a request.

_announcementText:_

- Scope `@` → contains translated "Scoped to People" prefix.
- Symmetric for `#` tags, `/` collections, `>` nav.

_Concurrency (new describe block):_

- Scope transition mid-batch: prior providers abort; non-scope sections reset synchronously.
- Rapid scope thrash (`@` → `#` → `/`): each transition aborts cleanly, counter bookkeeping stays consistent.
- `/` while `albumsCache` promise is in-flight: both keystrokes await the same promise, last one writes results.
- `getAllPeople` cancellation via `closeSignal` on palette close clears `peopleSuggestionsCache`.
- `getAllPeople` 5 s timeout: section transitions to `timeout`.
- `getAllPeople` network error: section transitions to `error`.

_Recent replay (defensive):_

- `activateRecent({ kind: 'query', text: '@alice', mode: 'smart' })` (synthetic entry) → `setQuery('@alice')` → scope derives to `people`, payload `alice`.

### Component — `global-search.spec.ts`

- Scope `people`: only PeopleSection present; no PhotoSection / AlbumSection / SpaceSection / PlaceSection / TagSection / NavigationSection / TopResult / ML banner.
- Scope `collections`: AlbumSection + SpaceSection present; others hidden.
- Scope `nav`: NavigationSections present; others hidden.
- Placeholder text is exactly `Search…`.
- `?` keypress on the input calls `modalManager.show(ShortcutsModal, {})` (spy).
- Mode pills under scope carry `opacity-50` class.
- ML banner: with `mlHealthy = false`, visible under scope `all`, hidden under any prefixed scope.
- TopNavigationMatch: present under `all` when label matches, hidden under any prefixed scope.
- Preview pane: under `@alice` with Alice highlighted, PersonPreview renders; under `>` with a nav item highlighted, preview falls through to the "Select a result to preview" empty state.

### Component — `global-search-footer.spec.ts`

- Both kbd groups render (`Ctrl+/` cycle, `@ # / >` scope).
- `?` icon button present on `sm+` breakpoint; hidden on `<sm`.
- Clicking `?` invokes `modalManager.show(ShortcutsModal, {})` (spy).

### E2E — `global-search.e2e-spec.ts`

- **Scope `@`:** type `@al` → only People visible → Enter Alice → `/people/<id>`, RECENT writes `person:` entry.
- **Scope `/`:** type `/ja` → Albums + Spaces sections filter by "ja" → activate album → route.
- **Scope `>`:** type `>theme` → nav-theme highlighted → Enter → `document.documentElement` theme class toggles.
- **Bare `#`:** type `#` → top tag suggestions render; no extra server round-trip beyond the initial catalog fetch.
- **Bare `@`:** type `@` → top-10 people render; one `getAllPeople` request observed.
- **Backspace-out:** type `@alice` → Backspace × 5 → `@` bare → suggestions; Backspace again → empty palette.
- **Scope swap mid-stream:** type `@al`, Backspace × 3, type `#sun` — no stale sections; only Tags renders at end.
- **`?` opens modal:** palette open → press `?` → ShortcutsModal visible with "Scope prefixes" section; close modal, palette still open with focus on input.
- **`?` overrides literal:** palette input empty → press `?` → ShortcutsModal opens (not a literal `?` in input).
- **Stale album under scope:** scoped `/trip`, activate an album that was deleted server-side → 404 toast + RECENT purge (same path as unscoped activation).

### Manual visual QA

- 1024 px / 720 px / 480 px, light + dark mode: footer chip renders without overflow; `?` icon hides below `sm`.
- Dimmed mode pills are visibly muted but not confused for "disabled" grey.
- Scope transition is snappy — no flash of stale sections between keystrokes (SWR-correct).

---

## File changes

### New

- `web/src/lib/managers/cmdk-prefix.ts` — parser + `Scope` / `ParsedQuery` types.
- `web/src/lib/managers/cmdk-prefix.spec.ts` — parser unit tests.

### Modified

- `web/src/lib/managers/global-search-manager.svelte.ts` — parsedQuery/scope/payload deriveds, scope-aware runBatch + reconcileCursor, scope-aware runNavigationProvider signature, per-provider bare-prefix branch, peopleSuggestionsCache, scope emission in announcementText, setMode scope short-circuit.
- `web/src/lib/managers/global-search-manager.svelte.spec.ts` — new describe blocks per §Tests Unit.
- `web/src/lib/components/global-search/global-search.svelte` — scope-aware section rendering, hidden TopResult + ML banner under scope, dim mode pills, `?` keybind.
- `web/src/lib/components/global-search/__tests__/global-search.spec.ts` — scope render cases, preview cases, `?` keybind.
- `web/src/lib/components/global-search/global-search-footer.svelte` — scope chip group + `?` icon button (hidden below `sm`).
- `web/src/lib/components/global-search/__tests__/global-search-footer.spec.ts` — chip + `?` icon tests.
- `web/src/lib/modals/ShortcutsModal.svelte` — "Scope prefixes" section with 4 kbd-box rows.
- `i18n/en.json` — `cmdk_scope_hint_footer`, `cmdk_show_shortcuts`, `cmdk_shortcut_scope_heading`, `cmdk_shortcut_scope_people`, `cmdk_shortcut_scope_tags`, `cmdk_shortcut_scope_collections`, `cmdk_shortcut_scope_nav`, `cmdk_announce_scoped_people`, `cmdk_announce_scoped_tags`, `cmdk_announce_scoped_collections`, `cmdk_announce_scoped_nav`. Sorted via `pnpm --filter=immich-i18n format:fix`.
- `e2e/src/specs/web/global-search.e2e-spec.ts` — new E2E cases per §Tests E2E.

---

## Migration / rollout

- No server changes. No SDK regeneration. No new migrations.
- No new feature flag — `featureFlagsManager.value.search` continues to gate the whole surface.
- Existing unscoped queries dispatch identically (`parseScope('alice') = { scope: 'all', payload: 'alice' }`).
- Existing RECENT entries replay without change. No `cmdk-recent.ts` schema change.
- Deploy in one PR. No phased rollout needed.

---

## Risks

1. **`getAllPeople` default sort** may not be face-count desc on all server versions. Mitigation: verify at implementation time; add explicit client-side sort if the default is different. Pin the sort with a unit test so a server change can't silently drift it.
2. **`?` override** prevents literal `?` input in the palette. Accepted trade-off, documented above.
3. **Mobile `?` icon hidden below `sm`** means mobile users with a Bluetooth keyboard can still use the `?` keybind, but the tap affordance is gone. Acceptable — mobile users rarely need keyboard reference.
4. **`parseScope` runs on every keystroke** as a $derived. Cost is O(1) per keystroke (one trim, one map lookup, one slice) — negligible.
5. **Pre-existing `reconcileCursor` miss** (albums/spaces absent from the order) gets tangentially fixed. Regression test pins the new order; if someone later re-removes albums/spaces from the order, the test will flag it.

---

## Implementation sequence (skeleton for the follow-up plan)

Not a plan doc — rough order for `superpowers:writing-plans`:

1. **Parser module + unit tests** — `cmdk-prefix.ts` + `cmdk-prefix.spec.ts`, table-driven.
2. **Manager deriveds** — `parsedQuery` / `scope` / `payload`; unit tests for derivation.
3. **`runBatch` scope gating + ENTITY_KEYS_BY_SCOPE** — non-scope sections to idle; scope-aware dispatch.
4. **`reconcileCursor` scope-aware order** — including the `all`-case regression fix.
5. **Per-provider bare-prefix branch** — each provider's `run()` gets the `payload === '' && scope !== 'all'` check.
6. **`peopleSuggestionsCache`** + `getAllPeople` call wiring, cleared on close.
7. **`runNavigationProvider(payload, scope)` signature change** + call-site update.
8. **`setMode` scope short-circuit.**
9. **`announcementText` scope emission.**
10. **SWR tweak** — non-scope sections force-idle on scope transition.
11. **`global-search.svelte` scope-aware rendering** + `?` keybind.
12. **Footer scope chip + `?` icon button** + `<sm` hide.
13. **ShortcutsModal "Scope prefixes" section** + kbd-box rows.
14. **i18n keys** + sort.
15. **Component + E2E tests.**
16. **Manual visual QA at 1024/720/480, light + dark.**
