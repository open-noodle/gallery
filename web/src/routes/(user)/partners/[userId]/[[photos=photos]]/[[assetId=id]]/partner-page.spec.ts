import TestWrapper from '#lib/components/TestWrapper.svelte';
import type { UserResponseDto } from '@immich/sdk';
import type { Component } from 'svelte';
import { render } from 'vitest-browser-svelte';
import { page, userEvent } from 'vitest/browser';
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

vi.mock('$app/navigation', async () => ({ ...(await import('#test/unit/mocks/app-navigation.ts')), goto: gotoMock }));

vi.mock('#lib/components/shared-components/control-app-bar.svelte', async () => {
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

vi.mock('#lib/components/timeline/actions/DownloadAction.svelte', async () => {
  const { default: MockComponent } = await import('#lib/gallery/__mocks__/noop-component.svelte');
  return { default: MockComponent };
});

vi.mock('#lib/managers/asset-multi-select-manager.svelte.js', () => ({
  assetMultiSelectManager: mockAssetMultiSelectManager,
}));

vi.mock('#lib/services/asset.service.js', () => ({
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

async function renderPage() {
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
    await renderPage();

    expect(await vi.waitFor(() => page.getByTestId('timeline-desktop-grouping-control').element())).toBeInTheDocument();
    expect(page.getByTestId('timeline-grouping-day').element()).toHaveAttribute('aria-pressed', 'true');
    expect(page.getByTestId('timeline-mobile-grouping-props').element()).toMatchTextContent(
      JSON.stringify({ grouping: 'day', hasHandler: true }),
    );
    expect(page.getByTestId('timeline-options').element()).toMatchTextContent('"userId":"partner-user-id"');
    expect(page.getByTestId('timeline-options').element()).toMatchTextContent('"grouping":"day"');
  });

  it('year and month buckets keep partner options without temporal chips', async () => {
    await renderPage();

    await userEvent.click(await vi.waitFor(() => page.getByTestId('activate-year-bucket').element()));

    await vi.waitFor(() => {
      expect(page.getByTestId('timeline-options').element()).toMatchTextContent('"userId":"partner-user-id"');
      expect(page.getByTestId('timeline-options').element()).toMatchTextContent('"grouping":"month"');
      expect(page.getByTestId('timeline-options').element()).not.toMatchTextContent('"takenAfter"');
      expect(page.getByTestId('timeline-options').element()).not.toMatchTextContent('"takenBefore"');
      expect(page.getByTestId('active-filters-bar').query()).not.toBeInTheDocument();
      expect(page.getByTestId('timeline-anchor').element()).toMatchTextContent('{"year":2015}');
    });

    await userEvent.click(page.getByTestId('activate-month-bucket'));

    await vi.waitFor(() => {
      expect(page.getByTestId('timeline-options').element()).toMatchTextContent('"userId":"partner-user-id"');
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

  it('never shows the add-all-to-collection button (excluded surface)', async () => {
    timelineStubGlobals.__timelineStubAssetCount = 3;

    await renderPage();

    await vi.waitFor(() => page.getByTestId('timeline-desktop-grouping-control').element());
    expect(page.getByTestId('add-all-to-collection').query()).not.toBeInTheDocument();
  });
});
