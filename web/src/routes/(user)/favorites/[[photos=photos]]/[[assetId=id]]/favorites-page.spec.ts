import '@testing-library/jest-dom';
import { fireEvent, render, screen, waitFor } from '@testing-library/svelte';
import type { Component } from 'svelte';
import TestWrapper from '$lib/components/TestWrapper.svelte';
import FavoritesPage from './+page.svelte';

type TimelineStubGlobals = typeof globalThis & {
  __timelineStubAssetCount?: number;
};

const timelineStubGlobals = globalThis as TimelineStubGlobals;

const { mockAssetMultiSelectManager } = vi.hoisted(() => ({
  mockAssetMultiSelectManager: {
    selectionActive: false,
    assets: [],
    clear: vi.fn(),
    isAllFavorite: false,
    isAllArchived: false,
    isAllUserOwned: true,
  },
}));

vi.mock('$lib/components/layouts/UserPageLayout.svelte', async () => {
  const { default: MockComponent } = await import('$lib/components/spaces/mock-user-page-layout.test-wrapper.svelte');
  return { default: MockComponent };
});

vi.mock('$lib/components/shared-components/context-menu/ButtonContextMenu.svelte', async () => {
  const { default: MockComponent } = await import('@test-data/mocks/noop-component.svelte');
  return { default: MockComponent };
});

vi.mock('$lib/components/shared-components/EmptyPlaceholder.svelte', async () => {
  const { default: MockComponent } = await import('@test-data/mocks/noop-component.svelte');
  return { default: MockComponent };
});

vi.mock('$lib/components/timeline/Timeline.svelte', async () => {
  const { default: MockComponent } = await import('@test-data/mocks/bindable-timeline.stub.svelte');
  return { default: MockComponent };
});

vi.mock('$lib/components/timeline/AssetSelectControlBar.svelte', async () => {
  const { default: MockComponent } = await import('@test-data/mocks/noop-component.svelte');
  return { default: MockComponent };
});

vi.mock('$lib/components/timeline/actions/ArchiveAction.svelte', async () => {
  const { default: MockComponent } = await import('@test-data/mocks/noop-component.svelte');
  return { default: MockComponent };
});

vi.mock('$lib/components/timeline/actions/ChangeDateAction.svelte', async () => {
  const { default: MockComponent } = await import('@test-data/mocks/noop-component.svelte');
  return { default: MockComponent };
});

vi.mock('$lib/components/timeline/actions/ChangeDescriptionAction.svelte', async () => {
  const { default: MockComponent } = await import('@test-data/mocks/noop-component.svelte');
  return { default: MockComponent };
});

vi.mock('$lib/components/timeline/actions/ChangeLocationAction.svelte', async () => {
  const { default: MockComponent } = await import('@test-data/mocks/noop-component.svelte');
  return { default: MockComponent };
});

vi.mock('$lib/components/timeline/actions/CreateSharedLinkAction.svelte', async () => {
  const { default: MockComponent } = await import('@test-data/mocks/noop-component.svelte');
  return { default: MockComponent };
});

vi.mock('$lib/components/timeline/actions/DeleteAssetsAction.svelte', async () => {
  const { default: MockComponent } = await import('@test-data/mocks/noop-component.svelte');
  return { default: MockComponent };
});

vi.mock('$lib/components/timeline/actions/DownloadAction.svelte', async () => {
  const { default: MockComponent } = await import('@test-data/mocks/noop-component.svelte');
  return { default: MockComponent };
});

vi.mock('$lib/components/timeline/actions/FavoriteAction.svelte', async () => {
  const { default: MockComponent } = await import('@test-data/mocks/noop-component.svelte');
  return { default: MockComponent };
});

vi.mock('$lib/components/timeline/actions/RotateAction.svelte', async () => {
  const { default: MockComponent } = await import('@test-data/mocks/noop-component.svelte');
  return { default: MockComponent };
});

vi.mock('$lib/components/timeline/actions/SelectAllAction.svelte', async () => {
  const { default: MockComponent } = await import('@test-data/mocks/noop-component.svelte');
  return { default: MockComponent };
});

vi.mock('$lib/components/timeline/actions/SetVisibilityAction.svelte', async () => {
  const { default: MockComponent } = await import('@test-data/mocks/noop-component.svelte');
  return { default: MockComponent };
});

vi.mock('$lib/components/timeline/actions/TagAction.svelte', async () => {
  const { default: MockComponent } = await import('@test-data/mocks/noop-component.svelte');
  return { default: MockComponent };
});

vi.mock('$lib/managers/asset-multi-select-manager.svelte', () => ({
  assetMultiSelectManager: mockAssetMultiSelectManager,
}));

vi.mock('$lib/managers/auth-manager.svelte', () => ({
  authManager: { preferences: { tags: { enabled: true } } },
}));

vi.mock('$lib/services/asset.service', () => ({
  getAssetBulkActions: vi.fn(() => ({})),
}));

function renderPage() {
  const props = { data: { meta: { title: 'Favorites' } } };

  return render(TestWrapper as Component<{ component: typeof FavoritesPage; componentProps: typeof props }>, {
    component: FavoritesPage,
    componentProps: props,
  });
}

describe('Favorites page timeline grouping', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockAssetMultiSelectManager.selectionActive = false;
    mockAssetMultiSelectManager.assets = [];
    timelineStubGlobals.__timelineStubAssetCount = undefined;
  });

  afterEach(() => {
    timelineStubGlobals.__timelineStubAssetCount = undefined;
  });

  it('renders desktop grouping controls and mobile grouping props for favorites', async () => {
    renderPage();

    expect(await screen.findByTestId('timeline-desktop-grouping-control')).toBeInTheDocument();
    expect(screen.getByTestId('timeline-grouping-day')).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByTestId('timeline-mobile-grouping-props')).toHaveTextContent(
      JSON.stringify({ grouping: 'day', hasHandler: true }),
    );
    expect(screen.getByTestId('timeline-options')).toHaveTextContent('"isFavorite":true');
    expect(screen.getByTestId('timeline-options')).toHaveTextContent('"grouping":"day"');
  });

  // #763: a favorite is a per-user `asset_favorite` row, so this page must be cross-scope like the
  // Photos timeline's favorites chip (buildPhotosTimelineOptions). The server only resolves
  // `timelineSpaceIds` when the request carries `withSharedSpaces`; without it, the timeline query
  // falls back to a hard `asset.ownerId = caller` filter, so a favorite the caller placed on another
  // member's Space asset — which the overlay explicitly permits, and which the heart reports as
  // favorited — is silently unreachable here and the page renders its empty placeholder.
  //
  // The break this catches: dropping either flag from `baseTimelineOptions`. That regression shipped
  // once already (fixed in abbbde288e8, reverted by fd0c6b38aa1 along with this coverage), and the
  // API-level e2e cannot catch it because its helper hardcodes `withSharedSpaces=true` — the very
  // flag the page omitted. Asserted on the serialised options because the timeline is stubbed here.
  it('requests favorites across shared spaces and partners, not just owned assets', async () => {
    renderPage();

    const options = await screen.findByTestId('timeline-options');
    expect(options).toHaveTextContent('"withSharedSpaces":true');
    expect(options).toHaveTextContent('"withPartners":true');
  });

  // The cross-scope flags are only half the contract: timeline.service.ts rejects both of them with
  // a 400 unless `visibility` is set, because an undefined visibility resolves to Archive+Timeline
  // and would expose other users' archived assets. Sending the flags without it makes every request
  // on this page fail — the page renders empty either way, so only this assertion separates "asks
  // for the right scope" from "asks for a scope the server will refuse".
  it('pins the visibility the cross-scope flags require, so the request is not rejected', async () => {
    renderPage();

    expect(await screen.findByTestId('timeline-options')).toHaveTextContent('"visibility":"timeline"');
  });

  // Guards the composition rather than the constant: `options` is $derived by spreading
  // baseTimelineOptions, so a refactor that rebuilds it per grouping could drop the flags on every
  // surface except the initial render. Activating a year bucket regroups to month.
  it('keeps the cross-scope flags after a bucket change regroups the timeline', async () => {
    renderPage();

    await fireEvent.click(await screen.findByTestId('activate-year-bucket'));

    await waitFor(() => {
      expect(screen.getByTestId('timeline-options')).toHaveTextContent('"grouping":"month"');
      expect(screen.getByTestId('timeline-options')).toHaveTextContent('"withSharedSpaces":true');
      expect(screen.getByTestId('timeline-options')).toHaveTextContent('"withPartners":true');
    });
  });

  it('year and month buckets keep favorite options without temporal chips', async () => {
    renderPage();

    await fireEvent.click(await screen.findByTestId('activate-year-bucket'));

    await waitFor(() => {
      expect(screen.getByTestId('timeline-options')).toHaveTextContent('"isFavorite":true');
      expect(screen.getByTestId('timeline-options')).toHaveTextContent('"grouping":"month"');
      expect(screen.getByTestId('timeline-options')).not.toHaveTextContent('"takenAfter"');
      expect(screen.getByTestId('timeline-options')).not.toHaveTextContent('"takenBefore"');
      expect(screen.queryByTestId('active-filters-bar')).not.toBeInTheDocument();
      expect(screen.getByTestId('timeline-anchor')).toHaveTextContent('{"year":2015}');
    });

    await fireEvent.click(screen.getByTestId('activate-month-bucket'));

    await waitFor(() => {
      expect(screen.getByTestId('timeline-options')).toHaveTextContent('"isFavorite":true');
      expect(screen.getByTestId('timeline-options')).toHaveTextContent('"grouping":"day"');
      expect(screen.getByTestId('timeline-options')).not.toHaveTextContent('"takenAfter"');
      expect(screen.getByTestId('timeline-options')).not.toHaveTextContent('"takenBefore"');
      expect(screen.queryByTestId('active-filters-bar')).not.toBeInTheDocument();
      expect(screen.getByTestId('timeline-anchor')).toHaveTextContent('{"year":2015,"month":8}');
    });
  });

  it('bucket activation does not render a temporal result count chip', async () => {
    renderPage();

    await fireEvent.click(await screen.findByTestId('activate-year-bucket'));

    await waitFor(() => {
      expect(screen.getByTestId('timeline-options')).toHaveTextContent('"grouping":"month"');
      expect(screen.getByTestId('timeline-anchor')).toHaveTextContent('{"year":2015}');
    });
    expect(screen.queryByTestId('result-count')).not.toBeInTheDocument();
    expect(screen.queryByTestId('active-filters-bar')).not.toBeInTheDocument();
  });

  it('manual grouping changes do not create temporal chips', async () => {
    renderPage();

    await fireEvent.click(await screen.findByTestId('timeline-grouping-year'));

    await waitFor(() => {
      expect(screen.getByTestId('timeline-options')).toHaveTextContent('"grouping":"year"');
    });
    expect(screen.queryByTestId('active-filters-bar')).not.toBeInTheDocument();
    // The grouping change preserves position via a scroll anchor, not a filter chip.
    expect(screen.getByTestId('timeline-anchor')).not.toHaveTextContent('null');
  });

  it('selection mode hides desktop grouping controls', () => {
    mockAssetMultiSelectManager.selectionActive = true;

    renderPage();

    expect(screen.queryByTestId('timeline-desktop-grouping-control')).not.toBeInTheDocument();
  });

  it('ignores bucket activation while selection mode is active', async () => {
    mockAssetMultiSelectManager.selectionActive = true;

    renderPage();
    await fireEvent.click(await screen.findByTestId('activate-year-bucket'));

    await waitFor(() => {
      expect(screen.getByTestId('timeline-options')).toHaveTextContent('"grouping":"day"');
      expect(screen.getByTestId('timeline-anchor')).toHaveTextContent('null');
    });
    expect(screen.queryByTestId('active-filters-bar')).not.toBeInTheDocument();
  });

  it('unfiltered empty placeholder does not render orphaned grouping controls', async () => {
    timelineStubGlobals.__timelineStubAssetCount = 0;

    renderPage();

    await waitFor(() => {
      expect(screen.queryByTestId('timeline-desktop-grouping-control')).not.toBeInTheDocument();
    });
  });

  it('shows the add-all-to-collection button when the surface has results', async () => {
    timelineStubGlobals.__timelineStubAssetCount = 3;

    renderPage();

    expect(await screen.findByTestId('add-all-to-collection')).toBeInTheDocument();
  });

  it('hides the add-all-to-collection button when empty', async () => {
    timelineStubGlobals.__timelineStubAssetCount = 0;

    renderPage();

    await screen.findByTestId('timeline-stub');
    expect(screen.queryByTestId('add-all-to-collection')).not.toBeInTheDocument();
  });
});
