import TestWrapper from '#lib/components/TestWrapper.svelte';
import type { Component } from 'svelte';
import { expect } from 'vitest';
import { render } from 'vitest-browser-svelte';
import { page } from 'vitest/browser';
import LockedPage from './+page.svelte';

type TimelineStubGlobals = typeof globalThis & {
  __timelineStubAssetCount?: number;
};

const timelineStubGlobals = globalThis as TimelineStubGlobals;

const { gotoMock, mockAssetMultiSelectManager } = vi.hoisted(() => ({
  gotoMock: vi.fn(),
  mockAssetMultiSelectManager: {
    selectionActive: false,
    assets: [],
    clear: vi.fn(),
  },
}));

vi.mock('$app/navigation', async () => ({
  ...(await import('#test/unit/mocks/app-navigation.ts')),
  goto: gotoMock,
}));

vi.mock('#lib/components/OnEvents.svelte', async () => {
  const { default: MockComponent } = await import('#lib/gallery/__mocks__/noop-component.svelte');
  return { default: MockComponent };
});

vi.mock('#lib/components/layouts/UserPageLayout.svelte', async () => {
  const { default: MockComponent } = await import('#lib/components/spaces/mock-user-page-layout.test-wrapper.svelte');
  return { default: MockComponent };
});

vi.mock('#lib/components/shared-components/context-menu/ButtonContextMenu.svelte', async () => {
  const { default: MockComponent } = await import('#lib/gallery/__mocks__/noop-component.svelte');
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

vi.mock('#lib/components/timeline/actions/ChangeDateAction.svelte', async () => {
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

vi.mock('#lib/components/timeline/actions/SelectAllAction.svelte', async () => {
  const { default: MockComponent } = await import('#lib/gallery/__mocks__/noop-component.svelte');
  return { default: MockComponent };
});

vi.mock('#lib/components/timeline/actions/SetVisibilityAction.svelte', async () => {
  const { default: MockComponent } = await import('#lib/gallery/__mocks__/noop-component.svelte');
  return { default: MockComponent };
});

vi.mock('#lib/managers/asset-multi-select-manager.svelte.js', () => ({
  assetMultiSelectManager: mockAssetMultiSelectManager,
}));

vi.mock('#lib/services/user.service.js', () => ({
  getUserActions: vi.fn(() => ({ LockSession: {} })),
}));

function renderPage() {
  const props = { data: { meta: { title: 'Locked' } } };

  return render(TestWrapper as Component<{ component: typeof LockedPage; componentProps: typeof props }>, {
    component: LockedPage,
    componentProps: props,
  });
}

describe('Locked page timeline grouping', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockAssetMultiSelectManager.selectionActive = false;
    mockAssetMultiSelectManager.assets = [];
    timelineStubGlobals.__timelineStubAssetCount = undefined;
  });

  afterEach(() => {
    timelineStubGlobals.__timelineStubAssetCount = undefined;
  });

  const options = () => page.getByTestId('timeline-options');
  const anchor = () => page.getByTestId('timeline-anchor');

  it('renders desktop grouping controls and mobile grouping props for locked assets', async () => {
    await renderPage();

    await expect.element(page.getByTestId('timeline-desktop-grouping-control')).toBeInTheDocument();
    await expect.element(page.getByTestId('timeline-grouping-day')).toHaveAttribute('aria-pressed', 'true');
    await expect
      .element(page.getByTestId('timeline-mobile-grouping-props'))
      .toMatchTextContent(JSON.stringify({ grouping: 'day', hasHandler: true }));
    await expect.element(options()).toMatchTextContent('"visibility":"locked"');
    await expect.element(options()).toMatchTextContent('"grouping":"day"');
  });

  it('year and month buckets keep locked options without temporal chips', async () => {
    await renderPage();

    await page.getByTestId('activate-year-bucket').click();

    await expect.element(options()).toMatchTextContent('"visibility":"locked"');
    await expect.element(options()).toMatchTextContent('"grouping":"month"');
    await expect.element(options()).not.toMatchTextContent('"takenAfter"');
    await expect.element(options()).not.toMatchTextContent('"takenBefore"');
    await expect.element(page.getByTestId('active-filters-bar')).not.toBeInTheDocument();
    await expect.element(anchor()).toMatchTextContent('{"year":2015}');

    await page.getByTestId('activate-month-bucket').click();

    await expect.element(options()).toMatchTextContent('"visibility":"locked"');
    await expect.element(options()).toMatchTextContent('"grouping":"day"');
    await expect.element(options()).not.toMatchTextContent('"takenAfter"');
    await expect.element(options()).not.toMatchTextContent('"takenBefore"');
    await expect.element(page.getByTestId('active-filters-bar')).not.toBeInTheDocument();
    await expect.element(anchor()).toMatchTextContent('{"year":2015,"month":8}');
  });

  it('bucket activation does not render a temporal result count chip', async () => {
    await renderPage();

    await page.getByTestId('activate-year-bucket').click();

    await expect.element(options()).toMatchTextContent('"grouping":"month"');
    await expect.element(anchor()).toMatchTextContent('{"year":2015}');
    expect(page.getByTestId('result-count').query()).toBeNull();
    expect(page.getByTestId('active-filters-bar').query()).toBeNull();
  });

  it('manual grouping changes do not create temporal chips', async () => {
    await renderPage();

    await page.getByTestId('timeline-grouping-year').click();

    await expect.element(options()).toMatchTextContent('"grouping":"year"');
    expect(page.getByTestId('active-filters-bar').query()).toBeNull();
    // The grouping change preserves position via a scroll anchor, not a filter chip.
    await expect.element(anchor()).not.toMatchTextContent('null');
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

    await expect.element(options()).toMatchTextContent('"grouping":"day"');
    await expect.element(anchor()).toMatchTextContent('null');
    expect(page.getByTestId('active-filters-bar').query()).toBeNull();
  });

  it('unfiltered empty placeholder does not render orphaned grouping controls', async () => {
    timelineStubGlobals.__timelineStubAssetCount = 0;

    await renderPage();

    await expect.element(page.getByTestId('timeline-desktop-grouping-control')).not.toBeInTheDocument();
  });

  it('never shows the add-all-to-collection button (excluded surface)', async () => {
    timelineStubGlobals.__timelineStubAssetCount = 3;

    await renderPage();

    await expect.element(page.getByTestId('timeline-desktop-grouping-control')).toBeInTheDocument();
    expect(page.getByTestId('add-all-to-collection').query()).toBeNull();
  });
});
