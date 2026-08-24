import '@testing-library/jest-dom';
import { cleanup, render, screen } from '@testing-library/svelte';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import SharedLinkCreateModal from './SharedLinkCreateModal.svelte';

const handleCreateSharedLinkMock = vi.hoisted(() => vi.fn());
vi.mock('$lib/services/shared-link.service', () => ({ handleCreateSharedLink: handleCreateSharedLinkMock }));

beforeEach(() => {
  // Not clearMocks: this project's vitest config leaves mock history to leak across a file.
  handleCreateSharedLinkMock.mockReset();
  handleCreateSharedLinkMock.mockResolvedValue(true);
});

// `FormModal` mounts a bits-ui dialog whose body scroll lock releases on a 24ms timer; if the
// file ends inside that window happy-dom is already torn down and the timer throws an unhandled
// error. Same drain as AlbumEditModal.spec.ts.
afterEach(async () => {
  cleanup();
  await new Promise((resolve) => setTimeout(resolve, 30));
});

const submit = async () => {
  const user = userEvent.setup();
  await user.click(screen.getByRole('button', { name: 'create_link' }));
};

describe('SharedLinkCreateModal', () => {
  describe('sharing from a space (#1018)', () => {
    it('warns that other members’ photos will become public', () => {
      render(SharedLinkCreateModal, {
        props: { onClose: vi.fn(), assetIds: ['a1', 'a2'], spaceId: 'space-1', contributedCount: 2 },
      });

      expect(screen.getByTestId('shared-link-contributed-warning')).toBeInTheDocument();
    });

    it('warns without a count on an album link, where the contributed share is not known client-side', () => {
      render(SharedLinkCreateModal, { props: { onClose: vi.fn(), albumId: 'album-1', spaceId: 'space-1' } });

      expect(screen.getByTestId('shared-link-contributed-warning')).toBeInTheDocument();
    });

    it('does not warn on an album link outside a space', () => {
      render(SharedLinkCreateModal, { props: { onClose: vi.fn(), albumId: 'album-1' } });

      expect(screen.queryByTestId('shared-link-contributed-warning')).not.toBeInTheDocument();
    });

    it('does not warn when the caller owns every selected photo', () => {
      render(SharedLinkCreateModal, {
        props: { onClose: vi.fn(), assetIds: ['a1'], spaceId: 'space-1', contributedCount: 0 },
      });

      expect(screen.queryByTestId('shared-link-contributed-warning')).not.toBeInTheDocument();
    });

    it('sends the space with the link so the server authorizes against it', async () => {
      render(SharedLinkCreateModal, {
        props: { onClose: vi.fn(), assetIds: ['a1', 'a2'], spaceId: 'space-1', contributedCount: 1 },
      });

      await submit();

      expect(handleCreateSharedLinkMock).toHaveBeenCalledWith(expect.objectContaining({ spaceId: 'space-1' }));
    });
  });

  describe('sharing from outside a space', () => {
    it('sends no space', async () => {
      render(SharedLinkCreateModal, { props: { onClose: vi.fn(), assetIds: ['a1'] } });

      await submit();

      expect(handleCreateSharedLinkMock).toHaveBeenCalledWith(expect.objectContaining({ spaceId: undefined }));
    });

    it('keeps reporting assets narrowed out of the selection', () => {
      render(SharedLinkCreateModal, { props: { onClose: vi.fn(), assetIds: ['a1'], excludedCount: 2 } });

      expect(screen.getByTestId('shared-link-excluded-notice')).toBeInTheDocument();
      expect(screen.queryByTestId('shared-link-contributed-warning')).not.toBeInTheDocument();
    });
  });
});
