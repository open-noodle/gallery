import { crossfadeNavigation, nameSharedElements, shouldCrossfade } from '$lib/gallery/motion/page-transition';

const at = (id: string, params: Record<string, string> = {}) => ({ route: { id }, params, url: new URL('http://x') });

describe('shouldCrossfade', () => {
  it('crossfades between sections', () => {
    expect(
      shouldCrossfade({ from: at('/(user)/photos/[[assetId=id]]'), to: at('/(user)/albums'), willUnload: false }),
    ).toBe(true);
  });

  it('swaps instantly within a page (filters, queries)', () => {
    expect(shouldCrossfade({ from: at('/(user)/search'), to: at('/(user)/search'), willUnload: false })).toBe(false);
  });

  it('leaves the asset viewer to its own motion', () => {
    expect(
      shouldCrossfade({
        from: at('/(user)/albums'),
        to: at('/(user)/albums/[albumId=id]/[[photos=photos]]/[[assetId=id]]', { assetId: 'a1' }),
        willUnload: false,
      }),
    ).toBe(false);
    expect(
      shouldCrossfade({
        from: at('/(user)/search/[[photos=photos]]/[[assetId=id]]', { assetId: 'a1' }),
        to: at('/(user)/albums'),
        willUnload: false,
      }),
    ).toBe(false);
  });

  it('skips full page loads', () => {
    expect(shouldCrossfade({ from: at('/a'), to: at('/b'), willUnload: true })).toBe(false);
  });
});

describe('shared elements', () => {
  afterEach(() => {
    document.body.innerHTML = '';
    vi.unstubAllGlobals();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    delete (document as any).startViewTransition;
  });

  it('names shared elements and clears them', () => {
    document.body.innerHTML = '<div data-shared-element="cleanup-day-photos"></div>';
    const clear = nameSharedElements(document);
    const element = document.querySelector<HTMLElement>('[data-shared-element]')!;
    expect(element.style.viewTransitionName).toBe('cleanup-day-photos');
    clear();
    expect(element.style.viewTransitionName).toBe('');
  });

  it('names the old page before the transition starts and the new page after it navigated', async () => {
    vi.stubGlobal('matchMedia', () => ({ matches: false }));
    document.body.innerHTML = '<div id="old" data-shared-element="cleanup-day-title"></div>';
    let namedAtStart = '';
    let update: (() => Promise<void>) | undefined;
    let finish!: () => void;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (document as any).startViewTransition = (callback: () => Promise<void>) => {
      namedAtStart = document.querySelector<HTMLElement>('#old')!.style.viewTransitionName;
      update = callback;
      return { finished: new Promise<void>((resolve) => (finish = resolve)) };
    };
    let complete!: () => void;
    const navigation = {
      from: at('/(user)/utilities/cleanup'),
      to: at('/(user)/utilities/cleanup/rewind/[monthDay]'),
      willUnload: false,
      complete: new Promise<void>((resolve) => (complete = resolve)),
    };

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    void crossfadeNavigation(navigation as any);
    expect(namedAtStart).toBe('cleanup-day-title');

    const updating = update!();
    document.body.innerHTML = '<div id="new" data-shared-element="cleanup-day-title"></div>';
    complete();
    await updating;
    const next = document.querySelector<HTMLElement>('#new')!;
    expect(next.style.viewTransitionName).toBe('cleanup-day-title');

    finish();
    await Promise.resolve();
    await Promise.resolve();
    expect(next.style.viewTransitionName).toBe('');
  });
});
