import { AssetTypeEnum } from '@immich/sdk';
import '@testing-library/jest-dom';
import { fireEvent, screen } from '@testing-library/svelte';
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
      clear: vi.fn(),
      getAssetFaces: vi.fn().mockResolvedValue(undefined),
    },
    getAllAlbumsMock: vi.fn(),
    getAssetInfoMock: vi.fn(),
    zoomImageToBase64Mock: vi.fn(),
  }),
);

const eventManagerMock = vi.hoisted(() => ({ emit: vi.fn(), on: vi.fn(), off: vi.fn() }));

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
  const { default: MockComponent } = await import('@test-data/mocks/space-person-side-panel-refresh.stub.svelte');
  return { default: MockComponent };
});

vi.mock('$lib/managers/event-manager.svelte', () => ({ eventManager: eventManagerMock }));

describe('DetailPanel people refresh propagates to the asset viewer', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    authManagerMock.user = { id: 'anna' };
    authManagerMock.preferences.tags.enabled = false;
    authManagerMock.preferences.ratings.enabled = false;
    faceManagerMock.data = [];
    faceManagerMock.facesByPersonId = new Map();
    faceManagerMock.people = [];
    assetViewerManagerMock.isEditFacesPanelOpen = true;
    getAllAlbumsMock.mockResolvedValue([]);
    zoomImageToBase64Mock.mockResolvedValue(null);
  });

  /**
   * The stale-panel bug: `asset` is a plain prop and AssetViewer derives it from `cursor.current`,
   * so DetailPanel assigning `asset = await getAssetInfo(...)` only updated its OWN copy. Closing
   * and reopening the info panel re-read the parent's untouched asset and showed the pre-edit
   * people again, until a full page reload.
   *
   * Emitting `AssetUpdate` is the existing route back to the parent (AssetViewer's `onAssetUpdate`
   * replaces `cursor.current`). Asserting the emit -- rather than anything rendered inside
   * DetailPanel -- is the point: a local-only assignment renders identically here and would pass a
   * DOM assertion while leaving the parent stale.
   */
  it('emits AssetUpdate with the refetched asset after a space face edit', async () => {
    const asset = assetFactory.build({
      id: 'asset-1',
      ownerId: 'someone-else',
      canEdit: true,
      type: AssetTypeEnum.Image,
    });
    const refreshed = { ...asset, people: [] };
    getAssetInfoMock.mockResolvedValue(refreshed);

    renderWithTooltips(DetailPanel, { asset, currentAlbum: null, spaceId: 'space-1' });

    await fireEvent.click(screen.getByTestId('trigger-refresh'));

    expect(getAssetInfoMock).toHaveBeenCalledWith({ id: 'asset-1', spaceId: 'space-1' });
    expect(eventManagerMock.emit).toHaveBeenCalledWith('AssetUpdate', refreshed);
  });
});
