import { modalManager, toastManager } from '@immich/ui';
import { render, screen } from '@testing-library/svelte';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import CreateSharedLinkAction from '$lib/components/timeline/actions/create-shared-link-action.test-wrapper.svelte';
import { assetMultiSelectManager } from '$lib/managers/asset-multi-select-manager.svelte';
import type { TimelineAsset } from '$lib/managers/timeline-manager/types';

const { mockUser } = vi.hoisted(() => ({ mockUser: { current: { id: 'me', isAdmin: false } } }));
vi.mock('$lib/managers/auth-manager.svelte', () => ({
  authManager: {
    get authenticated() {
      return mockUser.current !== null;
    },
    get user() {
      return mockUser.current;
    },
  },
}));

const asset = (id: string, ownerId: string) => ({ id, ownerId }) as TimelineAsset;

describe('CreateSharedLinkAction', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    // `show`'s result type is inferred from the modal component, so a bare spy widens to `never`.
    vi.spyOn(modalManager, 'show').mockResolvedValue(undefined as never);
    vi.spyOn(toastManager, 'warning').mockReturnValue(undefined as never);
    mockUser.current = { id: 'me', isAdmin: false };
    assetMultiSelectManager.clear();
  });

  const clickShare = async () => {
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: /share/i }));
  };

  // #1018: on a space surface where the caller is an Owner/Editor, the toolbar passes the space
  // down and the whole selection goes into the link — the server authorizes it against the space
  // instead of against ownership. Off a space surface `spaceId` is undefined and nothing changes.
  describe('from a space (#1018)', () => {
    it('sends the whole selection, not just the owned subset', async () => {
      assetMultiSelectManager.selectAssets([asset('mine', 'me'), asset('theirs', 'someone-else')]);
      render(CreateSharedLinkAction, { spaceId: 'space-1' });

      await clickShare();

      expect(modalManager.show).toHaveBeenCalledWith(expect.anything(), {
        assetIds: ['mine', 'theirs'],
        spaceId: 'space-1',
        contributedCount: 1,
      });
    });

    it('opens the modal even when the caller owns none of the selection', async () => {
      assetMultiSelectManager.selectAssets([asset('theirs-1', 'other-1'), asset('theirs-2', 'other-2')]);
      render(CreateSharedLinkAction, { spaceId: 'space-1' });

      await clickShare();

      expect(modalManager.show).toHaveBeenCalledWith(expect.anything(), {
        assetIds: ['theirs-1', 'theirs-2'],
        spaceId: 'space-1',
        contributedCount: 2,
      });
      expect(toastManager.warning).not.toHaveBeenCalled();
    });

    it('reports no contributions when the caller owns the whole selection', async () => {
      assetMultiSelectManager.selectAssets([asset('a1', 'me'), asset('a2', 'me')]);
      render(CreateSharedLinkAction, { spaceId: 'space-1' });

      await clickShare();

      expect(modalManager.show).toHaveBeenCalledWith(expect.anything(), {
        assetIds: ['a1', 'a2'],
        spaceId: 'space-1',
        contributedCount: 0,
      });
    });

    it('still refuses an unauthenticated viewer', async () => {
      mockUser.current = null as never;
      assetMultiSelectManager.selectAssets([asset('a1', 'someone')]);
      render(CreateSharedLinkAction, { spaceId: 'space-1' });

      await clickShare();

      expect(modalManager.show).not.toHaveBeenCalled();
    });
  });

  it('shares every asset when the whole selection is the user’s own', async () => {
    assetMultiSelectManager.selectAssets([asset('a1', 'me'), asset('a2', 'me')]);
    render(CreateSharedLinkAction);

    await clickShare();

    expect(modalManager.show).toHaveBeenCalledWith(expect.anything(), { assetIds: ['a1', 'a2'], excludedCount: 0 });
  });

  it('sends only the owned subset on a mixed selection — Permission.AssetShare rejects the whole request otherwise', async () => {
    assetMultiSelectManager.selectAssets([asset('mine', 'me'), asset('theirs', 'someone-else')]);
    render(CreateSharedLinkAction);

    await clickShare();

    expect(modalManager.show).toHaveBeenCalledWith(expect.anything(), { assetIds: ['mine'], excludedCount: 1 });
  });

  it('reports how many assets were left out so the subsetting is visible before the link is made', async () => {
    assetMultiSelectManager.selectAssets([
      asset('mine', 'me'),
      asset('theirs-1', 'other-1'),
      asset('theirs-2', 'other-2'),
    ]);
    render(CreateSharedLinkAction);

    await clickShare();

    expect(modalManager.show).toHaveBeenCalledWith(expect.anything(), { assetIds: ['mine'], excludedCount: 2 });
  });

  // Surfaces that render this action WITHOUT a capability gate (the partner page, the regular
  // album page, search) can hold a selection the user owns none of. Opening the modal there
  // would offer a form that can only ever fail — the server rejects an empty assetIds with
  // "Invalid assetIds" (shared-link.service.ts). Refuse up front instead.
  it('does not open the modal when the user owns none of the selection', async () => {
    assetMultiSelectManager.selectAssets([asset('theirs-1', 'other-1'), asset('theirs-2', 'other-2')]);
    render(CreateSharedLinkAction);

    await clickShare();

    expect(modalManager.show).not.toHaveBeenCalled();
    expect(toastManager.warning).toHaveBeenCalled();
  });

  it('does not open the modal for an unauthenticated viewer, even though ownedAssets falls back to every asset', async () => {
    // AssetMultiSelectManager.ownedAssets returns ALL assets when unauthenticated, so the
    // owned-subset gate has to key off authentication too or it would leak a share button.
    mockUser.current = null as never;
    assetMultiSelectManager.selectAssets([asset('a1', 'someone')]);
    render(CreateSharedLinkAction);

    await clickShare();

    expect(modalManager.show).not.toHaveBeenCalled();
  });
});
