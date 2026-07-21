# Recently Added — Slice 1: Header item count — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Show a live "N items" count in the Recently Added page header, sourced from `TimelineManager.assetCount`, hidden while the library is empty/loading.

**Architecture:** The visibility decision is extracted into a pure, unit-tested function in a new `web/src/lib/utils/recently-added-filter-options.ts` module (which later slices extend with the timeline-options and suggestion-request builders). The route is thin glue: it derives the count from the already-bound `timelineManager` and passes the formatted label to `UserPageLayout`'s existing `description` prop. No new i18n keys, no server/API change, no changes to `Timeline` / `UserPageLayout` / the Photos page.

**Tech Stack:** SvelteKit + Svelte 5 runes, TypeScript (strict), `svelte-i18n` (`$t` + ICU plural), Vitest (web unit tests), Playwright (`e2e/` web suite).

## Global Constraints

Copied verbatim from the spec (`docs/superpowers/specs/2026-07-19-recently-added-filters-design.md`) — these apply to every task:

- **Scope:** Web only. No server / API / mobile changes.
- **Do not modify** the Photos page or the shared `filter-panel` / `Timeline` / `UserPageLayout` components.
- Recently Added is an **own + partner** surface, **never shared spaces** (Slice 1 changes no data path, but do not introduce one).
- Recently Added stays ordered/day-grouped by **added** date — the existing `orderBy: AssetOrderBy.CreatedAt` in `options` must remain untouched.
- No i18n additions: reuse the existing `items_count` key — `"{count, plural, one {# item} other {# items}}"` (`i18n/en.json:1760`).
- The `AssetSelectControlBar` block in the route stays unchanged.
- Code style: Prettier (120 char, single quotes, trailing commas, semicolons); no relative imports in web — use the `$lib/` alias.
- ESLint: **no new errors**. Web's `pnpm lint` does not pass `--max-warnings 0`, and ~640 pre-existing Tailwind warnings are expected — do not halt on them (see the command reference below).

## Task order and why

Tasks run **unit test → e2e test (red) → implementation (green)**. The e2e spec is written _before_ the route change so its red state is genuine: at Task 2 the route genuinely lacks the feature, so the count scenarios genuinely fail. Do not reorder.

---

## File Structure

| File                                                                                 | Status              | Responsibility                                                                                                                                                                              |
| ------------------------------------------------------------------------------------ | ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `web/src/lib/utils/recently-added-filter-options.ts`                                 | **Create** (Task 1) | Pure decision/builder functions for the Recently Added view. This slice adds only `shouldShowRecentlyAddedCount`.                                                                           |
| `web/src/lib/utils/__tests__/recently-added-filter-options.spec.ts`                  | **Create** (Task 1) | Unit tests for the above. (`__tests__/` is the established location for the filter-options/filter-config spec family — see `album-filter-config.spec.ts`, `photos-filter-options.spec.ts`.) |
| `e2e/src/specs/web/recently-added-filters.e2e-spec.ts`                               | **Create** (Task 2) | BDD acceptance scenarios for the header count. Extended in Slices 2–3.                                                                                                                      |
| `web/src/routes/(user)/recently-added/[[photos=photos]]/[[assetId=id]]/+page.svelte` | **Modify** (Task 3) | Derive the count, format the label, pass `description=` to `UserPageLayout`.                                                                                                                |

## Reference: commands used in this slice

Web unit tests (`web/package.json` has `"test": "vitest"` — watch by default, so `--run` is required):

```bash
cd web && pnpm test -- --run src/lib/utils/__tests__/recently-added-filter-options.spec.ts
```

E2E web suite. **Do not use `:2283`** — see the trap below.

**Preferred — the dedicated e2e stack** (Playwright's own defaults; no env vars, no hacks). It serves the built web app on `:2285` and runs Postgres on `5435`, which is the port `utils.resetDatabase()` hardcodes:

```bash
cd e2e && docker compose up --build -d          # once, if not already up
cd e2e && pnpm exec playwright test --project=web src/specs/web/recently-added-filters.e2e-spec.ts
```

**Fallback — against a running `mise dev` stack**, which needs two corrections:

```bash
socat TCP-LISTEN:5435,fork,reuseaddr TCP:127.0.0.1:5432 &   # resetDatabase() hardcodes 5435; dev Postgres is on 5432
cd e2e && PLAYWRIGHT_BASE_URL=http://127.0.0.1:3000 PLAYWRIGHT_DISABLE_WEBSERVER=1 \
  pnpm exec playwright test --project=web src/specs/web/recently-added-filters.e2e-spec.ts
kill %1                                                      # tear the forward down afterwards
```

**Trap (verified 2026-07-19, pre-existing repo bug):** the `make e2e-web-dev` target and CLAUDE.md both point web Playwright projects at `PLAYWRIGHT_BASE_URL=http://127.0.0.1:2283`. Against a `mise dev` stack that URL returns **HTTP 200 with a 0-byte body** for every page route — the dev `immich_server` container has no `/build/www`, so its SSR fallback silently serves empty HTML. Tests then fail with "element not found" for reasons that have nothing to do with the code. The dev stack's real web app is the Vite container on **`:3000`**. (`make e2e-web-dev` also runs the entire web suite and accepts no arguments.)

Note: `cd web && pnpm lint` is `eslint . --concurrency 6` — it does **not** auto-fix and does **not** pass `--max-warnings 0`. ~640 pre-existing Tailwind warnings are expected; judge it on **errors only**. Prettier is a **separate CI gate** from ESLint, so always run `prettier --check` on touched files too.

---

## Task 1: `shouldShowRecentlyAddedCount` pure function

**Files:**

- Create: `web/src/lib/utils/recently-added-filter-options.ts`
- Test: `web/src/lib/utils/__tests__/recently-added-filter-options.spec.ts`

**Interfaces:**

- Consumes: nothing (first task, new module).
- Produces: `export function shouldShowRecentlyAddedCount(count: number, hasActiveFilters: boolean): boolean` — imported by the route in Task 3, and reused unchanged by Slice 2 (which starts passing a real `hasActiveFilters`).

**Why the `hasActiveFilters` arm exists in Slice 1:** the route always passes `false` this slice, but the function is written and tested complete so Slice 2 needs no change to it. Do **not** simplify it to a one-arg function.

- [ ] **Step 1: Write the failing test**

Create `web/src/lib/utils/__tests__/recently-added-filter-options.spec.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { shouldShowRecentlyAddedCount } from '$lib/utils/recently-added-filter-options';

describe('shouldShowRecentlyAddedCount', () => {
  it('hides the count while loading or for an empty account', () => {
    // No buckets loaded yet (assetCount is transiently 0) and no filters: showing
    // "0 items" would flash a wrong count. The EmptyPlaceholder communicates emptiness.
    expect(shouldShowRecentlyAddedCount(0, false)).toBe(false);
  });

  it('shows "0 items" when a filter matched nothing', () => {
    // Informative: tells the user their filter matched nothing, rather than
    // looking like an empty account.
    expect(shouldShowRecentlyAddedCount(0, true)).toBe(true);
  });

  it('shows the count for a populated view without filters', () => {
    expect(shouldShowRecentlyAddedCount(5, false)).toBe(true);
  });

  it('shows the count for a populated filtered view', () => {
    expect(shouldShowRecentlyAddedCount(5, true)).toBe(true);
  });

  it('shows the count at the singular boundary (plural wording is left to i18n)', () => {
    expect(shouldShowRecentlyAddedCount(1, false)).toBe(true);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
cd web && pnpm test -- --run src/lib/utils/__tests__/recently-added-filter-options.spec.ts
```

Expected: **FAIL** — the module does not exist, so the import fails. Vitest reports a resolution error such as `Failed to resolve import "$lib/utils/recently-added-filter-options"`. Do not proceed until you have seen a real failure; paste the output into your report.

- [ ] **Step 3: Write the minimal implementation**

Create `web/src/lib/utils/recently-added-filter-options.ts`:

```ts
/**
 * Whether the Recently Added header should display an item count.
 *
 * Hidden only when there is nothing to show *and* no filter is active: that state is either
 * "buckets have not loaded yet" or "empty account", and both are better served by the
 * EmptyPlaceholder than by a transient "0 items". With a filter active, "0 items" is
 * informative — it says the filter matched nothing.
 */
export function shouldShowRecentlyAddedCount(count: number, hasActiveFilters: boolean): boolean {
  return count > 0 || hasActiveFilters;
}
```

- [ ] **Step 4: Run the test to verify it passes**

```bash
cd web && pnpm test -- --run src/lib/utils/__tests__/recently-added-filter-options.spec.ts
```

Expected: **PASS** — 5 passed. Paste the output into your report.

- [ ] **Step 5: Refactor**

None expected — the function is a single expression. Do not add abstraction.

- [ ] **Step 6: Commit**

```bash
git add web/src/lib/utils/recently-added-filter-options.ts web/src/lib/utils/__tests__/recently-added-filter-options.spec.ts
git commit -m "test(web): shouldShowRecentlyAddedCount for the Recently Added header count (#805)"
```

---

## Task 2: BDD acceptance scenarios (Playwright e2e), written red-first

**Files:**

- Create: `e2e/src/specs/web/recently-added-filters.e2e-spec.ts`

**Interfaces:**

- Consumes: the page header markup rendered by `UserPageLayout` — the count will appear at `[data-testid="page-header-description"]` and the title at `[data-testid="page-header"]` (`web/src/lib/components/layouts/UserPageLayout.svelte:86-93` and `:82`). Neither the count nor the route change exists yet — that is the point of this task.
- Produces: the spec file that Slices 2 and 3 append their scenarios to. Keep the outer `test.describe` name generic (`Recently Added`) so later slices nest their own describes inside it.

**Context the implementer needs:**

- Template to mirror: `e2e/src/specs/web/photos-filter-panel.e2e-spec.ts`.
- Helpers, all from `e2e/src/utils.ts`: `utils.initSdk()`, `utils.resetDatabase()`, `utils.adminSetup()` → `LoginResponseDto`, `utils.userSetup(accessToken, dto)` → `LoginResponseDto` (creates **and** logs in; `UserAdminCreateDto` requires exactly `email` / `name` / `password`), `utils.createAsset(accessToken, dto)`, `utils.setAuthCookies(context, accessToken)`.
- A per-spec `resetDatabase()` in `beforeAll` is the established pattern and is safe: the `web` Playwright project runs `workers: 1` (`e2e/playwright.config.ts`), so it cannot race other web specs.
- The empty-library scenario uses a **second user that owns no assets**. Non-admin `userSetup` → `setAuthCookies` → `goto` has precedent in `global-search.e2e-spec.ts:527`, so expect no onboarding redirect.
- **Multi-select selector** — the timeline exposes a data attribute, _not_ a testid. There is no `asset-container` testid anywhere in `web/src`. Use the shared helper `thumbnailUtils` from `src/ui/specs/timeline/utils` (`thumbnailUtils.locator(page)` → `page.locator('[data-thumbnail-focus-container]')`), and **hover first** — the checkbox overlay only renders on hover. Pattern lifted from `e2e/src/specs/web/timeline-add-to-collection.e2e-spec.ts:26-38`.
- The count fills in as timeline buckets load — always assert with Playwright's auto-retrying `expect(locator).toHaveText(...)` / `.toHaveCount(...)`, never a bare `textContent()` read.

- [ ] **Step 1: Write the e2e spec**

Create `e2e/src/specs/web/recently-added-filters.e2e-spec.ts`:

```ts
import type { LoginResponseDto } from '@immich/sdk';
import { expect, test } from '@playwright/test';
import { thumbnailUtils } from 'src/ui/specs/timeline/utils';
import { utils } from 'src/utils';

test.describe('Recently Added', () => {
  let admin: LoginResponseDto;
  let emptyUser: LoginResponseDto;

  const ASSET_COUNT = 12;

  test.beforeAll(async () => {
    utils.initSdk();
    await utils.resetDatabase();
    admin = await utils.adminSetup();

    // Seed a populated library for the admin: 12 assets on distinct days.
    for (let i = 0; i < ASSET_COUNT; i++) {
      const day = String(i + 1).padStart(2, '0');
      await utils.createAsset(admin.accessToken, {
        fileCreatedAt: `2023-08-${day}T10:00:00.000Z`,
        fileModifiedAt: `2023-08-${day}T10:00:00.000Z`,
      });
    }

    // A second user with an empty library, for the empty-state scenario.
    emptyUser = await utils.userSetup(admin.accessToken, {
      email: 'recently-added-empty@immich.cloud',
      name: 'Empty Library',
      password: 'password',
    });
  });

  // Scenario: Count shown for a populated library
  test('shows the item count in the header for a populated library', async ({ context, page }) => {
    await utils.setAuthCookies(context, admin.accessToken);
    await page.goto('/recently-added');

    await expect(page.getByTestId('page-header-description')).toHaveText(`${ASSET_COUNT} items`);
  });

  // Scenario: Count hidden for an empty library
  test('hides the item count and shows the placeholder for an empty library', async ({ context, page }) => {
    await utils.setAuthCookies(context, emptyUser.accessToken);
    await page.goto('/recently-added');

    // The empty-state placeholder confirms the timeline finished loading with no assets.
    // Copy comes from i18n/en.json `no_assets_message`.
    await expect(page.getByText('Click to upload your first photo')).toBeVisible();
    await expect(page.getByTestId('page-header-description')).toHaveCount(0);
  });

  // Scenario: Count is not shown while selecting
  test('replaces the header with the selection bar during multi-select', async ({ context, page }) => {
    await utils.setAuthCookies(context, admin.accessToken);
    await page.goto('/recently-added');
    await expect(page.getByTestId('page-header-description')).toHaveText(`${ASSET_COUNT} items`);

    // Enter multi-select: hover a thumbnail so its checkbox overlay renders, then click it.
    const thumb = thumbnailUtils.locator(page).first();
    await expect(thumb).toBeVisible();
    await thumb.hover();
    await thumb.locator('button[role="checkbox"]').click();

    // `hideNavbar` collapses the entire header row (title + count); the selection bar takes over.
    await expect(page.getByTestId('page-header-description')).toHaveCount(0);
    await expect(page.getByTestId('page-header')).toHaveCount(0);
  });
});
```

- [ ] **Step 2: Run the spec and verify it is RED**

```bash
cd e2e && pnpm exec playwright test --project=web src/specs/web/recently-added-filters.e2e-spec.ts
```

(Run it exactly as documented in the command reference near the top of this plan — **not** against `:2283`.)

Expected: **2 failed, 1 passed.**

- "populated library" → **FAIL**: `page-header-description` resolves to 0 elements; the route does not pass `description` yet.
- "during multi-select" → **FAIL** at its first assertion, for the same reason.
- "empty library" → **PASS** even now, because it asserts _absence_. That is expected and correct; it becomes a real regression guard once Task 3 lands.

Paste the failure output into your report. If instead all three pass, stop — something is wrong (most likely a stale web stack; see the traps below).

Two known traps in this repo:

- The e2e stack (`immich-e2e` project, `immich-server:latest`) is **machine-wide**; a concurrent session can restart it or swap the image underneath you. If results look impossible, confirm the stack is yours and current before debugging the test.
- `reuseExistingServer` can attach to a **stale** web stack. A "UI is broken" symptom is far more often a stale image than a code bug.

- [ ] **Step 3: Commit the red spec**

```bash
cd /Users/pierre/dev/gallery/.claude/worktrees/recently-added-filters-805
git add e2e/src/specs/web/recently-added-filters.e2e-spec.ts
git commit -m "test(e2e): acceptance scenarios for the Recently Added item count (#805)"
```

---

## Task 3: Wire the count into the Recently Added route (turns Task 2 green)

**Files:**

- Modify: `web/src/routes/(user)/recently-added/[[photos=photos]]/[[assetId=id]]/+page.svelte`

**Interfaces:**

- Consumes: `shouldShowRecentlyAddedCount(count: number, hasActiveFilters: boolean): boolean` from Task 1; `TimelineManager.assetCount` (a `$derived.by` live grand total summed from bucket counts — `web/src/lib/managers/timeline-manager/timeline-manager.svelte.ts:95`); `UserPageLayout`'s existing `description?: string | undefined` prop (`web/src/lib/components/layouts/UserPageLayout.svelte:18`), rendered at lines 86–93 with `data-testid="page-header-description"`.
- Produces: the rendered count, asserted by the Task 2 e2e scenarios.

**Context the implementer needs:**

- `timelineManager` is already declared and bound in this route:
  `let timelineManager = $state<TimelineManager>() as TimelineManager;` with `bind:timelineManager` on `<Timeline>`. It is **undefined until the first bind**, so the derivation must use optional chaining + `?? 0`. This is exactly what the Photos page does (`web/src/routes/(user)/photos/[[assetId=id]]/+page.svelte:350`: `const totalAssetCount = $derived(timelineManager?.assetCount ?? 0);`) on the identical `as TimelineManager` cast — the optional chain is correct and triggers no lint or type error here.
- The header row only renders when `!hideNavbar && (title || buttons)` (`UserPageLayout.svelte:77`). This route already passes `hideNavbar={assetMultiSelectManager.selectionActive}` and `title={data.meta.title}`, so the count **automatically** disappears during multi-select. Do not add extra gating for that.
- `$t` is already imported in this file (`import { t } from 'svelte-i18n';`, line 37). `$t('items_count', { values: { count } })` is the repo-standard call shape (12 existing call sites, e.g. `AlbumCard.svelte:79`).
- The existing `const options = { ... }` object (lines 47–52) and the whole `AssetSelectControlBar` block must remain **byte-identical**.

- [ ] **Step 1: Add the import**

In the `<script lang="ts">` block, add the import alongside the other `$lib/utils/` imports (`prettier-plugin-organize-imports` settles final ordering — run the formatter in Step 4):

```ts
import { shouldShowRecentlyAddedCount } from '$lib/utils/recently-added-filter-options';
```

- [ ] **Step 2: Add the derivations**

Immediately after the existing `const options = { ... };` block, add:

```ts
const assetCount = $derived(timelineManager?.assetCount ?? 0);
// Slice 1 has no filters yet, so `hasActiveFilters` is always false here; Slice 2 replaces
// the literal with `getActiveFilterCount(filters) > 0`.
const countLabel = $derived(
  shouldShowRecentlyAddedCount(assetCount, false) ? $t('items_count', { values: { count: assetCount } }) : undefined,
);
```

- [ ] **Step 3: Pass the label to the layout**

Change the opening `UserPageLayout` tag (line 92) from:

```svelte
<UserPageLayout hideNavbar={assetMultiSelectManager.selectionActive} title={data.meta.title} scrollbar={false}>
```

to:

```svelte
<UserPageLayout
  hideNavbar={assetMultiSelectManager.selectionActive}
  title={data.meta.title}
  description={countLabel}
  scrollbar={false}
>
```

- [ ] **Step 4: Verify the e2e spec is now GREEN**

```bash
cd e2e && pnpm exec playwright test --project=web src/specs/web/recently-added-filters.e2e-spec.ts
```

(Run it exactly as documented in the command reference near the top of this plan — **not** against `:2283`.)
Expected: **3 passed** (the two that failed in Task 2 Step 2 now pass). Paste the output into your report.

Note: the web dev stack serves the route from source, so no rebuild is needed between the red and green runs.

- [ ] **Step 5: Run the web gate**

```bash
cd web && pnpm check:typescript && pnpm check:svelte && pnpm lint && pnpm test -- --run
```

Expected: type check clean, svelte-check clean, ESLint reports **no errors** (pre-existing Tailwind warnings are fine), all unit tests pass including Task 1's 5.

Then the separate Prettier gate:

```bash
cd web && pnpm exec prettier --check "src/routes/(user)/recently-added/**/*.svelte" "src/lib/utils/recently-added-filter-options.ts" "src/lib/utils/__tests__/recently-added-filter-options.spec.ts"
cd ../e2e && pnpm exec prettier --check src/specs/web/recently-added-filters.e2e-spec.ts
```

Expected: all report as formatted. If not, rerun with `--write` and re-check.

- [ ] **Step 6: Commit**

```bash
git add "web/src/routes/(user)/recently-added/[[photos=photos]]/[[assetId=id]]/+page.svelte"
git commit -m "feat(web): item count in Recently Added header (#805)"
```

---

## Slice 1 Done Gate

All of the following must hold before the slice is complete:

- [ ] `cd web && pnpm check:typescript` — clean
- [ ] `cd web && pnpm check:svelte` — clean
- [ ] `cd web && pnpm lint` — no **errors**
- [ ] `cd web && pnpm test -- --run` — all pass, including the 5 new unit tests
- [ ] `cd e2e && pnpm exec playwright test --project=web src/specs/web/recently-added-filters.e2e-spec.ts` (see command reference for stack setup) — **3 passed**
- [ ] Prettier `--check` clean on all touched files (separate CI gate from ESLint)
- [ ] Recorded red→green evidence: Task 1 Step 2 (red) / Step 4 (green); Task 2 Step 2 (2 failed, 1 passed) → Task 3 Step 4 (3 passed)
- [ ] The Photos page, `filter-panel/`, `Timeline`, and `UserPageLayout` are **unmodified** — verify with `git diff --stat main...HEAD`
- [ ] The route's `options` object and `AssetSelectControlBar` block are unchanged — verify with `git diff` on the route
- [ ] Three commits made as specified above

## Coverage check against the spec

| Spec edge case (§Slice 1)                                                | Covered by                                                                                    |
| ------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------- |
| Buckets not yet loaded (`assetCount` 0 transiently) → no "0 items" flash | Task 1 unit `shouldShowRecentlyAddedCount(0, false) === false`                                |
| Empty account → count hidden, placeholder shown                          | Task 1 unit + Task 2 e2e "empty library"                                                      |
| Multi-select active (`hideNavbar`) → header + count hidden               | Task 2 e2e "during multi-select"                                                              |
| Plural vs singular ("1 item")                                            | `items_count` ICU plural (i18n, not this code); boundary case `(1, false)` asserted in Task 1 |
| Count shown for a populated library                                      | Task 2 e2e "populated library"                                                                |
| `hasActiveFilters` arm (unused this slice, needed by Slice 2)            | Task 1 units `(0, true)` and `(5, true)`                                                      |
