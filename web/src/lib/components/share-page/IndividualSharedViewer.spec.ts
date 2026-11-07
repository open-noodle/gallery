import TestWrapper from '#lib/components/TestWrapper.svelte';
import { factory } from '#test/unit/factories.ts';
import { SharedLinkType, type SharedLinkResponseDto } from '@immich/sdk';
import type { Component } from 'svelte';
import { expect } from 'vitest';
import { render } from 'vitest-browser-svelte';
import { page } from 'vitest/browser';
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

vi.mock('$app/navigation', async () => ({
  ...(await import('#test/unit/mocks/app-navigation.ts')),
  goto: vi.fn(),
}));

vi.mock('#lib/components/asset-viewer/asset-viewer.svelte', async () => {
  const { default: MockComponent } = await import('#lib/gallery/__mocks__/noop-component.svelte');
  return { default: MockComponent };
});

vi.mock('#lib/components/shared-components/Logo.svelte', async () => {
  const { default: MockComponent } = await import('#lib/gallery/__mocks__/noop-component.svelte');
  return { default: MockComponent };
});

vi.mock('#lib/components/shared-components/control-app-bar.svelte', async () => {
  const { default: MockComponent } = await import('#lib/gallery/__mocks__/noop-component.svelte');
  return { default: MockComponent };
});

vi.mock('#lib/components/shared-components/gallery-viewer/GalleryViewer.svelte', async () => {
  const { default: MockComponent } = await import('#lib/gallery/__mocks__/gallery-viewer-props.stub.svelte');
  return { default: MockComponent };
});

vi.mock('#lib/components/timeline/AssetSelectControlBar.svelte', async () => {
  const { default: MockComponent } = await import('#lib/gallery/__mocks__/noop-component.svelte');
  return { default: MockComponent };
});

vi.mock('#lib/components/timeline/actions/DownloadAction.svelte', async () => {
  const { default: MockComponent } = await import('#lib/gallery/__mocks__/noop-component.svelte');
  return { default: MockComponent };
});

vi.mock('#lib/components/timeline/actions/RemoveFromSharedLinkAction.svelte', async () => {
  const { default: MockComponent } = await import('#lib/gallery/__mocks__/noop-component.svelte');
  return { default: MockComponent };
});

vi.mock('#lib/managers/asset-multi-select-manager.svelte.js', () => ({
  assetMultiSelectManager: mockAssetMultiSelectManager,
}));

vi.mock('#lib/managers/auth-manager.svelte.js', () => ({
  authManager: mockAuthManager,
}));

vi.mock('#lib/stores/media-query-manager.svelte.js', () => ({
  mediaQueryManager: { maxMd: false },
}));

vi.mock('#lib/utils/asset-utils.js', { spy: true });

vi.mock('#lib/utils/file-uploader.js', { spy: true });

vi.mock('#lib/utils/timeline-util.js', { spy: true });

vi.mock('@immich/sdk', async () => {
  const actual = await vi.importActual<typeof import('@immich/sdk')>('@immich/sdk');
  return {
    ...actual,
    getAssetInfo: mockGetAssetInfo,
  };
});

function renderViewer(sharedLinkOverrides: Partial<SharedLinkResponseDto>) {
  const props = {
    sharedLink: factory.sharedLink({
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
    mockGetAssetInfo.mockResolvedValue(factory.asset({ id: 'single-asset' }));
  });

  it('enables GalleryViewer grouping for multi-asset shared views', async () => {
    await renderViewer({
      assets: [factory.asset({ id: 'shared-1' }), factory.asset({ id: 'shared-2' })],
      allowDownload: true,
    });

    await expect.element(page.getByTestId('gallery-viewer')).toHaveAttribute('data-enable-grouping', 'true');
  });

  it('keeps the existing single-asset shared-link viewer path out of GalleryViewer grouping', async () => {
    await renderViewer({ assets: [factory.asset({ id: 'single-asset' })], allowUpload: false });

    await vi.waitFor(() => expect(mockGetAssetInfo).toHaveBeenCalledWith({ id: 'single-asset' }));
    expect(page.getByTestId('gallery-viewer').query()).toBeNull();
  });
});
