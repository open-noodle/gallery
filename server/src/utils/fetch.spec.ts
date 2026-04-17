import { serverVersion } from 'src/constants';
import { ImmichEnvironment } from 'src/enum';
import { configureUserAgent } from 'src/utils/fetch';

describe('fetch', () => {
  let originalFetch: typeof globalThis.fetch;
  let originalEnv: string | undefined;

  beforeEach(() => {
    originalFetch = globalThis.fetch;
    originalEnv = process.env.IMMICH_ENV;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    process.env.IMMICH_ENV = originalEnv;
  });

  const getUserAgent = async () => {
    const spy = vi.fn().mockResolvedValue(new Response());
    globalThis.fetch = spy;
    configureUserAgent();
    await globalThis.fetch('http://test.local');
    const headers: Headers = spy.mock.calls[0][1].headers;
    return headers.get('User-Agent');
  };

  it('should label production with (prod)', async () => {
    process.env.IMMICH_ENV = ImmichEnvironment.Production;
    expect(await getUserAgent()).toBe(`gallery-server/${serverVersion} (prod)`);
  });

  it('should label development with (dev)', async () => {
    process.env.IMMICH_ENV = ImmichEnvironment.Development;
    expect(await getUserAgent()).toBe(`gallery-server/${serverVersion} (dev)`);
  });

  it('should label testing with (testing)', async () => {
    process.env.IMMICH_ENV = ImmichEnvironment.Testing;
    expect(await getUserAgent()).toBe(`gallery-server/${serverVersion} (testing)`);
  });

  it('should default to (prod) when IMMICH_ENV is unset', async () => {
    delete process.env.IMMICH_ENV;
    expect(await getUserAgent()).toBe(`gallery-server/${serverVersion} (prod)`);
  });
});
