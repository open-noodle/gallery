import type { AlbumResponseDto, AssetVisibility as AssetVisibilityType } from '@immich/sdk';
import { AlbumUserRole, AssetVisibility } from '@immich/sdk';
import { render, screen } from '@testing-library/svelte';
import type { Component } from 'svelte';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import TestWrapper from '$lib/components/TestWrapper.svelte';
import type { AssetMultiSelectManager } from '$lib/managers/asset-multi-select-manager.svelte';
import type { TimelineManager } from '$lib/managers/timeline-manager/timeline-manager.svelte';
import type { TimelineAsset } from '$lib/managers/timeline-manager/types';
import type { TimelineDateTime } from '$lib/utils/timeline-util';
import SelectionToolbar from './SelectionToolbar.svelte';

// Mirrors the (unexported) Props interface declared inside SelectionToolbar.svelte —
// just enough shape for this spec file's own type-checking of test fixtures.
interface ToolbarTestProps {
  timelineManager: TimelineManager;
  assetInteraction: AssetMultiSelectManager;
  album?: AlbumResponseDto;
  space?: { id: string; canWrite: boolean };
  downloadFilename?: string;
  onRemove?: (assetIds: string[]) => void;
  onSetCover?: () => void;
  onFavorite?: (ids: string[], isFavorite: boolean) => void;
  onArchive?: (ids: string[], visibility: AssetVisibilityType) => void;
  onAssetDelete?: (assetIds: string[]) => void;
}

// ---------------------------------------------------------------------------
// Mocks — the two singletons SelectionToolbar (or a component it renders)
// reads eagerly at render time. Every leaf action component is rendered for
// real (per the task's "PREFER real rendering" guidance): none of them read
// a problematic singleton at render time EXCEPT DeleteAssetsAction, which
// derives `force` from `featureFlagsManager.value.trash` — that getter
// throws until initialized, so it must be mocked. `authManager` is read
// directly by SelectionToolbar itself to build the CommandContext.
// ---------------------------------------------------------------------------

const { mockUser, mockPreferences } = vi.hoisted(() => ({
  mockUser: { current: { id: 'me', isAdmin: false } as { id: string; isAdmin: boolean } | null },
  mockPreferences: { current: { tags: { enabled: true } } },
}));

vi.mock('$lib/managers/auth-manager.svelte', () => ({
  authManager: {
    get authenticated() {
      return mockUser.current !== null;
    },
    get user() {
      return mockUser.current;
    },
    get preferences() {
      return mockPreferences.current;
    },
  },
}));

vi.mock('$lib/managers/feature-flags-manager.svelte', () => ({
  featureFlagsManager: {
    value: { trash: true },
  },
}));

const dateTime: TimelineDateTime = { year: 2024, month: 1, day: 1, hour: 0, minute: 0, second: 0, millisecond: 0 };

function makeAsset(overrides: Partial<TimelineAsset> = {}): TimelineAsset {
  return {
    id: 'asset-1',
    ownerId: 'me',
    ratio: 1,
    thumbhash: null,
    localDateTime: dateTime,
    createdAt: dateTime,
    fileCreatedAt: dateTime,
    visibility: AssetVisibility.Timeline,
    isFavorite: false,
    isTrashed: false,
    isVideo: false,
    isImage: true,
    stack: null,
    duration: null,
    projectionType: null,
    livePhotoVideoId: null,
    city: null,
    country: null,
    people: null,
    ...overrides,
  };
}

type FakeAssetInteraction = Pick<
  AssetMultiSelectManager,
  'selectionActive' | 'assets' | 'ownedAssets' | 'isAllUserOwned' | 'isAllFavorite' | 'isAllArchived' | 'selectAll'
> & { clear: () => void };

/**
 * `ownedAssets` defaults to the real manager's rule — the assets whose `ownerId` is the
 * logged-in user — so a fixture cannot accidentally disagree with its own `assets` list.
 */
function makeAssetInteraction(overrides: Partial<FakeAssetInteraction> = {}): AssetMultiSelectManager {
  const assets = overrides.assets ?? [makeAsset()];
  const base: FakeAssetInteraction = {
    selectionActive: true,
    assets,
    ownedAssets: assets.filter((asset) => asset.ownerId === mockUser.current?.id),
    isAllUserOwned: true,
    isAllFavorite: false,
    isAllArchived: false,
    selectAll: false,
    clear: () => {},
    ...overrides,
  };
  return base as unknown as AssetMultiSelectManager;
}

// `overrides` is deliberately loose (not Partial<AlbumResponseDto>) — fixtures only ever
// need to override a couple of fields (e.g. albumUsers with minimal {id}-only users), and
// AlbumResponseDto's nested UserResponseDto is not worth reproducing in full here.
function makeAlbum(overrides: Record<string, unknown> = {}): AlbumResponseDto {
  return {
    id: 'album-1',
    albumName: 'Album',
    albumUsers: [{ user: { id: 'owner-1' }, role: AlbumUserRole.Owner }],
    ...overrides,
  } as unknown as AlbumResponseDto;
}

const fakeTimelineManager = {} as unknown as TimelineManager;

// SelectionToolbar renders real @immich/ui IconButtons, which resolve a
// bits-ui Tooltip against a "Tooltip.Provider" context. TestWrapper supplies
// it (see other *.spec.ts files rendering real IconButton-based trees).
function renderToolbar(props: ToolbarTestProps) {
  return render(TestWrapper as Component<{ component: typeof SelectionToolbar; componentProps: typeof props }>, {
    component: SelectionToolbar,
    componentProps: props,
  });
}

beforeEach(() => {
  mockUser.current = { id: 'me', isAdmin: false };
  mockPreferences.current = { tags: { enabled: true } };
});

describe('SelectionToolbar', () => {
  it("Given a space viewer browsing another member's asset in a direct space, When the toolbar renders, Then only Select-all and Download are shown", () => {
    renderToolbar({
      timelineManager: fakeTimelineManager,
      assetInteraction: makeAssetInteraction({
        isAllUserOwned: false,
        assets: [makeAsset({ id: 'asset-1', ownerId: 'other' })],
      }),
      space: { id: 'space-1', canWrite: false },
    });

    expect(screen.getByLabelText('select_all')).toBeInTheDocument();
    expect(screen.getByRole('menuitem', { name: 'download' })).toBeInTheDocument();

    expect(screen.queryByLabelText('share')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('add_to_album_or_space')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('to_favorite')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('remove_from_favorites')).not.toBeInTheDocument();
    expect(screen.queryByRole('menuitem', { name: 'delete' })).not.toBeInTheDocument();
    expect(screen.queryByLabelText('remove_from_space')).not.toBeInTheDocument();
    expect(screen.queryByRole('menuitem', { name: 'set_as_space_cover' })).not.toBeInTheDocument();
    expect(screen.queryByRole('menuitem', { name: 'set_as_album_cover' })).not.toBeInTheDocument();
  });

  it('Given a space editor selecting their own single asset in a direct space, When the toolbar renders, Then Share/Add-to-album/Favorite/Delete/Remove-from-space/Cover are all shown', () => {
    renderToolbar({
      timelineManager: fakeTimelineManager,
      assetInteraction: makeAssetInteraction({
        isAllUserOwned: true,
        assets: [makeAsset({ id: 'asset-1', ownerId: 'me' })],
      }),
      space: { id: 'space-1', canWrite: true },
      onSetCover: vi.fn(),
      onRemove: vi.fn(),
      onFavorite: vi.fn(),
      onArchive: vi.fn(),
      onAssetDelete: vi.fn(),
    });

    expect(screen.getByLabelText('select_all')).toBeInTheDocument();
    expect(screen.getByRole('menuitem', { name: 'download' })).toBeInTheDocument();
    expect(screen.getByLabelText('share')).toBeInTheDocument();
    expect(screen.getByLabelText('add_to_album_or_space')).toBeInTheDocument();
    expect(screen.getByLabelText('to_favorite')).toBeInTheDocument();
    expect(screen.getByRole('menuitem', { name: 'delete' })).toBeInTheDocument();
    expect(screen.getByLabelText('remove_from_space')).toBeInTheDocument();
    expect(screen.getByRole('menuitem', { name: 'set_as_space_cover' })).toBeInTheDocument();
  });

  it('Given the space-person surface (same editor+own-asset context but no onSetCover passed), When the toolbar renders, Then Cover is absent even though caps.canSetCover is true', () => {
    renderToolbar({
      timelineManager: fakeTimelineManager,
      assetInteraction: makeAssetInteraction({
        isAllUserOwned: true,
        assets: [makeAsset({ id: 'asset-1', ownerId: 'me' })],
      }),
      space: { id: 'space-1', canWrite: true },
      // onSetCover intentionally omitted — mirrors the space-person page, which has no cover action.
      onRemove: vi.fn(),
      onFavorite: vi.fn(),
    });

    expect(screen.getByLabelText('share')).toBeInTheDocument();
    expect(screen.getByLabelText('remove_from_space')).toBeInTheDocument();
    expect(screen.queryByRole('menuitem', { name: 'set_as_space_cover' })).not.toBeInTheDocument();
    expect(screen.queryByRole('menuitem', { name: 'set_as_album_cover' })).not.toBeInTheDocument();
  });

  it('Given a space-album manager viewing a not-owned asset, When the toolbar renders, Then Remove-from-album is shown and Remove-from-space is absent', () => {
    renderToolbar({
      timelineManager: fakeTimelineManager,
      assetInteraction: makeAssetInteraction({
        isAllUserOwned: false,
        assets: [makeAsset({ id: 'asset-1', ownerId: 'other' })],
      }),
      album: makeAlbum({ albumUsers: [{ user: { id: 'owner-1' }, role: AlbumUserRole.Owner }] }),
      space: { id: 'space-1', canWrite: true },
      onRemove: vi.fn(),
    });

    expect(screen.getByLabelText('select_all')).toBeInTheDocument();
    expect(screen.getByRole('menuitem', { name: 'download' })).toBeInTheDocument();
    expect(screen.getByRole('menuitem', { name: 'remove_from_album' })).toBeInTheDocument();
    expect(screen.queryByLabelText('remove_from_space')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('share')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('to_favorite')).not.toBeInTheDocument();
    expect(screen.queryByRole('menuitem', { name: 'delete' })).not.toBeInTheDocument();
  });

  it('Given a space editor with a MIXED selection, When the toolbar renders, Then both Share and Add-to-album are shown', () => {
    renderToolbar({
      timelineManager: fakeTimelineManager,
      assetInteraction: makeAssetInteraction({
        isAllUserOwned: false,
        assets: [makeAsset({ id: 'mine', ownerId: 'me' }), makeAsset({ id: 'theirs', ownerId: 'other' })],
      }),
      space: { id: 'space-1', canWrite: true },
      onRemove: vi.fn(),
    });

    expect(screen.getByLabelText('share')).toBeInTheDocument();
    expect(screen.getByLabelText('add_to_album_or_space')).toBeInTheDocument();
    // Still hidden: these mutate every selected asset and the server refuses the non-owned ones.
    expect(screen.queryByLabelText('to_favorite')).not.toBeInTheDocument();
    expect(screen.queryByRole('menuitem', { name: 'delete' })).not.toBeInTheDocument();
  });

  it("Given a space editor selecting only other members' assets, When the toolbar renders, Then Add-to-album is shown for contribution but Share is not", () => {
    renderToolbar({
      timelineManager: fakeTimelineManager,
      assetInteraction: makeAssetInteraction({
        isAllUserOwned: false,
        assets: [makeAsset({ id: 'theirs', ownerId: 'other' })],
      }),
      space: { id: 'space-1', canWrite: true },
      onRemove: vi.fn(),
    });

    expect(screen.getByLabelText('add_to_album_or_space')).toBeInTheDocument();
    expect(screen.queryByLabelText('share')).not.toBeInTheDocument();
  });

  it('Given a space VIEWER with a mixed selection, When the toolbar renders, Then Share is shown for the owned subset but Add-to-album is not — a viewer cannot contribute', () => {
    renderToolbar({
      timelineManager: fakeTimelineManager,
      assetInteraction: makeAssetInteraction({
        isAllUserOwned: false,
        assets: [makeAsset({ id: 'mine', ownerId: 'me' }), makeAsset({ id: 'theirs', ownerId: 'other' })],
      }),
      space: { id: 'space-1', canWrite: false },
    });

    expect(screen.getByLabelText('share')).toBeInTheDocument();
    expect(screen.queryByLabelText('add_to_album_or_space')).not.toBeInTheDocument();
  });

  it('Given a REGULAR album editor with a mixed selection, When the toolbar renders, Then Add-to-album stays hidden — contribution needs a space link', () => {
    renderToolbar({
      timelineManager: fakeTimelineManager,
      assetInteraction: makeAssetInteraction({
        isAllUserOwned: false,
        assets: [makeAsset({ id: 'mine', ownerId: 'me' }), makeAsset({ id: 'theirs', ownerId: 'other' })],
      }),
      album: makeAlbum({ albumUsers: [{ user: { id: 'me' }, role: AlbumUserRole.Editor }] }),
      onRemove: vi.fn(),
    });

    expect(screen.queryByLabelText('add_to_album_or_space')).not.toBeInTheDocument();
    expect(screen.getByLabelText('share')).toBeInTheDocument();
  });

  it('Given no active selection, When the toolbar renders, Then nothing is rendered', () => {
    const { container } = renderToolbar({
      timelineManager: fakeTimelineManager,
      assetInteraction: makeAssetInteraction({ selectionActive: false, assets: [] }),
    });

    expect(screen.queryByLabelText('menu')).not.toBeInTheDocument();
    expect(container.querySelector('#control-bar')).not.toBeInTheDocument();
  });
});
