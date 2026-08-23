# Space Albums Launch Fixes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. Dispatch implementation subagents on the **sonnet** model.
>
> **Slices for `impl-loop`:** each `### Task N` is one slice — slice _N_ ⇒ Task _N_. Tasks 1–6 are the implementation slices; **Task 7 is the final verification gate, run inline — it is not a slice.** Implement in numeric order: several slices share files (Tasks 2 & 3 both edit the space-album `+page.svelte` and `space-album-detail-page.spec.ts`; Tasks 4 & 5 both edit `shared-space.repository.ts`, `shared.space.repository.sql`, and the repository medium spec), so they must land sequentially, never in parallel.

**Goal:** Fix the six verifier-confirmed pre-launch findings from the 2026-07-19 final review of PR #752 (Space Albums), each with TDD/BDD test coverage. **Scope is deliberately limited to these six bug fixes** — the S4 RBAC reroute, the added coverage tests, and the docs additions from the review are all deferred past launch as too risky/large right now (see Out of scope).

**Architecture:** Six independent slices — three web client-truth fixes (remove-from-album results, add-photos failure, filter-panel reopen), one server+web pagination fix (activity feed), one server retention fix (face-sweep contributed arm), one DB trigger migration (member re-join grant refresh). No API-shape changes, no OpenAPI regen, no new dependencies.

**Tech Stack:** SvelteKit/Svelte 5 + Vitest + @testing-library/svelte (web), NestJS + Kysely + Vitest medium tests via testcontainers (server), raw-SQL Postgres trigger migration (Kysely migration file).

**Branch / worktree:** `space-albums-launch-fixes` (stacked on top of `space-albums-onto-main`) in `/Users/pierre/dev/gallery/.claude/worktrees/space-albums-rebase-v303`. This ships as a **separate PR** whose base is `space-albums-onto-main` (PR #752), so #752 stays untouched. Pushing triggers PR CI.

## Global Constraints

- TDD every slice: write the failing test, run it and observe RED, implement, observe GREEN, commit. Never write the implementation first.
- BDD naming: every new `it(...)` describes observable behavior ("shows a warning when nothing was removed"), never implementation ("calls filter on results").
- Commit per task, conventional-commit style with `(#752)` suffix like the branch's existing commits. **Never add Co-Authored-By / Generated-with trailers.**
- Server: no relative imports (use `src/` alias). ESLint zero-warnings. ESLint green ≠ Prettier green: run `pnpm exec prettier --check <touched files>` (from `server/`) on every touched server file, source included.
- Web: run only the targeted spec file per task (`pnpm test -- --run <file>` from `web/`); defer the full lint/check pass to the final gate. `pnpm lint` from `web/` has no `--max-warnings` — ~640 pre-existing tailwind warnings are tolerated, new errors are not.
- i18n: new keys go to `i18n/en.json` ONLY (shared web+mobile dir; other locales are translated separately).
- **NEVER run `make sql` / `mise //:sql` locally.** Without a DB it deletes all query docs; with a DB it deterministically corrupts `session.repository.sql`/`search.repository.sql` and drops 2nd+ statements of multi-statement `@GenerateSql` methods. Instead hand-edit `server/src/queries/shared.space.repository.sql` to mirror query changes; if the CI "SQL Schema Checks" job disagrees, download that job's diff and `git apply` it (strip any leading timestamp prefixes).
- Medium tests need Docker running (testcontainers): `cd server && pnpm test:medium -- --run <file>`.
- Test-code blocks below are complete but written blind of each spec file's local harness — before inserting, read the target spec file and align imports, factory helpers, and mock setup with its existing describe blocks. Behavior asserted must not be weakened.
- **Two end-to-end tests are green-once-the-fix-is-in by construction** (Task 5 Step 6 unlink sweep; Task 6 Step 5 re-delivery). The slice's RED evidence is its repository/trigger test (Task 5 Steps 1–2; Task 6 Steps 1–2) — observe that failing first. To see the end-to-end test itself red, stash the fix once as the step notes. This is deliberate, not a TDD violation: do not skip the repo/trigger RED, and do not treat "passes on first run" as a failure for these two.
- New fork migration timestamp is `1783700000000` (round, greater than the current latest fork migration `1783628194057`; verified free). Create it in `server/src/schema/migrations-gallery/` — never edit an already-shipped migration in place (RC/staging DBs recorded the old body; use a new `CREATE OR REPLACE` migration, following the `1782100000000` precedent).

---

### Task 1: Truthful remove-from-album results (web, MED-HIGH)

**Finding:** A space editor removing another member's `album_asset` photos on the space album page gets per-asset `success:false, error:no_permission` from the server (which fails closed), but the shared action prunes ALL selected ids from the timeline and always shows a success-styled toast — "Removed 0 assets" while every photo vanishes until reload. Contributions (`album_space_asset`) DO remove successfully; only others' `album_asset` rows fail, so multi-member albums hit this asymmetrically. The regular album page gates the action on `isOwned || isAllUserOwned` so the mixed case was unreachable before the space page.

**Files:**

- Modify: `web/src/lib/components/timeline/actions/RemoveFromAlbumAction.svelte` (lines 32–48)
- Modify: `i18n/en.json` (two new keys)
- Test: Create `web/src/lib/components/timeline/actions/remove-from-album-action.spec.ts`

**Interfaces:**

- Consumes: `removeAssetFromAlbum` returns `BulkIdResponseDto[]` (`{ id, success, error? }`).
- Produces: `onRemove` is now invoked with **only the successfully removed ids** (callers `handleRemoveAssets` on the space album page and the regular album page treat the argument as "ids actually removed" — no caller change needed).

- [ ] **Step 1: Write the failing tests**

Create `web/src/lib/components/timeline/actions/remove-from-album-action.spec.ts`:

```ts
import RemoveFromAlbumAction from '$lib/components/timeline/actions/RemoveFromAlbumAction.svelte';
import { assetMultiSelectManager } from '$lib/managers/asset-multi-select-manager.svelte';
import { getAlbumInfo, removeAssetFromAlbum, type AlbumResponseDto } from '@immich/sdk';
import { modalManager, toastManager } from '@immich/ui';
import { render, screen } from '@testing-library/svelte';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@immich/sdk', async (original) => ({
  ...(await original()),
  removeAssetFromAlbum: vi.fn(),
  getAlbumInfo: vi.fn(),
}));

describe('RemoveFromAlbumAction', () => {
  const album = { id: 'album-1', albumName: 'Trip' } as AlbumResponseDto;

  beforeEach(() => {
    vi.restoreAllMocks();
    vi.spyOn(modalManager, 'showDialog').mockResolvedValue(true);
    vi.mocked(getAlbumInfo).mockResolvedValue(album);
    assetMultiSelectManager.clear();
  });

  const clickRemove = async () => {
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: /remove_from_album/i }));
  };

  it('prunes only the assets the server actually removed', async () => {
    vi.mocked(removeAssetFromAlbum).mockResolvedValue([
      { id: 'a1', success: true },
      { id: 'a2', success: false, error: 'no_permission' },
    ]);
    const onRemove = vi.fn();
    render(RemoveFromAlbumAction, { album, onRemove, assetIds: ['a1', 'a2'] });

    await clickRemove();

    expect(onRemove).toHaveBeenCalledWith(['a1']);
  });

  it('shows a warning, not success, when nothing was removed', async () => {
    vi.mocked(removeAssetFromAlbum).mockResolvedValue([
      { id: 'a1', success: false, error: 'no_permission' },
      { id: 'a2', success: false, error: 'no_permission' },
    ]);
    const warning = vi.spyOn(toastManager, 'warning').mockImplementation(() => ({}) as never);
    const primary = vi.spyOn(toastManager, 'primary').mockImplementation(() => ({}) as never);
    render(RemoveFromAlbumAction, { album, onRemove: vi.fn(), assetIds: ['a1', 'a2'] });

    await clickRemove();

    expect(warning).toHaveBeenCalled();
    expect(primary).not.toHaveBeenCalled();
  });

  it('reports a partial removal as info with both counts', async () => {
    vi.mocked(removeAssetFromAlbum).mockResolvedValue([
      { id: 'a1', success: true },
      { id: 'a2', success: false, error: 'no_permission' },
    ]);
    const info = vi.spyOn(toastManager, 'info').mockImplementation(() => ({}) as never);
    const primary = vi.spyOn(toastManager, 'primary').mockImplementation(() => ({}) as never);
    render(RemoveFromAlbumAction, { album, onRemove: vi.fn(), assetIds: ['a1', 'a2'] });

    await clickRemove();

    expect(info).toHaveBeenCalled();
    expect(primary).not.toHaveBeenCalled();
  });

  it('keeps the success toast when every asset was removed', async () => {
    vi.mocked(removeAssetFromAlbum).mockResolvedValue([{ id: 'a1', success: true }]);
    const primary = vi.spyOn(toastManager, 'primary').mockImplementation(() => ({}) as never);
    render(RemoveFromAlbumAction, { album, onRemove: vi.fn(), assetIds: ['a1'] });

    await clickRemove();

    expect(primary).toHaveBeenCalled();
  });
});
```

Adapt the i18n/render harness to how sibling web component specs mock `svelte-i18n` (the button's aria-label is `$t('remove_from_album')`; if the suite renders raw keys, query by the key string).

- [ ] **Step 2: Run tests, verify RED**

Run: `cd web && pnpm test -- --run src/lib/components/timeline/actions/remove-from-album-action.spec.ts`
Expected: FAIL — `onRemove` called with `['a1','a2']`; `primary` called in the zero/partial cases.

- [ ] **Step 3: Implement**

In `RemoveFromAlbumAction.svelte`, replace lines 32–48 (`try { ... }` body) with:

```ts
try {
  const results = await removeAssetFromAlbum({
    id: album.id,
    bulkIdsDto: { ids },
  });

  album = await getAlbumInfo({ id: album.id });

  // #752 launch review: the server answers per-asset (a space editor may not remove another
  // member's own album_asset rows) — prune and report only what was actually removed.
  const removedIds = results.filter(({ success }) => success).map(({ id }) => id);
  onRemove?.(removedIds);

  if (removedIds.length === ids.length) {
    toastManager.primary($t('assets_removed_count', { values: { count: removedIds.length } }));
  } else if (removedIds.length > 0) {
    toastManager.info(
      $t('assets_removed_partial_count', {
        values: { removedCount: removedIds.length, totalCount: ids.length },
      }),
    );
  } else {
    toastManager.warning($t('assets_remove_failed_count', { values: { count: ids.length } }));
  }

  assetMultiSelectManager.clear();
} catch (error) {
  handleError(error, $t('errors.error_removing_assets_from_album'));
}
```

Add to `i18n/en.json` (alphabetical position among the `assets_*` keys):

```json
"assets_remove_failed_count": "Could not remove {count, plural, one {# asset} other {# assets}} from the album",
"assets_removed_partial_count": "Removed {removedCount} of {totalCount} assets",
```

Match the ICU style of the existing `assets_removed_count` key — if it is a plain `{count}` string, use plain strings here too.

- [ ] **Step 4: Run tests, verify GREEN**

Run: `cd web && pnpm test -- --run src/lib/components/timeline/actions/remove-from-album-action.spec.ts`
Expected: PASS (all 4). Also run the two consumer suites to catch regressions:
`pnpm test -- --run "src/routes/(user)/spaces/[spaceId]/albums/[albumId=id]/[[photos=photos]]/[[assetId=id]]/space-album-detail-page.spec.ts"`

- [ ] **Step 5: Commit**

```bash
git add web/src/lib/components/timeline/actions/RemoveFromAlbumAction.svelte web/src/lib/components/timeline/actions/remove-from-album-action.spec.ts i18n/en.json
git commit -m "fix(web): report remove-from-album results truthfully, prune only removed assets (#752)"
```

---

### Task 2: No phantom timeline insert when add-photos fails (web, MED)

**Finding:** On the space album page, `addAssetsToAlbums` never rejects (it catches, toasts, and returns `false`), but the caller ignores the boolean — on a 5xx/network failure `handleAddAssetsSuccess(added)` still runs, upserting never-added photos into the album grid under the error toast and exiting the picker. The regular album page avoids this via its `AlbumAddAssets` event listener; the space page has none.

**Files:**

- Modify: `web/src/routes/(user)/spaces/[spaceId]/albums/[albumId=id]/[[photos=photos]]/[[assetId=id]]/+page.svelte` (lines 471–486, the `AddAssets` `onAction`)
- Test: Modify `web/src/routes/(user)/spaces/[spaceId]/albums/[albumId=id]/[[photos=photos]]/[[assetId=id]]/space-album-detail-page.spec.ts` (next to the existing add-success test, around line 467)

**Interfaces:**

- Consumes: `addAssetsToAlbums(albumIds, assetIds, { notify }): Promise<boolean>` from `$lib/services/album.service.ts` — `true` iff the HTTP call succeeded.
- Produces: on `false`, the page stays in `add` mode with the selection intact so the user can retry; the browse timeline is untouched.

- [ ] **Step 1a: Stop the pre-existing success test from relying on the bug**

The current test `firing AddAssets action in add mode returns to browse and refreshes album` (~line 468) does **not** mock `addAssetsToAlbums`. The real service runs, its SDK `addToAlbum` call rejects (no server), so it returns `false` — yet today `handleAddAssetsSuccess` runs anyway (the bug), calling `getAlbumInfo`, and the test passes. After the Step 3 fix that test would FAIL (`ok === false` → `handleAddAssetsSuccess` skipped → `getAlbumInfo` never called). So it must first be converted into a genuine success-path test.

Extend the existing `vi.mock('$lib/services/album.service', …)` block (it currently spreads `...actual` and overrides only `getAlbumAssetsActions`) to also stub the service:

```ts
vi.mock('$lib/services/album.service', async (importOriginal) => {
  const actual = await importOriginal<typeof import('$lib/services/album.service')>();
  return {
    ...actual,
    getAlbumAssetsActions: vi.fn().mockReturnValue(/* existing default */),
    addAssetsToAlbums: vi.fn().mockResolvedValue(true),
  };
});
```

Then in the pre-existing test body add `vi.mocked(addAssetsToAlbums).mockResolvedValue(true);` so it exercises the real success path (add succeeds → `handleAddAssetsSuccess` → `getAlbumInfo`). Its existing assertions stay.

- [ ] **Step 1b: Write the failing test**

Add a sibling test in the same describe, reusing the file's add-mode helpers verbatim from the success test:

```ts
it('does not insert photos into the album grid when the add call fails', async () => {
  // The service never rejects — on 5xx/network it toasts and resolves false.
  vi.mocked(addAssetsToAlbums).mockResolvedValue(false);
  renderPage({ members: [makeMember(SharedSpaceRole.Editor)], album: makeAlbum({ id: 'album-1' }) });

  // Enter add mode and fire the header Add action, exactly as the success test does.
  await fireEvent.click(screen.getByTestId('add-photos-button'));
  await waitFor(() => expect(screen.getByTestId('space-album-timeline')).toHaveAttribute('data-mode', 'add'));
  await fireEvent.click(screen.getByRole('button', { name: /add assets/i }));

  // The picker stays open (retry) and nothing was optimistically upserted into the browse timeline.
  expect(screen.getByTestId('add-photos-overlay')).toBeInTheDocument();
  expect(mockTimelineState.upsertAssets).not.toHaveBeenCalled();
});
```

`mockTimelineState.upsertAssets` (`mock-timeline-state.ts`, `Object.assign`-ed onto the bound `timelineManager`) is the assertable spy — use whatever name the file actually binds it under. If the file exposes no `add-photos-overlay` testid, assert the mode stayed `add` (the browse timeline's `data-mode` attribute) and `getAlbumInfo` was not called instead.

- [ ] **Step 2: Run test, verify RED**

Run: `cd web && pnpm test -- --run "src/routes/(user)/spaces/[spaceId]/albums/[albumId=id]/[[photos=photos]]/[[assetId=id]]/space-album-detail-page.spec.ts"`
Expected: the new test FAILS (`upsertAssets` was called / overlay closed).

- [ ] **Step 3: Implement**

In the page's `AddAssets` action (lines 471–486), replace the `onAction` with:

```ts
onAction: () => {
  const added = pickerMultiSelectManager.assets;
  void addAssetsToAlbums(
    [album.id],
    added.map(({ id }) => id),
    { notify: true },
  ).then((ok) => (ok ? handleAddAssetsSuccess(added) : undefined));
},
```

- [ ] **Step 4: Run tests, verify GREEN**

Same command as Step 2. Expected: PASS — the new failure test, AND the pre-existing success test now that it mocks `addAssetsToAlbums → true` (Step 1a). If the pre-existing test fails with "getAlbumInfo not called", Step 1a's mock conversion was missed.

- [ ] **Step 5: Commit**

```bash
git add "web/src/routes/(user)/spaces/[spaceId]/albums/[albumId=id]/[[photos=photos]]/[[assetId=id]]/+page.svelte" "web/src/routes/(user)/spaces/[spaceId]/albums/[albumId=id]/[[photos=photos]]/[[assetId=id]]/space-album-detail-page.spec.ts"
git commit -m "fix(web): keep the space-album picker open and the grid untouched when adding photos fails (#752)"
```

---

### Task 3: Filter panel reopenable at every viewport (web, MED — regression beyond spaces)

**Finding:** Commit `3354acbcaf` made the collapsed filter panel reopenable only via a header button that is `hidden md:flex`, while the in-panel collapse (X) button renders at every viewport and the collapsed state persists in ONE global localStorage key (`gallery-filter-collapsed`). A phone user who taps X is permanently stuck with the panel at `w-0` on photos, album detail, spaces timeline, and space album detail. The pre-commit code rendered an expand strip at every size.

**Files:**

- Modify: `web/src/lib/components/filter-panel/filter-toolbar.svelte` (root display class line 54, button wrapper line 59)
- Modify: `web/src/routes/(user)/spaces/[spaceId]/albums/[albumId=id]/[[photos=photos]]/[[assetId=id]]/+page.svelte` (lines 269–281, the page-local reopen/grouping bar)
- Test: Modify `web/src/lib/components/filter-panel/__tests__/filter-toolbar.spec.ts`

**Interfaces:**

- Consumes: existing `FilterToolbar` props `showFilterButton`, `filterActive`, `onExpandFilters` (no prop changes).
- Produces: the reopen affordance renders at ALL viewports whenever `showFilterButton && onExpandFilters`; the grouping control stays desktop-only (`hidden md:flex`). `TimelineRouteGroupingBar` (passes `class="hidden md:flex"`, no `showFilterButton`) stays desktop-only via twMerge — do not change it.

- [ ] **Step 1a: Reconcile the existing responsive-contract assertions**

`filter-toolbar.spec.ts` already has a "responsive contract" describe that reads `root.className` for `hidden` / `md:flex`. The Step 3 change flips the root from `hidden md:flex` to `flex` in the `showFilterButton && onExpandFilters && !showFilters` case. Read that block first and update any assertion that pins **that** case to the old `hidden md:flex` class — otherwise it fails at Step 4 (same trap as Task 2's pre-existing test). Assertions covering the `showFilters` (active) case and the no-`showFilterButton` case are unaffected; leave them.

- [ ] **Step 1b: Write the failing tests**

Add to `filter-toolbar.spec.ts` (match its existing render helper):

```ts
describe('collapsed-panel reopen button', () => {
  it('renders the reopen button without responsive hiding so phones can reopen the panel', () => {
    render(FilterToolbar, {
      grouping: 'day',
      onGroupingChange: vi.fn(),
      showFilterButton: true,
      filterActive: false,
      onExpandFilters: vi.fn(),
    });

    const root = screen.getByTestId('filter-toolbar-root');
    expect(root.className).toContain('flex');
    expect(root.className).not.toMatch(/(?:^|\s)hidden(?:\s|$)/);

    const wrapper = screen.getByTestId('filter-toolbar-reopen');
    expect(wrapper.className).not.toMatch(/(?:^|\s)hidden(?:\s|$)/);
  });

  it('keeps the grouping control desktop-only', () => {
    render(FilterToolbar, {
      grouping: 'day',
      onGroupingChange: vi.fn(),
      showFilterButton: true,
      filterActive: false,
      onExpandFilters: vi.fn(),
    });

    expect(screen.getByTestId('timeline-desktop-grouping-control').className).toContain('hidden');
  });
});
```

(The two testids `filter-toolbar-root` / `filter-toolbar-reopen` are added in Step 3; the grouping testid already exists.)

- [ ] **Step 2: Run tests, verify RED**

Run: `cd web && pnpm test -- --run src/lib/components/filter-panel/__tests__/filter-toolbar.spec.ts`
Expected: FAIL (testids missing / `hidden` present).

- [ ] **Step 3: Implement**

`filter-toolbar.svelte` — change the root display ternary (line 54) and the button wrapper (lines 58–62):

```svelte
      showFilterButton ? 'ps-2' : 'ps-4',
      showFilters || (showFilterButton && onExpandFilters) ? 'flex' : 'hidden md:flex',
      className,
    )}
    data-testid="filter-toolbar-root"
  >
    {#if showFilterButton && onExpandFilters}
      <!-- Visible at EVERY viewport: collapsing is possible at every viewport (the panel's X has no
           breakpoint) and the collapsed flag is a global preference — an md:-gated reopen button
           permanently strands small screens (#752 launch review F3). -->
      <div class="flex items-center" data-testid="filter-toolbar-reopen">
        <FilterToggleButton active={filterActive} onExpand={onExpandFilters} />
      </div>
    {/if}
```

Space album page (lines 269–281) — same principle for its page-local bar (reopen visible on mobile when collapsed; grouping stays desktop-only):

```svelte
{#if !assetMultiSelectManager.selectionActive}
  <div
    class="mb-2 shrink-0 items-center gap-2 bg-transparent py-2 pe-4 dark:bg-transparent {filterCollapsed &&
    !isBrowseEmpty
      ? 'flex ps-2'
      : 'hidden ps-4 md:flex'}"
  >
    {#if filterCollapsed && !isBrowseEmpty}
      <FilterToggleButton active={browseActive > 0} onExpand={() => (filterCollapsed = false)} />
    {/if}
    <div class="hidden md:flex md:items-center" data-testid="timeline-desktop-grouping-control">
      <TimelineGroupingControl grouping={timelineGrouping} onGroupingChange={handleTimelineGroupingChange} />
    </div>
  </div>
{/if}
```

(The `data-testid="timeline-desktop-grouping-control"` moves from the outer bar onto the grouping wrapper so its "desktop-only" contract stays true; update any selector in `space-album-detail-page.spec.ts` that asserted on the outer div.)

- [ ] **Step 4: Run tests, verify GREEN**

Run both:
`cd web && pnpm test -- --run src/lib/components/filter-panel/__tests__/filter-toolbar.spec.ts`
`cd web && pnpm test -- --run "src/routes/(user)/spaces/[spaceId]/albums/[albumId=id]/[[photos=photos]]/[[assetId=id]]/space-album-detail-page.spec.ts"`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add web/src/lib/components/filter-panel/filter-toolbar.svelte web/src/lib/components/filter-panel/__tests__/filter-toolbar.spec.ts "web/src/routes/(user)/spaces/[spaceId]/albums/[albumId=id]/[[photos=photos]]/[[assetId=id]]/+page.svelte" "web/src/routes/(user)/spaces/[spaceId]/albums/[albumId=id]/[[photos=photos]]/[[assetId=id]]/space-album-detail-page.spec.ts"
git commit -m "fix(web): make the collapsed filter panel reopenable on mobile viewports (#752)"
```

---

### Task 4: Activity feed — dead-album filtering in SQL + resilient load-more (server+web, MED)

**Finding:** `getActivities` pages raw rows with LIMIT/OFFSET, then the service post-filters `album_link`/`album_unlink` rows whose album was deleted (routine: the abandoned-create flow deletes albums). One dropped row → page < 20 → the client's `hasMore = length === 20` hides Load-more and all older activity becomes unreachable; the client also advances its offset by the filtered count against a raw-row offset (duplicates). `loadMoreActivities` has no error handling.

**Files:**

- Modify: `server/src/repositories/shared-space.repository.ts` (`getActivities`, lines 1559–1580)
- Modify: `server/src/queries/shared.space.repository.sql` (hand-mirror the query change — see Global Constraints)
- Modify: `web/src/routes/(user)/spaces/[spaceId]/activity/+page.svelte` (lines 16–21)
- Test: Modify `server/test/medium/specs/repositories/shared-space.repository.spec.ts`; Modify `web/src/routes/(user)/spaces/[spaceId]/activity/space-activity-page.spec.ts` (file lives next to the page; if named differently, extend the existing space-activity page spec)

**Interfaces:**

- Consumes: `SharedSpaceActivityType.AlbumLink` / `.AlbumUnlink` from `src/enum`; activity `data` jsonb carries `albumId` as text.
- Produces: `getActivities` now returns only rows renderable by the service (album link/unlink rows are included iff their album exists and is not soft-deleted), so a short page really means "no more data". The service-level post-filter in `shared-space.service.ts:911-921` stays as defense-in-depth (it should now never drop anything).

- [ ] **Step 1: Write the failing medium test**

Add to `server/test/medium/specs/repositories/shared-space.repository.spec.ts` (reuse its existing space/user/album factories):

```ts
describe('getActivities — dead-album entries are filtered in SQL (full pages)', () => {
  it('returns a full page even when deleted-album link entries fall inside it', async () => {
    // Given a space with 20 link activities for live albums and 1 for a since-deleted album,
    // interleaved so the dead entry falls inside the first page.
    // (Seed: 10 live-album link activities, then the dead-album one, then 10 more live.)
    // When the first page of 20 is fetched
    const page = await sharedSpaceRepository.getActivities(spaceId, 20, 0);
    // Then it contains 20 rows, none referencing the deleted album
    expect(page).toHaveLength(20);
    expect(page.every((a) => (a.data as { albumId?: string }).albumId !== deletedAlbumId)).toBe(true);
    // And the second page delivers the remaining live row(s) — older activity stays reachable
    const rest = await sharedSpaceRepository.getActivities(spaceId, 20, 20);
    expect(rest.length).toBeGreaterThan(0);
  });

  it('keeps non-album activity types regardless of their data payload', async () => {
    // A member_join (or any non-album) activity with no albumId must not be filtered.
    const page = await sharedSpaceRepository.getActivities(spaceIdWithMemberJoin, 20, 0);
    expect(page.some((a) => a.type === 'member_join')).toBe(true);
  });
});
```

Seed the dead-album case by creating a real album, logging the activity via `logActivity({ type: SharedSpaceActivityType.AlbumLink, data: { albumId } })`, then **soft-deleting** it via `ctx.softDeleteAlbum(album.id)` (the helper already used in this spec's `getActivities` describe). **Use soft-delete, not a hard row delete:** the Step 3 fix filters on `album.deletedAt is null`, and only a soft-deleted album (row present, `deletedAt` set) exercises that predicate — a hard-deleted row would be dropped by non-existence alone, so a regression that omitted the `deletedAt` clause would still pass. For completeness also add one hard-deleted-album case (asserting non-existence is handled too), but the soft-delete case is the one that pins the fix.

- [ ] **Step 2: Run test, verify RED**

Run: `cd server && pnpm test:medium -- --run test/medium/specs/repositories/shared-space.repository.spec.ts`
Expected: first new test FAILS (page has 19 rows or contains the dead-album entry).

- [ ] **Step 3: Implement the repository change**

In `getActivities` (line 1559), add one where-clause between the `spaceId` filter and the `orderBy`:

```ts
      .where('shared_space_activity.spaceId', '=', spaceId)
      // Drop album link/unlink entries whose album no longer exists (e.g. the abandoned create-flow
      // album deleted on navigate-away) IN SQL, not post-hoc: LIMIT must yield full pages, because
      // the client infers hasMore from a full page and advances its offset by the returned count —
      // a post-SQL filter shrinks pages, dead-ends pagination, and desyncs the offset (#752 F4).
      .where((eb) =>
        eb.or([
          eb('shared_space_activity.type', 'not in', [
            SharedSpaceActivityType.AlbumLink,
            SharedSpaceActivityType.AlbumUnlink,
          ]),
          eb.exists(
            eb
              .selectFrom('album')
              .select('album.id')
              .where('album.deletedAt', 'is', null)
              .where(sql<boolean>`album.id::text = shared_space_activity.data->>'albumId'`),
          ),
        ]),
      )
```

Import `SharedSpaceActivityType` from `src/enum` (the repo file already imports `sql` from kysely; add it if not). Text-compare `album.id::text` against the jsonb field — never cast the jsonb value to uuid (a malformed payload must filter out, not error). Hand-mirror the new SQL into `server/src/queries/shared.space.repository.sql` under the `getActivities` entry.

- [ ] **Step 4: Run tests, verify GREEN**

Run: `cd server && pnpm test:medium -- --run test/medium/specs/repositories/shared-space.repository.spec.ts`
Also run the service unit suite (the post-filter behavior is pinned there and must still pass):
`cd server && pnpm test -- --run src/services/shared-space.service.spec.ts`
Expected: PASS.

- [ ] **Step 5: Write the failing web test (load-more error resilience)**

Add to the space-activity page spec:

```ts
it('keeps the feed and the load-more button when loading more fails', async () => {
  vi.mocked(getSpaceActivities).mockRejectedValueOnce(new Error('network'));
  // ...render the page with an initial full page (hasMoreActivities: true), click "load more"...
  // The already-loaded activities are still rendered and the button remains for retry.
  expect(screen.getAllByTestId('activity-row').length).toBe(20);
  expect(screen.getByRole('button', { name: /load/i })).toBeInTheDocument();
});
```

Align testids/roles with what `space-activity-feed.svelte` actually renders (button at its line ~255).

- [ ] **Step 6: Run web test, verify RED**

Run: `cd web && pnpm test -- --run "src/routes/(user)/spaces/[spaceId]/activity/space-activity-page.spec.ts"`
Expected: FAIL (unhandled rejection surfaces / feed state assertion fails).

- [ ] **Step 7: Implement the web change**

`web/src/routes/(user)/spaces/[spaceId]/activity/+page.svelte` lines 16–21:

```ts
import { handleError } from '$lib/utils/handle-error';

async function loadMoreActivities() {
  try {
    const result = await getSpaceActivities({ id: space.id, limit: ACTIVITY_PAGE_SIZE, offset: activityOffset });
    activities = [...activities, ...result];
    activityOffset += result.length;
    hasMoreActivities = result.length === ACTIVITY_PAGE_SIZE;
  } catch (error) {
    handleError(error, $t('errors.error_loading_activities'));
  }
}
```

Add to the `errors` object in `i18n/en.json`:

```json
"error_loading_activities": "Could not load more activity",
```

- [ ] **Step 8: Run web test, verify GREEN**

Same command as Step 6. Expected: PASS.

- [ ] **Step 9: Commit**

```bash
git add server/src/repositories/shared-space.repository.ts server/src/queries/shared.space.repository.sql server/test/medium/specs/repositories/shared-space.repository.spec.ts "web/src/routes/(user)/spaces/[spaceId]/activity/+page.svelte" "web/src/routes/(user)/spaces/[spaceId]/activity/space-activity-page.spec.ts" i18n/en.json
git commit -m "fix(spaces): filter dead-album activity in SQL so feed pagination never dead-ends (#752)"
```

---

### Task 5: Face sweep covers contributed assets on unlink/departure/album-delete (server, MED)

**Finding:** `getAlbumAssetIdsWithoutOtherSpacePath` (`shared-space.repository.ts:2904`) enumerates sweep candidates from `album_asset` only. An asset whose ONLY remaining space path was an `album_space_asset` contribution into the severed album keeps its `shared_space_person_face` rows — phantom people in space People with thumbnails from an asset no member can see, with no nightly sweep to self-heal. The method is the enumerator for `unlinkAlbum`, `onAlbumDelete`, and `cleanupDepartingMemberFaces`. (The four NOT-EXISTS retention arms are already correct — including the contributed arm added by the B1 fix; only candidate enumeration is missing the contributed source.)

**Files:**

- Modify: `server/src/repositories/shared-space.repository.ts` (`getAlbumAssetIdsWithoutOtherSpacePath`, lines 2903–2974)
- Modify: `server/src/queries/shared.space.repository.sql` (hand-mirror; this becomes a multi-statement `@GenerateSql` method — both statements belong in the doc)
- Test: Modify `server/test/medium/specs/repositories/shared-space.repository.spec.ts` (the existing describe covering this helper) and `server/test/medium/specs/services/shared-space-album.service.spec.ts` (the unlink face-retention describe, ~line 199)

**Interfaces:**

- Consumes: tables `album_asset`, `album_space_asset(albumId, spaceId, assetId)`, `shared_space_asset`, `shared_space_album`, `shared_space_library`.
- Produces: same signature `getAlbumAssetIdsWithoutOtherSpacePath(spaceId, albumId): Promise<string[]>` — now returns orphans from BOTH membership arms of the severed album. Callers unchanged.

- [ ] **Step 1: Write the failing repo tests**

In the repository medium spec, inside the existing describe for `getAlbumAssetIdsWithoutOtherSpacePath`:

```ts
it('includes an asset whose only space path is a contribution into the severed album', async () => {
  // Given: linked album A in space S; asset X (owned by another member, NOT in the space pool,
  // no library path) contributed into A via album_space_asset(A, S, X). No album_asset row.
  const orphans = await sharedSpaceRepository.getAlbumAssetIdsWithoutOtherSpacePath(spaceId, albumAId);
  expect(orphans).toContain(assetXId);
});

it('retains an asset still contributed into ANOTHER linked album of the same space', async () => {
  // Given: X additionally has album_space_asset(B, S, X) where B is a second linked album.
  const orphans = await sharedSpaceRepository.getAlbumAssetIdsWithoutOtherSpacePath(spaceId, albumAId);
  expect(orphans).not.toContain(assetXId);
});

it('retains a contributed asset that is also directly in the space pool', async () => {
  // Given: X contributed into A AND shared_space_asset(S, X) exists.
  const orphans = await sharedSpaceRepository.getAlbumAssetIdsWithoutOtherSpacePath(spaceId, albumAId);
  expect(orphans).not.toContain(assetXId);
});
```

- [ ] **Step 2: Run tests, verify RED**

Run: `cd server && pnpm test:medium -- --run test/medium/specs/repositories/shared-space.repository.spec.ts`
Expected: the first new test FAILS (contributed-only asset absent from the result).

- [ ] **Step 3: Implement**

In `getAlbumAssetIdsWithoutOtherSpacePath`, keep the existing `album_asset` query untouched, add a sibling query for the contributed arm, and union the results. After the existing `const rows = await this.db...execute();` insert:

```ts
// #752 F1 (launch review): the severed album's CONTRIBUTED memberships (album_space_asset) are
// candidates too — an asset whose only space path was a contribution into this album must be
// swept, or its projected faces outlive the link. Same four anti-join retention arms as above.
// CRITICAL: the outer MUST be aliased `as cand` and every arm correlated on `cand.assetId` — the
// method's own header documents the self-correlation footgun (the album_asset outer is why the arms
// are hand-rolled), and here the third arm itself joins album_space_asset (as `otherContribution`),
// so an unaliased outer `album_space_asset.assetId` correlation is ambiguous / self-matches.
const contributedRows = await this.db
  .selectFrom('album_space_asset as cand')
  .select('cand.assetId')
  .where('cand.albumId', '=', albumId)
  .where('cand.spaceId', '=', spaceId)
  .where((eb) =>
    eb.not(
      eb.exists(
        eb
          .selectFrom('shared_space_asset')
          .whereRef('shared_space_asset.assetId', '=', 'cand.assetId')
          .where('shared_space_asset.spaceId', '=', spaceId),
      ),
    ),
  )
  .where((eb) =>
    eb.not(
      eb.exists(
        eb
          .selectFrom('shared_space_album')
          .innerJoin('album', (join) =>
            join.onRef('album.id', '=', 'shared_space_album.albumId').on('album.deletedAt', 'is', null),
          )
          .innerJoin('album_asset as other', 'other.albumId', 'shared_space_album.albumId')
          .whereRef('other.assetId', '=', 'cand.assetId')
          .where('shared_space_album.spaceId', '=', spaceId)
          .where('shared_space_album.albumId', '!=', albumId),
      ),
    ),
  )
  .where((eb) =>
    eb.not(
      eb.exists(
        eb
          .selectFrom('shared_space_album')
          .innerJoin('album', (join) =>
            join.onRef('album.id', '=', 'shared_space_album.albumId').on('album.deletedAt', 'is', null),
          )
          .innerJoin('album_space_asset as otherContribution', (join) =>
            join
              .onRef('otherContribution.albumId', '=', 'shared_space_album.albumId')
              .onRef('otherContribution.spaceId', '=', 'shared_space_album.spaceId'),
          )
          .whereRef('otherContribution.assetId', '=', 'cand.assetId')
          .where('shared_space_album.spaceId', '=', spaceId)
          .where('shared_space_album.albumId', '!=', albumId),
      ),
    ),
  )
  .where((eb) =>
    eb.not(
      eb.exists(
        eb
          .selectFrom('shared_space_library')
          .innerJoin('asset', 'asset.libraryId', 'shared_space_library.libraryId')
          .whereRef('asset.id', '=', 'cand.assetId')
          .where('shared_space_library.spaceId', '=', spaceId),
      ),
    ),
  )
  .execute();
return [...new Set([...rows, ...contributedRows].map((r) => r.assetId))];
```

(Replace the existing final `return rows.map((r) => r.assetId);` with the Set-union return.) Hand-mirror BOTH statements into `server/src/queries/shared.space.repository.sql` under this method's entry. The Step 1 retention tests (2nd and 3rd `it`s) are the guard against a self-correlation regression — if the outer alias is dropped they flip to failing (a self-match returns every candidate, so a still-reachable asset is wrongly reported orphaned).

- [ ] **Step 4: Run repo tests, verify GREEN**

Same command as Step 2. Expected: PASS, including the pre-existing tests for the album_asset arm.

- [ ] **Step 5: Write the failing service-level test (end-to-end sweep)**

In `server/test/medium/specs/services/shared-space-album.service.spec.ts`, in the unlink face-retention describe (~line 199), following its existing seeding pattern (face-recognition-enabled space, projected faces):

```ts
it('unlinking an album sweeps faces projected from contribution-only assets and deletes the orphaned person', async () => {
  // Given: face-rec-enabled space; asset X reaches the space ONLY as a contribution into linked
  // album A; X's face is projected onto space person P (P has no other faces).
  await sut.unlinkAlbum(auth, spaceId, albumAId);
  // Then: X's shared_space_person_face rows are gone and P was deleted as orphaned.
  const faces = await getSpacePersonFaces(spaceId, personPId);
  expect(faces).toHaveLength(0);
  const person = await getSpacePerson(spaceId, personPId);
  expect(person).toBeUndefined();
});
```

- [ ] **Step 6: Run service test, verify RED then GREEN**

Run: `cd server && pnpm test:medium -- --run test/medium/specs/services/shared-space-album.service.spec.ts`
The test should already pass GREEN if Step 3 is complete — to honor TDD, stash Step 3 (`git stash`) once, observe this test RED, then `git stash pop` and observe GREEN. If stashing is impractical, it is acceptable that Step 1's repo tests were the RED phase for this slice; still add this test and see it GREEN.

- [ ] **Step 7: Commit**

```bash
git add server/src/repositories/shared-space.repository.ts server/src/queries/shared.space.repository.sql server/test/medium/specs/repositories/shared-space.repository.spec.ts server/test/medium/specs/services/shared-space-album.service.spec.ts
git commit -m "fix(spaces): sweep faces of contribution-only assets on unlink/departure/album delete (#752)"
```

---

### Task 6: Member re-join refreshes surviving album grants (server migration, MED)

**Finding:** The member-join trigger `shared_space_member_after_insert_album` grants `shared_space_album_user` rows with `ON CONFLICT DO NOTHING`. A re-added member whose grant SURVIVED removal (they also reach the album via `album_user` or a second co-linking space) keeps the original `createId`; per-album backfill (`SharedSpaceAlbumToAssetsV1` / `AssetsV1` / `ExifV1`) is keyed on the grant's `createId` (`sync.repository.ts` `getCreatedAfter`), and contributions made during the absence were gated off by `contributionVisibleToMember` while the device's ack advanced past their `updateId` — so those edges are permanently undeliverable to mobile. Web is unaffected (live reads). Migration `1782100000000` fixed the identical bug on the RE-LINK trigger and deliberately deferred this one.

**Files:**

- Create: `server/src/schema/migrations-gallery/1783700000000-FixSharedSpaceMemberJoinGrantCreateId.ts`
- Test: Modify `server/test/medium/specs/sync/shared-space-album-create-triggers.spec.ts` (mirror its albums-9 re-link `createId`-refresh test) and `server/test/medium/specs/sync/shared-space-album-to-asset-sync.spec.ts` (end-to-end re-delivery)

**Interfaces:**

- Consumes: trigger function `shared_space_member_after_insert_album` as created by `1779100000000-AddSharedSpaceAlbumCreateSideTriggers.ts` (lines 86–112) and the `migration_overrides` row `function_shared_space_member_after_insert_album`.
- Produces: on member (re-)join, conflicting grant rows get `"createId" = immich_uuid_v7(), "createdAt" = now()` — re-triggering per-album backfill for that user. Side effect (accepted, same as the re-link fix): a grant that also serves another space/`album_user` path gets refreshed too — the resulting re-backfill is an idempotent re-upsert.

- [ ] **Step 1: Write the failing trigger-level test**

In `shared-space-album-create-triggers.spec.ts`, next to the albums-9 re-link test and following its factory pattern:

Mirror the albums-9 re-link test (`create-triggers.spec.ts:173-201`) but drive the **member** trigger, not the album-link trigger. Use the file's real `ctx.new*` factories and its raw `db` handle (there is no `getGrant`/`removeMemberRow` helper — read/mutate the tables directly, as the departure tests do):

```ts
it('re-adding a member refreshes a surviving grant createId so backfill re-fires', async () => {
  // Given: member M in space S; M is also an album_user Editor of album L, so removing M from S
  // leaves the shared_space_album_user(M, L) grant in place (user_has_album_path stays true).
  const { user: owner } = await ctx.newUser();
  const { user: member } = await ctx.newUser();
  const { space } = await ctx.newSharedSpace({ createdById: owner.id });
  await ctx.newSharedSpaceMember({ spaceId: space.id, userId: member.id, role: SharedSpaceRole.Editor });
  const { album } = await ctx.newAlbum({ ownerId: owner.id });
  await db
    .insertInto('album_user')
    .values({ albumId: album.id, userId: member.id, role: AlbumUserRole.Editor })
    .execute();
  await ctx.newSharedSpaceAlbum({ spaceId: space.id, albumId: album.id, addedById: owner.id }); // link → grant created

  const readGrant = () =>
    db
      .selectFrom('shared_space_album_user')
      .select('createId')
      .where('userId', '=', member.id)
      .where('albumId', '=', album.id)
      .executeTakeFirst();

  const before = await readGrant();
  // Remove M from S — the delete-audit trigger keeps the grant (survives via album_user).
  await db.deleteFrom('shared_space_member').where('spaceId', '=', space.id).where('userId', '=', member.id).execute();
  expect((await readGrant())?.createId).toBe(before?.createId); // precondition: grant survived, createId stale

  // When: M is re-added → the member-join trigger fires against the surviving grant.
  await ctx.newSharedSpaceMember({ spaceId: space.id, userId: member.id, role: SharedSpaceRole.Editor });

  // Then: the grant's createId was refreshed (and createdAt bumped) so backfill re-fires.
  expect((await readGrant())?.createId).not.toBe(before?.createId);
});
```

(Align `ctx.new*` signatures and the `db` handle name with what `create-triggers.spec.ts` actually binds — e.g. `newSharedSpaceAlbum`/`newSharedSpaceMember` at `medium.factory.ts:324,375`. The album-link trigger sets the initial `createId`; the member-join trigger is what this test exercises on re-add.)

- [ ] **Step 2: Run test, verify RED**

Run: `cd server && pnpm test:medium -- --run test/medium/specs/sync/shared-space-album-create-triggers.spec.ts`
Expected: FAIL — `after.createId` equals `before.createId` (DO NOTHING).

- [ ] **Step 3: Create the migration**

Create `server/src/schema/migrations-gallery/1783700000000-FixSharedSpaceMemberJoinGrantCreateId.ts`. It is the member-join sibling of `1782100000000-FixSharedSpaceAlbumGrantRelinkCreateId.ts` — copy that file's structure exactly, substituting the member-join function body (from `1779100000000`, lines 86–112):

```ts
import { Kysely, sql } from 'kysely';

// #752 launch review F-A: a re-added member whose shared_space_album_user grant SURVIVED removal
// (album_user access or a second co-linking space) kept the original createId, so the grant-keyed
// per-album backfill never re-fired and contributions made during the absence were permanently
// undeliverable to that member's devices. Mirror of 1782100000000 (which fixed the re-link
// trigger): refresh the createId on conflict. A refresh of a grant that also serves another
// space/album_user path only causes an idempotent re-backfill.

export async function up(db: Kysely<any>): Promise<void> {
  await sql`CREATE OR REPLACE FUNCTION shared_space_member_after_insert_album()
  RETURNS TRIGGER
  LANGUAGE PLPGSQL
  AS $$
    BEGIN
      INSERT INTO shared_space_album_user ("userId", "albumId")
      SELECT DISTINCT ir."userId", ssa."albumId"
      FROM inserted_rows ir
      INNER JOIN shared_space_album ssa ON ssa."spaceId" = ir."spaceId"
      ON CONFLICT ("userId", "albumId")
      DO UPDATE SET "createId" = immich_uuid_v7(), "createdAt" = now();

      UPDATE album
      SET "updatedAt" = clock_timestamp(), "updateId" = immich_uuid_v7(clock_timestamp())
      WHERE "id" IN (
        SELECT DISTINCT ssa."albumId"
        FROM inserted_rows ir
        INNER JOIN shared_space_album ssa ON ssa."spaceId" = ir."spaceId"
      );
      RETURN NULL;
    END
  $$;`.execute(db);

  await sql`UPDATE "migration_overrides"
  SET "value" = '{"type":"function","name":"shared_space_member_after_insert_album","sql":"CREATE OR REPLACE FUNCTION shared_space_member_after_insert_album()\\n  RETURNS TRIGGER\\n  LANGUAGE PLPGSQL\\n  AS $$\\n    BEGIN\\n      INSERT INTO shared_space_album_user (\\"userId\\", \\"albumId\\")\\n      SELECT DISTINCT ir.\\"userId\\", ssa.\\"albumId\\"\\n      FROM inserted_rows ir\\n      INNER JOIN shared_space_album ssa ON ssa.\\"spaceId\\" = ir.\\"spaceId\\"\\n      ON CONFLICT (\\"userId\\", \\"albumId\\")\\n      DO UPDATE SET \\"createId\\" = immich_uuid_v7(), \\"createdAt\\" = now();\\n\\n      UPDATE album\\n      SET \\"updatedAt\\" = clock_timestamp(), \\"updateId\\" = immich_uuid_v7(clock_timestamp())\\n      WHERE \\"id\\" IN (\\n        SELECT DISTINCT ssa.\\"albumId\\"\\n        FROM inserted_rows ir\\n        INNER JOIN shared_space_album ssa ON ssa.\\"spaceId\\" = ir.\\"spaceId\\"\\n      );\\n      RETURN NULL;\\n    END\\n  $$;"}'::jsonb
  WHERE "name" = 'function_shared_space_member_after_insert_album';`.execute(db);
}

export async function down(db: Kysely<any>): Promise<void> {
  await sql`CREATE OR REPLACE FUNCTION shared_space_member_after_insert_album()
  RETURNS TRIGGER
  LANGUAGE PLPGSQL
  AS $$
    BEGIN
      INSERT INTO shared_space_album_user ("userId", "albumId")
      SELECT DISTINCT ir."userId", ssa."albumId"
      FROM inserted_rows ir
      INNER JOIN shared_space_album ssa ON ssa."spaceId" = ir."spaceId"
      ON CONFLICT DO NOTHING;

      UPDATE album
      SET "updatedAt" = clock_timestamp(), "updateId" = immich_uuid_v7(clock_timestamp())
      WHERE "id" IN (
        SELECT DISTINCT ssa."albumId"
        FROM inserted_rows ir
        INNER JOIN shared_space_album ssa ON ssa."spaceId" = ir."spaceId"
      );
      RETURN NULL;
    END
  $$;`.execute(db);

  await sql`UPDATE "migration_overrides"
  SET "value" = '{"type":"function","name":"shared_space_member_after_insert_album","sql":"CREATE OR REPLACE FUNCTION shared_space_member_after_insert_album()\\n  RETURNS TRIGGER\\n  LANGUAGE PLPGSQL\\n  AS $$\\n    BEGIN\\n      INSERT INTO shared_space_album_user (\\"userId\\", \\"albumId\\")\\n      SELECT DISTINCT ir.\\"userId\\", ssa.\\"albumId\\"\\n      FROM inserted_rows ir\\n      INNER JOIN shared_space_album ssa ON ssa.\\"spaceId\\" = ir.\\"spaceId\\"\\n      ON CONFLICT DO NOTHING;\\n\\n      UPDATE album\\n      SET \\"updatedAt\\" = clock_timestamp(), \\"updateId\\" = immich_uuid_v7(clock_timestamp())\\n      WHERE \\"id\\" IN (\\n        SELECT DISTINCT ssa.\\"albumId\\"\\n        FROM inserted_rows ir\\n        INNER JOIN shared_space_album ssa ON ssa.\\"spaceId\\" = ir.\\"spaceId\\"\\n      );\\n      RETURN NULL;\\n    END\\n  $$;"}'::jsonb
  WHERE "name" = 'function_shared_space_member_after_insert_album';`.execute(db);
}
```

Also update the comment in `1782100000000-FixSharedSpaceAlbumGrantRelinkCreateId.ts` line 9 — it documents "member-join keeps DO NOTHING", which is no longer true; point it at this migration.

- [ ] **Step 4: Run trigger test, verify GREEN**

Same command as Step 2 (medium tests run the real migrator, so the new migration applies automatically). Expected: PASS, including all pre-existing trigger tests (first-join grants still work — the INSERT path is unchanged).

- [ ] **Step 5: Write the end-to-end re-delivery test, verify GREEN**

In `shared-space-album-to-asset-sync.spec.ts` (follow the harness of its "member-departure link cleanup" and re-link re-delivery tests). `deliveredEdges` below is illustrative — build the actual collection from that spec's existing "run the sync stream and gather `SharedSpaceAlbumToAssetsV1` upserts" pattern; there is no existing member-readd sync test, so this is new coverage assembled from those building blocks:

```ts
it('a re-added member receives contributions made during their absence when their grant survived via album_user', async () => {
  // Given: member M (also album_user on linked album L) synced and acked; M is removed;
  // another member contributes asset X into L; M's ack passes X's updateId via unrelated
  // same-type deliveries.
  // When: M is re-added and syncs from their old ack.
  // Then: the album-to-asset backfill re-fires (fresh grant createId) and delivers the
  // (L, X) edge — the absence-window contribution is NOT permanently lost.
  expect(deliveredEdges).toContainEqual(expect.objectContaining({ albumId: albumLId, assetId: assetXId }));
});
```

This test should be GREEN with the migration in place; temporarily reverting the migration file (Step 3) must turn it RED — verify once if cheap, otherwise rely on Step 2's RED as this slice's failing phase.

- [ ] **Step 6: Commit**

```bash
git add server/src/schema/migrations-gallery/1783700000000-FixSharedSpaceMemberJoinGrantCreateId.ts server/src/schema/migrations-gallery/1782100000000-FixSharedSpaceAlbumGrantRelinkCreateId.ts server/test/medium/specs/sync/shared-space-album-create-triggers.spec.ts server/test/medium/specs/sync/shared-space-album-to-asset-sync.spec.ts
git commit -m "fix(spaces): refresh surviving album grants on member re-join so absence-window contributions sync (#752)"
```

---

### Task 7: Final verification gate (run inline by the orchestrator, NOT a subagent)

Subagents report green while missing what the integrated gates catch — run the full verification yourself:

- [ ] `cd server && pnpm test` (full unit suite)
- [ ] `cd server && pnpm test:medium` (full medium suite, Docker running)
- [ ] `cd server && pnpm exec prettier --check src/repositories/shared-space.repository.ts src/schema/migrations-gallery/1783700000000-FixSharedSpaceMemberJoinGrantCreateId.ts src/schema/migrations-gallery/1782100000000-FixSharedSpaceAlbumGrantRelinkCreateId.ts` plus every touched test file
- [ ] `make lint-server && make check-server` (from repo root)
- [ ] `cd web && pnpm test` (full web unit suite)
- [ ] `cd web && pnpm check:typescript && pnpm lint` (`check:svelte` reports 0 files locally — CI Lint/Test Web is the real gate)
- [ ] `pnpm exec prettier --write specs/2026-07-19-space-albums-launch-fixes.md` (CI Docs Build is strict on `docs/**` markdown)
- [ ] Push to `space-albums-launch-fixes` (its own PR, base `space-albums-onto-main`; CI runs on push) and babysit: if **SQL Schema Checks** fails, download the job's `git diff` output and `git apply` it (strip leading timestamp prefixes) — never regenerate locally. Only `shared.space.repository.sql` changed (Tasks 4 & 5).

## Out of scope (deliberately)

Scoped to the six non-behavior-changing bug fixes for launch. Everything else from the 2026-07-19 review is deferred past launch as too risky / too large right now — do not let any slice grow into these:

- **S4 reroute** (a space-editor-only caller's own adds to a non-owned linked album → `album_space_asset` instead of a permanent `album_asset` row). Consciously deferred as too risky pre-launch — it changes an RBAC write path. Current behavior stands, so the Contributions section of `docs/docs/features/space-albums.md` slightly overstates what "withdrawn on unlink" covers for an editor's own adds; accept until S4 ships.
- **`cleanupDepartingMemberFaces` coverage test** (member-removal → faces) and the **contribution-in-album-detail e2e** — coverage gaps, not launch-blocking fixes.
- **Departure/retention + contribution-model docs** (ex-member content retention, another member's link surviving departure, creator-account-delete-destroys-space).
- Mobile sync-nudge trailing pass; activity-feed name freeze at unlink (the confirmed LOW — the unlink snapshot already exists in `data.albumName`, just stop the live-name overwrite for `AlbumUnlink`); `POST :id/assets/linked-albums` asset-id access check; coexistence-race `NOT EXISTS` guard + legacy pre-XOR backfill; set-cover-on-contribution UX; create-then-link orphan album; stale tab badge; param-swap page reuse; user-delete person recounts; space/user-delete syncStream convergence e2e; browser-driven (Playwright) album mutations; the deeper per-asset `no_permission`-on-add UX (Task 2 fixes the 5xx/network phantom-insert only — a partial per-asset denial that returns HTTP 200 still upserts, which needs `addAssetsToAlbums` to surface succeeded ids like Task 1's remove side).
