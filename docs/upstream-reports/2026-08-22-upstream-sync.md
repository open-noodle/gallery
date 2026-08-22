# Upstream Sync Report — 2026-08-22

## Summary

- **Upstream commits pulled**: 19 (`11b1aa5ecf7..2237b28813d`)
- **Batches**: 13 planned (133–145), run as 6 replays (see "Deviation from the batch plan")
- **Conflicts resolved**: 21 by hand + 9 auto-resolved in proven-mechanical classes
- **Fork-side reconciliation commits**: 5 (asset-file/download, branding + Drift steps, OpenAPI regen, mobile freezed, web lint debt)
- **Option-M debt repaired**: 6 defects — 4 mechanical (see "★ Option-M debt this cycle exposed") + 2 DTO-boundary drops, one of them a live admin-console bug
- **Upstream bug worked around**: 1 (single `PUT /assets/:id` locking an asset 400s on a non-elevated session)
- **CI flake fixed rather than retried**: 1 (unauthenticated js-pdk fetch in the plugins stage)
- **Risk level**: MEDIUM
- **Recommendation**: PROCEED — level with `upstream/main` (0 behind), all audits and local gates green

This is a **rolling cycle**, not a cutover. The branch stays off `main`: upstream has not released a
tag past `v3.1.0`, so the standing landing rule is not satisfied.

Starting state: `58a1ca590ec`, based on `11b1aa5ecf7` (#30739, the option-M landing). Fork main was
already fully integrated (`integratedForkHead` == `origin/main` == `690fd44e12c`), so no
`upstream-sync-fork-main` was needed this cycle.

## ★ Option-M debt this cycle exposed

**The 19 upstream commits were not the hard part of this cycle.** The first CI dispatch after the
option-M landing found four defects in that landing, none of them caused by this sync. They are
recorded here because the pattern matters more than the individual fixes.

**Why they were invisible until now.** Nothing from the option-M cycle was ever pushed — the last CI
run on the rolling branch was batch 131 on 2026-08-20, _before_ the landing — so this dispatch is the
first time option M has seen CI at all. Every defect below sits in a layer the local gates do not
execute: raw SQL (invisible to `tsc`), generated `.sql` docs (needs a live DB), and a Docker-boot
drift check against the tagged release image.

| #   | Defect                                                                                                                                                                                     | Found by                                                                                     |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------- |
| 1   | `revert-to-immich.sql` restored the `trigger_person_delete_audit` override with #30739's `pg_trigger_depth() <= 1`; tagged v3.1.0 seeds `= 0`, so a reverted DB reports schema drift       | Revert-to-Immich Validation (Docker-boot half, runs against `:main`)                         |
| 2   | 51 e2e raw-SQL sites across 15 files still used `person.id` / `asset_face."personId"` / `personId` on the three fork face-review tables                                                    | Storage Migration E2E: `column "id" does not exist`                                          |
| 3   | Five `INSERT INTO "person" (…) RETURNING id` fixtures — `personGroupId` is a **foreign key** to `person_group` and part of the composite PK, not generated, so these could not work at all | pet-detection + gallery-map e2e (they have no SQL of their own; they use the shared helpers) |
| 4   | `server/src/queries/*.sql` never regenerated after the `withPerson` / `withFacesAndPeople` fix changed the emitted SQL                                                                     | SQL Schema Checks (runs `sync-sql` against a live DB and diffs)                              |

**The generalisable lesson**: a re-key of this size is only as complete as the layers you can execute.
`tsc` covered the server; the unit and medium suites covered its behaviour; but the e2e layer talks to
Postgres in string literals, and the generated SQL docs and the revert script are only checked by jobs
that need a database or a container. The option-M memory already recorded "sync-sql against a live DB
is the ONLY thing that finds broken raw SQL" — that was applied to `server/src`, and the same sweep was
never run against `e2e/src`, which has no `@GenerateSql` decorators and so is not covered by `sync-sql`
at all. **After any column re-key, grep `e2e/` for raw SQL explicitly; it is a separate surface.**

Fixes: `00d603ba78c` (re-key + revert script), `53048a92f21` (regenerated SQL docs), and the
person_group seeding commit. `sync-sql` was re-run against a fresh migrated database as part of the
repair: 157 migrations apply, `migrations:generate` reports no changes, all 680 decorated queries
execute with no `column does not exist`.

## ★ A fifth failure — and it is UPSTREAM's, not option M's

Once the four above were fixed, one e2e failure remained (1 of 1275). It is worth its own section
because the obvious inference — "more option-M debt" — was **wrong**, and only a local reproduction
settled it.

`PUT /assets/:id` with `{visibility: locked}` returns **400 while the write succeeds**:

1. `AssetService.update` writes the visibility, then ends with `return this.get(auth, id)`.
2. `get` calls `requireAccess(AssetRead)` → `AssetAccess.checkOwnerAccess`, which carries
   `.$if(!hasElevatedPermission, eb => eb.where('asset.visibility', '!=', Locked))`.
3. A non-elevated session therefore cannot read back the asset it just locked, and `requireAccess`
   throws `BadRequestException` → 400.

Confirmed by reproducing against a stack built from this branch and then observing the asset as
`locked` in the database _after_ the failing call — the write landed, only the response failed.

**It is upstream's code.** `git show upstream/main:server/src/services/asset.service.ts` ends `update`
with the identical `return this.get(auth, id)`. It is invisible upstream because the **bulk** endpoint
(`updateAll`) returns void and never reads back — which is also why every other fork spec that locks an
asset passes: they all go through `updateAssets`. These two specs deliberately use the single endpoint
(the bulk path strips Locked assets from every album, making the case vacuous), so they are the only
callers in the tree that reach it.

Fixed on the **test** side (`a2746608515`), not the product side: a real client must hold a
PIN-verified session to use the locked folder at all, and the fork's own medium test already sets
`hasElevatedPermission` for exactly this transition. Patching `update()` fork-side would be a
behavioural divergence inside a file upstream owns — a guaranteed recurring conflict — for a case real
clients never hit. New `utils.elevateSession` (idempotent; `setupPinCode` 400s if a PIN already exists).

**Three process notes worth keeping:**

- **Two cheap hypotheses were both wrong**, and each was disproved in seconds rather than assumed: the
  DTO parses `{visibility:'locked'}` fine, and a medium test calling `sut.update(...)` with the full
  album+space fixture passes. The medium repro only passed because I had written
  `hasElevatedPermission: true` into the auth fixture — copying the existing spec's helper hid the very
  thing being tested. **When a repro passes, check what the fixture is quietly granting.**
- **A local full-suite run needs a control.** The first local run showed 53 failures against CI's 1,
  which looks alarming. Re-running the same suite with the change stashed gave **55** failures across
  **9** files versus **53** across **6** — so the change strictly improved things and the residual is
  local-stack environmental (`cli/*`, `library`, `tag`, `trash`). Without the control run the honest
  reading of "53 failures" is unavailable.
- **The e2e server suite is pre-job gated**, so it had not run on the rolling branch for many cycles
  (batch 131's run was CLI-only, 2 files / 20 tests). A gate that does not run is not a gate — this is
  the same lesson as the unwired `branding/scripts` regression tests.

## ★★ The DTO-boundary class — two more option-M defects, one of them live

The last web-e2e failure led to the most consequential finding of the cycle, and to an audit that found
a second instance.

**The defect.** Option M renamed the person key to `personGroupId` everywhere in storage, and the
documented boundary is: _storage uses `personGroupId`; the DTO and the web read `personId`, which under
M IS the person_group id; repositories alias back out_. Two places never got the alias:

| Where                                             | Impact                                                                                                                                                                                                                |
| ------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `getLatestScanStatus` → `FaceRepairScanStatusDto` | **LIVE**: `GET /admin/face-repair/scan/latest` returned rows with no `personId`. The face-cleanup console rendered its header ("6 flagged faces across 1 people") but could not render or act on a single person row. |
| `listDeclines` → `FaceRepairDeclineListDto`       | Latent: `GET /admin/face-repair/decline` has no consumer in web or e2e today. Fixed anyway so the endpoint matches its published contract.                                                                            |

**Why `tsc` was blind — and this is the reusable part.** `face-repair-admin.controller.ts` returns
**15 of its 17 endpoints through an `as` cast**:

```ts
return this.service.getLatestScanStatus() as Promise<FaceRepairScanStatusDto | null>;
return this.service.listDeclines() as unknown as Promise<FaceRepairDeclineListDto>;
```

A cast asserts a shape nothing verifies, so a field can vanish across the boundary in total silence.
This is `feedback_tsc_green_means_nothing_on_a_rekey` in its purest form: the whole M convergence
type-checked clean _because_ these casts absorbed the mismatch.

**The audit, and its bound.** The class is enumerable, so it was walked exhaustively rather than
sampled. Casts by controller: `face-repair-admin` **15**, `asset` 1, `search` 1 — everywhere else tsc
verifies the boundary, which is why nothing else in the M re-key drifted. Of the 8 DTOs declaring a
`personId`, every response producer in the risky controller was checked:
`getPersonFlaggedFaces` ✓, `listResolutions` ✓ (`fpv.personGroupId as personId`), `runRepair` /
`summarizeRepairPlan` ✓, `getPersonMetadata` ✓, `searchOwnerPeople` ✓ (`person.personGroupId as id`),
`createOwnerPerson` ✓, `getClusterFaces` ✓ (no person key). **Two defects, both now fixed.**

**A test that asserted the implementation instead of the contract.** The declines medium spec asserted
`row.personGroupId` — the internal name — so it passed happily while the DTO was wrong. Typing the row
correctly made tsc flag all three assertion sites at once. That is the argument for typing the row
rather than casting at the controller, and it generalises: **after a re-key, a test that reads the
internal field name cannot detect a broken boundary.**

The scan fix is pinned by a medium assertion **proved red against the unfixed service**
(`expected undefined to be '4c5a…'`), so the next re-key cannot repeat it silently.

Three e2e seeds that hand-write the `face_repair_scan.persons` JSONB were emitting the pre-M key too —
a JSON blob is invisible to `tsc` and to the raw-SQL sweep alike, so it needs its own pass.

## ★ One CI flake, fixed rather than retried

`End-to-End Tests (Web)` failed its Docker build with `extism-js: not found`. The plugins stage fetches
js-pdk from GitHub via `mise exec`; unauthenticated that is 60 requests/hour per runner IP, so it 403s,
mise skips the install, and the build dies at the first `extism-js` call.

Established as not-a-regression before touching it: the `mise exec` line and every compose field
touching that fetch are byte-identical to the pre-cycle tip, the same Dockerfile built successfully in
three earlier runs the same day, and `Docker` passed on the very same sha.

The fix was available and unused: `test.yml` already exports `GITHUB_TOKEN` for that compose build (the
line deliberately preserved during the batch-134 reconciliation), but **nothing consumed it** — the
token was plumbed most of the way and dropped. The compose file now forwards it as a BuildKit secret and
the plugins stage mounts it, optionally (`if [ -f /run/secrets/github_token ]`), verified by a
`--no-cache` build with no token supplied.

## Incoming Upstream Changes

| SHA           | Summary                                              | Area       | Risk to Fork | Notes                                                                                                                                         |
| ------------- | ---------------------------------------------------- | ---------- | ------------ | --------------------------------------------------------------------------------------------------------------------------------------------- |
| `c8199ef32fe` | flutter-maplibre-gl 0.27.0 (#30892)                  | mobile     | LOW          | pubspec only                                                                                                                                  |
| `24532c4d821` | fix(ci): docker caching (#30894)                     | CI/build   | **HIGH**     | Restructured `server/Dockerfile` into a `builder→sdk→plugin-sdk→server` stage chain; deleted the e2e registry-cache mechanism from `test.yml` |
| `c7f6197e755` | oauth account management url (#30873)                | server/web | MED          | Touches `config.dto.ts`, a fork-owned leaf since the #30881 port                                                                              |
| `c7531a36f9e` | refactor: partner e2e (#30895)                       | e2e→medium | LOW          | No fork content in the moved file                                                                                                             |
| `c9776fb9908` | download archives via POST forms (#30021)            | web/server | **HIGH**     | Moved content-disposition onto `ImmichReadStream`, which the fork had narrowed                                                                |
| `8ce6b18563c` | library exclusion patterns (#30850)                  | server     | MED          | Renamed `globToSqlPattern` → `globToPostgresRegex` and changed `like` → `~`                                                                   |
| `4c26a7ca761` | refactor: activity e2e (#30896)                      | e2e→medium | **HIGH**     | Deleted an e2e spec holding fork-only Shared-Spaces RBAC tests                                                                                |
| `a490cea1c49` | dedupe stale remote_asset rows (#28445)              | mobile     | MED          | `sync_stream_repository_test.dart` is +1791 fork-diverged                                                                                     |
| `57ce9b2221e` | correct asset dimensions from exif (#29244)          | server     | MED          | Added tests to a fork-extended medium spec                                                                                                    |
| `47c0dea07fa` | grafana docker tag (#30835)                          | infra      | LOW          | one line                                                                                                                                      |
| `8ae98f2a046` | quote database owner in restore (#30905)             | server     | LOW          | one line                                                                                                                                      |
| `caea849fee5` | **asset file apis (#25900)**                         | server API | **HIGH**     | New controller/service/repository/DTO, 3 permissions, new `BaseService` slot                                                                  |
| `2f48a8aab48` | refactor: memory e2e (#30906)                        | e2e→medium | MED          | fork has +409 in the medium spec                                                                                                              |
| `37e033a09d2` | **freezed migration (#30907)**                       | mobile     | **HIGH**     | 24 classes; hit a fork-deleted file and two standing fork divergences                                                                         |
| `79c4c00f70c` | **tag renaming v2 (#27909)**                         | web/server | **HIGH**     | Add/add collision on a fork-authored 16 KB medium spec                                                                                        |
| `a36fb677361` | bottom bar icon/font align (#30890)                  | mobile     | LOW          | 3 lines                                                                                                                                       |
| `7412079f88d` | search filter animation (#30866)                     | web        | LOW          | upstream search-bar only                                                                                                                      |
| `11cdfa9c5e3` | remove committed `db.repository.steps.dart` (#30910) | mobile     | MED          | Made the file generated + gitignored                                                                                                          |
| `2237b28813d` | delete local copies on lock (#29730)                 | mobile     | MED          | Added an i18n key naming the upstream product                                                                                                 |

### Product-direction gate

Applied per batch. **No batch tripped it**; nothing was quarantined.

The three candidates were read against fork product surface:

- **#25900 asset file apis** — three owner-scoped, `alpha`-tagged read/delete/download endpoints over
  the existing `asset_file` table. It does not rework sharing, add a sync contract, or duplicate
  Shared Spaces; its new permissions are additive `case` arms in `access.ts`. Upstream's own feature.
  It did produce one fork-side defect, fixed in-cycle — see Inconsistencies.
- **#27909 tag renaming v2** — upstream extending their own tag feature (renames the leaf segment of
  a tag path). The fork consumes tags in filters and search but owns no competing rename model.
- **#30873 oauth account management url** — a single config field.

## Deviation from the batch plan

Batches 133 and 134 were run individually with their full audits. Batches **135–141** — the LOW/MEDIUM
commits sitting before #25900 — were collapsed into a single replay, because each batch means a full
1,258-commit replay and those seven carried no gate-relevant risk. Conflicts still surface per **fork**
commit, so attribution is unchanged; only the audit runs were deferred to the end of the group (they
were green). Batches 142, 143, 144 and 145 were run separately, each with audits, because each carried
a HIGH-risk upstream commit.

## Conflict Resolutions

### Conflict: `server/Dockerfile` (×5, fork commits #323, "repair batch 143", the two SDK-reorder commits, the lockfile-regen commit)

- **Fork side**: a build-before-inject sequence in the server/web/cli/plugins stages (install the SDK,
  build it, then install the consumer) working around `injectWorkspacePackages` snapshotting a
  build-less SDK on a cold build; plus `COPY patches`, a rewritten plugins stage, and
  `SHARP_IGNORE_GLOBAL_LIBVIPS` on the web install.
- **Upstream side**: #30894 split the image into a `builder→sdk→plugin-sdk→{server,web,cli,plugins}`
  chain, so each consumer stage inherits an already-built SDK, and unified the pnpm cache id.
- **Resolution**: took upstream's structure. It implements the fork's build-before-inject intent
  _natively_, so the fork's per-stage duplication was dropped as redundant (including a leftover SDK
  rebuild in the plugins stage). Carried forward the genuinely fork-specific parts: `COPY patches`,
  the plugins stage's no-`mise install` rationale + binaryen + `mise exec js-pdk`, its distinct
  `mise-plugin-tools-*` cache id, and `SHARP_IGNORE_GLOBAL_LIBVIPS` re-attached to upstream's web
  install line.
- **Risk**: MEDIUM — only `docker.yml` exercises it.
- **Verification**: Shape-D assertion run — every stage inherits `WORKDIR /usr/src/app` and all five
  `COPY --from=<stage>` source paths agree with it.

### Conflict: `.github/workflows/test.yml` (×3)

- **Fork side**: `GITHUB_TOKEN: ${{ github.token }}` on both "Start Docker Compose" steps; the build-cache
  ref rewritten from `ghcr.io/immich-app/...` to `ghcr.io/${{ github.repository }}-build-cache`;
  readiness/diagnostics steps.
- **Upstream side**: deleted the Setup Buildx / GHCR login / Resolve-build-cache steps and the
  `E2E_CACHE_*` env entirely.
- **Resolution**: honoured upstream's deletion, kept the fork's `GITHUB_TOKEN` line. `e2e/docker-compose.yml`
  wires the `github_token` BuildKit secret from that variable, and the plugins stage needs it to avoid
  GitHub rate limits — so it is load-bearing. The fork's cache-namespace rewrite is a **Shape D** case:
  its upstream anchor is gone, and the intent (never push Gallery cache into Immich's namespace) is
  satisfied by the deletion. The readiness/diagnostics steps merged cleanly and survive.
- **Risk**: LOW. **Verification**: `.github` prettier gate green; no `immich-server-build-cache` ref remains.

### Conflict: `packages/e2e-auth-server/Dockerfile`

- **Fork side**: plain `pnpm install` (the fork isolates this package as its own pnpm workspace with no
  committed lockfile, so `--frozen-lockfile` fails).
- **Upstream side**: narrowed the COPY to just `package.json` before install, for layer caching.
- **Resolution**: took upstream's ordering but copied `pnpm-workspace.yaml` alongside the manifest —
  without it pnpm walks up to the monorepo root and resolves against the wrong lockfile, silently
  collapsing the fork's isolation. Kept the non-frozen install.
- **Risk**: MEDIUM — a silent wrong-lockfile resolve would only show at e2e runtime.

### Conflict: `server/src/utils/misc.spec.ts` + `server/src/repositories/asset.repository.ts` (×3)

- **Upstream side**: #30850 replaced `globToSqlPattern` (SQL `LIKE` pattern) with `globToPostgresRegex`
  (Postgres regex) and switched the predicate operator from `like` to `~`.
- **Resolution**: took the fork's wider import list with the symbol renamed, and swapped the fork-carried
  copy of upstream's _old_ test block for upstream's new one (the fork's copy was byte-identical to
  upstream's old one — no fork content). In `asset.repository.ts` the rename was unioned with the fork's
  `spaceAssetPathBranches` / `spaceVisibilityGate` imports (and the #749 revert's deletion honoured).
- **Risk**: MEDIUM — a mechanical rename that left `like` in place would silently match nothing.
- **Verification**: swept for `globToSqlPattern` across `server/src`, `web/src`, `e2e/src` — zero hits;
  confirmed the exclusions predicate now uses `'~'` while the import-path prefix match keeps `'like'`.

### Conflict: `e2e/src/specs/server/api/activity.e2e-spec.ts` (delete/modify)

- **Upstream side**: #30896 **deleted** the file, migrating its tests to
  `server/test/medium/specs/services/activity.service.spec.ts`.
- **Fork side**: the file also holds three fork-authored Shared-Spaces RBAC tests (album-level activity
  denied to space-only readers, commenter-email redaction, statistics scoping — issue C1/M5).
- **Resolution**: kept the file, reduced to the fork's own describe block plus the scaffolding it needs.
  Upstream's three migrated describes were dropped (they are one-for-one in the new medium spec).
  Pruned the now-unused imports and fixtures.
- **Risk**: MEDIUM — silently deleting the file would have lost fork-only permission-boundary coverage
  with no test failure anywhere.
- **Verification**: `eslint` + `prettier` clean on the file; 3 tests retained.

### Conflict: `server/test/medium/specs/repositories/tag.repository.spec.ts` (add/add)

- **Both sides created a file at this path.** The fork owns a 16 KB space-RBAC suite for `getAll`
  (12 GRANT/DENY cases from #752); #27909 added a new file with a `describe('update')` block.
- **Resolution**: union into one `describe(TagRepository.name)` — the fork's imports/helpers/`setup`
  (which uses `real: [TagRepository]`, a superset of upstream's `real: []`), then upstream's `afterEach`
  and `update` block, then the fork's `getAll` matrix.
- **Risk**: MEDIUM — the naive outcome is two concatenated file bodies that do not parse.
- **Verification**: brace/paren balance 0/0, esbuild parse gate passed, 12 tests + 7 helper references retained.

### Conflict: `mobile/lib/models/search/search_filter.model.dart` (×3, freezed)

- **Upstream side**: #30907 converted the SearchFilter family to freezed, deleting the hand-written
  `copyWith`/`toString`/`==`/`hashCode`.
- **Fork side**: three separate fork commits add, in turn, an `empty()` factory plus `SetEquality`/
  `ListEquality` deep-equality helpers; a `sort` field (`SearchSortOrder`); and a `Set<Person>` →
  `Set<FilterPerson>` type change.
- **Resolution**: took freezed's shape and re-expressed only the genuine deltas — kept `empty()`, added
  `@Default(SearchSortOrder.relevance) SearchSortOrder sort` to the `const factory`, and applied the
  `FilterPerson` type/import change. **Dropped** `_setEq`/`_listEq` and the `collection` import: freezed's
  generated `==` already uses `DeepCollectionEquality`, which is exactly what they existed to provide,
  and they still named the pre-unification `PersonDto`.
- **Risk**: LOW.

### Conflict: `mobile/lib/presentation/pages/search/drift_search.page.dart` (modify/delete)

- Fork #654 removed upstream's mobile search page entirely; #30907 modified it. **Honoured the fork's
  deletion.** Confirmed no live reference remains.

### Conflict: `mobile/lib/presentation/actions/similar_photos.action.dart`

- Standing fork divergence #1. Upstream routes to `searchPreFilterProvider` + `DriftSearchRoute`, which
  does not exist here. **Kept the fork's** `photosFilterProvider.setSimilarTo()` + `MainTimelineRoute`.

### Conflict: `mobile/lib/presentation/widgets/timeline/scrubber.widget.dart`

- Upstream converted the private `_Segment` to freezed in place; fork #625 had moved it out to
  `scrubber_segments.dart` as the public `ScrubberSegment`. **Honoured the fork's deletion** after
  confirming the replacement exists and is what the widget uses.

### Conflict: `mobile/test/domain/repositories/sync_stream_repository_test.dart` (×4)

- Unions of independent test groups and of the `_createAsset` helper's parameter list. Upstream dropped
  its `ownerId` parameter (no call site passes it — verified) and parameterised `isFavorite`; the fork
  parameterises `type`, `visibility` and `livePhotoVideoId`. Merged all five parameters.
- **A first attempt at one of these unions dropped a closing block** — caught by a brace-balance check
  against the file's own baseline, not by inspection. See Inconsistencies.

### Conflict: `server/src/services/download.service.ts`

- Union: upstream's `disposition` return field + the fork's `abort` teardown closure.

### Conflict: `server/src/enum.ts`

- Additive enum-member union (`ApiTag.AssetFiles` + `ApiTag.Classification`), auto-resolved.

### Auto-resolved classes (9 conflicts)

Two proven-mechanical classes were resolved by script, each followed by a balance gate against the
incoming commit's own baseline and an esbuild parse gate:

1. **Generated artifacts** (`immich-openapi-specs.json`, `fetch-client.ts`) — take theirs, regenerate once
   at the end (done; see Local CI Verification).
2. **Strictly-additive unions** — empty base, every added line a single-line import / bare identifier /
   enum member. Imports merged sorted by module path.
3. **`db.repository.steps.dart`** (8 modify/delete conflicts) — upstream made it generated; honoured the
   deletion each time.

`rerere` was disabled for every git invocation in this cycle
(`git -c rerere.enabled=false`), per the standing rule.

## Fork Feature Verification

| Feature                         | Status | Notes                                                                                                                                                                                                   |
| ------------------------------- | ------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Shared Spaces                   | OK     | Activity RBAC e2e coverage preserved; tag `getAll` RBAC matrix preserved; space branches in `asset.repository.ts` intact                                                                                |
| Storage Migration / S3          | OK     | Download archive abort teardown preserved; `FileDelete` path handling unchanged                                                                                                                         |
| Pet Detection                   | OK     | Untouched                                                                                                                                                                                               |
| Image Editing / Video Trimming  | OK     | Untouched                                                                                                                                                                                               |
| Branding                        | OK     | New upstream string overridden; branded-merge simulation returns no upstream name                                                                                                                       |
| Google Photos Import            | OK     | Untouched                                                                                                                                                                                               |
| User Groups                     | OK     | Untouched                                                                                                                                                                                               |
| Option M (cluster groups inert) | OK     | `ClusterGroupController` still unmounted with its reversal note; `person_personGroupId_key` present; **0 cluster-group routes in the spec**; `face-identity` tables byte-identical to the pre-cycle tip |
| Search V3 coexistence           | OK     | 3 dormancy banners; both V3 builder call sites are inside upstream's own dormant `searchMetadataV3`/`searchStatisticsV3`, wired to nothing                                                              |

## CI and Infrastructure Verification

| Check                                   | Status | Notes                                                                   |
| --------------------------------------- | ------ | ----------------------------------------------------------------------- |
| Workflow files (no upstream collisions) | OK     | Only `test.yml` changed                                                 |
| Docker image references                 | OK     | `ci-invariants-check`: Gallery release workflows publish Gallery images |
| Branding (no upstream-name leaks)       | OK     | One gap found and fixed — see Inconsistencies                           |
| Fork CI modifications intact            | OK     | `fork-patches-check` green; `GITHUB_TOKEN` wiring preserved             |
| New upstream workflows reviewed         | OK     | None added                                                              |
| `.github` formatting (separate gate)    | OK     | `npx prettier --check .` clean                                          |

## Database Migration Analysis

**No migration or schema-table churn this cycle** — `git diff 11b1aa5ecf7..upstream/main` touches neither
`server/src/schema/migrations/` nor `server/src/schema/tables/`.

- Gallery migrations: **60**; upstream migrations: **95**
- Timestamp collisions: NONE (`Migration Timestamp Collision Check` green)
- `postbuild` merge intact: YES — build reports "Synced 60 Gallery migrations … wrote 1 compatibility aliases"
- `revert-to-immich.sql` coverage detector: **no missing entries**

One piece of bookkeeping owed from the previous cycle was fixed: the two option-M migrations
(`1787100000000-DropPersonFksBeforeClusterGroups`, `1791000000000-RepointFaceReviewToPersonGroup`) were
never added to the ownership manifest's enumerated list, so `Gallery Migration Count` read 60 vs an
expected 58.

## Mobile Drift Migration Analysis

No upstream `schemaVersion` change this cycle. `mobile-drift-rebase-check` green:
schemaVersion, snapshots and Gallery callbacks consistent. No renumbering needed.

**#30910 changes how the migration steps file is produced**: `db.repository.steps.dart` is now generated
by a new `codegen:drift:migration` mise task and gitignored. A previous cycle's fork commit had
deliberately restored the committed copy; that is now obsolete. The file was untracked, and regeneration
was verified to reproduce it at **the identical 652194 bytes**, confirming the fork's own schema versions
(v32+) are covered by generation.

## Inconsistencies Found

1. **#25900 leaked storage paths to non-owners (fixed).** `GET /asset-files` gates on
   `Permission.AssetRead`, which Gallery also grants to shared-space members, while every per-file
   endpoint the commit adds is owner-only. The response carried the raw `path`, so a Space member could
   enumerate the owner's storage paths / S3 keys for files they cannot fetch. `path` is now projected out
   for non-owners and marked optional in the DTO. Upstream has the same shape for album members and
   partners; the fork simply widens the audience, which is why the fix is fork-side.
2. **#30021's `disposition` had nowhere to go (fixed).** Upstream moved the archive content-disposition
   onto `ImmichReadStream`, but the fork had narrowed `downloadArchive`'s return type to an inline shape
   carrying its S3 `abort` hook. Widened to `ImmichReadStream & { abort }`; the controller now returns
   `asStreamableFile(...)` while keeping the fork's `req.on('close', abort)` teardown. Upstream's new
   `download.controller.spec.ts` mocked the pre-fork shape and was updated to supply `abort`.
3. **Branding gap from #29730 (fixed).** `delete_dialog_alert_local_ios` names the upstream product with
   no entry in `overrides-en.json`. `verify-branding.sh` would have reddened `gallery-ml-smoke`,
   `gallery-mobile-smoke` and `gallery-build-mobile` — three workflows unrelated to the change that
   introduced it. Fix proved by simulating the branded merge and re-scanning: no upstream name survives.
   No translated locale carries the key yet, so no per-locale override is owed.
4. **A hand-written block union silently dropped a closing block (fixed).** Merging upstream's and the
   fork's test groups in `sync_stream_repository_test.dart` left the preceding group unclosed, because
   the closers were shared trailing context. A "no duplicate helpers / groups listed" check passed; the
   brace-balance check against the file's own baseline caught it. The same shape then appeared in
   `metadata.service.spec.ts` and was caught immediately by the esbuild parse gate. Both gates were
   subsequently wired into the auto-resolver.
5. **A broken duplicate `_createAssetV2` shadowed the fork's (fixed).** The #28445 union left two
   definitions in `sync_stream_repository_test.dart`; upstream's — first, and therefore the one Dart
   resolved — had a body reading a `livePhotoVideoId` parameter its signature never declared. Removed.
6. **`_createAsset` lost a parameter the fork still needs (fixed).** #28445 dropped `ownerId` because
   upstream had no caller passing it. Verified as safe _at the commit where the signature merged_ — but
   later fork commits in the same replay add prune tests that pass `ownerId: 'user-partner'`. The
   parameter was restored. Worth noting as a per-commit-vs-end-state gap: a call-site sweep is only
   valid for the tree as it exists at that point in the replay.
7. **★ `dart fix --apply` introduced a runtime regression the analyzer could not see (fixed).**
   Applying `--code=prefer_const_constructors` made a test helper return `const SearchFilter(...)`,
   which made its `people` set **unmodifiable**; eight tests doing `..people.add(...)` then threw
   `Unsupported operation: Cannot modify an unmodifiable Set` at runtime while `dart analyze
--fatal-infos` reported **No issues found**. Those sites now build the set through `copyWith`.
   The general lesson matches the existing "green type-check means nothing" rule: an automated lint fix
   is a code change and needs the test suite, not just the analyzer.
8. **Pre-existing web lint debt surfaced (not introduced this cycle).** See the note under Local CI
   Verification.

## Pattern Propagation

| Refactor                                             | Old → New Pattern                                                           | Fork Files Affected                                                       | Decision                                                                           | Commit / Follow-up |
| ---------------------------------------------------- | --------------------------------------------------------------------------- | ------------------------------------------------------------------------- | ---------------------------------------------------------------------------------- | ------------------ |
| freezed on mobile models (#30907, continuing #30168) | hand-written ctor/`copyWith`/`==`/`hashCode` → `@freezed` + `const factory` | **3 fork-only lib files + 9 fork-only test files** (forced, not optional) | **Forced adoption at the boundary**; the fork's own models still stay hand-written | `15021973da1`      |

**Correction to the standing "propagation deferred" note.** Deferral only holds for models the fork
_owns_. #30907 converted `SearchFilter`, which fork-only code **consumes heavily**, and that is not
optional work: freezed makes every field final and replaces `copyWith`, so 58 analyzer errors appeared
in fork-only code with no conflict at any of them. The cost this cycle:

- `photos_filter.provider.dart` used a `copyWith()..field = x` cascade **specifically because** the old
  hand-written `copyWith` null-coalesced, so an explicit `null` meant "keep". freezed's sentinel
  `copyWith` sets null, making the workaround both unnecessary and impossible. 5 sites converted.
- ~40 cascade assignments across 8 fork-only test files converted to `copyWith`.
- `scrubber.widget.dart` kept a `part '*.freezed.dart'` directive after the fork's #625 had moved
  `_Segment` out; the generated part no longer exists, so the file stopped compiling.

This is worth recording because it inverts the usual expectation: the _deferral_ decision is about the
fork's own models, but a conversion of an upstream model the fork consumes lands as mandatory work, and
it arrives as a compile error rather than as a conflict.

**`copyWith(x: null)` trap swept.** Four call sites pass an explicit `null`. Two are on classes #30907
converted (`CleanupState`, `AlbumFilter`) but both lines are **upstream's own** — upstream converted the
class and kept them, so the semantics change is theirs and deliberate. The fork's `Person` was already
freezed before this cycle (no change), and `LocalAsset` was not converted. **The trap does not fire this
cycle** — the fork's exposure showed up instead as the compile-time cascade failures above, which is the
loud version of the same hazard.

## Local CI Verification

| Check                                             | Status | Notes                                                                                           |
| ------------------------------------------------- | ------ | ----------------------------------------------------------------------------------------------- |
| `server pnpm build` (+ postbuild migration sync)  | PASS   | Synced 60 Gallery migrations, 1 compatibility alias                                             |
| OpenAPI regeneration (`sync-open-api` + oazapfts) | PASS   | 3 asset-file routes added; `path` optional; **0 cluster-group routes**                          |
| `server pnpm check` (tsc)                         | PASS   |                                                                                                 |
| `web check:typescript`                            | PASS   |                                                                                                 |
| `web check:svelte`                                | PASS   | 622 files, 0 errors, 0 warnings                                                                 |
| `e2e pnpm check`                                  | PASS   |                                                                                                 |
| `packages/cli pnpm check`                         | PASS   |                                                                                                 |
| `server pnpm lint`                                | PASS   |                                                                                                 |
| `server prettier --check .`                       | PASS   | one union needed reformatting                                                                   |
| `e2e` eslint + prettier                           | PASS   |                                                                                                 |
| `packages/cli` eslint (`src/**/*.ts`) + prettier  | PASS   |                                                                                                 |
| `.github` prettier                                | PASS   | separate package + CI job                                                                       |
| `i18n` prettier                                   | PASS   |                                                                                                 |
| `web pnpm lint` (eslint `--max-warnings 0`)       | PASS   | 5 pre-existing warnings fixed — see the note below                                              |
| `web prettier --check .`                          | PASS   |                                                                                                 |
| Server unit tests                                 | PASS   | **5769 passed**, 12 skipped (S3 integration)                                                    |
| Web unit tests                                    | PASS   | **5694 passed**, 2 skipped, 8 todo                                                              |
| Mobile codegen                                    | PASS   | Dart client + translations + `drift_dev make-migrations` + build_runner + drift schema + pigeon |
| `dart analyze --fatal-infos lib test`             | PASS   | **No issues found** (from 58 errors + 45 infos)                                                 |
| `dart format --set-exit-if-changed`               | PASS   | 865 files, 0 changed                                                                            |
| `flutter test`                                    | PASS   | **3363 passed**, 1 skipped                                                                      |
| `revert-to-immich.sql` coverage                   | PASS   | no missing entries                                                                              |
| Post-rebase audits (×5 batches)                   | PASS   | fork-owned files, symbols, migrations, timestamps, artifacts                                    |
| `fork-patches-check`                              | PASS   | `@immich/ui` patch metadata consistent                                                          |
| `ci-invariants-check`                             | PASS   | incl. `person-join-not-viewer-filtered` (the option-M gate)                                     |
| `mobile-drift-rebase-check`                       | PASS   | schemaVersion/snapshots/callbacks consistent                                                    |

### ★ Two traps in the local web-lint workaround, worth recording

`eslint` cannot be run normally in this worktree — `@koddsson/eslint-plugin-tscompat` crashes — so the
standing workaround is `npx eslint . --rule '{"tscompat/tscompat":"off"}'`. That run reported **18
problems**, but only **5** are real:

- **13 are artifacts of the workaround itself.** Turning the rule off makes every
  `// eslint-disable-next-line tscompat/tscompat` comment in the tree report as an _unused disable
  directive_. Under CI, where the rule is on, those directives are used and silent. **Do not "fix"
  them** — deleting them would break the real CI run.
- **5 are genuine pre-existing debt**, in `SharingSettings.svelte`: imports left unused when the
  option-M landing amputated upstream's cluster-group half of that page last cycle. The file is
  byte-identical to the pre-cycle tip, so this cycle did not introduce them — but `Lint Web` runs
  `--max-warnings 0`, so they would have failed CI. Fixed here (`926638acd93`).

The reason they survived a "green" previous cycle is the same crash: that cycle linted only its
individually-changed files. **Scope the local workaround to the whole tree, and read past the
unused-directive noise, or this class hides indefinitely.**

Confirmed the 20 web files this cycle changed are themselves lint-clean.

## Post-Rebase Verification

- Fork commits ahead of upstream: **1258**
- Commits behind upstream: **0**
- Fork diff looks clean: YES
