import { AssetTypeEnum } from '@immich/sdk';
import '@testing-library/jest-dom';
import { screen } from '@testing-library/svelte';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderWithTooltips } from '$tests/helpers';
import { assetFactory } from '@test-data/factories/asset-factory';
import DetailPanel from '../DetailPanel.svelte';

// Closes the Slice 8 wiring gap: `canEditSpacePeople` made the People-row edit affordances
// VISIBLE to a space editor, but DetailPanel.svelte:563 unconditionally rendered the OWNER'S
// `PersonSidePanel` when the edit-faces panel opened — which calls owner-only endpoints
// (reassignFacesById, createPerson, deleteFace, createFace) that 403/404 for a non-owner. This
// pins that the side panel now SPLITS on `canEditSpacePeople` vs `isOwner`, and the two paths are
// mutually exclusive.

const { authManagerMock, faceManagerMock, getAllAlbumsMock, getAssetInfoMock, zoomImageToBase64Mock } = vi.hoisted(
  () => ({
    authManagerMock: {
      authenticated: true,
      user: { id: 'owner-1' },
      isSharedLink: false,
      params: {},
      preferences: { tags: { enabled: false }, ratings: { enabled: false } },
    },
    faceManagerMock: {
      data: [] as unknown[],
      facesByPersonId: new Map<string, unknown[]>(),
      people: [] as unknown[],
    },
    getAllAlbumsMock: vi.fn(),
    getAssetInfoMock: vi.fn(),
    zoomImageToBase64Mock: vi.fn(),
  }),
);

const assetViewerManagerMock = vi.hoisted(() => ({
  closeDetailPanel: vi.fn(),
  closeEditFacesPanel: vi.fn(),
  clearHighlightedFaces: vi.fn(),
  highlightedFaces: [] as unknown[],
  isEditFacesPanelOpen: true,
  isShowAssetPath: false,
  openEditFacesPanel: vi.fn(),
  setHighlightedFaces: vi.fn(),
  toggleAssetPath: vi.fn(),
  toggleFaceEditMode: vi.fn(),
}));

vi.mock('@immich/sdk', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@immich/sdk')>();
  return {
    ...actual,
    getAllAlbums: getAllAlbumsMock,
    getAssetInfo: getAssetInfoMock,
  };
});

vi.mock('$app/navigation', () => ({ goto: vi.fn().mockResolvedValue(undefined) }));

vi.mock('$lib/utils/people-utils', () => ({ zoomImageToBase64: zoomImageToBase64Mock }));

vi.mock('$lib/stores/face.svelte', () => ({ faceManager: faceManagerMock }));

vi.mock('$lib/managers/auth-manager.svelte', () => ({ authManager: authManagerMock }));

vi.mock('$lib/managers/asset-viewer-manager.svelte', () => ({ assetViewerManager: assetViewerManagerMock }));

vi.mock('$lib/managers/feature-flags-manager.svelte', () => ({
  featureFlagsManager: { value: { map: false, smartSearch: false } },
}));

vi.mock('$lib/components/asset-viewer/DetailPanelDate.svelte', async () => {
  const { default: MockComponent } = await import('@test-data/mocks/noop-component.svelte');
  return { default: MockComponent };
});
vi.mock('$lib/components/asset-viewer/DetailPanelDescription.svelte', async () => {
  const { default: MockComponent } = await import('@test-data/mocks/noop-component.svelte');
  return { default: MockComponent };
});
vi.mock('$lib/components/asset-viewer/DetailPanelLocation.svelte', async () => {
  const { default: MockComponent } = await import('@test-data/mocks/noop-component.svelte');
  return { default: MockComponent };
});
vi.mock('$lib/components/asset-viewer/DetailPanelStarRating.svelte', async () => {
  const { default: MockComponent } = await import('@test-data/mocks/noop-component.svelte');
  return { default: MockComponent };
});
vi.mock('$lib/components/asset-viewer/DetailPanelTags.svelte', async () => {
  const { default: MockComponent } = await import('@test-data/mocks/noop-component.svelte');
  return { default: MockComponent };
});
vi.mock('$lib/components/OnEvents.svelte', async () => {
  const { default: MockComponent } = await import('@test-data/mocks/noop-component.svelte');
  return { default: MockComponent };
});
vi.mock('$lib/components/shared-components/UserAvatar.svelte', async () => {
  const { default: MockComponent } = await import('@test-data/mocks/noop-component.svelte');
  return { default: MockComponent };
});
vi.mock('$lib/components/asset-viewer/AlbumListItemDetails.svelte', async () => {
  const { default: MockComponent } = await import('@test-data/mocks/noop-component.svelte');
  return { default: MockComponent };
});
vi.mock('$lib/components/shared-components/LoadingSpinner.svelte', async () => {
  const { default: MockComponent } = await import('@test-data/mocks/noop-component.svelte');
  return { default: MockComponent };
});

vi.mock('$lib/components/faces-page/PersonSidePanel.svelte', async () => {
  const { default: MockComponent } = await import('@test-data/mocks/person-side-panel.stub.svelte');
  return { default: MockComponent };
});
vi.mock('$lib/components/asset-viewer/SpacePersonSidePanel.svelte', async () => {
  const { default: MockComponent } = await import('@test-data/mocks/space-person-side-panel.stub.svelte');
  return { default: MockComponent };
});

describe('DetailPanel face side-panel wiring (Slice 8 gap closure)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    authManagerMock.user = { id: 'owner-1' };
    authManagerMock.preferences.tags.enabled = false;
    authManagerMock.preferences.ratings.enabled = false;
    faceManagerMock.data = [];
    faceManagerMock.facesByPersonId = new Map();
    faceManagerMock.people = [];
    assetViewerManagerMock.isEditFacesPanelOpen = true;
    getAllAlbumsMock.mockResolvedValue([]);
    getAssetInfoMock.mockResolvedValue(undefined);
    zoomImageToBase64Mock.mockResolvedValue(null);
  });

  it('renders SpacePersonSidePanel and NOT PersonSidePanel for a non-owner space editor', () => {
    const asset = assetFactory.build({
      id: 'asset-1',
      ownerId: 'someone-else',
      canEdit: true,
      type: AssetTypeEnum.Image,
    });

    renderWithTooltips(DetailPanel, { asset, currentAlbum: null, spaceId: 'space-1' });

    expect(screen.getByTestId('space-person-side-panel-stub')).toBeInTheDocument();
    expect(screen.queryByTestId('person-side-panel-stub')).toBeNull();

    const stub = screen.getByTestId('space-person-side-panel-stub');
    expect(stub).toHaveAttribute('data-space-id', 'space-1');
    expect(stub).toHaveAttribute('data-asset-id', 'asset-1');
  });

  it('renders PersonSidePanel and NOT SpacePersonSidePanel for the asset owner, even inside a space', () => {
    const asset = assetFactory.build({ id: 'asset-1', ownerId: 'owner-1', canEdit: true, type: AssetTypeEnum.Image });

    renderWithTooltips(DetailPanel, { asset, currentAlbum: null, spaceId: 'space-1' });

    expect(screen.getByTestId('person-side-panel-stub')).toBeInTheDocument();
    expect(screen.queryByTestId('space-person-side-panel-stub')).toBeNull();

    const stub = screen.getByTestId('person-side-panel-stub');
    expect(stub).toHaveAttribute('data-asset-id', 'asset-1');
  });

  it('renders the owner PersonSidePanel (never both) for a non-owner with no space context', () => {
    const asset = assetFactory.build({
      id: 'asset-1',
      ownerId: 'someone-else',
      canEdit: true,
      type: AssetTypeEnum.Image,
    });

    renderWithTooltips(DetailPanel, { asset, currentAlbum: null });

    expect(screen.getByTestId('person-side-panel-stub')).toBeInTheDocument();
    expect(screen.queryByTestId('space-person-side-panel-stub')).toBeNull();
  });
});
