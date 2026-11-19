import { afterEach, describe, expect, it, vi } from 'vitest';
import { render } from 'vitest-browser-svelte';
import { page } from 'vitest/browser';
import ReadOnlyDemoNotice from './ReadOnlyDemoNotice.svelte';

const mockAuthManager = vi.hoisted(() => ({
  isReadOnlyDemo: false,
}));

vi.mock('#lib/managers/auth-manager.svelte.ts', () => ({
  authManager: {
    get isReadOnlyDemo() {
      return mockAuthManager.isReadOnlyDemo;
    },
  },
}));

describe('ReadOnlyDemoNotice', () => {
  afterEach(() => {
    mockAuthManager.isReadOnlyDemo = false;
  });

  it('renders the read-only demo notice for demo preview users', async () => {
    mockAuthManager.isReadOnlyDemo = true;

    await render(ReadOnlyDemoNotice);

    await expect.element(page.getByText('Read-only demo')).toBeInTheDocument();
    await expect.element(page.getByText(/Changes are disabled/i)).toBeInTheDocument();
  });

  it('does not render for normal users and real admins', async () => {
    await render(ReadOnlyDemoNotice);

    await expect.element(page.getByText('Read-only demo')).not.toBeInTheDocument();
  });
});
