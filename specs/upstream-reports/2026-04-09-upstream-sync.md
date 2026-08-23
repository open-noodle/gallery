# Upstream Sync Report — 2026-04-09

## Summary

- **Upstream version**: Immich v2.7.0 → **v2.7.2**
- **Upstream commits pulled**: 16
- **Conflicts resolved**: 13 (3 distinct text + 10 binary `mobile/openapi/README.md` reruns)
- **Risk level**: **LOW–MEDIUM**
- **Recommendation**: **PROCEED**

All 16 upstream commits are bug fixes and chores (no schema changes, no new features, no API breaks). The only fork-affecting change is upstream PR #27595, which moves library import chunking from manual service-layer code into the `@ChunkedArray` repository decorator. This obsoleted fork PR #246's manual chunking implementation, including its unit test. Functionally identical (and slightly safer: 4000-row chunks vs fork's 4678).

## Incoming Upstream Changes

| SHA       | Summary                                                      | Area   | Risk       | Notes                                                                                                                                                                                                                                 |
| --------- | ------------------------------------------------------------ | ------ | ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 427878908 | chore: git ignore tsBuildInfo (#27594)                       | infra  | LOW        | One-line `.gitignore` add                                                                                                                                                                                                             |
| f1882c292 | fix: csp quotes (#27592)                                     | server | LOW        | 2 lines in `helmet.json`                                                                                                                                                                                                              |
| 9ba9a22c4 | fix(ml): downgrade numpy (#27591)                            | ML     | LOW        | Pin `numpy<2.4.0` in pyproject.toml + uv.lock                                                                                                                                                                                         |
| 2903b2653 | fix(server): library import batch size (#27595)              | server | **MEDIUM** | Moves chunking from `library.service.ts` to `@ChunkedArray({ chunkSize: 4000 })` decorator on `AssetRepository.createAll`. Return type changes from `Asset[]` → `string[]`. Conflicts with fork PR #246. See HIGH-RISK section below. |
| b03a649e7 | chore: version v2.7.1                                        | infra  | LOW        | Version bumps in package.json files (overwritten by branding script at deploy)                                                                                                                                                        |
| 6441c3b77 | fix: server build (#27599)                                   | infra  | LOW        | Removes accidentally-committed `tsconfig.build.tsbuildinfo`                                                                                                                                                                           |
| 6a63e814a | chore: version v2.7.2                                        | infra  | LOW        | Version bumps                                                                                                                                                                                                                         |
| 64766c8c0 | chore(deps): update github-actions (#27560)                  | CI     | LOW        | Renovate bumps for `docker/login-action`, `ruby/setup-ruby`, `github/codeql-action`, etc. — no behavioural changes                                                                                                                    |
| 6a361dae7 | fix(server): use randomized cron for version check (#27626)  | server | LOW        | Adds `VersionCheck` to `CronJob` enum (no fork collision). Touches `version.service.ts`, `api.service.ts`, `medium.factory.ts`. Fork untouched.                                                                                       |
| 781d568f2 | fix(docs): typo 'Start rating' → 'Star rating' (#27606)      | docs   | LOW        | 1 line                                                                                                                                                                                                                                |
| 55ab8c65b | fix(server): restore health check timeout (#27420)           | server | LOW        | `maintenance-health.repository.ts`, fork untouched                                                                                                                                                                                    |
| 2b0f6c920 | fix(mobile): improve image load cancellation (#27624)        | mobile | LOW        | Image provider widgets, fork untouched                                                                                                                                                                                                |
| ed0ec3091 | fix(docs): updated docker deprecation link (#27633)          | docs   | LOW        | 1 line                                                                                                                                                                                                                                |
| 8d67c1f82 | fix(server): people search not showing for ≤3 chars (#27629) | server | LOW-MEDIUM | `person.repository.ts` `getByName` switches to a CTE setting `pg_trgm.word_similarity_threshold = 0.5` and `%>` operator. Fork untouched at this method; SQL file regenerated.                                                        |
| 555391023 | fix(web): don't cache empty people search (#27632)           | web    | LOW        | `web/.../people-search.svelte`, fork untouched (this is upstream's people search, not our filter panel suggestions)                                                                                                                   |
| b5bed0230 | fix(mobile): provider refs in backup page (#27597)           | mobile | LOW        | `drift_backup.page.dart`, fork untouched                                                                                                                                                                                              |

### High-risk detail: PR #27595 (`2903b2653`) — library import batch size

**What upstream changed:**

- Extended the existing `@ChunkedArray` decorator (`server/src/decorators.ts`) to accept a `chunkSize` option (it always supported it via the underlying `Chunked`, but `ChunkedArray` wasn't exposing it).
- Decorated `AssetRepository.createAll` with `@ChunkedArray({ chunkSize: 4000 })`.
- Removed manual chunking from `LibraryService.handleSyncFiles`; service now calls `await this.assetRepository.createAll(assetImports)` once.
- Changed `createAll` return type from `Asset[]` (full rows) → `string[]` (just IDs).
- Updated `library.service.spec.ts` line ~563 mock from `mockResolvedValue([asset])` → `mockResolvedValue([asset.id])`.

**Why this affected the fork:**

- Fork PR #246 (`project_library_sync_param_limit.md`) added manual chunking in `library.service.ts:269-276` AND a fork-only test `'should chunk createAll calls to stay within postgres parameter limit'` at `library.service.spec.ts:621-644` that asserted `createAll` was called twice.
- The fork's "space face matching" describe block (4 tests at lines 635-712) used `mockResolvedValue([{ id: assetId } as any])` which fed objects into the iteration loop `for (const assetId of assetIds)` — works when `assetIds` is `Asset[]`, breaks when it's `string[]` because `assetId` becomes `{ id: '...' }` instead of a bare string.

**Verification of upstream's solution:**

- `4000 rows × 14 asset columns = 56,000` PG params per insert (well under the 65,535 limit).
- Fork's previous `4678 × 14 = 65,492` was right at the edge — upstream's static 4000 is more conservative.
- `@ChunkedArray` is the standard pattern used everywhere else in the repository layer; fork's manual chunking was a workaround that pre-dated the realization that the decorator already supported a custom `chunkSize`.

**Resolutions applied:**

1. Took upstream's one-liner in `library.service.ts`: `const assetIds = await this.assetRepository.createAll(assetImports);`
2. Removed unused `DATABASE_PARAMETER_CHUNK_SIZE` import from `library.service.ts`.
3. Deleted the fork-only chunking test (`'should chunk createAll calls to stay within postgres parameter limit'`) and its `DATABASE_PARAMETER_CHUNK_SIZE` import in `library.service.spec.ts`. The test is no longer meaningful at the service-test level because `@ChunkedArray` is bypassed by vitest mocks.
4. Updated four `space face matching` tests to use `mockResolvedValue([assetId])` (string array) instead of `mockResolvedValue([{ id: assetId } as any])`.

Result: 3799 server unit tests pass, including the four `space face matching` tests that exercise the new behaviour.

## Conflict Resolutions

### Conflict 1: `.gitignore`

- **Fork side**: added `.worktrees`
- **Upstream side**: added `*.tsbuildinfo` and `*.tsbuildInfo` (PR #27594)
- **Resolution**: combined — kept all three lines.
- **Risk**: LOW.

### Conflict 2: `server/src/queries/person.repository.sql` (during squashed-fork commit)

- **Fork side**: stale SQL with old `lower("person"."name") like ...` form (predated the upstream substring-matching fix from PR #26903 we already had)
- **Upstream side**: new CTE-based form using `set_config('pg_trgm.word_similarity_threshold', '0.5', true)` and `f_unaccent ... %> ...`
- **Resolution**: took upstream (HEAD). The fork's auto-generated SQL was simply out-of-date with its own TS code. `make sql` re-generated identical output afterwards.
- **Risk**: LOW. Generated file.

### Conflict 3: `server/src/services/version.service.spec.ts`

- **Fork side**: two new tests — `'should add a new version to upgrade history when version differs'` and `'should queue MemoryGenerate job when upgrading from a version older than 1.129.0'`.
- **Upstream side**: one new test — `'should create a version check cron job'` (uses `mocks.cron.create` and `CronJob.VersionCheck` from PR #27626).
- **Resolution**: combined — kept all three tests in the same describe block.
- **Risk**: LOW. Disjoint test additions.
- **Verification**: passes; `mocks.cron` factory was added by upstream's same commit in `medium.factory.ts`.

### Conflict 4: `mobile/pubspec.yaml`

- **Fork side**: `version: 1.0.0+1` (Play Store branding from `project_play_store_publishing.md`)
- **Upstream side**: `version: 2.7.2+3043`
- **Resolution**: took fork. Intentional Gallery branding.
- **Risk**: LOW.

### Conflict 5: `machine-learning/uv.lock` (during fork PR #120 replay)

- **Fork side**: requires-dist had `numpy>=2.3.4` and added `onnx>=1.20.1`.
- **Upstream side**: requires-dist had `numpy<2.4.0` (PR #27591 downgrade).
- **Resolution**: combined — kept upstream's `numpy<2.4.0` and fork's `onnx>=1.20.1`. `pyproject.toml` already auto-merged correctly to `numpy<2.4.0` + `onnx>=1.20.1`.
- **Follow-up**: ran `uv lock` after rebase to regenerate consistent lockfile state. Committed alongside other regenerated files.
- **Risk**: LOW-MEDIUM (lockfile resolution; uv lock confirmed it resolves cleanly).
- **Note**: an initial Edit attempt failed silently (read-first error), so the broken file was committed temporarily. This was caught and fixed by `uv lock` + a follow-up commit.

### Conflict 6: `docs/docs/install/requirements.md` (during fork PR #167 rebrand)

- **Fork side**: `Gallery requires the command docker compose; ... is no longer supported by Gallery.` with old link `https://docs.docker.com/compose/migrate/`.
- **Upstream side**: `Immich requires ...` with new link `https://docs.docker.com/retired/#docker-compose-v1-replaced-by-compose-v2` (PR #27633).
- **Resolution**: combined — Gallery wording with the new link.
- **Risk**: LOW.

### Conflict 7: `mobile/openapi/README.md` (binary, ~10 occurrences)

- **Fork side / upstream side**: every fork commit that touched `mobile/openapi/` regenerated this binary, conflicting on each replay.
- **Resolution**: took ours (HEAD) at every occurrence. `make open-api` regenerated the canonical version after the rebase completed.
- **Risk**: LOW. Generated file.

### Conflict 8: `server/src/services/library.service.ts` (during fork PR #246)

See HIGH-RISK section above.

### Conflict 9: `server/src/services/library.service.spec.ts` (during fork PR #246)

See HIGH-RISK section above. Removed obsolete chunking test + its `DATABASE_PARAMETER_CHUNK_SIZE` import.

### Conflict 10: `server/src/queries/person.repository.sql` (during a previous upstream sync report commit replay)

- Same situation as Conflict 2. Took ours (HEAD). `make sql` reconciles afterwards.

## Fork Feature Verification

| Feature                       | Status | Notes                                                                                                                                                                  |
| ----------------------------- | ------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Shared Spaces                 | OK     | All schema files, services, controllers, web routes, mobile pages intact. 21 fork migrations in `migrations-gallery/` preserved.                                       |
| Storage Migration             | OK     | Service, controller, S3 backend, web routes, dedicated CI workflows (`storage-migration-{e2e,tests}.yml`) preserved.                                                   |
| Pet Detection                 | OK     | ML model, schema columns, service intact.                                                                                                                              |
| User Groups                   | OK     | Tables, service, controller, web components intact.                                                                                                                    |
| Google Photos Import          | OK     | Web wizard, manager, utils intact.                                                                                                                                     |
| Image Editing                 | OK     | Edit manager, rotate action, server media service extensions intact.                                                                                                   |
| Auto-Classification           | OK     | Classification service, SystemConfig section, admin UI intact.                                                                                                         |
| Video Duplicate Detection     | OK     | Multi-frame CLIP encoding, duplicate.repository.ts intact.                                                                                                             |
| CLIP Relevance Threshold      | OK     | `machineLearning.clip.maxDistance` config intact.                                                                                                                      |
| Discord/GitHub Support UI     | OK     | Sidebar purchase-info and purchase-content swaps intact.                                                                                                               |
| Filter Panel                  | OK     | Generic filter panel, contextual suggestions, section selector, temporal picker intact.                                                                                |
| Unified Smart Search (Spaces) | OK     | `spacePersonIds` param + space-search utils intact.                                                                                                                    |
| Space Library Linking         | OK     | UNION query-through + library link tables intact.                                                                                                                      |
| Bulk Add to Spaces            | OK     | Background job + sidebar dropdown intact.                                                                                                                              |
| Activity Logging              | OK     | Activity table + feed component intact.                                                                                                                                |
| Collapsible Space Hero        | OK     | Hero component + storage util intact.                                                                                                                                  |
| Search Sorting (Spaces)       | OK     | Sort dropdown + CTE-based search repository sort intact.                                                                                                               |
| Dynamic Filter Suggestions    | OK     | Unified suggestions endpoint + faceted search intact.                                                                                                                  |
| Space Person Dedup            | OK     | Two-layer dedup (personId fallback + vector merge) intact.                                                                                                             |
| Checksum Tombstone (Dedup)    | OK     | Tombstone table + repository intact.                                                                                                                                   |
| Mobile Spaces                 | OK     | Bottom-nav tab, spaces page, space detail/members pages intact.                                                                                                        |
| Branding                      | OK     | `branding/scripts/apply-branding.sh`, branding config, logos, action.yml all intact.                                                                                   |
| Fork Migration Compatibility  | OK     | `CompositeMigrationProvider` intact, `allowUnorderedMigrations: true` intact, postbuild merge in `server/package.json` intact, 21 migrations in `migrations-gallery/`. |
| Structured JSON Logging       | OK     | Untouched.                                                                                                                                                             |

## CI and Infrastructure Verification

| Check                                             | Status | Notes                                                                                                                                               |
| ------------------------------------------------- | ------ | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| Workflow files (no upstream collisions)           | OK     | Only `.github/workflows/{build-mobile,cli,close-duplicates,codeql-analysis,docker,preview-label}.yml` changed — minor version bumps from PR #27560. |
| Docker image references (gallery-_, not immich-_) | OK     | `gallery-release.yml` (the actual fork release workflow) preserved with `ghcr.io/open-noodle/gallery-*` images.                                     |
| Branding (no "Immich" leaks in CI/config)         | OK     | No new upstream references; fork branding script untouched.                                                                                         |
| DCM disabled in `static_analysis.yml`             | OK     | `# run: dcm analyze ...` still commented out.                                                                                                       |
| `PUSH_O_MATIC` only in `merge-translations.yml`   | OK     | The single documented exception. All other workflows use `${{ github.token }}`.                                                                     |
| Fork-only files preserved                         | OK     | `gallery-release.yml`, `gallery-docs-deploy.yml`, `gallery-build-mobile.yml`, `storage-migration-{e2e,tests}.yml` all present.                      |
| New upstream workflows reviewed                   | OK     | None added.                                                                                                                                         |
| Action/tool versions compatible                   | OK     | All bumps are minor renovate updates of `docker/login-action`, `github/codeql-action`, `ruby/setup-ruby`, etc.                                      |

## Database Migration Analysis

### New Upstream Migrations

**None.** Upstream v2.7.0 → v2.7.2 contains zero new migrations. All 16 incoming commits are bug fixes / chores / version bumps.

### Timestamp Ordering

- Gallery migration interleaving: OK (no new upstream migrations to interleave with)
- Timestamp collisions: NONE (the existing `1775100000000` and `1777000000000` collisions in `migrations-gallery/` predate this rebase)

### Table Conflict Check

- Tables shared with gallery migrations: NONE (no upstream migrations in this rebase)
- Column/constraint conflicts: NONE

### Schema File Changes

- Fork-extended schema tables modified by upstream: NONE (no schema changes in this rebase)

### Postbuild Merge

- `postbuild` script intact: YES (`server/package.json`)
- Filename collisions: NONE
- `CompositeMigrationProvider` intact: YES (`server/src/repositories/database.repository.ts:24,532-534`)

## Inconsistencies Found

**One.** Fork's "space face matching" tests in `library.service.spec.ts` were silently relying on `assetIds` being `Asset[]`-shaped objects (`mockResolvedValue([{ id: assetId } as any])`). After upstream's PR #27595 changed `createAll` to return `string[]`, the iteration `for (const assetId of assetIds)` started yielding `{ id: '...' }` objects instead of bare strings, producing job payloads with `assetId: { id: ... }` instead of `assetId: '...'`. Fixed in commit `089a6c433` by changing the four test mocks to `mockResolvedValue([assetId])`.

No other inconsistencies detected after `make check-server`, `make check-web`, server unit tests (3799 passing), and web unit tests (1258 passing).

## Code Review Findings

Performed during conflict resolution and verification:

- Verified upstream's `@ChunkedArray({ chunkSize: 4000 })` is functionally equivalent and safer than fork's manual chunking (4000 × 14 cols = 56,000 params; fork's 4678 × 14 = 65,492, right at the limit).
- Verified `CronJob.VersionCheck` enum addition does not collide with fork's `CronJob` enum (fork only has `LibraryScan` + `NightlyJobs`).
- Verified `person.repository.ts` `getByName` change rebased cleanly — fork has not modified that method.
- Verified `mocks.cron.create` is added by upstream's same commit in `medium.factory.ts`, so the new test compiles.
- Verified all 21 fork migrations in `migrations-gallery/` are preserved.
- Verified `tsconfig.build.tsbuildinfo` was untracked (matches upstream's `.gitignore` add + `git rm` from PR #27599).

## Local CI Verification

| Check                | Status    | Notes                                                                                                       |
| -------------------- | --------- | ----------------------------------------------------------------------------------------------------------- |
| `make build-server`  | **PASS**  | Clean nest build, postbuild copies fork migrations into dist                                                |
| `make build-sdk`     | (pending) | To be run before push                                                                                       |
| `make check-server`  | **PASS**  | `tsc --noEmit` clean                                                                                        |
| `make check-web`     | **PASS**  | `tsc --noEmit` + `svelte-check` 0 errors / 0 warnings                                                       |
| `make lint-server`   | (pending) | To be run before push                                                                                       |
| `make lint-web`      | (pending) | To be run before push                                                                                       |
| Server unit tests    | **PASS**  | 3799 passing / 8 skipped (115 files)                                                                        |
| Web unit tests       | **PASS**  | 1258 passing / 1 skipped / 8 todo (114 files)                                                               |
| OpenAPI regeneration | **PASS**  | `make open-api` produced consistent output, regenerated `mobile/openapi/README.md` and other binaries       |
| SQL regeneration     | **PASS**  | `make sql` produced one new field in `getFaceForFacialRecognitionJob` (asset_face.assetId added), committed |

## Remote CI Verification

To be performed after Checkpoint 3 approval. Will push to `rebase/upstream-v2.7.2` test branch first.

## Post-Rebase Verification

- Fork commits ahead of upstream: **221** (219 fork commits + 1 regen commit + 1 test fix commit)
- Commits behind upstream: **0**
- Fork diff vs origin/main: 44 files changed, +227/-215 — mostly the 16 upstream commits' deltas plus regenerated specs.
- Fork diff looks clean: **YES**
