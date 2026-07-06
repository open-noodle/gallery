# Space Albums — Phase 1.5 (Immersive In-Space Albums) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give a shared space a real Albums area — a header button → a grid of linked albums → an in-space album view where members browse a linked album's photos and Editors/Owners collaborate (add/remove) — all within the space chrome.

**Architecture:** One small backend read-grant (`checkSpaceLinkedAlbumReadAccess` unioned into `AlbumRead`/`AlbumDownload`) so space members can open a linked album; three web surfaces mirroring the existing `/spaces/:id/people` sub-page + the global album page, reusing `UserPageLayout`, `Timeline` + `buildAlbumTimelineOptions`, `AssetSelectControlBar`, `RemoveFromAlbumAction`, `getAlbumAssetsActions`, and `@immich/ui`. The Phase-1 side-panel "Albums" tab is removed and its management consolidated onto the grid page.

**Tech Stack:** NestJS + Kysely (server), Zod/`checkAccess` (access), Vitest medium tests (testcontainers Postgres); SvelteKit + Svelte 5 runes (web), `@immich/sdk`, `@immich/ui`, Playwright/Vitest e2e.

**Spec:** `docs/superpowers/specs/2026-06-12-space-albums-phase-1.5-in-space-experience-design.md`. Builds directly on the merged Phase-1 work (`feat/space-albums`). **TDD mandatory** (RED → GREEN → REFACTOR); the access-control grant's matrix cells are written first.

**Branch:** `feat/space-albums` (continue here).

---

## File map

**Create:**

- `server/test/medium/specs/services/shared-space-album-permissions.service.spec.ts` — _extend_ (READ-album-entity grid)
- `web/src/lib/components/spaces/space-album-card.svelte` — in-space album card
- `web/src/lib/components/spaces/space-album-card.spec.ts` — card test
- `web/src/routes/(user)/spaces/[spaceId]/albums/+page.ts` — grid load
- `web/src/routes/(user)/spaces/[spaceId]/albums/+page.svelte` — grid page
- `web/src/routes/(user)/spaces/[spaceId]/albums/[albumId=id]/+page.ts` — album-view load (+ linkage check)
- `web/src/routes/(user)/spaces/[spaceId]/albums/[albumId=id]/+page.svelte` — in-space album view
- `web/src/routes/(user)/spaces/[spaceId]/albums/space-albums-page.spec.ts` (or co-located) — route component tests
- `e2e/src/specs/server/api/shared-space-album.e2e-spec.ts` — _extend_ (read-grant cases)

**Modify:**

- `server/src/repositories/access.repository.ts` — `checkSpaceLinkedAlbumReadAccess`
- `server/src/utils/access.ts` — union into `AlbumRead` + `AlbumDownload`
- `server/test/repositories/access.repository.mock.ts` — mock the new method
- `server/src/queries/access.repository.sql` — regenerated
- `i18n/en.json` — new keys
- `web/src/routes/(user)/spaces/[spaceId]/[[photos=photos]]/[[assetId=id]]/+page.svelte` — header "Albums" button
- `web/src/lib/components/spaces/space-panel.svelte` — remove the "Albums" tab
- `web/src/lib/components/spaces/space-panel.spec.ts` — drop the Albums-tab test
- (delete) `web/src/lib/components/spaces/space-linked-albums.svelte` + `.spec.ts` — logic relocated to the grid page

---

## Task 1: Backend — album-read grant for space members

**Files:**

- Test: `server/test/medium/specs/services/shared-space-album-permissions.service.spec.ts`
- Modify: `server/src/repositories/access.repository.ts`, `server/src/utils/access.ts`, `server/test/repositories/access.repository.mock.ts`

- [ ] **Step 1: Write the failing READ-album-entity matrix grid.** In `shared-space-album-permissions.service.spec.ts`, add a `describe('Grid R — READ the album ENTITY via space membership')` using the existing `world` fixture + `checkAccess`:

```ts
describe('Grid R — READ album entity (AlbumRead) via space membership', () => {
  it.each([
    ['spaceOwner', true],
    ['spaceEditor', true],
    ['spaceViewer', true], // any member can read the linked album entity
    ['nonMember', false],
    ['crossEditor', false], // member of S2; A is not linked to S2
  ] as const)('%s checkAccess(AlbumRead, A) → %s', async (actor, allowed) => {
    const result = await checkAccess(accessRepo, {
      auth: authOf(actor),
      permission: Permission.AlbumRead,
      ids: new Set([world.albumA]),
    });
    expect(result.has(world.albumA)).toBe(allowed);
  });

  it('unlinked album B is NOT readable via the space grant', async () => {
    const result = await checkAccess(accessRepo, {
      auth: authOf('spaceViewer'),
      permission: Permission.AlbumRead,
      ids: new Set([world.albumB]),
    });
    expect(result.has(world.albumB)).toBe(false);
  });

  it('the read grant does NOT widen write: spaceViewer still cannot AlbumAssetCreate on A', async () => {
    const result = await checkAccess(accessRepo, {
      auth: authOf('spaceViewer'),
      permission: Permission.AlbumAssetCreate,
      ids: new Set([world.albumA]),
    });
    expect(result.has(world.albumA)).toBe(false);
  });

  it('AlbumDownload is granted to a space viewer for a linked album', async () => {
    const result = await checkAccess(accessRepo, {
      auth: authOf('spaceViewer'),
      permission: Permission.AlbumDownload,
      ids: new Set([world.albumA]),
    });
    expect(result.has(world.albumA)).toBe(true);
  });
});
```

- [ ] **Step 2: Run → RED.** Run: `cd server && pnpm test:medium -- --run test/medium/specs/services/shared-space-album-permissions.service.spec.ts` → Expected: the spaceViewer/spaceEditor/spaceOwner `AlbumRead`/`AlbumDownload` cells FAIL (currently only owner/album_user are granted).

- [ ] **Step 3: Add `checkSpaceLinkedAlbumReadAccess`** to the `AlbumAccess` class in `access.repository.ts`, immediately after `checkSpaceLinkedAlbumAccess` (mirror it, but with NO role filter):

```ts
  @GenerateSql({ params: [DummyValue.UUID, DummyValue.UUID_SET] })
  @ChunkedSet({ paramIndex: 1 })
  async checkSpaceLinkedAlbumReadAccess(userId: string, albumIds: Set<string>) {
    if (albumIds.size === 0) {
      return new Set<string>();
    }

    return this.db
      .selectFrom('album')
      .select('album.id')
      .distinct()
      .innerJoin('shared_space_album', 'shared_space_album.albumId', 'album.id')
      .innerJoin('shared_space_member', 'shared_space_member.spaceId', 'shared_space_album.spaceId')
      .where('album.id', 'in', [...albumIds])
      .where('album.deletedAt', 'is', null)
      .where('shared_space_member.userId', '=', userId)
      .execute()
      .then((albums) => new Set(albums.map((album) => album.id)));
  }
```

- [ ] **Step 4: Wire into `access.ts`.** In the **auth** branch of `Permission.AlbumRead`, union the space-member grant for not-yet-granted ids:

```ts
    case Permission.AlbumRead: {
      const isOwner = await access.album.checkOwnerAccess(auth.user.id, ids);
      const isShared = await access.album.checkSharedAlbumAccess(
        auth.user.id,
        setDifference(ids, isOwner),
        AlbumUserRole.Viewer,
      );
      const granted = setUnion(isOwner, isShared);
      const isSpaceLinked = await access.album.checkSpaceLinkedAlbumReadAccess(
        auth.user.id,
        setDifference(ids, granted),
      );
      return setUnion(granted, isSpaceLinked);
    }
```

Apply the identical transformation to the **auth** branch of `Permission.AlbumDownload`. Leave the `sharedLink` branches, `AlbumAssetCreate`/`AlbumAssetDelete` (Phase-1 Editor grant), and `AlbumUpdate`/`AlbumDelete` unchanged.

- [ ] **Step 5: Add the mock.** In `server/test/repositories/access.repository.mock.ts`, add to the `album` group: `checkSpaceLinkedAlbumReadAccess: vitest.fn().mockResolvedValue(new Set()),`.

- [ ] **Step 6: Run → GREEN.** Run the matrix spec → all pass. `cd server && pnpm exec tsc --noEmit` → clean.

- [ ] **Step 7: Add a repo-level medium test** in `server/test/medium/specs/repositories/shared-space-album.repository.spec.ts` for `checkSpaceLinkedAlbumReadAccess` via the access repo: any member (incl. viewer) allowed; non-member denied; not-linked denied; **dual-path** (a user who is both a space member and an `album_user`) allowed with a single result entry. Run → GREEN.

- [ ] **Step 8: Lint + commit.** `npx eslint --fix` the 3 changed source/test files (exit 0). Commit `server/src/repositories/access.repository.ts server/src/utils/access.ts server/test/repositories/access.repository.mock.ts server/test/medium/specs/...` with message `feat(server): grant space members AlbumRead/AlbumDownload on linked albums`.

> SQL-doc regen for the new `@GenerateSql` method is done in Task 8 (against a complete DB), to keep all `.sql` regen in one verified pass.

---

## Task 2: i18n keys for the in-space albums UI

**Files:** Modify `i18n/en.json`

- [ ] **Step 1: Add keys** (alphabetical position; the `space_albums_*` Phase-1 keys exist — reuse them where possible). Add the new ones used by the grid page + album view + header:

```json
  "space_albums_page_title": "Albums",
  "space_albums_count": "{count, plural, one {# album} other {# albums}}",
  "space_albums_empty": "No albums linked yet",
  "space_albums_empty_editor_cta": "Link an album",
  "space_albums_hidden_from_timeline": "Hidden from timeline",
  "space_album_in_space": "in {space}",
  "space_album_not_linked": "That album isn’t part of this space.",
  "space_album_add_photos": "Add photos"
```

(Verify the exact existing Phase-1 keys with `grep -n "spaces_linked_albums" i18n/en.json` and reuse `spaces_linked_albums_link_album`, `_unlink`, `_unlink_confirmation`, `_show_in_timeline`, `_error_*`, `_pick_album`, `_no_albums` rather than duplicating.)

- [ ] **Step 2: Format + commit.** The i18n source lives at the **repo-root `i18n/` package** (NOT under `web/`). Run from repo root: `pnpm --filter immich-i18n format:fix` so `i18n/en.json` stays alphabetically sorted; confirm `git diff i18n/en.json` shows only the added keys. Commit `i18n/en.json` with message `i18n: keys for in-space albums experience`.

---

## Task 3: `space-album-card.svelte` (in-space album card)

**Files:**

- Create: `web/src/lib/components/spaces/space-album-card.svelte`
- Test: `web/src/lib/components/spaces/space-album-card.spec.ts`

- [ ] **Step 1: Write the failing component test.** Mirror `space-linked-albums.spec.ts`. Assert: renders the album name + count; the card is a link to `/spaces/:spaceId/albums/:albumId`; when `canManage` the ⋯ menu exposes "Show in timeline" + "Unlink" and fires `onToggleTimeline`/`onUnlink`; when `!canManage` no ⋯ menu; when `showInTimeline === false` the "hidden from timeline" sublabel renders.

```ts
import { render, screen } from '@testing-library/svelte';
import SpaceAlbumCard from './space-album-card.svelte';
const album = {
  albumId: 'a-1',
  albumName: 'Trip',
  assetCount: 12,
  albumThumbnailAssetId: null,
  showInTimeline: true,
  addedById: null,
  createdAt: '2026-01-01T00:00:00Z',
};

it('links to the in-space album route', () => {
  render(SpaceAlbumCard, { spaceId: 's-1', album, canManage: false });
  expect(screen.getByTestId('space-album-card-link')).toHaveAttribute('href', '/spaces/s-1/albums/a-1');
});
it('editor sees the manage menu; viewer does not', () => {
  const { rerender } = render(SpaceAlbumCard, {
    spaceId: 's-1',
    album,
    canManage: true,
    onUnlink: vi.fn(),
    onToggleTimeline: vi.fn(),
  });
  expect(screen.getByTestId('space-album-card-menu')).toBeInTheDocument();
});
it('shows hidden-from-timeline sublabel when showInTimeline is false', () => {
  render(SpaceAlbumCard, { spaceId: 's-1', album: { ...album, showInTimeline: false }, canManage: false });
  expect(screen.getByText(/hidden from timeline/i)).toBeInTheDocument();
});
```

- [ ] **Step 2: Run → RED.** Run: `cd web && pnpm test -- --run src/lib/components/spaces/space-album-card.spec.ts` → FAIL (component missing).

- [ ] **Step 3: Implement** `space-album-card.svelte`. Reuse `AlbumCover` for the thumbnail and AlbumCard's class vocabulary; props `{ spaceId, album: SharedSpaceLinkedAlbumDto, canManage, onUnlink?, onToggleTimeline? }`. The card is an `<a href={`/spaces/${spaceId}/albums/${album.albumId}`} data-testid="space-album-card-link">` wrapping `AlbumCover` + name (`text-lg font-semibold line-clamp-2`) + subtitle (`text-sm text-gray-500` = `space_albums`-style count); when `showInTimeline === false`, dim the cover (`opacity-60`) and add the `space_albums_hidden_from_timeline` sublabel. The ⋯ `ButtonContextMenu` (`mdiDotsVertical`, absolute `inset-e-? top-?`, on-hover) is rendered **only when `canManage`**, as a sibling of (not nested in) the `<a>`, with `MenuOption`s: "Show in timeline" (`onToggleTimeline(album)`) and "Unlink from space" (`onUnlink(album)`). Prefix any async handler appropriately; no nested interactive elements inside the `<a>`.

- [ ] **Step 4: Run → GREEN.** Run the card spec → PASS. `cd web && pnpm run check:typescript && pnpm run check:svelte` → clean.

- [ ] **Step 5: Lint + commit.** `npx eslint --fix` the two files (0 warnings), `npx prettier --write`. Commit with message `feat(web): space-album-card for the in-space albums grid`.

---

## Task 4: Albums grid page (`/spaces/:id/albums`)

**Files:**

- Create: `web/src/routes/(user)/spaces/[spaceId]/albums/+page.ts`, `…/albums/+page.svelte`
- Test: `web/src/routes/(user)/spaces/[spaceId]/albums/space-albums-page.spec.ts`

- [ ] **Step 1: Write `+page.ts`** mirroring the People page load:

```ts
import { getMembers, getSharedSpaceAlbums, getSpace } from '@immich/sdk';
import { authenticate } from '$lib/utils/auth';
import type { PageLoad } from './$types';

export const load = (async ({ url, params }) => {
  await authenticate(url);
  const [space, members, albums] = await Promise.all([
    getSpace({ id: params.spaceId }),
    getMembers({ id: params.spaceId }),
    getSharedSpaceAlbums({ id: params.spaceId }),
  ]);
  return { space, members, albums, meta: { title: `${space.name} - Albums` } };
}) satisfies PageLoad;
```

- [ ] **Step 2: Write the failing page test.** Render the page component with seeded `data` (space, members [viewer vs editor], albums). Assert: a `space-album-card-link` per album; Editor sees the "Link album" button + the empty-state CTA when no albums; Viewer sees neither; empty state text renders when `albums = []`.

- [ ] **Step 3: Run → RED.**

- [ ] **Step 4: Implement `+page.svelte`.** `UserPageLayout` shell mirroring the People page:
  - Compute `currentMember = members.find(m => m.userId === authManager.user.id)`, `isEditor = role ∈ {Owner, Editor}`.
  - `title = $t('space_albums_page_title')`, `description = $t('space_albums_count', { count })`.
  - `{#snippet leading()}` back `IconButton mdiArrowLeft` → `goto(`/spaces/${space.id}`)`.
  - `{#snippet buttons()}` — Editor only: a `Button` "Link album" (`leadingIcon mdiLinkVariantPlus`) → opens the link picker (relocate the picker logic from `space-linked-albums.svelte`: `getAllAlbums` filtered to owner/editor & not-yet-linked, `linkAlbum`, refresh via `invalidate`/reload).
  - Content: empty state (People-page inline pattern, `mdiImageMultipleOutline` 3.5em + `space_albums_empty`; Editor also gets the CTA button) OR the grid (`px-4 pt-4`, `grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 2xl:grid-cols-8`) of `SpaceAlbumCard` (passing `spaceId`, `album`, `canManage={isEditor}`, `onUnlink`→confirm+`unlinkAlbum`+refresh, `onToggleTimeline`→`updateSharedSpaceAlbum`+local update). Reuse the exact SDK handlers from the current `space-linked-albums.svelte` (handleLink/handleUnlink/handleToggleTimeline/openPicker) — move them here.

- [ ] **Step 5: Run → GREEN.** Page test passes; `pnpm run check:typescript && pnpm run check:svelte` clean.

- [ ] **Step 6: Lint + commit.** eslint --fix (0 warnings) + prettier. Commit the route files + test with message `feat(web): in-space Albums grid page with management`.

---

## Task 5: Header "Albums" button + remove the panel "Albums" tab

**Files:** Modify `web/src/routes/(user)/spaces/[spaceId]/[[photos=photos]]/[[assetId=id]]/+page.svelte`, `web/src/lib/components/spaces/space-panel.svelte`, `web/src/lib/components/spaces/space-panel.spec.ts`; delete `web/src/lib/components/spaces/space-linked-albums.svelte` + `.spec.ts`.

- [ ] **Step 1: Add the header button.** In the main space view header `buttons` row (the ghost/round IconButton group with Map/Members), add, visible to all members, before the Members button:

```svelte
<IconButton
  icon={mdiImageMultipleOutline}
  aria-label={$t('space_albums_page_title')}
  variant="ghost"
  shape="round"
  color="secondary"
  onclick={() => goto(`/spaces/${space.id}/albums`)}
  data-testid="space-albums-button"
/>
```

Add `mdiImageMultipleOutline` to the `@mdi/js` imports. Confirm `goto` is imported.

- [ ] **Step 2: Remove the panel "Albums" tab.** In `space-panel.svelte`: drop the `'albums'` member from the `activeTab` union type, the albums `<button data-testid="tab-albums">`, the `{:else if activeTab === 'albums'} <SpaceLinkedAlbums .../>` content block, and the `SpaceLinkedAlbums` import (and the now-unused `isEditor` prop **only if** nothing else uses it — verify; the People/main views still pass it elsewhere, but the panel may no longer need it).

- [ ] **Step 3: Update `space-panel.spec.ts`.** Remove the Albums-tab test + revert the tab-count assertion to Activity + Members (2 tabs). Remove the now-unneeded `getSharedSpaceAlbums` mock if it was only for that tab.

- [ ] **Step 4: Delete the now-unused component.** `git rm web/src/lib/components/spaces/space-linked-albums.svelte web/src/lib/components/spaces/space-linked-albums.spec.ts`. Confirm `grep -rn "space-linked-albums\|SpaceLinkedAlbums" web/src` returns nothing (its logic now lives in the grid page).

- [ ] **Step 5: Verify + commit.** `cd web && pnpm test -- --run src/lib/components/spaces/space-panel.spec.ts` → green; `pnpm run check:svelte` clean; eslint --fix the changed files (0 warnings). Commit with message `feat(web): space header Albums button; remove panel Albums tab`.

---

## Task 6: In-space album view route + browse (`/spaces/:id/albums/:albumId`)

**Files:**

- Create: `…/albums/[albumId=id]/+page.ts`, `…/albums/[albumId=id]/+page.svelte`
- Test: co-located `*.spec.ts`

- [ ] **Step 1: Write `+page.ts` with the linkage check** (do NOT rely on `getAlbumInfo` 4xx alone):

```ts
import { getAlbumInfo, getMembers, getSharedSpaceAlbums, getSpace } from '@immich/sdk';
import { authenticate } from '$lib/utils/auth';
import { redirect } from '@sveltejs/kit';
import type { PageLoad } from './$types';

export const load = (async ({ url, params }) => {
  await authenticate(url);
  const [space, members, albums] = await Promise.all([
    getSpace({ id: params.spaceId }),
    getMembers({ id: params.spaceId }),
    getSharedSpaceAlbums({ id: params.spaceId }),
  ]);
  const linked = albums.find((a) => a.albumId === params.albumId);
  if (!linked) {
    redirect(302, `/spaces/${params.spaceId}/albums`); // not linked to THIS space
  }
  const album = await getAlbumInfo({ id: params.albumId }); // permitted via the Task-1 read grant
  return { space, members, album, meta: { title: album.albumName } };
}) satisfies PageLoad;
```

- [ ] **Step 2: Write the failing tests.** Component test: the view renders the album's `Timeline`; header shows the album name + the "in {space}" context; `canManage` (space-Editor) shows the Add-photos affordance, Viewer does not; a `showInTimeline = false` album **still renders fully** (the toggle gates only the aggregate space surfaces, never this view). `+page.ts` **linkage tests** (unit-test the `load` with mocked SDK): (a) an album present in `getSharedSpaceAlbums(:id)` → loads `getAlbumInfo` and returns it; (b) an album **NOT** in `getSharedSpaceAlbums(:id)` — **even when `getAlbumInfo` would succeed** (a user who independently owns it) — throws the `redirect(302, /spaces/:id/albums)` (assert via the thrown redirect); (c) a `getSpace` rejection (non-member) propagates (no album data). Mock `@immich/sdk` so `getAlbumInfo` is NOT called when the album isn't linked.

- [ ] **Step 3: Run → RED.**

- [ ] **Step 4: Implement `+page.svelte` (browse).** `UserPageLayout`:
  - `currentMember`/`isEditor` from members; `canManage = isEditor || album.albumUsers.some(au => au.user.id === authManager.user.id && (au.role === AlbumUserRole.Owner || au.role === AlbumUserRole.Editor))`.
  - `leading()` = back `IconButton mdiArrowLeft` → `goto(`/spaces/${space.id}/albums`)`. `title = album.albumName`; `description = `${$t('items_count', { values: { count: album.assetCount } })} · ${$t('space_album_in_space', { values: { space: space.name } })}``.
  - Content: `Timeline` with the album options built exactly as the global album page does (reuse `buildAlbumTimelineOptions` from `web/src/lib/utils/album-filter-options.ts`):
    ```ts
    const albumOptions = buildAlbumTimelineOptions(
      album.id,
      album.order ?? authManager.preferences.albums.defaultAssetOrder,
      clearFilters(/* empty FilterState */),
    );
    const options = { ...albumOptions, grouping: 'month' };
    ```
    `enableRouting={false}` (the asset viewer opens as an overlay on click; the route deliberately omits the `[[photos=photos]]/[[assetId=id]]` deep-link segments to stay focused — deep-linkable album photos are a future nicety, not Phase 1.5), an `AssetMultiSelectManager`; `empty` snippet → centered icon + "No photos yet" (Editor also "Add photos"). (`clearFilters`/`FilterState` are the album page's filter utilities; verify the exact empty-state constructor it uses and mirror it.)
  - (Collaboration affordances are wired in Task 7 — this task delivers browse + the `canManage` flag + the Add button gated on `canManage`.)

- [ ] **Step 5: Run → GREEN.** Tests pass; `pnpm run check:typescript && pnpm run check:svelte` clean.

- [ ] **Step 6: Lint + commit.** eslint --fix (0 warnings) + prettier. Commit with message `feat(web): in-space album view (browse) with linkage check`.

---

## Task 7: In-space album collaboration (add / remove, `canManage`-gated)

**Files:** Modify `…/albums/[albumId=id]/+page.svelte`; extend its `*.spec.ts`.

- [ ] **Step 1: Write the failing test.** With `canManage = true`: selecting assets renders `AssetSelectControlBar` including the Remove-from-album action; the "Add photos" control is present. With `canManage = false` (Viewer): no Add, no Remove (selection still allows download). Mock `@immich/sdk`/the album service.

- [ ] **Step 2: Run → RED.**

- [ ] **Step 3: Implement collaboration**, reusing the global album page's two-mode mechanism but gated on `canManage`. Add a local `let mode = $state<'browse' | 'add'>('browse')` and a second `AssetMultiSelectManager` for the picker (mirror the album page's `assetMultiSelectManager` vs `timelineMultiSelectManager` split):
  - **Browse mode** (default): `options = { ...buildAlbumTimelineOptions(album.id, order, emptyFilters), grouping: 'month' }` (from Task 6); selecting album photos shows `AssetSelectControlBar` containing `RemoveFromAlbumAction` (`bind:album`, `onRemove` → reload/invalidate) — rendered **only when `canManage`** — plus the album-page default multiselect actions (download, favorite).
  - **Add mode** (`canManage` only; entered via the header "Add photos" `IconButton mdiImagePlusOutline`): swap `options = buildAlbumAssetPickerOptions(album.id, emptyFilters)` and render the picker `Timeline` + an `AssetSelectControlBar` whose action is `getAlbumAssetsActions($t, album, pickerMultiSelectManager.assets).AddAssets` (and `Upload`). On add success, return to browse mode and reload. Use `enableRouting={false}` in both modes (consistent with the browse route omitting deep-link segments); mirror the album page's `isSelectionMode`/`singleSelect` wiring. Keep it focused — no album title-edit / sharing / settings / map.
  - The server already authorizes add/remove for space Editors (Phase-1 write predicate) and for album owners/editors — so `canManage` purely controls affordance visibility; the server is the actual gate.

- [ ] **Step 4: Run → GREEN.** Test passes; `pnpm run check:typescript && pnpm run check:svelte` clean; `cd web && pnpm build` succeeds.

- [ ] **Step 5: Lint + commit.** eslint --fix (0 warnings) + prettier. Commit with message `feat(web): in-space album collaboration (add/remove) gated on space role`.

---

## Task 8: e2e + SQL regen + final gates

**Files:** Modify `e2e/src/specs/server/api/shared-space-album.e2e-spec.ts`; regenerate `server/src/queries/access.repository.sql`.

- [ ] **Step 1: Extend the e2e** (mirror the Phase-1 e2e harness): a space **Viewer** can `GET /albums/:id` (album info) AND fetch the album-filtered timeline (`getTimeBuckets`/`getTimeBucket` with `albumId`) for a **linked** album (proves the read grant); a **non-member** is denied both; an album **not linked** to the space → `GET /albums/:id` denied for a non-album-member; a space **Editor** can `PUT`/`DELETE /albums/:id/assets` (re-assert Phase-1 write in the album-view context). Run: `cd e2e && pnpm test -- --run src/specs/server/api/shared-space-album.e2e-spec.ts` → green (if the e2e stack can't start locally, note it for CI — it ran green in Phase 1).

- [ ] **Step 2: Regenerate SQL docs** for the new `@GenerateSql` method against a COMPLETE DB (per the Phase-1 lesson — verify a scoped diff, no unrelated deletions). Start the dev Postgres (`docker start immich_postgres`, ensure gallery migrations applied), `pnpm -C server build`, then `cd server && DB_HOSTNAME=localhost DB_PORT=5432 DB_USERNAME=postgres DB_PASSWORD=postgres DB_DATABASE_NAME=immich node dist/bin/sync-sql.js`. Confirm `git diff server/src/queries/access.repository.sql` is ONLY the new `checkSpaceLinkedAlbumReadAccess` block (no unrelated churn — if hundreds of lines drop, the DB is incomplete; fix and re-run). Stop the container (no `-v`). Commit `server/src/queries/access.repository.sql`.

- [ ] **Step 3: Full local gates.** Run:
  - `cd server && pnpm exec tsc --noEmit && pnpm lint` → clean.
  - `cd server && pnpm test:medium -- --run test/medium/specs/services/shared-space-album-permissions.service.spec.ts test/medium/specs/repositories/shared-space-album.repository.spec.ts` → green.
  - `cd web && pnpm build && pnpm check && pnpm lint` → clean (0 warnings on new files); `pnpm test -- --run src/lib/components/spaces/space-album-card.spec.ts src/routes/\(user\)/spaces/\[spaceId\]/albums` → green.

- [ ] **Step 4: Commit any regen + manual smoke note.** Commit. Manual web smoke (on a `make dev` stack from this branch): space header → Albums → grid → open an album → browse; as Editor add+remove a photo; as Viewer confirm browse-only and the album still isn't in personal `/albums`; toggle show-in-timeline from the grid card.

---

## Self-review checklist (run before handoff)

- **Spec coverage:** backend read grant (T1) → `AlbumRead`/`AlbumDownload`; header button (T5); grid page + management consolidation + panel-tab removal (T4, T5); in-space album view browse (T6) + collaborate (T7); SQL regen (T8); permissions table rows all covered. Edge cases each have an explicit test — `showInTimeline=false` **still browsable in-space** (T6 component test) and excluded from aggregate surfaces (Phase-1); **own-but-not-linked redirect** (T6 `+page.ts` unit test asserting `getAlbumInfo` is NOT consulted for the decision); unlinked → redirect (T6); soft-deleted (subsumed: absent from `getSharedSpaceAlbums` → not in grid + T6 redirect); non-member route denied (T6 load + T8 e2e); dual-path (T1 repo test); read-grant-does-not-widen-write (T1). ✅
- **TDD:** every task RED→GREEN→commit; the access grant's matrix + the `+page.ts` linkage logic are written test-first. (T2 i18n and the T5 header button are mechanical; T5's panel-tab removal is guarded by the updated `space-panel.spec.ts`.) ✅
- **Type/name consistency:** `checkSpaceLinkedAlbumReadAccess` (repo+mock+access.ts+tests); `SpaceAlbumCard` props `{ spaceId, album, canManage, onUnlink, onToggleTimeline }`; routes `/spaces/:id/albums` + `/spaces/:id/albums/[albumId=id]`; `canManage = spaceEditor || albumOwnerEditor`; reuse `buildAlbumTimelineOptions(albumId, order, filters)` / `buildAlbumAssetPickerOptions(albumId, filters)` / `getAlbumAssetsActions($t, album, assets)` / `AssetSelectControlBar` / `RemoveFromAlbumAction`. ✅
- **Verified anchors (corrected during review):** i18n source is repo-root `i18n/en.json` (NOT `web/i18n/`); count key is `items_count`; `buildAlbumTimelineOptions` is a 3-arg `(albumId, order, filters)` call + `{ ...opts, grouping }`; the `id` route-param matcher exists (`web/src/params/id.ts`); `enableRouting={false}` so the route needs no `[[photos]]/[[assetId]]` deep-link segments. ✅
- **No placeholders:** backend code is exact; web tasks give concrete skeletons + the exact reuse utilities + test code (Svelte UI assembled from verified components, matching how Phase-1 Task 14 was specified). The add-photos select mode is now spelled out as a two-mode (`'browse' | 'add'`) options-swap reusing `buildAlbumAssetPickerOptions` + `getAlbumAssetsActions`.
