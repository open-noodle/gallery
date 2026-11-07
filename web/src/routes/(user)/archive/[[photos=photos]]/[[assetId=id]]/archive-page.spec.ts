import TestWrapper from '#lib/components/TestWrapper.svelte';
import type { Component } from 'svelte';
import { render } from 'vitest-browser-svelte';
import { page, userEvent } from 'vitest/browser';
import ArchivePage from './+page.svelte';

type TimelineStubGlobals = typeof globalThis & {
  __timelineStubAssetCount?: number;
};

const timelineStubGlobals = globalThis as TimelineStubGlobals;

const { mockAssetMultiSelectManager, mockRegisterSelectionContext } = vi.hoisted(() => ({
  mockAssetMultiSelectManager: {
    selectionActive: false,
    assets: [],
    clear: vi.fn(),
    isAllFavorite: false,
    isAllUserOwned: true,
  },
  mockRegisterSelectionContext: vi.fn(),
}));

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

vi.mock('#lib/gallery/actions/ArchiveAction.svelte', async () => {
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

vi.mock('#lib/components/timeline/actions/RotateAction.svelte', async () => {
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

vi.mock('#lib/managers/command-context-manager.svelte.js', () => ({
  registerSelectionContext: mockRegisterSelectionContext,
}));

vi.mock('#lib/services/asset.service.js', () => ({
  getAssetBulkActions: vi.fn(() => ({})),
}));

async function renderPage() {
  const props = {
    data: {
      meta: { title: 'Archive' },
    },
  };

  return render(TestWrapper as Component<{ component: typeof ArchivePage; componentProps: typeof props }>, {
    component: ArchivePage,
    componentProps: props,
  });
}

describe('Archive page cmdk selection context', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockAssetMultiSelectManager.selectionActive = false;
    mockAssetMultiSelectManager.assets = [];
  });

  it('registers add-to-album, favorite, and delete without archive or undo callbacks', async () => {
    await renderPage();

    expect(mockRegisterSelectionContext).toHaveBeenCalledOnce();
    const options = mockRegisterSelectionContext.mock.calls[0][0];
    expect(options.getAssets()).toBe(mockAssetMultiSelectManager.assets);
    expect(options.canAddToAlbum()).toBe(true);
    expect(options.getOnFavorite()).toEqual(expect.any(Function));
    expect(options.getOnArchive?.()).toBeUndefined();
    expect(options.getOnDelete()).toEqual(expect.any(Function));
    expect(options.getOnUndoDelete?.()).toBeUndefined();
    expect(options.getAddSelectedToCurrentSpace?.()).toBeUndefined();
  });
});

describe('Archive page timeline grouping', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockAssetMultiSelectManager.selectionActive = false;
    mockAssetMultiSelectManager.assets = [];
    timelineStubGlobals.__timelineStubAssetCount = undefined;
  });

  afterEach(() => {
    timelineStubGlobals.__timelineStubAssetCount = undefined;
  });

  it('renders desktop grouping controls and mobile grouping props for archive', async () => {
    await renderPage();

    expect(await vi.waitFor(() => page.getByTestId('timeline-desktop-grouping-control').element())).toBeInTheDocument();
    expect(page.getByTestId('timeline-grouping-day').element()).toHaveAttribute('aria-pressed', 'true');
    expect(page.getByTestId('timeline-mobile-grouping-props').element()).toMatchTextContent(
      JSON.stringify({ grouping: 'day', hasHandler: true }),
    );
    expect(page.getByTestId('timeline-options').element()).toMatchTextContent('"visibility":"archive"');
    expect(page.getByTestId('timeline-options').element()).toMatchTextContent('"grouping":"day"');
  });

  it('year and month buckets keep archive options without temporal chips', async () => {
    await renderPage();

    await userEvent.click(await vi.waitFor(() => page.getByTestId('activate-year-bucket').element()));

    await vi.waitFor(() => {
      expect(page.getByTestId('timeline-options').element()).toMatchTextContent('"visibility":"archive"');
      expect(page.getByTestId('timeline-options').element()).toMatchTextContent('"grouping":"month"');
      expect(page.getByTestId('timeline-options').element()).not.toMatchTextContent('"takenAfter"');
      expect(page.getByTestId('timeline-options').element()).not.toMatchTextContent('"takenBefore"');
      expect(page.getByTestId('active-filters-bar').query()).not.toBeInTheDocument();
      expect(page.getByTestId('timeline-anchor').element()).toMatchTextContent('{"year":2015}');
    });

    await userEvent.click(page.getByTestId('activate-month-bucket'));

    await vi.waitFor(() => {
      expect(page.getByTestId('timeline-options').element()).toMatchTextContent('"visibility":"archive"');
      expect(page.getByTestId('timeline-options').element()).toMatchTextContent('"grouping":"day"');
      expect(page.getByTestId('timeline-options').element()).not.toMatchTextContent('"takenAfter"');
      expect(page.getByTestId('timeline-options').element()).not.toMatchTextContent('"takenBefore"');
      expect(page.getByTestId('active-filters-bar').query()).not.toBeInTheDocument();
      expect(page.getByTestId('timeline-anchor').element()).toMatchTextContent('{"year":2015,"month":8}');
    });
  });

  it('bucket activation does not render a temporal result count chip', async () => {
    await renderPage();

    await userEvent.click(await vi.waitFor(() => page.getByTestId('activate-year-bucket').element()));

    await vi.waitFor(() => {
      expect(page.getByTestId('timeline-options').element()).toMatchTextContent('"grouping":"month"');
      expect(page.getByTestId('timeline-anchor').element()).toMatchTextContent('{"year":2015}');
    });
    expect(page.getByTestId('result-count').query()).not.toBeInTheDocument();
    expect(page.getByTestId('active-filters-bar').query()).not.toBeInTheDocument();
  });

  it('manual grouping changes do not create temporal chips', async () => {
    await renderPage();

    await userEvent.click(await vi.waitFor(() => page.getByTestId('timeline-grouping-year').element()));

    await vi.waitFor(() => {
      expect(page.getByTestId('timeline-options').element()).toMatchTextContent('"grouping":"year"');
    });
    expect(page.getByTestId('active-filters-bar').query()).not.toBeInTheDocument();
    // The grouping change preserves position via a scroll anchor, not a filter chip.
    expect(page.getByTestId('timeline-anchor').element()).not.toMatchTextContent('null');
  });

  it('selection mode hides desktop grouping controls', async () => {
    mockAssetMultiSelectManager.selectionActive = true;

    await renderPage();

    expect(page.getByTestId('timeline-desktop-grouping-control').query()).not.toBeInTheDocument();
  });

  it('ignores bucket activation while selection mode is active', async () => {
    mockAssetMultiSelectManager.selectionActive = true;

    await renderPage();
    await userEvent.click(await vi.waitFor(() => page.getByTestId('activate-year-bucket').element()));

    await vi.waitFor(() => {
      expect(page.getByTestId('timeline-options').element()).toMatchTextContent('"grouping":"day"');
      expect(page.getByTestId('timeline-anchor').element()).toMatchTextContent('null');
    });
    expect(page.getByTestId('active-filters-bar').query()).not.toBeInTheDocument();
  });

  it('unfiltered empty placeholder does not render orphaned grouping controls', async () => {
    timelineStubGlobals.__timelineStubAssetCount = 0;

    await renderPage();

    await vi.waitFor(() => {
      expect(page.getByTestId('timeline-desktop-grouping-control').query()).not.toBeInTheDocument();
    });
  });

  it('shows the add-all-to-collection button when the surface has results', async () => {
    timelineStubGlobals.__timelineStubAssetCount = 3;

    await renderPage();

    expect(await vi.waitFor(() => page.getByTestId('add-all-to-collection').element())).toBeInTheDocument();
  });

  it('hides the add-all-to-collection button when empty', async () => {
    timelineStubGlobals.__timelineStubAssetCount = 0;

    await renderPage();

    await vi.waitFor(() => page.getByTestId('timeline-stub').element());
    expect(page.getByTestId('add-all-to-collection').query()).not.toBeInTheDocument();
  });
});
