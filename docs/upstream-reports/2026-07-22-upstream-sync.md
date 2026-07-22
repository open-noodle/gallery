# Upstream Sync Report — 2026-07-22 (batches 24–32)

## Summary

- **Branch**: `rebase/upstream-rolling-v3.0.3` (held off `main`)
- **Upstream commits pulled**: 22 (batches 24–32, up to `7a7303ace`)
- **Fork commits synced from `origin/main`**: 2 (#824, #813)
- **Conflicts resolved**: 11 across 9 files
- **Batches complete**: 32 / 35 — batch 33 remains quarantined, 34–35 blocked behind it
- **Risk level**: MEDIUM (TypeScript 7, eslint-unicorn v72, GitHub Actions major)
- **Recommendation**: PROCEED

Three toolchain majors landed in this run — TypeScript 6→7, eslint-plugin-unicorn
v70→v72 and the GitHub Actions major. All three needed fork-side propagation that
upstream's own sweeps did not cover.

## Incoming Upstream Changes

| Batch | Tip         | Commits | Area                | Risk to Fork | Notes                                                       |
| ----- | ----------- | ------: | ------------------- | ------------ | ----------------------------------------------------------- |
| 24    | `2e587fc7e` |       1 | docs                | LOW          | Bulgarian readme; fork README kept its own NOTE block       |
| 25    | `e918658cc` |       1 | docker              | LOW          | mise image tag 2026.7.7 → 2026.7.11                         |
| 26    | `1b4d41324` |       4 | deps, server, web   | **HIGH**     | **TypeScript v7**, pnpm 11.13.1, upload-filename fix        |
| 27    | `ce022233a` |       1 | docker              | LOW          | base-image → v202607211135                                  |
| 28    | `aa08dad1f` |       1 | lint                | **HIGH**     | **eslint-plugin-unicorn v72**                               |
| 29    | `ae8398ffe` |       1 | docker              | LOW          | valkey digest bump                                          |
| 30    | `e6fff3b15` |       6 | mobile, web, server | MEDIUM       | Android startup refactor, web palette entry, lens-model fix |
| 31    | `59bc81423` |       1 | ci                  | **HIGH**     | **github-actions major** across 15 workflows                |
| 32    | `7a7303ace` |       5 | mobile              | MEDIUM       | album picker, photo_manager pin, maplibre SwiftPM lock      |

### High-risk changes — detailed analysis

#### Batch 26 — TypeScript v7 (#29903)

Upstream did **not** simply bump the compiler. It installed both majors side by side:

- `typescript` is aliased to `npm:@typescript/typescript6` — ships its binary as **`tsc6`**
- `@typescript/native` is aliased to `npm:typescript@7` — ships **`tsc`**

Every `tsc --noEmit` script in the repo (server, web, e2e, cli) therefore now runs
**TypeScript 7**, while TS 6 stays available for the editor, `svelte-check` and
`typescript-eslint`. This is the opposite of the initial reading — the migration is
not opt-in, and the fork's ~3,100 changed files were type-checked by TS 7 for the
first time here.

Fork breakage was narrow but real: **2 errors** in `server/src/utils/database.ts`.
`hasPeople` and `hasFaceIdentities` early-return the untouched builder when their id
list is empty, so each has a union return type (joined vs not joined). `hasAllPeople`
chained them directly, passing that union where `SelectQueryBuilder<DB, 'asset', O>`
is expected. TS 6 accepted it; TS 7 does not. Upstream never hits this because its
`hasPeople` has no early return and every caller guards with `$if`.

Fixed by rewriting `hasAllPeople` with the `$if` idiom already used at every other
fork call site (`asset.repository`, `search.repository`) — identical behaviour, no
casts. `packages/sdk`, `plugin-sdk` and `plugin-core` compile under TS 7.0.2, which
matters because `packages/sdk/src/fetch-client.ts` carries ~2,400 lines of
fork-generated endpoints.

The same commit moved pnpm to **11.13.1**. Two historical fork commits pinning pnpm
(11.5.2, then 11.6.0) are now fully superseded by the build-before-inject reorder in
`server/Dockerfile`, which survives intact; both were resolved to upstream's version.

#### Batch 28 — eslint-plugin-unicorn v72 (#30092)

Far smaller than the v70 sweep (27 files vs ~900). Upstream disabled the noisy new
`unicorn/prefer-simple-condition-first` in its server, web and cli configs.

Fork-only propagation needed:

- `web` — 5 errors: `prefer-split-limit` in `timeline-bucket`, `prefer-string-repeat`
  in the #813 Recently Added specs
- `server` — 1 leftover: the `extname` import orphaned by #30024 (see below)
- `e2e` — 52 errors; see "Pre-existing debt" below

#### Batch 31 — GitHub Actions major (#30095)

`actions/checkout` v6→v7, `actions/setup-node` v6→v7, `actions/cache` v5→v6 across
15 upstream workflows. Four conflicts, all cases where the fork had deleted the job
or step upstream was bumping. Each was resolved by keeping the fork's removal **and**
adopting upstream's new pin on the surviving steps, so no workflow silently stayed on
an old action.

The fork's own workflows are still on older pins (12× checkout v4.2.2, 8× v6.0.2, 2×
setup-node v6.2.0, 2× cache v5.0.4). This is **pre-existing** drift, not caused by
this batch — see "Follow-up work".

## Conflict Resolutions

| #   | File                                                       | Fork side                                                   | Upstream side                 | Resolution                                                                                               | Risk |
| --- | ---------------------------------------------------------- | ----------------------------------------------------------- | ----------------------------- | -------------------------------------------------------------------------------------------------------- | ---- |
| 1   | `e2e/package.json`                                         | adds `tsx`                                                  | dual TS install               | kept both                                                                                                | LOW  |
| 2   | `server/src/services/asset-media.service.ts`               | `createReadStream`, `extname`, `isAbsolute`                 | dropped `extname`             | kept the fork import line so the ~948 downstream commits replayed cleanly; removed the orphan at the tip | LOW  |
| 3–5 | `mise.toml`, `mise.lock`, `package.json` (×3 commits)      | pnpm 11.5.2 / 11.6.0 / 11.11.0 pins                         | 11.13.1                       | took upstream; the pins are superseded by the Dockerfile reorder, which applied cleanly                  | LOW  |
| 6   | `packages/scripts/package.json`                            | deleted (#29331 tooling dropped)                            | modified                      | kept the deletion                                                                                        | LOW  |
| 7   | `pnpm-lock.yaml` (×2)                                      | fork lock w/ `@immich/ui` patch, axe-core, faker pin        | upstream TS7 lock             | kept fork side mid-replay, regenerated with `pnpm install` at the end                                    | LOW  |
| 8   | `MemoryViewer.svelte`                                      | `isHistorySource` conditional promise                       | `.then().catch()` restructure | combined both                                                                                            | LOW  |
| 9   | `e2e/docker-compose.yml`                                   | valkey from ghcr (Docker Hub rate limits)                   | new docker.io digest          | fork registry + upstream digest, after confirming both digests resolve on ghcr (HTTP 200)                | LOW  |
| 10  | `.github/workflows/auto-close.yml`                         | template-enforcement jobs removed                           | checkout bump inside them     | kept the deletion; only `close_llm` remains                                                              | LOW  |
| 11  | `docs-destroy.yml`, `prepare-release.yml`, `test.yml` (×4) | deleted / token steps removed / `script-unit-tests` dropped | action bumps                  | kept every fork removal, adopted upstream's pins on surviving steps                                      | LOW  |

## Verification

### Local gate — all green

| Check                                                     | Result                                  |
| --------------------------------------------------------- | --------------------------------------- |
| server prettier / eslint / `tsc` (TS 7) / `tsc6` (TS 6)   | PASS (0/0/0/0)                          |
| server unit tests                                         | PASS — 5099 passed, 9 skipped           |
| web prettier / eslint / `tsc`                             | PASS — 0 errors                         |
| web `svelte-check`                                        | PASS — 568 files, 0 errors, 0 warnings  |
| web unit tests                                            | PASS — 3752 passed, 2 skipped, 8 todo   |
| mobile `dart analyze --fatal-infos`                       | PASS — no issues                        |
| mobile `dart format`                                      | PASS — 791 files, 0 changed             |
| mobile tests                                              | PASS — 2819 passed, 1 skipped           |
| mobile codegen freshness (`build_runner`)                 | PASS — 190 outputs, **0 files changed** |
| e2e prettier / eslint / `tsc`                             | PASS (0/0/0)                            |
| cli + `.github` gates                                     | PASS                                    |
| `@immich/sdk`, `plugin-sdk`, `plugin-core` under TS 7.0.2 | PASS                                    |

Toolchain note: mobile must be driven through `mise exec` from `mobile/`
(Flutter 3.44.6 / Dart 3.12.2). `mise run codegen:dart` resolved Flutter **3.44.0**
against a pubspec requiring 3.44.6 and failed; `mise exec -- dart run build_runner`
is the working path.

### Rebase audits — all green

Post-rebase audit (7 checks) ran per batch; `ci-invariants-check`,
`fork-patches-check` and `mobile-drift-rebase-check` all pass at the tip. Fork
migration count steady at 48. No upstream migration timestamp collisions.
`revert-to-immich.sql` coverage detector reports **0 missing** — no migration
entered the tree in batches 24–32, so batch 35's `AddOAuthBearerTokenToSession`
will be the next one to need an entry.

A full-tree conflict-marker scan was run after **every** batch, not only at the end.

### Repo integrity

During batch 30 a concurrent `git gc`/repack removed a packfile mid-rebase, producing
`packfile ... index unavailable` errors. The rebase still reported success and was
verified sound afterwards: pack/index counts match (5/5), `git archive HEAD` reads
every object in the tree, and a full `git rev-list --objects` walk exits 0.

## Pre-existing debt found and fixed

Two classes of debt predating this run were surfaced by the full gate and closed:

1. **Formatting** — 24 server files and 2 web files failed `prettier --check`, which
   CI runs over the whole package (`mise //server:ci-unit` → `:format`). All were
   fork-touched. The batch 18–23 run checked only the files it modified, so this had
   been red since then. Formatting-only fix; no import removal, no semantic change.

2. **e2e lint** — 52 eslint-unicorn errors across 20 fork-touched files. The v70
   propagation covered server and web but skipped e2e, which CI does gate
   (`mise //e2e:ci-unit` → `:lint`). Verified pre-existing by running today's config
   against the pre-batch-24 file contents (identical error counts). Closed as:
   23 autofixed, 24 hand-fixed (all behaviour-preserving — see the commit message for
   the per-rule reasoning, notably that `parseInt(s, 10)` → `Number(s)` was checked
   per site rather than applied blindly), and 3 harness-hostile rules disabled for
   e2e only — `no-top-level-side-effects`, `no-top-level-assignment-in-function`,
   `no-break-in-nested-loop`. That mirrors the precedent upstream set in this very
   batch, and `e2e/src/utils.ts` already carried file-level suppressions for two of
   them, which are now redundant and removed.

## Product-direction gate

Applied per batch. It did **not** fire as a blocker, but one finding is worth
recording.

**Upstream continues to develop its own command palette.** `e6fff3b15` adds a
Maintenance entry to `getPagesProvider` in `web/src/lib/commands.ts`. In the fork
that provider is **dead code** — `commands.ts` is imported only for
`getMyImmichLink`, and the live palette is the fork's cmdk implementation driven by
`web/src/lib/managers/command-items.ts`. The commit is therefore inert here.

The divergence is deliberate and long-standing, so quarantining would have been
wrong. But it now has a concrete user-visible cost: the fork **has** `/admin/maintenance`
(route and page both exist) and its palette has **no** entry for it, so fork admins
cannot jump there from cmd+K. Every future entry upstream adds will miss fork users
the same way. Logged as follow-up.

Also checked and dismissed: `899f54705` fixes an empty-string `lensModel` bug in
`SearchFilterModal.svelte`, a component the fork deleted with the legacy SearchBar
flow (#416). The fork's filter panel builds typed filter state rather than a
free-text form, and `lensModel` appears only in display/deep-link paths with real
values, so the bug does not apply.

## Quarantine

Batch 33 (`ee4bd3f83`, "add album asset event handling", #29008) remains held by the
2026-07-21 product-direction decision: it reshapes `AlbumUpdate` and adds
`on_album_update`, overlapping the fork's space-album event model. `lastAllowedTip`
is `7a7303ace` — verified an ancestor of HEAD, and `ee4bd3f83` verified **not** in
HEAD. Batches 34–35 sit behind it and cannot be pulled until the converge-vs-parallel
call is made.

## Follow-up work

1. **Command-palette Maintenance entry** — add `/admin/maintenance` to the fork's
   `command-items.ts` to match upstream's `getPagesProvider`, and decide whether the
   two palettes should be reconciled or the dead `getPagesProvider` dropped.
2. **Fork workflow action pins** — bump the fork's own workflows to checkout v7 /
   setup-node v7 / cache v6. Pre-existing drift; the v4.2.2 pins are old enough to be
   worth attention. Deliberately deferred: these workflows push images, sign mobile
   builds and deploy docs, and bumping 24 pins mid-rebase adds risk without benefit.
3. **Batch 33 product decision** — required before 34–35 can land.
4. **Batch 35 `revert-to-immich.sql`** — will need an entry for
   `AddOAuthBearerTokenToSession`.

## Post-Rebase Verification

- Upstream base in HEAD: `7a7303ace` (batch 32 tip)
- Fork commits ahead of that base: 951
- Commits behind `upstream/main`: 5 (the quarantined batch 33 plus 34–35)
- Working tree clean; no conflict markers anywhere in the tree
