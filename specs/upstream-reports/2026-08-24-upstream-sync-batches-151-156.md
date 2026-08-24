# Upstream Sync Report — 2026-08-24 (batches 151–156)

## Summary

- **Upstream commits pulled**: 9 (`c98c20e9639..8dcfd36fa57`), batches 151–156
- **Fork commits synced from `origin/main`**: 6 (`07cd632f1ba..a8064e8af02`)
- **Conflicts resolved**: 9 in the fork sync, 4 across batches 151–155, 20 across batch 156
- **Risk level**: MEDIUM
- **Recommendation**: PROCEED — branch is level with `upstream/main`, all local gates green

Batch 156 (`immich-30966`, the mobile Drift relocation) was flagged at Checkpoint 1 as
HIGH risk and offered for quarantine. The maintainer chose to **bundle** it, so the
fork-side propagation landed in this cycle rather than being deferred.

## Incoming Upstream Changes

| SHA           | Summary                                 | Area   | Risk to Fork | Notes                                                                                                     |
| ------------- | --------------------------------------- | ------ | ------------ | --------------------------------------------------------------------------------------------------------- |
| `cbf5d83a693` | maintenance return-URL sanitization     | web    | LOW          | Applied clean                                                                                             |
| `2feb889b9cd` | zod 4.4.3, nestjs-zod ^5.5.0            | server | MEDIUM       | Lockfile was already on nestjs-zod 5.5.0; forced an OpenAPI regen that only touches fork DTOs — see below |
| `6f6f2362d7a` | lint for unguarded redirect URL reading | web    | MEDIUM       | One fork-only violation; fork `eslint.config.js` conflicted                                               |
| `6b7b0fe3a6b` | remove partner assets from memories     | server | MEDIUM       | New migration + permission semantics change — see below                                                   |
| `1b3aa9cd512` | correct tag create operations           | server | MEDIUM       | Rewrote the code a fork deadlock fix patched                                                              |
| `0b75b202674` | hash-wasm SHA-1 upload hashing          | web    | LOW          | Applied clean                                                                                             |
| `2ea17db70c2` | flutter 3.44.9 → 3.47.1                 | mobile | MEDIUM       | One trivial `.gitignore` conflict                                                                         |
| `b3daf492347` | dcm 1.37.0 → 1.39.1                     | mobile | LOW          | Fork's DCM-gate patch does not overlap the version line                                                   |
| `8dcfd36fa57` | **move Drift into `mobile/data`**       | mobile | **HIGH**     | 100 files, 34 renames — see Pattern Propagation                                                           |

### High-risk changes

**`8dcfd36fa57` — mobile Drift relocation.** Upstream moved
`lib/infrastructure/{entities,repositories,utils}` into `lib/data/db/**`. Fork exposure:
eight fork-only tables plus `space_album.repository.dart`, and ~250 files importing the
moved paths. `build.yaml`'s `generate_for` dropped `lib/infrastructure/entities/*.dart`,
so leaving the fork tables at the old path would have removed them from codegen with no
error. `drift_schemas/` was not moved, so the fork's v32–v36 snapshots stayed put.

**`6b7b0fe3a6b` — permission semantics differ for the fork.** Upstream replaced
`addAssets`'s hardcoded `Permission.AssetShare` with a per-caller permission, moving
memories and tags to `Permission.AssetUpdate`. Upstream reads that as a pure narrowing
(owner only). In Gallery `AssetUpdate` is owner **+ space editor** (`utils/access.ts`),
while `AssetShare` is owner + partner, so for us it is a swap: memories and tags lose
partner assets and gain space-editor reach. Decided with the maintainer to **take
upstream as-is**, consistent with how space editors already act on assets they do not own
(#764).

The migration `1787148183730-DeleteMismatchedMemoryAssets` deletes `memory_asset` rows
whose memory and asset owners differ. Checked against the fork's shared-space memory
support (#997/#998): that is viewer-side (`memory.repository.ts accessibleSearchBuilder`),
memory owner and asset owner still match, so no fork data is affected.

## Conflict Resolutions

### Fork sync (`upstream-sync-fork-main` threw; resolved by hand)

The script failed on the first commit and left the cherry-pick mid-flight instead of
rolling back. Resolved commit-by-commit; `integratedForkHead` and `appendHistory` were
advanced manually to match what the script would have written.

| File                                                     | Fork side                                                    | Upstream/rolling side                                  | Resolution                                                                       | Risk                                                                         |
| -------------------------------------------------------- | ------------------------------------------------------------ | ------------------------------------------------------ | -------------------------------------------------------------------------------- | ---------------------------------------------------------------------------- |
| `server/src/services/search.service.ts`                  | #993 adds `callerId` + album-scoped `userIds`                | rolling has `viewingUserId` (face ordering)            | Kept **both** — distinct fields, verified against `search.repository.ts`         | LOW                                                                          |
| `mobile/openapi/**`                                      | `main` commits the Dart client                               | rolling generates it at build time (#888)              | Kept the deletion                                                                | LOW                                                                          |
| `AGENTS.md`                                              | #998 condenses three bullets                                 | rolling's are newer (unified `Person`, Flutter 3.44.9) | Kept rolling's, grafted #998's memory-lane and date-param facts                  | LOW                                                                          |
| `mobile/.../memory.service.dart`                         | adds `_apiRepository`                                        | rolling renamed the repo to `MemoryRepository`         | Both                                                                             | LOW                                                                          |
| `mobile/.../memory.provider.dart`                        | edits providers rolling deleted                              | rolling constructs inline off `driftProvider`          | Kept rolling's shape, threaded the API repo                                      | MEDIUM — two other construction sites broke on arity with no conflict; fixed |
| `specs/**` (41 paths)                                    | #1021 consolidates docs                                      | rolling has its own newer docs                         | Kept the relocation; deleted the three execution plans #1021 drops               | LOW                                                                          |
| `mobile/.../action.provider.dart`, `action.service.dart` | #1019 edits `shareLink`                                      | rolling moved it to `presentation/actions`             | Ported `spaceId`/`contributedCount` into `ShareLinkAction`; both tests re-shaped | MEDIUM                                                                       |
| `Package.resolved`                                       | `origin/main` **dropped** the keychainaccess + maplibre pins | rolling and `upstream/main` have them                  | Kept rolling's — see Inconsistencies                                             | LOW                                                                          |

### Batches 151–155

| File                                          | Resolution                                                                                                                                                        | Risk |
| --------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---- |
| `web/.../people/[personId]/+page.svelte` (×2) | Upstream deleted `isExternalUrl` in favour of `Route.continue`; dropped the fork's import of it, then the fork's own later removal of `getPersonFaceThumbnailUrl` | LOW  |
| `server/src/repositories/tag.repository.ts`   | Took upstream's single-CTE rewrite. The fork's pool-deadlock fix (`this.db` → `tx`) is **subsumed**: there is no explicit transaction left to leak out of         | LOW  |
| `server/test/.../tag.repository.spec.ts`      | Base was one line and both sides appended — resolved as a **union**, asserted brace balance and that both sides' describes survive                                | LOW  |

### Batch 156

Twenty conflicts, nearly all import blocks. Resolved with a purpose-built resolver that
derives the fork's added lines from `base → theirs` (never by reading a marker side) and
repoints them through upstream's own rename map, refusing anything that is not
import-only. The four substantive ones:

| File                                               | Resolution                                                                                                                                  | Risk                                                    |
| -------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------- |
| `data/db/main/database.dart`                       | Upstream's new import set + the five fork tables at their new paths                                                                         | LOW                                                     |
| `data/db/main/query/merged_asset.drift`            | Fork's three shared-space imports rewritten to `../table/remote/`                                                                           | LOW                                                     |
| `data/server/person.dart`                          | Fork's lazy `ApiService` resolution + upstream's `const` ctor                                                                               | LOW                                                     |
| `sync_stream.repository.dart` and three test files | `ours` was empty against a 19–24 line base — the asymmetric-alignment trap. Fork's additions recovered from `base → theirs` and re-inserted | MEDIUM — taking `ours` would have silently dropped them |

## Fork Feature Verification

| Feature                         | Status | Notes                                                                        |
| ------------------------------- | ------ | ---------------------------------------------------------------------------- |
| Shared Spaces (server)          | OK     | Fork-owned file + symbol survival green                                      |
| Shared Spaces (mobile Drift)    | OK     | Tables relocated, FKs restored, v36 snapshot regenerates identical           |
| Space share links (#1018/#1019) | OK     | Server, web and mobile paths carried; mobile re-shaped onto the action model |
| Storage Migration               | OK     | Suite dispatched                                                             |
| Pet Detection / Classification  | OK     | Classification DTO surfaced in the OpenAPI regen, no behaviour change        |
| Image Editing                   | OK     | No conflicts                                                                 |
| Branding                        | OK     | i18n branding-override detector clean                                        |
| Memories (fork types + #997)    | OK     | Permission change accepted deliberately; timer test rewired to the API path  |

## Database Migration Analysis

| Timestamp     | Migration                    | Tables         | Risk | Notes                            |
| ------------- | ---------------------------- | -------------- | ---- | -------------------------------- |
| 1787148183730 | DeleteMismatchedMemoryAssets | `memory_asset` | LOW  | Data-only; no fork rows affected |

- Gallery migration count: 61 (manifest updated for `1792123120451-AddSharedLinkSpaceId`, which arrived via the fork sync)
- Timestamp collisions: NONE
- `postbuild` sync: intact — "Synced 61 Gallery migrations … 1 compatibility aliases"
- `revert-to-immich.sql`: coverage detector clean after adding the new migration

## Mobile Drift Migration Analysis

- `schemaVersion` 36, snapshots v32–v36 fork-owned — **unchanged**; upstream added no mobile migration
- No renumbering required
- `drift_schema_v36.json` regenerates byte-identical to the committed file (this is what caught the lost foreign keys)

## Pattern Propagation

| Refactor                                 | Old → New                                                             | Fork files affected                                       | Decision    | Commit                       |
| ---------------------------------------- | --------------------------------------------------------------------- | --------------------------------------------------------- | ----------- | ---------------------------- |
| Mobile Drift relocation (`immich-30966`) | `lib/infrastructure/{entities,repositories,utils}` → `lib/data/db/**` | 8 tables renamed, ~90 files repointed, tooling + manifest | **Bundled** | `1afff19cbb2`, `3adb17d3dc7` |

Three loose ends the relocation itself could not surface:

1. The fork tables kept a `.entity.dart` suffix in a directory where upstream uses bare
   names — renamed, and the five importers repointed.
2. Their generated `.drift.dart` siblings became **tracked again**: #888 untracked them at
   the old paths, and the rename carried pre-deletion copies to new paths the deletion no
   longer matched. Untracked (already covered by `mobile/.gitignore`).
3. The fork's own preflight tooling and ownership manifest addressed `db.repository.dart`
   by literal path, so `mobile-drift-check` read an empty file and reported every Gallery
   callback as missing — a fork-tooling break with no compiler visibility.

## Inconsistencies Found

1. **Lost foreign keys on every shared-space mobile table (fixed).** The relocation only
   rewrote imports inside conflicting files; the fork's table definitions still imported
   `user.entity.dart` and `drift_default.mixin.dart` at the old paths. Drift resolved
   neither and silently dropped the FKs and the mixin. No compiler error — `dart analyze`
   was green on those files in isolation. Only `drift_dev make-migrations` refusing to
   rewrite the v36 snapshot exposed it. **This is the strongest argument yet for running
   the mobile gates locally rather than deferring them to CI.**
2. **`origin/main` dropped two SPM pins.** `Package.resolved` on `main` no longer carries
   `keychainaccess` or `maplibre-gl-native-distribution`; `upstream/main` and rolling both
   do. Rolling's copy was kept. **This is a `main`-side regression that still needs its own
   fix** — it was carried in by #1019's local environment.
3. **A `Route.search` guard matched by bare substring.** `web/src/lib/route.spec.ts` used
   `includes('Route.search')`, so a local named `previousRoute.search` read as a new call
   site. Anchored the match; verified it still fails on a genuine `Route.search(` call.
4. **Pre-existing conflict markers inside replayed fork history.** Several replayed commits
   contain unresolved markers in `web/src/service-worker/index.ts`. The end state and
   `origin/main` are both clean, so these are transient intermediate states from an earlier
   cycle, not from this one. Left alone rather than rewriting 1,300 commits.

## Local CI Verification

| Check                                                  | Status | Notes                                                                     |
| ------------------------------------------------------ | ------ | ------------------------------------------------------------------------- |
| `server pnpm build` (+ postbuild)                      | PASS   | 61 migrations, 1 alias                                                    |
| `server pnpm check`                                    | PASS   |                                                                           |
| `web check:typescript`                                 | PASS   | needed an SDK rebuild first — stale build masked the new `albumIds` facet |
| `web check:svelte`                                     | PASS   | 627 files, 0 errors                                                       |
| `e2e pnpm check`                                       | PASS   |                                                                           |
| `server pnpm lint`                                     | PASS   |                                                                           |
| web eslint (`tscompat` off)                            | PASS   | 0 errors                                                                  |
| prettier: server / e2e / docs / cli / `.github` / i18n | PASS   | tag.repository.ts needed formatting                                       |
| Server unit tests                                      | PASS   | 6070 passed                                                               |
| Web unit tests                                         | PASS   | 5972 passed                                                               |
| `dart analyze --fatal-infos`                           | PASS   | No issues found                                                           |
| `dart format` (CI form)                                | PASS   | 0 changed                                                                 |
| `flutter test`                                         | PASS   | 3441 passed                                                               |
| `drift_dev make-migrations`                            | PASS   | v36 unchanged                                                             |
| OpenAPI regeneration                                   | PASS   | committed                                                                 |

## Remote CI Verification

- **Test branch**: `rebase/upstream-batch-156`
- **Commit validated**: `50f5302ff26` (7 workflows were validated at `71b6c41dc88`; the delta to
  `50f5302ff26` is this report plus whitespace in one web route and one mobile test)

| Workflow                                  | Status | Run           | Notes                                                                       |
| ----------------------------------------- | ------ | ------------- | --------------------------------------------------------------------------- |
| `test.yml`                                | GREEN  | `50f5302ff26` | 21/21 jobs, incl. Lint Web, OpenAPI Clients, Medium Tests, Unit Test Mobile |
| `docker.yml`                              | GREEN  | `50f5302ff26` | re-run after the web whitespace fix                                         |
| `static_analysis.yml`                     | GREEN  | `50f5302ff26` |                                                                             |
| `gallery-mobile-smoke.yml`                | GREEN  | `50f5302ff26` |                                                                             |
| `gallery-build-mobile.yml`                | GREEN  | `71b6c41dc88` | iOS + Android compile                                                       |
| `gallery-ml-smoke.yml`                    | GREEN  | `71b6c41dc88` |                                                                             |
| `gallery-rebase-smoke.yml`                | GREEN  | `71b6c41dc88` |                                                                             |
| `storage-migration-tests.yml`             | GREEN  | `71b6c41dc88` |                                                                             |
| `storage-migration-e2e.yml`               | GREEN  | `71b6c41dc88` |                                                                             |
| `gallery-revert-to-immich-validation.yml` | GREEN  | `71b6c41dc88` | coverage grep + Docker boot                                                 |

**Failures fixed** (first round, all self-inflicted and formatting-only — no code defect):

- `Test Web`: prettier on the space people `+page.ts`. The local sweep covered `server`, `e2e`,
  `docs`, `packages/cli`, `.github` and `i18n` but **skipped `web/`**, so that gate never ran here.
- `Static Code Analysis` + `Gallery Mobile Smoke`: one `directives_ordering` info in
  `space_bottom_sheet_share_link_test.dart`, which was edited _after_ the last `dart analyze`.

Both are the same process error — editing a file after its gate has already run. The full sweep was
re-run on the final tree afterwards.

**Confirmed flakes**: none. Every failure was real and reproducible locally once the right gate was
run.

## Post-Rebase Verification

- Fork commits ahead of upstream: 1313
- Commits behind upstream: 0
- Conflict markers in the working tree: none
