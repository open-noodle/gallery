import { AssetTypeEnum } from '@immich/sdk';
import '@testing-library/jest-dom';
import { screen } from '@testing-library/svelte';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderWithTooltips } from '$tests/helpers';
import { assetFactory } from '@test-data/factories/asset-factory';
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

vi.mock('$lib/managers/asset-viewer-manager.svelte', () => ({ assetViewerManager: assetViewerManagerMock }));

vi.mock('$lib/managers/cast-manager.svelte', () => ({
  castManager: { isCasting: false, loadMedia: vi.fn() },
}));

vi.mock('$lib/stores/face.svelte', () => ({
  faceManager: { data: [] as unknown[], facesByPersonId: new Map(), people: [] as unknown[] },
}));

vi.mock('$lib/stores/ocr.svelte', () => ({
  ocrManager: { showOverlay: false, data: [] as unknown[] },
}));

vi.mock('$lib/actions/zoom-image', () => ({ zoomImageAction: () => ({}) }));

vi.mock('$lib/components/AssetViewerEvents.svelte', async () => {
  const { default: MockComponent } = await import('@test-data/mocks/noop-component.svelte');
  return { default: MockComponent };
});

vi.mock('$lib/components/AdaptiveImage.svelte', async () => {
  const { default: MockComponent } = await import('@test-data/mocks/noop-component.svelte');
  return { default: MockComponent };
});

vi.mock('$lib/components/asset-viewer/face-editor/FaceEditor.svelte', async () => {
  const { default: MockComponent } = await import('@test-data/mocks/face-editor.stub.svelte');
  return { default: MockComponent };
});

vi.mock('$lib/components/asset-viewer/face-editor/SpaceFaceEditor.svelte', async () => {
  const { default: MockComponent } = await import('@test-data/mocks/space-face-editor.stub.svelte');
  return { default: MockComponent };
});

describe('PhotoViewer face editor wiring (Slice 8 gap closure)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    assetViewerManagerMock.isFaceEditMode = true;
    assetViewerManagerMock.imgRef = { naturalWidth: 100, naturalHeight: 100 } as unknown;
  });

  it('renders SpaceFaceEditor and NOT FaceEditor for a non-owner space editor', () => {
    const asset = assetFactory.build({ id: 'asset-1', ownerId: 'someone-else', type: AssetTypeEnum.Image });

    renderWithTooltips(PhotoViewer, {
      cursor: { current: asset },
      spaceId: 'space-1',
      canEditSpacePeople: true,
    });

    const stub = screen.getByTestId('space-face-editor-stub');
    expect(stub).toBeInTheDocument();
    expect(stub).toHaveAttribute('data-space-id', 'space-1');
    expect(stub).toHaveAttribute('data-asset-id', 'asset-1');
    expect(screen.queryByTestId('face-editor-stub')).toBeNull();
  });

  it('renders FaceEditor and NOT SpaceFaceEditor for the asset owner, even inside a space', () => {
    const asset = assetFactory.build({ id: 'asset-1', ownerId: 'owner-1', type: AssetTypeEnum.Image });

    renderWithTooltips(PhotoViewer, {
      cursor: { current: asset },
      spaceId: 'space-1',
      canEditSpacePeople: false,
    });

    const stub = screen.getByTestId('face-editor-stub');
    expect(stub).toBeInTheDocument();
    expect(stub).toHaveAttribute('data-asset-id', 'asset-1');
    expect(screen.queryByTestId('space-face-editor-stub')).toBeNull();
  });

  it('renders the owner FaceEditor (never both) when canEditSpacePeople is true but no space id is available', () => {
    const asset = assetFactory.build({ id: 'asset-1', ownerId: 'someone-else', type: AssetTypeEnum.Image });

    renderWithTooltips(PhotoViewer, {
      cursor: { current: asset },
      canEditSpacePeople: true,
    });

    expect(screen.getByTestId('face-editor-stub')).toBeInTheDocument();
    expect(screen.queryByTestId('space-face-editor-stub')).toBeNull();
  });
});
