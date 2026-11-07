import { renderInViewerSpace } from '#lib/gallery/viewer-space.test-helpers.ts';
import { authManager } from '#lib/managers/auth-manager.svelte.ts';
import AssetAddToCollectionModal from '#lib/modals/AssetAddToCollectionModal.svelte';
import { factory } from '#test/unit/factories.ts';
import { renderWithTooltips } from '#test/unit/helpers.ts';
import { AssetTypeEnum } from '@immich/sdk';
import { commandPaletteManager, modalManager } from '@immich/ui';
import { expect } from 'vitest';
import { page } from 'vitest/browser';
import AssetViewerNavBar from './AssetViewerNavBar.svelte';

vi.mock(import('#lib/managers/feature-flags-manager.svelte.js'), function () {
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

  afterEach(() => {
    authManager.reset();
  });

  afterAll(() => {
    vi.restoreAllMocks();
  });

  it('shows edited badge when asset is edited', async () => {
    const prefs = factory.preferences({ cast: { gCastEnabled: false } });
    authManager.setPreferences(prefs);

    const asset = factory.asset({ isEdited: true, isTrashed: false });
    const screen = await renderWithTooltips(AssetViewerNavBar, { asset, ...additionalProps });
    await expect.element(screen.getByText('edited')).toBeInTheDocument();
  });

  it('does not show edited badge when asset is not edited', async () => {
    const prefs = factory.preferences({ cast: { gCastEnabled: false } });
    authManager.setPreferences(prefs);

    const asset = factory.asset({ isEdited: false, isTrashed: false });
    const screen = await renderWithTooltips(AssetViewerNavBar, { asset, ...additionalProps });
    await expect.element(screen.getByLabelText('go_back')).toBeInTheDocument();
    expect(screen.getByText('edited').query()).toBeNull();
  });

  // #889: viewing a shared-space photo owned by someone else, "add to album or space" used to
  // list every personal album — all of which the server must reject.
  describe('add to album on a shared-space photo the user does not own', () => {
    const renderSpaceViewer = async (space: { id: string; canWrite: boolean }) => {
      authManager.setUser(factory.user({ id: 'space-member' }));
      authManager.setPreferences(factory.preferences({ cast: { gCastEnabled: false } }));
      const asset = factory.asset({ id: 'space-photo', ownerId: 'space-owner', isTrashed: false });

      await renderInViewerSpace(AssetViewerNavBar, { asset, ...additionalProps }, { space });
      await page.getByLabelText('more').click();
    };

    it('opens the same picker as the timeline for an editor (#1119)', async () => {
      const show = vi.spyOn(modalManager, 'show').mockResolvedValue(undefined as never);

      await renderSpaceViewer({ id: 'space-1', canWrite: true });
      await page.getByText('add_to_album_or_space').click();

      expect(show).toHaveBeenCalledWith(AssetAddToCollectionModal, { assetIds: ['space-photo'] });
      show.mockRestore();
    });

    it('does not offer the action to a viewer', async () => {
      await renderSpaceViewer({ id: 'space-1', canWrite: false });

      await expect.element(page.getByRole('menu')).toBeInTheDocument();
      expect(page.getByText('add_to_album_or_space').query()).toBeNull();
    });
  });

  // #734: a space editor may edit a member's asset. The server answers per asset via
  // `canEdit`; these tests pin that the nav bar honours it without leaking the owner-only
  // actions.
  describe('space editor on a member photo (#734)', () => {
    const renderEditableSpacePhoto = async (canEdit: boolean) => {
      authManager.setUser(factory.user({ id: 'space-member' }));
      authManager.setPreferences(factory.preferences({ cast: { gCastEnabled: false } }));
      const asset = factory.asset({
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

      await renderInViewerSpace(
        AssetViewerNavBar,
        { asset, ...additionalProps },
        { space: { id: 'space-1', canWrite: true } },
      );
      await page.getByLabelText('more').click();
    };

    it('W-1: offers rotate and the re-processing jobs when canEdit is true', async () => {
      await renderEditableSpacePhoto(true);

      await expect.element(page.getByText('rotate_left')).toBeInTheDocument();
      await expect.element(page.getByText('rotate_180')).toBeInTheDocument();
      await expect.element(page.getByText('refresh_faces')).toBeInTheDocument();
      await expect.element(page.getByText('refresh_metadata')).toBeInTheDocument();
    });

    // Rating is the `Rate` ActionItem (immich-31804): no visible markup, only number-key shortcuts
    // dispatched by @immich/ui's command palette manager on `document.body` (the app enables it in
    // +layout.ts). Its `isEditable()` gate has no other observable surface, so these probe it by
    // pressing '5' and checking whether `updateAsset` fires.
    it('W-rating-1: wires the rating shortcut when canEdit is true', async () => {
      commandPaletteManager.enable();
      updateAssetMock.mockClear();
      authManager.setUser(factory.user({ id: 'space-member' }));
      authManager.setPreferences(factory.preferences({ cast: { gCastEnabled: false }, ratings: { enabled: true } }));
      const asset = factory.asset({
        id: 'space-photo',
        ownerId: 'space-owner',
        isTrashed: false,
        type: AssetTypeEnum.Image,
        canEdit: true,
      });

      await renderInViewerSpace(
        AssetViewerNavBar,
        { asset, ...additionalProps },
        { space: { id: 'space-1', canWrite: true } },
      );

      document.body.dispatchEvent(new KeyboardEvent('keydown', { key: '5', bubbles: true }));

      await vi.waitFor(() =>
        expect(updateAssetMock).toHaveBeenCalledWith({ id: 'space-photo', updateAssetDto: { rating: 5 } }),
      );
    });

    it('W-rating-2: does not wire the rating shortcut when canEdit is false', async () => {
      commandPaletteManager.enable();
      updateAssetMock.mockClear();
      authManager.setUser(factory.user({ id: 'space-member' }));
      authManager.setPreferences(factory.preferences({ cast: { gCastEnabled: false }, ratings: { enabled: true } }));
      const asset = factory.asset({
        id: 'space-photo',
        ownerId: 'space-owner',
        isTrashed: false,
        type: AssetTypeEnum.Image,
        canEdit: false,
      });

      await renderInViewerSpace(
        AssetViewerNavBar,
        { asset, ...additionalProps },
        { space: { id: 'space-1', canWrite: true } },
      );

      document.body.dispatchEvent(new KeyboardEvent('keydown', { key: '5', bubbles: true }));
      // The handler is async (it awaits the formatter first), so let it settle before asserting
      // the negative — otherwise this passes before a wrongly-wired call could land.
      await new Promise((resolve) => setTimeout(resolve, 50));

      expect(updateAssetMock).not.toHaveBeenCalled();
    });

    it('W-2: still withholds the owner-only actions from a non-owner', async () => {
      await renderEditableSpacePhoto(true);

      await expect.element(page.getByText('rotate_left')).toBeInTheDocument();
      expect(page.getByLabelText('delete').query()).toBeNull();
      expect(page.getByText('to_archive').query()).toBeNull();
      expect(page.getByText('add_upload_to_stack').query()).toBeNull();
      expect(page.getByText('view_in_timeline').query()).toBeNull();
    });

    it('W-3: withholds the edit actions when canEdit is false', async () => {
      await renderEditableSpacePhoto(false);

      await expect.element(page.getByRole('menu')).toBeInTheDocument();
      expect(page.getByText('rotate_left').query()).toBeNull();
      expect(page.getByText('refresh_faces').query()).toBeNull();
    });
  });
});
