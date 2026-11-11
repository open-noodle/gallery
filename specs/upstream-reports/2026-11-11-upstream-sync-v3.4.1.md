# Upstream Sync Report — 2026-11-11 (v3.4 rolling → v3.4.1)

## Summary

- **Upstream**: Immich tagged `v3.4.1` (`22b95194c80`). 10 commits on top of `v3.4.0`: nine release fixes and the
  version bump. `release/v3.4` has one more commit after the tag (immich-33220, slideshow play/pause), left for the
  next tag. One replay of 1874 fork commits onto the tag.
- **Fork sync**: #1300 (mobile Try Demo login), `integratedForkHead` `3983e438171` → `5f12e25498d`.
- **Base**: `upstream.version` → `3.4.1` (AGENTS.md, README, both switching guides, the revert-script notes, the
  branding-targets pin, the OpenAPI version). v3.4.1 adds no migrations, no Drift schema change and touches no key in
  the FK registry. `ghcr.io/immich-app/immich-server:v3.4.1` is published.
- **Product gate**: did not fire. The one change near a fork surface is a query rewrite (shared-link covers), not a
  new sharing model.
- **Risk**: LOW, one MEDIUM item (the shared-link cover query, below). Backup: `backup/rolling-v34-pre-341-1111`
  (pre-cycle tip `4e4181e51dd`, pushed).

## Upstream changes

| SHA           | Summary                                            | Area         | Risk   | Notes                                                                    |
| ------------- | -------------------------------------------------- | ------------ | ------ | ------------------------------------------------------------------------ |
| `fe999f349b2` | map `.hif` to `image/heif` (immich-33172)          | server       | LOW    | applied inside the fork's `heif` group                                   |
| `3b30a6976c8` | shared-links cover query (immich-33186)            | server       | MEDIUM | new query drops the fork's #1018 filter and `projectedDuration`; see below |
| `2e8b18279c3` | queue job status query (immich-33185)              | server       | LOW    | fixes the admin queue page 400 left open on 2026-11-09                   |
| `358aba65f03` | info panel filename alignment (immich-33187)       | web          | LOW    | nets out with immich-33208                                               |
| `1964142f569` | highlight search filters with camera set (immich-33200) | web     | LOW    | clean                                                                    |
| `efe042636c2` | filename element on detail panel (immich-33208)    | web          | LOW    | `justify-between` applied to the fork's `FilterValue` row                |
| `e96fc1b7664` | prometheus exporter on all interfaces (immich-33209) | server     | LOW    | clean                                                                    |
| `74022e4f719` | workflow step field defaults (immich-33212)        | web          | LOW    | clean                                                                    |
| `a380a3b80f6` | FUTO backups 1.16.0 (immich-33217)                 | deps         | LOW    | lock hunks taken over the fork's patched `@immich/ui`                    |
| `22b95194c80` | version v3.4.1                                     | all          | LOW    | the mobile app keeps Gallery's version                                   |

Pre-rebase detectors: no URL removed from a file fork tooling matches by literal (the two hits are `mise.lock`
jellyfin-ffmpeg asset URLs, not matched by any branding script); no i18n change, so no branding gap; no new version
gate, no deleted member, no migration.

## Shared-link covers (immich-33186)

`SharedLinkRepository.getAll` used `withSharedAssets(eb).limit(1)` for each link's cover. Upstream replaced that with a
pre-query of the user's individual links and a `min(fileCreatedAt)` derived table, so the planner can use the ids.
The fork's `withSharedAssets` carries two things upstream's new subqueries do not:

- the #1018 rule `sharedLinkAssetIsServable`: an asset the creator does not own is served only while the link's space
  tether holds, so a withdrawn contribution must not become a cover;
- `projectedDuration`, so a trimmed video's cover reports the trimmed length.

Taking upstream's text would have merged cleanly and dropped both. Resolution: upstream's two-step query, with the
servable filter in both cover subqueries and `projectedDuration` on the selected cover. The derived table is not
lateral, so it cannot see the outer `shared_link` row; it joins `shared_link` and `shared_link_space` itself, which
is what the tether helper reads. The correlated `assets` subquery reads the outer row as before. Gates: the RBAC
oracle (shared-links surface) and the SQL query file.

## How the replay was driven

One `git rebase v3.4.1`, `rerere` off. The driver took the fork side only for UU conflicts with markers in the 28 files
v3.4.1 touches and would have stopped on anything else. It resolved 13 conflicts and never stopped. Every file outside
the 28 came out byte-identical to the pre-replay tip.

`fix(rolling): reconcile the v3.4.1 changes with fork code` then set each of the 28 files to a three-way merge (fork
tip, v3.4.0, v3.4.1): 17 merged clean, 1 new upstream file (`queue.controller.spec.ts`), 7 by hand, 3 regenerated
(OpenAPI spec and SDK, the shared-link SQL file). A line audit then checked every v3.4.1 line is present and every line
it removed is gone. The exceptions are deliberate: Gallery's mobile version (`Info.plist`, `pubspec.yaml`), the fork's
`@immich/ui` patch hash on the backups lock entries, and the fork's `mapSharedLink` options object.

## Resolutions

- **`mime-types.ts`** (immich-33172): the fork had moved `.heic`/`.heif`/`.hif` into its own `heif` group; `.hif` now
  maps to `image/heif` there. Nothing in the fork reads `image/hif`.
- **`queue.dto.ts`** (immich-33185): upstream's `queryParamArray` import beside the fork's queue extension import.
  `queryParamArray` does not collide with anything `src/gallery/validation.ts` exports.
- **`shared-link.dto.ts`** (immich-33186): upstream's `Omit<SharedLink, 'assets'> & Partial<…>` input type with the
  fork's `options` object (`redactAssetOwners`).
- **`DetailPanel.svelte`** (immich-33187/33208): the two commits net to `justify-end` → `justify-between`; applied to
  the fork's filename row, which wraps the name in `FilterValue`.
- **Lockfile** (immich-33217): the fork's lockfile with upstream's 1.14.0 → 1.16.0 lines; `pnpm install
  --frozen-lockfile` accepts it, no `version: file:` entries. This replaces last cycle's hand pin of
  `backups-api-client`.
- **Mobile version**: Gallery's (`3.3.3+3030399`), as every v3.4 cycle.

## Fork sync

`make upstream-sync-fork-main` cherry-picked #1300 cleanly (`947ea1e8931`) and then failed in
`fork-ownership-coverage-check`, which diffs `upstream/release/v3.4...origin/main` (a v3.3.5-based `main` against the
v3.4 release branch) and fails on this branch regardless of the commit. `integratedForkHead` was advanced by hand with
an `appendHistory` note. #1300 passes `dart analyze --fatal-infos` and its widget test on the rolling Flutter pin.

## Layering

- Upstream files whose fork diff grew: `shared-link.repository.ts` (the filter and duration in upstream's new cover
  query, 5 lines), `DetailPanel.svelte` (none: one class changed on a fork line). The rest kept their fork delta.
- `i18n/*.json` identical to upstream; `merge.mjs --check` passes.

## Local CI verification

| Check                                                   | Status | Notes                                     |
| ------------------------------------------------------- | ------ | ----------------------------------------- |
| server build, `tsc`, eslint + prettier on changed files | PASS   |                                           |
| server unit                                             | PASS   | 7746                                      |
| web `tsc`, svelte-check, eslint on changed files        | PASS   | 715 files                                 |
| web unit: asset viewer, workflow                        | PASS   | 20 files, 295 tests                       |
| OpenAPI + SDK regeneration                              | PASS   | version string only                       |
| mobile #1300: analyze, widget test                      | PASS   | Flutter 3.47.2                            |
| i18n overlay check and merge tests                      | PASS   |                                           |
| preflight suite, CI invariants, fork patches            | PASS   | branding-targets pin bumped to 3.4.1      |
| branding check (`gallery-branding-check.sh`)            | PASS   |                                           |
| revert spec                                             | PASS   |                                           |
| commit autolink check                                   | PASS   | 1876 messages                             |

Not run locally: SQL regeneration and the server medium suite (the access and RBAC oracles). Docker Desktop did not
start from the session, so both were left to CI.

## Remote CI verification

Code commit `56fb9144cc3` (all runs). A first Test run on `7035ecdc671` failed only SQL Schema Checks, with the
expected drift in `shared.link.repository.sql`; that diff was applied from the job log (Docker Desktop would not start
locally) and checked by hand: both cover subqueries carry the #1018 tether and the cover's `duration` reads
`asset_video_trim`.

| Workflow                         | Run           | Result                                         |
| -------------------------------- | ------------- | ---------------------------------------------- |
| Test                             | `43083060590` | PASS (21 jobs, incl. SQL, server and web medium) |
| Static Code Analysis             | `43083153239` | PASS                                           |
| Gallery Rebase Smoke             | `43083242515` | PASS                                           |
| Gallery Build Mobile             | `43083329088` | PASS, Android and iOS (iOS ran this time)      |
| Docker                           | `43083595444` | PASS                                           |
| Storage Migration Tests / E2E    | `43083679946` / `43083936688` | PASS                           |
| Gallery ML Smoke / Mobile Smoke  | `43083761992` / `43083849629` | PASS                           |
| Revert-to-Immich                 | `43102453425` | PASS (`rolling-v34-rc15` vs stock `immich-server:v3.4.1`) |

No CI-only breaks and no flakes this cycle.

## Personal instance

`rolling-v34-rc15` (server only, from `befc7698f55`; run `43099024277`, whose first attempt died on a GHCR
`toomanyrequests` pull and passed on rerun), pinned in infra-gitops `72b14e8`, replacing `v5.10.0-rc.1` (v3.3.5 base).
ML stays the shared `gallery-ml:main-3360746c-rc2`: `machine-learning.repository.ts` is unchanged from v3.3.5 to
v3.4.1, and the v2 model revision is an ML-side setting the server does not send.

- Migrations: the three v3.4 upstream ones (`AddPasskeyTable`, `AddUpdateIdIndexes`, `AddAssetOwnerIdUpdateIdIndex`)
  plus three fork migrations already on `main` that `v5.10.0-rc.1` predates (`ScopeJitOffToDatabase`,
  `AddAssetDataSaverVideoTable`, `AddAssetFaceVideoFrameTable`). `No schema drift detected` on both workers.
- Each new pod's first start hit `ECONNREFUSED` on `gallery-postgres-rw` and restarted once; Postgres itself did not
  restart (up since 2026-10-24). The second start connected and migrated.
- `/server/version` is 3.4.1 for a stock client and 5.10.0-rc.1 for a Gallery client; ArgoCD `Synced / Healthy`.
- First boot of upstream's FUTO backups generated a state key for `/data/backups/yucca` (on the uploads PVC).
- Pre-deploy dump `~/gallery-backups/personal-pre-rolling-v34-rc15-2026-11-11.dump` (541 MB, sha256 `92c574d6…`, matched
  the in-pod copy). The CNPG pod's `/tmp` is read-only (dump to the data volume), and `kubectl exec cat` truncated the
  copy even in 50 MB chunks; 8 MB `dd` chunks with size checks worked. Rollback: restore that dump and
  `git revert 72b14e8` in infra-gitops (a v3.3.5-based build refuses the three v3.4 rows).

## Staging

Server `rolling-v34-rc15` (infra-gitops `85afee0`), replacing rc14 (v3.4.0); ML stays `rolling-v34-rc14`, since
v3.4.1 changes only the ML version string and #1300 is mobile-only. Live-DB parity: 0 orphans, 0 pending, so nothing
ran. Boot: `No schema drift detected` on both workers, 0 restarts. `/server/version` is 3.4.1 for a stock client and
5.10.0-rc.1 for a Gallery client; ArgoCD `Synced / Healthy`. Pre-deploy dump
`~/gallery-backups/staging-pre-rolling-v34-rc15-2026-11-11.dump` (63 MB, sha256 `2a9ec522…`, matched the in-pod copy);
rollback is pinning rc14 again (no migrations to undo).
