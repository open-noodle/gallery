import { authManager } from '#lib/managers/auth-manager.svelte.ts';
import { queryClient } from '#lib/queries/client.ts';
import { getPublicConfigQuery } from '#lib/queries/config-public.query.ts';
import { getServerConfigQuery } from '#lib/queries/server-info.query.ts';
import PageHost from '#test/unit/mocks/PageHost.svelte';
import { demoLogin } from '@immich/sdk';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render } from 'vitest-browser-svelte';
import { page } from 'vitest/browser';
import { goto } from '$app/navigation';
import LoginPage from './+page.svelte';

const { mockAuthManager, mockEventManager, mockUser } = vi.hoisted(() => ({
  mockAuthManager: { isDemo: false },
  mockEventManager: { emit: vi.fn(), on: vi.fn() },
  mockUser: { accessToken: 'token', isAdmin: false, isOnboarded: true, shouldChangePassword: false },
}));

vi.mock('$app/navigation', async () => ({
  ...(await import('#test/unit/mocks/app-navigation.ts')),
  goto: vi.fn().mockResolvedValue(undefined),
}));

vi.mock(import('#lib/managers/auth-manager.svelte.ts'), () => ({
  authManager: mockAuthManager as never,
}));

vi.mock(import('#lib/managers/event-manager.svelte.ts'), () => ({
  eventManager: mockEventManager as never,
}));

vi.mock('@immich/sdk', async (original) => {
  const actual = await original<typeof import('@immich/sdk')>();
  return {
    ...actual,
    demoLogin: vi.fn(),
    login: vi.fn(),
  };
});

// The page reads both configs through createPreloadedQuery, so they must already sit in the query cache,
// exactly as the root layout's load leaves them.
const seedConfig = ({ demoMode, demoAutoLogin }: { demoMode: boolean; demoAutoLogin: boolean }) => {
  queryClient.setQueryData(getPublicConfigQuery().queryKey, {
    oauth: { enabled: true, autoLaunch: false, buttonText: 'Login with OAuth' },
    passwordLogin: { enabled: true },
    passkey: { enabled: false },
    server: { loginPageMessage: '' },
  } as never);
  queryClient.setQueryData(getServerConfigQuery().queryKey, {
    demoAutoLogin,
    demoMode,
    isInitialized: true,
    isOnboarded: true,
    loginPageMessage: '',
    maintenanceMode: false,
    oauthButtonText: 'Login with OAuth',
  } as never);
};

// PageHost supplies the QueryClientProvider the page's passkey mutation needs, as the root layout does.
const renderLoginPage = () =>
  render(PageHost, {
    component: LoginPage as never,
    data: { continueUrl: '/photos', meta: { title: 'Login' } },
    params: {},
    client: queryClient,
  });

describe('LoginPage demo mode', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockAuthManager.isDemo = false;
    vi.mocked(demoLogin).mockResolvedValue(mockUser as never);
  });

  it('shows only the Try Demo button when manual demo login is enabled', async () => {
    seedConfig({ demoMode: true, demoAutoLogin: false });

    await renderLoginPage();

    await expect.element(page.getByRole('button', { name: 'Try Demo' })).toBeInTheDocument();
    await expect.element(page.getByLabelText('email')).not.toBeInTheDocument();
    await expect.element(page.getByLabelText('password')).not.toBeInTheDocument();
    await expect.element(page.getByRole('button', { name: 'Login with OAuth' })).not.toBeInTheDocument();
    expect(demoLogin).not.toHaveBeenCalled();
  });

  it('keeps the standard login and no Try Demo button outside demo mode', async () => {
    seedConfig({ demoMode: false, demoAutoLogin: false });

    await renderLoginPage();

    await expect.element(page.getByLabelText('email')).toBeInTheDocument();
    await expect.element(page.getByRole('button', { name: 'Try Demo' })).not.toBeInTheDocument();
  });

  it('logs in as the demo user automatically when demo auto-login is enabled', async () => {
    seedConfig({ demoMode: true, demoAutoLogin: true });

    await renderLoginPage();

    await vi.waitFor(() => expect(demoLogin).toHaveBeenCalledTimes(1));
    expect(authManager.isDemo).toBe(true);
    await vi.waitFor(() => expect(goto).toHaveBeenCalledWith('/photos', { refreshAll: true }));
  });
});
