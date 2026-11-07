import TestWrapper from '#lib/components/TestWrapper.svelte';
import { reactivePageMock as mockPage } from '#lib/gallery/__mocks__/reactive-page.mock.svelte.ts';
import { addAssetsToAlbumWithOutcome } from '#lib/gallery/album/album-add.ts';
import { authManager } from '#lib/managers/auth-manager.svelte.ts';
import { getAlbumAssetsActions } from '#lib/services/album.service.ts';
import { factory } from '#test/unit/factories.ts';
import {
  AlbumUserRole,
  AssetOrder,
  SharedSpaceRole,
  getAlbumInfo,
  getFilterSuggestions,
  searchSmartFacets,
  type AlbumResponseDto,
  type SharedSpaceMemberResponseDto,
  type SharedSpaceResponseDto,
} from '@immich/sdk';
import type { Component } from 'svelte';
import { init, register, waitLocale } from 'svelte-i18n';
import { expect } from 'vitest';
import { render } from 'vitest-browser-svelte';
import { page, userEvent } from 'vitest/browser';
import { goto } from '$app/navigation';
import SpaceAlbumDetailPage from './+page.svelte';
import { mockTimelineState, resetMockTimelineState, setMockTimelineEmpty } from './mock-timeline-state';

vi.mock('#lib/components/layouts/UserPageLayout.svelte', async () => {
  const { default: MockComponent } = await import('#lib/components/spaces/mock-user-page-layout.test-wrapper.svelte');
  return { default: MockComponent };
});

vi.mock('#lib/components/timeline/Timeline.svelte', async () => {
  const { default: MockComponent } = await import('./mock-timeline.test-wrapper.svelte');
  return { default: MockComponent };
});

vi.mock('#lib/components/timeline/AssetSelectControlBar.svelte', async () => {
  const { default: MockComponent } = await import('./mock-asset-select-control-bar.test-wrapper.svelte');
  return { default: MockComponent };
});

vi.mock('#lib/components/timeline/actions/DownloadAction.svelte', async () => {
  const { default: MockComponent } = await import('./mock-download-action.test-wrapper.svelte');
  return { default: MockComponent };
});

vi.mock('#lib/components/shared-components/ControlAppBar.svelte', async () => {
  const { default: MockComponent } =
    await import('../../../../[[photos=photos]]/[[assetId=id]]/mock-control-app-bar.test-wrapper.svelte');
  return { default: MockComponent };
});

vi.mock('#lib/components/filter-panel/filter-panel.svelte', async () => {
  const { default: MockComponent } = await import('./mock-filter-panel.test-wrapper.svelte');
  return { default: MockComponent };
});

vi.mock('#lib/components/filter-panel/active-filters-bar.svelte', async () => {
  const { default: MockComponent } = await import('./mock-active-filters-bar.test-wrapper.svelte');
  return { default: MockComponent };
});

vi.mock('$app/navigation', async () => ({
  ...(await import('#test/unit/mocks/app-navigation.ts')),
  goto: vi.fn(),
  invalidateAll: vi.fn(),
  onNavigate: vi.fn(),
}));

// Reactive, not a plain hoisted object: this page's filters and committed query are URL-backed, so
// its re-hydrate $effect only re-runs when `page.url` is a real signal. A plain object would let a
// broken re-hydrate pass. See reactive-page.mock.svelte.ts.
vi.mock('$app/state', async () => {
  const { reactivePageMock } = await import('#lib/gallery/__mocks__/reactive-page.mock.svelte.ts');
  return { page: reactivePageMock };
});

vi.mock('#lib/components/search/smart-search-results.svelte', async () => {
  const { default: MockComponent } = await import('#lib/gallery/__mocks__/smart-search-results.stub.svelte');
  return { default: MockComponent };
});

vi.mock('#lib/components/timeline/TimelineGroupingControl.svelte', async () => {
  const { default: MockComponent } = await import('./mock-grouping-control.test-wrapper.svelte');
  return { default: MockComponent };
});

vi.mock('#lib/gallery/timeline/timeline-anchor.js', () => ({
  getTimelineTopVisibleAnchor: vi.fn().mockReturnValue(undefined),
  getTimelineTemporalAnchorTarget: vi.fn(),
  scrollTimelineToTemporalAnchor: vi.fn(),
  retryOnAnimationFrames: vi.fn(),
}));

vi.mock('#lib/utils/timeline-zoom-navigation.js', () => ({
  getTimelineBucketZoomTarget: vi.fn(),
  getTimelineManagerTimeBuckets: vi.fn().mockReturnValue([]),
}));

// Slice 6: the browse selection bar now renders the full <SelectionToolbar>, which wires
// DeleteAssetsAction — its `force` derivation reads featureFlagsManager.value.trash, which
// throws until the (real, module-singleton) manager is initialized. Mirrors the mock already
// used by SelectionToolbar.spec.ts and the space-person-detail-page spec.
vi.mock('#lib/managers/feature-flags-manager.svelte.js', () => ({
  featureFlagsManager: { value: { trash: true } },
}));

const { mockAssetMultiSelectManager, pickerMultiSelectClear, pickerSelectedAssets, mockOpenSearchPalette } = vi.hoisted(
  () => ({
    mockOpenSearchPalette: vi.fn(),
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
        // eslint-disable-next-line unicorn/no-this-outside-of-class
        return this.isAllUserOwned ? this.assets : [];
      },
    },
  }),
);

vi.mock('#lib/managers/global-search-manager.svelte.js', () => ({
  globalSearchManager: {
    // Returns a teardown, matching the real registration the page's $effect consumes.
    registerSearchablePageFilters: vi.fn(() => vi.fn()),
    open: mockOpenSearchPalette,
  },
}));

vi.mock('#lib/managers/asset-multi-select-manager.svelte.js', () => ({
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
    getFilterSuggestions: vi.fn(),
    searchSmartFacets: vi.fn(),
  };
});

// Spied, not replaced by a factory: spreading importOriginal() here deadlocks the browser-mode module
// graph. beforeEach gives getAlbumAssetsActions its fixture return.
vi.mock('#lib/services/album.service.js', { spy: true });

vi.mock('#lib/gallery/album/album-add.js', () => ({
  addAssetsToAlbumWithOutcome: vi.fn().mockResolvedValue({ ok: true, addedIds: [], deniedIds: [] }),
  addAssetsToAlbums: vi.fn(),
  createAlbum: vi.fn(),
}));

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
  folderId: string | null = null,
) {
  return {
    error: undefined,
    asset: undefined,
    linkedAlbums: [],
    space,
    members,
    album,
    folderId,
    meta: { title: album.albumName },
  };
}

function renderPage({
  album = makeAlbum(),
  members = [makeMember()],
  space = BASE_SPACE,
  folderId = null,
}: {
  album?: AlbumResponseDto;
  members?: SharedSpaceMemberResponseDto[];
  space?: SharedSpaceResponseDto;
  folderId?: string | null;
} = {}) {
  authManager.setUser(factory.user({ id: 'current-user-id' }));
  authManager.setPreferences(factory.preferences());

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
      componentProps: { data: makePageData(album, members, space, folderId) },
    },
  );
}

// Slice 6: RemoveFromAlbum/Download/Delete/etc. now live as menu items inside the
// <SelectionToolbar>'s "⋮" ButtonContextMenu instead of top-level in the control bar. Open it
// before asserting on any menu item, mirroring the Slice 4/5 Playwright specs
// (spaces-selection-toolbar-timeline.e2e-spec.ts's `openOverflowMenu`).
async function openOverflowMenu() {
  await userEvent.click(page.getByRole('button', { name: 'Menu' }));
}

describe('Space album detail page', () => {
  beforeAll(async () => {
    register('en-US', () => import('#i18n/en.json'));
    await init({ fallbackLocale: 'en-US', initialLocale: 'en-US' });
    await waitLocale('en-US');
  });

  beforeEach(() => {
    vi.resetAllMocks();
    mockPage.reset('https://gallery.test/spaces/space-1/albums/album-1');
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

  it('renders the album timeline', async () => {
    await renderPage();
    await expect.element(page.getByTestId('space-album-timeline')).toBeInTheDocument();
  });

  it('shows the space name in the page title (the album name lives in the editable AlbumTitle below)', async () => {
    await renderPage({
      album: makeAlbum({ albumName: 'Summer Trips' }),
      space: { ...BASE_SPACE, name: 'Family Memories' },
    });
    const layout = page.getByTestId('user-page-layout').element() as HTMLElement;
    expect(layout).toHaveAttribute('data-title', 'Family Memories');
    // The album name is no longer duplicated in the page header (it moved to the editable AlbumTitle).
    expect(layout.dataset.title).not.toBe('Summer Trips');
  });

  it('renders the back button in leading slot', async () => {
    await renderPage();
    const leading = page.getByTestId('layout-leading').element() as HTMLElement;
    expect(leading.querySelector('button')).not.toBeNull();
  });

  // Back must return the user to the folder the album lives in, not dump them at the space
  // root — otherwise every trip into an album costs them their place in the tree.
  it('back returns to the album folder when the album lives in one', async () => {
    await renderPage({ folderId: 'folder-trips' });

    await userEvent.click(page.getByTestId('layout-leading').element().querySelector('button')!);

    expect(goto).toHaveBeenCalledWith('/spaces/space-1/albums?folder=folder-trips');
  });

  it('back returns to the space root when the album is not in a folder', async () => {
    await renderPage({ folderId: null });

    await userEvent.click(page.getByTestId('layout-leading').element().querySelector('button')!);

    expect(goto).toHaveBeenCalledWith('/spaces/space-1/albums');
  });

  it('editor sees the "Add photos" button', async () => {
    await renderPage({ members: [makeMember(SharedSpaceRole.Editor)] });
    await expect.element(page.getByTestId('add-photos-button')).toBeInTheDocument();
  });

  it('owner sees the "Add photos" button', async () => {
    await renderPage({ members: [makeMember(SharedSpaceRole.Owner)] });
    await expect.element(page.getByTestId('add-photos-button')).toBeInTheDocument();
  });

  it('viewer does NOT see the "Add photos" button when not an album editor', async () => {
    await renderPage({
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
    await expect.element(page.getByTestId('add-photos-button')).not.toBeInTheDocument();
  });

  it('album editor/owner can manage even as a space viewer', async () => {
    await renderPage({
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
    await expect.element(page.getByTestId('add-photos-button')).toBeInTheDocument();
  });

  it('showInTimeline=false album still renders the timeline fully', async () => {
    await renderPage({
      album: makeAlbum(),
    });
    await expect.element(page.getByTestId('space-album-timeline')).toBeInTheDocument();
  });

  it('browse timeline has enableRouting=true so the in-place asset viewer opens/closes via the URL', async () => {
    await renderPage();
    await expect.element(page.getByTestId('space-album-timeline')).toHaveAttribute('data-enable-routing', 'true');
  });

  // #889 — the in-place asset viewer gates add-to-album on the space capability, so the browse
  // timeline has to carry it (an album linked to this space is the only target the server can
  // accept another member's photo into).
  it('browse timeline carries the space capability for an editor', async () => {
    await renderPage();
    await expect
      .element(page.getByTestId('space-album-timeline'))
      .toHaveAttribute('data-space', JSON.stringify({ id: 'space-1', canWrite: true }));
  });

  it('browse timeline carries the space capability as read-only for a viewer', async () => {
    await renderPage({ members: [makeMember(SharedSpaceRole.Viewer)] });
    await expect
      .element(page.getByTestId('space-album-timeline'))
      .toHaveAttribute('data-space', JSON.stringify({ id: 'space-1', canWrite: false }));
  });

  it('in browse mode, the timeline-desktop-grouping-control renders', async () => {
    await renderPage();
    await expect.element(page.getByTestId('timeline-desktop-grouping-control')).toBeInTheDocument();
  });

  // #1051. This page hand-rolls the toolbar row rather than using FilterToolbar, so the button is
  // wired separately here and needs its own coverage — a FilterToolbar test proves nothing for it.
  describe('scoped search button', () => {
    it('sits beside the grouping control in browse mode', async () => {
      await renderPage();
      await expect.element(page.getByTestId('scoped-search-button')).toBeInTheDocument();
    });

    it('opens the album-scoped search palette when clicked', async () => {
      await renderPage();
      await userEvent.click(page.getByTestId('scoped-search-button'));

      expect(mockOpenSearchPalette).toHaveBeenCalledOnce();
    });

    it('is hidden when selection is active, alongside the grouping control', async () => {
      mockAssetMultiSelectManager.selectionActive = true;
      await renderPage();
      await expect.element(page.getByTestId('scoped-search-button')).not.toBeInTheDocument();
    });

    it('stays available while album search results are showing', async () => {
      mockPage.reset('https://gallery.test/spaces/space-1/albums/album-1?q=beach');

      await renderPage();

      await expect.element(page.getByTestId('scoped-search-button')).toBeInTheDocument();
    });

    // This toolbar row is hand-rolled rather than FilterToolbar, so its responsive contract
    // has to be asserted here too — a FilterToolbar test proves nothing for it.
    it('is desktop-only, matching the grouping control beside it', async () => {
      await renderPage();

      const wrapper = page.getByTestId('space-album-toolbar-search').element() as HTMLElement;
      expect(wrapper.className).toContain('hidden');
      expect(wrapper.className).toContain('md:flex');
    });
  });

  it('the grouping-control bar is transparent (no navy/border bar) to match the space page', async () => {
    await renderPage();
    // data-testid="timeline-desktop-grouping-control" now sits on the grouping wrapper (kept
    // desktop-only, #752 launch review F3); the surrounding bar carrying the background utilities
    // is its parent.
    const bar = page.getByTestId('timeline-desktop-grouping-control').element().parentElement!;
    // The rolling/main fix dropped the bordered grey/navy bar in favour of a transparent container.
    expect(bar.className).toContain('bg-transparent');
    expect(bar.className).toContain('dark:bg-transparent');
    expect(bar.className).not.toContain('bg-gray-50');
    expect(bar.className).not.toContain('dark:bg-gray-900');
    expect(bar.className).not.toContain('border-b');
  });

  it('timeline receives grouping="day" by default (not "month")', async () => {
    await renderPage();
    await expect.element(page.getByTestId('space-album-timeline')).toHaveAttribute('data-grouping', 'day');
  });

  it('browse timeline OPTIONS carry the current grouping (default day) so the manager actually groups', async () => {
    await renderPage({ album: makeAlbum({ id: 'album-1' }) });
    const options = JSON.parse(page.getByTestId('timeline-options').element().textContent ?? '{}');
    expect(options.grouping).toBe('day');
  });

  it('changing the grouping control updates the timeline OPTIONS grouping (not just the prop)', async () => {
    await renderPage({ album: makeAlbum({ id: 'album-1' }) });
    await userEvent.click(page.getByTestId('set-grouping-month'));
    await vi.waitFor(() => {
      const options = JSON.parse(page.getByTestId('timeline-options').element().textContent ?? '{}');
      expect(options.grouping).toBe('month');
    });
    // and the prop stays in sync
    await expect.element(page.getByTestId('space-album-timeline')).toHaveAttribute('data-grouping', 'month');
  });

  it('timeline-desktop-grouping-control is hidden when selection is active in browse mode', async () => {
    mockAssetMultiSelectManager.selectionActive = true;
    await renderPage();
    await expect.element(page.getByTestId('timeline-desktop-grouping-control')).not.toBeInTheDocument();
  });

  it('timeline-desktop-grouping-control is hidden in add mode', async () => {
    await renderPage({ members: [makeMember(SharedSpaceRole.Editor)], album: makeAlbum({ id: 'album-1' }) });
    await userEvent.click(page.getByTestId('add-photos-button'));
    await expect.element(page.getByTestId('space-album-timeline')).toHaveAttribute('data-mode', 'add');
    await expect.element(page.getByTestId('timeline-desktop-grouping-control')).not.toBeInTheDocument();
  });

  it('timeline options include albumId in browse mode', async () => {
    await renderPage({ album: makeAlbum({ id: 'album-1' }) });
    const options = JSON.parse(page.getByTestId('timeline-options').element().textContent ?? '{}');
    expect(options).toMatchObject({ albumId: 'album-1' });
  });

  it('timeline starts in browse mode (options have albumId, not timelineAlbumId)', async () => {
    await renderPage({ album: makeAlbum({ id: 'album-1' }) });
    await expect.element(page.getByTestId('space-album-timeline')).toHaveAttribute('data-mode', 'browse');
  });

  it('clicking "Add photos" switches timeline to add mode (picker options)', async () => {
    await renderPage({ members: [makeMember(SharedSpaceRole.Editor)], album: makeAlbum({ id: 'album-1' }) });
    const addButton = page.getByTestId('add-photos-button').element() as HTMLElement;

    await userEvent.click(addButton);

    await expect.element(page.getByTestId('space-album-timeline')).toHaveAttribute('data-mode', 'add');
    const options = JSON.parse(page.getByTestId('timeline-options').element().textContent ?? '{}');
    expect(options).toMatchObject({ timelineAlbumId: 'album-1' });
    expect(options).not.toHaveProperty('albumId');
  });

  it('in browse mode with selection active, AssetSelectControlBar is rendered', async () => {
    mockAssetMultiSelectManager.selectionActive = true;
    await renderPage({ members: [makeMember(SharedSpaceRole.Editor)] });
    await expect.element(page.getByTestId('asset-select-control-bar')).toBeInTheDocument();
  });

  it('in browse mode with selection active and canManage=true, RemoveFromAlbum and Download actions are wired', async () => {
    mockAssetMultiSelectManager.selectionActive = true;
    await renderPage({ members: [makeMember(SharedSpaceRole.Editor)] });
    // AssetSelectControlBar renders its children
    await expect.element(page.getByTestId('asset-select-control-bar')).toBeInTheDocument();

    // Remove-from-album and DownloadAction are menu items inside the "⋮" overflow menu.
    await openOverflowMenu();
    await expect.element(page.getByText('Remove from album')).toBeInTheDocument();
    // DownloadAction is rendered for all members
    await expect.element(page.getByTestId('download-action')).toBeInTheDocument();
  });

  it('in browse mode with selection active and canManage=false, control bar shown with Download but no Remove action', async () => {
    mockAssetMultiSelectManager.selectionActive = true;
    await renderPage({
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
    await expect.element(page.getByTestId('asset-select-control-bar')).toBeInTheDocument();

    await openOverflowMenu();
    // DownloadAction is available to all members (bar is not empty for viewers)
    await expect.element(page.getByTestId('download-action')).toBeInTheDocument();
    // But remove-from-album is NOT rendered
    await expect.element(page.getByText('Remove from album')).not.toBeInTheDocument();
  });

  // ── Picker source toggle ────────────────────────────────────────────────────
  // The picker has always browsed the caller's OWN timeline, so a space album could
  // not pull in another member's photo even though the space timeline's "+" can push
  // the very same photo into the very same album (#764 contribution). The Space tab
  // closes that asymmetry by sourcing the picker from the space pool.
  describe('picker source toggle', () => {
    const openPicker = async () => {
      await userEvent.click(page.getByTestId('add-photos-button'));
      await expect.element(page.getByTestId('space-album-timeline')).toHaveAttribute('data-mode', 'add');
    };
    const pickerOptions = () => JSON.parse(page.getByTestId('timeline-options').element().textContent ?? '{}');

    it('defaults to the caller’s own photos — unchanged from today', async () => {
      await renderPage({ members: [makeMember(SharedSpaceRole.Editor)], album: makeAlbum({ id: 'album-1' }) });
      await openPicker();

      expect(pickerOptions()).toMatchObject({ timelineAlbumId: 'album-1' });
      expect(pickerOptions().spaceId).toBeUndefined();
    });

    it('switching to Space sources the picker from the space pool while keeping the already-in-album marker', async () => {
      await renderPage({ members: [makeMember(SharedSpaceRole.Editor)], album: makeAlbum({ id: 'album-1' }) });
      await openPicker();

      await userEvent.click(page.getByTestId('picker-source-space'));

      await vi.waitFor(() => expect(pickerOptions().spaceId).toBe(BASE_SPACE.id));
      // timelineAlbumId must survive: it is what greys out assets already in the album.
      expect(pickerOptions()).toMatchObject({ timelineAlbumId: 'album-1' });
    });

    it('switching back to My photos drops the space scope again', async () => {
      await renderPage({ members: [makeMember(SharedSpaceRole.Editor)], album: makeAlbum({ id: 'album-1' }) });
      await openPicker();

      await userEvent.click(page.getByTestId('picker-source-space'));
      await vi.waitFor(() => expect(pickerOptions().spaceId).toBe(BASE_SPACE.id));
      await userEvent.click(page.getByTestId('picker-source-mine'));

      await vi.waitFor(() => expect(pickerOptions().spaceId).toBeUndefined());
    });

    it('clears the pending selection when the source changes, so a selection never spans both pools', async () => {
      await renderPage({ members: [makeMember(SharedSpaceRole.Editor)], album: makeAlbum({ id: 'album-1' }) });
      await openPicker();
      // Opening the picker already calls clear() via resetPicker, and the mock class shares one
      // spy across instances — so asserting "has been called" would pass even with the clear in
      // setPickerSource deleted. Baseline here and assert the toggle adds a call of its own.
      const callsBeforeToggle = pickerMultiSelectClear.mock.calls.length;

      await userEvent.click(page.getByTestId('picker-source-space'));

      await vi.waitFor(() => expect(pickerMultiSelectClear.mock.calls.length).toBeGreaterThan(callsBeforeToggle));
    });

    it('does not clear when the already-active source is re-clicked', async () => {
      await renderPage({ members: [makeMember(SharedSpaceRole.Editor)], album: makeAlbum({ id: 'album-1' }) });
      await openPicker();
      const callsBeforeToggle = pickerMultiSelectClear.mock.calls.length;

      await userEvent.click(page.getByTestId('picker-source-mine'));

      expect(pickerMultiSelectClear.mock.calls.length).toBe(callsBeforeToggle);
    });

    // The default album fixture makes the current user its OWNER, so the picker still opens
    // for a space Viewer — but contributing another member's photo is Owner/Editor-only.
    it('is hidden from a space viewer — only an Owner/Editor may contribute another member’s photo', async () => {
      await renderPage({ members: [makeMember(SharedSpaceRole.Viewer)], album: makeAlbum({ id: 'album-1' }) });
      await openPicker();

      await expect.element(page.getByTestId('picker-source-toggle')).not.toBeInTheDocument();
    });

    it('is shown to a space editor', async () => {
      await renderPage({ members: [makeMember(SharedSpaceRole.Editor)], album: makeAlbum({ id: 'album-1' }) });
      await openPicker();

      await expect.element(page.getByTestId('picker-source-toggle')).toBeInTheDocument();
    });
  });

  it('add mode shows picker control bar (no add-photos button visible while in add mode)', async () => {
    await renderPage({ members: [makeMember(SharedSpaceRole.Editor)], album: makeAlbum({ id: 'album-1' }) });
    await userEvent.click(page.getByTestId('add-photos-button'));

    await expect.element(page.getByTestId('space-album-timeline')).toHaveAttribute('data-mode', 'add');
    // In add mode, the add-photos button should be hidden / not visible as a standalone button
    // (the ControlAppBar for picker mode replaces the regular app bar)
    await expect.element(page.getByTestId('add-photos-button')).not.toBeInTheDocument();
  });

  it('in add mode, the full-screen overlay renders with the picker timeline inside', async () => {
    await renderPage({ members: [makeMember(SharedSpaceRole.Editor)], album: makeAlbum({ id: 'album-1' }) });
    await userEvent.click(page.getByTestId('add-photos-button'));

    await expect.element(page.getByTestId('add-photos-overlay')).toBeInTheDocument();
    const overlay = page.getByTestId('add-photos-overlay').element() as HTMLElement;
    const main = page.getByTestId('add-photos-timeline-main').element() as HTMLElement;
    expect(overlay).toContainElement(main);
    expect(main.className).toContain('pt-(--control-bar-height)');
  });

  it('the picker control bar comes AFTER the timeline-main in DOM so it paints on top and its buttons are clickable', async () => {
    await renderPage({ members: [makeMember(SharedSpaceRole.Editor)], album: makeAlbum({ id: 'album-1' }) });
    await userEvent.click(page.getByTestId('add-photos-button'));
    await expect.element(page.getByTestId('add-photos-overlay')).toBeInTheDocument();

    const overlay = page.getByTestId('add-photos-overlay').element() as HTMLElement;
    const main = page.getByTestId('add-photos-timeline-main').element() as HTMLElement;
    // The ControlAppBar is `position: absolute` with auto z-index. The full-height <main> would
    // paint over it (swallowing clicks on the trailing Upload/Add buttons) unless the bar comes
    // LATER in DOM order. querySelectorAll returns document order — bar must be last.
    const ordered = [
      ...overlay.querySelectorAll('[data-testid="add-photos-timeline-main"], [data-testid="control-app-bar"]'),
    ];
    expect(ordered[0]).toBe(main);
    expect(ordered[1]).toBe(page.getByTestId('control-app-bar').element());
  });

  it('in browse mode, the add-photos overlay is NOT rendered', async () => {
    await renderPage({ members: [makeMember(SharedSpaceRole.Editor)], album: makeAlbum({ id: 'album-1' }) });
    await expect.element(page.getByTestId('add-photos-overlay')).not.toBeInTheDocument();
  });

  it('in browse mode, the browse timeline renders (not in the overlay)', async () => {
    await renderPage({ album: makeAlbum({ id: 'album-1' }) });
    await expect.element(page.getByTestId('space-album-timeline')).toHaveAttribute('data-mode', 'browse');
    await expect.element(page.getByTestId('add-photos-overlay')).not.toBeInTheDocument();
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

    await renderPage({ members: [makeMember(SharedSpaceRole.Editor)], album: makeAlbum({ id: 'album-1' }) });

    // Enter add mode
    await userEvent.click(page.getByTestId('add-photos-button'));
    await expect.element(page.getByTestId('space-album-timeline')).toHaveAttribute('data-mode', 'add');

    // The ControlAppBar mock renders its trailing slot, so the HeaderActionButton for AddAssets
    // is in the DOM. Click it to fire the page's wrapped onAction → handleAddAssetsSuccess.
    const addAssetsButton = page.getByRole('button', { name: /add assets/i }).element() as HTMLElement;
    await userEvent.click(addAssetsButton);

    // handleAddAssetsSuccess: calls AddAssets.onAction (which resolves), then refreshAlbum
    // (getAlbumInfo), then sets mode='browse'
    await vi.waitFor(() => {
      expect(getAlbumInfo).toHaveBeenCalledWith(expect.objectContaining({ id: 'album-1' }), expect.anything());
    });
    // After refresh, mode returns to browse (add-photos button reappears)
    await expect.element(page.getByTestId('add-photos-button')).toBeInTheDocument();
  });

  it('does not insert photos into the album grid when the add call fails', async () => {
    // The service never rejects - on 5xx/network it toasts and resolves ok:false.
    pickerSelectedAssets.splice(0, pickerSelectedAssets.length, { id: 'a-1' });
    vi.mocked(addAssetsToAlbumWithOutcome).mockResolvedValue({ ok: false, addedIds: [], deniedIds: [] });
    await renderPage({ members: [makeMember(SharedSpaceRole.Editor)], album: makeAlbum({ id: 'album-1' }) });

    // Enter add mode and fire the header Add action, exactly as the success test does.
    await userEvent.click(page.getByTestId('add-photos-button'));
    await expect.element(page.getByTestId('space-album-timeline')).toHaveAttribute('data-mode', 'add');
    await userEvent.click(page.getByRole('button', { name: /add assets/i }));

    // The picker stays open (retry) and nothing was optimistically upserted into the browse timeline.
    await expect.element(page.getByTestId('add-photos-overlay')).toBeInTheDocument();
    expect(mockTimelineState.upsertAssets).not.toHaveBeenCalled();
  });

  // The add endpoint returns HTTP 200 with PER-ASSET outcomes, so "the call did not throw" is not
  // the same as "every photo landed". Cross-owner adds (the Space tab) make partial denial routine:
  // an asset visible through the space is not necessarily one the contribution path will accept.
  describe('partial add outcomes', () => {
    const fireAdd = async () => {
      await userEvent.click(page.getByTestId('add-photos-button'));
      await expect.element(page.getByTestId('space-album-timeline')).toHaveAttribute('data-mode', 'add');
      await userEvent.click(page.getByRole('button', { name: /add assets/i }));
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
      await renderPage({ members: [makeMember(SharedSpaceRole.Editor)], album: makeAlbum({ id: 'album-1' }) });

      await fireAdd();

      await vi.waitFor(() => expect(mockTimelineState.upsertAssets).toHaveBeenCalled());
      // 'theirs' was denied per-asset; painting it in would show a photo that vanishes on reload.
      expect(mockTimelineState.upsertAssets).toHaveBeenCalledWith([{ id: 'mine' }]);
    });

    it('keeps the picker open and inserts nothing when every asset was denied', async () => {
      vi.mocked(addAssetsToAlbumWithOutcome).mockResolvedValue({
        ok: true,
        addedIds: [],
        deniedIds: ['mine', 'theirs'],
      });
      await renderPage({ members: [makeMember(SharedSpaceRole.Editor)], album: makeAlbum({ id: 'album-1' }) });

      await fireAdd();

      expect(mockTimelineState.upsertAssets).not.toHaveBeenCalled();
      await expect.element(page.getByTestId('add-photos-overlay')).toBeInTheDocument();
    });

    // A duplicate is not a refusal: the photo is already where the user wanted it, so there is
    // nothing to retry. Trapping them in the picker would be a regression against the old
    // behaviour, which returned to browse on any non-throwing call.
    it('closes the picker when every asset was already in the album', async () => {
      vi.mocked(addAssetsToAlbumWithOutcome).mockResolvedValue({ ok: true, addedIds: [], deniedIds: [] });
      await renderPage({ members: [makeMember(SharedSpaceRole.Editor)], album: makeAlbum({ id: 'album-1' }) });

      await fireAdd();

      await expect.element(page.getByTestId('add-photos-overlay')).not.toBeInTheDocument();
      expect(mockTimelineState.upsertAssets).toHaveBeenCalledWith([]);
    });
  });

  it('browse mode renders the FilterPanel', async () => {
    await renderPage();
    await expect.element(page.getByTestId('filter-panel')).toBeInTheDocument();
  });

  it('does not render the FilterPanel while a browse selection is active', async () => {
    mockAssetMultiSelectManager.selectionActive = true;
    await renderPage();
    await expect.element(page.getByTestId('filter-panel')).not.toBeInTheDocument();
  });

  it('browseOptions carry filter fields once a browse filter is set', async () => {
    await renderPage({ album: makeAlbum({ id: 'album-1' }) });
    await userEvent.click(page.getByTestId('filter-panel-add-person'));
    await vi.waitFor(() => {
      const options = JSON.parse(page.getByTestId('timeline-options').element().textContent ?? '{}');
      expect(options.personIds).toEqual(['person-1']);
    });
  });

  it('shows ActiveFiltersBar only when a browse filter is active', async () => {
    await renderPage();
    await expect.element(page.getByTestId('active-filters-bar')).not.toBeInTheDocument();
    await userEvent.click(page.getByTestId('filter-panel-add-person'));
    await expect.element(page.getByTestId('active-filters-bar')).toBeInTheDocument();
  });

  it('wires the add-all-to-collection handler into the browse ActiveFiltersBar', async () => {
    await renderPage();
    await userEvent.click(page.getByTestId('filter-panel-add-person'));
    await expect.element(page.getByTestId('active-filters-bar')).toBeInTheDocument();
    const bar = page.getByTestId('active-filters-bar').element() as HTMLElement;
    expect(bar).toHaveAttribute('data-has-add-all', 'true');
  });

  it('browse: when filtered to empty, the filtered-empty block replaces the timeline; clear restores it', async () => {
    setMockTimelineEmpty();
    await renderPage();
    await userEvent.click(page.getByTestId('filter-panel-add-person'));
    await expect.element(page.getByTestId('browse-filtered-empty')).toBeInTheDocument();
    await expect.element(page.getByTestId('space-album-timeline')).not.toBeInTheDocument();
    await userEvent.click(page.getByTestId('browse-clear-filters'));
    await expect.element(page.getByTestId('browse-filtered-empty')).not.toBeInTheDocument();
    await expect.element(page.getByTestId('space-album-timeline')).toBeInTheDocument();
  });

  it('browse: the FilterPanel is hidden when the album is genuinely empty (no assets, no filters)', async () => {
    setMockTimelineEmpty();
    await renderPage();
    await vi.waitFor(() => expect(page.getByTestId('filter-panel').element().dataset.hidden).toBe('true'));
  });

  it('browse: the FilterPanel stays visible when filtered to empty (so it can be cleared)', async () => {
    setMockTimelineEmpty();
    await renderPage();
    await userEvent.click(page.getByTestId('filter-panel-add-person'));
    await vi.waitFor(() => expect(page.getByTestId('filter-panel').element().dataset.hidden).toBe('false'));
  });

  it('browse: removing the temporal chip clears the temporal filter (ActiveFiltersBar disappears)', async () => {
    await renderPage();
    await userEvent.click(page.getByTestId('filter-panel-add-year'));
    await expect.element(page.getByTestId('active-filters-bar')).toBeInTheDocument();
    await userEvent.click(page.getByTestId('active-filters-remove-timeline'));
    await expect.element(page.getByTestId('active-filters-bar')).not.toBeInTheDocument();
  });

  it('browse: clear-all in ActiveFiltersBar removes all filters', async () => {
    await renderPage();
    await userEvent.click(page.getByTestId('filter-panel-add-person'));
    await expect.element(page.getByTestId('active-filters-bar')).toBeInTheDocument();
    await userEvent.click(page.getByTestId('active-filters-clear-all'));
    await expect.element(page.getByTestId('active-filters-bar')).not.toBeInTheDocument();
  });

  it('add mode renders the picker FilterPanel', async () => {
    await renderPage({ members: [makeMember(SharedSpaceRole.Editor)], album: makeAlbum({ id: 'album-1' }) });
    await userEvent.click(page.getByTestId('add-photos-button'));
    await expect.element(page.getByTestId('filter-panel')).toBeInTheDocument();
  });

  it('pickerOptions carry filter fields once a picker filter is set, and show ActiveFiltersBar', async () => {
    await renderPage({ members: [makeMember(SharedSpaceRole.Editor)], album: makeAlbum({ id: 'album-1' }) });
    await userEvent.click(page.getByTestId('add-photos-button'));
    await userEvent.click(page.getByTestId('filter-panel-add-person'));
    await vi.waitFor(() => {
      const options = JSON.parse(page.getByTestId('timeline-options').element().textContent ?? '{}');
      expect(options.personIds).toEqual(['person-1']);
      expect(options.timelineAlbumId).toBe('album-1');
    });
    await expect.element(page.getByTestId('active-filters-bar')).toBeInTheDocument();
  });

  it('add mode: filtered-empty replaces the picker timeline; clear restores it', async () => {
    setMockTimelineEmpty();
    await renderPage({ members: [makeMember(SharedSpaceRole.Editor)], album: makeAlbum({ id: 'album-1' }) });
    await userEvent.click(page.getByTestId('add-photos-button'));
    await userEvent.click(page.getByTestId('filter-panel-add-person'));
    await expect.element(page.getByTestId('picker-filtered-empty')).toBeInTheDocument();
    await expect.element(page.getByTestId('space-album-timeline')).not.toBeInTheDocument();
    await userEvent.click(page.getByTestId('picker-clear-filters'));
    await expect.element(page.getByTestId('picker-filtered-empty')).not.toBeInTheDocument();
    await expect.element(page.getByTestId('space-album-timeline')).toBeInTheDocument();
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

    await renderPage({ members: [makeMember(SharedSpaceRole.Editor)], album: makeAlbum({ id: 'album-1' }) });

    // Enter add mode and set a picker filter.
    await userEvent.click(page.getByTestId('add-photos-button'));
    await expect.element(page.getByTestId('space-album-timeline')).toHaveAttribute('data-mode', 'add');
    await userEvent.click(page.getByTestId('filter-panel-add-person'));
    await expect.element(page.getByTestId('active-filters-bar')).toBeInTheDocument();

    // Fire the AddAssets action — same mechanism as the existing test.
    const addAssetsButton = page.getByRole('button', { name: /add assets/i }).element() as HTMLElement;
    await userEvent.click(addAssetsButton);

    // handleAddAssetsSuccess runs: calls onAction, refreshes album, resets picker filters, returns to browse.
    await vi.waitFor(() => {
      expect(getAlbumInfo).toHaveBeenCalledWith(expect.objectContaining({ id: 'album-1' }), expect.anything());
    });
    // After returning to browse, the picker filters must be cleared → no active-filters-bar.
    await expect.element(page.getByTestId('active-filters-bar')).not.toBeInTheDocument();
  });

  it('entering add mode starts with no active picker filters even if browse was filtered', async () => {
    await renderPage({ members: [makeMember(SharedSpaceRole.Editor)], album: makeAlbum({ id: 'album-1' }) });
    await userEvent.click(page.getByTestId('filter-panel-add-person'));
    await expect.element(page.getByTestId('active-filters-bar')).toBeInTheDocument();
    await userEvent.click(page.getByTestId('add-photos-button'));
    await expect.element(page.getByTestId('add-photos-overlay')).toBeInTheDocument();
    await expect.element(page.getByTestId('active-filters-bar')).not.toBeInTheDocument();
  });

  it('add mode: the picker FilterPanel is hidden when there are no photos to add and no filters', async () => {
    setMockTimelineEmpty();
    await renderPage({ members: [makeMember(SharedSpaceRole.Editor)], album: makeAlbum({ id: 'album-1' }) });
    await userEvent.click(page.getByTestId('add-photos-button'));
    await vi.waitFor(() => expect(page.getByTestId('filter-panel').element().dataset.hidden).toBe('true'));
  });

  it('add mode: the picker FilterPanel stays visible when filtered to empty', async () => {
    setMockTimelineEmpty();
    await renderPage({ members: [makeMember(SharedSpaceRole.Editor)], album: makeAlbum({ id: 'album-1' }) });
    await userEvent.click(page.getByTestId('add-photos-button'));
    await userEvent.click(page.getByTestId('filter-panel-add-person'));
    await vi.waitFor(() => expect(page.getByTestId('filter-panel').element().dataset.hidden).toBe('false'));
  });

  // ── empty-add-photos-button gating ──────────────────────────────────────────

  it('empty-add-photos-button is present for a space editor (empty album)', async () => {
    setMockTimelineEmpty();
    await renderPage({ members: [makeMember(SharedSpaceRole.Editor)] });
    await expect.element(page.getByTestId('empty-add-photos-button')).toBeInTheDocument();
  });

  it('empty-add-photos-button is absent for a space viewer with album-viewer role', async () => {
    setMockTimelineEmpty();
    await renderPage({
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
    await expect.element(page.getByTestId('empty-add-photos-button')).not.toBeInTheDocument();
  });

  // ── header add-photos-button role-combo coverage ─────────────────────────────

  it('space=Editor + album role=Viewer: add-photos-button present (canManage via isSpaceEditor)', async () => {
    await renderPage({
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
    await expect.element(page.getByTestId('add-photos-button')).toBeInTheDocument();
  });

  it('space=Viewer + album role=Owner: add-photos-button present (canManage via isAlbumEditor)', async () => {
    await renderPage({
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
    await expect.element(page.getByTestId('add-photos-button')).toBeInTheDocument();
  });

  // ── RemoveFromAlbum gating — additional role combos ──────────────────────────

  it('space=Viewer + album=Editor + selection active: RemoveFromAlbum is present', async () => {
    mockAssetMultiSelectManager.selectionActive = true;
    await renderPage({
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
    await expect.element(page.getByText('Remove from album')).toBeInTheDocument();
  });

  it('space=Owner + default album + selection active: RemoveFromAlbum is present', async () => {
    mockAssetMultiSelectManager.selectionActive = true;
    await renderPage({ members: [makeMember(SharedSpaceRole.Owner)] });
    await openOverflowMenu();
    await expect.element(page.getByText('Remove from album')).toBeInTheDocument();
  });

  // Slice 6 — rbac-5/albums-8 REVERSED: the browse control bar now renders the full
  // album-equivalent <SelectionToolbar> (see the +page.svelte control-bar comment for the RBAC
  // reasoning) instead of the stripped Download+Remove-only bar it originally shipped with.
  // `canRemoveFromAlbum` stays `canManage`-gated (ownership grants nothing — decision C), while
  // the metadata-edit affordances (Archive/ChangeDate/ChangeLocation/Delete/…) and Share/
  // Add-to-album are gated independently on `isAllUserOwned` — the same two
  // independent axes the merged direct-space timeline and SelectionToolbar.spec.ts encode.
  // Favorite is NOT on either axis (#763): it writes a per-user `asset_favorite` row rather than
  // mutating the asset, so `canFavorite` is unconditionally true and the heart shows for every
  // selection any viewer can see.
  describe('Slice 6: full album-equivalent toolbar (reversal of the stripped bar)', () => {
    it('manager + all-owned selection: Download + RemoveFromAlbum + metadata-edit + Set-cover all present', async () => {
      mockAssetMultiSelectManager.selectionActive = true;
      mockAssetMultiSelectManager.isAllUserOwned = true;
      mockAssetMultiSelectManager.assets = [{ id: 'asset-1' }];
      await renderPage({ members: [makeMember(SharedSpaceRole.Editor)] });

      await expect.element(page.getByRole('button', { name: 'Share' })).toBeInTheDocument();
      await expect.element(page.getByRole('button', { name: 'Add to album or space' })).toBeInTheDocument();
      await expect.element(page.getByRole('button', { name: /favorite/i })).toBeInTheDocument();

      await openOverflowMenu();
      await expect.element(page.getByTestId('download-action')).toBeInTheDocument();
      await expect.element(page.getByText('Remove from album')).toBeInTheDocument();
      await expect.element(page.getByRole('menuitem', { name: 'Change date' })).toBeInTheDocument();
      await expect.element(page.getByRole('menuitem', { name: 'Change location' })).toBeInTheDocument();
      await expect.element(page.getByRole('menuitem', { name: 'Archive' })).toBeInTheDocument();
      await expect.element(page.getByRole('menuitem', { name: 'Delete' })).toBeInTheDocument();
      await expect.element(page.getByRole('menuitem', { name: 'Set as album cover' })).toBeInTheDocument();
    });

    it('manager + NOT-owned selection: RemoveFromAlbum + Set-cover + Add-to-album + Share (canManage/space-role-gated) + Favorite (per-user) present, metadata-edit + Delete absent (ownership-gated)', async () => {
      mockAssetMultiSelectManager.selectionActive = true;
      mockAssetMultiSelectManager.isAllUserOwned = false;
      mockAssetMultiSelectManager.assets = [{ id: 'asset-1' }];
      await renderPage({ members: [makeMember(SharedSpaceRole.Editor)] });

      // A space Editor may also publish non-owned assets through the space (#1018), so Share
      // stays — the link is created against the space and warns before it is made.
      await expect.element(page.getByRole('button', { name: 'Share' })).toBeInTheDocument();
      // A space Editor may contribute non-owned assets into an album linked to this space
      // (#764), so the "+" stays — it opens the picker restricted to that space's albums.
      await expect.element(page.getByRole('button', { name: 'Add to album or space' })).toBeInTheDocument();
      // #763: favoriting writes a per-user `asset_favorite` row, so it is not ownership-gated —
      // the heart stays for a non-owned selection.
      await expect.element(page.getByRole('button', { name: /favorite/i })).toBeInTheDocument();

      await openOverflowMenu();
      await expect.element(page.getByTestId('download-action')).toBeInTheDocument();
      // canRemoveFromAlbum / canSetCover key off canManage (space.canWrite || album.isEditor),
      // NOT ownership — both stay visible even though the selection isn't owned.
      await expect.element(page.getByText('Remove from album')).toBeInTheDocument();
      await expect.element(page.getByRole('menuitem', { name: 'Set as album cover' })).toBeInTheDocument();
      // Ownership-gated actions are hidden regardless of manager status.
      await expect.element(page.getByRole('menuitem', { name: 'Change date' })).not.toBeInTheDocument();
      await expect.element(page.getByRole('menuitem', { name: 'Archive' })).not.toBeInTheDocument();
      await expect.element(page.getByRole('menuitem', { name: 'Delete' })).not.toBeInTheDocument();
    });

    it('non-manager (viewer) + all-owned selection: metadata-edit affordances present, RemoveFromAlbum + Set-cover absent', async () => {
      mockAssetMultiSelectManager.selectionActive = true;
      mockAssetMultiSelectManager.isAllUserOwned = true;
      mockAssetMultiSelectManager.assets = [{ id: 'asset-1' }];
      await renderPage({
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

      await expect.element(page.getByRole('button', { name: 'Share' })).toBeInTheDocument();
      await expect.element(page.getByRole('button', { name: 'Add to album or space' })).toBeInTheDocument();
      await expect.element(page.getByRole('button', { name: /favorite/i })).toBeInTheDocument();

      await openOverflowMenu();
      await expect.element(page.getByTestId('download-action')).toBeInTheDocument();
      await expect.element(page.getByRole('menuitem', { name: 'Change date' })).toBeInTheDocument();
      await expect.element(page.getByRole('menuitem', { name: 'Archive' })).toBeInTheDocument();
      await expect.element(page.getByRole('menuitem', { name: 'Delete' })).toBeInTheDocument();

      // canManage is false for a plain album/space Viewer — Remove and Set-cover stay hidden
      // even though the selection is entirely their own.
      await expect.element(page.getByText('Remove from album')).not.toBeInTheDocument();
      await expect.element(page.getByRole('menuitem', { name: 'Set as album cover' })).not.toBeInTheDocument();
    });

    it('non-manager (viewer) + NOT-owned selection: only Select-all, Favorite and Download are shown', async () => {
      mockAssetMultiSelectManager.selectionActive = true;
      mockAssetMultiSelectManager.isAllUserOwned = false;
      mockAssetMultiSelectManager.assets = [{ id: 'asset-1' }];
      await renderPage({
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

      await expect.element(page.getByRole('button', { name: 'Select all' })).toBeInTheDocument();
      await expect.element(page.getByRole('button', { name: 'Share' })).not.toBeInTheDocument();
      await expect.element(page.getByRole('button', { name: 'Add to album or space' })).not.toBeInTheDocument();
      // #763: favoriting is a per-user overlay write available to anyone who can see the asset,
      // so even a read-only space viewer gets the heart on a non-owned selection.
      await expect.element(page.getByRole('button', { name: /favorite/i })).toBeInTheDocument();

      await openOverflowMenu();
      await expect.element(page.getByTestId('download-action')).toBeInTheDocument();
      await expect.element(page.getByText('Remove from album')).not.toBeInTheDocument();
      await expect.element(page.getByRole('menuitem', { name: 'Delete' })).not.toBeInTheDocument();
      await expect.element(page.getByRole('menuitem', { name: 'Set as album cover' })).not.toBeInTheDocument();
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
      const { rerender } = await renderPage({ album: makeAlbum({ id: 'album-1', albumName: 'Vacation 2025' }) });

      expect(JSON.parse(page.getByTestId('timeline-options').element().textContent ?? '{}').albumId).toBe('album-1');

      await rerender(rerenderWith(makeAlbum({ id: 'album-2', albumName: 'Birthday Party' })));

      expect(JSON.parse(page.getByTestId('timeline-options').element().textContent ?? '{}').albumId).toBe('album-2');
    });

    it('re-evaluates album-derived permissions for the newly navigated album', async () => {
      // Space viewer, so the manage gate falls through to the per-album role: owned album-1 keeps
      // "Add photos", viewer-only album-2 must not. A stale album leaves the button wrongly shown.
      const viewerOnly = [makeMember(SharedSpaceRole.Viewer)];
      const { rerender } = await renderPage({
        album: albumWithRole('album-1', AlbumUserRole.Owner),
        members: viewerOnly,
      });

      await expect.element(page.getByTestId('add-photos-button')).toBeInTheDocument();

      await rerender(rerenderWith(albumWithRole('album-2', AlbumUserRole.Viewer), viewerOnly));

      await expect.element(page.getByTestId('add-photos-button')).not.toBeInTheDocument();
    });

    it('drops the previous album filters instead of carrying them onto the new album', async () => {
      const { rerender } = await renderPage({ album: makeAlbum({ id: 'album-1' }) });

      await userEvent.click(page.getByTestId('filter-panel-add-person'));
      await vi.waitFor(() => {
        const options = JSON.parse(page.getByTestId('timeline-options').element().textContent ?? '{}');
        expect(options.personIds).toEqual(['person-1']);
      });

      await rerender(rerenderWith(makeAlbum({ id: 'album-2' })));

      const options = JSON.parse(page.getByTestId('timeline-options').element().textContent ?? '{}');
      expect(options.albumId).toBe('album-2');
      expect(options.personIds).toBeUndefined();
    });

    it('returns to browse mode when navigating away from the add-photos picker', async () => {
      const { rerender } = await renderPage({ album: makeAlbum({ id: 'album-1' }) });

      await userEvent.click(page.getByTestId('add-photos-button'));
      await expect.element(page.getByTestId('space-album-timeline')).toHaveAttribute('data-mode', 'add');

      await rerender(rerenderWith(makeAlbum({ id: 'album-2' })));

      await expect.element(page.getByTestId('space-album-timeline')).toHaveAttribute('data-mode', 'browse');
    });
  });

  // #986: searching from inside a space album used to bounce the user to /photos and run the query
  // against their whole library. The album is a searchable page now, so the query runs in place,
  // scoped to the album.
  describe('page-aware search', () => {
    const rerenderWith = (album: AlbumResponseDto) => ({
      component: SpaceAlbumDetailPage,
      componentProps: { data: makePageData(album) },
    });

    it('runs the search in place instead of showing the browse timeline', async () => {
      mockPage.reset('https://gallery.test/spaces/space-1/albums/album-1?q=beach');

      await renderPage();

      await expect.element(page.getByTestId('smart-search-results')).toHaveAttribute('data-search-query', 'beach');
      await expect.element(page.getByTestId('space-album-timeline')).not.toBeInTheDocument();
    });

    it('scopes the search to the album it was launched from', async () => {
      mockPage.reset('https://gallery.test/spaces/space-1/albums/album-1?q=beach');

      await renderPage({ album: makeAlbum({ id: 'album-1' }) });

      await expect.element(page.getByTestId('smart-search-results')).toHaveAttribute('data-album-ids', 'album-1');
    });

    // A space album is scoped by its album, not by its space: sending spaceId as well would make the
    // server drop the space gate in favour of the caller's full timeline-space set (database.ts).
    it('does not send a space scope alongside the album scope', async () => {
      mockPage.reset('https://gallery.test/spaces/space-1/albums/album-1?q=beach');

      await renderPage();

      await expect.element(page.getByTestId('smart-search-results')).toHaveAttribute('data-space-id', '');
    });

    it('shows the browse timeline when there is no query', async () => {
      await renderPage();

      await expect.element(page.getByTestId('space-album-timeline')).toBeInTheDocument();
      await expect.element(page.getByTestId('smart-search-results')).not.toBeInTheDocument();
    });

    it('hydrates filters from the URL into the search', async () => {
      mockPage.reset('https://gallery.test/spaces/space-1/albums/album-1?q=beach&city=Berlin&type=video');

      await renderPage();

      await expect.element(page.getByTestId('smart-search-results')).toHaveAttribute('data-filter-city', 'Berlin');
      await expect.element(page.getByTestId('smart-search-results')).toHaveAttribute('data-filter-media-type', 'video');
    });

    it('hydrates filters from the URL into the browse timeline', async () => {
      mockPage.reset('https://gallery.test/spaces/space-1/albums/album-1?city=Berlin');

      await renderPage();

      const options = JSON.parse(page.getByTestId('timeline-options').element().textContent ?? '{}');
      expect(options.city).toBe('Berlin');
    });

    it('carries an explicit sort into the search', async () => {
      mockPage.reset('https://gallery.test/spaces/space-1/albums/album-1?q=beach&sort=asc');

      await renderPage();

      await expect.element(page.getByTestId('smart-search-results')).toHaveAttribute('data-sort-order', 'asc');
    });

    // The navbar sort dropdown appears on every searchable page, browse mode included. Ignoring the
    // param there would leave a control that visibly does nothing.
    it('lets an explicit sort override the album order in browse mode', async () => {
      mockPage.reset('https://gallery.test/spaces/space-1/albums/album-1?sort=asc');

      await renderPage({ album: makeAlbum({ order: AssetOrder.Desc }) });

      expect(JSON.parse(page.getByTestId('timeline-options').element().textContent ?? '{}').order).toBe(AssetOrder.Asc);
    });

    it("keeps the album's own order in browse mode when the URL carries no sort", async () => {
      await renderPage({ album: makeAlbum({ order: AssetOrder.Asc }) });

      expect(JSON.parse(page.getByTestId('timeline-options').element().textContent ?? '{}').order).toBe(AssetOrder.Asc);
    });

    it('writes a filter change back to the URL', async () => {
      await renderPage();

      await userEvent.click(page.getByTestId('filter-panel-add-person'));

      await vi.waitFor(() =>
        expect(goto).toHaveBeenCalledWith(
          '/spaces/space-1/albums/album-1?people=person-1',
          expect.objectContaining({ replace: true }),
        ),
      );
    });

    it('keeps the query in the URL when a filter changes during a search', async () => {
      mockPage.reset('https://gallery.test/spaces/space-1/albums/album-1?q=beach');

      await renderPage();

      await userEvent.click(page.getByTestId('filter-panel-add-person'));

      await vi.waitFor(() =>
        expect(goto).toHaveBeenCalledWith(
          expect.stringContaining('q=beach'),
          expect.objectContaining({ replace: true }),
        ),
      );
    });

    it('re-hydrates when the URL changes under it (back/forward, shared link)', async () => {
      await renderPage();

      await expect.element(page.getByTestId('space-album-timeline')).toBeInTheDocument();

      mockPage.url = new URL('https://gallery.test/spaces/space-1/albums/album-1?q=sunset');

      await expect.element(page.getByTestId('smart-search-results')).toHaveAttribute('data-search-query', 'sunset');
    });

    const facetsWith = (people: Array<{ id: string; name: string }> = []) =>
      ({
        total: 7,
        timeBuckets: [{ timeBucket: '2025-06-01', count: 7 }],
        countries: [],
        cities: [],
        cameraMakes: [],
        cameraModels: [],
        tags: [],
        people,
        ratings: [],
        mediaTypes: [],
        hasUnnamedPeople: false,
      }) as never;

    // The panel's suggestions must come from the SEARCH in query mode, not the album's own
    // suggestion endpoint — otherwise it offers facets the visible results do not contain.
    it('sources the filter panel options from the search facets while a query is running', async () => {
      mockPage.reset('https://gallery.test/spaces/space-1/albums/album-1?q=beach');
      vi.mocked(searchSmartFacets).mockResolvedValue(facetsWith([{ id: 'facet-person', name: 'Facet Person' }]));

      await renderPage();

      await expect.element(page.getByTestId('filter-panel-suggested-person-facet-person')).toBeInTheDocument();
      expect(vi.mocked(getFilterSuggestions)).not.toHaveBeenCalled();
    });

    it('feeds the search facet time buckets to the filter panel instead of the album buckets', async () => {
      mockPage.reset('https://gallery.test/spaces/space-1/albums/album-1?q=beach');
      vi.mocked(searchSmartFacets).mockResolvedValue(facetsWith());

      await renderPage();

      await expect.element(page.getByTestId('filter-panel')).toHaveAttribute('data-time-buckets', '2025-06-01');
    });

    it('shows the search total rather than the browse count', async () => {
      mockPage.reset('https://gallery.test/spaces/space-1/albums/album-1?q=beach');
      vi.mocked(searchSmartFacets).mockResolvedValue(facetsWith());

      await renderPage();

      await expect.element(page.getByTestId('active-filters-bar')).toHaveAttribute('data-result-count', '7');
    });

    it('clears the query from the URL when the search chip is dismissed', async () => {
      mockPage.reset('https://gallery.test/spaces/space-1/albums/album-1?q=beach');
      vi.mocked(searchSmartFacets).mockResolvedValue(facetsWith());

      await renderPage();

      await userEvent.click(page.getByTestId('active-filters-clear-search'));

      await vi.waitFor(() => {
        const [target] = vi.mocked(goto).mock.calls.at(-1) as [string];
        expect(target).not.toContain('q=beach');
      });
    });

    // The filters are URL-backed now, so removing a chip has to write the URL too — otherwise the
    // param survives and a refresh restores the filter the user just removed.
    it('writes temporal chip removal back to the URL', async () => {
      mockPage.reset('https://gallery.test/spaces/space-1/albums/album-1?year=2025');

      await renderPage();

      await userEvent.click(page.getByTestId('active-filters-remove-timeline'));

      await vi.waitFor(() => {
        const [target] = vi.mocked(goto).mock.calls.at(-1) as [string];
        expect(target).not.toContain('year=2025');
      });
    });

    it('writes a filtered-empty "clear all filters" back to the URL', async () => {
      mockPage.reset('https://gallery.test/spaces/space-1/albums/album-1?city=Berlin');
      setMockTimelineEmpty();

      await renderPage();

      await userEvent.click(page.getByTestId('browse-clear-filters'));

      await vi.waitFor(() => {
        const [target] = vi.mocked(goto).mock.calls.at(-1) as [string];
        expect(target).not.toContain('city=Berlin');
      });
    });

    it('re-scopes the search when navigating straight to a sibling album', async () => {
      mockPage.reset('https://gallery.test/spaces/space-1/albums/album-1?q=beach');

      const { rerender } = await renderPage({ album: makeAlbum({ id: 'album-1' }) });

      await expect.element(page.getByTestId('smart-search-results')).toHaveAttribute('data-album-ids', 'album-1');

      mockPage.url = new URL('https://gallery.test/spaces/space-1/albums/album-2?q=beach');
      await rerender(rerenderWith(makeAlbum({ id: 'album-2' })));

      await expect.element(page.getByTestId('smart-search-results')).toHaveAttribute('data-album-ids', 'album-2');
    });
  });
});
