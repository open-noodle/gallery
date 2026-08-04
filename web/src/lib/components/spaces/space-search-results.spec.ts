import type { AssetResponseDto } from '@immich/sdk';
import { fireEvent, render, screen } from '@testing-library/svelte';
import { init, register, waitLocale } from 'svelte-i18n';
import { getIntersectionObserverMock } from '$lib/__mocks__/intersection-observer.mock';
import SpaceSearchResults from '$lib/components/spaces/space-search-results.svelte';

const getAssetInfoMock = vi.fn();
vi.mock('@immich/sdk', async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>;
  return { ...actual, getAssetInfo: (...args: unknown[]) => getAssetInfoMock(...args) };
});

// The real GalleryViewer measures a justified layout against its scroll container, which
// happy-dom reports as 0x0 — it would render zero thumbnails here. The stub records the props
// under test and renders one clickable element per asset.
vi.mock('$lib/components/shared-components/gallery-viewer/GalleryViewer.svelte', async () => {
  const { default: MockComponent } = await import('./mock-gallery-viewer.test-wrapper.svelte');
  return { default: MockComponent };
});

// Spy on the props forwarded to AssetViewer. The component dynamic-imports asset-viewer.svelte,
// so we mock the module and record each invocation's props on this array. Tests assert against it.
const assetViewerPropsCalls: Array<Record<string, unknown>> = [];
vi.mock('$lib/components/asset-viewer/AssetViewer.svelte', () => {
  return {
    default: function MockAssetViewer(_node: unknown, props: Record<string, unknown>) {
      assetViewerPropsCalls.push(props);
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
    register('en-US', () => import('$i18n/en.json'));
    await init({ fallbackLocale: 'en-US' });
    await waitLocale('en-US');
  });

  beforeEach(() => {
    vi.stubGlobal('IntersectionObserver', getIntersectionObserverMock());
    getAssetInfoMock.mockReset();
    getAssetInfoMock.mockResolvedValue({ id: 'asset-1', originalFileName: 'photo1.jpg' } as AssetResponseDto);
    assetViewerPropsCalls.length = 0;
  });

  it('should render search results through the gallery viewer', () => {
    render(SpaceSearchResults, {
      props: {
        results: mockAssets,
        isLoading: false,
        hasMore: false,
        totalLoaded: 3,
        onLoadMore: vi.fn(),
        sortMode: 'relevance',
      },
    });
    expect(screen.getByTestId('gallery-viewer')).toBeInTheDocument();
    for (const asset of mockAssets) {
      expect(screen.getByTestId(`gallery-asset-${asset.id}`)).toBeInTheDocument();
    }
  });

  // The whole point of #908: results must use the justified, selectable gallery rather than the
  // old fixed-aspect-ratio grid of bare <img> elements.
  it('should hand the gallery viewer a selection manager so photos are selectable on hover', () => {
    render(SpaceSearchResults, {
      props: {
        results: mockAssets,
        isLoading: false,
        hasMore: false,
        totalLoaded: 3,
        onLoadMore: vi.fn(),
        sortMode: 'relevance',
      },
    });
    expect(screen.getByTestId('gallery-viewer')).toHaveAttribute('data-has-asset-interaction', 'true');
  });

  it('should virtualize against its own scroll container rather than the document', () => {
    render(SpaceSearchResults, {
      props: {
        results: mockAssets,
        isLoading: false,
        hasMore: false,
        totalLoaded: 3,
        onLoadMore: vi.fn(),
        sortMode: 'relevance',
      },
    });
    expect(screen.getByTestId('gallery-viewer')).toHaveAttribute('data-has-scroll-element', 'true');
  });

  it('should keep ownership of the asset viewer so space context is preserved', () => {
    render(SpaceSearchResults, {
      props: {
        results: mockAssets,
        isLoading: false,
        hasMore: false,
        totalLoaded: 3,
        onLoadMore: vi.fn(),
        sortMode: 'relevance',
      },
    });
    expect(screen.getByTestId('gallery-viewer')).toHaveAttribute('data-with-asset-viewer', 'false');
  });

  it('should render the same justified gallery in date-sorted mode (no month headers)', () => {
    render(SpaceSearchResults, {
      props: {
        results: mockAssets,
        isLoading: false,
        hasMore: false,
        totalLoaded: 3,
        onLoadMore: vi.fn(),
        sortMode: 'desc',
      },
    });
    expect(screen.getByTestId('gallery-viewer')).toBeInTheDocument();
    expect(screen.queryByTestId('date-group-header-0')).not.toBeInTheDocument();
  });

  it('should show result count with + for relevance mode when more pages exist', () => {
    render(SpaceSearchResults, {
      props: {
        results: mockAssets,
        isLoading: false,
        hasMore: true,
        totalLoaded: 100,
        onLoadMore: vi.fn(),
        sortMode: 'relevance',
      },
    });
    expect(screen.getByTestId('result-count')).toHaveTextContent('100+');
  });

  it('should show route-provided exact total without plus when available', () => {
    render(SpaceSearchResults, {
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
    expect(screen.getByTestId('result-count')).toHaveTextContent('42 results');
    expect(screen.getByTestId('result-count').textContent).not.toContain('+');
  });

  it('should show exact count when no more pages', () => {
    render(SpaceSearchResults, {
      props: {
        results: mockAssets,
        isLoading: false,
        hasMore: false,
        totalLoaded: 3,
        onLoadMore: vi.fn(),
        sortMode: 'relevance',
      },
    });
    expect(screen.getByTestId('result-count')).toHaveTextContent('3');
    expect(screen.getByTestId('result-count').textContent).not.toContain('+');
  });

  it('should render scroll sentinel when hasMore is true', () => {
    render(SpaceSearchResults, {
      props: {
        results: mockAssets,
        isLoading: false,
        hasMore: true,
        totalLoaded: 100,
        onLoadMore: vi.fn(),
        sortMode: 'relevance',
      },
    });
    expect(screen.getByTestId('scroll-sentinel')).toBeInTheDocument();
  });

  it('should not render scroll sentinel when hasMore is false', () => {
    render(SpaceSearchResults, {
      props: {
        results: mockAssets,
        isLoading: false,
        hasMore: false,
        totalLoaded: 3,
        onLoadMore: vi.fn(),
        sortMode: 'relevance',
      },
    });
    expect(screen.queryByTestId('scroll-sentinel')).not.toBeInTheDocument();
  });

  it('should show loading spinner when loading', () => {
    render(SpaceSearchResults, {
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
    expect(screen.getByTestId('search-loading')).toBeInTheDocument();
  });

  it('should show empty state when no results and not loading', () => {
    render(SpaceSearchResults, {
      props: {
        results: [],
        isLoading: false,
        hasMore: false,
        totalLoaded: 0,
        onLoadMore: vi.fn(),
        sortMode: 'relevance',
      },
    });
    expect(screen.getByTestId('search-empty')).toBeInTheDocument();
  });

  it('should show contextual result count for date-sorted mode', () => {
    render(SpaceSearchResults, {
      props: {
        results: mockAssets,
        isLoading: false,
        hasMore: true,
        totalLoaded: 100,
        onLoadMore: vi.fn(),
        sortMode: 'desc',
      },
    });
    expect(screen.getByTestId('result-count')).toHaveTextContent('100 of up to 500');
  });

  it('should show contextual result count for asc mode', () => {
    render(SpaceSearchResults, {
      props: {
        results: mockAssets,
        isLoading: false,
        hasMore: true,
        totalLoaded: 50,
        onLoadMore: vi.fn(),
        sortMode: 'asc',
      },
    });
    expect(screen.getByTestId('result-count')).toHaveTextContent('50 of up to 500');
  });

  it('should show exact count in date mode when all loaded', () => {
    render(SpaceSearchResults, {
      props: {
        results: mockAssets,
        isLoading: false,
        hasMore: false,
        totalLoaded: 35,
        onLoadMore: vi.fn(),
        sortMode: 'desc',
      },
    });
    const text = screen.getByTestId('result-count').textContent;
    expect(text).toContain('35');
    expect(text).not.toContain('of up to');
  });

  describe('isShared prop and conditional spaceId', () => {
    it('should pass isShared={true} to AssetViewer when isShared prop is true', async () => {
      render(SpaceSearchResults, {
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

      await fireEvent.click(screen.getByTestId('gallery-asset-asset-1'));

      // Wait for the dynamic-imported AssetViewer mock to be invoked with props.
      await vi.waitFor(() => expect(assetViewerPropsCalls.length).toBeGreaterThan(0));

      const props = assetViewerPropsCalls.at(-1)!;
      expect(props.isShared).toBe(true);
    });

    it('should pass isShared={false} to AssetViewer when isShared prop is false', async () => {
      render(SpaceSearchResults, {
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

      await fireEvent.click(screen.getByTestId('gallery-asset-asset-1'));

      await vi.waitFor(() => expect(assetViewerPropsCalls.length).toBeGreaterThan(0));

      const props = assetViewerPropsCalls.at(-1)!;
      expect(props.isShared).toBe(false);
    });

    // #889 — the viewer opened from space search results has to know it is on a space surface,
    // or add-to-album offers personal albums the server cannot accept a non-owned photo into.
    it('should forward the space capability to AssetViewer', async () => {
      render(SpaceSearchResults, {
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

      await fireEvent.click(screen.getByTestId('gallery-asset-asset-1'));

      await vi.waitFor(() => expect(assetViewerPropsCalls.length).toBeGreaterThan(0));

      const props = assetViewerPropsCalls.at(-1)!;
      expect(props.space).toEqual({ id: 'space-1', canWrite: true });
    });

    it('should call getAssetInfo WITH spaceId when spaceId prop is set', async () => {
      render(SpaceSearchResults, {
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

      await fireEvent.click(screen.getByTestId('gallery-asset-asset-1'));

      await vi.waitFor(() => expect(getAssetInfoMock).toHaveBeenCalled());

      expect(getAssetInfoMock).toHaveBeenCalledWith(expect.objectContaining({ spaceId: 'space-42' }));
    });

    it('should call getAssetInfo WITHOUT spaceId when spaceId prop is undefined', async () => {
      render(SpaceSearchResults, {
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

      await fireEvent.click(screen.getByTestId('gallery-asset-asset-1'));

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
