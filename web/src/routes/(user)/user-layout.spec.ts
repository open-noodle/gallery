import '@testing-library/jest-dom';
import { render } from '@testing-library/svelte';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import UserLayout from './+layout.svelte';

const { mockPage, mockAssetViewerManager } = vi.hoisted(() => ({
  mockPage: {
    url: new URL('https://gallery.test/photos'),
    data: {} as { asset?: unknown },
  },
  mockAssetViewerManager: {
    gridScrollTarget: undefined as { at: string | null } | undefined,
    setAsset: vi.fn(),
    showAssetViewer: vi.fn(),
  },
}));

vi.mock('$app/state', () => ({ page: mockPage }));
vi.mock('$lib/managers/asset-viewer-manager.svelte', () => ({ assetViewerManager: mockAssetViewerManager }));
vi.mock('./DragAndDropUploadOverlay.svelte', async () => {
  const { default: MockComponent } = await import('@test-data/mocks/noop-component.svelte');
  return { default: MockComponent };
});

// `at` is read here, once, for every route under (user) — not per page. That is what lets
// `/spaces/<id>?at=<assetId>` scroll a Space timeline to a photo with no per-route wiring, which
// is how "view in timeline" on a memory's Space photo lands (#1047).
describe('(user) layout grid scroll target', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockPage.data = {};
    mockAssetViewerManager.gridScrollTarget = undefined;
  });

  it('seeds the scroll target from ?at= on the personal timeline', () => {
    mockPage.url = new URL('https://gallery.test/photos?at=asset-2');

    render(UserLayout);

    expect(mockAssetViewerManager.gridScrollTarget).toEqual({ at: 'asset-2' });
  });

  it('seeds the scroll target from ?at= on a space timeline', () => {
    mockPage.url = new URL('https://gallery.test/spaces/space-1?at=asset-2');

    render(UserLayout);

    expect(mockAssetViewerManager.gridScrollTarget).toEqual({ at: 'asset-2' });
  });

  it('clears the scroll target when the route carries no at', () => {
    mockPage.url = new URL('https://gallery.test/spaces/space-1');

    render(UserLayout);

    expect(mockAssetViewerManager.gridScrollTarget).toEqual({ at: null });
  });
});
