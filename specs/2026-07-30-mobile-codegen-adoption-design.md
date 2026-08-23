# Mobile Codegen Adoption + Dart Lint Propagation — Design

**Date**: 2026-07-30
**Context**: rolling upstream rebase `rebase/upstream-rolling-v3.1.1`, quarantined at batch 12
**Status**: approved, ready for implementation planning

## Problem

Upstream removes **all committed mobile generated code** across three commits and moves CI to
build-time generation:

| Commit                 | Removes                                                                                          |
| ---------------------- | ------------------------------------------------------------------------------------------------ |
| `27a29b6fabd` (#30297) | Drift output — `*.drift.dart`, `db.repository.steps.dart`, `mobile/test/drift/main/generated/**` |
| `6c01b4f5d8e` (#30287) | the entire `mobile/openapi/` generated Dart client                                               |
| `9a143f00471` (#30343) | Pigeon output — `*.g.dart`, `*.g.kt`, `*.g.swift`                                                |

They also delete `static_analysis.yml`'s generated-file freshness gate, drop `mobile/openapi` from
`test.yml`'s `verify-changed-files`, and remove the `mobile/openapi` `merge=unset` entries from
`.gitattributes`.

Interleaved with them, batches 15/20/24 (`d864a908117`, `858aeadce80`, `e7aace436d2`) enable ~20 new
Dart lint rules.

The fork's exposure: `CLAUDE.md` documents committed codegen, `make open-api` commits the Dart client
including fork-only surfaces, the fork owns Drift snapshots v32–v36, and three fork-only mobile
workflows assume the committed layout.

## Measurements

Taken on the rolling branch at `5aa0e1cf518` with Flutter 3.44.8 and full codegen.

**Codegen already runs.** `mobile/mise.toml`'s `install` task already declares
`depends = ["//:open-api-dart"]`, so `mobile/openapi` is regenerated on every `flutter pub get` in
CI today. Every `codegen:*` mise task already exists. The fork is already paying the generation
cost and _additionally_ committing the output.

**Lint scope.** Baseline `dart analyze lib test` under current rules: **0 issues**. Under upstream's
`analysis_options.yaml`: **1101**.

170 of those are `always_put_control_body_on_new_line`, which the fork **deliberately disables** —
it strips both the rule and its `errors:` severity entry. A whole-file swap re-enables it, so those
170 are measurement noise. Correcting:

|                                        |             Issues |
| -------------------------------------- | -----------------: |
| Attributable to the three lint commits |            **931** |
| — in files shared with upstream        |                797 |
| — **in fork-only files**               | **134** (75 files) |

The 797 shared-file issues arrive already fixed: upstream's commits touch 208 + 125 + 29 files doing
exactly that cleanup.

Fork-only breakdown:

| Rule                                                                                                              | Count | `dart fix` |
| ----------------------------------------------------------------------------------------------------------------- | ----: | ---------- |
| `discarded_futures`                                                                                               |    81 | no         |
| `directives_ordering`                                                                                             |    29 | yes        |
| `noop_primitive_operations`                                                                                       |     7 | yes        |
| `cast_nullable_to_non_nullable`                                                                                   |     6 | no         |
| `use_decorated_box`, `unnecessary_breaks`, `prefer_const_declarations`, `use_named_constants`, `avoid_void_async` |    11 | yes        |

≈47 machine-fixable, ≈87 needing a human decision. Confirmed by sampling `dart fix --dry-run`:
4 proposed fixes against 42 analyze issues in `lib/pages/library/spaces`, 3 against 70 in
`lib/presentation/widgets/filter_sheet`.

## Decisions

1. **Adopt upstream's direction.** Stop committing mobile generated code. It removes a permanent
   four-file divergence (`.gitattributes`, `.gitignore`, `static_analysis.yml`, `test.yml`) and
   kills the recurring `mobile/openapi` merge conflict that forced a hand-applied fork sync on
   2026-07-25.
2. **Codegen adoption is a prep PR on `main`**, not inline in the rolling branch. It gets the
   PR-only CI gates (docs / CodeQL / zizmor / cli) the rolling branch never runs, and it makes
   batches 12/13/20 near-no-ops because both sides then delete the same paths.
3. **Lint is NOT pre-adopted on `main`.** Enabling the rules on main would make
   `dart analyze --fatal-infos` red until all **931** are fixed — including 797 that upstream is
   about to fix for us, guaranteeing same-line conflicts at batches 15/20/24. Lint is handled
   inside the rolling branch instead, fixing only the 134 fork-only issues.

## Part 1 — prep PR on `main`

> Verified against upstream's post-removal state at `aa565f5ca07` rather than inferred from the
> three commit diffs. Two things that inspection corrected:
>
> 1. **The OpenAPI client MOVES**, it is not merely un-committed: `mobile/openapi` →
>    `mobile/generated/openapi`, with `mobile/pubspec.yaml`'s path dependency, the generator
>    script's output path, and the analyzer excludes all following it. Root `.gitignore` then
>    ignores the whole `mobile/generated` tree.
> 2. **Upstream adds two mise tasks** the fork does not have: a `[tasks.codegen]` aggregate
>    (`depends = ["codegen:dart", "codegen:drift:schema", "codegen:pigeon", "codegen:translation"]`,
>    taking over the `codegen` alias from `codegen:dart`) and
>    **`[tasks."codegen:drift:schema"]`** —
>    `dart run drift_dev schema generate --data-classes --companions drift_schemas/main/ test/drift/main/generated/`.
>    That second task is what makes deleting `mobile/test/drift/main/generated/` safe; without it the
>    Drift migration tests lose their generated schema classes.
>
> Also note upstream **keeps** the `.gitattributes` entries for `*.g.dart` / `*.g.kt` / `*.g.swift` /
> `*.drift.dart` / `db.repository.steps.dart` and removes only the four `mobile/openapi/**` lines.
> Match that exactly — deleting more re-creates divergence for no benefit.

### Delete (~614 files)

- `mobile/openapi/**` — 515
- `mobile/**/*.drift.dart` — 35, plus `mobile/lib/infrastructure/repositories/db.repository.steps.dart`
- `mobile/test/drift/main/generated/**` — 37
- Pigeon output — `mobile/lib/platform/*.g.dart`, `mobile/android/**/*.g.kt`,
  `mobile/ios/**/*.g.swift` — 26

**Keep `mobile/drift_schemas/main/*.json`** (36 files). These are codegen _inputs_, upstream keeps
them, and the fork owns v32–v36.

### Move the OpenAPI client to `mobile/generated/openapi`

| File                                | Change                                                                                                                                   |
| ----------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| `open-api/bin/generate-dart-sdk.sh` | every `../mobile/openapi` → `../mobile/generated/openapi`, preserving all three fork template patches and the four post-generate patches |
| `mobile/pubspec.yaml`               | `openapi: path: openapi` → `path: generated/openapi`; `analyzer.exclude: - openapi/**` → `- generated/openapi/**`                        |
| `mobile/analysis_options.yaml`      | `exclude: - openapi/**` → `- generated/openapi/**`                                                                                       |
| `mise.toml`                         | `outputs = ["../mobile/openapi/lib/"]` → `["../mobile/generated/openapi/lib/"]`                                                          |
| `renovate.json`                     | `"mobile/openapi/pubspec.yaml"` → `"mobile/generated/openapi/pubspec.yaml"`                                                              |
| `docs/fork/ownership.yml`           | `openapi-generated` glob `mobile/openapi/**` → `mobile/generated/openapi/**`                                                             |

### mise tasks

Add to `mobile/mise.toml`, mirroring upstream:

- `[tasks.codegen]` with `alias = "codegen"` and
  `depends = ["codegen:dart", "codegen:drift:schema", "codegen:pigeon", "codegen:translation"]`
- `[tasks."codegen:drift:schema"]` running
  `dart run drift_dev schema generate --data-classes --companions drift_schemas/main/ test/drift/main/generated/`
- drop `alias = "codegen"` from `codegen:dart` (the aggregate takes it)

### Config

- root `.gitignore` — add `mobile/generated`; drop
  `mobile/openapi/{pubspec.lock,test,doc,.openapi-generator/FILES}`.
- `mobile/.gitignore` — add upstream's block after `/build/`: `lib/**/*.drift.dart`,
  `test/drift/main/generated/`, and a `# Pigeon related` group with `/lib/platform/*.g.dart`,
  `/ios/**/*.g.swift`, `/android/**/*.g.kt`. Keep the fork's trailing
  `integration_test/test_bundle.dart`.
- `.gitattributes` — remove **only** the four `mobile/openapi/**` lines. Keep every other entry,
  matching upstream.

### Workflows

- `static_analysis.yml` — replace the three codegen steps plus the `verify-changed-files` freshness
  gate with `mise //mobile:codegen`. The gate asserts committed output is current; once output
  isn't committed it can only ever report "changed". (Keep the fork's DCM step commented out.)
- `test.yml` — drop `mobile/openapi` from the "OpenAPI Clients" job's `verify-changed-files` list,
  leaving `packages/sdk` and `open-api/immich-openapi-specs.json`.
- `gallery-mobile-smoke.yml` — same treatment as `static_analysis.yml`.
- `gallery-mobile-scale-test.yml` — `make pigeon` → `mise //mobile:codegen:pigeon`. This step
  already fails: `mobile/makefile`'s `pigeon` target is a deprecation stub that prints
  "This command has been removed" and exits 1, so the nightly has been red for ≥5 days
  (latest run 30518470271, failing step "Generate platform APIs"). Independent bug, fixed here.
- `gallery-build-mobile.yml` — replace the hand-rolled `dart run easy_localization:generate` /
  `dart run pigeon --input …` steps with `mise //mobile:codegen`.

### Docs

`CLAUDE.md` — two statements become false and must be corrected:

- the mobile note that "Drift/OpenAPI generated code is committed, so `build_runner` is not needed
  for tests";
- the OpenAPI Workflow section's "Both must be committed".

### Verification

- Full PR CI, including the PR-only gates.
- Dispatch `gallery-mobile-smoke` and `gallery-build-mobile`.
- Locally, from a clean checkout: `mise //mobile:codegen` then `flutter test` must pass with no
  committed generated code present.

## Part 2 — rolling branch, batches 12→26

1. `make upstream-sync-fork-main` to carry PR 1 onto the rolling branch.
2. Lift the quarantine: `upstreamTargetHead` → `aa565f5ca07`, re-run `make upstream-batch-plan`,
   and record the release in `rolling-state.json` `quarantineHistory` (`releasedAt` /
   `releaseReason`).
3. Batches 12/13/20 should be near-no-ops on generated files — both sides delete the same paths.
4. **Batches 15/20/24 — `mobile/analysis_options.yaml` invariant.** Take upstream's rule additions
   but preserve the fork's removal of `always_put_control_body_on_new_line` (the rule _and_ its
   `errors:` entry). A whole-file "take upstream" silently introduces 155 fork-only violations.
5. Fix the 134 fork-only issues: `dart fix --apply` for the ~47 mechanical ones, then hand-fix the
   81 `discarded_futures` and 6 `cast_nullable_to_non_nullable`.
6. Carry-forward stops already known from the Checkpoint-1 audit:
   - **Batches 22 / 25** each add an upstream migration (`9732bebb55a` user password,
     `6b6058c4631` album description) → `scripts/revert-to-immich.sql` must gain both entries or
     `gallery-revert-to-immich-validation` fails on this branch and everything based on it.
   - **Batch 17** (`a316ba35caf`) rewrites `automock()` prototype walking in `server/test/utils.ts`
     and makes `AuthGuard` throw when a route lacks `@Authenticated()`. All 55 fork-only controller
     routes already carry the decorator; re-verify the `automock` change against fork specs.

## Risks

| Risk                                                                                                                                  | Mitigation                                                                                                                            |
| ------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| `discarded_futures` — 81 sites each needing `await` / `unawaited()` / justified ignore; a wrong call hides an unhandled async failure | Review each site individually; use `unawaited()` only where fire-and-forget is genuinely intended, never as a blanket silencer        |
| Local dev ergonomics regress — `flutter test` now needs codegen first                                                                 | `mise //mobile:install` already depends on `//:open-api-dart`; document the codegen step in `CLAUDE.md`                               |
| `analysis_options.yaml` resolved whole-file at batch 15/20/24                                                                         | Recorded as a standing rebase invariant in Part 2 step 4                                                                              |
| Deleting 614 files hides an accidental deletion of something non-generated                                                            | Deletions are path-pattern driven and every pattern maps to a codegen task; verify with a clean-checkout codegen + `git status` empty |

## Out of scope

- The Dart lint work itself is specified here but executed on the rolling branch, not in PR 1.
- Upstream's `static_analysis.yml` changes arrive with the batches; the fork does not pre-apply them.
- No change to `mobile/drift_schemas/` ownership or the v32–v36 snapshot numbering.
