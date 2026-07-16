import { AssetTypeEnum, MemoryType, type MemoryResponseDto } from '@immich/sdk';
import '@testing-library/jest-dom';
import { render, screen, waitFor } from '@testing-library/svelte';
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
  goto: vi.fn(),
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
