import '@testing-library/jest-dom';
import { render, screen } from '@testing-library/svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';
import ReadOnlyDemoNotice from './ReadOnlyDemoNotice.svelte';

const mockAuthManager = vi.hoisted(() => ({
  isReadOnlyDemo: false,
}));

vi.mock('$lib/managers/auth-manager.svelte', () => ({
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

  it('renders the read-only demo notice for demo preview users', () => {
    mockAuthManager.isReadOnlyDemo = true;

    render(ReadOnlyDemoNotice);

    expect(screen.getByText('Read-only demo')).toBeInTheDocument();
    expect(screen.getByText(/Changes are disabled/i)).toBeInTheDocument();
  });

  it('does not render for normal users and real admins', () => {
    render(ReadOnlyDemoNotice);

    expect(screen.queryByText('Read-only demo')).not.toBeInTheDocument();
  });
});
