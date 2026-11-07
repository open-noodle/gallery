import SpaceSearchResults from '#lib/components/spaces/space-search-results.svelte';
import { getViewerSpace, type ViewerSpace } from '#lib/gallery/viewer-space.ts';
import type { AssetResponseDto } from '@immich/sdk';
import { init, register, waitLocale } from 'svelte-i18n';
import { render } from 'vitest-browser-svelte';
import { page, userEvent } from 'vitest/browser';

const getAssetInfoMock = vi.fn();
vi.mock('@immich/sdk', async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>;
  return { ...actual, getAssetInfo: (...args: unknown[]) => getAssetInfoMock(...args) };
});

// The real GalleryViewer lays thumbnails out by measuring its scroll container and only renders
// the ones in view. The stub records the props under test and renders one clickable element per
// asset, independent of that layout.
vi.mock('#lib/components/shared-components/gallery-viewer/GalleryViewer.svelte', async () => {
  const { default: MockComponent } = await import('./mock-gallery-viewer.test-wrapper.svelte');
  return { default: MockComponent };
});

// Spy on the props forwarded to AssetViewer. The component dynamic-imports asset-viewer.svelte,
// so we mock the module and record each invocation's props on this array, plus the viewer space
// context the viewer reads. Tests assert against them.
const assetViewerPropsCalls: Array<Record<string, unknown>> = [];
const viewerSpaceCalls: ViewerSpace[] = [];
vi.mock('#lib/components/asset-viewer/AssetViewer.svelte', () => {
  return {
    default: function MockAssetViewer(_node: unknown, props: Record<string, unknown>) {
      assetViewerPropsCalls.push(props);
      viewerSpaceCalls.push(getViewerSpace()());
      return { destroy: () => {} };
    },
  };
});

const mockAssets = [
  { id: 'asset-1', originalFileName: 'photo1.jpg' },
  { id: 'asset-2', originalFileName: 'photo2.jpg' },
  { id: 'asset-3', originalFileName: 'photo3.jpg' },
] as AssetResponseDto[];

describe('SpaceSearchResults', () => {
  beforeAll(async () => {
    register('en-US', () => import('#i18n/en.json'));
    await init({ fallbackLocale: 'en-US' });
    await waitLocale('en-US');
  });

  beforeEach(() => {
    getAssetInfoMock.mockReset();
    getAssetInfoMock.mockResolvedValue({ id: 'asset-1', originalFileName: 'photo1.jpg' } as AssetResponseDto);
    assetViewerPropsCalls.length = 0;
    viewerSpaceCalls.length = 0;
  });

  it('should render search results through the gallery viewer', async () => {
    await render(SpaceSearchResults, {
      props: {
        results: mockAssets,
        isLoading: false,
        hasMore: false,
        totalLoaded: 3,
        onLoadMore: vi.fn(),
        sortMode: 'relevance',
      },
    });
    expect(page.getByTestId('gallery-viewer').element()).toBeInTheDocument();
    for (const asset of mockAssets) {
      expect(page.getByTestId(`gallery-asset-${asset.id}`).element()).toBeInTheDocument();
    }
  });

  // The whole point of #908: results must use the justified, selectable gallery rather than the
  // old fixed-aspect-ratio grid of bare <img> elements.
  it('should hand the gallery viewer a selection manager so photos are selectable on hover', async () => {
    await render(SpaceSearchResults, {
      props: {
        results: mockAssets,
        isLoading: false,
        hasMore: false,
        totalLoaded: 3,
        onLoadMore: vi.fn(),
        sortMode: 'relevance',
      },
    });
    expect(page.getByTestId('gallery-viewer').element()).toHaveAttribute('data-has-asset-interaction', 'true');
  });

  it('should virtualize against its own scroll container rather than the document', async () => {
    await render(SpaceSearchResults, {
      props: {
        results: mockAssets,
        isLoading: false,
        hasMore: false,
        totalLoaded: 3,
        onLoadMore: vi.fn(),
        sortMode: 'relevance',
      },
    });
    expect(page.getByTestId('gallery-viewer').element()).toHaveAttribute('data-has-scroll-element', 'true');
  });

  // #1028: the results grid owns the only scrolling element on the surface, so a host that wants
  // to shrink its chrome as the reader scrolls (the space shell collapsing its cover) can only
  // learn about it from here.
  it('should report its scroll position so the host can collapse the chrome around it', async () => {
    const onScroll = vi.fn();
    await render(SpaceSearchResults, {
      props: {
        results: mockAssets,
        isLoading: false,
        hasMore: false,
        totalLoaded: 3,
        onLoadMore: vi.fn(),
        sortMode: 'relevance',
        onScroll,
      },
    });

    const scroller = page.getByTestId('search-results-scroller').element();
    Object.defineProperty(scroller, 'scrollTop', { value: 240, configurable: true });
    scroller.dispatchEvent(new Event('scroll'));

    expect(onScroll).toHaveBeenCalledWith(240);
  });

  it('should keep ownership of the asset viewer so space context is preserved', async () => {
    await render(SpaceSearchResults, {
      props: {
        results: mockAssets,
        isLoading: false,
        hasMore: false,
        totalLoaded: 3,
        onLoadMore: vi.fn(),
        sortMode: 'relevance',
      },
    });
    expect(page.getByTestId('gallery-viewer').element()).toHaveAttribute('data-with-asset-viewer', 'false');
  });

  it('should render the same justified gallery in date-sorted mode (no month headers)', async () => {
    await render(SpaceSearchResults, {
      props: {
        results: mockAssets,
        isLoading: false,
        hasMore: false,
        totalLoaded: 3,
        onLoadMore: vi.fn(),
        sortMode: 'desc',
      },
    });
    expect(page.getByTestId('gallery-viewer').element()).toBeInTheDocument();
    expect(page.getByTestId('date-group-header-0').query()).not.toBeInTheDocument();
  });

  it('should show result count with + for relevance mode when more pages exist', async () => {
    await render(SpaceSearchResults, {
      props: {
        results: mockAssets,
        isLoading: false,
        hasMore: true,
        totalLoaded: 100,
        onLoadMore: vi.fn(),
        sortMode: 'relevance',
      },
    });
    expect(page.getByTestId('result-count').element()).toMatchTextContent('100+');
  });

  it('should show route-provided exact total without plus when available', async () => {
    await render(SpaceSearchResults, {
      props: {
        results: mockAssets,
        isLoading: false,
        hasMore: true,
        totalLoaded: 3,
        total: 42,
        onLoadMore: vi.fn(),
        sortMode: 'relevance',
      },
    });
    expect(page.getByTestId('result-count').element()).toMatchTextContent('42 results');
    expect(page.getByTestId('result-count').element().textContent).not.toContain('+');
  });

  it('should show exact count when no more pages', async () => {
    await render(SpaceSearchResults, {
      props: {
        results: mockAssets,
        isLoading: false,
        hasMore: false,
        totalLoaded: 3,
        onLoadMore: vi.fn(),
        sortMode: 'relevance',
      },
    });
    expect(page.getByTestId('result-count').element()).toMatchTextContent('3');
    expect(page.getByTestId('result-count').element().textContent).not.toContain('+');
  });

  it('should render scroll sentinel when hasMore is true', async () => {
    await render(SpaceSearchResults, {
      props: {
        results: mockAssets,
        isLoading: false,
        hasMore: true,
        totalLoaded: 100,
        onLoadMore: vi.fn(),
        sortMode: 'relevance',
      },
    });
    expect(page.getByTestId('scroll-sentinel').element()).toBeInTheDocument();
  });

  it('should not render scroll sentinel when hasMore is false', async () => {
    await render(SpaceSearchResults, {
      props: {
        results: mockAssets,
        isLoading: false,
        hasMore: false,
        totalLoaded: 3,
        onLoadMore: vi.fn(),
        sortMode: 'relevance',
      },
    });
    expect(page.getByTestId('scroll-sentinel').query()).not.toBeInTheDocument();
  });

  it('should show loading spinner when loading', async () => {
    await render(SpaceSearchResults, {
      props: {
        results: [],
        spaceId: 'space-1',
        isLoading: true,
        hasMore: false,
        totalLoaded: 0,
        onLoadMore: vi.fn(),
        sortMode: 'relevance',
      },
    });
    expect(page.getByTestId('search-loading').element()).toBeInTheDocument();
  });

  it('should show empty state when no results and not loading', async () => {
    await render(SpaceSearchResults, {
      props: {
        results: [],
        isLoading: false,
        hasMore: false,
        totalLoaded: 0,
        onLoadMore: vi.fn(),
        sortMode: 'relevance',
      },
    });
    expect(page.getByTestId('search-empty').element()).toBeInTheDocument();
  });

  it('should show contextual result count for date-sorted mode', async () => {
    await render(SpaceSearchResults, {
      props: {
        results: mockAssets,
        isLoading: false,
        hasMore: true,
        totalLoaded: 100,
        onLoadMore: vi.fn(),
        sortMode: 'desc',
      },
    });
    expect(page.getByTestId('result-count').element()).toMatchTextContent('100 of up to 500');
  });

  it('should show contextual result count for asc mode', async () => {
    await render(SpaceSearchResults, {
      props: {
        results: mockAssets,
        isLoading: false,
        hasMore: true,
        totalLoaded: 50,
        onLoadMore: vi.fn(),
        sortMode: 'asc',
      },
    });
    expect(page.getByTestId('result-count').element()).toMatchTextContent('50 of up to 500');
  });

  it('should show exact count in date mode when all loaded', async () => {
    await render(SpaceSearchResults, {
      props: {
        results: mockAssets,
        isLoading: false,
        hasMore: false,
        totalLoaded: 35,
        onLoadMore: vi.fn(),
        sortMode: 'desc',
      },
    });
    const text = page.getByTestId('result-count').element().textContent;
    expect(text).toContain('35');
    expect(text).not.toContain('of up to');
  });

  describe('isShared prop and conditional spaceId', () => {
    it('should pass isShared={true} to AssetViewer when isShared prop is true', async () => {
      await render(SpaceSearchResults, {
        props: {
          results: mockAssets,
          isLoading: false,
          hasMore: false,
          totalLoaded: 3,
          onLoadMore: vi.fn(),
          sortMode: 'relevance',
          spaceId: 'space-1',
          isShared: true,
        },
      });

      await userEvent.click(page.getByTestId('gallery-asset-asset-1'));

      // Wait for the dynamic-imported AssetViewer mock to be invoked with props.
      await vi.waitFor(() => expect(assetViewerPropsCalls.length).toBeGreaterThan(0));

      const props = assetViewerPropsCalls.at(-1)!;
      expect(props.isShared).toBe(true);
    });

    it('should pass isShared={false} to AssetViewer when isShared prop is false', async () => {
      await render(SpaceSearchResults, {
        props: {
          results: mockAssets,
          isLoading: false,
          hasMore: false,
          totalLoaded: 3,
          onLoadMore: vi.fn(),
          sortMode: 'relevance',
          isShared: false,
        },
      });

      await userEvent.click(page.getByTestId('gallery-asset-asset-1'));

      await vi.waitFor(() => expect(assetViewerPropsCalls.length).toBeGreaterThan(0));

      const props = assetViewerPropsCalls.at(-1)!;
      expect(props.isShared).toBe(false);
    });

    // #889 — the viewer opened from space search results has to know it is on a space surface,
    // or add-to-album offers personal albums the server cannot accept a non-owned photo into.
    it('should hand the space scope to AssetViewer through the viewer space context', async () => {
      await render(SpaceSearchResults, {
        props: {
          results: mockAssets,
          isLoading: false,
          hasMore: false,
          totalLoaded: 3,
          onLoadMore: vi.fn(),
          sortMode: 'relevance',
          spaceId: 'space-1',
          space: { id: 'space-1', canWrite: true },
          isShared: true,
        },
      });

      await userEvent.click(page.getByTestId('gallery-asset-asset-1'));

      await vi.waitFor(() => expect(assetViewerPropsCalls.length).toBeGreaterThan(0));

      expect(viewerSpaceCalls.at(-1)).toEqual({ spaceId: 'space-1', space: { id: 'space-1', canWrite: true } });
      expect(assetViewerPropsCalls.at(-1)).not.toHaveProperty('space');
    });

    it('should call getAssetInfo WITH spaceId when spaceId prop is set', async () => {
      await render(SpaceSearchResults, {
        props: {
          results: mockAssets,
          isLoading: false,
          hasMore: false,
          totalLoaded: 3,
          onLoadMore: vi.fn(),
          sortMode: 'relevance',
          spaceId: 'space-42',
          isShared: true,
        },
      });

      await userEvent.click(page.getByTestId('gallery-asset-asset-1'));

      await vi.waitFor(() => expect(getAssetInfoMock).toHaveBeenCalled());

      expect(getAssetInfoMock).toHaveBeenCalledWith(expect.objectContaining({ spaceId: 'space-42' }));
    });

    it('should call getAssetInfo WITHOUT spaceId when spaceId prop is undefined', async () => {
      await render(SpaceSearchResults, {
        props: {
          results: mockAssets,
          isLoading: false,
          hasMore: false,
          totalLoaded: 3,
          onLoadMore: vi.fn(),
          sortMode: 'relevance',
          isShared: false,
        },
      });

      await userEvent.click(page.getByTestId('gallery-asset-asset-1'));

      await vi.waitFor(() => expect(getAssetInfoMock).toHaveBeenCalled());

      // Assert the spaceId key is ABSENT (not just undefined) from every call.
      for (const call of getAssetInfoMock.mock.calls) {
        const arg = call[0] as Record<string, unknown>;
        expect(Object.prototype.hasOwnProperty.call(arg, 'spaceId')).toBe(false);
      }
      // Also assert via not.objectContaining as a secondary guardrail.
      expect(getAssetInfoMock).toHaveBeenCalledWith(expect.not.objectContaining({ spaceId: expect.anything() }));
    });
  });
});
