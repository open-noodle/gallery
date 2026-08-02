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
  it('A1: reports overflow on mount', () => {
    const onChange = vi.fn();
    clampOverflow(makeNode(100, 40).node, { onChange });
    expect(onChange).toHaveBeenCalledWith(true);
  });

  it('A2: reports fit on mount without deduping the first call away', () => {
    const onChange = vi.fn();
    clampOverflow(makeNode(40, 40).node, { onChange });
    expect(onChange).toHaveBeenCalledWith(false);
    expect(onChange).toHaveBeenCalledTimes(1);
  });

  it('A3: measures before the observer is even wired up', () => {
    const onChange = vi.fn();
    clampOverflow(makeNode(100, 40).node, { onChange });
    // Ordering, not just occurrence: the mount verdict must not depend on the observer firing.
    expect(onChange.mock.invocationCallOrder[0]).toBeLessThan(observe.mock.invocationCallOrder[0]);
  });

  it('A4: treats content shorter than the box as a fit', () => {
    const onChange = vi.fn();
    clampOverflow(makeNode(39, 40).node, { onChange });
    expect(onChange).toHaveBeenCalledWith(false);
  });

  it('A5: observes the node it was applied to', () => {
    const { node } = makeNode(40, 40);
    clampOverflow(node, { onChange: vi.fn() });
    expect(observe).toHaveBeenCalledWith(node);
  });

  it('A6: re-measures when the observer fires', () => {
    const { node, metrics } = makeNode(40, 40);
    const onChange = vi.fn();
    clampOverflow(node, { onChange });
    onChange.mockClear();

    metrics.scrollHeight = 100;
    resizeCallback?.();

    expect(onChange).toHaveBeenCalledWith(true);
  });

  it('A7: suppresses unchanged verdicts', () => {
    const onChange = vi.fn();
    clampOverflow(makeNode(100, 40).node, { onChange });

    resizeCallback?.();
    resizeCallback?.();

    expect(onChange).toHaveBeenCalledTimes(1);
  });

  it('A8: re-measures on update', () => {
    const { node, metrics } = makeNode(40, 40);
    const onChange = vi.fn();
    const action = clampOverflow(node, { onChange, key: 'short' });
    onChange.mockClear();

    metrics.scrollHeight = 100;
    const onChangeUpdated = vi.fn();
    action.update?.({ onChange: onChangeUpdated, key: 'a much longer name' });

    expect(onChangeUpdated).toHaveBeenCalledWith(true);
    expect(onChange).not.toHaveBeenCalled();
  });

  it('A9: disconnects the observer on destroy', () => {
    const action = clampOverflow(makeNode(40, 40).node, { onChange: vi.fn() });
    action.destroy?.();
    expect(disconnect).toHaveBeenCalled();
  });

  it('A10: tolerates a missing ResizeObserver', () => {
    vi.stubGlobal('ResizeObserver', undefined);
    const onChange = vi.fn();

    expect(() => clampOverflow(makeNode(100, 40).node, { onChange })).not.toThrow();
    expect(onChange).toHaveBeenCalledWith(true);
  });
});
