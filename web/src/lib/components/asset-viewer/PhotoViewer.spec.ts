import { renderInViewerSpace } from '#lib/gallery/viewer-space.test-helpers.ts';
import { authManager } from '#lib/managers/auth-manager.svelte.ts';
import { factory } from '#test/unit/factories.ts';
import { renderWithTooltips } from '#test/unit/helpers.ts';
import { AssetTypeEnum } from '@immich/sdk';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { page } from 'vitest/browser';
import PhotoViewer from './PhotoViewer.svelte';

// Closes the Slice 8 wiring gap: `canEditSpacePeople` made the People-row edit affordances
// VISIBLE to a space editor, but PhotoViewer.svelte unconditionally rendered the OWNER'S
// `FaceEditor` when face-draw mode opened — which calls the owner-only `createFace` endpoint,
// 403/404ing for a non-owner. This pins that the face editor now SPLITS on `canEditSpacePeople`
// vs `isOwner`, and the two paths are mutually exclusive.

const assetViewerManagerMock = vi.hoisted(() => ({
  imgRef: undefined as unknown,
  zoom: 1,
  highlightedFaces: [] as unknown[],
  isFaceEditMode: true,
  isShowingHiddenPeople: false,
  resetZoomState: vi.fn(),
  clearHighlightedFaces: vi.fn(),
  hideHiddenPeople: vi.fn(),
  animatedZoom: vi.fn(),
  setHighlightedFaces: vi.fn(),
  closeFaceEditMode: vi.fn(),
}));

vi.mock('#lib/managers/asset-viewer-manager.svelte.js', () => ({ assetViewerManager: assetViewerManagerMock }));

vi.mock('#lib/managers/cast-manager.svelte.js', () => ({
  castManager: { isCasting: false, loadMedia: vi.fn() },
}));

vi.mock('#lib/stores/face.svelte.js', () => ({
  faceManager: { data: [] as unknown[], facesByPersonId: new Map(), people: [] as unknown[] },
}));

vi.mock('#lib/stores/ocr.svelte.js', () => ({
  ocrManager: { showOverlay: false, data: [] as unknown[] },
}));

vi.mock('#lib/actions/zoom-image.js', () => ({ zoomImageAction: () => ({}) }));

vi.mock('#lib/components/AssetViewerEvents.svelte', async () => {
  const { default: MockComponent } = await import('#lib/gallery/__mocks__/noop-component.svelte');
  return { default: MockComponent };
});

vi.mock('#lib/components/AdaptiveImage.svelte', async () => {
  const { default: MockComponent } = await import('#lib/gallery/__mocks__/noop-component.svelte');
  return { default: MockComponent };
});

vi.mock('#lib/components/asset-viewer/face-editor/FaceEditor.svelte', async () => {
  const { default: MockComponent } = await import('#lib/gallery/__mocks__/face-editor.stub.svelte');
  return { default: MockComponent };
});

vi.mock('#lib/gallery/asset-viewer/space-face-editor.js', () => ({
  getFaceEditorSpace: (spaceId: string) => ({ spaceId }),
}));

describe('PhotoViewer face editor wiring (Slice 8 gap closure)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    assetViewerManagerMock.isFaceEditMode = true;
    assetViewerManagerMock.imgRef = { naturalWidth: 100, naturalHeight: 100 } as unknown;
    authManager.setUser(factory.user({ id: 'owner-1' }));
    authManager.setPreferences(factory.preferences());
  });

  it('renders FaceEditor in its space mode for a non-owner space editor', async () => {
    const asset = factory.asset({
      id: 'asset-1',
      ownerId: 'someone-else',
      canEdit: true,
      type: AssetTypeEnum.Image,
    });

    await renderInViewerSpace(PhotoViewer, { cursor: { current: asset } }, { spaceId: 'space-1' });

    const stub = page.getByTestId('face-editor-stub');
    await expect.element(stub).toHaveAttribute('data-space-id', 'space-1');
    await expect.element(stub).toHaveAttribute('data-asset-id', 'asset-1');
  });

  it('renders FaceEditor in its owner mode for the asset owner, even inside a space', async () => {
    const asset = factory.asset({ id: 'asset-1', ownerId: 'owner-1', canEdit: true, type: AssetTypeEnum.Image });

    await renderInViewerSpace(PhotoViewer, { cursor: { current: asset } }, { spaceId: 'space-1' });

    const stub = page.getByTestId('face-editor-stub');
    await expect.element(stub).toBeInTheDocument();
    await expect.element(stub).toHaveAttribute('data-asset-id', 'asset-1');
    await expect.element(stub).not.toHaveAttribute('data-space-id');
  });

  it('renders the owner FaceEditor (never both) for an editor when no space id is available', async () => {
    const asset = factory.asset({
      id: 'asset-1',
      ownerId: 'someone-else',
      canEdit: true,
      resolvedSpaceId: undefined,
      type: AssetTypeEnum.Image,
    });

    await renderWithTooltips(PhotoViewer, { cursor: { current: asset } });

    await expect.element(page.getByTestId('face-editor-stub')).toBeInTheDocument();
    await expect.element(page.getByTestId('face-editor-stub')).not.toHaveAttribute('data-space-id');
  });
});
