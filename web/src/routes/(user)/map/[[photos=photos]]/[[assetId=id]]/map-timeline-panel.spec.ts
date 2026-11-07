import TestWrapper from '#lib/components/TestWrapper.svelte';
import { createFilterState, type FilterState } from '#lib/components/filter-panel/filter-panel.ts';
import type { Component } from 'svelte';
import { expect } from 'vitest';
import { render } from 'vitest-browser-svelte';
import { page, userEvent } from 'vitest/browser';
import MapTimelinePanel from './MapTimelinePanel.svelte';

const { mockAssetMultiSelectManager } = vi.hoisted(() => ({
  mockAssetMultiSelectManager: {
    selectionActive: false,
    assets: [],
    ownedAssets: [],
    clear: vi.fn(),
    getOwnedAssets: vi.fn(() => []),
    isAllFavorite: false,
    isAllArchived: false,
    isAllUserOwned: true,
  },
}));

vi.mock('#lib/components/timeline/Timeline.svelte', async () => {
  const { default: MockComponent } = await import('#lib/gallery/__mocks__/bindable-timeline.stub.svelte');
  return { default: MockComponent };
});

vi.mock('#lib/components/shared-components/context-menu/ButtonContextMenu.svelte', async () => {
  const { default: MockComponent } = await import('#lib/gallery/__mocks__/noop-component.svelte');
  return { default: MockComponent };
});

vi.mock('#lib/components/timeline/AssetSelectControlBar.svelte', async () => {
  const { default: MockComponent } = await import('#lib/gallery/__mocks__/noop-component.svelte');
  return { default: MockComponent };
});

vi.mock('#lib/gallery/actions/ArchiveAction.svelte', async () => {
  const { default: MockComponent } = await import('#lib/gallery/__mocks__/noop-component.svelte');
  return { default: MockComponent };
});

vi.mock('#lib/components/timeline/actions/ChangeDateAction.svelte', async () => {
  const { default: MockComponent } = await import('#lib/gallery/__mocks__/noop-component.svelte');
  return { default: MockComponent };
});

vi.mock('#lib/components/timeline/actions/ChangeDescriptionAction.svelte', async () => {
  const { default: MockComponent } = await import('#lib/gallery/__mocks__/noop-component.svelte');
  return { default: MockComponent };
});

vi.mock('#lib/components/timeline/actions/ChangeLocationAction.svelte', async () => {
  const { default: MockComponent } = await import('#lib/gallery/__mocks__/noop-component.svelte');
  return { default: MockComponent };
});

vi.mock('#lib/components/timeline/actions/DeleteAssetsAction.svelte', async () => {
  const { default: MockComponent } = await import('#lib/gallery/__mocks__/noop-component.svelte');
  return { default: MockComponent };
});

vi.mock('#lib/components/timeline/actions/DownloadAction.svelte', async () => {
  const { default: MockComponent } = await import('#lib/gallery/__mocks__/noop-component.svelte');
  return { default: MockComponent };
});

vi.mock('#lib/components/timeline/actions/FavoriteAction.svelte', async () => {
  const { default: MockComponent } = await import('#lib/gallery/__mocks__/noop-component.svelte');
  return { default: MockComponent };
});

vi.mock('#lib/components/timeline/actions/LinkLivePhotoAction.svelte', async () => {
  const { default: MockComponent } = await import('#lib/gallery/__mocks__/noop-component.svelte');
  return { default: MockComponent };
});

vi.mock('#lib/components/timeline/actions/SelectAllAction.svelte', async () => {
  const { default: MockComponent } = await import('#lib/gallery/__mocks__/noop-component.svelte');
  return { default: MockComponent };
});

vi.mock('#lib/components/timeline/actions/SetVisibilityAction.svelte', async () => {
  const { default: MockComponent } = await import('#lib/gallery/__mocks__/noop-component.svelte');
  return { default: MockComponent };
});

vi.mock('#lib/components/timeline/actions/StackAction.svelte', async () => {
  const { default: MockComponent } = await import('#lib/gallery/__mocks__/noop-component.svelte');
  return { default: MockComponent };
});

vi.mock('#lib/components/timeline/actions/TagAction.svelte', async () => {
  const { default: MockComponent } = await import('#lib/gallery/__mocks__/noop-component.svelte');
  return { default: MockComponent };
});

vi.mock('#lib/elements/Portal.svelte', async () => {
  const { default: MockComponent } = await import('#lib/gallery/__mocks__/noop-component.svelte');
  return { default: MockComponent };
});

vi.mock('#lib/managers/asset-multi-select-manager.svelte.js', () => ({
  assetMultiSelectManager: mockAssetMultiSelectManager,
}));

vi.mock('#lib/managers/auth-manager.svelte.js', () => ({
  authManager: { preferences: { tags: { enabled: true } } },
}));

vi.mock('#lib/services/asset.service.js', () => ({
  getAssetBulkActions: vi.fn(() => ({})),
}));

async function renderPanel(filters = createFilterState(), onFiltersChange?: (filters: FilterState) => void) {
  return await render(
    TestWrapper as Component<{ component: typeof MapTimelinePanel; componentProps: Record<string, unknown> }>,
    {
      component: MapTimelinePanel,
      componentProps: {
        bbox: { west: 1, south: 2, east: 3, north: 4 },
        selectedClusterIds: new Set(['asset-1', 'asset-2']),
        filters,
        onClose: vi.fn(),
        ...(onFiltersChange && { onFiltersChange }),
      },
    },
  );
}

type TimelineStubGlobal = typeof globalThis & { __timelineStubAssetCount?: number };

const timelineStubGlobals = globalThis as TimelineStubGlobal;

describe('MapTimelinePanel grouping', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockAssetMultiSelectManager.selectionActive = false;
    mockAssetMultiSelectManager.assets = [];
    mockAssetMultiSelectManager.ownedAssets = [];
  });

  afterEach(() => {
    timelineStubGlobals.__timelineStubAssetCount = undefined;
  });

  // Task 10: the header used to be handed `selectedClusterIds.size` by the map page — the number of
  // pins in the cluster at CLICK time, which no filter change ever recomputed ("50 assets" over the
  // five pins a rating filter had left). It must count what the panel itself lists.
  it('counts the assets its own timeline holds, not the size of the cluster selection', async () => {
    timelineStubGlobals.__timelineStubAssetCount = 7;

    await renderPanel(); // the cluster selection carries 2 ids

    await expect.element(page.getByTestId('map-panel-asset-count')).toHaveAttribute('data-asset-count', '7');
  });

  it('reports an empty panel when its timeline holds nothing (a filter excluded every pin)', async () => {
    timelineStubGlobals.__timelineStubAssetCount = 0;

    await renderPanel();

    await expect.element(page.getByTestId('map-panel-asset-count')).toHaveAttribute('data-asset-count', '0');
  });

  it('renders compact grouping controls and passes mobile grouping props', async () => {
    await renderPanel();

    await expect.element(page.getByTestId('timeline-desktop-grouping-control')).toBeInTheDocument();
    await expect
      .element(page.getByTestId('timeline-mobile-grouping-props'))
      .toMatchTextContent(JSON.stringify({ grouping: 'day', hasHandler: true }));
  });

  it('manual grouping changes keep map bbox and selected cluster filters without temporal chips', async () => {
    await renderPanel();

    await userEvent.click(page.getByTestId('timeline-grouping-year'));

    await expect.element(page.getByTestId('timeline-options')).toMatchTextContent('"grouping":"year"');
    await expect.element(page.getByTestId('timeline-options')).toMatchTextContent('"assetFilter":{}');
    await expect.element(page.getByTestId('active-filters-bar')).not.toBeInTheDocument();
  });

  it('year bucket activation keeps map filters and anchors without temporal filters', async () => {
    await renderPanel(createFilterState());

    await userEvent.click(page.getByTestId('activate-year-bucket'));

    await expect.element(page.getByTestId('timeline-options')).toMatchTextContent('"grouping":"month"');
    await expect.element(page.getByTestId('timeline-options')).toMatchTextContent('"assetFilter":{}');
    await expect.element(page.getByTestId('timeline-options')).not.toMatchTextContent('"takenAfter"');
    await expect.element(page.getByTestId('timeline-options')).not.toMatchTextContent('"takenBefore"');
    await expect.element(page.getByTestId('active-filters-bar')).not.toBeInTheDocument();
    await expect.element(page.getByTestId('timeline-anchor')).toMatchTextContent(JSON.stringify({ year: 2015 }));
  });

  it('month bucket activation keeps map filters and anchors without temporal filters', async () => {
    await renderPanel(createFilterState());

    await userEvent.click(page.getByTestId('activate-month-bucket'));

    await expect.element(page.getByTestId('timeline-options')).toMatchTextContent('"grouping":"day"');
    await expect.element(page.getByTestId('timeline-options')).toMatchTextContent('"assetFilter":{}');
    await expect.element(page.getByTestId('timeline-options')).not.toMatchTextContent('"takenAfter"');
    await expect.element(page.getByTestId('timeline-options')).not.toMatchTextContent('"takenBefore"');
    await expect.element(page.getByTestId('active-filters-bar')).not.toBeInTheDocument();
    await expect
      .element(page.getByTestId('timeline-anchor'))
      .toMatchTextContent(JSON.stringify({ year: 2015, month: 8 }));
  });

  it('explicit map temporal filters still show chips and clear without changing grouping', async () => {
    await renderPanel({ ...createFilterState(), selectedYear: 2015 });

    await expect.element(page.getByTestId('active-filters-bar')).toMatchTextContent('2015');
    await expect
      .element(page.getByTestId('timeline-options'))
      .toMatchTextContent('"takenAfter":"2015-01-01T00:00:00.000Z"');
    await expect
      .element(page.getByTestId('timeline-options'))
      .toMatchTextContent('"takenBefore":"2016-01-01T00:00:00.000Z"');
    await expect.element(page.getByTestId('timeline-options')).toMatchTextContent('"grouping":"day"');

    await userEvent.click(page.getByRole('button', { name: 'filter_remove_chip' }));

    await expect.element(page.getByTestId('active-filters-bar')).not.toBeInTheDocument();
    await expect.element(page.getByTestId('timeline-options')).not.toMatchTextContent('"takenAfter"');
    await expect.element(page.getByTestId('timeline-options')).not.toMatchTextContent('"takenBefore"');
    await expect.element(page.getByTestId('timeline-options')).toMatchTextContent('"grouping":"day"');
    await expect.element(page.getByTestId('timeline-anchor')).toMatchTextContent('null');
  });

  // Finding 1 (#767 fresh instance): clearing the temporal chip INSIDE the panel used to only
  // mutate the bound `filters` in memory — the map page's URL (from/to) never got told, so a
  // reload / Back / shared link brought the "cleared" filter right back. The panel must notify the
  // page (onFiltersChange), exactly like FilterPanel does, so the caller can sync the URL.
  it('notifies onFiltersChange with the temporal fields cleared when the chip is removed inside the panel', async () => {
    const onFiltersChange = vi.fn();
    await renderPanel({ ...createFilterState(), dateAfter: '2024-01-01', dateBefore: '2024-06-30' }, onFiltersChange);

    await expect.element(page.getByTestId('active-filters-bar')).toBeInTheDocument();

    await userEvent.click(page.getByRole('button', { name: 'filter_remove_chip' }));

    await vi.waitFor(() => {
      expect(onFiltersChange).toHaveBeenCalledWith(
        expect.objectContaining({
          dateAfter: undefined,
          dateBefore: undefined,
          selectedYear: undefined,
          selectedMonth: undefined,
        }),
      );
    });
  });

  it('ignores map bucket activation while selection mode is active', async () => {
    mockAssetMultiSelectManager.selectionActive = true;
    await renderPanel(createFilterState());

    await userEvent.click(page.getByTestId('activate-year-bucket'));

    await expect.element(page.getByTestId('timeline-options')).toMatchTextContent('"grouping":"day"');
    await expect.element(page.getByTestId('timeline-anchor')).toMatchTextContent('null');
  });

  it('hides panel grouping controls while selection mode is active', async () => {
    mockAssetMultiSelectManager.selectionActive = true;

    await renderPanel();

    await expect.element(page.getByTestId('timeline-desktop-grouping-control')).not.toBeInTheDocument();
    await expect
      .element(page.getByTestId('timeline-mobile-grouping-props'))
      .toMatchTextContent(JSON.stringify({ grouping: 'day', hasHandler: false }));
  });
});
