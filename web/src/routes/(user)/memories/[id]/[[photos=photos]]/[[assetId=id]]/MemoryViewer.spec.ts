import { AssetTypeEnum, MemoryType, type MemoryResponseDto } from '@immich/sdk';
import '@testing-library/jest-dom';
import { render, screen, waitFor } from '@testing-library/svelte';
import type { Component } from 'svelte';
import TestWrapper from '$lib/components/TestWrapper.svelte';
import { memoryManager } from '$lib/managers/memory-manager.svelte';
import { assetFactory } from '@test-data/factories/asset-factory';
import { reactivePageMock as mockPage } from '@test-data/mocks/reactive-page.mock.svelte';
import MemoryViewer from './MemoryViewer.svelte';

// Ported from the fork's #790/#791 regression suite (deleted with the fork's own memory viewer,
// which the upstream route restructure replaces). Upstream scopes the viewer to one memory via
// `page.params.id` (see memory-manager.svelte.ts `#url`/`current`) instead of the fork's
// `memoryId` query param, so the fix is now structural. `memoryManager` is deliberately NOT
// mocked here: only its real lookup logic (keyed first by `page.params.id`, then narrowed to that
// memory's own assets) can prove the scoping still holds. Mocking `current` by hand would just
// assert whatever the test wrote into the mock.
const { mockAssetMultiSelectManager, mockAssetViewerManager, mockAuthManager, mockGetAssetInfo } = vi.hoisted(() => ({
  mockAssetMultiSelectManager: {
    selectionActive: false,
    assets: [],
    clear: vi.fn(),
    isAllFavorite: false,
    isAllArchived: false,
    isAllUserOwned: true,
    selectAssets: vi.fn(),
  },
  mockAssetViewerManager: {
    asset: undefined,
    isViewing: false,
    showAssetViewer: vi.fn(),
  },
  mockAuthManager: {
    // false so the real memoryManager singleton's constructor does not auto-`initialize()`
    // (which would call the real, unmocked `searchMemories`/`memoriesStatistics`).
    authenticated: false,
    params: {},
    preferences: { memories: { duration: 5 }, tags: { enabled: true } },
  },
  mockGetAssetInfo: vi.fn(),
}));

vi.mock('$app/navigation', () => ({ goto: vi.fn() }));

// A REACTIVE stand-in for $app/state's `page` -- memoryManager's `current` is `$derived.by(...)`
// off `page.params.id` / `page.url.searchParams`, so a non-reactive plain object would not
// re-trigger that derivation when a test reassigns `mockPage.params`/`mockPage.url`.
vi.mock('$app/state', async () => {
  const { reactivePageMock } = await import('@test-data/mocks/reactive-page.mock.svelte');
  return { page: reactivePageMock };
});

vi.mock('$lib/components/shared-components/context-menu/ButtonContextMenu.svelte', async () => {
  const { default: MockComponent } = await import('@test-data/mocks/noop-component.svelte');
  return { default: MockComponent };
});

vi.mock('$lib/components/shared-components/context-menu/MenuOption.svelte', async () => {
  const { default: MockComponent } = await import('@test-data/mocks/noop-component.svelte');
  return { default: MockComponent };
});

vi.mock('$lib/components/shared-components/gallery-viewer/GalleryViewer.svelte', async () => {
  const { default: MockComponent } = await import('@test-data/mocks/gallery-viewer-props.stub.svelte');
  return { default: MockComponent };
});

vi.mock('$lib/components/timeline/actions/ArchiveAction.svelte', async () => {
  const { default: MockComponent } = await import('@test-data/mocks/noop-component.svelte');
  return { default: MockComponent };
});

vi.mock('$lib/components/timeline/actions/ChangeDateAction.svelte', async () => {
  const { default: MockComponent } = await import('@test-data/mocks/noop-component.svelte');
  return { default: MockComponent };
});

vi.mock('$lib/components/timeline/actions/ChangeDescriptionAction.svelte', async () => {
  const { default: MockComponent } = await import('@test-data/mocks/noop-component.svelte');
  return { default: MockComponent };
});

vi.mock('$lib/components/timeline/actions/ChangeLocationAction.svelte', async () => {
  const { default: MockComponent } = await import('@test-data/mocks/noop-component.svelte');
  return { default: MockComponent };
});

vi.mock('$lib/components/timeline/actions/CreateSharedLinkAction.svelte', async () => {
  const { default: MockComponent } = await import('@test-data/mocks/noop-component.svelte');
  return { default: MockComponent };
});

vi.mock('$lib/components/timeline/actions/DeleteAssetsAction.svelte', async () => {
  const { default: MockComponent } = await import('@test-data/mocks/noop-component.svelte');
  return { default: MockComponent };
});

vi.mock('$lib/components/timeline/actions/DownloadAction.svelte', async () => {
  const { default: MockComponent } = await import('@test-data/mocks/noop-component.svelte');
  return { default: MockComponent };
});

vi.mock('$lib/components/timeline/actions/FavoriteAction.svelte', async () => {
  const { default: MockComponent } = await import('@test-data/mocks/noop-component.svelte');
  return { default: MockComponent };
});

vi.mock('$lib/components/timeline/actions/TagAction.svelte', async () => {
  const { default: MockComponent } = await import('@test-data/mocks/noop-component.svelte');
  return { default: MockComponent };
});

vi.mock('$lib/components/timeline/AssetSelectControlBar.svelte', async () => {
  const { default: MockComponent } = await import('@test-data/mocks/noop-component.svelte');
  return { default: MockComponent };
});

vi.mock('./MemoryPhotoViewer.svelte', async () => {
  const { default: MockComponent } = await import('@test-data/mocks/noop-component.svelte');
  return { default: MockComponent };
});

vi.mock('./MemoryVideoViewer.svelte', async () => {
  const { default: MockComponent } = await import('@test-data/mocks/noop-component.svelte');
  return { default: MockComponent };
});

vi.mock('$lib/managers/asset-multi-select-manager.svelte', () => ({
  assetMultiSelectManager: mockAssetMultiSelectManager,
}));

vi.mock('$lib/managers/asset-viewer-manager.svelte', () => ({
  assetViewerManager: mockAssetViewerManager,
}));

vi.mock('$lib/managers/auth-manager.svelte', () => ({
  authManager: mockAuthManager,
}));

// $lib/managers/memory-manager.svelte is intentionally left unmocked -- see the comment above.

vi.mock('$lib/services/asset.service', () => ({
  getAssetBulkActions: vi.fn(() => ({})),
}));

vi.mock('@immich/sdk', async () => {
  const actual = await vi.importActual<typeof import('@immich/sdk')>('@immich/sdk');
  return {
    ...actual,
    getAssetInfo: mockGetAssetInfo,
  };
});

function memory(id: string, assetIds: string[]): MemoryResponseDto {
  return {
    id,
    assets: assetIds.map((assetId) =>
      assetFactory.build({
        id: assetId,
        type: AssetTypeEnum.Image,
        localDateTime: '2015-08-03T00:00:00.000Z',
        fileCreatedAt: '2015-08-03T00:00:00.000Z',
      }),
    ),
    createdAt: '2020-01-01T00:00:00.000Z',
    updatedAt: '2020-01-01T00:00:00.000Z',
    deletedAt: undefined,
    ownerId: 'user-1',
    type: MemoryType.OnThisDay,
    data: { year: 2015 },
    isSaved: false,
    memoryAt: '2020-01-01T00:00:00.000Z',
    seenAt: undefined,
    showAt: '2020-01-01T00:00:00.000Z',
    hideAt: undefined,
  };
}

/**
 * A memory whose assets span several years, as an `on_this_day_place` card does. The plain
 * `memory()` helper above dates every asset the same day, which cannot distinguish "the memory's
 * first asset" from "the asset being viewed".
 */
function multiYearMemory(id: string, assets: { id: string; localDateTime: string }[]): MemoryResponseDto {
  return {
    ...memory(
      id,
      assets.map(({ id }) => id),
    ),
    assets: assets.map(({ id, localDateTime }) =>
      assetFactory.build({ id, type: AssetTypeEnum.Image, localDateTime, fileCreatedAt: localDateTime }),
    ),
    type: MemoryType.Rule,
    data: { ruleId: 'on_this_day_place', title: 'On this day in Berlin', context: { years: [2021, 2025] } },
  };
}

function renderViewer() {
  return render(TestWrapper as Component<{ component: typeof MemoryViewer; componentProps: Record<string, never> }>, {
    component: MemoryViewer,
    componentProps: {},
  });
}

describe('MemoryViewer memory-scoped navigation (#790)', () => {
  beforeEach(() => {
    // The same asset id appears in two memories (e.g. a birthday memory and an on-this-day
    // memory). This duplication is the only reason memory-scoped navigation is observable at
    // all -- without it, any implementation (correct or regressed) resolves the same way.
    memoryManager.memories = [
      memory('memory-1', ['dup-asset', 'm1-only']),
      memory('memory-2', ['dup-asset', 'm2-only']),
    ];

    // Route param names the memory; the query param names the asset within it -- upstream's
    // actual URL shape (Route.viewMemory -> `/memories/<id>?assetId=<assetId>`), not the fork's
    // `/memory?id=...&memoryId=...`.
    mockPage.reset('https://gallery.test/memories/memory-2?assetId=dup-asset', {
      routeId: '/(user)/memories/[id]/[[photos=photos]]/[[assetId=id]]',
      params: { id: 'memory-2' },
    });

    mockGetAssetInfo.mockResolvedValue(memoryManager.memories[1].assets[0]);

    vi.stubGlobal(
      'IntersectionObserver',
      class {
        observe = vi.fn();
        disconnect = vi.fn();
      },
    );
  });

  it('resolves the viewer position within the memory from the url', async () => {
    const { container } = renderViewer();

    const galleryViewer = await screen.findByTestId('gallery-viewer');

    // `current.memory.assets` (memoryManager.current, real derivation) feeds the gallery strip.
    // If the url ever resolved `dup-asset` against the wrong memory -- e.g. a regression back to
    // a global assetId lookup that ignores the memoryId route param -- this would show memory-1's
    // assets instead.
    expect(container.querySelector('[data-testid="asset-row-m2-only"]')).toBeInTheDocument();
    expect(container.querySelector('[data-testid="asset-row-m1-only"]')).not.toBeInTheDocument();
    expect(galleryViewer).toHaveAttribute('data-asset-count', '2');
  });

  // Fork feature #625 (asset grouping in the gallery viewer). Upstream's viewer does not pass
  // `enableGrouping`, so the prop defaults to `false` and the grouping headers silently vanish
  // whenever this fork delta is dropped during a rebase. Asserting on the stub's
  // `data-enable-grouping` attribute makes that loss loud instead of silent.
  it('enables asset grouping on the memory gallery strip (#625)', async () => {
    renderViewer();

    const galleryViewer = await screen.findByTestId('gallery-viewer');

    expect(galleryViewer).toHaveAttribute('data-enable-grouping', 'true');
  });

  it('links progress bar segments to assets scoped to the current memory', async () => {
    const { container } = renderViewer();

    await screen.findByTestId('gallery-viewer');

    // The progress-bar segments (one `<a class="relative grow py-2">` per asset in
    // `current.memory.assets`) are built from `current.getAssetHref`, which always routes through
    // `Route.viewMemory({ id: memory.id, ... })` for the CURRENT memory -- distinct from the
    // previous/next-memory cards, which legitimately link to an adjacent memory.
    const hrefs = [...container.querySelectorAll('a.grow.py-2')].map((anchor) => anchor.getAttribute('href'));

    expect(hrefs.length).toBeGreaterThan(0);
    for (const href of hrefs) {
      expect(href).toMatch(/^\/memories\/memory-2(\?|$)/);
    }
  });
});

// Ported from the fork's #1029 regression suite, which was written against the fork's own memory
// viewer (deleted with `memory-viewer-source.ts`). The bug it guards is live on the adopted
// upstream viewer too: the date overlay used to read `current.memory.assets[0]`, so every asset in
// a memory showed the FIRST asset's date. That is invisible for an `on_this_day` memory (one year,
// one date) and wrong for an `on_this_day_place` memory, which covers every year the place recurs.
//
// `assetIndex` must stay memory-relative for the fix to hold -- memory-manager builds
// `assetIndexes` per memory (`memory.assets.map((asset, assetIndex) => ...)`), so an index across
// the concatenated viewer list would read another memory's asset or run off the end.
describe('MemoryViewer date overlay for a memory spanning years (#1029)', () => {
  const berlin = [
    { id: 'berlin-2021', localDateTime: '2021-08-26T13:48:33.000Z' },
    { id: 'berlin-2025', localDateTime: '2025-08-26T18:15:01.000Z' },
  ];

  const viewAsset = (memoryId: string, assetId: string) =>
    mockPage.reset(`https://gallery.test/memories/${memoryId}?assetId=${assetId}`, {
      routeId: '/(user)/memories/[id]/[[photos=photos]]/[[assetId=id]]',
      params: { id: memoryId },
    });

  beforeEach(() => {
    memoryManager.memories = [multiYearMemory('memory-1', berlin)];
    mockGetAssetInfo.mockResolvedValue(memoryManager.memories[0].assets[0]);

    vi.stubGlobal(
      'IntersectionObserver',
      class {
        observe = vi.fn();
        disconnect = vi.fn();
      },
    );
  });

  it("shows the FIRST asset's date when it is the one being viewed", async () => {
    viewAsset('memory-1', 'berlin-2021');

    renderViewer();

    expect(await screen.findByText(/August 26, 2021/)).toBeInTheDocument();
    expect(screen.queryByText(/August 26, 2025/)).not.toBeInTheDocument();
  });

  it("shows the SECOND asset's own date, not the memory's first", async () => {
    viewAsset('memory-1', 'berlin-2025');

    renderViewer();

    expect(await screen.findByText(/August 26, 2025/)).toBeInTheDocument();
    expect(screen.queryByText(/August 26, 2021/)).not.toBeInTheDocument();
  });

  // `current` is `$derived.by()` off the reactive page mock, so reassigning the url is how the
  // viewed asset changes in production. A fresh render cannot prove the overlay reacts.
  it('updates the date when paging from the 2021 photo into the 2025 one', async () => {
    viewAsset('memory-1', 'berlin-2021');
    renderViewer();
    expect(await screen.findByText(/August 26, 2021/)).toBeInTheDocument();

    viewAsset('memory-1', 'berlin-2025');

    expect(await screen.findByText(/August 26, 2025/)).toBeInTheDocument();
    await waitFor(() => expect(screen.queryByText(/August 26, 2021/)).not.toBeInTheDocument());
  });

  it('indexes within the current memory, not across the whole viewer', async () => {
    // berlin-2025 is asset 1 of memory-2, but asset 3 counting from the start of the viewer.
    // Reading [0] gives 2021; a viewer-wide index would run off the end of memory-2.
    memoryManager.memories = [
      multiYearMemory('memory-1', [
        { id: 'paris-a', localDateTime: '2019-03-14T10:00:00.000Z' },
        { id: 'paris-b', localDateTime: '2019-03-14T11:00:00.000Z' },
      ]),
      multiYearMemory('memory-2', berlin),
    ];
    viewAsset('memory-2', 'berlin-2025');

    renderViewer();

    expect(await screen.findByText(/August 26, 2025/)).toBeInTheDocument();
    expect(screen.queryByText(/August 26, 2021/)).not.toBeInTheDocument();
    expect(screen.queryByText(/March 14, 2019/)).not.toBeInTheDocument();
  });
});
