# Upstream Sync Report — 2026-07-29

## Summary

- **Upstream commits pulled**: 0 — the branch was already level with `upstream/main` (`8aa95c67470`, Immich **v3.1.0**) from the 2026-07-27 cycle
- **Batches**: none (54 / 54 complete)
- **Fork commits synced**: 4 (#715, #861, #870, #865)
- **Conflicts resolved**: 2
- **Risk level**: LOW
- **Recommendation**: PROCEED

This is a **fork-sync-only** cycle. No upstream commits, no schema/migration changes, no
mobile Drift changes, and no changes under `mobile/lib` or `mobile/test`. The fork base
stays on Immich **v3.1.0**; `branding/config.json` and `README.md` already reflect it.

The per-batch product-direction gate did not apply (no upstream batch was rebased).

## Fork Commits Synced

`integratedForkHead` advanced `04ef97010d1` → `df493c6b914`.

| SHA (on `main`) | Replayed as   | Summary                                                                                  | Area                   |
| --------------- | ------------- | ---------------------------------------------------------------------------------------- | ---------------------- |
| `24a83ca2ea0`   | `0bdd955113f` | fix(web): reach all assets in "All" timeline on large libraries (#713) (#715)            | web                    |
| `c0be5af935c`   | `b352dfe386e` | fix: narrow second-level filter options by the active filter set (#858) (#861)           | server + web + OpenAPI |
| `ae77366b1e5`   | `82e8b0ae0f4` | fix(web): keep locked-folder photos out of palette results and recents (#869) (#870)     | web                    |
| `df493c6b914`   | `a5dc3015890` | fix(spaces): stop the shared-space person deadlocks during a library unmap (#864) (#865) | server                 |

Changed-file distribution across the four picks: 21 `server/`, 16 `web/`, 7 `docs/`,
1 `packages/`, 1 `open-api/`, 1 `mobile/` (generated OpenAPI client only), 1 `e2e/`.

### Sync tooling behaviour

`make upstream-sync-fork-main` threw on both runs and behaved differently each time —
both documented failure modes were observed in one session:

1. **First run** (#715, #861, #870): conflicted on #870 and **did** roll the whole batch
   back (`reset --hard`, tree clean, HEAD unmoved). Recovered by cherry-picking the two
   clean commits with `--ff`, then resolving #870 by hand.
2. **Second run** (#865): conflicted and left the cherry-pick **mid-flight** — 12 files
   already staged, `UU` on `shared-space.repository.ts`, nothing rolled back. Finished by
   hand with `cherry-pick --continue`.

In both cases the three fork gate checks (`fork-ownership-coverage-check`,
`ci-invariants-check`, `fork-patches-check`) were run manually and passed, and
`integratedForkHead` / `lastForkSyncAt` / `appendHistory` were written by hand.
`make upstream-rolling-status` reports **Fork commits pending: 0**.

## Conflict Resolutions

### Conflict: `web/src/lib/managers/global-search-manager.svelte.ts` (#870)

- **Fork side (rolling branch)**: `...(mode === 'metadata' && { originalFileName: query })` — the
  `&&` short-circuit form required by eslint-plugin-unicorn v72 on this branch.
- **Upstream side (#870, authored on `main`)**: the older ternary form
  `...(mode === 'metadata' ? { originalFileName: query } : {})`, plus a new
  `visibility: AssetVisibility.Timeline,` entry — the actual fix for #869.
- **Resolution**: kept the rolling branch's `&&` form for all three spreads and layered
  #870's `visibility: AssetVisibility.Timeline` on top.
- **Risk**: LOW — purely syntactic on the fork side; the behavioural change (#870's
  visibility pin) is preserved verbatim.
- **Verification**: `web` eslint clean on the file; `global-search-manager.svelte.spec.ts`
  passes, including #870's new locked-folder cases.

### Conflict: `server/src/repositories/shared-space.repository.ts` (#865)

- **Fork side (rolling branch)**: `import { anyUuid, searchAssetBuilderLegacy } from 'src/utils/database';`
  — the Search-V3 coexistence invariant (upstream #28686 renamed the shared builder to
  `searchAssetBuilderLegacy`; fork call-sites must stay on it).
- **Upstream side (#865, authored on `main`)**: `import { anyUuid, retryOnDeadlock, searchAssetBuilder } from 'src/utils/database';`
  — adds the new `retryOnDeadlock` helper while still using the pre-rename builder name.
- **Resolution**: `import { anyUuid, retryOnDeadlock, searchAssetBuilderLegacy } from 'src/utils/database';`
- **Risk**: LOW, but this is the exact shape the Search-V3 note warns about — a blind
  "take theirs" would have rebound a fork call-site to the V3 builder, which has a
  different signature and drops the owner/space RBAC gate.
- **Verification**: the file's only builder call-site (line ~1556) is
  `searchAssetBuilderLegacy`. Repo-wide, the only non-Legacy `searchAssetBuilder(`
  references are upstream's dormant V3 pair in `search.repository.ts` and the definition
  in `utils/database.ts` — i.e. the intended dormant-coexistence state. `server pnpm check`
  and `pnpm lint` pass.

## Toolchain Drift (7th occurrence)

All four commits were green on `main` and cherry-picked without any behavioural conflict,
then failed lint here because the rolling branch carries **eslint-plugin-unicorn v72**
while `main` is still on v70. Fixed in `b331e6edc89`:

| File                                                         | Rule                                                | Fix                                                                                                               |
| ------------------------------------------------------------ | --------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| `server/src/repositories/face-identity.repository.ts` (#865) | `unicorn/no-negated-array-predicate`                | Hoisted the negated `.some()` to a named local. Rewriting to `.every()` re-triggers the same rule one level down. |
| `web/.../VirtualScrollManager.svelte.ts` (#715)              | `unicorn/no-unnecessary-global-this`                | Dropped the redundant `globalThis.` qualifier on `devicePixelRatio` (2 sites).                                    |
| `web/.../VirtualScrollManager.svelte.spec.ts` (#715)         | `unicorn/prefer-global-number-constants`            | `Number.NaN` → `NaN`, `Number.POSITIVE_INFINITY` → `Infinity`.                                                    |
| `web/.../timeline-manager.svelte.spec.ts` (#715)             | `unicorn/no-this-outside-of-class`                  | Referenced the fake element by name instead of `this` inside an object-literal method.                            |
| `web/.../global-search-manager.svelte.ts` (#870)             | `unicorn/prefer-includes-over-repeated-comparisons` | Collapsed the repeated status equality checks into `.includes()`.                                                 |

This remains the expected outcome of any fork sync, not an edge case.

## Database Migration Analysis

- **New upstream migrations**: none (no upstream commits this cycle).
- **New fork migrations**: none. `git diff 2da41147ea2..HEAD -- server/src/schema/migrations server/src/schema/migrations-gallery` is empty.
- **`migrations-gallery/` count**: 49 — unchanged, matches the expected count.
- **Postbuild merge**: intact — `server pnpm build` reports
  `Synced 49 Gallery migrations into dist/schema/migrations; removed 0 stale files; wrote 1 compatibility aliases.`
- **`scripts/revert-to-immich.sql` coverage**: unchanged, since no migration was added on
  either side.

## Mobile Drift Migration Analysis

Not applicable — no `mobile/lib`, `mobile/test`, or `mobile/drift_schemas/` changes. The
only mobile file touched is the generated `mobile/openapi/lib/api/search_api.dart`.

### Generated Dart client

`mobile/openapi/**` is `merge: unset`, so it is worth confirming the picked copy is not a
cross-generator mix. It is not:

- `search_api.dart` was **byte-identical** between the pre-pick rolling branch and
  pre-#861 `main`, so #861's regenerated copy applies cleanly with nothing dropped.
- A real `mise run //:open-api-dart` reproduces the tree **byte-identically**
  (`git status -- mobile/openapi` empty), with `.openapi-generator/VERSION` = **7.24.0**
  and all three fork template patches applied — including the fork-only
  `native_class_nullable_items_in_arrays.patch`.
- `mise.lock` / `mobile/mise.lock` were **not** rewritten by the local `mise` invocation
  (`git status -- '*mise.lock'` empty).

## Fork Feature Verification

| Feature                         | Status | Notes                                                                                                                          |
| ------------------------------- | ------ | ------------------------------------------------------------------------------------------------------------------------------ |
| Shared Spaces                   | OK     | #865 touches `shared-space.repository.ts` / `face-identity.repository.ts`; RBAC gate preserved via `searchAssetBuilderLegacy`. |
| Search V3 coexistence           | OK     | All fork call-sites on `searchAssetBuilderLegacy`; upstream V3 dormant.                                                        |
| Global Face Identity            | OK     | #865's deadlock retry lands in `face-identity.repository.ts`; medium specs added.                                              |
| Dynamic Filter Suggestions      | OK     | #861 extends the suggestions endpoint; OpenAPI + SDK + Dart client regenerated consistently.                                   |
| Global Search / Command Palette | OK     | #870's locked-folder visibility pin applied on the rolling syntax.                                                             |
| Timeline (large libraries)      | OK     | #715's scroll-height cap; `VirtualScrollManager` specs pass.                                                                   |
| Branding / version refs         | OK     | `branding/config.json` = 3.1.0, README = v3.1.0 — unchanged this cycle.                                                        |

## CI and Infrastructure Verification

| Check                           | Status | Notes                                                                                     |
| ------------------------------- | ------ | ----------------------------------------------------------------------------------------- |
| `fork-ownership-coverage-check` | OK     | Covers 3241 fork files.                                                                   |
| `ci-invariants-check`           | OK     | No `PUSH_O_MATIC`; Gallery release image names; upstream docs-deploy stays dispatch-only. |
| `fork-patches-check`            | OK     | `@immich/ui` patch metadata consistent.                                                   |
| `mise.lock` integrity           | OK     | Not rewritten by local `mise` runs.                                                       |

## Local CI Verification

| Check                                            | Status | Notes                                       |
| ------------------------------------------------ | ------ | ------------------------------------------- |
| `server pnpm build` (+ postbuild migration sync) | PASS   | 49 migrations, 1 compatibility alias        |
| `server pnpm check` (tsc)                        | PASS   |                                             |
| `server pnpm lint`                               | PASS   | after the `no-negated-array-predicate` fix  |
| `server` unit tests                              | PASS   | 154 files, 5249 passed / 14 skipped         |
| `web check:typescript`                           | PASS   |                                             |
| `web` eslint (`tscompat` off)                    | PASS   | 0 errors after the drift fixes              |
| `web` unit tests                                 | PASS   | 294 files, 4001 passed / 2 skipped / 8 todo |
| Dart OpenAPI regeneration                        | PASS   | byte-identical, generator 7.24.0            |
| Prettier (server + web touched files)            | PASS   |                                             |

`make sql` was not run: no repository method decorated with `@GenerateSqlQueries` changed
shape beyond what #861/#865 already committed, and running it without a database deletes
every file under `server/src/queries/`.

## Remote CI Verification

- **Test branch**: `rebase/upstream-rolling-2026-07-29`
- **Commit validated**: `76245d2db30`

| Workflow                                  | Status | Notes                                                |
| ----------------------------------------- | ------ | ---------------------------------------------------- |
| `test.yml`                                | GREEN  | 21/21 jobs, none skipped (run 30471034202)           |
| `docker.yml`                              | GREEN  | run 30471037201                                      |
| `static_analysis.yml`                     | GREEN  | run 30471039722                                      |
| `gallery-build-mobile.yml`                | GREEN  | run 30471060671                                      |
| `gallery-rebase-smoke.yml`                | GREEN  | run 30471042044                                      |
| `storage-migration-tests.yml`             | GREEN  | run 30471044582                                      |
| `storage-migration-e2e.yml`               | GREEN  | run 30471058313                                      |
| `gallery-revert-to-immich-validation.yml` | RED    | structural main-lag, not a branch defect — see below |
| `gallery-ml-smoke.yml`                    | GREEN  | run 30471049197                                      |
| `gallery-mobile-smoke.yml`                | GREEN  | run 30471051606                                      |

### `gallery-revert-to-immich-validation` — diagnosis (run 30471046799)

**Not a `revert-to-immich.sql` coverage gap, and not fixable on this branch.** The coverage
detector from step 7i reports **0 missing** entries against the `v3.1.0` upstream tree (88
upstream migrations), and `1784647658615-AddOAuthBearerTokenToSession` is already present in
the SQL.

The failure is a consequence of the rolling branch being ahead of `main`:

1. The workflow's pre-phase boots **upstream Immich at the tag from the branch's
   `branding/config.json`** — now `v3.1.0`. That image runs
   `1784647658615-AddOAuthBearerTokenToSession` and records it in `kysely_migrations`.
   Pre-phase baseline drift: 0 items.
2. The gallery phase then boots `GALLERY_IMAGE`, which defaults to **`:main`** — built from
   `origin/main`, where `branding/config.json` still says **3.0.3** and
   `1784647658615-AddOAuthBearerTokenToSession.ts` **does not exist**.
3. Kysely aborts: `corrupted migrations: previously executed migration
1784647658615-AddOAuthBearerTokenToSession is missing`, so the server never answers
   `/api/server/ping` and the job times out at 180s.

The revert SQL is never reached. This clears itself once the rolling branch lands on `main`
and `:main` is rebuilt at v3.1.0. It is the same upstream/main-lag family as the 2026-07-27
red, with a different symptom now that the `v3.1.0` image is published.

## Staging RC Validation

- **RC tag**: `rolling-v310-rc2` (server-only; `build_ml` omitted)
- **Built from**: `rebase/upstream-rolling-2026-07-29` @ `76245d2db30` (run 30471070327)
- **ML**: left at `v5.1.1` — `git diff v5.1.1..HEAD -- machine-learning/` is the version
  string `3.0.3` → `3.1.0` in `pyproject.toml` + `uv.lock` and nothing else; this cycle
  changed zero ML files.
- **infra-gitops**: `dee96ef` (`apps/staging/server.yaml` only)
- **Served pod**: `gallery-server-fdbff59bd-rwlch` running
  `ghcr.io/open-noodle/gallery-server:rolling-v310-rc2` (verified by pod image, not by
  `rollout status`)

**Migration parity pre-check** (before pinning): the only DB-recorded migration with no file
on disk was `1776735180298-ChangeDurationToInteger` — the known-benign `compatibilityAliases`
case — and **0 migrations were pending**, consistent with this cycle adding none.

**Boot result**: `Running migrations` → `Finished running migrations` →
**`No schema drift detected` on BOTH Api and Microservices workers.**

**Fork surface smoke** (temp api_key, deleted afterwards) — all HTTP 200:

| Endpoint                                                  | Result                        |
| --------------------------------------------------------- | ----------------------------- |
| `/server/ml-health`                                       | `{"smartSearchHealthy":true}` |
| `/shared-spaces`                                          | 200                           |
| `/albums`                                                 | 200                           |
| `/people?withSharedSpaces=true`                           | 200                           |
| `/gallery/map/markers` (fork-only)                        | 200, 556 KB                   |
| `/timeline/buckets` (#715 surface)                        | 200                           |
| `/search/suggestions?type=camera-model&make=Apple` (#861) | narrowed to 4 iPhone models   |
| `POST /search/smart` (#870 palette path)                  | 200, 10 hits (CLIP + vector)  |

The `#861` probe is the meaningful one: unfiltered `camera-make` returns 12 makes, and
`camera-model` narrowed by `make=Apple` returns only iPhone models — i.e. second-level
narrowing works end-to-end against a real library.

## Post-Rebase Verification

- Commits behind `upstream/main`: **0**
- Fork commits pending from `origin/main`: **0**
- `integratedForkHead`: `df493c6b914`
- Backup branch: `backup/rolling-pre-forksync-20260729` @ `2da41147ea2`
