# Slice 2 — Album-read visibility gate: remaining surfaces (TDD plan)

> Line-exact TDD plan for Slice 2 of `docs/superpowers/specs/2026-07-08-space-albums-review-remediation-design.md`.
> Closes **security-2, C1, security-8, rbac-7, rbac-8**. Slice 1 (security-1/security-3 HIGH leaks) is
> already merged on this branch and is treated as baseline. Independent of Slice 1 (different files) but
> shares the e2e harness (`e2e/src/specs/server/api/shared-space-visibility-negatives.e2e-spec.ts`).

## Goal

Apply the album-read visibility gate to the five lower-severity sibling surfaces the HIGH slice did not
reach, using the **same flat `spaceVisibilityGate`** pattern (no owner exception, consistent with the album
grid `withDefaultVisibility`) for the content-read surfaces, and an **access-layer** determination for the
two non-SQL leaks (album-level activity + participant PII):

- **security-2** — `getAlbumMapMarkers` returns lat/lon + city/state/country of Hidden/Locked album assets to everyone → add a flat gate.
- **C1** — `GET /activities?albumId=<space-linked>` leaks the whole album comment thread + commenter identities + like list to non-participant space members → deny album-level activity to space-only readers at the service.
- **security-8** — `GET /albums/:id` returns other participants' id/name/role/profileImage to space-only members → strip `albumUsers` to the owner.
- **rbac-7** — `PersonRead` shared-space arm uses `visibility = Timeline` equality (stricter than the grid) → **widen** to Timeline+Archive so a person on Archived-only space assets is granted PersonRead. A deny-only widening, never admits Hidden/Locked.
- **rbac-8** — `downloadAlbumId` already flat-gates (owner's Hidden omitted, matching the grid) → **no functional change**; add a clarifying comment + a pinning regression test.

## Architecture

- **Server** — NestJS 11 + Kysely. Services extend `BaseService` (exposes `this.accessRepository`,
  `this.requireAccess`, `this.checkAccess`). Access composition lives in `src/utils/access.ts`
  (`checkOtherAccess` → `AlbumRead` case at lines 181-194 = owner ∪ shared-viewer ∪ **space-linked**).
- **The "space-only reader" determination (shared by C1 + security-8).** A caller reaches an album through
  a _direct_ grant (album owner or a shared `album_user`) or _only_ through shared-space membership
  (`checkSpaceLinkedAlbumReadAccess`, no role filter). We introduce **one** shared helper
  `hasDirectAlbumReadAccess(access, userId, albumId)` in `src/utils/access.ts` that mirrors the `granted`
  set computed in the `AlbumRead` case **before** the space-linked arm is unioned in
  (`checkOwnerAccess ∪ checkSharedAlbumAccess(Viewer)`). When `AlbumRead` passed but this helper returns
  false, the caller is a space-only reader. Shared-link auth is treated as direct (deliberate share) and
  short-circuits the helper — this also avoids calling the auto-mocked access methods on the shared-link
  test paths.
  - **C1** hooks it at `activity.service.ts` `getAll` (line 21) — no album object is loaded there, so the
    access-repo determination is the only option; album-level rows (`assetId === null`) are filtered in-memory.
  - **security-8** hooks it at `album.service.ts` `get` (replacing the in-memory `isParticipant` check at
    line 107) — the same predicate, so the genuine-participant path wins in both fixes.
- **SQL-gate fixes** (security-2, rbac-7) change `@GenerateSql`-decorated queries. `pnpm run check` (tsc)
  and `pnpm run lint` do **not** validate the generated `server/src/queries/*.sql` docs, so local gates
  pass; regenerating the docs needs a scratch migrated DB (`make sql`) which is unavailable here — see
  Global Constraints.

## Tech Stack

- Server unit: **vitest** via `newTestService()` auto-mocking (`test/utils.ts`), run with
  `cd server && pnpm test --run <path>`.
- Server medium: **vitest** + real Postgres (testcontainers) via `newMediumService()` (`test/medium.factory.ts`),
  run with `cd server && pnpm test:medium --run <path>`.
- e2e: API vitest + supertest (`e2e/`).
- Type/lint gate: `cd server && pnpm run check` (tsc --noEmit) and `cd server && pnpm run lint`
  (eslint `--max-warnings 0`).

## Global Constraints (from spec §0.3 + environment)

- **Docker is DOWN** — `pnpm test:medium` and the e2e API suite **cannot run locally**. Every fix that has
  a service-layer surface (C1, security-8) gets a **unit** test that runs locally red→green. Fixes that are
  pure SQL predicates (security-2, rbac-7, rbac-8) are **not unit-testable**; their medium/e2e tests are
  **authored, CI-deferred** and the local proof is `pnpm run check` + `pnpm run lint` (impl compiles).
- **No Claude co-author trailers.** One commit per fix-group; boundaries defined per task below.
- **Never run `make sql` / migrations without a DB** (deletes query files / no scratch DB here). security-2
  and rbac-7 touch `@GenerateSql`-decorated queries, so `server/src/queries/map.repository.sql` and
  `server/src/queries/access.repository.sql` **will drift**; regen against a scratch migrated DB is
  **CI/DB-deferred before merge**. This is expected and does not fail `pnpm run check`/`lint`.
- Prefer keeping the wire shape stable — **no DTO change** in this slice, so **no SDK/OpenAPI regen** is
  required. (If `@immich/plugin-sdk` dist is missing and web/vite fails to resolve, run
  `pnpm --filter @immich/sdk build && pnpm --filter @immich/plugin-sdk build`.)
- Kysely: never issue `this.db` queries inside a `transaction()` callback (not relevant to this slice — no
  new transactions).
- Single-file unit run uses `pnpm test --run <path>` (NOT `pnpm test -- --run <path>`, which does not filter).

---

## Task 1 — security-2: gate `getAlbumMapMarkers` on shareable visibility

**Closes security-2.** `getAlbumMapMarkers` (`map.repository.ts`) joins `album_asset → asset_exif` with **no**
visibility filter — the only genuinely ungated album content-read surface. `mapMarkersQuery()` is
`asset`-rooted (`selectFrom('asset')`), so `asset.visibility` is already available: **no extra `asset` join
is needed**, just a flat `spaceVisibilityGate`. `album.service.getMapMarkers` only gates `AlbumRead`, so the
gate must live in the repo SQL. Flat gate (no owner exception) — consistent with the album grid and
`downloadAlbumId`.

**This is a pure SQL predicate → not unit-testable. Medium + e2e authored, CI-deferred. Local proof = `check` + `lint`.**

### Files

- `server/src/repositories/map.repository.ts` — impl (import + one `.where`).
- `server/test/medium/specs/repositories/map.repository.spec.ts` — new `describe('getAlbumMapMarkers')` block (CI-deferred).
- `e2e/src/specs/server/api/shared-space-visibility-negatives.e2e-spec.ts` — new `GET /albums/:id/map-markers` block (CI-deferred).

### Interfaces

- `getAlbumMapMarkers(albumId: string)` — unchanged signature; SQL now excludes Hidden/Locked album assets.
- `spaceVisibilityGate(eb, column?='asset.visibility'): Expression<SqlBool>` — existing helper from `src/utils/shared-space-album-scope`.

### Steps

- [ ] **Write the failing medium test** in `map.repository.spec.ts`, appended inside `describe(MapRepository.name, ...)` after the existing `getMapMarkers` block:

  ```ts
  describe('getAlbumMapMarkers', () => {
    const withGps = async (ctx: any, assetId: string, latitude: number, longitude: number) =>
      ctx.database
        .insertInto('asset_exif')
        .values({ assetId, latitude, longitude, city: 'Vienna', state: 'Vienna', country: 'Austria' })
        .execute();

    it('excludes Hidden and Locked album assets; includes Timeline and Archive (flat gate, security-2)', async () => {
      const { ctx, sut } = setup();
      const { user: owner } = await ctx.newUser();
      const { album } = await ctx.newAlbum({ ownerId: owner.id });

      const { asset: timeline } = await ctx.newAsset({ ownerId: owner.id, visibility: AssetVisibility.Timeline });
      const { asset: archive } = await ctx.newAsset({ ownerId: owner.id, visibility: AssetVisibility.Archive });
      const { asset: hidden } = await ctx.newAsset({ ownerId: owner.id, visibility: AssetVisibility.Hidden });
      const { asset: locked } = await ctx.newAsset({ ownerId: owner.id, visibility: AssetVisibility.Locked });

      await withGps(ctx, timeline.id, 48.2, 16.3);
      await withGps(ctx, archive.id, 48.3, 16.4);
      await withGps(ctx, hidden.id, 48.4, 16.5);
      await withGps(ctx, locked.id, 48.5, 16.6);

      for (const assetId of [timeline.id, archive.id, hidden.id, locked.id]) {
        await ctx.newAlbumAsset({ albumId: album.id, assetId });
      }

      const ids = (await sut.getAlbumMapMarkers(album.id)).map((m) => m.id);

      expect(ids).toContain(timeline.id);
      expect(ids).toContain(archive.id); // Archive is shareable — not stripped
      expect(ids).not.toContain(hidden.id);
      expect(ids).not.toContain(locked.id);
    });

    it("omits the album OWNER's own Hidden asset too (flat gate, matches the grid)", async () => {
      const { ctx, sut } = setup();
      const { user: owner } = await ctx.newUser();
      const { album } = await ctx.newAlbum({ ownerId: owner.id });
      const { asset: hidden } = await ctx.newAsset({ ownerId: owner.id, visibility: AssetVisibility.Hidden });
      await withGps(ctx, hidden.id, 40.7, -74.0);
      await ctx.newAlbumAsset({ albumId: album.id, assetId: hidden.id });

      const ids = (await sut.getAlbumMapMarkers(album.id)).map((m) => m.id);
      expect(ids).not.toContain(hidden.id);
    });
  });
  ```

- [ ] **Run (CI-deferred — Docker down)**: `cd server && pnpm test:medium --run test/medium/specs/repositories/map.repository.spec.ts`.
      Expected **RED** on current code: the four-asset test fails because `hidden.id` and `locked.id` are present in `ids` (no gate). Record: "Docker unavailable locally — deferred to CI; RED reasoning: `getAlbumMapMarkers` has no visibility filter."

- [ ] **Write the failing e2e** in `shared-space-visibility-negatives.e2e-spec.ts`, appended as a new top-level `describe` inside the outer suite (reuse module helpers `freshSpaceWithViewer`, `linkAlbum`, `setVisibility`; import nothing new). Uses a GPS-tagged fixture so `asset_exif` has coordinates:

  ```ts
  describe('GET /albums/:id/map-markers (space-linked) — Hidden/Locked coordinates absent (security-2)', () => {
    const mapMarkerIds = async (albumId: string, token: string): Promise<string[]> => {
      const { status, body } = await request(app)
        .get(`/albums/${albumId}/map-markers`)
        .set('Authorization', `Bearer ${token}`);
      expect(status).toBe(200);
      return (body as Array<{ id: string }>).map((m) => m.id);
    };

    it('Hidden album asset has no map marker for a Viewer member OR the owner (flat gate)', async () => {
      // thompson-springs.jpg carries GPS EXIF (see reference_test_asset_exif_content).
      const gps = await utils.createAsset(owner.accessToken, {
        assetData: { filename: 'thompson-springs.jpg', bytes: readTestAsset('formats/jpg/thompson-springs.jpg') },
      });
      const hidden = await utils.createAsset(owner.accessToken, {
        assetData: { filename: 'thompson-springs.jpg', bytes: readTestAsset('formats/jpg/thompson-springs.jpg') },
      });
      const album = await utils.createAlbum(owner.accessToken, {
        albumName: 'MapMarkerHiddenNeg',
        assetIds: [gps.id, hidden.id],
      });
      await setVisibility(hidden.id, AssetVisibility.Hidden);
      const spaceId = await freshSpaceWithViewer('map-marker-hidden-neg');
      await linkAlbum(spaceId, album.id);

      const memberIds = await mapMarkerIds(album.id, member.accessToken);
      expect(memberIds).toContain(gps.id);
      expect(memberIds).not.toContain(hidden.id);

      const ownerIds = await mapMarkerIds(album.id, owner.accessToken);
      expect(ownerIds).not.toContain(hidden.id); // flat gate: no owner exception
    });
  });
  ```

  Add the fixture reader near the other module helpers (top of the file):

  ```ts
  import { readFileSync } from 'node:fs';
  const readTestAsset = (rel: string) => readFileSync(new URL(`../../../../test-assets/${rel}`, import.meta.url));
  ```

  > Note: verify the exact `test-assets` relative depth against the repo layout when running e2e; if the GPS
  > fixture path differs, adjust. The **medium test above is the authoritative security-2 proof** (it inserts
  > `asset_exif` directly and is layout-independent); the e2e is the HTTP-seam confirmation.

- [ ] **Run (CI-deferred)**: `cd e2e && pnpm test -- shared-space-visibility-negatives`. Expected **RED**: `hidden.id` present in `memberIds`/`ownerIds`.

- [ ] **Implement the minimal fix** in `server/src/repositories/map.repository.ts`.

  Extend the import at line 17:

  ```ts
  import {
    spaceAlbumAssetExists,
    spaceAssetPathBranches,
    spaceVisibilityGate,
  } from 'src/utils/shared-space-album-scope';
  ```

  Change `getAlbumMapMarkers` (lines 75-81) to:

  ```ts
  @GenerateSql({ params: [DummyValue.UUID] })
  getAlbumMapMarkers(albumId: string) {
    return this.mapMarkersQuery()
      .innerJoin('album_asset', 'asset.id', 'album_asset.assetId')
      .where('album_asset.albumId', '=', albumId)
      // security-2: never expose GPS / city / state / country of Hidden or Locked album assets. Flat
      // gate (no owner exception), consistent with the album grid (withDefaultVisibility) and the album
      // download path (downloadAlbumId). mapMarkersQuery() is asset-rooted, so asset.visibility is
      // available without an extra join.
      .where((eb) => spaceVisibilityGate(eb))
      .execute();
  }
  ```

- [ ] **Local gate (runs now)**: `cd server && pnpm run check` then `cd server && pnpm run lint`. Expected **GREEN** (compiles, no warnings). The medium/e2e tests turn GREEN on CI.

- [ ] **Commit** (only the map repo + its two test files):
      `git add server/src/repositories/map.repository.ts server/test/medium/specs/repositories/map.repository.spec.ts e2e/src/specs/server/api/shared-space-visibility-negatives.e2e-spec.ts`
      `git commit -m "fix(spaces): gate album map-markers on shareable visibility (security-2)"`

---

## Task 2 — C1: deny album-level activity to space-only album readers (+ shared helper)

**Closes C1 (net-new).** `GET /activities?albumId=` object-gates on `AlbumRead` (`activity.service.ts:21`),
now granted to any space member via `checkSpaceLinkedAlbumReadAccess`. Album-level comments/likes
(`activity.assetId IS NULL`) legitimately have no asset, so the SQL gate in
`activity.repository.search()` (`… OR asset.id IS NULL`) **cannot** filter them. **Fix at the access
layer**: introduce the shared `hasDirectAlbumReadAccess` helper and, when the caller reaches the album
**only** via space membership, drop album-level activity in-memory. Asset-level activity on visible assets
(already gated by `search`) is unaffected.

**Service-layer fix → unit-testable, runs locally red→green.** Medium is not the right layer (in-memory
filter). e2e authored, CI-deferred.

### Files

- `server/src/utils/access.ts` — new exported helper `hasDirectAlbumReadAccess` (also used by Task 3).
- `server/src/services/activity.service.ts` — `getAll` filters album-level for space-only readers.
- `server/src/services/activity.service.spec.ts` — new unit tests (run locally).
- `e2e/src/specs/server/api/activity.e2e-spec.ts` — new space-linked block (CI-deferred).

### Interfaces

- `hasDirectAlbumReadAccess(access: AccessRepository, userId: string, albumId: string): Promise<boolean>` —
  true iff the user is the album owner or a shared `album_user` (Viewer+). Mirrors the `granted` set in
  `checkOtherAccess`'s `AlbumRead` case before the space-linked arm.
- `ActivityService.getAll(auth, dto)` — unchanged signature; result excludes `assetId === null` rows for
  space-only readers.

### Steps

- [ ] **Write the failing unit tests** in `activity.service.spec.ts`, appended to the `describe('getAll')`
      block (imports to add at top: `AlbumUserRole` from `src/enum`; `ActivityFactory`, `getForActivity`,
      `AuthFactory`, `newUuid`/`newUuids` are already imported):

  ```ts
  it('drops album-level activity for a space-only reader; keeps asset-level activity on visible assets (C1)', async () => {
    const [albumId, assetId, userId] = newUuids();
    const albumLevel = getForActivity(ActivityFactory.create({ albumId, assetId: null, userId }));
    const assetLevel = getForActivity(ActivityFactory.create({ albumId, assetId, userId }));

    // AlbumRead granted ONLY via the space-linked arm (not owner, not shared album_user).
    mocks.access.album.checkOwnerAccess.mockResolvedValue(new Set());
    mocks.access.album.checkSharedAlbumAccess.mockResolvedValue(new Set());
    mocks.access.album.checkSpaceLinkedAlbumReadAccess.mockResolvedValue(new Set([albumId]));
    mocks.activity.search.mockResolvedValue([albumLevel, assetLevel]);

    const result = await sut.getAll(AuthFactory.create({ id: userId }), { albumId });

    expect(result.map((a) => a.assetId)).toEqual([assetId]);
    expect(result.some((a) => a.assetId === null)).toBe(false);
  });

  it('keeps album-level activity for the album owner (direct access wins over the space arm) (C1)', async () => {
    const [albumId, assetId, userId] = newUuids();
    const albumLevel = getForActivity(ActivityFactory.create({ albumId, assetId: null, userId }));
    const assetLevel = getForActivity(ActivityFactory.create({ albumId, assetId, userId }));

    mocks.access.album.checkOwnerAccess.mockResolvedValue(new Set([albumId]));
    mocks.activity.search.mockResolvedValue([albumLevel, assetLevel]);

    const result = await sut.getAll(AuthFactory.create({ id: userId }), { albumId });

    expect(result).toHaveLength(2);
    expect(result.some((a) => a.assetId === null)).toBe(true);
  });

  it('keeps album-level activity for a shared album participant who is also a space member (C1)', async () => {
    const [albumId, userId] = newUuids();
    const albumLevel = getForActivity(ActivityFactory.create({ albumId, assetId: null, userId }));

    // Not owner, but a shared album_user (Viewer+) — participant path wins.
    mocks.access.album.checkOwnerAccess.mockResolvedValue(new Set());
    mocks.access.album.checkSharedAlbumAccess.mockResolvedValue(new Set([albumId]));
    mocks.access.album.checkSpaceLinkedAlbumReadAccess.mockResolvedValue(new Set([albumId]));
    mocks.activity.search.mockResolvedValue([albumLevel]);

    const result = await sut.getAll(AuthFactory.create({ id: userId }), { albumId });

    expect(result).toHaveLength(1);
  });
  ```

  > Note: the existing `getAll` tests mock `checkOwnerAccess → {albumId}`, so `hasDirectAlbumReadAccess`
  > short-circuits on the owner arm and never touches `checkSharedAlbumAccess` — they stay green unchanged.

- [ ] **Run**: `cd server && pnpm test --run src/services/activity.service.spec.ts`.
      Expected **RED**: the first test fails because current `getAll` returns both rows (`[null, assetId]`),
      so `result.map(a => a.assetId)` is `[null, assetId]`, not `[assetId]`.

- [ ] **Implement the shared helper** in `server/src/utils/access.ts`. Add after `checkOtherAccess`
      (before `requireElevatedPermission`); all imports it needs (`AccessRepository`, `AlbumUserRole`) are
      already present at the top of the file:

  ```ts
  /**
   * True when the caller reaches an album through a DIRECT grant — album owner or a shared album_user
   * (Viewer+) — as opposed to ONLY via shared-space membership (checkSpaceLinkedAlbumReadAccess, no role
   * filter). Mirrors the `granted` set computed in the AlbumRead case above, i.e. everything AlbumRead
   * grants BEFORE the space-linked arm is unioned in.
   *
   * When AlbumRead passed but this returns false, the caller is a "space-only reader". Used to deny
   * album-level activity (C1) and strip participant PII (security-8) for those callers, while leaving
   * genuine owners/participants untouched.
   */
  export const hasDirectAlbumReadAccess = async (
    access: AccessRepository,
    userId: string,
    albumId: string,
  ): Promise<boolean> => {
    const ids = new Set([albumId]);
    const isOwner = await access.album.checkOwnerAccess(userId, ids);
    if (isOwner.has(albumId)) {
      return true;
    }
    const isShared = await access.album.checkSharedAlbumAccess(userId, ids, AlbumUserRole.Viewer);
    return isShared.has(albumId);
  };
  ```

- [ ] **Implement the C1 fix** in `server/src/services/activity.service.ts`. Add the import:

  ```ts
  import { hasDirectAlbumReadAccess } from 'src/utils/access';
  ```

  Replace `getAll` (lines 20-30) with:

  ```ts
  async getAll(auth: AuthDto, dto: ActivitySearchDto): Promise<ActivityResponseDto[]> {
    await this.requireAccess({ auth, permission: Permission.AlbumRead, ids: [dto.albumId] });

    // C1: a caller who reaches the album ONLY through shared-space membership (not the album owner or a
    // shared album_user) must not see album-level activity (comments/likes with no asset) — the historical
    // thread, commenter identities and like list. Asset-level activity on visible assets (already gated in
    // activityRepository.search) is unaffected. A shared-link caller has explicit album access → treated as
    // direct (also avoids an owner-lookup on the shared-link path).
    const hasDirectAccess =
      !!auth.sharedLink || (await hasDirectAlbumReadAccess(this.accessRepository, auth.user.id, dto.albumId));

    const activities = await this.activityRepository.search({
      userId: dto.userId,
      albumId: dto.albumId,
      assetId: dto.level === ReactionLevel.ALBUM ? null : dto.assetId,
      isLiked: dto.type && dto.type === ReactionType.LIKE,
    });

    const visible = hasDirectAccess ? activities : activities.filter((activity) => activity.assetId !== null);

    return visible.map((activity) => mapActivity(activity));
  }
  ```

  > Scope note (record in the commit body): `getStatistics` (line 33) gates on the same `AlbumRead` but
  > returns only aggregate `{comments, likes}` counts — no identities/content — so it is outside C1's
  > identity/content-leak scope. Restricting the counts would need an SQL predicate change +
  > `make sql` regen (no DB available). Left unchanged deliberately.

- [ ] **Run**: `cd server && pnpm test --run src/services/activity.service.spec.ts`. Expected **GREEN**
      (all three new tests + the existing `getAll`/`getStatistics`/`create`/`delete` tests pass).

- [ ] **Write the CI-deferred e2e** in `activity.e2e-spec.ts`, appended as a new `describe` (reuse the
      module's `createActivity`; add `utils.createSpace`/`addSpaceMember`/link-album calls). Skeleton:

  ```ts
  describe('GET /activities (space-linked album) — album-level activity denied to space-only readers (C1)', () => {
    it('space Viewer sees asset-level activity on a visible asset but NOT album-level comments', async () => {
      const spaceOwner = admin; // album owner
      const asset = await utils.createAsset(spaceOwner.accessToken);
      const album = await createAlbum(
        { createAlbumDto: { albumName: 'C1 Album', assetIds: [asset.id] } },
        { headers: asBearerAuth(spaceOwner.accessToken) },
      );
      // album-level comment (no assetId) + asset-level comment (assetId set)
      await createActivity(
        { albumId: album.id, type: ReactionType.Comment, comment: 'album-level secret' },
        spaceOwner.accessToken,
      );
      await createActivity(
        { albumId: album.id, assetId: asset.id, type: ReactionType.Comment, comment: 'on the photo' },
        spaceOwner.accessToken,
      );

      const space = await utils.createSpace(spaceOwner.accessToken, { name: 'C1 Space' });
      await utils.addSpaceMember(spaceOwner.accessToken, space.id, { userId: nonOwner.userId }); // Viewer
      await request(app)
        .put(`/shared-spaces/${space.id}/albums/${album.id}`)
        .set('Authorization', `Bearer ${spaceOwner.accessToken}`);

      const asMember = await request(app)
        .get('/activities')
        .query({ albumId: album.id })
        .set('Authorization', `Bearer ${nonOwner.accessToken}`);
      expect(asMember.status).toBe(200);
      expect(asMember.body.map((a: { assetId: string | null }) => a.assetId)).toEqual([asset.id]);
      expect(asMember.body.some((a: { comment?: string }) => a.comment === 'album-level secret')).toBe(false);

      const asOwner = await request(app)
        .get('/activities')
        .query({ albumId: album.id })
        .set('Authorization', `Bearer ${spaceOwner.accessToken}`);
      expect(asOwner.body).toHaveLength(2); // owner sees both
    });
  });
  ```

  > Edge cases covered by name: asset-level on visible asset kept (`toEqual([asset.id])`); album-level
  > denied (`'album-level secret'` absent); owner/participant path unaffected (owner sees both).

- [ ] **Run (CI-deferred)**: `cd e2e && pnpm test -- activity`. Expected GREEN on CI.

- [ ] **Local gate**: `cd server && pnpm run check` then `cd server && pnpm run lint`. Expected **GREEN**.

- [ ] **Commit**:
      `git add server/src/utils/access.ts server/src/services/activity.service.ts server/src/services/activity.service.spec.ts e2e/src/specs/server/api/activity.e2e-spec.ts`
      `git commit -m "fix(spaces): deny album-level activity to space-only album readers (C1)"`

---

## Task 3 — security-8: strip album participants for space-only readers

**Closes security-8 (PII shape).** `GET /albums/:id` (`album.service.ts` `get`, `mapAlbum`) returns
`albumUsers` (id/name/profileImage/role) to non-participant space members (email already redacted).
`getLinkedAlbums` correctly omits `albumUsers` (exposes only `ownerId`). Fix: for a space-derived
`AlbumRead` (reuse the **same** `hasDirectAlbumReadAccess` determination as C1), reduce `albumUsers` to the
album owner (display name; email blanked), matching `getLinkedAlbums`. `AlbumResponseSchema.albumUsers`
requires `.min(1)`, so the owner entry is kept (cannot omit the array entirely).

**Service-layer fix → unit-testable, runs locally red→green.** e2e authored, CI-deferred.

### Files

- `server/src/services/album.service.ts` — `get` replaces the `isParticipant` email-only redaction with the shared-helper strip.
- `server/src/services/album.service.spec.ts` — rewrite/extend the `describe('getAlbumInfo')` redaction tests (run locally).
- `e2e/src/specs/server/api/shared-space-visibility-negatives.e2e-spec.ts` — new `GET /albums/:id` block (CI-deferred).

### Interfaces

- `AlbumService.get(auth, id)` — unchanged signature; for space-only readers `result.albumUsers` = `[owner]` (email `''`).
- Reuses `hasDirectAlbumReadAccess` from Task 2.

### Steps

- [ ] **Rewrite the failing unit test** in `album.service.spec.ts`, inside `describe('getAlbumInfo')`.
      Replace the existing test `'redacts album-user emails when access is via space grant only (not a participant)'`
      (lines ~903-929) with the stronger security-8 assertion, and add an explicit "other participant
      absent" check. Keep the two "does NOT redact" tests (owner / participant) as-is — they now assert the
      un-stripped path:

  ```ts
  it('strips albumUsers to the owner (email redacted) when access is via space grant only (security-8)', async () => {
    // spaceViewer is NOT in album.albumUsers — access granted only via checkSpaceLinkedAlbumReadAccess.
    const spaceViewer = UserFactory.create();
    const album = AlbumFactory.from().albumUser().build(); // owner + 1 extra participant
    const otherParticipant = album.albumUsers.find(({ role }) => role !== AlbumUserRole.Owner)!;
    mocks.album.getById.mockResolvedValue(getForAlbum(album));
    mocks.access.album.checkOwnerAccess.mockResolvedValue(new Set());
    mocks.access.album.checkSharedAlbumAccess.mockResolvedValue(new Set());
    mocks.access.album.checkSpaceLinkedAlbumReadAccess.mockResolvedValue(new Set([album.id]));
    mocks.album.getMetadataForIds.mockResolvedValue([
      { albumId: album.id, assetCount: 0, startDate: null, endDate: null, lastModifiedAssetTimestamp: null },
    ]);

    const result = await sut.get(AuthFactory.create(spaceViewer), album.id);

    // Only the owner survives (DTO requires albumUsers.min(1)); other participants are gone.
    expect(result.albumUsers).toHaveLength(1);
    expect(result.albumUsers[0].role).toBe(AlbumUserRole.Owner);
    expect(result.albumUsers.map((u) => u.user.id)).not.toContain(otherParticipant.user.id);
    // Owner display name kept; email still redacted.
    expect(result.albumUsers[0].user.email).toBe('');
  });
  ```

- [ ] **Run**: `cd server && pnpm test --run src/services/album.service.spec.ts`.
      Expected **RED**: current `get` only blanks emails (keeps both albumUsers), so `result.albumUsers`
      has length 2 and still contains `otherParticipant.user.id`.

- [ ] **Implement the fix** in `server/src/services/album.service.ts`. Add the import (alongside the
      existing `src/utils/asset.util` import):

  ```ts
  import { hasDirectAlbumReadAccess } from 'src/utils/access';
  ```

  Replace the `mapped`/redaction block in `get` (lines 102-112) with:

  ```ts
  const mapped = mapAlbum(album);

  // security-8: a caller who reaches the album ONLY through shared-space membership (not the album owner
  // or a shared album_user) must not see other participants' PII (id / name / role / profile image /
  // email). Strip albumUsers down to the album owner (display name only, email redacted), matching
  // getLinkedAlbums; genuine participants and shared-link callers keep the full list.
  const hasDirectAccess =
    !!auth.sharedLink || (await hasDirectAlbumReadAccess(this.accessRepository, auth.user.id, id));
  if (!hasDirectAccess) {
    const ownerAlbumUser = mapped.albumUsers.find(({ role }) => role === AlbumUserRole.Owner);
    mapped.albumUsers = ownerAlbumUser ? [ownerAlbumUser] : mapped.albumUsers.slice(0, 1);
    for (const albumUser of mapped.albumUsers) {
      albumUser.user.email = '';
    }
  }
  ```

  > The `hasSharedUsers`/`isShared`/`contributorCounts` computation above (lines 98-100, 120) reads the raw
  > `album.albumUsers` and is unaffected. `contributorCounts` still exposes contributor `userId`s for
  > space-only readers — outside security-8's stated `albumUsers`-shape scope; flag for a follow-up, do
  > **not** change here (spec-faithful).

- [ ] **Run**: `cd server && pnpm test --run src/services/album.service.spec.ts`. Expected **GREEN**
      (new strip test + the owner/participant "does NOT redact" tests + the shared-link `getAlbumInfo`
      test all pass; the shared-link test is safe because `!!auth.sharedLink` short-circuits the helper).

- [ ] **Write the CI-deferred e2e** in `shared-space-visibility-negatives.e2e-spec.ts`, appended as a new
      `describe` (reuse `freshSpaceWithViewer`, `linkAlbum`; owner adds a second album participant so there
      is PII to strip):

  ```ts
  describe('GET /albums/:id (space-linked) — participants stripped for space-only readers (security-8)', () => {
    it('space Viewer sees albumUsers reduced to the owner; a participant sees the full list', async () => {
      const [participant] = await Promise.all([
        utils.userSetup(admin.accessToken, createUserDto.create('sec8-participant')),
      ]);
      const asset = await utils.createAsset(owner.accessToken);
      const album = await utils.createAlbum(owner.accessToken, { albumName: 'Sec8 Album', assetIds: [asset.id] });
      await request(app)
        .put(`/albums/${album.id}/users`)
        .set('Authorization', `Bearer ${owner.accessToken}`)
        .send({
          albumUsers: [{ userId: participant.userId, role: SharedSpaceRole.Viewer /* AlbumUserRole.Viewer */ }],
        });

      const spaceId = await freshSpaceWithViewer('sec8-space');
      await linkAlbum(spaceId, album.id);

      const asMember = await request(app)
        .get(`/albums/${album.id}`)
        .set('Authorization', `Bearer ${member.accessToken}`);
      expect(asMember.status).toBe(200);
      expect(asMember.body.albumUsers).toHaveLength(1);
      expect(asMember.body.albumUsers.map((u: { user: { id: string } }) => u.user.id)).not.toContain(
        participant.userId,
      );

      const asParticipant = await request(app)
        .get(`/albums/${album.id}`)
        .set('Authorization', `Bearer ${participant.accessToken}`);
      expect(asParticipant.body.albumUsers.length).toBeGreaterThan(1); // participant path wins
    });
  });
  ```

  > Use the real `AlbumUserRole.Viewer` enum value in the `albumUsers` payload when wiring the SDK import
  > (the inline comment marks where). Edge cases by name: participant-who-is-also-space-member sees full
  > list; space Viewer reduced to owner.

- [ ] **Run (CI-deferred)**: `cd e2e && pnpm test -- shared-space-visibility-negatives`. Expected GREEN on CI.

- [ ] **Local gate**: `cd server && pnpm run check` then `cd server && pnpm run lint`. Expected **GREEN**.

- [ ] **Commit**:
      `git add server/src/services/album.service.ts server/src/services/album.service.spec.ts e2e/src/specs/server/api/shared-space-visibility-negatives.e2e-spec.ts`
      `git commit -m "fix(spaces): strip album participants for space-only readers (security-8)"`

---

## Task 4 — rbac-7: grant PersonRead on Archived-only space assets (deny-only widening)

**Closes rbac-7.** `PersonRead` shared-space arm (`access.repository.ts`
`PersonAccess.checkSharedSpaceAccess`, lines 697-727) inner-joins `asset` with
`.on('asset.visibility', '=', AssetVisibility.Timeline)` — **stricter** than the grid. A person appearing
only on **Archived** space assets shows in the space people grid (`getPersonsBySpaceId` already uses
`visibleSpaceAssetVisibilities` = Archive+Timeline) but is _denied_ `PersonRead` (rep-face picker /
thumbnail 403). Widen the equality to the shareable set `spaceVisibleAssetVisibilities`
(Timeline+Archive). This **grants more** and never admits Hidden/Locked — frame as a deny-fix, not a leak.

**Pure SQL predicate → not unit-testable. Medium authored, CI-deferred. Local proof = `check` + `lint`.**

### Files

- `server/src/repositories/access.repository.ts` — widen the join `.on` condition.
- `server/test/medium/specs/repositories/access-space-visibility.repository.spec.ts` — new `describe('checkSharedSpaceAccess (PersonRead) — rbac-7')` block (CI-deferred).
- `server/test/medium/specs/repositories/shared-space.repository.spec.ts` — one regression in the existing `getPersonsBySpaceId` block pinning "no Hidden/Locked" (CI-deferred).

### Interfaces

- `AccessRepository.person.checkSharedSpaceAccess(userId, personIds): Promise<Set<string>>` — unchanged signature; now grants persons whose only space face is on an Archived asset.
- `spaceVisibleAssetVisibilities` — existing `[Archive, Timeline]` const from `src/utils/shared-space-album-scope`.

### Steps

- [ ] **Write the failing medium test** in `access-space-visibility.repository.spec.ts`, appended after the
      existing `checkSpaceEditAccess` block (the file already imports `AccessRepository`, `AssetVisibility`,
      and provides `ctx.newPerson`/`ctx.newAssetFace`/`ctx.newSharedSpaceAsset`):

  ```ts
  describe('checkSharedSpaceAccess (PersonRead) — visibility widening (rbac-7)', () => {
    const seedPersonOnSpaceAsset = async (visibility: AssetVisibility) => {
      const { ctx, accessRepo } = setup();
      const { user: owner } = await ctx.newUser();
      const { user: viewer } = await ctx.newUser();
      const { space } = await ctx.newSharedSpace({ createdById: owner.id });
      await ctx.newSharedSpaceMember({ spaceId: space.id, userId: owner.id, role: 'owner' });
      await ctx.newSharedSpaceMember({ spaceId: space.id, userId: viewer.id, role: 'viewer' });
      const { person } = await ctx.newPerson({ ownerId: owner.id });
      const { asset } = await ctx.newAsset({ ownerId: owner.id, visibility });
      await ctx.newAssetFace({ assetId: asset.id, personId: person.id });
      await ctx.newSharedSpaceAsset({ spaceId: space.id, assetId: asset.id });
      return { accessRepo, viewer, person };
    };

    it('GRANTS PersonRead for a person whose only space face is on an Archived asset (was denied)', async () => {
      const { accessRepo, viewer, person } = await seedPersonOnSpaceAsset(AssetVisibility.Archive);
      const result = await accessRepo.person.checkSharedSpaceAccess(viewer.id, new Set([person.id]));
      expect(result.has(person.id)).toBe(true);
    });

    it('grants PersonRead on a Timeline asset (positive control, regression)', async () => {
      const { accessRepo, viewer, person } = await seedPersonOnSpaceAsset(AssetVisibility.Timeline);
      const result = await accessRepo.person.checkSharedSpaceAccess(viewer.id, new Set([person.id]));
      expect(result.has(person.id)).toBe(true);
    });

    it('never grants PersonRead when the person only appears on Hidden or Locked space assets', async () => {
      const hiddenCase = await seedPersonOnSpaceAsset(AssetVisibility.Hidden);
      const lockedCase = await seedPersonOnSpaceAsset(AssetVisibility.Locked);
      expect(
        (
          await hiddenCase.accessRepo.person.checkSharedSpaceAccess(
            hiddenCase.viewer.id,
            new Set([hiddenCase.person.id]),
          )
        ).has(hiddenCase.person.id),
      ).toBe(false);
      expect(
        (
          await lockedCase.accessRepo.person.checkSharedSpaceAccess(
            lockedCase.viewer.id,
            new Set([lockedCase.person.id]),
          )
        ).has(lockedCase.person.id),
      ).toBe(false);
    });
  });
  ```

- [ ] **Write the `getPersonsBySpaceId` regression** in `shared-space.repository.spec.ts`, inside the
      existing `describe('getPersonsBySpaceId')` block (Archive coverage already exists; add the explicit
      Hidden/Locked exclusion pin — model it on the neighbouring tests' setup, seeding a person whose only
      space face is on a Hidden then a Locked asset and asserting `result` does not contain it). Mark as
      regression (expected already-correct).

- [ ] **Run (CI-deferred)**: `cd server && pnpm test:medium --run test/medium/specs/repositories/access-space-visibility.repository.spec.ts`.
      Expected **RED**: the "GRANTS … Archived" test fails on current code (`.on('asset.visibility', '=', Timeline)` excludes Archive). Hidden/Locked + Timeline tests pass on both.

- [ ] **Implement the widening** in `server/src/repositories/access.repository.ts`. Extend the import at line 8:

  ```ts
  import {
    spaceAssetPathBranches,
    spaceVisibilityGate,
    spaceVisibleAssetVisibilities,
  } from 'src/utils/shared-space-album-scope';
  ```

  Change the join condition in `checkSharedSpaceAccess` (lines 705-710) from
  `.on('asset.visibility', '=', AssetVisibility.Timeline)` to:

  ```ts
            .innerJoin('asset', (join) =>
              join
                .onRef('asset.id', '=', 'asset_face.assetId')
                .on('asset.deletedAt', 'is', null)
                // rbac-7 (deny-only widening): widen from Timeline-only to the shareable set
                // (Timeline + Archive) so a person appearing only on Archived space assets — shown in the
                // space people grid via getPersonsBySpaceId — is also granted PersonRead. Never Hidden/Locked.
                .on('asset.visibility', 'in', spaceVisibleAssetVisibilities),
            )
  ```

  > `AssetVisibility` stays imported (still used elsewhere in the file). `spaceVisibilityGate` is a
  > `where`-predicate helper and is **not** usable inside a join `.on(...)`, hence the direct
  > `'in', spaceVisibleAssetVisibilities` form.

- [ ] **Local gate**: `cd server && pnpm run check` then `cd server && pnpm run lint`. Expected **GREEN**.
      Medium tests turn GREEN on CI.

- [ ] **Commit**:
      `git add server/src/repositories/access.repository.ts server/test/medium/specs/repositories/access-space-visibility.repository.spec.ts server/test/medium/specs/repositories/shared-space.repository.spec.ts`
      `git commit -m "fix(spaces): grant PersonRead on archived-only space assets (rbac-7)"`

---

## Task 5 — rbac-8: pin the album-download flat visibility gate (NO functional change)

**Closes rbac-8 (documented no-change).** `downloadAlbumId` (`download.repository.ts`, lines 28-34) already
applies a flat `spaceVisibilityGate`, so an album-archive export omits the owner's own Hidden rows. Adding
an `own OR` exception would let the owner _download_ Hidden while the grid _hides_ it — an inconsistency.
The current flat gate **matches the album grid** (`withDefaultVisibility`) and map-markers. **Fix = a
one-line clarifying comment + a pinning regression test.** No behavior change.

**Comment change → verified by `check`/`lint`. Pin test is a characterization test (expected GREEN on first
run — an explicit exception to §0.1's "red first" rule, documented). e2e (owner path) authored, CI-deferred.**

### Files

- `server/src/repositories/download.repository.ts` — one clarifying comment (no code change).
- `e2e/src/specs/server/api/shared-space-visibility-negatives.e2e-spec.ts` — new owner-download pin (CI-deferred; the existing member-path album-download block already pins the member side).

### Interfaces

- `DownloadRepository.downloadAlbumId(albumId)` — unchanged.

### Steps

- [ ] **Add the clarifying comment** in `server/src/repositories/download.repository.ts`, `downloadAlbumId`
      (lines 28-34):

  ```ts
  downloadAlbumId(albumId: string) {
    return builder(this.db)
      .innerJoin('album_asset', 'asset.id', 'album_asset.assetId')
      .where('album_asset.albumId', '=', albumId)
      // rbac-8 (no functional change): flat visibility gate — NO owner exception — so an album-archive
      // export omits Hidden/Locked rows for everyone, matching the album grid (withDefaultVisibility) and
      // map-markers. An `own OR` here would let the owner download Hidden while the grid hides it.
      .where((eb) => spaceVisibilityGate(eb))
      .stream();
  }
  ```

- [ ] **Write the CI-deferred owner-download pin** in `shared-space-visibility-negatives.e2e-spec.ts`,
      appended to the existing album-download describe (owner exports their own album; their Hidden asset is
      omitted). Skeleton (uses `owner.accessToken`, a helper to POST `/download/info` as owner):

  ```ts
  it("owner's own Hidden album asset is omitted from the album download manifest (rbac-8, flat gate)", async () => {
    const timelineAsset = await utils.createAsset(owner.accessToken);
    const hiddenAsset = await utils.createAsset(owner.accessToken);
    const album = await utils.createAlbum(owner.accessToken, {
      albumName: 'Rbac8 OwnerDownload',
      assetIds: [timelineAsset.id, hiddenAsset.id],
    });
    await setVisibility(hiddenAsset.id, AssetVisibility.Hidden);

    const { status, body } = await request(app)
      .post('/download/info')
      .set('Authorization', `Bearer ${owner.accessToken}`)
      .send({ albumId: album.id });
    expect(status).toBe(201);
    const ids = (body.archives as Array<{ assetIds: string[] }>).flatMap((a) => a.assetIds);
    expect(ids).toContain(timelineAsset.id);
    expect(ids).not.toContain(hiddenAsset.id); // matches the grid — owner's Hidden omitted
  });
  ```

  > Edge cases by name: owner download omits own Hidden (matches grid); Locked can't be in an album (the
  > existing member-path Locked test asserts absence); motion parts still download (unchanged — no
  > motion-specific filter touched).

- [ ] **Run (CI-deferred)**: `cd e2e && pnpm test -- shared-space-visibility-negatives`. Expected GREEN on CI
      **on first run** (behavior already correct — this is a pinning/characterization test).

- [ ] **Local gate**: `cd server && pnpm run check` then `cd server && pnpm run lint`. Expected **GREEN**.

- [ ] **Commit**:
      `git add server/src/repositories/download.repository.ts e2e/src/specs/server/api/shared-space-visibility-negatives.e2e-spec.ts`
      `git commit -m "docs(spaces): pin album-download flat visibility gate (rbac-8)"`

---

## Task 6 — Full-suite validation

**No new code.** Confirm the whole slice is green at the layers that run locally, and enumerate the
CI-deferred layers.

### Steps

- [ ] **Server unit suite**: `cd server && pnpm test --run`. Expected **GREEN** (all unit specs, including
      the new/changed `activity.service.spec.ts` and `album.service.spec.ts`).
- [ ] **Type gate**: `cd server && pnpm run check`. Expected **GREEN** (tsc --noEmit, no errors).
- [ ] **Lint gate**: `cd server && pnpm run lint`. Expected **GREEN** (eslint `--max-warnings 0`).
- [ ] **Record CI-deferred layers** (Docker down — cannot run locally; must be green before merge):
  - `cd server && pnpm test:medium --run test/medium/specs/repositories/map.repository.spec.ts` (security-2)
  - `cd server && pnpm test:medium --run test/medium/specs/repositories/access-space-visibility.repository.spec.ts` (rbac-7)
  - `cd server && pnpm test:medium --run test/medium/specs/repositories/shared-space.repository.spec.ts` (rbac-7 regression)
  - `cd e2e && pnpm test -- shared-space-visibility-negatives` (security-2, security-8, rbac-8)
  - `cd e2e && pnpm test -- activity` (C1)
- [ ] **Record DB-deferred regen** (needs a scratch migrated DB — CI/pre-merge): `make sql` to refresh
      `server/src/queries/map.repository.sql` and `server/src/queries/access.repository.sql` (drifted by
      security-2 + rbac-7). Never run against the dev-stack DB or without a DB.
- [ ] **No SDK/OpenAPI regen** — no DTO/endpoint shape changed in this slice (verify: `git diff --stat`
      shows no `*.dto.ts` schema changes and no controller signature changes).

---

## Coverage map (every Slice 2 edge case → named test)

| Spec edge case                                                                          | Test                                                                                                                                                            |
| --------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Map-markers Hidden/Locked absent for Viewer **and** owner (flat gate)                   | Task 1 medium "excludes Hidden and Locked…", "omits the album OWNER's own Hidden…"; e2e "Hidden album asset has no map marker for a Viewer member OR the owner" |
| Archive album asset still present in map-markers                                        | Task 1 medium `expect(ids).toContain(archive.id)`                                                                                                               |
| Asset-level comments on a **visible** asset still returned (don't over-deny C1)         | Task 2 unit "drops album-level … keeps asset-level" (`toEqual([assetId])`); e2e `toEqual([asset.id])`                                                           |
| Album participant who is **also** a space member still sees activity (participant wins) | Task 2 unit "keeps album-level … shared album participant who is also a space member"                                                                           |
| Owner sees album-level activity                                                         | Task 2 unit "keeps album-level … for the album owner"; e2e owner `toHaveLength(2)`                                                                              |
| Non-participant space member: albumUsers reduced to owner display name                  | Task 3 unit "strips albumUsers to the owner…"; e2e member `toHaveLength(1)`                                                                                     |
| Album participant who is also a space member: full participant list (participant wins)  | Task 3 e2e "a participant sees the full list"                                                                                                                   |
| `getLinkedAlbums` output unchanged (regression only)                                    | Untouched — no code change to `shared-space.service.getLinkedAlbums`; its existing specs stay green (verified by Task 6 unit run)                               |
| PersonRead **granted** for a person on Archived-only space assets (rbac-7 widening)     | Task 4 medium "GRANTS PersonRead … Archived asset"                                                                                                              |
| Hidden/Locked never grant PersonRead (regression)                                       | Task 4 medium "never grants … Hidden or Locked"                                                                                                                 |
| `getPersonsBySpaceId` stays gated (no Hidden/Locked)                                    | Task 4 regression in `shared-space.repository.spec.ts`                                                                                                          |
| Owner album download **omits** own Hidden (rbac-8 no-change, matches grid)              | Task 5 e2e "owner's own Hidden album asset is omitted"; existing member-path block covers the member side                                                       |
| **Locked** can't be in an album; motion parts still download (unchanged)                | Existing member-path Locked download test (Slice 1); no motion filter touched                                                                                   |
