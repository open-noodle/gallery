import { SharedLinkType, type SharedLinkResponseDto } from '@immich/sdk';
import '@testing-library/jest-dom';
import { render, screen, waitFor } from '@testing-library/svelte';
import type { Component } from 'svelte';
import TestWrapper from '$lib/components/TestWrapper.svelte';
import { assetFactory } from '@test-data/factories/asset-factory';
import { sharedLinkFactory } from '@test-data/factories/shared-link-factory';
import IndividualSharedViewer from './IndividualSharedViewer.svelte';

const { mockAssetMultiSelectManager, mockAuthManager, mockGetAssetInfo } = vi.hoisted(() => ({
  mockAssetMultiSelectManager: {
    selectionActive: false,
    assets: [],
    clear: vi.fn(),
    isAllFavorite: false,
    isAllUserOwned: true,
    selectAssets: vi.fn(),
  },
  mockAuthManager: {
    params: {},
  },
  mockGetAssetInfo: vi.fn(),
}));

vi.mock('$app/navigation', () => ({
  goto: vi.fn(),
}));

vi.mock('$lib/components/asset-viewer/asset-viewer.svelte', async () => {
  const { default: MockComponent } = await import('@test-data/mocks/noop-component.svelte');
  return { default: MockComponent };
});

vi.mock('$lib/components/shared-components/Logo.svelte', async () => {
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

vi.mock('$lib/components/timeline/actions/DownloadAction.svelte', async () => {
  const { default: MockComponent } = await import('@test-data/mocks/noop-component.svelte');
  return { default: MockComponent };
});

vi.mock('$lib/components/timeline/actions/RemoveFromSharedLinkAction.svelte', async () => {
  const { default: MockComponent } = await import('@test-data/mocks/noop-component.svelte');
  return { default: MockComponent };
});

vi.mock('$lib/managers/asset-multi-select-manager.svelte', () => ({
  assetMultiSelectManager: mockAssetMultiSelectManager,
}));

vi.mock('$lib/managers/auth-manager.svelte', () => ({
  authManager: mockAuthManager,
}));

vi.mock('$lib/stores/media-query-manager.svelte', () => ({
  mediaQueryManager: { maxMd: false },
}));

vi.mock('$lib/utils/asset-utils', () => ({
  downloadArchive: vi.fn(),
}));

vi.mock('$lib/utils/file-uploader', () => ({
  fileUploadHandler: vi.fn(),
  openFileUploadDialog: vi.fn(),
}));

vi.mock('$lib/utils/timeline-util', () => ({
  toTimelineAsset: vi.fn((asset) => asset),
}));

vi.mock('@immich/sdk', async () => {
  const actual = await vi.importActual<typeof import('@immich/sdk')>('@immich/sdk');
  return {
    ...actual,
    getAssetInfo: mockGetAssetInfo,
  };
});

function renderViewer(sharedLinkOverrides: Partial<SharedLinkResponseDto>) {
  const props = {
    sharedLink: sharedLinkFactory.build({
      type: SharedLinkType.Individual,
      allowUpload: false,
      allowDownload: false,
      assets: [],
      ...sharedLinkOverrides,
    }),
    isOwned: false,
  };

  return render(TestWrapper as Component<{ component: typeof IndividualSharedViewer; componentProps: typeof props }>, {
    component: IndividualSharedViewer,
    componentProps: props,
  });
}

describe('IndividualSharedViewer GalleryViewer grouping', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockAssetMultiSelectManager.selectionActive = false;
    mockAssetMultiSelectManager.assets = [];
    mockGetAssetInfo.mockResolvedValue(assetFactory.build({ id: 'single-asset' }));
  });

  it('enables GalleryViewer grouping for multi-asset shared views', () => {
    renderViewer({
      assets: [assetFactory.build({ id: 'shared-1' }), assetFactory.build({ id: 'shared-2' })],
      allowDownload: true,
    });

    expect(screen.getByTestId('gallery-viewer')).toHaveAttribute('data-enable-grouping', 'true');
  });

  it('keeps the existing single-asset shared-link viewer path out of GalleryViewer grouping', async () => {
    renderViewer({ assets: [assetFactory.build({ id: 'single-asset' })], allowUpload: false });

    await waitFor(() => expect(mockGetAssetInfo).toHaveBeenCalledWith({ id: 'single-asset' }));
    expect(screen.queryByTestId('gallery-viewer')).not.toBeInTheDocument();
  });
});
