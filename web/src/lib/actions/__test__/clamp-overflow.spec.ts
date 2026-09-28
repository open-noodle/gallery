import { clampOverflow } from '$lib/actions/clamp-overflow';

/**
 * happy-dom has no layout engine, so heights are supplied by the test.
 *
 * They are driven through a mutable `metrics` object behind getters rather than assigned onto the
 * element: `scrollHeight` is `readonly` in lib.dom.d.ts and happy-dom exposes only a getter, so
 * `node.scrollHeight = 100` fails `pnpm check:typescript` even though it would work at runtime.
 */
function makeNode(scrollHeight: number, clientHeight: number) {
  const node = document.createElement('div');
  const metrics = { scrollHeight, clientHeight };
  Object.defineProperties(node, {
    scrollHeight: { configurable: true, get: () => metrics.scrollHeight },
    clientHeight: { configurable: true, get: () => metrics.clientHeight },
  });
  return { node, metrics };
}

/** Measurements run in a microtask; this lets the one queued by the code under test run first. */
const settle = () => Promise.resolve();

let resizeCallback: (() => void) | undefined;
let observe: ReturnType<typeof vi.fn>;
let disconnect: ReturnType<typeof vi.fn>;

beforeEach(() => {
  resizeCallback = undefined;
  observe = vi.fn();
  disconnect = vi.fn();
  vi.stubGlobal(
    'ResizeObserver',
    vi.fn(function (callback: () => void) {
      resizeCallback = callback;
      return { observe, disconnect, unobserve: vi.fn() };
    }),
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('clampOverflow', () => {
  it('A1: reports overflow on mount', async () => {
    const onChange = vi.fn();
    clampOverflow(makeNode(100, 40).node, { onChange });
    await settle();
    expect(onChange).toHaveBeenCalledWith(true);
  });

  it('A2: reports fit on mount without deduping the first call away', async () => {
    const onChange = vi.fn();
    clampOverflow(makeNode(40, 40).node, { onChange });
    await settle();
    expect(onChange).toHaveBeenCalledWith(false);
    expect(onChange).toHaveBeenCalledTimes(1);
  });

  it('A3: measures on mount without waiting for the observer to fire', async () => {
    const onChange = vi.fn();
    clampOverflow(makeNode(100, 40).node, { onChange });
    await settle();
    // The stubbed observer never calls back unless a test does it by hand, so this verdict can only
    // have come from the mount-time measurement.
    expect(resizeCallback).toBeDefined();
    expect(onChange).toHaveBeenCalledWith(true);
  });

  it('A4: treats content shorter than the box as a fit', async () => {
    const onChange = vi.fn();
    clampOverflow(makeNode(39, 40).node, { onChange });
    await settle();
    expect(onChange).toHaveBeenCalledWith(false);
  });

  it('A5: observes the node it was applied to', () => {
    const { node } = makeNode(40, 40);
    clampOverflow(node, { onChange: vi.fn() });
    expect(observe).toHaveBeenCalledWith(node);
  });

  it('A6: re-measures when the observer fires', async () => {
    const { node, metrics } = makeNode(40, 40);
    const onChange = vi.fn();
    clampOverflow(node, { onChange });
    await settle();
    onChange.mockClear();

    metrics.scrollHeight = 100;
    resizeCallback?.();
    await settle();

    expect(onChange).toHaveBeenCalledWith(true);
  });

  it('A7: suppresses unchanged verdicts', async () => {
    const onChange = vi.fn();
    clampOverflow(makeNode(100, 40).node, { onChange });
    await settle();

    resizeCallback?.();
    await settle();
    resizeCallback?.();
    await settle();

    expect(onChange).toHaveBeenCalledTimes(1);
  });

  it('A8: re-measures on update', async () => {
    const { node, metrics } = makeNode(40, 40);
    const onChange = vi.fn();
    const action = clampOverflow(node, { onChange, key: 'short' });
    await settle();
    onChange.mockClear();

    metrics.scrollHeight = 100;
    const onChangeUpdated = vi.fn();
    action.update?.({ onChange: onChangeUpdated, key: 'a much longer name' });
    await settle();

    expect(onChangeUpdated).toHaveBeenCalledWith(true);
    expect(onChange).not.toHaveBeenCalled();
  });

  it('A9: disconnects the observer on destroy', () => {
    const action = clampOverflow(makeNode(40, 40).node, { onChange: vi.fn() });
    action.destroy?.();
    expect(disconnect).toHaveBeenCalled();
  });

  it('A10: tolerates a missing ResizeObserver', async () => {
    vi.stubGlobal('ResizeObserver', undefined);
    const onChange = vi.fn();

    expect(() => clampOverflow(makeNode(100, 40).node, { onChange })).not.toThrow();
    await settle();
    expect(onChange).toHaveBeenCalledWith(true);
  });

  it('A11: takes every pending measurement before reporting any of them (#1125)', async () => {
    // A report can re-render the row (the tooltip wraps it only once it overflows), which is a DOM
    // write. A read after a write forces the browser to lay the page out again, so reads interleaved
    // with reports cost one layout per row — measured at 15s for one keystroke in WebKit with a few
    // thousand tag rows. Batched, the reads share a single layout.
    const events: string[] = [];
    const tracked = (name: string, scrollHeight: number) => {
      const node = document.createElement('div');
      Object.defineProperties(node, {
        scrollHeight: {
          configurable: true,
          get: () => {
            events.push(`read ${name}`);
            return scrollHeight;
          },
        },
        clientHeight: { configurable: true, get: () => 40 },
      });
      return node;
    };

    const reporter = (name: string) => () => {
      events.push(`report ${name}`);
    };
    clampOverflow(tracked('a', 100), { onChange: reporter('a') });
    clampOverflow(tracked('b', 100), { onChange: reporter('b') });
    clampOverflow(tracked('c', 40), { onChange: reporter('c') });

    // Nothing is measured while rows are still being mounted.
    expect(events).toEqual([]);

    await settle();

    expect(events).toEqual(['read a', 'read b', 'read c', 'report a', 'report b', 'report c']);
  });

  it('A12: does not report for a node destroyed before its measurement ran', async () => {
    const onChange = vi.fn();
    const action = clampOverflow(makeNode(100, 40).node, { onChange });
    action.destroy?.();
    await settle();
    expect(onChange).not.toHaveBeenCalled();
  });
});
