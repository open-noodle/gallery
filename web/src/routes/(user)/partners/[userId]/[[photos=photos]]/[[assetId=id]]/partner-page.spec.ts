import type { UserResponseDto } from '@immich/sdk';
import '@testing-library/jest-dom';
import { fireEvent, render, screen, waitFor } from '@testing-library/svelte';
import type { Component } from 'svelte';
import TestWrapper from '$lib/components/TestWrapper.svelte';
import PartnerPage from './+page.svelte';

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

vi.mock('$app/navigation', () => ({ goto: gotoMock }));

vi.mock('$lib/components/shared-components/control-app-bar.svelte', async () => {
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

vi.mock('$lib/components/timeline/actions/CreateSharedLinkAction.svelte', async () => {
  const { default: MockComponent } = await import('@test-data/mocks/noop-component.svelte');
  return { default: MockComponent };
});

vi.mock('$lib/components/timeline/actions/DownloadAction.svelte', async () => {
  const { default: MockComponent } = await import('@test-data/mocks/noop-component.svelte');
  return { default: MockComponent };
});

vi.mock('$lib/managers/asset-multi-select-manager.svelte', () => ({
  assetMultiSelectManager: mockAssetMultiSelectManager,
}));

vi.mock('$lib/services/asset.service', () => ({
  getAssetBulkActions: vi.fn(() => ({})),
}));

function makePartner(overrides: Partial<UserResponseDto> = {}): UserResponseDto {
  return {
    id: 'partner-user-id',
    name: 'Partner User',
    email: 'partner@example.com',
    profileImagePath: '',
    avatarColor: 'primary',
    profileChangedAt: '2026-01-01T00:00:00.000Z',
    isAdmin: false,
    shouldChangePassword: false,
    status: 'active',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    deletedAt: null,
    oauthId: '',
    storageLabel: null,
    quotaSizeInBytes: null,
    quotaUsageInBytes: 0,
    ...overrides,
  } as UserResponseDto;
}

function renderPage() {
  const props = {
    data: {
      partner: makePartner(),
      meta: { title: 'Partner User' },
    },
  };

  return render(TestWrapper as Component<{ component: typeof PartnerPage; componentProps: typeof props }>, {
    component: PartnerPage,
    componentProps: props,
  });
}

describe('Partner page timeline grouping', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockAssetMultiSelectManager.selectionActive = false;
    mockAssetMultiSelectManager.assets = [];
    timelineStubGlobals.__timelineStubAssetCount = undefined;
  });

  afterEach(() => {
    timelineStubGlobals.__timelineStubAssetCount = undefined;
  });

  it('renders desktop grouping controls and mobile grouping props for partner assets', async () => {
    renderPage();

    expect(await screen.findByTestId('timeline-desktop-grouping-control')).toBeInTheDocument();
    expect(screen.getByTestId('timeline-grouping-day')).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByTestId('timeline-mobile-grouping-props')).toHaveTextContent(
      JSON.stringify({ grouping: 'day', hasHandler: true }),
    );
    expect(screen.getByTestId('timeline-options')).toHaveTextContent('"userId":"partner-user-id"');
    expect(screen.getByTestId('timeline-options')).toHaveTextContent('"grouping":"day"');
  });

  it('year and month buckets keep partner options without temporal chips', async () => {
    renderPage();

    await fireEvent.click(await screen.findByTestId('activate-year-bucket'));

    await waitFor(() => {
      expect(screen.getByTestId('timeline-options')).toHaveTextContent('"userId":"partner-user-id"');
      expect(screen.getByTestId('timeline-options')).toHaveTextContent('"grouping":"month"');
      expect(screen.getByTestId('timeline-options')).not.toHaveTextContent('"takenAfter"');
      expect(screen.getByTestId('timeline-options')).not.toHaveTextContent('"takenBefore"');
      expect(screen.queryByTestId('active-filters-bar')).not.toBeInTheDocument();
      expect(screen.getByTestId('timeline-anchor')).toHaveTextContent('{"year":2015}');
    });

    await fireEvent.click(screen.getByTestId('activate-month-bucket'));

    await waitFor(() => {
      expect(screen.getByTestId('timeline-options')).toHaveTextContent('"userId":"partner-user-id"');
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

  it('never shows the add-all-to-collection button (excluded surface)', async () => {
    timelineStubGlobals.__timelineStubAssetCount = 3;

    renderPage();

    await screen.findByTestId('timeline-desktop-grouping-control');
    expect(screen.queryByTestId('add-all-to-collection')).not.toBeInTheDocument();
  });
});
