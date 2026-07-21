import { init } from 'svelte-i18n';

// Node.js 25+ exposes a native globalThis.localStorage that lacks Web Storage API methods
// (getItem, setItem, etc.), breaking svelte-persisted-store. Provide a proper implementation.
function createStorage(): Storage {
  let store: Record<string, string> = {};
  return {
    getItem: (key: string) => (Object.hasOwn(store, key) ? store[key] : null),
    setItem: (key: string, value: string) => {
      store[key] = value;
    },
    removeItem: (key: string) => {
      delete store[key];
    },
    clear: () => {
      store = {};
    },
    key: (index: number) => Object.keys(store)[index] ?? null,
    get length() {
      return Object.keys(store).length;
    },
  };
}

if (typeof globalThis.localStorage?.getItem !== 'function') {
  const ls = createStorage();
  const ss = createStorage();
  Object.defineProperties(globalThis, {
    localStorage: { value: ls, writable: true, configurable: true },
    sessionStorage: { value: ss, writable: true, configurable: true },
  });
  if (globalThis.window !== undefined) {
    Object.defineProperties(globalThis, {
      localStorage: { value: ls, writable: true, configurable: true },
      sessionStorage: { value: ss, writable: true, configurable: true },
    });
  }
}

beforeAll(async () => {
  await init({ fallbackLocale: 'dev' });
});

vi.mock('$app/env', () => ({ browser: true, dev: true, building: false, version: 'test' }));
vi.mock('$app/navigation', () => import('#test/unit/mocks/app-navigation.ts'));
vi.mock('$app/state', () => import('#test/unit/mocks/app-state.svelte.ts'));

vi.mock('$app/env/public', () => ({
  PUBLIC_IMMICH_BUY_HOST: 'https://buy.immich.app',
  PUBLIC_IMMICH_PAY_HOST: 'https://pay.futo.org',
}));

vi.mock('$env/dynamic/public', () => ({
  env: {
    PUBLIC_IMMICH_HOSTNAME: '',
  },
}));
