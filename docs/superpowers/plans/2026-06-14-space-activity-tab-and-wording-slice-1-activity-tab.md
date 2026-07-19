# Space Activity Tab Split — Slice 1 — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development. Steps use checkbox (`- [ ]`).

**Goal:** Move the "Recent Activity" feed out of the Members page into its own **Activity** space tab (`/spaces/:spaceId/activity`), placed after Members. Members keeps only the member list (+ per-member contribution counts).

**Architecture:** New SvelteKit route reusing the existing `SpaceActivityFeed`; a new tab entry in `space-tabs.svelte`; remove the feed + its load/state from the Members page. No backend/API change. Spec: `docs/superpowers/specs/2026-06-14-space-activity-tab-and-wording-design.md` §4.

**Tech Stack:** SvelteKit (Svelte 5 runes), Vitest + @testing-library/svelte. Run from `web/`.

## Conventions

- TDD per behavior (RED → GREEN). Prettier-format + `eslint` every touched file before committing (web lint = `eslint .`, no `--max-warnings`; only errors block). `pnpm run check:svelte` for the route. Targeted runs: `pnpm vitest run "<file>"`.
- `data.space` is provided by the `[spaceId]` layout load and merged into page `data`, so the new page reads it without re-fetching.

## File structure

- **Create** `web/src/routes/(user)/spaces/[spaceId]/activity/+page.ts`
- **Create** `web/src/routes/(user)/spaces/[spaceId]/activity/+page.svelte`
- **Create** `web/src/routes/(user)/spaces/[spaceId]/activity/space-activity-page.spec.ts`
- **Modify** `web/src/lib/components/spaces/space-tabs.svelte` (add Activity tab)
- **Modify** `web/src/lib/components/spaces/space-tabs.spec.ts` (Activity tab test)
- **Modify** `web/src/routes/(user)/spaces/[spaceId]/members/+page.ts` (drop activity load)
- **Modify** `web/src/routes/(user)/spaces/[spaceId]/members/+page.svelte` (remove feed + activity state/handlers/imports)
- **Modify** `web/src/routes/(user)/spaces/[spaceId]/members/space-members-page.spec.ts` (remove activity tests; assert feed absent)

---

## Task 1: Add the Activity tab

**Files:** Modify `web/src/lib/components/spaces/space-tabs.svelte`; Test `web/src/lib/components/spaces/space-tabs.spec.ts`.

- [ ] **Step 1: Write the failing test** — append to `space-tabs.spec.ts` (mirror the existing Members-tab test's render setup):

```ts
it('renders an Activity tab linking to the activity route', () => {
  renderTabs(); // use the file's existing render helper / pattern
  const activity = screen.getByTestId('space-tab-activity');
  expect(activity).toHaveAttribute('href', '/spaces/space-1/activity');
});

it('marks the Activity tab active on the activity route', () => {
  renderTabs({ pathname: '/spaces/space-1/activity' }); // match how other tests set the active path
  expect(screen.getByTestId('space-tab-activity')).toHaveAttribute('aria-current', 'page');
});
```

(Match the spec file's actual render helper + how it stubs `page.url.pathname` — read the existing Members/People tab tests and mirror them exactly, including the spaceId used, e.g. `space-1`.)

- [ ] **Step 2: Run RED** — `cd web && pnpm vitest run src/lib/components/spaces/space-tabs.spec.ts -t "Activity tab"` → FAIL (no `space-tab-activity`).

- [ ] **Step 3: Implement** — in `space-tabs.svelte`, add this entry to the `tabs` array immediately **after** the `members` entry (before the closing `] as (Tab | undefined)[]`):

```ts
        {
          key: 'activity',
          label: $t('spaces_activity'),
          href: `${base}/activity`,
          active: path.startsWith(`${base}/activity`),
        },
```

(No badge, no role gating. The render block already produces `data-testid="space-tab-activity"` from `tab.key`.)

- [ ] **Step 4: Run GREEN** — same command → PASS. Run the whole file too: `pnpm vitest run src/lib/components/spaces/space-tabs.spec.ts` → all PASS.

- [ ] **Step 5: Commit**

```bash
git add web/src/lib/components/spaces/space-tabs.svelte web/src/lib/components/spaces/space-tabs.spec.ts
git commit -m "feat(web): add Activity tab to space tabs (slice 1)"
```

---

## Task 2: Create the Activity route

**Files:** Create `activity/+page.ts`, `activity/+page.svelte`, `activity/space-activity-page.spec.ts`.

- [ ] **Step 1: Write the failing page test** — `web/src/routes/(user)/spaces/[spaceId]/activity/space-activity-page.spec.ts`. Mirror the activity tests currently in `members/space-members-page.spec.ts` (read them for the `sdkMock`/render pattern). Cover: (a) renders the feed from `data.activities`; (b) load-more calls `getSpaceActivities` with the advanced offset and appends.

```ts
import '@testing-library/jest-dom';
import { render, screen } from '@testing-library/svelte';
import { init, register, waitLocale } from 'svelte-i18n';
import { sdkMock } from '$lib/__mocks__/sdk.mock';
import TestWrapper from '$lib/components/TestWrapper.svelte';
import SpaceActivityPage from './+page.svelte';
// ... (match the members spec's exact imports + any component mocks it uses)

// Use the same minimal SharedSpaceResponseDto + activity fixtures as the members spec.
```

Concretely assert:

- With `data.activities = [<one activity>]`, the feed renders (e.g. `screen.getByTestId('space-activity')` is present and the activity's description text shows).
- Calling the page's load-more (trigger via the `SpaceActivityFeed`'s onLoadMore, or by exposing the same flow the members spec used) calls `sdkMock.getSpaceActivities` with `offset` = initial length, and appends the returned rows.

> Read `members/space-members-page.spec.ts` first and copy its activity-feed render + load-more test verbatim, retargeting to `SpaceActivityPage` and `data: { space, activities, hasMoreActivities }`.

- [ ] **Step 2: Run RED** — `cd web && pnpm vitest run "src/routes/(user)/spaces/[spaceId]/activity/space-activity-page.spec.ts"` → FAIL (module `./+page.svelte` not found).

- [ ] **Step 3: Implement `+page.ts`**:

```ts
import { getSpaceActivities } from '@immich/sdk';
import { authenticate } from '$lib/utils/auth';
import type { PageLoad } from './$types';

const ACTIVITY_PAGE_SIZE = 20;

export const load = (async ({ url, params, parent }) => {
  await authenticate(url);
  const { space } = await parent();
  const activities = await getSpaceActivities({ id: params.spaceId, limit: ACTIVITY_PAGE_SIZE, offset: 0 });
  return {
    activities,
    hasMoreActivities: activities.length === ACTIVITY_PAGE_SIZE,
    meta: { title: `${space.name} - Activity` },
  };
}) satisfies PageLoad;
```

- [ ] **Step 4: Implement `+page.svelte`**:

```svelte
<script lang="ts">
  import SpaceActivityFeed from '$lib/components/spaces/space-activity-feed.svelte';
  import { getSpaceActivities } from '@immich/sdk';
  import { t } from 'svelte-i18n';
  import type { PageData } from './$types';

  const ACTIVITY_PAGE_SIZE = 20;

  let { data }: { data: PageData } = $props();
  const space = $derived(data.space);

  let activities = $state(data.activities);
  let hasMoreActivities = $state(data.hasMoreActivities);
  let activityOffset = $state(data.activities.length);

  async function loadMoreActivities() {
    const result = await getSpaceActivities({ id: space.id, limit: ACTIVITY_PAGE_SIZE, offset: activityOffset });
    activities = [...activities, ...result];
    activityOffset += result.length;
    hasMoreActivities = result.length === ACTIVITY_PAGE_SIZE;
  }
</script>

<div class="mx-auto w-full max-w-3xl p-4">
  <h2 class="mb-3 text-base font-semibold">{$t('spaces_recent_activity')}</h2>
  <div data-testid="space-activity">
    <SpaceActivityFeed
      {activities}
      spaceColor={space.color ?? 'primary'}
      onLoadMore={loadMoreActivities}
      hasMore={hasMoreActivities}
    />
  </div>
</div>
```

- [ ] **Step 5: Run GREEN** — the spec from Step 1 passes. `pnpm run check:svelte` clean for the new route.

- [ ] **Step 6: Commit**

```bash
git add "web/src/routes/(user)/spaces/[spaceId]/activity"
git commit -m "feat(web): in-space Activity tab route with the recent-activity feed (slice 1)"
```

---

## Task 3: Slim the Members page

**Files:** Modify `members/+page.ts` and `members/+page.svelte`; update `members/space-members-page.spec.ts`.

- [ ] **Step 1: Update the Members spec FIRST (TDD)** — in `space-members-page.spec.ts`:
  - **Remove** the activity tests (the "renders the recent-activity feed" / load-more tests — they now live in the activity spec).
  - **Add** an assertion that the Members page no longer renders the feed:
    ```ts
    it('does not render the activity feed (moved to the Activity tab)', () => {
      renderPage(); // existing helper
      expect(screen.queryByTestId('members-activity')).not.toBeInTheDocument();
    });
    ```
  - If `renderPage`/the data fixture supplies `activities`/`hasMoreActivities`, leave them (harmless) or drop them — but ensure the remaining member-list tests still pass.

- [ ] **Step 2: Run RED** — `cd web && pnpm vitest run "src/routes/(user)/spaces/[spaceId]/members/space-members-page.spec.ts" -t "does not render the activity feed"` → FAIL (feed still present).

- [ ] **Step 3: Implement — `members/+page.ts`** (drop the activity load):

```ts
import { authenticate } from '$lib/utils/auth';
import type { PageLoad } from './$types';

export const load = (async ({ url, parent }) => {
  await authenticate(url);
  const { space } = await parent();
  return { meta: { title: `${space.name} - Members` } };
}) satisfies PageLoad;
```

- [ ] **Step 4: Implement — `members/+page.svelte`** (remove all activity bits, keep the member list):
  - Delete imports: `SpaceActivityFeed` (line ~5) and `getSpaceActivities` from the `@immich/sdk` import (line ~12).
  - Delete `const ACTIVITY_PAGE_SIZE = 20;` (line ~24).
  - Delete the activity state (lines ~32-34: `activities`, `hasMoreActivities`, `activityOffset`).
  - Delete `loadMoreActivities()` (lines ~80-85).
  - Delete the activity markup block (lines ~146-154: the `<h3>spaces_recent_activity</h3>` + `<div data-testid="members-activity">…SpaceActivityFeed…</div>`).
  - Keep everything else (member list, role change, add-member, contribution counts).

- [ ] **Step 5: Run GREEN** — `pnpm vitest run "src/routes/(user)/spaces/[spaceId]/members/space-members-page.spec.ts"` → all PASS (member-list tests intact, feed-absent test passes). `pnpm run check:svelte` clean (no unused imports/vars in members page).

- [ ] **Step 6: Commit**

```bash
git add "web/src/routes/(user)/spaces/[spaceId]/members"
git commit -m "refactor(web): remove recent-activity feed from Members page (moved to Activity tab) (slice 1)"
```

---

## Slice 1 completion gate

- [ ] `cd web && pnpm run check:svelte` → 0 errors/0 warnings.
- [ ] `pnpm vitest run src/lib/components/spaces/space-tabs.spec.ts "src/routes/(user)/spaces/[spaceId]/activity/space-activity-page.spec.ts" "src/routes/(user)/spaces/[spaceId]/members/space-members-page.spec.ts"` → all PASS.
- [ ] `eslint` clean + prettier-formatted on every touched/created file.
- [ ] Push (no merge).

## Edge-case coverage map (spec §4.4 → test/behavior)

| Spec edge                                          | Covered by                                                              |
| -------------------------------------------------- | ----------------------------------------------------------------------- |
| Activity tab visible to all members (no gating)    | Task 1 (no `faceRecognitionEnabled`/role guard on the entry) + tab test |
| Active highlight on `/activity`                    | Task 1 active test                                                      |
| Empty activity → feed's existing empty state       | unchanged `SpaceActivityFeed` (no code change)                          |
| Load-more pagination on the new page               | Task 2 load-more test                                                   |
| Deep-link/refresh `/spaces/:id/activity`           | Task 2 `+page.ts` load (runs on direct nav)                             |
| Members page has no feed + no `getSpaceActivities` | Task 3 feed-absent test + slimmed `+page.ts` (no activity fetch)        |
| Tab order: …, Members, Activity                    | Task 1 (entry placed after Members)                                     |
