import { describe, expect, it, vi } from 'vitest';
import { init } from './server';

const mocks = vi.hoisted(() => ({
  authManager: { isDemo: false, load: vi.fn() },
  featureFlagsManager: { init: vi.fn() },
  serverConfigManager: {
    value: { demoMode: true, maintenanceMode: false },
    init: vi.fn(),
  },
  initLanguage: vi.fn(),
}));

vi.mock('$lib/managers/auth-manager.svelte', () => ({ authManager: mocks.authManager }));
vi.mock('$lib/managers/feature-flags-manager.svelte', () => ({ featureFlagsManager: mocks.featureFlagsManager }));
vi.mock('$lib/managers/server-config-manager.svelte', () => ({ serverConfigManager: mocks.serverConfigManager }));
vi.mock('$lib/utils', () => ({ initLanguage: mocks.initLanguage }));
vi.mock('@immich/sdk', () => ({ defaults: {} }));

describe('server init demo mode', () => {
  it('marks the auth manager as demo before loading an existing session', async () => {
    await init(vi.fn() as never);

    expect(mocks.serverConfigManager.init).toHaveBeenCalled();
    expect(mocks.authManager.isDemo).toBe(true);
    expect(mocks.authManager.load).toHaveBeenCalled();
  });
});
