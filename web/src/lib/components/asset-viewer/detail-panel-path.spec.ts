import { AssetTypeEnum, AssetVisibility, type AssetResponseDto } from '@immich/sdk';
import '@testing-library/jest-dom';
import { screen, waitFor } from '@testing-library/svelte';
import { renderWithTooltips } from '$tests/helpers';
import DetailPanel from './DetailPanel.svelte';

// Regression probe for "file storage path no longer displayed below the filename in rc4".
// The path is rendered by `DetailPanel.svelte` only when the asset-viewer manager's
// persisted `isShowAssetPath` toggle (localStorage key `asset-viewer-show-path`, default false)
// is on. These tests pin that contract so we can tell a real code regression apart from the
// toggle simply being off (e.g. fresh localStorage on a different origin).

const { getAllAlbumsMock, getAssetInfoMock, assetViewerManagerMock } = vi.hoisted(() => ({
  getAllAlbumsMock: vi.fn(),
  getAssetInfoMock: vi.fn(),
  // Mutable so individual tests can flip the persisted path toggle.
  assetViewerManagerMock: {
    closeDetailPanel: vi.fn(),
    closeEditFacesPanel: vi.fn(),
    isEditFacesPanelOpen: false,
    isShowAssetPath: false,
    openEditFacesPanel: vi.fn(),
    toggleAssetPath: vi.fn(),
    toggleFaceEditMode: vi.fn(),
  },
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

vi.mock('$lib/managers/auth-manager.svelte', () => ({
  authManager: {
    authenticated: true,
    user: { id: 'owner-1' },
    isSharedLink: false,
    params: {},
    preferences: { tags: { enabled: false }, ratings: { enabled: false } },
  },
}));

vi.mock('$lib/managers/asset-viewer-manager.svelte', () => ({
  assetViewerManager: assetViewerManagerMock,
}));

vi.mock('$lib/managers/feature-flags-manager.svelte', () => ({
  featureFlagsManager: { value: { map: false, smartSearch: false } },
}));

const ORIGINAL_PATH = '/photos/berlin/2026/2026_04/20260416_173726.jpg';

const buildAsset = (overrides: Partial<AssetResponseDto> = {}): AssetResponseDto => ({
  id: 'asset-1',
  ownerId: 'owner-1',
  libraryId: 'library-1',
  type: AssetTypeEnum.Image,
  originalPath: ORIGINAL_PATH,
  originalFileName: '20260416_173726.jpg',
  originalMimeType: 'image/jpeg',
  thumbhash: 'thumbhash',
  createdAt: '2026-04-16T17:37:26.000Z',
  fileCreatedAt: '2026-04-16T17:37:26.000Z',
  fileModifiedAt: '2026-04-16T17:37:26.000Z',
  localDateTime: '2026-04-16T17:37:26.000Z',
  updatedAt: '2026-04-16T17:37:26.000Z',
  isFavorite: false,
  isArchived: false,
  isTrashed: false,
  duration: null,
  checksum: 'checksum',
  isOffline: false,
  hasMetadata: false,
  visibility: AssetVisibility.Timeline,
  width: 4000,
  height: 3000,
  isEdited: false,
  people: [],
  ...overrides,
});

describe('DetailPanel file path display', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getAllAlbumsMock.mockResolvedValue([]);
    getAssetInfoMock.mockResolvedValue(undefined);
    assetViewerManagerMock.isShowAssetPath = false;
  });

  it('hides the file path when the persisted toggle is off (the rc4 default state)', async () => {
    assetViewerManagerMock.isShowAssetPath = false;

    renderWithTooltips(DetailPanel, { asset: buildAsset(), currentAlbum: null });

    // Filename is always shown; the path is not, until the user toggles it on.
    await waitFor(() => expect(screen.getByText('20260416_173726.jpg')).toBeInTheDocument());
    expect(screen.queryByText(ORIGINAL_PATH)).not.toBeInTheDocument();
  });

  it('shows the file path below the filename when the persisted toggle is on', async () => {
    assetViewerManagerMock.isShowAssetPath = true;

    renderWithTooltips(DetailPanel, { asset: buildAsset(), currentAlbum: null });

    await waitFor(() => expect(screen.getByText(ORIGINAL_PATH)).toBeInTheDocument());
  });

  // Option 1: the "show file location" toggle is gated on the path being present, not on
  // ownership — so a non-owner who can see an external-library asset can still reveal its path.
  it('shows the file-location toggle to a non-owner when originalPath is present', async () => {
    renderWithTooltips(DetailPanel, {
      asset: buildAsset({ ownerId: 'owner-2' }),
      currentAlbum: null,
    });

    await waitFor(() => expect(screen.getByLabelText('show_file_location')).toBeInTheDocument());
  });

  it('shows the file-location toggle to the owner', async () => {
    renderWithTooltips(DetailPanel, {
      asset: buildAsset({ ownerId: 'owner-1' }),
      currentAlbum: null,
    });

    await waitFor(() => expect(screen.getByLabelText('show_file_location')).toBeInTheDocument());
  });

  it('hides the file-location toggle when there is no path (e.g. sanitized shared-link view)', async () => {
    renderWithTooltips(DetailPanel, {
      asset: buildAsset({ ownerId: 'owner-2', originalPath: '' }),
      currentAlbum: null,
    });

    await waitFor(() => expect(screen.getByText('20260416_173726.jpg')).toBeInTheDocument());
    expect(screen.queryByLabelText('show_file_location')).not.toBeInTheDocument();
  });
});
