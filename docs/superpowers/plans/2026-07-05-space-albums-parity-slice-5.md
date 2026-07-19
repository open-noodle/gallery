# Space Albums Parity — Slice 5: Search

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development. Steps use `- [ ]`.

**Goal:** A search box in `SpaceAlbumsControls` filters the space albums by name and description (case-insensitive, null-safe); a distinct "No matching albums" message shows when albums exist but the query matches none (separate from the 0-linked-albums empty state). Search composes with the active sort/group.

**Architecture:** `+page.svelte` owns a `searchQuery` `$state`, binds it into `SpaceAlbumsControls`, and passes it to `SpaceAlbumsList`. The list inserts a `filtered` derived **before** `sorted` (so filter → sort → group), and renders the no-results message when `filtered` is empty.

## Global Constraints

- Spec §4.3, Slice 5. Edge cases: no-results vs empty (#2), null `description` doesn't throw (#15).
- Fork-only: modify `space-albums-list.svelte`(+spec), `space-albums-controls.svelte`(+spec), `+page.svelte`(+`space-albums-page.spec.ts`), `i18n/en.json` (add a "no matching albums" key if none exists — grep first, e.g. reuse an existing empty/no-results key or add `space_albums_no_matching`).
- The page only renders the list when `albums.length > 0` (Slice 2 empty-state gate), so the list's no-results = "query matched nothing".
- Verify: `pnpm test -- --run <file>`, `pnpm check:typescript`, eslint 0. No `Co-Authored-By`. Base: `99d30935ca`.

## File Structure

- Modify `web/src/lib/components/spaces/space-albums-list.svelte` (+ `.spec.ts`).
- Modify `web/src/lib/components/spaces/space-albums-controls.svelte` (+ `.spec.ts`).
- Modify `web/src/routes/(user)/spaces/[spaceId]/albums/+page.svelte` (+ `space-albums-page.spec.ts`).
- Modify `i18n/en.json`.

---

## Task 1: Filter + no-results in SpaceAlbumsList

**Files:** `space-albums-list.svelte` (+ spec).

- [ ] **Step 1: Extend the list spec (red).**

```ts
it('filters by album name (case-insensitive)', () => {
  const albums = [makeAlbum({ id: 'v', albumName: 'Vacation' }), makeAlbum({ id: 'w', albumName: 'Work' })];
  render(SpaceAlbumsList, { spaceId: 's-1', albums, canManage: false, searchQuery: 'vac' });
  expect(screen.getAllByTestId('space-album-card-link')).toHaveLength(1);
  expect(screen.getByText('Vacation')).toBeInTheDocument();
});
it('filters by description and does not throw on null description', () => {
  const albums = [
    makeAlbum({ id: 'a', albumName: 'A', description: 'beach trip' }),
    makeAlbum({ id: 'b', albumName: 'B', description: null as unknown as string }),
  ];
  expect(() =>
    render(SpaceAlbumsList, { spaceId: 's-1', albums, canManage: false, searchQuery: 'beach' }),
  ).not.toThrow();
  expect(screen.getAllByTestId('space-album-card-link')).toHaveLength(1);
});
it('shows a no-matching message when the query matches nothing', () => {
  render(SpaceAlbumsList, {
    spaceId: 's-1',
    albums: [makeAlbum({ id: 'a', albumName: 'Alpha' })],
    canManage: false,
    searchQuery: 'zzz',
  });
  expect(screen.getByTestId('space-albums-no-results')).toBeInTheDocument();
  expect(screen.queryAllByTestId('space-album-card-link')).toHaveLength(0);
});
it('an empty query shows everything', () => {
  render(SpaceAlbumsList, {
    spaceId: 's-1',
    albums: [makeAlbum({ id: 'a' }), makeAlbum({ id: 'b' })],
    canManage: false,
    searchQuery: '',
  });
  expect(screen.getAllByTestId('space-album-card-link')).toHaveLength(2);
});
```

(Ensure `makeAlbum` accepts `description` overrides.)

- [ ] **Step 2: Run — RED.**

- [ ] **Step 3: Implement.** Add `searchQuery?: string` to `Props` (default `''`). Insert BEFORE `sorted`:

```ts
const filtered = $derived.by(() => {
  const q = (searchQuery ?? '').trim().toLowerCase();
  if (!q) return albums;
  return albums.filter((a) => a.albumName.toLowerCase().includes(q) || (a.description ?? '').toLowerCase().includes(q));
});
```

Change `sorted` to sort `filtered` (not `albums`). At the top of the markup, add:

```svelte
{#if filtered.length === 0}
  <p data-testid="space-albums-no-results" class="p-4 text-center text-gray-500">{$t('<no-matching-key>')}</p>
{:else if $spaceAlbumViewSettings.view === AlbumViewMode.List}
  ...existing branches...
{/if}
```

(Wrap the existing `{#if view === List}...{:else if isGrouped}...{:else}...{/if}` under the `{:else if}`/`{:else}` of the new no-results guard. Keep `groupIds` `$effect` working — it derives from `groups` which now derives from filtered→sorted.)

- [ ] **Step 4: GREEN + tsc + lint. Step 5: Commit.**

```bash
git commit -m "feat(spaces): search filter + no-results state in space albums list"
```

---

## Task 2: Search box in controls + page wiring

**Files:** `space-albums-controls.svelte` (+ spec), `+page.svelte` (+ `space-albums-page.spec.ts`), `i18n/en.json`.

- [ ] **Step 1: Extend the controls spec (red).** Assert a search input renders (`data-testid="space-albums-search"`) and is bound to `searchQuery` (typing updates the bound value — test via `fireEvent.input` and a `bind:` in a wrapper, OR assert the input exists + reflects a passed `searchQuery` prop).

- [ ] **Step 2: Run — RED.**

- [ ] **Step 3: Implement controls.** Add `searchQuery = $bindable('')` to the controls `Props`. Render a search field: try `@immich/ui` `SearchBar` (`import { SearchBar } from '@immich/ui'`, `<SearchBar bind:name={searchQuery} placeholder={$t('search_albums')} />`) — if it needs unavailable context in happy-dom (as the sort/group Dropdowns did), fall back to a plain `<input type="search" data-testid="space-albums-search" bind:value={searchQuery} placeholder={$t('search_albums')} class="..." />`. Place it at the left of the controls row (shape-the-view cluster).

- [ ] **Step 4: Wire `+page.svelte`.** Add `let searchQuery = $state('')`; pass `bind:searchQuery` to `<SpaceAlbumsControls>` and `{searchQuery}` to `<SpaceAlbumsList>`.

- [ ] **Step 5: Update `space-albums-page.spec.ts`.** Add an assertion that `space-albums-search` renders; keep existing tests green.

- [ ] **Step 6: i18n.** Ensure `search_albums` key exists (grep; the main page uses it — likely present). Add the no-matching key used in Task 1 if not present.

- [ ] **Step 7: GREEN + tsc + lint. Step 8: Commit.**

```bash
git commit -m "feat(spaces): search box in space albums controls"
```

---

## Slice 5 exit gate

- `cd web && pnpm test` green; `pnpm check:typescript` exit 0; `pnpm lint` no new errors on touched files.

## Self-review (author)

- Search filters name + description, null-safe (#15) ✓; no-results distinct from empty (#2) ✓; empty query = all ✓; composes with sort/group (filter→sort→group order) ✓.
