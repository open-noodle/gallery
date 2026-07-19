# Slice 7 — Purge convergence (M3, L4, L5) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development. TDD, red→green.
> Phase 2 (deferred). Server-only.

**Goal:** Make the #757 visibility-purge retry-convergent (M3), re-deliver EXIF on a library-arm restore
(L4), and stop leaking the owner's `isFavorite` on the library sync arm (L5).

## Global Constraints (spec §0)

- TDD, positive control before negative. No co-author trailers. Targeted specs + tsc + lint; `make sql`
  only with Docker DB up (scratch). One commit per fix.

---

### Fix M3 — purge is not retry-convergent (chosen: option (b), unconditional purge on non-shareable next)

**Files:** `server/src/services/asset.service.ts` (`applyVisibilityTransitionSideEffects`, `:410-450`;
comment `:402-408`), `server/src/services/metadata.service.ts` (`:890`), specs
`server/src/services/asset.service.spec.ts` + `server/src/services/metadata.service.spec.ts`.

**Root cause (verified):** `priorVisibilities` is read from the DB **before** the write (`asset.service.ts:380`),
then `updateAll` writes (`:387`), then the helper runs (`:391`). The purge set is gated on **prior**
shareable (`:441` `purgeIds = ids.filter(shareable prior)`). If a request fails after the write commits
but before/among the emits, a retry re-reads the now-Hidden asset → `purgeIds` empty → **silent no-op**;
the member device keeps hidden bytes. The `:402-408` comment claiming "RECOVERABLE (re-run converges)" is
**false**. Same in `metadata.service.ts:890` (motion re-extract: `visibility === Timeline` guard means a
retry after the write never re-emits `AssetHide`).

**Contract (pin with tests):** a retry after a failed emit must re-emit the purge (member converges). The
Timeline↔Archive no-op and the Locked album-strip-once behavior are unchanged. Re-emitting a purge for an
already-Hidden asset is **acceptable** (tombstones are idempotent) — this is the intended tradeoff.

- [ ] **Test (unit) RED:** in `asset.service.spec.ts`, call `applyVisibilityTransitionSideEffects` (or
      `updateAll`) with `nextVisibility = Hidden` and **prior = Hidden** (simulating the post-failed-write
      retry) → assert `emitDirectAssetVisibilityPurge` / `emitAlbumAssetVisibilityPurge` /
      `emitLibraryAssetVisibilityPurge` **ARE** called for those ids. Today they are NOT (prior-gate filters
      them out) → RED. Positive controls that stay green: `nextVisibility = Timeline`, prior Timeline
      (Timeline↔Archive) → **no** purge emit; prior Locked → `removeAssetsFromAll` skips it (lock-once).
- [ ] **Implement:** change the purge set to include all ids whenever `nextVisibility` is non-shareable —
      i.e. replace `const purgeIds = ids.filter((id) => shareable(priorVisibilities.get(id)));` (`:441`) with
      `const purgeIds = ids;` (the branch already guarantees `nextVisibility ∈ {Hidden, Locked}`). Keep the
      Locked `lockIds` prior-gate (`:433`) and the **restore** prior-gate (`:421`) unchanged. Rewrite the
      `:402-408` and `:439-440` comments to describe idempotent-unconditional purge (retry-convergent; a
      re-affirm re-emits harmlessly) — remove the false "RECOVERABLE" claim.
- [ ] **metadata.service.ts:890 (motion):** make the motion hide re-emit on retry — drop / invert the
      `visibility === Timeline` guard so `AssetHide` is emitted whenever the motion path results in a Hidden
      motion asset (idempotent). Test (unit, `metadata.service.spec.ts`): a re-extract on an already-Hidden
      motion asset still emits `AssetHide`.
- [ ] **Test (medium, if Docker):** hide an asset in a space-linked context, then re-hide (simulating
      retry) → member `/sync` still carries the purge tombstone (idempotent, converges).
- [ ] Commit: `fix(spaces): make visibility-purge retry-convergent (M3)`

### Fix L4 — library hide→restore loses EXIF on member devices

**Files:** `server/src/services/asset.service.ts` (`applyVisibilityTransitionSideEffects` restore branch
`:421-426`), `server/src/repositories/shared-space.repository.ts` (add `emitLibraryAssetVisibilityRestore`),
`server/src/repositories/sync.repository.ts` (`LibraryAssetExifSync`, ~`:1393`).
**Root cause (verified from spec):** direct/album restore bump their join-row `updateId` (EXIF keyed on
it re-delivers), but the library arm has no restore emit — the asset row re-upserts (keyed on
`asset.updateId`, bumped by the visibility UPDATE) but `LibraryAssetExifSync` (keyed on
`asset_exif.updateId`, which a visibility flip never touches) never re-streams → restored library asset
shows empty EXIF forever.

- [ ] **Test (medium) RED:** member syncs a library asset + EXIF → owner hides → member drops it → owner
      unhides → assert the member's next `/sync` re-delivers the asset's EXIF (today it doesn't).
- [ ] **Implement:** add `emitLibraryAssetVisibilityRestore(restoreIds)` to
      `shared-space.repository.ts` that bumps `asset_exif.updatedAt` (→ `updateId` via its trigger) for
      restored assets whose `libraryId ∈ shared_space_library`; call it in the restore branch (`:425`, replace
      the "Library restore is automatic" comment). Server-only (mobile handler exists).
- [ ] `make sql` if a decorated query changed. Commit: `fix(spaces): re-deliver EXIF on library-arm visibility restore (L4)`

### Fix L5 — library sync arm leaks owner `isFavorite`

**Files:** `server/src/repositories/sync.repository.ts` (`LibraryAssetSync.getBackfill/getUpserts`,
~`:1295`), `server/src/queries/sync.repository.sql`, existing medium `sync-library-asset.spec.ts:217-251`.
**Root cause (verified from spec):** `SharedSpaceAssetSync`/`SharedSpaceAlbumAssetSync` mask `isFavorite`
to the syncing user's own rows via a CASE; `LibraryAssetSync` selects `columns.syncAsset` raw (includes
`asset.isFavorite`) → a member syncing another owner's linked library gets the owner's true favorite flags.

- [ ] **Test (medium) RED:** the existing `sync-library-asset.spec.ts:217-251` already reproduces it
      (unasserted) — add the assertion: a member's library-arm sync row has `isFavorite = false` for a
      non-owned asset the owner favorited. RED today.
- [ ] **Implement:** in `LibraryAssetSync.getBackfill` and `getUpserts`, split `isFavorite` out of
      `columns.syncAsset` and apply the same ownership CASE the direct/album arms use (favorite only for the
      syncing user's own rows).
- [ ] `make sql` (Docker) for the changed decorated queries. Commit:
      `fix(spaces): mask owner isFavorite on the library sync arm (L5)`

---

## Definition of done

- 3 fixes, each RED→GREEN with positive control. tsc + lint clean; `make sql` run or flagged. Existing
  #757 transition tests (asset.service.spec) stay green (the Timeline↔Archive no-op + lock-once behaviors
  are preserved). Commits pushed. Scope-clean.
