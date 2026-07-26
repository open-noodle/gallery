import {
  AlbumUserRole,
  AssetOrder,
  SharedSpaceRole,
  getAlbumInfo,
  type AlbumResponseDto,
  type SharedSpaceMemberResponseDto,
  type SharedSpaceResponseDto,
} from '@immich/sdk';
import '@testing-library/jest-dom';
import { fireEvent, render, screen, waitFor } from '@testing-library/svelte';
import type { Component } from 'svelte';
import { init, register, waitLocale } from 'svelte-i18n';
import { getAnimateMock } from '$lib/__mocks__/animate.mock';
import TestWrapper from '$lib/components/TestWrapper.svelte';
import { authManager } from '$lib/managers/auth-manager.svelte';
import { addAssetsToAlbumWithOutcome, getAlbumAssetsActions } from '$lib/services/album.service';
import { preferencesFactory } from '@test-data/factories/preferences-factory';
import { userAdminFactory } from '@test-data/factories/user-factory';
import SpaceAlbumDetailPage from './+page.svelte';
import { mockTimelineState, resetMockTimelineState, setMockTimelineEmpty } from './mock-timeline-state';

vi.mock('$lib/components/layouts/UserPageLayout.svelte', async () => {
  const { default: MockComponent } = await import('$lib/components/spaces/mock-user-page-layout.test-wrapper.svelte');
  return { default: MockComponent };
});

vi.mock('$lib/components/timeline/Timeline.svelte', async () => {
  const { default: MockComponent } = await import('./mock-timeline.test-wrapper.svelte');
  return { default: MockComponent };
});

vi.mock('$lib/components/timeline/AssetSelectControlBar.svelte', async () => {
  const { default: MockComponent } = await import('./mock-asset-select-control-bar.test-wrapper.svelte');
  return { default: MockComponent };
});

vi.mock('$lib/components/timeline/actions/RemoveFromAlbumAction.svelte', async () => {
  const { default: MockComponent } = await import('./mock-remove-from-album.test-wrapper.svelte');
  return { default: MockComponent };
});

vi.mock('$lib/components/timeline/actions/DownloadAction.svelte', async () => {
  const { default: MockComponent } = await import('./mock-download-action.test-wrapper.svelte');
  return { default: MockComponent };
});

vi.mock('$lib/components/shared-components/ControlAppBar.svelte', async () => {
  const { default: MockComponent } =
    await import('../../../../[[photos=photos]]/[[assetId=id]]/mock-control-app-bar.test-wrapper.svelte');
  return { default: MockComponent };
});

vi.mock('$lib/components/filter-panel/filter-panel.svelte', async () => {
  const { default: MockComponent } = await import('./mock-filter-panel.test-wrapper.svelte');
  return { default: MockComponent };
});

vi.mock('$lib/components/filter-panel/active-filters-bar.svelte', async () => {
  const { default: MockComponent } = await import('./mock-active-filters-bar.test-wrapper.svelte');
  return { default: MockComponent };
});

vi.mock('$app/navigation', () => ({ goto: vi.fn(), invalidateAll: vi.fn(), onNavigate: vi.fn() }));

vi.mock('$lib/components/timeline/TimelineGroupingControl.svelte', async () => {
  const { default: MockComponent } = await import('./mock-grouping-control.test-wrapper.svelte');
  return { default: MockComponent };
});

vi.mock('$lib/managers/timeline-manager/timeline-anchor', () => ({
  getTimelineTopVisibleAnchor: vi.fn().mockReturnValue(undefined),
}));

vi.mock('$lib/utils/timeline-zoom-navigation', () => ({
  getTimelineBucketZoomTarget: vi.fn(),
  getTimelineManagerTimeBuckets: vi.fn().mockReturnValue([]),
}));

// Slice 6: the browse selection bar now renders the full <SelectionToolbar>, which wires
// DeleteAssetsAction — its `force` derivation reads featureFlagsManager.value.trash, which
// throws until the (real, module-singleton) manager is initialized. Mirrors the mock already
// used by SelectionToolbar.spec.ts and the space-person-detail-page spec.
vi.mock('$lib/managers/feature-flags-manager.svelte', () => ({
  featureFlagsManager: { value: { trash: true } },
}));

const { mockAssetMultiSelectManager, pickerMultiSelectClear, pickerSelectedAssets } = vi.hoisted(() => ({
  pickerMultiSelectClear: vi.fn(),
  // Shared so a test can give the PICKER (not the browse bar) a selection to add.
  pickerSelectedAssets: [] as { id: string }[],
  mockAssetMultiSelectManager: {
    selectionActive: false,
    assets: [] as { id: string }[],
    clear: vi.fn(),
    isAllFavorite: false,
    isAllArchived: false,
    isAllUserOwned: true,
    // Mirrors the real manager's derived field. These fixtures only model the all-owned and
    // none-owned ends of the range, so deriving it from isAllUserOwned keeps the two in step.
    get ownedAssets() {
      return this.isAllUserOwned ? this.assets : [];
    },
  },
}));

vi.mock('$lib/managers/asset-multi-select-manager.svelte', () => ({
  assetMultiSelectManager: mockAssetMultiSelectManager,
  AssetMultiSelectManager: class {
    selectionActive = false;
    get assets() {
      return pickerSelectedAssets;
    }
    // Shared across instances so a test can assert the picker cleared its selection.
    clear = pickerMultiSelectClear;
    isAllFavorite = false;
    isAllArchived = false;
    isAllUserOwned = true;
    get ownedAssets() {
      return this.isAllUserOwned ? this.assets : [];
    }
  },
}));

vi.mock('@immich/sdk', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@immich/sdk')>();
  return {
    ...actual,
    getAlbumInfo: vi.fn(),
  };
});

vi.mock('$lib/services/album.service', async (importOriginal) => {
  const actual = await importOriginal<typeof import('$lib/services/album.service')>();
  return {
    ...actual,
    getAlbumAssetsActions: vi.fn().mockReturnValue({
      AddAssets: {
        title: 'Add assets',
        icon: '',
        onAction: vi.fn().mockResolvedValue(undefined),
        $if: () => true,
      },
      Upload: {
        title: 'Upload',
        icon: '',
        onAction: vi.fn(),
      },
    }),
    addAssetsToAlbums: vi.fn().mockResolvedValue(true),
    addAssetsToAlbumWithOutcome: vi.fn().mockResolvedValue({ ok: true, addedIds: [], deniedIds: [] }),
  };
});

const BASE_SPACE: SharedSpaceResponseDto = {
  id: 'space-1',
  name: 'Family Memories',
  createdAt: '2026-01-01T00:00:00.000Z',
  createdById: 'owner-user-id',
} as SharedSpaceResponseDto;

function makeAlbum(overrides: Partial<AlbumResponseDto> = {}): AlbumResponseDto {
  return {
    id: 'album-1',
    albumName: 'Vacation 2025',
    assetCount: 12,
    shared: false,
    albumUsers: [
      {
        user: { id: 'current-user-id', email: 'user@example.com', name: 'Current User' } as never,
        role: AlbumUserRole.Owner,
      },
    ],
    hasSharedLink: false,
    isActivityEnabled: true,
    order: AssetOrder.Desc,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  } as AlbumResponseDto;
}

function makeMember(role: SharedSpaceRole = SharedSpaceRole.Editor): SharedSpaceMemberResponseDto {
  return {
    userId: 'current-user-id',
    email: 'user@example.com',
    name: 'Current User',
    role,
    showInTimeline: false,
    joinedAt: '2026-01-01T00:00:00.000Z',
  } as SharedSpaceMemberResponseDto;
}

// The page only reads space/members/album, but the route's PageData also carries the layout's
// linkedAlbums plus the asset-viewer fields — spell them out so `render`/`rerender` type-check.
function makePageData(
  album: AlbumResponseDto,
  members: SharedSpaceMemberResponseDto[] = [makeMember()],
  space: SharedSpaceResponseDto = BASE_SPACE,
) {
  return {
    error: undefined,
    asset: undefined,
    linkedAlbums: [],
    space,
    members,
    album,
    meta: { title: album.albumName },
  };
}

function renderPage({
  album = makeAlbum(),
  members = [makeMember()],
  space = BASE_SPACE,
}: {
  album?: AlbumResponseDto;
  members?: SharedSpaceMemberResponseDto[];
  space?: SharedSpaceResponseDto;
} = {}) {
  authManager.setUser(userAdminFactory.build({ id: 'current-user-id' }));
  authManager.setPreferences(preferencesFactory.build());

  // Slice 6: the browse selection bar now renders the full <SelectionToolbar>, which (like the
  // regular album page and the direct-space/space-person timelines) renders real @immich/ui
  // IconButtons that resolve a bits-ui Tooltip against a "Tooltip.Provider" context. That
  // provider only exists app-wide via the root +layout.svelte, which isn't part of this render —
  // TestWrapper supplies it (mirrors spaces-page.spec.ts / space-person-detail-page.spec.ts).
  return render(
    TestWrapper as Component<{
      component: typeof SpaceAlbumDetailPage;
      componentProps: { data: ReturnType<typeof makePageData> };
    }>,
    {
      component: SpaceAlbumDetailPage,
      componentProps: { data: makePageData(album, members, space) },
    },
  );
}

// Slice 6: RemoveFromAlbum/Download/Delete/etc. now live as menu items inside the
// <SelectionToolbar>'s "⋮" ButtonContextMenu instead of top-level in the control bar. Open it
// before asserting on any menu item, mirroring the Slice 4/5 Playwright specs
// (spaces-selection-toolbar-timeline.e2e-spec.ts's `openOverflowMenu`).
async function openOverflowMenu() {
  await fireEvent.click(screen.getByRole('button', { name: 'Menu' }));
}

describe('Space album detail page', () => {
  beforeAll(async () => {
    register('en-US', () => import('$i18n/en.json'));
    await init({ fallbackLocale: 'en-US', initialLocale: 'en-US' });
    await waitLocale('en-US');
  });

  beforeEach(() => {
    vi.resetAllMocks();
    // The add→browse transition calls element.animate(); without a mock it returns undefined and
    // setting .onfinish on it throws an async unhandled error that fails the run (seen only in CI's
    // test ordering). Mirror the global-album route spec.
    Element.prototype.animate = getAnimateMock();
    resetMockTimelineState();
    // The picker selection is a shared array (see the AssetMultiSelectManager mock) - reset it
    // so a test that seeds a selection cannot leak into the next one.
    pickerSelectedAssets.length = 0;
    vi.mocked(addAssetsToAlbumWithOutcome).mockResolvedValue({ ok: true, addedIds: [], deniedIds: [] });
    mockAssetMultiSelectManager.selectionActive = false;
    mockAssetMultiSelectManager.assets = [];
    // Slice 6: a handful of tests below flip these to exercise ownership/manager gating
    // independently — reset to the long-standing defaults so that leaks between tests.
    mockAssetMultiSelectManager.isAllUserOwned = true;
    mockAssetMultiSelectManager.isAllFavorite = false;
    mockAssetMultiSelectManager.isAllArchived = false;
    // Restore the default getAlbumAssetsActions return after resetAllMocks clears it
    vi.mocked(getAlbumAssetsActions).mockReturnValue({
      AddAssets: {
        title: 'Add assets',
        icon: '',
        onAction: vi.fn().mockResolvedValue(undefined),
        $if: () => true,
      },
      Upload: {
        title: 'Upload',
        icon: '',
        onAction: vi.fn(),
      },
    } as never);
  });

  it('renders the album timeline', () => {
    renderPage();
    expect(screen.getByTestId('space-album-timeline')).toBeInTheDocument();
  });

  it('shows the space name in the page title (the album name lives in the editable AlbumTitle below)', () => {
    renderPage({
      album: makeAlbum({ albumName: 'Summer Trips' }),
      space: { ...BASE_SPACE, name: 'Family Memories' },
    });
    const layout = screen.getByTestId('user-page-layout');
    expect(layout).toHaveAttribute('data-title', 'Family Memories');
    // The album name is no longer duplicated in the page header (it moved to the editable AlbumTitle).
    expect(layout.dataset.title).not.toBe('Summer Trips');
  });

  it('renders the back button in leading slot', () => {
    renderPage();
    const leading = screen.getByTestId('layout-leading');
    expect(leading.querySelector('button')).not.toBeNull();
  });

  it('editor sees the "Add photos" button', () => {
    renderPage({ members: [makeMember(SharedSpaceRole.Editor)] });
    expect(screen.getByTestId('add-photos-button')).toBeInTheDocument();
  });

  it('owner sees the "Add photos" button', () => {
    renderPage({ members: [makeMember(SharedSpaceRole.Owner)] });
    expect(screen.getByTestId('add-photos-button')).toBeInTheDocument();
  });

  it('viewer does NOT see the "Add photos" button when not an album editor', () => {
    renderPage({
      members: [makeMember(SharedSpaceRole.Viewer)],
      album: makeAlbum({
        albumUsers: [
          {
            user: { id: 'current-user-id', email: 'user@example.com', name: 'Current User' } as never,
            role: AlbumUserRole.Viewer,
          },
        ],
      }),
    });
    expect(screen.queryByTestId('add-photos-button')).not.toBeInTheDocument();
  });

  it('album editor/owner can manage even as a space viewer', () => {
    renderPage({
      members: [makeMember(SharedSpaceRole.Viewer)],
      album: makeAlbum({
        albumUsers: [
          {
            user: { id: 'current-user-id', email: 'user@example.com', name: 'Current User' } as never,
            role: AlbumUserRole.Editor,
          },
        ],
      }),
    });
    expect(screen.getByTestId('add-photos-button')).toBeInTheDocument();
  });

  it('showInTimeline=false album still renders the timeline fully', () => {
    renderPage({
      album: makeAlbum(),
    });
    expect(screen.getByTestId('space-album-timeline')).toBeInTheDocument();
  });

  it('browse timeline has enableRouting=true so the in-place asset viewer opens/closes via the URL', () => {
    renderPage();
    expect(screen.getByTestId('space-album-timeline')).toHaveAttribute('data-enable-routing', 'true');
  });

  it('in browse mode, the timeline-desktop-grouping-control renders', () => {
    renderPage();
    expect(screen.getByTestId('timeline-desktop-grouping-control')).toBeInTheDocument();
  });

  it('the grouping-control bar is transparent (no navy/border bar) to match the space page', () => {
    renderPage();
    // data-testid="timeline-desktop-grouping-control" now sits on the grouping wrapper (kept
    // desktop-only, #752 launch review F3); the surrounding bar carrying the background utilities
    // is its parent.
    const bar = screen.getByTestId('timeline-desktop-grouping-control').parentElement!;
    // The rolling/main fix dropped the bordered grey/navy bar in favour of a transparent container.
    expect(bar.className).toContain('bg-transparent');
    expect(bar.className).toContain('dark:bg-transparent');
    expect(bar.className).not.toContain('bg-gray-50');
    expect(bar.className).not.toContain('dark:bg-gray-900');
    expect(bar.className).not.toContain('border-b');
  });

  it('timeline receives grouping="day" by default (not "month")', () => {
    renderPage();
    expect(screen.getByTestId('space-album-timeline')).toHaveAttribute('data-grouping', 'day');
  });

  it('browse timeline OPTIONS carry the current grouping (default day) so the manager actually groups', () => {
    renderPage({ album: makeAlbum({ id: 'album-1' }) });
    const options = JSON.parse(screen.getByTestId('timeline-options').textContent ?? '{}');
    expect(options.grouping).toBe('day');
  });

  it('changing the grouping control updates the timeline OPTIONS grouping (not just the prop)', async () => {
    renderPage({ album: makeAlbum({ id: 'album-1' }) });
    await fireEvent.click(screen.getByTestId('set-grouping-month'));
    await waitFor(() => {
      const options = JSON.parse(screen.getByTestId('timeline-options').textContent ?? '{}');
      expect(options.grouping).toBe('month');
    });
    // and the prop stays in sync
    expect(screen.getByTestId('space-album-timeline')).toHaveAttribute('data-grouping', 'month');
  });

  it('timeline-desktop-grouping-control is hidden when selection is active in browse mode', () => {
    mockAssetMultiSelectManager.selectionActive = true;
    renderPage();
    expect(screen.queryByTestId('timeline-desktop-grouping-control')).not.toBeInTheDocument();
  });

  it('timeline-desktop-grouping-control is hidden in add mode', async () => {
    renderPage({ members: [makeMember(SharedSpaceRole.Editor)], album: makeAlbum({ id: 'album-1' }) });
    await fireEvent.click(screen.getByTestId('add-photos-button'));
    await waitFor(() => {
      expect(screen.getByTestId('space-album-timeline')).toHaveAttribute('data-mode', 'add');
    });
    expect(screen.queryByTestId('timeline-desktop-grouping-control')).not.toBeInTheDocument();
  });

  it('timeline options include albumId in browse mode', () => {
    renderPage({ album: makeAlbum({ id: 'album-1' }) });
    const options = JSON.parse(screen.getByTestId('timeline-options').textContent ?? '{}');
    expect(options).toMatchObject({ albumId: 'album-1' });
  });

  it('timeline starts in browse mode (options have albumId, not timelineAlbumId)', () => {
    renderPage({ album: makeAlbum({ id: 'album-1' }) });
    expect(screen.getByTestId('space-album-timeline')).toHaveAttribute('data-mode', 'browse');
  });

  it('clicking "Add photos" switches timeline to add mode (picker options)', async () => {
    renderPage({ members: [makeMember(SharedSpaceRole.Editor)], album: makeAlbum({ id: 'album-1' }) });
    const addButton = screen.getByTestId('add-photos-button');

    await fireEvent.click(addButton);

    await waitFor(() => {
      expect(screen.getByTestId('space-album-timeline')).toHaveAttribute('data-mode', 'add');
    });
    const options = JSON.parse(screen.getByTestId('timeline-options').textContent ?? '{}');
    expect(options).toMatchObject({ timelineAlbumId: 'album-1' });
    expect(options).not.toHaveProperty('albumId');
  });

  it('in browse mode with selection active, AssetSelectControlBar is rendered', () => {
    mockAssetMultiSelectManager.selectionActive = true;
    renderPage({ members: [makeMember(SharedSpaceRole.Editor)] });
    expect(screen.getByTestId('asset-select-control-bar')).toBeInTheDocument();
  });

  it('in browse mode with selection active and canManage=true, RemoveFromAlbum and Download actions are wired', async () => {
    mockAssetMultiSelectManager.selectionActive = true;
    renderPage({ members: [makeMember(SharedSpaceRole.Editor)] });
    // AssetSelectControlBar renders its children
    expect(screen.getByTestId('asset-select-control-bar')).toBeInTheDocument();

    // RemoveFromAlbumAction and DownloadAction are now menu items inside the "⋮" overflow menu.
    await openOverflowMenu();
    expect(screen.getByTestId('album-remove-from-album')).toBeInTheDocument();
    // DownloadAction is rendered for all members
    expect(screen.getByTestId('download-action')).toBeInTheDocument();
  });

  it('in browse mode with selection active and canManage=false, control bar shown with Download but no Remove action', async () => {
    mockAssetMultiSelectManager.selectionActive = true;
    renderPage({
      members: [makeMember(SharedSpaceRole.Viewer)],
      album: makeAlbum({
        albumUsers: [
          {
            user: { id: 'current-user-id', email: 'user@example.com', name: 'Current User' } as never,
            role: AlbumUserRole.Viewer,
          },
        ],
      }),
    });
    // Control bar shows
    expect(screen.getByTestId('asset-select-control-bar')).toBeInTheDocument();

    await openOverflowMenu();
    // DownloadAction is available to all members (bar is not empty for viewers)
    expect(screen.getByTestId('download-action')).toBeInTheDocument();
    // But RemoveFromAlbumAction is NOT rendered
    expect(screen.queryByTestId('album-remove-from-album')).not.toBeInTheDocument();
  });

  // ── Picker source toggle ────────────────────────────────────────────────────
  // The picker has always browsed the caller's OWN timeline, so a space album could
  // not pull in another member's photo even though the space timeline's "+" can push
  // the very same photo into the very same album (#764 contribution). The Space tab
  // closes that asymmetry by sourcing the picker from the space pool.
  describe('picker source toggle', () => {
    const openPicker = async () => {
      await fireEvent.click(screen.getByTestId('add-photos-button'));
      await waitFor(() => expect(screen.getByTestId('space-album-timeline')).toHaveAttribute('data-mode', 'add'));
    };
    const pickerOptions = () => JSON.parse(screen.getByTestId('timeline-options').textContent ?? '{}');

    it('defaults to the caller’s own photos — unchanged from today', async () => {
      renderPage({ members: [makeMember(SharedSpaceRole.Editor)], album: makeAlbum({ id: 'album-1' }) });
      await openPicker();

      expect(pickerOptions()).toMatchObject({ timelineAlbumId: 'album-1' });
      expect(pickerOptions().spaceId).toBeUndefined();
    });

    it('switching to Space sources the picker from the space pool while keeping the already-in-album marker', async () => {
      renderPage({ members: [makeMember(SharedSpaceRole.Editor)], album: makeAlbum({ id: 'album-1' }) });
      await openPicker();

      await fireEvent.click(screen.getByTestId('picker-source-space'));

      await waitFor(() => expect(pickerOptions().spaceId).toBe(BASE_SPACE.id));
      // timelineAlbumId must survive: it is what greys out assets already in the album.
      expect(pickerOptions()).toMatchObject({ timelineAlbumId: 'album-1' });
    });

    it('switching back to My photos drops the space scope again', async () => {
      renderPage({ members: [makeMember(SharedSpaceRole.Editor)], album: makeAlbum({ id: 'album-1' }) });
      await openPicker();

      await fireEvent.click(screen.getByTestId('picker-source-space'));
      await waitFor(() => expect(pickerOptions().spaceId).toBe(BASE_SPACE.id));
      await fireEvent.click(screen.getByTestId('picker-source-mine'));

      await waitFor(() => expect(pickerOptions().spaceId).toBeUndefined());
    });

    it('clears the pending selection when the source changes, so a selection never spans both pools', async () => {
      renderPage({ members: [makeMember(SharedSpaceRole.Editor)], album: makeAlbum({ id: 'album-1' }) });
      await openPicker();
      // Opening the picker already calls clear() via resetPicker, and the mock class shares one
      // spy across instances — so asserting "has been called" would pass even with the clear in
      // setPickerSource deleted. Baseline here and assert the toggle adds a call of its own.
      const callsBeforeToggle = pickerMultiSelectClear.mock.calls.length;

      await fireEvent.click(screen.getByTestId('picker-source-space'));

      await waitFor(() => expect(pickerMultiSelectClear.mock.calls.length).toBeGreaterThan(callsBeforeToggle));
    });

    it('does not clear when the already-active source is re-clicked', async () => {
      renderPage({ members: [makeMember(SharedSpaceRole.Editor)], album: makeAlbum({ id: 'album-1' }) });
      await openPicker();
      const callsBeforeToggle = pickerMultiSelectClear.mock.calls.length;

      await fireEvent.click(screen.getByTestId('picker-source-mine'));

      expect(pickerMultiSelectClear.mock.calls.length).toBe(callsBeforeToggle);
    });

    // The default album fixture makes the current user its OWNER, so the picker still opens
    // for a space Viewer — but contributing another member's photo is Owner/Editor-only.
    it('is hidden from a space viewer — only an Owner/Editor may contribute another member’s photo', async () => {
      renderPage({ members: [makeMember(SharedSpaceRole.Viewer)], album: makeAlbum({ id: 'album-1' }) });
      await openPicker();

      expect(screen.queryByTestId('picker-source-toggle')).not.toBeInTheDocument();
    });

    it('is shown to a space editor', async () => {
      renderPage({ members: [makeMember(SharedSpaceRole.Editor)], album: makeAlbum({ id: 'album-1' }) });
      await openPicker();

      expect(screen.getByTestId('picker-source-toggle')).toBeInTheDocument();
    });
  });

  it('add mode shows picker control bar (no add-photos button visible while in add mode)', async () => {
    renderPage({ members: [makeMember(SharedSpaceRole.Editor)], album: makeAlbum({ id: 'album-1' }) });
    await fireEvent.click(screen.getByTestId('add-photos-button'));

    await waitFor(() => {
      expect(screen.getByTestId('space-album-timeline')).toHaveAttribute('data-mode', 'add');
    });
    // In add mode, the add-photos button should be hidden / not visible as a standalone button
    // (the ControlAppBar for picker mode replaces the regular app bar)
    expect(screen.queryByTestId('add-photos-button')).not.toBeInTheDocument();
  });

  it('in add mode, the full-screen overlay renders with the picker timeline inside', async () => {
    renderPage({ members: [makeMember(SharedSpaceRole.Editor)], album: makeAlbum({ id: 'album-1' }) });
    await fireEvent.click(screen.getByTestId('add-photos-button'));

    await waitFor(() => {
      expect(screen.getByTestId('add-photos-overlay')).toBeInTheDocument();
    });
    const overlay = screen.getByTestId('add-photos-overlay');
    const main = screen.getByTestId('add-photos-timeline-main');
    expect(overlay).toContainElement(main);
    expect(main.className).toContain('pt-(--navbar-height)');
  });

  it('the picker control bar comes AFTER the timeline-main in DOM so it paints on top and its buttons are clickable', async () => {
    renderPage({ members: [makeMember(SharedSpaceRole.Editor)], album: makeAlbum({ id: 'album-1' }) });
    await fireEvent.click(screen.getByTestId('add-photos-button'));
    await waitFor(() => {
      expect(screen.getByTestId('add-photos-overlay')).toBeInTheDocument();
    });

    const overlay = screen.getByTestId('add-photos-overlay');
    const main = screen.getByTestId('add-photos-timeline-main');
    // The ControlAppBar is `position: absolute` with auto z-index. The full-height <main> would
    // paint over it (swallowing clicks on the trailing Upload/Add buttons) unless the bar comes
    // LATER in DOM order. querySelectorAll returns document order — bar must be last.
    const ordered = [
      ...overlay.querySelectorAll('[data-testid="add-photos-timeline-main"], [data-testid="control-app-bar"]'),
    ];
    expect(ordered[0]).toBe(main);
    expect(ordered[1]).toBe(screen.getByTestId('control-app-bar'));
  });

  it('in browse mode, the add-photos overlay is NOT rendered', () => {
    renderPage({ members: [makeMember(SharedSpaceRole.Editor)], album: makeAlbum({ id: 'album-1' }) });
    expect(screen.queryByTestId('add-photos-overlay')).not.toBeInTheDocument();
  });

  it('in browse mode, the browse timeline renders (not in the overlay)', () => {
    renderPage({ album: makeAlbum({ id: 'album-1' }) });
    expect(screen.getByTestId('space-album-timeline')).toHaveAttribute('data-mode', 'browse');
    expect(screen.queryByTestId('add-photos-overlay')).not.toBeInTheDocument();
  });

  it('firing AddAssets action in add mode returns to browse and refreshes album', async () => {
    const refreshedAlbum = makeAlbum({ id: 'album-1', albumName: 'Refreshed', assetCount: 5 });
    vi.mocked(getAlbumInfo).mockResolvedValue(refreshedAlbum);
    pickerSelectedAssets.splice(0, pickerSelectedAssets.length, { id: 'a-1' });
    vi.mocked(addAssetsToAlbumWithOutcome).mockResolvedValue({ ok: true, addedIds: ['a-1'], deniedIds: [] });

    // Provide AddAssets whose onAction resolves immediately
    const addAssetsOnAction = vi.fn().mockResolvedValue(undefined);
    vi.mocked(getAlbumAssetsActions).mockReturnValue({
      AddAssets: {
        title: 'Add assets',
        icon: '',
        onAction: addAssetsOnAction,
        $if: () => true,
      },
      Upload: {
        title: 'Upload',
        icon: '',
        onAction: vi.fn(),
      },
    } as never);

    renderPage({ members: [makeMember(SharedSpaceRole.Editor)], album: makeAlbum({ id: 'album-1' }) });

    // Enter add mode
    await fireEvent.click(screen.getByTestId('add-photos-button'));
    await waitFor(() => {
      expect(screen.getByTestId('space-album-timeline')).toHaveAttribute('data-mode', 'add');
    });

    // The ControlAppBar mock renders its trailing slot, so the HeaderActionButton for AddAssets
    // is in the DOM. Click it to fire the page's wrapped onAction → handleAddAssetsSuccess.
    const addAssetsButton = screen.getByRole('button', { name: /add assets/i });
    await fireEvent.click(addAssetsButton);

    // handleAddAssetsSuccess: calls AddAssets.onAction (which resolves), then refreshAlbum
    // (getAlbumInfo), then sets mode='browse'
    await waitFor(() => {
      expect(getAlbumInfo).toHaveBeenCalledWith({ id: 'album-1' });
    });
    // After refresh, mode returns to browse (add-photos button reappears)
    await waitFor(() => {
      expect(screen.getByTestId('add-photos-button')).toBeInTheDocument();
    });
  });

  it('does not insert photos into the album grid when the add call fails', async () => {
    // The service never rejects - on 5xx/network it toasts and resolves ok:false.
    pickerSelectedAssets.splice(0, pickerSelectedAssets.length, { id: 'a-1' });
    vi.mocked(addAssetsToAlbumWithOutcome).mockResolvedValue({ ok: false, addedIds: [], deniedIds: [] });
    renderPage({ members: [makeMember(SharedSpaceRole.Editor)], album: makeAlbum({ id: 'album-1' }) });

    // Enter add mode and fire the header Add action, exactly as the success test does.
    await fireEvent.click(screen.getByTestId('add-photos-button'));
    await waitFor(() => expect(screen.getByTestId('space-album-timeline')).toHaveAttribute('data-mode', 'add'));
    await fireEvent.click(screen.getByRole('button', { name: /add assets/i }));

    // The picker stays open (retry) and nothing was optimistically upserted into the browse timeline.
    expect(screen.getByTestId('add-photos-overlay')).toBeInTheDocument();
    expect(mockTimelineState.upsertAssets).not.toHaveBeenCalled();
  });

  // The add endpoint returns HTTP 200 with PER-ASSET outcomes, so "the call did not throw" is not
  // the same as "every photo landed". Cross-owner adds (the Space tab) make partial denial routine:
  // an asset visible through the space is not necessarily one the contribution path will accept.
  describe('partial add outcomes', () => {
    const fireAdd = async () => {
      await fireEvent.click(screen.getByTestId('add-photos-button'));
      await waitFor(() => expect(screen.getByTestId('space-album-timeline')).toHaveAttribute('data-mode', 'add'));
      await fireEvent.click(screen.getByRole('button', { name: /add assets/i }));
    };

    beforeEach(() => {
      pickerSelectedAssets.splice(0, pickerSelectedAssets.length, { id: 'mine' }, { id: 'theirs' });
      // A successful add returns to browse via refreshAlbum(); without this the page would
      // re-render with `album` undefined.
      vi.mocked(getAlbumInfo).mockResolvedValue(makeAlbum({ id: 'album-1' }));
      vi.mocked(getAlbumAssetsActions).mockReturnValue({
        AddAssets: { title: 'Add assets', icon: '', onAction: vi.fn(), $if: () => true },
        Upload: { title: 'Upload', icon: '', onAction: vi.fn() },
      } as never);
    });

    it('inserts only the assets the server actually accepted, not the whole selection', async () => {
      vi.mocked(addAssetsToAlbumWithOutcome).mockResolvedValue({ ok: true, addedIds: ['mine'], deniedIds: [] });
      renderPage({ members: [makeMember(SharedSpaceRole.Editor)], album: makeAlbum({ id: 'album-1' }) });

      await fireAdd();

      await waitFor(() => expect(mockTimelineState.upsertAssets).toHaveBeenCalled());
      // 'theirs' was denied per-asset; painting it in would show a photo that vanishes on reload.
      expect(mockTimelineState.upsertAssets).toHaveBeenCalledWith([{ id: 'mine' }]);
    });

    it('keeps the picker open and inserts nothing when every asset was denied', async () => {
      vi.mocked(addAssetsToAlbumWithOutcome).mockResolvedValue({
        ok: true,
        addedIds: [],
        deniedIds: ['mine', 'theirs'],
      });
      renderPage({ members: [makeMember(SharedSpaceRole.Editor)], album: makeAlbum({ id: 'album-1' }) });

      await fireAdd();

      expect(mockTimelineState.upsertAssets).not.toHaveBeenCalled();
      expect(screen.getByTestId('add-photos-overlay')).toBeInTheDocument();
    });

    // A duplicate is not a refusal: the photo is already where the user wanted it, so there is
    // nothing to retry. Trapping them in the picker would be a regression against the old
    // behaviour, which returned to browse on any non-throwing call.
    it('closes the picker when every asset was already in the album', async () => {
      vi.mocked(addAssetsToAlbumWithOutcome).mockResolvedValue({ ok: true, addedIds: [], deniedIds: [] });
      renderPage({ members: [makeMember(SharedSpaceRole.Editor)], album: makeAlbum({ id: 'album-1' }) });

      await fireAdd();

      await waitFor(() => expect(screen.queryByTestId('add-photos-overlay')).not.toBeInTheDocument());
      expect(mockTimelineState.upsertAssets).toHaveBeenCalledWith([]);
    });
  });

  it('browse mode renders the FilterPanel', () => {
    renderPage();
    expect(screen.getByTestId('filter-panel')).toBeInTheDocument();
  });

  it('does not render the FilterPanel while a browse selection is active', () => {
    mockAssetMultiSelectManager.selectionActive = true;
    renderPage();
    expect(screen.queryByTestId('filter-panel')).not.toBeInTheDocument();
  });

  it('browseOptions carry filter fields once a browse filter is set', async () => {
    renderPage({ album: makeAlbum({ id: 'album-1' }) });
    await fireEvent.click(screen.getByTestId('filter-panel-add-person'));
    await waitFor(() => {
      const options = JSON.parse(screen.getByTestId('timeline-options').textContent ?? '{}');
      expect(options.personIds).toEqual(['person-1']);
    });
  });

  it('shows ActiveFiltersBar only when a browse filter is active', async () => {
    renderPage();
    expect(screen.queryByTestId('active-filters-bar')).not.toBeInTheDocument();
    await fireEvent.click(screen.getByTestId('filter-panel-add-person'));
    await waitFor(() => expect(screen.getByTestId('active-filters-bar')).toBeInTheDocument());
  });

  it('wires the add-all-to-collection handler into the browse ActiveFiltersBar', async () => {
    renderPage();
    await fireEvent.click(screen.getByTestId('filter-panel-add-person'));
    const bar = await screen.findByTestId('active-filters-bar');
    expect(bar).toHaveAttribute('data-has-add-all', 'true');
  });

  it('browse: when filtered to empty, the filtered-empty block replaces the timeline; clear restores it', async () => {
    setMockTimelineEmpty();
    renderPage();
    await fireEvent.click(screen.getByTestId('filter-panel-add-person'));
    await waitFor(() => {
      expect(screen.getByTestId('browse-filtered-empty')).toBeInTheDocument();
      expect(screen.queryByTestId('space-album-timeline')).not.toBeInTheDocument();
    });
    await fireEvent.click(screen.getByTestId('browse-clear-filters'));
    await waitFor(() => {
      expect(screen.queryByTestId('browse-filtered-empty')).not.toBeInTheDocument();
      expect(screen.getByTestId('space-album-timeline')).toBeInTheDocument();
    });
  });

  it('browse: the FilterPanel is hidden when the album is genuinely empty (no assets, no filters)', async () => {
    setMockTimelineEmpty();
    renderPage();
    await waitFor(() => expect(screen.getByTestId('filter-panel').dataset.hidden).toBe('true'));
  });

  it('browse: the FilterPanel stays visible when filtered to empty (so it can be cleared)', async () => {
    setMockTimelineEmpty();
    renderPage();
    await fireEvent.click(screen.getByTestId('filter-panel-add-person'));
    await waitFor(() => expect(screen.getByTestId('filter-panel').dataset.hidden).toBe('false'));
  });

  it('browse: removing the temporal chip clears the temporal filter (ActiveFiltersBar disappears)', async () => {
    renderPage();
    await fireEvent.click(screen.getByTestId('filter-panel-add-year'));
    await waitFor(() => expect(screen.getByTestId('active-filters-bar')).toBeInTheDocument());
    await fireEvent.click(screen.getByTestId('active-filters-remove-timeline'));
    await waitFor(() => expect(screen.queryByTestId('active-filters-bar')).not.toBeInTheDocument());
  });

  it('browse: clear-all in ActiveFiltersBar removes all filters', async () => {
    renderPage();
    await fireEvent.click(screen.getByTestId('filter-panel-add-person'));
    await waitFor(() => expect(screen.getByTestId('active-filters-bar')).toBeInTheDocument());
    await fireEvent.click(screen.getByTestId('active-filters-clear-all'));
    await waitFor(() => expect(screen.queryByTestId('active-filters-bar')).not.toBeInTheDocument());
  });

  it('add mode renders the picker FilterPanel', async () => {
    renderPage({ members: [makeMember(SharedSpaceRole.Editor)], album: makeAlbum({ id: 'album-1' }) });
    await fireEvent.click(screen.getByTestId('add-photos-button'));
    await waitFor(() => expect(screen.getByTestId('filter-panel')).toBeInTheDocument());
  });

  it('pickerOptions carry filter fields once a picker filter is set, and show ActiveFiltersBar', async () => {
    renderPage({ members: [makeMember(SharedSpaceRole.Editor)], album: makeAlbum({ id: 'album-1' }) });
    await fireEvent.click(screen.getByTestId('add-photos-button'));
    await fireEvent.click(screen.getByTestId('filter-panel-add-person'));
    await waitFor(() => {
      const options = JSON.parse(screen.getByTestId('timeline-options').textContent ?? '{}');
      expect(options.personIds).toEqual(['person-1']);
      expect(options.timelineAlbumId).toBe('album-1');
    });
    expect(screen.getByTestId('active-filters-bar')).toBeInTheDocument();
  });

  it('add mode: filtered-empty replaces the picker timeline; clear restores it', async () => {
    setMockTimelineEmpty();
    renderPage({ members: [makeMember(SharedSpaceRole.Editor)], album: makeAlbum({ id: 'album-1' }) });
    await fireEvent.click(screen.getByTestId('add-photos-button'));
    await fireEvent.click(screen.getByTestId('filter-panel-add-person'));
    await waitFor(() => {
      expect(screen.getByTestId('picker-filtered-empty')).toBeInTheDocument();
      expect(screen.queryByTestId('space-album-timeline')).not.toBeInTheDocument();
    });
    await fireEvent.click(screen.getByTestId('picker-clear-filters'));
    await waitFor(() => {
      expect(screen.queryByTestId('picker-filtered-empty')).not.toBeInTheDocument();
      expect(screen.getByTestId('space-album-timeline')).toBeInTheDocument();
    });
  });

  it('picker filters are reset after a successful add (returns to browse with no active filters)', async () => {
    const refreshedAlbum = makeAlbum({ id: 'album-1', albumName: 'Refreshed', assetCount: 5 });
    vi.mocked(getAlbumInfo).mockResolvedValue(refreshedAlbum);
    pickerSelectedAssets.splice(0, pickerSelectedAssets.length, { id: 'a-1' });
    vi.mocked(addAssetsToAlbumWithOutcome).mockResolvedValue({ ok: true, addedIds: ['a-1'], deniedIds: [] });
    const addAssetsOnAction = vi.fn().mockResolvedValue(undefined);
    vi.mocked(getAlbumAssetsActions).mockReturnValue({
      AddAssets: { title: 'Add assets', icon: '', onAction: addAssetsOnAction, $if: () => true },
      Upload: { title: 'Upload', icon: '', onAction: vi.fn() },
    } as never);

    renderPage({ members: [makeMember(SharedSpaceRole.Editor)], album: makeAlbum({ id: 'album-1' }) });

    // Enter add mode and set a picker filter.
    await fireEvent.click(screen.getByTestId('add-photos-button'));
    await waitFor(() => {
      expect(screen.getByTestId('space-album-timeline')).toHaveAttribute('data-mode', 'add');
    });
    await fireEvent.click(screen.getByTestId('filter-panel-add-person'));
    await waitFor(() => expect(screen.getByTestId('active-filters-bar')).toBeInTheDocument());

    // Fire the AddAssets action — same mechanism as the existing test.
    const addAssetsButton = screen.getByRole('button', { name: /add assets/i });
    await fireEvent.click(addAssetsButton);

    // handleAddAssetsSuccess runs: calls onAction, refreshes album, resets picker filters, returns to browse.
    await waitFor(() => {
      expect(getAlbumInfo).toHaveBeenCalledWith({ id: 'album-1' });
    });
    // After returning to browse, the picker filters must be cleared → no active-filters-bar.
    await waitFor(() => expect(screen.queryByTestId('active-filters-bar')).not.toBeInTheDocument());
  });

  it('entering add mode starts with no active picker filters even if browse was filtered', async () => {
    renderPage({ members: [makeMember(SharedSpaceRole.Editor)], album: makeAlbum({ id: 'album-1' }) });
    await fireEvent.click(screen.getByTestId('filter-panel-add-person'));
    await waitFor(() => expect(screen.getByTestId('active-filters-bar')).toBeInTheDocument());
    await fireEvent.click(screen.getByTestId('add-photos-button'));
    await waitFor(() => expect(screen.getByTestId('add-photos-overlay')).toBeInTheDocument());
    expect(screen.queryByTestId('active-filters-bar')).not.toBeInTheDocument();
  });

  it('add mode: the picker FilterPanel is hidden when there are no photos to add and no filters', async () => {
    setMockTimelineEmpty();
    renderPage({ members: [makeMember(SharedSpaceRole.Editor)], album: makeAlbum({ id: 'album-1' }) });
    await fireEvent.click(screen.getByTestId('add-photos-button'));
    await waitFor(() => expect(screen.getByTestId('filter-panel').dataset.hidden).toBe('true'));
  });

  it('add mode: the picker FilterPanel stays visible when filtered to empty', async () => {
    setMockTimelineEmpty();
    renderPage({ members: [makeMember(SharedSpaceRole.Editor)], album: makeAlbum({ id: 'album-1' }) });
    await fireEvent.click(screen.getByTestId('add-photos-button'));
    await fireEvent.click(screen.getByTestId('filter-panel-add-person'));
    await waitFor(() => expect(screen.getByTestId('filter-panel').dataset.hidden).toBe('false'));
  });

  // ── empty-add-photos-button gating ──────────────────────────────────────────

  it('empty-add-photos-button is present for a space editor (empty album)', () => {
    setMockTimelineEmpty();
    renderPage({ members: [makeMember(SharedSpaceRole.Editor)] });
    expect(screen.getByTestId('empty-add-photos-button')).toBeInTheDocument();
  });

  it('empty-add-photos-button is absent for a space viewer with album-viewer role', () => {
    setMockTimelineEmpty();
    renderPage({
      members: [makeMember(SharedSpaceRole.Viewer)],
      album: makeAlbum({
        albumUsers: [
          {
            user: { id: 'current-user-id', email: 'user@example.com', name: 'Current User' } as never,
            role: AlbumUserRole.Viewer,
          },
        ],
      }),
    });
    expect(screen.queryByTestId('empty-add-photos-button')).not.toBeInTheDocument();
  });

  // ── header add-photos-button role-combo coverage ─────────────────────────────

  it('space=Editor + album role=Viewer: add-photos-button present (canManage via isSpaceEditor)', () => {
    renderPage({
      members: [makeMember(SharedSpaceRole.Editor)],
      album: makeAlbum({
        albumUsers: [
          {
            user: { id: 'current-user-id', email: 'user@example.com', name: 'Current User' } as never,
            role: AlbumUserRole.Viewer,
          },
        ],
      }),
    });
    expect(screen.getByTestId('add-photos-button')).toBeInTheDocument();
  });

  it('space=Viewer + album role=Owner: add-photos-button present (canManage via isAlbumEditor)', () => {
    renderPage({
      members: [makeMember(SharedSpaceRole.Viewer)],
      album: makeAlbum({
        albumUsers: [
          {
            user: { id: 'current-user-id', email: 'user@example.com', name: 'Current User' } as never,
            role: AlbumUserRole.Owner,
          },
        ],
      }),
    });
    expect(screen.getByTestId('add-photos-button')).toBeInTheDocument();
  });

  // ── RemoveFromAlbum gating — additional role combos ──────────────────────────

  it('space=Viewer + album=Editor + selection active: RemoveFromAlbum is present', async () => {
    mockAssetMultiSelectManager.selectionActive = true;
    renderPage({
      members: [makeMember(SharedSpaceRole.Viewer)],
      album: makeAlbum({
        albumUsers: [
          {
            user: { id: 'current-user-id', email: 'user@example.com', name: 'Current User' } as never,
            role: AlbumUserRole.Editor,
          },
        ],
      }),
    });
    await openOverflowMenu();
    expect(screen.getByTestId('album-remove-from-album')).toBeInTheDocument();
  });

  it('space=Owner + default album + selection active: RemoveFromAlbum is present', async () => {
    mockAssetMultiSelectManager.selectionActive = true;
    renderPage({ members: [makeMember(SharedSpaceRole.Owner)] });
    await openOverflowMenu();
    expect(screen.getByTestId('album-remove-from-album')).toBeInTheDocument();
  });

  // Slice 6 — rbac-5/albums-8 REVERSED: the browse control bar now renders the full
  // album-equivalent <SelectionToolbar> (see the +page.svelte control-bar comment for the RBAC
  // reasoning) instead of the stripped Download+Remove-only bar it originally shipped with.
  // `canRemoveFromAlbum` stays `canManage`-gated (ownership grants nothing — decision C), while
  // the metadata-edit affordances (Archive/ChangeDate/ChangeLocation/Delete/…) and Share/
  // Add-to-album/Favorite are gated independently on `isAllUserOwned` — the same two
  // independent axes the merged direct-space timeline and SelectionToolbar.spec.ts encode.
  describe('Slice 6: full album-equivalent toolbar (reversal of the stripped bar)', () => {
    it('manager + all-owned selection: Download + RemoveFromAlbum + metadata-edit + Set-cover all present', async () => {
      mockAssetMultiSelectManager.selectionActive = true;
      mockAssetMultiSelectManager.isAllUserOwned = true;
      mockAssetMultiSelectManager.assets = [{ id: 'asset-1' }];
      renderPage({ members: [makeMember(SharedSpaceRole.Editor)] });

      expect(screen.getByRole('button', { name: 'Share' })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Add to album or space' })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: /favorite/i })).toBeInTheDocument();

      await openOverflowMenu();
      expect(screen.getByTestId('download-action')).toBeInTheDocument();
      expect(screen.getByTestId('album-remove-from-album')).toBeInTheDocument();
      expect(screen.getByRole('menuitem', { name: 'Change date' })).toBeInTheDocument();
      expect(screen.getByRole('menuitem', { name: 'Change location' })).toBeInTheDocument();
      expect(screen.getByRole('menuitem', { name: 'Archive' })).toBeInTheDocument();
      expect(screen.getByRole('menuitem', { name: 'Delete' })).toBeInTheDocument();
      expect(screen.getByRole('menuitem', { name: 'Set as album cover' })).toBeInTheDocument();
    });

    it('manager + NOT-owned selection: RemoveFromAlbum + Set-cover + Add-to-album present (canManage-gated), metadata-edit + Delete + Share absent (ownership-gated)', async () => {
      mockAssetMultiSelectManager.selectionActive = true;
      mockAssetMultiSelectManager.isAllUserOwned = false;
      mockAssetMultiSelectManager.assets = [{ id: 'asset-1' }];
      renderPage({ members: [makeMember(SharedSpaceRole.Editor)] });

      expect(screen.queryByRole('button', { name: 'Share' })).not.toBeInTheDocument();
      // A space Editor may contribute non-owned assets into an album linked to this space
      // (#764), so the "+" stays — it opens the picker restricted to that space's albums.
      expect(screen.getByRole('button', { name: 'Add to album or space' })).toBeInTheDocument();
      expect(screen.queryByRole('button', { name: /favorite/i })).not.toBeInTheDocument();

      await openOverflowMenu();
      expect(screen.getByTestId('download-action')).toBeInTheDocument();
      // canRemoveFromAlbum / canSetCover key off canManage (space.canWrite || album.isEditor),
      // NOT ownership — both stay visible even though the selection isn't owned.
      expect(screen.getByTestId('album-remove-from-album')).toBeInTheDocument();
      expect(screen.getByRole('menuitem', { name: 'Set as album cover' })).toBeInTheDocument();
      // Ownership-gated actions are hidden regardless of manager status.
      expect(screen.queryByRole('menuitem', { name: 'Change date' })).not.toBeInTheDocument();
      expect(screen.queryByRole('menuitem', { name: 'Archive' })).not.toBeInTheDocument();
      expect(screen.queryByRole('menuitem', { name: 'Delete' })).not.toBeInTheDocument();
    });

    it('non-manager (viewer) + all-owned selection: metadata-edit affordances present, RemoveFromAlbum + Set-cover absent', async () => {
      mockAssetMultiSelectManager.selectionActive = true;
      mockAssetMultiSelectManager.isAllUserOwned = true;
      mockAssetMultiSelectManager.assets = [{ id: 'asset-1' }];
      renderPage({
        members: [makeMember(SharedSpaceRole.Viewer)],
        album: makeAlbum({
          albumUsers: [
            {
              user: { id: 'current-user-id', email: 'user@example.com', name: 'Current User' } as never,
              role: AlbumUserRole.Viewer,
            },
          ],
        }),
      });

      expect(screen.getByRole('button', { name: 'Share' })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Add to album or space' })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: /favorite/i })).toBeInTheDocument();

      await openOverflowMenu();
      expect(screen.getByTestId('download-action')).toBeInTheDocument();
      expect(screen.getByRole('menuitem', { name: 'Change date' })).toBeInTheDocument();
      expect(screen.getByRole('menuitem', { name: 'Archive' })).toBeInTheDocument();
      expect(screen.getByRole('menuitem', { name: 'Delete' })).toBeInTheDocument();

      // canManage is false for a plain album/space Viewer — Remove and Set-cover stay hidden
      // even though the selection is entirely their own.
      expect(screen.queryByTestId('album-remove-from-album')).not.toBeInTheDocument();
      expect(screen.queryByRole('menuitem', { name: 'Set as album cover' })).not.toBeInTheDocument();
    });

    it('non-manager (viewer) + NOT-owned selection: only Select-all and Download are shown', async () => {
      mockAssetMultiSelectManager.selectionActive = true;
      mockAssetMultiSelectManager.isAllUserOwned = false;
      mockAssetMultiSelectManager.assets = [{ id: 'asset-1' }];
      renderPage({
        members: [makeMember(SharedSpaceRole.Viewer)],
        album: makeAlbum({
          albumUsers: [
            {
              user: { id: 'current-user-id', email: 'user@example.com', name: 'Current User' } as never,
              role: AlbumUserRole.Viewer,
            },
          ],
        }),
      });

      expect(screen.getByRole('button', { name: 'Select all' })).toBeInTheDocument();
      expect(screen.queryByRole('button', { name: 'Share' })).not.toBeInTheDocument();
      expect(screen.queryByRole('button', { name: 'Add to album or space' })).not.toBeInTheDocument();
      expect(screen.queryByRole('button', { name: /favorite/i })).not.toBeInTheDocument();

      await openOverflowMenu();
      expect(screen.getByTestId('download-action')).toBeInTheDocument();
      expect(screen.queryByTestId('album-remove-from-album')).not.toBeInTheDocument();
      expect(screen.queryByRole('menuitem', { name: 'Delete' })).not.toBeInTheDocument();
      expect(screen.queryByRole('menuitem', { name: 'Set as album cover' })).not.toBeInTheDocument();
    });
  });

  // The sidebar album drill-down made album → sibling-album navigation reachable for the first
  // time. SvelteKit reuses this component instance across that navigation, so nothing remounts —
  // only `data` changes. The page has to re-seed its local album state from it, or the URL moves
  // while the timeline keeps showing the album you came from.
  describe('navigating between sibling albums (same route, new params)', () => {
    // Rendered via TestWrapper (see renderPage), so `rerender` needs the full
    // `{ component, componentProps }` shape, not just the inner page's props.
    const rerenderWith = (album: AlbumResponseDto, members = [makeMember()]) => ({
      component: SpaceAlbumDetailPage,
      componentProps: { data: makePageData(album, members) },
    });

    const albumWithRole = (id: string, role: AlbumUserRole) =>
      makeAlbum({
        id,
        albumUsers: [
          {
            user: { id: 'current-user-id', email: 'user@example.com', name: 'Current User' } as never,
            role,
          },
        ],
      });

    it('rebuilds the timeline for the newly navigated album', async () => {
      const { rerender } = renderPage({ album: makeAlbum({ id: 'album-1', albumName: 'Vacation 2025' }) });

      expect(JSON.parse(screen.getByTestId('timeline-options').textContent ?? '{}').albumId).toBe('album-1');

      await rerender(rerenderWith(makeAlbum({ id: 'album-2', albumName: 'Birthday Party' })));

      expect(JSON.parse(screen.getByTestId('timeline-options').textContent ?? '{}').albumId).toBe('album-2');
    });

    it('re-evaluates album-derived permissions for the newly navigated album', async () => {
      // Space viewer, so the manage gate falls through to the per-album role: owned album-1 keeps
      // "Add photos", viewer-only album-2 must not. A stale album leaves the button wrongly shown.
      const viewerOnly = [makeMember(SharedSpaceRole.Viewer)];
      const { rerender } = renderPage({
        album: albumWithRole('album-1', AlbumUserRole.Owner),
        members: viewerOnly,
      });

      expect(screen.getByTestId('add-photos-button')).toBeInTheDocument();

      await rerender(rerenderWith(albumWithRole('album-2', AlbumUserRole.Viewer), viewerOnly));

      expect(screen.queryByTestId('add-photos-button')).not.toBeInTheDocument();
    });

    it('drops the previous album filters instead of carrying them onto the new album', async () => {
      const { rerender } = renderPage({ album: makeAlbum({ id: 'album-1' }) });

      await fireEvent.click(screen.getByTestId('filter-panel-add-person'));
      await waitFor(() => {
        const options = JSON.parse(screen.getByTestId('timeline-options').textContent ?? '{}');
        expect(options.personIds).toEqual(['person-1']);
      });

      await rerender(rerenderWith(makeAlbum({ id: 'album-2' })));

      const options = JSON.parse(screen.getByTestId('timeline-options').textContent ?? '{}');
      expect(options.albumId).toBe('album-2');
      expect(options.personIds).toBeUndefined();
    });

    it('returns to browse mode when navigating away from the add-photos picker', async () => {
      const { rerender } = renderPage({ album: makeAlbum({ id: 'album-1' }) });

      await fireEvent.click(screen.getByTestId('add-photos-button'));
      await waitFor(() => expect(screen.getByTestId('space-album-timeline')).toHaveAttribute('data-mode', 'add'));

      await rerender(rerenderWith(makeAlbum({ id: 'album-2' })));

      expect(screen.getByTestId('space-album-timeline')).toHaveAttribute('data-mode', 'browse');
    });
  });
});
