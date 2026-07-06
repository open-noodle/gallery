# Space Albums Parity — Slice 4: Group by + collapse/expand

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development. Steps use `- [ ]`.

**Goal:** A Group dropdown (None / Year / Linked by / Owner) with expand/collapse-all, grouping the space albums in both cover and list modes, driven by the space store. Year uses `startDate` under Oldest-photo sort else `endDate`; "Linked by" resolves `addedById` → member name; empty/unknown buckets handled; collapse state is space-scoped.

**Architecture:** A new **pure** fork util `space-album-grouping.ts` holds the group metadata (with a fork `isDisabled` reading the space store), the fork collapse/expand mutators (bound to `spaceAlbumViewSettings`), and `buildSpaceAlbumGroups(albums, settings, ctx)`. `SpaceAlbumsList` builds groups and renders per-group (cover) / passes groups to `SpaceAlbumsTable` (list). `SpaceAlbumsControls` gains a group menu + expand/collapse-all. `members` is threaded page → list.

**Tech Stack:** Svelte 5, lodash-es `groupBy`, Vitest.

## Global Constraints

- Spec §4.2 (grouping), Slice 4. Edge cases: Owner grouping (#5), null `addedById` → "Unknown" (#7), linker-not-a-member → "Unknown" (#8), Year "No date" bucket (#9), Year date-source conditional (#10), `Year` disabled under date-created/modified sort (#11).
- Fork-only. New `web/src/lib/utils/space-album-grouping.ts`. Modify `space-albums-list.svelte`, `space-albums-table.svelte`, `space-albums-controls.svelte`, `+page.svelte`. i18n additions go in **repo-root `i18n/en.json`** (confirm this path; the web imports keys from there) — add `group_linked_by`; REUSE `group_no`/`group_owner`/`group_year`, `unknown_year`, `unassigned` (for null/unknown linker), `my_albums`, `albums_count`, `expand_all`, `collapse_all`.
- **Guards:** `SharedSpaceLinkedAlbumDto.albumUsers` may be `[]` (test fixtures) — Owner grouping must NOT index `albumUsers[0]` unguarded; bucket empty-owner albums under an "unknown" group. `addedById` may be `null` or not in `members` → "unassigned" bucket. `startDate`/`endDate` may be absent → "No date" (unknown-year) bucket.
- **Pure util:** `buildSpaceAlbumGroups` takes explicit label strings + members + currentUserId in a `ctx` object (no `$t`/store access inside), so it is unit-testable. The component passes `$t(...)` values.
- Collapse mutators bind `spaceAlbumViewSettings` (fork copies of album-utils' global-bound ones). `collapsedGroups` is keyed by the current `groupBy` value.
- Reuse `sortAlbums`, `stringToSortOrder` from `$lib/utils/album-utils`; `SpaceAlbumGroupBy`/`spaceAlbumViewSettings` from the store (`LinkedBy` enum member already exists).
- Match the fork controls' plain-button menu pattern (Slice 3 `space-albums-controls.svelte` uses `showSortMenu` + `data-testid` container/btn/menu/option — mirror as `showGroupMenu`).
- Verify: `pnpm test -- --run <file>`, `pnpm check:typescript`, eslint 0 on touched files. No `Co-Authored-By`. Base: `1305ebd88d`.

## File Structure

- Create `web/src/lib/utils/space-album-grouping.ts` + `.spec.ts`.
- Modify `space-albums-list.svelte` (+ spec), `space-albums-table.svelte` (+ spec), `space-albums-controls.svelte` (+ spec), `+page.svelte` (thread `members`).
- Modify `i18n/en.json` (add `group_linked_by`).

---

## Task 1: Fork grouping util (pure logic)

**Files:** Create `web/src/lib/utils/space-album-grouping.ts` + `web/src/lib/utils/space-album-grouping.spec.ts`.

**Interfaces:**

- Produces: `SpaceAlbumGroup { id; name; albums: SharedSpaceLinkedAlbumDto[] }`; `spaceGroupOptionsMetadata`; `findSpaceGroupOptionMetadata`; `getSelectedSpaceAlbumGroupOption(settings)`; `isSpaceAlbumGroupCollapsed(settings, id)`; `toggleSpaceAlbumGroupCollapsing(id)`; `collapseAllSpaceAlbumGroups(ids)`; `expandAllSpaceAlbumGroups()`; `buildSpaceAlbumGroups(albums, settings, ctx)`.
- Consumes: `SpaceAlbumGroupBy`, `spaceAlbumViewSettings`, `SpaceAlbumViewSettings` (store); `AlbumSortBy`, `SortOrder` (preferences.store); `sortAlbums`, `stringToSortOrder` (album-utils); `groupBy` from `lodash-es`.

- [ ] **Step 1: Write the util spec (red).** Cover every grouping + edge case with explicit `ctx` labels:

```ts
import { get } from 'svelte/store';
import { AlbumSortBy, SortOrder } from '$lib/stores/preferences.store';
import { SpaceAlbumGroupBy, spaceAlbumViewSettings } from '$lib/stores/space-album-view-settings.store';
import {
  buildSpaceAlbumGroups,
  getSelectedSpaceAlbumGroupOption,
  isSpaceAlbumGroupCollapsed,
  toggleSpaceAlbumGroupCollapsing,
  collapseAllSpaceAlbumGroups,
  expandAllSpaceAlbumGroups,
} from '$lib/utils/space-album-grouping';

const CTX = {
  ungrouped: 'Albums',
  unknownYear: 'Unknown Year',
  unassigned: 'Unassigned',
  currentUserId: 'me',
  members: [] as any[],
};
const A = (o: any) => ({
  id: 'x',
  albumName: 'A',
  assetCount: 0,
  albumThumbnailAssetId: null,
  showInTimeline: true,
  addedById: null,
  linkedAt: '',
  albumUsers: [],
  description: '',
  createdAt: '2024-01-01T00:00:00Z',
  updatedAt: '2024-01-01T00:00:00Z',
  shared: false,
  hasSharedLink: false,
  isActivityEnabled: false,
  ...o,
});

beforeEach(() => {
  localStorage.clear();
  spaceAlbumViewSettings.reset();
});

it('None → a single group named ungrouped', () => {
  const g = buildSpaceAlbumGroups(
    [A({ id: 'a' })],
    { ...get(spaceAlbumViewSettings), groupBy: SpaceAlbumGroupBy.None },
    CTX,
  );
  expect(g).toHaveLength(1);
  expect(g[0].albums).toHaveLength(1);
});

it('Year buckets by endDate, unknown-year last', () => {
  const albums = [
    A({ id: 'none' }),
    A({ id: 'y2020', endDate: '2020-06-01T00:00:00Z' }),
    A({ id: 'y2024', endDate: '2024-06-01T00:00:00Z' }),
  ];
  const g = buildSpaceAlbumGroups(
    albums,
    {
      ...get(spaceAlbumViewSettings),
      groupBy: SpaceAlbumGroupBy.Year,
      groupOrder: SortOrder.Desc,
      sortBy: AlbumSortBy.MostRecentPhoto,
    },
    CTX,
  );
  expect(g.map((x) => x.name)).toEqual(['2024', '2020', 'Unknown Year']);
});

it('Year uses startDate under Oldest-photo sort', () => {
  const albums = [A({ id: 's', startDate: '2019-01-01T00:00:00Z', endDate: '2025-01-01T00:00:00Z' })];
  const g = buildSpaceAlbumGroups(
    albums,
    { ...get(spaceAlbumViewSettings), groupBy: SpaceAlbumGroupBy.Year, sortBy: AlbumSortBy.OldestPhoto },
    CTX,
  );
  expect(g[0].name).toBe('2019');
});

it('LinkedBy resolves addedById to member name; null/unknown → unassigned', () => {
  const ctx = { ...CTX, members: [{ userId: 'u1', name: 'Alice' }] };
  const albums = [A({ id: 'a', addedById: 'u1' }), A({ id: 'b', addedById: null }), A({ id: 'c', addedById: 'ghost' })];
  const g = buildSpaceAlbumGroups(albums, { ...get(spaceAlbumViewSettings), groupBy: SpaceAlbumGroupBy.LinkedBy }, ctx);
  const byName = Object.fromEntries(g.map((x) => [x.name, x.albums.map((a) => a.id)]));
  expect(byName['Alice']).toEqual(['a']);
  expect(byName['Unassigned'].sort()).toEqual(['b', 'c']);
});

it('Owner groups by albumUsers[0]; empty albumUsers → unassigned (no crash)', () => {
  const ctx = { ...CTX, currentUserId: 'me' };
  const albums = [
    A({ id: 'mine', albumUsers: [{ role: 'owner', user: { id: 'me', name: 'Me' } }] }),
    A({ id: 'hers', albumUsers: [{ role: 'owner', user: { id: 'her', name: 'Zoe' } }] }),
    A({ id: 'empty', albumUsers: [] }),
  ];
  const g = buildSpaceAlbumGroups(albums, { ...get(spaceAlbumViewSettings), groupBy: SpaceAlbumGroupBy.Owner }, ctx);
  const names = g.map((x) => x.name);
  expect(names).toContain('Zoe');
  expect(names).toContain('Unassigned'); // empty albumUsers bucket
  expect(() =>
    buildSpaceAlbumGroups(
      [A({ id: 'e', albumUsers: [] })],
      { ...get(spaceAlbumViewSettings), groupBy: SpaceAlbumGroupBy.Owner },
      ctx,
    ),
  ).not.toThrow();
});

it('getSelectedSpaceAlbumGroupOption falls back to None when Year is disabled under date sort', () => {
  const s = { ...get(spaceAlbumViewSettings), groupBy: SpaceAlbumGroupBy.Year, sortBy: AlbumSortBy.DateCreated };
  spaceAlbumViewSettings.set(s);
  expect(getSelectedSpaceAlbumGroupOption(s)).toBe(SpaceAlbumGroupBy.None);
});

it('collapse mutators write only the space store, keyed by groupBy', () => {
  spaceAlbumViewSettings.update((s) => ({ ...s, groupBy: SpaceAlbumGroupBy.Year }));
  toggleSpaceAlbumGroupCollapsing('2024');
  expect(isSpaceAlbumGroupCollapsed(get(spaceAlbumViewSettings), '2024')).toBe(true);
  collapseAllSpaceAlbumGroups(['2024', '2020']);
  expect(get(spaceAlbumViewSettings).collapsedGroups.Year.sort()).toEqual(['2020', '2024']);
  expandAllSpaceAlbumGroups();
  expect(get(spaceAlbumViewSettings).collapsedGroups.Year).toEqual([]);
});
```

- [ ] **Step 2: Run — expect RED** (module missing). `cd web && pnpm test -- --run src/lib/utils/space-album-grouping.spec.ts`.

- [ ] **Step 3: Implement `space-album-grouping.ts`.** Mirror album-utils' logic (contracts in the spec §Slice-4 research), adapted:
  - `spaceGroupOptionsMetadata`: `[None, Year, LinkedBy, Owner]`; `Year.isDisabled = () => [AlbumSortBy.DateCreated, AlbumSortBy.DateModified].includes(get(spaceAlbumViewSettings).sortBy)`; others `false`.
  - `getSelectedSpaceAlbumGroupOption(settings)` → falls back to `None` if the selected option's `isDisabled()`.
  - Collapse helpers: copy album-utils' `getCollapsedAlbumGroups`/`isAlbumGroupCollapsed`/`toggleAlbumGroupCollapsing`/`collapseAllAlbumGroups`/`expandAllAlbumGroups` verbatim but bind `spaceAlbumViewSettings` and rename with `Space`. `isSpaceAlbumGroupCollapsed(settings, id)` takes settings (no store read).
  - `buildSpaceAlbumGroups(albums, settings, ctx)` where `ctx = { ungrouped, unknownYear, unassigned, currentUserId, members }`:
    - `groupBy = getSelectedSpaceAlbumGroupOption(settings)`, `order = stringToSortOrder(settings.groupOrder)`.
    - None → `[{ id: ctx.ungrouped, name: ctx.ungrouped, albums }]`.
    - Year → mirror album-utils (date = `settings.sortBy === AlbumSortBy.OldestPhoto ? startDate : endDate`; unknown-year bucket via `ctx.unknownYear`, forced last; `id===name===year`).
    - LinkedBy → `groupBy(albums, a => a.addedById && ctx.members.find(m => m.userId === a.addedById)?.userId || '__unassigned__')`; group `name` = member name or `ctx.unassigned`; sort by name asc/desc, unassigned last.
    - Owner → `groupBy(albums, a => a.albumUsers[0]?.user.id ?? '__unassigned__')` (GUARD `?.`); `name` = `id === ctx.currentUserId ? ctx.myAlbums? : owner.name` (guard `albumUsers[0]?.user.name ?? ctx.unassigned`); current-user group pinned like album-utils.
    - Then re-sort each group's `albums` via `sortAlbums(group.albums as unknown as AlbumResponseDto[], { sortBy: settings.sortBy, orderBy: settings.sortOrder })`.
  - Add `ctx.myAlbums` to the ctx if you use it for the current-user owner bucket (or reuse `unassigned` semantics only for empty). Keep it explicit and test it.

- [ ] **Step 4: Run — expect GREEN + tsc.** All util spec cases pass; `pnpm check:typescript` exit 0.

- [ ] **Step 5: Commit.**

```bash
git add web/src/lib/utils/space-album-grouping.ts web/src/lib/utils/space-album-grouping.spec.ts
git commit -m "feat(spaces): fork album grouping util (None/Year/LinkedBy/Owner) + collapse helpers"
```

---

## Task 2: Group rendering in SpaceAlbumsList (+ thread members)

**Files:** Modify `space-albums-list.svelte` (+ spec); modify `+page.svelte` to pass `members`.

**Interfaces:**

- Consumes: `buildSpaceAlbumGroups`, `getSelectedSpaceAlbumGroupOption`, `isSpaceAlbumGroupCollapsed`, `toggleSpaceAlbumGroupCollapsing` (Task 1); `SpaceAlbumGroupBy`.
- Produces: `SpaceAlbumsList` now takes `members: SharedSpaceMemberResponseDto[]`; renders grouped cover output (per-group header + grid) and passes groups to `SpaceAlbumsTable`.

- [ ] **Step 1: Extend the list spec (red).** Assert: with `groupBy = Year` and albums across two years, two group headers render with the year names and counts; collapsing a group (via `toggleSpaceAlbumGroupCollapsing`) hides its cards; `groupBy = LinkedBy` renders member-name headers + an "Unassigned" group for null `addedById`; ungrouped (`None`) renders a flat grid (no headers). Provide `members` prop.

- [ ] **Step 2: Run — expect RED.**

- [ ] **Step 3: Implement.** In `space-albums-list.svelte`: add `members` prop. Build `groups = $derived(buildSpaceAlbumGroups(sorted, $spaceAlbumViewSettings, { ungrouped: $t('albums'), unknownYear: $t('unknown_year'), unassigned: $t('unassigned'), myAlbums: $t('my_albums'), currentUserId: authManager.user.id, members }))`. When `getSelectedSpaceAlbumGroupOption($spaceAlbumViewSettings) === None`, render the existing flat grid/table of `sorted`. Otherwise, for cover mode render `{#each groups as group (group.id)}` a header button (chevron + `group.name` + `({$t('albums_count', {values:{count: group.albums.length}})})`, `onclick={() => toggleSpaceAlbumGroupCollapsing(group.id)}`, `data-testid="space-album-group-{group.id}"`) then, when `!isSpaceAlbumGroupCollapsed($spaceAlbumViewSettings, group.id)`, the `grid grid-auto-fill-56 gap-y-4` of `SpaceAlbumCard`s for `group.albums`; for list mode pass `groups` + the grouped flag to `SpaceAlbumsTable`.

- [ ] **Step 4: Wire `+page.svelte`.** Pass `members` to `<SpaceAlbumsList ... {members} />`.

- [ ] **Step 5: Run — GREEN + tsc + lint.**

- [ ] **Step 6: Commit.**

```bash
git add web/src/lib/components/spaces/space-albums-list.svelte web/src/lib/components/spaces/space-albums-list.spec.ts "web/src/routes/(user)/spaces/[spaceId]/albums/+page.svelte" i18n/en.json
git commit -m "feat(spaces): grouped cover rendering + collapse in space albums list"
```

---

## Task 3: Grouped rendering in SpaceAlbumsTable

**Files:** Modify `space-albums-table.svelte` (+ spec).

- [ ] **Step 1: Extend the table spec (red).** With grouped input, assert per-group collapsible header `tbody` rows (name + count) render, and collapsing hides that group's rows.

- [ ] **Step 2: Run — RED.**

- [ ] **Step 3: Implement.** Add optional `groups?: SpaceAlbumGroup[]` + `grouped: boolean` props (or accept `groups` and branch on length). Mirror `AlbumsTable`'s grouped `<tbody>` header + body pattern, using `isSpaceAlbumGroupCollapsed($spaceAlbumViewSettings, group.id)` + `toggleSpaceAlbumGroupCollapsing`, and the existing space row markup for `group.albums`. Ungrouped path unchanged (renders `albums` flat).

- [ ] **Step 4: GREEN + tsc + lint. Step 5: Commit.**

```bash
git commit -m "feat(spaces): grouped collapsible rows in space albums table"
```

---

## Task 4: Group dropdown + expand/collapse-all in controls

**Files:** Modify `space-albums-controls.svelte` (+ spec); `i18n/en.json` (`group_linked_by`).

- [ ] **Step 1: Extend the controls spec (red).** Assert: a group menu lists **None / Year / Linked by / Owner**; selecting one writes `$spaceAlbumViewSettings.groupBy` (space store only); the `Year` option is disabled when `sortBy` is `DateCreated`/`DateModified`; expand/collapse-all buttons appear only when the selected group ≠ None and call the fork mutators.

- [ ] **Step 2: Run — RED.**

- [ ] **Step 3: Implement.** Mirror the Slice-3 sort control's plain-button menu (`showGroupMenu`, container `data-testid="space-albums-group-container"`, btn `-group-btn`, menu `-group-menu`, options `-group-option-{id}`). Options from `spaceGroupOptionsMetadata`; disabled per `isDisabled()`; labels: `{None: $t('group_no'), Year: $t('group_year'), LinkedBy: $t('group_linked_by'), Owner: $t('group_owner')}`. `handleChangeGroupBy` mirrors AlbumsControls (same id → flip `groupOrder`, else set `groupBy` + `defaultOrder`). Add expand/collapse-all `IconButton`s gated on `getSelectedSpaceAlbumGroupOption($spaceAlbumViewSettings) !== None`, calling `expandAllSpaceAlbumGroups()` / `collapseAllSpaceAlbumGroups(groupIds)` — the controls need the current group ids; derive them or accept a `groupIds` prop from the list (simplest: compute in the page/list and pass down, OR compute in controls from the albums+settings). Add `group_linked_by` to `i18n/en.json` (value "Group by who linked").

- [ ] **Step 4: GREEN + tsc + lint. Step 5: Commit.**

```bash
git commit -m "feat(spaces): group dropdown + expand/collapse-all in space albums controls"
```

---

## Slice 4 exit gate

- `cd web && pnpm test` green; `pnpm check:typescript` exit 0; `pnpm lint` (no new eslint errors on touched files).

## Self-review (author)

- Spec Slice 4 tests: None/Year/LinkedBy/Owner buckets ✓; Year start/end conditional (#10) ✓; unknown-year "No date" (#9) ✓; null addedById + linker-not-member → Unassigned (#7,#8) ✓; Owner empty-albumUsers guard (#5, no crash) ✓; Year disabled under date sort (#11) ✓; collapse/expand space-scoped ✓; group dropdown lists 4 + writes space store ✓.
- Pure util (ctx labels) keeps grouping testable; components inject `$t`/members.
