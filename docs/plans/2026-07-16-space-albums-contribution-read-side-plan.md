# Space Albums Contribution Read-Side — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close the 11 confirmed read-side/revocation gaps from the 2026-07-16 audit spec (`2026-07-16-space-albums-contribution-read-side-spec.md`) on branch `rebase/space-albums-onto-main-v303`, TDD, one commit per priority item.

**Architecture:** `album_space_asset` is the cross-owner contribution edge. Decided semantics: **D1 = (b)** — retain rows across unlink, emit synthetic `album_space_asset_audit` tombstones at unlink, `updatedAt`-touch retained rows at re-link so `getUpserts` re-delivers (mirrors the existing visibility purge/restore machinery at `shared-space.repository.ts:538/:588`). **D3 = per-contribution enqueue** of `SharedSpaceFaceMatch {spaceId, assetId}`. Every new read arm joins through the **live** `shared_space_album` link + live membership, so retained rows are inert while unlinked.

**Tech Stack:** NestJS 11, Kysely, Vitest medium tests (real Postgres via testcontainers, `test/medium.factory.ts` contexts), e2e Vitest API suite.

## Global Constraints

- Worktree: `/Users/pierre/dev/gallery/.claude/worktrees/space-albums-rebase-v303` — never the main checkout.
- Order: **P0-3 → P0-1(+P2-9) → P0-2+P1-5 (one commit) → P1-4 → P1-6 → P1-7 → P2 batch**.
- One commit per task, **no Claude co-author / Generated-with trailers**.
- TDD: write the failing test, run it RED, then the minimal fix, run GREEN.
- Do not "fix" spec §3 behaviors: pool-removal/library-unlink leaves contributions visible (multi-path design); owner-departure retention (P2-10 pins it).
- Do not re-audit spec §2 verified-clean areas.
- Kysely: never `this.db` inside a `transaction()` callback — use the `trx` handle (#595).
- `@GenerateSql` methods that gain a `transaction()` wrapper: if the SQL generator cannot introspect the transaction, **drop the decorator** on that method (CI "SQL Schema Checks" regen is authoritative; local `mise sql` is broken — pull the CI diff and `git apply` it, stripping timestamp prefixes).
- After each task: run that task's medium/e2e files locally. Defer the full lint/format/check pass to Task 8 (final gate).
- Scope-guard: `server/src/utils/shared-space-album-scope.guard.spec.ts` (`SPACE_HELPER`/`NON_DECL`/`VIS_ALLOWLIST`) must pass in the final gate; register new helper usages/raw sites if it flags them.
- Medium test run command (from `server/`): `pnpm test:medium -- --run <file>`. E2e (from `e2e/`, stack up detached): `pnpm test -- --run src/specs/server/api/shared-space-album.e2e-spec.ts`.
- CI: `gh workflow run test.yml --ref rebase/space-albums-onto-main-v303` (account `Deeds67`), then **check jobs, not run conclusion**.
- Prettier this plan + any docs edits before committing (CI Docs Build is strict); `prettier --check` every modified server file (eslint green ≠ prettier green).

## Key file map

| Concern               | Files                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| --------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Unlink/re-link (P0-1) | `server/src/repositories/shared-space.repository.ts` (`removeAlbum:746`, `removeOwnedAlbumLinksAddedBy:770`, `addAlbum:736`)                                                                                                                                                                                                                                                                                                                                                                    |
| Time buckets (P0-2)   | `server/src/repositories/asset.repository.ts` (`AssetBuilderOptions:87`, albumId arm `:317-333`), `server/src/services/timeline.service.ts` (`buildTimeBucketOptions:46`)                                                                                                                                                                                                                                                                                                                       |
| Metadata (P1-5)       | `server/src/repositories/album.repository.ts` (`getMetadataForIds:162`), consumers `shared-space.service.ts:824`, `album.service.ts:76/:97`                                                                                                                                                                                                                                                                                                                                                     |
| Access (P1-4)         | `server/src/repositories/access.repository.ts` (`checkSpaceAccess` `:272-344`, `checkSpaceAccessForSpace` `:346-421`)                                                                                                                                                                                                                                                                                                                                                                           |
| Coexistence (P1-6)    | `server/src/repositories/album.repository.ts` (`addAssetIds:425`, `addAssetIdsToAlbums:565`)                                                                                                                                                                                                                                                                                                                                                                                                    |
| Faces (P1-7)          | `server/src/repositories/face-identity.repository.ts` (CTE arms end `:603` and `:734`; public entry `getSharedSpaceFaceMatchBackfillTargets:524`), `server/src/utils/shared-space-album-scope.ts` (`spaceAlbumAssetExistsSql:364`), `server/src/repositories/asset.repository.ts` (`getByAlbumIdWithFaces:960`), `server/src/services/album.service.ts` (`tryContributeDeniedAssets:298`), `server/src/services/shared-space.service.ts:2033` (`handleSharedSpaceAlbumFaceSync` — pager caller) |
| Sync tests            | `server/test/medium/specs/sync/shared-space-album-to-asset-sync.spec.ts`, `.../sync-space-backfill-trash.medium.spec.ts`                                                                                                                                                                                                                                                                                                                                                                        |
| Service tests         | `server/test/medium/specs/services/album-space-asset-permissions.service.spec.ts`, `.../timeline.service.spec.ts`                                                                                                                                                                                                                                                                                                                                                                               |
| Equivalence test      | `server/test/medium/specs/utils/shared-space-album-scope-sql.medium.spec.ts`                                                                                                                                                                                                                                                                                                                                                                                                                    |
| e2e                   | `e2e/src/specs/server/api/shared-space-album.e2e-spec.ts` (PATCH suite `:165-200`)                                                                                                                                                                                                                                                                                                                                                                                                              |

---

### Task 1: P0-3 — remove scratch audit docs (trivial fixup, first commit)

**Files:** Delete: `SPACE-ALBUMS-RBAC-REMEDIATION-SPEC-2026-07-11.md`, `SPACE-ALBUMS-RBAC-REVIEW-2026-07-11.md`, `SPACE-ALBUMS-REMEDIATION-REVIEW-2026-07-08.md` (repo root).

- [ ] **Step 1: Remove and commit**

```bash
cd /Users/pierre/dev/gallery/.claude/worktrees/space-albums-rebase-v303
git rm SPACE-ALBUMS-RBAC-REMEDIATION-SPEC-2026-07-11.md SPACE-ALBUMS-RBAC-REVIEW-2026-07-11.md SPACE-ALBUMS-REMEDIATION-REVIEW-2026-07-08.md
git commit -m "chore: remove internal audit scratch documents from repo root"
```

Expected: three deletions, `ls SPACE-ALBUMS-*.md` → no matches.

---

### Task 2: P0-1 + P2-9 — unlink revocation tombstones + re-link re-delivery (D1 = b)

**Behavior specs (BDD):**

1. Given album L linked to S1+S2, member M (editor) of both, contribution X (owned by carol) tethered to S1; When the link (S1, L) is removed; Then (a) the `album_space_asset` row **survives** (retention), (b) `getDeletes(M)` delivers a `(L, X)` tombstone (album still accessible via S2), (c) web read gate already hides it (pinned test stays green).
2. Given the state after (1); When L is re-linked to S1; Then the retained row's `updateId` is bumped, so `getUpserts(M, ack = pre-unlink updateId)` re-delivers `(L, X)`.
3. Given departing member D owns album L, added its links to S1 (and separately to S2), contribution X tethered to S1, member M in both spaces; When `removeOwnedAlbumLinksAddedBy(S1, D)` runs (member-departure path); Then `getDeletes(M)` delivers the `(L, X)` tombstone.
4. Single-space unlink: whole album dropped via the (gated) grant tombstone. **Correction (2026-07-16 review):** only PARTIALLY covered today — `LinkDeleteV1` emission and trigger-level grant revocation are pinned (`sync-shared-space-album.spec.ts:360-485`, delete-triggers spec), but nothing pins the member's whole-album metadata drop after an UNLINK (only after member-removal/trash) — and this task rewrites `removeAlbum`. Test 4 below pins it (expected-GREEN regression guard, not a RED driver). The edge tombstone is intentionally NOT delivered in this case (`accessibleSpaceAlbums` no longer matches once the only link is gone); the album-level drop is what heals the device — pin both halves. Tombstone over-delivery to members who never synced the edge is a harmless idempotent client delete (audit table has no spaceId; getDeletes scopes by `accessibleSpaceAlbums`).

**Edge matrix notes:** same-(albumId,assetId) contributed via two spaces is structurally unreachable (PK = albumId+assetId); asset deleted while unlinked → FK cascade fires the real trigger → duplicate tombstone, harmless; re-link of a now-Hidden asset → touch bumps updateId but `getUpserts`' `spaceVisibilityGate` withholds it (no resurrection).

**Files:**

- Modify: `server/src/repositories/shared-space.repository.ts` (`addAlbum`, `removeAlbum`, `removeOwnedAlbumLinksAddedBy`, new private helper)
- Test: `server/test/medium/specs/sync/shared-space-album-to-asset-sync.spec.ts` (new describe)

**Interfaces:**

- Produces: `removeAlbum(spaceId, albumId): Promise<void>` (now transactional, tombstoning); `addAlbum(values)` (unchanged signature, touches retained rows when a new link row is inserted); `removeOwnedAlbumLinksAddedBy` (unchanged signature, tombstones on the passed handle).

- [ ] **Step 1: Write the failing tests (P2-9)** — append to `shared-space-album-to-asset-sync.spec.ts` (imports: add `SharedSpaceRepository` from `src/repositories/shared-space.repository`):

```ts
describe('SharedSpaceAlbumToAssetSync — unlink revocation + re-link re-delivery (P0-1 / D1-b)', () => {
  // eslint-disable-next-line unicorn/consistent-function-scoping -- test-local seed factory
  const seedCoLinked = async (ctx: SyncTestContext) => {
    const { user: owner } = await ctx.newUser();
    const { user: m } = await ctx.newUser(); // member of BOTH spaces
    const { user: carol } = await ctx.newUser(); // asset owner
    const { album } = await ctx.newAlbum({ ownerId: owner.id });
    const { asset } = await ctx.newAsset({ ownerId: carol.id });
    const { space: s1 } = await ctx.newSharedSpace({ createdById: owner.id });
    const { space: s2 } = await ctx.newSharedSpace({ createdById: owner.id });
    for (const s of [s1, s2]) {
      await ctx.newSharedSpaceMember({ spaceId: s.id, userId: owner.id, role: SharedSpaceRole.Owner });
      await ctx.newSharedSpaceMember({ spaceId: s.id, userId: m.id, role: SharedSpaceRole.Editor });
      await ctx.newSharedSpaceAlbum({ spaceId: s.id, albumId: album.id });
    }
    await ctx.newAlbumSpaceAsset({ albumId: album.id, assetId: asset.id, spaceId: s1.id });
    return { owner, m, album, asset, s1, s2 };
  };

  it('unlink tombstones the contribution for a member who keeps the album via a co-linked space; the row is retained', async () => {
    const { ctx, db, sut } = setup();
    const spaceRepo = ctx.get(SharedSpaceRepository);
    const { m, album, asset, s1 } = await seedCoLinked(ctx);

    await spaceRepo.removeAlbum(s1.id, album.id);

    // D1-(b) retention: the row survives for re-link reversibility …
    const row = await db
      .selectFrom('album_space_asset')
      .select('assetId')
      .where('albumId', '=', album.id)
      .executeTakeFirst();
    expect(row).toBeDefined();
    // … but the member device receives a delete tombstone (album stays accessible via S2).
    const deletes = await drain(sut.getDeletes({ nowId: NOW_ID, userId: m.id }));
    expect(deletes.some((r) => r.albumId === album.id && r.assetId === asset.id)).toBe(true);
  });

  it('re-link bumps the retained contribution so getUpserts re-delivers past a pre-unlink ack', async () => {
    const { ctx, db, sut } = setup();
    const spaceRepo = ctx.get(SharedSpaceRepository);
    const { owner, m, album, asset, s1 } = await seedCoLinked(ctx);

    const before = await db
      .selectFrom('album_space_asset')
      .select('updateId')
      .where('albumId', '=', album.id)
      .executeTakeFirstOrThrow();

    await spaceRepo.removeAlbum(s1.id, album.id);
    const relinked = await spaceRepo.addAlbum({ spaceId: s1.id, albumId: album.id, addedById: owner.id });
    expect(relinked).toBeDefined();

    // A device that acked past the original updateId must re-receive the edge.
    const rows = await drain(
      sut.getUpserts({
        nowId: NOW_ID,
        userId: m.id,
        ack: { type: SyncEntityType.SharedSpaceAlbumToAssetV1, updateId: before.updateId },
      }),
    );
    expect(rows.some((r) => r.albumId === album.id && r.assetId === asset.id)).toBe(true);
  });

  it('member-departure link cleanup (removeOwnedAlbumLinksAddedBy) tombstones the removed links’ contributions', async () => {
    const { ctx, db, sut } = setup();
    const spaceRepo = ctx.get(SharedSpaceRepository);
    const { user: dep } = await ctx.newUser(); // departing member, owns + added the album
    const { user: m } = await ctx.newUser();
    const { user: carol } = await ctx.newUser();
    const { album } = await ctx.newAlbum({ ownerId: dep.id });
    const { asset } = await ctx.newAsset({ ownerId: carol.id });
    const { space: s1 } = await ctx.newSharedSpace({ createdById: dep.id });
    const { space: s2 } = await ctx.newSharedSpace({ createdById: dep.id });
    for (const s of [s1, s2]) {
      await ctx.newSharedSpaceMember({ spaceId: s.id, userId: dep.id, role: SharedSpaceRole.Owner });
      await ctx.newSharedSpaceMember({ spaceId: s.id, userId: m.id, role: SharedSpaceRole.Editor });
      await ctx.newSharedSpaceAlbum({ spaceId: s.id, albumId: album.id, addedById: dep.id });
    }
    await ctx.newAlbumSpaceAsset({ albumId: album.id, assetId: asset.id, spaceId: s1.id });

    const removed = await spaceRepo.removeOwnedAlbumLinksAddedBy(s1.id, dep.id);
    expect(removed).toContain(album.id);

    const deletes = await drain(sut.getDeletes({ nowId: NOW_ID, userId: m.id }));
    expect(deletes.some((r) => r.albumId === album.id && r.assetId === asset.id)).toBe(true);
    // sanity: retention here too
    const row = await db
      .selectFrom('album_space_asset')
      .select('assetId')
      .where('albumId', '=', album.id)
      .executeTakeFirst();
    expect(row).toBeDefined();
  });

  it('single-space unlink: member gets the whole-album drop; the edge tombstone is correctly withheld', async () => {
    // Expected-GREEN regression guard for the removeAlbum rewrite (BDD 4): in the common
    // single-space case the device converges via the album-level metadata drop, NOT the edge
    // tombstone (getDeletes filters it out once the album leaves accessibleSpaceAlbums).
    const { ctx, sut } = setup();
    const spaceRepo = ctx.get(SharedSpaceRepository);
    const { user: owner } = await ctx.newUser();
    const { user: m } = await ctx.newUser();
    const { user: carol } = await ctx.newUser();
    const { album } = await ctx.newAlbum({ ownerId: owner.id });
    const { asset } = await ctx.newAsset({ ownerId: carol.id });
    const { space } = await ctx.newSharedSpace({ createdById: owner.id });
    await ctx.newSharedSpaceMember({ spaceId: space.id, userId: owner.id, role: SharedSpaceRole.Owner });
    await ctx.newSharedSpaceMember({ spaceId: space.id, userId: m.id, role: SharedSpaceRole.Editor });
    await ctx.newSharedSpaceAlbum({ spaceId: space.id, albumId: album.id });
    await ctx.newAlbumSpaceAsset({ albumId: album.id, assetId: asset.id, spaceId: space.id });

    await spaceRepo.removeAlbum(space.id, album.id);

    const edgeDeletes = await drain(sut.getDeletes({ nowId: NOW_ID, userId: m.id }));
    expect(edgeDeletes.some((r) => r.albumId === album.id)).toBe(false);
    // Album-metadata sync delivers the whole-album drop via the (gated) grant tombstone. Adjust
    // the sut property + delete-row shape to mirror sync-shared-space-album.spec.ts.
    const albumSync = ctx.get(SyncRepository).sharedSpaceAlbum;
    const albumDeletes = await drain(albumSync.getDeletes({ nowId: NOW_ID, userId: m.id }));
    expect(JSON.stringify(albumDeletes)).toContain(album.id);
  });
});
```

Verified against code (2026-07-16 review — no RED-cycle adjustments needed for these): `SyncEntityType.SharedSpaceAlbumToAssetV1` exists as written (`src/enum.ts:1282`); `ctx.newSharedSpaceAlbum` accepts `addedById` (defaults null); `ctx.newAlbum({ ownerId })` creates the `album_user` Owner row; `drain`/`NOW_ID` exist in the file; grants (`shared_space_album_user`) are trigger-created on link insert, so repo-level `addAlbum` in test 2 re-delivers without service plumbing. Remaining adjustment: test 4's album-metadata sync sut — mirror `sync-shared-space-album.spec.ts` for the `SyncRepository` property name and delete-row shape.

- [ ] **Step 2: Run RED**

```bash
cd server && pnpm test:medium -- --run test/medium/specs/sync/shared-space-album-to-asset-sync.spec.ts
```

Expected: the 3 new tests FAIL (no tombstone rows / no updateId bump); all pre-existing tests PASS.

- [ ] **Step 3: Implement** in `shared-space.repository.ts`:

Add private helper (near `emitAlbumAssetVisibilityPurge`, reusing its idiom):

```ts
// D1 (#752 P0-1): synthetic unlink tombstones. Contributions are RETAINED across unlink
// (re-link reversibility, pinned by album-space-asset-permissions.service.spec) — but a device
// that synced the edge must still purge it, and the ONLY tombstone producer is the AFTER-DELETE
// trigger, which never fires for retained rows. Insert audit rows directly: an audit row means
// "revoke this edge on devices", NOT "the row was deleted". getDeletes scopes delivery by
// accessibleSpaceAlbums; members without album access get nothing, extra deliveries are
// idempotent client deletes.
private async tombstoneContributionsForUnlink(
  db: Kysely<DB> | Transaction<DB>,
  spaceId: string,
  albumIds: string[],
): Promise<void> {
  if (albumIds.length === 0) {
    return;
  }
  await db
    .insertInto('album_space_asset_audit')
    .columns(['albumId', 'assetId'])
    .expression(
      db
        .selectFrom('album_space_asset')
        .select(['album_space_asset.albumId', 'album_space_asset.assetId'])
        .where('album_space_asset.spaceId', '=', spaceId)
        .where('album_space_asset.albumId', 'in', albumIds),
    )
    .execute();
}
```

Rewrite `removeAlbum` (transactional; drop `@GenerateSql` if the generator chokes on the transaction — see Global Constraints):

```ts
@GenerateSql({ params: [DummyValue.UUID, DummyValue.UUID] })
async removeAlbum(spaceId: string, albumId: string): Promise<void> {
  await this.db.transaction().execute(async (trx) => {
    await this.tombstoneContributionsForUnlink(trx, spaceId, [albumId]);
    await trx
      .deleteFrom('shared_space_album')
      .where('spaceId', '=', spaceId)
      .where('albumId', '=', albumId)
      .execute();
  });
}
```

In `removeOwnedAlbumLinksAddedBy`, after computing `deleted`, before `return`:

```ts
// D1 (#752 P0-1): member-departure link removal has the identical revocation gap as unlinkAlbum.
await this.tombstoneContributionsForUnlink(
  db,
  spaceId,
  deleted.map((row) => row.albumId),
);
```

(uses the caller-passed handle so the L7 member-removal transaction stays atomic).

Rewrite `addAlbum` (re-link re-delivery — the visibility-restore touch pattern, see `emitAlbumAssetVisibilityRestore`):

```ts
addAlbum(values: Insertable<SharedSpaceAlbumTable>) {
  return this.db.transaction().execute(async (trx) => {
    const inserted = await trx
      .insertInto('shared_space_album')
      .values(values)
      .onConflict((oc) => oc.doNothing())
      .returningAll()
      .executeTakeFirst();
    if (inserted) {
      // D1 (#752 P0-1): re-link re-delivery — touch retained contributions so the
      // album_space_asset_updatedAt trigger bumps updateId and getUpserts re-emits them to
      // devices that purged on the unlink tombstone. No-op on a first-time link.
      await trx
        .updateTable('album_space_asset')
        .set({ updatedAt: sql`clock_timestamp()` })
        .where('spaceId', '=', values.spaceId)
        .where('albumId', '=', values.albumId)
        .execute();
    }
    return inserted;
  });
}
```

- [ ] **Step 4: Run GREEN** — same command as Step 2; all tests PASS. Also run the pinned suites:

```bash
pnpm test:medium -- --run test/medium/specs/services/album-space-asset-permissions.service.spec.ts test/medium/specs/services/shared-space-album.service.spec.ts
```

Expected: PASS (retention pin at `:272` unchanged).

- [ ] **Step 5: Commit**

```bash
git add server/src/repositories/shared-space.repository.ts server/test/medium/specs/sync/shared-space-album-to-asset-sync.spec.ts
git commit -m "fix(spaces): tombstone contributions on album unlink, re-deliver on re-link (#752)"
```

---

### Task 3: P0-2 + P1-5 — contributions in album grid AND metadata counts (ONE commit)

**Behavior specs (BDD):** album L (owner O) linked to space S; contributor C (editor) contributed asset X (owned by carol); member M (viewer). All below via TimelineService (albumId browse) and `getMetadataForIds`:

| Viewer                                             | Grid shows X? | Count includes X? |
| -------------------------------------------------- | ------------- | ----------------- |
| Contributor C (live member)                        | yes           | yes               |
| Album owner O (live member)                        | yes           | yes               |
| Member M (viewer role)                             | yes           | yes               |
| `album_user` shared viewer (non-member)            | **no**        | **no**            |
| Shared-link viewer                                 | **no**        | **no**            |
| O after leaving S (membership gate, not link gate) | **no**        | **no**            |

Plus: trashed X vanishes from buckets+count; Hidden X gated; contributed stack-primary appears (arm-parity stack test); covers include the contribution (`getTimeBucketCovers` pin); `lastModifiedAssetTimestamp` widens (mobile consumer); dedup when (L, X) is in both tables (P1-6 window) — counted once; date range widens when X is the extremum; **invariant: Σ bucket counts == metadata assetCount for every viewer class**.

**Security note (why member-gated):** a blind union would leak cross-owner assets to `album_user`/shared-link viewers. The gate is `albumSpaceIds` — the viewer's **live member spaces currently linking this album** — resolved per request, never for `auth.sharedLink`.

**Files:**

- Modify: `server/src/repositories/shared-space.repository.ts` (new `getMemberSpaceIdsLinkingAlbum`)
- Modify: `server/src/repositories/asset.repository.ts` (`AssetBuilderOptions` + albumId arm of `withTimeBucketAssetFilters`)
- Modify: `server/src/services/timeline.service.ts` (`buildTimeBucketOptions`)
- Modify: `server/src/repositories/album.repository.ts` (`getMetadataForIds`)
- Modify: `server/src/services/shared-space.service.ts:824`, `server/src/services/album.service.ts:76/:97` (pass `forUserId`)
- Test: new `server/test/medium/specs/services/timeline-album-contributions.medium.spec.ts`

**Interfaces:**

- Produces: `SharedSpaceRepository.getMemberSpaceIdsLinkingAlbum(albumId: string, userId: string): Promise<string[]>`; `TimeBucketOptions.albumSpaceIds?: string[]`; `AlbumRepository.getMetadataForIds(ids: string[], options?: { forUserId?: string }): Promise<AlbumAssetCount[]>`.
- Deliberate deviation from the spec's literal wording: a NEW `albumSpaceIds` field instead of overloading `timelineSpaceIds` — `timelineSpaceIds` has a second consumer (`resolveScopedPersonFilters`, PR #778 trap) and is preference-filtered (`shared_space_member.showInTimeline`), which is the wrong gate for an album page.
- `getOwnedNames`/`getSharedNames` stay single-arm (command palette, spec allows). `getByAssetId`/`getByAlbumIdWithFaces` untouched here (latter is Task 6).

- [ ] **Step 1: Write the failing tests** — new file `server/test/medium/specs/services/timeline-album-contributions.medium.spec.ts`:

```ts
// P0-2 + P1-5 (#752): cross-owner contributions must render in the album they were contributed
// to — grid (time buckets), covers, and metadata counts — for every LIVE member of the tether
// space, and for nobody else (album_user shares, shared links, departed members). Count and grid
// must never desync: both consume the same member-gate (albumSpaceIds / forUserId).
import { Kysely } from 'kysely';
import { AssetVisibility, SharedLinkType, SharedSpaceRole } from 'src/enum';
import { AccessRepository } from 'src/repositories/access.repository';
import { AlbumRepository } from 'src/repositories/album.repository';
import { AssetRepository } from 'src/repositories/asset.repository';
import { LoggingRepository } from 'src/repositories/logging.repository';
import { PartnerRepository } from 'src/repositories/partner.repository';
import { SharedLinkRepository } from 'src/repositories/shared-link.repository';
import { SharedSpaceRepository } from 'src/repositories/shared-space.repository';
import { DB } from 'src/schema';
import { TimelineService } from 'src/services/timeline.service';
import { newMediumService } from 'test/medium.factory';
import { factory } from 'test/small.factory';
import { getKyselyDB } from 'test/utils';

let db: Kysely<DB>;

const setup = () =>
  newMediumService(TimelineService, {
    database: db,
    real: [AssetRepository, AccessRepository, PartnerRepository, SharedSpaceRepository, AlbumRepository],
    mock: [LoggingRepository],
  });

beforeAll(async () => {
  db = await getKyselyDB();
});

const seed = async (ctx: ReturnType<typeof setup>['ctx']) => {
  const { user: owner } = await ctx.newUser();
  const { user: contributor } = await ctx.newUser();
  const { user: viewer } = await ctx.newUser();
  const { user: carol } = await ctx.newUser(); // owns the contributed asset
  const { user: albumUserViewer } = await ctx.newUser(); // album_user share, NOT a space member
  const { album } = await ctx.newAlbum({ ownerId: owner.id });
  await ctx.newAlbumUser({ albumId: album.id, userId: albumUserViewer.id, role: 'viewer' });
  const { space } = await ctx.newSharedSpace({ createdById: owner.id });
  await ctx.newSharedSpaceMember({ spaceId: space.id, userId: owner.id, role: SharedSpaceRole.Owner });
  await ctx.newSharedSpaceMember({ spaceId: space.id, userId: contributor.id, role: SharedSpaceRole.Editor });
  await ctx.newSharedSpaceMember({ spaceId: space.id, userId: viewer.id, role: SharedSpaceRole.Viewer });
  await ctx.newSharedSpaceAlbum({ spaceId: space.id, albumId: album.id });

  // owner row — 2020-03-15; contribution — 2020-03-10 (same month bucket, earlier extremum)
  const { asset: owned } = await ctx.newAsset({ ownerId: owner.id, localDateTime: new Date('2020-03-15T12:00:00Z') });
  const { asset: contributed } = await ctx.newAsset({
    ownerId: carol.id,
    localDateTime: new Date('2020-03-10T12:00:00Z'),
  });
  await ctx.newExif({ assetId: owned.id, make: 'Canon' });
  await ctx.newExif({ assetId: contributed.id, make: 'Canon' });
  await ctx.newAlbumAsset({ albumId: album.id, assetId: owned.id });
  await ctx.newAlbumSpaceAsset({ albumId: album.id, assetId: contributed.id, spaceId: space.id });

  return { owner, contributor, viewer, carol, albumUserViewer, album, space, owned, contributed };
};

const bucketTotal = async (sut: TimelineService, userId: string, email: string, albumId: string) => {
  const auth = factory.auth({ user: { id: userId, email } });
  const buckets = await sut.getTimeBuckets(auth, { albumId });
  return buckets.reduce((sum, b) => sum + b.count, 0);
};

describe('P0-2: contributions render in the album grid', () => {
  it('every live member (owner / contributor / viewer) sees the contribution in bucket counts and the asset list', async () => {
    const { sut, ctx } = setup();
    const s = await seed(ctx);
    for (const u of [s.owner, s.contributor, s.viewer]) {
      expect(await bucketTotal(sut, u.id, u.email, s.album.id)).toBe(2);
      const auth = factory.auth({ user: { id: u.id, email: u.email } });
      const assets = await sut.getTimeBucket(auth, { timeBucket: '2020-03-01', albumId: s.album.id });
      expect(assets).toContain(s.contributed.id);
      expect(assets).toContain(s.owned.id);
    }
  });

  it('album_user shared viewer (non-member) does NOT see the contribution', async () => {
    const { sut, ctx } = setup();
    const s = await seed(ctx);
    expect(await bucketTotal(sut, s.albumUserViewer.id, s.albumUserViewer.email, s.album.id)).toBe(1);
  });

  it('album owner who LEFT the space does NOT see the contribution (membership gate, not link gate)', async () => {
    const { sut, ctx } = setup();
    const s = await seed(ctx);
    await db
      .deleteFrom('shared_space_member')
      .where('spaceId', '=', s.space.id)
      .where('userId', '=', s.owner.id)
      .execute();
    expect(await bucketTotal(sut, s.owner.id, s.owner.email, s.album.id)).toBe(1);
  });

  it('shared-link viewer does NOT see the contribution', async () => {
    const { sut, ctx } = setup();
    const s = await seed(ctx);
    // ctx.newSharedLink does NOT exist (verified) — create via the repository, mirroring
    // timeline.service.spec.ts:414-436 for the full required insert shape:
    const sharedLink = await ctx.get(SharedLinkRepository).create({
      userId: s.owner.id,
      albumId: s.album.id,
      type: SharedLinkType.Album,
    } as never); // widen/adjust fields to the repo's Insertable shape
    const auth = factory.auth({ user: { id: s.owner.id, email: s.owner.email }, sharedLink });
    const buckets = await sut.getTimeBuckets(auth, { albumId: s.album.id });
    expect(buckets.reduce((sum, b) => sum + b.count, 0)).toBe(1);
  });

  it('trashed and Hidden contributions vanish from buckets', async () => {
    const { sut, ctx } = setup();
    const s = await seed(ctx);
    await db.updateTable('asset').set({ deletedAt: new Date() }).where('id', '=', s.contributed.id).execute();
    expect(await bucketTotal(sut, s.viewer.id, s.viewer.email, s.album.id)).toBe(1);
    await db
      .updateTable('asset')
      .set({ deletedAt: null, visibility: AssetVisibility.Hidden })
      .where('id', '=', s.contributed.id)
      .execute();
    expect(await bucketTotal(sut, s.viewer.id, s.viewer.email, s.album.id)).toBe(1);
  });

  it('unlinked album (retained rows, D1-b) excludes the contribution — live-link gate', async () => {
    const { sut, ctx } = setup();
    const s = await seed(ctx);
    await ctx.get(SharedSpaceRepository).removeAlbum(s.space.id, s.album.id);
    expect(await bucketTotal(sut, s.owner.id, s.owner.email, s.album.id)).toBe(1);
  });

  it('coexistence window (P1-6): (albumId, assetId) in BOTH tables counts once', async () => {
    const { sut, ctx } = setup();
    const s = await seed(ctx);
    await db.insertInto('album_asset').values({ albumId: s.album.id, assetId: s.contributed.id }).execute();
    expect(await bucketTotal(sut, s.viewer.id, s.viewer.email, s.album.id)).toBe(2);
  });

  it('covers (P0-2): the contribution can be the bucket cover (third consumer of the shared arm)', async () => {
    const { ctx } = setup();
    const s = await seed(ctx);
    // Trash the owned sibling so the contributed asset is the only cover candidate — decisive:
    // without the contributed arm the bucket has NO cover at all.
    await db.updateTable('asset').set({ deletedAt: new Date() }).where('id', '=', s.owned.id).execute();
    const albumSpaceIds = await ctx.get(SharedSpaceRepository).getMemberSpaceIdsLinkingAlbum(s.album.id, s.viewer.id);
    const covers = await ctx
      .get(AssetRepository)
      .getTimeBucketCovers({ albumId: s.album.id, albumSpaceIds, timeBuckets: ['2020-03-01'] } as never);
    expect(JSON.stringify(covers)).toContain(s.contributed.id);
  });

  it('stacked contribution (P0-2): arm parity with owned stacks', async () => {
    // Pin PARITY, not a specific collapse behavior: a contributed stacked pair must change the
    // bucket total by exactly what an owned stacked pair changes it by.
    const { sut, ctx } = setup();
    const s = await seed(ctx);
    const { asset: ownedChild } = await ctx.newAsset({
      ownerId: s.owner.id,
      localDateTime: new Date('2020-03-15T12:01:00Z'),
    });
    await ctx.newAlbumAsset({ albumId: s.album.id, assetId: ownedChild.id });
    await ctx.newStack({ ownerId: s.owner.id, primaryAssetId: s.owned.id, assetIds: [s.owned.id, ownedChild.id] });
    const baseline = await bucketTotal(sut, s.viewer.id, s.viewer.email, s.album.id);
    const ownedDelta = baseline - 2;

    const { asset: contribChild } = await ctx.newAsset({
      ownerId: s.carol.id,
      localDateTime: new Date('2020-03-10T12:01:00Z'),
    });
    await ctx.newAlbumSpaceAsset({ albumId: s.album.id, assetId: contribChild.id, spaceId: s.space.id });
    await ctx.newStack({
      ownerId: s.carol.id,
      primaryAssetId: s.contributed.id,
      assetIds: [s.contributed.id, contribChild.id],
    });
    const total = await bucketTotal(sut, s.viewer.id, s.viewer.email, s.album.id);
    expect(total - baseline).toBe(ownedDelta);

    const auth = factory.auth({ user: { id: s.viewer.id, email: s.viewer.email } });
    const assets = await sut.getTimeBucket(auth, { timeBucket: '2020-03-01', albumId: s.album.id });
    expect(assets).toContain(s.contributed.id); // the contributed stack PRIMARY stays visible
  });
});

describe('P1-5: metadata count/date-range includes contributions, member-gated, grid-consistent', () => {
  it('forUserId=live member → count 2, startDate widens to the contribution', async () => {
    const { ctx } = setup();
    const s = await seed(ctx);
    const albumRepo = ctx.get(AlbumRepository);
    const [meta] = await albumRepo.getMetadataForIds([s.album.id], { forUserId: s.viewer.id });
    expect(meta.assetCount).toBe(2);
    expect(new Date(meta.startDate!).toISOString().slice(0, 10)).toBe('2020-03-10');
    expect(new Date(meta.endDate!).toISOString().slice(0, 10)).toBe('2020-03-15');
    // lastModifiedAssetTimestamp (mobile consumer) must aggregate over the contributed arm too.
    // The contribution is created LAST in seed(), so the max must come from it (don't set
    // updatedAt directly — the updated_at trigger would overwrite it with clock_timestamp).
    const rows = await db
      .selectFrom('asset')
      .select(['id', 'updatedAt'])
      .where('id', 'in', [s.owned.id, s.contributed.id])
      .execute();
    const maxUpdated = Math.max(...rows.map((r) => new Date(r.updatedAt).getTime()));
    expect(new Date(meta.lastModifiedAssetTimestamp!).getTime()).toBe(maxUpdated);
  });

  it('no forUserId (legacy) and departed-member forUserId → count 1', async () => {
    const { ctx } = setup();
    const s = await seed(ctx);
    const albumRepo = ctx.get(AlbumRepository);
    const [legacy] = await albumRepo.getMetadataForIds([s.album.id]);
    expect(legacy.assetCount).toBe(1);
    await db
      .deleteFrom('shared_space_member')
      .where('spaceId', '=', s.space.id)
      .where('userId', '=', s.owner.id)
      .execute();
    const [departed] = await albumRepo.getMetadataForIds([s.album.id], { forUserId: s.owner.id });
    expect(departed.assetCount).toBe(1);
  });

  it('dedup: (albumId, assetId) in both tables counts once', async () => {
    const { ctx } = setup();
    const s = await seed(ctx);
    await db.insertInto('album_asset').values({ albumId: s.album.id, assetId: s.contributed.id }).execute();
    const [meta] = await ctx.get(AlbumRepository).getMetadataForIds([s.album.id], { forUserId: s.viewer.id });
    expect(meta.assetCount).toBe(2);
  });

  it('INVARIANT: Σ bucket counts == metadata assetCount for every viewer class', async () => {
    const { sut, ctx } = setup();
    const s = await seed(ctx);
    const albumRepo = ctx.get(AlbumRepository);
    for (const u of [s.owner, s.contributor, s.viewer, s.albumUserViewer]) {
      const grid = await bucketTotal(sut, u.id, u.email, s.album.id);
      const [meta] = await albumRepo.getMetadataForIds([s.album.id], { forUserId: u.id });
      expect(meta.assetCount).toBe(grid);
    }
  });
});
```

Verified factory facts (2026-07-16 review): `newAlbumUser` ({ albumId, userId, role } — role defaults Editor) and `newExif` EXIST; `ctx.newSharedLink` does NOT — use `ctx.get(SharedLinkRepository).create(...)` per `timeline.service.spec.ts:414-436`. `getTimeBucket` returns a JSON string of columnar arrays — assert with `expect(assets).toContain(s.contributed.id)` on the raw string (id appears verbatim) or parse `JSON.parse(assets).id`. Remaining adjustments allowed during RED: `ctx.newStack` shape (if absent, insert into `stack` + set `asset.stackId` directly, mirroring the #751 stack medium specs); `getTimeBucketCovers` call/return shape (repo-level — mirror its service consumer). If `newMediumService` needs more real repos for TimelineService's BaseService wiring, add them (memory: "Unable to create repository instance" → register in `newRealRepository` switch).

- [ ] **Step 2: Run RED** — `pnpm test:medium -- --run test/medium/specs/services/timeline-album-contributions.medium.spec.ts`. Expected: member-visibility tests FAIL with count 1 vs 2 / missing asset id; negative tests may already pass (fine — they pin the gate).

- [ ] **Step 3: Implement — repo resolver** in `shared-space.repository.ts` (near `getSpaceIdsForTimeline`):

```ts
// #752 P0-2: spaces that CURRENTLY link `albumId` and have `userId` as a live member — the
// member-gate for contributed content on album read surfaces (time buckets, covers, metadata).
// Live-link + live-membership by construction; A1 (album not soft-deleted) enforced here so a
// trashed album's retained contributions resolve to no spaces. NOT preference-filtered — unlike
// getSpaceIdsForTimeline, a member who hid the space from their home timeline still sees the
// album's contributions on the album page itself.
@GenerateSql({ params: [DummyValue.UUID, DummyValue.UUID] })
async getMemberSpaceIdsLinkingAlbum(albumId: string, userId: string): Promise<string[]> {
  const rows = await this.db
    .selectFrom('shared_space_album')
    .innerJoin('album', (join) =>
      join.onRef('album.id', '=', 'shared_space_album.albumId').on('album.deletedAt', 'is', null),
    )
    .innerJoin('shared_space_member', 'shared_space_member.spaceId', 'shared_space_album.spaceId')
    .where('shared_space_album.albumId', '=', albumId)
    .where('shared_space_member.userId', '=', userId)
    .select('shared_space_album.spaceId')
    .execute();
  return rows.map((row) => row.spaceId);
}
```

- [ ] **Step 4: Implement — options field + albumId arm** in `asset.repository.ts`. In `AssetBuilderOptions` add:

```ts
/**
 * #752 P0-2: live member-spaces of the viewer that currently link `albumId` — resolved by
 * timeline.service (getMemberSpaceIdsLinkingAlbum), NEVER for shared-link auth. When set, the
 * albumId arm unions member-gated album_space_asset contributions. Distinct from
 * timelineSpaceIds (home-timeline preference set, separate consumers — PR #778).
 */
albumSpaceIds?: string[];
```

Replace the albumId arm (`:317-333`) — keep both existing flat-gate comments on the trailing `.where`s, but DELETE the stale trailing sentence "Keep the getTimeBucket inline copy in sync." (verified 2026-07-16: no inline copy exists anymore — `getTimeBucket`'s Stage-1 CTE consumes this helper):

```ts
.$if(!!options.albumId, (qb) =>
  qb
    .innerJoin(
      (eb) => {
        // #764/#752 P0-2: album content = the owner's album_asset rows ∪ member-gated
        // cross-owner contributions. The contributed arm is included ONLY when the service
        // resolved albumSpaceIds (live member-spaces linking this album) — album_user shares,
        // shared links and departed members resolve to none, so a blind-union leak is
        // impossible. UNION (not ALL) dedupes a P1-6 coexistence-window pair.
        const ownerRows = eb
          .selectFrom('album_asset')
          .select('album_asset.assetId as assetId')
          .where('album_asset.albumId', '=', asUuid(options.albumId!));
        return (
          options.albumSpaceIds?.length
            ? ownerRows.union(
                eb
                  .selectFrom('album_space_asset')
                  .select('album_space_asset.assetId as assetId')
                  .where('album_space_asset.albumId', '=', asUuid(options.albumId!))
                  .where('album_space_asset.spaceId', '=', anyUuid(options.albumSpaceIds!)),
              )
            : ownerRows
        ).as('album_members');
      },
      (join) => join.onRef('album_members.assetId', '=', 'asset.id'),
    )
    .where((eb) => spaceVisibilityGate(eb))
    .where('asset.deletedAt', 'is', null),
)
```

(The two flat gates already cover the contributed arm — they act on the outer `asset`. `getTimeBuckets`/`getTimeBucketCovers`/`getTimeBucket` all consume this helper; no inline copies exist — verified, the only other `album_asset` sites in this file are `isNotInAlbum`/`isInAlbum` (albumId-exclusive) and `getByAlbumIdWithFaces` (Task 6).)

- [ ] **Step 5: Implement — service threading** in `timeline.service.ts` `buildTimeBucketOptions`, after the `userId` block:

```ts
let albumSpaceIds: string[] | undefined = undefined;
// #752 P0-2: album browse — resolve the viewer's live member-spaces linking this album so the
// repository unions member-gated contributions. NEVER for shared-link auth: auth.user is the
// link OWNER there, and their membership must not leak contributions to anonymous viewers.
if (dto.albumId && !auth.sharedLink) {
  const ids = await this.sharedSpaceRepository.getMemberSpaceIdsLinkingAlbum(dto.albumId, auth.user.id);
  if (ids.length > 0) {
    albumSpaceIds = ids;
  }
}
```

and return it: `return { ...scopedOptions, bucketSize: dto.bucketSize ?? TimeBucketSize.Month, userIds, albumSpaceIds };`

- [ ] **Step 6: Implement — metadata union (P1-5)** in `album.repository.ts`:

```ts
@GenerateSql({ params: [[DummyValue.UUID]] }, { params: [[DummyValue.UUID], { forUserId: DummyValue.UUID }] })
@ChunkedArray()
async getMetadataForIds(ids: string[], { forUserId }: { forUserId?: string } = {}): Promise<AlbumAssetCount[]> {
  if (ids.length === 0) {
    return [];
  }

  return this.db
    .selectFrom('asset')
    .$call(withDefaultVisibility)
    .innerJoin(
      (eb) => {
        // #752 P1-5: album metadata = owner rows ∪ member-gated contributions, so card counts
        // and date ranges agree with the grid (P0-2) for the SAME viewer. The contributed arm
        // requires a LIVE album↔space link (D1-b: retained rows of an unlinked album are inert)
        // and live membership of `forUserId`. UNION dedupes a P1-6 coexistence-window pair.
        const ownerRows = eb
          .selectFrom('album_asset')
          .select(['album_asset.albumId as albumId', 'album_asset.assetId as assetId'])
          .where('album_asset.albumId', 'in', ids);
        return (
          forUserId
            ? ownerRows.union(
                eb
                  .selectFrom('album_space_asset')
                  .innerJoin('shared_space_album', (join) =>
                    join
                      .onRef('shared_space_album.albumId', '=', 'album_space_asset.albumId')
                      .onRef('shared_space_album.spaceId', '=', 'album_space_asset.spaceId'),
                  )
                  .innerJoin('album', (join) =>
                    join.onRef('album.id', '=', 'album_space_asset.albumId').on('album.deletedAt', 'is', null),
                  )
                  .innerJoin('shared_space_member', (join) =>
                    join
                      .onRef('shared_space_member.spaceId', '=', 'shared_space_album.spaceId')
                      .on('shared_space_member.userId', '=', asUuid(forUserId)),
                  )
                  .select(['album_space_asset.albumId as albumId', 'album_space_asset.assetId as assetId'])
                  .where('album_space_asset.albumId', 'in', ids),
              )
            : ownerRows
        ).as('album_members');
      },
      (join) => join.onRef('album_members.assetId', '=', 'asset.id'),
    )
    .select('album_members.albumId as albumId')
    .select((eb) => eb.fn.min(sql<Date>`("asset"."localDateTime" AT TIME ZONE 'UTC'::text)::date`).as('startDate'))
    .select((eb) => eb.fn.max(sql<Date>`("asset"."localDateTime" AT TIME ZONE 'UTC'::text)::date`).as('endDate'))
    // lastModifiedAssetTimestamp is only used in mobile app, please remove if not need
    .select((eb) => eb.fn.max('asset.updatedAt').as('lastModifiedAssetTimestamp'))
    .select((eb) => sql<number>`${eb.fn.count('asset.id')}::int`.as('assetCount'))
    .where('asset.deletedAt', 'is', null)
    .groupBy('album_members.albumId')
    .execute();
}
```

(imports: `asUuid` from `src/utils/database` if not present.)

- [ ] **Step 7: Wire consumers.**
  - `shared-space.service.ts:824`: `getMetadataForIds(rows.map((row) => row.id), { forUserId: auth.user.id })` (viewer is a live member by `requireMembership`).
  - `album.service.ts` `getAll` (:76): change destructure to keep `auth`, then `getMetadataForIds(albums.map((album) => album.id), { forUserId: auth.user.id })`.
  - `album.service.ts` `get` (:97): `getMetadataForIds([album.id], { forUserId: auth.sharedLink ? undefined : auth.user.id })` — the shared-link gate mirrors Step 5.

- [ ] **Step 8: Run GREEN** — the new spec file + regression suites:

```bash
pnpm test:medium -- --run test/medium/specs/services/timeline-album-contributions.medium.spec.ts \
  test/medium/specs/services/timeline.service.spec.ts \
  test/medium/specs/repositories/timeline-bucket-explicit-visibility.medium.spec.ts \
  test/medium/specs/repositories/shared-space-album-scope.characterization.spec.ts \
  test/medium/specs/services/shared-space-album.service.spec.ts
pnpm test -- --run src/services/timeline.service.spec.ts src/services/album.service.spec.ts src/services/shared-space.service.spec.ts
```

Unit specs mocking `getMetadataForIds` keep working (optional second arg); fix any mock call-signature assertions that pin the old single-arg call.

- [ ] **Step 9: Commit**

```bash
git add server/src/repositories/shared-space.repository.ts server/src/repositories/asset.repository.ts \
  server/src/services/timeline.service.ts server/src/repositories/album.repository.ts \
  server/src/services/shared-space.service.ts server/src/services/album.service.ts \
  server/test/medium/specs/services/timeline-album-contributions.medium.spec.ts
git commit -m "fix(spaces): render cross-owner contributions in album grid and counts, member-gated (#752)"
```

---

### Task 4: P1-4 — `checkSpaceAccess` contributed arm (thumbnail/original/download 403 → 200)

**Behavior specs:** contributed-only asset X (in `album_space_asset` for (S, L), NOT in the space pool, NOT in `album_asset`):

- member of S → `checkSpaceAccess(member, {X})` returns X (currently ∅ → RED);
- non-member → ∅; Hidden/trashed X → ∅;
- after `removeAlbum(S, L)` (retained rows!) → ∅ — the live-link inner join is what enforces D1-(b) revocation;
- `checkSpaceAccessForSpace(member, S2, {X})` where the link is (S1, L) → ∅ (space-scoped).

**Files:**

- Modify: `server/src/repositories/access.repository.ts` (`checkSpaceAccess`, `checkSpaceAccessForSpace`)
- Test: extend `server/test/medium/specs/repositories/access-space-visibility.repository.spec.ts` (new describe; reuse its setup idiom)

- [ ] **Step 1: Write the failing tests** — new describe in `access-space-visibility.repository.spec.ts` (adapt to the file's existing setup/factory names):

```ts
describe('P1-4: contributed-only assets — checkSpaceAccess / checkSpaceAccessForSpace', () => {
  const seedContributionOnly = async (ctx: /* the file's ctx type */) => {
    const { user: owner } = await ctx.newUser();
    const { user: member } = await ctx.newUser();
    const { user: carol } = await ctx.newUser();
    const { album } = await ctx.newAlbum({ ownerId: owner.id });
    const { asset } = await ctx.newAsset({ ownerId: carol.id, visibility: AssetVisibility.Timeline });
    const { space } = await ctx.newSharedSpace({ createdById: owner.id });
    await ctx.newSharedSpaceMember({ spaceId: space.id, userId: member.id, role: SharedSpaceRole.Viewer });
    await ctx.newSharedSpaceAlbum({ spaceId: space.id, albumId: album.id });
    // contribution is the ONLY space path: no shared_space_asset row, no album_asset row
    await ctx.newAlbumSpaceAsset({ albumId: album.id, assetId: asset.id, spaceId: space.id });
    return { owner, member, carol, album, asset, space };
  };

  it('member reaches a contributed-only asset (fixes thumbnail/original/download 403)', async () => {
    const { ctx, accessRepo } = setup(); // verified idiom: setup() returns { ctx, accessRepo }; module DB var is defaultDatabase
    const s = await seedContributionOnly(ctx);
    const allowed = await accessRepo.asset.checkSpaceAccess(s.member.id, new Set([s.asset.id]));
    expect(allowed.has(s.asset.id)).toBe(true);
  });

  it('non-member gets nothing', async () => {
    const { ctx, accessRepo } = setup();
    const s = await seedContributionOnly(ctx);
    const { user: stranger } = await ctx.newUser();
    const allowed = await accessRepo.asset.checkSpaceAccess(stranger.id, new Set([s.asset.id]));
    expect(allowed.size).toBe(0);
  });

  it('unlink revokes access even though the contribution row is retained (D1-b live-link gate)', async () => {
    const { ctx, accessRepo } = setup();
    const s = await seedContributionOnly(ctx);
    await ctx.get(SharedSpaceRepository).removeAlbum(s.space.id, s.album.id);
    const allowed = await accessRepo.asset.checkSpaceAccess(s.member.id, new Set([s.asset.id]));
    expect(allowed.size).toBe(0);
  });

  it('Hidden / trashed contributed asset is not reachable', async () => {
    const { ctx, accessRepo } = setup();
    const s = await seedContributionOnly(ctx);
    await defaultDatabase
      .updateTable('asset')
      .set({ visibility: AssetVisibility.Hidden })
      .where('id', '=', s.asset.id)
      .execute();
    expect((await accessRepo.asset.checkSpaceAccess(s.member.id, new Set([s.asset.id]))).size).toBe(0);
    await defaultDatabase
      .updateTable('asset')
      .set({ visibility: AssetVisibility.Timeline, deletedAt: new Date() })
      .where('id', '=', s.asset.id)
      .execute();
    expect((await accessRepo.asset.checkSpaceAccess(s.member.id, new Set([s.asset.id]))).size).toBe(0);
  });

  it('checkSpaceAccessForSpace is scoped to the contribution’s own space', async () => {
    const { ctx, accessRepo } = setup();
    const s = await seedContributionOnly(ctx);
    const { space: other } = await ctx.newSharedSpace({ createdById: s.owner.id });
    await ctx.newSharedSpaceMember({ spaceId: other.id, userId: s.member.id, role: SharedSpaceRole.Viewer });
    const wrongSpace = await accessRepo.asset.checkSpaceAccessForSpace(s.member.id, other.id, new Set([s.asset.id]));
    expect(wrongSpace.size).toBe(0);
    const rightSpace = await accessRepo.asset.checkSpaceAccessForSpace(s.member.id, s.space.id, new Set([s.asset.id]));
    expect(rightSpace.has(s.asset.id)).toBe(true);
  });
});
```

- [ ] **Step 2: Run RED** — `pnpm test:medium -- --run test/medium/specs/repositories/access-space-visibility.repository.spec.ts`. Expected: positive tests FAIL (empty set); negatives pass.

- [ ] **Step 3: Implement.** In `checkSpaceAccess` (`:272-344`; the pool/library/album arms are unioned inside the `combined` subquery, and the assetIds or-where is applied INSIDE each arm — the block below already does both), append a 4th `.union(...)` after the album arm, mirroring it exactly with the contributed join:

```ts
.union(
  this.db
    .selectFrom('shared_space_album')
    .innerJoin('album', (join) =>
      join.onRef('album.id', '=', 'shared_space_album.albumId').on('album.deletedAt', 'is', null),
    )
    .innerJoin('shared_space_member', 'shared_space_member.spaceId', 'shared_space_album.spaceId')
    // #764/#752 P1-4: cross-owner contributions — the spaceId correlation keeps a contribution
    // reachable ONLY through the single live-linked space it was contributed via (mirrors
    // spaceContributedAssetExists; also what revokes access after unlink under D1-b retention).
    .innerJoin('album_space_asset', (join) =>
      join
        .onRef('album_space_asset.albumId', '=', 'shared_space_album.albumId')
        .onRef('album_space_asset.spaceId', '=', 'shared_space_album.spaceId'),
    )
    .innerJoin('asset', (join) =>
      join.onRef('asset.id', '=', 'album_space_asset.assetId').on('asset.deletedAt', 'is', null),
    )
    .select(['asset.id', 'asset.livePhotoVideoId'])
    .where('shared_space_member.userId', '=', userId)
    .where((eb) => spaceVisibilityGate(eb))
    .where((eb) =>
      eb.or([eb('asset.id', 'in', [...assetIds]), eb('asset.livePhotoVideoId', 'in', [...assetIds])]),
    ),
)
```

Same block in `checkSpaceAccessForSpace` with one extra line after the member filter: `.where('shared_space_album.spaceId', '=', spaceId)`.

- [ ] **Step 4: Run GREEN** — same file, plus `pnpm test:medium -- --run test/medium/specs/repositories/shared-space-visibility-matrix.medium.spec.ts test/medium/specs/services/album-space-asset-permissions.service.spec.ts`. Note: the permissions spec's LEAK NEGATIVE (`:240`) asserts the departed album owner loses `AssetRead` — the new arm's membership join keeps that green; if it flips, the arm is wrong (membership gate missing), not the test.

- [ ] **Step 5: Commit**

```bash
git add server/src/repositories/access.repository.ts server/test/medium/specs/repositories/access-space-visibility.repository.spec.ts
git commit -m "fix(spaces): grant asset view/download access for contributed-only assets (#752)"
```

---

### Task 5: P1-6 — coexistence invariant: owner-add converts the contribution

**Behavior specs:**

1. Given E contributed carol's asset X to linked album L; When carol (asset owner, space Editor) adds X via `addAssets` → success, exactly ONE row remains — `album_asset` — the `album_space_asset` row is deleted **in the same transaction**, its audit tombstone exists (mobile: tombstone + fresh `album_asset` upsert in one window → converges to the owner edge).
2. Same net conversion via the bulk `addAssetsToAlbums` service path. **Corrected framing (2026-07-16 review):** this path does NOT share `addAssets`' plumbing — no `asset.util.ts` DUPLICATE precheck (it prechecks per album via `getAssetIds`, which reads only `album_asset` — the P1-6 blind spot), no `tryContributeDeniedAssets` (AssetShare-denied assets are silently dropped, never contributed), aggregate result only. The conversion therefore lands at the REPO layer (`addAssetIdsToAlbums`), which both service paths hit.
3. Re-contribution after conversion → `DUPLICATE` (the `album_asset` precheck fires first), no new contribution row. (`addAssets` path only — the bulk path reports aggregate duplicates.)
4. Owner-first is unreachable via `addAssets` (DUPLICATE precheck precedes AssetShare) — no test needed (spec).
5. Sync convergence: after conversion, `sharedSpaceAlbumToAsset.getDeletes(member)` delivers the tombstone AND `getUpserts(member)` delivers the `album_asset` edge. Client-side ordering is GUARANTEED (verified 2026-07-16): the server handler streams all deletes before upserts (`sync.service.ts:1102-1162`) and the mobile client applies batches strictly sequentially — delete-then-insert is the only possible resolution; note this dependency in the test comment.
6. Post-conversion removal (spec P1-6 seed): owner removes the converted asset → a NEW tombstone (`album_asset_audit`) is delivered beyond the conversion tombstones, and `getUpserts` no longer carries the edge.

**Files:**

- Modify: `server/src/repositories/album.repository.ts` (`addAssetIds:425`, `addAssetIdsToAlbums:565`)
- Test: `server/test/medium/specs/services/album-space-asset-permissions.service.spec.ts` (new describe), `server/test/medium/specs/sync/shared-space-album-to-asset-sync.spec.ts` (one convergence test)

- [ ] **Step 1: Write the failing tests.** In the permissions spec, add the describe INSIDE the existing seeded describe, after the REMOVE block — the fixture (`actors`, `spaceS`, `albumL`, `sut`, `authOf`, row helpers) is describe-scoped, seeded once in that describe's `beforeAll` (`:111-156`); a top-level describe cannot see it, and a per-test `setup()` does NOT re-seed (it only yields a fresh `ctx` for factories — the existing `:207` idiom):

```ts
// ===============================================================================================
// COEXISTENCE (P1-6) — an (albumId, assetId) pair lives in EXACTLY ONE of album_asset /
// album_space_asset. Reachable ordering is contribution-first; the owner-add converts it.
// ===============================================================================================
describe('COEXISTENCE (P1-6)', () => {
  // eslint-disable-next-line unicorn/consistent-function-scoping -- closes over the shared fixture
  const contributeFreshCarolAsset = async () => {
    const { ctx } = setup();
    const { asset } = await ctx.newAsset({ ownerId: actors.carol.id, visibility: AssetVisibility.Timeline });
    await ctx.newSharedSpaceAsset({ spaceId: spaceS, assetId: asset.id, addedById: actors.carol.id });
    const [res] = await sut.addAssets(authOf('spaceEditor'), albumL, { ids: [asset.id] });
    expect(res.success).toBe(true);
    return asset.id;
  };

  it('owner-add of a contributed asset converts it: album_asset row present, contribution row gone, tombstone written', async () => {
    const assetId = await contributeFreshCarolAsset();
    const [res] = await sut.addAssets(authOf('carol'), albumL, { ids: [assetId] });
    expect(res).toEqual({ id: assetId, success: true });
    expect(await isAlbumAssetRow(assetId)).toBe(true);
    expect(await isContributionRow(assetId)).toBeUndefined();
    const tombstone = await db
      .selectFrom('album_space_asset_audit')
      .select('assetId')
      .where('albumId', '=', albumL)
      .where('assetId', '=', assetId)
      .executeTakeFirst();
    expect(tombstone).toBeDefined();
  });

  it('bulk path (addAssetsToAlbums) converts too', async () => {
    const assetId = await contributeFreshCarolAsset();
    const res = await sut.addAssetsToAlbums(authOf('carol'), { albumIds: [albumL], assetIds: [assetId] });
    expect(res.success).toBe(true);
    expect(await isAlbumAssetRow(assetId)).toBe(true);
    expect(await isContributionRow(assetId)).toBeUndefined();
  });

  it('re-contribution after conversion → DUPLICATE, no contribution row', async () => {
    const assetId = await contributeFreshCarolAsset();
    await sut.addAssets(authOf('carol'), albumL, { ids: [assetId] });
    const [res] = await sut.addAssets(authOf('spaceEditor'), albumL, { ids: [assetId] });
    expect(res).toEqual({ id: assetId, success: false, error: 'duplicate' });
    expect(await isContributionRow(assetId)).toBeUndefined();
  });
});
```

In the sync spec, append to the contributions describe:

```ts
it('P1-6 convergence: owner-add conversion delivers tombstone + album_asset upsert in one window', async () => {
  const { ctx, db, sut } = setup();
  const albumRepo = ctx.get(AlbumRepository);
  const { user: owner } = await ctx.newUser();
  const { user: member } = await ctx.newUser();
  const { user: carol } = await ctx.newUser();
  const { album } = await ctx.newAlbum({ ownerId: owner.id });
  const { asset } = await ctx.newAsset({ ownerId: carol.id });
  const { space } = await ctx.newSharedSpace({ createdById: owner.id });
  await ctx.newSharedSpaceMember({ spaceId: space.id, userId: member.id, role: SharedSpaceRole.Editor });
  await ctx.newSharedSpaceAlbum({ spaceId: space.id, albumId: album.id });
  await ctx.newAlbumSpaceAsset({ albumId: album.id, assetId: asset.id, spaceId: space.id });

  await albumRepo.addAssetIds(album.id, [asset.id]); // the owner-add conversion site

  const remaining = await db
    .selectFrom('album_space_asset')
    .select('assetId')
    .where('albumId', '=', album.id)
    .execute();
  expect(remaining).toHaveLength(0);
  const deletes = await drain(sut.getDeletes({ nowId: NOW_ID, userId: member.id }));
  expect(deletes.some((r) => r.albumId === album.id && r.assetId === asset.id)).toBe(true);
  const upserts = await drain(sut.getUpserts({ nowId: NOW_ID, userId: member.id }));
  expect(upserts.some((r) => r.albumId === album.id && r.assetId === asset.id)).toBe(true);

  // Post-conversion removal (P1-6 spec seed): the owner now removes the asset — devices must get
  // a NEW tombstone (album_asset_audit) beyond the conversion ones, and the edge must stop
  // upserting. (Convergence order is safe by construction: the server handler streams deletes
  // before upserts and the client applies batches sequentially.)
  const conversionTombstoneIds = deletes
    .filter((r) => r.albumId === album.id && r.assetId === asset.id)
    .map((r) => r.id);
  await albumRepo.removeAssetIds(album.id, [asset.id]); // adjust: the album_asset removal repo method
  const deletesAfter = await drain(sut.getDeletes({ nowId: NOW_ID, userId: member.id }));
  expect(
    deletesAfter.some(
      (r) => r.albumId === album.id && r.assetId === asset.id && !conversionTombstoneIds.includes(r.id),
    ),
  ).toBe(true);
  const upsertsAfter = await drain(sut.getUpserts({ nowId: NOW_ID, userId: member.id }));
  expect(upsertsAfter.some((r) => r.albumId === album.id && r.assetId === asset.id)).toBe(false);
});
```

(import `AlbumRepository` in the sync spec.)

- [ ] **Step 2: Run RED** — both files. Expected: conversion assertions FAIL (contribution row still present / no tombstone).

- [ ] **Step 3: Implement** in `album.repository.ts`. `addAssetIds` (keep/drop `@GenerateSql` per Global Constraints):

```ts
async addAssetIds(albumId: string, assetIds: string[]): Promise<void> {
  if (assetIds.length === 0) {
    return;
  }

  // #752 P1-6 coexistence invariant: an (albumId, assetId) pair lives in EXACTLY ONE of
  // album_asset / album_space_asset. An owner-add of a previously-contributed asset converts the
  // contribution atomically: the delete fires the audit trigger (device tombstone) while the
  // fresh album_asset row upserts — mobile converges to the owner edge in one sync window.
  await this.db.transaction().execute(async (trx) => {
    await trx
      .insertInto('album_asset')
      .expression((eb) =>
        eb.selectFrom(dummy).select([asUuid(albumId).as('albumId'), sql`unnest(${assetIds}::uuid[])`.as('assetId')]),
      )
      .onConflict((oc) => oc.doNothing())
      .execute();
    await trx
      .deleteFrom('album_space_asset')
      .where('album_space_asset.albumId', '=', albumId)
      .where('album_space_asset.assetId', 'in', assetIds)
      .execute();
  });
}
```

`addAssetIdsToAlbums`:

```ts
@Chunked({ chunkSize: 30_000 })
async addAssetIdsToAlbums(values: { albumId: string; assetId: string }[]): Promise<void> {
  if (values.length === 0) {
    return;
  }
  // #752 P1-6: same conversion as addAssetIds, per album in the batch (see comment there).
  const byAlbum = new Map<string, string[]>();
  for (const { albumId, assetId } of values) {
    const ids = byAlbum.get(albumId);
    if (ids) {
      ids.push(assetId);
    } else {
      byAlbum.set(albumId, [assetId]);
    }
  }
  await this.db.transaction().execute(async (trx) => {
    await trx
      .insertInto('album_asset')
      .values(values)
      // Allow idempotent album sync without failing on existing album memberships.
      .onConflict((oc) => oc.columns(['albumId', 'assetId']).doNothing())
      .execute();
    for (const [albumId, assetIds] of byAlbum) {
      await trx
        .deleteFrom('album_space_asset')
        .where('album_space_asset.albumId', '=', albumId)
        .where('album_space_asset.assetId', 'in', assetIds)
        .execute();
    }
  });
}
```

- [ ] **Step 4: Run GREEN** — both spec files + `pnpm test -- --run src/services/album.service.spec.ts` (unit). Also re-run Task 3's spec (the coexistence dedup tests describe the pre-conversion window and still pass — they seed rows directly).

- [ ] **Step 5: Commit**

```bash
git add server/src/repositories/album.repository.ts \
  server/test/medium/specs/services/album-space-asset-permissions.service.spec.ts \
  server/test/medium/specs/sync/shared-space-album-to-asset-sync.spec.ts
git commit -m "fix(albums): enforce album_asset/album_space_asset exclusivity on owner-add (#752)"
```

---

### Task 6: P1-7 — face pipeline: CTE arms, raw helper arm, link-time pager, per-contribution enqueue (D3)

**Behavior specs:**

1. Contributed-only asset with a named face in a `faceRecognitionEnabled` space → `getSharedSpaceFaceMatchBackfillTargets()` returns `(spaceId, assetId)` (RED: never selected).
2. `spaceAlbumAssetExistsSql` ≡ `spaceAlbumAssetExists` on fixtures that include contributions AND a contribution-only asset (extend the pinned equivalence spec — RED: raw arm misses them).
3. A successful contribution enqueues `SharedSpaceFaceMatch {spaceId, assetId}` iff the space has `faceRecognitionEnabled` (D3).
4. `getByAlbumIdWithFaces` (feeds `SharedSpaceAlbumFaceSync` on link/re-link) includes contributed assets **tethered to the syncing space** — D1-(b) consequence: re-link must re-project retained contributions' faces. The arm MUST be spaceId-correlated (2026-07-16 review): contributions are visible only through their tether space (`contributionVisibleToMember` correlates albumId+spaceId), so linking album L to a second space S2 must NOT page an S1-tethered contribution into S2's face sync. Positive + negative tests below. (Not swarm-flagged; reachable only because we chose retention.)

**Files:**

- Modify: `server/src/repositories/face-identity.repository.ts` (both CTEs), `server/src/utils/shared-space-album-scope.ts` (`spaceAlbumAssetExistsSql`), `server/src/repositories/asset.repository.ts` (`getByAlbumIdWithFaces` — new `spaceId` param), `server/src/services/album.service.ts` (`tryContributeDeniedAssets`), `server/src/services/shared-space.service.ts:2033` (`handleSharedSpaceAlbumFaceSync` — pass `spaceId` to the pager; unit-spec call assertions `shared-space.service.spec.ts:9444-9503` follow)
- Test: extend `server/test/medium/specs/utils/shared-space-album-scope-sql.medium.spec.ts`; new `server/test/medium/specs/repositories/face-backfill-contributions.medium.spec.ts`; extend `server/test/medium/specs/services/album-space-asset-permissions.service.spec.ts` (enqueue assertions)

- [ ] **Step 1: RED — equivalence spec.** In `shared-space-album-scope-sql.medium.spec.ts`, extend `seedCombos`:

```ts
// #752 P1-7: contributions — one co-resident with an album_asset album, one contribution-ONLY.
const { asset: viaContribution } = await ctx.newAsset({ ownerId: user.id });
const { asset: viaContributionOnly } = await ctx.newAsset({ ownerId: user.id });
await ctx.newAlbumSpaceAsset({ albumId: shown.id, assetId: viaContribution.id, spaceId: space.id });
await ctx.newAlbumSpaceAsset({ albumId: hidden.id, assetId: viaContributionOnly.id, spaceId: space.id });
// return them alongside the existing fields
return { space, viaShown, viaHidden, viaContribution, viaContributionOnly };
```

Extend the first test's assertions:

```ts
expect(kysely.has(viaContribution.id ?? viaContribution)).toBe(true);
expect(kysely.has(viaContributionOnly.id ?? viaContributionOnly)).toBe(true);
```

(match the destructuring style already used — `viaShown.id`), and in the timeline-variant tests assert `viaContributionOnly` (tethered to the `showInTimeline=false` album) is excluded when `requireShowInTimeline=true` and included when `false`. The `expect(raw).toEqual(kysely)` lines are the RED trigger.

- [ ] **Step 2: RED — projection-target + pager spec.** New `face-backfill-contributions.medium.spec.ts`:

```ts
// P1-7 (#752): faces on contributed-only assets must be selectable as projection targets and by
// the link-time face-sync pager. Face fixtures are seeded with direct inserts (no factory).
import { Kysely } from 'kysely';
import { AssetVisibility, SharedSpaceRole } from 'src/enum';
import { AssetRepository } from 'src/repositories/asset.repository';
import { FaceIdentityRepository } from 'src/repositories/face-identity.repository';
import { LoggingRepository } from 'src/repositories/logging.repository';
import { DB } from 'src/schema';
import { BaseService } from 'src/services/base.service';
import { newMediumService } from 'test/medium.factory';
import { getKyselyDB } from 'test/utils';

let db: Kysely<DB>;

const setup = () => {
  const { ctx } = newMediumService(BaseService, { database: db, real: [], mock: [LoggingRepository] });
  return { ctx };
};

beforeAll(async () => {
  db = await getKyselyDB();
});

const seedContributionWithFace = async (ctx: ReturnType<typeof setup>['ctx']) => {
  const { user: owner } = await ctx.newUser();
  const { user: carol } = await ctx.newUser();
  const { album } = await ctx.newAlbum({ ownerId: owner.id });
  const { asset } = await ctx.newAsset({ ownerId: carol.id, visibility: AssetVisibility.Timeline });
  const { space } = await ctx.newSharedSpace({ createdById: owner.id, faceRecognitionEnabled: true });
  await ctx.newSharedSpaceMember({ spaceId: space.id, userId: owner.id, role: SharedSpaceRole.Owner });
  await ctx.newSharedSpaceAlbum({ spaceId: space.id, albumId: album.id });
  await ctx.newAlbumSpaceAsset({ albumId: album.id, assetId: asset.id, spaceId: space.id });
  // named face + identity — the CTE requires asset_face.personId NOT NULL + face_identity_face
  const { person } = await ctx.newPerson({ ownerId: carol.id });
  const { assetFace } = await ctx.newAssetFace({ assetId: asset.id, personId: person.id });
  await ctx.newFaceIdentityFace({ assetFaceId: assetFace.id });
  return { owner, space, album, asset, assetFace };
};

describe('P1-7: contributed-only assets in the face pipeline', () => {
  it('getSharedSpaceFaceMatchBackfillTargets selects a contributed-only asset', async () => {
    const { ctx } = setup();
    const s = await seedContributionWithFace(ctx);
    const sut = ctx.get(FaceIdentityRepository);
    const targets = await sut.getSharedSpaceFaceMatchBackfillTargets();
    expect(targets.some((t) => t.spaceId === s.space.id && t.assetId === s.asset.id)).toBe(true);
  });

  it('getByAlbumIdWithFaces pages a contributed asset for its tether space (re-link face sync, D1-b)', async () => {
    const { ctx } = setup();
    const s = await seedContributionWithFace(ctx);
    const sut = ctx.get(AssetRepository);
    const rows = await sut.getByAlbumIdWithFaces(s.album.id, s.space.id);
    expect(rows.map((r) => r.id)).toContain(s.asset.id);
  });

  it('getByAlbumIdWithFaces does NOT page a contribution tethered to a different space', async () => {
    // Cross-space guard: linking the album to a second space must not project the S1-tethered
    // contribution's faces into S2 (mirrors contributionVisibleToMember's albumId+spaceId gate).
    const { ctx } = setup();
    const s = await seedContributionWithFace(ctx);
    const { space: other } = await ctx.newSharedSpace({ createdById: s.owner.id, faceRecognitionEnabled: true });
    await ctx.newSharedSpaceAlbum({ spaceId: other.id, albumId: s.album.id });
    const sut = ctx.get(AssetRepository);
    const rows = await sut.getByAlbumIdWithFaces(s.album.id, other.id);
    expect(rows.map((r) => r.id)).not.toContain(s.asset.id);
  });
});
```

Verified (2026-07-16 review): `newPerson`, `newAssetFace`, and `newSharedSpace({ faceRecognitionEnabled })` EXIST (the factory default is already `faceRecognitionEnabled: true`); `newFaceIdentityFace` does NOT — seed it with direct `db.insertInto('face_identity'|'face_identity_face')` minimal rows (copy required columns from `src/schema/tables/*.table.ts`). `getSharedSpaceFaceMatchBackfillTargets` takes an optional `{ limit?, assetFaceIds? }` input — the no-arg call is fine.

- [ ] **Step 3: RED — enqueue assertions (D3).** In `album-space-asset-permissions.service.spec.ts`, add the describe INSIDE the existing seeded describe (same describe-scoped-fixture rule as Task 5 Step 1 — `spaceS`/`actors`/`albumL`/`authOf` are not visible from a top-level describe; JobRepository is already mocked in `setup()`):

```ts
describe('FACE MATCH ENQUEUE (P1-7 / D3)', () => {
  it('a successful contribution enqueues SharedSpaceFaceMatch for its (spaceId, assetId) when the space has face recognition on', async () => {
    const { ctx: freshCtx, sut: freshSut } = setup();
    const jobMock = freshCtx.getMock(JobRepository);
    jobMock.queueAll.mockResolvedValue(void 0);
    await db.updateTable('shared_space').set({ faceRecognitionEnabled: true }).where('id', '=', spaceS).execute();
    const { asset } = await freshCtx.newAsset({ ownerId: actors.carol.id, visibility: AssetVisibility.Timeline });
    await freshCtx.newSharedSpaceAsset({ spaceId: spaceS, assetId: asset.id, addedById: actors.carol.id });

    const [res] = await freshSut.addAssets(authOf('spaceEditor'), albumL, { ids: [asset.id] });
    expect(res.success).toBe(true);
    expect(jobMock.queueAll).toHaveBeenCalledWith([
      { name: 'SharedSpaceFaceMatch', data: { spaceId: spaceS, assetId: asset.id } },
    ]);
  });

  it('no enqueue when face recognition is off', async () => {
    const { ctx: freshCtx, sut: freshSut } = setup();
    const jobMock = freshCtx.getMock(JobRepository);
    await db.updateTable('shared_space').set({ faceRecognitionEnabled: false }).where('id', '=', spaceS).execute();
    const { asset } = await freshCtx.newAsset({ ownerId: actors.carol.id, visibility: AssetVisibility.Timeline });
    await freshCtx.newSharedSpaceAsset({ spaceId: spaceS, assetId: asset.id, addedById: actors.carol.id });

    const [res] = await freshSut.addAssets(authOf('spaceEditor'), albumL, { ids: [asset.id] });
    expect(res.success).toBe(true);
    expect(jobMock.queueAll).not.toHaveBeenCalled();
  });
});
```

(Use `JobName.SharedSpaceFaceMatch` import instead of the string literal; reset `faceRecognitionEnabled` to its prior value afterwards if later tests depend on it.)

- [ ] **Step 4: Run all three RED** —

```bash
pnpm test:medium -- --run test/medium/specs/utils/shared-space-album-scope-sql.medium.spec.ts \
  test/medium/specs/repositories/face-backfill-contributions.medium.spec.ts \
  test/medium/specs/services/album-space-asset-permissions.service.spec.ts
```

- [ ] **Step 5: Implement — raw helper.** Replace `spaceAlbumAssetExistsSql`'s return with the two-arm OR (update its doc header: "emits BOTH arms, mirroring spaceAlbumAssetExists"):

```ts
return sql<SqlBool>`(EXISTS (
            SELECT 1
            FROM shared_space_album
            ${options.spaceScopeJoin}
            ${albumJoin}
            INNER JOIN album_asset ON album_asset."albumId" = shared_space_album."albumId"
            WHERE album_asset."assetId" = ${options.assetIdColumn}
            ${timelineGate}
          ) OR EXISTS (
            SELECT 1
            FROM shared_space_album
            ${options.spaceScopeJoin}
            ${albumJoin}
            INNER JOIN album_space_asset ON album_space_asset."albumId" = shared_space_album."albumId"
              AND album_space_asset."spaceId" = shared_space_album."spaceId"
            WHERE album_space_asset."assetId" = ${options.assetIdColumn}
            ${timelineGate}
          ))`;
```

The outer parentheses keep all six `OR ${...}` / negated consumers precedence-safe.

- [ ] **Step 6: Implement — CTE arms.** In `face-identity.repository.ts`, after the album_asset arm ending `:603` (CTE 1) add a 4th `UNION` arm — identical to the `:582-603` arm except the join line becomes:

```sql
INNER JOIN album_space_asset ON album_space_asset."albumId" = shared_space_album."albumId"
  AND album_space_asset."spaceId" = shared_space_album."spaceId"
INNER JOIN asset ON asset.id = album_space_asset."assetId"
```

(keep the full SELECT list, `shared_space`/`album` joins, all WHERE gates, and `${assetFaceFilter}`). Mirror for CTE 2 after `:734` — identical to the `:710-734` arm (2-column SELECT, `asset_face.id = ${anyUuid(...)}` filter, NOT EXISTS guard) with the same join swap. Add a one-line comment above each: `-- #752 P1-7: cross-owner contributions (spaceId-correlated, mirrors spaceContributedAssetExists)`.

- [ ] **Step 7: Implement — pager.** `getByAlbumIdWithFaces` in `asset.repository.ts`: replace the `album_asset` inner join with the same union-subquery idiom as Task 3's albumId arm. **The contributed arm is spaceId-correlated to the SYNCING space** (2026-07-16 review — an unconditional arm would page S1-tethered contributions into S2's link sync; contributions are visible only through their tether space):

```ts
@GenerateSql({ params: [DummyValue.UUID, DummyValue.UUID, 1000, 0] })
getByAlbumIdWithFaces(albumId: string, spaceId: string, limit = 1000, offset = 0) {
  return this.db
    .selectFrom('asset')
    .innerJoin(
      (eb) => {
        // #752 P1-7 / D1-b: link-time face sync must also page retained contributions on
        // re-link — album_asset alone would skip faces cleaned up while the album was unlinked.
        // The contributed arm is correlated to the syncing space: contributions are reachable
        // only through their tether space (mirrors contributionVisibleToMember's albumId+spaceId
        // gate), so an S2 link-sync never pages an S1-tethered contribution into S2's people.
        return eb
          .selectFrom('album_asset')
          .select('album_asset.assetId as assetId')
          .where('album_asset.albumId', '=', asUuid(albumId))
          .union(
            eb
              .selectFrom('album_space_asset')
              .select('album_space_asset.assetId as assetId')
              .where('album_space_asset.albumId', '=', asUuid(albumId))
              .where('album_space_asset.spaceId', '=', asUuid(spaceId)),
          )
          .as('album_members');
      },
      (join) => join.onRef('album_members.assetId', '=', 'asset.id'),
    )
    .innerJoin('asset_face', 'asset_face.assetId', 'asset.id')
    .select('asset.id')
    .where('asset.deletedAt', 'is', null)
    .where('asset.isOffline', '=', false)
    .groupBy('asset.id')
    .orderBy('asset.id')
    .limit(limit)
    .offset(offset)
    .execute();
}
```

Ripple: update the sole production caller `handleSharedSpaceAlbumFaceSync` (`shared-space.service.ts:2033`) to pass its job's `spaceId`, the unit-spec call assertions at `shared-space.service.spec.ts:9444-9503` (they pin `(albumId, 1000, 0)`-style args), and the repository mock signature if typed (`test/repositories/asset.repository.mock.ts:30`).

- [ ] **Step 8: Implement — enqueue (D3).** In `album.service.ts` `tryContributeDeniedAssets`, replace the tail:

```ts
if (toInsert.length > 0) {
  await this.albumRepository.addContributedAssets(toInsert);
  // D3 (#752 P1-7): a contribution's faces must reach space People without waiting for a coarse
  // reconcile trigger — enqueue the targeted per-asset match, mirroring the space-pool add path
  // (SharedSpaceService.addAssets). The handler re-guards on space + faceRecognitionEnabled.
  const spaceIds = [...new Set(toInsert.map(({ spaceId }) => spaceId))];
  const spaces = await Promise.all(spaceIds.map((spaceId) => this.sharedSpaceRepository.getById(spaceId)));
  const faceEnabled = new Set(spaces.filter((space) => space?.faceRecognitionEnabled).map((space) => space!.id));
  const jobs = toInsert
    .filter(({ spaceId }) => faceEnabled.has(spaceId))
    .map(({ spaceId, assetId }) => ({ name: JobName.SharedSpaceFaceMatch as const, data: { spaceId, assetId } }));
  if (jobs.length > 0) {
    await this.jobRepository.queueAll(jobs);
  }
}
```

(import `JobName` from `src/enum` if absent.) Handler chain VERIFIED (2026-07-16 review — no change needed): `handleSharedSpaceFaceMatch` re-guards on `faceRecognitionEnabled`, and `processSpaceFaceMatch` guards via `SharedSpaceRepository.isAssetInSpace`, whose four-arm union already includes the spaceId-correlated contribution arm (`shared-space.repository.ts:3068-3130`) — a contributed-only asset is NOT skipped.

- [ ] **Step 9: Run GREEN** — the three files from Step 4, plus `pnpm test -- --run src/services/album.service.spec.ts` (unit: auto-mocks return undefined for `getById` → no enqueue → existing tests unaffected; extend mocks only if a test pins `queueAll`).

- [ ] **Step 10: Commit**

```bash
git add server/src/repositories/face-identity.repository.ts server/src/utils/shared-space-album-scope.ts \
  server/src/repositories/asset.repository.ts server/src/services/album.service.ts \
  server/test/medium/specs/utils/shared-space-album-scope-sql.medium.spec.ts \
  server/test/medium/specs/repositories/face-backfill-contributions.medium.spec.ts \
  server/test/medium/specs/services/album-space-asset-permissions.service.spec.ts
git commit -m "fix(spaces): include contributions in face projection and scope SQL; enqueue face match per contribution (#752)"
```

---

### Task 7: P2 batch — pin trash gates (P2-8), departure retention (P2-10), PATCH persistence (P2-11)

These are expected-GREEN pins (product code unchanged). If any fails, STOP — that's a real bug; reassess before "fixing" the test.

- [ ] **Step 1: P2-8** — extend `sync-space-backfill-trash.medium.spec.ts` with a contributed seed helper and five cases:

```ts
const seedContributionInSpace = async (ctx: SyncTestContext) => {
  const { user: owner } = await ctx.newUser();
  const { user: member } = await ctx.newUser();
  const { user: carol } = await ctx.newUser();
  const { album } = await ctx.newAlbum({ ownerId: owner.id });
  const { asset: live } = await ctx.newAsset({ ownerId: carol.id });
  const { asset: trashed } = await ctx.newAsset({ ownerId: carol.id });
  await ctx.newExif({ assetId: live.id, make: 'LiveCamera' });
  await ctx.newExif({ assetId: trashed.id, make: 'TrashedCamera' });
  const { space } = await ctx.newSharedSpace({ createdById: owner.id });
  await ctx.newSharedSpaceMember({ spaceId: space.id, userId: member.id, role: SharedSpaceRole.Editor });
  await ctx.newSharedSpaceAlbum({ spaceId: space.id, albumId: album.id });
  await ctx.newAlbumSpaceAsset({ albumId: album.id, assetId: live.id, spaceId: space.id });
  await ctx.newAlbumSpaceAsset({ albumId: album.id, assetId: trashed.id, spaceId: space.id });
  await trash(defaultDatabase, trashed.id);
  return { owner, member, album, live, trashed };
};

describe('M-2 (P2-8): contributed arms — backfill/creates exclude trashed; updates still deliver', () => {
  it('ToAsset.getBackfill excludes a trashed contribution (live sibling present)', async () => {
    const ctx = setup();
    const sut = ctx.get(SyncRepository).sharedSpaceAlbumToAsset;
    const { member, album, live, trashed } = await seedContributionInSpace(ctx);
    const rows = await collect(
      sut.getBackfill({ nowId: NOW_ID, beforeUpdateId: BEFORE_UPDATE_ID }, album.id, member.id),
    );
    const ids = rows.map((r) => r.assetId);
    expect(ids).toContain(live.id);
    expect(ids).not.toContain(trashed.id);
  });

  it('ToAsset.getBackfill album_asset arm also gates trash (line :1690 pin)', async () => {
    const ctx = setup();
    const sut = ctx.get(SyncRepository).sharedSpaceAlbumToAsset;
    const { user: owner } = await ctx.newUser();
    const { album } = await ctx.newAlbum({ ownerId: owner.id });
    const { asset: live } = await ctx.newAsset({ ownerId: owner.id });
    const { asset: trashed } = await ctx.newAsset({ ownerId: owner.id });
    await ctx.newAlbumAsset({ albumId: album.id, assetId: live.id });
    await ctx.newAlbumAsset({ albumId: album.id, assetId: trashed.id });
    await trash(defaultDatabase, trashed.id);
    const rows = await collect(
      sut.getBackfill({ nowId: NOW_ID, beforeUpdateId: BEFORE_UPDATE_ID }, album.id, owner.id),
    );
    expect(rows.map((r) => r.assetId)).not.toContain(trashed.id);
  });

  it('Asset content sync (getBackfill + getCreates) excludes the trashed contributed asset', async () => {
    const ctx = setup();
    const sut = ctx.get(SyncRepository).sharedSpaceAlbumAsset;
    const { member, album, live, trashed } = await seedContributionInSpace(ctx);
    const backfill = await collect(
      sut.getBackfill({ nowId: NOW_ID, beforeUpdateId: BEFORE_UPDATE_ID }, album.id, member.id),
    );
    expect(backfill.map((r) => r.id)).toContain(live.id);
    expect(backfill.map((r) => r.id)).not.toContain(trashed.id);
    const creates = await collect(sut.getCreates({ nowId: NOW_ID, userId: member.id }));
    expect(creates.map((r) => r.id)).toContain(live.id);
    expect(creates.map((r) => r.id)).not.toContain(trashed.id);
  });

  it('Exif sync getBackfill excludes the trashed contribution’s EXIF', async () => {
    const ctx = setup();
    const sut = ctx.get(SyncRepository).sharedSpaceAlbumAssetExif;
    const { member, album, live, trashed } = await seedContributionInSpace(ctx);
    const rows = await collect(
      sut.getBackfill({ nowId: NOW_ID, beforeUpdateId: BEFORE_UPDATE_ID }, album.id, member.id),
    );
    expect(rows.map((r) => r.assetId)).toContain(live.id);
    expect(rows.map((r) => r.assetId)).not.toContain(trashed.id);
  });

  it('Asset content getUpdates STILL delivers the trashed contribution (purge convergence)', async () => {
    const ctx = setup();
    const sut = ctx.get(SyncRepository).sharedSpaceAlbumAsset;
    const { member, trashed } = await seedContributionInSpace(ctx);
    const rows = await collect(
      sut.getUpdates(
        { nowId: NOW_ID, userId: member.id },
        { type: SyncEntityType.AlbumToAssetV1, updateId: BEFORE_UPDATE_ID },
      ),
    );
    expect(rows.map((r) => r.id)).toContain(trashed.id);
  });
});
```

(Verified 2026-07-16: the existing getUpdates test passes `SyncEntityType.AlbumToAssetV1` (`:97`) — as written above; `setup()` in this file returns a `SyncTestContext` directly — `const ctx = setup()` as written; check `trash`'s arity before calling — it may close over `defaultDatabase` and take only the assetId.) Run: `pnpm test:medium -- --run test/medium/specs/sync/sync-space-backfill-trash.medium.spec.ts` → all PASS.

- [ ] **Step 2: P2-10** — in `album-space-asset-permissions.service.spec.ts` READ+lifecycle describe, after the UNLINK NEGATIVE:

```ts
it('DEPARTURE RETENTION (pins D2 status quo): contributed-asset owner leaves — remaining members still see it', async () => {
  // carol owns assetCarol and contributed nothing herself; the pinned semantic is that HER
  // departure does not revoke the contribution (mirrors shared_space_asset pool retention).
  // Flipping this assertion is the one-line signal if D2 ever decides departure should revoke.
  await spaceRepo.removeMember(spaceS, actors.carol.id);
  try {
    expect(await seesContribution(actors.spaceEditor.id, assetCarol)).toBe(true);
    expect(await seesContribution(actors.spaceViewer.id, assetCarol)).toBe(true);
  } finally {
    await db
      .insertInto('shared_space_member')
      .values({ spaceId: spaceS, userId: actors.carol.id, role: 'editor' })
      .onConflict((oc) => oc.doNothing())
      .execute();
  }
});
```

- [ ] **Step 3: P2-11 (verify, then fix)** — confirmed unverified→real: the three positive PATCH tests (`e2e/src/specs/server/api/shared-space-album.e2e-spec.ts:185-198`) assert only 204. Extend each with GET-after-PATCH:

```ts
it('space editor → 204 (toggle showInTimeline=false) and the value persists', async () => {
  const { status } = await updateAlbum(editor.accessToken, ownerAlbum.id, false);
  expect(status).toBe(204);
  const { body } = await listAlbums(editor.accessToken);
  expect(
    (body as Array<{ id: string; showInTimeline: boolean }>).find((a) => a.id === ownerAlbum.id)?.showInTimeline,
  ).toBe(false);
});
```

(same pattern for the `true` toggle and the owner toggle — assert the persisted boolean each time). Run against the local e2e stack: `cd e2e && pnpm test -- --run src/specs/server/api/shared-space-album.e2e-spec.ts`.

- [ ] **Step 4: Commit**

```bash
git add server/test/medium/specs/sync/sync-space-backfill-trash.medium.spec.ts \
  server/test/medium/specs/services/album-space-asset-permissions.service.spec.ts \
  e2e/src/specs/server/api/shared-space-album.e2e-spec.ts
git commit -m "test(spaces): pin contribution trash gates, departure retention, showInTimeline persistence (#752)"
```

---

### Task 8: Final gate — full verify + CI

- [ ] **Step 1: Full local server gate** (from `server/`):

```bash
pnpm test                       # unit
pnpm test:medium                # full medium suite (DB via docker)
npx tsc --noEmit -p .           # or: make check-server from repo root
npx eslint "src/**/*.ts" "test/**/*.ts" --max-warnings 0
npx prettier --check $(git diff --name-only origin/main...HEAD -- 'server/**/*.ts' | tr '\n' ' ')
```

Known flake triage: `sync-album-user.spec` "sync a new shared user" ordering flake is pre-existing (memory) — verify on main before blaming this branch; NO other flake allowance.

- [ ] **Step 2: Scope guard** — `pnpm test -- --run src/utils/shared-space-album-scope.guard.spec.ts`; register any new raw `album_space_asset` sites it flags in its allowlists (`SPACE_HELPER` / `NON_DECL` / `VIS_ALLOWLIST`) with a comment referencing this plan.

- [ ] **Step 3: e2e API suite** (stack up detached): `cd e2e && pnpm test -- --run src/specs/server/api/shared-space-album.e2e-spec.ts src/specs/server/api/album.e2e-spec.ts`.

- [ ] **Step 4: Docs prettier** — `npx prettier --write docs/plans/2026-07-16-space-albums-contribution-read-side-plan.md docs/plans/2026-07-16-space-albums-contribution-read-side-spec.md` and commit if changed (fold into Task 7's commit via amend is NOT allowed after push — separate `docs:` commit is fine).

- [ ] **Step 5: Push + CI dispatch**:

```bash
git push origin rebase/space-albums-onto-main-v303
gh workflow run test.yml --ref rebase/space-albums-onto-main-v303
```

Then poll `gh run list --branch rebase/space-albums-onto-main-v303` and **inspect jobs** (`gh run view <id> --json jobs`) — a "success" conclusion can hide failed jobs. If "SQL Schema Checks" fails: download its diff, `git apply` (strip timestamp prefixes), commit `chore: regen sql docs`, re-push, re-dispatch.

---

### Task 9: D1-b residue — live-link gate on `inAlbums`' contributed arm (post-review amendment)

**Decision (Pierre, 2026-07-16, after the final whole-branch review):** fix the `inAlbums` search residue now; the other deferred finding (unlink leaves contributed-only face projections in space People until a coarse reconcile — pre-existing candidate-set gap in `getAlbumAssetIdsWithoutOtherSpacePath`) is **accepted as-is, no fix, no tracking issue**.

**Behavior specs (BDD):**

1. Given member M of space S, album L linked to S, contribution X (owned by carol) tethered to S; When a search-side query using `inAlbums` filters on [L] for M; Then X matches (existing behavior — keep green).
2. When L is unlinked from S (retained rows, D1-b); Then X NO LONGER matches for M — RED today: the contributed arm gates on `timelineSpaceIds` membership but not on a live `shared_space_album` link, producing "listed in search but 403 on thumbnail" after P1-4.
3. Re-link → X matches again (D1-b reversibility).
4. The `album_asset` arm is untouched: owner/album-shared rows match by album-access rules regardless of space links.

**Files:**

- Modify: `server/src/utils/database.ts` (`inAlbums` contributed arm, ~`:466-503`) — add the live `shared_space_album` correlation on BOTH albumId AND spaceId to the `album_space_asset` join, mirroring `contributionVisibleToMember` / `spaceContributedAssetExists`.
- Test: extend whichever medium spec already pins `inAlbums`' contributed arm (grep `inAlbums` consumers and `album_space_asset` under `test/medium`); if none pins the unlink case, add a focused describe to the search repository medium spec. TDD: BDD-2 is the RED driver; BDD-1/3/4 pin.

**Constraints:** all Global Constraints apply (tsc/eslint/prettier; scope-guard allowlists if flagged; no `make sql` locally — if the arm is inside a `@GenerateSql` consumer the CI regen handles the doc). One commit: `fix(search): gate contributed album search matches on a live album-space link (#752)`.

---

## Self-review notes (spec coverage)

- P0-1 → Task 2 (D1-b); P0-2 → Task 3; P0-3 → Task 1; P1-4 → Task 4; P1-5 → Task 3 (same commit as P0-2 ✓); P1-6 → Task 5; P1-7 (3 parts + D3) → Task 6; P2-8/9/10/11 → Tasks 7 / 2 / 7 / 7. ✓
- Spec §3 intentional behaviors: untouched; P2-10 pins departure retention. ✓
- D1-(b) residue flagged for Pierre, NOT implemented (out of scope): `inAlbums` (search) gates contributions on `timelineSpaceIds` membership but not on a live album↔space link — a live member searching an UNLINKED album (owner-only reachable) can still match a retained contribution. Cosmetic inconsistency, no cross-audience leak (viewer must be a live tether-space member). Decide separately.
- Type consistency: `albumSpaceIds?: string[]` (Task 3 Steps 4–5), `getMetadataForIds(ids, {forUserId})` (Task 3 Steps 6–7), `getMemberSpaceIdsLinkingAlbum(albumId, userId)` (Task 3 Steps 3/5), `tombstoneContributionsForUnlink(db, spaceId, albumIds)` (Task 2 only), `getByAlbumIdWithFaces(albumId, spaceId, limit, offset)` (Task 6 Steps 2/7 + caller ripple). ✓

## Review amendments (2026-07-16, post-verification review)

Folded in after a 4-agent code-verification review of this plan (each claim below was checked against the actual worktree code):

- **Nesting (Tasks 5/6):** the permissions spec's fixture is describe-scoped; new describes must nest inside the seeded describe — a per-test `setup()` does NOT re-seed.
- **Task 5:** corrected `addAssetsToAlbums` framing (own per-album `getAssetIds` precheck — itself album_asset-only; no `tryContributeDeniedAssets`; denied assets silently dropped); added the post-conversion owner-removal coverage (spec seed); mobile convergence is guaranteed by server deletes-before-upserts emission order (`sync.service.ts:1102-1162`) + strictly sequential client batch application — no mobile-side test needed.
- **Task 6:** `getByAlbumIdWithFaces` now takes the syncing `spaceId` and correlates the contributed arm — an S2 link-sync must not page S1-tethered contributions (negative test added); handler-chain question resolved: `isAssetInSpace` is already a four-arm union including the spaceId-correlated contribution arm.
- **Task 2:** single-space unlink pin added (whole-album drop delivers; edge tombstone correctly withheld once the album leaves `accessibleSpaceAlbums`); BDD-4's "already covered" corrected — only LinkDeleteV1 + trigger-level revocation were pinned. (Spec P2-9's blanket "no spec deletes a `shared_space_album` row at all" is inaccurate; several do, none pin unlink device convergence.)
- **Task 3:** added covers pin, stacked-contribution arm-parity pin, and `lastModifiedAssetTimestamp` widening assert (all spec P0-2/P1-5 seeds); `ctx.newSharedLink` does not exist → `SharedLinkRepository.create` (timeline.service.spec.ts:414-436 idiom); the albumId arm's stale "inline copy" comment sentence gets deleted with the arm edit.
- **Task 4:** file idiom is `{ ctx, accessRepo }` + `defaultDatabase`; anchors corrected to `:272-344` / `:346-421`; the assetIds or-where lives inside each union arm (the proposed arm already matches).
- **Verified clean during review (do not re-verify):** `album_space_asset_audit` insert shape valid (defaults on `id`/`deletedAt`, no FKs); `addAlbum` already `onConflict doNothing` + `returningAll().executeTakeFirst()` (the rewrite only adds the transaction + touch; `linkAlbum` gates side effects on the returned row); both visibility gates admit exactly {Archive, Timeline} — the Σ-counts invariant is sound; all three time-bucket methods consume `withTimeBucketAssetFilters`, no inline copies; raw `sql` fragments are safe to interpolate twice; grants (`shared_space_album_user`) are trigger-created on link insert; `getUpserts`' contributed arm requires the live (albumId, spaceId) link — retained rows are inert while unlinked, exactly as D1-(b) assumes.
