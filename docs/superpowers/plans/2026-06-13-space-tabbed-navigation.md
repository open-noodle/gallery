# Space Tabbed Navigation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the space detail view's scattered icon/pill chrome with one shared shell — a labeled tab bar (`Photos · People · Albums · Map · Members`) over a button-free cover — implemented as a SvelteKit layout under `(user)/spaces/[spaceId]/`.

**Architecture:** A new `+layout.ts` loads `space`, `members`, and `linkedAlbums` once; a new `+layout.svelte` renders the single `UserPageLayout` app bar (back · ＋Add photos · ⋮ overflow), the cover (`SpaceHero`), and the always-visible `SpaceTabs`, then `{@render children()}`. Child routes (Photos / People / Albums / Members) render content only. A small runes manager (`space-ui-manager`) carries cross-route intents (the layout's ＋Add photos / Change cover trigger the Photos page's selection modes) and a `chromeHidden`/`coverCollapsed` flag. The cover collapses on Timeline scroll via a new optional `onScroll` callback on `Timeline.svelte`.

**Tech Stack:** SvelteKit, Svelte 5 runes, TypeScript, `@immich/sdk`, `@immich/ui`, Vitest + @testing-library/svelte (web unit), Playwright (e2e web), svelte-i18n.

**Reference spec:** `docs/superpowers/specs/2026-06-13-space-tabbed-navigation-design.md` — read it before starting.

**Conventions:**

- All web unit tests run from `web/`: `pnpm test -- --run <path>` (one file) — vitest.
- Type/lint gate: `cd web && pnpm check:typescript && pnpm check:svelte` (svelte-check + tsc) from the repo root. Defer the full `pnpm lint` to the final task.
- e2e web specs live in `e2e/src/specs/web/`; run via `make e2e-web-dev` against a running `make dev` stack, or a single spec from `e2e/` with `pnpm exec playwright test src/specs/web/<file> --project=web`.
- No relative server imports rule does not apply to web; web uses `$lib/...` aliases.
- Prettier on any touched markdown before committing.

---

## File structure

**New files**

- `web/src/lib/managers/space-ui-manager.svelte.ts` — cross-route intent + `chromeHidden` + `coverCollapsed` state (singleton).
- `web/src/lib/managers/space-ui-manager.svelte.spec.ts` — its unit test.
- `web/src/lib/components/spaces/space-tabs.svelte` — the labeled tab bar.
- `web/src/lib/components/spaces/space-tabs.spec.ts` — its unit test.
- `web/src/routes/(user)/spaces/[spaceId]/+layout.ts` — shared load (space + members + linkedAlbums).
- `web/src/routes/(user)/spaces/[spaceId]/+layout.svelte` — the shell (app bar + cover + tabs + children).
- `web/src/routes/(user)/spaces/[spaceId]/members/+page.ts` — Members tab load (activities).
- `web/src/routes/(user)/spaces/[spaceId]/members/+page.svelte` — Members tab (ported from `space-panel`).
- `web/src/routes/(user)/spaces/[spaceId]/members/space-members-page.spec.ts` — its unit test.

**Modified files**

- `web/src/lib/components/timeline/Timeline.svelte` — add optional `onScroll` prop.
- `web/src/routes/(user)/spaces/[spaceId]/[[photos=photos]]/[[assetId=id]]/+page.ts` — drop space/members fetch (use parent).
- `web/src/routes/(user)/spaces/[spaceId]/[[photos=photos]]/[[assetId=id]]/+page.svelte` — remove app-bar chrome, hero, people strip, panel, moved handlers; add intent consumer + chromeHidden + Timeline `onScroll`.
- `web/src/routes/(user)/spaces/[spaceId]/people/+page.ts` and `.../albums/+page.ts` — drop space/members fetch (use parent); Albums drops `getSharedSpaceAlbums` (use parent `linkedAlbums`).
- `web/src/routes/(user)/spaces/[spaceId]/people/+page.svelte` and `.../albums/+page.svelte` — remove `UserPageLayout`; relocate their toolbars into a content-area header.
- `web/src/lib/components/spaces/space-hero.svelte` — remove pill row + collapse chevron + dropped props; add hover ✎; tall/compact + scroll-collapse.
- `web/src/routes/(user)/spaces/[spaceId]/[[photos=photos]]/[[assetId=id]]/spaces-page.spec.ts`, `.../people/space-people-page.spec.ts`, `.../albums/space-albums-page.spec.ts`, `web/src/lib/components/spaces/space-hero.spec.ts` — updated for the new structure.
- `i18n/en.json` — new keys for previously-hardcoded strings.
- `e2e/src/specs/web/spaces-p1.e2e-spec.ts` (and siblings) — extended coverage.

**Deleted files**

- `web/src/lib/components/spaces/space-panel.svelte` + `space-panel.spec.ts`.
- `web/src/lib/components/spaces/space-people-strip.svelte` + `space-people-strip.spec.ts`.

---

## Task 1: `space-ui-manager` (cross-route intent + chrome flags)

**Files:**

- Create: `web/src/lib/managers/space-ui-manager.svelte.ts`
- Test: `web/src/lib/managers/space-ui-manager.svelte.spec.ts`

- [ ] **Step 1: Write the failing test**

Create `web/src/lib/managers/space-ui-manager.svelte.spec.ts`:

```ts
import { beforeEach, describe, expect, it } from 'vitest';
import { spaceUiManager } from './space-ui-manager.svelte';

describe('spaceUiManager', () => {
  beforeEach(() => {
    spaceUiManager.reset();
  });

  it('starts with no intent and visible chrome', () => {
    expect(spaceUiManager.intent).toBeNull();
    expect(spaceUiManager.chromeHidden).toBe(false);
    expect(spaceUiManager.coverCollapsed).toBe(false);
  });

  it('records an add-photos intent and clears it on consume', () => {
    spaceUiManager.requestAddPhotos();
    expect(spaceUiManager.intent).toBe('add-assets');
    expect(spaceUiManager.consumeIntent()).toBe('add-assets');
    expect(spaceUiManager.intent).toBeNull();
  });

  it('records a change-cover intent and clears it on consume', () => {
    spaceUiManager.requestChangeCover();
    expect(spaceUiManager.intent).toBe('set-cover');
    expect(spaceUiManager.consumeIntent()).toBe('set-cover');
    expect(spaceUiManager.intent).toBeNull();
  });

  it('consume is idempotent — a second consume returns null', () => {
    spaceUiManager.requestAddPhotos();
    spaceUiManager.consumeIntent();
    expect(spaceUiManager.consumeIntent()).toBeNull();
  });

  it('toggles chromeHidden and coverCollapsed', () => {
    spaceUiManager.setChromeHidden(true);
    spaceUiManager.setCoverCollapsed(true);
    expect(spaceUiManager.chromeHidden).toBe(true);
    expect(spaceUiManager.coverCollapsed).toBe(true);
  });

  it('reset() clears all state', () => {
    spaceUiManager.requestAddPhotos();
    spaceUiManager.setChromeHidden(true);
    spaceUiManager.setCoverCollapsed(true);
    spaceUiManager.reset();
    expect(spaceUiManager.intent).toBeNull();
    expect(spaceUiManager.chromeHidden).toBe(false);
    expect(spaceUiManager.coverCollapsed).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run (from `web/`): `pnpm test -- --run src/lib/managers/space-ui-manager.svelte.spec.ts`
Expected: FAIL — cannot resolve `./space-ui-manager.svelte`.

- [ ] **Step 3: Write the implementation**

Create `web/src/lib/managers/space-ui-manager.svelte.ts`:

```ts
export type SpaceIntent = 'add-assets' | 'set-cover' | null;

/**
 * Cross-route UI state for the space shell.
 *
 * The shell layout (app bar) lives above the per-tab content, but two actions —
 * "Add photos" and "Change cover" — are fulfilled by the Photos page's selection
 * modes. The layout records an intent here and navigates to the Photos route; the
 * Photos page consumes it on mount (and reactively while already mounted), then it
 * is cleared so a later manual visit does not re-enter a selection mode.
 *
 * `chromeHidden` lets the Photos page hide the shell app bar + cover + tabs while a
 * full-screen selection mode is active. `coverCollapsed` is driven by Timeline scroll.
 */
class SpaceUiManager {
  intent = $state<SpaceIntent>(null);
  chromeHidden = $state(false);
  coverCollapsed = $state(false);

  requestAddPhotos() {
    this.intent = 'add-assets';
  }

  requestChangeCover() {
    this.intent = 'set-cover';
  }

  consumeIntent(): SpaceIntent {
    const intent = this.intent;
    this.intent = null;
    return intent;
  }

  setChromeHidden(value: boolean) {
    this.chromeHidden = value;
  }

  setCoverCollapsed(value: boolean) {
    this.coverCollapsed = value;
  }

  reset() {
    this.intent = null;
    this.chromeHidden = false;
    this.coverCollapsed = false;
  }
}

export const spaceUiManager = new SpaceUiManager();
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm test -- --run src/lib/managers/space-ui-manager.svelte.spec.ts`
Expected: PASS (6 tests).

- [ ] **Step 5: Commit**

```bash
git add web/src/lib/managers/space-ui-manager.svelte.ts web/src/lib/managers/space-ui-manager.svelte.spec.ts
git commit -m "feat(web): add space-ui-manager for space shell cross-route intents"
```

---

## Task 2: `SpaceTabs` component

**Files:**

- Create: `web/src/lib/components/spaces/space-tabs.svelte`
- Test: `web/src/lib/components/spaces/space-tabs.spec.ts`

Active-tab detection uses `page.url.pathname`. The tab strip is a `<nav>` of links with `aria-current="page"` on the active one (correct ARIA for route-based navigation — not a `tablist`, which is for in-page panel switching). The Map entry is a plain external link (never "current"). Badges render only when `> 0`.

- [ ] **Step 1: Write the failing test**

Create `web/src/lib/components/spaces/space-tabs.spec.ts`:

```ts
import '@testing-library/jest-dom';
import { render, screen } from '@testing-library/svelte';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import SpaceTabs from './space-tabs.svelte';

const mockPage = vi.hoisted(() => ({ url: new URL('https://gallery.test/spaces/s1') }));
vi.mock('$app/state', () => ({ page: mockPage }));

const base = { spaceId: 's1', photoCount: 35, albumCount: 4, memberCount: 3 };

describe('SpaceTabs', () => {
  beforeEach(() => {
    mockPage.url = new URL('https://gallery.test/spaces/s1');
  });

  it('renders Photos, Albums, Map, Members but hides People when face recognition is off', () => {
    render(SpaceTabs, { ...base, faceRecognitionEnabled: false });
    expect(screen.getByTestId('space-tab-photos')).toBeInTheDocument();
    expect(screen.getByTestId('space-tab-albums')).toBeInTheDocument();
    expect(screen.getByTestId('space-tab-map')).toBeInTheDocument();
    expect(screen.getByTestId('space-tab-members')).toBeInTheDocument();
    expect(screen.queryByTestId('space-tab-people')).not.toBeInTheDocument();
  });

  it('shows the People tab when face recognition is on', () => {
    render(SpaceTabs, { ...base, faceRecognitionEnabled: true });
    expect(screen.getByTestId('space-tab-people')).toBeInTheDocument();
  });

  it('renders count badges only when greater than zero', () => {
    render(SpaceTabs, { spaceId: 's1', photoCount: 35, albumCount: 0, memberCount: 1 });
    expect(screen.getByTestId('space-tab-photos')).toHaveTextContent('35');
    // albumCount 0 → no badge text
    expect(screen.getByTestId('space-tab-albums')).not.toHaveTextContent('0');
  });

  it('marks Photos active on the index route', () => {
    mockPage.url = new URL('https://gallery.test/spaces/s1');
    render(SpaceTabs, base);
    expect(screen.getByTestId('space-tab-photos')).toHaveAttribute('aria-current', 'page');
    expect(screen.getByTestId('space-tab-members')).not.toHaveAttribute('aria-current');
  });

  it('marks Members active on the members route', () => {
    mockPage.url = new URL('https://gallery.test/spaces/s1/members');
    render(SpaceTabs, base);
    expect(screen.getByTestId('space-tab-members')).toHaveAttribute('aria-current', 'page');
    expect(screen.getByTestId('space-tab-photos')).not.toHaveAttribute('aria-current');
  });

  it('points the Map tab at the filtered global map and never marks it current', () => {
    mockPage.url = new URL('https://gallery.test/spaces/s1');
    render(SpaceTabs, base);
    const map = screen.getByTestId('space-tab-map');
    expect(map).toHaveAttribute('href', '/map?spaceId=s1');
    expect(map).not.toHaveAttribute('aria-current');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test -- --run src/lib/components/spaces/space-tabs.spec.ts`
Expected: FAIL — cannot resolve `./space-tabs.svelte`.

- [ ] **Step 3: Write the implementation**

Create `web/src/lib/components/spaces/space-tabs.svelte`:

```svelte
<script lang="ts">
  import { page } from '$app/state';
  import { QueryParameter } from '$lib/constants';
  import { t } from 'svelte-i18n';

  interface Props {
    spaceId: string;
    faceRecognitionEnabled?: boolean;
    photoCount?: number;
    albumCount?: number;
    memberCount?: number;
  }

  let {
    spaceId,
    faceRecognitionEnabled = false,
    photoCount = 0,
    albumCount = 0,
    memberCount = 0,
  }: Props = $props();

  const base = $derived(`/spaces/${spaceId}`);
  const path = $derived(page.url.pathname);

  interface Tab {
    key: string;
    label: string;
    href: string;
    badge?: number;
    external?: boolean;
    active: boolean;
  }

  // Photos owns the index + the optional `/photos[/assetId]` segment.
  const photosActive = $derived(path === base || path.startsWith(`${base}/photos`));

  const tabs = $derived<Tab[]>(
    [
      { key: 'photos', label: $t('photos'), href: base, badge: photoCount, active: photosActive },
      faceRecognitionEnabled
        ? {
            key: 'people',
            label: $t('people'),
            href: `${base}/people`,
            active: path.startsWith(`${base}/people`),
          }
        : undefined,
      {
        key: 'albums',
        label: $t('albums'),
        href: `${base}/albums`,
        badge: albumCount,
        active: path.startsWith(`${base}/albums`),
      },
      {
        key: 'map',
        label: $t('map'),
        href: `/map?${QueryParameter.SPACE_ID}=${spaceId}`,
        external: true,
        active: false,
      },
      {
        key: 'members',
        label: $t('members'),
        href: `${base}/members`,
        badge: memberCount,
        active: path.startsWith(`${base}/members`),
      },
    ].filter((tab): tab is Tab => tab !== undefined),
  );
</script>

<nav
  class="flex gap-1 overflow-x-auto border-b border-gray-200 px-4 dark:border-gray-800"
  aria-label={$t('spaces')}
  data-testid="space-tabs"
>
  {#each tabs as tab (tab.key)}
    <a
      href={tab.href}
      data-testid="space-tab-{tab.key}"
      data-sveltekit-preload-data={tab.external ? 'off' : undefined}
      aria-current={tab.active ? 'page' : undefined}
      class="flex shrink-0 items-center gap-1.5 border-b-2 px-3 py-3 text-sm font-medium transition-colors
        {tab.active
        ? 'border-primary text-primary'
        : 'border-transparent text-gray-500 hover:text-gray-800 dark:text-gray-400 dark:hover:text-gray-100'}"
    >
      {tab.label}
      {#if tab.badge && tab.badge > 0}
        <span class="rounded-full bg-gray-200 px-1.5 py-0.5 text-xs text-gray-600 dark:bg-gray-700 dark:text-gray-300">
          {tab.badge}
        </span>
      {/if}
    </a>
  {/each}
</nav>
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm test -- --run src/lib/components/spaces/space-tabs.spec.ts`
Expected: PASS (6 tests). If `$t('spaces')` is missing it still renders (svelte-i18n returns the key); the `aria-label` value is not asserted.

- [ ] **Step 5: Commit**

```bash
git add web/src/lib/components/spaces/space-tabs.svelte web/src/lib/components/spaces/space-tabs.spec.ts
git commit -m "feat(web): add SpaceTabs labeled navigation component"
```

---

## Task 3: Add `onScroll` callback to `Timeline`

**Files:**

- Modify: `web/src/lib/components/timeline/Timeline.svelte` (Props interface ~lines 41-80; scroller `onscroll` handler ~line 727)

The Timeline owns its `#asset-grid` scroller and already has an inline `onscroll`. Add an optional `onScroll?: (scrollTop: number) => void` prop and invoke it from that handler. No behavior change when the prop is absent.

- [ ] **Step 1: Write the failing test**

Create `web/src/lib/components/timeline/timeline-onscroll.spec.ts`:

```ts
import '@testing-library/jest-dom';
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

// Lightweight structural test: the Timeline must expose an `onScroll` prop and
// invoke it from its scroll handler. A full virtualized render is impractical in
// jsdom, so we assert the wiring is present in source. The real scroll→collapse
// behavior is covered by the Photos e2e (Task 13).
const source = readFileSync(fileURLToPath(new URL('./Timeline.svelte', import.meta.url)), 'utf8');

describe('Timeline onScroll prop', () => {
  it('declares an optional onScroll prop', () => {
    expect(source).toMatch(/onScroll\?:\s*\(scrollTop:\s*number\)\s*=>\s*void/);
  });

  it('invokes onScroll from the scroll handler with the scroller scrollTop', () => {
    expect(source).toMatch(/onScroll\?\.\(\s*scrollableElement[?.]*\.scrollTop[^)]*\)/);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test -- --run src/lib/components/timeline/timeline-onscroll.spec.ts`
Expected: FAIL — neither pattern is present yet.

- [ ] **Step 3: Implement — add the prop**

In `web/src/lib/components/timeline/Timeline.svelte`, add to the `Props` interface (next to the other optional callbacks like `onEscape`):

```ts
    onScroll?: (scrollTop: number) => void;
```

Add `onScroll` to the `$props()` destructuring alongside the other handlers (e.g. after `onEscape`):

```ts
    onEscape,
    onScroll,
```

- [ ] **Step 4: Implement — invoke it from the scroll handler**

The scroller currently reads (verbatim, ~line 719-728):

```svelte
<section
  id="asset-grid"
  class={['scrollbar-hidden h-full overflow-y-auto outline-none', ...]}
  bind:this={scrollableElement}
  bind:clientHeight={timelineManager.viewportHeight}
  bind:clientWidth={timelineManager.viewportWidth}
  onscroll={() => (handleTimelineScroll(), timelineManager.updateSlidingWindow(), updateIsScrolling())}
>
```

Change the `onscroll` expression to also invoke the callback:

```svelte
  onscroll={() => (
    handleTimelineScroll(),
    timelineManager.updateSlidingWindow(),
    updateIsScrolling(),
    onScroll?.(scrollableElement?.scrollTop ?? 0)
  )}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `pnpm test -- --run src/lib/components/timeline/timeline-onscroll.spec.ts`
Expected: PASS (2 tests). Then `cd web && pnpm check:typescript && pnpm check:svelte` — expect no type errors.

- [ ] **Step 6: Commit**

```bash
git add web/src/lib/components/timeline/Timeline.svelte web/src/lib/components/timeline/timeline-onscroll.spec.ts
git commit -m "feat(web): add optional onScroll callback to Timeline"
```

---

## Task 4: Shared `+layout.ts` load

**Files:**

- Create: `web/src/routes/(user)/spaces/[spaceId]/+layout.ts`
- Test: `web/src/routes/(user)/spaces/[spaceId]/space-layout-load.spec.ts`

The load authenticates once and fetches `space`, `members`, `linkedAlbums` in parallel — the union of what the three child pages fetch today. Child pages will read these via `await parent()` / merged `data` (Tasks 5-6).

- [ ] **Step 1: Write the failing test**

Create `web/src/routes/(user)/spaces/[spaceId]/space-layout-load.spec.ts`:

```ts
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { sdkMock } from '$lib/__mocks__/sdk.mock';

vi.mock('$lib/utils/auth', () => ({ authenticate: vi.fn().mockResolvedValue(undefined) }));

import { authenticate } from '$lib/utils/auth';
import { load } from './+layout';

describe('space [spaceId] +layout.ts load', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    sdkMock.getSpace.mockResolvedValue({ id: 's1', name: 'Trip' } as never);
    sdkMock.getMembers.mockResolvedValue([{ userId: 'u1', role: 'owner' }] as never);
    sdkMock.getSharedSpaceAlbums.mockResolvedValue([{ albumId: 'a1' }, { albumId: 'a2' }] as never);
  });

  it('authenticates and loads space, members and linked albums', async () => {
    const url = new URL('https://gallery.test/spaces/s1');
    const result = await load({ url, params: { spaceId: 's1' } } as never);

    expect(authenticate).toHaveBeenCalledWith(url);
    expect(sdkMock.getSpace).toHaveBeenCalledWith({ id: 's1' });
    expect(sdkMock.getMembers).toHaveBeenCalledWith({ id: 's1' });
    expect(sdkMock.getSharedSpaceAlbums).toHaveBeenCalledWith({ id: 's1' });
    expect(result.space).toEqual({ id: 's1', name: 'Trip' });
    expect(result.members).toHaveLength(1);
    expect(result.linkedAlbums).toHaveLength(2);
  });

  it('redirects to the spaces list when the space is gone or access was revoked (404/403)', async () => {
    sdkMock.getSpace.mockRejectedValue({ status: 404 });
    const url = new URL('https://gallery.test/spaces/s1');
    await expect(load({ url, params: { spaceId: 's1' } } as never)).rejects.toMatchObject({ status: 302 });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test -- --run "src/routes/(user)/spaces/[spaceId]/space-layout-load.spec.ts"`
Expected: FAIL — cannot resolve `./+layout`.

- [ ] **Step 3: Write the implementation**

Create `web/src/routes/(user)/spaces/[spaceId]/+layout.ts`:

```ts
import { getMembers, getSharedSpaceAlbums, getSpace } from '@immich/sdk';
import { redirect } from '@sveltejs/kit';
import { authenticate } from '$lib/utils/auth';
import { Route } from '$lib/route';
import type { LayoutLoad } from './$types';

export const load = (async ({ url, params }) => {
  await authenticate(url);
  try {
    const [space, members, linkedAlbums] = await Promise.all([
      getSpace({ id: params.spaceId }),
      getMembers({ id: params.spaceId }),
      getSharedSpaceAlbums({ id: params.spaceId }),
    ]);
    return { space, members, linkedAlbums, meta: { title: space.name } };
  } catch (error) {
    // Space deleted or access revoked mid-session → return to the spaces list rather than erroring.
    const status = (error as { status?: number })?.status;
    if (status === 403 || status === 404) {
      redirect(302, Route.spaces());
    }
    throw error;
  }
}) satisfies LayoutLoad;
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm test -- --run "src/routes/(user)/spaces/[spaceId]/space-layout-load.spec.ts"`
Expected: PASS (1 test).

- [ ] **Step 5: Commit**

```bash
git add "web/src/routes/(user)/spaces/[spaceId]/+layout.ts" "web/src/routes/(user)/spaces/[spaceId]/space-layout-load.spec.ts"
git commit -m "feat(web): add shared space [spaceId] layout load (space + members + albums)"
```

---

## Task 5: Slim child loaders to read from parent; add Members load

**Files:**

- Modify: `.../[[photos=photos]]/[[assetId=id]]/+page.ts`, `.../people/+page.ts`, `.../albums/+page.ts`
- Create: `.../members/+page.ts`

Now that the layout loads `space`/`members`/`linkedAlbums`, child loaders stop refetching them. Layout data merges into each page's `data`, so the page components keep reading `data.space` / `data.members` unchanged.

- [ ] **Step 1: Rewrite the Photos `+page.ts`**

Replace `.../[[photos=photos]]/[[assetId=id]]/+page.ts` with:

```ts
import { authenticate } from '$lib/utils/auth';
import type { PageLoad } from './$types';

// space + members come from the parent [spaceId] layout load.
export const load = (async ({ url, parent }) => {
  await authenticate(url);
  await parent();
  return {};
}) satisfies PageLoad;
```

- [ ] **Step 2: Rewrite the People `+page.ts`**

Replace `.../people/+page.ts` with (drops `getSpace`/`getMembers`, keeps people + stats):

```ts
import { getSpacePeople, getSpacePeopleStatistics } from '@immich/sdk';
import { redirect } from '@sveltejs/kit';
import { authenticate } from '$lib/utils/auth';
import type { PageLoad } from './$types';

export const load = (async ({ url, params, parent }) => {
  await authenticate(url);
  const { space } = await parent();
  // The People tab is hidden when face recognition is off; a direct/bookmarked nav redirects to Photos.
  if (!space.faceRecognitionEnabled) {
    redirect(307, `/spaces/${params.spaceId}`);
  }
  const [people, peopleStatistics] = await Promise.all([
    getSpacePeople({ id: params.spaceId, limit: 100 }),
    getSpacePeopleStatistics({ id: params.spaceId }).catch(() => null),
  ]);
  return { people, peopleStatistics };
}) satisfies PageLoad;
```

- [ ] **Step 3: Rewrite the Albums `+page.ts`**

Replace `.../albums/+page.ts` with (albums now come from the parent layout's `linkedAlbums`):

```ts
import { authenticate } from '$lib/utils/auth';
import type { PageLoad } from './$types';

export const load = (async ({ url, parent }) => {
  await authenticate(url);
  await parent();
  return {};
}) satisfies PageLoad;
```

In `.../albums/+page.svelte`, change the reference from its own loaded `albums` to the layout-provided `linkedAlbums`. Find where it reads `data.albums` and replace with `data.linkedAlbums` (the array shape is identical — both are `SharedSpaceLinkedAlbumDto[]` from `getSharedSpaceAlbums`). Update the local `$state`/`$derived` accordingly.

- [ ] **Step 4: Create the Members `+page.ts`**

Create `.../members/+page.ts`:

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
    meta: { title: `${space.name} - Members` },
  };
}) satisfies PageLoad;
```

- [ ] **Step 5: Type-check**

Run: `cd web && pnpm check:typescript && pnpm check:svelte`
Expected: passes. (The Photos/People/Albums page specs may now fail because their `data` no longer includes locally-fetched `space` — they will be fixed in Task 6 where the components change. If a spec fails purely on a missing `albums` key, fix it in Task 6.)

- [ ] **Step 6: Commit**

```bash
git add "web/src/routes/(user)/spaces/[spaceId]"
git commit -m "refactor(web): read space/members/albums from the shared layout load"
```

---

## Task 6: Introduce the shell `+layout.svelte` and de-chrome the tab pages (atomic flip)

This is the core change. Exactly one `UserPageLayout` may render, so the layout starts rendering it and the three tab pages stop. The layout owns the app bar (back · ＋Add photos · ⋮ overflow) and all the management handlers moved out of the Photos page. Tabs/cover are added in Tasks 7 & 9.

**Files:**

- Create: `.../[spaceId]/+layout.svelte`
- Modify: `.../[[photos=photos]]/[[assetId=id]]/+page.svelte`, `.../people/+page.svelte`, `.../albums/+page.svelte`
- Modify: `spaces-page.spec.ts`, `space-people-page.spec.ts`, `space-albums-page.spec.ts`

- [ ] **Step 1: Write the failing layout test**

Create `.../[spaceId]/space-layout.spec.ts`:

```ts
import type { SharedSpaceMemberResponseDto, SharedSpaceResponseDto } from '@immich/sdk';
import { SharedSpaceRole } from '@immich/sdk';
import '@testing-library/jest-dom';
import { render, screen } from '@testing-library/svelte';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { sdkMock } from '$lib/__mocks__/sdk.mock';
import SpaceLayout from './+layout.svelte';

const { mockPage, mockAuthManager, gotoMock } = vi.hoisted(() => ({
  mockPage: { url: new URL('https://gallery.test/spaces/s1'), route: { id: '/(user)/spaces/[spaceId]' } },
  mockAuthManager: { user: { id: 'u1', isAdmin: false } },
  gotoMock: vi.fn().mockResolvedValue(undefined),
}));
vi.mock('$app/state', () => ({ page: mockPage }));
vi.mock('$app/navigation', () => ({ goto: gotoMock, invalidateAll: vi.fn().mockResolvedValue(undefined) }));
vi.mock('$lib/managers/auth-manager.svelte', () => ({ authManager: mockAuthManager }));

const space = (o: Partial<SharedSpaceResponseDto> = {}): SharedSpaceResponseDto =>
  ({ id: 's1', name: 'Trip', assetCount: 35, memberCount: 1, faceRecognitionEnabled: false, ...o }) as never;
const member = (o: Partial<SharedSpaceMemberResponseDto> = {}): SharedSpaceMemberResponseDto =>
  ({ userId: 'u1', role: SharedSpaceRole.Owner, name: 'Me', email: 'me@x.io' }) as never;

function renderLayout(role: SharedSpaceRole, isAdmin = false) {
  mockAuthManager.user = { id: 'u1', isAdmin };
  // `children` is optional; the layout renders `{@render children?.()}`, so omitting it is fine.
  return render(SpaceLayout, {
    data: { space: space(), members: [member({ role })], linkedAlbums: [] } as never,
  });
}

describe('space [spaceId] +layout.svelte', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockPage.url = new URL('https://gallery.test/spaces/s1');
  });

  it('shows ＋ Add photos and the overflow for an editor', () => {
    renderLayout(SharedSpaceRole.Editor);
    expect(screen.getByTestId('space-add-photos')).toBeInTheDocument();
    expect(screen.getByTestId('space-overflow')).toBeInTheDocument();
  });

  it('hides ＋ Add photos for a viewer', () => {
    renderLayout(SharedSpaceRole.Viewer);
    expect(screen.queryByTestId('space-add-photos')).not.toBeInTheDocument();
  });

  it('records an add-photos intent and navigates to the Photos route when ＋ is clicked', async () => {
    const { spaceUiManager } = await import('$lib/managers/space-ui-manager.svelte');
    spaceUiManager.reset();
    mockPage.url = new URL('https://gallery.test/spaces/s1/members');
    renderLayout(SharedSpaceRole.Editor);
    await screen.getByTestId('space-add-photos').click();
    expect(spaceUiManager.intent).toBe('add-assets');
    expect(gotoMock).toHaveBeenCalledWith('/spaces/s1');
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm test -- --run "src/routes/(user)/spaces/[spaceId]/space-layout.spec.ts"`
Expected: FAIL — cannot resolve `./+layout.svelte`.

- [ ] **Step 3: Create `+layout.svelte`**

Create `.../[spaceId]/+layout.svelte`. This moves the back button + ＋Add photos + the full overflow menu (with handlers) out of the Photos page. Handlers call the SDK and `invalidateAll()` to refresh the shell.

```svelte
<script lang="ts">
  import { goto, invalidateAll } from '$app/navigation';
  import { page } from '$app/state';
  import UserPageLayout from '$lib/components/layouts/UserPageLayout.svelte';
  import ButtonContextMenu from '$lib/components/shared-components/context-menu/ButtonContextMenu.svelte';
  import MenuOption from '$lib/components/shared-components/context-menu/MenuOption.svelte';
  import SpaceLinkedLibrariesModal from '$lib/modals/SpaceLinkedLibrariesModal.svelte';
  import { authManager } from '$lib/managers/auth-manager.svelte';
  import { spaceUiManager } from '$lib/managers/space-ui-manager.svelte';
  import { Route } from '$lib/route';
  import { handleError } from '$lib/utils/handle-error';
  import {
    bulkAddAssets,
    removeSpace,
    SharedSpaceRole,
    updateMemberPreferences,
    updateMemberTimeline,
    updateSpace,
  } from '@immich/sdk';
  import { Button, IconButton, modalManager, toastManager } from '@immich/ui';
  import {
    mdiArrowLeft,
    mdiBookshelf,
    mdiDeleteOutline,
    mdiDotsVertical,
    mdiEyeOffOutline,
    mdiEyeOutline,
    mdiFaceRecognition,
    mdiImageMultipleOutline,
    mdiImagePlusOutline,
    mdiPaw,
  } from '@mdi/js';
  import type { Snippet } from 'svelte';
  import { t } from 'svelte-i18n';
  import type { LayoutData } from './$types';

  interface Props {
    data: LayoutData;
    children?: Snippet;
  }

  let { data, children }: Props = $props();

  const space = $derived(data.space);
  const members = $derived(data.members);
  const base = $derived(`/spaces/${space.id}`);

  const currentMember = $derived(members.find((m) => m.userId === authManager.user.id));
  const isOwner = $derived(currentMember?.role === SharedSpaceRole.Owner);
  const isEditor = $derived(
    currentMember?.role === SharedSpaceRole.Owner || currentMember?.role === SharedSpaceRole.Editor,
  );
  const showInTimeline = $derived(currentMember?.showInTimeline ?? true);
  const sharePersonMetadata = $derived(currentMember?.sharePersonMetadata ?? true);

  // A detail route (person or album) suppresses the cover + tabs; it keeps its own back nav.
  const suffix = $derived(page.url.pathname.slice(base.length));
  const isDetailRoute = $derived(/^\/(people|albums)\/[^/]+/.test(suffix));
  const showChrome = $derived(!isDetailRoute && !spaceUiManager.chromeHidden);

  const handleAddPhotos = () => {
    spaceUiManager.requestAddPhotos();
    if (page.url.pathname !== base) {
      void goto(base);
    }
  };

  const handleToggleTimeline = async () => {
    try {
      await updateMemberTimeline({
        id: space.id,
        sharedSpaceMemberTimelineDto: { showInTimeline: !showInTimeline },
      });
      await invalidateAll();
    } catch (error) {
      handleError(error, $t('errors.unable_to_update_timeline_display_status'));
    }
  };

  const handleTogglePersonMetadataSharing = async () => {
    try {
      await updateMemberPreferences({
        id: space.id,
        sharedSpaceMemberPreferencesDto: { sharePersonMetadata: !sharePersonMetadata },
      });
      await invalidateAll();
    } catch (error) {
      handleError(error, $t('errors.unable_to_update_person_metadata_sharing'));
    }
  };

  const handleBulkAddAssets = async () => {
    const confirmed = await modalManager.showDialog({ title: $t('add_all_photos'), prompt: $t('bulk_add_confirmation') });
    if (!confirmed) {
      return;
    }
    try {
      await bulkAddAssets({ id: space.id });
      toastManager.success($t('bulk_add_started'));
    } catch (error) {
      handleError(error, $t('errors.error_adding_assets_to_space'));
    }
  };

  const handleLinkLibraries = async () => {
    const changed = await modalManager.show(SpaceLinkedLibrariesModal, { space });
    if (changed) {
      await invalidateAll();
    }
  };

  const handleToggleFaceRecognition = async () => {
    try {
      await updateSpace({
        id: space.id,
        sharedSpaceUpdateDto: { faceRecognitionEnabled: !space.faceRecognitionEnabled },
      });
      await invalidateAll();
    } catch (error) {
      handleError(error, $t('spaces_toggle_people_failed'));
    }
  };

  const handleTogglePets = async () => {
    try {
      await updateSpace({ id: space.id, sharedSpaceUpdateDto: { petsEnabled: !space.petsEnabled } });
      await invalidateAll();
    } catch (error) {
      handleError(error, $t('spaces_toggle_pets_failed'));
    }
  };

  const handleDelete = async () => {
    const confirmed = await modalManager.showDialog({
      prompt: $t('spaces_delete_confirmation', { values: { name: space.name } }),
      title: $t('spaces_delete'),
    });
    if (!confirmed) {
      return;
    }
    await removeSpace({ id: space.id });
    await goto(Route.spaces());
  };
</script>

<UserPageLayout hideNavbar={spaceUiManager.chromeHidden} title={space.name} scrollbar={false}>
  {#snippet leading()}
    {#if !spaceUiManager.chromeHidden}
      <IconButton
        variant="ghost"
        shape="round"
        color="secondary"
        aria-label={$t('back')}
        onclick={() => goto(Route.spaces())}
        icon={mdiArrowLeft}
      />
    {/if}
  {/snippet}

  {#snippet buttons()}
    {#if !spaceUiManager.chromeHidden}
      <div class="flex items-center gap-1">
        {#if isEditor}
          <!-- Mockup: a labeled primary "＋ Add photos" button; text hides on narrow widths → icon only. -->
          <Button
            size="small"
            leadingIcon={mdiImagePlusOutline}
            onclick={handleAddPhotos}
            aria-label={$t('add_photos')}
            data-testid="space-add-photos"
          >
            <span class="hidden sm:inline">{$t('add_photos')}</span>
          </Button>
        {/if}
        <ButtonContextMenu
          direction="left"
          align="top-right"
          color="secondary"
          title={$t('more')}
          icon={mdiDotsVertical}
          data-testid="space-overflow"
        >
          <MenuOption
            text={showInTimeline ? $t('spaces_hide_from_timeline') : $t('spaces_show_on_timeline')}
            icon={showInTimeline ? mdiEyeOutline : mdiEyeOffOutline}
            onClick={handleToggleTimeline}
          />
          <MenuOption
            text={sharePersonMetadata ? $t('spaces_stop_sharing_person_metadata') : $t('spaces_share_person_metadata')}
            icon={mdiFaceRecognition}
            onClick={handleTogglePersonMetadataSharing}
          />
          {#if isEditor || authManager.user?.isAdmin}
            <hr class="my-1 border-gray-300" />
          {/if}
          {#if isEditor}
            <MenuOption text={$t('add_all_photos')} icon={mdiImageMultipleOutline} onClick={handleBulkAddAssets} />
          {/if}
          {#if authManager.user?.isAdmin}
            <MenuOption text={$t('spaces_link_libraries')} icon={mdiBookshelf} onClick={handleLinkLibraries} />
          {/if}
          {#if isOwner}
            <hr class="my-1 border-gray-300" />
            <MenuOption
              text={space.faceRecognitionEnabled ? $t('spaces_hide_people') : $t('spaces_show_people')}
              icon={mdiFaceRecognition}
              onClick={handleToggleFaceRecognition}
            />
            {#if space.faceRecognitionEnabled && space.hasPets}
              <MenuOption
                text={space.petsEnabled ? $t('spaces_hide_pets') : $t('spaces_show_pets')}
                icon={mdiPaw}
                onClick={handleTogglePets}
              />
            {/if}
            <hr class="my-1 border-gray-300" />
            <MenuOption text={$t('spaces_delete')} icon={mdiDeleteOutline} textColor="text-red-500" onClick={handleDelete} />
          {/if}
        </ButtonContextMenu>
      </div>
    {/if}
  {/snippet}

  <div class="flex h-full flex-col">
    <!-- SpaceTabs added in Task 7; SpaceHero (cover) added in Task 9 -->
    <div class="min-h-0 flex-1">
      {@render children?.()}
    </div>
  </div>
</UserPageLayout>
```

- [ ] **Step 4: Run the layout test to green**

Run: `pnpm test -- --run "src/routes/(user)/spaces/[spaceId]/space-layout.spec.ts"`
Expected: PASS. (The `more` i18n key already exists as `$t('more')`? If not, replace `title={$t('more')}` with the literal the codebase used before — the old Photos overflow used `title="More"`. Use `title={$t('more')}` only if the key exists; otherwise keep `title="More"` to match prior behavior. Confirm by grep `"more"` in `i18n/en.json`.)

- [ ] **Step 5: De-chrome the Photos page**

In `.../[[photos=photos]]/[[assetId=id]]/+page.svelte`:

1. Delete the entire opening `<UserPageLayout ...>` tag and its `{#snippet leading()}` and `{#snippet buttons()}` blocks (verbatim current lines 937-1045), and the matching closing `</UserPageLayout>` (line 1186). Keep the inner content (the `<div class="flex h-full" data-testid="discovery-timeline">…</div>`) as the page's top-level markup.
2. Delete the handler definitions now living in the layout: `handleToggleTimeline`, `handleTogglePersonMetadataSharing`, `handleBulkAddAssets`, `handleLinkLibraries`, `handleToggleFaceRecognition`, `handleTogglePets`, `handleDelete`. Remove their now-unused imports (`bulkAddAssets`, `removeSpace`, `updateMemberPreferences`, `updateMemberTimeline`, `mdiBookshelf`, `mdiPaw`, etc.) — `cd web && pnpm check:typescript && pnpm check:svelte` will flag leftovers. **Keep** `handleShowMembers`, `openSelectCover`, `handleReposition`, `handleSavePosition`, `handleCancelReposition`, `heroCollapsed`, `repositioning`, `spacePeople` for now — the hero + people strip (still inside the Timeline until Task 9) and the `SpacePanel` (until Task 10) still reference them. Removing them now would fail `check:svelte` (`--fail-on-warnings` flags unused, and the live references would break).
3. Add the intent consumer. Near the other `$effect`s add:

```ts
import { spaceUiManager } from '$lib/managers/space-ui-manager.svelte';

// Consume add-photos / change-cover intents triggered from the shell app bar.
$effect(() => {
  const intent = spaceUiManager.intent;
  if (!intent) {
    return;
  }
  spaceUiManager.consumeIntent();
  if (intent === 'add-assets') {
    viewMode = 'select-assets';
  } else if (intent === 'set-cover') {
    openSelectCover();
  }
});
```

4. Mirror the selection modes into `chromeHidden`. Add:

```ts
$effect(() => {
  spaceUiManager.setChromeHidden(
    assetMultiSelectManager.selectionActive || viewMode === 'select-assets' || viewMode === 'select-cover',
  );
});

// Reset shell state when leaving the Photos page.
$effect(() => () => spaceUiManager.reset());
```

The `ControlAppBar` blocks (`select-assets`, `select-cover`) and the `AssetSelectControlBar` block stay as-is — they already render as fixed overlays above the layout.

- [ ] **Step 6: De-chrome the People page (relocate its toolbar)**

In `.../people/+page.svelte`, remove the `<UserPageLayout ...>` wrapper and its `leading`/`buttons` snippets (verbatim current lines 445-496). Render the page content directly, with the former `buttons` toolbar moved into a content-area header at the top:

```svelte
<div class="flex h-full flex-col">
  {#if hasSearchablePeople || canManageVisibility}
    <div class="flex items-center justify-end gap-2 px-4 py-2">
      {#if hasSearchablePeople}
        <div class="hidden sm:block">
          <div class="w-40 lg:w-80 h-10">
            <SearchBar
              bind:name={searchName}
              {showLoadingSpinner}
              placeholder={$t('search_people')}
              onReset={() => void onResetSearchBar()}
              onSearch={() => void searchPeople()}
            />
          </div>
        </div>
        <Dropdown
          title={$t('sort_people_by')}
          options={peopleSortOptions}
          selectedOption={peopleSortBy}
          onSelect={(sortBy) => ($peopleViewSettings.sortBy = sortBy)}
          render={(sortBy) => ({ title: peopleSortByNames[sortBy], icon: peopleSortIcons[sortBy] })}
        />
      {/if}
      {#if canManageVisibility}
        <Button leadingIcon={mdiEyeOutline} onclick={openVisibilityModal} size="small" variant="ghost" color="secondary">
          {$t('show_and_hide_people')}
        </Button>
      {/if}
    </div>
  {/if}

  <!-- existing people grid markup that was inside UserPageLayout goes here, unchanged -->
</div>
```

Remove the now-unused `UserPageLayout` import and the `mdiArrowLeft` import (the back button is the shell's now).

- [ ] **Step 7: De-chrome the Albums page (relocate its toolbar)**

In `.../albums/+page.svelte`, remove the `<UserPageLayout ...>` wrapper and its `leading`/`buttons` snippets (verbatim current lines 124-151). Render content directly with a content-area header:

```svelte
<div class="flex h-full flex-col">
  <div class="flex items-center justify-between px-4 py-2">
    <p class="text-sm text-gray-500">{$t('space_albums_count', { values: { count: linkedAlbums.length } })}</p>
    {#if isEditor}
      <Button
        size="small"
        variant="ghost"
        leadingIcon={mdiLinkVariantPlus}
        onclick={() => void openPicker()}
        data-testid="link-album-button"
      >
        {$t('spaces_linked_albums_link_album')}
      </Button>
    {/if}
  </div>

  <!-- existing album grid markup that was inside UserPageLayout goes here, unchanged -->
</div>
```

Remove the now-unused `UserPageLayout` and `mdiArrowLeft` imports. Ensure the component reads `data.linkedAlbums` (renamed in Task 5 Step 3).

- [ ] **Step 8: Update the affected page specs**

In `spaces-page.spec.ts`, `space-people-page.spec.ts`, `space-albums-page.spec.ts`: the page components no longer render the back button / title / overflow (those moved to the layout, which these specs don't render). Remove assertions that targeted the removed app-bar elements (e.g. `space-members-button`, `space-albums-button`, the back IconButton) and any assertion of the page title. For `space-albums-page.spec.ts`, change the `data` fixture key from `albums` to `linkedAlbums`. Keep all content assertions (grid, search, etc.).

- [ ] **Step 9: Type-check and run the affected unit tests**

```bash
cd web && pnpm check:typescript && pnpm check:svelte
```

Then from `web/`:

```bash
pnpm test -- --run "src/routes/(user)/spaces/[spaceId]/[[photos=photos]]/[[assetId=id]]/spaces-page.spec.ts" \
  "src/routes/(user)/spaces/[spaceId]/people/space-people-page.spec.ts" \
  "src/routes/(user)/spaces/[spaceId]/albums/space-albums-page.spec.ts" \
  "src/routes/(user)/spaces/[spaceId]/space-layout.spec.ts"
```

Expected: all PASS, no type errors.

- [ ] **Step 10: Commit**

```bash
git add "web/src/routes/(user)/spaces/[spaceId]"
git commit -m "refactor(web): introduce space shell layout; move app-bar actions out of tab pages"
```

---

## Task 7: Mount `SpaceTabs` in the shell

**Files:**

- Modify: `.../[spaceId]/+layout.svelte`
- Modify: `.../[spaceId]/space-layout.spec.ts`

- [ ] **Step 1: Add the failing assertion**

Append to `space-layout.spec.ts`:

```ts
it('renders the tab bar with badge counts when chrome is shown', () => {
  renderLayout(SharedSpaceRole.Owner);
  expect(screen.getByTestId('space-tabs')).toBeInTheDocument();
  expect(screen.getByTestId('space-tab-photos')).toHaveTextContent('35');
});

it('suppresses the tab bar on a person/album detail route', () => {
  mockPage.url = new URL('https://gallery.test/spaces/s1/albums/al-1');
  renderLayout(SharedSpaceRole.Owner);
  expect(screen.queryByTestId('space-tabs')).not.toBeInTheDocument();
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm test -- --run "src/routes/(user)/spaces/[spaceId]/space-layout.spec.ts"`
Expected: FAIL — no `space-tabs` element (the first assertion). The detail-route test already passes against Task 6's `showChrome`/`isDetailRoute` guard.

- [ ] **Step 3: Implement**

In `+layout.svelte`, import and render `SpaceTabs` inside the content column, gated on `showChrome`:

```svelte
  import SpaceTabs from '$lib/components/spaces/space-tabs.svelte';
```

```svelte
  <div class="flex h-full flex-col">
    {#if showChrome}
      <!-- cover (SpaceHero) is inserted above the tabs in Task 9 -->
      <SpaceTabs
        spaceId={space.id}
        faceRecognitionEnabled={space.faceRecognitionEnabled}
        photoCount={space.assetCount ?? 0}
        albumCount={data.linkedAlbums.length}
        memberCount={members.length}
      />
    {/if}
    <div class="min-h-0 flex-1">
      {@render children?.()}
    </div>
  </div>
```

- [ ] **Step 4: Run to verify it passes**

Run: `pnpm test -- --run "src/routes/(user)/spaces/[spaceId]/space-layout.spec.ts"`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add "web/src/routes/(user)/spaces/[spaceId]/+layout.svelte" "web/src/routes/(user)/spaces/[spaceId]/space-layout.spec.ts"
git commit -m "feat(web): render SpaceTabs in the space shell"
```

---

## Task 8: Refactor `SpaceHero` (button-free cover, hover ✎, tall/compact, scroll-collapse)

> **Coupling note:** Tasks 8 and 9 share one commit. Changing `SpaceHero`'s props here makes the Photos page's old `<SpaceHero …>` call site (removed in Task 9) stop type-checking, so the app-level `cd web && pnpm check:typescript && pnpm check:svelte` will not pass until Task 9 is done. In Task 8, run only the component spec; do the single combined commit at the end of Task 9.

**Files:**

- Modify: `web/src/lib/components/spaces/space-hero.svelte`
- Modify: `web/src/lib/components/spaces/space-hero.spec.ts`

Remove the pill row, the collapse chevron, and the dropped props (`memberCount`, `assetCount`, `onShowMembers`, `collapsed`, `onToggleCollapse`, `faceRecognitionEnabled`). Add: `compact` (boolean — short identity-only height for non-Photos tabs), `collapsed` is replaced by reading scroll state via a new prop `collapsed` driven by the layout, and a hover-revealed ✎ edit affordance for editors (`onChangeCover`, `onReposition`). Keep the cover image / gradient, name, description, a relocated role badge, and reposition mode.

- [ ] **Step 1: Update the failing test**

Replace the pill-row assertions in `space-hero.spec.ts` and add new ones. Add these cases (keep existing name/cover/gradient cases):

```ts
it('does NOT render the old pill row (photo/member counts, manage-people, chevron)', () => {
  render(SpaceHero, { space: makeSpace(), currentRole: 'owner' });
  expect(screen.queryByTestId('hero-photo-count')).not.toBeInTheDocument();
  expect(screen.queryByTestId('hero-member-count')).not.toBeInTheDocument();
  expect(screen.queryByTestId('hero-manage-people')).not.toBeInTheDocument();
  expect(screen.queryByTestId('hero-collapse-toggle')).not.toBeInTheDocument();
});

it('shows the hover edit control only when canEdit', () => {
  const { rerender } = render(SpaceHero, { space: makeSpace({ thumbnailAssetId: 'a1' }), canEdit: false });
  expect(screen.queryByTestId('hero-edit-cover')).not.toBeInTheDocument();
  rerender({
    space: makeSpace({ thumbnailAssetId: 'a1' }),
    canEdit: true,
    onChangeCover: () => {},
    onReposition: () => {},
  });
  expect(screen.getByTestId('hero-edit-cover')).toBeInTheDocument();
});

it('shows a Set cover prompt when there is no cover and canEdit', () => {
  render(SpaceHero, { space: makeSpace({ thumbnailAssetId: null }), canEdit: true, onChangeCover: () => {} });
  expect(screen.getByTestId('hero-set-cover-button')).toBeInTheDocument();
});

it('renders the role badge', () => {
  render(SpaceHero, { space: makeSpace(), currentRole: 'owner' });
  expect(screen.getByTestId('hero-role-badge')).toBeInTheDocument();
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm test -- --run src/lib/components/spaces/space-hero.spec.ts`
Expected: FAIL — old testids still present / new props unsupported.

- [ ] **Step 3: Implement the refactor**

Rewrite `space-hero.svelte`'s `Props` and markup. New `Props`:

```ts
interface Props {
  space: SharedSpaceResponseDto;
  currentRole?: string;
  gradientClass?: string;
  canEdit?: boolean;
  onChangeCover?: () => void;
  onReposition?: () => void;
  repositioning?: boolean;
  onSavePosition?: (cropY: number) => void;
  onCancelReposition?: () => void;
  compact?: boolean;
  collapsed?: boolean;
}
```

Height logic:

```ts
let {
  space,
  currentRole,
  gradientClass = 'from-gray-400 to-gray-600',
  canEdit = false,
  onChangeCover,
  onReposition,
  repositioning = false,
  onSavePosition,
  onCancelReposition,
  compact = false,
  collapsed = false,
}: Props = $props();

const TALL = 220;
const COMPACT = 96;
let hasCover = $derived(!!space.thumbnailAssetId);
let effectiveHeight = $derived(repositioning ? TALL : collapsed ? 0 : compact ? COMPACT : TALL);
```

Keep the cover image / gradient / reposition drag logic (verbatim from the current file: the `coverUrl`, `displayCropY`, `handlePointerDown/Move/Up`, and the reposition-mode overlay block). DELETE the entire collapsed-bar block (current lines 133-191) and the bottom pill row inside the normal state (current lines 284-333). Replace the normal-state bottom content with name + description + role badge only:

```svelte
    <div class="absolute bottom-0 left-0 right-0 p-5 text-white">
      <h1 class="text-2xl font-bold drop-shadow-md" data-testid="hero-title">{space.name}</h1>
      {#if space.description}
        <p class="mt-1 line-clamp-2 text-sm text-white/80 drop-shadow-sm" data-testid="hero-description">
          {space.description}
        </p>
      {/if}
    </div>

    <!-- Mockup: hover ✎ (editors) + role badge grouped at the top-right of the cover. -->
    <div class="absolute right-3 top-3 flex items-center gap-2">
      {#if canEdit && !repositioning && hasCover}
        <div class="opacity-0 transition group-hover:opacity-100" data-testid="hero-edit-cover">
          <ButtonContextMenu icon={mdiPencilOutline} title={$t('edit')} color="secondary" align="top-right" direction="left">
            <MenuOption text={$t('change_cover_photo')} icon={mdiImageEditOutline} onClick={onChangeCover} />
            <MenuOption text={$t('reposition')} icon={mdiCursorMove} onClick={onReposition} />
          </ButtonContextMenu>
        </div>
      {/if}
      {#if currentRole}
        <span
          class="inline-flex items-center rounded-full bg-white/20 px-2.5 py-0.5 text-xs font-medium capitalize text-white backdrop-blur-sm"
          data-testid="hero-role-badge"
        >
          {currentRole}
        </span>
      {/if}
    </div>
```

For the no-cover case (editors), show a hover-revealed "Set cover photo" prompt (top-left, so it doesn't collide with the role badge):

```svelte
    {#if canEdit && !repositioning && !hasCover}
      <button
        type="button"
        class="absolute left-3 top-3 flex items-center gap-1.5 rounded-full bg-black/40 px-3 py-1.5 text-xs font-medium text-white opacity-0 backdrop-blur-sm transition hover:bg-black/60 group-hover:opacity-100"
        onclick={onChangeCover}
        data-testid="hero-set-cover-button"
      >
        <Icon icon={mdiImageEditOutline} size="14" />
        {$t('set_cover_photo')}
      </button>
    {/if}
```

Add imports for `ButtonContextMenu`, `MenuOption`, and `mdiPencilOutline` (keep `Icon`, `mdiImageEditOutline`, `mdiCursorMove`). Update the root element height style to use `effectiveHeight`, keep the `transition: height 300ms ease`, and add `class="group"` to the root element so the hover-reveal works.

- [ ] **Step 4: Run the component spec to verify it passes**

Run: `pnpm test -- --run src/lib/components/spaces/space-hero.spec.ts`
Expected: PASS. Do **not** run `cd web && pnpm check:typescript && pnpm check:svelte` yet — the Photos page still renders the old hero API and won't type-check until Task 9.

- [ ] **Step 5: No commit yet**

Continue straight to Task 9. The combined commit (SpaceHero refactor + cover relocation) lands at the end of Task 9, once `cd web && pnpm check:typescript && pnpm check:svelte` is green again.

---

## Task 9: Mount the cover in the shell; drive collapse from Timeline scroll; remove hero/strip from Photos

**Files:**

- Modify: `.../[spaceId]/+layout.svelte`
- Modify: `.../[[photos=photos]]/[[assetId=id]]/+page.svelte`

- [ ] **Step 1: Add cover to the layout (above the tabs)**

In `+layout.svelte`, import `SpaceHero`, add reposition state + cover handlers, and render the cover above `SpaceTabs`. The cover is tall + collapsible on the Photos route, compact elsewhere.

```svelte
  import SpaceHero from '$lib/components/spaces/space-hero.svelte';
  import { handleError } from '$lib/utils/handle-error';
  import { toastManager } from '@immich/ui';
```

```ts
let repositioning = $state(false);
const onPhotosTab = $derived(page.url.pathname === base || page.url.pathname.startsWith(`${base}/photos`));

const handleChangeCover = () => {
  spaceUiManager.requestChangeCover();
  if (page.url.pathname !== base) {
    void goto(base);
  }
};
const handleSavePosition = async (cropY: number) => {
  try {
    await updateSpace({ id: space.id, sharedSpaceUpdateDto: { thumbnailCropY: cropY } });
    repositioning = false;
    await invalidateAll();
    toastManager.success($t('space_cover_updated'));
  } catch (error) {
    handleError(error, $t('errors.unable_to_update_space_cover'));
  }
};
```

Render above `<SpaceTabs>`:

```svelte
    {#if showChrome}
      <SpaceHero
        space={space}
        currentRole={currentMember?.role}
        canEdit={isEditor}
        onChangeCover={handleChangeCover}
        onReposition={() => (repositioning = true)}
        {repositioning}
        onSavePosition={handleSavePosition}
        onCancelReposition={() => (repositioning = false)}
        compact={!onPhotosTab}
        collapsed={onPhotosTab && spaceUiManager.coverCollapsed}
      />
      <SpaceTabs … />
    {/if}
```

Append a cover-render assertion to `space-layout.spec.ts` and run it (FAIL before, PASS after mounting the cover):

```ts
it('renders the cover (SpaceHero) when chrome is shown', () => {
  renderLayout(SharedSpaceRole.Owner);
  expect(screen.getByTestId('hero-title')).toHaveTextContent('Trip');
});
```

- [ ] **Step 2: Remove the hero + people strip from the Photos page and wire scroll**

In `.../[[photos=photos]]/[[assetId=id]]/+page.svelte`:

1. Delete the `<SpaceHero … />` block (verbatim current lines 1127-1143) and the `<SpacePeopleStrip … />` block (lines 1145-1152) from inside the `<Timeline>`. Remove the `SpaceHero`, `SpacePeopleStrip` imports and the now-dead hero state/handlers: `heroCollapsed`, `toggleHeroCollapsed`, `loadHeroCollapsed`, `persistHeroCollapsed`, `repositioning`, `handleReposition`, `handleSavePosition`, `handleCancelReposition`, `handleShowMembers`, and `spacePeople`/`loadSpacePeople` (their only remaining consumer was the strip — confirm with a grep before deleting). **Keep** `openSelectCover`, `handleCloseSelectCover`, `handleSetCoverFromSelection`, `handleAddAssets`, `handleCloseSelectAssets` — the `select-cover`/`select-assets` modes are still driven here, and `openSelectCover` is invoked by the intent consumer added in Task 6.
2. Fix `handleSetCoverFromSelection`: the cover now lives in the shell (which reads its own `data.space`), so the old local `space = { … }` mutation and `repositioning = true` no longer apply. Replace its body with `updateSpace` + `invalidateAll()` + return to view:

```ts
const handleSetCoverFromSelection = async () => {
  const assets = assetMultiSelectManager.assets;
  if (assets.length !== 1) {
    return;
  }
  try {
    await updateSpace({ id: space.id, sharedSpaceUpdateDto: { thumbnailAssetId: assets[0].id } });
    await invalidateAll();
    toastManager.success($t('space_cover_updated'));
    assetMultiSelectManager.clear();
    viewMode = 'view';
  } catch (error) {
    handleError(error, $t('errors.unable_to_update_space_cover'));
  }
};
```

Add `import { invalidateAll } from '$app/navigation';` (alongside the existing `goto` import).

3. Wire the Timeline's new `onScroll` to collapse the cover:

```svelte
<Timeline
  …
  onScroll={(scrollTop) => spaceUiManager.setCoverCollapsed(scrollTop > 64)}
>
```

- [ ] **Step 3: Type-check + manual smoke**

```bash
cd web && pnpm check:typescript && pnpm check:svelte
```

Then run the dev stack (`make dev`) and verify, on a space: Photos tab shows the tall cover; scrolling the grid collapses it and the tabs stay; People/Albums/Members show a compact cover; a detail route (open an album) shows no cover/tabs.

- [ ] **Step 4: Run the Photos page spec**

Run: `pnpm test -- --run "src/routes/(user)/spaces/[spaceId]/[[photos=photos]]/[[assetId=id]]/spaces-page.spec.ts"`
Expected: PASS (remove any remaining hero/strip assertions if present).

- [ ] **Step 5: Commit (covers Tasks 8 + 9)**

```bash
git add web/src/lib/components/spaces/space-hero.svelte web/src/lib/components/spaces/space-hero.spec.ts "web/src/routes/(user)/spaces/[spaceId]"
git commit -m "feat(web): button-free SpaceHero mounted in shell, collapse on Timeline scroll"
```

---

## Task 10: Members tab (ported from `space-panel`)

**Files:**

- Create: `.../members/+page.svelte`
- Test: `.../members/space-members-page.spec.ts`

Port the panel's member list (role `Select` for owner, `RoleBadge` otherwise), invite button, and the activity feed — rendered as a full page (member list primary, activity below). Reads `space`/`members` from layout `data`, activities from its own load (Task 5).

- [ ] **Step 1: Write the failing test**

Create `.../members/space-members-page.spec.ts`:

```ts
import type { SharedSpaceMemberResponseDto, SharedSpaceResponseDto } from '@immich/sdk';
import { SharedSpaceRole } from '@immich/sdk';
import '@testing-library/jest-dom';
import { render, screen } from '@testing-library/svelte';
import type { Component } from 'svelte';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { sdkMock } from '$lib/__mocks__/sdk.mock';
import TestWrapper from '$lib/components/TestWrapper.svelte';
import MembersPage from './+page.svelte';

const { mockAuthManager } = vi.hoisted(() => ({ mockAuthManager: { user: { id: 'u1', isAdmin: false } } }));
vi.mock('$lib/managers/auth-manager.svelte', () => ({ authManager: mockAuthManager }));
vi.mock('$app/navigation', () => ({ goto: vi.fn(), invalidateAll: vi.fn().mockResolvedValue(undefined) }));

const space = (o: Partial<SharedSpaceResponseDto> = {}): SharedSpaceResponseDto =>
  ({ id: 's1', name: 'Trip', color: 'primary', ...o }) as never;
const member = (o: Partial<SharedSpaceMemberResponseDto> = {}): SharedSpaceMemberResponseDto =>
  ({ userId: 'u1', role: SharedSpaceRole.Owner, name: 'Me', email: 'me@x.io', contributionCount: 0 }) as never;

function renderPage(role: SharedSpaceRole, members = [member({ role })]) {
  mockAuthManager.user = { id: 'u1', isAdmin: false };
  const props = { data: { space: space(), members, linkedAlbums: [], activities: [], hasMoreActivities: false } };
  return render(TestWrapper as Component<{ component: typeof MembersPage; componentProps: typeof props }>, {
    component: MembersPage,
    componentProps: props,
  });
}

describe('Members tab', () => {
  beforeEach(() => vi.clearAllMocks());

  it('lists members', () => {
    renderPage(SharedSpaceRole.Owner, [member(), member({ userId: 'u2', role: SharedSpaceRole.Editor, name: 'Ann' })]);
    expect(screen.getByText('Me')).toBeInTheDocument();
    expect(screen.getByText('Ann')).toBeInTheDocument();
  });

  it('shows the invite button to an owner', () => {
    renderPage(SharedSpaceRole.Owner);
    expect(screen.getByTestId('members-invite')).toBeInTheDocument();
  });

  it('hides the invite button from a non-owner', () => {
    renderPage(SharedSpaceRole.Viewer);
    expect(screen.queryByTestId('members-invite')).not.toBeInTheDocument();
  });

  it('renders the activity section', () => {
    renderPage(SharedSpaceRole.Owner);
    expect(screen.getByTestId('members-activity')).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm test -- --run "src/routes/(user)/spaces/[spaceId]/members/space-members-page.spec.ts"`
Expected: FAIL — cannot resolve `./+page.svelte`.

- [ ] **Step 3: Write the page**

Create `.../members/+page.svelte` (ports `space-panel.svelte`'s member list + the `SpaceActivityFeed`; the role-change `handleRoleChange` is copied verbatim from the panel):

```svelte
<script lang="ts">
  import { invalidateAll } from '$app/navigation';
  import UserAvatar from '$lib/components/shared-components/UserAvatar.svelte';
  import RoleBadge from '$lib/components/spaces/role-badge.svelte';
  import SpaceActivityFeed from '$lib/components/spaces/space-activity-feed.svelte';
  import SpaceAddMemberModal from '$lib/modals/SpaceAddMemberModal.svelte';
  import { authManager } from '$lib/managers/auth-manager.svelte';
  import { getAssetMediaUrl } from '$lib/utils';
  import { handleError } from '$lib/utils/handle-error';
  import { formatTimeAgo } from '$lib/utils/timesince';
  import {
    getSpaceActivities,
    removeMember,
    SharedSpaceRole,
    updateMember,
    UserAvatarColor,
    type SharedSpaceMemberResponseDto,
  } from '@immich/sdk';
  import { Button, Field, modalManager, Select, type SelectOption } from '@immich/ui';
  import { mdiAccountPlusOutline } from '@mdi/js';
  import { t } from 'svelte-i18n';
  import type { PageData } from './$types';

  const ACTIVITY_PAGE_SIZE = 20;

  let { data }: { data: PageData } = $props();
  const space = $derived(data.space);
  const members = $derived(data.members);
  const currentMember = $derived(members.find((m) => m.userId === authManager.user.id));
  const isOwner = $derived(currentMember?.role === SharedSpaceRole.Owner);

  let activities = $state(data.activities);
  let hasMoreActivities = $state(data.hasMoreActivities);
  let activityOffset = $state(data.activities.length);

  const toAvatarUser = (m: SharedSpaceMemberResponseDto) => ({
    id: m.userId,
    name: m.name,
    email: m.email,
    profileImagePath: m.profileImagePath ?? '',
    avatarColor: (m.avatarColor as UserAvatarColor) ?? UserAvatarColor.Primary,
    profileChangedAt: m.profileChangedAt ?? '',
  });

  async function handleAddMember() {
    const result = await modalManager.show(SpaceAddMemberModal, {
      spaceId: space.id,
      existingMemberIds: members.map((m) => m.userId),
    });
    if (result) {
      await invalidateAll();
    }
  }

  async function handleRoleChange(member: SharedSpaceMemberResponseDto, newRole: SharedSpaceRole | 'remove') {
    if (newRole === 'remove') {
      const confirmed = await modalManager.showDialog({
        prompt: $t('spaces_remove_member_confirmation', { values: { name: member.name } }),
        title: $t('spaces_remove_member'),
      });
      if (!confirmed) {
        return;
      }
      try {
        await removeMember({ id: space.id, userId: member.userId });
        await invalidateAll();
      } catch (error) {
        handleError(error, $t('errors.error_removing_member'));
      }
      return;
    }
    try {
      await updateMember({ id: space.id, userId: member.userId, sharedSpaceMemberUpdateDto: { role: newRole } });
      await invalidateAll();
    } catch (error) {
      handleError(error, $t('errors.error_updating_member_role'));
    }
  }

  async function loadMoreActivities() {
    const result = await getSpaceActivities({ id: space.id, limit: ACTIVITY_PAGE_SIZE, offset: activityOffset });
    activities = [...activities, ...result];
    activityOffset += result.length;
    hasMoreActivities = result.length === ACTIVITY_PAGE_SIZE;
  }
</script>

<div class="mx-auto w-full max-w-3xl px-4 py-4">
  <div class="mb-3 flex items-center justify-between">
    <h2 class="text-base font-semibold">{$t('members')} ({members.length})</h2>
    {#if isOwner}
      <Button size="small" leadingIcon={mdiAccountPlusOutline} onclick={handleAddMember} data-testid="members-invite">
        {$t('spaces_add_member')}
      </Button>
    {/if}
  </div>

  <div data-testid="member-list" class="rounded-xl border border-gray-200 dark:border-gray-800">
    {#each members as member (member.userId)}
      <div class="border-b border-gray-100 px-4 py-3 last:border-b-0 dark:border-gray-800/50">
        <div class="flex items-center gap-3">
          <UserAvatar user={toAvatarUser(member)} size="sm" />
          <div class="min-w-0 flex-1">
            <p class="truncate text-sm font-medium">{member.name}</p>
            <p class="truncate text-xs text-gray-500">{member.email}</p>
          </div>
          {#if isOwner && member.role !== 'owner'}
            <Field class="w-28 shrink-0">
              <Select
                value={member.role as string as SharedSpaceRole}
                options={[
                  { label: $t('role_editor'), value: SharedSpaceRole.Editor },
                  { label: $t('role_viewer'), value: SharedSpaceRole.Viewer },
                  { label: $t('remove'), value: 'remove' },
                ] as SelectOption<SharedSpaceRole | 'remove'>[]}
                onChange={(value) => handleRoleChange(member, value)}
              />
            </Field>
          {:else}
            <RoleBadge role={member.role} spaceColor={space.color} size="sm" />
          {/if}
        </div>
        {#if (member.contributionCount ?? 0) > 0}
          <div class="mt-2 flex items-center gap-2.5">
            {#if member.recentAssetId}
              <img alt="" src={getAssetMediaUrl({ id: member.recentAssetId })} class="size-12 rounded-lg object-cover" loading="lazy" draggable="false" />
            {/if}
            <div class="text-xs text-gray-500">
              <span>{member.contributionCount} {$t('photos')}</span>
              {#if member.lastActiveAt}
                <span class="mx-0.5">·</span><span>{formatTimeAgo(member.lastActiveAt)}</span>
              {/if}
            </div>
          </div>
        {/if}
      </div>
    {/each}
  </div>

  <h3 class="mt-6 mb-2 text-xs font-medium uppercase tracking-wide text-gray-500">{$t('spaces_recent_activity')}</h3>
  <div data-testid="members-activity">
    <SpaceActivityFeed {activities} spaceColor={space.color ?? 'primary'} onLoadMore={loadMoreActivities} hasMore={hasMoreActivities} />
  </div>
</div>
```

- [ ] **Step 4: Run to verify it passes**

Run: `pnpm test -- --run "src/routes/(user)/spaces/[spaceId]/members/space-members-page.spec.ts"`
Expected: PASS (4 tests). Then `cd web && pnpm check:typescript && pnpm check:svelte`.

- [ ] **Step 5: Remove the slide-in panel from the Photos page**

In `.../[[photos=photos]]/[[assetId=id]]/+page.svelte`: delete the `<SpacePanel … />` block (verbatim current lines 1222-1237), its `SpacePanel` import, the `panelOpen` state (and the `panelOpen = false` line in the space-switch `$effect`), and the activity-loading code that fed it (`activities`, `hasMoreActivities`, `activityOffset`, `loadActivities`, `loadMoreActivities`, `getSpaceActivities` import) — the activity feed now lives on the Members tab. (`handleShowMembers` was already removed in Task 9.) Run `cd web && pnpm check:typescript && pnpm check:svelte` to catch leftovers.

- [ ] **Step 6: Commit**

```bash
git add "web/src/routes/(user)/spaces/[spaceId]"
git commit -m "feat(web): Members tab page; remove slide-in space panel"
```

---

## Task 11: Add i18n keys

**Files:**

- Modify: `i18n/en.json`

The relocated overflow strings and the new activity heading were previously hardcoded English. Add keys (insert alphabetically near other `spaces_*` keys).

- [ ] **Step 1: Add the keys**

Add to `i18n/en.json`:

```json
  "spaces_hide_people": "Hide people",
  "spaces_show_people": "Show people",
  "spaces_hide_pets": "Hide pets",
  "spaces_show_pets": "Show pets",
  "spaces_link_libraries": "Link libraries",
  "spaces_toggle_people_failed": "Failed to update face recognition",
  "spaces_toggle_pets_failed": "Failed to update pets setting",
  "spaces_recent_activity": "Recent activity",
```

(If `more` is not already a key, also add `"more": "More"`; otherwise leave the overflow `title` as the literal `"More"` per Task 6 Step 4.)

- [ ] **Step 2: Verify usage compiles + format**

```bash
cd web && pnpm check:typescript && pnpm check:svelte
npx prettier --write i18n/en.json
```

Expected: no missing-key warnings for the new `$t(...)` calls; prettier clean.

- [ ] **Step 3: Commit**

```bash
git add i18n/en.json
git commit -m "i18n(web): add keys for relocated space overflow + members activity"
```

---

## Task 12: Delete `space-panel` and `space-people-strip`

**Files:**

- Delete: `web/src/lib/components/spaces/space-panel.svelte`, `space-panel.spec.ts`
- Delete: `web/src/lib/components/spaces/space-people-strip.svelte`, `space-people-strip.spec.ts`

- [ ] **Step 1: Confirm no remaining importers**

Run (from repo root):

```bash
grep -rn "space-panel\|SpacePanel\|space-people-strip\|SpacePeopleStrip" web/src --include=*.svelte --include=*.ts
```

Expected: no non-test references (the Photos page no longer imports them after Tasks 9-10). If anything remains, remove it.

- [ ] **Step 2: Delete the files**

```bash
git rm web/src/lib/components/spaces/space-panel.svelte web/src/lib/components/spaces/space-panel.spec.ts \
       web/src/lib/components/spaces/space-people-strip.svelte web/src/lib/components/spaces/space-people-strip.spec.ts
```

- [ ] **Step 3: Type-check**

Run: `cd web && pnpm check:typescript && pnpm check:svelte`
Expected: passes (no dangling imports).

- [ ] **Step 4: Commit**

```bash
git commit -m "chore(web): remove obsolete space panel and people strip"
```

---

## Task 13: E2E Playwright coverage

**Files:**

- Modify/extend: `e2e/src/specs/web/spaces-p1.e2e-spec.ts` (add a `describe('tabbed navigation')`)

Use the existing role-setup pattern: create users + space + members in `beforeAll`, switch identities with `utils.setAuthCookies`.

- [ ] **Step 1: Add the failing e2e describe**

Append to `e2e/src/specs/web/spaces-p1.e2e-spec.ts` (adapt the imports/fixtures to the file's existing `beforeAll`; if it already builds a space context, reuse it):

```ts
import { SharedSpaceRole } from '@immich/sdk';
import { expect, test } from '@playwright/test';
import { createUserDto } from 'src/fixtures';
import { utils } from 'src/utils';

test.describe('Spaces — tabbed navigation', () => {
  let admin, owner, editor, viewer, spaceId;

  test.beforeAll(async () => {
    utils.initSdk();
    await utils.resetDatabase();
    admin = await utils.adminSetup();
    [owner, editor, viewer] = await Promise.all([
      utils.userSetup(admin.accessToken, createUserDto.create('tabs-owner')),
      utils.userSetup(admin.accessToken, createUserDto.create('tabs-editor')),
      utils.userSetup(admin.accessToken, createUserDto.create('tabs-viewer')),
    ]);
    const space = await utils.createSpace(owner.accessToken, { name: 'Tabs Space' });
    spaceId = space.id;
    await utils.addSpaceMember(owner.accessToken, spaceId, { userId: editor.userId, role: SharedSpaceRole.Editor });
    await utils.addSpaceMember(owner.accessToken, spaceId, { userId: viewer.userId, role: SharedSpaceRole.Viewer });
  });

  test('owner sees all tabs except People (face rec off) and can navigate', async ({ context, page }) => {
    await utils.setAuthCookies(context, owner.accessToken);
    await page.goto(`/spaces/${spaceId}`);
    await expect(page.getByTestId('space-tab-photos')).toBeVisible();
    await expect(page.getByTestId('space-tab-albums')).toBeVisible();
    await expect(page.getByTestId('space-tab-map')).toBeVisible();
    await expect(page.getByTestId('space-tab-members')).toBeVisible();
    await expect(page.getByTestId('space-tab-people')).toHaveCount(0);

    await page.getByTestId('space-tab-members').click();
    await page.waitForURL(`/spaces/${spaceId}/members`);
    await expect(page.getByTestId('member-list')).toBeVisible();
  });

  test('viewer sees no ＋ Add photos and no owner overflow items', async ({ context, page }) => {
    await utils.setAuthCookies(context, viewer.accessToken);
    await page.goto(`/spaces/${spaceId}`);
    await expect(page.getByTestId('space-tabs')).toBeVisible();
    await expect(page.getByTestId('space-add-photos')).toHaveCount(0);
  });

  test('editor sees ＋ Add photos and entering it lands in select mode from another tab', async ({ context, page }) => {
    await utils.setAuthCookies(context, editor.accessToken);
    await page.goto(`/spaces/${spaceId}/members`);
    await page.getByTestId('space-add-photos').click();
    await page.waitForURL(`/spaces/${spaceId}`);
    await expect(page.getByText(/add to/i)).toBeVisible();
  });

  test('Members is a tab, not a slide-in panel', async ({ context, page }) => {
    await utils.setAuthCookies(context, owner.accessToken);
    await page.goto(`/spaces/${spaceId}`);
    await expect(page.getByTestId('space-panel')).toHaveCount(0);
  });

  test('a direct People deep-link redirects to Photos when face recognition is off', async ({ context, page }) => {
    await utils.setAuthCookies(context, owner.accessToken);
    await page.goto(`/spaces/${spaceId}/people`);
    await page.waitForURL(`/spaces/${spaceId}`);
    await expect(page.getByTestId('space-tabs')).toBeVisible();
  });
});
```

- [ ] **Step 2: Run the spec**

With a dev stack up (`make dev`), run from `e2e/`:

```bash
pnpm exec playwright test src/specs/web/spaces-p1.e2e-spec.ts --project=web
```

Expected: the new `tabbed navigation` tests PASS. Fix selectors if the app markup differs.

- [ ] **Step 3: Commit**

```bash
git add e2e/src/specs/web/spaces-p1.e2e-spec.ts
git commit -m "test(e2e): web coverage for space tabbed navigation + role gating"
```

---

## Task 14: Final verification gate

- [ ] **Step 1: Full type + svelte check**

Run: `cd web && pnpm check:typescript && pnpm check:svelte`
Expected: zero errors.

- [ ] **Step 2: Full web unit suite**

Run (from `web/`): `pnpm test -- --run`
Expected: all green (including the new specs; deleted-component specs are gone).

- [ ] **Step 3: Lint (deferred full pass)**

Run: `cd web && pnpm lint`
Expected: zero warnings. Fix any unused imports left over from the refactors.

- [ ] **Step 4: e2e web suite**

With `make dev` up: `make e2e-web-dev`
Expected: the spaces specs pass.

- [ ] **Step 5: Manual smoke (real app)**

On a space as owner: tabs render; Photos cover collapses on scroll, tabs stay; ＋ Add photos works from each tab; ⋮ overflow items work (toggle timeline, delete, etc.); cover hover ✎ → change/reposition; People tab appears only when face recognition is enabled; Members tab shows list + role changes + invite + activity; Map opens `/map?spaceId=` and its back button returns; opening an album/person detail hides the cover+tabs. As viewer: no ＋, no owner overflow, read-only roles.

- [ ] **Step 6: Final commit (if any fixups)**

```bash
git add -A
git commit -m "chore(web): lint/cleanup for space tabbed navigation"
```

---

## Spec coverage check

- Shared `+layout` shell → Tasks 4, 6, 7, 9.
- Five-tab routing + gating + badges → Task 2 (+ wired in 7); People-hidden-when-face-rec-off → Tasks 2, 13; People deep-link redirect → Task 5 (load redirect) + Task 13 (e2e).
- Space deleted / access revoked mid-session → Task 4 (`+layout.ts` 403/404 redirect + test).
- Album badge without server change (layout `linkedAlbums`) → Tasks 4, 5, 7.
- App-bar actions only (＋Add + ⋮ overflow); role gating relocated → Task 6.
- Cover button-free + hover ✎ + Set-cover prompt → Task 8.
- Cover scroll-collapse via Timeline `onScroll`; tabs always pinned → Tasks 3, 8, 9.
- Cross-route intents (add-photos / change-cover) consumed once → Tasks 1, 6, 9.
- Selection-mode chrome hiding (`chromeHidden`) + reset on leave → Tasks 1, 6.
- Detail-route chrome suppression → Task 6 (`isDetailRoute`) + Task 7 unit test, verified in Task 14 smoke.
- Members tab from the panel (list + roles + invite + activity); panel removed → Tasks 5, 10, 12.
- People/Albums toolbars relocated into content → Task 6.
- Map reuses existing back affordance → Task 2 (link), Task 14 smoke.
- i18n for relocated strings → Task 11.
- Tests: unit (Tasks 1-4, 8, 10) + page-spec updates (Task 6, 9) + e2e (Task 13) + final gate (Task 14).
- Edge cases (no cover, zero counts, face-rec off, single member, stale intent, detail routes, narrow viewport): covered across Tasks 2, 8, 9, 13.
