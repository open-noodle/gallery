<script lang="ts">
  import ButtonContextMenu from '$lib/components/shared-components/context-menu/ButtonContextMenu.svelte';
  import MenuOption from '$lib/components/shared-components/context-menu/MenuOption.svelte';
  import ArchiveAction from '$lib/components/timeline/actions/ArchiveAction.svelte';
  import ChangeDate from '$lib/components/timeline/actions/ChangeDateAction.svelte';
  import ChangeDescription from '$lib/components/timeline/actions/ChangeDescriptionAction.svelte';
  import ChangeLocation from '$lib/components/timeline/actions/ChangeLocationAction.svelte';
  import CreateSharedLink from '$lib/components/timeline/actions/CreateSharedLinkAction.svelte';
  import DeleteAssets from '$lib/components/timeline/actions/DeleteAssetsAction.svelte';
  import DownloadAction from '$lib/components/timeline/actions/DownloadAction.svelte';
  import FavoriteAction from '$lib/components/timeline/actions/FavoriteAction.svelte';
  import RemoveFromAlbum from '$lib/components/timeline/actions/RemoveFromAlbumAction.svelte';
  import RemoveFromSpaceAction from '$lib/components/timeline/actions/RemoveFromSpaceAction.svelte';
  import RotateAction from '$lib/components/timeline/actions/RotateAction.svelte';
  import SelectAllAssets from '$lib/components/timeline/actions/SelectAllAction.svelte';
  import SetVisibilityAction from '$lib/components/timeline/actions/SetVisibilityAction.svelte';
  import TagAction from '$lib/components/timeline/actions/TagAction.svelte';
  import AssetSelectControlBar from '$lib/components/timeline/AssetSelectControlBar.svelte';
  import type { AssetMultiSelectManager } from '$lib/managers/asset-multi-select-manager.svelte';
  import { authManager } from '$lib/managers/auth-manager.svelte';
  import type {
    AlbumContext,
    CommandContext,
    SelectionCommandContext,
    SpaceContext,
  } from '$lib/managers/command-context-manager.svelte';
  import { getSelectionCapabilities } from '$lib/managers/selection-capabilities';
  import { TimelineManager } from '$lib/managers/timeline-manager/timeline-manager.svelte';
  import { getAssetBulkActions } from '$lib/services/asset.service';
  import type { OnArchive, OnDelete, OnFavorite, OnSetVisibility, OnUndoDelete } from '$lib/utils/actions';
  import { AlbumUserRole, type AlbumResponseDto, type SharedSpaceResponseDto } from '@immich/sdk';
  import { ActionButton, CommandPaletteDefaultProvider } from '@immich/ui';
  import { mdiDotsVertical, mdiImageOutline } from '@mdi/js';
  import { t } from 'svelte-i18n';

  /**
   * Reusable multi-select action bar, gated by the pure `getSelectionCapabilities`
   * rule engine (see `$lib/managers/selection-capabilities.ts`). Unlike the
   * personal/album/space pages, this component does NOT depend on
   * `registerSelectionContext` / `registerAlbumContext` / `registerSpaceContext`
   * being called — it derives its own minimal `CommandContext` from explicit
   * props + the `assetInteraction` (assetMultiSelectManager) singleton, so it
   * also works on surfaces (space-person, space-album) that register none of
   * those contexts.
   *
   * See `docs/superpowers/specs/2026-07-24-selection-toolbar-consistency-design.md`.
   */
  interface Props {
    /** Absent on surfaces with no timeline behind them — e.g. smart search results. */
    timelineManager?: TimelineManager;
    assetInteraction: AssetMultiSelectManager;
    /** Overrides the timeline-wide select-all. Required when `timelineManager` is absent. */
    onSelectAll?: () => void;
    /** Present on album surfaces (regular album OR space album). */
    album?: AlbumResponseDto;
    /** Present on space surfaces (direct space OR space album). */
    space?: { id: string; canWrite: boolean };
    downloadFilename?: string;
    /** Remove-from-album / remove-from-space result handler. */
    onRemove?: (assetIds: string[]) => void;
    /** Cover setter. Absent ⇒ no cover button (e.g. the space-person page passes none). */
    onSetCover?: () => void;
    onFavorite?: OnFavorite;
    onArchive?: OnArchive;
    onVisibilitySet?: OnSetVisibility;
    onAssetDelete?: OnDelete;
    onUndoDelete?: OnUndoDelete;
  }

  let {
    timelineManager,
    assetInteraction,
    onSelectAll,
    album,
    space,
    downloadFilename,
    onRemove,
    onSetCover,
    onFavorite,
    onArchive,
    onVisibilitySet,
    onAssetDelete,
    onUndoDelete,
  }: Props = $props();

  // RemoveFromAlbumAction's `album` prop is `$bindable()` — it reassigns it locally
  // after re-fetching album info post-removal. Mirror that with a writable $derived
  // rather than binding the prop directly (props aren't guaranteed assignable
  // targets, and this keeps the fallback well-typed when `album` is undefined).
  // Reassigning a $derived locally overrides it until `album` itself changes again.
  // The fallback branch is never actually rendered/read: RemoveFromAlbum only
  // renders when the real `album` prop is present (see the `{:else if ... &&
  // album}` gate below).
  const EMPTY_ALBUM = {} as AlbumResponseDto;
  let localAlbum = $derived(album ?? EMPTY_ALBUM);

  const currentUserId = $derived(authManager.authenticated ? authManager.user.id : null);

  // Mirrors registerAlbumContext's isOwner/isEditor derivation in
  // command-context-manager.svelte.ts, applied to the `album` prop directly
  // instead of a registered context.
  const albumCtx = $derived.by((): AlbumContext | null => {
    if (!album) {
      return null;
    }
    const albumUsers = album.albumUsers ?? [];
    const ownerId =
      albumUsers.find(({ role }) => role === AlbumUserRole.Owner)?.user.id ?? albumUsers[0]?.user.id ?? '';
    const isMember = currentUserId !== null && albumUsers.some((u) => u.user.id === currentUserId);
    const isEditor =
      currentUserId !== null &&
      albumUsers.some(
        (u) => u.user.id === currentUserId && (u.role === AlbumUserRole.Owner || u.role === AlbumUserRole.Editor),
      );
    return {
      id: album.id,
      albumName: album.albumName,
      ownerId,
      isOwner: currentUserId !== null && currentUserId === ownerId,
      isEditor,
      isMember,
      raw: album,
    };
  });

  const spaceCtx = $derived.by((): SpaceContext | null => {
    if (!space) {
      return null;
    }
    return {
      id: space.id,
      name: '',
      createdById: '',
      isOwner: false,
      isMember: true,
      canWrite: space.canWrite,
      raw: {} as SharedSpaceResponseDto,
      members: [],
    };
  });

  const selectionCtx = $derived.by((): SelectionCommandContext | null => {
    if (!assetInteraction.selectionActive) {
      return null;
    }
    // `ownedAssets` drives canShare (the share action sends the owned subset), so it must
    // reflect the real selection rather than the empty placeholder it once held.
    const ownedAssets = assetInteraction.ownedAssets;
    return {
      assets: assetInteraction.assets,
      selectedAssetIds: assetInteraction.assets.map((asset) => asset.id),
      ownedAssets,
      ownedSelectedAssetIds: ownedAssets.map((asset) => asset.id),
      canAddToAlbum: false,
      canAddToSpace: false,
      isAllUserOwned: assetInteraction.isAllUserOwned,
      isAllFavorite: assetInteraction.isAllFavorite,
      isAllArchived: assetInteraction.isAllArchived,
      isAllTrashed: false,
      clearSelection: () => {},
    };
  });

  const ctx = $derived<CommandContext>({
    routeId: null,
    params: {},
    album: albumCtx,
    space: spaceCtx,
    selection: selectionCtx,
    userId: currentUserId,
    isAdmin: authManager.authenticated ? authManager.user.isAdmin : false,
  });

  const tagsEnabled = $derived(authManager.authenticated ? authManager.preferences.tags.enabled : false);
  const caps = $derived(getSelectionCapabilities(ctx, tagsEnabled));

  // Non-owned assets in the selection can only land as #764 contributions into an album linked
  // to THIS space, so the picker is narrowed to those. `caps` already encodes the space-editor
  // check; `space` is non-null whenever that flag is set.
  const restrictToSpaceId = $derived(caps.addToAlbumRestrictedToSpace ? space?.id : undefined);
</script>

{#if assetInteraction.selectionActive}
  <AssetSelectControlBar>
    {@const Actions = getAssetBulkActions($t, { restrictToSpaceId })}
    <CommandPaletteDefaultProvider name={$t('assets')} actions={Object.values(Actions)} />
    {#if caps.canShare}
      <CreateSharedLink />
    {/if}
    {#if caps.canSelectAll}
      <SelectAllAssets {timelineManager} {assetInteraction} {onSelectAll} />
    {/if}
    {#if caps.canAddToAlbum}
      <ActionButton action={Actions.AddToAlbum} />
    {/if}
    {#if caps.canFavorite}
      <FavoriteAction removeFavorite={assetInteraction.isAllFavorite} {onFavorite} />
    {/if}
    {#if caps.canRemoveFromSpace && space}
      <!-- Top-level (not a menu item): RemoveFromSpaceAction has no `menuItem` variant, and the
           direct-space pages render it top-level today. RemoveFromAlbum stays in the menu below,
           mirroring the album page. A surface only ever has one of the two removes. -->
      <RemoveFromSpaceAction spaceId={space.id} {onRemove} />
    {/if}
    <ButtonContextMenu icon={mdiDotsVertical} title={$t('menu')} offset={{ x: 175, y: 25 }}>
      {#if caps.canDownload}
        <DownloadAction menuItem filename={downloadFilename} />
      {/if}
      {#if caps.canEditMetadata}
        <RotateAction />
        <ChangeDate menuItem />
        <ChangeDescription menuItem />
        <ChangeLocation menuItem />
        <ArchiveAction menuItem unarchive={assetInteraction.isAllArchived} {onArchive} />
        {#if onVisibilitySet}
          <SetVisibilityAction menuItem {onVisibilitySet} />
        {/if}
      {/if}
      {#if caps.canSetCover && onSetCover}
        {#if album}
          <MenuOption text={$t('set_as_album_cover')} icon={mdiImageOutline} onClick={() => onSetCover?.()} />
        {:else}
          <MenuOption text={$t('set_as_space_cover')} icon={mdiImageOutline} onClick={() => onSetCover?.()} />
        {/if}
      {/if}
      {#if caps.canTag}
        <TagAction menuItem />
      {/if}
      {#if caps.canRemoveFromAlbum && album}
        <RemoveFromAlbum menuItem bind:album={localAlbum} {onRemove} />
      {/if}
      {#if caps.canDelete && onAssetDelete}
        <DeleteAssets menuItem {onAssetDelete} {onUndoDelete} />
      {/if}
    </ButtonContextMenu>
  </AssetSelectControlBar>
{/if}
