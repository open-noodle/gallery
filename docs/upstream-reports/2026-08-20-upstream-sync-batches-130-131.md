# Upstream Sync Report — 2026-08-20 (batches 130–131, the #30881 config port)

## Summary

- **Upstream commits pulled**: 3 (`e529557160d`, `f9f73114183`, `f88fb628ff5`) — the quarantine released
- **Conflicts resolved**: ~12 manual, plus three classes handled by audited auto-rules
- **Risk level**: HIGH (config contract rewrite), mitigated by an enforced admin-only invariant
- **Recommendation**: PROCEED — every local gate green

The branch is now **level with `upstream/main`** for the first time since the quarantine, 1220 fork
commits ahead. Design: `docs/superpowers/specs/2026-08-20-upstream-config-endpoints-port-design.md`.
Plan: `docs/superpowers/plans/2026-08-20-upstream-config-endpoints-port.md`.

## What landed

| SHA           | Summary                                                 | Notes                                                                                                                                     |
| ------------- | ------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| `e529557160d` | feat: new config endpoints (#30881)                     | Deleted `config.ts` + `system-config.dto.ts` + `model-config.dto.ts`; replaced by a zod schema with per-leaf Public/User/Admin visibility |
| `f9f73114183` | refactor: use public config (#30891)                    | Login page reads `publicConfig`                                                                                                           |
| `f88fb628ff5` | chore(mobile): patch Flutter for iOS simulator (#30821) | Wanted; was blocked only by commit ordering                                                                                               |

## The port

Fork config now lives in a **fork-owned leaf module** `server/src/gallery/config.dto.ts`, composed
into upstream's schema at seven seams. Every fork field is unannotated and therefore defaults to
`Admin` — behaviour-identical to before.

`configBool` is deliberately duplicated as `galleryConfigBool`: upstream's is module-private, and
importing it would make the gallery module circular with `config.dto.ts`, leaving the const undefined
at module-init time. The coercion is load-bearing — it is what makes `IMMICH_CONFIG_FILE` string
booleans parse.

`petDetection` is defined **independently** rather than extending
`AdminConfigMachineLearningModelSchema`, whose `enabled` leaf upstream annotates `visibility: User`.
Extending it would have silently exposed pet detection to every logged-in user. The consequence is an
accepted asymmetry: `petDetection.enabled` is the only ML task `enabled` that is admin-only.

## Rebase mechanics — this was not a normal batch

The fork's **squashed base commit** already depends on all three deleted modules, so the collision
started at fork commit #1 and recurred across the replay of **1215 commits**. Three auto-rules handled
the bulk, each derived from evidence rather than assumption, with a hard stop on anything else:

| Class                                                           | Rule                                                                   | Justification                                                        |
| --------------------------------------------------------------- | ---------------------------------------------------------------------- | -------------------------------------------------------------------- |
| The 3 deleted config files                                      | `git rm`                                                               | Content relocates to the gallery module; preserved in the backup ref |
| Generated artifacts                                             | take one side                                                          | Regenerated once at the end — never hand-merged                      |
| 20 files whose entire `#30881` delta is the `src/config` import | take fork side, rewrite the path                                       | Computed from the commit diff                                        |
| Pure import-member unions                                       | `union_imports.py` — refuses anything not matching `^\s*Identifier,?$` | Provably safe; verified by marker count                              |

Two tooling bugs found the hard way, both worth remembering:

- **zsh does not word-split unquoted variables**, so `for f in $CONF` iterated once with two filenames
  concatenated. Single-file conflicts advanced; multi-file ones misclassified.
- The file classifier initially reported **0 auto-resolvable files** because its regex matched
  `src/config` but not the replacement `src/dtos/config.dto`. Trusting it would have turned 20
  mechanical resolutions into 20 manual stops.

## Findings that contradicted the design

1. **The `SystemConfigDto` alias does not survive SDK generation.** It exists in the server source
   (`export { AdminConfigDto as SystemConfigDto }`), but `@immich/sdk` is generated from the OpenAPI
   spec, whose schema ids contain only `AdminConfigDto`. The client rename was therefore **required**,
   not optional: 8 files for the type, 10 for the `systemConfigDto` → `adminConfigDto` request param.
   One (`ClassificationSettings.svelte`) is invisible to `tsc` — only `pnpm check:svelte` caught it.
2. **`grep -c '"visibility"'` is not a valid leak check.** Immich has a legitimate `visibility` asset
   property, giving ~21 hits with zero leakage. Replaced with a walker matching the metadata key by
   value (`Admin`/`User`/`Public`). Actual leaks: **0**.

Both documents were corrected in place.

## Verification

The admin-only invariant is **enforced, not asserted**: `mapUserConfig`/`mapPublicConfig` must contain
no fork key. It was **proved red** by annotating `storageUsage.includeDerivatives` as `User`, then
green again on revert. The composition test guards the silent-drop failure mode — the schema strips
unknown keys, so a fork field missing from it would vanish at runtime with no error.

| Check                                   | Result                                           |
| --------------------------------------- | ------------------------------------------------ |
| `server pnpm check`                     | PASS (95 → 29 → 0 errors)                        |
| `server pnpm lint` / `prettier`         | PASS                                             |
| Server unit tests                       | PASS — 179 files, 5758 tests                     |
| `web check:typescript` / `check:svelte` | PASS — 622 files, 0 errors                       |
| Web unit tests                          | PASS — 363 files, 5694 tests                     |
| `e2e pnpm check` / `lint` / `prettier`  | PASS                                             |
| `dart analyze --fatal-infos`            | PASS — no issues                                 |
| `dart format`                           | PASS                                             |
| `flutter test`                          | PASS — 3356 tests                                |
| OpenAPI regeneration                    | PASS — all fork DTOs present, 0 visibility leaks |
| `revert-to-immich.sql` coverage         | PASS — unchanged; section 5 still correct        |
| Gallery migration count                 | 58 (unchanged)                                   |

`classification.service.spec.ts` and the fork's admin-settings web specs pass **unmodified**, which is
the design's check that the port did not alter behaviour.

## Remote CI — 10/10 green

- **Test branch**: `rebase/upstream-batch-131`
- **Commits validated**: `26068cc4e40` (nine workflows) and `d315fe77070` (`test.yml`, after the fix below)

| Workflow                                  | Result                                                   |
| ----------------------------------------- | -------------------------------------------------------- |
| `test.yml`                                | GREEN on `d315fe77070` — red on the first run, see below |
| `docker.yml`                              | GREEN                                                    |
| `static_analysis.yml`                     | GREEN                                                    |
| `gallery-build-mobile.yml`                | GREEN                                                    |
| `gallery-mobile-smoke.yml`                | GREEN                                                    |
| `gallery-ml-smoke.yml`                    | GREEN                                                    |
| `gallery-rebase-smoke.yml`                | GREEN                                                    |
| `gallery-revert-to-immich-validation.yml` | GREEN                                                    |
| `storage-migration-tests.yml`             | GREEN on re-run — confirmed environmental, see below     |
| `storage-migration-e2e.yml`               | GREEN                                                    |

### One real failure — a stale local test run

`Test Web` failed on five `ClassificationSettings.spec.ts` assertions. **Cause: a local verification
gap, not the port.** The web suite was run and reported green, and only _afterwards_ was
`ClassificationSettings.svelte` edited to rename `systemConfigDto` → `adminConfigDto` (fixing what
`check:svelte` caught). The suite was never re-run, so five assertions still expected the old param
name.

Fixed in `d315fe77070`; the full web suite re-verified at 363 files / 5694 tests, and a tree-wide
sweep confirmed no other `systemConfigDto` mismatch survives (remaining hits are upstream's own alias
export and comments).

**Process lesson: re-run the affected suite after any post-test edit.** A green run is only evidence
about the tree that produced it.

### One confirmed flake — `storage-migration-tests`

The `delete-source-false` phase died at "Verifying API access works (admin)" with
`SocketError: other side closed` on `/assets/{id}/original`. Judged environmental on four
independent pieces of evidence, not on a re-run alone:

- it passed on re-run;
- the failing test file is **unchanged** by the port (`git diff` vs the pre-port backup is empty);
- the server logged a clean boot and normal migration work, then **no error whatsoever** at the moment
  the socket closed — no exception, no crash, no restart;
- the sibling `storage-migration-e2e.yml` passed the same S3 serving path on the same commit.

This workflow had passed 8 of its previous 8 runs, so the failure was investigated as a suspected
regression before being classified.

### Tooling note

`npx prettier --check` must be run **from inside the package** — from the repo root the
`@trivago/prettier-plugin-sort-imports` plugin fails to resolve and the command errors in a way that
can be mistaken for a different problem.

## Backup

`rolling-backup-2026-08-20-pre-config-port` → `c276fa06c03`, the pre-port tip.
