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
//
// bits-ui's dismissable layer (popovers, menus) has the same shape with a longer fuse: its
// "interact outside" handler is debounced by 500ms, so a spec whose last test clicks while a layer
// is open can finish with that timer pending, and it then fails on `Element` instead of `document`.
// Nothing in the DOM shows it is pending, so this one cannot be drained by waiting on a signal.
// Instead every timeout set during the file is tracked, and whatever is still pending once the
// drain above has run is cancelled: every test has finished by then, so no assertion can depend on
// it.
const pendingTimeouts = new Set<ReturnType<typeof setTimeout>>();
const nativeSetTimeout = setTimeout;
const nativeClearTimeout = clearTimeout;
const trackedSetTimeout = ((handler: TimerHandler, timeout?: number, ...args: unknown[]) => {
  if (typeof handler !== 'function') {
    return nativeSetTimeout(handler, timeout, ...args);
  }
  const id = nativeSetTimeout(() => {
    pendingTimeouts.delete(id);
    handler(...args);
  }, timeout);
  pendingTimeouts.add(id);
  return id;
}) as typeof setTimeout;
const trackedClearTimeout = ((id?: Parameters<typeof clearTimeout>[0]) => {
  pendingTimeouts.delete(id as ReturnType<typeof setTimeout>);
  nativeClearTimeout(id);
}) as typeof clearTimeout;
// Defined rather than stubbed: specs call `vi.unstubAllGlobals()`, which would drop a stub.
Object.defineProperties(globalThis, {
  setTimeout: { value: trackedSetTimeout, writable: true, configurable: true },
  clearTimeout: { value: trackedClearTimeout, writable: true, configurable: true },
});

afterAll(async () => {
  if (typeof document === 'undefined') {
    return;
  }

  for (let i = 0; i < 20 && document.body.style.overflow === 'hidden'; i++) {
    await new Promise((resolve) => setTimeout(resolve, 25));
  }

  for (const id of pendingTimeouts) {
    nativeClearTimeout(id);
  }
  pendingTimeouts.clear();
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
