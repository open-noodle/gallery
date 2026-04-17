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

| Input           | Scope         | Payload        | Notes                                                                                            |
| --------------- | ------------- | -------------- | ------------------------------------------------------------------------------------------------ |
| `""`            | `all`         | `""`           | Empty palette state.                                                                             |
| `"  "`          | `all`         | `""`           | Whitespace-only.                                                                                 |
| `"alice"`       | `all`         | `"alice"`      | No prefix.                                                                                       |
| `"@alice"`      | `people`      | `"alice"`      | Canonical case.                                                                                  |
| `"@ alice"`     | `people`      | `"alice"`      | Payload trim is symmetrical.                                                                     |
| `"@"`           | `people`      | `""`           | Bare prefix → suggestions.                                                                       |
| `"#"`           | `tags`        | `""`           | Bare prefix.                                                                                     |
| `"/"`           | `collections` | `""`           | Bare prefix.                                                                                     |
| `">"`           | `nav`         | `""`           | Bare prefix.                                                                                     |
| `"@@alice"`     | `people`      | `"@alice"`     | Only the first char is consumed; literal `@` stays in payload.                                   |
| `"abc@def"`     | `all`         | `"abc@def"`    | Prefix must be at position 0.                                                                    |
| `"$abc"`        | `all`         | `"$abc"`       | Unsupported char preserved in payload.                                                           |
| `"＠alice"`     | `all`         | `"＠alice"`    | Fullwidth/unicode look-alike does NOT match.                                                     |
| `"/2024/trips"` | `collections` | `"2024/trips"` | First `/` is consumed; subsequent slashes stay literal. Payload does NOT retain the leading `/`. |
| `"\t@alice"`    | `people`      | `"alice"`      | Tab is whitespace; stripped by outer trim.                                                       |

### Scope transitions

Each keystroke re-parses. `manager.query` holds the raw user text; `manager.scope` and `manager.payload` are deriveds. On scope change the prior batch is aborted and non-scope sections reset to `idle` synchronously (they do NOT SWR-preserve across scopes — displaying stale photos under `@alice` would be confusing).

Backspace-out reverts naturally: clearing the `@` returns the parser to `{ scope: 'all', payload: 'alice' }`, all sections re-enter their SWR cycle on the next debounce tick. Emptying the input returns the palette to its RECENT / quick-links empty state.

### Bare prefix suggestions

Rendered when `payload === '' && scope !== 'all'`. Each scope has its own sort:

- **`@` people** — up to 10 by `updatedAt` desc (name alpha / id stable tie-break). `PersonResponseDto` has no `numberOfAssets` / `faceCount` field, so `updatedAt` is the closest recency proxy. Implemented by `personSuggestionsComparator` in `cmdk-prefix.ts`. New SDK call `getAllPeople({ size: 10 })`; memoized on `manager.peopleSuggestionsCache` per open session; cache cleared in `close()`.
- **`#` tags** — top 5 from in-memory `tagsCache` sorted by `updatedAt` desc. Honors the existing `tagsDisabled` (`tagsCache > 20k`) branch.
- **`/` albums + spaces** — **two** sections: top 5 albums by `endDate ?? ''` desc, top 5 spaces by `lastActivityAt ?? createdAt` desc. `AlbumNameDto` (from `getAlbumNames`) has no `updatedAt` field, so `endDate` — "most recent photo in the album" — is the activity proxy. Albums with no `endDate` sink to the bottom. Spaces DTO has no `updatedAt`; `lastActivityAt` is nullable on inactive spaces, `createdAt` is always present.
- **`>` navigation** — ALL nav items passing admin + feature-flag filters, alphabetical by translated label. No slice; typically ~36 rows for admins, ~11 for regular users after filtering.

### Keyboard: `?` opens ShortcutsModal

Pressing `?` while the palette is open — from any focus, including the `Command.Input` — calls `modalManager.show(ShortcutsModal, {})`. The palette stays open behind the modal; dismissing the modal returns focus to the input naturally.

**Explicit override policy:** a literal `?` character is unreachable via keyboard inside the palette input. Users searching for `?` in their library must paste the character. Accepted trade-off — discoverability beats the rare literal-`?` case.

**Modifier combinations:** only a bare `?` (no Ctrl / Alt / Meta; Shift is implicit since `?` on most layouts is `Shift+/`) fires the modal. `Ctrl+?` / `Alt+?` fall through to the input as today (no-op in the default Gallery key map). Pinned by a keydown test so future handlers can't silently steal the combinations.

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
- **minQueryLength gate:**
  - `scope === 'all'`: `payload.length >= provider.minQueryLength` (existing rule).
  - `scope !== 'all' && payload.length > 0`: relaxed to `>= 1` (the prefix already declared intent; e.g. `@a` is valid for People's minQueryLength=2).
  - `scope !== 'all' && payload === ''`: **bypass the gate entirely and dispatch directly** — the provider takes its suggestions branch (bare `@`, `#`, `/` → provider.run(payload='')). Without this bypass, `0 < minQueryLength` would set the section to idle and suggestions would never render.

#### Per-provider suggestions branch

The existing `Provider.run(query, mode, signal)` contract grows a single internal check at the top:

```ts
run: async (query, mode, signal) => {
  // `query` here is the payload, not raw user text. runBatch only dispatches this
  // branch under a prefix scope (the empty-text branch of setQuery short-circuits
  // before runBatch is invoked), so query === '' uniquely identifies the
  // bare-prefix case. No need to read `manager.scope` — avoids a mid-async live-
  // state read that could race with scope transitions.
  if (query === '') {
    return runSuggestions(signal);
  }
  // existing code
};
```

No new `Provider` method. Reviewer flagged `runSuggestions?` as YAGNI — folded in.

#### Scope-aware navigation

`runNavigationProvider(payload, scope)` replaces the current `runNavigationProvider(text)`. Behavior:

| `scope`                       | `payload` | Returns                                                                                                                            |
| ----------------------------- | --------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| `all`                         | `''`      | `{ status: 'empty' }` — matches today's behavior; `setQuery`'s empty-text branch already resets sections to idle before this call. |
| `all`                         | non-empty | existing fuzzy search over admin+flag-filtered items                                                                               |
| `nav`                         | `''`      | **all** filtered items, alphabetical by translated label                                                                           |
| `nav`                         | non-empty | existing fuzzy search; payload is used in place of raw query                                                                       |
| `people`/`tags`/`collections` | any       | `{ status: 'empty' }` — navigation section does not render                                                                         |

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

**People (`@` bare)** — one new SDK caller, with a promise-join pattern mirroring `ensureAlbumsCache` / `ensureSpacesCache`:

```ts
private peoplePromise: Promise<void> | undefined;
peopleSuggestionsCache: PersonResponseDto[] | undefined = $state(undefined);

async ensurePeopleSuggestionsCache(): Promise<void> {
  if (this.peopleSuggestionsCache !== undefined) return;
  this.peoplePromise ??= this.fetchPeopleSuggestions();
  return this.peoplePromise;
}

private async fetchPeopleSuggestions(): Promise<void> {
  try {
    // Response shape is verified at implementation time — see §Risks #1.
    // Treat `response.people` as the canonical access for this design; swap
    // to the actual field name during the pre-impl check.
    const response = await getAllPeople({ size: 10 }, { signal: this.closeSignal });
    this.peopleSuggestionsCache = [...response.people].sort(personSuggestionsComparator);
  } catch (error: unknown) {
    if (error instanceof Error && error.name === 'AbortError') return;
    // Stale-rejection guard: a bare-@ fetch that rejects AFTER the user has
    // moved to `@alice` (where searchPerson wrote fresh ok results) must not
    // stomp those results with an error state. Only write the error if the
    // manager is still in the bare-@ state that kicked off this fetch.
    if (this.scope === 'people' && this.payload === '') {
      this.sections.people = { status: 'error', message: error instanceof Error ? error.message : 'unknown error' };
    }
    throw error;
  }
}
```

The people provider's `run()` wires it in:

```ts
run: async (query, mode, signal) => {
  if (query === '') {
    await this.ensurePeopleSuggestionsCache();
    if (this.peopleSuggestionsCache === undefined) {
      // fetchPeopleSuggestions already transitioned the section to 'error' (or
      // no-op'd via AbortError); return the current section state.
      return this.sections.people;
    }
    const items = this.peopleSuggestionsCache.slice(0, 10);
    return items.length === 0 ? { status: 'empty' } : { status: 'ok', items, total: items.length };
  }
  // existing searchPerson code path for non-empty payload
};
```

- **Concurrency:** concurrent `@` retypes join the same in-flight `peoplePromise`; `getAllPeople` fires at most once per open session. Without this pattern, typing `@ → @a → @` fast enough to race the first fetch would fire two concurrent calls. Pinned by a concurrency test.
- **Stale rejection:** the guard above prevents a late-arriving rejection from stomping over fresh non-bare results.
- **Clear lifecycle:** both `peopleSuggestionsCache` and `peoplePromise` are reset in `open()`, mirroring the existing pattern for `albumsPromise` / `spacesPromise` (see `global-search-manager.svelte.ts:355-356`). `close()` only aborts `closeController`; it does not touch the promise/cache fields. This keeps all open-session lazy caches on a single "reset on open" rule.
- **Rejection stickiness within session:** if the first bare-`@` fetch rejects, `peoplePromise` retains the rejection for the remainder of the open session — subsequent bare-`@` re-types read the same rejected promise. User must close + reopen to retry. **Accepted limitation**, consistent with `ensureAlbumsCache` / `ensureSpacesCache` today.
- **Sort key:** `personSuggestionsComparator` is applied client-side regardless of server default. **The exact sort key is open** — see §Risks for the `PersonResponseDto` field verification that unblocks this. Comparator is a small pure function exported alongside the manager and covered by a table-driven test.

**Tags (`#` bare)** — reuse `tagsCache` (fetched on first `#` or first unscoped tags search). Sort by `updatedAt` desc, slice top 5. `tagsDisabled` branch (`tagsCache.length > 20_000`) returns the same `error: 'tag_cache_too_large'` as unscoped tag search.

**Albums + Spaces (`/` bare)** — reuse `albumsCache` + `spacesCache`. Each rendered as its own section:

- Albums: `sort by endDate desc`, slice 5. `AlbumNameDto` (returned by `getAlbumNames`) has no `updatedAt` field; `endDate` is "most recent photo in the album" and is a better activity proxy anyway. Missing `endDate` sinks to the bottom.
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

| Case                                                         | Handling                                                                                                      |
| ------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------- |
| `getAllPeople` 5 s timeout on bare `@`                       | section transitions to `{ status: 'timeout' }`; palette shows "Search is slow" hint                           |
| `getAllPeople` network failure                               | section transitions to `{ status: 'error' }`                                                                  |
| Concurrent bare `@` retypes racing first fetch               | callers join `peoplePromise`; `getAllPeople` fires exactly once                                               |
| Stale bare-`@` rejection arrives after `@alice` resolved     | `scope === 'people' && payload === ''` guard skips the error write; fresh `ok` results preserved              |
| `peoplePromise` rejection within session                     | sticks until close + reopen (accepted, matches `ensureAlbumsCache` / `ensureSpacesCache`)                     |
| `/` while `albumsCache` / `spacesCache` is mid-fetch         | keystrokes join the in-flight promise; last settled run writes results                                        |
| Scope transition mid-batch (`al` → `@al`)                    | `batchController.abort()` cancels prior; non-people sections forced idle synchronously                        |
| Rapid scope thrash (`@`/`#`/`/`)                             | each keystroke re-parses; abort + idle on every transition                                                    |
| Scope transition preserves cursor when target stays in scope | `alice` → `@alice`: cursor on Alice stays on Alice (People still in scope)                                    |
| Scope transition reconciles cursor when target exits scope   | `@alice` → `#alice`: cursor drops to first tag row                                                            |
| Scope away → scope back (`alice` → `@alice` → `alice`)       | no stranded `idle` sections; SWR-normal state                                                                 |
| Bare `@` with zero named people                              | section `{ status: 'empty' }`                                                                                 |
| Bare `#` with empty `tagsCache`                              | section `{ status: 'empty' }`                                                                                 |
| Bare `#` with `tagsDisabled === true`                        | returns `error: 'tag_cache_too_large'` same as unscoped tag search                                            |
| Bare `/` with zero albums AND zero spaces                    | both sections `{ status: 'empty' }`                                                                           |
| Bare `/` with mixed empty (albums ok, spaces empty or vv.)   | one section `ok`, the other `empty` independently                                                             |
| Bare `>` for non-admin with restrictive flags                | returns `{ status: 'empty' }` not `{ status: 'ok', items: [] }`                                               |
| Bare `>` for admin (~36 items)                               | all render, `Command.List` scrolls; palette height stays within `max-h-[80vh]`                                |
| `Ctrl+?` / `Alt+?` in palette input                          | modifier combinations fall through to input; only bare `?` opens ShortcutsModal                               |
| `?` pressed while input has text                             | ShortcutsModal opens; literal `?` not inserted (accepted trade-off)                                           |
| `Esc` while ShortcutsModal is open over palette              | modal closes first, focus returns to palette input; palette stays open                                        |
| Mode pill click under scope                                  | `manager.mode` + localStorage updated; no `runBatch`, no photos request                                       |
| `parseScope('/2024/trips')`                                  | scope `collections`, payload `2024/trips` (first `/` consumed); album named `/2024/...` unreachable under `/` |
| Tag literally named `#christmas` under `#christmas` query    | unreachable (first `#` always consumed); user must search unscoped                                            |
| Album literally named `@2024` under `@` scope                | unreachable (first `@` always consumed); user must search unscoped                                            |

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
- **minQueryLength bypass on bare prefix:** scope `people` with `payload === ''` dispatches the people provider even though payload length `< people.minQueryLength = 2`. Without this bypass the provider would be set to idle and suggestions would never render.
- **Provider bare-prefix routing:** the people provider's `run('' , mode, signal)` routes into `ensurePeopleSuggestionsCache`, NOT into `searchPerson`. Spy `searchPerson` and assert zero calls in this path.

_Bare-prefix suggestions:_

- `@` bare → `getAllPeople({ size: 10 })` called once. Subsequent `@` re-types read `peopleSuggestionsCache`. `close()` clears the cache.
- `@ → @a → @` sequence: second `@` reads cache; `getAllPeople` called exactly once.
- Bare `@` with zero named people → section `{ status: 'empty' }`.
- `#` bare → tagsCache sorted by `updatedAt` desc, top 5.
- `#` bare under `tagsDisabled` → `error: 'tag_cache_too_large'`.
- `#` bare with empty `tagsCache` → `{ status: 'empty' }`.
- `/` bare → albums sort by `endDate` desc; spaces sort by `lastActivityAt ?? createdAt`. Two independent section writes.
- `/` bare with zero albums AND zero spaces → both sections `{ status: 'empty' }`.
- `/` bare with **mixed empty** (e.g. 5 albums, 0 spaces) → albums `ok`, spaces `empty`. Symmetric for 0 albums, 5 spaces.
- `>` bare → admin + feature-flag filtered, alphabetical, all items. No slice; assert the rendered count equals the filtered catalog length.
- `>` bare for a non-admin with restrictive flags returns `empty`.

_`personSuggestionsComparator` (pure function):_

- Sorts descending by the chosen recency/popularity key (exact key set at implementation time — see §Risks).
- Stable ordering: ties break by the field that's always present (fallback to `name` alpha).
- Same-name tie-break: two people with identical names break by `id` for deterministic order (prevents test flakiness on fixtures with duplicate names).
- Handles missing optional field (returns 0 contribution; no crash).

_Cursor:_

- `all` reconcile order is `['photos', 'albums', 'spaces', 'people', 'places', 'tags', 'navigation']` (regression pin).
- Scope transition drops the cursor onto the first item of the first in-scope section when prior cursor target exits scope.
- **Scope transition preserves cursor** when the prior target is in the new scope. Case: cursor on Alice (People section) under `all` → prepend `@` → scope `people` → cursor STILL on Alice.
- `/trip` lands on the first album (albums before spaces).

_SWR / scope transitions:_

- `all` → `people` flips non-people sections from `ok` to `idle` **immediately** (not preserved).
- Within-scope payload change preserves `ok` sections (existing SWR).
- Scope transition mid-batch aborts prior `batchController`.
- Scope-away → Scope-back: `alice` → `@alice` → `alice` leaves all sections in SWR-normal state (no stranded `idle`).

_setMode while scoped:_

- `setMode('metadata')` while `scope === 'people'` persists mode to localStorage but does NOT re-run photos.
- Clicking a mode pill under scope updates `manager.mode` without dispatching a request — spy on `searchSmart` / `searchAssets` (SDK-level, stable) and assert neither is called; `photosController` is not aborted/recreated.

_announcementText:_

- Scope `@` → contains translated "Scoped to People" prefix.
- Symmetric for `#` tags, `/` collections, `>` nav.

_Concurrency (new describe block):_

- Scope transition mid-batch: prior providers abort; non-scope sections reset synchronously.
- Rapid scope thrash (`@` → `#` → `/`): each transition aborts cleanly, counter bookkeeping stays consistent.
- `/` while `albumsCache` promise is in-flight: both keystrokes await the same promise, last one writes results.
- **Concurrent bare `@` keystrokes** (`@ → @a → @` racing the first fetch): both callers join the same `peoplePromise`; `getAllPeople` is called **exactly once** (spy assertion).
- `getAllPeople` cancellation via `closeSignal` on palette close; `open()` then resets both `peopleSuggestionsCache` and `peoplePromise` to `undefined` so typing `@` in the next session re-fires exactly once. (Matches `albumsPromise` / `spacesPromise` reset-on-open pattern.)
- `getAllPeople` 5 s timeout: section transitions to `timeout`.
- `getAllPeople` network error: section transitions to `error`.
- **Stale bare-`@` rejection after scope change:** start bare `@` fetch, transition to `@alice` which resolves via `searchPerson` and writes `sections.people = ok`, then reject the original bare-`@` fetch. Assert `sections.people` remains `ok` (the `scope === 'people' && payload === ''` guard skips the error write).

_Recent replay (defensive):_

- `activateRecent({ kind: 'query', text: '@alice', mode: 'smart' })` (synthetic entry) → `setQuery('@alice')` → scope derives to `people`, payload `alice`.

### Component — `global-search.spec.ts`

- Scope `people`: only PeopleSection present; no PhotoSection / AlbumSection / SpaceSection / PlaceSection / TagSection / NavigationSection / TopResult / ML banner.
- Scope `collections`: AlbumSection + SpaceSection present; others hidden.
- Scope `nav`: NavigationSections present; others hidden.
- Placeholder text is exactly `Search…` (string equality, not `toContain`).
- `?` keypress on the input calls `modalManager.show(ShortcutsModal, {})` (spy).
- **`?` keydown reaches our handler** — regression guard against bits-ui `Command.Input` consuming the key. Dispatch a `?` keydown event on the input element and assert the modalManager spy fires. Pins the current bits-ui version's key handling; a future upgrade that starts consuming `?` would fail this test.
- `?` with modifier (`Ctrl+?` / `Alt+?`) does NOT trigger the modal — falls through to input.
- **Mode pills under scope (a11y):**
  - Carry `opacity-50` class.
  - Do NOT carry `aria-disabled` attribute.
  - Remain focusable via Tab order.
  - Clicking sets `manager.mode`, persists to localStorage, does NOT call `searchSmart` / `searchAssets` (SDK spy — more stable target than spying on the protected `runBatch` method).
- ML banner: with `mlHealthy = false`, visible under scope `all`, hidden under any prefixed scope.
- TopNavigationMatch: present under `all` when label matches, hidden under any prefixed scope.
- **Preview pane per scope:**
  - `@alice` + Alice highlighted → PersonPreview renders.
  - `#xmas` + a tag highlighted → TagPreview renders.
  - `/trip` + album highlighted → AlbumPreview renders; spaces row highlighted → SpacePreview renders.
  - `>theme` + nav-theme highlighted → preview pane renders _something non-crashing_. Exact behavior — either the empty-state "Select a result to preview" OR a nav-specific preview — is pinned by this test against the **actual** current implementation of `GlobalSearchPreview` (see §Risks for the pre-implementation verification).
- **`>` bare scroll:** with an admin user and a filtered catalog of 36 items, all 36 render in the DOM; the `Command.List` container scrolls (height is not growing unbounded).

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
- **Cursor preservation across scope transition:** type `alice`, arrow-down to Alice (cursor on `person:<id>`), prepend `@` (input now `@alice`), cursor **stays** on Alice → Enter → navigates to `/people/<id>` correctly.
- **`?` opens modal:** palette open → press `?` → ShortcutsModal visible with "Scope prefixes" section; close modal, palette still open with focus on input.
- **`?` overrides literal:** palette input empty → press `?` → ShortcutsModal opens (not a literal `?` in input).
- **`>` bare scroll for admin:** type `>` as admin → all ~36 filtered items render → scrolling the list doesn't grow the palette height past its `max-h-[80vh]` cap.
- **`@` retry after failure:** intercept `getAllPeople` to fail on first call → type `@` → section renders `error` state → close palette → re-intercept to succeed → reopen palette → type `@` → top-10 people render. Validates `close()` resets `peoplePromise` end-to-end.
- **Stale album under scope:** scoped `/trip`, activate an album that was deleted server-side → 404 toast + RECENT purge (same path as unscoped activation).

### Manual visual QA

- 1024 px / 720 px / 480 px, light + dark mode: footer chip renders without overflow; `?` icon hides below `sm`.
- Dimmed mode pills are visibly muted but not confused for "disabled" grey.
- Scope transition is snappy — no flash of stale sections between keystrokes (SWR-correct).

---

## File changes

### New

- `web/src/lib/managers/cmdk-prefix.ts` — parser + `Scope` / `ParsedQuery` types + `personSuggestionsComparator` pure function.
- `web/src/lib/managers/cmdk-prefix.spec.ts` — parser + comparator unit tests.

### Modified

- `web/src/lib/managers/global-search-manager.svelte.ts` — parsedQuery/scope/payload deriveds, scope-aware runBatch + reconcileCursor, scope-aware runNavigationProvider signature, per-provider bare-prefix branch, `ensurePeopleSuggestionsCache` + `peopleSuggestionsCache` + `peoplePromise`, scope emission in announcementText, setMode scope short-circuit.
- `web/src/lib/managers/global-search-manager.svelte.spec.ts` — new describe blocks per §Tests Unit.
- `web/src/lib/components/global-search/global-search.svelte` — scope-aware section rendering, hidden TopResult + ML banner under scope, dim mode pills, `?` keybind.
- `web/src/lib/components/global-search/global-search-preview.svelte` — (conditional on pre-implementation check) add `{:else if activeItem?.kind === 'nav'}` branch rendering the empty-state markup, if the component currently has no fall-through for nav active items.
- `web/src/lib/components/global-search/__tests__/global-search.spec.ts` — scope render cases, preview cases per scope, `?` keybind, Ctrl+?/Alt+? fallthrough, mode-pill a11y.
- `web/src/lib/components/global-search/global-search-footer.svelte` — scope chip group + `?` icon button (hidden below `sm`).
- `web/src/lib/components/global-search/__tests__/global-search-footer.spec.ts` — chip + `?` icon tests.
- `web/src/lib/modals/ShortcutsModal.svelte` — "Scope prefixes" section with 4 kbd-box rows.
- `i18n/en.json` — new keys (English values pinned; sort order applied via `pnpm --filter=immich-i18n format:fix`):
  - `cmdk_scope_hint_footer` = `"@ # / > scope"`
  - `cmdk_show_shortcuts` = `"Keyboard shortcuts"`
  - `cmdk_shortcut_scope_heading` = `"Scope prefixes"`
  - `cmdk_shortcut_scope_people` = `"Search people"`
  - `cmdk_shortcut_scope_tags` = `"Search tags"`
  - `cmdk_shortcut_scope_collections` = `"Search albums & spaces"`
  - `cmdk_shortcut_scope_nav` = `"Jump to pages"`
  - `cmdk_announce_scoped_people` = `"Scoped to people."`
  - `cmdk_announce_scoped_tags` = `"Scoped to tags."`
  - `cmdk_announce_scoped_collections` = `"Scoped to albums & spaces."` _(NOT "Scoped to collections" — matches the ShortcutsModal copy)_
  - `cmdk_announce_scoped_nav` = `"Scoped to pages."`
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

1. **`getAllPeople` response shape + `PersonResponseDto` sort field are unverified.** Two related pre-impl checks:
   - **Response shape.** The design writes `[...response.people].sort(...)` assuming `{ people: PersonResponseDto[] }`. Nearby SDK shapes vary: `getAllSpaces` returns a bare array, `searchSmart` returns `{ assets: { items } }`. Grep `open-api/typescript-sdk/src/fetch-client.ts` for `getAllPeople`'s return type and swap the field access (`response.people` / `response.items` / `response`) to match.
   - **Sort field.** The bare-`@` sort needs a "popularity" or "recency" signal. Candidates observed in nearby DTOs: `numberOfAssets`, `faceCount`, `updatedAt`. Pick the first that exists on `PersonResponseDto`; fall back to alphabetical by `name` if none is present.
   - **Pre-implementation check blocks Task 6 in §Implementation sequence.**
   - **Test the chosen comparator** with fixtures where the sort field is missing (to verify the `?? 0` / fallback path doesn't crash).
2. **`GlobalSearchPreview`'s handling of `{ kind: 'nav' }` active items is unverified.** The v1.1 nav design claimed the preview "falls through to the empty state" when the cursor is on a nav item, but the design did not add a new test.
   - **Pre-implementation check (blocks Task 11 in §Implementation sequence):** read `web/src/lib/components/global-search/global-search-preview.svelte`. If the `#if` chain has no `nav` branch and no `{:else}` that renders the empty state for unknown kinds, add a `nav` branch in this PR that renders the empty-state markup. Pin with the component test listed in §Component.
3. **`getAllPeople` default sort** may not match the chosen sort key on all server versions. Mitigation: `personSuggestionsComparator` runs client-side unconditionally (not just as a fallback) so the order is deterministic regardless of server default. Pinned by test.
4. **`?` override** prevents literal `?` input in the palette. Accepted trade-off, documented above.
5. **Mobile `?` icon hidden below `sm`** means mobile users with a Bluetooth keyboard can still use the `?` keybind, but the tap affordance is gone. Acceptable — mobile users rarely need keyboard reference.
6. **`parseScope` runs on every keystroke** as a $derived. Cost is O(1) per keystroke (one trim, one map lookup, one slice) — negligible.
7. **Pre-existing `reconcileCursor` miss** (albums/spaces absent from the order) gets tangentially fixed. Regression test pins the new order; if someone later re-removes albums/spaces from the order, the test will flag it.
8. **Concurrent `getAllPeople` fetches** from rapid `@` retypes are prevented by the `ensurePeopleSuggestionsCache` promise-join pattern — not by `??=` on the cache field alone. Pinned by test.
9. **bits-ui `Command.Input` default key handling** may consume `?` for something unknown at design time.
   - **Pre-implementation check (blocks Task 11 in §Implementation sequence):** review bits-ui `Command.Input`'s keydown defaults at the pinned version in `web/package.json`. If `?` has any default behavior, either stop propagation at the palette level before bits-ui sees it, or use capture-phase binding. Pinned by a regression component test that dispatches `?` on the input and asserts `modalManager.show` fires.
10. **`fetchPeopleSuggestions` stale-rejection race** is mitigated by the `scope === 'people' && payload === ''` guard before the error write. If either condition is false, the rejection is silently dropped (AbortError pattern).

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
11. **`global-search.svelte` scope-aware rendering** + `?` keybind. Pre-check: inspect `global-search-preview.svelte` for a `{ kind: 'nav' }` branch; add one in this step if missing (see §Risks #2).
12. **Footer scope chip + `?` icon button** + `<sm` hide.
13. **ShortcutsModal "Scope prefixes" section** + kbd-box rows.
14. **i18n keys** + sort.
15. **Component + E2E tests.**
16. **Manual visual QA at 1024/720/480, light + dark.**

**Pre-implementation checks** (do these before starting Task 6 / Task 11):

- **§Risks #1a — `getAllPeople` response shape.** Grep `open-api/typescript-sdk/src/fetch-client.ts` for `getAllPeople`'s return type. Swap `response.people` in `fetchPeopleSuggestions` to match the actual field name (or `response` if the response is a bare array).
- **§Risks #1b — `PersonResponseDto` sort field.** Grep the DTO definition. Pick the first of `{ numberOfAssets, faceCount, updatedAt }` that exists as the sort key for `personSuggestionsComparator`; fall back to `name` alpha if none. Document the chosen field in the Task 6 implementation notes.
- **§Risks #2 — `GlobalSearchPreview` nav branch.** Read the component's `#if` chain. If a `nav` active-item kind has no branch and no catch-all `{:else}`, add an `{:else if activeItem?.kind === 'nav'}` branch in Task 11 that renders the existing empty-state markup. Test the branch in the component spec.
- **§Risks #9 — bits-ui `Command.Input` `?` handling.** Inspect bits-ui's Command.Input keydown logic at the pinned version in `web/package.json`. If it consumes `?`, bind our `?` handler at capture phase OR stop propagation before bits-ui's own listener. Pinned by the component-level regression test that dispatches `?` on the input.
