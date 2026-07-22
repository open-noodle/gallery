# Slice 6 — Root cause A residuals (L1, L2, L3, I1, I2) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development. TDD, red→green.
> Phase 2 (deferred). 5 independent server-side fixes, all "album-granted read scope" residuals.

**Goal:** Close the low-severity leaks/divergences left after Phase 1's album-read gating: contributor
PII + hidden-count side channel (L1), album-search over-restriction vs the grid (L2), person stats
library-wide count leak (L3), suggestion-facet owner exception (I1), and activity-count album-level
leak (I2).

## Global Constraints (spec §0)

- TDD, positive control before negative. No co-author trailers. Targeted specs + tsc + lint; write e2e,
  defer to CI. `make sql` only against a scratch DB with Docker up (never without a DB). Re-confirm lines.
- **Consistency (critical):** L2 refactors `albumSharedSpaceScope`, which Slice 1 (H1) already modified.
  The refactor **MUST keep `asset.deletedAt IS NULL`** in the resulting predicate. Run the Slice-1 H1
  search tests after L2 — they must stay green.

Each fix is its own commit. Order: L1, L3, I1, I2, then L2 (do the risky refactor last, after the
simpler ones are green).

---

### Fix L1 — `contributorCounts` PII + hidden-count leak

**Files:** `server/src/services/album.service.ts` (`get`, ~~`:154`), `server/src/repositories/album.repository.ts` (`getContributorCounts`, `:575`)
**Verified:** `get` already computes `isShared` (~~`:103`) and `hasDirectAccess` (~`:111`); today
`contributorCounts: isShared ? await getContributorCounts(id) : undefined` (with an in-code comment
admitting the leak). `getContributorCounts` filters `deletedAt` only (no visibility).

- [ ] Test (unit) RED: a space-only reader (`hasDirectAccess` false) `get`ting a shared album → response
      `contributorCounts` is `undefined`. Positive control: a direct reader → present. (medium, if feasible:
      `getContributorCounts` excludes Hidden/Locked assets so the count can't reveal hidden counts.)
- [ ] Implement: change to `contributorCounts: isShared && hasDirectAccess ? await this.albumRepository.getContributorCounts(album.id) : undefined`; **and** add `withDefaultVisibility` (Archive+Timeline) inside `getContributorCounts` so the hidden-count inference is closed for all callers. Remove the stale "flagged for a follow-up" comment.
- [ ] `make sql` if `getContributorCounts`'s generated doc changed (Docker up). Commit:
      `fix(spaces): gate album contributorCounts to direct readers + visibility (L1)`

### Fix L3 — `person.getStatistics` null-identityId library-wide count

**Files:** `server/src/services/person.service.ts` (`getStatistics`, `:398-406`), `server/src/repositories/person.repository.ts` (`getStatistics`, `:604`)
**Verified:** null-identityId branch calls `personRepository.getStatistics(id)` unscoped for non-owners.

- [ ] Test (unit/medium) RED: a space-only reader of a person with `identityId = null` gets a count
      restricted to space-reachable assets, not the owner's whole library. Positive control: owner → full.
- [ ] Implement: in the null-identityId branch, if `auth.user.id !== person.ownerId`, route to a
      space-scoped count (reuse the `getAccessiblePersonStatistics`-style `spaceAssetPathBranches({
memberUserId })` + `spaceVisibilityGate`), else the existing owner count. Add a scoped repo method or
      parameterize `getStatistics` with an optional `memberUserId` scope.
- [ ] `make sql` if a new decorated query. Commit: `fix(spaces): scope legacy person statistics for space readers (L3)`

### Fix I1 — suggestion-facet albumId owner exception

**Files:** `server/src/repositories/search.repository.ts` (`applySuggestionScope`, albumId arm `:1215-1245`)
**Verified:** the albumId arm's owner branch is `eb('asset.ownerId', '=', anyUuid(userIds))` (`:1226`)
with no visibility gate → the owner's own Hidden album asset feeds People/Location/Camera facets.

- [ ] Test (medium) RED: an owner's Hidden album asset does NOT contribute a facet value via the albumId
      suggestion path. Positive control: a visible album asset does.
- [ ] Implement: AND the ownerId branch (`:1226`) with `spaceVisibilityGate(eb)` — **albumId arm only**;
      leave the `spaceId`/`timelineSpaceIds` arms' owner exception intact.
- [ ] `make sql` if changed. Commit: `fix(spaces): gate owner Hidden assets out of album suggestion facets (I1)`

### Fix I2 — activity `getStatistics` album-level count leak

**Files:** `server/src/services/activity.service.ts` (`getStatistics`, `:48-51`), `server/src/repositories/activity.repository.ts` (`getStatistics`)
**Verified:** `getStatistics` gates on `AlbumRead` but returns aggregate {comments, likes} including
album-level (assetId null) rows to space-only readers. An in-code comment says it was deliberately
deferred (needs an SQL predicate change + `make sql`).

- [ ] Test (unit) RED: a space-only reader's `getStatistics` excludes album-level comments/likes (assetId
      null) from the counts; a direct reader includes them (positive control).
- [ ] Implement: compute `hasDirectAccess` (same as `getAll`: `!!auth.sharedLink ||
hasDirectAlbumReadAccess(...)`); when `!hasDirectAccess`, pass a flag to `activityRepository.getStatistics`
      that excludes `assetId IS NULL` rows (add an optional `excludeAlbumLevel`/`assetIdNotNull` param to the
      repo method). Update the deliberate-deferral comment.
- [ ] `make sql` for the changed decorated `getStatistics` (Docker up). Commit:
      `fix(spaces): exclude album-level activity counts for space-only readers (I2)`

### Fix L2 — `albumSharedSpaceScope` over-restriction (do LAST) ⚠️

**Files:** `server/src/utils/database.ts` (`albumSharedSpaceScope`, `:609-653`)
**Verified:** the plain-album branch (`:612-624`, after Slice 1) is `spaceVisibilityGate` +
`deletedAt IS NULL` + two anti-joins excluding `shared_space_asset`/`shared_space_library` assets;
those are re-admitted only via the `timelineSpaceIds` arms (membership + `showInTimeline`). This
**over-restricts** album-scoped search vs the grid: library-backed / directly-space-linked album assets
the grid shows are omitted for an album_user Viewer or a member with the timeline toggle off.

- [ ] Test (medium) RED: an album_user Viewer's `searchMetadata { albumIds:[X] }`, where X contains a
      library-backed or directly-space-linked visible asset, returns that asset (today it is omitted).
      Positive controls that MUST stay green: Hidden album asset still excluded; **trashed album asset still
      excluded (Slice 1 H1)**; Locked excluded.
- [ ] Implement: replace the plain-album `eb.and([...])` branch AND drop the `timelineSpaceIds`
      re-admission arms — reduce `albumSharedSpaceScope` to the flat gate:

```ts
export function albumSharedSpaceScope<O>(qb: SelectQueryBuilder<DB, 'asset', O>, _timelineSpaceIds?: string[]) {
  // AlbumRead already authorizes the album's content; match the album grid's flat visibility gate
  // (withDefaultVisibility) exactly — Archive+Timeline, not-deleted, no owner exception, no anti-join.
  return qb.where((eb) => eb.and([spaceVisibilityGate(eb), eb('asset.deletedAt', 'is', null)]));
}
```

Keep the `timelineSpaceIds` param in the signature (callers pass it) but unused, or update the single
call site (`searchAssetBuilder:714`) — pick the lower-churn option and note it. **Re-run the Slice-1
H1 search medium/e2e tests — they must stay green.**

- [ ] `make sql` if changed. Commit: `fix(spaces): flat-gate album-scoped search to match the grid (L2)`

---

## Definition of done

- 5 fixes, each with RED→GREEN TDD + positive control; e2e where the spec named one (L1, I2). tsc + lint
  clean; `make sql` run (or flagged if no Docker). **Slice-1 H1 tests still green after L2.** Scope-clean
  (only root-cause-A residuals). Commits pushed.
