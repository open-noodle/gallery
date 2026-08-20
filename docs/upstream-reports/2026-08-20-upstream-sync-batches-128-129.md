# Upstream Sync Report — 2026-08-20 (batches 128–129)

## Summary

- **Upstream commits pulled**: 2 (`a066b5f301b`, `47c5a3dbf6d`)
- **Upstream commits QUARANTINED**: 3 (`e529557160d`, `f9f73114183`, `f88fb628ff5`)
- **Fork commits synced**: 0 — `integratedForkHead` already equals `origin/main` (`690fd44e12c`, #987)
- **Conflicts resolved**: 4 regions across 2 files, all in one hotspot file plus one test helper
- **Risk level**: LOW for what landed; the quarantined commit is HIGH and needs a product decision
- **Recommendation**: PROCEED with batches 128–129; hold `#30881` pending the config-visibility design

Branch is now level with `47c5a3dbf6d`, which is the **quarantine boundary**, not `upstream/main`.

## Product-direction gate — FIRED on `#30881`

`e529557160d` "feat: new config endpoints (#30881)" was stopped by the per-batch product gate and
`upstreamTargetHead` was set to `47c5a3dbf6d` (the commit immediately before it), so the two safe
commits still flowed in.

**What it does.** It deletes `server/src/config.ts`, `server/src/dtos/system-config.dto.ts` and
`server/src/dtos/model-config.dto.ts`, replacing them with a single zod-schema-driven
`server/src/dtos/config.dto.ts` in which every field carries a **visibility** annotation
(`ConfigVisibility.{Public,User,Admin}`), plus three new controllers
(`config-public` / `config-user` / `config-admin`) and a new `Permission.UserConfigRead`.

**Why it is a product question, not a merge question.** All three deleted files are files the fork
extends, and the replacement demands a deliberate visibility decision per fork config field:

| Deleted file                           | Fork delta | Fork surface at stake                                                                                                                                                                                                           |
| -------------------------------------- | ---------: | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `server/src/config.ts`                 |        +72 | `clip.maxDistance`, `facialRecognition.suggestions`, `petDetection`, `memories`, `server.mergePeopleAcrossOwners`, `classification`, `storageUsage`, 3 fork queue concurrencies, OpenFreeMap map tiles, fork version-check note |
| `server/src/dtos/system-config.dto.ts` |        +62 | Classification / Memories / StorageUsage zod schemas                                                                                                                                                                            |
| `server/src/dtos/model-config.dto.ts`  |        +33 | `PetDetectionConfigSchema`, CLIP threshold, face-suggestion config                                                                                                                                                              |

Two **fork-only** files import the deleted modules and would break outright:
`server/src/dtos/model-config.dto.spec.ts` (its entire subject disappears) and
`server/src/services/classification.service.ts`.

Deciding that e.g. `mergePeopleAcrossOwners` — a destructive cross-owner merge toggle — or
`classification.categories` is `Public`/`User`/`Admin` is an RBAC decision, not a mechanical merge.

**It is also explicitly unfinished upstream**: every new endpoint is tagged
`.alpha('v3.2.0')`. This is the same shape as Search V3 — pulling it now means re-expressing the
fork's config against a moving target, plus absorbing ~3237 lines of OpenAPI and ~1133 lines of SDK
churn.

`f9f73114183` (#30891, consumes the new public config) depends on it. `f88fb628ff5` (#30821, an
unrelated and useful Flutter iOS-simulator build patch) sits _after_ it in history, so it is held
only by commit ordering and should ride in with the config batch once that is decided.

## Incoming Upstream Changes (landed)

| SHA           | Summary                                                                | Area           | Risk to Fork | Notes                                                                                                                                                         |
| ------------- | ---------------------------------------------------------------------- | -------------- | ------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `a066b5f301b` | fix(mobile): order album/place/person timelines by local date (#29338) | mobile         | MEDIUM       | Threads `groupBy` into 3 private methods, adds file-level `_assetDateOrder`. Collided with the fork's heavily extended timeline repository (1085 fork lines). |
| `47c5a3dbf6d` | refactor: api key response dto (#30887)                                | server/web/e2e | LOW          | Flattens `ApiKeyCreateResponseDto`, keeps `apiKey` as deprecated. Fork delta on all three source files is zero; applied with no conflicts.                    |

## Conflict Resolutions

### Conflict 1 — `mobile/lib/infrastructure/repositories/timeline.repository.dart` @ fork `b99a462717f` (#337)

- **Fork side**: #337 adds shared-space visibility to the video/place/map/marker queries, giving
  `place` and `_getPlaceBucketAssets` extra `userIds` / `currentUserId` parameters.
- **Upstream side**: #29338 threads `groupBy` into `_getPlaceBucketAssets` / `_getPersonBucketAssets`
  and replaces their `orderBy` with `_assetDateOrder(...)`.
- **Resolution**: git had misaligned fork's `_getVideoBucketAssets` header against upstream's
  `_getPlaceBucketAssets` header. Kept fork's method ordering and signatures **and** layered
  upstream's `groupBy` parameter and threading on top, so both intents survive.
- **Risk**: LOW — verified.
- **Verification**: 0 conflict markers; each method defined exactly once; brace balance identical to
  fork #337's own version of the file (96/96).

### Conflict 2 — same file @ fork `bb16aacbe29` (#625, timeline grouping display modes)

- **Fork side**: #625 adds a `temporalScope` parameter to the same six call sites/signatures.
- **Upstream side**: the same #29338 `groupBy` threading.
- **Resolution**: seven conflict regions. Rather than hand-merging them, reconstructed the file as
  **fork #625's own version + upstream #29338's seven edits re-applied**, per the skill's
  "re-apply upstream's structural change, then layer fork's additions" rule. `groupBy` and
  `temporalScope` now coexist on all six sites.
- **Risk**: LOW — verified.
- **Verification**: confirmed upstream's _only_ delta to this file across the batch is #29338;
  all 3 `_assetDateOrder` call sites plus its single definition present; the one remaining
  `if (isAscending)` block is byte-identical to the one upstream deliberately left in place
  (the bucket-count query ordering by `dateExp`).

### Conflict 3 — same file @ fork `5b985fda487` (#679)

- **Both sides** added new top-level helpers at the same insertion point (upstream's
  `_assetDateOrder`; fork's `_buildBuckets` / `_orderedForGrouping` / `_localBucketDate`).
- **Resolution**: kept both.
- **Risk**: LOW. Brace balance 144/144.

### Conflict 4 — `mobile/test/medium/repository_context.dart` @ fork `1de54241d10` (#966/#971)

- **Fork side**: `Value<DateTime?> localDateTime = const Value.absent()` — deliberately introduced so
  fixtures can express an asset with **no** localDateTime (design item S13; `remote_asset.localDateTime`
  is nullable). Many fork tests pass `localDateTime: Value(...)`.
- **Upstream side**: #29338 added a plainer `DateTime? localDateTime`, which cannot express
  explicit-null versus absent.
- **Resolution**: kept the fork's strictly more expressive signature and **adapted upstream's six new
  call sites** in `mobile/test/medium/repositories/timeline_repository_test.dart` to wrap in
  `Value(...)`. `package:drift/drift.dart` was already imported there.
- **Risk**: LOW — verified by running upstream's own two new tests (below).

## Fork Feature Verification

| Feature                               | Status | Notes                                                                              |
| ------------------------------------- | ------ | ---------------------------------------------------------------------------------- |
| Shared Spaces                         | OK     | `sharedSpace` / `spaceAlbum` timeline queries intact; 160 mobile medium tests pass |
| Storage Migration                     | OK     | Untouched by this batch                                                            |
| Pet Detection                         | OK     | Untouched                                                                          |
| Image Editing                         | OK     | Untouched                                                                          |
| Branding                              | OK     | No `i18n/` or branding-script files touched                                        |
| Google Photos Import                  | OK     | Untouched                                                                          |
| Mobile shared-space visibility (#337) | OK     | Both fork params and upstream `groupBy` preserved                                  |
| Space album sort parity (#966/#971)   | OK     | Fork's `Value<DateTime?>` fixture capability retained                              |

## Post-Rebase Audits

| Check                               | Batch 128         | Batch 129                   |
| ----------------------------------- | ----------------- | --------------------------- |
| Fork-Owned File Survival            | OK                | OK                          |
| Fork Extension Symbol Survival      | OK                | OK                          |
| Gallery Migration Count (58)        | OK                | OK                          |
| Gallery Migration Filename Survival | OK                | OK                          |
| Gallery Migration Manifest Coverage | OK                | OK                          |
| Migration Timestamp Collision Check | OK                | OK                          |
| Generated Artifact Review           | OK                | ISSUE — reviewed, see below |
| `ci-invariants-check`               | OK (3/3)          | —                           |
| `fork-patches-check`                | OK (`@immich/ui`) | —                           |
| `mobile-drift-rebase-check`         | OK                | —                           |

**Generated Artifact Review (batch 129)** — informational, reviewed and clean. The audit flags that
upstream regenerated `open-api/immich-openapi-specs.json`. Verified directly: the spec carries
upstream's flattened `ApiKeyCreateResponseDto` (`id`/`name`/`createdAt`/`updatedAt`/`permissions`/
`secret`/`apiKey`) **and** all 50 fork paths (252 total). No Dart-client drift is possible here —
`mobile/openapi` is not committed on this branch; the client is generated into gitignored
`mobile/generated/openapi` (495 models) at codegen time.

## Zero-Conflict Semantic Break Detectors

Run against the correct upstream-to-upstream range `47dccf72834..47c5a3dbf6d`:

| Detector                                                             | Result                        |
| -------------------------------------------------------------------- | ----------------------------- |
| Silent-noop (deleted literals still literal-matched by fork tooling) | Clean                         |
| i18n branding-override gap                                           | N/A — no `i18n/` file touched |
| Shape I (added file whose path fork history once owned)              | Clean                         |
| Deleted exports in `e2e/src`                                         | None                          |

A first run of these detectors used the fork tip as the baseline, which inverts all 1210 fork commits
and produced ~50 false positives; the range above is the correct one.

## Database / Mobile Drift Migrations

- New upstream migrations: **none**. No file under `server/src/schema/migrations/` or
  `migrations-gallery/` changed, so `scripts/revert-to-immich.sql` coverage is unchanged from
  batch 127 and needs no update this cycle.
- Gallery migration count: **58** (expected 58).
- `pnpm build` postbuild: `Synced 58 Gallery migrations into dist/schema/migrations; removed 0 stale
files; wrote 1 compatibility aliases` — the load-bearing `ChangeDurationToInteger` alias is intact.
- Mobile Drift: no `schemaVersion` change, no new snapshots; `mobile-drift-rebase-check` OK.

## Pattern Propagation

| Refactor                              | Old → New Pattern                                         | Fork Files Affected                                                                         | Decision     | Notes                                                                                                                                                                                                                                                            |
| ------------------------------------- | --------------------------------------------------------- | ------------------------------------------------------------------------------------------- | ------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Local-date timeline ordering (#29338) | `orderBy([desc(createdAt)])` → `_assetDateOrder(groupBy)` | Fork's `sharedSpace`, `spaceAlbum` and video timeline queries in `timeline.repository.dart` | **Deferred** | Upstream applied it to album/place/person only. The fork's space timelines still order by `createdAt`, so a shifted-date asset sorts differently in a Space than in an album. Not a regression introduced here — it is a new consistency gap. Worth a follow-up. |

## Local CI Verification

| Check                                            | Status  | Notes                                                                                                                                                                                                                                                    |
| ------------------------------------------------ | ------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `server pnpm build` (+ postbuild migration sync) | PASS    | 58 migrations, 1 alias                                                                                                                                                                                                                                   |
| `server pnpm check` (tsc)                        | PASS    | Clean                                                                                                                                                                                                                                                    |
| `web check:typescript`                           | PASS    | Clean                                                                                                                                                                                                                                                    |
| `web check:svelte`                               | PASS    | 622 files, 0 errors, 0 warnings                                                                                                                                                                                                                          |
| `e2e pnpm check` (tsc)                           | PASS    | See stale-SDK note below                                                                                                                                                                                                                                 |
| `server pnpm lint` (eslint)                      | PASS    | `--max-warnings 0`                                                                                                                                                                                                                                       |
| `server prettier --check .`                      | PASS    |                                                                                                                                                                                                                                                          |
| `e2e pnpm lint`                                  | PASS    |                                                                                                                                                                                                                                                          |
| `e2e prettier --check .`                         | PASS    |                                                                                                                                                                                                                                                          |
| `web eslint` (`tscompat` off)                    | PASS    | 0 errors. Its 13 warnings are all "unused eslint-disable directive for `tscompat/tscompat`", induced by disabling that rule locally to dodge the known plugin crash; CI runs the rule, so those directives are used and the warnings do not occur there. |
| `web prettier --check .`                         | PASS    |                                                                                                                                                                                                                                                          |
| Server unit tests                                | PASS    | 177 files, 5737 passed, 12 skipped                                                                                                                                                                                                                       |
| Web unit tests                                   | PASS    | 363 files, 5694 passed, 2 skipped, 8 todo                                                                                                                                                                                                                |
| `dart analyze --fatal-infos`                     | PASS    | No issues found                                                                                                                                                                                                                                          |
| `dart format --set-exit-if-changed`              | PASS    | lib + the two edited test files                                                                                                                                                                                                                          |
| `flutter test`                                   | PASS    | 3356 passed, 1 skipped                                                                                                                                                                                                                                   |
| `flutter test test/medium/`                      | PASS    | 160 passed, incl. upstream's two new #28852 ordering tests                                                                                                                                                                                               |
| `.github` prettier                               | N/A     | No workflow file touched                                                                                                                                                                                                                                 |
| `make sql`                                       | SKIPPED | No repository method changed; requires a running DB                                                                                                                                                                                                      |

**Stale local SDK build, not a rebase defect.** `e2e pnpm check` first failed with six
`Property 'id' does not exist on type 'ApiKeyCreateResponseDto'` errors. The SDK **source**
(`packages/sdk/src/fetch-client.ts`) was correct; `packages/sdk/build/` was pre-rebase. After
`mise run //:sdk:build` the check is clean. Worth remembering: the e2e type check is the gate that
surfaces this, and it reads the _built_ SDK.

**Mobile codegen is required before `dart analyze` means anything.** `mobile/.gitignore` ignores
`lib/**/*.drift.dart`, so a first analyze run reported 200 errors that were purely absent generated
code. After `dart run build_runner build`, `drift_dev schema generate` and pigeon, analyze is clean.
Note also that `dart analyze --fatal-infos | tail` masks the real exit code — read the summary line,
not `$?` after a pipeline.

## Remote CI Verification

- **Test branch**: `rebase/upstream-batch-129`
- **Commit validated**: `cdaa5065684`

**10/10 green.** All ten workflows dispatched and all concluded `success`:

| Workflow                                  | Status |
| ----------------------------------------- | ------ |
| `test.yml`                                | GREEN  |
| `docker.yml`                              | GREEN  |
| `static_analysis.yml`                     | GREEN  |
| `gallery-build-mobile.yml`                | GREEN  |
| `gallery-mobile-smoke.yml`                | GREEN  |
| `gallery-ml-smoke.yml`                    | GREEN  |
| `gallery-rebase-smoke.yml`                | GREEN  |
| `gallery-revert-to-immich-validation.yml` | GREEN  |
| `storage-migration-tests.yml`             | GREEN  |
| `storage-migration-e2e.yml`               | GREEN  |

- **Failures fixed**: none — no workflow failed, so no re-dispatch was needed.
- **Confirmed flakes**: none.

Commits added to the branch after this SHA are documentation only (this report and the
`#30881` port design spec) and do not affect the validated build.

## Post-Rebase Verification

- Fork commits ahead of the quarantine boundary: 1210
- Commits behind `47c5a3dbf6d`: 0
- Commits deliberately held from `upstream/main`: 3
- Net delta versus the previous branch tip is exactly upstream's 10 files — the conflict resolutions
  preserved fork content and contribute no spurious diff.
