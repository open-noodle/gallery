import { commandContextManager } from '#lib/managers/command-context-manager.svelte.ts';
import type { TimelineAsset } from '#lib/managers/timeline-manager/types.ts';
import {
  AlbumUserRole,
  AssetVisibility,
  SharedSpaceRole,
  type AlbumResponseDto,
  type SharedSpaceMemberResponseDto,
  type SharedSpaceResponseDto,
} from '@immich/sdk';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render } from 'vitest-browser-svelte';
import RegisterAlbumContextHarness from './__tests__/register-album-context-harness.svelte';
import RegisterSelectionContextHarness from './__tests__/register-selection-context-harness.svelte';
import RegisterSpaceContextHarness from './__tests__/register-space-context-harness.svelte';

const { mockPage, mockUser } = vi.hoisted(() => ({
  mockPage: { route: { id: null as string | null }, params: {} as Record<string, string> },
  mockUser: { current: null as { id: string; isAdmin: boolean } | null },
}));
vi.mock('$app/state', () => ({ page: mockPage }));
vi.mock('#lib/managers/auth-manager.svelte.js', () => ({
  authManager: {
    get authenticated() {
      return mockUser.current !== null;
    },
    get user() {
      return mockUser.current;
    },
  },
}));

const ALBUM_ROUTE = '/(user)/albums/[albumId=id]/[[photos=photos]]/[[assetId=id]]';
const PHOTOS_ROUTE = '/(user)/photos/[[assetId=id]]';
const SPACE_ROUTE = '/(user)/spaces/[spaceId]/[[photos=photos]]/[[assetId=id]]';

beforeEach(() => {
  commandContextManager.setAlbum(null);
  commandContextManager.setSelection(null);
  commandContextManager.setSpace(null);
  mockUser.current = null;
  mockPage.route.id = null;
  mockPage.params = {};
});

describe('CommandContextManager', () => {
  it('returns null album and space by default', () => {
    const ctx = commandContextManager.getContext();
    expect(ctx.album).toBeNull();
    expect(ctx.space).toBeNull();
  });

  it('round-trips setAlbum / setSpace', () => {
    mockPage.route.id = ALBUM_ROUTE;
    commandContextManager.setAlbum({
      id: 'a1',
      albumName: 'Test',
      ownerId: 'u1',
      isOwner: true,
      isEditor: false,
      isMember: false,
      raw: { id: 'a1', albumName: 'Test', ownerId: 'u1' } as unknown as AlbumResponseDto,
    });
    expect(commandContextManager.getContext().album?.id).toBe('a1');
  });

  it('getContext gates album by route — stored album is hidden on non-album routes', () => {
    commandContextManager.setAlbum({
      id: 'a1',
      albumName: 'Test',
      ownerId: 'u1',
      isOwner: true,
      isEditor: false,
      isMember: false,
      raw: { id: 'a1' } as unknown as AlbumResponseDto,
    });
    mockPage.route.id = SPACE_ROUTE;
    expect(commandContextManager.getContext().album).toBeNull();
    mockPage.route.id = ALBUM_ROUTE;
    expect(commandContextManager.getContext().album?.id).toBe('a1');
  });

  it('getContext gates space by route — stored space is hidden on non-space routes', () => {
    commandContextManager.setSpace({
      id: 's1',
      name: 'Shared',
      createdById: 'u1',
      isOwner: true,
      isMember: true,
      canWrite: true,
      raw: { id: 's1' } as unknown as SharedSpaceResponseDto,
      members: [],
    });
    mockPage.route.id = ALBUM_ROUTE;
    expect(commandContextManager.getContext().space).toBeNull();
    mockPage.route.id = SPACE_ROUTE;
    expect(commandContextManager.getContext().space?.id).toBe('s1');
  });

  it('params is a snapshot — mutation does not leak into next read', () => {
    const ctx1 = commandContextManager.getContext();
    (ctx1.params as Record<string, string>).foo = 'bar';
    const ctx2 = commandContextManager.getContext();
    expect(ctx2.params.foo).toBeUndefined();
  });

  it('userId / isAdmin derive from user store', () => {
    mockUser.current = { id: 'u-me', isAdmin: true };
    const ctx = commandContextManager.getContext();
    expect(ctx.userId).toBe('u-me');
    expect(ctx.isAdmin).toBe(true);
  });
});

const makeAlbumUser = (id: string, role: AlbumUserRole = AlbumUserRole.Owner): AlbumResponseDto['albumUsers'][number] =>
  ({
    user: { id },
    role,
  }) as AlbumResponseDto['albumUsers'][number];

const makeAlbum = (overrides: Partial<AlbumResponseDto> = {}): AlbumResponseDto =>
  ({
    id: 'a1',
    albumName: 'Test',
    albumUsers: [makeAlbumUser('u-owner')],
    ...overrides,
  }) as unknown as AlbumResponseDto;

describe('registerAlbumContext', () => {
  beforeEach(() => {
    mockPage.route.id = ALBUM_ROUTE;
  });

  it('sets album on mount, clears on unmount', async () => {
    mockUser.current = { id: 'u-owner', isAdmin: false };
    const album = makeAlbum();
    const { unmount } = await render(RegisterAlbumContextHarness, { props: { thunk: () => album } });
    expect(commandContextManager.getContext().album?.id).toBe('a1');
    await unmount();
    expect(commandContextManager.getContext().album).toBeNull();
  });

  it('computes isOwner=true when current user matches the owner album user', async () => {
    mockUser.current = { id: 'u-owner', isAdmin: false };
    const { unmount } = await render(RegisterAlbumContextHarness, {
      props: { thunk: () => makeAlbum({ albumUsers: [makeAlbumUser('u-owner')] }) },
    });
    expect(commandContextManager.getContext().album?.isOwner).toBe(true);
    await unmount();
  });

  it('computes isOwner=false when user differs from the owner album user', async () => {
    mockUser.current = { id: 'u-other', isAdmin: false };
    const { unmount } = await render(RegisterAlbumContextHarness, {
      props: { thunk: () => makeAlbum({ albumUsers: [makeAlbumUser('u-owner')] }) },
    });
    expect(commandContextManager.getContext().album?.isOwner).toBe(false);
    await unmount();
  });

  it('treats undefined albumUsers as isMember=false', async () => {
    mockUser.current = { id: 'u-other', isAdmin: false };
    const album = makeAlbum({ albumUsers: undefined });
    const { unmount } = await render(RegisterAlbumContextHarness, { props: { thunk: () => album } });
    expect(commandContextManager.getContext().album?.isMember).toBe(false);
    await unmount();
  });

  it('sets isMember=true when current user is in albumUsers', async () => {
    mockUser.current = { id: 'u-current', isAdmin: false };
    const album = makeAlbum({
      albumUsers: [makeAlbumUser('u-owner'), makeAlbumUser('u-current', AlbumUserRole.Editor)],
    });
    const { unmount } = await render(RegisterAlbumContextHarness, { props: { thunk: () => album } });
    expect(commandContextManager.getContext().album?.isMember).toBe(true);
    await unmount();
  });

  it('exposes raw DTO on context', async () => {
    mockUser.current = { id: 'u-owner', isAdmin: false };
    const album = makeAlbum({ albumName: 'Original' });
    const { unmount } = await render(RegisterAlbumContextHarness, { props: { thunk: () => album } });
    // $state wraps the stored object in a reactive proxy; assert field equality, not identity.
    expect(commandContextManager.getContext().album?.raw.albumName).toBe('Original');
    await unmount();
  });
});

const makeSpace = (overrides: Partial<SharedSpaceResponseDto> = {}): SharedSpaceResponseDto =>
  ({
    id: 's1',
    name: 'Shared',
    createdById: 'u-owner',
    ...overrides,
  }) as unknown as SharedSpaceResponseDto;

const makeAsset = (overrides: Partial<TimelineAsset> = {}): TimelineAsset =>
  ({
    id: 'asset-1',
    ownerId: 'u-me',
    ratio: 1,
    thumbhash: null,
    localDateTime: '2026-01-01T00:00:00.000Z',
    fileCreatedAt: '2026-01-01T00:00:00.000Z',
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
  }) as unknown as TimelineAsset;

const makeMember = (overrides: Partial<SharedSpaceMemberResponseDto> = {}): SharedSpaceMemberResponseDto =>
  ({
    userId: 'u-me',
    email: 'me@test.com',
    name: 'Me',
    joinedAt: '2024-01-01T00:00:00.000Z',
    role: SharedSpaceRole.Editor,
    ...overrides,
  }) as unknown as SharedSpaceMemberResponseDto;

describe('registerSelectionContext', () => {
  beforeEach(() => {
    mockPage.route.id = PHOTOS_ROUTE;
    mockUser.current = { id: 'u-me', isAdmin: false };
  });

  it('returns selection:null when no selection context is registered', () => {
    expect(commandContextManager.getContext().selection).toBeNull();
  });

  it('returns selection:null when getAssets returns an empty array', async () => {
    const { unmount } = await render(RegisterSelectionContextHarness, {
      props: {
        options: {
          getAssets: () => [],
          clearSelection: vi.fn(),
        },
      },
    });

    expect(commandContextManager.getContext().selection).toBeNull();
    await unmount();
  });

  it('builds a live, deduped selection snapshot in selected order', async () => {
    let assets = [
      makeAsset({ id: 'asset-1', ownerId: 'u-me' }),
      makeAsset({ id: 'asset-2', ownerId: 'u-other' }),
      makeAsset({ id: 'asset-1', ownerId: 'u-me' }),
    ];
    const clearSelection = vi.fn();
    const { unmount } = await render(RegisterSelectionContextHarness, {
      props: { options: { getAssets: () => assets, clearSelection } },
    });

    const first = commandContextManager.getContext().selection;
    expect(first?.assets.map((asset) => asset.id)).toEqual(['asset-1', 'asset-2']);
    expect(first?.selectedAssetIds).toEqual(['asset-1', 'asset-2']);
    expect(first?.ownedAssets.map((asset) => asset.id)).toEqual(['asset-1']);
    expect(first?.ownedSelectedAssetIds).toEqual(['asset-1']);
    expect(first?.isAllUserOwned).toBe(false);
    expect(first?.clearSelection).toBe(clearSelection);

    assets = [makeAsset({ id: 'asset-3', ownerId: 'u-me', isFavorite: true })];
    const second = commandContextManager.getContext().selection;
    expect(second?.selectedAssetIds).toEqual(['asset-3']);
    expect(second?.ownedAssets.map((asset) => asset.id)).toEqual(['asset-3']);
    expect(second?.ownedSelectedAssetIds).toEqual(['asset-3']);
    expect(second?.isAllUserOwned).toBe(true);
    expect(second?.isAllFavorite).toBe(true);
    await unmount();
  });

  it('treats all selected assets as unowned without an authenticated user', async () => {
    mockUser.current = null;
    const { unmount } = await render(RegisterSelectionContextHarness, {
      props: {
        options: {
          getAssets: () => [makeAsset({ id: 'asset-1', ownerId: 'u-other' })],
          clearSelection: vi.fn(),
        },
      },
    });

    const selection = commandContextManager.getContext().selection;
    expect(selection?.ownedAssets).toEqual([]);
    expect(selection?.ownedSelectedAssetIds).toEqual([]);
    expect(selection?.isAllUserOwned).toBe(false);
    await unmount();
  });

  it('computes archive/trash/favorite flags from the live assets', async () => {
    let assets = [
      makeAsset({ id: 'asset-1', visibility: AssetVisibility.Archive, isFavorite: true, isTrashed: true }),
      makeAsset({ id: 'asset-2', visibility: AssetVisibility.Archive, isFavorite: true, isTrashed: true }),
    ];
    const { unmount } = await render(RegisterSelectionContextHarness, {
      props: { options: { getAssets: () => assets, clearSelection: vi.fn() } },
    });

    expect(commandContextManager.getContext().selection).toMatchObject({
      isAllFavorite: true,
      isAllArchived: true,
      isAllTrashed: true,
    });

    assets = [makeAsset({ id: 'asset-3', visibility: AssetVisibility.Timeline, isFavorite: false, isTrashed: false })];
    expect(commandContextManager.getContext().selection).toMatchObject({
      isAllFavorite: false,
      isAllArchived: false,
      isAllTrashed: false,
    });
    await unmount();
  });

  it('resolves canAddToAlbum and callbacks through live getters', async () => {
    let canAddToAlbum = false;
    let canAddToSpace = false;
    let favorite = vi.fn();
    const archive = vi.fn();
    const onDelete = vi.fn();
    const onUndoDelete = vi.fn();
    const addSelectedToCurrentSpace = vi.fn().mockResolvedValue(true);

    const { unmount } = await render(RegisterSelectionContextHarness, {
      props: {
        options: {
          getAssets: () => [makeAsset()],
          clearSelection: vi.fn(),
          canAddToAlbum: () => canAddToAlbum,
          canAddToSpace: () => canAddToSpace,
          getOnFavorite: () => favorite,
          getOnArchive: () => archive,
          getOnDelete: () => onDelete,
          getOnUndoDelete: () => onUndoDelete,
          getAddSelectedToCurrentSpace: () => addSelectedToCurrentSpace,
        },
      },
    });

    expect(commandContextManager.getContext().selection?.canAddToAlbum).toBe(false);
    expect(commandContextManager.getContext().selection?.canAddToSpace).toBe(false);
    canAddToAlbum = true;
    canAddToSpace = true;
    expect(commandContextManager.getContext().selection?.canAddToAlbum).toBe(true);
    expect(commandContextManager.getContext().selection?.canAddToSpace).toBe(true);
    expect(commandContextManager.getContext().selection?.onFavorite).toBe(favorite);
    favorite = vi.fn();
    expect(commandContextManager.getContext().selection?.onFavorite).toBe(favorite);
    expect(commandContextManager.getContext().selection?.onArchive).toBe(archive);
    expect(commandContextManager.getContext().selection?.onDelete).toBe(onDelete);
    expect(commandContextManager.getContext().selection?.onUndoDelete).toBe(onUndoDelete);
    expect(commandContextManager.getContext().selection?.addSelectedToCurrentSpace).toBe(addSelectedToCurrentSpace);
    await unmount();
  });

  it('hides a stored selection context after route navigation and restores it on the original route', async () => {
    const { unmount } = await render(RegisterSelectionContextHarness, {
      props: { options: { getAssets: () => [makeAsset()], clearSelection: vi.fn() } },
    });

    expect(commandContextManager.getContext().selection?.selectedAssetIds).toEqual(['asset-1']);
    mockPage.route.id = SPACE_ROUTE;
    expect(commandContextManager.getContext().selection).toBeNull();
    mockPage.route.id = PHOTOS_ROUTE;
    expect(commandContextManager.getContext().selection?.selectedAssetIds).toEqual(['asset-1']);
    await unmount();
  });

  it('clears selection registration on unmount', async () => {
    const { unmount } = await render(RegisterSelectionContextHarness, {
      props: { options: { getAssets: () => [makeAsset()], clearSelection: vi.fn() } },
    });
    expect(commandContextManager.getContext().selection).not.toBeNull();
    await unmount();
    expect(commandContextManager.getContext().selection).toBeNull();
  });

  it('does not let an older registration cleanup clear a newer active registration', async () => {
    const first = await render(RegisterSelectionContextHarness, {
      props: { options: { getAssets: () => [makeAsset({ id: 'asset-1' })], clearSelection: vi.fn() } },
    });
    const second = await render(RegisterSelectionContextHarness, {
      props: { options: { getAssets: () => [makeAsset({ id: 'asset-2' })], clearSelection: vi.fn() } },
    });

    expect(commandContextManager.getContext().selection?.selectedAssetIds).toEqual(['asset-2']);
    await first.unmount();
    expect(commandContextManager.getContext().selection?.selectedAssetIds).toEqual(['asset-2']);
    await second.unmount();
    expect(commandContextManager.getContext().selection).toBeNull();
  });
});

describe('registerSpaceContext', () => {
  beforeEach(() => {
    mockPage.route.id = SPACE_ROUTE;
  });

  it('sets isOwner=true when user is createdById', async () => {
    mockUser.current = { id: 'u-owner', isAdmin: false };
    const space = makeSpace();
    const { unmount } = await render(RegisterSpaceContextHarness, {
      props: { spaceThunk: () => space, membersThunk: () => [] },
    });
    expect(commandContextManager.getContext().space?.isOwner).toBe(true);
    await unmount();
  });

  it('canWrite=true for owner role in members list', async () => {
    mockUser.current = { id: 'u-me', isAdmin: false };
    const members = [makeMember({ userId: 'u-me', role: SharedSpaceRole.Owner })];
    const { unmount } = await render(RegisterSpaceContextHarness, {
      props: { spaceThunk: () => makeSpace(), membersThunk: () => members },
    });
    expect(commandContextManager.getContext().space?.canWrite).toBe(true);
    await unmount();
  });

  it('canWrite=true for editor', async () => {
    mockUser.current = { id: 'u-me', isAdmin: false };
    const members = [makeMember({ userId: 'u-me', role: SharedSpaceRole.Editor })];
    const { unmount } = await render(RegisterSpaceContextHarness, {
      props: { spaceThunk: () => makeSpace(), membersThunk: () => members },
    });
    expect(commandContextManager.getContext().space?.canWrite).toBe(true);
    await unmount();
  });

  it('canWrite=false for viewer', async () => {
    mockUser.current = { id: 'u-me', isAdmin: false };
    const members = [makeMember({ userId: 'u-me', role: SharedSpaceRole.Viewer })];
    const { unmount } = await render(RegisterSpaceContextHarness, {
      props: { spaceThunk: () => makeSpace(), membersThunk: () => members },
    });
    expect(commandContextManager.getContext().space?.canWrite).toBe(false);
    await unmount();
  });

  it('treats undefined members thunk as isMember=false + canWrite=false', async () => {
    mockUser.current = { id: 'u-me', isAdmin: false };
    const { unmount } = await render(RegisterSpaceContextHarness, {
      props: { spaceThunk: () => makeSpace(), membersThunk: () => undefined },
    });
    const space = commandContextManager.getContext().space;
    expect(space?.isMember).toBe(false);
    expect(space?.canWrite).toBe(false);
    await unmount();
  });

  it('passes through the live add-photos callback when provided', async () => {
    mockUser.current = { id: 'u-me', isAdmin: false };
    const addPhotosToCurrentSpace = vi.fn();
    const { unmount } = await render(RegisterSpaceContextHarness, {
      props: {
        spaceThunk: () => makeSpace(),
        membersThunk: () => [makeMember({ userId: 'u-me', role: SharedSpaceRole.Editor })],
        options: { getAddPhotosToCurrentSpace: () => addPhotosToCurrentSpace },
      },
    });

    expect(commandContextManager.getContext().space?.addPhotosToCurrentSpace).toBe(addPhotosToCurrentSpace);
    commandContextManager.getContext().space?.addPhotosToCurrentSpace?.();
    expect(addPhotosToCurrentSpace).toHaveBeenCalledOnce();
    await unmount();
  });

  it('isMember=true when current user appears in members', async () => {
    mockUser.current = { id: 'u-me', isAdmin: false };
    const members = [makeMember({ userId: 'u-me' })];
    const { unmount } = await render(RegisterSpaceContextHarness, {
      props: { spaceThunk: () => makeSpace(), membersThunk: () => members },
    });
    expect(commandContextManager.getContext().space?.isMember).toBe(true);
    await unmount();
  });

  it('cleanup clears space on unmount', async () => {
    mockUser.current = { id: 'u-me', isAdmin: false };
    const { unmount } = await render(RegisterSpaceContextHarness, {
      props: { spaceThunk: () => makeSpace(), membersThunk: () => [] },
    });
    expect(commandContextManager.getContext().space).not.toBeNull();
    await unmount();
    expect(commandContextManager.getContext().space).toBeNull();
  });

  it('stores raw DTO and separately-fetched members on context', async () => {
    mockUser.current = { id: 'u-me', isAdmin: false };
    const space = makeSpace({ name: 'Original' });
    const members = [makeMember({ userId: 'u-me', role: SharedSpaceRole.Owner })];
    const { unmount } = await render(RegisterSpaceContextHarness, {
      props: { spaceThunk: () => space, membersThunk: () => members },
    });
    const ctx = commandContextManager.getContext();
    // $state wraps stored objects in reactive proxies; assert field equality, not identity.
    expect(ctx.space?.raw.name).toBe('Original');
    expect(ctx.space?.members.map((m) => m.userId)).toEqual(['u-me']);
    await unmount();
  });

  it('SharedSpaceRole enum values are lowercase strings', () => {
    // Drift guard: backend expects these exact string values.
    expect(SharedSpaceRole.Owner).toBe('owner');
    expect(SharedSpaceRole.Editor).toBe('editor');
    expect(SharedSpaceRole.Viewer).toBe('viewer');
  });
});
