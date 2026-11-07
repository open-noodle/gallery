import { sdkMock } from '#lib/gallery/__mocks__/sdk.mock.ts';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render } from 'vitest-browser-svelte';
import { page, userEvent } from 'vitest/browser';

// The browser links every static import before any module body runs, so a static import of the
// component would load the real @immich/sdk before sdk.mock.ts registers its vi.mock. Loading it
// after that registration gives it the mocked module.
const { default: SharedLinkCreateModal } = await import('./SharedLinkCreateModal.svelte');

beforeEach(() => {
  // The modal saves through upstream's createSharedLinkMutation (immich-32666), so assert on the SDK
  // call it makes. Not clearMocks: this project's vitest config leaves mock history to leak.
  sdkMock.createSharedLink.mockReset();
  sdkMock.createSharedLink.mockResolvedValue({ id: 'link-1', key: 'key-1' } as never);
});

const submit = async () => {
  await userEvent.click(page.getByRole('button', { name: 'create_link', exact: true }));
};

describe('SharedLinkCreateModal', () => {
  describe('sharing from a space (#1018)', () => {
    it('warns that other members’ photos will become public', async () => {
      await render(SharedLinkCreateModal, {
        props: { onClose: vi.fn(), assetIds: ['a1', 'a2'], spaceId: 'space-1', contributedCount: 2 },
      });

      expect(page.getByTestId('shared-link-contributed-warning').element()).toBeInTheDocument();
    });

    it('warns without a count on an album link, where the contributed share is not known client-side', async () => {
      await render(SharedLinkCreateModal, { props: { onClose: vi.fn(), albumId: 'album-1', spaceId: 'space-1' } });

      expect(page.getByTestId('shared-link-contributed-warning').element()).toBeInTheDocument();
    });

    it('does not warn on an album link outside a space', async () => {
      await render(SharedLinkCreateModal, { props: { onClose: vi.fn(), albumId: 'album-1' } });

      expect(page.getByTestId('shared-link-contributed-warning').query()).not.toBeInTheDocument();
    });

    it('does not warn when the caller owns every selected photo', async () => {
      await render(SharedLinkCreateModal, {
        props: { onClose: vi.fn(), assetIds: ['a1'], spaceId: 'space-1', contributedCount: 0 },
      });

      expect(page.getByTestId('shared-link-contributed-warning').query()).not.toBeInTheDocument();
    });

    it('sends the space with the link so the server authorizes against it', async () => {
      await render(SharedLinkCreateModal, {
        props: { onClose: vi.fn(), assetIds: ['a1', 'a2'], spaceId: 'space-1', contributedCount: 1 },
      });

      await submit();

      await vi.waitFor(() =>
        expect(sdkMock.createSharedLink).toHaveBeenCalledWith({
          sharedLinkCreateDto: expect.objectContaining({ spaceId: 'space-1' }),
        }),
      );
    });
  });

  describe('sharing from outside a space', () => {
    it('sends no space', async () => {
      await render(SharedLinkCreateModal, { props: { onClose: vi.fn(), assetIds: ['a1'] } });

      await submit();

      await vi.waitFor(() =>
        expect(sdkMock.createSharedLink).toHaveBeenCalledWith({
          sharedLinkCreateDto: expect.objectContaining({ spaceId: undefined }),
        }),
      );
    });

    it('keeps reporting assets narrowed out of the selection', async () => {
      await render(SharedLinkCreateModal, { props: { onClose: vi.fn(), assetIds: ['a1'], excludedCount: 2 } });

      expect(page.getByTestId('shared-link-excluded-notice').element()).toBeInTheDocument();
      expect(page.getByTestId('shared-link-contributed-warning').query()).not.toBeInTheDocument();
    });
  });
});
