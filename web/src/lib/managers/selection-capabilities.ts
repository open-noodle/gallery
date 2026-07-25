import type { CommandContext } from '$lib/managers/command-context-manager.svelte';

/**
 * One struct of booleans deciding which bulk-selection actions the current
 * `CommandContext` allows. Pure and side-effect free: no `authManager`
 * reads, no `$state`. See
 * `docs/superpowers/specs/2026-07-24-selection-toolbar-consistency-design.md`
 * for the rule derivation ("the regular shared album is the reference model").
 */
export interface SelectionCapabilities {
  canSelectAll: boolean;
  canDownload: boolean;
  /** CreateSharedLink */
  canShare: boolean;
  canAddToAlbum: boolean;
  canFavorite: boolean;
  /** Rotate, ChangeDate/Description/Location, Archive, SetVisibility */
  canEditMetadata: boolean;
  canTag: boolean;
  canDelete: boolean;
  canSetCover: boolean;
  canRemoveFromAlbum: boolean;
  canRemoveFromSpace: boolean;
}

const NO_CAPABILITIES: SelectionCapabilities = {
  canSelectAll: false,
  canDownload: false,
  canShare: false,
  canAddToAlbum: false,
  canFavorite: false,
  canEditMetadata: false,
  canTag: false,
  canDelete: false,
  canSetCover: false,
  canRemoveFromAlbum: false,
  canRemoveFromSpace: false,
};

export function getSelectionCapabilities(ctx: CommandContext, tagsEnabled: boolean): SelectionCapabilities {
  const sel = ctx.selection;
  if (sel === null) {
    // No toolbar is rendered at all when there is no active selection.
    return { ...NO_CAPABILITIES };
  }

  const album = ctx.album;
  const space = ctx.space;
  const isRegularAlbum = album !== null && space === null;
  const isDirectSpace = space !== null && album === null;
  const isSpaceAlbum = album !== null && space !== null;

  // isEditorOfContext / canRemoveFromAlbum both branch on the same surface
  // discriminators, so resolve them together instead of repeating the
  // isRegularAlbum / isDirectSpace / isSpaceAlbum ternary chain twice.
  let isEditorOfContext = false;
  let canRemoveFromAlbum = false;
  if (isRegularAlbum && album) {
    isEditorOfContext = album.isOwner || album.isEditor;
    canRemoveFromAlbum = album.isOwner || sel.isAllUserOwned;
  } else if (isDirectSpace && space) {
    isEditorOfContext = space.canWrite;
    // canRemoveFromAlbum stays false — there is no album on a direct-space surface.
  } else if (isSpaceAlbum && album && space) {
    // "canManage" — space editor/owner OR album editor/owner. No own-asset arm
    // (decision C): AlbumAssetDelete is role-gated server-side, ownership grants nothing.
    isEditorOfContext = space.canWrite || album.isEditor;
    canRemoveFromAlbum = space.canWrite || album.isEditor;
  }

  const canRemoveFromSpace = isDirectSpace && space !== null && space.canWrite;

  return {
    canSelectAll: true,
    canDownload: true,
    canShare: sel.isAllUserOwned,
    canAddToAlbum: sel.isAllUserOwned,
    canFavorite: sel.isAllUserOwned,
    canEditMetadata: sel.isAllUserOwned,
    canTag: sel.isAllUserOwned && tagsEnabled,
    canDelete: sel.isAllUserOwned,
    canSetCover: isEditorOfContext && sel.selectedAssetIds.length === 1,
    canRemoveFromAlbum,
    canRemoveFromSpace,
  };
}
