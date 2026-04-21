# Post-Rebase Smoke Suite Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Implement the tiered post-rebase smoke suite designed in `docs/plans/2026-04-21-rebase-smoke-design.md`: a page-render canary + detail-panel full-layout test running on every PR, a UI permission matrix running only on rebase branches via `workflow_dispatch`, and a manual mobile checklist.

**Architecture:** Three runnable deliverables (plus one markdown file). Deliverables 1 and 2 drop into the existing Playwright `web` project. Deliverable 3 is a new `rebase-smoke` Playwright project gated by a new `gallery-rebase-smoke.yml` workflow. Small production-code edits add stable `data-testid` attributes to header layouts, the detail panel, and the map marker so the specs can target them without depending on translated text.

**Tech Stack:** TypeScript, SvelteKit (Svelte 5 runes), Playwright, Vitest, `@immich/sdk`, GitHub Actions, GNU Make. `@immich/ui` primitives (Button, Breadcrumbs, IconButton) used in existing layouts.

**Worktree:** All work happens in `/home/pierre/dev/gallery/.claude/worktrees/upstream-rebase` on branch `rebase/upstream`. HEAD is `0521158b1` (the second-review fold-in of the design doc). Commit frequently; every task ends in a commit.

**Pre-flight checks (do once before starting):**

```bash
cd /home/pierre/dev/gallery/.claude/worktrees/upstream-rebase
git status                        # must be clean
git log --oneline -3              # HEAD should be 0521158b1
cd e2e && docker compose up -d --build --wait
curl -fs http://127.0.0.1:2285/api/server/ping  # expect 200 {"res":"pong"}
```

**Reference the design doc constantly** — every decision not re-stated here is decided there.

---

## Phase A — Always-tier: page-render canary (deliverable 1)

### Task A1: Add `page-header` testid to `user-page-layout.svelte`

**Files:**

- Modify: `web/src/lib/components/layouts/user-page-layout.svelte:80`

**Step 1: Open the file and locate the header div.**

Run: `grep -n "id={headerId}" web/src/lib/components/layouts/user-page-layout.svelte`
Expected: one hit at line ~80 showing `<div class="outline-none pe-8" tabindex="-1" id={headerId}>{title}</div>`.

**Step 2: Add the testid attribute.**

Change line 80 from:

```svelte
<div class="outline-none pe-8" tabindex="-1" id={headerId}>{title}</div>
```

to:

```svelte
<div class="outline-none pe-8" tabindex="-1" id={headerId} data-testid="page-header">{title}</div>
```

The `id={headerId}` and exported `headerId` constant stay — existing focus-management callers reference them.

**Step 3: Verify no other changes.**

Run: `cd web && pnpm exec prettier --check src/lib/components/layouts/user-page-layout.svelte`
Expected: no formatting diff.

**Step 4: Commit.**

```bash
git add web/src/lib/components/layouts/user-page-layout.svelte
git commit -m "feat(web): add page-header testid to user-page-layout for e2e canary"
```

---

### Task A2: Add `admin-page-header` testid to `BreadcrumbActionPage.svelte`

**Files:**

- Modify: `web/src/lib/components/BreadcrumbActionPage.svelte:34`

**Step 1: Locate the header container.**

Run: `grep -n "flex h-16" web/src/lib/components/BreadcrumbActionPage.svelte`
Expected: one hit at line ~34 showing `<div class="flex h-16 w-full justify-between items-center border-b py-2 px-4 md:px-2">`.

**Step 2: Add the testid.**

Change that line to include `data-testid="admin-page-header"`:

```svelte
<div class="flex h-16 w-full justify-between items-center border-b py-2 px-4 md:px-2" data-testid="admin-page-header">
```

**Step 3: Commit.**

```bash
git add web/src/lib/components/BreadcrumbActionPage.svelte
git commit -m "feat(web): add admin-page-header testid to BreadcrumbActionPage"
```

---

### Task A3: Write the page-canary spec (red)

**Files:**

- Create: `e2e/src/specs/web/rebase-smoke-pages.e2e-spec.ts`

**Step 1: Write the spec.**

Use the exact contents below. Route list comes verbatim from the design doc's route table (18 entries).

```ts
import type { LoginResponseDto } from '@immich/sdk';
import { expect, test } from '@playwright/test';
import { utils } from 'src/utils';

type CanaryRoute = {
  path: string;
  landmark: string;
  description: string;
};

const routes: CanaryRoute[] = [
  {
    path: '/photos',
    landmark: '[data-testid="discovery-panel"], [data-testid="collapsed-icon-strip"]',
    description: '/photos renders',
  },
  { path: '/albums', landmark: '[data-testid="page-header"]', description: '/albums renders' },
  { path: '/spaces', landmark: '[data-testid="page-header"]', description: '/spaces renders' },
  { path: '/favorites', landmark: '[data-testid="page-header"]', description: '/favorites renders' },
  { path: '/archive', landmark: '[data-testid="page-header"]', description: '/archive renders' },
  { path: '/trash', landmark: '[data-testid="page-header"]', description: '/trash renders' },
  { path: '/map', landmark: '.maplibregl-map', description: '/map renders' },
  { path: '/people', landmark: '[data-testid="page-header"]', description: '/people renders' },
  { path: '/places', landmark: '[data-testid="page-header"]', description: '/places renders' },
  { path: '/partners', landmark: '[data-testid="page-header"]', description: '/partners renders' },
  { path: '/shared-links', landmark: '[data-testid="page-header"]', description: '/shared-links renders' },
  { path: '/tags', landmark: '[data-testid="page-header"]', description: '/tags renders' },
  { path: '/explore', landmark: '[data-testid="page-header"]', description: '/explore renders' },
  {
    path: '/admin/user-management',
    landmark: '[data-testid="admin-page-header"]',
    description: '/admin/user-management renders',
  },
  {
    path: '/admin/system-settings',
    landmark: '[data-testid="admin-page-header"]',
    description: '/admin/system-settings renders',
  },
  {
    path: '/admin/jobs-status',
    landmark: '[data-testid="admin-page-header"]',
    description: '/admin/jobs-status renders',
  },
  { path: '/admin/queues', landmark: '[data-testid="admin-page-header"]', description: '/admin/queues renders' },
  { path: '/user-settings', landmark: '[data-testid="page-header"]', description: '/user-settings renders' },
];

test.describe.serial('Rebase Smoke — Page Render', () => {
  let admin: LoginResponseDto;

  test.beforeAll(async () => {
    utils.initSdk();
    await utils.resetDatabase();
    admin = await utils.adminSetup();
  });

  for (const route of routes) {
    test(route.description, async ({ context, page }) => {
      await utils.setAuthCookies(context, admin.accessToken);
      await page.goto(route.path);
      await expect(page.locator(route.landmark).first()).toBeVisible({ timeout: 5_000 });
    });
  }
});
```

**Step 2: Run the spec.**

```bash
cd e2e && PLAYWRIGHT_DISABLE_WEBSERVER=true pnpm exec playwright test --project=web src/specs/web/rebase-smoke-pages.e2e-spec.ts
```

Expected: 18 tests execute serially. All should pass given Tasks A1 + A2 added the testids. If any fail (e.g. a route that doesn't pass a `title` prop to `user-page-layout`), note which and either: (a) fix the page to pass a title, (b) pick a page-specific landmark, or (c) remove the route from the list with a comment.

**Step 3: If any routes fail, fix them before moving on.** Common failure modes:

- Page doesn't mount `user-page-layout` (e.g. map/photos, handled above). Pick a page-specific landmark.
- Page renders an empty state that wraps its own layout. Inspect the rendered HTML via `page.content()` in Playwright UI mode (`pnpm exec playwright test --ui`).
- Admin layout pages that use a different layout entirely. None expected; if found, add its testid to that layout.

**Step 4: Commit the spec.**

```bash
git add e2e/src/specs/web/rebase-smoke-pages.e2e-spec.ts
git commit -m "test(e2e): page-render canary for rebase-smoke always tier"
```

---

### Task A4: Measure canary runtime (rollout gate)

**Files:** none

**Step 1: Run the canary 5 times, capture wall-clock medians.**

```bash
cd e2e
for i in 1 2 3 4 5; do
  time PLAYWRIGHT_DISABLE_WEBSERVER=true pnpm exec playwright test --project=web src/specs/web/rebase-smoke-pages.e2e-spec.ts 2>&1 | tail -5
done
```

Record the 5 real-time values.

**Step 2: Decide.**

- Median ≤ 4 min → proceed, canary stays always-on.
- Median > 4 min but ≤ 6 min → tighten landmark timeout from 5000 to 2000ms, re-measure.
- Median > 6 min → demote to rebase-gate (move the file from `e2e/src/specs/web/` to `e2e/src/specs/rebase-smoke/` after Task C1 creates that directory). Document the decision in the eventual PR description.

**Step 3: If no changes are needed, nothing to commit. Otherwise, commit timeout tightening or file move.**

---

## Phase B — Always-tier: detail-panel full-layout (deliverable 2)

### Task B1: Write the failing detail-panel full-layout test

**Files:**

- Modify: `e2e/src/specs/web/asset-viewer/detail-panel.e2e-spec.ts`

**Step 1: Read the existing file to understand setup.**

Run: `head -50 e2e/src/specs/web/asset-viewer/detail-panel.e2e-spec.ts` — note the pattern for admin setup, uploading, and opening the viewer. Use that pattern.

**Step 2: Append a new test at the end of the `test.describe` block.**

```ts
test('renders all panel sections simultaneously for a fully-tagged photo', async ({ context, page }) => {
  // Upload thompson-springs.jpg — full EXIF + GPS fixture used by other specs.
  const gpsImagePath = `${testAssetDir}/metadata/gps-position/thompson-springs.jpg`;
  const asset = await utils.createAsset(admin.accessToken, {
    assetData: { bytes: readFileSync(gpsImagePath), filename: 'thompson-springs.jpg' },
  });

  // Drain metadata so EXIF + reverse-geocoded location land before we assert.
  await utils.waitForQueueFinish(admin.accessToken, 'metadataExtraction');
  await utils.waitForQueueFinish(admin.accessToken, 'thumbnailGeneration');

  // Apply rating + tag so those sections render.
  await updateAsset({ id: asset.id, updateAssetDto: { rating: 5 } }, { headers: asBearerAuth(admin.accessToken) });
  const tags = await utils.upsertTags(admin.accessToken, ['rebase-smoke']);
  await utils.tagAssets(admin.accessToken, tags[0].id, [asset.id]);

  // Open the asset viewer + detail panel.
  await utils.setAuthCookies(context, admin.accessToken);
  await page.goto(`/photos/${asset.id}`);
  await page.getByRole('button', { name: 'Info' }).click(); // or the existing pattern in this file

  // All 7 section testids must be visible together.
  for (const testid of [
    'detail-panel-edit-date-button',
    'detail-panel-filename',
    'detail-panel-camera',
    'detail-panel-lens',
    'detail-panel-location',
    'detail-panel-rating',
    'detail-panel-tags',
  ]) {
    await expect(page.locator(`[data-testid="${testid}"]`)).toBeVisible({ timeout: 5_000 });
  }
});
```

You may need to adjust the imports at the top of the file: add `readFileSync` from `node:fs`, `updateAsset` from `@immich/sdk`, `asBearerAuth`, `testAssetDir`. Match the exact import style of neighbour specs.

**Step 3: Run it. Expect it to fail.**

```bash
cd e2e && PLAYWRIGHT_DISABLE_WEBSERVER=true pnpm exec playwright test --project=web src/specs/web/asset-viewer/detail-panel.e2e-spec.ts -g "renders all panel sections"
```

Expected: FAIL — 5 testids don't exist yet (filename, camera, lens, location, rating). The existing `detail-panel-edit-date-button` and `detail-panel-tags` should pass the Visible check individually but the test overall fails.

**Step 4: Do NOT commit yet.** Proceed to Task B2 to make the test pass before committing.

---

### Task B2: Add 5 testids to `detail-panel.svelte` and related sub-components

**Files:**

- Modify: `web/src/lib/components/asset-viewer/detail-panel.svelte` (3 testids: filename, camera, lens)
- Modify: `web/src/lib/components/asset-viewer/detail-panel-location.svelte` (1 testid: location)
- Modify: `web/src/lib/components/asset-viewer/detail-panel-star-rating.svelte` (1 testid: rating)

**Step 1: Add `detail-panel-filename` to the filename block.**

Edit `web/src/lib/components/asset-viewer/detail-panel.svelte` line ~285. Change:

```svelte
<div class="flex gap-4 py-4">
  <div><Icon icon={mdiImageOutline} size="24" /></div>
```

to:

```svelte
<div class="flex gap-4 py-4" data-testid="detail-panel-filename">
  <div><Icon icon={mdiImageOutline} size="24" /></div>
```

**Step 2: Add `detail-panel-camera` to the camera block (line ~331).**

Change `<div class="flex gap-4 py-4">` (the one containing `<Icon icon={mdiCamera} ...>`) to `<div class="flex gap-4 py-4" data-testid="detail-panel-camera">`.

**Step 3: Add `detail-panel-lens` to the lens block (line ~365).**

Change `<div class="flex gap-4 py-4">` (the one containing `<Icon icon={mdiCameraIris} ...>`) to `<div class="flex gap-4 py-4" data-testid="detail-panel-lens">`.

**Step 4: Add `detail-panel-location` to `detail-panel-location.svelte`.**

Run: `head -30 web/src/lib/components/asset-viewer/detail-panel-location.svelte` — find the root element and add `data-testid="detail-panel-location"` to it.

**Step 5: Add `detail-panel-rating` to `detail-panel-star-rating.svelte`.**

Same approach — find the root element, add `data-testid="detail-panel-rating"`.

**Step 6: Re-run the test.**

```bash
cd e2e && PLAYWRIGHT_DISABLE_WEBSERVER=true pnpm exec playwright test --project=web src/specs/web/asset-viewer/detail-panel.e2e-spec.ts -g "renders all panel sections"
```

Expected: PASS.

**Step 7: Commit.**

```bash
git add web/src/lib/components/asset-viewer/detail-panel.svelte \
        web/src/lib/components/asset-viewer/detail-panel-location.svelte \
        web/src/lib/components/asset-viewer/detail-panel-star-rating.svelte \
        e2e/src/specs/web/asset-viewer/detail-panel.e2e-spec.ts
git commit -m "test(e2e): full-layout test + 5 section testids for rebase-smoke always tier"
```

---

### Task B3: Measure detail-panel test runtime

**Files:** none

**Step 1: Run the new test 3 times and time it.**

```bash
cd e2e
for i in 1 2 3; do
  time PLAYWRIGHT_DISABLE_WEBSERVER=true pnpm exec playwright test --project=web src/specs/web/asset-viewer/detail-panel.e2e-spec.ts -g "renders all panel sections"
done
```

**Step 2: If median > 40s, flag for investigation** but don't block — this is supplementary to the existing file and unlikely to dominate the project's runtime.

---

## Phase C — Rebase-gate setup (deliverable 3 scaffold)

### Task C1: Create the `rebase-smoke` directory and Playwright project

**Files:**

- Create: `e2e/src/specs/rebase-smoke/` (directory — place a `.gitkeep` if needed so git tracks it)
- Modify: `e2e/playwright.config.ts`

**Step 1: Create the directory.**

```bash
mkdir -p e2e/src/specs/rebase-smoke
```

**Step 2: Add the Playwright project.**

In `e2e/playwright.config.ts`, locate the `projects: [...]` array (~line 35) and add a new project AFTER the existing `maintenance` entry:

```ts
{
  name: 'rebase-smoke',
  use: { ...devices['Desktop Chrome'] },
  testDir: './src/specs/rebase-smoke',
  workers: 1,
  retries: 0, // explicit — default config has retries: 4 on CI which would mask flakes
},
```

**Step 3: Verify the config parses.**

```bash
cd e2e && pnpm exec playwright test --project=rebase-smoke --list
```

Expected: `0 tests in 0 files` (no specs yet) — confirms the project is recognized.

**Step 4: Commit.**

```bash
git add e2e/playwright.config.ts
git commit -m "chore(e2e): add rebase-smoke Playwright project"
```

---

### Task C2: Add the `make e2e-rebase-smoke` target

**Files:**

- Modify: `Makefile`

**Step 1: Locate the existing e2e targets.**

Run: `grep -n "^e2e" Makefile` — note the pattern of existing targets.

**Step 2: Add the new target.**

Append to `Makefile`:

```makefile
.PHONY: e2e-rebase-smoke
e2e-rebase-smoke:
	cd e2e && docker compose up -d --build --wait
	cd e2e && PLAYWRIGHT_DISABLE_WEBSERVER=true pnpm exec playwright test --project=rebase-smoke
	cd e2e && docker compose down -v
```

**Step 3: Verify the target is wired correctly.**

```bash
make -n e2e-rebase-smoke   # prints the commands without running them
```

Expected: the three commands appear.

**Step 4: Commit.**

```bash
git add Makefile
git commit -m "chore: add make e2e-rebase-smoke target"
```

---

## Phase D — Rebase-gate: permission-matrix spec (deliverable 3)

Each test in the matrix gets its own task. Setup logic lives in a shared `beforeAll` in the spec file.

### Task D1: Scaffold the permission-matrix spec with shared setup

**Files:**

- Create: `e2e/src/specs/rebase-smoke/permission-matrix.e2e-spec.ts`

**Step 1: Write the skeleton with `beforeAll` setup but zero tests.**

```ts
import {
  AssetMediaResponseDto,
  LoginResponseDto,
  SharedSpaceResponseDto,
  SharedSpaceRole,
  updateAsset,
} from '@immich/sdk';
import { expect, test } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { asBearerAuth, testAssetDir, utils } from 'src/utils';

test.describe('Rebase Smoke — UI Permission Matrix', () => {
  let admin: LoginResponseDto;
  let owner: LoginResponseDto;
  let editor: LoginResponseDto;
  let viewer: LoginResponseDto;
  let stranger: LoginResponseDto;
  let space: SharedSpaceResponseDto;
  let asset: AssetMediaResponseDto;

  test.beforeAll(async () => {
    utils.initSdk();
    await utils.resetDatabase();
    admin = await utils.adminSetup();
    owner = await utils.userSetup(admin.accessToken, { email: 'owner@t.com', password: 'p', name: 'Owner' });
    editor = await utils.userSetup(admin.accessToken, { email: 'editor@t.com', password: 'p', name: 'Editor' });
    viewer = await utils.userSetup(admin.accessToken, { email: 'viewer@t.com', password: 'p', name: 'Viewer' });
    stranger = await utils.userSetup(admin.accessToken, { email: 'stranger@t.com', password: 'p', name: 'Stranger' });

    space = await utils.createSpace(owner.accessToken, { name: 'Perms Space' });
    await utils.addSpaceMember(owner.accessToken, space.id, { userId: editor.userId, role: SharedSpaceRole.Editor });
    await utils.addSpaceMember(owner.accessToken, space.id, { userId: viewer.userId, role: SharedSpaceRole.Viewer });
    // Default showInTimeline=true — do NOT override; tests 9/10 rely on it.

    const gpsImagePath = `${testAssetDir}/metadata/gps-position/thompson-springs.jpg`;
    asset = await utils.createAsset(owner.accessToken, {
      assetData: { bytes: readFileSync(gpsImagePath), filename: 'rebase-smoke.jpg' },
    });
    await updateAsset({ id: asset.id, updateAssetDto: { rating: 5 } }, { headers: asBearerAuth(owner.accessToken) });
    const tags = await utils.upsertTags(owner.accessToken, ['rebase-smoke']);
    await utils.tagAssets(owner.accessToken, tags[0].id, [asset.id]);
    const person = await utils.createPerson(owner.accessToken, { name: 'RebasePerson' });
    await utils.createFace({ assetId: asset.id, personId: person.id });
    await utils.addSpaceAssets(owner.accessToken, space.id, [asset.id]);

    // Enable tags + ratings for editor/viewer.
    for (const role of [editor, viewer]) {
      await utils.updateMyPreferences(role.accessToken, {
        tags: { enabled: true },
        ratings: { enabled: true },
      });
    }

    // Drain queues with ADMIN token (waitForQueueFinish requires admin per feedback_e2e_admin_only_queues).
    await utils.waitForQueueFinish(admin.accessToken, 'metadataExtraction');
    await utils.waitForQueueFinish(admin.accessToken, 'thumbnailGeneration');
    await utils.waitForQueueFinish(admin.accessToken, 'facialRecognition');

    // Pre-flight: verify geocoding populated city. If not, tests 9/10 will skip.
    const fullAsset = await utils.getAssetInfo(owner.accessToken, asset.id);
    if (!fullAsset.exifInfo?.city) {
      console.warn('[rebase-smoke] Reverse-geocoding produced no city; tests 9/10 will be skipped.');
    }
  });

  // Tests 1-10 added in subsequent tasks.
});
```

**Step 2: Run to confirm the skeleton parses and setup works.**

```bash
cd e2e && PLAYWRIGHT_DISABLE_WEBSERVER=true pnpm exec playwright test --project=rebase-smoke
```

Expected: `0 tests` or `1 test skipped` — the empty describe shouldn't register tests but the `beforeAll` is not triggered without tests. This step is just a compile check.

**Step 3: Commit.**

```bash
git add e2e/src/specs/rebase-smoke/permission-matrix.e2e-spec.ts
git commit -m "test(e2e): scaffold permission-matrix spec for rebase-smoke"
```

---

### Task D2: Test 1 — owner on `/spaces/:id`

**Files:**

- Modify: `e2e/src/specs/rebase-smoke/permission-matrix.e2e-spec.ts`

**Step 1: Write the test (place inside the describe, after `beforeAll`).**

```ts
test('Test 1 — owner: space-menu-button visible, role badge Owner', async ({ context, page }) => {
  await utils.setAuthCookies(context, owner.accessToken);
  await page.goto(`/spaces/${space.id}`);
  await expect(page.locator('[data-testid="space-menu-button"]')).toBeVisible({ timeout: 5_000 });
  await expect(page.locator('[data-testid="hero-role-badge"]')).toContainText('Owner');
});
```

**Step 2: Run the test. Expect it to PASS (existing spaces page already has these testids per `spaces-p1.e2e-spec.ts`).**

```bash
cd e2e && PLAYWRIGHT_DISABLE_WEBSERVER=true pnpm exec playwright test --project=rebase-smoke -g "Test 1"
```

**Step 3: If testids are missing,** inspect the spaces page (`web/src/routes/(user)/spaces/`) and either:

- Add missing testids to the space page hero/menu components (production-code edit — commit separately with `feat(web):` prefix).
- Fall back to text-based or `role=` locators if the visual element reliably renders.

**Step 4: Commit.**

```bash
git add e2e/src/specs/rebase-smoke/permission-matrix.e2e-spec.ts
git commit -m "test(e2e): permission-matrix Test 1 — owner space page"
```

---

### Task D3: Test 2 — editor on `/spaces/:id`

**Step 1: Write the test.**

```ts
test('Test 2 — editor: add-assets visible, delete-space NOT visible', async ({ context, page }) => {
  await utils.setAuthCookies(context, editor.accessToken);
  await page.goto(`/spaces/${space.id}`);
  await expect(page.locator('[data-testid="hero-role-badge"]')).toContainText('Editor');
  await expect(page.locator('[data-testid="add-assets-button"]')).toBeVisible();
  await expect(page.locator('[data-testid="delete-space-button"]')).not.toBeVisible();
});
```

**Step 2: Run, fix testids if missing, commit.**

```bash
cd e2e && PLAYWRIGHT_DISABLE_WEBSERVER=true pnpm exec playwright test --project=rebase-smoke -g "Test 2"
git add e2e/src/specs/rebase-smoke/permission-matrix.e2e-spec.ts
git commit -m "test(e2e): permission-matrix Test 2 — editor space page"
```

---

### Task D4: Test 3 — viewer on `/spaces/:id`

**Step 1: Write the test.**

```ts
test('Test 3 — viewer: add-assets NOT visible', async ({ context, page }) => {
  await utils.setAuthCookies(context, viewer.accessToken);
  await page.goto(`/spaces/${space.id}`);
  await expect(page.locator('[data-testid="hero-role-badge"]')).toContainText('Viewer');
  await expect(page.locator('[data-testid="add-assets-button"]')).not.toBeVisible();
});
```

**Step 2: Run, commit.**

```bash
cd e2e && PLAYWRIGHT_DISABLE_WEBSERVER=true pnpm exec playwright test --project=rebase-smoke -g "Test 3"
git add e2e/src/specs/rebase-smoke/permission-matrix.e2e-spec.ts
git commit -m "test(e2e): permission-matrix Test 3 — viewer space page"
```

---

### Task D5: Test 4 — owner detail panel

**Step 1: Write the test. Uses detail-panel testids from Phase B.**

```ts
test('Test 4 — owner detail panel: edit controls visible, file path visible', async ({ context, page }) => {
  await utils.setAuthCookies(context, owner.accessToken);
  await page.goto(`/spaces/${space.id}/photos/${asset.id}`);
  await page.getByRole('button', { name: 'Info' }).click();
  await expect(page.locator('[data-testid="detail-panel-edit-date-button"]')).toBeVisible();
  await expect(page.locator('[data-testid="detail-panel-rating"] [role="button"]').first()).toBeEnabled();
  // Click the file-info toggle to reveal the path (owner-only).
  await page.locator('[aria-label="Show file location"]').click();
  await expect(page.locator('text=/rebase-smoke.jpg/')).toBeVisible();
});
```

**Step 2: Run, commit.**

```bash
cd e2e && PLAYWRIGHT_DISABLE_WEBSERVER=true pnpm exec playwright test --project=rebase-smoke -g "Test 4"
git add e2e/src/specs/rebase-smoke/permission-matrix.e2e-spec.ts
git commit -m "test(e2e): permission-matrix Test 4 — owner detail panel"
```

---

### Task D6: Test 5 — editor detail panel

**Step 1: Write the test.**

```ts
test('Test 5 — editor detail panel: edit controls hidden, rating readonly', async ({ context, page }) => {
  await utils.setAuthCookies(context, editor.accessToken);
  await page.goto(`/spaces/${space.id}/photos/${asset.id}`);
  await page.getByRole('button', { name: 'Info' }).click();
  await expect(page.locator('[data-testid="detail-panel-edit-date-button"]')).not.toBeVisible();
  await expect(
    page.locator('[data-testid="detail-panel-filename"] [aria-label="Show file location"]'),
  ).not.toBeVisible();
});
```

**Step 2: Run, commit.**

```bash
cd e2e && PLAYWRIGHT_DISABLE_WEBSERVER=true pnpm exec playwright test --project=rebase-smoke -g "Test 5"
git add e2e/src/specs/rebase-smoke/permission-matrix.e2e-spec.ts
git commit -m "test(e2e): permission-matrix Test 5 — editor detail panel"
```

---

### Task D7: Test 6 — viewer detail panel

**Step 1: Write the test — same assertions as Test 5 but for viewer, plus no add-assets in parent viewer.**

```ts
test('Test 6 — viewer detail panel: same as editor, no editor-only controls', async ({ context, page }) => {
  await utils.setAuthCookies(context, viewer.accessToken);
  await page.goto(`/spaces/${space.id}/photos/${asset.id}`);
  await page.getByRole('button', { name: 'Info' }).click();
  await expect(page.locator('[data-testid="detail-panel-edit-date-button"]')).not.toBeVisible();
  await expect(
    page.locator('[data-testid="detail-panel-filename"] [aria-label="Show file location"]'),
  ).not.toBeVisible();
});
```

**Step 2: Run, commit.**

```bash
cd e2e && PLAYWRIGHT_DISABLE_WEBSERVER=true pnpm exec playwright test --project=rebase-smoke -g "Test 6"
git add e2e/src/specs/rebase-smoke/permission-matrix.e2e-spec.ts
git commit -m "test(e2e): permission-matrix Test 6 — viewer detail panel"
```

---

### Task D8: Test 7 — stranger blocked at `/spaces/:id`

**Step 1: Write the test.**

```ts
test('Test 7 — stranger: 403 redirect or access-denied on direct URL', async ({ context, page }) => {
  await utils.setAuthCookies(context, stranger.accessToken);
  const response = await page.goto(`/spaces/${space.id}`);
  // Either the server returns 403 or the page redirects to /spaces (list) / shows access-denied.
  // Accept any of: HTTP error status, URL that's not /spaces/<id>, or visible access-denied UI.
  const is403 = response?.status() === 403;
  const redirectedAway = !page.url().includes(`/spaces/${space.id}`);
  const accessDenied = await page
    .locator('text=/access denied|not found|no access/i')
    .isVisible()
    .catch(() => false);
  expect(is403 || redirectedAway || accessDenied).toBeTruthy();
});
```

**Step 2: Run, commit.**

```bash
cd e2e && PLAYWRIGHT_DISABLE_WEBSERVER=true pnpm exec playwright test --project=rebase-smoke -g "Test 7"
git add e2e/src/specs/rebase-smoke/permission-matrix.e2e-spec.ts
git commit -m "test(e2e): permission-matrix Test 7 — stranger blocked"
```

---

### Task D9: Test 8 — owner asset viewer nav bar

**Step 1: Write the test.**

```ts
test('Test 8 — owner nav bar: Edit / Delete / Archive / Favorite / Share all visible', async ({ context, page }) => {
  await utils.setAuthCookies(context, owner.accessToken);
  await page.goto(`/photos/${asset.id}`); // owner's personal viewer path, not space
  for (const label of ['Edit', 'Delete', 'Archive', 'Favorite', 'Share']) {
    await expect(page.getByRole('button', { name: label })).toBeVisible();
  }
});
```

**Step 2: Run, commit.**

```bash
cd e2e && PLAYWRIGHT_DISABLE_WEBSERVER=true pnpm exec playwright test --project=rebase-smoke -g "Test 8"
git add e2e/src/specs/rebase-smoke/permission-matrix.e2e-spec.ts
git commit -m "test(e2e): permission-matrix Test 8 — owner nav bar actions"
```

---

### Task D10: Test 9 — viewer `/photos` filter panel sees space content

**Step 1: Write the test.**

```ts
test('Test 9 — viewer /photos filter panel includes space suggestions', async ({ context, page }) => {
  const fullAsset = await utils.getAssetInfo(owner.accessToken, asset.id);
  test.skip(!fullAsset.exifInfo?.city, 'Reverse-geocoding produced no city; skipping');

  await utils.setAuthCookies(context, viewer.accessToken);
  await page.goto('/photos');
  // FilterPanel is open by default on /photos.
  await page.locator('[data-testid="filter-section-location"]').waitFor({ timeout: 10_000 });
  // The owner's tag must appear in the viewer's Tags section (via withSharedSpaces=true).
  await expect(page.locator('text=/rebase-smoke/i').first()).toBeVisible({ timeout: 10_000 });
});
```

**Step 2: Run, commit.**

```bash
cd e2e && PLAYWRIGHT_DISABLE_WEBSERVER=true pnpm exec playwright test --project=rebase-smoke -g "Test 9"
git add e2e/src/specs/rebase-smoke/permission-matrix.e2e-spec.ts
git commit -m "test(e2e): permission-matrix Test 9 — viewer /photos filter sees space"
```

---

### Task D11: Add `map-marker` testid to `map.svelte`

**Files:**

- Modify: `web/src/lib/components/shared-components/map/map.svelte:433`

**Step 1: Locate the image-backed marker div.**

Run: `grep -n "getAssetMediaUrl({ id: feature" web/src/lib/components/shared-components/map/map.svelte` — expect a hit near line 434.

**Step 2: Add `data-testid="map-marker"` to the `<img>` element at that line.**

Before:

```svelte
<img
  src={getAssetMediaUrl({ id: feature.properties?.id })}
  class="rounded-full w-15 h-15 ..."
  alt={...}
/>
```

After:

```svelte
<img
  src={getAssetMediaUrl({ id: feature.properties?.id })}
  class="rounded-full w-15 h-15 ..."
  alt={...}
  data-testid="map-marker"
/>
```

**Step 3: Commit.**

```bash
git add web/src/lib/components/shared-components/map/map.svelte
git commit -m "feat(web): add map-marker testid for e2e map tests"
```

---

### Task D12: Test 10 — viewer `/map` sees space-contributed marker

**Step 1: Write the test.**

```ts
test('Test 10 — viewer /map sees space marker', async ({ context, page }) => {
  const fullAsset = await utils.getAssetInfo(owner.accessToken, asset.id);
  test.skip(!fullAsset.exifInfo?.latitude, 'Asset has no GPS; skipping');

  await utils.setAuthCookies(context, viewer.accessToken);
  await page.goto('/map');
  await page.locator('.maplibregl-map').waitFor({ timeout: 10_000 });
  // At least one marker must render for the space-owned asset.
  const markers = page.locator('[data-testid="map-marker"]');
  await expect.poll(async () => markers.count(), { timeout: 15_000 }).toBeGreaterThan(0);
});
```

**Step 2: Run, commit.**

```bash
cd e2e && PLAYWRIGHT_DISABLE_WEBSERVER=true pnpm exec playwright test --project=rebase-smoke -g "Test 10"
git add e2e/src/specs/rebase-smoke/permission-matrix.e2e-spec.ts
git commit -m "test(e2e): permission-matrix Test 10 — viewer /map sees space marker"
```

---

### Task D13: Run the full rebase-smoke project and measure

**Files:** none

**Step 1: Full run.**

```bash
cd e2e && time PLAYWRIGHT_DISABLE_WEBSERVER=true pnpm exec playwright test --project=rebase-smoke
```

Expected: 10 tests, all pass. Wall-clock under 7 min.

**Step 2: If any tests are flaky across 3 consecutive runs, fix at root** — per `feedback_no_flake_allowance`, never add `test.retry()` or increase retries. Most likely culprits: queue not drained, selector slightly wrong, race on reverse-geocoding.

**Step 3: Nothing to commit here** unless fixes were made; commit those individually.

---

## Phase E — Rebase-gate CI workflow

### Task E1: Add `gallery-rebase-smoke.yml` GitHub Actions workflow

**Files:**

- Create: `.github/workflows/gallery-rebase-smoke.yml`

**Step 1: Write the workflow.**

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
        with:
          node-version: 24
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

**Step 2: Validate with `gh`.**

```bash
gh workflow view gallery-rebase-smoke.yml || true   # workflow-dispatch-only workflows need the file merged before view works
yq . .github/workflows/gallery-rebase-smoke.yml      # should not error
```

**Step 3: Commit.**

```bash
git add .github/workflows/gallery-rebase-smoke.yml
git commit -m "ci: add gallery-rebase-smoke workflow (workflow_dispatch only)"
```

---

## Phase F — Mobile checklist

### Task F1: Write the mobile smoke checklist

**Files:**

- Create: `docs/upstream-reports/rebase-mobile-smoke-checklist.md`

**Step 1: Write the file.**

```markdown
# Rebase Mobile Smoke Checklist

Human-run checklist after an upstream rebase. Targets ~10 min on a device with the `de.opennoodle.gallery.debug` build installed.

## Boot + auth

- [ ] App boots past splash screen. (Bug if: immediate crash, blank screen >5s, framework exception dialog. Catches auto_route strict-mode collisions, riverpod-provider resolution failures, Drift schema version mismatch.)
- [ ] Login screen accepts credentials → lands on bottom nav.
- [ ] Logout → lands at login screen (not onboarding, not /photos).

## Bottom nav — each tab renders

- [ ] Timeline tab renders, shows the user's photos (or the empty-state illustration).
- [ ] Search tab opens, search input is focusable.
- [ ] Spaces tab opens, lists spaces. (Bug if: tap crashes the app — this is the primary repro for the duplicate-SpacesRoute crash seen on 2026-04-20.)
- [ ] Library tab opens.

## Viewer

- [ ] Open a photo from the Timeline → detail panel renders.
- [ ] Swipe left/right between photos in the viewer.

## Spaces

- [ ] Open a space → member avatars visible → tap a member → see their contributions → back.

## Filters + preferences

- [ ] Open the Timeline filter sheet → apply a filter → timeline content filters.
- [ ] Settings → Account → each sub-page opens without "unknown route" error.
- [ ] Settings → Preferences → each sub-page opens cleanly.
- [ ] Pet detection toggle survives an app restart (kill → relaunch).

## Upload sanity

- [ ] Upload a photo via the system image picker → appears in Timeline within 30 seconds.

---

**When to run:** after every upstream rebase, before merging the rebase to main. Log any bugs with repro steps in a new issue tagged `rebase-regression`.
```

**Step 2: Run prettier.**

```bash
cd docs && pnpm exec prettier --write upstream-reports/rebase-mobile-smoke-checklist.md
```

**Step 3: Commit.**

```bash
git add docs/upstream-reports/rebase-mobile-smoke-checklist.md
git commit -m "docs: rebase mobile smoke checklist"
```

---

## Phase G — Final validation

### Task G1: Fresh full CI run

**Files:** none

**Step 1: Push the branch.**

```bash
git push origin rebase/upstream
```

**Step 2: Dispatch the four rebase workflows.**

Per `feedback_rebase_test_branch_no_pr_ci`, rebase branches don't auto-trigger PR-event CI — dispatch manually:

```bash
for wf in test.yml docker.yml static_analysis.yml gallery-rebase-smoke.yml; do
  gh workflow run "$wf" --ref rebase/upstream
done
```

**Step 3: Wait for all four to go green.**

```bash
gh run list --branch rebase/upstream --limit 10
# When all show "completed success", proceed. If any red, fix at root and re-dispatch.
```

**Step 4: Nothing to commit — this is the verification step.**

---

### Task G2: Update PR description with measurement data

**Files:** the PR (when opened)

**Step 1: Open a PR for this work or augment the existing rebase PR.**

If the smoke suite is part of the rebase PR, add a "Rebase smoke measurements" section with:

- Deliverable 1 canary local median (from Task A4) and CI wall-clock.
- Deliverable 2 detail-panel test local median.
- Deliverable 3 rebase-smoke project full-run wall-clock (from Task D13 and CI).

**Step 2: No commits; PR metadata only.**

---

### Task G3: Follow-up — update push-rebase skill

**Files:**

- Modify: `/home/pierre/.claude/skills/push-rebase/SKILL.md`

**Step 1: This task lives in a SEPARATE PR that lands AFTER the smoke-suite PR merges** (so the SKILL can reference a workflow file that already exists on main).

Open a second worktree or switch back to main, then edit `push-rebase/SKILL.md` to insert a new step between the existing "Verify completeness" (step 4) and "Force-push" (step 5):

````markdown
### 4.5 Dispatch rebase-branch CI and wait green

PR-event CI does not auto-trigger on rebase branches (per `feedback_rebase_test_branch_no_pr_ci`). Dispatch manually and block the force-push on green:

\```bash
for wf in test.yml docker.yml static_analysis.yml gallery-rebase-smoke.yml; do
gh workflow run "$wf" --ref <rebase-branch>
done

# Wait for all four to go green.

gh run list --branch <rebase-branch> --limit 10
\```

If anything is red, fix at root. Never force-push on a red workflow.
````

**Step 2: Renumber subsequent steps.**

**Step 3: Commit in its own PR.**

```bash
git add ~/.claude/skills/push-rebase/SKILL.md   # or the skill's actual location
git commit -m "skills: push-rebase dispatches rebase-smoke workflow before force-push"
```

---

## Done checklist

When all phases are complete, the repo should have:

- [ ] `web/src/lib/components/layouts/user-page-layout.svelte` with `data-testid="page-header"`
- [ ] `web/src/lib/components/BreadcrumbActionPage.svelte` with `data-testid="admin-page-header"`
- [ ] `web/src/lib/components/asset-viewer/detail-panel.svelte` + sub-components with 5 new testids
- [ ] `web/src/lib/components/shared-components/map/map.svelte` with `data-testid="map-marker"`
- [ ] `e2e/src/specs/web/rebase-smoke-pages.e2e-spec.ts` (18 serial canary tests)
- [ ] `e2e/src/specs/web/asset-viewer/detail-panel.e2e-spec.ts` extended with full-layout test
- [ ] `e2e/playwright.config.ts` with new `rebase-smoke` project
- [ ] `e2e/src/specs/rebase-smoke/permission-matrix.e2e-spec.ts` (10 tests)
- [ ] `Makefile` with `e2e-rebase-smoke` target
- [ ] `.github/workflows/gallery-rebase-smoke.yml`
- [ ] `docs/upstream-reports/rebase-mobile-smoke-checklist.md`
- [ ] Measured runtimes recorded in PR description
- [ ] All four CI workflows green on `rebase/upstream`
- [ ] Follow-up PR queued to update `push-rebase` skill after merge
