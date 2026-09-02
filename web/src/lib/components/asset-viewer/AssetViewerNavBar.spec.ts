import { AssetTypeEnum } from '@immich/sdk';
import { modalManager } from '@immich/ui';
import '@testing-library/jest-dom';
import { fireEvent, screen } from '@testing-library/svelte';
import { getResizeObserverMock } from '$lib/__mocks__/resize-observer.mock';
import { authManager } from '$lib/managers/auth-manager.svelte';
import AssetAddToCollectionModal from '$lib/modals/AssetAddToCollectionModal.svelte';
import { renderWithTooltips } from '$tests/helpers';
import { assetFactory } from '@test-data/factories/asset-factory';
import { preferencesFactory } from '@test-data/factories/preferences-factory';
import { userAdminFactory } from '@test-data/factories/user-factory';
import AssetViewerNavBar from './AssetViewerNavBar.svelte';

vi.mock(import('$lib/managers/feature-flags-manager.svelte'), function () {
  return {
    featureFlagsManager: {
      init: vi.fn(),
      loadFeatureFlags: vi.fn(),
      value: { smartSearch: true, trash: true },
    } as never,
  };
});

// RatingAction renders no visible markup of its own — it only wires document-level number-key
// shortcuts (see RatingAction.svelte). The only observable proof it mounted is that pressing a
// rating key actually calls `updateAsset`, so that call is spied here rather than left to hit the
// network.
const { updateAssetMock } = vi.hoisted(() => ({
  updateAssetMock: vi.fn().mockResolvedValue({}),
}));

vi.mock('@immich/sdk', async () => {
  const actual = await vi.importActual<typeof import('@immich/sdk')>('@immich/sdk');
  return { ...actual, updateAsset: updateAssetMock };
});

describe('AssetViewerNavBar component', () => {
  const additionalProps = {
    preAction: () => {},
    onAction: () => {},
    onPlaySlideshow: () => {},
    onClose: () => {},
    playOriginalVideo: false,
    setPlayOriginalVideo: () => Promise.resolve(),
  };

  beforeAll(() => {
    Element.prototype.animate = vi.fn().mockImplementation(function () {
      return {
        cancel: () => {},
      };
    });
    vi.stubGlobal('ResizeObserver', getResizeObserverMock());
  });

  afterEach(() => {
    authManager.reset();
  });

  afterAll(() => {
    vi.restoreAllMocks();
  });

  it('shows back button', () => {
    const preferences = preferencesFactory.build({ cast: { gCastEnabled: false } });
    authManager.setPreferences(preferences);

    const asset = assetFactory.build({ isTrashed: false });
    const { getByLabelText } = renderWithTooltips(AssetViewerNavBar, { asset, ...additionalProps });
    expect(getByLabelText('go_back')).toBeInTheDocument();
  });

  it('shows edited badge when asset is edited', () => {
    const prefs = preferencesFactory.build({ cast: { gCastEnabled: false } });
    authManager.setPreferences(prefs);

    const asset = assetFactory.build({ isEdited: true, isTrashed: false });
    const { getByText } = renderWithTooltips(AssetViewerNavBar, { asset, ...additionalProps });
    expect(getByText('edited')).toBeInTheDocument();
  });

  it('does not show edited badge when asset is not edited', () => {
    const prefs = preferencesFactory.build({ cast: { gCastEnabled: false } });
    authManager.setPreferences(prefs);

    const asset = assetFactory.build({ isEdited: false, isTrashed: false });
    const { queryByText } = renderWithTooltips(AssetViewerNavBar, { asset, ...additionalProps });
    expect(queryByText('edited')).not.toBeInTheDocument();
  });

  describe('if the current user owns the asset', () => {
    it('shows delete button', () => {
      const ownerId = 'id-of-the-user';
      const user = userAdminFactory.build({ id: ownerId });
      const asset = assetFactory.build({ ownerId, isTrashed: false });
      authManager.setUser(user);

      const preferences = preferencesFactory.build({ cast: { gCastEnabled: false } });
      authManager.setPreferences(preferences);

      const { getByLabelText } = renderWithTooltips(AssetViewerNavBar, { asset, ...additionalProps });
      expect(getByLabelText('delete')).toBeInTheDocument();
    });
  });

  // #889: viewing a shared-space photo owned by someone else, "add to album or space" used to
  // list every personal album — all of which the server must reject.
  describe('add to album on a shared-space photo the user does not own', () => {
    const renderSpaceViewer = async (space: { id: string; canWrite: boolean }) => {
      authManager.setUser(userAdminFactory.build({ id: 'space-member' }));
      authManager.setPreferences(preferencesFactory.build({ cast: { gCastEnabled: false } }));
      const asset = assetFactory.build({ id: 'space-photo', ownerId: 'space-owner', isTrashed: false });

      renderWithTooltips(AssetViewerNavBar, { asset, space, ...additionalProps });
      await fireEvent.click(screen.getByLabelText('more'));
    };

    it('narrows the picker to the space for an editor', async () => {
      const show = vi.spyOn(modalManager, 'show').mockResolvedValue(undefined as never);

      await renderSpaceViewer({ id: 'space-1', canWrite: true });
      await fireEvent.click(screen.getByText('add_to_album_or_space'));

      expect(show).toHaveBeenCalledWith(AssetAddToCollectionModal, {
        assetIds: ['space-photo'],
        restrictToSpaceId: 'space-1',
      });
      show.mockRestore();
    });

    it('does not offer the action to a viewer', async () => {
      await renderSpaceViewer({ id: 'space-1', canWrite: false });

      expect(screen.queryByText('add_to_album_or_space')).not.toBeInTheDocument();
    });
  });

  // #734: a space editor may edit a member's asset. The server answers per asset via
  // `canEdit`; these tests pin that the nav bar honours it without leaking the owner-only
  // actions.
  describe('space editor on a member photo (#734)', () => {
    const renderEditableSpacePhoto = async (canEdit: boolean) => {
      authManager.setUser(userAdminFactory.build({ id: 'space-member' }));
      authManager.setPreferences(preferencesFactory.build({ cast: { gCastEnabled: false } }));
      const asset = assetFactory.build({
        id: 'space-photo',
        ownerId: 'space-owner',
        isTrashed: false,
        // Both fields below are pinned because the factory draws them randomly, and
        // canEditImage/canEditVideo (`asset.service.ts:290-296`) gate on both: the default `type`
        // is a random AssetTypeEnum value, which made this test flaky (a random Video draw failed
        // W-1 nondeterministically); the default `originalPath` is `faker.system.filePath()`,
        // which occasionally draws a `.gif`/`.svg`/`.insp` extension that canEditImage rejects —
        // roughly 1 run in 70. Neither is a production bug; both are pinned to keep this test
        // deterministic.
        type: AssetTypeEnum.Image,
        originalPath: '/photos/photo.jpg',
        canEdit,
      });

      renderWithTooltips(AssetViewerNavBar, {
        asset,
        space: { id: 'space-1', canWrite: true },
        ...additionalProps,
      });
      await fireEvent.click(screen.getByLabelText('more'));
    };

    it('W-1: offers rotate and the re-processing jobs when canEdit is true', async () => {
      await renderEditableSpacePhoto(true);

      expect(screen.getByText('rotate_left')).toBeInTheDocument();
      expect(screen.getByText('rotate_180')).toBeInTheDocument();
      expect(screen.getByText('refresh_faces')).toBeInTheDocument();
      expect(screen.getByText('refresh_metadata')).toBeInTheDocument();
    });

    // RatingAction renders no visible markup — it only wires document-level number-key shortcuts
    // (`use:shortcuts` on `<svelte:document>`). The rating gate at `AssetViewerNavBar.svelte:146`
    // has no other observable surface, so these probe it by pressing '5' and checking whether
    // `updateAsset` fires — the only way to tell the component mounted at all.
    it('W-rating-1: wires the rating shortcut when canEdit is true', async () => {
      updateAssetMock.mockClear();
      authManager.setUser(userAdminFactory.build({ id: 'space-member' }));
      authManager.setPreferences(
        preferencesFactory.build({ cast: { gCastEnabled: false }, ratings: { enabled: true } }),
      );
      const asset = assetFactory.build({
        id: 'space-photo',
        ownerId: 'space-owner',
        isTrashed: false,
        type: AssetTypeEnum.Image,
        canEdit: true,
      });

      renderWithTooltips(AssetViewerNavBar, {
        asset,
        space: { id: 'space-1', canWrite: true },
        ...additionalProps,
      });

      await fireEvent.keyDown(document, { key: '5' });

      expect(updateAssetMock).toHaveBeenCalledWith({ id: 'space-photo', updateAssetDto: { rating: 5 } });
    });

    it('W-rating-2: does not wire the rating shortcut when canEdit is false', async () => {
      updateAssetMock.mockClear();
      authManager.setUser(userAdminFactory.build({ id: 'space-member' }));
      authManager.setPreferences(
        preferencesFactory.build({ cast: { gCastEnabled: false }, ratings: { enabled: true } }),
      );
      const asset = assetFactory.build({
        id: 'space-photo',
        ownerId: 'space-owner',
        isTrashed: false,
        type: AssetTypeEnum.Image,
        canEdit: false,
      });

      renderWithTooltips(AssetViewerNavBar, {
        asset,
        space: { id: 'space-1', canWrite: true },
        ...additionalProps,
      });

      await fireEvent.keyDown(document, { key: '5' });

      expect(updateAssetMock).not.toHaveBeenCalled();
    });

    it('W-2: still withholds the owner-only actions from a non-owner', async () => {
      await renderEditableSpacePhoto(true);

      expect(screen.queryByLabelText('delete')).toBeNull();
      expect(screen.queryByText('to_archive')).toBeNull();
      expect(screen.queryByText('add_upload_to_stack')).toBeNull();
      expect(screen.queryByText('view_in_timeline')).toBeNull();
    });

    it('W-3: withholds the edit actions when canEdit is false', async () => {
      await renderEditableSpacePhoto(false);

      expect(screen.queryByText('rotate_left')).toBeNull();
      expect(screen.queryByText('refresh_faces')).toBeNull();
    });
  });
});
