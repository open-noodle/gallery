# Space Albums Parity — Slice 2: space-scoped store + reuse rendering + cover/list toggle

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development. Steps use `- [ ]`.

**Goal:** Render the space Albums tab through fork components that reuse `AlbumCover`, with a working Cover/List toggle whose state lives in a space-scoped persisted store isolated from the global `albumViewSettings`. Existing per-card actions (show-in-timeline dim, unlink/timeline menu) preserved.

**Architecture:** New fork store `space-album-view-settings.store.ts` (mirrors `space-view.store.ts`). `SpaceAlbumCard` swaps its raw `<img>` for the reused `AlbumCover`. New fork `SpaceAlbumsTable` renders the list-mode rows (routing to the space album, guarding `albumUsers`). New `SpaceAlbumsControls` (view toggle only, for now) + `SpaceAlbumsList` (cover grid vs. table) replace the bespoke grid in `+page.svelte`.

**Tech Stack:** Svelte 5 runes, `svelte-persisted-store`, Vitest + @testing-library/svelte + happy-dom, `@immich/sdk` (`SharedSpaceLinkedAlbumDto`).

## Global Constraints

- Spec: `docs/superpowers/specs/2026-07-05-space-albums-page-parity-design.md` (§3–§5, Slice 2).
- Fork-isolation: create/modify only `web/src/lib/components/spaces/*`, `web/src/lib/stores/space-album-view-settings.store.ts`, `web/src/routes/(user)/spaces/[spaceId]/albums/+page.svelte`, and `web/src/lib/i18n/en.json` (additive). REUSE upstream `AlbumCover` and `preferences.store` enums by import; do NOT edit them.
- **Isolation invariant:** nothing in this slice may write the global `albumViewSettings` store. Assert it.
- **Crash guards:** `SharedSpaceLinkedAlbumDto` has `albumUsers: []` in tests and may lack `startDate`/`endDate`. Never index `albumUsers[0]` unguarded; fall back to `-` for absent dates.
- `AlbumCover`'s prop is typed `AlbumResponseDto`; the linked-album DTO only supplies the 2 fields it reads — cast `album as unknown as AlbumResponseDto` at the call site.
- Web verify: `cd web && pnpm test -- --run <file>` and `pnpm check:typescript` (NOTE: `check:svelte` is a local no-op — do not rely on it). ESLint 0 problems. No `Co-Authored-By` trailers.
- Base commit: `e36aa4c4cb` (Slice 1 complete).

## File Structure

- Create `web/src/lib/stores/space-album-view-settings.store.ts` + `.spec.ts`.
- Create `web/src/lib/components/spaces/space-albums-table.svelte` + `.spec.ts`.
- Create `web/src/lib/components/spaces/space-albums-controls.svelte`.
- Create `web/src/lib/components/spaces/space-albums-list.svelte` + `.spec.ts`.
- Modify `web/src/lib/components/spaces/space-album-card.svelte` (+ update its `.spec.ts`).
- Modify `web/src/routes/(user)/spaces/[spaceId]/albums/+page.svelte` (+ update `space-albums-page.spec.ts`).
- Modify `web/src/lib/i18n/en.json` (view-toggle + list-header strings).

---

## Task 1: space-scoped view-settings store

**Files:**

- Create: `web/src/lib/stores/space-album-view-settings.store.ts`
- Test: `web/src/lib/stores/space-album-view-settings.store.spec.ts`

**Interfaces:**

- Consumes: `persisted` from `svelte-persisted-store`; `AlbumViewMode`, `AlbumSortBy`, `SortOrder` from `$lib/stores/preferences.store`.
- Produces: `spaceAlbumViewSettings` (a `persisted<SpaceAlbumViewSettings>`), `SpaceAlbumViewSettings` interface, `SpaceAlbumGroupBy` enum. Later slices consume `sortBy`/`sortOrder` (Slice 3) and `groupBy`/`groupOrder`/`collapsedGroups` + mutators (Slice 4).

- [ ] **Step 1: Write the store spec (red).** Mirror `space-view.store.spec.ts`:

```ts
import { get } from 'svelte/store';
import { AlbumSortBy, AlbumViewMode, SortOrder } from '$lib/stores/preferences.store';
import { SpaceAlbumGroupBy, spaceAlbumViewSettings } from '$lib/stores/space-album-view-settings.store';

describe('space-album-view-settings store', () => {
  beforeEach(() => {
    localStorage.clear();
    spaceAlbumViewSettings.reset();
  });

  it('defaults view to Cover', () => {
    expect(get(spaceAlbumViewSettings).view).toBe(AlbumViewMode.Cover);
  });
  it('defaults sort to MostRecentPhoto desc and group to None', () => {
    const s = get(spaceAlbumViewSettings);
    expect(s.sortBy).toBe(AlbumSortBy.MostRecentPhoto);
    expect(s.sortOrder).toBe(SortOrder.Desc);
    expect(s.groupBy).toBe(SpaceAlbumGroupBy.None);
    expect(s.collapsedGroups).toEqual({});
  });
  it('persists under a key distinct from album-view-settings', () => {
    spaceAlbumViewSettings.update((s) => ({ ...s, view: AlbumViewMode.List }));
    expect(localStorage.getItem('space-album-view-settings')).toContain('List');
    expect(localStorage.getItem('album-view-settings')).toBeNull();
  });
});
```

- [ ] **Step 2: Run — expect RED.** `cd web && pnpm test -- --run src/lib/stores/space-album-view-settings.store.spec.ts` → FAIL (module missing).

- [ ] **Step 3: Implement the store.**

```ts
import { persisted } from 'svelte-persisted-store';
import { AlbumSortBy, AlbumViewMode, SortOrder } from '$lib/stores/preferences.store';

export enum SpaceAlbumGroupBy {
  None = 'None',
  Year = 'Year',
  LinkedBy = 'LinkedBy',
  Owner = 'Owner',
}

export interface SpaceAlbumViewSettings {
  view: string;
  sortBy: string;
  sortOrder: string;
  groupBy: string;
  groupOrder: string;
  collapsedGroups: { [group: string]: string[] };
}

export const spaceAlbumViewSettings = persisted<SpaceAlbumViewSettings>('space-album-view-settings', {
  view: AlbumViewMode.Cover,
  sortBy: AlbumSortBy.MostRecentPhoto,
  sortOrder: SortOrder.Desc,
  groupBy: SpaceAlbumGroupBy.None,
  groupOrder: SortOrder.Desc,
  collapsedGroups: {},
});
```

- [ ] **Step 4: Run — expect GREEN + tsc.** `cd web && pnpm test -- --run src/lib/stores/space-album-view-settings.store.spec.ts && pnpm check:typescript` → PASS / exit 0.

- [ ] **Step 5: Commit.**

```bash
git add web/src/lib/stores/space-album-view-settings.store.ts web/src/lib/stores/space-album-view-settings.store.spec.ts
git commit -m "feat(spaces): space-scoped album view-settings store"
```

---

## Task 2: SpaceAlbumCard reuses AlbumCover

**Files:**

- Modify: `web/src/lib/components/spaces/space-album-card.svelte` (thumbnail block ~lines 20-22, 56-64)
- Test: `web/src/lib/components/spaces/space-album-card.spec.ts` (update)

**Interfaces:**

- Consumes: `AlbumCover` from `$lib/components/album-page/AlbumCover.svelte`.
- Produces: unchanged card props/behavior; thumbnail now rendered by `AlbumCover` (includes its `NoCover` fallback).

- [ ] **Step 1: Update the card spec (red).** Add an assertion that the card renders `AlbumCover`'s output. `AlbumCover` renders an `<img>` with the album name as `alt` when a thumbnail exists, or the `NoCover` component when null. The current test albums have `albumThumbnailAssetId: null`. Add a test with a NON-null `albumThumbnailAssetId` asserting an `<img>` with `alt` = album name appears, and keep the existing href/menu/hidden-from-timeline assertions. Example addition:

```ts
it('renders the album cover image when a thumbnail exists', () => {
  renderWithTooltips(SpaceAlbumCard, {
    spaceId: 's-1',
    album: { ...baseAlbum, id: 'a-1', albumThumbnailAssetId: 'thumb-1', albumName: 'Trip' },
    canManage: false,
  });
  expect(screen.getByAltText('Trip')).toBeInTheDocument();
});
```

(Confirm the existing `baseAlbum`/inline album literal name; reuse it.)

- [ ] **Step 2: Run — expect RED** (before the swap the raw `<img>` uses `alt={album.albumName}` too, so this specific assertion may already pass; if so, the RED is instead the visual regression — proceed and rely on Step 4 green + the isolation of the change). `cd web && pnpm test -- --run src/lib/components/spaces/space-album-card.spec.ts`.

- [ ] **Step 3: Swap in AlbumCover.** Read the file; replace the thumbnail `{#if thumbnailUrl}...{:else}...{/if}` inner block (inside the `relative aspect-square ... {opacity-60}` wrapper `<div>`) with:

```svelte
<AlbumCover album={album as unknown as AlbumResponseDto} class="size-full object-cover" />
```

Add `import AlbumCover from '$lib/components/album-page/AlbumCover.svelte';` and `import type { AlbumResponseDto } from '@immich/sdk';`. Remove the now-unused `thumbnailUrl` derived, `getAssetMediaUrl` import, and `mdiImageAlbum` import (only if unused elsewhere in the file). KEEP the wrapper `<div>` with `{album.showInTimeline ? '' : 'opacity-60'}` and the `data-testid`s.

- [ ] **Step 4: Run — expect GREEN + tsc + lint.** `cd web && pnpm test -- --run src/lib/components/spaces/space-album-card.spec.ts && pnpm check:typescript && npx eslint src/lib/components/spaces/space-album-card.svelte src/lib/components/spaces/space-album-card.spec.ts` → PASS / 0.

- [ ] **Step 5: Commit.**

```bash
git add web/src/lib/components/spaces/space-album-card.svelte web/src/lib/components/spaces/space-album-card.spec.ts
git commit -m "refactor(spaces): SpaceAlbumCard reuses AlbumCover for the thumbnail"
```

---

## Task 3: SpaceAlbumsTable (fork list-mode rows)

**Files:**

- Create: `web/src/lib/components/spaces/space-albums-table.svelte`
- Test: `web/src/lib/components/spaces/space-albums-table.spec.ts`
- Modify: `web/src/lib/i18n/en.json` (list column headers if new keys needed — reuse existing `items_count`, album date strings where possible).

**Interfaces:**

- Consumes: `SharedSpaceLinkedAlbumDto[]`, `spaceId`, `canManage`, `onUnlink`, `onToggleTimeline` (same handler shapes as `SpaceAlbumCard`).
- Produces: a table listing albums; each row links to `/spaces/{spaceId}/albums/{album.id}` and shows the space context menu.

- [ ] **Step 1: Write the table spec (red).**

```ts
import { render, screen } from '@testing-library/svelte';
import SpaceAlbumsTable from '$lib/components/spaces/space-albums-table.svelte';
// build 2 albums via the same makeAlbum shape (id/albumName/assetCount/showInTimeline/albumUsers:[]/...)

it('renders a linking row per album to the space album route', () => {
  render(SpaceAlbumsTable, { spaceId: 's-1', albums: [a1, a2], canManage: false });
  expect(screen.getByTestId(`space-album-row-${a1.id}`)).toHaveAttribute('href', '/spaces/s-1/albums/a-1');
  expect(screen.getByText('Vacation')).toBeInTheDocument();
  expect(screen.getByText(/5 items/i)).toBeInTheDocument();
});

it('shows the manage menu only when canManage', () => {
  const { rerender } = render(SpaceAlbumsTable, { spaceId: 's-1', albums: [a1], canManage: true });
  expect(screen.getByTestId(`space-album-row-menu-${a1.id}`)).toBeInTheDocument();
});
```

(Use `renderWithTooltips` from `$tests/helpers` if the menu needs tooltip context.)

- [ ] **Step 2: Run — expect RED.** `cd web && pnpm test -- --run src/lib/components/spaces/space-albums-table.spec.ts` → FAIL (missing component).

- [ ] **Step 3: Implement `space-albums-table.svelte`.** Model on `AlbumsTableRow.svelte` but: (a) each row is an `<a href="/spaces/{spaceId}/albums/{album.id}" data-testid="space-album-row-{album.id}">` (not `goto(Route.viewAlbum)`); (b) columns: name (+ `$t('items_count')`), and dates via a null-guarded formatter (`album.updatedAt`, `album.createdAt`, then `album.endDate ?? '-'`, `album.startDate ?? '-'`); (c) a trailing cell with the space context menu (`data-testid="space-album-row-menu-{album.id}"`, timeline toggle + unlink) shown only when `canManage`, reusing the same `$t` keys and `onToggleTimeline`/`onUnlink` calls as `SpaceAlbumCard`. **Do NOT read `album.albumUsers[0]`** and do NOT add an owner or shared-by column (Slice 2 keeps it simple). Props:

```ts
interface Props {
  spaceId: string;
  albums: SharedSpaceLinkedAlbumDto[];
  canManage: boolean;
  onUnlink?: (album: SharedSpaceLinkedAlbumDto) => void;
  onToggleTimeline?: (album: SharedSpaceLinkedAlbumDto) => void;
}
```

Use a plain `<table class="w-full text-start">` / `<thead>` (static labels) / `<tbody>` with flex rows matching upstream row styling classes.

- [ ] **Step 4: Run — expect GREEN + tsc + lint.** As in Task 2, for the table files.

- [ ] **Step 5: Commit.**

```bash
git add web/src/lib/components/spaces/space-albums-table.svelte web/src/lib/components/spaces/space-albums-table.spec.ts web/src/lib/i18n/en.json
git commit -m "feat(spaces): SpaceAlbumsTable list-mode rows (fork, space routing)"
```

---

## Task 4: SpaceAlbumsControls (view toggle) + SpaceAlbumsList (switch) + wire the page

**Files:**

- Create: `web/src/lib/components/spaces/space-albums-controls.svelte`
- Create: `web/src/lib/components/spaces/space-albums-list.svelte` + `.spec.ts`
- Modify: `web/src/routes/(user)/spaces/[spaceId]/albums/+page.svelte`
- Modify: `web/src/routes/(user)/spaces/[spaceId]/albums/space-albums-page.spec.ts`
- Modify: `web/src/lib/i18n/en.json` (view toggle labels, e.g. reuse existing `cover`/`list` keys if present; else add `spaces_albums_view_cover`/`spaces_albums_view_list`).

**Interfaces:**

- Consumes: `spaceAlbumViewSettings` (Task 1); `SpaceAlbumCard` (Task 2); `SpaceAlbumsTable` (Task 3); `AlbumViewMode` from `$lib/stores/preferences.store`.
- Produces: `SpaceAlbumsControls` (renders the Cover/List toggle, writes `$spaceAlbumViewSettings.view`); `SpaceAlbumsList` (given `albums`, `spaceId`, `canManage`, handlers, renders cover grid of `SpaceAlbumCard` when `view === Cover`, else `SpaceAlbumsTable`).

- [ ] **Step 1: Write the list spec (red).**

```ts
import { get } from 'svelte/store';
import { render, screen } from '@testing-library/svelte';
import { AlbumViewMode, albumViewSettings } from '$lib/stores/preferences.store';
import { spaceAlbumViewSettings } from '$lib/stores/space-album-view-settings.store';
import SpaceAlbumsList from '$lib/components/spaces/space-albums-list.svelte';

beforeEach(() => {
  localStorage.clear();
  spaceAlbumViewSettings.reset();
  albumViewSettings.reset();
});

it('renders cover cards by default and switches to the table on view=List', async () => {
  const albums = [makeAlbum({ id: 'a-1' }), makeAlbum({ id: 'a-2' })];
  render(SpaceAlbumsList, { spaceId: 's-1', albums, canManage: false });
  expect(screen.getAllByTestId('space-album-card')).toHaveLength(2);
  spaceAlbumViewSettings.update((s) => ({ ...s, view: AlbumViewMode.List }));
  expect(await screen.findByTestId('space-album-row-a-1')).toBeInTheDocument();
});

it('never writes the global albumViewSettings (isolation)', () => {
  const before = get(albumViewSettings);
  render(SpaceAlbumsList, { spaceId: 's-1', albums: [makeAlbum({ id: 'a-1' })], canManage: false });
  spaceAlbumViewSettings.update((s) => ({ ...s, view: AlbumViewMode.List }));
  expect(get(albumViewSettings)).toEqual(before);
});
```

- [ ] **Step 2: Run — expect RED.** Missing components.

- [ ] **Step 3: Implement `space-albums-controls.svelte`.** A toolbar row rendering a Cover/List toggle (use `@immich/ui` `Button`/`IconButton`, icons `mdiViewGridOutline`/`mdiFormatListBulletiSquare` or similar) that flips `$spaceAlbumViewSettings.view` between `AlbumViewMode.Cover` and `AlbumViewMode.List`, `data-testid="space-albums-view-toggle"`. (Search/sort/group/create/link are added in later slices — leave a clear layout container for them.)

- [ ] **Step 4: Implement `space-albums-list.svelte`.**

```svelte
<script lang="ts">
  import type { SharedSpaceLinkedAlbumDto } from '@immich/sdk';
  import { AlbumViewMode } from '$lib/stores/preferences.store';
  import { spaceAlbumViewSettings } from '$lib/stores/space-album-view-settings.store';
  import SpaceAlbumCard from '$lib/components/spaces/space-album-card.svelte';
  import SpaceAlbumsTable from '$lib/components/spaces/space-albums-table.svelte';

  interface Props {
    spaceId: string;
    albums: SharedSpaceLinkedAlbumDto[];
    canManage: boolean;
    onUnlink?: (album: SharedSpaceLinkedAlbumDto) => void;
    onToggleTimeline?: (album: SharedSpaceLinkedAlbumDto) => void;
  }
  let { spaceId, albums, canManage, onUnlink, onToggleTimeline }: Props = $props();
</script>

{#if $spaceAlbumViewSettings.view === AlbumViewMode.List}
  <SpaceAlbumsTable {spaceId} {albums} {canManage} {onUnlink} {onToggleTimeline} />
{:else}
  <div class="grid grid-auto-fill-56 gap-y-4">
    {#each albums as album (album.id)}
      <SpaceAlbumCard {spaceId} {album} {canManage} {onUnlink} {onToggleTimeline} />
    {/each}
  </div>
{/if}
```

- [ ] **Step 5: Run list spec — expect GREEN.**

- [ ] **Step 6: Wire `+page.svelte`.** Read the file. Replace the `{:else}` cover-grid block (~lines 125-139) with `<SpaceAlbumsControls />` above `<SpaceAlbumsList spaceId={space.id} {albums} canManage={isEditor} onUnlink={handleUnlink} onToggleTimeline={handleToggleTimeline} />`. Keep the empty-state `{#if}` branch, the header/link button, and the handlers. Add the two component imports.

- [ ] **Step 7: Update `space-albums-page.spec.ts`.** It currently asserts `getAllByTestId('space-album-card')` (still valid — cover mode default) and empty-state. Add an assertion that `space-albums-view-toggle` renders. Ensure `beforeEach` resets `spaceAlbumViewSettings`. Keep existing tests green.

- [ ] **Step 8: Full web gate for the touched files — GREEN.**
      `cd web && pnpm test -- --run src/lib/components/spaces/space-albums-list.spec.ts "src/routes/(user)/spaces/[spaceId]/albums/space-albums-page.spec.ts" && pnpm check:typescript && npx eslint src/lib/components/spaces/space-albums-controls.svelte src/lib/components/spaces/space-albums-list.svelte "src/routes/(user)/spaces/[spaceId]/albums/+page.svelte"`

- [ ] **Step 9: Commit.**

```bash
git add web/src/lib/components/spaces/space-albums-controls.svelte web/src/lib/components/spaces/space-albums-list.svelte web/src/lib/components/spaces/space-albums-list.spec.ts "web/src/routes/(user)/spaces/[spaceId]/albums/" web/src/lib/i18n/en.json
git commit -m "feat(spaces): render space albums via fork list + cover/list toggle"
```

---

## Slice 2 exit gate

- `cd web && pnpm test` (full web suite) green; `pnpm check:typescript` exit 0; `pnpm lint` (tolerating the ~580 pre-existing tailwind warnings — no NEW eslint errors on touched files).
- Manual sanity (optional if dev stack up): the tab shows cards; the toggle switches to the table; global `/albums` view unaffected.

## Self-review (author)

- Spec Slice 2 tests covered: store defaults/key/reset (T1) ✓, card AlbumCover + dim + menu (T2) ✓, table rows route to space + menu gating (T3) ✓, list cover↔table switch + isolation (T4) ✓, page renders controls+list + empty state (T4) ✓.
- Crash guards: no `albumUsers[0]`, date `-` fallback ✓. AlbumCover cast ✓.
- Type consistency: handler signatures `(album: SharedSpaceLinkedAlbumDto) => void` identical across card/table/list/page ✓.
