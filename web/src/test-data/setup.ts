import '@testing-library/jest-dom';
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
  Element.prototype.animate = vi.fn().mockImplementation(function () {
    return { cancel: () => {}, finished: Promise.resolve() };
  });
});

// bits-ui's body-scroll-lock does not release the body style when the locking component
// unmounts — it schedules the reset on a ~24ms `window.setTimeout` so a modal that closes and
// reopens in the same tick keeps its styles. A spec whose components render a modal therefore
// finishes with that timer still pending, and if vitest tears the happy-dom environment down
// first, the callback dereferences a `document` that no longer exists. Vitest surfaces that as
// an unhandled "ReferenceError: document is not defined" and fails the run even though every
// test passed — intermittent, because it is a race between the timer and teardown.
//
// Drain it here, while the DOM is still alive. `overflow: hidden` is set on the body for as long
// as a lock is outstanding and cleared by the deferred reset, so a spec that never opens a modal
// pays nothing. The iteration cap keeps a spec that sets that style for its own reasons from
// stalling the file.
afterAll(async () => {
  if (typeof document === 'undefined') {
    return;
  }

  for (let i = 0; i < 20 && document.body.style.overflow === 'hidden'; i++) {
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
});

Object.defineProperty(globalThis, 'matchMedia', {
  writable: true,
  value: vi.fn().mockImplementation(function (query) {
    return {
      matches: false,
      media: query,
      onchange: null,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    };
  }),
});

vi.mock('$env/dynamic/public', () => {
  return {
    env: {
      PUBLIC_IMMICH_HOSTNAME: '',
    },
  };
});
