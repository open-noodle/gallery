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
});
