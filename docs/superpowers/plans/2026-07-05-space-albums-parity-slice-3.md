# Space Albums Parity — Slice 3: Sort

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development. Steps use `- [ ]`.

**Goal:** A Sort dropdown in `SpaceAlbumsControls` drives the album order in `SpaceAlbumsList` (both cover and list modes), writing the space-scoped store. Null-date albums sort last under date sorts.

**Architecture:** Reuse the pure `sortAlbums` + `sortOptionsMetadata` from `album-utils.ts`. `SpaceAlbumsList` derives a sorted array from `$spaceAlbumViewSettings.sortBy/sortOrder`. `SpaceAlbumsControls` gains a sort `Dropdown` mirroring the main `/albums` `AlbumsControls` sort dropdown, but writing `spaceAlbumViewSettings`.

**Tech Stack:** Svelte 5, `@immich/ui` `Dropdown`, Vitest + @testing-library/svelte.

## Global Constraints

- Spec §4 (Sort), Slice 3. Edge cases: MostRecentPhoto=`endDate`, OldestPhoto=`startDate` (#12); null-date albums sort last (#13).
- Fork-only: modify `web/src/lib/components/spaces/space-albums-controls.svelte` and `space-albums-list.svelte`; extend their specs. Reuse `sortAlbums`, `sortOptionsMetadata`, `findSortOptionMetadata` from `$lib/utils/album-utils` by import (do NOT edit them).
- **`sortAlbums` signature (exact):** `sortAlbums(albums: AlbumResponseDto[], { sortBy, orderBy }: { sortBy: string; orderBy: string })` — the second key is **`orderBy`**, and its value is the sort-ORDER string (`$spaceAlbumViewSettings.sortOrder`). Cast the space albums: `sortAlbums(albums as unknown as AlbumResponseDto[], { sortBy, orderBy })`.
- The store already has `sortBy` (default `AlbumSortBy.MostRecentPhoto`) and `sortOrder` (default `SortOrder.Desc`) from Slice 2. Do NOT change the store.
- Web verify: `pnpm test -- --run <file>`, `pnpm check:typescript` (svelte-check is a no-op). ESLint 0 on touched files. No `Co-Authored-By`.
- Base: `c0621d553b`.

## File Structure

- Modify `web/src/lib/components/spaces/space-albums-list.svelte` (+ `space-albums-list.spec.ts`).
- Modify `web/src/lib/components/spaces/space-albums-controls.svelte` (+ create/extend `space-albums-controls.spec.ts`).
- Possibly `web/src/lib/i18n/en.json` (reuse the SAME sort-label keys the main `AlbumsControls` uses — read them from `web/src/routes/(user)/albums/AlbumsControls.svelte`'s `albumSortByNames` map; add none if all exist).

---

## Task 1: SpaceAlbumsList applies the sort

**Files:**

- Modify: `web/src/lib/components/spaces/space-albums-list.svelte`
- Test: `web/src/lib/components/spaces/space-albums-list.spec.ts` (extend)

**Interfaces:**

- Consumes: `sortAlbums` from `$lib/utils/album-utils`; `spaceAlbumViewSettings`.
- Produces: albums rendered in sorted order in both cover and table modes.

- [ ] **Step 1: Extend the list spec (red).** Add ordering assertions. Build albums with distinguishing sort keys and assert the rendered order via the card link hrefs (`space-album-card-link` → `/spaces/s-1/albums/{id}`) or the row testids. Example:

```ts
import { get } from 'svelte/store';
import { AlbumSortBy, SortOrder } from '$lib/stores/preferences.store';

const idsInCoverOrder = () =>
  screen.getAllByTestId('space-album-card-link').map((a) => a.getAttribute('href')!.split('/').pop());

it('sorts by Title ascending', () => {
  const albums = [makeAlbum({ id: 'b', albumName: 'Bravo' }), makeAlbum({ id: 'a', albumName: 'Alpha' })];
  spaceAlbumViewSettings.update((s) => ({ ...s, sortBy: AlbumSortBy.Title, sortOrder: SortOrder.Asc }));
  render(SpaceAlbumsList, { spaceId: 's-1', albums, canManage: false });
  expect(idsInCoverOrder()).toEqual(['a', 'b']);
});

it('sorts by item count descending', () => {
  const albums = [makeAlbum({ id: 'lo', assetCount: 2 }), makeAlbum({ id: 'hi', assetCount: 9 })];
  spaceAlbumViewSettings.update((s) => ({ ...s, sortBy: AlbumSortBy.ItemCount, sortOrder: SortOrder.Desc }));
  render(SpaceAlbumsList, { spaceId: 's-1', albums, canManage: false });
  expect(idsInCoverOrder()).toEqual(['hi', 'lo']);
});

it('sorts by MostRecentPhoto on endDate, pushing null-date albums last', () => {
  const albums = [
    makeAlbum({ id: 'none' }), // no startDate/endDate
    makeAlbum({ id: 'old', endDate: '2020-01-01T00:00:00.000Z' }),
    makeAlbum({ id: 'new', endDate: '2024-01-01T00:00:00.000Z' }),
  ];
  spaceAlbumViewSettings.update((s) => ({ ...s, sortBy: AlbumSortBy.MostRecentPhoto, sortOrder: SortOrder.Desc }));
  render(SpaceAlbumsList, { spaceId: 's-1', albums, canManage: false });
  const order = idsInCoverOrder();
  expect(order.slice(0, 2)).toEqual(['new', 'old']);
  expect(order[2]).toBe('none'); // null-date last
});

it('sorts by OldestPhoto on startDate', () => {
  const albums = [
    makeAlbum({ id: 'y2024', startDate: '2024-01-01T00:00:00.000Z' }),
    makeAlbum({ id: 'y2020', startDate: '2020-01-01T00:00:00.000Z' }),
  ];
  spaceAlbumViewSettings.update((s) => ({ ...s, sortBy: AlbumSortBy.OldestPhoto, sortOrder: SortOrder.Asc }));
  render(SpaceAlbumsList, { spaceId: 's-1', albums, canManage: false });
  expect(idsInCoverOrder()).toEqual(['y2020', 'y2024']);
});
```

Also add a List-mode ordering check (set `view: List`, assert the `space-album-row-*` order). Ensure `makeAlbum` accepts `startDate`/`endDate` overrides (add them to the local helper if the shared one omits them).

- [ ] **Step 2: Run — expect RED** (list currently renders `albums` in input order). `cd web && pnpm test -- --run src/lib/components/spaces/space-albums-list.spec.ts`.

- [ ] **Step 3: Apply the sort in the list.** Add to `space-albums-list.svelte`:

```svelte
<script lang="ts">
  import type { AlbumResponseDto, SharedSpaceLinkedAlbumDto } from '@immich/sdk';
  import { sortAlbums } from '$lib/utils/album-utils';
  import { spaceAlbumViewSettings } from '$lib/stores/space-album-view-settings.store';
  // ...existing props...
  const sorted = $derived(
    sortAlbums(albums as unknown as AlbumResponseDto[], {
      sortBy: $spaceAlbumViewSettings.sortBy,
      orderBy: $spaceAlbumViewSettings.sortOrder,
    }) as unknown as SharedSpaceLinkedAlbumDto[],
  );
</script>
```

Render `sorted` (not `albums`) in BOTH the cover grid `{#each sorted as album (album.id)}` and the `<SpaceAlbumsTable albums={sorted} .../>`.

- [ ] **Step 4: Run — expect GREEN + tsc.** `cd web && pnpm test -- --run src/lib/components/spaces/space-albums-list.spec.ts && pnpm check:typescript`.

- [ ] **Step 5: Commit.**

```bash
git add web/src/lib/components/spaces/space-albums-list.svelte web/src/lib/components/spaces/space-albums-list.spec.ts
git commit -m "feat(spaces): sort space albums via reused sortAlbums"
```

---

## Task 2: Sort dropdown in SpaceAlbumsControls

**Files:**

- Modify: `web/src/lib/components/spaces/space-albums-controls.svelte`
- Test: `web/src/lib/components/spaces/space-albums-controls.spec.ts` (create or extend)

**Interfaces:**

- Consumes: `sortOptionsMetadata`, `findSortOptionMetadata` from `$lib/utils/album-utils`; `spaceAlbumViewSettings`; the sort-label i18n keys used by `AlbumsControls`.
- Produces: a sort dropdown; selecting an option sets `$spaceAlbumViewSettings.sortBy` (and `sortOrder` per the option's `defaultOrder`, toggling if the same option is re-selected — mirror `AlbumsControls`' `handleChangeSortBy`).

- [ ] **Step 1: Read the reference.** Open `web/src/routes/(user)/albums/AlbumsControls.svelte` and copy the sort `Dropdown` block (~lines 141-151) and its `handleChangeSortBy` handler (~lines 67-74) and `albumSortByNames` map (~lines 99-106). These are your template — adapt them to write `spaceAlbumViewSettings` instead of `albumViewSettings`.

- [ ] **Step 2: Write the controls spec (red).**

```ts
import { get } from 'svelte/store';
import { render, screen } from '@testing-library/svelte';
import { AlbumSortBy } from '$lib/stores/preferences.store';
import { spaceAlbumViewSettings } from '$lib/stores/space-album-view-settings.store';
import SpaceAlbumsControls from '$lib/components/spaces/space-albums-controls.svelte';

beforeEach(() => {
  localStorage.clear();
  spaceAlbumViewSettings.reset();
});

it('renders a sort dropdown with the six album sort options', async () => {
  render(SpaceAlbumsControls);
  // open the dropdown (mirror how AlbumsControls dropdown tests interact; if none, click the trigger)
  // assert all six labels are present (Title, Item count, Date modified, Date created, Most recent photo, Oldest photo)
});

it('writes the chosen sort to the space store, not the global one', async () => {
  render(SpaceAlbumsControls);
  // select "Title"
  expect(get(spaceAlbumViewSettings).sortBy).toBe(AlbumSortBy.Title);
});
```

(If the `@immich/ui` `Dropdown` is hard to drive in tests, assert the store write by invoking the component's selection path the same way an existing dropdown test in the repo does — search `web/src` for a `.spec.ts` that tests a `Dropdown` selection and mirror it. If truly untestable via DOM, at minimum assert the six option labels render.)

- [ ] **Step 3: Run — expect RED.**

- [ ] **Step 4: Implement the sort dropdown** in `space-albums-controls.svelte`, adapted from the reference, writing `spaceAlbumViewSettings`. Place it in the controls' layout container next to the view toggle.

- [ ] **Step 5: Run — expect GREEN + tsc + lint.**
      `cd web && pnpm test -- --run src/lib/components/spaces/space-albums-controls.spec.ts && pnpm check:typescript && npx eslint src/lib/components/spaces/space-albums-controls.svelte src/lib/components/spaces/space-albums-controls.spec.ts`

- [ ] **Step 6: Commit.**

```bash
git add web/src/lib/components/spaces/space-albums-controls.svelte web/src/lib/components/spaces/space-albums-controls.spec.ts web/src/lib/i18n/en.json
git commit -m "feat(spaces): sort dropdown in space albums controls"
```

---

## Slice 3 exit gate

- `cd web && pnpm test` green; `pnpm check:typescript` exit 0; `pnpm lint` (no NEW eslint errors on touched files).

## Self-review (author)

- Spec Slice 3 tests: each sort option orders correctly incl. MostRecentPhoto=endDate / OldestPhoto=startDate ✓ (#12); null-date albums sort last ✓ (#13); dropdown lists six options + writes the space store (not global) ✓.
- `sortAlbums` called with the exact `{ sortBy, orderBy }` shape ✓; casts for the DTO ✓.
