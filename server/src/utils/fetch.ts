import { serverVersion } from 'src/constants';
import { ImmichEnvironment } from 'src/enum';

const environmentLabel: Record<ImmichEnvironment, string> = {
  [ImmichEnvironment.Development]: 'dev',
  [ImmichEnvironment.Testing]: 'testing',
  [ImmichEnvironment.Production]: 'prod',
};

export function configureUserAgent() {
  const env = (process.env.IMMICH_ENV as ImmichEnvironment) || ImmichEnvironment.Production;
  const label = environmentLabel[env] ?? environmentLabel[ImmichEnvironment.Production];
  const userAgent = `gallery-server/${serverVersion} (${label})`;
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (input, init) => {
    const headers = new Headers(init?.headers);
    if (!headers.has('User-Agent')) {
      headers.set('User-Agent', userAgent);
    }
    return originalFetch(input, { ...init, headers });
  };
}
