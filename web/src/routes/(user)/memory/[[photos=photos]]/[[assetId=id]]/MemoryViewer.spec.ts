import { AssetTypeEnum, MemoryType, type MemoryResponseDto } from '@immich/sdk';
import '@testing-library/jest-dom';
import { fireEvent, render, screen, waitFor } from '@testing-library/svelte';
import type { Component } from 'svelte';
import TestWrapper from '$lib/components/TestWrapper.svelte';
import { findMemoryAsset } from '$lib/utils/memory-viewer-source';
import { assetFactory } from '@test-data/factories/asset-factory';
import MemoryViewer from './MemoryViewer.svelte';

const {
  mockAfterNavigate,
  mockAssetMultiSelectManager,
  mockAssetViewerManager,
  mockAuthManager,
  mockGetAssetInfo,
  mockGoto,
  mockMemoryManager,
  mockPage,
} = vi.hoisted(() => ({
  mockAfterNavigate: vi.fn(),
  mockAssetMultiSelectManager: {
    selectionActive: false,
    assets: [],
    clear: vi.fn(),
    isAllFavorite: false,
    isAllUserOwned: true,
    selectAssets: vi.fn(),
  },
  mockAssetViewerManager: {
    asset: undefined,
    isViewing: false,
    showAssetViewer: vi.fn(),
  },
  mockAuthManager: {
    params: {},
    preferences: { memories: { duration: 5 }, tags: { enabled: true } },
  },
  mockGetAssetInfo: vi.fn(),
  mockGoto: vi.fn(),
  mockMemoryManager: {
    memories: [] as MemoryResponseDto[],
    ready: vi.fn(),
    getMemoryAsset: vi.fn(),
    hideAssetsFromMemory: vi.fn(),
    deleteAssetFromMemory: vi.fn(),
    deleteMemory: vi.fn(),
    updateMemorySaved: vi.fn(),
  },
  mockPage: {
    url: new URL('https://gallery.test/memory/photos/memory-asset-1'),
    params: { assetId: 'memory-asset-1' } as { assetId?: string },
  },
}));

vi.mock('$app/navigation', () => ({
  afterNavigate: mockAfterNavigate,
  goto: mockGoto,
}));

vi.mock('$app/state', () => ({ page: mockPage }));

vi.mock('$lib/components/shared-components/context-menu/ButtonContextMenu.svelte', async () => {
  const { default: MockComponent } = await import('@test-data/mocks/noop-component.svelte');
  return { default: MockComponent };
});

vi.mock('$lib/components/shared-components/context-menu/menu-option.svelte', async () => {
  const { default: MockComponent } = await import('@test-data/mocks/noop-component.svelte');
  return { default: MockComponent };
});

vi.mock('$lib/components/shared-components/control-app-bar.svelte', async () => {
  const { default: MockComponent } = await import('@test-data/mocks/noop-component.svelte');
  return { default: MockComponent };
});

vi.mock('$lib/components/shared-components/gallery-viewer/GalleryViewer.svelte', async () => {
  const { default: MockComponent } = await import('@test-data/mocks/gallery-viewer-props.stub.svelte');
  return { default: MockComponent };
});

vi.mock('$lib/components/timeline/AssetSelectControlBar.svelte', async () => {
  const { default: MockComponent } = await import('@test-data/mocks/noop-component.svelte');
  return { default: MockComponent };
});

vi.mock('./memory-photo-viewer.svelte', async () => {
  const { default: MockComponent } = await import('@test-data/mocks/noop-component.svelte');
  return { default: MockComponent };
});

vi.mock('./memory-video-viewer.svelte', async () => {
  const { default: MockComponent } = await import('@test-data/mocks/noop-component.svelte');
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

vi.mock('$lib/managers/asset-multi-select-manager.svelte', () => ({
  assetMultiSelectManager: mockAssetMultiSelectManager,
}));

vi.mock('$lib/managers/asset-viewer-manager.svelte', () => ({
  assetViewerManager: mockAssetViewerManager,
}));

vi.mock('$lib/managers/auth-manager.svelte', () => ({
  authManager: mockAuthManager,
}));

vi.mock('$lib/managers/memory-manager.svelte', () => ({
  memoryManager: mockMemoryManager,
}));

vi.mock('$lib/services/asset.service', () => ({
  getAssetBulkActions: vi.fn(() => ({})),
}));

vi.mock('@immich/sdk', async () => {
  const actual = await vi.importActual<typeof import('@immich/sdk')>('@immich/sdk');
  return {
    ...actual,
    getAssetInfo: mockGetAssetInfo,
    deleteMemory: vi.fn(),
    removeMemoryAssets: vi.fn(),
    searchMemories: vi.fn(),
    updateMemory: vi.fn(),
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

/** A memory whose assets span several years, as an `on_this_day_place` card does. */
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

describe('MemoryViewer GalleryViewer grouping', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockPage.url = new URL('https://gallery.test/memory/photos/memory-asset-1');
    mockPage.params = { assetId: 'memory-asset-1' };
    mockMemoryManager.memories = [memory('memory-1', ['memory-asset-1', 'memory-asset-2'])];
    mockMemoryManager.ready.mockResolvedValue(undefined);
    mockMemoryManager.getMemoryAsset.mockImplementation((assetId: string | undefined) =>
      findMemoryAsset(mockMemoryManager.memories, assetId),
    );
    mockGetAssetInfo.mockResolvedValue(mockMemoryManager.memories[0].assets[0]);
    mockAfterNavigate.mockImplementation((callback) => {
      callback({ from: null, to: { params: mockPage.params, url: mockPage.url } });
    });
    vi.stubGlobal(
      'IntersectionObserver',
      class {
        observe = vi.fn();
        disconnect = vi.fn();
      },
    );
  });

  it('enables GalleryViewer grouping for the memory gallery strip', async () => {
    renderViewer();

    expect(await screen.findByTestId('gallery-viewer')).toHaveAttribute('data-enable-grouping', 'true');
  });
});

describe('MemoryViewer memory-scoped navigation (#790)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // the same asset appears in two memories (e.g. a birthday memory and an on-this-day memory)
    mockMemoryManager.memories = [memory('memory-1', ['dup-asset', 'm1-b']), memory('memory-2', ['dup-asset', 'm2-b'])];
    mockMemoryManager.ready.mockResolvedValue(undefined);
    mockMemoryManager.getMemoryAsset.mockImplementation((assetId: string | undefined, memoryId?: string) =>
      findMemoryAsset(mockMemoryManager.memories, assetId, memoryId),
    );
    mockGetAssetInfo.mockResolvedValue(mockMemoryManager.memories[0].assets[0]);
    mockPage.url = new URL('https://gallery.test/memory?id=dup-asset&memoryId=memory-2');
    mockPage.params = {};
    mockAfterNavigate.mockImplementation((callback) => {
      callback({ from: null, to: { params: mockPage.params, url: mockPage.url } });
    });
    vi.stubGlobal(
      'IntersectionObserver',
      class {
        observe = vi.fn();
        disconnect = vi.fn();
      },
    );
  });

  it('resolves the viewer position within the memory from the url', async () => {
    renderViewer();

    await waitFor(() => expect(mockMemoryManager.getMemoryAsset).toHaveBeenCalledWith('dup-asset', 'memory-2'));
  });

  it('links progress bar segments to assets scoped to the current memory', async () => {
    const { container } = renderViewer();

    await screen.findByTestId('gallery-viewer');
    await waitFor(() => {
      const hrefs = [...container.querySelectorAll('a[href^="/memory"]')].map((anchor) => anchor.getAttribute('href'));
      expect(hrefs.length).toBeGreaterThan(0);
      for (const href of hrefs) {
        expect(href).toContain('memoryId=memory-2');
      }
    });
  });
});

describe('MemoryViewer date overlay for a memory spanning years', () => {
  const memoryAssets = [
    { id: 'berlin-2021', localDateTime: '2021-08-26T13:48:33.000Z' },
    { id: 'berlin-2025', localDateTime: '2025-08-26T18:15:01.000Z' },
  ];
  // `current` is recomputed inside afterNavigate, so replaying this callback with a new url is
  // how the viewed asset changes in production — a fresh render cannot prove the overlay reacts.
  let navigated: (nav: { from: null; to: { params: object; url: URL } }) => void;

  const navigateTo = (url: string) => {
    mockPage.url = new URL(url);
    navigated({ from: null, to: { params: mockPage.params, url: mockPage.url } });
  };

  beforeEach(() => {
    vi.clearAllMocks();
    mockMemoryManager.memories = [multiYearMemory('memory-1', memoryAssets)];
    mockMemoryManager.ready.mockResolvedValue(undefined);
    mockMemoryManager.getMemoryAsset.mockImplementation((assetId: string | undefined, memoryId?: string) =>
      findMemoryAsset(mockMemoryManager.memories, assetId, memoryId),
    );
    mockGetAssetInfo.mockResolvedValue(mockMemoryManager.memories[0].assets[0]);
    mockPage.params = {};
    mockAfterNavigate.mockImplementation((callback) => {
      navigated = callback;
      callback({ from: null, to: { params: mockPage.params, url: mockPage.url } });
    });
    vi.stubGlobal(
      'IntersectionObserver',
      class {
        observe = vi.fn();
        disconnect = vi.fn();
      },
    );
  });

  it("shows the FIRST asset's date when it is the one being viewed", async () => {
    mockPage.url = new URL('https://gallery.test/memory?id=berlin-2021&memoryId=memory-1');

    renderViewer();

    expect(await screen.findByText(/August 26, 2021/)).toBeInTheDocument();
    expect(screen.queryByText(/August 26, 2025/)).not.toBeInTheDocument();
  });

  it("shows the SECOND asset's own date, not the memory's first asset", async () => {
    mockPage.url = new URL('https://gallery.test/memory?id=berlin-2025&memoryId=memory-1');

    renderViewer();

    expect(await screen.findByText(/August 26, 2025/)).toBeInTheDocument();
    expect(screen.queryByText(/August 26, 2021/)).not.toBeInTheDocument();
  });

  it('updates the date when paging from the 2021 photos into the 2025 ones', async () => {
    mockPage.url = new URL('https://gallery.test/memory?id=berlin-2021&memoryId=memory-1');
    renderViewer();
    expect(await screen.findByText(/August 26, 2021/)).toBeInTheDocument();

    navigateTo('https://gallery.test/memory?id=berlin-2025&memoryId=memory-1');

    expect(await screen.findByText(/August 26, 2025/)).toBeInTheDocument();
    await waitFor(() => expect(screen.queryByText(/August 26, 2021/)).not.toBeInTheDocument());
  });

  it('offers a next control that targets the asset in the other year', async () => {
    mockPage.url = new URL('https://gallery.test/memory?id=berlin-2021&memoryId=memory-1');

    renderViewer();

    // the overlay only tracks whatever `current` points at, so the forward control has to reach
    // the 2025 asset for the paging test above to reflect a real user path
    const next = await screen.findByLabelText('next_memory');
    expect(next).toBeInTheDocument();
    await fireEvent.click(next);
    await waitFor(() => expect(mockGoto).toHaveBeenCalled());
    expect(mockGoto.mock.calls.at(-1)?.[0]).toContain('berlin-2025');
  });
});

describe('MemoryViewer date overlay across a memory boundary', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockMemoryManager.memories = [
      multiYearMemory('memory-1', [
        { id: 'paris-a', localDateTime: '2019-03-14T10:00:00.000Z' },
        { id: 'paris-b', localDateTime: '2019-03-14T11:00:00.000Z' },
      ]),
      multiYearMemory('memory-2', [
        { id: 'berlin-2021', localDateTime: '2021-08-26T13:48:33.000Z' },
        { id: 'berlin-2025', localDateTime: '2025-08-26T18:15:01.000Z' },
      ]),
    ];
    mockMemoryManager.ready.mockResolvedValue(undefined);
    mockMemoryManager.getMemoryAsset.mockImplementation((assetId: string | undefined, memoryId?: string) =>
      findMemoryAsset(mockMemoryManager.memories, assetId, memoryId),
    );
    mockGetAssetInfo.mockResolvedValue(mockMemoryManager.memories[0].assets[0]);
    mockPage.params = {};
    mockAfterNavigate.mockImplementation((callback) => {
      callback({ from: null, to: { params: mockPage.params, url: mockPage.url } });
    });
    vi.stubGlobal(
      'IntersectionObserver',
      class {
        observe = vi.fn();
        disconnect = vi.fn();
      },
    );
  });

  it("indexes within the current memory, not across the whole viewer's assets", async () => {
    // berlin-2025 is asset 1 of memory-2, but asset 3 counting from the start of the viewer.
    // Reading [0] gives 2021; reading a viewer-wide index would run off the end of memory-2.
    mockPage.url = new URL('https://gallery.test/memory?id=berlin-2025&memoryId=memory-2');

    renderViewer();

    expect(await screen.findByText(/August 26, 2025/)).toBeInTheDocument();
    expect(screen.queryByText(/August 26, 2021/)).not.toBeInTheDocument();
    expect(screen.queryByText(/March 14, 2019/)).not.toBeInTheDocument();
  });
});
