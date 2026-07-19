# Space Albums — UI Journey & Permission Matrix Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add one Playwright web e2e spec that walks the real space-albums navigation chain by **clicking** (never `goto` to a deep URL), per role (Owner/Editor/Viewer/Stranger), proving each member reaches the album's photos and the stranger is blocked at every depth.

**Architecture:** A single self-contained spec with one shared `beforeAll` fixture (space + linked album + 2 assets + four users), a handful of in-file funnel helpers (each performs one hop and asserts its result), and one test per role. Members walk hops 1→9 (sidebar → `/spaces` → space → Albums tab → album card → photo, plus control gating); the stranger asserts the space is absent from its list and is blocked at all four deep URLs.

**Tech Stack:** Playwright (`@playwright/test`), the e2e `utils`/`createUserDto` harness, `@immich/sdk` DTOs/enums. Test-only — **no production code changes**.

**Design spec:** `docs/superpowers/specs/2026-06-19-space-albums-ui-journey-matrix-design.md`

---

## Nature of these tests (read first)

These are **acceptance/characterization tests of behavior that already ships** (the feature is built; the spec confirms no production changes). The usual TDD red→green inversion does **not** apply: each test is expected to **PASS** against a working app. **A failing test is a discovered defect** — most likely the navigation-wiring / permission bug the spec was written to catch. When a step says "Expected: PASS" and it fails, do **not** patch the test to make it green; triage whether the UI is actually broken, report it, and fix the product (separate change) before moving on.

## Prerequisites

- A running stack built from **this branch's** source (it must include the space-albums feature + the Albums tab). Point Playwright at whichever local port serves that build. **In this environment that was the `make e2e` stack on `:2285`** (`immich-e2e-server`, v3, DB on `:5435`) — NOT `:2283`, which was an unrelated `make dev` stack from another worktree running an older fork version (2.7.5) without these UI changes. Confirm the port with `curl -s http://127.0.0.1:<port>/api/server/version` and check it is the v3 build before running.
- The fixture calls `utils.resetDatabase()`, so the target must be a disposable e2e database, **not** a stack with data you care about.
- Run from the repo root. Single-spec run command (used in every task):

  ```bash
  cd e2e && PLAYWRIGHT_BASE_URL=http://127.0.0.1:2285 PLAYWRIGHT_DISABLE_WEBSERVER=1 \
    pnpm exec playwright test --project=web spaces-albums-journey
  ```

  `spaces-albums-journey` is a filename substring filter; `PLAYWRIGHT_DISABLE_WEBSERVER=1` reuses the already-running stack. If the running image is stale, rebuild it first (`make e2e` rebuilds the e2e stack image from current source).

## File structure

- **Create:** `e2e/src/specs/web/spaces-albums-journey.e2e-spec.ts` — the entire spec (fixture + helpers + four role tests). One file, one responsibility: the role × journey matrix.

No other files are created or modified.

---

## Task 1: Scaffold the spec — fixture, helpers, and the Owner journey

**Files:**

- Create: `e2e/src/specs/web/spaces-albums-journey.e2e-spec.ts`

- [ ] **Step 1: Write the spec scaffold (imports, fixture, helpers, owner test)**

Create `e2e/src/specs/web/spaces-albums-journey.e2e-spec.ts` with exactly:

```ts
import {
  AlbumResponseDto,
  AlbumUserRole,
  AssetMediaResponseDto,
  LoginResponseDto,
  SharedSpaceResponseDto,
  SharedSpaceRole,
} from '@immich/sdk';
import { expect, test, type Page } from '@playwright/test';
import { createUserDto } from 'src/fixtures';
import { utils } from 'src/utils';

// Web E2E: the space-albums navigation JOURNEY, asserted by CLICKING the real
// nav chain (never page.goto to a deep URL), per role. Rows = Owner/Editor/
// Viewer/Stranger; columns = sidebar Spaces link -> /spaces list -> space ->
// Albums tab -> album card -> photo, plus per-role control gating.
//
// Gating for editor/viewer also lives in spaces-albums.e2e-spec.ts and
// permission-matrix.e2e-spec.ts; it is re-asserted here so this spec is the
// self-contained source of truth for the matrix.
//
// These tests characterize EXISTING behavior — they should PASS against a
// working app. A failure is a discovered wiring/permission defect to triage.

const ALBUM_NAME = 'Journey Linked Album';

test.describe('Spaces — Albums UI journey & permission matrix', () => {
  let admin: LoginResponseDto;
  let owner: LoginResponseDto;
  let editor: LoginResponseDto;
  let viewer: LoginResponseDto;
  let stranger: LoginResponseDto;
  let space: SharedSpaceResponseDto;
  let album: AlbumResponseDto;
  let asset!: AssetMediaResponseDto;
  let asset2!: AssetMediaResponseDto;

  test.beforeAll(async () => {
    utils.initSdk();
    await utils.resetDatabase();
    admin = await utils.adminSetup();

    [owner, editor, viewer, stranger] = await Promise.all([
      utils.userSetup(admin.accessToken, createUserDto.create('journey-owner')),
      utils.userSetup(admin.accessToken, createUserDto.create('journey-editor')),
      utils.userSetup(admin.accessToken, createUserDto.create('journey-viewer')),
      utils.userSetup(admin.accessToken, createUserDto.create('journey-stranger')),
    ]);

    // Space owned by `owner`; editor + viewer are members; stranger is NOT.
    space = await utils.createSpace(owner.accessToken, { name: 'Journey Test Space' });
    await utils.addSpaceMember(owner.accessToken, space.id, { userId: editor.userId, role: SharedSpaceRole.Editor });
    await utils.addSpaceMember(owner.accessToken, space.id, { userId: viewer.userId, role: SharedSpaceRole.Viewer });

    // Two assets owned by `owner` so the album is non-empty.
    [asset, asset2] = await Promise.all([utils.createAsset(owner.accessToken), utils.createAsset(owner.accessToken)]);

    // Album owned by `owner`, with `editor` as album Editor (mirrors the
    // spaces-albums fixture), both assets attached, then linked into the space.
    // NOTE: `viewer` has NO album_user share — so a viewer reaching the album
    // and its photos proves access flows purely through the space grant.
    album = await utils.createAlbum(owner.accessToken, {
      albumName: ALBUM_NAME,
      albumUsers: [{ userId: editor.userId, role: AlbumUserRole.Editor }],
      assetIds: [asset.id, asset2.id],
    });
    await utils.linkSpaceAlbum(owner.accessToken, space.id, album.id);
  });

  // ─── Funnel helpers — each performs ONE hop and asserts the result ─────────

  // Hop 1: click the left-nav Spaces link (the established spaces-sidebar
  // pattern — page.locator('nav').getByRole('link', { name: 'Spaces' })) and
  // land on /spaces. No data-testid: @immich/ui NavbarItem doesn't forward one.
  async function gotoSpacesList(page: Page) {
    await page.locator('nav').getByRole('link', { name: 'Spaces' }).click();
    await page.waitForURL('/spaces');
  }

  // Hops 2–3: the space is listed for this member; click it -> space detail.
  // Scoped to <main> (UserPageLayout) so the sidebar recent-spaces link cannot
  // match. The href anchor is view-agnostic: both the default card grid and the
  // table view render an <a href="/spaces/:id">.
  async function openSpaceFromList(page: Page, spaceId: string) {
    const link = page.locator('main').locator(`a[href$="/spaces/${spaceId}"]`).first();
    await expect(link).toBeVisible();
    await link.click();
    await page.waitForURL(`/spaces/${spaceId}`);
  }

  // Hop 4: click the Albums tab.
  async function openAlbumsTab(page: Page, spaceId: string) {
    await page.getByTestId('space-tab-albums').click();
    await page.waitForURL(`/spaces/${spaceId}/albums`);
  }

  // Hop 6: click the linked album's card -> album detail.
  async function openAlbumCard(page: Page, spaceId: string, name: string) {
    await page.getByTestId('space-album-card-link').filter({ hasText: name }).click();
    await page.waitForURL(new RegExp(`/spaces/${spaceId}/albums/[^/]+$`));
  }

  // Hop 7: the known asset thumbnail renders; click it -> asset viewer.
  async function openPhoto(page: Page, assetId: string) {
    const thumb = page.locator(`[data-thumbnail-focus-container][data-asset="${assetId}"]`);
    await expect(thumb).toBeVisible();
    await thumb.click();
    await page.waitForURL(new RegExp(`/photos/${assetId}$`));
    await page.waitForSelector('#immich-asset-viewer');
    await expect(page.locator('#immich-asset-viewer')).toBeVisible();
  }

  // Stranger: assert a deep URL is blocked (403 ∨ redirect ∨ blocked text).
  // SvelteKit serves a 200 shell and renders the error client-side, so a 403
  // status may not surface; the disjunction matches permission-matrix Test 7.
  async function expectBlockedAt(page: Page, url: string) {
    const response = await page.goto(url);
    await page.waitForLoadState('networkidle');
    const is403 = response?.status() === 403;
    const redirectedAway = !page.url().includes(url);
    const blockedText = await page
      .locator('text=/access denied|not found|no access|not a member|http 403/i')
      .first()
      .isVisible()
      .catch(() => false);
    expect(is403 || redirectedAway || blockedText).toBeTruthy();
  }

  // ─── Member journeys (positive funnel + gating) ────────────────────────────

  test('owner walks sidebar → space → album → photo and sees manage controls', async ({ context, page }) => {
    await utils.setAuthCookies(context, owner.accessToken);
    await page.goto('/photos');

    await gotoSpacesList(page); // hop 1
    await openSpaceFromList(page, space.id); // hops 2–3
    // hero-role-badge renders the RAW enum ('owner') with CSS `capitalize`,
    // which does NOT change textContent — so match case-insensitively.
    await expect(page.locator('[data-testid="hero-role-badge"]')).toContainText('owner', { ignoreCase: true });

    await openAlbumsTab(page, space.id); // hop 4
    // hop 5: linked album card present.
    await expect(page.getByTestId('space-album-card-link').filter({ hasText: ALBUM_NAME })).toBeVisible();
    // hop 8: owner gating @ grid — link button + card ⋮ menu. The menu is
    // rendered only when canManage but is opacity-0 until hover; assert it is
    // ATTACHED (present in the DOM) — the precise intent ("the control exists
    // for this role") and unambiguous vs. the opacity-0 visibility edge.
    await expect(page.getByTestId('link-album-button')).toBeVisible();
    await expect(page.getByTestId('space-album-card-menu')).toBeAttached();

    await openAlbumCard(page, space.id, ALBUM_NAME); // hop 6
    // hop 9: owner gating @ detail — add-photos button present.
    await expect(page.getByTestId('add-photos-button')).toBeVisible();

    await openPhoto(page, asset.id); // hop 7
  });
});
```

- [ ] **Step 2: Run the owner test — expect PASS**

Run (dev stack must be up on :2283):

```bash
cd e2e && PLAYWRIGHT_BASE_URL=http://127.0.0.1:2285 PLAYWRIGHT_DISABLE_WEBSERVER=1 \
  pnpm exec playwright test --project=web spaces-albums-journey
```

Expected: `1 passed`. If it FAILS, triage per "Nature of these tests" — a failure at hop 1 means the sidebar link is mis-wired, at hop 4 the Albums tab, etc. Capture which hop failed before changing anything.

- [ ] **Step 3: Commit**

```bash
git add e2e/src/specs/web/spaces-albums-journey.e2e-spec.ts
git commit -m "test(e2e): space-albums UI journey — owner click-through + manage gating"
```

---

## Task 2: Editor journey

**Files:**

- Modify: `e2e/src/specs/web/spaces-albums-journey.e2e-spec.ts` (add one test before the closing `});` of the describe block)

- [ ] **Step 1: Add the editor journey test**

Insert this test immediately after the owner test (still inside the `describe`):

```ts
test('editor walks the journey and sees manage controls', async ({ context, page }) => {
  await utils.setAuthCookies(context, editor.accessToken);
  await page.goto('/photos');

  await gotoSpacesList(page); // hop 1
  await openSpaceFromList(page, space.id); // hops 2–3
  await expect(page.locator('[data-testid="hero-role-badge"]')).toContainText('editor', { ignoreCase: true });

  await openAlbumsTab(page, space.id); // hop 4
  await expect(page.getByTestId('space-album-card-link').filter({ hasText: ALBUM_NAME })).toBeVisible(); // hop 5
  // hop 8: editor gating @ grid (space Editor role → canManage). Card menu is
  // opacity-0 until hover, so assert ATTACHED (present), not visible.
  await expect(page.getByTestId('link-album-button')).toBeVisible();
  await expect(page.getByTestId('space-album-card-menu')).toBeAttached();

  await openAlbumCard(page, space.id, ALBUM_NAME); // hop 6
  await expect(page.getByTestId('add-photos-button')).toBeVisible(); // hop 9

  await openPhoto(page, asset.id); // hop 7
});
```

- [ ] **Step 2: Run the editor test — expect PASS**

```bash
cd e2e && PLAYWRIGHT_BASE_URL=http://127.0.0.1:2285 PLAYWRIGHT_DISABLE_WEBSERVER=1 \
  pnpm exec playwright test --project=web spaces-albums-journey -g "editor walks"
```

Expected: `1 passed` (`-g` filters by title).

- [ ] **Step 3: Commit**

```bash
git add e2e/src/specs/web/spaces-albums-journey.e2e-spec.ts
git commit -m "test(e2e): space-albums UI journey — editor click-through + manage gating"
```

---

## Task 3: Viewer journey (reaches photos via space grant; NO manage controls)

**Files:**

- Modify: `e2e/src/specs/web/spaces-albums-journey.e2e-spec.ts` (add one test inside the describe block)

- [ ] **Step 1: Add the viewer journey test**

Insert after the editor test:

```ts
test('viewer walks the journey, reaches photos via the space grant, sees NO manage controls', async ({
  context,
  page,
}) => {
  await utils.setAuthCookies(context, viewer.accessToken);
  await page.goto('/photos');

  await gotoSpacesList(page); // hop 1
  await openSpaceFromList(page, space.id); // hops 2–3
  await expect(page.locator('[data-testid="hero-role-badge"]')).toContainText('viewer', { ignoreCase: true });

  await openAlbumsTab(page, space.id); // hop 4
  // hop 5: viewer SEES the album (read access via the space grant; viewer has
  // no album_user share).
  await expect(page.getByTestId('space-album-card-link').filter({ hasText: ALBUM_NAME })).toBeVisible();
  // hop 8: viewer gating @ grid — link button + card menu NOT rendered (canManage=false).
  await expect(page.getByTestId('link-album-button')).toHaveCount(0);
  await expect(page.getByTestId('space-album-card-menu')).toHaveCount(0);

  await openAlbumCard(page, space.id, ALBUM_NAME); // hop 6
  // hop 9: viewer gating @ detail — add-photos button NOT rendered.
  await expect(page.getByTestId('add-photos-button')).toHaveCount(0);

  await openPhoto(page, asset.id); // hop 7 — proves photo access via the space grant
});
```

- [ ] **Step 2: Run the viewer test — expect PASS**

```bash
cd e2e && PLAYWRIGHT_BASE_URL=http://127.0.0.1:2285 PLAYWRIGHT_DISABLE_WEBSERVER=1 \
  pnpm exec playwright test --project=web spaces-albums-journey -g "viewer walks"
```

Expected: `1 passed`. A failure at hop 7 (viewer can't open the photo) is the highest-value catch — it means the space-grant read path is broken in the UI. A failure on the `toHaveCount(0)` gating means a manage control leaked to a read-only viewer.

- [ ] **Step 3: Commit**

```bash
git add e2e/src/specs/web/spaces-albums-journey.e2e-spec.ts
git commit -m "test(e2e): space-albums UI journey — viewer space-grant read access + no-manage gating"
```

---

## Task 4: Stranger (non-member) — absent from list, blocked at all depths

**Files:**

- Modify: `e2e/src/specs/web/spaces-albums-journey.e2e-spec.ts` (add one test inside the describe block)

- [ ] **Step 1: Add the stranger test**

Insert after the viewer test (last test before the describe's closing `});`):

```ts
test('stranger does not see the space and is blocked at every space-albums depth', async ({ context, page }) => {
  await utils.setAuthCookies(context, stranger.accessToken);

  // The space must NOT appear in the stranger's /spaces list.
  await page.goto('/spaces');
  await expect(page.locator('main').locator(`a[href$="/spaces/${space.id}"]`)).toHaveCount(0);

  // All four depths are blocked — the [spaceId] layout load returns 403 for
  // non-members before any child route renders.
  await expectBlockedAt(page, `/spaces/${space.id}`);
  await expectBlockedAt(page, `/spaces/${space.id}/albums`);
  await expectBlockedAt(page, `/spaces/${space.id}/albums/${album.id}`);
  await expectBlockedAt(page, `/spaces/${space.id}/albums/${album.id}/photos/${asset.id}`);
});
```

- [ ] **Step 2: Run the stranger test — expect PASS**

```bash
cd e2e && PLAYWRIGHT_BASE_URL=http://127.0.0.1:2285 PLAYWRIGHT_DISABLE_WEBSERVER=1 \
  pnpm exec playwright test --project=web spaces-albums-journey -g "stranger"
```

Expected: `1 passed`. A failure here is a **security** finding: a non-member reached a space/album/photo route. Capture which depth leaked.

- [ ] **Step 3: Commit**

```bash
git add e2e/src/specs/web/spaces-albums-journey.e2e-spec.ts
git commit -m "test(e2e): space-albums UI journey — stranger absent from list + blocked at all depths"
```

---

## Task 5: Full-spec run, type check, format

**Files:**

- Possibly modify: `e2e/src/specs/web/spaces-albums-journey.e2e-spec.ts` (formatting only)

- [ ] **Step 1: Run the whole spec (all four tests)**

```bash
cd e2e && PLAYWRIGHT_BASE_URL=http://127.0.0.1:2285 PLAYWRIGHT_DISABLE_WEBSERVER=1 \
  pnpm exec playwright test --project=web spaces-albums-journey
```

Expected: `4 passed`.

- [ ] **Step 2: Type-check the e2e package**

```bash
cd e2e && pnpm check
```

Expected: no errors (exit 0). `check` is `tsc --noEmit`.

- [ ] **Step 3: Format the new file**

```bash
cd e2e && pnpm exec prettier --write src/specs/web/spaces-albums-journey.e2e-spec.ts
```

Expected: file unchanged or reformatted. (CI runs `prettier --check`, so this must be clean.)

- [ ] **Step 4: Commit any formatting changes**

```bash
git add e2e/src/specs/web/spaces-albums-journey.e2e-spec.ts
git commit -m "style(e2e): prettier-format space-albums journey spec" || echo "nothing to format"
```

---

## Notes & fallbacks

- **Sidebar viewport.** The funnel relies on the desktop sidebar. The `web` project uses `devices['Desktop Chrome']` (1280×720), so the sidebar is expanded and the Spaces link is present — no viewport override needed.
- **Card-menu presence.** `space-album-card-menu` is rendered only `{#if canManage}` and is `opacity-0` until hover. Managers assert `.toBeAttached()` (present in the DOM — opacity is irrelevant to attachment); the viewer asserts `.toHaveCount(0)` (not rendered). If you ever need to assert it is interactively reachable, hover the card first (`page.getByTestId('space-album-card').hover()`) then `.toBeVisible()`.
- **No queue drain.** `utils.createAsset` produces an asset whose timeline focus-container renders without thumbnail generation (same as the existing `spaces-albums.e2e-spec.ts` photo-viewer tests). If hop 7 flakes on a slow machine, add `await utils.waitForQueueFinish(admin.accessToken, 'thumbnailGeneration');` to `beforeAll`.
- **Role-badge text (case).** `hero-role-badge` (space-hero.svelte:186) renders `{currentRole}` = the raw `SharedSpaceRole` enum, which is lowercase (`server/src/enum.ts:73` → `'owner'`/`'editor'`/`'viewer'`). The visible capitalization is CSS `capitalize`, which does not affect `textContent`. Assert with `{ ignoreCase: true }`. NOTE: `permission-matrix.e2e-spec.ts` uses case-sensitive `toContainText('Owner')` against this same badge — likely a latent failure in that smoke suite; out of scope here but worth a separate look.
