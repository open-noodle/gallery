import '@testing-library/jest-dom';
import { render, screen, waitFor } from '@testing-library/svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import InfiniteScrollSentinel from './infinite-scroll-sentinel.svelte';

// The sentinel-only infinite-scroll primitive. Mirrors the controllable-observer + rAF-fallback test harness
// used by people-grid.spec.ts, since the observe/visibility-check logic is the same shape.

type ObserverEntry = Pick<IntersectionObserverEntry, 'target' | 'isIntersecting'>;

const observerInstances: ControllableIntersectionObserver[] = [];
let nextAnimationFrameId = 1;
let pendingAnimationFrames = new Map<number, FrameRequestCallback>();

class ControllableIntersectionObserver implements IntersectionObserver {
  readonly root = null;
  readonly rootMargin = '';
  readonly scrollMargin = '';
  readonly thresholds = [];
  readonly disconnect = vi.fn();
  readonly observe = vi.fn((target: Element) => {
    this.observedTarget = target;
  });
  readonly takeRecords = vi.fn(() => []);
  readonly unobserve = vi.fn();
  observedTarget?: Element;

  constructor(private readonly callback: IntersectionObserverCallback) {
    observerInstances.push(this);
  }

  trigger(entry: ObserverEntry) {
    this.callback([entry as IntersectionObserverEntry], this);
  }
}

describe('InfiniteScrollSentinel', () => {
  beforeEach(() => {
    observerInstances.length = 0;
    nextAnimationFrameId = 1;
    pendingAnimationFrames = new Map();
    vi.stubGlobal('IntersectionObserver', ControllableIntersectionObserver);
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
      const id = nextAnimationFrameId++;
      pendingAnimationFrames.set(id, callback);
      return id;
    });
    vi.stubGlobal('cancelAnimationFrame', (id: number) => pendingAnimationFrames.delete(id));
    // Default: sentinel sits just below the fold, so the visibility fallback never auto-fires.
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({
      top: window.innerHeight + 1,
    } as DOMRect);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  const flushAnimationFrames = () => {
    const callbacks = [...pendingAnimationFrames.values()];
    pendingAnimationFrames.clear();
    for (const callback of callbacks) {
      callback(0);
    }
  };

  it('renders the sentinel only while there are more pages', () => {
    const { rerender } = render(InfiniteScrollSentinel, {
      props: { hasMore: false, onLoadMore: vi.fn() },
    });
    expect(observerInstances).toHaveLength(0);

    void rerender({ hasMore: true, onLoadMore: vi.fn() });
  });

  it('shows the loading label with aria-live while a page is in flight', () => {
    render(InfiniteScrollSentinel, { props: { hasMore: true, loading: true, onLoadMore: vi.fn() } });

    const label = screen.getByText('loading');
    expect(label).toBeInTheDocument();
    expect(label).toHaveAttribute('aria-live', 'polite');
  });

  it('calls onLoadMore when the sentinel intersects while more pages are available', () => {
    const onLoadMore = vi.fn();
    render(InfiniteScrollSentinel, { props: { hasMore: true, onLoadMore } });

    observerInstances[0].trigger({ target: observerInstances[0].observedTarget!, isIntersecting: true });

    expect(onLoadMore).toHaveBeenCalledTimes(1);
  });

  it('does not call onLoadMore when the sentinel is not intersecting', () => {
    const onLoadMore = vi.fn();
    render(InfiniteScrollSentinel, { props: { hasMore: true, onLoadMore } });

    observerInstances[0].trigger({ target: observerInstances[0].observedTarget!, isIntersecting: false });

    expect(onLoadMore).not.toHaveBeenCalled();
  });

  it('does not call onLoadMore while loading', () => {
    const onLoadMore = vi.fn();
    render(InfiniteScrollSentinel, { props: { hasMore: true, loading: true, onLoadMore } });

    observerInstances[0].trigger({ target: observerInstances[0].observedTarget!, isIntersecting: true });

    expect(onLoadMore).not.toHaveBeenCalled();
  });

  it('calls onLoadMore after render when the sentinel is already visible', async () => {
    vi.mocked(HTMLElement.prototype.getBoundingClientRect).mockReturnValue({
      top: window.innerHeight - 1,
    } as DOMRect);
    const onLoadMore = vi.fn();

    render(InfiniteScrollSentinel, { props: { hasMore: true, itemCount: 1, onLoadMore } });
    flushAnimationFrames();

    await waitFor(() => expect(onLoadMore).toHaveBeenCalledTimes(1));
  });

  it('re-checks visibility after the loaded count grows', async () => {
    vi.mocked(HTMLElement.prototype.getBoundingClientRect).mockReturnValue({
      top: window.innerHeight - 1,
    } as DOMRect);
    const onLoadMore = vi.fn();

    const { rerender } = render(InfiniteScrollSentinel, {
      props: { hasMore: true, loading: true, itemCount: 1, onLoadMore },
    });
    expect(onLoadMore).not.toHaveBeenCalled();

    await rerender({ hasMore: true, loading: false, itemCount: 2, onLoadMore });
    flushAnimationFrames();

    await waitFor(() => expect(onLoadMore).toHaveBeenCalledTimes(1));
  });

  it('does not call onLoadMore twice when intersection fires before a pending visibility re-check', () => {
    vi.mocked(HTMLElement.prototype.getBoundingClientRect).mockReturnValue({
      top: window.innerHeight - 1,
    } as DOMRect);
    const onLoadMore = vi.fn();

    render(InfiniteScrollSentinel, { props: { hasMore: true, itemCount: 1, onLoadMore } });

    observerInstances[0].trigger({ target: observerInstances[0].observedTarget!, isIntersecting: true });
    flushAnimationFrames();

    expect(onLoadMore).toHaveBeenCalledTimes(1);
  });

  it('does not observe or call onLoadMore when there are no more pages', () => {
    const onLoadMore = vi.fn();
    render(InfiniteScrollSentinel, { props: { hasMore: false, onLoadMore } });

    expect(observerInstances).toHaveLength(0);
    expect(onLoadMore).not.toHaveBeenCalled();
  });

  it('disconnects the observer when pagination is no longer available', async () => {
    const { rerender } = render(InfiniteScrollSentinel, {
      props: { hasMore: true, onLoadMore: vi.fn() },
    });
    const observer = observerInstances[0];

    await rerender({ hasMore: false, onLoadMore: vi.fn() });

    expect(observer.disconnect).toHaveBeenCalled();
  });

  it('falls back gracefully when IntersectionObserver is unavailable', () => {
    vi.stubGlobal('IntersectionObserver', undefined);
    vi.mocked(HTMLElement.prototype.getBoundingClientRect).mockReturnValue({
      top: window.innerHeight - 1,
    } as DOMRect);
    const onLoadMore = vi.fn();

    render(InfiniteScrollSentinel, { props: { hasMore: true, itemCount: 1, onLoadMore } });
    flushAnimationFrames();

    expect(onLoadMore).toHaveBeenCalledTimes(1);
  });
});
