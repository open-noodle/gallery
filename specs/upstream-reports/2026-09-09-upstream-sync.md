# Upstream Sync Report — 2026-09-09 (batches 228–229)

## Summary

- **Upstream commits pulled**: 4 (`956330958f3..86ae0dd06c7`)
- **Fork commits synced from `origin/main`**: 1 (#1084)
- **Conflicts resolved**: 3
- **Risk level**: LOW
- **Recommendation**: PROCEED
- **Branch tip**: `745a610d9f4` on `rebase/upstream-rolling-v3.1.1`
- **Cursors**: `upstreamTargetHead` `86ae0dd06c7`, `integratedForkHead` `2971a07320f`
- **Position**: 0 behind `upstream/main`, 1479 fork commits ahead

## Upstream moved to release branches — the rebase source does not change

Upstream introduced per-minor release branches at `v3.2.0-rc.0` (2026-08-27) and tagged **v3.2.0**
on 2026-09-09, on `release/v3.2` rather than on `main`. This was checked before rebasing, because it
changes what "level with upstream" means.

`prepare-release.yml` gates release types by branch:

```
main:premajor | main:preminor                              → allowed
release/*:patch | release/*:prerelease | release/*:release  → allowed
```

and, only when run on `main`, cuts the branch and creates the backport label:

```bash
line=$(sed -E 's/^(v[0-9]+\.[0-9]+).*/\1/' <<< "${VERSION}")
git push origin "HEAD:refs/heads/release/${line}"
gh label create "backport:release/${line}" --force --color 5319e7
```

Fixes land on `main` first; `backport.yml` (korthout/backport-action, driven by a
`backport:release/vX.Y` label on a merged `main` PR) opens an auto-merging backport PR onto the
release branch. The direction is always main → release.

**Verified empirically**: of the 40 commits on `release/v3.2` that are not on `main`,
`git cherry upstream/main upstream/release/v3.2` marks **35 as patch-equivalent** to a `main`
commit. The remaining 5 are four `chore: version …` bumps plus the maplibre-gl v6 security bump,
which _is_ on `main` as `68e3409305c` (immich-31355) — the release copy is `163d3c71f97`
(immich-31375) and differs only in lockfile context; both trees pin `"maplibre-gl": "^6.0.0"`.

**Conclusion: `upstream/main` remains the correct rebase source** — it is the content superset. Do
not retarget at `release/*`: that branch renames every minor (`release/v3.3` will fork from `main`
at its own rc.0), so switching lines would deliver ~2 months of feature work as one unreviewable
batch, and backport SHAs differ from `main`'s, which would produce duplicate-content conflicts.

Two consequences worth recording:

1. **`main` now carries exactly one version commit per minor line** (`chore: version vX.Y.0-rc.0`),
   so `chore: version` commits are no longer usable as batch anchors on `main`.
2. **A release-only hotfix would be invisible to us.** Main-first is upstream policy, not a
   guarantee — a fix authored directly on `release/*`, or a backport whose
   `draft_commit_conflicts` resolution diverged materially, would never reach `main`. Today the
   check is clean. A cheap standing gate would be: resolve the newest `upstream/release/*`, run
   `git cherry upstream/main <that>`, and fail if any `+` commit is not a `chore: version` bump.
   **Not implemented this cycle** (Pierre scoped the session to the CLAUDE.md version line only).

The fork deletes all three of upstream's release-line workflows (`prepare-release.yml`,
`draft-release.yml`, `backport.yml`), so none of this machinery reaches Gallery CI.

## Incoming Upstream Changes

| SHA           | Summary                                                               | Area     | Risk to Fork | Notes                                                                                                                                                                                                            |
| ------------- | --------------------------------------------------------------------- | -------- | ------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `ed386952095` | chore(mobile): split Timeline dragging into new widget (immich-31255) | mobile   | MEDIUM       | Extracts 149 lines from `timeline.widget.dart`, where the fork carries 471 insertions. 2 conflicts. Upstream's extracted widget keeps the `!isReadonlyModeEnabled` gates verbatim, so no fork gate was at stake. |
| `d2245c7d075` | fix: memory page navigation (immich-31334)                            | web      | LOW          | Rewrites `MemoryManager.load()`/`clearCache()` and drops the `loading` guard from `MemoryViewer`'s `$effect`. Rolling had zero fork content in either file; applied clean. See "Follow-up work".                 |
| `68e3409305c` | fix(deps): maplibre-gl v5→v6 \[security] (immich-31355)               | web/deps | LOW          | Also `svelte-maplibre` 1→2. Only one consumer in the tree (`Map.svelte`); the fork's divergence there is disjoint from upstream's module-block change. Lockfile applied without regeneration.                    |
| `86ae0dd06c7` | fix: backport PRs requested review team (immich-31377)                | CI       | LOW          | Modify/delete against the fork's deletion of `backport.yml`. Resolved keep-deleted.                                                                                                                              |

**Product-direction gate: did not fire.** Nothing in the batch reworks a surface the fork owns.

## Pre-rebase detectors (all clean)

| Detector                                          | Result                                                                                                                                                                         |
| ------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Shape I — upstream adds a fork-touched path       | Clean. `timeline_drag_selection.dart` has no fork history (scoped to `origin/main`, not `--all`).                                                                              |
| Shape I — rename onto a fork-touched path         | No renames in range.                                                                                                                                                           |
| Shape S — deleted members the fork still calls    | 4 hits (`_dragScroll`, `_setDragStartIndex`, `_stopDrag`, `_handleDragAssetEnter`) — **all same-file moves**, not deletions. Confirmed by reading upstream's extracted widget. |
| Silent-noop — deleted URL literals                | 0 URL literals deleted in range.                                                                                                                                               |
| i18n branding override gap                        | Clean.                                                                                                                                                                         |
| Retired directory resurrection (`mobile/openapi`) | Still empty.                                                                                                                                                                   |
| Zero-byte tracked files                           | Only the 3 legitimate pre-existing (`CODEOWNERS`, `docs/static/.nojekyll`, `docs/static/CNAME`).                                                                               |
| Lockfile workspace injection                      | 0 `version: file:`; 11 `version: link:`. **The skill's "expect 9" is stale** — the repo gained plugin-sdk packages.                                                            |

## Conflict Resolutions

### Conflict 1 — `mobile/lib/presentation/widgets/timeline/timeline.widget.dart` (at fork commit #625)

Two diff3 regions, **both with `ours` empty** against a 67-line and 44-line `base` — the Shape K
asymmetry, where "take ours" silently discards fork content.

- **Region 1** (`ours=0, base=67, theirs=131`): `base` is contiguous inside `theirs` at offset 64,
  so `theirs = fork_additions(64) + base(67)`. Upstream moved the drag methods out; the fork's 64
  lines are `_scheduleZoomAnchorResolution` / `_resolveZoomAnchor`.
  **Resolution**: keep the 64 fork lines, drop the moved drag block.
- **Region 2** (`ours=0, base=44, theirs=48`): `base` **not** contiguous in `theirs` — the fork had
  edited inside the block. Upstream relocated the whole `grid`/`Scrubber` construction into
  `TimelineDragSelection(builder: (physics) {...})`, which sits in the shared context below the
  conflict. The fork's delta was exactly two edits: `groupBy: activeGroupBy,` and
  `monthSegmentSnappingOffset: timelineScrubberSnappingOffset(...)`.
  **Resolution**: take `ours` (empty) and re-apply both fork edits onto upstream's relocated copy.
- **Risk**: MEDIUM at resolution time, LOW after verification.
- **Verification**: 0 conflict markers; 0 orphan references to the moved symbols
  (`_dragging`, `_dragAnchorIndex`, `_draggedAssets`, `_scrollPhysics`, and the four methods);
  whole-file fork-line survival audit → **452 fork-added lines, 0 missing**.

### Conflict 2 — same file (at fork commit #680)

Import block: `ours` = `timeline_drag_selection.dart`, `base` = `timeline_drag_region.dart`,
`theirs` = `timeline_drag_region.dart` + the fork's `timeline_grouping_anchor.dart`.

- **Resolution**: keep upstream's new import plus the fork's, alphabetically sorted.
- **Risk**: LOW. **Verification**: `TimelineDragRegion` references in the file = 0 (it is now used
  only inside upstream's extracted widget); `TimelineDragSelection` = 1.

### Conflict 3 — `.github/workflows/backport.yml` (modify/delete, at fork commit `44883bb15fe`)

Upstream modified the file; the fork commit ("ci: drop upstream's new release-line workflows, which
need Immich-only infra") deletes it.

- **Resolution**: keep deleted, via `git rm` — deliberately **not** `git checkout --theirs`, which
  writes a zero-byte tracked workflow. That exact failure has happened on this exact file before.
- **Risk**: LOW. **Verification**: file absent from `HEAD`; zero-byte scan shows no new entries;
  `.github/` tree is byte-identical to the last green tip, because the fork's deletion cancels
  upstream's edit.

## Post-rebase fix

`745a610d9f4` — `style(mobile): reindent the scrubber snapping-offset call after the drag-selection
split`. The re-applied `timelineScrubberSnappingOffset(...)` in conflict 1 region 2 kept the
pre-relocation indentation; upstream's move added two nesting levels. Caught by
`dart format --set-exit-if-changed`, not by `dart analyze`. Formatting only.

## Fork Feature Verification

| Feature                                                                             | Status | Notes                                                                                                                |
| ----------------------------------------------------------------------------------- | ------ | -------------------------------------------------------------------------------------------------------------------- |
| Shared Spaces                                                                       | OK     | `Map.svelte` fork lines survive (24/24), incl. `getSpaceMapMarkers`, `withSharedSpaces`.                             |
| Mobile timeline (grouping, zoom anchor, scroll drain, `spaceId`)                    | OK     | 452/452 fork lines survive in `timeline.widget.dart`.                                                                |
| Memories (fork viewer additions)                                                    | OK     | 20/20 fork lines survive in `MemoryViewer.svelte` (space `view in timeline` href, per-asset date, `enableGrouping`). |
| Storage Migration / Pet Detection / Image Editing / Branding / Google Photos Import | OK     | `server`, `machine-learning`, `branding` trees byte-identical to the last 10/10-green tip.                           |

## CI and Infrastructure Verification

| Check                                   | Status | Notes                                                                            |
| --------------------------------------- | ------ | -------------------------------------------------------------------------------- |
| Workflow files (no upstream collisions) | OK     | `.github/` tree identical to last green tip.                                     |
| Docker image references (`gallery-*`)   | OK     | `ci-invariants-check` `gallery-release-image-names` passed.                      |
| Branding (no upstream-name leaks)       | OK     | i18n override detector clean; `branding/` tree identical.                        |
| Fork CI modifications intact            | OK     | All 5 `ci-invariants-check` invariants passed, incl. `search-v3-not-dispatched`. |
| New upstream workflows reviewed         | OK     | All three release-line workflows stay deleted on the fork.                       |

## Database / Mobile Migration Analysis

No server or mobile migrations in this batch.

- Gallery migration count: **67** (expected 67); filename survival and manifest coverage OK; no
  upstream/Gallery timestamp collision.
- Mobile Drift: `schemaVersion => 38`, snapshots through `v38`, callback chain contiguous —
  `mobile-drift-rebase-check` passed.
- `postbuild` migration sync and `CompositeMigrationProvider` untouched (`server` tree identical).

## Inconsistencies Found

None introduced by this cycle. One pre-existing item noted below.

## Local CI Verification

Gate set scoped by tree identity against `957632531ed` (the last 10/10-green tip). **IDENTICAL**:
`server`, `machine-learning`, `open-api`, `packages`, `i18n`, `.github`, `docker`, `deployment`,
`branding`, `e2e`, `docs`, `specs`, `tools`, `scripts`. **CHANGED**: `web`, `mobile`.

| Check                                   | Status  | Notes                                                                                             |
| --------------------------------------- | ------- | ------------------------------------------------------------------------------------------------- |
| `web check:typescript`                  | PASS    | exit 0                                                                                            |
| `web check:svelte`                      | PASS    | 640 files, 0 errors, 0 warnings                                                                   |
| web eslint (`tscompat` off)             | PASS    | exit 0                                                                                            |
| web unit tests                          | PASS    | 391 files, 6388 tests                                                                             |
| `dart analyze --fatal-infos`            | PASS    | "No issues found!" (Flutter 3.47.2, per `mobile/mise.toml`)                                       |
| `dart format --set-exit-if-changed`     | PASS    | after `745a610d9f4`                                                                               |
| `flutter test`                          | PASS    | 3820 passed, 1 skipped                                                                            |
| `tools/upstream-preflight` suite        | PASS    | 24 files, 257 tests                                                                               |
| `upstream-postrebase-audit` 228 & 229   | PASS    | 8/8 checks each                                                                                   |
| `ci-invariants-check`                   | PASS    | 5/5                                                                                               |
| `fork-patches-check`                    | PASS    | `@immich/ui` patch metadata consistent                                                            |
| `fork-ownership-coverage-check`         | PASS    | 3545 fork files covered                                                                           |
| `mobile-drift-rebase-check`             | PASS    |                                                                                                   |
| `commit-autolink-check`                 | PASS    | 1479 messages scanned, fork PR ceiling 1085                                                       |
| `rolling-final-check`                   | PASS    | second consecutive clean cycle                                                                    |
| Server / ML / e2e / SQL / OpenAPI regen | SKIPPED | Trees byte-identical to a 10/10-green tip; no `server/src/repositories/` change, so no SQL regen. |

**Local trap hit again**: the gitignored `test/drift/main/generated/` was stale (5
`uri_does_not_exist` for `schema_v32`–`v36`), which presents as a broken merge and would otherwise
mask the mobile suite. Fixed with
`dart run drift_dev schema generate --data-classes --companions drift_schemas/main/ test/drift/main/generated/`
(39 files, now through `schema_v38`). This is the second consecutive cycle it has fired.

## Whole-tree accounting

`git diff e2efbf69af6..HEAD` touches exactly 7 files, all attributable to the 4 upstream commits:
`timeline.widget.dart`, `timeline_drag_selection.dart`, `pnpm-lock.yaml`, `web/package.json`,
`Map.svelte`, `memory-manager.svelte.ts`, `MemoryViewer.svelte`. No unexplained deltas.

## Follow-up work

- **`fix/memory-escape-hang` is invalidated by `d2245c7d075` and is currently orphaned.** That fix
  (gate the bail-out effect on `navigating.to`; add a `#generation` guard to `MemoryManager.load()`)
  is on a **local-only** branch, tip `b96cb896ed3` (2026-08-28), whose base was rewritten by later
  rolling cycles. It is on neither rolling nor `origin/main`. Upstream has now rewritten the same
  code differently: the `#queued` re-entry moved to the top of `load()` with an early `return`,
  `#loading = undefined` dropped from `clearCache()`, and the `loading` guard dropped from
  `MemoryViewer`'s `$effect`. Whether that also fixes the reported hang is **unverified**. Rework
  the branch against the new shape, or re-test the hang on this tip before discarding it.
- **Release-line drift gate** (see the release-branch section above) — not implemented.
- **`AGENTS.md` version line**: `main` says "based on **Immich v2.7.5**", two minors stale.
  A fix is staged on `docs/upstream-version-anchor` off `origin/main` (uncommitted at time of
  writing) correcting it to v3.1.0, pointing at `branding/config.json` → `upstream.version` as the
  source of truth, and recording the release-branch model. It will reach rolling via a later fork
  sync. The rolling branch's own copy still carries the stale line.
