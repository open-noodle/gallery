import { AssetTypeEnum, AssetVisibility, type AssetResponseDto } from '@immich/sdk';
import '@testing-library/jest-dom';
import { fireEvent, render, screen, waitFor } from '@testing-library/svelte';
import type { Component } from 'svelte';
import { init, register, waitLocale } from 'svelte-i18n';

import TestWrapper from '$lib/components/TestWrapper.svelte';
import type { AssetMultiSelectManager } from '$lib/managers/asset-multi-select-manager.svelte';
import GalleryViewer from './GalleryViewer.svelte';

const { assetViewerPropsCalls, mockAssetInteraction, mockAssetViewerManager } = vi.hoisted(() => ({
  assetViewerPropsCalls: [] as Array<Record<string, unknown>>,
  mockAssetInteraction: {
    selectionActive: false,
    assets: [],
    candidates: [],
    startAsset: null,
    clear: vi.fn(),
    clearCandidates: vi.fn(),
    hasSelectedAsset: vi.fn(() => false),
    hasSelectionCandidate: vi.fn(() => false),
    removeAssetFromMultiselectGroup: vi.fn(),
    selectAsset: vi.fn(),
    selectAssets: vi.fn(),
    setAssetSelectionCandidates: vi.fn(),
    setAssetSelectionStart: vi.fn(),
  },
  mockAssetViewerManager: {
    _asset: undefined as AssetResponseDto | undefined,
    _isViewing: false,
    _notify: () => {},
    _track: () => {},
    get asset() {
      this._track();
      return this._asset;
    },
    set asset(asset: AssetResponseDto | undefined) {
      this._asset = asset;
      this._notify();
    },
    get isViewing() {
      this._track();
      return this._isViewing;
    },
    set isViewing(isViewing: boolean) {
      this._isViewing = isViewing;
      this._notify();
    },
    showAssetViewer: vi.fn(),
  },
}));

const asAssetInteraction = (assetInteraction: typeof mockAssetInteraction) =>
  assetInteraction as unknown as AssetMultiSelectManager;

vi.mock('$lib/components/assets/thumbnail/Thumbnail.svelte', async () => {
  const { default: MockComponent } = await import('@test-data/mocks/thumbnail-with-label.stub.svelte');
  return { default: MockComponent };
});

vi.mock('$lib/elements/Portal.svelte', async () => {
  const { default: MockComponent } = await import('@test-data/mocks/sidebar.stub.svelte');
  return { default: MockComponent };
});

vi.mock('$lib/components/asset-viewer/AssetViewer.svelte', () => {
  return {
    default: function MockAssetViewer(_node: unknown, props: Record<string, unknown>) {
      assetViewerPropsCalls.push(props);
      return {
        $set: (nextProps: Record<string, unknown>) => assetViewerPropsCalls.push(nextProps),
        destroy: () => {},
      };
    },
  };
});

vi.mock('$lib/managers/asset-viewer-manager.svelte', async () => {
  const { createSubscriber } = await import('svelte/reactivity');
  mockAssetViewerManager._track = createSubscriber((update) => {
    mockAssetViewerManager._notify = update;
    return () => {
      mockAssetViewerManager._notify = () => {};
    };
  });

  return {
    assetViewerManager: mockAssetViewerManager,
  };
});

vi.mock('$lib/managers/feature-flags-manager.svelte', () => ({
  featureFlagsManager: { value: { trash: true } },
}));

vi.mock('$lib/utils/navigation', () => ({
  isSharedLinkRoute: vi.fn(() => false),
  navigate: vi.fn(),
}));

vi.mock('lodash-es', async (importOriginal) => {
  const actual = await importOriginal<typeof import('lodash-es')>();
  return {
    ...actual,
    debounce: <T extends (...args: never[]) => unknown>(fn: T) => fn,
  };
});

function asset(id: string, localDateTime: string, overrides: Partial<AssetResponseDto> = {}): AssetResponseDto {
  return {
    id,
    ownerId: 'user-1',
    type: AssetTypeEnum.Image,
    originalFileName: `${id}.jpg`,
    visibility: AssetVisibility.Timeline,
    isFavorite: false,
    isTrashed: false,
    fileCreatedAt: localDateTime,
    localDateTime,
    thumbhash: `${id}-thumbhash`,
    width: 1600,
    height: 900,
    ...overrides,
  } as AssetResponseDto;
}

function renderViewer({
  assets = defaultAssets(),
  enableGrouping = true,
  assetInteraction = asAssetInteraction(mockAssetInteraction),
  onIntersected,
  viewerAssets,
}: {
  assets?: AssetResponseDto[];
  enableGrouping?: boolean;
  assetInteraction?: AssetMultiSelectManager;
  onIntersected?: () => void;
  viewerAssets?: AssetResponseDto[];
} = {}) {
  const componentProps = {
    assets,
    viewerAssets,
    assetInteraction,
    viewport: { width: 900, height: 700 },
    enableGrouping,
    onIntersected,
  };

  return render(
    TestWrapper as Component<{ component: typeof GalleryViewer; componentProps: Record<string, unknown> }>,
    {
      component: GalleryViewer,
      componentProps,
    },
  );
}

function createAnimationFrameQueue() {
  const callbacks: FrameRequestCallback[] = [];
  const originalRequestAnimationFrame = globalThis.requestAnimationFrame;
  const requestAnimationFrame = vi.fn((callback: FrameRequestCallback) => {
    callbacks.push(callback);
    return callbacks.length;
  });
  globalThis.requestAnimationFrame = requestAnimationFrame;

  return {
    requestAnimationFrame,
    async flush() {
      while (callbacks.length > 0) {
        callbacks.shift()?.(performance.now());
        await Promise.resolve();
      }
    },
    restore() {
      globalThis.requestAnimationFrame = originalRequestAnimationFrame;
    },
  };
}

function getScrolledElementSelector(element: Element) {
  if (!(element instanceof HTMLElement)) {
    return undefined;
  }

  const testId = element.dataset.testid;
  if (testId) {
    return `[data-testid="${testId}"]`;
  }

  const assetId = element.dataset.galleryAssetId;
  if (assetId) {
    return `[data-gallery-asset-id="${assetId}"]`;
  }

  const bucketYear = element.dataset.galleryBucketYear;
  const bucketMonth = element.dataset.galleryBucketMonth;
  if (bucketYear && bucketMonth) {
    return `[data-gallery-bucket-year="${bucketYear}"][data-gallery-bucket-month="${bucketMonth}"]`;
  }

  return undefined;
}

function trackScrolledElement() {
  let scrolledElement: Element | undefined;
  const originalScrollIntoView = Element.prototype.scrollIntoView;
  Element.prototype.scrollIntoView = vi.fn(function (this: Element) {
    const selector = getScrolledElementSelector(this);
    scrolledElement = selector ? (globalThis.document.querySelector(selector) ?? undefined) : undefined;
  });

  return {
    get scrolledElement() {
      return scrolledElement;
    },
    reset() {
      scrolledElement = undefined;
    },
    restore() {
      Element.prototype.scrollIntoView = originalScrollIntoView;
    },
  };
}

function defaultAssets() {
  return [
    asset('asset-2016', '2016-01-02T00:00:00.000Z'),
    asset('asset-2015-aug', '2015-08-03T00:00:00.000Z'),
    asset('asset-2015-jan', '2015-01-01T00:00:00.000Z'),
  ];
}

function assetsWithOffscreenAugustTarget() {
  return [
    ...Array.from({ length: 20 }, (_, index) =>
      asset(`asset-2016-${index}`, `2016-01-${String(index + 1).padStart(2, '0')}T00:00:00.000Z`),
    ),
    asset('asset-2015-aug-offscreen', '2015-08-03T00:00:00.000Z'),
    asset('asset-2015-jan', '2015-01-01T00:00:00.000Z'),
  ];
}

describe('GalleryViewer grouping', () => {
  beforeAll(async () => {
    // Load the real en bundle so the TimelineBucketCard accessible names
    // (`$t('timeline_overview_card_semantics', { values: { period, countLabel, action } })`)
    // resolve to English text ("2015, 2 photos, show months") instead of the raw key.
    // The grouping tests target individual cards by their period + photo-count label, so
    // the interpolated output is load-bearing (the global setup's `dev` locale returns keys).
    register('en-US', () => import('$i18n/en.json'));
    await init({ fallbackLocale: 'en-US' });
    await waitLocale('en-US');
  });

  beforeEach(() => {
    vi.clearAllMocks();
    mockAssetInteraction.selectionActive = false;
    mockAssetInteraction.assets = [];
    mockAssetInteraction.candidates = [];
    mockAssetInteraction.startAsset = null;
    mockAssetViewerManager.asset = undefined;
    mockAssetViewerManager.isViewing = false;
    assetViewerPropsCalls.length = 0;
  });

  it('renders the grouping control when grouping is enabled and assets exist', () => {
    renderViewer();

    expect(screen.getByTestId('timeline-desktop-grouping-control')).toBeInTheDocument();
  });

  it('does not render an orphaned grouping control for an empty asset list', () => {
    renderViewer({ assets: [], enableGrouping: true });

    expect(screen.queryByTestId('timeline-desktop-grouping-control')).not.toBeInTheDocument();
  });

  it('does not render the grouping control when grouping is disabled', () => {
    renderViewer({ enableGrouping: false });

    expect(screen.queryByTestId('timeline-desktop-grouping-control')).not.toBeInTheDocument();
  });

  it('manual grouping changes render representative year cards without temporal chips', async () => {
    renderViewer();

    await fireEvent.click(screen.getByTestId('timeline-grouping-year'));

    await waitFor(() => {
      expect(screen.getAllByTestId('timeline-bucket-card')).toHaveLength(2);
      expect(screen.queryByTestId('active-filters-bar')).not.toBeInTheDocument();
      expect(screen.queryByTestId('thumbnail-asset-2015-aug')).not.toBeInTheDocument();
    });
  });

  it('zooms from year to month to detailed mode without narrowing the local asset array', async () => {
    const assets = defaultAssets();
    renderViewer({ assets });

    await fireEvent.click(screen.getByTestId('timeline-grouping-year'));
    await fireEvent.click(screen.getByRole('button', { name: /2015, 2 photos/i }));

    await waitFor(() => {
      expect(screen.queryByTestId('active-filters-bar')).not.toBeInTheDocument();
      expect(screen.getByTestId('timeline-grouping-month')).toHaveAttribute('aria-pressed', 'true');
      expect(screen.getAllByTestId('timeline-bucket-card')).toHaveLength(3);
      expect(screen.getByRole('button', { name: /Jan 2016, 1 photo/i })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: /Aug 2015, 1 photo/i })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: /Jan 2015, 1 photo/i })).toBeInTheDocument();
    });

    await fireEvent.click(screen.getByRole('button', { name: /Aug 2015, 1 photo/i }));

    await waitFor(() => {
      expect(screen.queryByTestId('active-filters-bar')).not.toBeInTheDocument();
      expect(screen.getByTestId('timeline-grouping-day')).toHaveAttribute('aria-pressed', 'true');
      expect(screen.getByTestId('thumbnail-asset-2016')).toBeInTheDocument();
      expect(screen.getByTestId('thumbnail-asset-2015-aug')).toBeInTheDocument();
      expect(screen.getByTestId('thumbnail-asset-2015-jan')).toBeInTheDocument();
    });

    expect(assets.map((asset) => asset.id)).toEqual(['asset-2016', 'asset-2015-aug', 'asset-2015-jan']);
  });

  it('anchors year and month zooms to the first matching local bucket or asset', async () => {
    const frameQueue = createAnimationFrameQueue();
    const scrollTracker = trackScrolledElement();

    try {
      renderViewer();

      await fireEvent.click(screen.getByTestId('timeline-grouping-year'));
      await fireEvent.click(screen.getByRole('button', { name: /2015, 2 photos/i }));

      await waitFor(() => expect(frameQueue.requestAnimationFrame).toHaveBeenCalled());
      await frameQueue.flush();

      await waitFor(() => {
        expect(scrollTracker.scrolledElement).toHaveAttribute('data-gallery-bucket-year', '2015');
        expect(scrollTracker.scrolledElement).toHaveAttribute('data-gallery-bucket-month', '8');
        expect(screen.getByTestId('timeline-grouping-month')).toHaveAttribute('aria-pressed', 'true');
      });

      frameQueue.requestAnimationFrame.mockClear();
      scrollTracker.reset();

      await fireEvent.click(screen.getByRole('button', { name: /Aug 2015, 1 photo/i }));

      await waitFor(() => expect(frameQueue.requestAnimationFrame).toHaveBeenCalled());
      await frameQueue.flush();

      await waitFor(() => {
        expect(scrollTracker.scrolledElement).toHaveAttribute('data-gallery-asset-year', '2015');
        expect(scrollTracker.scrolledElement).toHaveAttribute('data-gallery-asset-month', '8');
        expect(scrollTracker.scrolledElement).toHaveAttribute(
          'data-testid',
          'gallery-viewer-asset-anchor-asset-2015-aug',
        );
        expect(screen.getByTestId('timeline-grouping-day')).toHaveAttribute('aria-pressed', 'true');
      });
    } finally {
      frameQueue.restore();
      scrollTracker.restore();
    }
  });

  it('does not run a stale anchor scroll after manual grouping clears the pending anchor', async () => {
    const frameQueue = createAnimationFrameQueue();
    const scrollTracker = trackScrolledElement();

    try {
      renderViewer();

      await fireEvent.click(screen.getByTestId('timeline-grouping-year'));
      await fireEvent.click(screen.getByRole('button', { name: /2015, 2 photos/i }));

      await waitFor(() => {
        expect(frameQueue.requestAnimationFrame).toHaveBeenCalled();
        expect(screen.getByTestId('timeline-grouping-month')).toHaveAttribute('aria-pressed', 'true');
      });

      await fireEvent.click(screen.getByTestId('timeline-grouping-year'));
      await waitFor(() => expect(screen.getByTestId('timeline-grouping-year')).toHaveAttribute('aria-pressed', 'true'));

      await frameQueue.flush();

      expect(scrollTracker.scrolledElement).toBeUndefined();
    } finally {
      frameQueue.restore();
      scrollTracker.restore();
    }
  });

  it('anchors month zooms to an offscreen local asset by scrolling the virtualized grid first', async () => {
    const frameQueue = createAnimationFrameQueue();
    const scrollTracker = trackScrolledElement();
    const assets = assetsWithOffscreenAugustTarget();

    try {
      renderViewer({ assets });

      await fireEvent.click(screen.getByTestId('timeline-grouping-year'));
      await fireEvent.click(screen.getByRole('button', { name: /2015, 2 photos/i }));
      await waitFor(() =>
        expect(screen.getByTestId('timeline-grouping-month')).toHaveAttribute('aria-pressed', 'true'),
      );

      frameQueue.requestAnimationFrame.mockClear();
      scrollTracker.reset();

      await fireEvent.click(screen.getByRole('button', { name: /Aug 2015, 1 photo/i }));

      await waitFor(() => expect(frameQueue.requestAnimationFrame).toHaveBeenCalled());
      await frameQueue.flush();

      await waitFor(() => {
        expect(scrollTracker.scrolledElement).toHaveAttribute(
          'data-testid',
          'gallery-viewer-asset-anchor-asset-2015-aug-offscreen',
        );
        expect(scrollTracker.scrolledElement).toHaveAttribute('data-gallery-asset-year', '2015');
        expect(scrollTracker.scrolledElement).toHaveAttribute('data-gallery-asset-month', '8');
      });
    } finally {
      frameQueue.restore();
      scrollTracker.restore();
    }
  });

  it('keeps remaining local assets available when the tapped period disappears before anchor resolution', async () => {
    const frameQueue = createAnimationFrameQueue();
    const scrollTracker = trackScrolledElement();
    const assets = defaultAssets();

    try {
      const view = renderViewer({ assets });

      await fireEvent.click(screen.getByTestId('timeline-grouping-year'));
      await fireEvent.click(screen.getByRole('button', { name: /2015, 2 photos/i }));

      await waitFor(() => {
        expect(frameQueue.requestAnimationFrame).toHaveBeenCalled();
        expect(screen.getByTestId('timeline-grouping-month')).toHaveAttribute('aria-pressed', 'true');
      });

      await view.rerender({
        component: GalleryViewer,
        componentProps: {
          assets: [assets[0]],
          assetInteraction: mockAssetInteraction,
          viewport: { width: 900, height: 700 },
          enableGrouping: true,
        },
      });
      await frameQueue.flush();

      await waitFor(() => {
        expect(screen.queryByTestId('active-filters-bar')).not.toBeInTheDocument();
        expect(screen.getByTestId('timeline-grouping-month')).toHaveAttribute('aria-pressed', 'true');
        expect(screen.getAllByTestId('timeline-bucket-card')).toHaveLength(1);
        expect(screen.getByRole('button', { name: /Jan 2016, 1 photo/i })).toBeInTheDocument();
      });
      expect(scrollTracker.scrolledElement).toBeUndefined();
    } finally {
      frameQueue.restore();
      scrollTracker.restore();
    }
  });

  it('keeps single-asset GalleryViewer grids in normal day mode', () => {
    renderViewer({ assets: [asset('single-asset', '2015-08-03T00:00:00.000Z')] });

    expect(screen.getByTestId('timeline-desktop-grouping-control')).toBeInTheDocument();
    expect(screen.getByTestId('thumbnail-single-asset')).toBeInTheDocument();
    expect(screen.queryByTestId('gallery-viewer-representative-buckets')).not.toBeInTheDocument();
  });

  it('does not request more assets while representative buckets are displayed', async () => {
    const onIntersected = vi.fn();
    renderViewer({ onIntersected });

    await fireEvent.click(screen.getByTestId('timeline-grouping-year'));
    onIntersected.mockClear();
    await fireEvent.click(screen.getByRole('button', { name: /2015, 2 photos/i }));
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(onIntersected).not.toHaveBeenCalled();
  });

  it('keeps asset viewer navigation on the full viewer asset list after zoom activation', async () => {
    const assets = defaultAssets();
    const widerViewerAssets = [
      asset('asset-2015-aug', '2015-08-03T00:00:00.000Z'),
      asset('asset-2015-jan', '2015-01-01T00:00:00.000Z'),
      asset('asset-2015-aug-extra', '2015-08-04T00:00:00.000Z'),
      asset('asset-2016', '2016-01-02T00:00:00.000Z'),
    ];
    const view = renderViewer({ assets, viewerAssets: widerViewerAssets });

    await fireEvent.click(screen.getByTestId('timeline-grouping-year'));
    await fireEvent.click(screen.getByRole('button', { name: /2015, 2 photos/i }));
    await fireEvent.click(screen.getByRole('button', { name: /Aug 2015, 1 photo/i }));

    await waitFor(() => {
      expect(screen.queryByTestId('active-filters-bar')).not.toBeInTheDocument();
      expect(screen.getByTestId('thumbnail-asset-2016')).toBeInTheDocument();
      expect(screen.getByTestId('thumbnail-asset-2015-aug')).toBeInTheDocument();
      expect(screen.getByTestId('thumbnail-asset-2015-jan')).toBeInTheDocument();
    });

    assetViewerPropsCalls.length = 0;
    mockAssetViewerManager.asset = widerViewerAssets[0];
    mockAssetViewerManager.isViewing = true;
    await view.rerender({
      component: GalleryViewer,
      componentProps: {
        assets,
        viewerAssets: widerViewerAssets,
        assetInteraction: mockAssetInteraction,
        viewport: { width: 900, height: 700 },
        enableGrouping: true,
      },
    });

    await waitFor(() => {
      const latestAssetViewerProps = assetViewerPropsCalls.at(-1) as {
        cursor: { nextAsset?: AssetResponseDto };
      };
      expect(latestAssetViewerProps.cursor.nextAsset?.id).toBe('asset-2015-jan');
    });
    const assetViewerProps = assetViewerPropsCalls.at(-1) as {
      cursor: { nextAsset?: AssetResponseDto; previousAsset?: AssetResponseDto };
      onRandom: () => Promise<{ id: string } | undefined>;
    };
    expect(assetViewerProps.cursor.nextAsset?.id).toBe('asset-2015-jan');
    expect(assetViewerProps.cursor.previousAsset).toBeUndefined();

    const randomSpy = vi.spyOn(Math, 'random').mockReturnValue(0.99);
    await expect(assetViewerProps.onRandom()).resolves.toMatchObject({ id: 'asset-2016' });
    randomSpy.mockRestore();
  });

  it('hides controls and disables representative card activation during selection mode', async () => {
    const assets = defaultAssets();
    const view = renderViewer({ assets });
    await fireEvent.click(screen.getByTestId('timeline-grouping-year'));

    const selectionInteraction = asAssetInteraction({ ...mockAssetInteraction, selectionActive: true });
    await view.rerender({
      component: GalleryViewer,
      componentProps: {
        assets,
        assetInteraction: selectionInteraction,
        viewport: { width: 900, height: 700 },
        enableGrouping: true,
      },
    });

    expect(screen.queryByTestId('timeline-desktop-grouping-control')).not.toBeInTheDocument();
    const yearCard = screen.getByRole('button', { name: /2015, 2 photos/i });
    expect(yearCard).toBeDisabled();
    await fireEvent.click(yearCard);
    expect(screen.queryByTestId('active-filters-bar')).not.toBeInTheDocument();
  });

  it('preserves ungrouped day-mode GalleryViewer behavior when grouping is disabled', () => {
    renderViewer({ enableGrouping: false });

    expect(screen.queryByTestId('timeline-desktop-grouping-control')).not.toBeInTheDocument();
    expect(screen.getByTestId('thumbnail-asset-2016')).toBeInTheDocument();
    expect(screen.getByTestId('thumbnail-asset-2015-aug')).toBeInTheDocument();
  });
});
