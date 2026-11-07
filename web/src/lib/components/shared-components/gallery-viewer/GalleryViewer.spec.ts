import TestWrapper from '#lib/components/TestWrapper.svelte';
import type { AssetMultiSelectManager } from '#lib/managers/asset-multi-select-manager.svelte.ts';
import { validThumbhash } from '#test/common/factories.ts';
import { MockRouter } from '#test/unit/mocks/router.ts';
import { AssetTypeEnum, AssetVisibility, type AssetResponseDto } from '@immich/sdk';
import type { Component } from 'svelte';
import { init, register, waitLocale } from 'svelte-i18n';
import { expect } from 'vitest';
import { render } from 'vitest-browser-svelte';
import { page, userEvent } from 'vitest/browser';
import GalleryViewer from './GalleryViewer.svelte';

const { assetViewerPropsCalls, mockAssetInteraction, mockAssetViewerManager } = vi.hoisted(() => {
  // Bound to a local name (not an inline literal) so the accessors reference the
  // state directly instead of `this` (unicorn/no-this-outside-of-class).
  const assetViewerManager = {
    _asset: undefined as AssetResponseDto | undefined,
    _isViewing: false,
    _notify: () => {},
    _track: () => {},
    get asset() {
      assetViewerManager._track();
      return assetViewerManager._asset;
    },
    set asset(asset: AssetResponseDto | undefined) {
      assetViewerManager._asset = asset;
      assetViewerManager._notify();
    },
    get isViewing() {
      assetViewerManager._track();
      return assetViewerManager._isViewing;
    },
    set isViewing(isViewing: boolean) {
      assetViewerManager._isViewing = isViewing;
      assetViewerManager._notify();
    },
    showAssetViewer: vi.fn(),
  };

  return {
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
    mockAssetViewerManager: assetViewerManager,
  };
});

const asAssetInteraction = (assetInteraction: typeof mockAssetInteraction) =>
  assetInteraction as unknown as AssetMultiSelectManager;

vi.mock('#lib/components/assets/thumbnail/Thumbnail.svelte', async () => {
  const { default: MockComponent } = await import('#lib/gallery/__mocks__/thumbnail-with-label.stub.svelte');
  return { default: MockComponent };
});

vi.mock('#lib/elements/Portal.svelte', async () => {
  const { default: MockComponent } = await import('#lib/gallery/__mocks__/sidebar.stub.svelte');
  return { default: MockComponent };
});

vi.mock('#lib/components/asset-viewer/AssetViewer.svelte', () => {
  return {
    default: function MockAssetViewer(_node: unknown, props: Record<string, unknown>) {
      assetViewerPropsCalls.push(props);
      return {
        $set: (nextProps: Record<string, unknown>) => {
          assetViewerPropsCalls.push(nextProps);
        },
        destroy: () => {},
      };
    },
  };
});

vi.mock('#lib/managers/asset-viewer-manager.svelte.js', async () => {
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

vi.mock('#lib/managers/feature-flags-manager.svelte.js', () => ({
  featureFlagsManager: { value: { trash: true } },
}));

vi.mock('lodash-es', async (importOriginal) => {
  const actual = await importOriginal<typeof import('lodash-es')>();
  return {
    ...actual,
    debounce: <T extends (...args: never[]) => unknown>(fn: T) => fn,
  };
});

// eslint-disable-next-line unicorn/no-unnecessary-parameters
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
    thumbhash: validThumbhash,
    width: 1600,
    height: 900,
    ...overrides,
  } as AssetResponseDto;
}

function renderViewer({
  assets = defaultAssets(),
  enableGrouping = true,
  // eslint-disable-next-line unicorn/no-unnecessary-parameters
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
  vi.stubGlobal('requestAnimationFrame', requestAnimationFrame);

  return {
    requestAnimationFrame,
    async flush() {
      while (callbacks.length > 0) {
        callbacks.shift()?.(performance.now());
        await Promise.resolve();
      }
    },
    restore() {
      vi.stubGlobal('requestAnimationFrame', originalRequestAnimationFrame);
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
  // A prototype-method mock genuinely needs the receiver: scrollIntoView() is called
  // with options, not the element, so `this` is the only handle on the scrolled node.
  Element.prototype.scrollIntoView = vi.fn(function (this: Element) {
    const selector = getScrolledElementSelector(this);
    scrolledElement = selector ? (document.querySelector(selector) ?? undefined) : undefined;
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
    register('en-US', () => import('#i18n/en.json'));
    await init({ fallbackLocale: 'en-US' });
    await waitLocale('en-US');
  });

  // `onRandom` navigates to the picked asset; the global `$app/navigation` fake records it on
  // the active mock router.
  const router = new MockRouter();

  beforeEach(() => {
    router.setup();
  });

  afterEach(() => {
    router.teardown();
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

  it('renders the grouping control when grouping is enabled and assets exist', async () => {
    await renderViewer();

    expect(page.getByTestId('timeline-desktop-grouping-control').element()).toBeInTheDocument();
  });

  it('does not render an orphaned grouping control for an empty asset list', async () => {
    await renderViewer({ assets: [], enableGrouping: true });

    expect(page.getByTestId('timeline-desktop-grouping-control').query()).not.toBeInTheDocument();
  });

  it('does not render the grouping control when grouping is disabled', async () => {
    await renderViewer({ enableGrouping: false });

    expect(page.getByTestId('timeline-desktop-grouping-control').query()).not.toBeInTheDocument();
  });

  it('manual grouping changes render representative year cards without temporal chips', async () => {
    await renderViewer();

    await userEvent.click(page.getByTestId('timeline-grouping-year').element());

    await vi.waitFor(() => {
      expect(page.getByTestId('timeline-bucket-card').elements()).toHaveLength(2);
      expect(page.getByTestId('active-filters-bar').query()).not.toBeInTheDocument();
      expect(page.getByTestId('thumbnail-asset-2015-aug').query()).not.toBeInTheDocument();
    });
  });

  it('zooms from year to month to detailed mode without narrowing the local asset array', async () => {
    const assets = defaultAssets();
    await renderViewer({ assets });

    await userEvent.click(page.getByTestId('timeline-grouping-year').element());
    await userEvent.click(page.getByRole('button', { name: /2015, 2 photos/i }).element());

    await vi.waitFor(() => {
      expect(page.getByTestId('active-filters-bar').query()).not.toBeInTheDocument();
      expect(page.getByTestId('timeline-grouping-month').element()).toHaveAttribute('aria-pressed', 'true');
      expect(page.getByTestId('timeline-bucket-card').elements()).toHaveLength(3);
      expect(page.getByRole('button', { name: /Jan 2016, 1 photo/i }).element()).toBeInTheDocument();
      expect(page.getByRole('button', { name: /Aug 2015, 1 photo/i }).element()).toBeInTheDocument();
      expect(page.getByRole('button', { name: /Jan 2015, 1 photo/i }).element()).toBeInTheDocument();
    });

    await userEvent.click(page.getByRole('button', { name: /Aug 2015, 1 photo/i }).element());

    await vi.waitFor(() => {
      expect(page.getByTestId('active-filters-bar').query()).not.toBeInTheDocument();
      expect(page.getByTestId('timeline-grouping-day').element()).toHaveAttribute('aria-pressed', 'true');
      expect(page.getByTestId('thumbnail-asset-2016').element()).toBeInTheDocument();
      expect(page.getByTestId('thumbnail-asset-2015-aug').element()).toBeInTheDocument();
      expect(page.getByTestId('thumbnail-asset-2015-jan').element()).toBeInTheDocument();
    });

    expect(assets.map((asset) => asset.id)).toEqual(['asset-2016', 'asset-2015-aug', 'asset-2015-jan']);
  });

  it('anchors year and month zooms to the first matching local bucket or asset', async () => {
    const frameQueue = createAnimationFrameQueue();
    const scrollTracker = trackScrolledElement();

    try {
      await renderViewer();

      await userEvent.click(page.getByTestId('timeline-grouping-year').element());
      await userEvent.click(page.getByRole('button', { name: /2015, 2 photos/i }).element());

      await vi.waitFor(() => expect(frameQueue.requestAnimationFrame).toHaveBeenCalled());
      await frameQueue.flush();

      await vi.waitFor(() => {
        expect(scrollTracker.scrolledElement).toHaveAttribute('data-gallery-bucket-year', '2015');
        expect(scrollTracker.scrolledElement).toHaveAttribute('data-gallery-bucket-month', '8');
        expect(page.getByTestId('timeline-grouping-month').element()).toHaveAttribute('aria-pressed', 'true');
      });

      frameQueue.requestAnimationFrame.mockClear();
      scrollTracker.reset();

      await userEvent.click(page.getByRole('button', { name: /Aug 2015, 1 photo/i }).element());

      await vi.waitFor(() => expect(frameQueue.requestAnimationFrame).toHaveBeenCalled());
      await frameQueue.flush();

      await vi.waitFor(() => {
        expect(scrollTracker.scrolledElement).toHaveAttribute('data-gallery-asset-year', '2015');
        expect(scrollTracker.scrolledElement).toHaveAttribute('data-gallery-asset-month', '8');
        expect(scrollTracker.scrolledElement).toHaveAttribute(
          'data-testid',
          'gallery-viewer-asset-anchor-asset-2015-aug',
        );
        expect(page.getByTestId('timeline-grouping-day').element()).toHaveAttribute('aria-pressed', 'true');
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
      await renderViewer();

      await userEvent.click(page.getByTestId('timeline-grouping-year').element());
      await userEvent.click(page.getByRole('button', { name: /2015, 2 photos/i }).element());

      await vi.waitFor(() => {
        expect(frameQueue.requestAnimationFrame).toHaveBeenCalled();
        expect(page.getByTestId('timeline-grouping-month').element()).toHaveAttribute('aria-pressed', 'true');
      });

      await userEvent.click(page.getByTestId('timeline-grouping-year').element());
      await vi.waitFor(() =>
        expect(page.getByTestId('timeline-grouping-year').element()).toHaveAttribute('aria-pressed', 'true'),
      );

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
      await renderViewer({ assets });

      await userEvent.click(page.getByTestId('timeline-grouping-year').element());
      await userEvent.click(page.getByRole('button', { name: /2015, 2 photos/i }).element());
      await vi.waitFor(() =>
        expect(page.getByTestId('timeline-grouping-month').element()).toHaveAttribute('aria-pressed', 'true'),
      );

      frameQueue.requestAnimationFrame.mockClear();
      scrollTracker.reset();

      await userEvent.click(page.getByRole('button', { name: /Aug 2015, 1 photo/i }).element());

      await vi.waitFor(() => expect(frameQueue.requestAnimationFrame).toHaveBeenCalled());
      await frameQueue.flush();

      await vi.waitFor(() => {
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
      const view = await renderViewer({ assets });

      await userEvent.click(page.getByTestId('timeline-grouping-year').element());
      await userEvent.click(page.getByRole('button', { name: /2015, 2 photos/i }).element());

      await vi.waitFor(() => {
        expect(frameQueue.requestAnimationFrame).toHaveBeenCalled();
        expect(page.getByTestId('timeline-grouping-month').element()).toHaveAttribute('aria-pressed', 'true');
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

      await vi.waitFor(() => {
        expect(page.getByTestId('active-filters-bar').query()).not.toBeInTheDocument();
        expect(page.getByTestId('timeline-grouping-month').element()).toHaveAttribute('aria-pressed', 'true');
        expect(page.getByTestId('timeline-bucket-card').elements()).toHaveLength(1);
        expect(page.getByRole('button', { name: /Jan 2016, 1 photo/i }).element()).toBeInTheDocument();
      });
      expect(scrollTracker.scrolledElement).toBeUndefined();
    } finally {
      frameQueue.restore();
      scrollTracker.restore();
    }
  });

  it('keeps single-asset GalleryViewer grids in normal day mode', async () => {
    await renderViewer({ assets: [asset('single-asset', '2015-08-03T00:00:00.000Z')] });

    expect(page.getByTestId('timeline-desktop-grouping-control').element()).toBeInTheDocument();
    expect(page.getByTestId('thumbnail-single-asset').element()).toBeInTheDocument();
    expect(page.getByTestId('gallery-viewer-representative-buckets').query()).not.toBeInTheDocument();
  });

  it('does not request more assets while representative buckets are displayed', async () => {
    const onIntersected = vi.fn();
    await renderViewer({ onIntersected });

    await userEvent.click(page.getByTestId('timeline-grouping-year').element());
    onIntersected.mockClear();
    await userEvent.click(page.getByRole('button', { name: /2015, 2 photos/i }).element());
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
    const view = await renderViewer({ assets, viewerAssets: widerViewerAssets });

    await userEvent.click(page.getByTestId('timeline-grouping-year').element());
    await userEvent.click(page.getByRole('button', { name: /2015, 2 photos/i }).element());
    await userEvent.click(page.getByRole('button', { name: /Aug 2015, 1 photo/i }).element());

    await vi.waitFor(() => {
      expect(page.getByTestId('active-filters-bar').query()).not.toBeInTheDocument();
      expect(page.getByTestId('thumbnail-asset-2016').element()).toBeInTheDocument();
      expect(page.getByTestId('thumbnail-asset-2015-aug').element()).toBeInTheDocument();
      expect(page.getByTestId('thumbnail-asset-2015-jan').element()).toBeInTheDocument();
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

    await vi.waitFor(() => {
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
    const view = await renderViewer({ assets });
    await userEvent.click(page.getByTestId('timeline-grouping-year').element());

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

    expect(page.getByTestId('timeline-desktop-grouping-control').query()).not.toBeInTheDocument();
    const yearCard = page.getByRole('button', { name: /2015, 2 photos/i }).element();
    expect(yearCard).toBeDisabled();
    // A disabled button is not actionable for a real pointer; dispatch the click directly.
    yearCard.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(page.getByTestId('active-filters-bar').query()).not.toBeInTheDocument();
  });

  it('preserves ungrouped day-mode GalleryViewer behavior when grouping is disabled', async () => {
    await renderViewer({ enableGrouping: false });

    expect(page.getByTestId('timeline-desktop-grouping-control').query()).not.toBeInTheDocument();
    expect(page.getByTestId('thumbnail-asset-2016').element()).toBeInTheDocument();
    expect(page.getByTestId('thumbnail-asset-2015-aug').element()).toBeInTheDocument();
  });
});
