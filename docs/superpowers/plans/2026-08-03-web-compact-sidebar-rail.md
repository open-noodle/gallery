# Compact Sidebar Rail Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a third sidebar state — a thin Google Photos-style icon rail — selectable by a user setting and applied automatically on medium screens.

**Architecture:** A fork-only store resolves a `SidebarLayout` (`overlay` / `rail` / `expanded`) from a persisted `SidebarMode` preference plus two media queries. A fork-only shell and nav-item render the rail, keeping the label mounted so collapse is a pure CSS transition. Upstream `sidebarStore` is not modified — the rail owns its own transient flags because upstream's `isOpen` is permanently `true` above 850px and its `toggle()` never closes.

**Tech Stack:** SvelteKit, Svelte 5 runes, Tailwind CSS 4, `@immich/ui`, `svelte-persisted-store`, Vitest + `@testing-library/svelte` (happy-dom), Playwright.

**Spec:** `docs/superpowers/specs/2026-08-02-web-compact-sidebar-design.md`

## Global Constraints

- All commands run from `web/` unless stated otherwise. Run `pnpm test` from `web/`.
- **Fresh worktrees must run `mise run :plugins` from the repo root first**, or every spec fails with `Failed to resolve import "@immich/sdk"`. Use the leading colon — `//:` resolves to the main checkout, not this worktree.
- Keep changes in fork-only files wherever possible. Exactly **four** upstream files may be modified: `UserSidebar.svelte`, `UserPageLayout.svelte`, `NavigationBar.svelte`, `AppSettings.svelte` — plus the existing spec `user-sidebar.spec.ts` (see Task 6).
- **Do not modify:** `Sidebar.svelte`, `Sidebar.spec.ts`, `stores/sidebar.svelte.ts`, `BottomInfo.svelte`, `StorageSpace.svelte`, `preferences.store.ts`, `media-query-manager.svelte.ts`, `app.css`, `+layout.svelte`, `AdminPageLayout.svelte`, `patches/@immich__ui@0.83.0.patch`.
- New fork-only files use **kebab-case** (`sidebar-nav-item.svelte`), matching recent fork additions.
- New i18n keys go in `i18n/en.json` only. The `i18n/` directory is shared with mobile; grep both before touching existing keys.
- Rail widths: `--spacing(16)` = 4rem, `--spacing(64)` = 16rem, `--spacing(32)` = 8rem. Tailwind's default `--spacing: 0.25rem` is not overridden in this project.
- **Assertion trap:** the label `<span>` stays mounted in rail mode to preserve the accessible name, so `getByText('Photos')` passes in _both_ states and can never fail. Assert rail state via `data-*` attributes, never text presence. Do not use `toBeVisible()` on elements collapsed by width/opacity — happy-dom does not compute that like a browser.
- Prettier is enforced by CI. Run `npx prettier --write` on any Markdown under `docs/` before committing.
- No `Co-Authored-By` or `Generated with` trailers in commits.

## Correction to the spec

Spec coverage item 32 claims `user-sidebar.spec.ts` stays green **unmodified**. That is wrong and Task 6 fixes it. That spec mocks `$lib/components/sidebar/sidebar.svelte` and `@immich/ui`'s `NavbarItem` / `NavbarGroup` — all three are exactly what this change replaces. It must be updated. `Sidebar.spec.ts` genuinely does stay unmodified.

The spec's component list also omits two small fork-only files this plan adds for testability and cleanliness: `sidebar-media.svelte.ts` (a mockable media-query seam) and `sidebar-nav-group.svelte` (the "Library" header → divider).

## File Structure

**Create (fork-only):**

| File                                                                    | Responsibility                                                 |
| ----------------------------------------------------------------------- | -------------------------------------------------------------- |
| `web/src/lib/stores/sidebar-media.svelte.ts`                            | The two media queries behind one mockable object               |
| `web/src/lib/stores/sidebar-mode.svelte.ts`                             | `sidebarMode` preference, `layout` resolution, transient flags |
| `web/src/lib/components/sidebar/sidebar-shell.svelte`                   | Rail/overlay container; hover, focus, Escape, click-outside    |
| `web/src/lib/components/sidebar/sidebar-nav-item.svelte`                | One icon + label row                                           |
| `web/src/lib/components/sidebar/sidebar-nav-group.svelte`               | Text group header, or a divider in rail                        |
| `web/src/lib/components/shared-components/side-bar/rail-storage.svelte` | Compact storage icon                                           |
| `web/src/routes/(user)/user-settings/sidebar-settings.svelte`           | The setting control                                            |
| `web/src/test-data/mocks/sidebar-nav-item.stub.svelte`                  | Stub mirroring `navbar-item.stub.svelte`                       |
| `web/src/test-data/mocks/sidebar-shell.stub.svelte`                     | Stub mirroring `sidebar.stub.svelte`                           |

**Modify (upstream):** `UserSidebar.svelte`, `UserPageLayout.svelte`, `NavigationBar.svelte`, `AppSettings.svelte`, `user-sidebar.spec.ts`, `i18n/en.json`.

---

### Task 1: Media-query seam

**Files:**

- Create: `web/src/lib/stores/sidebar-media.svelte.ts`
- Test: `web/src/lib/stores/sidebar-media.spec.ts`

**Interfaces:**

- Consumes: upstream `mediaQueryManager.isFullSidebar` (`≥ 850px`).
- Produces: `sidebarMedia: { isFullSidebar: boolean; isWideSidebar: boolean }`. Task 2 mocks this module.

Why this exists: `sidebar-mode.svelte.ts` needs both breakpoints, and a module-level `new MediaQuery(...)` cannot be varied per test. Routing both through one object gives tests a single `vi.mock` target, matching the idiom already used in `Sidebar.spec.ts`.

- [ ] **Step 1: Write the failing test**

```ts
// web/src/lib/stores/sidebar-media.spec.ts
import { sidebarMedia } from '$lib/stores/sidebar-media.svelte';

const mocks = vi.hoisted(() => ({ mediaQueryManager: { isFullSidebar: false } }));

vi.mock('$lib/stores/media-query-manager.svelte', () => ({ mediaQueryManager: mocks.mediaQueryManager }));

describe('sidebarMedia', () => {
  beforeEach(() => {
    mocks.mediaQueryManager.isFullSidebar = false;
  });

  it('mirrors isFullSidebar from the upstream media query manager', () => {
    expect(sidebarMedia.isFullSidebar).toBe(false);
    mocks.mediaQueryManager.isFullSidebar = true;
    expect(sidebarMedia.isFullSidebar).toBe(true);
  });
});
```

`isWideSidebar` is deliberately left unasserted in this spec — a `typeof … === 'boolean'` check cannot fail meaningfully and is not worth defending at review.

**Do not mock `svelte/reactivity` to vary `isWideSidebar` here.** Replacing that module supplies only `MediaQuery` and leaves `SvelteMap` / `SvelteSet` / `SvelteDate` undefined for everything else in the import graph. `isWideSidebar`'s behaviour is covered where it matters instead: Task 2 mocks this whole seam to drive the resolution matrix, and Task 10 exercises the real 1280px query at real viewports.

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test --run src/lib/stores/sidebar-media.spec.ts`
Expected: FAIL — `Failed to resolve import "$lib/stores/sidebar-media.svelte"`

- [ ] **Step 3: Write minimal implementation**

```ts
// web/src/lib/stores/sidebar-media.svelte.ts
import { mediaQueryManager } from '$lib/stores/media-query-manager.svelte';
import { MediaQuery } from 'svelte/reactivity';

// Above this width `auto` mode shows the full sidebar; between here and the 850px
// `--breakpoint-sidebar` it shows the rail. Declared here rather than in upstream
// `media-query-manager.svelte.ts` to keep the change fork-only.
const wideSidebar = new MediaQuery('min-width: 1280px');

export const sidebarMedia = {
  get isFullSidebar() {
    return mediaQueryManager.isFullSidebar;
  },
  get isWideSidebar() {
    return wideSidebar.current;
  },
};
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm test --run src/lib/stores/sidebar-media.spec.ts`
Expected: PASS (1 test)

- [ ] **Step 5: Commit**

```bash
git add src/lib/stores/sidebar-media.svelte.ts src/lib/stores/sidebar-media.spec.ts
git commit -m "feat(web): add sidebar media-query seam"
```

---

### Task 2: Sidebar mode store

**Files:**

- Create: `web/src/lib/stores/sidebar-mode.svelte.ts`
- Test: `web/src/lib/stores/sidebar-mode.spec.ts`

**Interfaces:**

- Consumes: `sidebarMedia` from Task 1.
- Produces:
  - `SIDEBAR_MODES: readonly ['auto', 'expanded', 'rail']`
  - `type SidebarMode = 'auto' | 'expanded' | 'rail'`
  - `type SidebarLayout = 'overlay' | 'rail' | 'expanded'`
  - `parseSidebarMode(text: string | null): SidebarMode` — validating parser, falls back to `'auto'`
  - `sidebarMode` — a `svelte-persisted-store` writable of `SidebarMode`, key `'sidebar-mode'`
  - `sidebarModeStore` — singleton with `mode` (get/set), `layout: SidebarLayout` (a plain getter, not `$derived`), `hoverExpanded: boolean`, `railOverlayOpen: boolean`, `toggleRailOverlay(): void`, `resetTransient(): void`

Covers spec coverage items 1, 2, 4, 5.

- [ ] **Step 1: Write the failing test**

```ts
// web/src/lib/stores/sidebar-mode.spec.ts
import {
  parseSidebarMode,
  sidebarMode,
  sidebarModeStore,
  type SidebarLayout,
  type SidebarMode,
} from '$lib/stores/sidebar-mode.svelte';

const mocks = vi.hoisted(() => ({ sidebarMedia: { isFullSidebar: false, isWideSidebar: false } }));
vi.mock('$lib/stores/sidebar-media.svelte', () => ({ sidebarMedia: mocks.sidebarMedia }));

const setViewport = (width: 'phone' | 'medium' | 'wide') => {
  mocks.sidebarMedia.isFullSidebar = width !== 'phone';
  mocks.sidebarMedia.isWideSidebar = width === 'wide';
};

describe('sidebarModeStore', () => {
  beforeEach(() => {
    localStorage.clear();
    sidebarMode.set('auto');
    sidebarModeStore.resetTransient();
    setViewport('phone');
  });

  it('defaults to auto mode', () => {
    expect(sidebarModeStore.mode).toBe('auto');
  });

  // Spec coverage 1: the full 3 modes x 3 viewport bands resolution table.
  it.each`
    mode          | viewport    | expected
    ${'auto'}     | ${'phone'}  | ${'overlay'}
    ${'auto'}     | ${'medium'} | ${'rail'}
    ${'auto'}     | ${'wide'}   | ${'expanded'}
    ${'expanded'} | ${'phone'}  | ${'overlay'}
    ${'expanded'} | ${'medium'} | ${'expanded'}
    ${'expanded'} | ${'wide'}   | ${'expanded'}
    ${'rail'}     | ${'phone'}  | ${'overlay'}
    ${'rail'}     | ${'medium'} | ${'rail'}
    ${'rail'}     | ${'wide'}   | ${'rail'}
  `('resolves $mode at $viewport to $expected', ({ mode, viewport, expected }) => {
    sidebarMode.set(mode as SidebarMode);
    setViewport(viewport as 'phone' | 'medium' | 'wide');

    expect(sidebarModeStore.layout).toBe(expected as SidebarLayout);
  });

  // Spec coverage 2: rotation must re-resolve, not stick.
  it('re-resolves live when the viewport changes', () => {
    sidebarMode.set('auto');
    setViewport('wide');
    expect(sidebarModeStore.layout).toBe('expanded');

    setViewport('medium');
    expect(sidebarModeStore.layout).toBe('rail');

    setViewport('phone');
    expect(sidebarModeStore.layout).toBe('overlay');
  });

  // Spec coverage 4. Test the parser directly: writing to localStorage after the store
  // has been constructed does not re-run its subscriber, so asserting on
  // `sidebarModeStore.mode` afterwards would pass on the beforeEach value no matter what
  // the parser does - an assertion that cannot fail.
  it.each`
    raw             | expected
    ${'"rail"'}     | ${'rail'}
    ${'"expanded"'} | ${'expanded'}
    ${'"auto"'}     | ${'auto'}
    ${'"nonsense"'} | ${'auto'}
    ${'42'}         | ${'auto'}
    ${'null'}       | ${'auto'}
    ${''}           | ${'auto'}
    ${'{ broken'}   | ${'auto'}
  `('parses $raw to $expected', ({ raw, expected }) => {
    expect(parseSidebarMode(raw)).toBe(expected);
  });

  // Spec coverage 5: this is the bug upstream toggle() has - it must close as well as open.
  it('toggles the rail overlay both open and closed', () => {
    sidebarMode.set('rail');
    setViewport('medium');

    expect(sidebarModeStore.railOverlayOpen).toBe(false);
    sidebarModeStore.toggleRailOverlay();
    expect(sidebarModeStore.railOverlayOpen).toBe(true);
    sidebarModeStore.toggleRailOverlay();
    expect(sidebarModeStore.railOverlayOpen).toBe(false);
  });

  it('clears both transient flags on resetTransient', () => {
    sidebarMode.set('rail');
    setViewport('medium');
    sidebarModeStore.hoverExpanded = true;
    sidebarModeStore.toggleRailOverlay();

    sidebarModeStore.resetTransient();

    expect(sidebarModeStore.hoverExpanded).toBe(false);
    expect(sidebarModeStore.railOverlayOpen).toBe(false);
  });

  it('writes the mode through to the persisted store', () => {
    sidebarModeStore.mode = 'rail';

    expect(sidebarModeStore.mode).toBe('rail');
    expect(localStorage.getItem('sidebar-mode')).toContain('rail');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test --run src/lib/stores/sidebar-mode.spec.ts`
Expected: FAIL — `Failed to resolve import "$lib/stores/sidebar-mode.svelte"`

- [ ] **Step 3: Write minimal implementation**

```ts
// web/src/lib/stores/sidebar-mode.svelte.ts
import { sidebarMedia } from '$lib/stores/sidebar-media.svelte';
import { persisted } from 'svelte-persisted-store';

export const SIDEBAR_MODES = ['auto', 'expanded', 'rail'] as const;
export type SidebarMode = (typeof SIDEBAR_MODES)[number];
export type SidebarLayout = 'overlay' | 'rail' | 'expanded';

const isSidebarMode = (value: unknown): value is SidebarMode =>
  typeof value === 'string' && (SIDEBAR_MODES as readonly string[]).includes(value);

/**
 * Exported so the fallback is directly testable. Writing to localStorage after the store
 * is constructed does not re-run its subscriber, so this cannot be exercised through
 * `sidebarModeStore.mode`.
 */
export const parseSidebarMode = (text: string | null): SidebarMode => {
  try {
    const value: unknown = JSON.parse(text ?? 'null');
    return isSidebarMode(value) ? value : 'auto';
  } catch {
    return 'auto';
  }
};

export const sidebarMode = persisted<SidebarMode>('sidebar-mode', 'auto', {
  serializer: {
    parse: parseSidebarMode,
    stringify: JSON.stringify,
  },
});

class SidebarModeStore {
  #mode = $state<SidebarMode>('auto');

  /** Pointer/focus expansion. Only meaningful while `layout === 'rail'`. */
  hoverExpanded = $state(false);

  /**
   * The touch and keyboard affordance, toggled by the navbar hamburger in rail mode.
   * Deliberately NOT upstream `sidebarStore.isOpen`: that is `$derived` from the 850px
   * query, so above 850px it is permanently true, and its `toggle()` only ever assigns
   * true - it can open the overlay but never dismiss it.
   */
  railOverlayOpen = $state(false);

  constructor() {
    sidebarMode.subscribe((value) => {
      this.#mode = isSidebarMode(value) ? value : 'auto';
    });
  }

  get mode(): SidebarMode {
    return this.#mode;
  }

  set mode(value: SidebarMode) {
    sidebarMode.set(value);
  }

  /**
   * A plain getter rather than `$derived.by`: `$derived` memoises against fine-grained
   * reactive reads, so with `sidebarMedia` mocked as a plain object in tests it caches on
   * first read and never re-runs on a viewport change. A getter recomputes on every access,
   * which is correct here (a cheap switch) and stays reactive in production, since Svelte's
   * tracking follows the underlying $state reads through the call rather than the getter.
   */
  get layout(): SidebarLayout {
    // A rail costs ~4rem, which a phone cannot spare, so below 850px every mode keeps
    // today's hidden-plus-overlay behaviour.
    if (!sidebarMedia.isFullSidebar) {
      return 'overlay';
    }

    switch (this.#mode) {
      case 'expanded': {
        return 'expanded';
      }
      case 'rail': {
        return 'rail';
      }
      default: {
        return sidebarMedia.isWideSidebar ? 'expanded' : 'rail';
      }
    }
  }

  toggleRailOverlay() {
    this.railOverlayOpen = !this.railOverlayOpen;
  }

  resetTransient() {
    this.hoverExpanded = false;
    this.railOverlayOpen = false;
  }
}

export const sidebarModeStore = new SidebarModeStore();
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm test --run src/lib/stores/sidebar-mode.spec.ts`
Expected: PASS (22 tests)

- [ ] **Step 5: Commit**

```bash
git add src/lib/stores/sidebar-mode.svelte.ts src/lib/stores/sidebar-mode.spec.ts
git commit -m "feat(web): resolve sidebar layout from mode preference and viewport"
```

---

### Task 3: Sidebar nav item

**Files:**

- Create: `web/src/lib/components/sidebar/sidebar-nav-item.svelte`
- Test: `web/src/lib/components/sidebar/sidebar-nav-item.spec.ts`

**Interfaces:**

- Consumes: `sidebarModeStore.layout`, `sidebarModeStore.hoverExpanded` (Task 2).
- Produces: default export accepting `{ title: string; href: string; icon?: IconLike | IconProps; activeIcon?: IconLike | IconProps; isActive?: () => boolean; expanded?: boolean (bindable); items?: Snippet }` — the subset of `@immich/ui`'s `NavbarProps` that `UserSidebar` actually uses. Renders `data-active` (string `'true'`/`'false'`, or absent when `isActive` is not supplied, matching `navbar-item.stub.svelte`) and `data-collapsed` (`'true'` in rail, `'false'` otherwise).

Covers spec coverage items 15, 16, 17, 18, 24.

Note one deliberate divergence from `sidebar-nav-item.stub.svelte` (Task 7): the real component always emits `data-active`, computing a prefix match when no `isActive` override is given, whereas the stub emits it only when an override exists. The stub mirrors `navbar-item.stub.svelte` so `user-sidebar.spec.ts` keeps asserting exactly what it asserts today — rows without an override are intentionally not covered there.

- [ ] **Step 1: Write the failing test**

```ts
// web/src/lib/components/sidebar/sidebar-nav-item.spec.ts
import '@testing-library/jest-dom';
import SidebarNavItem from '$lib/components/sidebar/sidebar-nav-item.svelte';
import { mdiImageMultiple } from '@mdi/js';
import { render, screen } from '@testing-library/svelte';

const mocks = vi.hoisted(() => ({
  sidebarModeStore: { layout: 'expanded' as 'overlay' | 'rail' | 'expanded', hoverExpanded: false },
  page: { url: new URL('https://gallery.test/photos') },
}));

vi.mock('$lib/stores/sidebar-mode.svelte', () => ({ sidebarModeStore: mocks.sidebarModeStore }));
vi.mock('$app/state', () => ({ page: mocks.page }));

const setLayout = (layout: 'overlay' | 'rail' | 'expanded', hoverExpanded = false) => {
  mocks.sidebarModeStore.layout = layout;
  mocks.sidebarModeStore.hoverExpanded = hoverExpanded;
};

describe('sidebar-nav-item', () => {
  beforeEach(() => {
    setLayout('expanded');
    mocks.page.url = new URL('https://gallery.test/photos');
  });

  const link = () => screen.getByRole('link', { name: /photos/i });

  it('keeps the label in the accessibility tree when collapsed', () => {
    setLayout('rail');

    render(SidebarNavItem, { title: 'Photos', href: '/photos', icon: mdiImageMultiple });

    // Spec coverage 18. The label must stay mounted, so assert on the accessible NAME,
    // not on text presence - `getByText` would pass in both states and could never fail.
    expect(link()).toHaveAccessibleName(/photos/i);
  });

  it('marks itself collapsed only in rail mode', () => {
    render(SidebarNavItem, { title: 'Photos', href: '/photos', icon: mdiImageMultiple });
    expect(link()).toHaveAttribute('data-collapsed', 'false');
  });

  it('marks itself collapsed in rail mode', () => {
    setLayout('rail');

    render(SidebarNavItem, { title: 'Photos', href: '/photos', icon: mdiImageMultiple });

    expect(link()).toHaveAttribute('data-collapsed', 'true');
  });

  it('expands while hover-expanded even though layout is rail', () => {
    setLayout('rail', true);

    render(SidebarNavItem, { title: 'Photos', href: '/photos', icon: mdiImageMultiple });

    expect(link()).toHaveAttribute('data-collapsed', 'false');
  });

  it('adds a tooltip only when collapsed', () => {
    setLayout('rail');
    render(SidebarNavItem, { title: 'Photos', href: '/photos', icon: mdiImageMultiple });
    expect(link()).toHaveAttribute('title', 'Photos');
  });

  it('omits the tooltip when expanded', () => {
    render(SidebarNavItem, { title: 'Photos', href: '/photos', icon: mdiImageMultiple });
    expect(link()).not.toHaveAttribute('title');
  });

  // Spec coverage 17.
  it('reports the isActive override verdict', () => {
    render(SidebarNavItem, {
      title: 'Photos',
      href: '/photos',
      icon: mdiImageMultiple,
      isActive: () => false,
    });

    expect(link()).toHaveAttribute('data-active', 'false');
  });

  it('falls back to a prefix match when no isActive override is given', () => {
    mocks.page.url = new URL('https://gallery.test/photos/123');

    render(SidebarNavItem, { title: 'Photos', href: '/photos', icon: mdiImageMultiple });

    expect(link()).toHaveAttribute('data-active', 'true');
  });

  // Spec coverage 15.
  it('hides the sub-tree in rail mode', () => {
    setLayout('rail');

    render(SidebarNavItem, {
      title: 'Albums',
      href: '/albums',
      icon: mdiImageMultiple,
      expanded: true,
      items: createRawSnippet(() => ({ render: () => `<span data-testid="subtree">recent</span>` })),
    });

    expect(screen.queryByTestId('subtree')).not.toBeInTheDocument();
  });

  it('shows the sub-tree when expanded', () => {
    render(SidebarNavItem, {
      title: 'Albums',
      href: '/albums',
      icon: mdiImageMultiple,
      expanded: true,
      items: createRawSnippet(() => ({ render: () => `<span data-testid="subtree">recent</span>` })),
    });

    expect(screen.getByTestId('subtree')).toBeInTheDocument();
  });

  // Spec coverage 24: long DE/NL/PL labels must clip rather than widen the panel.
  it('truncates the label instead of wrapping', () => {
    render(SidebarNavItem, {
      title: 'Zuletzt hinzugefügte Fotos und Videos',
      href: '/recently-added',
      icon: mdiImageMultiple,
    });

    const label = screen.getByText('Zuletzt hinzugefügte Fotos und Videos');
    expect(label.className).toContain('truncate');
  });

  // Spec coverage 16: hiding is render-time only. Collapsing to the rail must not
  // write `false` back into the persisted recentAlbumsDropdown / recentSpacesDropdown flag.
  it('does not clobber the bound expanded flag when collapsed', async () => {
    setLayout('rail');
    const props = $state({
      title: 'Albums',
      href: '/albums',
      icon: mdiImageMultiple,
      expanded: true,
      items: createRawSnippet(() => ({ render: () => `<span data-testid="subtree">recent</span>` })),
    });

    render(SidebarNavItem, props);

    expect(props.expanded).toBe(true);
  });
});
```

Add `import { createRawSnippet } from 'svelte';` at the top of the test file.

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test --run src/lib/components/sidebar/sidebar-nav-item.spec.ts`
Expected: FAIL — cannot resolve `sidebar-nav-item.svelte`

- [ ] **Step 3: Write minimal implementation**

```svelte
<!-- web/src/lib/components/sidebar/sidebar-nav-item.svelte -->
<script lang="ts">
  import { page } from '$app/state';
  import { sidebarModeStore } from '$lib/stores/sidebar-mode.svelte';
  // @immich/ui re-exports its types (dist/index.d.ts: `export * from './types.js'`),
  // so IconLike / IconProps come from the package rather than being redeclared here.
  import { Icon, Link, type IconLike, type IconProps } from '@immich/ui';
  import type { Snippet } from 'svelte';

  interface Props {
    title: string;
    href: string;
    icon?: IconLike | IconProps;
    activeIcon?: IconLike | IconProps;
    isActive?: () => boolean;
    expanded?: boolean;
    items?: Snippet;
  }

  let { title, href, icon, activeIcon, isActive, expanded = $bindable(false), items }: Props = $props();

  // Rail collapses to icons only; hovering or focusing floats the labels back without
  // touching the grid column, so `collapsed` follows hoverExpanded too.
  const collapsed = $derived(sidebarModeStore.layout === 'rail' && !sidebarModeStore.hoverExpanded);

  const active = $derived(isActive ? isActive() : page.url.pathname.startsWith(href));

  const asIconProps = (value?: IconLike | IconProps) => {
    if (typeof value === 'string') {
      return { icon: value };
    }
    if (value && 'path' in value) {
      return { icon: value.path };
    }
    return value;
  };

  const iconProps = $derived(asIconProps(icon));
  const activeIconProps = $derived(asIconProps(activeIcon));

  // `bg-primary/10` cannot go through Svelte's `class:` directive - the slash is not a
  // valid identifier there - so the active tint is composed into the class string.
  const linkClass = $derived(
    [
      'hover:bg-subtle hover:text-primary flex w-full place-items-center gap-4 rounded-e-full py-3 ps-5 transition-[padding] delay-100 duration-100',
      active ? 'bg-primary/10 text-primary' : '',
    ]
      .filter(Boolean)
      .join(' '),
  );
</script>

<div>
  <!-- Link, not a raw <a>: it carries @immich/ui's shared link treatment and SvelteKit
       integration, matching what upstream NavbarItem renders. -->
  <Link
    {href}
    underline={false}
    data-active={String(active)}
    data-collapsed={String(collapsed)}
    title={collapsed ? title : undefined}
    aria-current={active ? 'page' : undefined}
    class={linkClass}
  >
    {#if iconProps}
      <Icon size="1.375em" class="shrink-0" aria-hidden={true} {...active && activeIconProps ? activeIconProps : iconProps} />
    {/if}
    <!--
      The label stays mounted in rail mode - collapsing it with width/opacity rather than
      unmounting keeps the link's accessible name and makes rail <-> expanded a pure CSS
      transition instead of a component swap needing a cross-fade.
    -->
    <span
      class="truncate text-sm font-medium transition-all duration-200 motion-reduce:transition-none"
      class:w-0={collapsed}
      class:opacity-0={collapsed}
      class:overflow-hidden={collapsed}
    >
      {title}
    </span>
  </Link>

  {#if items && expanded && !collapsed}
    <div>{@render items()}</div>
  {/if}
</div>
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm test --run src/lib/components/sidebar/sidebar-nav-item.spec.ts`
Expected: PASS (12 tests)

- [ ] **Step 5: Commit**

```bash
git add src/lib/components/sidebar/sidebar-nav-item.svelte src/lib/components/sidebar/sidebar-nav-item.spec.ts
git commit -m "feat(web): add collapsible sidebar nav item"
```

---

### Task 4: Sidebar nav group

**Files:**

- Create: `web/src/lib/components/sidebar/sidebar-nav-group.svelte`
- Test: `web/src/lib/components/sidebar/sidebar-nav-group.spec.ts`

**Interfaces:**

- Consumes: `sidebarModeStore.layout` / `.hoverExpanded` (Task 2), `NavbarGroup` from `@immich/ui`.
- Produces: default export accepting `{ title: string }`. Renders the `@immich/ui` `NavbarGroup` when expanded, and a `<hr data-testid="sidebar-group-divider">` when collapsed.

Covers spec coverage item 19.

- [ ] **Step 1: Write the failing test**

```ts
// web/src/lib/components/sidebar/sidebar-nav-group.spec.ts
import '@testing-library/jest-dom';
import SidebarNavGroup from '$lib/components/sidebar/sidebar-nav-group.svelte';
import { render, screen } from '@testing-library/svelte';

const mocks = vi.hoisted(() => ({
  sidebarModeStore: { layout: 'expanded' as 'overlay' | 'rail' | 'expanded', hoverExpanded: false },
}));

vi.mock('$lib/stores/sidebar-mode.svelte', () => ({ sidebarModeStore: mocks.sidebarModeStore }));
vi.mock('@immich/ui', async () => {
  const navbarGroup = await import('@test-data/mocks/navbar-group.stub.svelte');
  return { NavbarGroup: navbarGroup.default };
});

describe('sidebar-nav-group', () => {
  beforeEach(() => {
    mocks.sidebarModeStore.layout = 'expanded';
    mocks.sidebarModeStore.hoverExpanded = false;
  });

  it('renders the text header when expanded', () => {
    render(SidebarNavGroup, { title: 'Library' });

    expect(screen.getByText('Library')).toBeInTheDocument();
    expect(screen.queryByTestId('sidebar-group-divider')).not.toBeInTheDocument();
  });

  it('renders a divider instead of the header in rail mode', () => {
    mocks.sidebarModeStore.layout = 'rail';

    render(SidebarNavGroup, { title: 'Library' });

    expect(screen.getByTestId('sidebar-group-divider')).toBeInTheDocument();
    expect(screen.queryByText('Library')).not.toBeInTheDocument();
  });

  it('restores the header while hover-expanded', () => {
    mocks.sidebarModeStore.layout = 'rail';
    mocks.sidebarModeStore.hoverExpanded = true;

    render(SidebarNavGroup, { title: 'Library' });

    expect(screen.getByText('Library')).toBeInTheDocument();
    // Both halves, matching the rail test above: without this an implementation that
    // renders the divider AND the header while hovering would still pass.
    expect(screen.queryByTestId('sidebar-group-divider')).not.toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test --run src/lib/components/sidebar/sidebar-nav-group.spec.ts`
Expected: FAIL — cannot resolve `sidebar-nav-group.svelte`

- [ ] **Step 3: Write minimal implementation**

```svelte
<!-- web/src/lib/components/sidebar/sidebar-nav-group.svelte -->
<script lang="ts">
  import { sidebarModeStore } from '$lib/stores/sidebar-mode.svelte';
  import { NavbarGroup } from '@immich/ui';

  interface Props {
    title: string;
  }

  let { title }: Props = $props();

  const collapsed = $derived(sidebarModeStore.layout === 'rail' && !sidebarModeStore.hoverExpanded);
</script>

{#if collapsed}
  <!-- A text heading is unreadable at 4rem, so the group boundary becomes a rule - the
       same treatment Google Photos uses in its rail. -->
  <hr data-testid="sidebar-group-divider" class="border-subtle mx-3 my-2" />
{:else}
  <NavbarGroup {title} size="tiny" />
{/if}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm test --run src/lib/components/sidebar/sidebar-nav-group.spec.ts`
Expected: PASS (3 tests)

- [ ] **Step 5: Commit**

```bash
git add src/lib/components/sidebar/sidebar-nav-group.svelte src/lib/components/sidebar/sidebar-nav-group.spec.ts
git commit -m "feat(web): collapse sidebar group headers to dividers in rail mode"
```

---

### Task 5: Rail storage indicator

**Files:**

- Create: `web/src/lib/components/shared-components/side-bar/rail-storage.svelte`
- Test: `web/src/lib/components/shared-components/side-bar/rail-storage.spec.ts`

**Interfaces:**

- Consumes: `authManager.user`, `userInteraction.serverInfo`, `getByteUnitString`, `locale`.
- Produces: default export taking no props. Renders a button-less `<div data-testid="rail-storage">` carrying the `storage_usage` tooltip.

Covers spec coverage items 20, 21.

The used/available derivation is duplicated from `StorageSpace.svelte:12-21` because adding a `compact` prop there would mean a fifth upstream file. Step 1's parity test exists so upstream quota changes fail CI rather than silently reporting wrong numbers in the rail.

- [ ] **Step 1: Write the failing test**

```ts
// web/src/lib/components/shared-components/side-bar/rail-storage.spec.ts
import '@testing-library/jest-dom';
import RailStorage from '$lib/components/shared-components/side-bar/rail-storage.svelte';
import { render, screen } from '@testing-library/svelte';

const mocks = vi.hoisted(() => ({
  authManager: { authenticated: true, user: { quotaSizeInBytes: null as number | null, quotaUsageInBytes: 0 } },
  userInteraction: {
    serverInfo: { diskSizeRaw: 0, diskUseRaw: 0 } as { diskSizeRaw: number; diskUseRaw: number } | undefined,
  },
}));

vi.mock('$lib/managers/auth-manager.svelte', () => ({ authManager: mocks.authManager }));
vi.mock('$lib/stores/user.svelte', () => ({ userInteraction: mocks.userInteraction }));
vi.mock('$lib/utils/auth', () => ({ requestServerInfo: vi.fn() }));

const bytes = () => {
  const node = screen.getByTestId('rail-storage');
  return { used: Number(node.dataset.used), available: Number(node.dataset.available) };
};

describe('rail-storage', () => {
  beforeEach(() => {
    mocks.authManager.authenticated = true;
    mocks.authManager.user = { quotaSizeInBytes: null, quotaUsageInBytes: 0 };
    mocks.userInteraction.serverInfo = { diskSizeRaw: 50_000_000_000, diskUseRaw: 12_000_000_000 };
  });

  it('renders the storage icon with an accessible label', () => {
    render(RailStorage);

    expect(screen.getByTestId('rail-storage')).toBeInTheDocument();
  });

  // Spec coverage 21. This must assert NUMBERS, not the tooltip: under test $t() returns
  // the raw key, so the title is the literal string 'storage_usage' for any byte values -
  // a title comparison would pass no matter how wrong the derivation got.
  it.each`
    scenario                    | quotaSize         | quotaUsed        | diskSize          | diskUse           | used              | available
    ${'no quota, server disk'}  | ${null}           | ${0}             | ${50_000_000_000} | ${12_000_000_000} | ${12_000_000_000} | ${50_000_000_000}
    ${'quota overrides disk'}   | ${20_000_000_000} | ${5_000_000_000} | ${50_000_000_000} | ${12_000_000_000} | ${5_000_000_000}  | ${20_000_000_000}
    ${'zero quota is honoured'} | ${0}              | ${0}             | ${50_000_000_000} | ${12_000_000_000} | ${0}              | ${0}
  `('derives bytes for $scenario', ({ quotaSize, quotaUsed, diskSize, diskUse, used, available }) => {
    mocks.authManager.user = { quotaSizeInBytes: quotaSize, quotaUsageInBytes: quotaUsed };
    mocks.userInteraction.serverInfo = { diskSizeRaw: diskSize, diskUseRaw: diskUse };

    render(RailStorage);

    expect(bytes()).toEqual({ used, available });
  });

  it('falls back to zero when the server info has not arrived', () => {
    mocks.userInteraction.serverInfo = undefined;

    render(RailStorage);

    expect(bytes()).toEqual({ used: 0, available: 0 });
  });

  it('uses server disk figures when unauthenticated even if a quota exists', () => {
    mocks.authManager.authenticated = false;
    mocks.authManager.user = { quotaSizeInBytes: 20_000_000_000, quotaUsageInBytes: 5_000_000_000 };

    render(RailStorage);

    expect(bytes()).toEqual({ used: 12_000_000_000, available: 50_000_000_000 });
  });
});
```

**Parity test (added in commit `7bcfa15` after review, per human ruling).** The table above pins
`rail-storage`'s own code but cannot detect divergence from `StorageSpace`. A second `describe`
block spies on `getByteUnitString`, renders BOTH components against the same mocked state, filters
to the `maxPrecision === 3` calls (`StorageSpace` also calls it at default precision for its
`Meter` label), and asserts identical bytes — delivering spec item 21.

The `zero quota is honoured` row pins a genuine subtlety in the upstream expression: `quotaSizeInBytes: 0` makes `hasQuota` true (it is `!== null`), but `|| 0` then collapses the value, so both readings are `0`. Mirroring that exactly is the point — if upstream ever changes it, this row fails and the duplication gets revisited.

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test --run src/lib/components/shared-components/side-bar/rail-storage.spec.ts`
Expected: FAIL — cannot resolve `rail-storage.svelte`

- [ ] **Step 3: Write minimal implementation**

```svelte
<!-- web/src/lib/components/shared-components/side-bar/rail-storage.svelte -->
<script lang="ts">
  import { authManager } from '$lib/managers/auth-manager.svelte';
  import { locale } from '$lib/stores/preferences.store';
  import { userInteraction } from '$lib/stores/user.svelte';
  import { requestServerInfo } from '$lib/utils/auth';
  import { getByteUnitString } from '$lib/utils/byte-units';
  import { Icon } from '@immich/ui';
  import { mdiCloudOutline } from '@mdi/js';
  import { onMount } from 'svelte';
  import { t } from 'svelte-i18n';

  // Duplicated from StorageSpace.svelte because giving that upstream component a
  // `compact` prop would add a fifth upstream file. The derivation is mirrored line for
  // line, and rail-storage.spec.ts pins it against a table of expected byte values.
  let hasQuota = $derived(authManager.user.quotaSizeInBytes !== null);
  let availableBytes = $derived(
    (hasQuota && authManager.authenticated
      ? authManager.user.quotaSizeInBytes
      : userInteraction.serverInfo?.diskSizeRaw) || 0,
  );
  let usedBytes = $derived(
    (hasQuota && authManager.authenticated
      ? authManager.user.quotaUsageInBytes
      : userInteraction.serverInfo?.diskUseRaw) || 0,
  );

  onMount(async () => {
    if (userInteraction.serverInfo && authManager.authenticated) {
      return;
    }
    await requestServerInfo();
  });
</script>

<div
  data-testid="rail-storage"
  class="mt-auto mb-6 flex justify-center py-2"
  data-used={usedBytes}
  data-available={availableBytes}
  title={$t('storage_usage', {
    values: {
      used: getByteUnitString(usedBytes, $locale, 3),
      available: getByteUnitString(availableBytes, $locale, 3),
    },
  })}
>
  <Icon icon={mdiCloudOutline} size="1.375em" aria-label={$t('storage')} />
</div>
```

`data-used` / `data-available` exist so the quota derivation is assertable. Under test `$t()` returns the raw key, so the rendered `title` is the literal string `storage_usage` with no interpolated numbers — anything asserting on the title alone could never detect a wrong byte value.

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm test --run src/lib/components/shared-components/side-bar/rail-storage.spec.ts`
Expected: PASS (6 tests)

- [ ] **Step 5: Commit**

```bash
git add src/lib/components/shared-components/side-bar/rail-storage.svelte src/lib/components/shared-components/side-bar/rail-storage.spec.ts
git commit -m "feat(web): add compact storage indicator for the sidebar rail"
```

---

### Task 6: Sidebar shell

**Files:**

- Create: `web/src/lib/components/sidebar/sidebar-shell.svelte`
- Test: `web/src/lib/components/sidebar/sidebar-shell.spec.ts`

**Interfaces:**

- Consumes: `sidebarModeStore` (Task 2), `sidebarStore` (upstream, read-only, `overlay` case only), `clickOutside`, `focusTrap`, `beforeNavigate`.
- Produces: default export accepting `{ ariaLabel?: string; children?: Snippet }` — the same surface as upstream `Sidebar.svelte`, so `UserSidebar` swaps one import. Renders `<nav data-testid="sidebar-parent" data-layout={layout} data-expanded={...}>`.

Covers spec coverage items 3, 6, 7, 8, 9, 10, 11, 12, 13, 14, 22, 23.

- [ ] **Step 1: Write the failing test**

```ts
// web/src/lib/components/sidebar/sidebar-shell.spec.ts
import '@testing-library/jest-dom';
import SidebarShell from '$lib/components/sidebar/sidebar-shell.svelte';
import { sidebarModeStore } from '$lib/stores/sidebar-mode.svelte';
import { fireEvent, render, screen } from '@testing-library/svelte';
import { tick } from 'svelte';

const mocks = vi.hoisted(() => ({
  sidebarMedia: { isFullSidebar: true, isWideSidebar: false },
  sidebarStore: { isOpen: true, reset: vi.fn() },
  beforeNavigate: vi.fn(),
}));

vi.mock('$lib/stores/sidebar-media.svelte', () => ({ sidebarMedia: mocks.sidebarMedia }));
vi.mock('$lib/stores/sidebar.svelte', () => ({ sidebarStore: mocks.sidebarStore }));
vi.mock('$app/navigation', () => ({ beforeNavigate: mocks.beforeNavigate }));

const nav = () => screen.getByTestId('sidebar-parent');

describe('sidebar-shell', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.sidebarMedia.isFullSidebar = true;
    mocks.sidebarMedia.isWideSidebar = false;
    mocks.sidebarStore.isOpen = true;
    sidebarModeStore.mode = 'rail';
    sidebarModeStore.resetTransient();
  });

  it('reports the rail layout', () => {
    render(SidebarShell);
    expect(nav()).toHaveAttribute('data-layout', 'rail');
  });

  // Spec coverage 12. Upstream isOpen is permanently true above 850px, so a shell that
  // consulted it would render a permanently expanded rail.
  it('ignores upstream isOpen in rail mode', () => {
    mocks.sidebarStore.isOpen = true;

    render(SidebarShell);

    expect(nav()).toHaveAttribute('data-expanded', 'false');
  });

  // Spec coverage 6.
  it('expands on pointerenter and collapses on pointerleave', async () => {
    render(SidebarShell);

    await fireEvent.pointerEnter(nav());
    expect(nav()).toHaveAttribute('data-expanded', 'true');

    await fireEvent.pointerLeave(nav());
    expect(nav()).toHaveAttribute('data-expanded', 'false');
  });

  // Spec coverage 7: the grid slot must stay at rail width so the timeline never re-lays-out.
  it('keeps the grid slot at rail width while hover-expanded', async () => {
    render(SidebarShell);
    await fireEvent.pointerEnter(nav());

    expect(nav()).toHaveAttribute('data-slot-width', 'rail');
  });

  // Spec coverage 8.
  it('expands on focusin and collapses on focusout', async () => {
    render(SidebarShell);

    await fireEvent.focusIn(nav());
    expect(nav()).toHaveAttribute('data-expanded', 'true');

    await fireEvent.focusOut(nav());
    expect(nav()).toHaveAttribute('data-expanded', 'false');
  });

  // Spec coverage 9.
  it('collapses on Escape', async () => {
    render(SidebarShell);
    await fireEvent.pointerEnter(nav());

    await fireEvent.keyDown(nav(), { key: 'Escape' });

    expect(nav()).toHaveAttribute('data-expanded', 'false');
  });

  // Spec coverage 10.
  it('dismisses the rail overlay on outside click', async () => {
    render(SidebarShell);
    sidebarModeStore.toggleRailOverlay();
    expect(nav()).toHaveAttribute('data-expanded', 'true');

    await fireEvent.mouseDown(document.body);

    expect(sidebarModeStore.railOverlayOpen).toBe(false);
  });

  // Spec coverage 11.
  it('registers a beforeNavigate handler that clears only the overlay flag', () => {
    render(SidebarShell);
    expect(mocks.beforeNavigate).toHaveBeenCalled();

    sidebarModeStore.hoverExpanded = true;
    sidebarModeStore.toggleRailOverlay();

    const handler = mocks.beforeNavigate.mock.calls[0][0] as () => void;
    handler();

    expect(sidebarModeStore.railOverlayOpen).toBe(false);
    // The pointer is still over the rail after clicking a link, so hover survives.
    expect(sidebarModeStore.hoverExpanded).toBe(true);
  });

  // Spec coverage 13.
  it('never marks itself inert in rail mode', () => {
    render(SidebarShell);
    expect((nav() as HTMLElement).inert).toBe(false);
  });

  // Spec coverage 14: the sub-850px overlay keeps today's modal behaviour.
  it('is inert when hidden below 850px', () => {
    mocks.sidebarMedia.isFullSidebar = false;
    mocks.sidebarStore.isOpen = false;

    render(SidebarShell);

    expect(nav()).toHaveAttribute('data-layout', 'overlay');
    expect((nav() as HTMLElement).inert).toBe(true);
  });

  it('is not inert when the sub-850px overlay is open', () => {
    mocks.sidebarMedia.isFullSidebar = false;
    mocks.sidebarStore.isOpen = true;

    render(SidebarShell);

    expect((nav() as HTMLElement).inert).toBe(false);
  });

  // Spec coverage 3. The reset runs in an $effect, which flushes in a post-render
  // microtask - await tick() explicitly rather than relying on rerender() to flush it.
  it('clears transient flags when the layout leaves rail', async () => {
    render(SidebarShell);
    await fireEvent.pointerEnter(nav());
    expect(sidebarModeStore.hoverExpanded).toBe(true);

    sidebarModeStore.mode = 'expanded';
    await tick();

    expect(sidebarModeStore.hoverExpanded).toBe(false);
    expect(sidebarModeStore.railOverlayOpen).toBe(false);
  });

  // Guards the resurface case: returning to rail must not restore a stale hover state.
  it('does not restore stale hover state when returning to rail', async () => {
    render(SidebarShell);
    await fireEvent.pointerEnter(nav());

    sidebarModeStore.mode = 'expanded';
    await tick();
    sidebarModeStore.mode = 'rail';
    await tick();

    expect(nav()).toHaveAttribute('data-expanded', 'false');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test --run src/lib/components/sidebar/sidebar-shell.spec.ts`
Expected: FAIL — cannot resolve `sidebar-shell.svelte`

- [ ] **Step 3: Write minimal implementation**

```svelte
<!-- web/src/lib/components/sidebar/sidebar-shell.svelte -->
<script lang="ts">
  import { beforeNavigate } from '$app/navigation';
  import { clickOutside } from '$lib/actions/click-outside';
  import { focusTrap } from '$lib/actions/focus-trap';
  import { sidebarModeStore } from '$lib/stores/sidebar-mode.svelte';
  import { sidebarStore } from '$lib/stores/sidebar.svelte';
  import type { Snippet } from 'svelte';

  interface Props {
    ariaLabel?: string;
    children?: Snippet;
  }

  let { ariaLabel, children }: Props = $props();

  const layout = $derived(sidebarModeStore.layout);
  const isRail = $derived(layout === 'rail');
  const isOverlay = $derived(layout === 'overlay');

  // In rail mode expansion comes solely from our own transient flags. Upstream
  // `sidebarStore.isOpen` is $derived from the 850px query, so above 850px it is
  // permanently true and would pin the rail open.
  const isExpanded = $derived(
    layout === 'expanded' ||
      (isRail && (sidebarModeStore.hoverExpanded || sidebarModeStore.railOverlayOpen)) ||
      (isOverlay && sidebarStore.isOpen),
  );

  const isHidden = $derived(isOverlay && !sidebarStore.isOpen);

  // Returning to rail after a stint at another width must not resurface a stale
  // hover state, so clear both flags whenever the layout leaves rail.
  $effect(() => {
    if (!isRail) {
      sidebarModeStore.resetTransient();
    }
  });

  beforeNavigate(() => {
    // The pointer is still over the rail after clicking a link, so hoverExpanded is
    // left alone - only the explicit tap/keyboard overlay closes.
    sidebarModeStore.railOverlayOpen = false;
  });

  const collapse = () => {
    sidebarModeStore.hoverExpanded = false;
    sidebarModeStore.railOverlayOpen = false;
  };

  const handleOutclick = () => {
    if (isRail) {
      sidebarModeStore.railOverlayOpen = false;
      return;
    }
    if (isOverlay && sidebarStore.isOpen) {
      sidebarStore.reset();
    }
  };
</script>

<nav
  id="sidebar"
  aria-label={ariaLabel}
  tabindex="-1"
  data-testid="sidebar-parent"
  data-layout={layout}
  data-expanded={String(isExpanded)}
  data-slot-width={isRail ? 'rail' : layout}
  inert={isHidden}
  class="relative z-10 h-full"
  onpointerenter={() => isRail && (sidebarModeStore.hoverExpanded = true)}
  onpointerleave={() => isRail && (sidebarModeStore.hoverExpanded = false)}
  onfocusin={() => isRail && (sidebarModeStore.hoverExpanded = true)}
  onfocusout={() => isRail && (sidebarModeStore.hoverExpanded = false)}
  use:clickOutside={{ onOutclick: handleOutclick, onEscape: collapse }}
  use:focusTrap={{ active: isOverlay && sidebarStore.isOpen }}
>
  <!--
    The nav keeps its grid slot at the rail width; this inner container is absolutely
    positioned and grows over the content instead, so the justified timeline never reflows.
  -->
  <div
    class="immich-scrollbar bg-light absolute start-0 top-0 flex h-full flex-col gap-1 overflow-x-hidden overflow-y-auto pt-8 ps-2 transition-[width] duration-200 motion-reduce:transition-none"
    class:w-64={isExpanded}
    class:w-16={isRail && !isExpanded}
    class:w-0={isHidden}
    class:shadow-2xl={isExpanded && layout !== 'expanded'}
  >
    {@render children?.()}
  </div>
</nav>
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm test --run src/lib/components/sidebar/sidebar-shell.spec.ts`
Expected: PASS (14 tests)

- [ ] **Step 5: Add the RTL and reduced-motion cases**

Append to `sidebar-shell.spec.ts`:

```ts
describe('sidebar-shell direction and motion', () => {
  beforeEach(() => {
    mocks.sidebarMedia.isFullSidebar = true;
    sidebarModeStore.mode = 'rail';
    sidebarModeStore.resetTransient();
  });

  afterEach(() => {
    document.documentElement.dir = 'ltr';
  });

  // Spec coverage 23: logical properties must carry the rail to the inline-end in RTL.
  it('anchors the panel to the inline-start in both directions', () => {
    document.documentElement.dir = 'rtl';

    render(SidebarShell);

    const panel = screen.getByTestId('sidebar-parent').firstElementChild as HTMLElement;
    expect(panel.className).toContain('start-0');
    expect(panel.className).not.toContain('left-0');
  });

  // Spec coverage 22.
  it('opts out of the width transition under reduced motion', () => {
    render(SidebarShell);

    const panel = screen.getByTestId('sidebar-parent').firstElementChild as HTMLElement;
    expect(panel.className).toContain('motion-reduce:transition-none');
  });
});
```

- [ ] **Step 6: Run the full shell spec**

Run: `pnpm test --run src/lib/components/sidebar/sidebar-shell.spec.ts`
Expected: PASS (16 tests)

- [ ] **Step 7: Commit**

```bash
git add src/lib/components/sidebar/sidebar-shell.svelte src/lib/components/sidebar/sidebar-shell.spec.ts
git commit -m "feat(web): add sidebar shell with rail hover expansion"
```

---

### Task 7: Wire UserSidebar

**Files:**

- Modify: `web/src/lib/components/shared-components/side-bar/UserSidebar.svelte`
- Modify: `web/src/lib/components/shared-components/side-bar/user-sidebar.spec.ts`
- Create: `web/src/test-data/mocks/sidebar-shell.stub.svelte`
- Create: `web/src/test-data/mocks/sidebar-nav-item.stub.svelte`

**Interfaces:**

- Consumes: `sidebar-shell.svelte` (Task 6), `sidebar-nav-item.svelte` (Task 3), `sidebar-nav-group.svelte` (Task 4), `rail-storage.svelte` (Task 5).
- Produces: nothing new. `UserSidebar` keeps its zero-prop surface.

`user-sidebar.spec.ts` **must** change: it currently mocks `$lib/components/sidebar/sidebar.svelte` and `@immich/ui`'s `NavbarItem` / `NavbarGroup`, all three of which this task replaces. Left untouched, it would silently render the real components and its `data-active` assertions would break. The new stubs mirror the existing ones so the four behavioural assertions in that file stay byte-identical.

- [ ] **Step 1: Write the stubs**

```svelte
<!-- web/src/test-data/mocks/sidebar-shell.stub.svelte -->
<script lang="ts">
  import type { Snippet } from 'svelte';

  interface Props {
    ariaLabel?: string;
    children?: Snippet;
  }

  let { ariaLabel, children }: Props = $props();
</script>

<nav aria-label={ariaLabel}>
  {@render children?.()}
</nav>
```

```svelte
<!-- web/src/test-data/mocks/sidebar-nav-item.stub.svelte -->
<script lang="ts">
  import type { Snippet } from 'svelte';

  interface Props {
    title: string;
    href?: string;
    isActive?: () => boolean;
    expanded?: boolean;
    items?: Snippet;
  }

  let { title, href = '#', isActive, expanded = $bindable(false), items }: Props = $props();

  // Mirrors navbar-item.stub.svelte: surface the isActive override's verdict so tests can
  // assert what the real component highlights. Rows without an override render no
  // data-active at all, keeping the default prefix match untested here.
  const active = $derived(isActive?.());
</script>

<a {href} data-expanded={expanded} data-active={active === undefined ? undefined : String(active)}>{title}</a>

{#if items}
  {@render items()}
{/if}
```

- [ ] **Step 2: Update the spec's mock targets to the new modules**

In `web/src/lib/components/shared-components/side-bar/user-sidebar.spec.ts`, replace the sidebar mock:

```ts
vi.mock('$lib/components/sidebar/sidebar-shell.svelte', async () => {
  const module = await import('@test-data/mocks/sidebar-shell.stub.svelte');
  return { default: module.default };
});
```

Replace the `BottomInfo` mock with both bottom components:

```ts
vi.mock('$lib/components/shared-components/side-bar/BottomInfo.svelte', async () => {
  const module = await import('@test-data/mocks/noop-component.svelte');
  return { default: module.default };
});

vi.mock('$lib/components/shared-components/side-bar/rail-storage.svelte', async () => {
  const module = await import('@test-data/mocks/noop-component.svelte');
  return { default: module.default };
});
```

Replace the `@immich/ui` mock with mocks for the two fork components:

```ts
vi.mock('$lib/components/sidebar/sidebar-nav-item.svelte', async () => {
  const module = await import('@test-data/mocks/sidebar-nav-item.stub.svelte');
  return { default: module.default };
});

vi.mock('$lib/components/sidebar/sidebar-nav-group.svelte', async () => {
  const module = await import('@test-data/mocks/navbar-group.stub.svelte');
  return { default: module.default };
});
```

Add the mode-store mock so `UserSidebar` can resolve the storage branch:

```ts
const sidebarMocks = vi.hoisted(() => ({
  sidebarModeStore: { layout: 'expanded' as 'overlay' | 'rail' | 'expanded', hoverExpanded: false },
}));

vi.mock('$lib/stores/sidebar-mode.svelte', () => ({ sidebarModeStore: sidebarMocks.sidebarModeStore }));
```

- [ ] **Step 3: Run the spec to verify it fails**

Run: `pnpm test --run src/lib/components/shared-components/side-bar/user-sidebar.spec.ts`

Expected: FAIL. Do not pin the exact message — `UserSidebar` still imports `Sidebar.svelte` and `@immich/ui` at this point, so the new mock targets are unused and the real components render. The failure will surface as the `data-active` / `getByRole('link')` assertions not matching, and possibly as an unresolved-module error for the not-yet-created `sidebar-shell.svelte`. **Read the actual output and confirm it fails because the real components rendered, not because a stub is malformed** — a stub typo produces a superficially similar failure and would let Step 4 "fix" the wrong thing.

- [ ] **Step 4: Rewire UserSidebar**

In `web/src/lib/components/shared-components/side-bar/UserSidebar.svelte`:

1. Replace the imports:

```ts
import BottomInfo from '$lib/components/shared-components/side-bar/BottomInfo.svelte';
import RailStorage from '$lib/components/shared-components/side-bar/rail-storage.svelte';
import RecentAlbums from '$lib/components/shared-components/side-bar/RecentAlbums.svelte';
import RecentSpaces from '$lib/components/shared-components/side-bar/recent-spaces.svelte';
import SidebarNavGroup from '$lib/components/sidebar/sidebar-nav-group.svelte';
import SidebarNavItem from '$lib/components/sidebar/sidebar-nav-item.svelte';
import Sidebar from '$lib/components/sidebar/sidebar-shell.svelte';
import { sidebarModeStore } from '$lib/stores/sidebar-mode.svelte';
```

Remove the `NavbarGroup, NavbarItem` import from `@immich/ui`.

2. Add the collapsed derivation to the script block:

```ts
const collapsed = $derived(sidebarModeStore.layout === 'rail' && !sidebarModeStore.hoverExpanded);
```

3. Rename all **18** `<NavbarItem` occurrences to `<SidebarNavItem` and the single `<NavbarGroup` to `<SidebarNavGroup`. Every prop stays as-is.

4. Replace `<BottomInfo />` with the branch:

```svelte
{#if collapsed}
  <RailStorage />
{:else}
  <BottomInfo />
{/if}
```

- [ ] **Step 5: Run the spec to verify it passes**

Run: `pnpm test --run src/lib/components/shared-components/side-bar/user-sidebar.spec.ts`
Expected: PASS (5 tests — the four pre-existing behavioural assertions plus the memories pair)

- [ ] **Step 6: Verify no `NavbarItem` remains and Sidebar.spec.ts is untouched**

```bash
grep -c "NavbarItem\|NavbarGroup" src/lib/components/shared-components/side-bar/UserSidebar.svelte   # expect 0
git status --short src/lib/components/sidebar/Sidebar.svelte src/lib/components/sidebar/Sidebar.spec.ts  # expect empty
pnpm test --run src/lib/components/sidebar/Sidebar.spec.ts   # expect PASS
```

- [ ] **Step 7: Commit**

```bash
git add src/lib/components/shared-components/side-bar/UserSidebar.svelte \
        src/lib/components/shared-components/side-bar/user-sidebar.spec.ts \
        src/test-data/mocks/sidebar-shell.stub.svelte \
        src/test-data/mocks/sidebar-nav-item.stub.svelte
git commit -m "feat(web): render the user sidebar through the rail-aware shell"
```

---

### Task 8: Layout and navbar wiring

**Files:**

- Modify: `web/src/lib/components/layouts/UserPageLayout.svelte:59-70`
- Modify: `web/src/lib/components/shared-components/navigation-bar/NavigationBar.svelte:56-81`
- Test: `web/src/lib/components/layouts/user-page-layout.spec.ts` (exists — extend)
- Test: `web/src/lib/components/shared-components/navigation-bar/navigation-bar.spec.ts` (create)

**Interfaces:**

- Consumes: `sidebarModeStore.layout` (Task 2).
- Produces: nothing consumed by later tasks.

Covers spec coverage items 25, 26, 27, 28, 29, 30.

- [ ] **Step 1: Write the failing tests**

```ts
// web/src/lib/components/shared-components/navigation-bar/navigation-bar.spec.ts
import '@testing-library/jest-dom';
import NavigationBar from '$lib/components/shared-components/navigation-bar/NavigationBar.svelte';
import { render, screen } from '@testing-library/svelte';

const mocks = vi.hoisted(() => ({
  sidebarModeStore: {
    layout: 'expanded' as 'overlay' | 'rail' | 'expanded',
    railOverlayOpen: false,
    toggleRailOverlay: vi.fn(),
  },
  sidebarStore: { isOpen: false, toggle: vi.fn() },
}));

vi.mock('$lib/stores/sidebar-mode.svelte', () => ({ sidebarModeStore: mocks.sidebarModeStore }));
vi.mock('$lib/stores/sidebar.svelte', () => ({ sidebarStore: mocks.sidebarStore }));

// NavigationBar pulls in the search trigger, notification and account panels, the avatar
// and theme button, and calls notificationManager.refresh() on mount - a network call.
// Everything not under test is stubbed out so this spec exercises only the sidebar wiring.
vi.mock('$lib/stores/notification-manager.svelte', () => ({
  notificationManager: { notifications: [], refresh: vi.fn().mockResolvedValue(undefined) },
}));

vi.mock('$lib/services/app.service', () => ({ getGlobalActions: () => ({ Cast: undefined }) }));

vi.mock('$lib/managers/global-search-manager.svelte', () => ({ globalSearchManager: { open: vi.fn() } }));

vi.mock('$lib/managers/auth-manager.svelte', () => ({
  authManager: { authenticated: true, user: { name: 'Test', email: 'test@example.com' } },
}));

// Written out one by one on purpose: vi.mock is hoisted to the top of the module and
// needs a literal path, so a loop over an array of paths silently fails to mock anything.
vi.mock('$lib/components/global-search/global-search-input-trigger.svelte', async () => {
  const module = await import('@test-data/mocks/noop-component.svelte');
  return { default: module.default };
});

vi.mock('$lib/components/shared-components/navigation-bar/NotificationPanel.svelte', async () => {
  const module = await import('@test-data/mocks/noop-component.svelte');
  return { default: module.default };
});

vi.mock('$lib/components/shared-components/navigation-bar/AccountInfoPanel.svelte', async () => {
  const module = await import('@test-data/mocks/noop-component.svelte');
  return { default: module.default };
});

vi.mock('$lib/components/shared-components/UserAvatar.svelte', async () => {
  const module = await import('@test-data/mocks/noop-component.svelte');
  return { default: module.default };
});

vi.mock('$lib/components/shared-components/ThemeButton.svelte', async () => {
  const module = await import('@test-data/mocks/noop-component.svelte');
  return { default: module.default };
});

const menuButton = () => screen.getByRole('button', { name: /main_menu/i });

describe('NavigationBar sidebar integration', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.sidebarModeStore.layout = 'expanded';
  });

  // Spec coverage 25.
  it.each`
    layout        | hidden
    ${'expanded'} | ${true}
    ${'rail'}     | ${false}
    ${'overlay'}  | ${false}
  `('menu button hidden=$hidden for $layout', ({ layout, hidden }) => {
    mocks.sidebarModeStore.layout = layout;

    render(NavigationBar);

    expect(menuButton().hasAttribute('data-hidden')).toBe(hidden);
  });

  // Spec coverage 26: rail must route to the real toggle, not upstream's open-only one.
  it('toggles the rail overlay rather than sidebarStore in rail mode', async () => {
    mocks.sidebarModeStore.layout = 'rail';

    render(NavigationBar);
    menuButton().click();

    expect(mocks.sidebarModeStore.toggleRailOverlay).toHaveBeenCalledOnce();
    expect(mocks.sidebarStore.toggle).not.toHaveBeenCalled();
  });

  it('falls back to sidebarStore.toggle below 850px', async () => {
    mocks.sidebarModeStore.layout = 'overlay';

    render(NavigationBar);
    menuButton().click();

    expect(mocks.sidebarStore.toggle).toHaveBeenCalledOnce();
    expect(mocks.sidebarModeStore.toggleRailOverlay).not.toHaveBeenCalled();
  });

  // Spec coverage 27: 4rem cannot hold the hamburger and the logo together.
  it.each`
    layout        | column
    ${'overlay'}  | ${'narrow'}
    ${'rail'}     | ${'narrow'}
    ${'expanded'} | ${'wide'}
  `('navbar first column is $column for $layout', ({ layout, column }) => {
    mocks.sidebarModeStore.layout = layout;

    render(NavigationBar);

    expect(screen.getByTestId('navbar-grid')).toHaveAttribute('data-column', column);
  });

  // Spec coverage 28.
  it.each`
    layout        | variant
    ${'overlay'}  | ${'icon'}
    ${'rail'}     | ${'icon'}
    ${'expanded'} | ${'inline'}
  `('logo variant is $variant for $layout', ({ layout, variant }) => {
    mocks.sidebarModeStore.layout = layout;

    render(NavigationBar);

    expect(screen.getByTestId('navbar-logo')).toHaveAttribute('data-variant', variant);
  });
});
```

```ts
// append to web/src/lib/components/layouts/user-page-layout.spec.ts
describe('UserPageLayout sidebar width', () => {
  it.each`
    layout        | width
    ${'overlay'}  | ${'0'}
    ${'rail'}     | ${'rail'}
    ${'expanded'} | ${'expanded'}
  `('sets the grid width to $width for $layout', ({ layout, width }) => {
    layoutMocks.sidebarModeStore.layout = layout;

    render(UserPageLayout);

    expect(screen.getByTestId('user-page-grid')).toHaveAttribute('data-sidebar-width', width);
  });

  // Spec coverage 29: /tags and /folders pass their own tree-explorer sidebar wrapping
  // upstream Sidebar.svelte, which renders sidebar:w-64 regardless of our variable. Applying
  // the rail width there would put a 16rem sidebar in a 4rem column.
  it('keeps the expanded width when a custom sidebar snippet is supplied', () => {
    layoutMocks.sidebarModeStore.layout = 'rail';

    render(UserPageLayout, {
      props: { sidebar: createRawSnippet(() => ({ render: () => `<nav data-testid="tree">tree</nav>` })) },
    });

    expect(screen.getByTestId('user-page-grid')).toHaveAttribute('data-sidebar-width', 'expanded');
  });
});
```

Add to the top of `user-page-layout.spec.ts`:

```ts
const layoutMocks = vi.hoisted(() => ({
  sidebarModeStore: { layout: 'expanded' as 'overlay' | 'rail' | 'expanded' },
}));

vi.mock('$lib/stores/sidebar-mode.svelte', () => ({ sidebarModeStore: layoutMocks.sidebarModeStore }));
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm test --run src/lib/components/shared-components/navigation-bar/navigation-bar.spec.ts src/lib/components/layouts/user-page-layout.spec.ts`
Expected: FAIL — missing `navbar-grid`, `navbar-logo`, `user-page-grid` test ids

- [ ] **Step 3: Implement UserPageLayout**

Replace the grid container opening tag (`UserPageLayout.svelte:59-65`):

```svelte
<script lang="ts">
  // ...existing imports
  import { sidebarModeStore } from '$lib/stores/sidebar-mode.svelte';

  // /tags and /folders supply a tree explorer wrapping upstream Sidebar.svelte, which is
  // always 16rem above 850px. Collapsing their grid column to the rail width would clip it,
  // and a tag tree has no meaningful icon-only form, so those pages opt out of the rail.
  const sidebarWidth = $derived.by(() => {
    if (sidebar) {
      return sidebarModeStore.layout === 'overlay' ? '0' : 'expanded';
    }
    return sidebarModeStore.layout === 'overlay' ? '0' : sidebarModeStore.layout;
  });

  const sidebarWidthValue = $derived(
    { '0': '0px', rail: 'calc(var(--spacing) * 16)', expanded: 'calc(var(--spacing) * 64)' }[sidebarWidth],
  );
</script>

<div
  tabindex="-1"
  data-testid="user-page-grid"
  data-sidebar-width={sidebarWidth}
  style:--sidebar-width={sidebarWidthValue}
  class="relative z-0 grid grid-cols-[var(--sidebar-width)_auto] overflow-hidden
    {hideNavbar ? 'h-dvh' : 'h-[calc(100dvh-var(--navbar-height))] max-md:h-[calc(100dvh-var(--navbar-height-md))]'}
    {hideNavbar ? 'pt-(--navbar-height)' : ''}
    {hideNavbar ? 'max-md:pt-(--navbar-height-md)' : ''}"
>
```

The two `sidebar:grid-cols-*` variants are removed — the variable now carries the width at every breakpoint.

- [ ] **Step 4: Implement NavigationBar**

In `NavigationBar.svelte`:

```ts
import { sidebarModeStore } from '$lib/stores/sidebar-mode.svelte';

const isRail = $derived(sidebarModeStore.layout === 'rail');
const isExpandedLayout = $derived(sidebarModeStore.layout === 'expanded');

// The first column holds the hamburger AND the logo, which is why its sub-850px value is
// 8rem. Rail mode needs the hamburger visible, so it cannot shrink to the 4rem rail width.
const navColumn = $derived(isExpandedLayout ? 'wide' : 'narrow');
```

Replace the grid `<div>` (line 56):

```svelte
<div
  data-testid="navbar-grid"
  data-column={navColumn}
  class="grid h-full items-center py-2 {navColumn === 'wide'
    ? 'grid-cols-[--spacing(64)_auto]'
    : 'grid-cols-[--spacing(32)_auto]'} {noBorder ? '' : 'border-b'}"
>
```

Replace the menu `IconButton`'s `class` and `onclick`:

```svelte
  class={isExpandedLayout ? 'hidden' : ''}
  data-hidden={isExpandedLayout ? '' : undefined}
  onclick={() => {
    if (isRail) {
      sidebarModeStore.toggleRailOverlay();
      return;
    }
    sidebarStore.toggle();
  }}
```

Replace the `Logo` (line 81):

```svelte
<Logo
  variant={isExpandedLayout ? 'inline' : 'icon'}
  data-testid="navbar-logo"
  data-variant={isExpandedLayout ? 'inline' : 'icon'}
  class="max-md:h-12"
/>
```

`Logo` spreads no rest props, so add `data-testid` and `data-variant` to its `Props` type and to the `<img>` in `Logo.svelte` — **or**, to keep `Logo.svelte` off the upstream-modified list, wrap it:

```svelte
<span data-testid="navbar-logo" data-variant={isExpandedLayout ? 'inline' : 'icon'}>
  <Logo variant={isExpandedLayout ? 'inline' : 'icon'} class="max-md:h-12" />
</span>
```

Use the wrapper. `Logo.svelte` stays untouched.

- [ ] **Step 5: Run tests to verify they pass**

Run: `pnpm test --run src/lib/components/shared-components/navigation-bar/navigation-bar.spec.ts src/lib/components/layouts/user-page-layout.spec.ts`
Expected: PASS

- [ ] **Step 6: Verify admin pages are untouched (spec coverage 30)**

```bash
git status --short src/lib/components/layouts/AdminPageLayout.svelte   # expect empty
pnpm test --run src/lib/components/layouts/   # expect PASS
```

- [ ] **Step 7: Commit**

```bash
git add src/lib/components/layouts/UserPageLayout.svelte \
        src/lib/components/layouts/user-page-layout.spec.ts \
        src/lib/components/shared-components/navigation-bar/NavigationBar.svelte \
        src/lib/components/shared-components/navigation-bar/navigation-bar.spec.ts
git commit -m "feat(web): size the page grid and navbar from the sidebar layout"
```

---

### Task 9: Settings control

**Files:**

- Create: `web/src/routes/(user)/user-settings/sidebar-settings.svelte`
- Test: `web/src/routes/(user)/user-settings/sidebar-settings.spec.ts`
- Modify: `web/src/routes/(user)/user-settings/AppSettings.svelte`
- Modify: `i18n/en.json`

**Interfaces:**

- Consumes: `sidebarModeStore`, `SIDEBAR_MODES` (Task 2), `SettingCombobox`.
- Produces: default export taking no props.

Covers spec coverage item 31.

- [ ] **Step 1: Add the i18n keys**

In `i18n/en.json`, add alphabetically among the `sidebar*` keys:

```json
"sidebar_mode": "Sidebar",
"sidebar_mode_auto": "Automatic",
"sidebar_mode_description": "Choose whether the sidebar shows labels, collapses to icons, or adapts to your screen size.",
"sidebar_mode_expanded": "Always expanded",
"sidebar_mode_rail": "Always compact",
```

- [ ] **Step 2: Write the failing test**

```ts
// web/src/routes/(user)/user-settings/sidebar-settings.spec.ts
import '@testing-library/jest-dom';
import SidebarSettings from './sidebar-settings.svelte';
import { sidebarModeStore } from '$lib/stores/sidebar-mode.svelte';
import { render, screen } from '@testing-library/svelte';

const mocks = vi.hoisted(() => ({ sidebarMedia: { isFullSidebar: true, isWideSidebar: true } }));
vi.mock('$lib/stores/sidebar-media.svelte', () => ({ sidebarMedia: mocks.sidebarMedia }));

describe('sidebar-settings', () => {
  beforeEach(() => {
    localStorage.clear();
    sidebarModeStore.mode = 'auto';
  });

  it('offers all three modes', () => {
    render(SidebarSettings);

    expect(screen.getByTestId('sidebar-mode-setting')).toBeInTheDocument();
  });

  it('writes the selected mode and re-resolves the layout', async () => {
    render(SidebarSettings);

    sidebarModeStore.mode = 'rail';

    expect(sidebarModeStore.mode).toBe('rail');
    // isWideSidebar is true, so only an explicit rail choice produces a rail here.
    expect(sidebarModeStore.layout).toBe('rail');
  });
});
```

The spec sits beside the component and imports it relatively — `web/` defines no `$routes` alias, so `$lib` is the only path alias available here.

- [ ] **Step 3: Run test to verify it fails**

Run: `pnpm test --run "src/routes/(user)/user-settings/sidebar-settings.spec.ts"`
Expected: FAIL — cannot resolve `sidebar-settings.svelte`

- [ ] **Step 4: Write the component**

```svelte
<!-- web/src/routes/(user)/user-settings/sidebar-settings.svelte -->
<script lang="ts">
  import type { ComboBoxOption } from '$lib/components/shared-components/Combobox.svelte';
  import { SIDEBAR_MODES, sidebarModeStore, type SidebarMode } from '$lib/stores/sidebar-mode.svelte';
  import SettingCombobox from './SettingCombobox.svelte';
  import { t } from 'svelte-i18n';

  const labels: Record<SidebarMode, string> = $derived({
    auto: $t('sidebar_mode_auto'),
    expanded: $t('sidebar_mode_expanded'),
    rail: $t('sidebar_mode_rail'),
  });

  const options: ComboBoxOption[] = $derived(SIDEBAR_MODES.map((value) => ({ value, label: labels[value] })));
  const selectedOption = $derived({ value: sidebarModeStore.mode, label: labels[sidebarModeStore.mode] });

  const handleSelect = (option: ComboBoxOption | undefined) => {
    if (option && SIDEBAR_MODES.includes(option.value as SidebarMode)) {
      sidebarModeStore.mode = option.value as SidebarMode;
    }
  };
</script>

<div data-testid="sidebar-mode-setting">
  <SettingCombobox
    title={$t('sidebar_mode')}
    subtitle={$t('sidebar_mode_description')}
    comboboxPlaceholder={$t('sidebar_mode')}
    {options}
    {selectedOption}
    onSelect={handleSelect}
  />
</div>
```

- [ ] **Step 5: Hook it into AppSettings**

In `web/src/routes/(user)/user-settings/AppSettings.svelte`, add the import and render it after the theme/locale block:

```ts
import SidebarSettings from './sidebar-settings.svelte';
```

```svelte
<SidebarSettings />
```

- [ ] **Step 6: Run tests to verify they pass**

Run: `pnpm test --run "src/routes/(user)/user-settings/"`
Expected: PASS

- [ ] **Step 7: Commit**

```bash
git add "src/routes/(user)/user-settings/sidebar-settings.svelte" \
        "src/routes/(user)/user-settings/sidebar-settings.spec.ts" \
        "src/routes/(user)/user-settings/AppSettings.svelte" \
        ../i18n/en.json
git commit -m "feat(web): add the sidebar mode setting"
```

---

### Task 10: End-to-end coverage

**Files:**

- Create: `e2e/src/ui/specs/sidebar/sidebar-rail.e2e-spec.ts`

**Interfaces:**

- Consumes: the shipped app. No module imports from earlier tasks.

Covers spec coverage items 33, 34, 35. Uses the viewport-driven `ui` Playwright project (`e2e/playwright.config.ts:43`, `testDir: ./src/ui/specs`), following `e2e/src/ui/specs/timeline/timeline-grouping.e2e-spec.ts`.

- [ ] **Step 1: Write the E2E spec**

```ts
// e2e/src/ui/specs/sidebar/sidebar-rail.e2e-spec.ts
import { faker } from '@faker-js/faker';
import { expect, test } from '@playwright/test';
import { setupBaseMockApiRoutes } from 'src/ui/mock-network/base-network';
import { utils } from 'src/utils';

test.describe('Sidebar rail', () => {
  let adminUserId: string;

  test.beforeAll(() => {
    utils.initSdk();
    adminUserId = faker.string.uuid();
  });

  test.beforeEach(async ({ context }) => {
    await setupBaseMockApiRoutes(context, adminUserId);
  });

  const sidebar = '[data-testid="sidebar-parent"]';
  const grid = '[data-testid="user-page-grid"]';

  // Spec coverage 33.
  test('shows the rail at 1000px and expands on hover without moving the grid', async ({ page }) => {
    await page.setViewportSize({ width: 1000, height: 900 });
    await page.goto('/photos');

    await expect(page.locator(sidebar)).toHaveAttribute('data-layout', 'rail');
    await expect(page.locator(grid)).toHaveAttribute('data-sidebar-width', 'rail');

    const before = await page.locator(grid).evaluate((node) => getComputedStyle(node).gridTemplateColumns);

    await page.locator(sidebar).hover();
    await expect(page.locator(sidebar)).toHaveAttribute('data-expanded', 'true');

    const after = await page.locator(grid).evaluate((node) => getComputedStyle(node).gridTemplateColumns);
    expect(after).toBe(before);
  });

  // Spec coverage 34.
  test('honours an explicit rail choice at 1400px and survives reload', async ({ page }) => {
    await page.setViewportSize({ width: 1400, height: 900 });
    await page.goto('/photos');
    await expect(page.locator(sidebar)).toHaveAttribute('data-layout', 'expanded');

    await page.evaluate(() => localStorage.setItem('sidebar-mode', JSON.stringify('rail')));
    await page.reload();

    await expect(page.locator(sidebar)).toHaveAttribute('data-layout', 'rail');
  });

  // Spec coverage 35: the hamburger must both open AND close - upstream toggle() never closes.
  test('opens and closes the rail overlay from the hamburger', async ({ page }) => {
    await page.setViewportSize({ width: 1000, height: 900 });
    await page.goto('/photos');

    const menu = page.locator('#top-menu-button');
    await expect(menu).toBeVisible();

    await menu.click();
    await expect(page.locator(sidebar)).toHaveAttribute('data-expanded', 'true');

    await menu.click();
    await expect(page.locator(sidebar)).toHaveAttribute('data-expanded', 'false');
  });

  test('navigates when a rail icon is tapped', async ({ page }) => {
    await page.setViewportSize({ width: 1000, height: 900 });
    await page.goto('/photos');

    await page.locator(`${sidebar} a[href="/albums"]`).click();

    await expect(page).toHaveURL(/\/albums/);
  });
});
```

- [ ] **Step 2: Run the E2E spec against a running dev stack**

Run from the repo root, with the dev stack up:

```bash
make e2e-web-dev
```

Or target this project directly from `e2e/`:

```bash
pnpm exec playwright test --project=ui src/ui/specs/sidebar/sidebar-rail.e2e-spec.ts
```

Expected: PASS. The `ui` project needs `PW_EXPERIMENTAL_SERVICE_WORKER_NETWORK_EVENTS=1` for mock-network routing — the timeline specs assert this in `beforeAll`; if the sidebar specs prove to need it too, add the same `test.fail` guard.

- [ ] **Step 3: Commit**

```bash
git add e2e/src/ui/specs/sidebar/sidebar-rail.e2e-spec.ts
git commit -m "test(web): add end-to-end coverage for the sidebar rail"
```

---

### Task 11: Final gates

**Files:** none created.

- [ ] **Step 1: Run the full web unit suite**

Run: `pnpm test`
Expected: PASS, with the pre-existing 299 files still green plus the new specs.

- [ ] **Step 2: Type checks**

Run from `web/`:

```bash
pnpm check:typescript
pnpm check:svelte
```

Expected: 0 errors. `check:svelte` can scan 0 files locally while still working in CI — if it reports 0 files, treat it as a push-only gate rather than a pass.

- [ ] **Step 3: Lint and format**

Run from `web/`:

```bash
pnpm lint
npx prettier --check src
```

Expected: both clean. ESLint and Prettier are separate CI gates — passing one does not imply the other.

- [ ] **Step 4: Confirm the upstream footprint**

```bash
git diff --name-only main... | grep -v '^docs/' | sort
```

Expected exactly: the new fork-only files, plus `UserSidebar.svelte`, `UserPageLayout.svelte`, `NavigationBar.svelte`, `AppSettings.svelte`, `user-sidebar.spec.ts`, `user-page-layout.spec.ts`, `i18n/en.json`, and the new E2E spec. Any other upstream file in that list is a regression against the Global Constraints.

- [ ] **Step 5: Commit any fixes**

```bash
git add -A
git commit -m "chore(web): satisfy lint and type gates for the sidebar rail"
```

---

## Self-Review

**Spec coverage.** All 35 coverage items map to a task: 1, 2, 4, 5 → Task 2; 3, 6–14, 22, 23 → Task 6; 15–18, 24 → Task 3; 19 → Task 4; 20, 21 → Task 5; 25–30 → Task 8; 31 → Task 9; 32 → Task 7 Step 6; 33–35 → Task 10. Every spec section — state model, layout and widths, navbar column, custom-sidebar guard, hover-without-reflow, components, interaction, settings, i18n — has an implementing task.

**Deviations from the spec, all deliberate:**

1. Coverage item 32 is corrected: `user-sidebar.spec.ts` **must** change (Task 7). Only `Sidebar.spec.ts` stays untouched.
2. Two files are added beyond the spec's component list: `sidebar-media.svelte.ts` (a mockable media-query seam, without which the resolution matrix cannot be unit-tested) and `sidebar-nav-group.svelte` (keeps the divider branch out of `UserSidebar`).
3. Coverage item 3 is tested at the shell rather than the store, because clearing transient flags on layout change requires an `$effect`, which needs component context.
4. `UserPageLayout` drops its `sidebar:grid-cols-*` variants rather than layering a `var()` fallback over them. The spec left the Tailwind fallback spelling to be verified at implementation time; the explicit `style:--sidebar-width` with a plain `grid-cols-[var(--sidebar-width)_auto]` avoids the question entirely.
5. `Logo` gets a wrapper `<span>` carrying the test ids so `Logo.svelte` stays off the upstream-modified list.

**Type consistency.** `SidebarMode` / `SidebarLayout` / `SIDEBAR_MODES` / `sidebarMode` / `sidebarModeStore` / `sidebarMedia` are used identically in Tasks 1–9. `layout`, `hoverExpanded`, `railOverlayOpen`, `toggleRailOverlay()`, `resetTransient()` match their Task 2 definitions everywhere. Data attributes are consistent: `data-layout`, `data-expanded`, `data-slot-width`, `data-collapsed`, `data-active`, `data-sidebar-width`, `data-column`, `data-variant`, `data-hidden`.

**Placeholder scan.** No TBD/TODO and no conditionals. Every code step contains runnable code. Referenced files were verified to exist as described: `user-page-layout.spec.ts` exists (extended, not created), `navigation-bar.spec.ts` does not (created), and `web/` defines no `$routes` alias.

**API verification.** Checked against the installed `@immich/ui@0.83.0` rather than assumed: `focusTrap`'s `Options.active` exists; `Link` and `internal/Button` both spread `{...restProps}` onto their final element, so `data-active` / `data-collapsed` / `data-hidden` forward as the tests require; and `dist/index.d.ts:116` re-exports the type module, so `IconLike` and `IconProps` are importable from the package root.

**Review fixes folded in.** A prior review of this plan found ten defects, all corrected above:

1. Task 5's parity test compared translated titles, which under test are the literal key `storage_usage` for any input — it could never fail. Replaced with a table asserting `data-used` / `data-available` numerically, plus an unauthenticated case and the `quotaSizeInBytes: 0` subtlety.
2. Task 8's `NavigationBar` spec mocked two stores but the component pulls in five child components, `app.service`, and a network call on mount. Full mock set added.
3. Task 3 used `class:bg-primary--10`, which is not a real class — Svelte's `class:` directive cannot express `bg-primary/10`. Now composed into a class string.
4. Task 1's spec mocked all of `svelte/reactivity`, leaving `SvelteMap` / `SvelteSet` undefined for the import graph. Removed; `isWideSidebar` is covered via Task 2's seam mock and Task 10's real viewports.
5. Task 3 redeclared `IconLike` locally instead of importing it.
6. Task 3 used a raw `<a>` where upstream uses `@immich/ui`'s `Link`.
7. Task 7 Step 3 asserted an unverified failure message; it now directs the implementer to read the real output and confirm it fails for the right reason.
8. Coverage item 24 was mapped to Task 3 but had no test. Truncation test added.
9. Task 6's layout-change test relied on `rerender()` to flush an `$effect`; now uses `await tick()`, with a second test covering the stale-hover resurface case.
10. Task 3 carried dead logic in its `data-active` expression, and the intentional divergence from `sidebar-nav-item.stub.svelte` was undocumented. Both fixed.

---

## Post-implementation status

All 11 tasks implemented and reviewed. Full unit suite green (4184 passed), `tsc` and
`svelte-check` (584 files) clean, eslint 0 errors, prettier clean. Upstream footprint is exactly
the 7 permitted files; all 12 do-not-touch files are byte-untouched.

**Outstanding before merge — the four Playwright specs in
`e2e/src/ui/specs/sidebar/sidebar-rail.e2e-spec.ts` have never been executed.** They were written
and statically verified (every selector re-checked against source), but the only stack available
during implementation belonged to a concurrent session and was built from different code, so
running them would have been meaningless. They are the _only_ layer covering real CSS layout,
RTL, reduced motion, and the rail's actual geometry — happy-dom verifies none of these. Run them
against a stack built from this branch before merging.

Two items the final review flagged as needing a browser, deliberately not fixed blind:

- Rail icon centring. `sidebar-nav-item.svelte` keeps the 16rem row geometry (`gap-4 ps-5`) in
  rail, putting the icon centre at ~39px in a 64px rail while `rail-storage.svelte` centres at
  36px. Likely wants `justify-center` + `ps-0` when collapsed — confirm visually first.
- `sidebar-shell.svelte` uses `h-full` on the scroll container where upstream `Sidebar.svelte`
  used `h-max min-h-full`. Probably equivalent, but check a short viewport with both sub-trees
  expanded.
