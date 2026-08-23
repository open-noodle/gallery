# Space Albums (PR #752) — Verified Findings & Remediation Spec

**Date:** 2026-07-16
**Branch:** `rebase/space-albums-onto-main-v303` (= PR #752 `space-albums-onto-main`)
**Worktree:** `/Users/pierre/dev/gallery/.claude/worktrees/space-albums-rebase-v303`
**Commit lineage:** rebase squash `82dd112b61` → audit fixes `fdd8705832` (B1/S1/S6/S5/S7 done, CI green)
**Provenance:** 18-agent verification swarm (run `wf_139f336e-1f7`, 2026-07-16): 6 dimension finders (RBAC, data integrity, sync, rebase consistency, test coverage, functional wiring) → dedupe → exactly one adversarial verifier per finding. 11 findings confirmed (1 high / 6 medium / 4 low), 1 refuted, 1 unverified (dropped at the 12-finding verification cap). Every file:line below was re-verified against this branch's code, not carried over from the earlier 57-agent audit.

---

## 1. Background

`album_space_asset` is the **cross-owner contribution** edge: a space member (editor) "bookmarks" an asset they own into an album someone else owns that is linked to a shared space. It deliberately does NOT create an `album_asset` row (which would expose the asset to the album's non-space audience). Commit `fdd8705832` fixed the **write/retention** side (B1: face-retention helpers, space-level counts, reconcile pager, remove-from-space stack bug S5, dead-code S7).

**What this spec covers:** the swarm confirmed the **read side** is still missing the `album_space_asset` union in several consumers, plus one revocation/sync gap and one unenforced invariant. The recurring root cause: hand-rolled joins on `album_asset` where the semantic meaning is "asset is content of this album" — the codebase already has two-arm helpers (`spaceAlbumAssetExists`, `spaceContributedAssetExists` in `server/src/utils/shared-space-album-scope.ts`) that most fixes should route through.

**Security posture: clean.** No RBAC leaks were found. Every confirmed gap fails **closed** (denies/hides too much, never exposes). The urgency is correctness and UX, not security.

---

## 2. Verified CLEAN — do not re-audit

The swarm explicitly checked and cleared these; a future session should not re-derive them:

- **RBAC:** viewer write-gating (all mutating grants filter Owner/Editor); cross-space confinement (all grants + sync arms correlate `spaceId`, incl. `contributionVisibleToMember`); non-member reachability (member-scoped arms everywhere; shared-link auth excluded from space widening); link/unlink authz (Editor + `AlbumUpdate`; owner-revoke + link-existence guard); activity/PII redaction; contribution-creation gate (Editor + live space path + visibility + not-own-asset).
- **Sync arms:** all 8 contributed sync arms (upserts/creates/updates/backfills across `SharedSpaceAlbumToAsset`/`Asset`/`AssetExif`) carry the `spaceId` correlation; Locked/Hidden strip clears `album_space_asset` (`removeAssetsFromAll`, `album.repository.ts:380-386`); mobile dispatch/reset/pruneAssets consume all new sync types without dropping fields.
- **Rebase consistency:** no #782 stack regressions (`withStacked` prop survives; `expandStackAssetIds` retained with the S5 direct-member bound); cherry-picks `93ac079197` (#786) and `97a3cec731` (#785) are genuinely **not** on main (`git cherry` marks all 4 branch commits `+`; main's "#785" grep hit is upstream Immich's PR 785); 12 `migrations-gallery` files collision-free; `album_space_asset`(+audit) registered in `server/src/schema/index.ts:129-130,257-258`; S7 dead code fully removed; OpenAPI spec + TS SDK (now `packages/sdk/src/fetch-client.ts`) + Dart client all regenerated and matching the 4 new controller routes.
- **Functional wiring:** web link/create/unlink/toggle-timeline modal→SDK→controller→service→repo chains correct; all 223 `$t()` keys in changed web files exist in `i18n/en.json`; space album detail load + thumbnails work for non-owner members (`checkSpaceLinkedAlbumReadAccess`); mobile `>5.0.0` sync gate is deliberate, with the `fork_version` RC override on `gallery-rc-build.yml` for RC testing.
- **Coverage (broad matrix):** link/unlink/PATCH/list RBAC matrix, contribute own-vs-other's asset incl. hidden/not-in-space/unlinked-album denials, remove-contribution actor matrix, unlink-with-contributions retention + re-link, two-spaces-same-user leak negatives, stacks-in-space-album expansion, album trash/restore sync lifecycle. (Specific gaps listed in P2 below.)

## 3. Intentional behavior — do NOT "fix"

- **Refuted finding:** "removing an asset from the space pool (or unlinking a library) leaves its `album_space_asset` contribution visible." This is deliberate multi-path design: a linked-album membership is a first-class live path into the space, identical to the accepted `album_asset` semantics. The service comment at `shared-space.service.ts:944-946` models it explicitly; the pool-remover (an Editor) holds `AlbumAssetDelete` on the linked album and can remove the contribution there; the asset owner's own levers (Hidden/Locked/delete) DO purge contributions and tombstone sync.
- **Owner-departure contribution retention** (a departed member's contributed photo stays visible to remaining members) mirrors the pre-existing `shared_space_asset` pool semantic. Treated as retention-by-design — but it is **unpinned by any test**; see P2-10. If product ever decides departure should revoke, that's design decision D2.

---

## 4. Prioritized findings

Severity legend: what breaks, for whom, how visibly. P0 = fix before merging PR #752. P1 = the read-side consistency sweep (one thematic change-set, same shape as `fdd8705832`). P2 = test-only. Confidence is the adversarial verifier's rating.

### P0-1 · HIGH — Unlinking an album (or member-owned-links cleanup) never revokes synced contributions

**Files:** `server/src/services/shared-space.service.ts:767-806` (`unlinkAlbum`), `server/src/repositories/shared-space.repository.ts:746-752` (`removeAlbum`), `:770-789` (`removeOwnedAlbumLinksAddedBy`), migration `1783000000000` (FKs), migration `1783100000000:56-60` (audit trigger), `server/src/repositories/sync.repository.ts:1715-1757` (`SharedSpaceAlbumToAssetSync.getDeletes`). Confidence: high.

**Why it's an issue:** `unlinkAlbum` deletes only the `shared_space_album` link row. `album_space_asset` rows survive by design (FKs are album/asset/space/user — not the link row), so nothing cascades. The ONLY tombstone producer is the `AFTER DELETE` trigger **on `album_space_asset`**, which never fires; `getDeletes` unions only the three audit tables, none of which gets a row. Result: a device that synced the contribution before the unlink keeps the cross-owner edge — and, via the sibling asset/EXIF arms, the photo and its metadata — **forever**, whenever the album stays accessible through a second co-linked space (`accessibleSpaceAlbums` keeps matching, so the album itself is never dropped either). Web hides the contribution immediately (live-link inner join in `spaceContributedAssetExists`, `shared-space-album-scope.ts:196-203`) → permanent web/mobile divergence with unrevoked cross-owner content on member devices. `removeOwnedAlbumLinksAddedBy` (member departure removing their own album links) has the identical gap. The single-space common case self-heals only because the grant tombstone drops the whole album.

**Fix direction (needs design decision D1 first):** the tension is that server-side retention of `album_space_asset` across unlink is intentional ("reversible on re-link", pinned at `album-space-asset-permissions.service.spec.ts:272`). Options:

- **(a) Delete contributions on unlink** — `deleteFrom('album_space_asset').where(spaceId).where(albumId)` inside `unlinkAlbum` (and per-album after `removeOwnedAlbumLinksAddedBy`); the existing trigger then writes the audit rows and the existing `contributedAuditArm` of `getDeletes` delivers device tombstones. Simple, but **breaks re-link reversibility**.
- **(b) Retain rows, emit synthetic tombstones** — keep the rows, insert `album_space_asset_audit` rows (or equivalent) at unlink time so devices purge; on re-link, the backfill arms re-deliver. Preserves both semantics; must verify backfill actually re-delivers after re-link (backfill keys on the re-appearing album visibility).
- An `AFTER DELETE` trigger on `shared_space_album` is a variant of (a) that covers all link-removal paths at once.

**Test seeds (BDD to flesh out):**

- Given album L linked to spaces S1+S2, member M in both, M synced+acked a contribution in L; When owner unlinks L from S1; Then M receives `SharedSpaceAlbumToAssetDeleteV1` for (L, asset) (plus asset/EXIF revocation if L is otherwise unreachable) — currently no test drives `unlinkAlbum` against a live contribution at all.
- Member-leave twin: M leaves S1 while keeping album access via S2.
- Re-link semantics per D1 decision: contributions reappear (b) or do not (a) — server AND device state.
- Single-space unlink: whole album dropped via grant tombstone (already covered — keep green).

### P0-2 · MEDIUM (flagship UX) — Contributed assets never render in the album they were contributed to

**Files:** `server/src/repositories/asset.repository.ts:317-332` (`withTimeBucketAssetFilters` albumId arm — shared by `getTimeBuckets`/`getTimeBucket`/`getTimeBucketCovers`), `server/src/services/timeline.service.ts` (`timeBucketChecks` adds no compensation), consumers `web/src/routes/(user)/albums/[albumId=id]/.../+page.svelte:354` and `web/src/routes/(user)/spaces/[spaceId]/albums/[albumId=id]/.../+page.svelte:103`. Confidence: high.

**Why it's an issue:** the albumId time-bucket arm joins only `album_asset`; `album_space_asset` appears nowhere in `asset.repository.ts`. A successful contribution (`album.service.ts:247-339` `addAssets` → `tryContributeDeniedAssets`, reachable via the ordinary add-to-album flow) is therefore invisible on `/albums/[id]` **and** on the space album page — for the contributor, the album owner, and every member — while the same asset shows in the space timeline, increments `contributorCounts`, and syncs to mobile (which renders it). Design intent is unambiguous (`utils/database.ts` `inAlbums` unions the arm with a "#764 count as album membership too" comment; design doc `2026-07-10-space-album-cross-owner-contributions-design.md` §5.2). The feature's core demo — "member adds a photo, everyone sees it in the album" — fails silently.

**Fix direction:** add a **member-gated** contributed arm to `withTimeBucketAssetFilters` (and keep `getTimeBucket`'s inline gates in sync): `album_asset` ∪ `album_space_asset` correlated to the album's `shared_space_album` link AND gated on the viewer's live member spaces. Resolve `timelineSpaceIds` in `timeline.service` when `dto.albumId` is set and thread through `TimeBucketOptions`. **A blind union is a security regression**: it would leak cross-owner assets to non-space-member album viewers (`album_user` shares, shared links). Preserve the existing visibility/`deletedAt` gates on the unioned arm. **Must land in the same change as P1-5** so grid and count cannot desync.

**Test seeds:**

- Contributor / album owner / other space member each see the contribution in the album grid, covers, and bucket counts (web route + raw time-bucket endpoints).
- `album_user` (non-space) shared viewer does NOT see it; shared-link viewer does NOT; album owner who has LEFT the space does NOT (membership gate, not just link gate).
- Contribution + stacked assets; contribution trashed (must vanish from buckets); Hidden/Locked visibility gates on the contributed arm.
- Count returned by P1-5 equals number of assets the same viewer's grid renders, for every viewer class above.

### P0-3 · LOW (hygiene, trivial) — Scratch audit documents committed at the repo root

**Files:** `SPACE-ALBUMS-RBAC-REMEDIATION-SPEC-2026-07-11.md`, `SPACE-ALBUMS-RBAC-REVIEW-2026-07-11.md`, `SPACE-ALBUMS-REMEDIATION-REVIEW-2026-07-08.md` (1131 lines, committed by the feat squash `82dd112b61`, absent from main). Confidence: high.

**Why it's an issue:** merging PR #752 as-is lands internal security-review working notes (referencing dead pre-rebase HEAD `b1e9f4628e`) on the public fork's main. No runtime or CI impact. **Fix:** `git rm` the three files in a fixup commit (or move to `docs/plans/` + prettier if worth keeping).

### P1-4 · MEDIUM — `checkSpaceAccess` lacks the contributed arm → contributed-only assets 403 on thumbnail/original/download

**Files:** `server/src/repositories/access.repository.ts:317` (`checkSpaceAccess`), `:393` (`checkSpaceAccessForSpace`); fall-through chain `server/src/utils/access.ts:116-153`. Confidence: high.

**Why it's an issue:** both AssetAccess space unions join only `album_asset` for the linked-album arm; `album_space_asset` appears nowhere in the file. The divergent state — contribution as the asset's **only** space path — is reachable because eligibility is checked only at creation time (`getContributableAssetSpaces`) and `SharedSpaceService.removeAssets` deletes only `shared_space_asset` rows. After that, every member except the asset's owner sees the asset listed in timeline/linked album/search/sync (`spaceContributedAssetExists`, `inAlbums`) but `AssetRead`/`AssetView`/`AssetDownload` fall through owner→album→partner→`checkSpaceAccess` and **403** on thumbnail/original/download. Fails closed — broken images, not a leak.

**Fix direction:** add a fourth union arm mirroring the album arm but joining `album_space_asset` with the `spaceId`-correlated join used by `spaceContributedAssetExists` (plus the `spaceId` filter in the `-ForSpace` variant) — or route the album leg through `spaceAlbumAssetExists` so both arms stay in lockstep permanently.

**Test seeds:** member fetches thumbnail/original/download of a contributed-only asset (currently 403 → must become 200); asset owner still OK via ownership; non-member still 403; after unlink (per D1 semantics) access is revoked; `-ForSpace` variant scoped to the right space (member of S1 can't use S2's link).

### P1-5 · MEDIUM — Album metadata (count/date-range) excludes contributions; web disagrees with mobile

**Files:** `server/src/repositories/album.repository.ts:162-184` (`getMetadataForIds`), same-pattern subqueries in `getOwnedNames`/`getSharedNames` (`:243`, `:317`); consumers `shared-space.service.ts:824` (`getLinkedAlbums` → `space-album-card.svelte:64`, `space-albums-table.svelte:49`) and `album.service.ts:76/:97`. Confidence: medium (mechanism corrected by verifier).

**Why it's an issue:** aggregates run on `album_asset` only. Mobile counts synced membership locally (`space_album.repository.dart:24-53`) over both arms → **mobile shows N+k while web shows N** for the same album. Design doc §5.2 and Slice-2 acceptance explicitly require the union. Subtlety the verifier flagged: today the web card count _agrees with the web grid_ (both single-arm) — patching `getMetadataForIds` alone would **create** a count-vs-grid mismatch and would over-count for viewers without live tether-space membership (`getMetadataForIds` has no viewer context). Hence: land with P0-2, member-gated.

**Fix direction:** for `getLinkedAlbums` (viewer is a live member by construction): aggregate over `album_asset ∪ (album_space_asset WHERE spaceId = :spaceId)` deduped by assetId — a space-scoped metadata variant or optional `spaceId` param. Leave `album.service.get/getAll` owner-scoped, or gate the contributed arm on the caller's live membership in the tether space.

**Test seeds:** linked-album card count/date-range includes a contribution for a member; excludes it for the album owner who left the space; dedup when (albumId, assetId) exists in both tables (see P1-6 window); `startDate`/`endDate`/`lastModifiedAssetTimestamp` widen correctly when the contribution is the extremum.

### P1-6 · MEDIUM — Coexistence invariant unenforced: `album_asset` + `album_space_asset` can both hold the same (albumId, assetId), then a single tombstone kills the mobile edge

**Files:** `server/src/services/album.service.ts:313-337` (contribution insert), `:366` (`addAssetsToAlbums`), `server/src/utils/asset.util.ts:39-53` (DUPLICATE precheck), `server/src/repositories/album.repository.ts:410-422` (`getAssetIds` reads only `album_asset`), `sync.repository.ts:1746-1748` (comment ASSUMING the invariant), mobile PK `shared_space_album_asset.entity.dart:20`, delete handler `sync_stream.repository.dart:1017-1024`. Confidence: high.

**Why it's an issue:** the reachable ordering is contribution-first: editor E contributes owner W's space-visible asset X (row in `album_space_asset`), then W adds X normally — the owner-add path checks only `album_asset` for duplicates, no DB constraint/trigger enforces exclusivity, so both rows coexist. (Owner-first is NOT reachable: the DUPLICATE precheck fires before the AssetShare check, so `tryContributeDeniedAssets` is never consulted.) The mobile edge table is keyed `(albumId, assetId)` with **no arm discriminator**: when either server row is later deleted (e.g. `removeAssets` deletes the `album_asset` row), its audit tombstone flows through sync and deletes the **single** client edge, while the surviving `album_space_asset` row keeps the asset visible on web and never re-upserts (its `updateId` never bumps) → asset silently vanishes from the album on mobile, permanently, while web still shows it.

**Fix direction:** enforce the one-table invariant on the owner-add path: after successful `album_asset` inserts into a space-linked album (`addAssets` AND `addAssetsToAlbums`), call `removeContributedAssetIds(albumId, addedIds)` **in the same transaction** — converts any existing contribution into the owner row; the emitted `album_space_asset_audit` tombstone plus the fresh `album_asset` upsert converge mobile clients correctly. Consider a DB-level exclusivity guard (trigger or constraint) as belt-and-braces — design decision. ⚠️ Kysely gotcha: never run `this.db` queries inside a `transaction()` callback (pool deadlock, #595) — use the `trx` handle.

**Test seeds:** contribute-then-owner-add → exactly one row remains (owner arm) and a mobile client that synced the contribution converges to the owner edge (tombstone + upsert in one sync window); then owner removes the asset → edge deleted on web AND mobile; re-contribution after conversion behaves (DUPLICATE vs new contribution); `addAssetsToAlbums` bulk path covered, not just `addAssets`.

### P1-7 · MEDIUM+LOW — Face pipeline blind to contributions: projection CTEs, raw SQL scope helper, and no per-contribution trigger

**Files:** `server/src/repositories/face-identity.repository.ts:591-592` and `:716-717` (backfill-target CTEs — union direct/library/`album_asset` arms, omit `album_space_asset`); `server/src/utils/shared-space-album-scope.ts:364-379` (`spaceAlbumAssetExistsSql` emits ONLY the `album_asset` arm despite its header claiming to mirror the two-arm Kysely `spaceAlbumAssetExists:128-133`) → six read-only consumers at `face-identity.repository.ts:915/1035/1177/1682/1828/1944`; `album.service.ts` contribution path deliberately skips the `AlbumAssetsAdd` face event ("a contribution is a bookmark with no album_asset row"). Confidence: high.

**Why it's an issue:** faces on contributed-only assets are never selected as projection targets, and the only covering job (`SharedSpaceFaceMatchAll` → `getAssetIdsInSpacePage`, fixed two-arm in `fdd8705832`) fires only on coarse unrelated triggers (faceRecognitionEnabled toggle, member add, bulk add, forced re-run…) — **no cron, no per-contribution trigger → unbounded window** where an asset visible in the space timeline has faces that never appear in space People. The raw-SQL helper divergence additionally makes people counts/statistics exclude contributed-only assets even AFTER a reconcile projects them — and sharpens an inconsistency: `fdd8705832`'s retention fix deliberately KEEPS a person whose only reachable faces are on contributions, whom these reads then fail to surface. The pinning medium spec (`test/medium/specs/utils/shared-space-album-scope-sql.medium.spec.ts`) never seeds `album_space_asset`, so the divergence passes CI.

**Fix direction:** (1) add the fourth spaceId-correlated UNION arm to both CTEs; (2) add the contributed arm to `spaceAlbumAssetExistsSql`, reusing its existing join/gate fragments, and extend the equivalence medium spec to seed `album_space_asset` rows including a contribution-only one; (3) enqueue a `SharedSpaceFaceMatch {spaceId, assetId}` job per successful contribution insert in `tryContributeDeniedAssets` (interacts with design decision D3). ⚠️ Register any new helper usage in the scope-guard `SPACE_HELPER`/`NON_DECL` lists (see `fdd8705832` lesson). ⚠️ `make sql` regen needed for `@GenerateSql` changes — local `mise sql` is broken on this machine (see §6).

**Test seeds:** member contributes an asset with a named face → the person appears in space People without waiting for a coarse reconcile trigger; contribution-only asset (direct path removed) still counted in person statistics/counts; equivalence spec: Kysely vs raw helper agree on contribution-only fixtures.

### P2 — Test-only gaps (no product-code change)

- **P2-8 (medium confidence: high):** the M-2 trash gate (`asset.deletedAt IS NULL`) on the **contributed** backfill/creates arms (`sync.repository.ts:1705-1709` + parallel gates) is entirely untested — every existing trash-related spec trashes the ALBUM or seeds only `album_asset`/direct/library rows. Also untested: the `album_asset`-arm gate of `SharedSpaceAlbumToAssetSync.getBackfill` (`:1690`). Extend `server/test/medium/specs/sync/sync-space-backfill-trash.medium.spec.ts`: seed linked album, member contributes, trash the contributed asset → `getBackfill`/`getCreates` (ToAsset, Asset, Exif) exclude it while `getUpdates` still delivers for convergence.
- **P2-9 (low):** the co-linked-album unlink scenario has no test (`shared-space-album-to-asset-sync.spec.ts` §8.3 covers only disjoint-membership; no spec deletes a `shared_space_album` row at all). This is P0-1's RED test — write it first, it must fail until P0-1 lands.
- **P2-10 (low):** owner-departure contribution retention is unpinned. Add one case to `server/test/medium/specs/services/album-space-asset-permissions.service.spec.ts` (~`:240`): remove the contributed-asset owner via `spaceRepo.removeMember`, assert remaining members still see the contribution (pins retention-by-design; flipping the assertion later is the one-line signal if D2 ever decides otherwise).
- **P2-11 (UNVERIFIED — dropped at the verification cap, confirm before acting):** the three positive `PATCH showInTimeline` e2e tests (`e2e/src/specs/server/api/shared-space-album.e2e-spec.ts:186` area) assert only HTTP 204 and never GET the persisted state — a silent-no-op regression would pass. Cheap fix: GET-after-PATCH assertions.

---

## 5. Open design decisions (settle BEFORE implementing the affected finding)

- **D1 (blocks P0-1):** unlink revocation semantics — delete `album_space_asset` rows on unlink (breaks the pinned "reversible on re-link" behavior) vs retain rows + synthetic sync tombstones (preserves reversibility; must prove backfill re-delivers on re-link). Owner of this decision: Pierre.
- **D2 (deferred S3, informs P2-10):** per-user revocation when a member departs while the album link survives for others — rows must remain for other members, so it needs user-scoped tombstones or a per-user backfill reset. Currently retention-by-design. Larger design; not required for merge.
- **D3 (S2 residue, blocks P1-7 part 3):** face-projection trigger semantics — per-contribution `SharedSpaceFaceMatch` enqueue (proposed) vs accepting reconcile-only with a documented window. The CTE/raw-helper fixes (P1-7 parts 1–2) are unconditional either way.
- **D4 (S4 from the first audit — still open, NOT re-raised by this swarm):** an editor's OWN assets added to a space-linked album become real global `album_asset` rows (visible to the album's non-space audience, surviving unlink). The functional finder judged current behavior internally consistent; the first audit flagged it as an RBAC/product decision (route own adds through `album_space_asset` instead, or accept + document). Interacts with P1-6 if own adds ever get rerouted.

## 6. Implementation gotchas (from project memory — verified patterns)

- **TDD throughout**: every P0/P1 item gets its failing test first (medium test for repo/service logic, e2e where the HTTP contract changes). P2-9 is explicitly P0-1's RED test.
- **Local `mise sql` is unreliable on this machine**: it deterministically scrambles `session.repository.sql`↔`search.repository.sql` and drops 2nd+ statements of multi-statement `@GenerateSql` methods. CI's "SQL Schema Checks" is authoritative — pull the failing job's diff and `git apply` it (strip timestamp prefixes).
- **Scope-guard registration**: helper calls at line-start get mis-read as function declarations — register new helpers/usages in `SPACE_HELPER` + `NON_DECL` allowlists or the guard defeats `VIS_ALLOWLIST`.
- **Kysely transactions**: never `this.db` inside `transaction()` callbacks — use the `trx` handle (pool deadlock, relevant to P1-6).
- **HTTP-contract ripple**: if any endpoint's status/body changes (cf. the 204→200 `removeAssets` lesson), the ripple is e2e specs + mobile test mocks + web SDK consumers + full OpenAPI regen (spec, TS, Dart).
- **feat/rebase branches get no CI on push** — dispatch with `gh workflow run test.yml --ref rebase/space-albums-onto-main-v303` (account `Deeds67`); check JOBS, not just run conclusion. Run medium/e2e locally (compose detached, not interactive `mise e2e`).
- **No flake allowance**: fix leaked state at root cause; e2e `waitForQueueFinish` returns "done" on not-yet-enqueued jobs — poll the post-condition instead (relevant to P1-7 face-job tests).
- **Prettier** this document (and any docs/plans edits) before committing — CI Docs Build is strict.
