import { page } from '$app/state';
import { user } from '$lib/stores/user.store';
import { isAlbumsRoute, isSpacesRoute } from '$lib/utils/navigation';
import {
  SharedSpaceRole,
  type AlbumResponseDto,
  type SharedSpaceMemberResponseDto,
  type SharedSpaceResponseDto,
} from '@immich/sdk';
import { get } from 'svelte/store';

export interface AlbumContext {
  id: string;
  albumName: string;
  ownerId: string;
  isOwner: boolean;
  isMember: boolean;
  /** Original DTO — passed through for handlers that open modals or call SDKs needing the full object. */
  raw: AlbumResponseDto;
}

export interface SpaceContext {
  id: string;
  name: string;
  createdById: string;
  isOwner: boolean;
  isMember: boolean;
  canWrite: boolean;
  /** Original DTO. */
  raw: SharedSpaceResponseDto;
  /** Separately-fetched members list (space page loader returns this as `data.members`). */
  members: SharedSpaceMemberResponseDto[];
}

export interface CommandContext {
  routeId: string | null;
  params: Record<string, string>;
  album: AlbumContext | null;
  space: SpaceContext | null;
  userId: string | null;
  isAdmin: boolean;
}

class CommandContextManager {
  private _album: AlbumContext | null = $state(null);
  private _space: SpaceContext | null = $state(null);

  setAlbum(album: AlbumContext | null) {
    this._album = album;
  }

  setSpace(space: SpaceContext | null) {
    this._space = space;
  }

  /**
   * Snapshot read at provider-run time. Pure; no side effects.
   *
   * Album/space are gated by the current route id so a stale context left
   * behind by a page unmount race can't leak verbs onto an unrelated page
   * (e.g. album commands appearing while on a space).
   */
  getContext(): CommandContext {
    const u = get(user);
    const routeId = page.route.id;
    return {
      routeId,
      params: { ...page.params },
      album: isAlbumsRoute(routeId) ? this._album : null,
      space: isSpacesRoute(routeId) ? this._space : null,
      userId: u?.id ?? null,
      isAdmin: u?.isAdmin ?? false,
    };
  }
}

export const commandContextManager = new CommandContextManager();

/**
 * Call inside a page component's script block. Registers a reactive album
 * context derived from the page's DTO thunk, computes `isOwner` / `isMember`,
 * and clears on unmount.
 */
export function registerAlbumContext(albumDto: () => AlbumResponseDto) {
  $effect(() => {
    const currentUserId = get(user)?.id ?? null;
    const album = albumDto();
    const isMember = album.albumUsers?.some((u) => u.user.id === currentUserId) ?? false;
    commandContextManager.setAlbum({
      id: album.id,
      albumName: album.albumName,
      ownerId: album.ownerId,
      isOwner: currentUserId !== null && currentUserId === album.ownerId,
      isMember,
      raw: album,
    });
    return () => commandContextManager.setAlbum(null);
  });
}

/**
 * Call inside a space page component's script block. Takes two thunks because
 * the space detail loader fetches space and members separately; `space.members`
 * on the DTO is NOT reliably populated.
 */
export function registerSpaceContext(
  getSpace: () => SharedSpaceResponseDto | undefined,
  getMembers: () => SharedSpaceMemberResponseDto[] | undefined,
) {
  $effect(() => {
    const currentUserId = get(user)?.id ?? null;
    const space = getSpace();
    if (!space) {
      commandContextManager.setSpace(null);
      return;
    }
    const members = getMembers() ?? [];
    const self = members.find((m) => m.userId === currentUserId);
    const role = self?.role as unknown as SharedSpaceRole | undefined;
    const isOwner = currentUserId !== null && currentUserId === space.createdById;
    const canWrite = role === SharedSpaceRole.Owner || role === SharedSpaceRole.Editor;
    commandContextManager.setSpace({
      id: space.id,
      name: space.name,
      createdById: space.createdById,
      isOwner,
      isMember: self !== undefined,
      canWrite,
      raw: space,
      members,
    });
    return () => commandContextManager.setSpace(null);
  });
}
