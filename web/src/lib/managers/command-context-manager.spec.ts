import type { AlbumResponseDto, SharedSpaceMemberResponseDto, SharedSpaceResponseDto } from '@immich/sdk';
import { Role, SharedSpaceRole } from '@immich/sdk';
import { render } from '@testing-library/svelte';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { mockPage, mockUser } = vi.hoisted(() => ({
  mockPage: { route: { id: null as string | null }, params: {} as Record<string, string> },
  mockUser: { current: null as { id: string; isAdmin: boolean } | null },
}));
vi.mock('$app/state', () => ({ page: mockPage }));
vi.mock('$lib/stores/user.store', () => ({
  user: {
    subscribe: (fn: (v: { id: string; isAdmin: boolean } | null) => void) => {
      fn(mockUser.current);
      return () => {};
    },
  },
}));

import { commandContextManager } from '$lib/managers/command-context-manager.svelte';
import RegisterAlbumContextHarness from './__tests__/register-album-context-harness.svelte';
import RegisterSpaceContextHarness from './__tests__/register-space-context-harness.svelte';

const ALBUM_ROUTE = '/(user)/albums/[albumId=id]/[[photos=photos]]/[[assetId=id]]';
const SPACE_ROUTE = '/(user)/spaces/[spaceId]/[[photos=photos]]/[[assetId=id]]';

beforeEach(() => {
  commandContextManager.setAlbum(null);
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

const makeAlbum = (overrides: Partial<AlbumResponseDto> = {}): AlbumResponseDto =>
  ({
    id: 'a1',
    albumName: 'Test',
    ownerId: 'u-owner',
    albumUsers: [],
    ...overrides,
  }) as unknown as AlbumResponseDto;

describe('registerAlbumContext', () => {
  beforeEach(() => {
    mockPage.route.id = ALBUM_ROUTE;
  });

  it('sets album on mount, clears on unmount', () => {
    mockUser.current = { id: 'u-owner', isAdmin: false };
    const album = makeAlbum();
    const { unmount } = render(RegisterAlbumContextHarness, { props: { thunk: () => album } });
    expect(commandContextManager.getContext().album?.id).toBe('a1');
    unmount();
    expect(commandContextManager.getContext().album).toBeNull();
  });

  it('computes isOwner=true when current user matches ownerId', () => {
    mockUser.current = { id: 'u-owner', isAdmin: false };
    const { unmount } = render(RegisterAlbumContextHarness, {
      props: { thunk: () => makeAlbum({ ownerId: 'u-owner' }) },
    });
    expect(commandContextManager.getContext().album?.isOwner).toBe(true);
    unmount();
  });

  it('computes isOwner=false when user differs from ownerId', () => {
    mockUser.current = { id: 'u-other', isAdmin: false };
    const { unmount } = render(RegisterAlbumContextHarness, {
      props: { thunk: () => makeAlbum({ ownerId: 'u-owner' }) },
    });
    expect(commandContextManager.getContext().album?.isOwner).toBe(false);
    unmount();
  });

  it('treats undefined albumUsers as isMember=false', () => {
    mockUser.current = { id: 'u-other', isAdmin: false };
    const album = makeAlbum({ albumUsers: undefined });
    const { unmount } = render(RegisterAlbumContextHarness, { props: { thunk: () => album } });
    expect(commandContextManager.getContext().album?.isMember).toBe(false);
    unmount();
  });

  it('sets isMember=true when current user is in albumUsers', () => {
    mockUser.current = { id: 'u-current', isAdmin: false };
    const album = makeAlbum({
      albumUsers: [{ user: { id: 'u-current' }, role: 'editor' }] as unknown as AlbumResponseDto['albumUsers'],
    });
    const { unmount } = render(RegisterAlbumContextHarness, { props: { thunk: () => album } });
    expect(commandContextManager.getContext().album?.isMember).toBe(true);
    unmount();
  });

  it('exposes raw DTO on context', () => {
    mockUser.current = { id: 'u-owner', isAdmin: false };
    const album = makeAlbum({ albumName: 'Original' });
    const { unmount } = render(RegisterAlbumContextHarness, { props: { thunk: () => album } });
    // $state wraps the stored object in a reactive proxy; assert field equality, not identity.
    expect(commandContextManager.getContext().album?.raw.albumName).toBe('Original');
    unmount();
  });
});

const makeSpace = (overrides: Partial<SharedSpaceResponseDto> = {}): SharedSpaceResponseDto =>
  ({
    id: 's1',
    name: 'Shared',
    createdById: 'u-owner',
    ...overrides,
  }) as unknown as SharedSpaceResponseDto;

const makeMember = (overrides: Partial<SharedSpaceMemberResponseDto> = {}): SharedSpaceMemberResponseDto =>
  ({
    userId: 'u-me',
    email: 'me@test.com',
    name: 'Me',
    joinedAt: '2024-01-01T00:00:00.000Z',
    role: Role.Editor,
    ...overrides,
  }) as unknown as SharedSpaceMemberResponseDto;

describe('registerSpaceContext', () => {
  beforeEach(() => {
    mockPage.route.id = SPACE_ROUTE;
  });

  it('sets isOwner=true when user is createdById', () => {
    mockUser.current = { id: 'u-owner', isAdmin: false };
    const space = makeSpace();
    const { unmount } = render(RegisterSpaceContextHarness, {
      props: { spaceThunk: () => space, membersThunk: () => [] },
    });
    expect(commandContextManager.getContext().space?.isOwner).toBe(true);
    unmount();
  });

  it('canWrite=true for owner role in members list', () => {
    mockUser.current = { id: 'u-me', isAdmin: false };
    const members = [makeMember({ userId: 'u-me', role: Role.Owner })];
    const { unmount } = render(RegisterSpaceContextHarness, {
      props: { spaceThunk: () => makeSpace(), membersThunk: () => members },
    });
    expect(commandContextManager.getContext().space?.canWrite).toBe(true);
    unmount();
  });

  it('canWrite=true for editor', () => {
    mockUser.current = { id: 'u-me', isAdmin: false };
    const members = [makeMember({ userId: 'u-me', role: Role.Editor })];
    const { unmount } = render(RegisterSpaceContextHarness, {
      props: { spaceThunk: () => makeSpace(), membersThunk: () => members },
    });
    expect(commandContextManager.getContext().space?.canWrite).toBe(true);
    unmount();
  });

  it('canWrite=false for viewer', () => {
    mockUser.current = { id: 'u-me', isAdmin: false };
    const members = [makeMember({ userId: 'u-me', role: Role.Viewer })];
    const { unmount } = render(RegisterSpaceContextHarness, {
      props: { spaceThunk: () => makeSpace(), membersThunk: () => members },
    });
    expect(commandContextManager.getContext().space?.canWrite).toBe(false);
    unmount();
  });

  it('treats undefined members thunk as isMember=false + canWrite=false', () => {
    mockUser.current = { id: 'u-me', isAdmin: false };
    const { unmount } = render(RegisterSpaceContextHarness, {
      props: { spaceThunk: () => makeSpace(), membersThunk: () => undefined },
    });
    const space = commandContextManager.getContext().space;
    expect(space?.isMember).toBe(false);
    expect(space?.canWrite).toBe(false);
    unmount();
  });

  it('isMember=true when current user appears in members', () => {
    mockUser.current = { id: 'u-me', isAdmin: false };
    const members = [makeMember({ userId: 'u-me' })];
    const { unmount } = render(RegisterSpaceContextHarness, {
      props: { spaceThunk: () => makeSpace(), membersThunk: () => members },
    });
    expect(commandContextManager.getContext().space?.isMember).toBe(true);
    unmount();
  });

  it('cleanup clears space on unmount', () => {
    mockUser.current = { id: 'u-me', isAdmin: false };
    const { unmount } = render(RegisterSpaceContextHarness, {
      props: { spaceThunk: () => makeSpace(), membersThunk: () => [] },
    });
    expect(commandContextManager.getContext().space).not.toBeNull();
    unmount();
    expect(commandContextManager.getContext().space).toBeNull();
  });

  it('stores raw DTO and separately-fetched members on context', () => {
    mockUser.current = { id: 'u-me', isAdmin: false };
    const space = makeSpace({ name: 'Original' });
    const members = [makeMember({ userId: 'u-me', role: Role.Owner })];
    const { unmount } = render(RegisterSpaceContextHarness, {
      props: { spaceThunk: () => space, membersThunk: () => members },
    });
    const ctx = commandContextManager.getContext();
    // $state wraps stored objects in reactive proxies; assert field equality, not identity.
    expect(ctx.space?.raw.name).toBe('Original');
    expect(ctx.space?.members.map((m) => m.userId)).toEqual(['u-me']);
    unmount();
  });

  it('SharedSpaceRole enum values are lowercase strings matching Role casts', () => {
    // Drift guard: the Role→SharedSpaceRole cast relies on identical string values.
    expect(SharedSpaceRole.Owner).toBe('owner');
    expect(SharedSpaceRole.Editor).toBe('editor');
    expect(SharedSpaceRole.Viewer).toBe('viewer');
  });
});
