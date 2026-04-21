# Post-Rebase Smoke Suite — Design

**Date:** 2026-04-21
**Status:** Approved, ready for implementation plan
**Related:** `docs/upstream-reports/2026-04-20-upstream-sync.md`

## Problem

The most recent rebase (96 upstream commits onto fork's 318) surfaced eight categories of silent regression caught only during the remote-CI iteration loop over ~10 commits:

1. SvelteKit `version.name = Date.now()` fallback mismatched hashes between chunks and SPA fallback → every web page hung on the loading spinner.
2. Detail panel "orphan-div fix" over-deleted upstream content (Date, filename, Location).
3. `authManager.logout()` lost `this.reset()` → user stayed authenticated client-side after logout.
4. `auth.service.syncProfilePicture` lost its S3 upload branch when taking upstream cleanly.
5. `auto_route` 9→11 strictness rejected duplicate `SpacesRoute` registration → mobile app crashed on first Spaces open.
6. Six zod validation rules silently dropped during class-validator→zod migration.
7. `@faker-js/faker` minor bump changed seeded UUIDs in UI fixtures.
8. `router.gr.dart` was stale after the `auto_route` bump.

Existing e2e coverage already enforces most of the permission matrix (`shared-space.e2e-spec.ts` is 2,758 lines of owner/editor/viewer/non-member checks) and catches regressions inside each feature's spec. What it doesn't catch is the **cross-cutting class** of bug: a single config knob, a single Svelte helper, or a fork-only integration path that every page depends on and that no single feature spec owns.

**Bug #4 is already covered by a server unit spec** — `server/src/services/auth.service.spec.ts:1055` "`syncProfilePicture with S3 backend`" asserts the S3 backend receives the upload. These unit tests run on every PR in the existing server test suite, so the e2e-level coverage this design originally proposed is redundant. See "Not doing" section.

## Goals

- Raise the rebase ship-confidence floor by filling the specific gaps that allowed bugs 1–3, 5, and 7 through local CI. (Bug #4 is already covered; bugs #6, #8 are caught by existing server specs and Dart Code Analysis.)
- Keep the cheap gap-tests live on every PR so they also catch routine regressions.
- Keep the expensive tests gated to rebase branches so PR cycle time isn't degraded.
- Match the existing e2e infrastructure style — no bash scripts, no new tool runtimes, no duplicated coverage.

## Non-Goals

- Re-testing anything already covered by existing specs. Shared-space CRUD, filter panels, upload pipeline, smart search, cmdk palette, auth registration flow, classification config validation are all already exhaustively covered — duplicating them in a monolithic "smoke" file would produce parallel suites that drift.
- Automated mobile regression tests. Patrol was removed from the fork (`project_play_store_publishing`); a manual checklist is the practical answer until a post-patrol Flutter integration_test investment is justified on its own.
- Bash/curl-based API scripts. The SDK + Vitest + supertest harness already does typed requests, token helpers, and DB reset.
- S3 storage migration coverage — that has its own harness (`storage-migration.sh`).
- E2E re-test of OAuth + S3 profile picture — server unit spec at `auth.service.spec.ts:1055+` already asserts this S3 branch.

## Architecture overview

Four deliverables across three tiers:

| #   | Deliverable                   | Tier                  | Runtime         | Location                                                                      |
| --- | ----------------------------- | --------------------- | --------------- | ----------------------------------------------------------------------------- |
| 1   | Page-render canary            | **Always** (every PR) | ~90s            | `e2e/src/specs/web/rebase-smoke-pages.e2e-spec.ts`                            |
| 2   | Detail-panel full-layout test | **Always** (every PR) | ~20s            | +1 test in existing `e2e/src/specs/web/asset-viewer/detail-panel.e2e-spec.ts` |
| 3   | UI permission matrix          | **Rebase-gate**       | ~4 min          | `e2e/src/specs/rebase-smoke/permission-matrix.e2e-spec.ts`                    |
| 4   | Mobile smoke checklist        | **Manual**            | ~10 min (human) | `docs/upstream-reports/rebase-mobile-smoke-checklist.md`                      |

### Tier mechanism: Playwright projects, not `--grep`

The "Always" tier lives under `e2e/src/specs/web/` → runs in the existing `web` Playwright project → already wired into every CI run.

The "Rebase-gate" tier lives under a new `e2e/src/specs/rebase-smoke/` testDir backed by a new Playwright project `rebase-smoke`. The project is **not** selected by the default `pnpm test:web` invocation — it only runs when explicitly targeted via `--project=rebase-smoke`.

**Why projects, not `--grep`:** projects are a first-class Playwright concept (separate testDir, workers, retries, timeout); `--grep` tagging requires every future author to remember to tag their test, while a project boundary is self-enforcing.

### Rebase-gate CI integration

New workflow `gallery-rebase-smoke.yml` triggered on:

- `workflow_dispatch` **only**.

Auto-triggering on `push: branches: ['rebase/**']` is intentionally rejected. Per `feedback_rebase_test_branch_no_pr_ci`, fork-specific GitHub behavior suppresses `pull_request`/`push` events for branches in forked repos' internal PRs — the maintainer already has to dispatch Test / Docker / Static Analysis manually for rebase PRs, and the rebase-smoke workflow must follow the same pattern. The `push-rebase` skill will be updated to add `gh workflow run gallery-rebase-smoke.yml --ref <rebase-branch>` alongside the other dispatches.

The workflow:

1. Boots the standard e2e stack (no S3 overlay — deliverable 4 was cut).
2. Runs `pnpm exec playwright test --project=rebase-smoke`.
3. Tears down.

Runtime target: under 8 min including stack startup. Runs on `ubuntu-latest` (NOT ARM — per `.github/workflows/test.yml:424-426`, the fork deliberately disabled ARM for Playwright because "ARM runner causes frequent timeouts on timing-sensitive UI tests").

### Local `make` target

`make e2e-rebase-smoke` does the same locally. Maintainer runs before force-pushing.

## Deliverable 1 — Page-render canary

**File:** `e2e/src/specs/web/rebase-smoke-pages.e2e-spec.ts`
**Tier:** Always
**Budget:** 3–4 min realistic (measurement gate in rollout step 2 is authoritative — the claimed budget here is a starting estimate, not a commitment)

### Structure: one test per route in `test.describe.serial`

Playwright's default per-test timeout on CI is 60s. Eighteen route visits in a single test would risk exceeding that cap (and would report only "the test failed" without telling you which route). Structure as `test.describe.serial("Rebase Smoke — Page Render")` containing **one test per route**. Each test gets its own 60s budget and its own failure report.

Authentication: `test.beforeAll` calls `utils.adminSetup()` to create the admin + obtain `accessToken`. Each test starts with `await utils.setAuthCookies(context, accessToken)` (the pattern used by `photos-filter-panel.e2e-spec.ts` and other web specs) — Playwright serial mode does NOT auto-share browser context across tests, so cookie injection is explicit per test. DB is reset once in `beforeAll`.

Route table shape (explicit type for implementers):

```ts
type CanaryRoute = {
  path: string;
  landmark: string; // CSS selector
  description: string; // Used as the test title
};
```

### What each test does

`await utils.setAuthCookies(context, accessToken)`; `page.goto(path)`; `await expect(page.locator(landmark)).toBeVisible({ timeout: 5_000 })`.

### Why landmark-visible, not spinner-absent

Asserting spinner absence can pass if the page crashed _before_ the spinner ever mounted (root error boundary throw). Asserting a known post-render landmark forces the test to prove the page rendered past the framework root.

### Landmark strategy

Two layouts own the header content of the routes listed below:

- **`(user)` routes** render their titles via `user-page-layout.svelte`. The header is a `<div id={headerId}>` (line 80; `headerId = 'user-page-header'` is exported for existing focus-management callers and must stay). Add `data-testid="page-header"` to that div. `headerId` export is retained unchanged.
- **`admin` routes** render their header via `BreadcrumbActionPage.svelte`, mounted inside `AdminPageLayout.svelte`. The header is the `<div class="flex h-16 w-full …">` at `BreadcrumbActionPage.svelte:34`. Add `data-testid="admin-page-header"` to that div. Targeting `AdminPageLayout.svelte` directly would land on an `AppShell` ancestor that mounts before the breadcrumb renders, defeating the "proved it rendered" point.

Fallback strategy if the production edits can't ship in the same PR: target `#user-page-header` directly for `(user)` routes (works today); admin routes would need a different approach (e.g., `text=` matching a breadcrumb label, brittle). The production-edit approach is strongly preferred.

### Routes (verified against `web/src/routes/(user)/`)

| Path                     | Landmark                                                                         |
| ------------------------ | -------------------------------------------------------------------------------- |
| `/photos`                | `[data-testid="discovery-panel"], [data-testid="collapsed-icon-strip"]` (either) |
| `/albums`                | `[data-testid="page-header"]`                                                    |
| `/spaces`                | `[data-testid="page-header"]`                                                    |
| `/favorites`             | `[data-testid="page-header"]`                                                    |
| `/archive`               | `[data-testid="page-header"]`                                                    |
| `/trash`                 | `[data-testid="page-header"]`                                                    |
| `/map`                   | `.maplibregl-map`                                                                |
| `/people`                | `[data-testid="page-header"]`                                                    |
| `/places`                | `[data-testid="page-header"]`                                                    |
| `/partners`              | `[data-testid="page-header"]`                                                    |
| `/shared-links`          | `[data-testid="page-header"]`                                                    |
| `/tags`                  | `[data-testid="page-header"]`                                                    |
| `/explore`               | `[data-testid="page-header"]`                                                    |
| `/admin/user-management` | `[data-testid="admin-page-header"]`                                              |
| `/admin/system-settings` | `[data-testid="admin-page-header"]`                                              |
| `/admin/jobs-status`     | `[data-testid="admin-page-header"]`                                              |
| `/admin/queues`          | `[data-testid="admin-page-header"]`                                              |
| `/user-settings`         | `[data-testid="page-header"]`                                                    |

18 routes total. Explicitly removed from the original list:

- `/admin/users` — 307 redirect to `/admin/user-management` (covered).
- `/admin/jobs` — does not exist; real path is `/admin/jobs-status` (covered).
- `/user-settings/preferences` — sub-route of `/user-settings`, no additional coverage value.
- `/search` — the `/search` route's own rendered content is the nav-level `SearchBar` (`#main-search-bar`), which is already mounted on every other `(user)` route via the navbar. Asserting `#main-search-bar` on `/search` proves nothing `/photos` doesn't already prove. Dropped to avoid redundancy.

### Why this catches the SvelteKit hash bug

When `kit.version.name` differs between chunks and SPA fallback, `globalThis.__sveltekit_<hash>.env` is undefined at chunk runtime; any code reading `$env/dynamic/public` (`@immich/ui`'s `env.PUBLIC_IMMICH_HOSTNAME`) throws, the page never mounts past the root boundary, landmark never appears → 5s timeout fails for every listed route. Would have caught bug #1 in ~5s instead of via 20 Playwright 30s-hangs.

### Maintenance

Routes are a single array of `{ path, landmark, adminOnly }` records. When a fork feature adds a top-level route, the author adds a row. No per-test duplication, no branching logic.

## Deliverable 2 — Detail-panel full-layout

**File:** `e2e/src/specs/web/asset-viewer/detail-panel.e2e-spec.ts` (extend existing 126-line file)
**Tier:** Always
**Budget:** ~20s (one new test)

### What it does

Upload `thompson-springs.jpg` (full EXIF + GPS), apply rating=5 + tag="rebase-smoke" via SDK, create a face via `utils.createFace`, open the asset viewer, open the detail panel, and assert **all seven section testids** are simultaneously visible:

- `[data-testid="detail-panel-edit-date-button"]` (already exists at `detail-panel-date.svelte:45`)
- `[data-testid="detail-panel-filename"]` (**NEW testid required**)
- `[data-testid="detail-panel-camera"]` (**NEW testid required**)
- `[data-testid="detail-panel-lens"]` (**NEW testid required**)
- `[data-testid="detail-panel-location"]` (**NEW testid required**)
- `[data-testid="detail-panel-rating"]` (**NEW testid required**)
- `[data-testid="detail-panel-tags"]` (already exists at `detail-panel-tags.svelte:48`)

### Production-code change scope

Adds `data-testid="detail-panel-<section>"` to 5 section root elements inside `detail-panel.svelte` (current file has ZERO testids — the existing 2 live on sibling sub-components, not the panel itself). No behavioral change.

### Why this catches the orphan-div regression

The orphan-div fix deleted the `<div class="px-4 py-4">` containing Date, filename, Location. Existing coverage only asserted the Date-button testid on retry. An "all sections simultaneously present" test would have failed on four missing testids at once, catching the over-deletion instead of the single Date miss.

## Deliverable 3 — UI permission matrix

**File:** `e2e/src/specs/rebase-smoke/permission-matrix.e2e-spec.ts`
**Tier:** Rebase-gate
**Budget:** ~4 min

### Scope

Not the entire 179-line permission matrix. Focused on **UI-layer** role gates — those the server doesn't enforce because the server's job is API permission, and the UI decides what to render. The failure mode this protects against: a rebase touches `isOwner` / `isSpaceMember` / role props in a Svelte helper and silently flips gates across the app.

### Setup (once per file, in `beforeAll`)

```
admin → creates 4 users: owner, editor, viewer, stranger
owner → creates space "Perms Space"
owner → invites editor (Editor), viewer (Viewer)
  NOTE: addMember default sets showInTimeline=true — required for tests 9/10.
        Do NOT override.
owner → uploads thompson-springs.jpg, adds tag, rates 5, creates a face
owner → adds asset to space

For editor, viewer:
  updateMyPreferences { tags: { enabled: true }, ratings: { enabled: true } }
    per feedback_env_prep_preferences

Drain background jobs before asserting visible state (use ADMIN token — not
role tokens — per feedback_e2e_admin_only_queues; the legacy queue endpoints
return 403 for non-admin callers, and expect.poll would silently loop on empty
state):
  waitForQueueFinish(admin.accessToken, 'metadataExtraction')
  waitForQueueFinish(admin.accessToken, 'thumbnailGeneration')
  waitForQueueFinish(admin.accessToken, 'facialRecognition')

Why these three queues:
  - metadataExtraction: populates EXIF + runs inline reverse-geocoding.
    There is no separate reverseGeocoding queue — the city/country fields
    land on the asset row as a side effect of metadata extraction.
  - thumbnailGeneration: populates thumbnails that the detail panel reads.
  - facialRecognition: guards the manually-created face row from the
    SharedSpacePersonDedup delete path (see utils.ts:524 commentary).
  - sidecar queue is NOT drained because no sidecar XMP is uploaded.
    Add a sidecar drain if a future test seeds one.
```

Classification and pet-detection queues are not drained — default e2e stack does not run them.

**Pre-flight geocoding sanity check.** Test 10 (and Test 9's Location assertion) depend on thompson-springs.jpg being geocoded to a non-null city. Existing comments in the codebase disagree on what place the tile data produces (`utils.ts:874` says Utah; `gallery-map.e2e-spec.ts:90` says Palisade, CO). Add a single assertion at the end of `beforeAll`: fetch the asset via `utils.getAssetInfo(owner, assetId)` and `expect(asset.exifInfo?.city).not.toBeNull()`. If this fails, the e2e stack's reverse-geocoding tile data has drifted and both tests 9/10 should be skipped with a clear message, not flaked.

### Test cases

Ten tests. Tests 1–8 are role-gate UI assertions; tests 9–10 cover cross-boundary data flow (space-member seeing their space's content on personal surfaces when `showInTimeline` is on):

| #   | Role     | Page                     | Key assertions                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| --- | -------- | ------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 1   | owner    | `/spaces/:id`            | `[data-testid="space-menu-button"]` visible, role badge = "Owner"                                                                                                                                                                                                                                                                                                                                                                                                  |
| 2   | editor   | `/spaces/:id`            | role badge = "Editor", add-assets visible, delete-space NOT visible                                                                                                                                                                                                                                                                                                                                                                                                |
| 3   | viewer   | `/spaces/:id`            | role badge = "Viewer", add-assets NOT visible                                                                                                                                                                                                                                                                                                                                                                                                                      |
| 4   | owner    | viewer + detail panel    | Date edit visible, rating clickable, tags editable, file path visible                                                                                                                                                                                                                                                                                                                                                                                              |
| 5   | editor   | viewer + detail panel    | Date edit NOT visible, rating readonly, file path NOT visible                                                                                                                                                                                                                                                                                                                                                                                                      |
| 6   | viewer   | viewer + detail panel    | Same as editor, assert no editor-only controls                                                                                                                                                                                                                                                                                                                                                                                                                     |
| 7   | stranger | `/spaces/:id` direct URL | 403 redirect or access-denied UI                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| 8   | owner    | asset viewer nav bar     | Edit (crop/rotate), Delete, Archive, Favorite, Share all visible                                                                                                                                                                                                                                                                                                                                                                                                   |
| 9   | viewer   | `/photos` filter panel   | Location / Camera / Tags suggestions include contributions from the space (viewer has `showInTimeline=true` by default). Verifies `/search/suggestions/filters?withSharedSpaces=true` is wired correctly — would catch rebases touching `searchAssetBuilder` or the space-union query path.                                                                                                                                                                        |
| 10  | viewer   | `/map`                   | At least one `[data-testid="map-marker"]` renders for the space-owned asset's geocoded location. Requires adding `data-testid="map-marker"` to the image-backed marker div in `map.svelte:433` (fork uses svelte-maplibre's `<MarkerLayer>` which renders custom divs — there is NO `.maplibregl-marker` class on user markers, only on maplibre's built-in controls). Would catch rebases touching `map.repository.ts` or the `getSpaceIdsForTimeline` predicate. |

Tests 9 and 10 deliberately do NOT test the `showInTimeline=false` negative case — that would require mutating the membership row mid-file, which risks cross-test state contamination, and the inverse is already covered at the API level by `timeline.e2e-spec.ts:180`. The UI tier only protects the default-on wiring.

### Playwright project config

```ts
// e2e/playwright.config.ts, inside projects array
{
  name: 'rebase-smoke',
  use: { ...devices['Desktop Chrome'] },
  testDir: './src/specs/rebase-smoke',
  workers: 1,
  retries: 0, // explicit — default config has retries: 4 on CI which would mask flakes
},
```

Default `pnpm test:web` still passes `--project=web` explicitly — rebase-smoke never runs by default.

### What's deliberately skipped

- Member management endpoints — already covered by `shared-space.e2e-spec.ts`.
- Tag CRUD — owner-only, server-enforced, already covered.
- Shared-link creation from space context — documented "known gap" in matrix; regression protection buys nothing.
- Map markers / activity feed / library linking — all tested at the server API level; UI gates for these are thin wrappers.

## Deliverable 4 — Mobile smoke checklist

**File:** `docs/upstream-reports/rebase-mobile-smoke-checklist.md`
**Tier:** Manual
**Budget:** ~10 min human time

### Format

Markdown checkbox list with "Tap X → expect Y. Bug if Z." per item. 15–20 items:

- [ ] App boots past splash (catches `auto_route` strict-mode crashes, riverpod-provider resolution failures, Drift schema version mismatch)
- [ ] Login screen accepts credentials, lands on bottom nav
- [ ] Timeline tab renders (not blank, not error page)
- [ ] Search tab opens, search bar responsive
- [ ] Spaces tab opens, lists spaces (catches `auto_route` duplicate-route crash, bug #5)
- [ ] Library tab opens
- [ ] Open photo from timeline, detail panel renders
- [ ] Swipe between photos in viewer
- [ ] Open Spaces → tap a space → tap a member avatar → back
- [ ] Open timeline filter sheet → apply a filter → content filters
- [ ] Settings → Account → sub-page opens
- [ ] Settings → Preferences → each sub-page opens without "unknown route"
- [ ] Pet detection toggle persists across app restart
- [ ] Upload a photo from device picker → appears in timeline after sync
- [ ] Logout → lands at login (not onboarding, not photos)

### Versioning

Committed once, reused per rebase. Maintainer ticks checkboxes in a local copy, discards on completion. New mobile regression classes (e.g. future `auto_route` bumps) add items over time.

## CI integration details

### Existing `web` project CI — unchanged

Deliverables 1 and 2 sit inside `e2e/src/specs/web/` → picked up by the existing Playwright `web` project → run on every PR → no workflow edit needed. The two specs together add ~110s to the web project's wall-clock time; the project runs with `workers: 1` so that's a straight addition.

### New workflow `gallery-rebase-smoke.yml`

```yaml
name: Gallery Rebase Smoke

on:
  workflow_dispatch:

jobs:
  rebase-smoke:
    runs-on: ubuntu-latest
    timeout-minutes: 15
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v4
      - uses: actions/setup-node@v5
        with: { node-version: 24 }
      - run: pnpm install --frozen-lockfile
      - name: Start e2e stack
        working-directory: e2e
        run: docker compose up -d --build --wait
      - name: Run rebase-smoke project
        working-directory: e2e
        env:
          PLAYWRIGHT_DISABLE_WEBSERVER: 'true'
        run: pnpm exec playwright test --project=rebase-smoke
      - name: Upload Playwright report on failure
        if: failure()
        uses: actions/upload-artifact@v4
        with:
          name: playwright-report
          path: e2e/playwright-report
      - name: Teardown
        if: always()
        working-directory: e2e
        run: docker compose down -v
```

### Push-rebase skill integration

Correction from draft: `push-rebase` SKILL.md currently covers cherry-pick + completeness-verify + force-push. It does NOT currently dispatch any CI workflows — the Test / Docker / Static Analysis dispatch pattern documented in `feedback_rebase_test_branch_no_pr_ci` lives in operator head-knowledge, not in any skill step. This design adds a new gating step to `push-rebase`:

**New step 4.5 (between "Verify completeness" and "Force-push"):** "Dispatch rebase-branch CI workflows and wait for green before force-pushing."

```bash
for wf in test.yml docker.yml static_analysis.yml gallery-rebase-smoke.yml; do
  gh workflow run "$wf" --ref <rebase-branch>
done

# Wait for all four to go green before proceeding to force-push.
# If any fail, fix at root — do NOT force-push on a red workflow.
```

The new workflow `gallery-rebase-smoke.yml` slots in alongside the three pre-existing ones. The skill edit is a separate, small PR that follows the smoke-suite PR (so the dispatch list can reference a workflow file that already exists on main).

### Makefile target

```makefile
e2e-rebase-smoke:
	cd e2e && docker compose up -d --build --wait
	cd e2e && PLAYWRIGHT_DISABLE_WEBSERVER=true pnpm exec playwright test --project=rebase-smoke
	cd e2e && docker compose down -v
```

## Flake mitigation

- Page canary asserts **landmark visible** rather than **spinner absent** — avoids false-green from crashed-before-mount.
- Permission matrix drains `metadataExtraction`, `thumbnailGeneration`, `facialRecognition` before asserting tag / rating / people visibility.
- Project-level `retries: 0` explicit on `rebase-smoke` project (default inherited retries: 4 would mask flakes — per `feedback_no_flake_allowance`, flakes must be fixed at root).
- All three specs `utils.resetDatabase()` in `beforeAll` for isolation.

## YAGNI / explicit exclusions

1. Monolithic `rebase-smoke.e2e-spec.ts` — would duplicate thousands of lines of spec coverage and drift.
2. Bash/curl API script — SDK + Vitest/Playwright harness is strictly better.
3. Full UI permission matrix coverage — only role gates most likely to flip under rebase are tested. The 179-line matrix is the spec document, not its full regression counterpart.
4. Automated mobile tests — patrol removed; Flutter integration_test without patrol is not justified yet.
5. **OAuth + S3 profile-picture e2e test (original deliverable 4, cut).** Server unit spec at `auth.service.spec.ts:1055+` already asserts the S3 branch of `syncProfilePicture`, running on every PR in the existing server test suite. An e2e would add ~90s + S3 stack cost for negligible coverage delta. If a future regression shows this unit test isn't enough (e.g. a wire-level S3 SDK change), reconsider.
6. Auto-triggering `gallery-rebase-smoke.yml` on `push: rebase/**` — forks suppress `pull_request`/`push` events on internal rebase branches, per `feedback_rebase_test_branch_no_pr_ci`.
7. Running rebase-smoke on ARM runners — existing fork deliberately disabled ARM for Playwright (`test.yml:424-426`).

## Rollout plan

1. Implement all four deliverables.
2. **Validate Always-tier runtime locally before promoting to CI.** Both deliverables 1 and 2 start life in `e2e/src/specs/web/`, but before merging, run them 3–5 times against the local e2e stack and take the median wall-clock. Realistic starting-estimate budget: deliverable 1 is 3–4 min (18 serial `page.goto`s × login cost + up to 5s landmark wait), deliverable 2 is ≤ 40s. Measured medians are authoritative — the above estimates are for sanity-checking, not gating. If deliverable 1's median exceeds ~4 min:
   - (a) drop the lowest-value routes from the canary (admin sub-pages first), OR
   - (b) tighten the landmark wait timeout from 5s to 2s (acceptable once we've confirmed real wall-clock is <2s on a healthy run), OR
   - (c) demote the canary to rebase-gate tier.
     Record the measured times in the PR description for future regression-spotting. `workers: 1` on the `web` project is a global constraint — do NOT override it for the canary alone unless the existing spec authors agree (parallelism breaks assumptions in the shared `connectWebsocket` event bus, among other things).
3. Dispatch `gallery-rebase-smoke.yml --ref rebase/upstream` manually to exercise the new workflow end-to-end.
4. Merge via the normal rebase force-push flow.
5. **Follow-up PR** to update `push-rebase` SKILL.md with the new step 4.5 dispatching the four workflows (see "Push-rebase skill integration" above). This PR lands AFTER the smoke-suite PR is merged, so the SKILL references a workflow file that already exists on main.

## Open questions

None remaining — reviewer's draft raised three; all are now resolved in the design:

- Runner: `ubuntu-latest` (ARM disabled per existing comment in `test.yml:424-426`).
- Auto-trigger on `rebase/**`: rejected (forks suppress the event).
- Canary test shape: one test per route in `test.describe.serial` to avoid 60s per-test cap.
