import { redirect } from '@sveltejs/kit';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { authenticate } from './auth';

const mockAuthManager = vi.hoisted(() => ({
  authenticated: true,
  canPreviewAdmin: false,
  load: vi.fn(),
}));

vi.mock('$lib/managers/auth-manager.svelte', () => ({
  authManager: {
    load: mockAuthManager.load,
    get authenticated() {
      return mockAuthManager.authenticated;
    },
    get canPreviewAdmin() {
      return mockAuthManager.canPreviewAdmin;
    },
  },
}));

vi.mock('@sveltejs/kit', () => ({
  redirect: vi.fn((status: number, location: string) => {
    throw Object.assign(new Error('redirect'), { status, location });
  }),
}));

describe('authenticate admin preview guard', () => {
  beforeEach(() => {
    mockAuthManager.authenticated = true;
    mockAuthManager.canPreviewAdmin = false;
    mockAuthManager.load.mockReset();
    vi.mocked(redirect).mockClear();
  });

  it('allows demo preview users into admin routes', async () => {
    mockAuthManager.canPreviewAdmin = true;

    await expect(authenticate(new URL('https://gallery.test/admin/users'), { admin: true })).resolves.toBeUndefined();
    expect(redirect).not.toHaveBeenCalled();
  });

  it('allows real admins into admin routes', async () => {
    mockAuthManager.canPreviewAdmin = true;

    await expect(authenticate(new URL('https://gallery.test/admin/users'), { admin: true })).resolves.toBeUndefined();
    expect(redirect).not.toHaveBeenCalled();
  });

  it('redirects normal non-admin users away from admin routes', async () => {
    await expect(authenticate(new URL('https://gallery.test/admin/users'), { admin: true })).rejects.toMatchObject({
      status: 307,
      location: '/photos',
    });
  });

  it('redirects unauthenticated users to login before admin preview checks', async () => {
    mockAuthManager.authenticated = false;

    await expect(
      authenticate(new URL('https://gallery.test/admin/users?tab=all'), { admin: true }),
    ).rejects.toMatchObject({
      status: 307,
      location: '/auth/login?continue=%2Fadmin%2Fusers%3Ftab%3Dall',
    });
  });
});
