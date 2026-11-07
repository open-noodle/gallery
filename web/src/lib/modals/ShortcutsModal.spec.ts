import { describe, expect, it, vi } from 'vitest';
import { render } from 'vitest-browser-svelte';
import { page } from 'vitest/browser';
import ShortcutsModal from './ShortcutsModal.svelte';

vi.mock('#lib/managers/auth-manager.svelte.js', () => ({
  authManager: {
    authenticated: false,
    preferences: { ratings: { enabled: false } },
  },
}));

describe('ShortcutsModal', () => {
  it('uses the Gallery logo in the modal header', async () => {
    await render(ShortcutsModal, { onClose: vi.fn() });

    await expect.element(page.getByRole('img', { name: 'Gallery logo' })).toBeInTheDocument();
    expect(page.getByRole('img', { name: 'Immich logo' }).query()).toBeNull();
  });
});
