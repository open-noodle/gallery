import { demoLogin } from '@immich/sdk';
import { render, screen, waitFor } from '@testing-library/svelte';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { goto } from '$app/navigation';
import { authManager } from '$lib/managers/auth-manager.svelte';
import LoginPage from './+page.svelte';

const { mockAuthManager, mockEventManager, mockFeatureFlags, mockOauth, mockServerConfig, mockUser, gotoMock } =
  vi.hoisted(() => ({
    mockAuthManager: { isDemo: false },
    mockEventManager: { emit: vi.fn(), on: vi.fn() },
    mockFeatureFlags: { oauth: false, oauthAutoLaunch: false, passwordLogin: true },
    mockOauth: {
      authorize: vi.fn(),
      isAutoLaunchDisabled: vi.fn(() => false),
      isAutoLaunchEnabled: vi.fn(() => false),
      isCallback: vi.fn(() => false),
      login: vi.fn(),
    },
    mockServerConfig: {
      demoAutoLogin: false,
      demoMode: false,
      isOnboarded: true,
      loginPageMessage: '',
      oauthButtonText: 'Login with OAuth',
    },
    mockUser: { accessToken: 'token', isAdmin: false, isOnboarded: true, shouldChangePassword: false },
    gotoMock: vi.fn().mockResolvedValue(undefined),
  }));

vi.mock('$app/navigation', () => ({ goto: gotoMock }));

vi.mock(import('$lib/managers/auth-manager.svelte'), () => ({
  authManager: mockAuthManager as never,
}));

vi.mock(import('$lib/managers/event-manager.svelte'), () => ({
  eventManager: mockEventManager as never,
}));

vi.mock(import('$lib/managers/feature-flags-manager.svelte'), () => ({
  featureFlagsManager: {
    get value() {
      return mockFeatureFlags;
    },
  } as never,
}));

vi.mock(import('$lib/managers/server-config-manager.svelte'), () => ({
  serverConfigManager: {
    get value() {
      return mockServerConfig;
    },
  } as never,
}));

vi.mock('$lib/utils', () => ({ oauth: mockOauth }));

vi.mock('@immich/sdk', async (original) => {
  const actual = await original<typeof import('@immich/sdk')>();
  return {
    ...actual,
    demoLogin: vi.fn(),
    login: vi.fn(),
  };
});

const renderLoginPage = () =>
  render(LoginPage, {
    data: {
      error: undefined,
      continueUrl: '/photos',
      meta: { title: 'Login' },
    },
  });

describe('LoginPage demo mode', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockAuthManager.isDemo = false;
    mockFeatureFlags.oauth = true;
    mockFeatureFlags.oauthAutoLaunch = false;
    mockFeatureFlags.passwordLogin = true;
    mockServerConfig.demoAutoLogin = false;
    mockServerConfig.demoMode = false;
    mockServerConfig.loginPageMessage = '';
    mockServerConfig.oauthButtonText = 'Login with OAuth';
    vi.mocked(demoLogin).mockResolvedValue(mockUser as never);
  });

  it('shows only the Try Demo button when manual demo login is enabled', () => {
    mockServerConfig.demoMode = true;

    renderLoginPage();

    expect(screen.getByRole('button', { name: 'Try Demo' })).toBeInTheDocument();
    expect(screen.queryByLabelText('email')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('password')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Login with OAuth' })).not.toBeInTheDocument();
    expect(demoLogin).not.toHaveBeenCalled();
  });

  it('logs in as the demo user automatically when demo auto-login is enabled', async () => {
    mockServerConfig.demoAutoLogin = true;
    mockServerConfig.demoMode = true;

    renderLoginPage();

    await waitFor(() => expect(demoLogin).toHaveBeenCalledTimes(1));
    expect(authManager.isDemo).toBe(true);
    expect(goto).toHaveBeenCalledWith('/photos', { invalidateAll: true });
  });
});
