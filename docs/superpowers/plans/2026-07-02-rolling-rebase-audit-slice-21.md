# Slice 21 — LOW#23: sync `gallery-build-mobile` pigeon input list

**Spec:** `docs/superpowers/specs/2026-07-02-rolling-rebase-audit-remediation.md` §"Slice 21"
**Findings:** `docs/plans/2026-07-02-rolling-rebase-audit-findings.md` LOW#23
**Branch / worktree:** `rebase/upstream-rolling-20260509-active`

---

## Step A — ground truth

`ls mobile/pigeon/*.dart` lists **9** files:

```
mobile/pigeon/background_worker_api.dart
mobile/pigeon/background_worker_lock_api.dart
mobile/pigeon/connectivity_api.dart
mobile/pigeon/local_image_api.dart
mobile/pigeon/native_sync_api.dart
mobile/pigeon/network_api.dart
mobile/pigeon/permission_api.dart      <- missing from workflow
mobile/pigeon/remote_image_api.dart
mobile/pigeon/view_intent_api.dart     <- missing from workflow
```

`.github/workflows/gallery-build-mobile.yml` has a "Generate platform APIs" step that
appears **twice** — once in the `build-sign-android` job (lines 178-188) and once in the
`build-sign-ios` job (lines 392-402), both byte-identical in shape. Each currently lists
only **7** `dart run pigeon --input pigeon/<file>.dart` lines (missing
`permission_api.dart` and `view_intent_api.dart`), followed by one `dart format` line
listing the corresponding 7 generated `lib/platform/*.g.dart` outputs.

Each pigeon input file declares its own outputs via an inline `@ConfigurePigeon(...)`
annotation (`dartOut`, `swiftOut`/`kotlinOut`, etc. — see `mobile/pigeon/permission_api.dart`
and `mobile/pigeon/view_intent_api.dart`), so the CLI invocation itself needs no
`--dart_out`/`--swift_out`/`--kotlin_out` flags — just `--input pigeon/<file>.dart`. The
only other place the two new inputs need representation is the trailing `dart format`
line, which lists every generated `lib/platform/*.g.dart` file so the pigeon output is
formatted before commit-time lint. Per each source file's `dartOut`, the new outputs are:

- `permission_api.dart` → `lib/platform/permission_api.g.dart`
- `view_intent_api.dart` → `lib/platform/view_intent_api.g.dart`

**Plan:** add one `dart run pigeon --input pigeon/permission_api.dart` line and one
`dart run pigeon --input pigeon/view_intent_api.dart` line to _each_ of the two
"Generate platform APIs" step blocks, and append
`lib/platform/permission_api.g.dart lib/platform/view_intent_api.g.dart` to each block's
`dart format` line. No other file needs modification (this is a workflow-only fix; the
`.g.dart` outputs are gitignored build products of `dart run pigeon`, not committed).

---

## Step B — RED guard

New file: `tools/upstream-preflight/src/pigeon-inputs.spec.ts`.

Uses the `yaml` package (already a dependency, see `src/manifest.ts` for the import
convention: `import YAML from 'yaml';`) to parse
`.github/workflows/gallery-build-mobile.yml`, walks every job's `steps`, and for each
step named `Generate platform APIs` extracts the `pigeon/<file>.dart` paths referenced
by `dart run pigeon --input ...` lines in that step's `run` block.

- Reads the real file set from `mobile/pigeon/*.dart` (basenames only).
- For **each** matching step (there must be at least one), asserts the step's parsed
  input-file set is exactly equal (as a `Set`, order-insensitive) to the real
  `mobile/pigeon/*.dart` set — catches both missing and stale/extra entries, and (via a
  length check) duplicate entries.
- Follows the repo-root-relative-fs convention from `mobile-nav.spec.ts` /
  `migration-timestamps.spec.ts` (`path.resolve(process.cwd(), '../../<dir>')`, since
  vitest runs from `tools/upstream-preflight`).

**Expected RED:** both steps (Android job + iOS job) are missing `permission_api.dart`
and `view_intent_api.dart` from their `--input` list.

**Command:** `cd tools/upstream-preflight && npx vitest run src/pigeon-inputs.spec.ts`

---

## Step C — GREEN

Edit `.github/workflows/gallery-build-mobile.yml` in both "Generate platform APIs" step
blocks (Android job + iOS job):

- Add `dart run pigeon --input pigeon/permission_api.dart` and
  `dart run pigeon --input pigeon/view_intent_api.dart` lines alongside the existing 7.
- Append `lib/platform/permission_api.g.dart lib/platform/view_intent_api.g.dart` to the
  `dart format` line.

Re-run the guard → green (both steps' input sets now equal the 9-file `mobile/pigeon/`
set).

---

## Edge cases covered

- Guard is set-equality (order-insensitive) — the new inputs don't need to be inserted in
  any particular position.
- Guard checks **every** step named "Generate platform APIs" independently (both the
  Android and iOS jobs), so a future fix to only one job would still fail the guard.
- Guard fails on future drift in either direction: a new `mobile/pigeon/*.dart` file added
  without a matching workflow `--input` line, or a workflow `--input` line referencing a
  pigeon file that no longer exists.
- Each `--input pigeon/<file>.dart` referenced by the workflow is asserted to actually
  exist on disk (implied by the set-equality check against the real directory listing).

## GREEN commands

```
cd tools/upstream-preflight && npx vitest run src/pigeon-inputs.spec.ts
```

(File-scoped only per parallel-mode rules — no whole-project `pnpm check`/`pnpm test`.)

## Commit

`fix(ci): add permission/view-intent pigeon inputs to mobile build (LOW #23)`

(Left uncommitted per orchestrator instructions — this line records the intended message
for the orchestrator's commit.)
