import TestWrapper from '#lib/components/TestWrapper.svelte';
import { queryClient } from '#lib/queries/client.ts';
import { getUniqueOriginalPathsQuery } from '#lib/queries/view.query.ts';
import { TreeNode } from '#lib/utils/tree-utils.ts';
import { factory } from '#test/common/factories.ts';
import type { Component } from 'svelte';
import { render } from 'vitest-browser-svelte';
import { page } from 'vitest/browser';
import FoldersPage from './+page.svelte';

const { mockAssetMultiSelectManager, mockAuthManager } = vi.hoisted(() => ({
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
}));

vi.mock('#lib/components/ActionMenuItem.svelte', async () => {
  const { default: MockComponent } = await import('#lib/gallery/__mocks__/noop-component.svelte');
  return { default: MockComponent };
});

vi.mock('#lib/components/layouts/UserPageLayout.svelte', async () => {
  const { default: MockComponent } = await import('#lib/components/spaces/mock-user-page-layout.test-wrapper.svelte');
  return { default: MockComponent, headerId: 'mock-header' };
});

vi.mock('#lib/components/shared-components/context-menu/ButtonContextMenu.svelte', async () => {
  const { default: MockComponent } = await import('#lib/gallery/__mocks__/noop-component.svelte');
  return { default: MockComponent };
});

vi.mock('#lib/components/shared-components/gallery-viewer/GalleryViewer.svelte', async () => {
  const { default: MockComponent } = await import('#lib/gallery/__mocks__/gallery-viewer-props.stub.svelte');
  return { default: MockComponent };
});

vi.mock('#lib/components/shared-components/tree/breadcrumbs.svelte', async () => {
  const { default: MockComponent } = await import('#lib/gallery/__mocks__/noop-component.svelte');
  return { default: MockComponent };
});

vi.mock('#lib/components/shared-components/tree/TreeItemThumbnails.svelte', async () => {
  const { default: MockComponent } = await import('#lib/gallery/__mocks__/noop-component.svelte');
  return { default: MockComponent };
});

vi.mock('#lib/components/shared-components/tree/TreeItems.svelte', async () => {
  const { default: MockComponent } = await import('#lib/gallery/__mocks__/noop-component.svelte');
  return { default: MockComponent };
});

vi.mock('#lib/components/sidebar/sidebar.svelte', async () => {
  const { default: MockComponent } = await import('#lib/gallery/__mocks__/noop-component.svelte');
  return { default: MockComponent };
});

vi.mock('#lib/components/timeline/AssetSelectControlBar.svelte', async () => {
  const { default: MockComponent } = await import('#lib/gallery/__mocks__/noop-component.svelte');
  return { default: MockComponent };
});

vi.mock('#lib/gallery/actions/ArchiveAction.svelte', async () => {
  const { default: MockComponent } = await import('#lib/gallery/__mocks__/noop-component.svelte');
  return { default: MockComponent };
});

vi.mock('#lib/components/timeline/actions/ChangeDateAction.svelte', async () => {
  const { default: MockComponent } = await import('#lib/gallery/__mocks__/noop-component.svelte');
  return { default: MockComponent };
});

vi.mock('#lib/components/timeline/actions/ChangeDescriptionAction.svelte', async () => {
  const { default: MockComponent } = await import('#lib/gallery/__mocks__/noop-component.svelte');
  return { default: MockComponent };
});

vi.mock('#lib/components/timeline/actions/ChangeLocationAction.svelte', async () => {
  const { default: MockComponent } = await import('#lib/gallery/__mocks__/noop-component.svelte');
  return { default: MockComponent };
});

vi.mock('#lib/components/timeline/actions/DeleteAssetsAction.svelte', async () => {
  const { default: MockComponent } = await import('#lib/gallery/__mocks__/noop-component.svelte');
  return { default: MockComponent };
});

vi.mock('#lib/components/timeline/actions/DownloadAction.svelte', async () => {
  const { default: MockComponent } = await import('#lib/gallery/__mocks__/noop-component.svelte');
  return { default: MockComponent };
});

vi.mock('#lib/components/timeline/actions/FavoriteAction.svelte', async () => {
  const { default: MockComponent } = await import('#lib/gallery/__mocks__/noop-component.svelte');
  return { default: MockComponent };
});

vi.mock('#lib/components/timeline/actions/RotateAction.svelte', async () => {
  const { default: MockComponent } = await import('#lib/gallery/__mocks__/noop-component.svelte');
  return { default: MockComponent };
});

vi.mock('#lib/components/timeline/actions/SetVisibilityAction.svelte', async () => {
  const { default: MockComponent } = await import('#lib/gallery/__mocks__/noop-component.svelte');
  return { default: MockComponent };
});

vi.mock('#lib/components/timeline/actions/TagAction.svelte', async () => {
  const { default: MockComponent } = await import('#lib/gallery/__mocks__/noop-component.svelte');
  return { default: MockComponent };
});

vi.mock('#lib/elements/SkipLink.svelte', async () => {
  const { default: MockComponent } = await import('#lib/gallery/__mocks__/noop-component.svelte');
  return { default: MockComponent };
});

vi.mock('#lib/managers/asset-multi-select-manager.svelte.js', () => ({
  assetMultiSelectManager: mockAssetMultiSelectManager,
}));

vi.mock('#lib/managers/auth-manager.svelte.js', () => ({ authManager: mockAuthManager }));

vi.mock('#lib/services/asset.service.js', () => ({
  getAssetBulkActions: vi.fn(() => ({})),
}));

function renderPage() {
  // The folder tree is a preloaded query since immich-32667 (getFolderTreeQuery).
  queryClient.setQueryData(getUniqueOriginalPathsQuery().queryKey, ['Trips']);
  const tree = TreeNode.fromPaths(['Trips']).traverse('Trips');

  const props = {
    data: {
      meta: { title: 'Trips' },
      tree,
      pathAssets: [factory.asset({ id: 'folder-asset-1' })],
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

  it('enables GalleryViewer grouping for folder asset grids', async () => {
    await renderPage();

    await expect.element(page.getByTestId('gallery-viewer')).toHaveAttribute('data-enable-grouping', 'true');
  });
});
