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
  /**
   * CreateSharedLink. True when *any* of the selection is the user's own — the action
   * shares the owned subset, because `Permission.AssetShare` rejects the whole request
   * if it names one asset the caller does not own.
   */
  canShare: boolean;
  canAddToAlbum: boolean;
  /**
   * The add-to-collection picker must offer only albums linked to this space, because the
   * selection contains assets the user does not own. Those can only land as #764
   * contributions (`album_space_asset`), which requires a space-linked album — never a
   * personal album, a brand-new album, or any space's direct pool.
   */
  addToAlbumRestrictedToSpace: boolean;
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
  addToAlbumRestrictedToSpace: false,
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

  // A space Owner/Editor is the one role that can act on assets they do not own: the server's
  // #764 contribution path (album.service.tryContributeDeniedAssets) accepts them into any album
  // linked to a space where the caller is Owner/Editor. A regular album editor has no such path,
  // so this arm is deliberately keyed on `space`, not on `isEditorOfContext`.
  const isSpaceEditor = space !== null && space.canWrite;

  return {
    canSelectAll: true,
    canDownload: true,
    // Not `isAllUserOwned`: the action sends only the owned subset, so it stays useful on a
    // mixed selection and is denied only when nothing in the selection is the user's.
    canShare: sel.ownedSelectedAssetIds.length > 0,
    canAddToAlbum: sel.isAllUserOwned || isSpaceEditor,
    addToAlbumRestrictedToSpace: !sel.isAllUserOwned && isSpaceEditor,
    canFavorite: sel.isAllUserOwned,
    canEditMetadata: sel.isAllUserOwned,
    canTag: sel.isAllUserOwned && tagsEnabled,
    canDelete: sel.isAllUserOwned,
    canSetCover: isEditorOfContext && sel.selectedAssetIds.length === 1,
    canRemoveFromAlbum,
    canRemoveFromSpace,
  };
}
