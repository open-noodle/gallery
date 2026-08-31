# Upstream Sync Report — 2026-08-31 (batches 200–203)

## Summary

- **Upstream commits pulled**: 8 (`1fd3d874921` → `5666d57f15a`)
- **Fork commits synced from `origin/main`**: 0 (`integratedForkHead` already at `9c31bc01655`; `origin/main` has not moved since #1037 on 2026-08-29)
- **Conflicts resolved**: 3 distinct files (`person.repository.sql` at six replayed commits, `server/bin/immich-dev`, the medium `person.service.spec.ts`), plus one modify/delete on `draft-release.yml`
- **Risk level**: LOW
- **Recommendation**: PROCEED

The whole-tree diff from the pre-cycle tip to the new HEAD is **15 files**, and every one of them is
accounted for by one of upstream's eight commits. No fork content was lost — the one place where the
mechanical replay did drop fork content (`person.repository.sql`) was caught by the whole-tree audit
and repaired by a real regeneration, after which that file nets out to exactly upstream's change.

## Incoming Upstream Changes

| SHA           | Summary                                                                                        | Area          | Risk to Fork | Notes                                                                                                                          |
| ------------- | ---------------------------------------------------------------------------------------------- | ------------- | ------------ | ------------------------------------------------------------------------------------------------------------------------------ |
| `015e5f20d71` | `chore: tune map icon size` (immich-31108)                                                     | web           | LOW          | 2 lines in `Map.svelte`. The fork carries a 24-line delta in that file (shared-space markers); no overlap, merged clean.       |
| `006e7fd0d5a` | `fix(mobile): keep the original filename when sharing downloaded assets` (immich-30267)        | mobile        | LOW          | `asset_media.repository.dart` was byte-identical to upstream here, so the fork simply adopts it. Adds one new test file.       |
| `c17a119735d` | `fix(mobile): refresh server info when the websocket connects` (immich-31144)                  | mobile        | LOW          | 3 lines in `websocket.provider.dart`, where the fork adds `markRemoteContentChanged()` calls. Disjoint hunks, merged clean.    |
| `0628f8b9666` | `fix: do not move faces of users other than the current owner` (immich-31145)                  | server, faces | **MEDIUM**   | Re-scopes `PersonRepository.reassignFaces` to `asset.ownerId`. Lands on the fork's highest-collision surface — analysed below. |
| `9e5dcc598f7` | `fix(server): allow an empty assetIds array when creating an album shared link` (immich-31098) | server        | LOW          | One-line validation relaxation in `shared-link.dto.ts`, where the fork adds `spaceId` + `redactAssetOwners`. Merged clean.     |
| `06f6104e1a8` | `fix: Build SDK in dev container` (immich-31096)                                               | server / dev  | LOW          | Adds one line to `server/bin/immich-dev`. **Conflicted** — the fork adds its own line at the same spot. Both kept.             |
| `9dead7857f1` | `fix(web): interaction with some filter elements closes the search panel` (immich-31107)       | web           | LOW          | Lands entirely inside the **dormant** upstream search-bar directory. Auto-merged, exactly as `DORMANT.md` intends.             |
| `5666d57f15a` | `fix: open an announcement discussion for each release line` (immich-31101)                    | CI            | LOW          | Modifies `draft-release.yml`, which the fork **deletes**. Modify/delete conflict, resolved to deletion.                        |

### Per-batch product-direction gate

**Did not fire on any of the four batches.** Two commits are worth stating explicitly, because both
touch a named fork surface and a green rebase alone would not clear them:

- **immich-31145 (faces & people)** is a _bugfix scoping an existing update_, not a change of
  direction for the person/face model. It adds no entity, no contract, and no UX. It neither
  duplicates nor competes with the fork's Global Face Identity work.
- **immich-31098 (sharing)** relaxes one validation rule on upstream's own shared links. It does not
  rework the sharing or access model, so it does not collide with Shared Spaces.

The other six are a map icon size, two mobile fixes, a dev-container build line, a dormant-UI fix and
a release-announcement workflow the fork does not run.

### Zero-conflict semantic break gate

Detectors run before and after the replay:

- **Silent-no-op detector** (URL literals upstream removes, grepped with backslashes stripped against
  `branding/scripts`, `tools`, `.github/actions`): **no hits**.
- **i18n branding-override detector**: not applicable — the `i18n/` tree is byte-identical to the
  last green tip, and the batch changes no `en.json` value.
- **Shape I (fork deleted a path upstream later creates/renames)**: the batch adds three files
  (`asset_media_repository_test.dart`, `SearchTagsSection.spec.ts`, `search-bar-utils.spec.ts`) and
  renames none. `git log origin/main -- <path>` is empty for all three, so fork history never owned
  them. Duplicate-content check (repeated import lines, two `main()`) on the touched mobile files:
  clean.
- **Shape L (directory relocation breaking codegen)**: no relocation in this batch, and
  `dart run drift_dev make-migrations` **regenerated without refusing**, which is the signal that
  matters.
- **Zero-byte tracked files**: 14 present, all 14 byte-for-byte the same set that was empty at the
  green tip — no `checkout --theirs` casualty.
- **`.github/` format gate**: `npx prettier --check .` clean (run because the batch touched a
  workflow path).

#### immich-31145 — the one that needed real analysis

Upstream changed `reassignFaces` from scoping by `person.ownerId` (via a subquery on the face's
current person group) to joining `asset` and scoping by `asset.ownerId`, and switched the row count
from `numChangedRows` to `numUpdatedRows`.

The fork's exposure is **nil**, for a reason worth recording: the fork does **not** route its
user-facing reassignment through this method. `PersonService.reassignFaces` /
`reassignFacesById` call the fork's own per-face `personRepository.reassignFace(faceId, personGroupId)`
so they can interleave verdict clearing and identity replacement. The single fork call site of the
plural method is `person.service.ts:1327`, which passes `{ faceIds: [id], newPersonGroupId }` and **no
`ownerId`** — so the `$if(!!ownerId, …)` branch upstream rewrote is never taken. The unconditional
`from('asset')` join it also adds is safe: every `asset_face` row has an asset.

This was the specific worry worth checking, since a Space editor legitimately reassigns faces on
assets they do not own (#765); had that path used the plural method with an `ownerId`, upstream's new
`asset.ownerId` predicate would have silently narrowed it. It does not.

## Conflict Resolutions

### Conflict: `server/src/queries/person.repository.sql` (six replayed fork commits)

- **Fork side**: each replayed commit carries this generated file as it was at that point in fork
  history — i.e. in the **pre-rename `personId` vocabulary**, before upstream's `personGroupId`
  re-key.
- **Upstream side**: the current generated form, plus immich-31145's new `from "asset"` join.
- **Resolution**: took the current generated form at each stop, then **regenerated the file for real**
  against a Postgres container (`pnpm migrations:run` + `mise run //:sql`) and committed the result
  (`26cd3292a71`).
- **Risk**: LOW — but only because of the regeneration. Taking the current form at each conflict
  **did** drop three fork-generated blocks (`getByGroupIdOnly`, `getPeopleFaceStatistics`,
  `getPeopleOverviewStatistics`) whose source-side `@GenerateSql` methods had applied cleanly. The
  whole-tree audit caught this as an unexplained −233-line delta.
- **Verification**: block count is back to 41 (matching the pre-cycle tip), all three named blocks are
  present, and the file's diff against the pre-cycle tip is now **exactly** immich-31145's three added
  SQL lines and nothing else.

### Conflict: `server/bin/immich-dev`

- **Fork side**: adds `node server/bin/sync-gallery-migrations.mjs` before the nest start line.
- **Upstream side**: adds `pnpm --filter @immich/plugin-sdk build` at the same position.
- **Resolution**: kept **both**, upstream's line first (the SDK build is a prerequisite of the server
  start; the migration sync is fork bookkeeping and order-independent relative to it). File mode
  `100755` preserved.
- **Risk**: LOW.

### Conflict: `server/test/medium/specs/services/person.service.spec.ts`

- **Fork side**: `feb28eec158` (`test(server): drop upstream's cross-user cluster-group tests`)
  deletes upstream's three `mergePerson` tests, keeping the now-empty `describe` wrapper. Under
  Option M the fork holds `person_personGroupId_key`, so a second owner's person can never join an
  existing person group — the state those tests construct is unreachable here.
- **Upstream side**: immich-31145 modified all three of those tests **and added a fourth**
  (`should not merge into person another user does not have`) built the same way —
  `ctx.newPerson({ ownerId: user2.id, personGroupId: person2.personGroupId })`.
- **Resolution**: extended the fork's deletion to all **four**. Upstream's new test would fail on the
  unique index exactly as the other three do, so admitting it would import a guaranteed red.
- **Risk**: LOW. Verified structurally: the resolved file is **byte-identical to the pre-cycle tip**
  (it does not appear in the tree diff at all), and the resolution reproduces `feb28eec158`'s own
  shape — that commit likewise kept the empty `describe('mergePerson')` wrapper rather than removing
  it.
- **Note**: this is the Shape-J family — upstream extending a set the fork deliberately excludes.
  Restoring these four tests remains part of ever turning cluster groups on; the existing Option M
  note at the top of the file already points at the landing plan.

### Conflict (modify/delete): `.github/workflows/draft-release.yml`

- **Fork side**: `21a22b9a52e` deletes it (with `backport.yml`) — both authenticate via the
  immich-app `PUSH_O_MATIC` GitHub App and call `immich-app/devtools` actions, neither of which
  exists for this fork.
- **Upstream side**: immich-31101 modifies it to open an announcement discussion per release line.
- **Resolution**: **deleted**, via `git rm` — deliberately _not_ `git checkout --theirs`, which writes
  a zero-byte file that Actions then reads as an invalid workflow.
- **Risk**: LOW. `ci-invariants-check`'s `no-push-o-matic` invariant covers this file and passes; the
  full zero-byte scan is clean.

## Fork Feature Verification

| Feature                             | Status | Notes                                                                                                                                                                    |
| ----------------------------------- | ------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Global Face Identity / Face Review  | OK     | `reassignFaces` analysis above; `person-join-not-viewer-filtered` invariant green; fork's per-face `reassignFace` path untouched.                                        |
| Shared Spaces (share links)         | OK     | Fork's `spaceId` field and `redactAssetOwners` (#1018) intact alongside immich-31098's relaxation.                                                                       |
| Shared-Space Photos on Personal Map | OK     | `Map.svelte` fork delta unchanged at 24+/2-; upstream's two icon-size lines verified present.                                                                            |
| Upstream search UI stays dormant    | OK     | Directory still byte-identical to `upstream/main` apart from fork-authored `DORMANT.md`; no external imports (only comments and the `route.spec.ts` dormancy assertion). |
| Search V3 stays undispatched        | OK     | `search-v3-not-dispatched` invariant green.                                                                                                                              |
| Mobile sync-status nudges           | OK     | Fork's `markRemoteContentChanged()` calls survive immich-31144's `_refreshServerInfo` rename.                                                                            |
| Gallery migrations                  | OK     | 62/62 present; no timestamp collision; postbuild synced 62 + 1 compatibility alias.                                                                                      |
| Mobile Drift schema                 | OK     | `mobile-drift-rebase-check` green; `make-migrations` regenerated without refusing.                                                                                       |
| Branding / `@immich/ui` patch       | OK     | `fork-patches-check` green; `branding/` tree byte-identical to the green tip.                                                                                            |

## CI and Infrastructure Verification

| Check                                     | Status | Notes                                                                                         |
| ----------------------------------------- | ------ | --------------------------------------------------------------------------------------------- |
| Workflow files (no upstream collisions)   | OK     | `.github/` tree byte-identical to the green tip; `draft-release.yml` stays deleted.           |
| Docker image references (`gallery-*`)     | OK     | `gallery-release-image-names` invariant green.                                                |
| No `PUSH_O_MATIC` dependency              | OK     | Invariant green — this is what covers the re-added `draft-release.yml`.                       |
| Upstream docs deploy stays dispatch-only  | OK     | Invariant green.                                                                              |
| `revert-to-immich.sql` migration coverage | OK     | Detector run against the `v3.1.0` tag tree: no `MISSING` lines. No new migrations this cycle. |
| Commit-message autolinks                  | OK     | 1396 messages scanned against the fork PR ceiling (1037); no cross-repo autolink.             |

## Database Migration Analysis

No new upstream migrations in this batch. Gallery migration count unchanged at **62**, timestamp
collision check clean, `postbuild` synced 62 migrations + 1 compatibility alias, and the
`CompositeMigrationProvider` path is untouched.

## Mobile Drift Migration Analysis

No upstream `schemaVersion` change and no new snapshots. Fork remains at **schemaVersion 36** with
fork-owned snapshots v32–v36. `make-migrations` regenerated the newest snapshot without the
"a schema for version N already exists and differs" refusal, and `dart analyze --fatal-infos` over
`lib` + `test` reports **No issues found**.

## Inconsistencies Found

One, self-inflicted and repaired in-cycle: the mechanical conflict resolution on
`server/src/queries/person.repository.sql` dropped three fork-generated query blocks. Caught by the
whole-tree audit, fixed by a real regeneration, and verified to net out to upstream's change alone.
See the conflict entry above.

## Pattern Propagation

No broad upstream refactor in this batch — the eight commits are six bugfixes, a chore and a CI
change. Nothing to propagate.

## Local CI Verification

| Check                                      | Status | Notes                                                        |
| ------------------------------------------ | ------ | ------------------------------------------------------------ |
| `server pnpm build` (+ migration sync)     | PASS   | Synced 62 Gallery migrations + 1 compatibility alias         |
| `server pnpm check` (tsc)                  | PASS   |                                                              |
| `server pnpm lint`                         | PASS   |                                                              |
| `server prettier --check`                  | PASS   |                                                              |
| Server unit tests                          | PASS   | 198 files, 6125 passed / 12 skipped                          |
| `web check:typescript`                     | PASS   |                                                              |
| `web check:svelte`                         | PASS   | 627 files, 0 errors, 0 warnings                              |
| web eslint (`tscompat` off)                | PASS   | 0 errors. 13 warnings, all "unused eslint-disable directive" |
| `web prettier --check`                     | PASS   |                                                              |
| Web unit tests                             | PASS   | 373 files, 5970 passed                                       |
| `e2e pnpm check` (tsc)                     | PASS   |                                                              |
| mobile `drift_dev make-migrations`         | PASS   | Regenerated without refusing (Shape L clear)                 |
| mobile `dart analyze --fatal-infos`        | PASS   | No issues found (lib + test)                                 |
| mobile `dart format --set-exit-if-changed` | PASS   | Only the two gitignored `lib/generated/*.g.dart` differ      |
| `flutter test`                             | PASS   | 3494 passed / 1 skipped                                      |
| `.github` prettier                         | PASS   | Its own separate gate                                        |
| `make commit-autolink-check`               | PASS   | 1396 messages scanned, no cross-repo autolink                |

The 13 web eslint warnings are an artifact of the local workaround, not a finding: disabling
`tscompat/tscompat` (the plugin crashes locally with `TypeError: ... reading 'Class'`) makes each of
its `eslint-disable` comments read as unused. `web/src` contains **exactly 13** such directives, so
the counts match one-for-one, and none is in a file this cycle touched. CI's Lint Web runs the rule
normally and passed.

## Remote CI Verification

- **Test branch**: `rebase/upstream-batch-203`
- **Commit validated**: `023eb70a1dd`
- **Result**: **10/10 green.** Two runs needed a re-run first — see below.

| Workflow                                  | Status | Run                               |
| ----------------------------------------- | ------ | --------------------------------- |
| `test.yml`                                | GREEN  | 33427396361 (21 non-skipped jobs) |
| `docker.yml`                              | GREEN  | 33427399323 (green on re-run)     |
| `static_analysis.yml`                     | GREEN  | 33427401724                       |
| `gallery-build-mobile.yml`                | GREEN  | 33427420487                       |
| `gallery-rebase-smoke.yml`                | GREEN  | 33427404061 (green on re-run)     |
| `storage-migration-tests.yml`             | GREEN  | 33427407030                       |
| `storage-migration-e2e.yml`               | GREEN  | 33427417725 (green on re-run)     |
| `gallery-revert-to-immich-validation.yml` | GREEN  | 33427409749                       |
| `gallery-ml-smoke.yml`                    | GREEN  | 33427412638                       |
| `gallery-mobile-smoke.yml`                | GREEN  | 33427415351                       |

Runs were read filtered by `headSha`, not by branch name — the branch is reused and force-pushed, and
a branch-scoped read served two stale `Test` successes from an earlier push.

### The `extism-js: not found` failures — transient, and a real fork-CI gap behind them

`gallery-rebase-smoke`, `storage-migration-e2e` and `docker` all failed first time on the **same**
line of `server/Dockerfile`'s plugins stage:

```
mise exec --no-deps --jobs=1 github:extism/js-pdk@1.6.0 -- pnpm ... build
  -> sh: 1: extism-js: not found
```

**Not caused by this rebase.** Every input to that stage — `server/Dockerfile`, `pnpm-lock.yaml`,
`pnpm-workspace.yaml`, `mise.toml`, `mise.lock` and the whole `packages/` tree — is byte-identical to
the batch-199 tip, where all three of these workflows were green this morning (runs 33393825338 /
33393852037 / 33393815823). All three passed on re-run against the identical tree, which is what
settles it: an anonymous GitHub API rate limit (60 requests/hour per runner IP), whose 403 surfaces
as the far less obvious "binary not found".

**The gap it exposed, fixed in `09122b20c65`:** `e2e/docker-compose.yml` already forwards
`GITHUB_TOKEN` as the `github_token` build secret and its comment names this exact failure — but the
secret is only populated if the workflow exports the variable. `test.yml` does, on both of its
compose-build steps. The two fork-only workflows that build the same stack never did, so they had
been running the fetch anonymously since they were written. Both now export
`GITHUB_TOKEN: ${{ github.token }}`.

**Still exposed, deliberately not patched here:** `docker.yml` cannot take the same fix. Its
`password:` lines are GHCR _login_, not a build secret, and it delegates the build to
`immich-app/devtools/.github/workflows/multi-runner-build.yml`, whose only secret input is
`GITHUB_APP_TOKEN` — there is no way to pass a `github_token` build secret without forking that
reusable workflow or changing the Dockerfile. That is upstream's design and a fork-CI decision in its
own right, not a rebase reconciliation, so it is flagged rather than patched mid-cycle.

## Final State

- Rolling branch `rebase/upstream-rolling-v3.1.1` is **level with `upstream/main`** (0 behind).
- `upstreamTargetHead` = `5666d57f15a`; `integratedForkHead` = `9c31bc01655` (unchanged).
- Skill Sync Anchor stays at `9c31bc01655` — `git log 9c31bc01655..origin/main` is empty, so
  `fork-surface.md` needs no new rows.
- **Not landing on `main`**: upstream has released no new tag (`branding/config.json` still reads
  `v3.1.0`), so the standing rule keeps the branch off `main`.
