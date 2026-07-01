# Upstream Sync Report — 2026-06-30 (batches 301–302)

## Summary

- **Upstream commits pulled**: 2 (`df383c1ead..deeb042a9e`)
- **Fork commits synced**: 1 (`#729` — `7dbd29113..ca13ebb95`)
- **Conflicts resolved**: 6 fork commits hit conflicts on the search surface (1 in the
  squashed fork base + 5 later fork search PRs); the generated
  `search.repository.sql` auto-resolved via a temporary, scoped keep-theirs merge
  driver and was regenerated canonically at the end.
- **Post-rebase fork fixes**: 2 commits — (`85174620c5`) a `not-locked` literal-type
  pin in `resolveSmartSearch` + an album-access mock in one fork unit test; and
  (`73ebb21325`) a shared-space RBAC gate for album-scoped search (see the dedicated
  section below — the one issue the first CI run caught).
- **Risk level**: MEDIUM (a breaking upstream change on the fork's most heavily
  extended surface — search, including a real RBAC reconciliation) → resolved and
  verified.
- **Recommendation**: PROCEED (re-verifying CI on the test branch after the RBAC gate)

Upstream is untagged post-`v3.0.0-rc.4` dev. The fork stays on its tagged base
`branding/config.json.upstream.version = 2.7.5` (unchanged — no version bump). The
planner split the two commits into batches 301 (`b4cc406a3f`) and 302
(`deeb042a9e`); both are search-only and sequential, so they were collapsed into a
single `git rebase deeb042a9e`.

## Incoming Upstream Changes

| Batch | SHA          | PR     | Summary                                                  | Area          | Risk to Fork      | Notes                                                                                                                                                                                                                                                                                                           |
| ----- | ------------ | ------ | -------------------------------------------------------- | ------------- | ----------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 301   | `b4cc406a3f` | #29385 | `fix!:` search endpoints visibility can be omitted       | server search | MEDIUM (breaking) | Rewrites the central `searchAssetBuilder` visibility clause into a `$if` conditional (`'not-locked'` → `!= Locked`, else `= visibility`, else no filter); adds `visibility` defaults in the search service; renumbers every bound param in `search.repository.sql`. Planner flagged HIGH / `breaking-refactor`. |
| 302   | `deeb042a9e` | #29352 | feat: honor album access permissions in search endpoints | server search | MEDIUM            | Adds a `Permission.AlbumRead` `requireAccess` gate to `searchMetadata` when `albumIds` is set (leaving `userIds` undefined in that branch).                                                                                                                                                                     |

### High-risk change: #29385 visibility omission (detailed)

- **What upstream changed.** `visibility` is no longer defaulted to `Timeline`. It may
  be omitted (no filter), `'not-locked'` (`!= Locked`), or a concrete value. The
  central `searchAssetBuilder` in `server/src/utils/database.ts` replaces
  `.where('asset.visibility', '=', visibility)` with a `$if(!!options.visibility, …)`
  block; each search service method sets
  `visibility: dto.visibility ?? (auth.session?.hasElevatedPermission ? undefined : 'not-locked')`.
- **Why it's risky.** The fork heavily extends all four touched files (Smart Search on
  `/photos`, Spaces search, `spacePersonIds`/global identities, OCR, CTE sort, filter
  facets). The fork's `searchAssetBuilder` wraps that exact visibility line with its own
  people/space/OCR clauses.
- **What was verified.** After resolution: the `$if` visibility block is present
  (`database.ts:610`) above the fork's `forceEmptyResult`/`spaceId`/`personIds` clauses;
  all four service methods carry the `not-locked` default (and the new
  `requireElevatedPermission` guards); the repository option types omit-and-re-add
  `visibility?: AssetVisibility | 'not-locked'`. Smart search routes its visibility
  through `resolveSmartSearch` → `resolveScopedPersonFilters` (which spreads `...dto`,
  preserving the key) so smart search **and** facets apply the not-locked filter for
  non-elevated sessions. The old `AssetVisibility.Timeline` default is gone.

## Fork Commit Sync (#729)

`make upstream-sync-fork-main` cherry-picked `ca13ebb95` (docs(readme): feature-list
parity with the marketing site). The fork-ownership coverage pre-check correctly
failed: #729 adds a new fork-only `AGENTS.md` and moves content out of `CLAUDE.md`.
Resolved by adding `AGENTS.md` to the `release-ci-and-infrastructure`
`optional_paths` and refreshing `last_verified_fork_head` to `ca13ebb95`
(commit `5b89ce1dc8`), then `ROLLING_CONTINUE=1` finalized the sync.

## Conflict Resolutions

All conflicts were on the search surface; every resolution keeps **both** upstream's
visibility/album-access logic and the fork's filter clauses.

### `server/src/repositories/search.repository.ts` (squashed base + #254)

- **Fork side**: `SmartSearchOptions` adds `SearchSpaceOptions` (base) and
  `SearchOrderOptions` (#254). **Upstream side**: omits `visibility` from
  `SearchStatusOptions` and re-adds `visibility?: AssetVisibility | 'not-locked'`.
- **Resolution**: union of all — `… & SearchSpaceOptions & SearchOrderOptions & { visibility?: AssetVisibility | 'not-locked' }`.
  (`AssetSearchOptions` auto-merged the same way.)
- **Risk**: LOW — orthogonal intersection members.

### `server/src/services/search.service.ts` (#254, #294, #456, #495)

- **#254**: keep `orderDirection: dto.order` (fork sort) alongside the new `visibility`
  default in the `searchSmart` repo call.
- **#294**: keep `maxDistance: machineLearning.clip.maxDistance` (CLIP threshold)
  alongside `visibility`.
- **#456**: fork refactored `searchSmart` to build options via `resolveSmartSearch`.
  Took the fork refactor (`searchSmart({ page, size }, options)`) and moved upstream's
  `visibility` default **into** `resolveSmartSearch`'s `resolvedOptions` so it covers
  both `searchSmart` and the new `searchSmartFacets`.
- **#495**: keep the fork's `getTimelineSpaceIds`/`resolveScopedPersonFilters`
  (`...resolvedDto`) flow in all methods alongside upstream's `visibility` defaults and
  `requireElevatedPermission` guards; in `resolveSmartSearch`, the `visibility` line
  sits inside the `resolveScopedPersonFilters(auth, { … })` argument.
- **Risk**: MEDIUM (most complex). Verified by the full server unit suite (4697 pass)
  and a manual read confirming `visibility` reaches the query builder on every path.

### `server/src/utils/database.ts` (squashed base + #495)

- **Resolution**: upstream's `$if(!!options.visibility, …)` block, then the fork's
  `$if(!!options.forceEmptyResult, …)` clause. Dropped #495's leftover
  `.where('asset.visibility', '=', visibility)` — that `visibility` const was removed by
  upstream's refactor.
- **Risk**: LOW.

### `server/src/services/search.service.spec.ts` (#294) & `server/test/medium/specs/services/search.service.spec.ts` (#716)

- Spec assertions updated to expect both `maxDistance` and `visibility: 'not-locked'`;
  the medium-spec import conflict (adjacent to upstream's new `AssetVisibility`/`AlbumUserRole`
  imports) took the fork's `FilterSuggestionsResponseDto` import.
- **Risk**: LOW.

### `server/src/queries/search.repository.sql` (14 fork commits)

- Generated file. Auto-resolved during the rebase via a temporary, **scoped**
  `keep-theirs` merge driver (`server/src/queries/search.repository.sql merge=…` in the
  common-dir `info/attributes`), which was **scrubbed immediately after** the rebase.
  The file was then regenerated canonically with `mise //:sql` against the running v3
  dev DB — the regen drops the `"asset"."visibility" = $N` line from each search query
  and renumbers params, matching upstream's intent layered onto the fork's query
  variants.
- **Risk**: LOW — regenerated from source; verified diff is exactly the visibility
  removal + param renumber.

### Post-rebase fork fix (`85174620c5`)

1. `resolveSmartSearch` annotates the visibility default as
   `AssetVisibility | 'not-locked' | undefined` so the `'not-locked'` literal survives
   the generic `resolveScopedPersonFilters` inference (no contextual type otherwise
   widened it to `string` → server `tsc` error).
2. The fork's album-scoped `searchMetadata` unit test now mocks
   `access.album.checkOwnerAccess` so it passes upstream #29352's new `AlbumRead`
   gate and reaches its `timelineSpaceIds` assertion.

### Lost-upstream-content check

`git diff upstream/main..HEAD` over the four search files shows only fork additions
plus the fork's own rewrites; every piece of upstream's new logic is positively
present in the final tree (the `$if` visibility block, the four `not-locked`
defaults, the `Permission.AlbumRead` gate). The old `AssetVisibility.Timeline`
default is correctly removed.

## Fork RBAC Reconciliation — album-scoped search (#29352) — commit `73ebb21325`

The mechanical conflict resolution was clean, but the first CI run surfaced a
**semantic** interaction that unit tests could not catch (only Medium Tests did):
upstream #29352 makes `searchMetadata` honor `album.read` access by dropping
`userIds` owner-scoping when `albumIds` is set. The fork's shared-space RBAC in
`searchAssetBuilder` (`server/src/utils/database.ts`) enforces access through
clauses **all gated on `options.userIds`** (owner scope at `:712`; accessible-space
scope at `:634`). With `userIds` undefined, those gates switch off, so a
shared-space asset **leaked** to a searcher who only had album access — a
non-space-member, or a member who hid the space from their timeline. Three fork
`people-identity-rbac` "timeline opt-in" tests caught this
(`toEqual([])` → returned one `timeline`-visibility asset).

**Decision (with the maintainer): Option B — adopt upstream's album access, add a
shared-space gate.** A new clause fires only in the `albumIds && !options.userIds`
path: an asset is visible iff it is **not** shared-space content (absent from
`shared_space_asset` and its library absent from `shared_space_library`) **or** it
is reachable through a space the searcher can currently access
(`shared_space_asset`/`shared_space_library` `spaceId` ∈ `options.timelineSpaceIds`).
This keeps upstream's shared-album search for plain assets while preserving the
fork's space-membership + timeline-visibility gating for shared-space content.

- **Verified**: the 3 fork RBAC tests pass; upstream's new "should return assets
  from shared album" medium test still passes; a new positive fork test asserts a
  member who has _not_ hidden the space sees the asset via album search
  (`people-identity-rbac.spec.ts`, 69 tests). Server `tsc` + 4697 unit tests green.
- **SQL**: unchanged — the `@GenerateSql` dummy params set `userIds`, so the gate
  never fires in the generated `search.repository.sql`.
- **Scope note**: matches upstream — only `searchMetadata` adopts album access;
  `searchStatistics`/`searchRandom`/`searchLargeAssets` still owner-scope album
  searches (no leak), so the gate is a no-op for them.

## Fork Feature Verification

| Feature                                  | Status | Notes                                                                                              |
| ---------------------------------------- | ------ | -------------------------------------------------------------------------------------------------- |
| Shared Spaces (search/space scope)       | OK     | `spaceId`/`spacePersonIds` access checks + builder clauses intact.                                 |
| Smart Search on `/photos`                | OK     | `resolveSmartSearch` + `timelineSpaceIds` + `withSharedSpaces` preserved; visibility now applied.  |
| Unified Smart Search + Filter Panel      | OK     | `searchSmartFacets` / filter-suggestion paths intact; visibility carried via `resolveSmartSearch`. |
| Global Face Identities / scoped person   | OK     | `resolveScopedPersonFilters` + `getTimelineSpaceIds` flow preserved across all methods.            |
| CLIP relevance threshold                 | OK     | `maxDistance: machineLearning.clip.maxDistance` preserved in smart search.                         |
| Search result sorting (Spaces)           | OK     | `orderDirection: dto.order` preserved.                                                             |
| Storage Migration / Pet Detection / etc. | OK     | Untouched by this batch.                                                                           |
| Branding                                 | OK     | No CI/branding changes in this batch.                                                              |

## CI and Infrastructure Verification

| Check                              | Status | Notes                                                                  |
| ---------------------------------- | ------ | ---------------------------------------------------------------------- |
| `ci-invariants-check`              | OK     | no PUSH_O_MATIC; Gallery image names; docs-deploy stays dispatch-only. |
| `fork-patches-check`               | OK     | `@immich/ui` patch metadata consistent.                                |
| `mobile-drift-rebase-check`        | OK     | schemaVersion / snapshots / callbacks consistent.                      |
| `postrebase-audit` (BATCH=302)     | OK     | fork files survive; symbols intact; generated-artifact review clean.   |
| Workflow / Docker image references | OK     | No CI/workflow files in this batch.                                    |

## Database Migration Analysis

- **New upstream migrations**: NONE — the batch is service/repository/SQL/spec only.
- **Gallery migration count**: 33 (unchanged; postrebase audit confirms).
- **Timestamp collisions**: NONE.
- **`revert-to-immich.sql` coverage**: intact — the step-7i detector prints no
  `MISSING` lines (no new migrations to cover).
- **Postbuild merge / `CompositeMigrationProvider`**: intact (`pnpm build` synced 33
  Gallery migrations).

## Mobile Drift Migration Analysis

- No mobile or Drift changes in this batch; `mobile-drift-rebase-check` OK. No
  renumbering required.

## Inconsistencies Found

None beyond the documented `not-locked` literal widening, which is fixed in
`85174620c5`.

## Pattern Propagation

No broad upstream refactor in this batch. #29385's `visibility`-omission is a local
contract change confined to the search surface and was reconciled inline (the fork
already routes all visibility through the shared `searchAssetBuilder` /
`resolveSmartSearch`).

## Local CI Verification

| Check                                     | Status | Notes                                                                       |
| ----------------------------------------- | ------ | --------------------------------------------------------------------------- |
| `server: pnpm build` (nest build)         | PASS   | postbuild synced 33 Gallery migrations.                                     |
| `server: pnpm check` (tsc --noEmit)       | PASS   | after the `not-locked` literal pin.                                         |
| `web: check:typescript` (tsc --noEmit)    | PASS   | web untouched by this server-only batch.                                    |
| `web: check:svelte`                       | N/A    | reports `0 FILES` in this worktree; CI Lint Web validates it.               |
| Server unit tests (`pnpm test`)           | PASS   | 4697 passed / 9 skipped.                                                    |
| ESLint (changed search files)             | PASS   | clean.                                                                      |
| OpenAPI regeneration (`mise //:open-api`) | PASS   | no diff — API surface unchanged (visibility was already optional).          |
| SQL regeneration (`mise //:sql`)          | PASS   | only `search.repository.sql` changed (visibility removal + param renumber). |

## Remote CI Verification

- **Test branch**: `rebase/upstream-batch-302`
- _CI dispatched after Checkpoint 3 approval; results recorded here before force-push._

## Post-Rebase Verification

- Fork commits ahead of upstream: 828 (+ this report)
- Commits behind upstream: 0
- Both upstream commits (`b4cc406a3f`, `deeb042a9e`) are ancestors of HEAD.
- Fork diff looks clean: YES
