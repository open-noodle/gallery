import { render } from '@testing-library/svelte';
import { createRawSnippet, flushSync } from 'svelte';
import LazyChunks from '$lib/components/shared-components/lazy-chunks.svelte';

describe('LazyChunks', () => {
  let report: (entries: Array<{ target: Element; isIntersecting: boolean }>) => void;

  beforeEach(() => {
    vi.stubGlobal(
      'IntersectionObserver',
      vi.fn(function (callback: typeof report) {
        report = callback;
        return { observe: vi.fn(), unobserve: vi.fn(), disconnect: vi.fn() };
      }),
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  const chunk = createRawSnippet((items: () => number[]) => ({ render: () => `<p>${items().join(',')}</p>` }));
  const renderChunks = () =>
    render(LazyChunks, {
      items: Array.from({ length: 10 }, (_, i) => i),
      chunkSize: 4,
      estimateHeight: (count: number) => count * 10,
      chunk,
    });

  it('mounts only the chunks near the viewport, following the observer as it scrolls', () => {
    // Chunk 0 starts on screen; the others start far below it.
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
      const top = Number(this.dataset.chunk) * 10_000;
      return { top, bottom: top + 100 } as DOMRect;
    });
    const { container } = renderChunks();
    const chunks = [...container.querySelectorAll<HTMLElement>('[data-chunk]')];

    expect(chunks).toHaveLength(3);
    expect(chunks.map((element) => element.textContent?.trim())).toEqual(['0,1,2,3', '', '']);
    expect(chunks[2].style.height).toBe('20px');

    report([{ target: chunks[2], isIntersecting: true }]);
    flushSync();
    expect(chunks[2].textContent?.trim()).toBe('8,9');
    expect(chunks[2].style.height).toBe('');

    report([{ target: chunks[0], isIntersecting: false }]);
    flushSync();
    expect(chunks[0].textContent?.trim()).toBe('');
  });
});
