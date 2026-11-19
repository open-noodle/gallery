import { init } from '#lib/utils/client.ts';
import { describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  authManager: { isDemo: false, load: vi.fn() },
  featureFlagsManager: { init: vi.fn() },
  query: vi.fn((options: { queryKey: string[] }) =>
    Promise.resolve(options.queryKey.join('/') === 'server/config' ? { demoMode: true, maintenanceMode: false } : {}),
  ),
  initLanguage: vi.fn(),
}));

vi.mock('#lib/managers/auth-manager.svelte.ts', () => ({ authManager: mocks.authManager }));
vi.mock('#lib/managers/feature-flags-manager.svelte.ts', () => ({ featureFlagsManager: mocks.featureFlagsManager }));
vi.mock('#lib/queries/client.ts', () => ({ queryClient: { query: mocks.query } }));
vi.mock('#lib/queries/server-info.query.ts', () => ({
  getServerConfigQuery: () => ({ queryKey: ['server', 'config'] }),
}));
vi.mock('#lib/queries/config-public.query.ts', () => ({
  getPublicConfigQuery: () => ({ queryKey: ['config', 'public'] }),
}));
vi.mock('#lib/utils.ts', () => ({ initLanguage: mocks.initLanguage }));
vi.mock('@immich/sdk', () => ({ setFetch: vi.fn(), setHeaders: vi.fn() }));

describe('client init demo mode', () => {
  it('marks the auth manager as demo before loading an existing session', async () => {
    await init(vi.fn() as never);

    expect(mocks.authManager.isDemo).toBe(true);
    expect(mocks.authManager.load).toHaveBeenCalled();
  });
});
