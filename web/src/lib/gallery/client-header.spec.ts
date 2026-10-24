import { defaults } from '@immich/sdk';
import { queryClient } from '$lib/queries/client';
import { getServerConfigQuery } from '$lib/queries/server.query';
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
vi.mock('$lib/managers/auth-manager.svelte', () => ({ authManager: { load: vi.fn() } }));
vi.mock('$lib/utils', () => ({ initLanguage: vi.fn() }));

describe('Gallery client header', () => {
  it('is sent on every SDK request', async () => {
    // init() reads the server config through the query client; maintenance mode skips the other loads.
    queryClient.setQueryData(getServerConfigQuery().queryKey, { maintenanceMode: true } as never);
    await init(fetch);
    expect(defaults.headers).toMatchObject({ 'x-gallery-app': version });
  });

  it('is sent in the websocket handshake', () => {
    expect(ioOptions).toEqual([expect.objectContaining({ auth: { 'x-gallery-app': version } })]);
  });
});
