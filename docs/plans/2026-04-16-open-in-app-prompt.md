# Open-in-App Prompt Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Build a top sticky banner that appears on mobile cold-entry to deep-linkable Gallery routes, prompting the user to open the link in the Gallery app via the `noodle-gallery://` URI scheme. Includes the supporting mobile-side `space` intent and dual-scheme branding so legacy `immich://` links continue to work after migration.

**Architecture:** Pure-helper module (`open-in-app.ts`) handles eligibility + deep-link construction. Svelte 5 component (`OpenInAppBanner.svelte`) mounts in `+layout.svelte`, driven by `$effect` against the user store and `afterNavigate` (skipping the `type: 'enter'` first-fire). One mobile-side intent and two branding-script changes. See the design doc at `docs/plans/2026-04-16-open-in-app-prompt-design.md` for the full rationale.

**Tech Stack:** SvelteKit 2 (Svelte 5 runes), `@immich/ui`, Tailwind CSS 4, Vitest + happy-dom + @testing-library/svelte for unit/component tests, Playwright for E2E. Flutter/Dart for the mobile change. Bash/sed/jq for branding.

**Conventions to honour (from CLAUDE.md and memory):**

- Server imports use `src/` alias; web uses `$lib/` alias. No relative imports.
- Prettier 120-char, single quotes, trailing commas, semicolons.
- ESLint zero-warnings policy.
- Web: `bg-light dark:bg-dark` design tokens (per `feedback_match_gallery_design.md`).
- Component tests must mock `@immich/ui` IconButton → Button to avoid Tooltip.Provider context error (per `feedback_iconbutton_test_mock.md`).
- i18n keys must be sorted via `pnpm --filter=immich-i18n format:fix` (per `feedback_i18n_key_sorting.md`).
- Don't run lint locally — let CI handle it. Only run type checks (per `feedback_lint_sequential.md`).
- All E2E component tests should use real-server flow, not mocks (per `feedback_e2e_mock_filterpanel.md`).
- Use `SvelteMap`/`SvelteSet` in `.svelte` files (per `feedback_svelte_map_lint.md`).
- Don't use `void 0` in source — use `undefined` (per `feedback_server_lint_rules.md`); test mocks may use `void 0 as any`.

---

## Task 1 — `pathToDeepLink` helper

**Files:**

- Create: `web/src/lib/utils/open-in-app.ts`
- Test: `web/src/lib/utils/open-in-app.spec.ts`

**Step 1: Write the failing test**

```ts
// web/src/lib/utils/open-in-app.spec.ts
import { describe, expect, it } from 'vitest';
import { pathToDeepLink } from './open-in-app';

const UUID = '550e8400-e29b-41d4-a716-446655440000';
const UUID2 = '6ba7b810-9dad-11d1-80b4-00c04fd430c8';

describe('pathToDeepLink', () => {
  it.each([
    [`/photos/${UUID}`, `immich://asset?id=${UUID}`],
    [`/albums/${UUID}`, `immich://album?id=${UUID}`],
    [`/albums/${UUID}/${UUID2}`, `immich://asset?id=${UUID2}`],
    [`/people/${UUID}`, `immich://people?id=${UUID}`],
    [`/memory/${UUID}`, `immich://memory?id=${UUID}`],
    [`/memory`, `immich://memory`],
    [`/spaces/${UUID}`, `immich://space?id=${UUID}`],
    [`/spaces/${UUID}/photos/${UUID2}`, `immich://asset?id=${UUID2}`],
  ])('maps %s → %s', (path, expected) => {
    expect(pathToDeepLink(path)).toBe(expected);
  });

  it.each([
    '/photos',
    '/photos/not-a-uuid',
    '/albums',
    '/spaces',
    '/share/abc123',
    '/map',
    '/admin/users',
    '/onboarding',
    '/auth/login',
    '/install',
  ])('returns null for ineligible path %s', (path) => {
    expect(pathToDeepLink(path)).toBeNull();
  });
});
```

**Step 2: Run test, verify it fails**

```bash
cd web && pnpm test -- --run src/lib/utils/open-in-app.spec.ts
```

Expected: FAIL — `pathToDeepLink` does not exist.

**Step 3: Implement minimal**

```ts
// web/src/lib/utils/open-in-app.ts

const UUID = '[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}';

const ROUTES: { regex: RegExp; build: (m: RegExpMatchArray) => string }[] = [
  // /spaces/:id/photos/:assetId — must come before /spaces/:id
  { regex: new RegExp(`^/spaces/${UUID}/photos/(${UUID})$`), build: (m) => `immich://asset?id=${m[1]}` },
  // /albums/:id/:assetId — must come before /albums/:id
  { regex: new RegExp(`^/albums/${UUID}/(${UUID})$`), build: (m) => `immich://asset?id=${m[1]}` },
  { regex: new RegExp(`^/photos/(${UUID})$`), build: (m) => `immich://asset?id=${m[1]}` },
  { regex: new RegExp(`^/albums/(${UUID})$`), build: (m) => `immich://album?id=${m[1]}` },
  { regex: new RegExp(`^/people/(${UUID})$`), build: (m) => `immich://people?id=${m[1]}` },
  { regex: new RegExp(`^/memory/(${UUID})$`), build: (m) => `immich://memory?id=${m[1]}` },
  { regex: new RegExp(`^/spaces/(${UUID})$`), build: (m) => `immich://space?id=${m[1]}` },
  { regex: /^\/memory$/, build: () => `immich://memory` },
];

export const pathToDeepLink = (pathname: string): string | null => {
  for (const { regex, build } of ROUTES) {
    const match = pathname.match(regex);
    if (match) return build(match);
  }
  return null;
};
```

**Step 4: Run test, verify it passes**

```bash
cd web && pnpm test -- --run src/lib/utils/open-in-app.spec.ts
```

Expected: PASS — all rows green.

**Step 5: Commit**

```bash
git add web/src/lib/utils/open-in-app.ts web/src/lib/utils/open-in-app.spec.ts
git commit -m "feat(web): add pathToDeepLink helper for open-in-app banner"
```

---

## Task 2 — `detectPlatform` helper

**Files:**

- Modify: `web/src/lib/utils/open-in-app.ts`
- Modify: `web/src/lib/utils/open-in-app.spec.ts`

**Step 1: Write failing test (append to spec)**

```ts
import { detectPlatform } from './open-in-app';

const UA = {
  iPhone: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15',
  iPadOld: 'Mozilla/5.0 (iPad; CPU OS 12_0 like Mac OS X) AppleWebKit/605.1.15',
  iPadAsMac: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 Version/17.0 Safari/605.1.15',
  pixel:
    'Mozilla/5.0 (Linux; Android 14; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36',
  desktopChrome:
    'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  desktopSafari: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 Version/17.0 Safari/605.1.15',
};

describe('detectPlatform', () => {
  it('detects iPhone as ios', () => expect(detectPlatform(UA.iPhone, 0)).toBe('ios'));
  it('detects classic iPad as ios', () => expect(detectPlatform(UA.iPadOld, 0)).toBe('ios'));
  it('detects modern iPad-as-Mac (touch points > 1) as ios', () => expect(detectPlatform(UA.iPadAsMac, 5)).toBe('ios'));
  it('detects desktop Safari (touch points = 0) as null', () => expect(detectPlatform(UA.desktopSafari, 0)).toBeNull());
  it('detects Pixel as android', () => expect(detectPlatform(UA.pixel, 5)).toBe('android'));
  it('detects desktop Chrome as null', () => expect(detectPlatform(UA.desktopChrome, 0)).toBeNull());
});
```

**Step 2: Run test, verify it fails (`detectPlatform is not a function`).**

**Step 3: Implement**

```ts
// append to web/src/lib/utils/open-in-app.ts
export type Platform = 'ios' | 'android';

export const detectPlatform = (userAgent: string, maxTouchPoints: number): Platform | null => {
  if (/iPhone|iPod|iPad/i.test(userAgent)) return 'ios';
  if (maxTouchPoints > 1 && /Macintosh/i.test(userAgent)) return 'ios';
  if (/Android/i.test(userAgent)) return 'android';
  return null;
};
```

**Step 4: Run test, verify it passes.**

**Step 5: Commit**

```bash
git add web/src/lib/utils/open-in-app.ts web/src/lib/utils/open-in-app.spec.ts
git commit -m "feat(web): add detectPlatform helper with iPad-as-Mac fallback"
```

---

## Task 3 — `parseDismissedUntil` helper

**Files:**

- Modify: `web/src/lib/utils/open-in-app.ts`
- Modify: `web/src/lib/utils/open-in-app.spec.ts`

**Step 1: Write failing test**

```ts
import { isDismissed } from './open-in-app';

describe('isDismissed', () => {
  const NOW = new Date('2026-04-16T12:00:00Z');

  it('returns false when value is null', () => expect(isDismissed(null, NOW)).toBe(false));
  it('returns false when expiry is in the past', () => expect(isDismissed('2026-04-15T12:00:00Z', NOW)).toBe(false));
  it('returns true when expiry is in the future', () => expect(isDismissed('2026-05-16T12:00:00Z', NOW)).toBe(true));
  it('returns false when value is malformed (graceful)', () => expect(isDismissed('not-a-date', NOW)).toBe(false));
  it('returns false when value is empty string', () => expect(isDismissed('', NOW)).toBe(false));
});
```

**Step 2: Run, verify fail.**

**Step 3: Implement**

```ts
export const isDismissed = (value: string | null, now: Date): boolean => {
  if (!value) return false;
  const ts = Date.parse(value);
  if (Number.isNaN(ts)) return false;
  return ts > now.getTime();
};
```

**Step 4: Run, verify pass.**

**Step 5: Commit**

```bash
git add web/src/lib/utils/open-in-app.ts web/src/lib/utils/open-in-app.spec.ts
git commit -m "feat(web): add isDismissed helper with graceful fallback"
```

---

## Task 4 — `isEligible` orchestration

**Files:**

- Modify: `web/src/lib/utils/open-in-app.ts`
- Modify: `web/src/lib/utils/open-in-app.spec.ts`

**Step 1: Write failing test**

```ts
import { isEligible } from './open-in-app';

describe('isEligible', () => {
  const NOW = new Date('2026-04-16T12:00:00Z');
  const UUID = '550e8400-e29b-41d4-a716-446655440000';

  const baseOpts = {
    userAgent: UA.iPhone,
    maxTouchPoints: 0,
    pathname: `/photos/${UUID}`,
    isAuthenticated: true,
    coldEntry: true,
    dismissedUntil: null,
    now: NOW,
  };

  it('returns eligible with deep link + platform when all gates pass', () => {
    const result = isEligible(baseOpts);
    expect(result).toEqual({ eligible: true, platform: 'ios', deepLink: `immich://asset?id=${UUID}` });
  });

  it.each([
    ['cold entry false', { coldEntry: false }],
    ['unauthenticated', { isAuthenticated: false }],
    ['dismissed in future', { dismissedUntil: '2026-05-16T12:00:00Z' }],
    ['desktop UA', { userAgent: UA.desktopChrome }],
    ['unmatched route', { pathname: '/share/abc' }],
    ['invalid uuid in path', { pathname: '/photos/not-a-uuid' }],
  ])('returns ineligible when %s', (_label, override) => {
    expect(isEligible({ ...baseOpts, ...override })).toEqual({ eligible: false });
  });
});
```

**Step 2: Run, verify fail.**

**Step 3: Implement**

```ts
export type Eligibility = { eligible: false } | { eligible: true; deepLink: string; platform: Platform };

export interface EligibilityOpts {
  userAgent: string;
  maxTouchPoints: number;
  pathname: string;
  isAuthenticated: boolean;
  coldEntry: boolean;
  dismissedUntil: string | null;
  now: Date;
}

export const isEligible = (opts: EligibilityOpts): Eligibility => {
  if (!opts.coldEntry) return { eligible: false };
  if (!opts.isAuthenticated) return { eligible: false };
  if (isDismissed(opts.dismissedUntil, opts.now)) return { eligible: false };

  const platform = detectPlatform(opts.userAgent, opts.maxTouchPoints);
  if (!platform) return { eligible: false };

  const deepLink = pathToDeepLink(opts.pathname);
  if (!deepLink) return { eligible: false };

  return { eligible: true, platform, deepLink };
};
```

**Step 4: Run, verify pass.**

**Step 5: Commit**

```bash
git add web/src/lib/utils/open-in-app.ts web/src/lib/utils/open-in-app.spec.ts
git commit -m "feat(web): add isEligible orchestration for open-in-app banner"
```

---

## Task 5 — Constants for store URLs

**Files:**

- Modify: `web/src/lib/constants.ts`

**Step 1: Add constants**

```ts
// append to web/src/lib/constants.ts
export const IOS_APP_STORE_URL = 'https://apps.apple.com/app/id6761776289';
export const ANDROID_INSTALL_URL = '/install';
```

**Step 2: Type-check**

```bash
cd web && pnpm check
```

Expected: PASS, zero errors.

**Step 3: Commit**

```bash
git add web/src/lib/constants.ts
git commit -m "feat(web): add IOS_APP_STORE_URL and ANDROID_INSTALL_URL constants"
```

---

## Task 6 — `/install` route as thin wrapper

**Files:**

- Create: `web/src/routes/(user)/install/+page.svelte`

**Step 1: Create page**

```svelte
<!-- web/src/routes/(user)/install/+page.svelte -->
<script lang="ts">
  import OnboardingMobileApp from '$lib/components/onboarding-page/onboarding-mobile-app.svelte';
  import { t } from 'svelte-i18n';
</script>

<svelte:head>
  <title>{$t('install_app_title')}</title>
</svelte:head>

<div class="mx-auto max-w-2xl p-6">
  <OnboardingMobileApp />
</div>
```

NOTE: do NOT add a `+page.ts` — i18n strings aren't available reliably at SvelteKit `load` time, so resolving the title via `$t` inside `<svelte:head>` is correct. Verified at `web/src/lib/components/onboarding-page/onboarding-mobile-app.svelte`.

**Step 2: Manual smoke check**

Run dev (if not running): `make dev`. Browse to `http://localhost:2283/install`. Expected: page renders the existing onboarding mobile-app content (Obtainium / GitHub releases / direct APK link).

**Step 3: Commit**

```bash
git add web/src/routes/\(user\)/install/
git commit -m "feat(web): add /install route wrapping OnboardingMobileApp"
```

---

## Task 7 — i18n keys + Gallery overrides

**Files:**

- Modify: `i18n/en.json` (the source-of-truth; there is NO `i18n/src/` directory)
- Modify: `branding/i18n/overrides-en.json`

**Step 1: Add source keys (Immich-branded)**

Add the following keys (alphabetically inserted; the `pnpm format:fix` step at the end will sort precisely):

```json
{
  "open_in_app_banner_title": "Open in Immich",
  "open_in_app_banner_subtitle": "Better in the app",
  "open_in_app_banner_open": "Open",
  "open_in_app_banner_get_app": "Don't have the app?",
  "open_in_app_banner_dismiss": "Dismiss banner",
  "install_app_title": "Install the app"
}
```

**Step 2: Add Gallery overrides**

```json
{
  "open_in_app_banner_title": "Open in Noodle Gallery",
  "open_in_app_banner_subtitle": "Better in the app",
  "open_in_app_banner_open": "Open",
  "open_in_app_banner_get_app": "Don't have the app?",
  "open_in_app_banner_dismiss": "Dismiss banner",
  "install_app_title": "Install Noodle Gallery"
}
```

NOTE: only the title/install copy actually differs; including all keys for clarity.

**Step 3: Sort + format**

```bash
pnpm --filter=immich-i18n format:fix
```

Expected: file rewritten with sorted keys, no errors.

**Step 4: Commit**

```bash
git add i18n/en.json branding/i18n/overrides-en.json
git commit -m "feat(i18n): add open-in-app banner strings + Gallery overrides"
```

---

## Task 8 — Banner skeleton: render-when-eligible + render-nothing-when-not

**Files:**

- Create: `web/src/lib/components/shared-components/open-in-app-banner.svelte`
- Create: `web/src/lib/components/shared-components/open-in-app-banner.spec.ts`

**Step 1: Write failing test**

```ts
// web/src/lib/components/shared-components/open-in-app-banner.spec.ts
import { render, screen } from '@testing-library/svelte';
import { tick } from 'svelte';
import { writable } from 'svelte/store';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// Mock @immich/ui IconButton → Button to avoid Tooltip.Provider context error
vi.mock('@immich/ui', async () => {
  const actual = await vi.importActual<typeof import('@immich/ui')>('@immich/ui');
  return { ...actual, IconButton: actual.Button };
});

// Mock $app/navigation
vi.mock('$app/navigation', () => ({
  afterNavigate: vi.fn(),
}));

// Mock user store
const userStore = writable<{ id: string } | null>({ id: 'user-1' });
vi.mock('$lib/stores/user.store', () => ({ user: userStore }));

// Mock $app/state page (read pathname)
const pageState = { url: { pathname: '/photos/550e8400-e29b-41d4-a716-446655440000' } };
vi.mock('$app/state', () => ({ page: pageState }));

import OpenInAppBanner from './open-in-app-banner.svelte';

describe('OpenInAppBanner', () => {
  beforeEach(() => {
    userStore.set({ id: 'user-1' });
    pageState.url.pathname = '/photos/550e8400-e29b-41d4-a716-446655440000';
    localStorage.clear();
    Object.defineProperty(navigator, 'userAgent', {
      value: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)',
      configurable: true,
    });
    Object.defineProperty(navigator, 'maxTouchPoints', { value: 5, configurable: true });
  });

  it('renders the banner when all gates pass', async () => {
    render(OpenInAppBanner);
    await tick();
    expect(screen.getByRole('region', { name: /mobile app suggestion/i })).toBeInTheDocument();
    const openLink = screen.getByRole('link', { name: /open/i });
    expect(openLink).toHaveAttribute('href', expect.stringMatching(/^immich:\/\/asset\?id=/));
  });

  it('renders nothing when path does not match a deep-link route', async () => {
    pageState.url.pathname = '/admin/users';
    render(OpenInAppBanner);
    await tick();
    expect(screen.queryByRole('region', { name: /mobile app suggestion/i })).not.toBeInTheDocument();
  });
});
```

**Step 2: Run, verify fail (component doesn't exist).**

```bash
cd web && pnpm test -- --run src/lib/components/shared-components/open-in-app-banner.spec.ts
```

**Step 3: Implement minimal**

```svelte
<!-- web/src/lib/components/shared-components/open-in-app-banner.svelte -->
<script lang="ts">
  import { browser } from '$app/environment';
  import { afterNavigate } from '$app/navigation';
  import { page } from '$app/state';
  import { ANDROID_INSTALL_URL, IOS_APP_STORE_URL } from '$lib/constants';
  import { user } from '$lib/stores/user.store';
  import { isEligible, type Eligibility } from '$lib/utils/open-in-app';
  import { Button, IconButton } from '@immich/ui';
  import { mdiClose } from '@mdi/js';
  import { onMount } from 'svelte';
  import { t } from 'svelte-i18n';

  const DISMISSAL_KEY = 'gallery.openInApp.dismissedUntil';
  const DISMISSAL_DAYS = 30;

  let coldEntry = $state(true);
  let visible = $state(false);

  let eligibility: Eligibility = $derived.by(() => {
    if (!browser) return { eligible: false };
    return isEligible({
      userAgent: navigator.userAgent,
      maxTouchPoints: navigator.maxTouchPoints,
      pathname: page.url.pathname,
      isAuthenticated: !!$user,
      coldEntry,
      dismissedUntil: localStorage.getItem(DISMISSAL_KEY),
      now: new Date(),
    });
  });

  $effect(() => {
    if (eligibility.eligible) visible = true;
  });

  afterNavigate(({ type }) => {
    if (type === 'enter') return; // first-fire on cold load
    coldEntry = false;
    visible = false;
  });

  const dismiss = () => {
    const until = new Date(Date.now() + DISMISSAL_DAYS * 24 * 60 * 60 * 1000);
    localStorage.setItem(DISMISSAL_KEY, until.toISOString());
    visible = false;
  };

  const getAppHref = (platform: 'ios' | 'android') =>
    platform === 'ios' ? IOS_APP_STORE_URL : ANDROID_INSTALL_URL;
</script>

{#if visible && eligibility.eligible}
  <div role="region" aria-label="Mobile app suggestion" class="fixed inset-x-0 top-0 z-40 bg-light">
    <a href={eligibility.deepLink} role="button">{$t('open_in_app_banner_open')}</a>
    <a href={getAppHref(eligibility.platform)}>{$t('open_in_app_banner_get_app')}</a>
    <IconButton aria-label={$t('open_in_app_banner_dismiss')} icon={mdiClose} onclick={dismiss} />
  </div>
{/if}
```

NOTE: this is the minimal markup to pass Step 2 tests. Visual styling is task 12.

**Step 4: Run, verify pass.**

**Step 5: Commit**

```bash
git add web/src/lib/components/shared-components/open-in-app-banner.svelte web/src/lib/components/shared-components/open-in-app-banner.spec.ts
git commit -m "feat(web): scaffold OpenInAppBanner with eligibility gating"
```

---

## Task 9 — Banner: auth-late race ($effect re-eval)

**Files:**

- Modify: `web/src/lib/components/shared-components/open-in-app-banner.spec.ts`

**Step 1: Add failing test**

```ts
it('appears after auth resolves (auth-late race)', async () => {
  userStore.set(null);
  render(OpenInAppBanner);
  await tick();
  expect(screen.queryByRole('region', { name: /mobile app suggestion/i })).not.toBeInTheDocument();

  userStore.set({ id: 'user-1' });
  await tick();
  expect(screen.getByRole('region', { name: /mobile app suggestion/i })).toBeInTheDocument();
});
```

**Step 2: Run; should ALREADY pass** because `$derived.by` re-runs when `$user` changes and `$effect` flips `visible` true.

If it does not pass, audit the `$derived.by` reactivity — the issue is most often that `$user` is read inside an unreactive helper rather than directly in the `$derived.by` closure.

**Step 3: Commit**

```bash
git add web/src/lib/components/shared-components/open-in-app-banner.spec.ts
git commit -m "test(web): cover auth-late race for OpenInAppBanner"
```

---

## Task 10 — Banner: `afterNavigate` first-fire skip

**Files:**

- Modify: `web/src/lib/components/shared-components/open-in-app-banner.spec.ts`

**Step 1: Add failing test**

Replace the `vi.mock('$app/navigation', ...)` factory with a controllable spy:

```ts
let afterNavigateCallback: ((nav: { type: string }) => void) | undefined;
vi.mock('$app/navigation', () => ({
  afterNavigate: (cb: (nav: { type: string }) => void) => {
    afterNavigateCallback = cb;
  },
}));
```

Add the test:

```ts
it('does not hide on the initial enter-fire of afterNavigate', async () => {
  render(OpenInAppBanner);
  await tick();
  expect(screen.getByRole('region', { name: /mobile app suggestion/i })).toBeInTheDocument();

  afterNavigateCallback!({ type: 'enter' });
  await tick();
  expect(screen.getByRole('region', { name: /mobile app suggestion/i })).toBeInTheDocument();
});

it('hides on subsequent navigation', async () => {
  render(OpenInAppBanner);
  await tick();
  afterNavigateCallback!({ type: 'link' });
  await tick();
  expect(screen.queryByRole('region', { name: /mobile app suggestion/i })).not.toBeInTheDocument();
});
```

**Step 2: Run; should pass** if the implementation already has the `if (type === 'enter') return;` guard. If not, fix.

**Step 3: Commit**

```bash
git add web/src/lib/components/shared-components/open-in-app-banner.spec.ts
git commit -m "test(web): cover afterNavigate enter-skip for OpenInAppBanner"
```

---

## Task 11 — Banner: dismiss writes localStorage 30d

**Files:**

- Modify: `web/src/lib/components/shared-components/open-in-app-banner.spec.ts`

**Step 1: Add failing test**

```ts
import { fireEvent } from '@testing-library/svelte';

it('dismiss writes localStorage with ~30 day expiry', async () => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-04-16T12:00:00Z'));

  render(OpenInAppBanner);
  await tick();

  const dismiss = screen.getByRole('button', { name: /dismiss banner/i });
  await fireEvent.click(dismiss);
  await tick();

  expect(screen.queryByRole('region', { name: /mobile app suggestion/i })).not.toBeInTheDocument();

  const stored = localStorage.getItem('gallery.openInApp.dismissedUntil');
  expect(stored).toBe('2026-05-16T12:00:00.000Z');

  vi.useRealTimers();
});

it('does not render when dismissal is in the future', async () => {
  const future = new Date(Date.now() + 1000 * 60 * 60 * 24 * 7).toISOString();
  localStorage.setItem('gallery.openInApp.dismissedUntil', future);
  render(OpenInAppBanner);
  await tick();
  expect(screen.queryByRole('region', { name: /mobile app suggestion/i })).not.toBeInTheDocument();
});
```

**Step 2: Run; should pass** with the existing `dismiss()` implementation.

**Step 3: Commit**

```bash
git add web/src/lib/components/shared-components/open-in-app-banner.spec.ts
git commit -m "test(web): cover dismiss + dismissal expiry for OpenInAppBanner"
```

---

## Task 12 — Banner styling refinement (visual + reduced-motion)

**Files:**

- Modify: `web/src/lib/components/shared-components/open-in-app-banner.svelte`

**Step 1: Replace minimal markup with refined design**

Replace the `{#if visible && eligibility.eligible}` block with the full UI per the design doc Section 3:

```svelte
{#if visible && eligibility.eligible}
  <div
    role="region"
    aria-label="Mobile app suggestion"
    class="fixed inset-x-0 top-0 z-40 border-b border-light-100 bg-light shadow-sm motion-safe:animate-slide-down dark:border-dark-100 dark:bg-dark"
  >
    <div class="flex items-center gap-3 px-3 py-2">
      <img
        src="/apple-icon-180.png"
        alt=""
        class="h-12 w-12 flex-shrink-0 rounded-xl shadow-sm ring-1 ring-light/10 dark:ring-dark/10"
      />
      <div class="min-w-0 flex-1">
        <p class="truncate text-base font-semibold leading-tight">
          {$t('open_in_app_banner_title')}
        </p>
        <p class="truncate text-xs text-subtle sm:hidden">
          {$t('open_in_app_banner_subtitle')}
        </p>
      </div>
      <Button href={eligibility.deepLink} size="small" class="flex-shrink-0">
        {$t('open_in_app_banner_open')}
      </Button>
      <IconButton
        aria-label={$t('open_in_app_banner_dismiss')}
        icon={mdiClose}
        variant="ghost"
        size="small"
        onclick={dismiss}
      />
    </div>
    <div class="flex justify-end px-3 pb-2 sm:hidden">
      <a href={getAppHref(eligibility.platform)} class="text-xs text-subtle underline underline-offset-2">
        {$t('open_in_app_banner_get_app')}
      </a>
    </div>
  </div>
  <div aria-hidden="true" class="h-[88px] sm:h-[56px]"></div>
{/if}
```

NOTES:

- The icon path `/apple-icon-180.png` is the standard upstream PWA asset already in `web/static/` (verified). Don't reference the fork-only `gallery-logo-mark.svg` — it would surprise upstream rebases.
- Default body text colour comes from the layout — no `text-text` class (it doesn't exist in `@immich/ui`'s theme). Verified tokens in this banner: `bg-light/dark`, `border-light-100/dark-100`, `text-subtle`, `ring-light/dark`. Do NOT add `text-text`.
- `Button` from `@immich/ui` accepts an `href` prop for anchor rendering — confirmed by `web/src/lib/components/import/import-progress-step.svelte`.

Add a tiny CSS keyframe (Tailwind's `motion-safe:` variant already wraps the keyframe in the `prefers-reduced-motion: no-preference` media query — no separate `@media` override needed):

```svelte
<style>
  @keyframes slide-down {
    from {
      transform: translateY(-100%);
    }
    to {
      transform: translateY(0);
    }
  }
  :global(.motion-safe\:animate-slide-down) {
    animation: slide-down 0.28s cubic-bezier(0.32, 0.72, 0, 1);
  }
</style>
```

NOTE: `motion-safe:` in Tailwind 4 only applies the class when `prefers-reduced-motion: no-preference` matches. Users with reduced-motion preference get no animation automatically.

**Step 2: Type-check**

```bash
cd web && pnpm check
```

Expected: PASS.

**Step 3: Re-run all banner tests**

```bash
cd web && pnpm test -- --run src/lib/components/shared-components/open-in-app-banner.spec.ts
```

All tests still green.

**Step 4: Manual visual verification**

Start dev: `make dev`. Open Chrome DevTools → device emulation → iPhone 13 → navigate to `http://localhost:2283/photos/<an-asset-id>`. Banner should appear at top, slide-down animation visible.

Verify:

- 88px banner on iPhone, 56px on tablet/desktop emulation widths.
- Dismiss × works.
- Tap "Open" — Chrome DevTools shows it would launch `noodle-gallery://...` (won't actually open native app in DevTools).
- Toggle DevTools → Rendering → "Emulate CSS media feature prefers-reduced-motion" → "reduce" — banner appears without slide.

**Step 5: Commit**

```bash
git add web/src/lib/components/shared-components/open-in-app-banner.svelte
git commit -m "feat(web): refined two-row UI with slide-in for OpenInAppBanner"
```

---

## Task 13 — Mount banner in `+layout.svelte`

**Files:**

- Modify: `web/src/routes/+layout.svelte`

**Step 1: Edit**

Add an import near other component imports:

```ts
import OpenInAppBanner from '$lib/components/shared-components/open-in-app-banner.svelte';
```

Inside the `<TooltipProvider>` block, ABOVE `{@render children?.()}`:

```svelte
<TooltipProvider>
  <OpenInAppBanner />
  {#if page.data.error}
    <ErrorLayout error={page.data.error}></ErrorLayout>
  {:else}
    {@render children?.()}
  {/if}
  ...
</TooltipProvider>
```

**Step 2: Type-check + run web tests**

```bash
cd web && pnpm check && pnpm test -- --run
```

Expected: PASS, no regressions.

**Step 3: Manual smoke test**

Restart dev if running. Navigate to a deep-link route on mobile emulation — banner shows. Click an asset thumbnail to navigate within app — banner hides (and stays hidden on subsequent navigation in same tab session).

**Step 4: Commit**

```bash
git add web/src/routes/+layout.svelte
git commit -m "feat(web): mount OpenInAppBanner in root layout"
```

---

## Task 14 — Mobile `space` intent in `deep_link.service.dart`

**Files:**

- Modify: `mobile/lib/services/deep_link.service.dart`

**Step 1: Locate the right Riverpod provider + auto_route for the space view**

Grep `mobile/lib/` for "Space" / "SpaceRoute":

```bash
cd mobile && grep -rn "SpaceRoute\|spaceProvider\|SharedSpaceRoute" lib/ | head -20
```

Identify (a) the provider used by the bottom-nav Spaces tab to fetch a space by ID, and (b) the auto_route that opens a single space. Likely names: `RemoteSpaceRoute`, `DriftSpaceRoute`, or similar — verify against the actual code.

**Step 2: Add the intent + builder**

Add to the `intent` switch in `handleScheme`:

```dart
"space" => await _buildSpaceDeepLink(queryParams['id'] ?? ''),
```

Add the builder method (modeled after `_buildAlbumDeepLink`):

```dart
Future<PageRouteInfo?> _buildSpaceDeepLink(String spaceId) async {
  if (Store.isBetaTimelineEnabled == false) {
    return null;
  }
  // Replace with the actual provider + route name from Step 1
  final space = await _someSpaceService.get(spaceId);
  if (space == null) return null;
  return SpaceRoute(space: space);
}
```

Inject any new service via the constructor + provider just like `_betaRemoteAlbumService` etc. is wired.

**Step 3: Add a unit test for the new intent (REQUIRED, not optional)**

Look for an existing test file:

```bash
cd mobile && find test -name 'deep_link*' -o -name '*deep*link*'
```

If one exists, mirror the album case to assert that `handleScheme` parses `noodle-gallery://space?id=<uuid>` and returns the expected `PageRouteInfo`. Mock the space provider/service.

If no test file exists yet, create `mobile/test/services/deep_link_service_test.dart` with a minimal Riverpod test using `ProviderContainer` overrides. Pattern from any other service test in `mobile/test/services/`. Test cases:

- `handleScheme(immich://space?id=<known-id>, ...)` → returns the expected route.
- `handleScheme(immich://space?id=, ...)` → returns `DeepLink.defaultPath` on cold start, `DeepLink.none` otherwise.
- Same two cases with `noodle-gallery://space?id=...` to confirm scheme-agnostic behaviour.

Run: `cd mobile && flutter test test/services/deep_link_service_test.dart`.

**Step 4: Commit**

```bash
git add mobile/lib/services/deep_link.service.dart
git commit -m "feat(mobile): add space intent to deep-link service"
```

---

## Task 15 — Branding: additive Android/iOS scheme rule

**Files:**

- Modify: `branding/scripts/apply-branding.sh`

**Step 1: Locate existing scheme replacement lines**

```bash
grep -n 'android:scheme="immich"\|<string>immich</string>' branding/scripts/apply-branding.sh
```

Expected output: two lines around 371 and 420 (per earlier exploration).

**Step 2: Replace REPLACE with ADD**

The current Android line:

```bash
sed -i "s|<data android:scheme=\"immich\"|<data android:scheme=\"${DEEP_LINK_SCHEME}\"|g" "$manifest"
```

Becomes additive (insert a new `<data>` next to the existing one rather than rewriting it):

```bash
# Add a second <data> entry alongside the existing immich one.
# Idempotent: only inserts if not already present.
if ! grep -q "android:scheme=\"${DEEP_LINK_SCHEME}\"" "$manifest"; then
  sed -i "s|<data android:scheme=\"immich\" />|<data android:scheme=\"immich\" />\n          <data android:scheme=\"${DEEP_LINK_SCHEME}\" />|g" "$manifest"
fi
```

NOTE: verify the EXACT current line in `AndroidManifest.xml` (whitespace, self-closing slash position) before running. Adjust the sed pattern accordingly.

The current iOS line:

```bash
sed -i "s|<string>immich</string>|<string>${DEEP_LINK_SCHEME}</string>|g" "$info_plist"
```

Becomes additive:

```bash
if ! grep -q "<string>${DEEP_LINK_SCHEME}</string>" "$info_plist"; then
  sed -i "s|<string>immich</string>|<string>immich</string>\n      <string>${DEEP_LINK_SCHEME}</string>|" "$info_plist"
fi
```

NOTE: only replace the FIRST `<string>immich</string>` (the one inside CFBundleURLSchemes), not all occurrences. The `sed -i` without `g` does first-match. Verify by reading the Info.plist around line 104-106.

**Step 3: Test by running the script in a temp copy**

```bash
# In a scratch directory:
cp -r mobile/android/app/src/main/AndroidManifest.xml /tmp/manifest-test.xml
# Manually run the new sed line on /tmp/manifest-test.xml and inspect
diff mobile/android/app/src/main/AndroidManifest.xml /tmp/manifest-test.xml
```

Expected diff: a new `<data android:scheme="noodle-gallery" />` line inserted directly after the existing `<data android:scheme="immich" />`.

Do the same dry run for Info.plist.

**Step 4: Commit**

```bash
git add branding/scripts/apply-branding.sh
git commit -m "feat(branding): register noodle-gallery:// alongside immich:// (additive)"
```

---

## Task 16 — Branding: rewrite web `immich://` → `noodle-gallery://`

**Files:**

- Modify: `branding/scripts/apply-branding.sh`

**Step 1: Add a new sed rule**

In `apply-branding.sh`, inside `patch_web()`, add:

```bash
# Rewrite the open-in-app deep-link scheme from immich:// to ${DEEP_LINK_SCHEME}://
sed -i "s|immich://|${DEEP_LINK_SCHEME}://|g" "$REPO_ROOT/web/src/lib/utils/open-in-app.ts"
```

**Step 2: Dry-run**

```bash
cp web/src/lib/utils/open-in-app.ts /tmp/open-in-app-test.ts
sed -i "s|immich://|noodle-gallery://|g" /tmp/open-in-app-test.ts
diff web/src/lib/utils/open-in-app.ts /tmp/open-in-app-test.ts
```

Expected diff: every `immich://` in the route table is replaced with `noodle-gallery://`.

**Step 3: Commit**

```bash
git add branding/scripts/apply-branding.sh
git commit -m "feat(branding): rewrite web open-in-app scheme to noodle-gallery"
```

---

## Task 17 — Branding verification assertions

**Files:**

- Modify: `branding/scripts/verify-branding.sh`

**Step 1: Add post-branding assertions**

Append to `verify-branding.sh`:

```bash
# --- Open-in-app banner verification ---

# Web should no longer contain immich:// after branding
if grep -q 'immich://' "$REPO_ROOT/web/src/lib/utils/open-in-app.ts"; then
  echo "FAIL: web open-in-app.ts still contains immich:// after branding"
  exit 1
fi
if ! grep -q "${DEEP_LINK_SCHEME}://" "$REPO_ROOT/web/src/lib/utils/open-in-app.ts"; then
  echo "FAIL: web open-in-app.ts missing ${DEEP_LINK_SCHEME}:// after branding"
  exit 1
fi

# Android manifest should have BOTH schemes registered
manifest="$REPO_ROOT/mobile/android/app/src/main/AndroidManifest.xml"
if ! grep -q 'android:scheme="immich"' "$manifest"; then
  echo "FAIL: AndroidManifest.xml missing immich:// scheme (legacy)"
  exit 1
fi
if ! grep -q "android:scheme=\"${DEEP_LINK_SCHEME}\"" "$manifest"; then
  echo "FAIL: AndroidManifest.xml missing ${DEEP_LINK_SCHEME}:// scheme (brand)"
  exit 1
fi

# iOS Info.plist should have BOTH schemes
info_plist="$REPO_ROOT/mobile/ios/Runner/Info.plist"
if ! grep -q '<string>immich</string>' "$info_plist"; then
  echo "FAIL: Info.plist missing immich scheme (legacy)"
  exit 1
fi
if ! grep -q "<string>${DEEP_LINK_SCHEME}</string>" "$info_plist"; then
  echo "FAIL: Info.plist missing ${DEEP_LINK_SCHEME} scheme (brand)"
  exit 1
fi

echo "  Open-in-app scheme registration verified"
```

**Step 2: Manually run the full branding+verify cycle in an isolated worktree copy**

To avoid risking local changes, run in a fresh worktree:

```bash
# From the worktree root:
WORK=$(mktemp -d)
git clone --branch HEAD --depth 1 . "$WORK"
cd "$WORK"
./branding/scripts/apply-branding.sh
./branding/scripts/verify-branding.sh
cd -
rm -rf "$WORK"
```

Expected: verify-branding exits 0 with "Open-in-app scheme registration verified" line. No mutation to the working repo.

**Step 3: Commit**

```bash
git add branding/scripts/verify-branding.sh
git commit -m "test(branding): verify dual-scheme registration after branding"
```

---

## Task 18 — E2E spec for the banner

**Files:**

- Create: `e2e/src/specs/web/open-in-app-banner.e2e-spec.ts`

The actual file naming convention is `<topic>.e2e-spec.ts` under `e2e/src/specs/web/` (verified against `e2e/src/specs/web/album.e2e-spec.ts`). Utility API: `utils.initSdk()`, `utils.resetDatabase()`, `utils.adminSetup()`, `utils.setAuthCookies(context, accessToken)`, asset path via `${testAssetDir}/...`. Both come from `'src/utils'`.

**Step 1: Write E2E**

```ts
// e2e/src/specs/web/open-in-app-banner.e2e-spec.ts
import { type LoginResponseDto } from '@immich/sdk';
import { devices, expect, test } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { testAssetDir, utils } from 'src/utils';

const SCHEME_RX = /^(immich|noodle-gallery):\/\/asset\?id=[0-9a-fA-F-]{36}$/;

test.describe('open-in-app banner', () => {
  let admin: LoginResponseDto;
  let assetId: string;

  test.beforeAll(async () => {
    utils.initSdk();
    await utils.resetDatabase();
    admin = await utils.adminSetup();
    const asset = await utils.createAsset(admin.accessToken, {
      assetData: {
        bytes: readFileSync(`${testAssetDir}/formats/jpg/el_torcal_rocks.jpg`),
        filename: 'el_torcal_rocks.jpg',
      },
    });
    assetId = asset.id;
  });

  test.describe('iPhone 13', () => {
    test.use({ ...devices['iPhone 13'] });

    test('renders on cold-nav to /photos/:id with the right deep link', async ({ context, page }) => {
      await utils.setAuthCookies(context, admin.accessToken);
      await page.goto(`/photos/${assetId}`);

      const banner = page.getByRole('region', { name: /mobile app suggestion/i });
      await expect(banner).toBeVisible();

      const openLink = banner.getByRole('link', { name: /^open$/i });
      await expect(openLink).toHaveAttribute('href', expect.stringMatching(SCHEME_RX));
    });

    test('hides on internal SPA navigation back to the timeline', async ({ context, page }) => {
      await utils.setAuthCookies(context, admin.accessToken);
      await page.goto(`/photos/${assetId}`);
      await expect(page.getByRole('region', { name: /mobile app suggestion/i })).toBeVisible();

      await page.goBack();
      await expect(page.getByRole('region', { name: /mobile app suggestion/i })).not.toBeVisible();
    });

    test('dismiss persists across reload', async ({ context, page }) => {
      await utils.setAuthCookies(context, admin.accessToken);
      await page.goto(`/photos/${assetId}`);
      await page.getByRole('button', { name: /dismiss banner/i }).click();
      await expect(page.getByRole('region', { name: /mobile app suggestion/i })).not.toBeVisible();

      await page.reload();
      await expect(page.getByRole('region', { name: /mobile app suggestion/i })).not.toBeVisible();
    });

    test('"Don\'t have the app?" routes to App Store on iOS', async ({ context, page }) => {
      await utils.setAuthCookies(context, admin.accessToken);
      await page.goto(`/photos/${assetId}`);
      const link = page.getByRole('link', { name: /don't have the app/i });
      await expect(link).toHaveAttribute('href', /apps\.apple\.com/);
    });
  });

  test.describe('Pixel 5', () => {
    test.use({ ...devices['Pixel 5'] });

    test('"Don\'t have the app?" routes to /install on Android', async ({ context, page }) => {
      await utils.setAuthCookies(context, admin.accessToken);
      await page.goto(`/photos/${assetId}`);
      const link = page.getByRole('link', { name: /don't have the app/i });
      await expect(link).toHaveAttribute('href', '/install');
    });
  });

  test.describe('desktop', () => {
    test('does not render banner on desktop', async ({ context, page }) => {
      await utils.setAuthCookies(context, admin.accessToken);
      await page.goto(`/photos/${assetId}`);
      await expect(page.getByRole('region', { name: /mobile app suggestion/i })).not.toBeVisible();
    });
  });
});
```

NOTE on `utils.createAsset`: this is the canonical upload helper used across the e2e suite. If the actual signature differs slightly (it's a generated SDK call), grep `e2e/src/specs/web/*.e2e-spec.ts` for an existing `createAsset` call and copy that shape exactly.

**Step 2: Run E2E against a running dev stack**

```bash
# Terminal 1:
make dev

# Terminal 2:
make e2e-web-dev -- -g "open-in-app banner"
```

Expected: all e2e cases pass.

If individual tests are flaky on first run, re-run; if persistently flaky, do not skip — fix root cause (per `feedback_never_skip_tests.md`).

**Step 3: Commit**

```bash
git add e2e/src/specs/web/open-in-app-banner.e2e-spec.ts
git commit -m "test(e2e): cover open-in-app banner across devices"
```

---

## Task 19 — Final checks + push + PR

**Step 1: Run all web checks**

```bash
cd web && pnpm check && pnpm test -- --run
```

Expected: PASS, no warnings.

**Step 2: Verify branding cycle locally one more time** — use the same isolated mktemp-clone pattern from Task 17 so the working tree is never mutated:

```bash
WORK=$(mktemp -d)
git clone --branch HEAD --depth 1 . "$WORK"
(cd "$WORK" && ./branding/scripts/apply-branding.sh && ./branding/scripts/verify-branding.sh)
rm -rf "$WORK"
```

**Step 3: Push branch**

```bash
git push -u origin feat/open-in-app-prompt
```

**Step 4: Open PR**

```bash
gh pr create --title "feat: prompt to open Gallery links in the mobile app" --body "$(cat <<'EOF'
## Summary

- Adds a top sticky banner on mobile cold-entry to deep-linkable Gallery routes (photos, albums, people, memories, spaces, including the new `space` intent).
- Primary CTA launches `noodle-gallery://` (or `immich://` in dev/source); secondary "Don't have the app?" link routes to App Store on iOS or `/install` on Android.
- 30-day localStorage dismissal. Cold-entry-only — no banner on internal SPA navigation.
- Mobile-side: new `space` intent in `deep_link.service.dart`; branding script registers BOTH `immich://` and `noodle-gallery://` so legacy links survive the migration from upstream Immich.

## Design

See `docs/plans/2026-04-16-open-in-app-prompt-design.md`.

## Test plan

- [ ] Web unit tests pass (`cd web && pnpm test`)
- [ ] Web type check passes (`cd web && pnpm check`)
- [ ] E2E open-in-app banner suite passes on iPhone 13, Pixel 5, and desktop emulation
- [ ] Branding verify-branding.sh asserts dual-scheme registration
- [ ] Manual: install branded Gallery app on a phone, share `https://<your-instance>/photos/<id>` to chat, tap from chat — banner shows, "Open" launches the app at the correct asset
EOF
)"
```

**Step 5: Babysit CI** (per the babysit skill if it goes red).

---

## Coverage check (final)

| Design item                        | Covered by tasks |
| ---------------------------------- | ---------------- |
| Pure helpers + tests               | 1, 2, 3, 4       |
| Constants + install route          | 5, 6             |
| i18n + branding overrides          | 7                |
| Banner component + tests           | 8, 9, 10, 11     |
| Banner UI styling + reduced-motion | 12               |
| Layout integration                 | 13               |
| Mobile space intent                | 14               |
| Branding additive scheme           | 15               |
| Branding web scheme rewrite        | 16               |
| Branding verification              | 17               |
| E2E coverage                       | 18               |
| CI green + PR                      | 19               |
