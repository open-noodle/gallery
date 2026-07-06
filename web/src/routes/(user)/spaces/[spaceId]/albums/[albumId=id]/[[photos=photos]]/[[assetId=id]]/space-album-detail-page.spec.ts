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
import { init, register, waitLocale } from 'svelte-i18n';
import { getAnimateMock } from '$lib/__mocks__/animate.mock';
import { authManager } from '$lib/managers/auth-manager.svelte';
import { getAlbumAssetsActions } from '$lib/services/album.service';
import { preferencesFactory } from '@test-data/factories/preferences-factory';
import { userAdminFactory } from '@test-data/factories/user-factory';
import SpaceAlbumDetailPage from './+page.svelte';
import { resetMockTimelineState, setMockTimelineEmpty } from './mock-timeline-state';

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
  const { default: MockComponent } = await import('@test-data/mocks/noop-component.svelte');
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

vi.mock('$app/navigation', () => ({ goto: vi.fn() }));

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

const { mockAssetMultiSelectManager } = vi.hoisted(() => ({
  mockAssetMultiSelectManager: {
    selectionActive: false,
    assets: [] as { id: string }[],
    clear: vi.fn(),
    isAllFavorite: false,
    isAllUserOwned: true,
  },
}));

vi.mock('$lib/managers/asset-multi-select-manager.svelte', () => ({
  assetMultiSelectManager: mockAssetMultiSelectManager,
  AssetMultiSelectManager: class {
    selectionActive = false;
    assets: { id: string }[] = [];
    clear = vi.fn();
    isAllFavorite = false;
    isAllUserOwned = true;
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

  return render(SpaceAlbumDetailPage, {
    props: {
      data: {
        space,
        members,
        album,
        meta: { title: album.albumName },
      },
    },
  });
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
    mockAssetMultiSelectManager.selectionActive = false;
    mockAssetMultiSelectManager.assets = [];
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

  it('shows the album name in the page title', () => {
    renderPage({ album: makeAlbum({ albumName: 'Summer Trips' }) });
    const layout = screen.getByTestId('user-page-layout');
    expect(layout).toHaveAttribute('data-title', 'Summer Trips');
  });

  it('shows "in {space}" context in description', () => {
    renderPage({ album: makeAlbum(), space: { ...BASE_SPACE, name: 'Family Memories' } });
    const layout = screen.getByTestId('user-page-layout');
    expect(layout.dataset.description).toMatch(/in Family Memories/);
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
    const bar = screen.getByTestId('timeline-desktop-grouping-control');
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

  it('in browse mode with selection active and canManage=true, RemoveFromAlbum and Download actions are wired', () => {
    mockAssetMultiSelectManager.selectionActive = true;
    renderPage({ members: [makeMember(SharedSpaceRole.Editor)] });
    // AssetSelectControlBar renders its children
    expect(screen.getByTestId('asset-select-control-bar')).toBeInTheDocument();
    // RemoveFromAlbumAction (noop-component) is rendered
    expect(screen.getByTestId('noop-component')).toBeInTheDocument();
    // DownloadAction is rendered for all members
    expect(screen.getByTestId('download-action')).toBeInTheDocument();
  });

  it('in browse mode with selection active and canManage=false, control bar shown with Download but no Remove action', () => {
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
    // DownloadAction is available to all members (bar is not empty for viewers)
    expect(screen.getByTestId('download-action')).toBeInTheDocument();
    // But RemoveFromAlbumAction (noop-component) is NOT rendered
    expect(screen.queryByTestId('noop-component')).not.toBeInTheDocument();
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

  it('space=Viewer + album=Editor + selection active: RemoveFromAlbum is present', () => {
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
    expect(screen.getByTestId('noop-component')).toBeInTheDocument();
  });

  it('space=Owner + default album + selection active: RemoveFromAlbum is present', () => {
    mockAssetMultiSelectManager.selectionActive = true;
    renderPage({ members: [makeMember(SharedSpaceRole.Owner)] });
    expect(screen.getByTestId('noop-component')).toBeInTheDocument();
  });
});
