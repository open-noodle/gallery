# Upstream Sync Report — 2026-07-01 (batch 303)

## Summary

- **Upstream commits pulled**: 6 (`deeb042a9e..05d838b560`) — upstream is now **GA-tagged v3.0.0**
- **Fork commits synced**: 0 (`origin/main` already integrated — `integratedForkHead == ca13ebb95`)
- **Conflicts resolved**: 10 fork commits hit conflicts, all mechanical "keep both" (mobile
  login/timeline/config, generated `router.gr.dart`, i18n). No reconciliation.
- **Post-rebase fix**: 1 commit (`1a79d7f410`) — hand-restored upstream's generated
  `WhatsNewRoute` in `router.gr.dart` (dropped by the keep-theirs driver used for the 8
  fork regen conflicts).
- **Risk level**: MEDIUM (mobile-heavy: two new mobile features + the "what's new" dialog
  touch fork-modified login/timeline/config; verified by reasoning + CI, no local flutter).
- **Recommendation**: PROCEED (pending CI on the test branch)

The fork stays on its tagged base `branding/config.json.upstream.version = 2.7.5`
(unchanged — the v3.0.0 GA bump is upstream's package version, replayed into package.json /
openapi specs; the fork's own base tag is separate). `docker/example.env` keeps the fork
pin `IMMICH_VERSION=v4`; `mobile/pubspec.yaml` keeps `1.0.0+1`. The planner split the 6
commits into per-commit batches; collapsed into one `git rebase 05d838b560`.

## Incoming Upstream Changes

| SHA          | PR     | Summary                                   | Area        | Risk to Fork | Notes                                                                                                                                             |
| ------------ | ------ | ----------------------------------------- | ----------- | ------------ | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| `d4b994301f` | #29405 | fix: version compatibility check          | mobile      | LOW–MED      | `login_form.dart` + `version_compatibility.dart` (fork doesn't modify the latter → clean).                                                        |
| `165bca4b0a` | #29388 | feat: "what's new" feature-message dialog | mobile      | MEDIUM       | New `whats_new` page/route/config/service + `main_timeline` initState + `login_form` markSeen + 17 `en.json` keys.                                |
| `6a7a34d294` | #29404 | chore: make webhooks workflow-agnostic    | plugin-core | LOW          | `packages/plugin-core/src/index.ts` — fork doesn't extend → clean.                                                                                |
| `02506424a7` | #29406 | feat: integrity checks admin settings     | web         | MEDIUM       | New `IntegrityChecksSettings.svelte` + wired into the admin settings page (fork adds classification/storage-migration there) + 15 `en.json` keys. |
| `82b70c1ab6` | #29347 | chore(web): update translations           | i18n        | LOW          | 19 locales; only `he.json` conflicted (branded disclosure vs Weblate marker update).                                                              |
| `05d838b560` | —      | chore: version **v3.0.0** (GA)            | version     | LOW          | package.json / openapi / mobile version strings; `example.env` (keep fork `v4`).                                                                  |

## Conflict Resolutions

All resolutions keep **both** the fork's additions and upstream's. No feature-level
reconciliation was needed.

- **`docker/example.env`** — rerere auto-resolved to the fork squash-base (verified
  byte-identical to fork; upstream's only change `v2→v3` absorbed). A later fork commit
  restores `IMMICH_VERSION=v4` (final value confirmed `v4`).
- **`mobile/pubspec.yaml`** — kept the fork's `1.0.0+1` (upstream's v3.0.0 discarded; real
  version stamped at build time).
- **`docs/docs/install/upgrading.md`** — rerere merged the fork rebrand + upstream's `:v2→:v3`.
- **`mobile/lib/presentation/pages/dev/main_timeline.page.dart`** (×3: #370, #625, #720) —
  kept upstream #29388's `initState()` feature-message dialog + `build` signature alongside
  the fork's filter-sheet `ref.listen`, `TimelineRouteScope`/`TimelineGroupingSelector`, and
  timeline-empty-state imports.
- **`mobile/lib/widgets/forms/login/login_form.dart`** (×4: #378, #bec3b8139f, #572) —
  upstream #29388 adds `featureMessageServiceProvider.markSeen()` on login success; the fork
  evolved this path (nav-call style → `context.replaceRoute`, `TabShellRoute` →
  `GalleryTabShellRoute`, isBeta branching removed, then extracted to a `completeLogin()`
  helper by #572). Final: `markSeen()` lives once inside `completeLogin()` (covers the
  password/other paths) plus the inline OAuth block — 2 call sites, matching every login
  success path.
- **`mobile/lib/domain/models/config/app_config.dart`** (×2: #683, #a1d300189d) — added both
  `people` (fork #683) and `featureMessage` (upstream) to the generated `==`/`hashCode`/`toString`.
- **`mobile/lib/routing/router.gr.dart`** (generated, 8 fork regen commits) — auto-resolved
  via a temporary **scoped** keep-theirs merge driver (`mobile/lib/routing/router.gr.dart merge=…`
  in the common-dir `info/attributes`), **scrubbed immediately after** the rebase. That drops
  upstream's generated `WhatsNewRoute`; hand-restored it in its alphabetical-by-page slot
  (commit `1a79d7f410`). `router.dart` (auto-merged) wires `WhatsNewRoute.page`. CI
  `static_analysis` `verify-changed-files` (build_runner) validates the exact generated output.
- **`i18n/he.json`** — kept the fork's **branded** `map_no_location_permission_content`
  ("Noodle Gallery …" — the fork's own "disclose location usage before consent" feature) +
  upstream Weblate's `map_marker_for_image` (new) and updated `map_marker_with_image`.
- **`i18n/en.json`** — keep-both, alphabetical: fork's `open_in_google_maps` +
  `open_in_immich_*`. Valid JSON, 2058 keys.

### Rebase "staged changes" hiccup

At #683 (`3d0797c961`), `git rebase --continue` reported "you have staged changes" with all
conflicts already resolved → used the documented `git commit -C 3d0797c961` workaround, then
continued.

## Fork Feature Verification

| Feature                                   | Status | Notes                                                                                                |
| ----------------------------------------- | ------ | ---------------------------------------------------------------------------------------------------- |
| Admin settings (Classification / Storage) | OK     | `IntegrityChecksSettings` (upstream) + `ClassificationSettings` (fork) both wired in `+page.svelte`. |
| Mobile login (password + OAuth)           | OK     | `completeLogin()` + inline OAuth both carry `markSeen()`; nav → `GalleryTabShellRoute`.              |
| Mobile Photos timeline (filter/grouping)  | OK     | `main_timeline` keeps filter-sheet + grouping + empty-state; upstream feature-message dialog added.  |
| Mobile app config (People sort)           | OK     | `people` + `featureMessage` both in AppConfig derived methods.                                       |
| Location-disclosure branding              | OK     | `he.json` keeps the branded Noodle Gallery disclosure text.                                          |
| Branding / version pins                   | OK     | `example.env` `v4`, pubspec `1.0.0+1`, branding `2.7.5` all intact.                                  |

## CI and Infrastructure Verification

| Check                          | Status | Notes                                                                       |
| ------------------------------ | ------ | --------------------------------------------------------------------------- |
| `ci-invariants-check`          | OK     | no PUSH_O_MATIC; Gallery images; docs-deploy dispatch-only.                 |
| `fork-patches-check`           | OK     | `@immich/ui` patch consistent.                                              |
| `mobile-drift-rebase-check`    | OK     | schemaVersion / snapshots / callbacks consistent.                           |
| `postrebase-audit` (BATCH=303) | OK     | fork files/symbols survive; 33 migrations; generated-artifact review clean. |

## Database Migration Analysis

- **New upstream migrations**: NONE. Gallery migration count 33 (unchanged). No timestamp
  collisions. `revert-to-immich.sql` coverage intact (step-7i detector prints nothing).
- The v3.0.0 GA bump does not change `branding.upstream.version` (stays 2.7.5), so the
  revert-to-immich validation target tag is unchanged.

## Mobile Drift Migration Analysis

- No mobile Drift changes; `mobile-drift-rebase-check` OK. No renumbering.

## Inconsistencies Found

None. Server tree is byte-identical to the last-green batch-302 tip.

## Local CI Verification

| Check                                     | Status | Notes                                                                                                   |
| ----------------------------------------- | ------ | ------------------------------------------------------------------------------------------------------- |
| `server: pnpm build` (nest build)         | PASS   | postbuild synced 33 Gallery migrations.                                                                 |
| `server: pnpm check` (tsc --noEmit)       | PASS   | (server/src byte-identical to batch-302 → server tests redundant).                                      |
| `web: check:typescript` (tsc --noEmit)    | PASS   | integrity-settings merge type-clean.                                                                    |
| OpenAPI regeneration (`mise //:open-api`) | PASS   | no diff (v3.0.0 version already absorbed; no server-logic change).                                      |
| SQL regeneration (`mise //:sql`)          | PASS   | no diff (no `@GenerateSql` repo touched).                                                               |
| Mobile (analyze / build / flutter test)   | CI     | not runnable locally (flutter-pin) — validated on CI static_analysis / build-mobile / Unit-Test-Mobile. |

## Remote CI Verification

- **Test branch**: `rebase/upstream-batch-303` (final commit `5d3c903856`)

| Workflow                                   | Status | Notes                                                                                                                                     |
| ------------------------------------------ | ------ | ----------------------------------------------------------------------------------------------------------------------------------------- |
| `test.yml`                                 | GREEN  | Went red twice first (see fixes below); green on `5d3c903856`.                                                                            |
| `docker.yml`                               | GREEN  | server/web/cli/ml images build.                                                                                                           |
| `static_analysis.yml`                      | GREEN  | dart analyze + format + `verify-changed-files` confirmed the hand-merged `router.gr.dart` (incl. restored `WhatsNewRoute`) is byte-exact. |
| `gallery-build-mobile.yml`                 | GREEN  | iOS + Android compile — validates all mobile conflict resolutions.                                                                        |
| `gallery-rebase-smoke.yml`                 | GREEN  | (one Docker-Compose base-image flake first; cleared on re-run).                                                                           |
| `storage-migration-tests.yml` / `-e2e.yml` | GREEN  |                                                                                                                                           |
| `gallery-revert-to-immich-validation.yml`  | GREEN  | (one exit-125 Docker container-start flake first; cleared on re-run).                                                                     |

- Smoke gates `gallery-ml-smoke` / `gallery-mobile-smoke` not on `main` → not dispatchable.
  This batch touches neither ML nor the mobile-smoke codegen surface.

### Post-rebase fixes (all consequences of the new upstream features)

1. `1a79d7f410` — restore upstream's generated `WhatsNewRoute` in `router.gr.dart` (see
   Conflict Resolutions).
2. `b8d856b129` — **Test Web**: upstream #29406 adds an `integrity-checks` accordion section;
   the fork's `NAVIGATION_ITEMS` (command palette) drift-guard requires a matching entry.
   Added it (`mdiFileCheckOutline`) + bumped the count guards (37 / 21).
3. `102fd61e62` — **Unit Test Mobile**: upstream #29388's `initState()` shows the "what's new"
   dialog from `MainTimelinePage`, which fired (and threw on unmocked localization) in the fork's
   `main_timeline_infinite_scroll_test` while it scrolled. Stubbed `featureMessageServiceProvider`
   so `shouldShow()` returns false. (The other `MainTimelinePage` tests only read the static const
   / don't settle enough to fire the post-frame dialog.)
4. `5d3c903856` — **E2E (Server & CLI)**: a **real** failure the earlier Docker-startup infra
   flakes had masked. Upstream's `GET /server/version` test asserts `prerelease: expect.anything()`
   (rejects null). It passed on `3.0.0-rc.4` (numeric prerelease) but upstream is now **GA-tagged
   `v3.0.0`** — a clean release whose SemVer has no prerelease, so `ServerVersionResponseDto`
   returns `prerelease: null` (exactly what `version.service.spec.ts` expects). Upstream never hits
   this because it only e2e-builds dev versions. Adapted the test to accept null or numeric
   prerelease. **This is a durable adaptation** — it will recur every rebase now that upstream ships
   GA tags and the fork rebases onto them.

- **Confirmed flakes**: Docker-based e2e stack startup (rebase-smoke Docker-Compose base-image pull,
  revert exit-125 container start, and the first E2E `ECONNREFUSED`) — all cleared on re-run;
  server tree is byte-identical to the last-green batch-302 tip.

## Post-Rebase Verification

- Fork commits ahead of upstream: 835 (+ 4 post-rebase fixes + this report)
- Commits behind upstream: 0
- All 6 upstream commits are ancestors of HEAD.
- Fork diff looks clean: YES
- All 8 CI workflows green on the final commit (`test.yml` directly; the other 7 carry from
  their green commits — inputs byte-identical: since `102fd61e62` only the e2e spec changed;
  since `a302b4839d` `mobile/lib` is unchanged).
