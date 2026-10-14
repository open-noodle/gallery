import { defaults } from '@immich/sdk';
import '$lib/stores/websocket';
import { init } from '$lib/utils/server';
import { version } from '../../../package.json';

// captured outside vi.fn: the test setup resets mock call history before each test
const ioOptions = vi.hoisted(() => [] as unknown[]);
vi.mock('socket.io-client', () => {
  const socket = { on: () => socket };
  return {
    io: (options: unknown) => {
      ioOptions.push(options);
      return socket;
    },
  };
});
vi.mock('$lib/managers/server-config-manager.svelte', () => ({
  serverConfigManager: { init: vi.fn(), value: { maintenanceMode: true } },
}));
vi.mock('$lib/managers/auth-manager.svelte', () => ({ authManager: { load: vi.fn() } }));
vi.mock('$lib/utils', () => ({ initLanguage: vi.fn() }));

describe('Gallery client header', () => {
  it('is sent on every SDK request', async () => {
    await init(fetch);
    expect(defaults.headers).toMatchObject({ 'x-gallery-app': version });
  });

  it('is sent in the websocket handshake', () => {
    expect(ioOptions).toEqual([expect.objectContaining({ auth: { 'x-gallery-app': version } })]);
  });
});
