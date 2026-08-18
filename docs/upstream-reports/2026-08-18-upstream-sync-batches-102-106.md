# Upstream Sync Report — 2026-08-18 (arc A, batches 102–106)

## Summary

- **Upstream commits pulled**: 6 of 19 available (`f9c05af45f8` → `01e40c07486`)
- **Upstream commits quarantined**: 13 (`225ca9ab8df` → `65b4b9b8fbe`)
- **Fork commits synced**: 0 — `integratedForkHead` was already `origin/main` (`690fd44e12c`, #987)
- **Conflicts resolved**: 8 (1 analyzer config, 1 web page, 1 test factory, 1 mobile pubspec pair, 4 lockfile)
- **Risk level**: MEDIUM
- **Recommendation**: PROCEED for arc A; arc B (the quarantined 13) needs its own pass

`upstream/main` moved 19 commits ahead while the branch sat level. Three of those
reshape surfaces the fork extends, so the cycle was deliberately split into two arcs at
the batch-107 boundary. This report covers arc A only.

## Arc split and the quarantine

The per-batch product-direction gate fired on **batch 107 — `225ca9ab8df`
`chore(mobile): use Drift @DriftAccessor() and collapse some providers (#30693)`** (92 files).
It deletes the `DriftDatabaseRepository` base class, renames 14 repositories
(`DriftPeopleRepository` → `PeopleRepository`, `DriftStoreRepository` → `StoreRepository`, …)
into `DatabaseAccessor<Drift>` classes carrying `@DriftAccessor()` plus a generated mixin, and
registers each in a new `daos:` list on the `Drift` class.

Measured fork exposure, before any rebase:

| Signal                                                            | Count                                                                                             |
| ----------------------------------------------------------------- | ------------------------------------------------------------------------------------------------- |
| Fork repositories extending the deleted `DriftDatabaseRepository` | 19                                                                                                |
| …of which **fork-only**                                           | 1 — `SpaceAlbumRepository` (`mobile/lib/infrastructure/repositories/space_album.repository.dart`) |
| **Fork-only** files referencing a deleted or renamed symbol       | 67                                                                                                |

The fork-only `SpaceAlbumRepository` must also join the `daos:` registry inside
`db.repository.dart` — the fork's most-diverged mobile file, which owns `schemaVersion`,
Drift snapshots v32–v36 and five fork-only entities. That is an architecture reshape of a
layer the fork extends, not a mechanical merge, so batch 107 and everything behind it were
held.

Maintainer decision (2026-08-18): roll batches 102–106 to full CI green first, then decide
the `@DriftAccessor` propagation with fresh context. Recorded in `rolling-state.json`
`quarantineHistory`; `upstreamTargetHead` is pinned at `01e40c07486`.

Quarantine ordering was checked before promising a "safe majority": the two Dart lint
sweeps sit at positions 1–2 of the pending range, so there was no way to take a large safe
prefix while deferring them. Batches 102–106 are the whole safe prefix.

## Incoming upstream changes (arc A)

| SHA           | Summary                                                         | Area   | Risk to fork | Notes                                                                                |
| ------------- | --------------------------------------------------------------- | ------ | ------------ | ------------------------------------------------------------------------------------ |
| `bd55f7e73a0` | pump flutter_lints to 6.0 (#30664)                              | mobile | **HIGH**     | New default rules over a large fork Dart surface                                     |
| `ffc83eae360` | more dart lints (#30665)                                        | mobile | **HIGH**     | Rewrites the whole `rules:` block; re-adds a rule the fork had disabled; 7 new rules |
| `9ab12b0c4e9` | mark finished downloads complete (#29023)                       | mobile | LOW          | No fork overlap                                                                      |
| `3cec8fcc3ce` | base-image v202608111116 (#30818)                               | CI     | LOW          | `server/Dockerfile*` only                                                            |
| `d84be93c2cc` | flutter pub upgrade (#29985)                                    | mobile | MEDIUM       | Collides with the fork's `background_downloader` pin                                 |
| `01e40c07486` | speed up lint ~4x via svelte-eslint-parser ts.sys hook (#30782) | web    | MEDIUM       | Adds `web/lint-env.js`; bumps `svelte-eslint-parser` 1.3.3 → 1.8.1                   |

The Flutter SDK pin is **unchanged** (`3.44.9`): `d84be93c2cc` touches only `mobile/pubspec.*`,
not `mise.toml`/`mise.lock`, so the recurring `mise.lock` trap did not apply this cycle.

### Quarantined for arc B (13 commits)

Held behind the boundary, listed so arc B does not have to re-derive the risk:

| SHA           | Summary                                              | Why it matters to the fork                                                                                                                                                                                                                            |
| ------------- | ---------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `225ca9ab8df` | Drift `@DriftAccessor()` (#30693)                    | **The boundary.** See above                                                                                                                                                                                                                           |
| `11755e5a53e` | eslint-plugin-unicorn v73 (#30844)                   | Recurring fork-side lint sweep (server/web/e2e/cli)                                                                                                                                                                                                   |
| `20edf0051c1` | update typescript-projects (#30839)                  | 1182-line lockfile churn                                                                                                                                                                                                                              |
| `4d319cbd0d8` | mise docker tag v2026.8.8 (#30834)                   | —                                                                                                                                                                                                                                                     |
| `d00867d702a` | album description navigation freeze (#30781)         | —                                                                                                                                                                                                                                                     |
| `b0a9468da71` | guard `createAll` against empty values (#30837)      | —                                                                                                                                                                                                                                                     |
| `618dc0d397e` | **respect backpressure in the sync stream (#30764)** | `send()` becomes `async`; the fork has 13 fork-only sync stream methods with **75 `send(response, …)` + 16 `sendEntityBackfillCompleteAck`** call sites that must all be awaited, or the fork's largest payloads keep the old fire-and-hope behaviour |
| `3af2ba19ec8` | iOS dynamic background ids (#30574)                  | Touches the iOS background worker                                                                                                                                                                                                                     |
| `80a90fabf34` | update ocr & faces after asset edit (#29303)         | **Adds 2 upstream migrations** (`1786972746371-AssetOcrUpdatedAtTrigger`, `1786972746372-AssetOcrSyncReset`), neither covered by `scripts/revert-to-immich.sql`                                                                                       |
| `03da1ba1087` | single line block comments (#30852)                  | Adds an eslint rule to 4 configs → fork-side sweep                                                                                                                                                                                                    |
| `1539ae8b07d` | resend an upload once on dead connection (#30843)    | —                                                                                                                                                                                                                                                     |
| `ea3fa927767` | actions undo handling (#30481)                       | Mobile action layer, where the fork holds three standing divergences; also touches `main.dart` (recurring CRLF whole-file conflict)                                                                                                                   |
| `65b4b9b8fbe` | deep link to memory lane (#30787)                    | —                                                                                                                                                                                                                                                     |

## Zero-conflict semantic break detectors (run pre-rebase)

| Detector                                                                                               | Result                                                                    |
| ------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------- |
| Deleted URL literals vs literal-matching fork tooling (`branding/scripts`, `tools`, `.github/actions`) | 12 removed URLs, **0 silent-noop risks**                                  |
| Symbols deleted/renamed upstream vs fork references                                                    | 29 symbols, **all from the quarantined #30693** — deferred with the batch |
| Fork-relevant paths deleted by upstream                                                                | none                                                                      |

One break was **not** caught by either detector and is recorded below.

## Conflict resolutions

### 1. `mobile/analysis_options.yaml` — deliberate reversal of a fork decision

- **Fork side**: commit `align analysis with rebased sync models` removes
  `always_put_control_body_on_new_line` (both the rule and its `errors:` severity).
- **Upstream side**: `ffc83eae360` regroups the entire `rules:` block and re-adds that rule.
- **Resolution**: take upstream's file wholesale — verified byte-identical to
  `ffc83eae360:mobile/analysis_options.yaml`. The fork commit's removal becomes a no-op.
- **Risk**: LOW mechanically, but it **reverses a maintainer decision**. Adopted on Pierre's
  explicit instruction (2026-08-18) to take upstream's rule set wholesale rather than keep
  the divergence. Cost: 177 violations to sweep (below).
- **Verification**: `dart analyze --fatal-infos lib test` clean after the sweep.

### 2. `mobile/lib/presentation/pages/drift_people_collection.page.dart` — combine, don't pick a side

- **Fork side**: #980 replaces the inline grid with the shared `PeopleGrid` widget, deleting
  the `LayoutBuilder` block and `_PersonName` entirely.
- **Upstream side**: `ffc83eae360`'s new `parameter_assignments` rule rewrote the same region —
  `people` was a reassigned callback parameter, so upstream introduced a separate local.
- **Resolution**: take the fork's post-#980 file, then apply the equivalent compliance to the
  fork's surviving reassignment (a ternary-initialised `filtered` local, which needs no
  re-added `Person` import). Taking the fork side alone would have left a `parameter_assignments`
  violation in the replacement code; taking upstream's alone would have reverted #980.
- **Risk**: LOW. **Verification**: paren-balance delta vs the fork commit's own version is −2,
  exactly the removed `if (` / `)`; analyzer clean.

### 3. `mobile/test/unit/factories/remote_album_factory.dart` — union of both sides

- **Fork side**: #985 adds a `currentUserRole` parameter and passes it through.
- **Upstream side**: `parameter_assignments` again — `id = TestUtils.uuid(id)` became
  `final albumId = …`, with three downstream references renamed.
- **Resolution**: upstream's file plus the fork's two added lines.
- **Verification**: diff against the upstream side is exactly the fork's 2 lines; diff against
  the fork side is exactly upstream's `albumId` rename. Provably the union.

### 4. `mobile/pubspec.yaml` + `mobile/pubspec.lock` — keep the newer fork pin

- **Fork side**: `background_downloader ^9.5.7` (#892 / the iOS notification-crash work).
- **Upstream side**: `d84be93c2cc` moves it 9.5.4 → 9.5.6.
- **Resolution**: hunk-by-hunk — the fork's `9.5.7` and its sha256 for the three conflicting
  hunks, everything else in upstream's pub upgrade left alone. `git checkout --theirs` was
  **not** used: it would have discarded upstream's other 36 lines of bumps.
- **Verification**: `flutter pub get --enforce-lockfile` (the exact form CI's
  `mise //mobile:install:ci` runs, which hard-fails on lock/manifest disagreement) succeeds.

### 5–8. `pnpm-lock.yaml` ×4 — generated artifact, one regen at the end

Four fork commits (`unicorn v70 autofixes`, `TypeScript 7 toolchain`, `unicorn v72 propagation`,
`regenerate to match svelte 5.56.8`) each carry a full stale lockfile regeneration, so their
hunks are nonsense to hand-merge. All four resolved by keeping the replayed side, then one
regeneration at the end.

**This is the arc-4 trap and it fired.** `pnpm install --frozen-lockfile` failed with
`ERR_PNPM_LOCKFILE_CONFIG_MISMATCH`: the kept lockfile still pinned `patchedDependencies` at
`@immich/ui@0.83.0` while `pnpm-workspace.yaml` declares `0.85.0`. One
`pnpm install --no-frozen-lockfile` reconciled it (commit `97bd1bc884a`).

Post-regen invariants, all verified:

- `pnpm install --frozen-lockfile` passes (the CI gate).
- Workspace deps stay symlinked — **9** `version: link:`, **0** `version: file:` — so
  `injectWorkspacePackages` did not activate.
- `@immich/ui` patch resolves at `0.85.0`, matching `patches/@immich__ui@0.85.0.patch`.
- `@faker-js/faker` stays on upstream's `10.5.0`, so the seeded UI Playwright fixtures are
  unaffected.

### Two fork commits emptied by the replay

The lockfile resolutions emptied two commits, and git dropped them (1182 → 1180). Named rather
than inferred from the count:

- `fix: regenerate pnpm-lock.yaml to match svelte 5.56.8 manifest bump`
- `fix(build): keep workspace deps symlinked in the lockfile (revert accidental injection)`

Both are lockfile-only maintenance, and **both intents are preserved and independently verified**
in the final tree: the frozen install passes, and the 9/0 link-vs-file counts hold.

## Zero-conflict semantic break found

**Upstream `avoid_unused_constructor_parameters` (one of #30665's seven new rules) deleted the
unused `GalleryPermissionNotifier` parameter from `AppRouter` and from `appRouterProvider`.**
The fork-only `mobile/test/routing/router_test.dart` still constructed `AppRouter` with five
positional arguments and stopped compiling.

Nothing conflicted — upstream never touched that file. Neither pre-rebase detector saw it:
the symbol was not deleted (only a parameter was) and no literal moved. Only
`dart analyze` caught it. The usual mocktail blind spot does not apply, because constructor
arity is checked at the construction site rather than absorbed by `noSuchMethod`.

Fixed in `ddeeeb4b47b` by dropping the argument, the now-unused mock class, and its import.

**Generalisation worth keeping**: a lint rule that removes _unused parameters_ is a
signature-changing rule. After any batch enabling one, grep fork-only code for constructions of
the affected classes — the fork's own call sites are exactly the ones upstream's sweep did not
see.

## Pattern propagation — Dart lint rule set

| Refactor                                          | Old → new                            | Fork files affected | Decision    | Commit        |
| ------------------------------------------------- | ------------------------------------ | ------------------- | ----------- | ------------- |
| flutter_lints 6.0 + regrouped rules + 7 new rules | fork's reduced rule set → upstream's | 95                  | **Bundled** | `0c3cc23e8b4` |

Sweep detail, measured after codegen so the analyzer could see the fork's Drift output:

- **177 `always_put_control_body_on_new_line`** across 87 files. Fixed with **braces**, not with
  a bare body on its own line: a bare body is re-joined onto the `if` line by `dart format` when
  it fits, which re-triggers the rule. Braces are also upstream's own idiom — `upstream/main` has
  no single-line control bodies at all. All 177 sites were the identical shape
  `if (…) <stmt>;` with no `else` and only 3 trailing comments, which is what made a scripted
  transform safe; the script refused anything not matching that shape and refused 0.
- **16 `unnecessary_underscores`** (a flutter_lints 6.0 default, e.g. `(_, __, ___)` → `(_, _, _)`)
  via `dart fix --apply`, run once per path since it takes one path per invocation.
- **0 violations of the seven new rules.** The single `parameter_assignments` site was already
  resolved during the batch-103 replay (conflict 2 above).

**Codegen matters before believing the count.** The first analyzer run reported 396 issues; 200 of
them were `uri_does_not_exist`/`undefined_*` errors pointing at _fork-only_ Drift output
(`shared_space*.entity.drift.dart`, `library.entity.drift.dart`, `schema_v32`–`v36`) that had not
been generated in this worktree. After `build_runner` and `drift_dev schema generate` the true
count was 196.

**The `shared_preferences: any` pollution recurred**: something in the codegen chain appended it to
`mobile/pubspec.yaml` under `dev_dependencies`, in the wrong place (after a comment belonging to
`dependency_overrides`). Reverted. It also produced a _phantom_ lint result worth noting — with the
stray dependency present, 13 `// ignore: depend_on_referenced_packages` comments were reported as
`unnecessary_ignore`; reverting the pollution made those ignores necessary again and the 13
findings vanished. **Always revert that line before trusting an `unnecessary_ignore` count.**

## Fork feature verification

| Feature                    | Status | Notes                                                         |
| -------------------------- | ------ | ------------------------------------------------------------- |
| Shared Spaces              | OK     | `upstream-postrebase-audit` symbol + file survival green      |
| Storage Migration          | OK     | Untouched by arc A                                            |
| Pet Detection              | OK     | Untouched by arc A                                            |
| Image Editing              | OK     | Untouched by arc A                                            |
| Branding                   | OK     | `gallery-branding-check.sh` passed, incl. mobile image assets |
| Google Photos Import       | OK     | Untouched by arc A                                            |
| Mobile Spaces / Drift sync | OK     | `mobile-drift-rebase-check` green; `flutter test` 3342 passed |
| Fork migrations            | OK     | 58 Gallery migrations, count unchanged                        |

## CI and infrastructure verification

| Check                            | Status | Notes                                                                       |
| -------------------------------- | ------ | --------------------------------------------------------------------------- |
| Fork-owned file survival         | OK     | audit: all literal fork-owned files present                                 |
| Fork extension symbol survival   | OK     | audit: all manifest symbols present                                         |
| Gallery migration count          | OK     | 58 (expected 58)                                                            |
| Migration timestamp collisions   | OK     | none                                                                        |
| Generated artifact review        | OK     | no upstream generated-artifact changes need review                          |
| `fork-patches-check`             | OK     | `@immich/ui` patch metadata consistent                                      |
| `ci-invariants-check`            | OK     | no-push-o-matic, gallery-release-image-names, docs-deploy-disabled all pass |
| `mobile-drift-rebase-check`      | OK     | schemaVersion, snapshots, Gallery callbacks consistent                      |
| `fork-ownership-coverage-check`  | OK     | manifest covers 3670 fork files                                             |
| Branding check                   | OK     | full apply-then-verify in a temp worktree                                   |
| `mise.lock` / `mobile/mise.lock` | OK     | byte-identical to the pre-arc tip; no local `mise` invocation rewrote them  |

## Database migration analysis

**No upstream migrations land in arc A.** The two new ones (`1786972746371-AssetOcrUpdatedAtTrigger`,
`1786972746372-AssetOcrSyncReset`, from the quarantined `80a90fabf34`) are held with batch 114.

The step-7i coverage detector — the same grep `gallery-revert-to-immich-validation`'s first job runs
— reports **0 missing entries** against tagged upstream `v3.1.0` (88 migration files). Both new
migrations will need `scripts/revert-to-immich.sql` entries **in arc B**, or that gate fails on the
rolling branch and every branch based on it.

## Mobile Drift migration analysis

No change. `schemaVersion`, the fork-owned snapshots v32–v36 and the Gallery migration callbacks are
untouched by arc A; `mobile-drift-rebase-check BATCH=106` confirms the chain is consistent. The
`@DriftAccessor` refactor that _does_ restructure this layer is quarantined.

## Inconsistencies found

1. **`web/package.json`'s `lint` script is missing `--max-warnings 0`.** The fork runs
   `eslint . --concurrency 6`; upstream runs `eslint . --max-warnings 0 --concurrency 6`, and
   `CLAUDE.md` documents a zero-warnings policy. **Pre-existing, not caused by this arc** — verified
   character-identical before and after (`backup/rolling-pre-arcA-20260818:web/package.json`). Left
   alone deliberately: restoring the flag changes lint strictness and could surface a backlog
   unrelated to this rebase. Worth its own change.

## Local CI verification

| Check                                               | Status  | Notes                                                                          |
| --------------------------------------------------- | ------- | ------------------------------------------------------------------------------ |
| `mise run plugins` (sdk + plugin-sdk + plugin-core) | PASS    | fresh-worktree prerequisite                                                    |
| `server pnpm build` (+ postbuild migration sync)    | PASS    | Synced 58 Gallery migrations, 1 compatibility alias                            |
| `server pnpm check` (tsc)                           | PASS    |                                                                                |
| `web check:typescript`                              | PASS    |                                                                                |
| `web check:svelte`                                  | PASS    | 609 files, 0 errors, 0 warnings (not the 0-file no-op)                         |
| `server pnpm lint`                                  | PASS    | `--max-warnings 0`                                                             |
| web eslint (`tscompat` off)                         | PENDING | Ran >25 min locally without finishing; CI's Lint Web job is the authority      |
| Server unit tests                                   | PASS    | 171 files, 5685 passed / 12 skipped / 0 failed                                 |
| Web unit tests                                      | PASS    | 363 files, 5694 passed / 2 skipped / 8 todo / 0 failed                         |
| `dart analyze --fatal-infos lib test`               | PASS    | **No issues found**                                                            |
| `dart format` (CI-exact, lib minus generated)       | PASS    | 852 files, **0 changed**                                                       |
| `flutter test` (Flutter 3.44.9)                     | PASS    | **3342 passed / 1 skipped / 0 failed**                                         |
| `flutter pub get --enforce-lockfile`                | PASS    | validates the hand-resolved `pubspec.lock`                                     |
| `pnpm install --frozen-lockfile`                    | PASS    | after the regen                                                                |
| OpenAPI regeneration                                | PASS    | no drift (arc A changes no DTO/controller/repository)                          |
| `make sql`                                          | SKIPPED | no repository method changed; running it without a DB deletes every query file |

## Remote CI verification

To be recorded when the dispatched suite completes.

## Post-rebase verification

- Upstream commits taken: **6** (branch contains `01e40c07486`, 0 behind it)
- Upstream commits deliberately held: **13** (`01e40c07486..upstream/main`)
- Fork commits ahead of the arc-A boundary: **1180** (1182 before, minus the two emptied lockfile commits)
- Backup branch: `backup/rolling-pre-arcA-20260818` @ `2e9c75f73ee`
