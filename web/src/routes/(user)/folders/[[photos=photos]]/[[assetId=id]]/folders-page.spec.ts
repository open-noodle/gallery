import '@testing-library/jest-dom';
import { render, screen } from '@testing-library/svelte';
import type { Component } from 'svelte';
import TestWrapper from '$lib/components/TestWrapper.svelte';
import { TreeNode } from '$lib/utils/tree-utils';
import { assetFactory } from '@test-data/factories/asset-factory';
import FoldersPage from './+page.svelte';

const { mockAfterNavigate, mockAssetMultiSelectManager, mockAuthManager, mockFoldersStore } = vi.hoisted(() => ({
  mockAfterNavigate: vi.fn(),
  mockAssetMultiSelectManager: {
    selectionActive: false,
    assets: [],
    clear: vi.fn(),
    isAllArchived: false,
    isAllFavorite: false,
    isAllUserOwned: true,
    selectAssets: vi.fn(),
  },
  mockAuthManager: {
    preferences: { tags: { enabled: true } },
  },
  mockFoldersStore: {
    folders: undefined as unknown,
    refreshAssetsByPath: vi.fn(),
  },
}));

vi.mock('$app/navigation', () => ({
  afterNavigate: mockAfterNavigate,
  goto: vi.fn(),
  invalidateAll: vi.fn(),
}));

vi.mock('$lib/components/ActionMenuItem.svelte', async () => {
  const { default: MockComponent } = await import('@test-data/mocks/noop-component.svelte');
  return { default: MockComponent };
});

vi.mock('$lib/components/layouts/UserPageLayout.svelte', async () => {
  const { default: MockComponent } = await import('$lib/components/spaces/mock-user-page-layout.test-wrapper.svelte');
  return { default: MockComponent, headerId: 'mock-header' };
});

vi.mock('$lib/components/shared-components/context-menu/ButtonContextMenu.svelte', async () => {
  const { default: MockComponent } = await import('@test-data/mocks/noop-component.svelte');
  return { default: MockComponent };
});

vi.mock('$lib/components/shared-components/gallery-viewer/GalleryViewer.svelte', async () => {
  const { default: MockComponent } = await import('@test-data/mocks/gallery-viewer-props.stub.svelte');
  return { default: MockComponent };
});

vi.mock('$lib/components/shared-components/tree/breadcrumbs.svelte', async () => {
  const { default: MockComponent } = await import('@test-data/mocks/noop-component.svelte');
  return { default: MockComponent };
});

vi.mock('$lib/components/shared-components/tree/TreeItemThumbnails.svelte', async () => {
  const { default: MockComponent } = await import('@test-data/mocks/noop-component.svelte');
  return { default: MockComponent };
});

vi.mock('$lib/components/shared-components/tree/TreeItems.svelte', async () => {
  const { default: MockComponent } = await import('@test-data/mocks/noop-component.svelte');
  return { default: MockComponent };
});

vi.mock('$lib/components/sidebar/sidebar.svelte', async () => {
  const { default: MockComponent } = await import('@test-data/mocks/noop-component.svelte');
  return { default: MockComponent };
});

vi.mock('$lib/components/timeline/AssetSelectControlBar.svelte', async () => {
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

vi.mock('$lib/components/timeline/actions/RotateAction.svelte', async () => {
  const { default: MockComponent } = await import('@test-data/mocks/noop-component.svelte');
  return { default: MockComponent };
});

vi.mock('$lib/components/timeline/actions/SetVisibilityAction.svelte', async () => {
  const { default: MockComponent } = await import('@test-data/mocks/noop-component.svelte');
  return { default: MockComponent };
});

vi.mock('$lib/components/timeline/actions/TagAction.svelte', async () => {
  const { default: MockComponent } = await import('@test-data/mocks/noop-component.svelte');
  return { default: MockComponent };
});

vi.mock('$lib/elements/SkipLink.svelte', async () => {
  const { default: MockComponent } = await import('@test-data/mocks/noop-component.svelte');
  return { default: MockComponent };
});

vi.mock('$lib/managers/asset-multi-select-manager.svelte', () => ({
  assetMultiSelectManager: mockAssetMultiSelectManager,
}));

vi.mock('$lib/managers/auth-manager.svelte', () => ({ authManager: mockAuthManager }));

vi.mock('$lib/services/asset.service', () => ({
  getAssetBulkActions: vi.fn(() => ({})),
}));

vi.mock('$lib/stores/folders.svelte', () => ({
  foldersStore: mockFoldersStore,
}));

vi.mock('$lib/utils/timeline-util', () => ({
  toTimelineAsset: vi.fn((asset) => asset),
}));

function renderPage() {
  const root = TreeNode.fromPaths(['Trips']);
  const tree = root.traverse('Trips');
  mockFoldersStore.folders = root;

  const props = {
    data: {
      meta: { title: 'Trips' },
      tree,
      pathAssets: [assetFactory.build({ id: 'folder-asset-1' })],
    },
  };

  return render(TestWrapper as Component<{ component: typeof FoldersPage; componentProps: typeof props }>, {
    component: FoldersPage,
    componentProps: props,
  });
}

describe('Folders page GalleryViewer grouping', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockAssetMultiSelectManager.selectionActive = false;
    mockAssetMultiSelectManager.assets = [];
  });

  it('enables GalleryViewer grouping for folder asset grids', () => {
    renderPage();

    expect(screen.getByTestId('gallery-viewer')).toHaveAttribute('data-enable-grouping', 'true');
  });
});
