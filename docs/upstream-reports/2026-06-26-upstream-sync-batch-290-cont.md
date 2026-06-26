# Upstream Sync Report — 2026-06-26 (batch 290, continuation)

> **Batch-number note.** The rolling planner folds late-arriving upstream commits
> into the current batch number and renumbers "completed" down (the documented
> batch-290 behaviour). After bumping `upstreamTargetHead`
> `49a821b0d0` → `688241a462`, `upstream-rolling-status` flipped from
> "290/290 completed" to "289/290, next batch **290**" with the two new commits
> folded in. The prior `2026-06-25` batch-290 report (and its first addendum,
> #29296/#29325) is already a sealed, CI-green, pushed milestone, so rather than
> stack a third addendum onto it this continuation gets its own dated file.
> Together they cover the full planner-batch 290 (`0931a19c..688241a462`).

## Summary

- **Upstream commits pulled**: 2 (`49a821b0d0..688241a462`)
- **Fork commits synced**: 0 — `origin/main` (`7dbd29113`) already equals
  `integratedForkHead`; no `upstream-sync-fork-main` needed.
- **Conflicts resolved**: 0 (clean rebase; the three fork-modified files in the
  touched set 3-way-merged cleanly and were verified semantically)
- **Migrations**: none (server + mobile-drift schema unchanged)
- **Version bump**: none (both commits are untagged v3-dev; `branding/config.json`
  `upstream.version` stays `2.7.5`)
- **Risk level**: LOW
- **Recommendation**: PROCEED

This is a low-risk batch shape: one mobile reconciliation (#29320 refactors the
mobile action/button system the fork extends) and one additive plugin-sdk change
(#29323). Per the v3 rolling rules, mobile is not locally verifiable (worktree
flutter pin) and rests on CI; the plugin-sdk/lockfile change rests on `docker.yml`.

## Incoming Upstream Changes

| SHA          | Summary                                     | Area               | Risk to Fork | Notes                                                                          |
| ------------ | ------------------------------------------- | ------------------ | ------------ | ------------------------------------------------------------------------------ |
| `cb1af3a8ec` | feat: favorite bottom sheet action (#29320) | mobile             | LOW–MEDIUM   | Refactors the mobile action/button framework — fork touches 2 of those files.  |
| `688241a462` | feat: plugin-sdk safety all around (#29323) | packages/plugin-\* | LOW          | Additive `commander` dep + CLI; fork has **zero** divergence on plugin source. |

### `#29320` — favorite bottom sheet action (mobile)

Upstream introduces an action framework (`presentation/actions/{action,asset_debug,favorite,timeline}.action.dart`),
renames `AssetService` constructor params (`remoteAssetRepository` → `remoteRepository`,
`localAssetRepository` → `localRepository`, adds `apiRepository`), changes
`ActionButtonBuilder.buildButton` return type `ConsumerWidget` → `Widget`, replaces
the `advancedInfo` button with `ActionMenuItemWidget(action: AssetDebugAction(...))`,
deletes `advanced_info_action_button.widget.dart`, and drops the `WidgetRef ref`
parameter from `buildViewerKebabMenu`.

Two fork-modified files sit in this set and 3-way-merged cleanly:

- **`mobile/lib/providers/infrastructure/asset.provider.dart`** — both imports land
  (fork's `sync_status.provider.dart` + upstream's `asset_api.repository.dart`);
  `assetServiceProvider` adopts upstream's renamed params + `apiRepository`; the
  fork's `placesProvider` keeps its `ref.watch(syncStatusProvider.select(...))`
  invalidation. Fork delta on top of upstream = exactly the two fork additions.
- **`mobile/lib/utils/action_button.utils.dart`** — the fork's `viewInTimeline`
  button (a `BaseActionButton`, i.e. a plain `Widget`) is fully compatible with the
  new `Widget buildButton(...)` signature and keeps its
  `maybePop()`/`navigateTo(MainTimelineRoute())`/`scrollToDateNotifierProvider`
  body. Fork delta = the `scroll_to_date_notifier` import + that button body.

Compile-risk scan across the fork mobile tree (since flutter can't run locally):

- `buildViewerKebabMenu` — only caller is `viewer_kebab_menu.widget.dart:53`,
  already 2-arg `(actionContext, context)`, matches the new signature. ✓
- `AdvancedInfoActionButton` / `advanced_info_action_button.widget` — **no** fork
  references; upstream's deletion leaves no dangling import. ✓

### `#29323` — plugin-sdk safety all around

Rewrites `packages/plugin-core/src/index.ts`, adds `packages/plugin-sdk/src/cli.ts`
and a `commander@^15.0.0` dependency (+4 lines in `pnpm-lock.yaml`), tweaks
`esbuild.js`/`host-functions.ts`/`sdk.ts`. The fork carries **no** divergence on
plugin-sdk/plugin-core source (`git diff upstream/main..HEAD` over those dirs is
empty), so the rewrite applies as-is. The fork's only plugin customization — the
build-ORDER fix in `mise.toml [tasks.plugins]` and the Dockerfile stages (build
`@immich/sdk` before the inject-install so cold builds resolve `@immich/sdk`) —
filters by package name and runs each package's own `build` script, neither of
which #29323 changes. The new `commander` dep is in the frozen lockfile, so
`pnpm install --frozen-lockfile` picks it up.

## Conflict Resolutions

None — the rebase replayed all 819 fork commits with no conflict.

## Fork Feature Verification

| Feature             | Status | Notes                                                                   |
| ------------------- | ------ | ----------------------------------------------------------------------- |
| Mobile action ext   | OK     | `viewInTimeline` button + `asset.provider` sync-status watch intact.    |
| Plugin build wiring | OK     | `mise.toml [tasks.plugins]` build-order fix untouched; no source drift. |
| All others          | OK     | server/web/cli/ml/e2e/open-api byte-identical to last-green tip.        |

## CI and Infrastructure Verification

| Check                                      | Status | Notes                                                                       |
| ------------------------------------------ | ------ | --------------------------------------------------------------------------- |
| `make upstream-postrebase-audit BATCH=290` | OK     | files/symbols survive; migrations 33/33; no collisions; no artifact review. |
| `make ci-invariants-check`                 | OK     | no PUSH_O_MATIC; gallery images; docs-deploy disabled.                      |
| `make fork-patches-check`                  | OK     | @immich/ui patch consistent.                                                |
| `make mobile-drift-rebase-check BATCH=290` | OK     | schemaVersion/snapshots/callbacks consistent.                               |

## Database Migration Analysis

No new upstream migrations; Gallery migration count steady at 33. No
`scripts/revert-to-immich.sql` change and no mobile-drift renumbering required.

## Mobile Drift Migration Analysis

No `db.repository.dart` / `drift_schemas/` changes — `mobile-drift-rebase-check`
green. Fork `schemaVersion` unchanged.

## Inconsistencies Found

None.

## Pattern Propagation

No broad upstream refactor in this batch. (Outstanding deferred item unchanged:
#29140 `z.string()` → `z.uuidv4()` on fork-only DTO IDs — still spec-annotation-only
pending output `ZodSerializerDto` validation; safe to defer.)

## Local Verification

The diff between the last CI-green tip (`c0d62cfa72`) and the rebased HEAD is
**exactly** the two upstream commits — no other tree changed:

```
git diff --name-only c0d62cfa72 HEAD
→ only mobile/** , packages/plugin-{core,sdk}/** , pnpm-lock.yaml
```

Therefore server/web/cli/machine-learning/e2e/open-api are byte-identical to the
last green state and their heavy local gates (server lint/unit/check, web
check/unit, SDK build, OpenAPI/SQL regen) are provably redundant. Lockfile fork
pins verified intact: `@aws-sdk/client-s3@3.1025.0`, `@faker-js/faker@10.3.0`,
`nanoid@3.3.12`. Mobile rests on CI per the no-local-mobile rule; the plugin-sdk
build rests on `docker.yml`.

## Remote CI Verification

- **Test branch**: `rebase/upstream-batch-290`
- _(to be filled after dispatch)_

| Workflow                                  | Status    | Notes                                                               |
| ----------------------------------------- | --------- | ------------------------------------------------------------------- |
| `test.yml`                                | _pending_ | Unit Test Mobile + the 20-job suite                                 |
| `static_analysis.yml`                     | _pending_ | dart analyze + format + `*.g.dart` freshness (mobile authoritative) |
| `gallery-build-mobile.yml`                | _pending_ | iOS + Android compile (mobile authoritative)                        |
| `docker.yml`                              | _pending_ | server/web/cli/ml + **plugins** image (validates #29323 cold build) |
| `gallery-rebase-smoke.yml`                | _pending_ |                                                                     |
| `storage-migration-tests.yml`             | _pending_ |                                                                     |
| `gallery-revert-to-immich-validation.yml` | _pending_ | coverage grep (no migration delta → no SQL change)                  |

## Post-Rebase Verification

- Fork commits ahead of upstream: 819 (1 squashed + 818 PRs) + this report commit
- Commits behind upstream: 0 (`merge-base(HEAD, upstream/main) == upstream/main == 688241a462`)
- Prior target `49a821b0d` is an ancestor of HEAD: yes
- Fork diff looks clean: yes — only the two upstream commits land on top of the
  last-green fork delta
