import TestWrapper from '#lib/components/TestWrapper.svelte';
import type { Component } from 'svelte';
import { render } from 'vitest-browser-svelte';
import { page } from 'vitest/browser';
import TrashPage from './+page.svelte';

type TimelineStubGlobals = typeof globalThis & {
  __timelineStubAssetCount?: number;
};

const timelineStubGlobals = globalThis as TimelineStubGlobals;

const { mockAssetMultiSelectManager, mockFeatureFlagsManager, mockServerConfigManager } = vi.hoisted(() => ({
  mockAssetMultiSelectManager: {
    selectionActive: false,
    assets: [],
    clear: vi.fn(),
  },
  mockFeatureFlagsManager: { value: { trash: true } },
  mockServerConfigManager: { value: { trashDays: 30 } },
}));

vi.mock('#lib/components/layouts/UserPageLayout.svelte', async () => {
  const { default: MockComponent } = await import('#lib/components/spaces/mock-user-page-layout.test-wrapper.svelte');
  return { default: MockComponent };
});

vi.mock('#lib/components/shared-components/EmptyPlaceholder.svelte', async () => {
  const { default: MockComponent } = await import('#lib/gallery/__mocks__/noop-component.svelte');
  return { default: MockComponent };
});

vi.mock('#lib/components/timeline/Timeline.svelte', async () => {
  const { default: MockComponent } = await import('#lib/gallery/__mocks__/bindable-timeline.stub.svelte');
  return { default: MockComponent };
});

vi.mock('#lib/components/timeline/AssetSelectControlBar.svelte', async () => {
  const { default: MockComponent } = await import('#lib/gallery/__mocks__/noop-component.svelte');
  return { default: MockComponent };
});

vi.mock('#lib/components/timeline/actions/DeleteAssetsAction.svelte', async () => {
  const { default: MockComponent } = await import('#lib/gallery/__mocks__/noop-component.svelte');
  return { default: MockComponent };
});

vi.mock('#lib/components/timeline/actions/SelectAllAction.svelte', async () => {
  const { default: MockComponent } = await import('#lib/gallery/__mocks__/noop-component.svelte');
  return { default: MockComponent };
});

vi.mock('./RestoreAction.svelte', async () => {
  const { default: MockComponent } = await import('#lib/gallery/__mocks__/noop-component.svelte');
  return { default: MockComponent };
});

vi.mock('#lib/managers/asset-multi-select-manager.svelte.js', () => ({
  assetMultiSelectManager: mockAssetMultiSelectManager,
}));

vi.mock('#lib/managers/feature-flags-manager.svelte.js', () => ({
  featureFlagsManager: mockFeatureFlagsManager,
}));

vi.mock('#lib/managers/server-config-manager.svelte', () => ({
  serverConfigManager: mockServerConfigManager,
}));

vi.mock('#lib/services/trash.service.js', () => ({
  getTrashActions: vi.fn(() => ({ Empty: {}, RestoreAll: {} })),
}));

// Substring checks on a stub's rendered JSON; jest-dom's toHaveTextContent matched substrings.
const text = (testId: string) => page.getByTestId(testId).element().textContent ?? '';

function renderPage() {
  const props = { data: { meta: { title: 'Trash' } } };

  return render(TestWrapper as Component<{ component: typeof TrashPage; componentProps: typeof props }>, {
    component: TrashPage,
    componentProps: props,
  });
}

describe('Trash page timeline grouping', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockAssetMultiSelectManager.selectionActive = false;
    mockAssetMultiSelectManager.assets = [];
    mockFeatureFlagsManager.value.trash = true;
    timelineStubGlobals.__timelineStubAssetCount = undefined;
  });

  afterEach(() => {
    timelineStubGlobals.__timelineStubAssetCount = undefined;
  });

  it('renders desktop grouping controls and mobile grouping props for trash', async () => {
    await renderPage();

    await expect.element(page.getByTestId('timeline-desktop-grouping-control')).toBeInTheDocument();
    await expect.element(page.getByTestId('timeline-grouping-day')).toHaveAttribute('aria-pressed', 'true');
    expect(text('timeline-mobile-grouping-props')).toContain(JSON.stringify({ grouping: 'day', hasHandler: true }));
    expect(text('timeline-options')).toContain('"isTrashed":true');
    expect(text('timeline-options')).toContain('"grouping":"day"');
  });

  it('year and month buckets keep trash options without temporal chips', async () => {
    await renderPage();

    await page.getByTestId('activate-year-bucket').click();

    await vi.waitFor(() => {
      expect(text('timeline-options')).toContain('"isTrashed":true');
      expect(text('timeline-options')).toContain('"grouping":"month"');
      expect(text('timeline-options')).not.toContain('"takenAfter"');
      expect(text('timeline-options')).not.toContain('"takenBefore"');
      expect(page.getByTestId('active-filters-bar').query()).toBeNull();
      expect(text('timeline-anchor')).toContain('{"year":2015}');
    });

    await page.getByTestId('activate-month-bucket').click();

    await vi.waitFor(() => {
      expect(text('timeline-options')).toContain('"isTrashed":true');
      expect(text('timeline-options')).toContain('"grouping":"day"');
      expect(text('timeline-options')).not.toContain('"takenAfter"');
      expect(text('timeline-options')).not.toContain('"takenBefore"');
      expect(page.getByTestId('active-filters-bar').query()).toBeNull();
      expect(text('timeline-anchor')).toContain('{"year":2015,"month":8}');
    });
  });

  it('bucket activation does not render a temporal result count chip', async () => {
    await renderPage();

    await page.getByTestId('activate-year-bucket').click();

    await vi.waitFor(() => {
      expect(text('timeline-options')).toContain('"grouping":"month"');
      expect(text('timeline-anchor')).toContain('{"year":2015}');
    });
    expect(page.getByTestId('result-count').query()).toBeNull();
    expect(page.getByTestId('active-filters-bar').query()).toBeNull();
  });

  it('manual grouping changes do not create temporal chips', async () => {
    await renderPage();

    await page.getByTestId('timeline-grouping-year').click();

    await vi.waitFor(() => {
      expect(text('timeline-options')).toContain('"grouping":"year"');
    });
    expect(page.getByTestId('active-filters-bar').query()).toBeNull();
    // The grouping change preserves position via a scroll anchor, not a filter chip.
    expect(text('timeline-anchor')).not.toContain('null');
  });

  it('selection mode hides desktop grouping controls', async () => {
    mockAssetMultiSelectManager.selectionActive = true;

    await renderPage();

    expect(page.getByTestId('timeline-desktop-grouping-control').query()).toBeNull();
  });

  it('ignores bucket activation while selection mode is active', async () => {
    mockAssetMultiSelectManager.selectionActive = true;

    await renderPage();
    await page.getByTestId('activate-year-bucket').click();

    await vi.waitFor(() => {
      expect(text('timeline-options')).toContain('"grouping":"day"');
      expect(text('timeline-anchor')).toContain('null');
    });
    expect(page.getByTestId('active-filters-bar').query()).toBeNull();
  });

  it('unfiltered empty placeholder does not render orphaned grouping controls', async () => {
    timelineStubGlobals.__timelineStubAssetCount = 0;

    await renderPage();

    await vi.waitFor(() => {
      expect(page.getByTestId('timeline-desktop-grouping-control').query()).toBeNull();
    });
  });

  it('never shows the add-all-to-collection button (excluded surface)', async () => {
    timelineStubGlobals.__timelineStubAssetCount = 3;

    await renderPage();

    await expect.element(page.getByTestId('timeline-desktop-grouping-control')).toBeInTheDocument();
    expect(page.getByTestId('add-all-to-collection').query()).toBeNull();
  });
});
