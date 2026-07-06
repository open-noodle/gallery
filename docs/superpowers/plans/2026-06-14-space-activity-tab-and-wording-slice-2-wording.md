# Space Activity Wording — Slice 2 — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development. Steps use checkbox (`- [ ]`).

**Goal:** Eliminate the generic `"{name} performed an action"` for real actions: **log** album link/unlink and person-merge (with denormalized names), add `personName` to person-update, and give album/person activities proper descriptions in the feed.

**Architecture:** Backend adds two `SharedSpaceActivityType` values + `logActivity` calls (album link/unlink, person merge) and a `personName` field on person-update; frontend adds `getDescription` cases. **No migration** (`shared_space_activity.data` is free-form JSON) and **no SDK/OpenAPI regen** (the activity DTO types `type` as `z.string()`; `logActivity` takes `type: string`). Spec: `docs/superpowers/specs/2026-06-14-space-activity-tab-and-wording-design.md` §5.

**Tech Stack:** NestJS + Kysely (server unit tests, Vitest), SvelteKit (web component test). Run server from `server/`, web from `web/`.

## Conventions

- TDD per behavior (RED → GREEN). Prettier-format + lint every touched file before committing (server `pnpm check` = tsc; web lint = `eslint .`, only errors block). No `@GenerateSql` method added → no `mise sql`. No DTO change → no SDK regen (sanity: `pnpm --filter immich … ` not needed).
- Wording is **hardcoded English**, matching the existing `getDescription()` (all current cases are hardcoded).

## File structure

- **Modify** `server/src/enum.ts` — add `AlbumLink`, `AlbumUnlink` to `SharedSpaceActivityType`.
- **Modify** `server/src/services/shared-space.service.ts` — log in `linkAlbum`, `unlinkAlbum`, `mergeSpacePeople`; add `personName` to `updateSpacePerson`'s `PersonUpdate` log.
- **Test** `server/src/services/shared-space.service.spec.ts` — logging unit tests.
- **Modify** `web/src/lib/components/spaces/space-activity-feed.svelte` — 5 new `getDescription` cases.
- **Test** `web/src/lib/components/spaces/space-activity-feed.spec.ts` — description tests (create if absent).

---

## Task 1: Backend — enum + activity logging

**Files:** Modify `server/src/enum.ts`, `server/src/services/shared-space.service.ts`; Test `server/src/services/shared-space.service.spec.ts`.

- [ ] **Step 1: Write the failing unit tests** in `shared-space.service.spec.ts`. Read the file first for its setup (`newTestService(SharedSpaceService)` → `{sut, mocks}`, `factory.auth()`, how `requireRole`/`requireAccess` are satisfied, and how existing `linkAlbum`/`updateSpacePerson`/`mergeSpacePeople` tests stub mocks). Add a `describe('activity logging', …)` covering:

```ts
// linkAlbum logs AlbumLink (new link only), with album name
it('linkAlbum logs an album_link activity for a new link', async () => {
  const auth = factory.auth();
  const spaceId = newUuid();
  const albumId = newUuid();
  // satisfy requireRole(Editor) + requireAccess(AlbumUpdate) the same way existing linkAlbum tests do
  mocks.sharedSpace.addAlbum.mockResolvedValue({ spaceId, albumId, addedById: auth.user.id } as any); // truthy = new link
  mocks.sharedSpace.getById.mockResolvedValue(factory.sharedSpace({ id: spaceId, faceRecognitionEnabled: false }));
  mocks.album.getById.mockResolvedValue({ albumName: 'Trip' } as any);
  mocks.sharedSpace.logActivity.mockResolvedValue();

  await sut.linkAlbum(auth, spaceId, albumId);

  expect(mocks.sharedSpace.logActivity).toHaveBeenCalledWith({
    spaceId,
    userId: auth.user.id,
    type: SharedSpaceActivityType.AlbumLink,
    data: { albumId, albumName: 'Trip' },
  });
});

it('linkAlbum does not log album_link on an idempotent re-link', async () => {
  const auth = factory.auth();
  mocks.sharedSpace.addAlbum.mockResolvedValue(undefined as any); // falsy = already linked
  await sut.linkAlbum(auth, newUuid(), newUuid());
  expect(mocks.sharedSpace.logActivity).not.toHaveBeenCalledWith(
    expect.objectContaining({ type: SharedSpaceActivityType.AlbumLink }),
  );
});

it('unlinkAlbum logs an album_unlink activity with the album name', async () => {
  const auth = factory.auth();
  const spaceId = newUuid();
  const albumId = newUuid();
  mocks.album.getById.mockResolvedValue({ albumName: 'Trip' } as any);
  mocks.sharedSpace.getAlbumAssetIdsWithoutOtherSpacePath.mockResolvedValue([]);
  mocks.sharedSpace.removeAlbum.mockResolvedValue();
  mocks.sharedSpace.logActivity.mockResolvedValue();

  await sut.unlinkAlbum(auth, spaceId, albumId);

  expect(mocks.sharedSpace.logActivity).toHaveBeenCalledWith({
    spaceId,
    userId: auth.user.id,
    type: SharedSpaceActivityType.AlbumUnlink,
    data: { albumId, albumName: 'Trip' },
  });
});

it('updateSpacePerson logs person_update with the person name', async () => {
  // mirror the existing updateSpacePerson test setup; stub getPersonById to return the updated person
  // ... assert logActivity called with type PersonUpdate and data.personName set (e.g. 'Alice')
});

it('mergeSpacePeople logs person_merge with the target name and count', async () => {
  // mirror the existing mergeSpacePeople happy-path test (target + sources via getPersonById,
  // identityMergePropagationService.mergeSpacePeople stubbed)
  // assert logActivity called with type PersonMerge, data { personName: <target.name>, count: dto.ids.length }
});

it('mergeSpacePeople does NOT log on a validation error (e.g. empty ids / self-merge / type mismatch)', async () => {
  // trigger a BadRequestException path; assert logActivity not called with PersonMerge
});
```

(Fill the person tests' arrange by copying the existing `updateSpacePerson` / `mergeSpacePeople` tests in the file and adding the `logActivity` assertion. `SharedSpaceActivityType` is imported from `src/enum`; `newUuid` from `test/small.factory`.)

- [ ] **Step 2: Run RED** — `cd server && pnpm test -- --run -t "activity logging"` → FAIL (no AlbumLink enum / no logs).

- [ ] **Step 3: Implement** —
  1. `src/enum.ts`, in `SharedSpaceActivityType`, after `SpaceColorChange` (or anywhere in the enum):
     ```ts
       AlbumLink = 'album_link',
       AlbumUnlink = 'album_unlink',
     ```
  2. `shared-space.service.ts` `linkAlbum` — inside the existing `if (result) { … }` block, AFTER the face-sync queue block, add:
     ```ts
     const album = await this.albumRepository.getById(albumId, { withAssets: false });
     await this.sharedSpaceRepository.logActivity({
       spaceId,
       userId: auth.user.id,
       type: SharedSpaceActivityType.AlbumLink,
       data: { albumId, albumName: album?.albumName ?? '' },
     });
     ```
  3. `unlinkAlbum` — fetch the album name before removal, log after `removeAlbum`:
     ```ts
     const album = await this.albumRepository.getById(albumId, { withAssets: false });
     const orphanedAssetIds = await this.sharedSpaceRepository.getAlbumAssetIdsWithoutOtherSpacePath(spaceId, albumId);
     await this.sharedSpaceRepository.removeAlbum(spaceId, albumId);
     await this.sharedSpaceRepository.logActivity({
       spaceId,
       userId: auth.user.id,
       type: SharedSpaceActivityType.AlbumUnlink,
       data: { albumId, albumName: album?.albumName ?? '' },
     });
     if (orphanedAssetIds.length > 0) {
       // …existing cleanup…
     }
     ```
  4. `updateSpacePerson` — move the `PersonUpdate` `logActivity` to AFTER `const enriched = await …getPersonById(personId)` + the `if (!enriched) throw` guard, and include the resulting name:
     ```ts
     const enriched = await this.sharedSpaceRepository.getPersonById(personId);
     if (!enriched) {
       throw new BadRequestException('Person not found');
     }
     await this.sharedSpaceRepository.logActivity({
       spaceId,
       userId: auth.user.id,
       type: SharedSpaceActivityType.PersonUpdate,
       data: { personId, personName: enriched.name ?? '' },
     });
     return this.mapSpacePerson(enriched, alias?.alias ?? null);
     ```
     (Remove the original `PersonUpdate` log that used `data: { personId }`.)
  5. `mergeSpacePeople` — after `await this.identityMergePropagationService.mergeSpacePeople(auth, spaceId, targetPersonId, dto.ids);`, add:
     ```ts
     await this.sharedSpaceRepository.logActivity({
       spaceId,
       userId: auth.user.id,
       type: SharedSpaceActivityType.PersonMerge,
       data: { personName: target.name ?? '', count: dto.ids.length },
     });
     ```

- [ ] **Step 4: Run GREEN** — `pnpm test -- --run -t "activity logging"` → PASS. Then the whole files: `pnpm test -- --run -t "linkAlbum" -t "unlinkAlbum" -t "updateSpacePerson" -t "mergeSpacePeople"` and `make check-server`/`pnpm check` clean.

- [ ] **Step 5: Commit**

```bash
git add server/src/enum.ts server/src/services/shared-space.service.ts server/src/services/shared-space.service.spec.ts
git commit -m "feat(spaces): log album link/unlink + person merge activities; name on person update (slice 2)"
```

---

## Task 2: Frontend — activity descriptions

**Files:** Modify `web/src/lib/components/spaces/space-activity-feed.svelte`; Test `web/src/lib/components/spaces/space-activity-feed.spec.ts` (create if absent).

- [ ] **Step 1: Write the failing component test** — render `SpaceActivityFeed` with one activity of each new type and assert the row text. If no spec exists, create one (use `@testing-library/svelte` + `TestWrapper`, mirror `space-tabs.spec.ts`/`space-album-detail-page.spec.ts` for i18n init + render). `userName` drives `${name}`; `data` carries the fields.

```ts
const cases = [
  { type: 'album_link', data: { albumName: 'Trip' }, text: 'linked album "Trip"' },
  { type: 'album_unlink', data: { albumName: 'Trip' }, text: 'unlinked album "Trip"' },
  { type: 'person_update', data: { personName: 'Alice' }, text: 'updated person "Alice"' },
  { type: 'person_delete', data: { personName: 'Alice' }, text: 'deleted person "Alice"' },
  { type: 'person_merge', data: { personName: 'Alice', count: 2 }, text: 'merged 2 people into "Alice"' },
];
// for each: render feed with [{ id, type, data, userName: 'Bob', createdAt }], assert the row shows `Bob ${text}`
// plus: an unknown type still renders 'performed an action'
// plus: a new-type activity missing its name field renders with empty quotes (no crash)
```

- [ ] **Step 2: Run RED** — `cd web && pnpm vitest run src/lib/components/spaces/space-activity-feed.spec.ts` → the new-type rows FAIL (fall through to `performed an action`).

- [ ] **Step 3: Implement** — in `space-activity-feed.svelte` `getDescription()`, add these cases immediately before the `default:` case (match the existing `case 'x': { return …; }` block style):

```ts
      case 'album_link': {
        return `${name} linked album "${data.albumName ?? ''}"`;
      }
      case 'album_unlink': {
        return `${name} unlinked album "${data.albumName ?? ''}"`;
      }
      case 'person_update': {
        return `${name} updated person "${data.personName ?? ''}"`;
      }
      case 'person_delete': {
        return `${name} deleted person "${data.personName ?? ''}"`;
      }
      case 'person_merge': {
        return `${name} merged ${data.count ?? 0} people into "${data.personName ?? ''}"`;
      }
```

- [ ] **Step 4: Run GREEN** — `pnpm vitest run src/lib/components/spaces/space-activity-feed.spec.ts` → PASS. `pnpm run check:svelte` clean.

- [ ] **Step 5: Commit**

```bash
git add web/src/lib/components/spaces/space-activity-feed.svelte web/src/lib/components/spaces/space-activity-feed.spec.ts
git commit -m "feat(web): activity descriptions for album link/unlink + person update/delete/merge (slice 2)"
```

---

## Slice 2 completion gate

- [ ] `cd server && pnpm test -- --run -t "activity logging"` + the touched method tests → PASS; `pnpm check` clean.
- [ ] `cd web && pnpm vitest run src/lib/components/spaces/space-activity-feed.spec.ts` → PASS; `pnpm run check:svelte` clean.
- [ ] eslint + prettier clean on every touched file.
- [ ] No `mise sql` diff (no `@GenerateSql` added) and no SDK regen needed (sanity check `git status` shows only the intended files).
- [ ] Push (no merge).

## Edge-case coverage map (spec §5.4 → test)

| Spec edge                                                                       | Covered by                                                 |
| ------------------------------------------------------------------------------- | ---------------------------------------------------------- |
| 1. New link only logs AlbumLink; re-link logs nothing                           | Task 1 tests #1, #2 (addAlbum truthy/falsy)                |
| 2. Album name missing → `linked album ""`                                       | Task 1 (album?.albumName ?? '') + Task 2 missing-name test |
| 3. Unlink logs AlbumUnlink with name                                            | Task 1 unlink test                                         |
| 4. PersonUpdate name set; empty → `""`                                          | Task 1 update test + Task 2 missing-name test              |
| 5. PersonMerge only on success; count = #sources; not on validation errors      | Task 1 merge happy-path + validation-error tests           |
| 6. Backward-compat: old rows missing fields render with empty quotes (no crash) | Task 2 missing-name test (`?? ''`)                         |
| 7. Album/person activities are low-impact rows                                  | unchanged tiers (no code change)                           |
| 8. Unknown/future type → generic fallback                                       | Task 2 unknown-type test                                   |
