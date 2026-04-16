# cmdk Navigation Provider + SWR Jitter Fix — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Extend the shipped cmdk palette with a navigation/commands provider (19 system settings + 5 admin pages + 11 user pages + 1 theme action, 36 items total), disable the competing `@immich/ui` global palette, and fix the skeleton-jitter bug on every keystroke via stale-while-revalidate.

**Architecture:** A new `navigation` key joins `photos/people/places/tags` in `GlobalSearchManager.sections`. The navigation provider filters a static item list via `computeCommandScore` from bits-ui (memoized per locale). Results are flat but grouped into four sub-sections at render time by a new `GlobalSearchNavigationSections` component. SWR rule: only `ok` sections preserve state on new queries; `idle/empty/error/timeout` still flip to `loading`. Navigation runs synchronously inside `setQuery`, bypassing the 150 ms debounce entirely. A single-line deletion of `commandPaletteManager.enable()` in `+layout.ts:25` reclaims `Ctrl+K` from `@immich/ui`.

**Tech Stack:** SvelteKit 2 + Svelte 5 (runes), `bits-ui` `Command` + `computeCommandScore`, `@immich/ui` `Modal`, svelte-i18n, vitest + @testing-library/svelte, Playwright.

**Design doc:** [`docs/plans/2026-04-13-cmdk-navigation-design.md`](./2026-04-13-cmdk-navigation-design.md) — read before starting. This plan implements that design.

**Worktree:** `.worktrees/cmdk-search-research` on branch `research/cmdk-search`. v1 of the palette is already shipped across 40 commits; this plan extends it. Run every task from the worktree root.

---

## Verified ground truth (trust these — checked against real source)

- **System settings accordions = 19.** Keys from `web/src/routes/admin/system-settings/+page.svelte`: `authentication, backup, image, job, external-library, logging, machine-learning, classification, location, metadata, nightly-tasks, notifications, server, storage-template, theme, trash, user-settings, version-check, video-transcoding`. Deep-link pattern: `/admin/system-settings?isOpen=<key>` (verified via `setting-accordion-state.svelte` reading `QueryParameter.IS_OPEN`). Keys are space-separated if multiple — one key per item is sufficient.
- **Accordion `title` / `subtitle` i18n keys** live under `admin.*` in `i18n/en.json` (e.g. `admin.classification_settings`, `admin.classification_settings_description`).
- **`@immich/ui` `commandPaletteManager.enable()` call site:** `web/src/routes/+layout.ts:25`. Deleting that one line unbinds `Ctrl+K` / `Cmd+K` / `/` for the whole document. Per-page `CommandPaletteDefaultProvider` mounts (19 files) stay in place as dead code for upstream-rebase safety.
- **Existing `Shift+T` theme toggle** rode along with the deleted `.enable()`. Re-register via `use:shortcut` in `+layout.svelte` next to the existing `Ctrl+Shift+M` binding.
- **`themeManager.toggleTheme()`** exists at `web/src/lib/managers/theme-manager.svelte.ts:53`. Exported as `themeManager` from the same file.
- **`bits-ui` exports `computeCommandScore` top-level** (verified at `node_modules/.pnpm/bits-ui@2.16.3*/node_modules/bits-ui/dist/index.js:1`). Signature: `computeCommandScore(command, search, commandKeywords?)` — keywords array is joined with spaces onto `command` (NOT a weighted-context array).
- **`svelte-i18n` exports `locale` as a `Writable<string>` store** — subscribe imperatively for invalidation, no reactive plumbing needed.
- **`cmdk.recent` store** already has five kinds (`query, photo, person, place, tag`). Adding a sixth (`navigate`) is a pure extension; no migration needed.
- **`ServerFeaturesDto`** fields (from `open-api/typescript-sdk/src/fetch-client.ts`): `configFile, duplicateDetection, email, facialRecognition, importFaces, map, oauth, oauthAutoLaunch, ocr, passwordLogin, reverseGeocoding, search, sidecar, smartSearch, trash`. **Note:** Gallery's `search` field is hardcoded to `true` in `server.service.ts:getFeatures()` so feature-flag gating of user pages is largely academic at shipping time. Items gated on a flag still render when the flag is `true` or `undefined` (SSR window).
- **`GlobalSearchManager` touchpoints to widen** (verified via grep):
  - `Sections` type at line 26
  - `ActiveItem` type at line 40
  - `sectionForKind` at line 210
  - `reconcileCursor.order` + `kindOf` at line 230–256
  - `announcementText` at line 420
  - `getActiveItem` at line 179 (case branch for `nav`)
- **`GlobalSearchSection`** has **no** `empty` branch in its `#if` chain (verified) — bare `<Command.GroupHeading>` renders for `empty` status. Fix in Task 2.

---

## Conventions for every task

- **TDD cycle:** write failing test → confirm failure → minimal implementation → confirm pass → typecheck → commit. Never skip the confirm-failure step.
- **Commits:** one logical unit per commit with `feat|fix|test|chore|docs|i18n(scope):` prefixes. **No `Co-Authored-By` trailers.**
- **Before commit (web only — `feedback_lint_sequential` says no local lint):**
  - `cd web && pnpm check:typescript`
  - `cd web && pnpm check:svelte`
  - **Do NOT run `pnpm lint`** — CI handles it. Running it locally takes >10 min and has been explicitly declined.
- **Vitest:** run specific files via `cd web && pnpm vitest run src/lib/managers/global-search-manager.svelte.spec.ts`.
- **Fake timers + `AbortSignal.timeout`:** reuse the existing `web/src/lib/managers/__tests__/fake-abort-timeout.ts` helper — `installFakeAbortTimeout()` / `restoreAbortTimeout()`.
- **Svelte 5:** never mutate `$state` from inside `$derived` (`feedback_svelte_derived_no_mutation`); use `SvelteMap`/`SvelteSet` in `.svelte` files (`feedback_svelte_map_lint`).
- **i18n:** new keys must go through `pnpm --filter=immich-i18n format:fix` before commit (`feedback_i18n_key_sorting`).
- **Type-safe casts:** prefer `as unknown as T` over `as T` for opaque shape-punning; prefer `as never` only inside Svelte snippet prop passthrough (existing convention in the v1 palette).
- **User store mocking pattern (shared).** Tests that need to flip `user.isAdmin` mid-file MUST use the `vi.hoisted` + `vi.mock` pattern — `vi.doMock` inside an `it()` block does NOT retroactively swap references that are already bound at module-load time. Use this header in every spec file that mocks `$lib/stores/user.store`:

  ```ts
  const { mockUser } = vi.hoisted(() => ({
    mockUser: { current: { isAdmin: true } as { isAdmin: boolean } | null },
  }));
  vi.mock('$lib/stores/user.store', () => ({
    user: {
      subscribe: (run: (v: { isAdmin: boolean } | null) => void) => {
        run(mockUser.current);
        return () => {};
      },
    },
  }));
  ```

  Tests then flip `mockUser.current = { isAdmin: false }` before constructing a new manager. This pattern is proven in `web/src/lib/components/global-search/__tests__/global-search-trigger.spec.ts` for the `featureFlagsManager` case.

  **CRITICAL — set mock state BEFORE mounting components.** The mock's `subscribe` callback fires once with the current value at subscribe time and does NOT re-emit when `mockUser.current` is later reassigned. Imperative `get(user)` reads (used in `runNavigationProvider`) work correctly because they re-subscribe each call, but Svelte component reactive subscriptions (`$user` inside `.svelte` files) cache the value at mount time. **Component tests that need a non-default user state must assign `mockUser.current = { isAdmin: false }` BEFORE the `render(Component, ...)` call.** Same constraint applies to `mockFlags.valueOrUndefined` and `mockI18nLocale.current`.

- **Feature flags mocking pattern (shared).** Same rule — use `vi.hoisted` for mutable mock state:

  ```ts
  const { mockFlags } = vi.hoisted(() => ({
    mockFlags: {
      valueOrUndefined: { search: true, map: true, trash: true } as Record<string, boolean> | undefined,
    },
  }));
  vi.mock('$lib/managers/feature-flags-manager.svelte', () => ({
    featureFlagsManager: mockFlags,
  }));
  ```

- **Icon fallback map.** If `pnpm check:typescript` fails on any `@mdi/js` import introduced in Task 5, use these substitutions rather than inventing new ones:

  | Missing icon     | Substitute           |
  | ---------------- | -------------------- |
  | `mdiJobOutline`  | `mdiSync`            |
  | `mdiViewAgenda`  | `mdiBookOpenOutline` |
  | `mdiStarOutline` | `mdiHistory`         |
  | `mdiHeart`       | `mdiStar`            |
  | `mdiArchive`     | `mdiPackageVariant`  |

  The Task 6 schema test only asserts `icon` is a non-empty string, so any valid path works. If none of the above exist either, pick any `mdi*` import that compiles.

---

## Task 1 — i18n keys for navigation sections

**Files:**

- Modify: `i18n/en.json`

**Step 1: Add the four section-heading keys**

Insert after the existing `cmdk_*` block — Prettier will alphabetise on format:

```
"cmdk_section_actions": "Actions",
"cmdk_section_admin": "Admin",
"cmdk_section_system_settings": "System Settings",
"cmdk_section_user_pages": "Navigation"
```

Rationale for the `User Pages → Navigation` label: the three other sections are admin-only or command-only. The user-pages category is "everything else you'd want to jump to" — `Navigation` is the more natural label for end users who don't care about the internal category name.

**Step 2: Run prettier**

```bash
pnpm --filter=immich-i18n format:fix
```

**Step 3: Typecheck web**

```bash
cd web && pnpm check:typescript && pnpm check:svelte
```

Expected: clean.

**Step 4: Commit**

```bash
git add i18n/en.json
git commit -m "i18n(web): add cmdk navigation section headings"
```

---

## Task 2 — `GlobalSearchSection` empty-branch side-fix

**Files:**

- Modify: `web/src/lib/components/global-search/global-search-section.svelte` — outer guard
- Create: `web/src/lib/components/global-search/__tests__/global-search-section.spec.ts`

**Context:** Pre-existing v1 bug. `{#if status.status !== 'idle'}` at line 29 lets `empty` through and renders a bare `<Command.GroupHeading>` with no items. SWR will expose this more often because `empty` persists one more render cycle. One-line fix + one-test pin.

**Step 1: Write failing test**

```ts
// global-search-section.spec.ts
import { render } from '@testing-library/svelte';
import { describe, it, expect } from 'vitest';
import GlobalSearchSection from '../global-search-section.svelte';
import { createRawSnippet } from 'svelte';

describe('global-search-section empty-state', () => {
  it('renders NOTHING when status is empty', () => {
    const { container } = render(GlobalSearchSection, {
      props: {
        heading: 'Photos',
        status: { status: 'empty' },
        idPrefix: 'photo' as const,
        onActivate: () => {},
        renderRow: createRawSnippet(() => ({ render: () => '<span></span>' })),
      },
    });
    expect(container.querySelector('[data-command-group-heading]')).toBeNull();
    expect(container.querySelector('[data-command-group]')).toBeNull();
    expect(container.textContent?.trim()).toBe('');
  });

  it('renders nothing when status is idle', () => {
    const { container } = render(GlobalSearchSection, {
      props: {
        heading: 'Photos',
        status: { status: 'idle' },
        idPrefix: 'photo' as const,
        onActivate: () => {},
        renderRow: createRawSnippet(() => ({ render: () => '<span></span>' })),
      },
    });
    expect(container.textContent?.trim()).toBe('');
  });

  it('renders the heading when status is ok', () => {
    const { container } = render(GlobalSearchSection, {
      props: {
        heading: 'Photos',
        status: { status: 'ok', items: [{ id: 'a1' }], total: 1 },
        idPrefix: 'photo' as const,
        onActivate: () => {},
        renderRow: createRawSnippet(() => ({ render: () => '<span>a1</span>' })),
      },
    });
    expect(container.textContent).toContain('Photos');
  });
});
```

**Step 2: Run — expect failure on empty case**

```bash
cd web && pnpm vitest run src/lib/components/global-search/__tests__/global-search-section.spec.ts
```

Expected: the `renders NOTHING when status is empty` test fails — the section still emits a `<Command.GroupHeading>` node.

**Step 3: Fix the guard**

Edit `web/src/lib/components/global-search/global-search-section.svelte`, line 29:

```svelte
{#if status.status !== 'idle' && status.status !== 'empty'}
```

**Step 4: Re-run — expect pass**

```bash
cd web && pnpm vitest run src/lib/components/global-search/__tests__/global-search-section.spec.ts
```

**Step 5: Typecheck + commit**

```bash
cd web && pnpm check:typescript && pnpm check:svelte
git add web/src/lib/components/global-search/global-search-section.svelte \
  web/src/lib/components/global-search/__tests__/global-search-section.spec.ts
git commit -m "fix(web): hide empty sections in GlobalSearchSection"
```

---

## Task 3 — `cmdk-recent`: add `removeEntry(id)` export

**Files:**

- Modify: `web/src/lib/stores/cmdk-recent.ts`
- Modify: `web/src/lib/stores/cmdk-recent.spec.ts`

**Context:** Required by Task 12's `activateRecent` admin-purge path. Pure additive change; no callers yet.

**Step 1: Write failing tests**

Append to `cmdk-recent.spec.ts`:

```ts
describe('removeEntry', () => {
  beforeEach(() => {
    localStorage.clear();
    __resetForTests();
  });

  it('removes the matching entry and preserves order', () => {
    addEntry({ kind: 'query', id: 'q:a', text: 'a', mode: 'smart', lastUsed: 1 });
    addEntry({ kind: 'query', id: 'q:b', text: 'b', mode: 'smart', lastUsed: 2 });
    addEntry({ kind: 'query', id: 'q:c', text: 'c', mode: 'smart', lastUsed: 3 });
    removeEntry('q:b');
    expect(getEntries().map((e) => e.id)).toEqual(['q:c', 'q:a']);
  });

  it('no-op on missing id', () => {
    addEntry({ kind: 'query', id: 'q:a', text: 'a', mode: 'smart', lastUsed: 1 });
    removeEntry('does-not-exist');
    expect(getEntries().map((e) => e.id)).toEqual(['q:a']);
  });

  it('persists the removal to localStorage', () => {
    addEntry({ kind: 'query', id: 'q:a', text: 'a', mode: 'smart', lastUsed: 1 });
    removeEntry('q:a');
    const raw = localStorage.getItem('cmdk.recent');
    expect(JSON.parse(raw ?? '[]')).toEqual([]);
  });
});
```

Import `removeEntry` at the top of the file.

**Step 2: Run — expect failure**

```bash
cd web && pnpm vitest run src/lib/stores/cmdk-recent.spec.ts
```

Expected: `removeEntry is not a function`.

**Step 3: Implement**

In `cmdk-recent.ts`, add after `clearEntries`:

```ts
export function removeEntry(id: string) {
  if (memory === null) {
    memory = rawRead();
  }
  const before = memory.length;
  memory = memory.filter((e) => e.id !== id);
  if (memory.length !== before) {
    rawWrite(memory);
  }
}
```

**Step 4: Run — expect pass**

**Step 5: Commit**

```bash
cd web && pnpm check:typescript && pnpm check:svelte
git add web/src/lib/stores/cmdk-recent.ts web/src/lib/stores/cmdk-recent.spec.ts
git commit -m "feat(web): add removeEntry to cmdk.recent store"
```

---

## Task 4 — `cmdk-recent`: add `navigate` kind to `RecentEntry`

**Files:**

- Modify: `web/src/lib/stores/cmdk-recent.ts`
- Modify: `web/src/lib/stores/cmdk-recent.spec.ts`
- Modify: `web/src/lib/managers/global-search-manager.svelte.ts` — `isValidRecentEntry` branch

**Step 1: Write failing tests**

Append to `cmdk-recent.spec.ts`:

```ts
describe('navigate kind', () => {
  beforeEach(() => {
    localStorage.clear();
    __resetForTests();
  });

  it('persists a navigate entry with all required fields', () => {
    addEntry({
      kind: 'navigate',
      id: 'nav:users',
      route: '/admin/users',
      labelKey: 'users',
      icon: 'M12...mock',
      adminOnly: true,
      lastUsed: 1,
    });
    const entries = getEntries();
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({
      kind: 'navigate',
      id: 'nav:users',
      route: '/admin/users',
      adminOnly: true,
    });
  });

  it('dedupes navigate entries by id', () => {
    addEntry({
      kind: 'navigate',
      id: 'nav:users',
      route: '/admin/users',
      labelKey: 'users',
      icon: 'x',
      adminOnly: true,
      lastUsed: 1,
    });
    addEntry({
      kind: 'navigate',
      id: 'nav:users',
      route: '/admin/users',
      labelKey: 'users',
      icon: 'x',
      adminOnly: true,
      lastUsed: 5,
    });
    const entries = getEntries();
    expect(entries).toHaveLength(1);
    expect(entries[0].lastUsed).toBe(5);
  });
});
```

Also add an isolated `isValidRecentEntry` test to the manager spec (it's a module-local function, but activateRecent exercises it):

```ts
describe('isValidRecentEntry (navigate branch)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    resetRecentStore();
  });

  // Mock goto so we can detect whether activateRecent actually navigated.
  it('rejects navigate entries with empty route / labelKey / icon', () => {
    const m = new GlobalSearchManager();
    m.open();
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    for (const missing of ['route', 'labelKey', 'icon'] as const) {
      vi.mocked(goto).mockClear();
      warnSpy.mockClear();
      const entry = {
        kind: 'navigate' as const,
        id: `nav:bad-${missing}`,
        route: missing === 'route' ? '' : '/ok',
        labelKey: missing === 'labelKey' ? '' : 'ok',
        icon: missing === 'icon' ? '' : 'M0 0',
        adminOnly: false,
        lastUsed: 1,
      };
      m.open();
      m.activateRecent(entry);
      expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('corrupt recent entry'), expect.anything());
      expect(goto).not.toHaveBeenCalled();
    }
    warnSpy.mockRestore();
  });
});
```

This test depends on Task 12's `activateRecent` implementation. Move this test into Task 12 if Task 4 doesn't yet have the `activateRecent` navigate branch — the isValidRecentEntry function itself is already written in Task 4.

**Step 2: Run — expect failure**

```bash
cd web && pnpm vitest run src/lib/stores/cmdk-recent.spec.ts
```

Expected: TypeScript error — `navigate` not in the `RecentEntry` union.

**Step 3: Extend the union**

In `cmdk-recent.ts`:

```ts
export type RecentEntry =
  | { kind: 'query'; id: string; text: string; mode: SearchMode; lastUsed: number }
  | { kind: 'photo'; id: string; assetId: string; label: string; lastUsed: number }
  | { kind: 'person'; id: string; personId: string; label: string; thumbnailAssetId?: string; lastUsed: number }
  | { kind: 'place'; id: string; latitude: number; longitude: number; label: string; lastUsed: number }
  | { kind: 'tag'; id: string; tagId: string; label: string; lastUsed: number }
  | {
      kind: 'navigate';
      id: string;
      route: string;
      labelKey: string;
      icon: string;
      adminOnly: boolean;
      lastUsed: number;
    };
```

In `global-search-manager.svelte.ts`, add to `isValidRecentEntry`:

```ts
case 'navigate': {
  return (
    typeof e.route === 'string' &&
    e.route.length > 0 &&
    typeof e.labelKey === 'string' &&
    e.labelKey.length > 0 &&
    typeof e.icon === 'string' &&
    e.icon.length > 0
  );
}
```

**Step 4: Run — expect pass**

```bash
cd web && pnpm vitest run src/lib/stores/cmdk-recent.spec.ts \
  src/lib/managers/global-search-manager.svelte.spec.ts
```

**Step 5: Commit**

```bash
cd web && pnpm check:typescript && pnpm check:svelte
git add web/src/lib/stores/cmdk-recent.ts web/src/lib/stores/cmdk-recent.spec.ts \
  web/src/lib/managers/global-search-manager.svelte.ts
git commit -m "feat(web): add navigate kind to RecentEntry union"
```

---

## Task 5 — `navigation-items.ts` static data + types

**Files:**

- Create: `web/src/lib/managers/navigation-items.ts`

**Context:** The source of truth for the 36 navigation items. Icons imported from `@mdi/js`, labels via i18n keys (resolved at filter time by the manager).

**Step 1: Write the module**

```ts
// web/src/lib/managers/navigation-items.ts
import type { ServerFeaturesDto } from '@immich/sdk';
import {
  mdiAccountMultipleOutline,
  mdiAccountOutline,
  mdiArchive,
  mdiBackupRestore,
  mdiBellOutline,
  mdiBookshelf,
  mdiClockOutline,
  mdiCog,
  mdiDatabaseOutline,
  mdiFileDocumentOutline,
  mdiFolderOutline,
  mdiHeart,
  mdiImageMultiple,
  mdiImageOutline,
  mdiJobOutline, // if missing, substitute mdiSync
  mdiLockOutline,
  mdiMagnifyScan,
  mdiMap,
  mdiMapMarkerOutline,
  mdiPaletteOutline,
  mdiRobotOutline,
  mdiServer,
  mdiServerOutline,
  mdiShareVariantOutline,
  mdiStarOutline, // memories placeholder
  mdiSync,
  mdiTagMultipleOutline,
  mdiThemeLightDark,
  mdiTrashCanOutline,
  mdiUpdate,
  mdiViewAgenda, // spaces placeholder
  mdiVideoOutline,
} from '@mdi/js';

export type NavigationCategory = 'systemSettings' | 'admin' | 'userPages' | 'actions';

export interface NavigationItem {
  id: string;
  category: NavigationCategory;
  labelKey: string;
  descriptionKey: string;
  icon: string;
  /** Empty string for command-kind items (e.g. theme toggle). */
  route: string;
  adminOnly: boolean;
  /** Optional feature-flag gate. Item is hidden when `featureFlagsManager.valueOrUndefined?.[featureFlag]` is falsy. */
  featureFlag?: keyof ServerFeaturesDto;
}

const SYSTEM_SETTINGS: readonly NavigationItem[] = [
  ['authentication', 'authentication_settings', mdiLockOutline],
  ['backup', 'backup_settings', mdiBackupRestore],
  ['image', 'image_settings', mdiImageOutline],
  ['job', 'job_settings', mdiSync],
  ['external-library', 'library_settings', mdiBookshelf],
  ['logging', 'logging_settings', mdiFileDocumentOutline],
  ['machine-learning', 'machine_learning_settings', mdiRobotOutline],
  ['classification', 'classification_settings', mdiMagnifyScan],
  ['location', 'map_gps_settings', mdiMapMarkerOutline],
  ['metadata', 'metadata_settings', mdiDatabaseOutline],
  ['nightly-tasks', 'nightly_tasks_settings', mdiClockOutline],
  ['notifications', 'notification_settings', mdiBellOutline],
  ['server', 'server_settings', mdiServerOutline],
  ['storage-template', 'storage_template_settings', mdiFolderOutline],
  ['theme', 'theme_settings', mdiPaletteOutline],
  ['trash', 'trash_settings', mdiTrashCanOutline],
  ['user-settings', 'user_settings', mdiAccountOutline],
  ['version-check', 'version_check_settings', mdiUpdate],
  ['video-transcoding', 'transcoding_settings', mdiVideoOutline],
].map(([key, base, icon]) => ({
  id: `nav:systemSettings:${key}`,
  category: 'systemSettings',
  labelKey: `admin.${base}`,
  descriptionKey: `admin.${base}_description`,
  icon: icon as string,
  route: `/admin/system-settings?isOpen=${key}`,
  adminOnly: true,
})) as readonly NavigationItem[];

const ADMIN_PAGES: readonly NavigationItem[] = [
  {
    id: 'nav:admin:users',
    category: 'admin',
    labelKey: 'users',
    descriptionKey: 'admin.users_page_description',
    icon: mdiAccountMultipleOutline,
    route: '/admin/users',
    adminOnly: true,
  },
  {
    id: 'nav:admin:libraries',
    category: 'admin',
    labelKey: 'external_libraries',
    descriptionKey: 'admin.external_libraries_page_description',
    icon: mdiBookshelf,
    route: '/admin/library-management',
    adminOnly: true,
  },
  {
    id: 'nav:admin:queues',
    category: 'admin',
    labelKey: 'admin.queues',
    descriptionKey: 'admin.queues_page_description',
    icon: mdiSync,
    route: '/admin/queues',
    adminOnly: true,
  },
  {
    id: 'nav:admin:server-stats',
    category: 'admin',
    labelKey: 'server_stats',
    descriptionKey: 'admin.server_stats_page_description',
    icon: mdiServer,
    route: '/admin/system-statistics',
    adminOnly: true,
  },
  {
    id: 'nav:admin:maintenance',
    category: 'admin',
    labelKey: 'maintenance',
    descriptionKey: 'admin.maintenance_page_description',
    icon: mdiCog,
    route: '/admin/maintenance',
    adminOnly: true,
  },
];

const USER_PAGES: readonly NavigationItem[] = [
  {
    id: 'nav:userPages:photos',
    category: 'userPages',
    labelKey: 'photos',
    descriptionKey: 'photos_page_description',
    icon: mdiImageMultiple,
    route: '/photos',
    adminOnly: false,
  },
  {
    id: 'nav:userPages:albums',
    category: 'userPages',
    labelKey: 'albums',
    descriptionKey: 'albums_page_description',
    icon: mdiViewAgenda,
    route: '/albums',
    adminOnly: false,
  },
  {
    id: 'nav:userPages:people',
    category: 'userPages',
    labelKey: 'people',
    descriptionKey: 'people_page_description',
    icon: mdiAccountMultipleOutline,
    route: '/people',
    adminOnly: false,
  },
  {
    id: 'nav:userPages:tags',
    category: 'userPages',
    labelKey: 'tags',
    descriptionKey: 'tags_page_description',
    icon: mdiTagMultipleOutline,
    route: '/tags',
    adminOnly: false,
  },
  {
    id: 'nav:userPages:map',
    category: 'userPages',
    labelKey: 'map',
    descriptionKey: 'map_page_description',
    icon: mdiMap,
    route: '/map',
    adminOnly: false,
    featureFlag: 'map',
  },
  {
    id: 'nav:userPages:sharing',
    category: 'userPages',
    labelKey: 'sharing',
    descriptionKey: 'sharing_page_description',
    icon: mdiShareVariantOutline,
    route: '/sharing',
    adminOnly: false,
  },
  {
    id: 'nav:userPages:spaces',
    category: 'userPages',
    labelKey: 'spaces',
    descriptionKey: 'spaces_page_description',
    icon: mdiViewAgenda,
    route: '/spaces',
    adminOnly: false,
  },
  {
    id: 'nav:userPages:trash',
    category: 'userPages',
    labelKey: 'trash',
    descriptionKey: 'trash_page_description',
    icon: mdiTrashCanOutline,
    route: '/trash',
    adminOnly: false,
    featureFlag: 'trash',
  },
  {
    id: 'nav:userPages:favorites',
    category: 'userPages',
    labelKey: 'favorites',
    descriptionKey: 'favorites_page_description',
    icon: mdiHeart,
    route: '/favorites',
    adminOnly: false,
  },
  {
    id: 'nav:userPages:archive',
    category: 'userPages',
    labelKey: 'archive',
    descriptionKey: 'archive_page_description',
    icon: mdiArchive,
    route: '/archive',
    adminOnly: false,
  },
  {
    id: 'nav:userPages:memories',
    category: 'userPages',
    labelKey: 'memories',
    descriptionKey: 'memories_page_description',
    icon: mdiStarOutline,
    route: '/memory',
    adminOnly: false,
  },
];

const ACTIONS: readonly NavigationItem[] = [
  {
    id: 'nav:theme',
    category: 'actions',
    labelKey: 'theme',
    descriptionKey: 'toggle_theme_description',
    icon: mdiThemeLightDark,
    route: '',
    adminOnly: false,
  },
];

export const NAVIGATION_ITEMS: readonly NavigationItem[] = [
  ...SYSTEM_SETTINGS,
  ...ADMIN_PAGES,
  ...USER_PAGES,
  ...ACTIONS,
];
```

**Note on icon imports:** `mdiJobOutline`, `mdiViewAgenda`, `mdiStarOutline` may not exist in the installed `@mdi/js` version. Before committing, verify each import resolves by running `pnpm check:typescript`. Substitute with the closest available icon (e.g. `mdiSync` for jobs, `mdiBookOpenOutline` for spaces) — the exact icon choice is open and the test only asserts the field is a non-empty string.

**Note on label/description keys:** Several of the user-page `*_page_description` keys may not exist in `i18n/en.json` yet. Add them in a sub-step (inside this same commit) or fall back to reusing existing label keys twice (e.g. `labelKey: 'photos', descriptionKey: 'photos'`) — the filter matches both, duplication is harmless. A grep pass at implementation time decides.

**Step 2: Verify no type errors**

```bash
cd web && pnpm check:typescript
```

Fix any missing icon imports by substituting existing icons. Fix any missing i18n keys by either adding them to `i18n/en.json` or falling back to existing keys.

**Step 3: Commit**

```bash
git add web/src/lib/managers/navigation-items.ts i18n/en.json
git commit -m "feat(web): static NAVIGATION_ITEMS list for cmdk navigation provider"
```

---

## Task 6 — `navigation-items.spec.ts` schema + drift guards

**Files:**

- Create: `web/src/lib/managers/navigation-items.spec.ts`

**Step 1: Write the test**

```ts
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { NAVIGATION_ITEMS } from './navigation-items';

// __dirname is not defined in ESM (vitest default). Derive it from import.meta.url.
const __dirname = dirname(fileURLToPath(import.meta.url));

describe('NAVIGATION_ITEMS schema', () => {
  it('has exactly 36 items', () => {
    expect(NAVIGATION_ITEMS).toHaveLength(36);
  });

  it('every item has non-empty required fields', () => {
    for (const item of NAVIGATION_ITEMS) {
      expect(item.id).toMatch(/^nav:/);
      expect(item.labelKey.length).toBeGreaterThan(0);
      expect(item.descriptionKey.length).toBeGreaterThan(0);
      expect(item.icon.length).toBeGreaterThan(0);
      if (item.category === 'actions') {
        expect(item.route).toBe('');
      } else {
        expect(item.route.length).toBeGreaterThan(0);
      }
    }
  });

  it('ids are unique', () => {
    const ids = NAVIGATION_ITEMS.map((i) => i.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('system-settings routes match the /admin/system-settings?isOpen=<key> pattern', () => {
    const items = NAVIGATION_ITEMS.filter((i) => i.category === 'systemSettings');
    expect(items).toHaveLength(19);
    for (const item of items) {
      expect(item.route).toMatch(/^\/admin\/system-settings\?isOpen=[a-z-]+$/);
      expect(item.adminOnly).toBe(true);
    }
  });

  it('admin routes start with /admin/', () => {
    const items = NAVIGATION_ITEMS.filter((i) => i.category === 'admin');
    expect(items).toHaveLength(5);
    for (const item of items) {
      expect(item.route.startsWith('/admin/')).toBe(true);
      expect(item.adminOnly).toBe(true);
    }
  });

  it('user-pages items are not admin-only', () => {
    const items = NAVIGATION_ITEMS.filter((i) => i.category === 'userPages');
    expect(items).toHaveLength(11);
    for (const item of items) {
      expect(item.adminOnly).toBe(false);
    }
  });

  it('actions category has exactly the theme toggle', () => {
    const items = NAVIGATION_ITEMS.filter((i) => i.category === 'actions');
    expect(items).toHaveLength(1);
    expect(items[0].id).toBe('nav:theme');
    expect(items[0].route).toBe('');
  });

  it('drift guard: every systemSettings isOpen key exists in the accordion source', () => {
    // From web/src/lib/managers/ up 2 dirs → web/src/, then into routes/admin/...
    const sourcePath = resolve(__dirname, '..', '..', 'routes', 'admin', 'system-settings', '+page.svelte');
    const source = readFileSync(sourcePath, 'utf-8');
    const sourceKeys = new Set([...source.matchAll(/key:\s*'([a-z-]+)'/g)].map((m) => m[1]));
    const ourKeys = NAVIGATION_ITEMS.filter((i) => i.category === 'systemSettings').map((i) =>
      i.route.replace('/admin/system-settings?isOpen=', ''),
    );
    for (const key of ourKeys) {
      expect(sourceKeys.has(key)).toBe(true);
    }
  });
});
```

**Step 2: Run — expect pass**

```bash
cd web && pnpm vitest run src/lib/managers/navigation-items.spec.ts
```

**Step 3: Commit**

```bash
cd web && pnpm check:typescript
git add web/src/lib/managers/navigation-items.spec.ts
git commit -m "test(web): NAVIGATION_ITEMS schema + accordion-key drift guard"
```

---

## Task 7 — Manager: widen `Sections` / `ActiveItem` and touchpoints

**Files:**

- Modify: `web/src/lib/managers/global-search-manager.svelte.ts` — types, `sectionForKind`, `reconcileCursor`, `announcementText`, `getActiveItem`
- Modify: `web/src/lib/managers/global-search-manager.svelte.spec.ts`

**Context:** Type-level scaffolding only. No runtime behavior yet. The navigation section will exist but always be `idle`.

**Step 1: Write failing tests**

Append a new `describe` to the manager spec:

```ts
describe('navigation section scaffolding', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
  });

  it('sections.navigation starts as idle', () => {
    const m = new GlobalSearchManager();
    expect(m.sections.navigation).toEqual({ status: 'idle' });
  });

  it('sectionForKind("nav") returns sections.navigation', () => {
    const m = new GlobalSearchManager();
    // sectionForKind is private; use getActiveItem as the public path.
    m.sections.navigation = { status: 'ok', items: [{ id: 'nav:theme' }] as never[], total: 1 };
    m.activeItemId = 'nav:nav:theme';
    const active = m.getActiveItem();
    expect(active?.kind).toBe('nav');
  });

  it('announcementText includes navigation count as "N pages" when ok', () => {
    const m = new GlobalSearchManager();
    m.sections = {
      photos: { status: 'empty' },
      people: { status: 'empty' },
      places: { status: 'empty' },
      tags: { status: 'empty' },
      navigation: { status: 'ok', items: [{ id: 'nav:theme' }] as never[], total: 5 },
    };
    expect(m.announcementText).toBe('5 pages');
  });

  it('reconcileCursor falls through to navigation when entity sections are empty', () => {
    const m = new GlobalSearchManager();
    m.sections = {
      photos: { status: 'empty' },
      people: { status: 'empty' },
      places: { status: 'empty' },
      tags: { status: 'empty' },
      navigation: { status: 'ok', items: [{ id: 'nav:theme' }] as never[], total: 1 },
    };
    m.activeItemId = null;
    m.reconcileCursor();
    expect(m.activeItemId).toBe('nav:nav:theme');
  });
});
```

**Step 2: Run — expect failure**

Types should break: `sections.navigation` doesn't exist, `ActiveItem` has no `'nav'` kind, etc.

**Step 3: Implement the touchpoints**

In `global-search-manager.svelte.ts`:

```ts
// Import the type for the item data shape:
import type { NavigationItem } from './navigation-items';

// Widen Sections:
export type Sections = {
  photos: ProviderStatus;
  people: ProviderStatus;
  places: ProviderStatus;
  tags: ProviderStatus;
  navigation: ProviderStatus<NavigationItem>;
};

// Widen ActiveItem:
export type ActiveItem =
  | { kind: 'photo'; data: unknown }
  | { kind: 'person'; data: unknown }
  | { kind: 'place'; data: unknown }
  | { kind: 'tag'; data: unknown }
  | { kind: 'nav'; data: NavigationItem };

// Initial state of sections:
sections = $state<Sections>({
  photos: idle,
  people: idle,
  places: idle,
  tags: idle,
  navigation: idle,
});
```

Update `sectionForKind`:

```ts
private sectionForKind(kind: string): ProviderStatus | null {
  switch (kind) {
    case 'photo': return this.sections.photos;
    case 'person': return this.sections.people;
    case 'place': return this.sections.places;
    case 'tag': return this.sections.tags;
    case 'nav': return this.sections.navigation as ProviderStatus;
    default: return null;
  }
}
```

Update `getActiveItem`'s item shape branching — navigation items match on `id` only (they have an `id` field starting with `nav:`).

Update `reconcileCursor.order` and `kindOf`:

```ts
const order = ['photos', 'people', 'places', 'tags', 'navigation'] as const;
const kindOf: Record<keyof Sections, string> = {
  photos: 'photo',
  people: 'person',
  places: 'place',
  tags: 'tag',
  navigation: 'nav',
};
```

Update `announcementText` — add the `navigation` count to the `parts` array. Use "pages" rather than "navigation" in the aria-live text because "5 navigation" reads awkwardly to a screen reader:

```ts
if (count(s.navigation) > 0) {
  parts.push(`${count(s.navigation)} pages`);
}
```

Update `buildProviders` to add a placeholder `navigation` stub (wired properly in Task 10):

```ts
const navigationStub: Provider<NavigationItem> = {
  key: 'navigation',
  topN: 5,
  minQueryLength: 2,
  run: async () => ({ status: 'empty' }),
};
return { photos, people, places, tags, navigation: navigationStub };
```

Update `close()` to reset navigation to idle:

```ts
this.sections = { photos: idle, people: idle, places: idle, tags: idle, navigation: idle };
```

Update `setQuery`'s empty-query reset path likewise.

**Step 4: Run — expect pass**

```bash
cd web && pnpm vitest run src/lib/managers/global-search-manager.svelte.spec.ts
```

All existing tests plus the 4 new ones should be green.

**Step 5: Commit**

```bash
cd web && pnpm check:typescript && pnpm check:svelte
git add web/src/lib/managers/global-search-manager.svelte.ts \
  web/src/lib/managers/global-search-manager.svelte.spec.ts
git commit -m "feat(web): widen Sections/ActiveItem for navigation section"
```

---

## Task 8 — Manager: locale-keyed memo cache + `locale` subscription

**Files:**

- Modify: `web/src/lib/managers/global-search-manager.svelte.ts`
- Modify: `web/src/lib/managers/global-search-manager.svelte.spec.ts`

**Context:** Infrastructure for Task 9's `runNavigationProvider`. The cache maps locale → `Map<itemId, searchableString>`. `searchableString` is `` `${t(labelKey)} ${t(descriptionKey)}` ``.

**Step 1: Write failing test**

```ts
describe('navigation memo cache', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
  });

  it('builds cache on first access for the current locale', () => {
    const m = new GlobalSearchManager();
    const cache = (
      m as unknown as { getNavigationSearchStrings: () => Map<string, string> }
    ).getNavigationSearchStrings();
    expect(cache.size).toBe(36); // matches NAVIGATION_ITEMS.length
    for (const [id, str] of cache) {
      expect(id.startsWith('nav:')).toBe(true);
      expect(str.length).toBeGreaterThan(0);
    }
  });

  it('reuses the cached table on subsequent calls', () => {
    const m = new GlobalSearchManager();
    const a = (m as unknown as { getNavigationSearchStrings: () => Map<string, string> }).getNavigationSearchStrings();
    const b = (m as unknown as { getNavigationSearchStrings: () => Map<string, string> }).getNavigationSearchStrings();
    expect(a).toBe(b); // same reference
  });

  it('handles a null locale gracefully (svelte-i18n before init)', () => {
    // Set the mocked locale to null — simulates svelte-i18n's pre-init state.
    // The `get(i18nLocale) ?? 'en'` fallback in getNavigationSearchStrings should
    // build the cache under the 'en' key without throwing.
    mockI18nLocale.current = null;
    const m = new GlobalSearchManager();
    const cache = (
      m as unknown as { getNavigationSearchStrings: () => Map<string, string> }
    ).getNavigationSearchStrings();
    expect(cache.size).toBe(36);
    // Reset for subsequent tests in the file.
    mockI18nLocale.current = 'en';
  });
});
```

**Add a third hoisted mock block** alongside `mockUser` and `mockFlags` at the top of the spec file. This mocks ONLY the `locale` store — `t` stays as the real implementation so existing translation calls continue to work via the `fallbackLocale: 'dev'` setup:

```ts
const { mockI18nLocale } = vi.hoisted(() => ({
  mockI18nLocale: { current: 'en' as string | null },
}));
vi.mock('svelte-i18n', async (orig) => {
  const actual = await orig<typeof import('svelte-i18n')>();
  return {
    ...actual,
    locale: {
      subscribe: (run: (v: string | null) => void) => {
        run(mockI18nLocale.current);
        return () => {};
      },
    },
  };
});
```

**Step 2: Run — expect failure**

```bash
cd web && pnpm vitest run src/lib/managers/global-search-manager.svelte.spec.ts
```

Expected: `getNavigationSearchStrings is not a function`.

**Step 3: Implement**

Import svelte-i18n's `t` and `locale`:

```ts
import { get } from 'svelte/store';
import { t, locale as i18nLocale } from 'svelte-i18n';
import { NAVIGATION_ITEMS } from './navigation-items';
```

Add fields:

```ts
private navigationSearchCache: Map<string, Map<string, string>> = new Map();
private localeUnsubscribe?: () => void;
```

In the constructor (inside the `if (browser)` guard):

```ts
this.localeUnsubscribe = i18nLocale.subscribe(() => {
  this.navigationSearchCache.clear();
});
```

The existing `destroy()` method already handles the storage listener teardown; note for future readers that `localeUnsubscribe` is stored for symmetry and test-isolation use but is never called in production (singleton lifetime = tab lifetime). If the destroy method does not exist yet, add:

```ts
destroy() {
  if (this.storageListener) {
    window.removeEventListener('storage', this.storageListener);
  }
  if (this.localeUnsubscribe) {
    this.localeUnsubscribe();
  }
}
```

Add the cache builder:

```ts
private getNavigationSearchStrings(): Map<string, string> {
  const currentLocale = (get(i18nLocale) ?? 'en') as string;
  let table = this.navigationSearchCache.get(currentLocale);
  if (table) {
    return table;
  }
  const translate = get(t);
  table = new Map();
  for (const item of NAVIGATION_ITEMS) {
    const label = translate(item.labelKey);
    const description = translate(item.descriptionKey);
    table.set(item.id, `${label} ${description}`);
  }
  this.navigationSearchCache.set(currentLocale, table);
  return table;
}
```

**Step 4: Run — expect pass**

**Step 5: Commit**

```bash
cd web && pnpm check:typescript && pnpm check:svelte
git add web/src/lib/managers/global-search-manager.svelte.ts \
  web/src/lib/managers/global-search-manager.svelte.spec.ts
git commit -m "feat(web): navigation memo cache + locale subscription"
```

---

## Task 9 — Manager: `runNavigationProvider` with fuzzy scoring + gates

**Files:**

- Modify: `web/src/lib/managers/global-search-manager.svelte.ts`
- Modify: `web/src/lib/managers/global-search-manager.svelte.spec.ts`

**Context:** The synchronous filter function. Admin gate, feature-flag gate, fuzzy score via `bits-ui`'s `computeCommandScore`, sort descending, return flat `ProviderStatus<NavigationItem>`.

**Step 1: Write failing tests**

**IMPORTANT — shared mocks live in ONE place.** These tests use the `mockUser` and `mockFlags` constants from the shared `vi.hoisted` blocks. Place those blocks at the **very top** of `global-search-manager.svelte.spec.ts`, **above all other imports** (including the import of `GlobalSearchManager` itself). Tasks 11, 12, and 15 (any subsequent task that flips `mockUser.current` or `mockFlags.valueOrUndefined`) reference the same constants — do **NOT** re-declare them per-describe block. Vitest hoists `vi.mock` calls above every import, so the mocks must appear before TS code that touches the mocked modules.

`vi.doMock` inside individual tests does NOT work for this case because `GlobalSearchManager` binds `user` and `featureFlagsManager` at module load:

```ts
// Top of file, before the import of GlobalSearchManager
const { mockUser } = vi.hoisted(() => ({
  mockUser: { current: { isAdmin: true } as { isAdmin: boolean } | null },
}));
vi.mock('$lib/stores/user.store', () => ({
  user: {
    subscribe: (run: (v: { isAdmin: boolean } | null) => void) => {
      run(mockUser.current);
      return () => {};
    },
  },
}));

const { mockFlags } = vi.hoisted(() => ({
  mockFlags: {
    valueOrUndefined: { search: true, map: true, trash: true } as Record<string, boolean> | undefined,
  },
}));
vi.mock('$lib/managers/feature-flags-manager.svelte', () => ({
  featureFlagsManager: mockFlags,
}));
```

Append the test block:

```ts
import { computeCommandScore } from 'bits-ui';

describe('runNavigationProvider', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    mockUser.current = { isAdmin: true };
    mockFlags.valueOrUndefined = { search: true, map: true, trash: true };
  });

  function runNav(m: GlobalSearchManager, query: string): ProviderStatus<never> {
    return (m as unknown as { runNavigationProvider: (q: string) => ProviderStatus<never> }).runNavigationProvider(
      query,
    );
  }

  it('returns empty for short queries (below minQueryLength 2)', () => {
    const m = new GlobalSearchManager();
    expect(runNav(m, '').status).toBe('empty');
    expect(runNav(m, 'a').status).toBe('empty');
  });

  it('returns ok with Auto-Classification in the result set for query "classific"', () => {
    const m = new GlobalSearchManager();
    const result = runNav(m, 'classific');
    expect(result.status).toBe('ok');
    if (result.status === 'ok') {
      const labels = result.items.map((i) => (i as { labelKey: string }).labelKey);
      expect(labels).toContain('admin.classification_settings');
    }
  });

  it('filters admin-only items for non-admin users', () => {
    mockUser.current = { isAdmin: false };
    const m = new GlobalSearchManager();
    const result = runNav(m, 'classific');
    if (result.status === 'ok') {
      for (const item of result.items) {
        expect((item as { adminOnly: boolean }).adminOnly).toBe(false);
      }
    }
  });

  it('filters items gated on a disabled feature flag', () => {
    mockFlags.valueOrUndefined = { search: true, map: false, trash: true };
    const m = new GlobalSearchManager();
    const result = runNav(m, 'map');
    if (result.status === 'ok') {
      const ids = result.items.map((i) => (i as { id: string }).id);
      expect(ids).not.toContain('nav:userPages:map');
    }
  });

  it('items gated on a feature flag are hidden when flags have not loaded yet (SSR window)', () => {
    mockFlags.valueOrUndefined = undefined;
    const m = new GlobalSearchManager();
    const result = runNav(m, 'map');
    if (result.status === 'ok') {
      const ids = result.items.map((i) => (i as { id: string }).id);
      expect(ids).not.toContain('nav:userPages:map');
    }
  });

  it('hyphenated query is tolerated by computeCommandScore (key fallback locale)', () => {
    // Test setup uses svelte-i18n with `fallbackLocale: 'dev'`, which renders the literal
    // i18n key for missing translations. The searchable corpus for the classification item
    // is therefore "admin.classification_settings admin.classification_settings_description".
    // 'auto-class' would NOT match the key (no 'u' / 't' in the right positions), but
    // 'class-set' DOES — chars c-l-a-s-s-_-s-e-t all appear in order. The hyphen in the
    // query is tolerated by bits-ui's tokenizer.
    const m = new GlobalSearchManager();
    const result = runNav(m, 'class-set');
    expect(result.status).toBe('ok');
    if (result.status === 'ok') {
      const labels = result.items.map((i) => (i as { labelKey: string }).labelKey);
      expect(labels).toContain('admin.classification_settings');
    }
  });
});
```

**Step 2: Run — expect failure**

```bash
cd web && pnpm vitest run src/lib/managers/global-search-manager.svelte.spec.ts
```

Expected: `runNavigationProvider is not a function`.

**Step 3: Implement**

Import at the top of the manager:

```ts
import { computeCommandScore } from 'bits-ui';
import { featureFlagsManager } from '$lib/managers/feature-flags-manager.svelte';
import { user } from '$lib/stores/user.store';
import { NAVIGATION_ITEMS, type NavigationItem } from './navigation-items';
```

Add the method:

```ts
private runNavigationProvider(query: string): ProviderStatus<NavigationItem> {
  if (query.length < 2) {
    return { status: 'empty' };
  }
  const u = get(user);
  const isAdmin = u?.isAdmin ?? false;
  const flags = featureFlagsManager.valueOrUndefined;
  const searchStrings = this.getNavigationSearchStrings();

  const scored: Array<{ item: NavigationItem; score: number }> = [];
  for (const item of NAVIGATION_ITEMS) {
    if (item.adminOnly && !isAdmin) {
      continue;
    }
    if (item.featureFlag && !flags?.[item.featureFlag]) {
      continue;
    }
    const corpus = searchStrings.get(item.id);
    if (!corpus) {
      continue;
    }
    const score = computeCommandScore(corpus, query);
    if (score <= 0) {
      continue;
    }
    scored.push({ item, score });
  }
  if (scored.length === 0) {
    return { status: 'empty' };
  }
  scored.sort((a, b) => b.score - a.score);
  const items = scored.map((s) => s.item);
  return { status: 'ok', items, total: items.length };
}
```

**Step 4: Run — expect pass**

**Step 5: Commit**

```bash
cd web && pnpm check:typescript && pnpm check:svelte
git add web/src/lib/managers/global-search-manager.svelte.ts \
  web/src/lib/managers/global-search-manager.svelte.spec.ts
git commit -m "feat(web): runNavigationProvider with fuzzy scoring + gates"
```

---

## Task 10 — Manager: wire navigation synchronously into `setQuery`

**Files:**

- Modify: `web/src/lib/managers/global-search-manager.svelte.ts` — `setQuery`, `buildProviders`
- Modify: `web/src/lib/managers/global-search-manager.svelte.spec.ts`

**Context:** The design mandates navigation bypasses the 150 ms debounce and runs synchronously inside `setQuery`. `runBatch` never iterates over `navigation`. Task 7 already scaffolded an `empty`-returning stub in `buildProviders`; this task replaces it with a dead stub (never invoked) and adds the synchronous call site.

**Step 1: Write failing tests**

```ts
describe('setQuery synchronous navigation', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    vi.useFakeTimers();
    installFakeAbortTimeout();
    vi.mocked(searchSmart).mockResolvedValue({ assets: { items: [], nextPage: null } } as never);
    vi.mocked(searchAssets).mockResolvedValue({ assets: { items: [], nextPage: null } } as never);
    vi.mocked(searchPerson).mockResolvedValue([] as never);
    vi.mocked(searchPlaces).mockResolvedValue([] as never);
    vi.mocked(getAllTags).mockResolvedValue([] as never);
  });
  afterEach(() => {
    restoreAbortTimeout();
    vi.useRealTimers();
  });

  it('navigation section updates BEFORE the debounce fires', () => {
    const m = new GlobalSearchManager();
    m.open();
    m.setQuery('classific');
    // Sync check — no timer advancement. Entity sections are loading; navigation is ok.
    expect(m.sections.navigation.status).toBe('ok');
    expect(m.sections.photos.status).toBe('loading');
  });

  it('runBatch does NOT re-invoke navigation after the debounce', () => {
    const m = new GlobalSearchManager();
    const spy = vi.spyOn(m as unknown as { runNavigationProvider: (q: string) => unknown }, 'runNavigationProvider');
    m.open();
    m.setQuery('classific');
    expect(spy).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(200);
    // After the debounce + runBatch have fired once each:
    expect(spy).toHaveBeenCalledTimes(1);
  });
});
```

**Step 2: Run — expect failure**

`setQuery` still wipes `navigation` to loading along with the others. First assertion fails.

**Step 3: Implement**

Modify `setQuery` to call `runNavigationProvider` synchronously after setting the query:

```ts
setQuery(text: string) {
  if (this.query === text) {
    return;
  }
  this.query = text;
  this.clearDebounce();
  this.batchController?.abort();
  this.batchController = null;
  this.photosController?.abort();
  this.photosController = null;

  if (text.trim() === '') {
    this.sections = {
      photos: idle,
      people: idle,
      places: idle,
      tags: idle,
      navigation: idle,
    };
    return;
  }

  // Synchronous: navigation updates immediately, bypassing the 150 ms debounce.
  // Navigation is client-side and should feel instant.
  this.sections.navigation = this.runNavigationProvider(text);

  // Entity sections flip to loading (SWR rule lands in Task 11).
  this.sections.photos = { status: 'loading' };
  this.sections.people = { status: 'loading' };
  this.sections.places = { status: 'loading' };
  this.sections.tags = { status: 'loading' };

  this.debounceTimer = setTimeout(() => this.runBatch(text, this.mode), 150);
}
```

**IMPORTANT:** The existing `runBatch` iterates over a hardcoded tuple `['photos', 'people', 'places', 'tags']` — do NOT add `'navigation'` to this tuple. The existing code already excludes nav by omission; the regression test pins this so future edits can't accidentally add it.

Remove (or leave as dead code) the stub navigation entry in `buildProviders` — it's never invoked because setQuery handles nav separately. If removed, `providers` becomes `Record<keyof Omit<Sections, 'navigation'>, Provider>` and type gymnastics get harder. **Recommendation: keep the stub**, since the runtime never calls it.

**Step 4: Run — expect pass**

**Step 5: Commit**

```bash
cd web && pnpm check:typescript && pnpm check:svelte
git add web/src/lib/managers/global-search-manager.svelte.ts \
  web/src/lib/managers/global-search-manager.svelte.spec.ts
git commit -m "feat(web): synchronous navigation provider path in setQuery"
```

---

## Task 11 — Manager: stale-while-revalidate rule + `batchInFlight`

**Files:**

- Modify: `web/src/lib/managers/global-search-manager.svelte.ts` — `setQuery`, `runBatch`, `setMode`
- Modify: `web/src/lib/managers/global-search-manager.svelte.spec.ts`

**Context:** The core jitter fix. `setQuery` stops wiping `ok` sections to `loading`. `batchInFlight: boolean` tracks active batches. `inFlightCounter` decrements on each provider settle.

**Step 1: Write failing tests**

```ts
describe('SWR loading rules', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    vi.useFakeTimers();
    installFakeAbortTimeout();
    vi.mocked(searchSmart).mockResolvedValue({ assets: { items: [], nextPage: null } } as never);
    vi.mocked(searchAssets).mockResolvedValue({ assets: { items: [], nextPage: null } } as never);
    vi.mocked(searchPerson).mockResolvedValue([] as never);
    vi.mocked(searchPlaces).mockResolvedValue([] as never);
    vi.mocked(getAllTags).mockResolvedValue([] as never);
  });
  afterEach(() => {
    restoreAbortTimeout();
    vi.useRealTimers();
  });

  it('preserves ok photos across a new keystroke (does NOT flip to loading)', async () => {
    vi.mocked(searchSmart).mockResolvedValueOnce({
      assets: { items: [{ id: 'a1' } as never], nextPage: null },
    } as never);
    const m = new GlobalSearchManager();
    m.open();
    m.setQuery('beach');
    await vi.advanceTimersByTimeAsync(200);
    expect(m.sections.photos.status).toBe('ok');
    m.setQuery('sunset');
    // Synchronously — photos should still be ok (old items), not loading.
    expect(m.sections.photos.status).toBe('ok');
  });

  it('flips empty → loading on new keystroke', async () => {
    vi.mocked(searchSmart).mockResolvedValue({ assets: { items: [], nextPage: null } } as never);
    const m = new GlobalSearchManager();
    m.open();
    m.setQuery('xxxx');
    await vi.advanceTimersByTimeAsync(200);
    expect(m.sections.photos.status).toBe('empty');
    m.setQuery('yyyy');
    expect(m.sections.photos.status).toBe('loading');
  });

  it('flips error → loading on new keystroke', async () => {
    vi.mocked(searchSmart).mockRejectedValue(new Error('boom'));
    const m = new GlobalSearchManager();
    m.open();
    m.setQuery('xxxx');
    await vi.advanceTimersByTimeAsync(200);
    expect(m.sections.photos.status).toBe('error');
    m.setQuery('yyyy');
    expect(m.sections.photos.status).toBe('loading');
  });

  it('flips idle → loading on FIRST keystroke (cold open)', () => {
    const m = new GlobalSearchManager();
    m.open();
    // Every entity section is idle at this point.
    m.setQuery('a');
    expect(m.sections.photos.status).toBe('loading');
  });

  it('batchInFlight is true during setQuery and false after all providers settle', async () => {
    const m = new GlobalSearchManager();
    m.open();
    m.setQuery('beach');
    expect(m.batchInFlight).toBe(true);
    await vi.advanceTimersByTimeAsync(200);
    expect(m.batchInFlight).toBe(false);
  });

  it('cold-open first keystroke: navigation is ok instantly, entity sections flip to loading', () => {
    mockUser.current = { isAdmin: true };
    const m = new GlobalSearchManager();
    m.open();
    m.setQuery('classific');
    // Navigation is synchronous.
    expect(m.sections.navigation.status).toBe('ok');
    // Entities were idle on cold open, so they all flip to loading (SWR skips only ok).
    expect(m.sections.photos.status).toBe('loading');
    expect(m.sections.people.status).toBe('loading');
  });

  it('setMode preserves ok photos until re-run completes (SWR)', async () => {
    vi.mocked(searchSmart).mockResolvedValueOnce({
      assets: { items: [{ id: 'a1' } as never], nextPage: null },
    } as never);
    const m = new GlobalSearchManager();
    m.open();
    m.setQuery('beach');
    await vi.advanceTimersByTimeAsync(200);
    expect(m.sections.photos.status).toBe('ok');
    // Mode switch: synchronously, photos stays ok.
    m.setMode('metadata');
    expect(m.sections.photos.status).toBe('ok');
  });

  it('setMode joins the batch counter — mode switch during live batch does NOT drop stripe early', async () => {
    // Create a slow photos provider so the batch stays in flight.
    let resolvePhotos!: () => void;
    vi.mocked(searchSmart).mockImplementationOnce(
      () => new Promise((r) => (resolvePhotos = () => r({ assets: { items: [], nextPage: null } } as never))),
    );
    const m = new GlobalSearchManager();
    m.open();
    m.setQuery('beach');
    await vi.advanceTimersByTimeAsync(200); // runBatch fires
    expect(m.batchInFlight).toBe(true);
    // Mode switch while photos is still in flight.
    m.setMode('metadata');
    expect(m.batchInFlight).toBe(true); // still true — setMode increments the counter
    // Let the setMode-triggered re-run resolve first (fast path).
    vi.mocked(searchAssets).mockResolvedValueOnce({ assets: { items: [], nextPage: null } } as never);
    await vi.advanceTimersByTimeAsync(10);
    // Original photos still in flight — batchInFlight MUST remain true.
    expect(m.batchInFlight).toBe(true);
    // Finally, let the original photos resolve.
    resolvePhotos();
    await vi.advanceTimersByTimeAsync(10);
    expect(m.batchInFlight).toBe(false);
  });

  it('stale-batch providers do not deadlock batchInFlight after a new batch supersedes', async () => {
    // Simulate a provider that ignores abort signals (worst case — mocks that don't
    // listen to the AbortSignal, or real backends that are slow to cancel).
    let resolveStalePhotos!: () => void;
    vi.mocked(searchSmart).mockImplementationOnce(
      () => new Promise((r) => (resolveStalePhotos = () => r({ assets: { items: [], nextPage: null } } as never))),
    );
    const m = new GlobalSearchManager();
    m.open();
    m.setQuery('first');
    await vi.advanceTimersByTimeAsync(200); // runBatch1 fires, stuck on photos
    expect(m.batchInFlight).toBe(true);
    // Second query — runBatch2 replaces runBatch1. Uses the default mockResolvedValue
    // (empty + instant) so runBatch2 settles quickly.
    m.setQuery('second');
    await vi.advanceTimersByTimeAsync(200);
    // runBatch2 fully settled; runBatch1's stale photos still pending. batchInFlight
    // should be FALSE because the current batch (runBatch2) has no pending providers.
    expect(m.batchInFlight).toBe(false);
    // Release the stale photos; the counter must NOT go negative (check-before-decrement
    // guard in onSettle drops stale settles).
    resolveStalePhotos();
    await vi.advanceTimersByTimeAsync(10);
    expect((m as unknown as { inFlightCounter: number }).inFlightCounter).toBe(0);
    expect(m.batchInFlight).toBe(false);
  });

  it('runBatch entry resets inFlightCounter to zero before incrementing per-provider', async () => {
    const m = new GlobalSearchManager();
    m.open();
    // Force a non-zero counter to simulate stale bookkeeping.
    (m as unknown as { inFlightCounter: number }).inFlightCounter = 99;
    m.setQuery('beach');
    await vi.advanceTimersByTimeAsync(200);
    // After runBatch has started and settled, counter should be 0 — not 99 minus N.
    expect((m as unknown as { inFlightCounter: number }).inFlightCounter).toBe(0);
  });

  it('setMode with empty query is a no-op (cold open)', () => {
    const m = new GlobalSearchManager();
    m.open();
    // No setQuery call, query is empty.
    m.setMode('metadata');
    expect(m.batchInFlight).toBe(false);
    expect(m.sections.photos.status).toBe('idle');
    expect((m as unknown as { inFlightCounter: number }).inFlightCounter).toBe(0);
  });

  it('rapid mode switching does not decrement counter below zero', async () => {
    vi.mocked(searchSmart).mockResolvedValue({ assets: { items: [], nextPage: null } } as never);
    vi.mocked(searchAssets).mockResolvedValue({ assets: { items: [], nextPage: null } } as never);
    const m = new GlobalSearchManager();
    m.open();
    m.setQuery('beach');
    await vi.advanceTimersByTimeAsync(200);
    // Rapid mode churn.
    m.setMode('metadata');
    m.setMode('description');
    m.setMode('ocr');
    m.setMode('smart');
    await vi.advanceTimersByTimeAsync(100);
    // Should settle cleanly; no negative counter; batchInFlight returns to false.
    expect(m.batchInFlight).toBe(false);
    expect((m as unknown as { inFlightCounter: number }).inFlightCounter).toBe(0);
  });
});
```

**Step 2: Run — expect failure**

**Step 3: Implement**

Add state fields:

```ts
batchInFlight = $state(false);
private _batchInFlightStartedAt = 0;
/**
 * Public getter — the component needs to read this for the progress stripe's
 * 200ms grace calculation but the field stays encapsulated.
 */
get batchInFlightStartedAt() {
  return this._batchInFlightStartedAt;
}
private inFlightCounter = 0;
```

Update `setQuery` (replace the photos/people/places/tags wipe):

```ts
// SWR rule: only flip sections that are NOT 'ok' to loading. Preserve ok content.
for (const key of ['photos', 'people', 'places', 'tags'] as const) {
  if (this.sections[key].status !== 'ok') {
    this.sections[key] = { status: 'loading' };
  }
}

// batchInFlight flips true here, but batchInFlightStartedAt is set INSIDE runBatch.
// Starting the grace-window timer at setQuery time would let the 150ms debounce
// eat most of the 200ms grace and fast backend responses would flash the stripe.
this.batchInFlight = true;
this.debounceTimer = setTimeout(() => this.runBatch(text, this.mode), 150);
```

Update `runBatch` — set `batchInFlightStartedAt` HERE (at debounce-fire time, not setQuery time), **reset the counter at batch entry** (this batch owns the bookkeeping), and **check-before-decrement** so stale providers from superseded batches no-op on settle:

```ts
protected runBatch(text: string, mode: SearchMode) {
  this.debounceTimer = null;
  this._batchInFlightStartedAt = performance.now(); // 200ms grace starts now
  const batch = new AbortController();
  const photosLocal = new AbortController();
  this.batchController = batch;
  this.photosController = photosLocal;

  // Reset the counter — this batch owns the bookkeeping from here on. Any stale
  // onSettle calls from a prior batch will no-op via the check-below guard. Without
  // the reset, a stale batch whose providers don't respect AbortSignal could keep
  // incrementing/decrementing the shared counter and corrupt the state.
  this.inFlightCounter = 0;

  const keys = ['photos', 'people', 'places', 'tags'] as const;

  for (const key of keys) {
    const provider = this.providers[key];
    if (text.length < provider.minQueryLength) {
      this.sections[key] = idle;
      continue;
    }
    this.inFlightCounter++;
    const controllers = key === 'photos' ? [batch.signal, photosLocal.signal] : [batch.signal];
    const signal = AbortSignal.any([...controllers, AbortSignal.timeout(5000)]);

    const onSettle = () => {
      // Check-before-decrement: stale batches' providers no-op. Without this,
      // a provider that ignores AbortSignal (buggy mock or real slow backend)
      // could decrement the counter after a new batch has started, deadlocking
      // batchInFlight at true because the *new* batch's final-settle would find
      // counter > 0 while nothing meaningful is pending.
      if (batch !== this.batchController) {
        return;
      }
      this.inFlightCounter--;
      if (this.inFlightCounter === 0) {
        this.batchInFlight = false;
      }
    };

    Promise.resolve()
      .then(() => provider.run(text, mode, signal))
      .then((result) => {
        if (batch !== this.batchController) {
          // Stale batch: don't update sections. onSettle no-ops per guard above.
          return;
        }
        this.sections[key] = result;
        if (key === 'photos') {
          this.onPhotosSettled();
        }
        this.reconcileCursor();
        onSettle();
      })
      .catch((err: unknown) => {
        if (batch !== this.batchController) {
          return;
        }
        if (err instanceof Error && err.name === 'AbortError') {
          if (signal.aborted && signal.reason instanceof DOMException && signal.reason.name === 'TimeoutError') {
            this.sections[key] = { status: 'timeout' };
            if (key === 'photos') {
              this.onPhotosSettled();
            }
          }
          onSettle();
          return;
        }
        const message = err instanceof Error ? err.message : 'unknown error';
        this.sections[key] = { status: 'error', message };
        if (key === 'photos') {
          this.onPhotosSettled();
        }
        onSettle();
      });
  }

  if (this.inFlightCounter === 0) {
    // All sections were below minQueryLength — nothing to do.
    this.batchInFlight = false;
  }
}
```

`setMode`'s photos-only re-run must use the same SWR rule AND integrate with the in-flight counter (not flip `batchInFlight` directly) — otherwise a mode switch during an active batch would prematurely drop the progress stripe. It also needs the SAME stale-batch guard as `runBatch`'s `onSettle`, otherwise a slow setMode re-run that resolves AFTER a new `runBatch` has reset the counter would corrupt the new batch's bookkeeping:

```ts
// In setMode's non-debounce branch, replace the current loading flip:
if (this.sections.photos.status !== 'ok') {
  this.sections.photos = { status: 'loading' };
}

// Capture the current batch identity so a stale setMode straggler doesn't decrement
// a future batch's counter. If no batch is active, capture null.
const setModeBatch = this.batchController;

// Join the in-flight counter.
this.inFlightCounter++;
if (!this.batchInFlight) {
  this.batchInFlight = true;
  this._batchInFlightStartedAt = performance.now();
}
```

In the promise `.then`/`.catch` of the setMode re-run, both paths share the same guard:

```ts
const onSetModeSettle = () => {
  // Stale-batch guard — same pattern as runBatch.onSettle. If a new runBatch has
  // taken over the batchController since setMode fired, this stale settle no-ops.
  if (this.batchController !== setModeBatch) {
    return;
  }
  this.inFlightCounter--;
  if (this.inFlightCounter === 0) {
    this.batchInFlight = false;
  }
};

// In .then:
this.sections.photos = result;
this.onPhotosSettled();
this.reconcileCursor();
onSetModeSettle();

// In .catch (AbortError + non-AbortError branches both call onSetModeSettle()).
```

This ensures mode switches share bookkeeping with the main batch AND tolerate stale settles after a new batch supersedes — `batchInFlight` stays accurate in both directions.

**Step 4: Run — expect pass**

**Step 5: Commit**

```bash
cd web && pnpm check:typescript && pnpm check:svelte
git add web/src/lib/managers/global-search-manager.svelte.ts \
  web/src/lib/managers/global-search-manager.svelte.spec.ts
git commit -m "feat(web): stale-while-revalidate loading rules + batchInFlight state"
```

---

## Task 12 — Manager: `activate('navigation')` + `activateRecent` navigate branch

**Files:**

- Modify: `web/src/lib/managers/global-search-manager.svelte.ts` — `activate`, `activateRecent`
- Modify: `web/src/lib/managers/global-search-manager.svelte.spec.ts`

**Context:** Final manager piece. Navigation items either toggle theme (one specific id) or `goto(route)` + persist as a `navigate` recent. `activateRecent` re-checks admin status and purges stale entries via `removeEntry` (Task 3).

**Step 1: Write failing tests**

```ts
describe('activate navigation', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    resetRecentStore();
  });

  it('theme toggle: calls toggleTheme + does NOT persist a recent', () => {
    const m = new GlobalSearchManager();
    m.open();
    m.activate('nav', {
      id: 'nav:theme',
      category: 'actions',
      labelKey: 'theme',
      descriptionKey: 'toggle_theme_description',
      icon: 'x',
      route: '',
      adminOnly: false,
    });
    expect(themeManager.toggleTheme).toHaveBeenCalled();
    expect(getEntries().find((e) => e.id === 'nav:theme')).toBeUndefined();
  });

  it('system-settings item: goto + persist navigate recent', () => {
    const m = new GlobalSearchManager();
    m.open();
    m.activate('nav', {
      id: 'nav:systemSettings:classification',
      category: 'systemSettings',
      labelKey: 'admin.classification_settings',
      descriptionKey: 'admin.classification_settings_description',
      icon: 'x',
      route: '/admin/system-settings?isOpen=classification',
      adminOnly: true,
    });
    expect(goto).toHaveBeenCalledWith('/admin/system-settings?isOpen=classification');
    const entries = getEntries();
    expect(entries[0]).toMatchObject({
      kind: 'navigate',
      id: 'nav:systemSettings:classification',
      route: '/admin/system-settings?isOpen=classification',
      adminOnly: true,
    });
  });
});

describe('activateRecent stale admin purge', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    resetRecentStore();
  });

  it('admin user: navigates normally and does NOT purge', () => {
    mockUser.current = { isAdmin: true };
    const m = new GlobalSearchManager();
    m.open();
    addEntry({
      kind: 'navigate',
      id: 'nav:admin:users',
      route: '/admin/users',
      labelKey: 'users',
      icon: 'x',
      adminOnly: true,
      lastUsed: 1,
    });
    m.activateRecent({
      kind: 'navigate',
      id: 'nav:admin:users',
      route: '/admin/users',
      labelKey: 'users',
      icon: 'x',
      adminOnly: true,
      lastUsed: 1,
    });
    expect(goto).toHaveBeenCalledWith('/admin/users');
    expect(getEntries().some((e) => e.id === 'nav:admin:users')).toBe(true);
  });

  it('non-admin user: warns, purges entry, does NOT navigate', () => {
    mockUser.current = { isAdmin: false };
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const m = new GlobalSearchManager();
    m.open();
    addEntry({
      kind: 'navigate',
      id: 'nav:admin:users',
      route: '/admin/users',
      labelKey: 'users',
      icon: 'x',
      adminOnly: true,
      lastUsed: 1,
    });
    m.activateRecent({
      kind: 'navigate',
      id: 'nav:admin:users',
      route: '/admin/users',
      labelKey: 'users',
      icon: 'x',
      adminOnly: true,
      lastUsed: 1,
    });
    expect(warnSpy).toHaveBeenCalled();
    expect(goto).not.toHaveBeenCalled();
    expect(getEntries().some((e) => e.id === 'nav:admin:users')).toBe(false);
    expect(m.isOpen).toBe(false);
    warnSpy.mockRestore();
  });

  it('purge mechanism: activateRecent calls removeEntry (not some other clearing path)', async () => {
    // Spy on the actual removeEntry export to pin the contract — guards against a
    // future refactor that "purges" stale entries via clearEntries() or similar.
    const recentModule = await import('$lib/stores/cmdk-recent');
    const removeSpy = vi.spyOn(recentModule, 'removeEntry');
    mockUser.current = { isAdmin: false };
    const m = new GlobalSearchManager();
    m.open();
    addEntry({
      kind: 'navigate',
      id: 'nav:admin:users',
      route: '/admin/users',
      labelKey: 'users',
      icon: 'x',
      adminOnly: true,
      lastUsed: 1,
    });
    m.activateRecent({
      kind: 'navigate',
      id: 'nav:admin:users',
      route: '/admin/users',
      labelKey: 'users',
      icon: 'x',
      adminOnly: true,
      lastUsed: 1,
    });
    expect(removeSpy).toHaveBeenCalledWith('nav:admin:users');
    removeSpy.mockRestore();
  });
});
```

**Step 2: Run — expect failure**

**Step 3: Implement**

Import:

```ts
import { themeManager } from '$lib/managers/theme-manager.svelte';
import { removeEntry } from '$lib/stores/cmdk-recent';
```

Extend `activate` to handle the `nav` kind:

```ts
activate(kind: 'photo' | 'person' | 'place' | 'tag' | 'nav', item: unknown) {
  const now = Date.now();
  switch (kind) {
    // ... existing photo/person/place/tag cases ...
    case 'nav': {
      const n = item as NavigationItem;
      if (n.category === 'actions' && n.id === 'nav:theme') {
        themeManager.toggleTheme();
        // Theme toggle is stateless — not persisted to recents.
      } else {
        addEntry({
          kind: 'navigate',
          id: n.id,
          route: n.route,
          labelKey: n.labelKey,
          icon: n.icon,
          adminOnly: n.adminOnly,
          lastUsed: now,
        });
        void goto(n.route);
      }
      break;
    }
  }
  this.close();
}
```

Extend `activateRecent`:

```ts
activateRecent(entry: RecentEntry) {
  if (!isValidRecentEntry(entry)) {
    console.warn('[cmdk] ignoring corrupt recent entry', entry);
    this.close();
    return;
  }
  // Admin gate re-check for stale navigate entries.
  if (entry.kind === 'navigate' && entry.adminOnly && !(get(user)?.isAdmin ?? false)) {
    console.warn('[cmdk] purging stale admin recent', entry);
    removeEntry(entry.id);
    this.close();
    return;
  }
  const now = Date.now();
  addEntry({ ...entry, lastUsed: now });
  if (entry.kind === 'query') {
    this.setMode(entry.mode);
    this.setQuery(entry.text);
    return;
  }
  switch (entry.kind) {
    // ... existing photo/person/place/tag cases ...
    case 'navigate': {
      void goto(entry.route);
      break;
    }
  }
  this.close();
}
```

**Step 4: Run — expect pass**

**Step 5: Commit**

```bash
cd web && pnpm check:typescript && pnpm check:svelte
git add web/src/lib/managers/global-search-manager.svelte.ts \
  web/src/lib/managers/global-search-manager.svelte.spec.ts
git commit -m "feat(web): activate navigation + stale-admin purge in activateRecent"
```

---

## Task 13 — `navigation-row.svelte` component + spec

**Files:**

- Create: `web/src/lib/components/global-search/rows/navigation-row.svelte`
- Create: `web/src/lib/components/global-search/__tests__/navigation-row.spec.ts`

**Step 1: Write failing test**

```ts
// __tests__/navigation-row.spec.ts
import { render, screen } from '@testing-library/svelte';
import { describe, it, expect } from 'vitest';
import NavigationRow from '../rows/navigation-row.svelte';

describe('navigation-row', () => {
  const baseItem = {
    id: 'nav:systemSettings:classification',
    category: 'systemSettings' as const,
    labelKey: 'admin.classification_settings',
    descriptionKey: 'admin.classification_settings_description',
    icon: 'M12 2L1 12h3v9h7v-6h2v6h7v-9h3L12 2z',
    route: '/admin/system-settings?isOpen=classification',
    adminOnly: true,
  };

  it('renders the translated label and description', () => {
    render(NavigationRow, { props: { item: baseItem } });
    // svelte-i18n's `fallbackLocale: 'dev'` used in setup renders the key name when no translation exists.
    expect(screen.getByText(/classification/i)).toBeInTheDocument();
  });

  it('renders an Icon element with the provided path', () => {
    const { container } = render(NavigationRow, { props: { item: baseItem } });
    expect(container.querySelector('svg')).not.toBeNull();
  });

  it('does NOT set role="option" (Command.Item wraps)', () => {
    const { container } = render(NavigationRow, { props: { item: baseItem } });
    expect(container.querySelector('[role="option"]')).toBeNull();
  });

  it('has transition-colors class for the 80ms active-tint animation', () => {
    const { container } = render(NavigationRow, { props: { item: baseItem } });
    const root = container.firstElementChild as HTMLElement;
    expect(root.className).toContain('transition-colors');
  });
});
```

**Step 2: Run — expect failure**

**Step 3: Implement**

```svelte
<!-- web/src/lib/components/global-search/rows/navigation-row.svelte -->
<script lang="ts">
  import type { NavigationItem } from '$lib/managers/navigation-items';
  import { Icon } from '@immich/ui';
  import { t } from 'svelte-i18n';

  interface Props {
    item: NavigationItem;
  }
  let { item }: Props = $props();
</script>

<div
  class="flex h-[52px] items-center gap-3 rounded-lg px-3 py-2 transition-colors duration-[80ms] ease-out data-[selected=true]:bg-primary/10"
>
  <div class="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-subtle/40">
    <Icon icon={item.icon} size="1.125em" class="text-gray-500 dark:text-gray-400" />
  </div>
  <div class="min-w-0 flex-1">
    <div class="truncate text-sm font-medium">{$t(item.labelKey)}</div>
    <div class="truncate text-xs text-gray-500 dark:text-gray-400">{$t(item.descriptionKey)}</div>
  </div>
</div>
```

**Step 4: Run — expect pass**

**Step 5: Commit**

```bash
cd web && pnpm check:typescript && pnpm check:svelte
git add web/src/lib/components/global-search/rows/navigation-row.svelte \
  web/src/lib/components/global-search/__tests__/navigation-row.spec.ts
git commit -m "feat(web): navigation-row component"
```

---

## Task 14 — `GlobalSearchNavigationSections.svelte` (groups + render)

**Files:**

- Create: `web/src/lib/components/global-search/global-search-navigation-sections.svelte`
- Create: `web/src/lib/components/global-search/__tests__/global-search-navigation-sections.spec.ts`

**Context:** Takes a flat `ProviderStatus<NavigationItem>`, groups by `category` at render time, emits 1–4 `<Command.Group>` sub-sections in fixed order (`systemSettings → admin → userPages → actions`), slices each to `topN = 5`, and renders each item via `navigation-row.svelte`.

**Step 1: Write failing test**

```ts
import { render, screen } from '@testing-library/svelte';
import { describe, it, expect } from 'vitest';
import GlobalSearchNavigationSections from '../global-search-navigation-sections.svelte';
import type { NavigationItem } from '$lib/managers/navigation-items';

describe('global-search-navigation-sections', () => {
  function makeItem(category: NavigationItem['category'], id: string): NavigationItem {
    return {
      id,
      category,
      labelKey: `label-${id}`,
      descriptionKey: `desc-${id}`,
      icon: 'M0 0',
      route: category === 'actions' ? '' : `/${id}`,
      adminOnly: category === 'systemSettings' || category === 'admin',
    };
  }

  it('renders nothing when status is idle', () => {
    const { container } = render(GlobalSearchNavigationSections, {
      props: { status: { status: 'idle' }, onActivate: () => {} },
    });
    expect(container.textContent?.trim()).toBe('');
  });

  it('renders nothing when status is empty', () => {
    const { container } = render(GlobalSearchNavigationSections, {
      props: { status: { status: 'empty' }, onActivate: () => {} },
    });
    expect(container.textContent?.trim()).toBe('');
  });

  it('renders nothing when status is loading', () => {
    const { container } = render(GlobalSearchNavigationSections, {
      props: { status: { status: 'loading' }, onActivate: () => {} },
    });
    expect(container.textContent?.trim()).toBe('');
  });

  it('renders four sub-sections in fixed order when all categories have items', () => {
    const items = [
      makeItem('actions', 'nav:theme'),
      makeItem('admin', 'nav:admin:users'),
      makeItem('userPages', 'nav:userPages:photos'),
      makeItem('systemSettings', 'nav:systemSettings:authentication'),
    ];
    const { container } = render(GlobalSearchNavigationSections, {
      props: { status: { status: 'ok', items, total: items.length }, onActivate: () => {} },
    });
    const headings = [...container.querySelectorAll('[data-command-group-heading]')];
    const order = headings.map((h) => (h as HTMLElement).textContent?.trim());
    expect(order).toEqual([
      expect.stringMatching(/system.*settings/i),
      expect.stringMatching(/admin/i),
      expect.stringMatching(/navigation|user/i),
      expect.stringMatching(/actions/i),
    ]);
  });

  it('omits empty categories entirely (no heading)', () => {
    const items = [makeItem('actions', 'nav:theme')];
    const { container } = render(GlobalSearchNavigationSections, {
      props: { status: { status: 'ok', items, total: 1 }, onActivate: () => {} },
    });
    const headings = [...container.querySelectorAll('[data-command-group-heading]')];
    expect(headings).toHaveLength(1);
    expect(headings[0].textContent).toMatch(/actions/i);
  });

  it('slices each category to topN=5', () => {
    const items: NavigationItem[] = [];
    for (let i = 0; i < 8; i++) {
      items.push(makeItem('systemSettings', `nav:systemSettings:k${i}`));
    }
    const { container } = render(GlobalSearchNavigationSections, {
      props: { status: { status: 'ok', items, total: items.length }, onActivate: () => {} },
    });
    const rows = container.querySelectorAll('[data-command-item]');
    expect(rows.length).toBe(5);
  });

  it('pins that no "× N more" affordance is rendered', () => {
    const items: NavigationItem[] = [];
    for (let i = 0; i < 8; i++) {
      items.push(makeItem('systemSettings', `nav:systemSettings:k${i}`));
    }
    const { container } = render(GlobalSearchNavigationSections, {
      props: { status: { status: 'ok', items, total: items.length }, onActivate: () => {} },
    });
    expect(container.textContent).not.toMatch(/more|see all/i);
  });
});
```

**Step 2: Run — expect failure**

**Step 3: Implement**

```svelte
<!-- web/src/lib/components/global-search/global-search-navigation-sections.svelte -->
<script lang="ts">
  import type { NavigationItem, NavigationCategory } from '$lib/managers/navigation-items';
  import type { ProviderStatus } from '$lib/managers/global-search-manager.svelte';
  import { Command } from 'bits-ui';
  import { t } from 'svelte-i18n';
  import { fade } from 'svelte/transition';
  import NavigationRow from './rows/navigation-row.svelte';

  interface Props {
    status: ProviderStatus<NavigationItem>;
    onActivate: (item: NavigationItem) => void;
  }
  let { status, onActivate }: Props = $props();

  const TOP_N = 5;
  const ORDER: ReadonlyArray<{ category: NavigationCategory; headingKey: string }> = [
    { category: 'systemSettings', headingKey: 'cmdk_section_system_settings' },
    { category: 'admin', headingKey: 'cmdk_section_admin' },
    { category: 'userPages', headingKey: 'cmdk_section_user_pages' },
    { category: 'actions', headingKey: 'cmdk_section_actions' },
  ];

  const buckets = $derived.by(() => {
    if (status.status !== 'ok') {
      return [];
    }
    const byCategory = new Map<NavigationCategory, NavigationItem[]>();
    for (const item of status.items) {
      const arr = byCategory.get(item.category) ?? [];
      if (arr.length < TOP_N) {
        arr.push(item);
        byCategory.set(item.category, arr);
      }
    }
    return ORDER.filter(({ category }) => (byCategory.get(category)?.length ?? 0) > 0).map(({ category, headingKey }) => ({
      category,
      headingKey,
      items: byCategory.get(category) ?? [],
    }));
  });
</script>

{#if status.status === 'ok' && buckets.length > 0}
  <div in:fade={{ duration: 120 }} out:fade={{ duration: 80 }}>
    {#each buckets as bucket (bucket.category)}
      <Command.Group class="mb-4">
        <Command.GroupHeading
          class="px-3 pb-1 text-[11px] font-semibold uppercase tracking-wider text-gray-500 dark:text-gray-400"
        >
          {$t(bucket.headingKey)}
        </Command.GroupHeading>
        <Command.GroupItems>
          {#each bucket.items as item (item.id)}
            <Command.Item value={item.id} onSelect={() => onActivate(item)}>
              <NavigationRow {item} />
            </Command.Item>
          {/each}
        </Command.GroupItems>
      </Command.Group>
    {/each}
  </div>
{/if}
```

**Step 4: Run — expect pass**

**Step 5: Commit**

```bash
cd web && pnpm check:typescript && pnpm check:svelte
git add web/src/lib/components/global-search/global-search-navigation-sections.svelte \
  web/src/lib/components/global-search/__tests__/global-search-navigation-sections.spec.ts
git commit -m "feat(web): GlobalSearchNavigationSections with render-time category grouping"
```

---

## Task 15 — `global-search.svelte`: mount nav sections + progress stripe + stale-admin filter

**Files:**

- Modify: `web/src/lib/components/global-search/global-search.svelte`
- Modify: `web/src/lib/components/global-search/__tests__/global-search.spec.ts`
- Modify: `web/src/app.css` — `@keyframes cmdk-shimmer` + utility class

**Step 1: Write failing tests**

Append to `global-search.spec.ts`:

```ts
it('navigation sub-sections render below entity sections', async () => {
  // Mock user as admin so system-settings show.
  // Provide a manager that runs navigation synchronously via setQuery.
  const m = new GlobalSearchManager();
  m.open();
  render(GlobalSearch, { props: { manager: m } });
  await user.type(screen.getByRole('combobox'), 'classific');
  await vi.waitFor(() => {
    expect(screen.getByText(/cmdk_section_system_settings|system settings/i)).toBeInTheDocument();
  });
  // DOM order assertion: the nav section heading appears AFTER the photos heading in document order
  const photosHeading = screen.queryByText(/cmdk_photos_heading|photos/i);
  const navHeading = screen.getByText(/cmdk_section_system_settings|system settings/i);
  if (photosHeading) {
    expect(photosHeading.compareDocumentPosition(navHeading) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  }
});

it('progress stripe renders when batchInFlight > 200ms', async () => {
  const m = new GlobalSearchManager();
  (m as unknown as { providers: Record<string, Provider> }).providers.photos.run = () => new Promise(() => {}); // never resolves
  m.open();
  render(GlobalSearch, { props: { manager: m } });
  await user.type(screen.getByRole('combobox'), 'beach');
  await new Promise((r) => setTimeout(r, 250));
  const stripe = document.querySelector('[data-cmdk-progress]');
  expect(stripe).not.toBeNull();
});

it('progress stripe is hidden for fast-settling queries', async () => {
  // All providers resolve instantly → batch settles in microtask; stripe never shows.
  const m = new GlobalSearchManager();
  m.open();
  render(GlobalSearch, { props: { manager: m } });
  await user.type(screen.getByRole('combobox'), 'beach');
  await new Promise((r) => setTimeout(r, 100));
  const stripe = document.querySelector('[data-cmdk-progress]');
  expect(stripe).toBeNull();
});

it('render-time filter hides stale admin navigate entries for non-admins', () => {
  // Mock non-admin user
  addEntry({
    kind: 'navigate',
    id: 'nav:admin:users',
    route: '/admin/users',
    labelKey: 'users',
    icon: 'x',
    adminOnly: true,
    lastUsed: 1,
  });
  const m = new GlobalSearchManager();
  m.open();
  render(GlobalSearch, { props: { manager: m } });
  expect(screen.queryByText(/admin users page/i)).toBeNull();
});
```

**Step 2: Run — expect failure**

**Step 3: Implement in `global-search.svelte`**

Add the progress stripe + nav sections mount + recent filter. Relevant additions:

```svelte
<script lang="ts">
  // ... existing imports ...
  import GlobalSearchNavigationSections from './global-search-navigation-sections.svelte';
  import { user } from '$lib/stores/user.store';

  // ... existing state ...

  // Render-time filter: drop stale admin navigate entries for non-admin users.
  const recentEntries = $derived<RecentEntry[]>(() => {
    if (inputValue.trim() !== '') {
      return [];
    }
    const isAdmin = $user?.isAdmin ?? false;
    return getEntries().filter((e) => !(e.kind === 'navigate' && e.adminOnly && !isAdmin));
  });

  // Progress stripe: show only after 200ms grace so fast queries don't flash.
  // Clean setTimeout pattern — no interval, no `performance.now` polling.
  let stripeArmed = $state(false);
  let stripeTimer: ReturnType<typeof setTimeout> | null = null;

  $effect(() => {
    if (manager.batchInFlight) {
      stripeTimer = setTimeout(() => {
        stripeArmed = true;
      }, 200);
      return () => {
        if (stripeTimer !== null) {
          clearTimeout(stripeTimer);
          stripeTimer = null;
        }
        stripeArmed = false;
      };
    }
  });

  const showProgressStripe = $derived(stripeArmed && manager.batchInFlight);
</script>

<!-- Inside Command.Root, after Command.Input: -->
{#if showProgressStripe}
  <div
    aria-hidden="true"
    data-cmdk-progress
    class="h-0.5 bg-gradient-to-r from-transparent via-primary to-transparent bg-[length:200%_100%] animate-cmdk-shimmer"
  ></div>
{/if}

<!-- Inside the results area, AFTER the four entity GlobalSearchSection instances: -->
<GlobalSearchNavigationSections
  status={manager.sections.navigation}
  onActivate={(item) => manager.activate('nav', item)}
/>
```

**Note:** the setTimeout pattern above does not read `batchInFlightStartedAt` at all — the 200 ms grace is encoded purely as a timer. Task 11 still exposes `batchInFlightStartedAt` via a public getter, but this component no longer depends on it. The getter remains for future diagnostic use and for any test that wants to assert the timing invariant.

**Note on rapid batch cycles:** If `batchInFlight` flips `true → false → true` in under 200 ms (e.g. the user is typing fast, each batch settles quickly), the `$effect` cleanup fires on each `false` transition, clearing the pending timer and resetting `stripeArmed`. The next `true` transition starts a fresh 200 ms timer. Practical effect: **the stripe only appears when a single batch takes > 200 ms to settle**, which is exactly the intent — fast sessions never see a stripe at all. This is desirable behavior, not a bug.

Add to `web/src/app.css`:

```css
@keyframes cmdk-shimmer {
  0% {
    background-position: 200% 0;
  }
  100% {
    background-position: -200% 0;
  }
}
.animate-cmdk-shimmer {
  animation: cmdk-shimmer 1.6s linear infinite;
}
```

**Step 4: Run — expect pass**

**Step 5: Commit**

```bash
cd web && pnpm check:typescript && pnpm check:svelte
git add web/src/lib/components/global-search/global-search.svelte \
  web/src/lib/components/global-search/__tests__/global-search.spec.ts \
  web/src/app.css
git commit -m "feat(web): mount navigation sections + progress stripe in palette"
```

---

## Task 16 — Disable `@immich/ui` global palette + re-register Shift+T

**Files:**

- Modify: `web/src/routes/+layout.ts` — delete `commandPaletteManager.enable()` (line 25)
- Modify: `web/src/routes/+layout.svelte` — add `Shift+T` shortcut

**Step 1: Verify the callsite**

```bash
grep -n "commandPaletteManager.enable" web/src/routes/+layout.ts
```

Expected: one hit at line 25.

**Step 2: Edit `+layout.ts`**

Replace `commandPaletteManager.enable();` with a comment:

```ts
// commandPaletteManager.enable() is intentionally NOT called — we reclaim Ctrl+K /
// Cmd+K / `/` for our cmdk palette (GlobalSearchManager). Per-page
// <CommandPaletteDefaultProvider> mounts still compile but their shortcut is dead.
// Re-enable this call if we decide to restore per-page action palettes.
```

Leave the `import { commandPaletteManager } from '@immich/ui'` line (the existing import) if linting complains about unused imports; otherwise remove it. Prefer removal.

**Step 3: Add `Shift+T` in `+layout.svelte`**

The existing `<svelte:document>` at line 237 uses both `use:shortcut` and `use:shortcuts`. Add a new `use:shortcut` invocation above the existing bindings:

```svelte
<svelte:document
  use:shortcut={{
    shortcut: { ctrl: true, shift: true, key: 'm' },
    onShortcut: () => copyToClipboard(getMyImmichLink().toString()),
  }}
  use:shortcut={{
    shortcut: { shift: true, key: 't' },
    onShortcut: () => themeManager.toggleTheme(),
  }}
  use:shortcuts={[
    // ... existing Ctrl+K / Ctrl+/ bindings ...
  ]}
/>
```

Import `themeManager`:

```svelte
import { themeManager } from '$lib/managers/theme-manager.svelte';
```

**Step 4: Manual verification**

```bash
cd web && pnpm check:typescript && pnpm check:svelte
```

No unit test here — the assertion happens in E2E (Task 17). The skipped `Ctrl+K` binding is observable by opening the palette in the dev stack.

**Step 5: Commit**

```bash
git add web/src/routes/+layout.ts web/src/routes/+layout.svelte
git commit -m "feat(web): disable @immich/ui palette; reclaim Ctrl+K, re-register Shift+T"
```

---

## Task 17 — E2E: navigation search + SWR jitter + Ctrl+K reclaim

**Files:**

- Modify: `e2e/src/specs/web/global-search.e2e-spec.ts`

**Step 0: Verify e2e helpers exist**

Before writing the test bodies, grep `e2e/src/utils.ts` for the helpers used below — adapt the call sites if any signature differs:

```bash
grep -n "userSetup\|setAuthCookies\|adminSetup" e2e/src/utils.ts
```

Expected: `userSetup` takes `(accessToken: string, dto: { email: string; password: string; name: string })` and returns a `LoginResponseDto`. `setAuthCookies` takes `(context, accessToken)`. If either differs, swap the test calls accordingly. The e2e file already uses these helpers in earlier tests in this branch, so the pattern is proven.

**Step 1: Append tests**

```ts
test.describe('navigation provider', () => {
  test('type "auto" → Auto-Classification appears → Enter → classification accordion opens', async ({ page }) => {
    await page.goto('/photos');
    await page.keyboard.press('Control+k');
    await page.getByRole('combobox').fill('auto');
    await expect(page.getByText(/auto-classification/i)).toBeVisible();
    await page.keyboard.press('Enter');
    await expect(page).toHaveURL(/\/admin\/system-settings\?isOpen=classification/);
  });

  test('type "theme" → Theme command appears → Enter → theme flips', async ({ page }) => {
    await page.goto('/photos');
    const initialTheme = await page.evaluate(() => document.documentElement.classList.contains('dark'));
    await page.keyboard.press('Control+k');
    await page.getByRole('combobox').fill('theme');
    await expect(page.getByText(/toggle theme/i)).toBeVisible();
    await page.keyboard.press('Enter');
    await expect
      .poll(async () => page.evaluate(() => document.documentElement.classList.contains('dark')))
      .toBe(!initialTheme);
  });

  test('SWR: typing into populated sections does not flash skeletons', async ({ page }) => {
    await page.goto('/photos');
    await page.keyboard.press('Control+k');
    const combobox = page.getByRole('combobox');
    await combobox.fill('beach');
    await expect(page.getByRole('option').first()).toBeVisible({ timeout: 8000 });
    // Directly assert no Skeleton elements exist while typing through additional characters.
    // Skeleton.svelte renders <div data-skeleton="true">. If SWR is working, photos are ok
    // and the component short-circuits the loading branch — zero skeleton nodes in the DOM.
    const countBefore = await page.locator('[data-skeleton="true"]').count();
    expect(countBefore).toBe(0);
    await combobox.press('y');
    await combobox.press('z');
    const countAfter = await page.locator('[data-skeleton="true"]').count();
    expect(countAfter).toBe(0);
  });

  test('non-admin user: System Settings and Admin sub-sections are absent', async ({ page, context }) => {
    // Seed a non-admin user via utils.userSetup and set auth cookies.
    const writer = await utils.userSetup(admin.accessToken, {
      email: 'nonadmin-nav@cmdk.test',
      password: 'pw',
      name: 'NonAdmin Nav',
    });
    await utils.setAuthCookies(context, writer.accessToken);
    await page.goto('/photos');
    await page.keyboard.press('Control+k');
    await page.getByRole('combobox').fill('classific');
    await expect(page.getByText(/auto-classification/i)).toHaveCount(0);
  });

  test('admin demotion: stale admin recents are not visible to non-admin users', async ({ page, context }) => {
    // Step 1: as admin, activate Auto-Classification to seed a recent.
    await utils.setAuthCookies(context, admin.accessToken);
    await page.goto('/photos');
    await page.keyboard.press('Control+k');
    await page.getByRole('combobox').fill('auto-class');
    await expect(page.getByText(/auto-classification/i)).toBeVisible();
    await page.keyboard.press('Enter');
    await expect(page).toHaveURL(/classification/);
    // Step 2: swap to non-admin cookie (simulating a demotion).
    const writer = await utils.userSetup(admin.accessToken, {
      email: 'demoted-nav@cmdk.test',
      password: 'pw',
      name: 'Demoted',
    });
    await utils.setAuthCookies(context, writer.accessToken);
    await page.goto('/photos');
    await page.keyboard.press('Control+k');
    // Empty query → Recent section should NOT contain Auto-Classification.
    await expect(page.getByText(/auto-classification/i)).toHaveCount(0);
  });

  test('Ctrl+K reclaim: our palette opens (not the legacy @immich/ui one)', async ({ page }) => {
    await page.goto('/photos');
    await page.keyboard.press('Control+k');
    await expect(page.getByRole('dialog')).toBeVisible();
    // Positive signature of OUR palette: the mode-selector radiogroup with role="radiogroup"
    // and a name derived from cmdk_search_mode. The legacy @immich/ui palette has no such element.
    await expect(page.getByRole('radiogroup', { name: /search mode/i })).toBeVisible();
  });
});
```

**Step 2: Run the new tests**

```bash
cd e2e && pnpm check
```

Typecheck only — running e2e requires the dev stack. Defer the actual run to Task 18 manual QA.

**Step 3: Commit**

```bash
git add e2e/src/specs/web/global-search.e2e-spec.ts
git commit -m "test(e2e): cmdk navigation provider + SWR jitter + Ctrl+K reclaim"
```

---

## Task 18 — Manual visual QA

**Files:** none modified.

**Step 1: Start the dev stack**

```bash
make dev
```

Wait for `immich_server` and `immich_web` to be ready. The stack bind-mounts this worktree so code is live.

**Step 2: Seed data (skip if already seeded from prior session)**

```bash
bash ~/.claude/skills/env-prep/run.sh
```

Sign in as `a@a.com` / `a`.

**Step 3: Smoke-test the navigation provider**

At `http://localhost:2283/photos`:

1. Press `Ctrl+K`. Palette opens.
2. Type `auto`. Expect: photos section + a new "System Settings" sub-section containing "Auto-Classification." Pressing Enter navigates to `/admin/system-settings?isOpen=classification` with the accordion open.
3. Type `theme`. Expect: "Actions" sub-section containing "Theme → Toggle theme." Pressing Enter flips the theme.
4. Type `users`. Expect: "Admin" sub-section containing "Users."
5. Type `asdfasdf`. Expect: no more jitter. Entity sections stay empty (or previous state) without flashing skeletons on each keystroke. Progress stripe appears after 200 ms if the backend is slow.
6. Type `photos`. Expect: "Navigation" sub-section with the user-pages Photos entry.

**Step 4: Smoke-test as non-admin**

Sign in as `b@b.com` / `b`.

1. Open palette. Type `classific`. Expect: NO "System Settings" sub-section, NO "Admin" sub-section. Only user pages and actions.
2. Log out. Sign in again as admin. Activate "Auto-Classification" (now in recents). Log out. Sign in as non-admin. Open palette (empty query). Expect: Recent section does NOT show Auto-Classification. (Render-time filter test.)

**Step 5: Responsive check**

Resize window to ≥1024 px, 720 px, 480 px. Palette:

- Two-pane layout only at ≥1024 px ✓ (navigation items have no preview — pane shows the faded logo).
- List-only below 1024 px ✓.
- Navigation section heading visible in both light and dark modes.

**Step 6: Motion check**

In DevTools Rendering panel, toggle "Emulate CSS media feature prefers-reduced-motion: reduce." Open palette, type. Expect: progress stripe animation drops to instant.

**Step 7: Log findings**

If any visual bug surfaces, open a fixup commit referencing this task. Otherwise, the branch is PR-ready.

No commit for this task unless QA finds something.

---

## Summary of commits

```
 1. i18n(web): add cmdk navigation section headings
 2. fix(web): hide empty sections in GlobalSearchSection
 3. feat(web): add removeEntry to cmdk.recent store
 4. feat(web): add navigate kind to RecentEntry union
 5. feat(web): static NAVIGATION_ITEMS list for cmdk navigation provider
 6. test(web): NAVIGATION_ITEMS schema + accordion-key drift guard
 7. feat(web): widen Sections/ActiveItem for navigation section
 8. feat(web): navigation memo cache + locale subscription
 9. feat(web): runNavigationProvider with fuzzy scoring + gates
10. feat(web): synchronous navigation provider path in setQuery
11. feat(web): stale-while-revalidate loading rules + batchInFlight state
12. feat(web): activate navigation + stale-admin purge in activateRecent
13. feat(web): navigation-row component
14. feat(web): GlobalSearchNavigationSections with render-time category grouping
15. feat(web): mount navigation sections + progress stripe in palette
16. feat(web): disable @immich/ui palette; reclaim Ctrl+K, re-register Shift+T
17. test(e2e): cmdk navigation provider + SWR jitter + Ctrl+K reclaim
```

Task 18 is manual verification — no commit unless something needs fixing.

---

## Executor notes

- **Read the design doc first** — this plan is the _how_; `2026-04-13-cmdk-navigation-design.md` is the _what_ and _why_.
- **Match existing Gallery conventions** if plan and reality diverge. Grep for real helper names and paths before inventing.
- **Never skip the confirm-failure TDD step.** It's the only proof the test exercises the new code.
- **One commit per task.** Bite-sized commits make review easy.
- **No local lint.** Per `feedback_lint_sequential`: CI handles it, local `pnpm lint` takes >10 min and has been explicitly declined.
- **Svelte 5 reactivity:** don't mutate `$state` from inside `$derived`; use `get(store)` for imperative reads in TS.
- **Never merge without explicit user confirmation** (`feedback_never_merge_without_asking`). This plan produces commits; merging is a separate step.
