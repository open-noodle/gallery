<script lang="ts">
  import { goto, invalidateAll } from '$app/navigation';
  import { page } from '$app/state';
  import { onMount } from 'svelte';
  import SpaceAlbumFolderBreadcrumb from '$lib/components/spaces/space-album-folder-breadcrumb.svelte';
  import SpaceAlbumsControls from '$lib/components/spaces/space-albums-controls.svelte';
  import SpaceAlbumsList from '$lib/components/spaces/space-albums-list.svelte';
  import { authManager } from '$lib/managers/auth-manager.svelte';
  import { eventManager } from '$lib/managers/event-manager.svelte';
  import AlbumHideFromMyTimelineConfirmModal from '$lib/modals/AlbumHideFromMyTimelineConfirmModal.svelte';
  import AlbumHideFromSpacePhotosConfirmModal from '$lib/modals/AlbumHideFromSpacePhotosConfirmModal.svelte';
  import SpaceAlbumFolderNameModal from '$lib/modals/SpaceAlbumFolderNameModal.svelte';
  import SpaceAlbumFolderPickerModal from '$lib/modals/SpaceAlbumFolderPickerModal.svelte';
  import SpaceLinkAlbumModal from '$lib/modals/SpaceLinkAlbumModal.svelte';
  import { Route } from '$lib/route';
  import { handleError } from '$lib/utils/handle-error';
  import { createAlbum } from '$lib/utils/album-utils';
  import { canDrop, type DragPayload } from '$lib/utils/space-album-folder-dnd';
  import { getFolderPath } from '$lib/utils/space-album-folders';
  import {
    getAlbumTimelineHidePreview,
    createSharedSpaceAlbumFolder,
    deleteSharedSpaceAlbumFolder,
    getSharedSpaceAlbumFolders,
    getSharedSpaceAlbums,
    linkAlbum,
    setSharedSpaceAlbumFolder,
    SharedSpaceRole,
    unlinkAlbum,
    updateAlbumTimelineForMember,
    updateSharedSpaceAlbum,
    updateSharedSpaceAlbumFolder,
    type SharedSpaceAlbumFolderDto,
    type SharedSpaceLinkedAlbumDto,
    type SharedSpaceMemberResponseDto,
    type SharedSpaceResponseDto,
  } from '@immich/sdk';
  import { Button, Icon, modalManager } from '@immich/ui';
  import { mdiFolderPlusOutline, mdiImageMultipleOutline, mdiLinkVariantPlus, mdiPlus } from '@mdi/js';
  import { t } from 'svelte-i18n';
  import type { PageData } from './$types';

  interface Props {
    data: PageData;
  }

  let { data }: Props = $props();

  const space = $derived<SharedSpaceResponseDto>(data.space);
  const members = $derived<SharedSpaceMemberResponseDto[]>(data.members);
  let albums = $state<SharedSpaceLinkedAlbumDto[]>(data.linkedAlbums);
  // Seeded from the page load, NOT empty-then-fetched-on-mount: an empty tree makes every album
  // in the space resolve to the root (see getFolderContents), so a page that starts empty renders
  // the whole space unscoped until its first fetch lands. `data.folders` is null only when the
  // load's own fetch failed.
  let folders = $state<SharedSpaceAlbumFolderDto[]>(data.folders ?? []);
  // True once a folders fetch has ever SUCCEEDED (even with an empty result) — distinct from
  // `folders.length > 0`, which can't tell "haven't loaded yet" apart from "genuinely zero
  // folders" and would otherwise never let the fallback effect below strip a dangling ?folder=
  // for a space that no longer has any folders at all.
  let foldersLoaded = $state(data.folders !== null);
  // True when the MOST RECENT folders fetch failed.
  let foldersLoadFailed = $state(data.folders === null);
  let groupIds = $state<string[]>([]);
  let searchQuery = $state('');

  const currentMember = $derived(members.find((m) => m.userId === authManager.user.id));
  const isEditor = $derived(
    currentMember?.role === SharedSpaceRole.Owner || currentMember?.role === SharedSpaceRole.Editor,
  );

  const linkedAlbumIds = $derived(albums.map((a) => a.id));

  const isSearching = $derived(searchQuery.trim().length > 0);

  const requestedFolderId = $derived(page.url.searchParams.get('folder'));

  // A folder another editor deleted must degrade to the root rather than break the page.
  const currentFolderId = $derived(
    requestedFolderId && folders.some((f) => f.id === requestedFolderId) ? requestedFolderId : null,
  );

  const folderPath = $derived(getFolderPath(folders, currentFolderId));

  // "Unavailable" must mean we have no usable folder data to scope by — not merely that the
  // MOST RECENT fetch failed. A prior success leaves `folders` non-empty and deliberately
  // untouched on a later failure (see reload() below), and that stale-but-usable tree is exactly
  // what currentFolderId/folderPath/the breadcrumb are still derived from; flattening the album
  // list in that case would show every album in the space while the breadcrumb still claims
  // you're inside a specific folder. Only degrade to the flat list when there's genuinely nothing
  // to scope by (never loaded, or loaded to confirmed-empty and now also failing).
  const foldersUnavailable = $derived(foldersLoadFailed && folders.length === 0);

  $effect(() => {
    // Strip a stale ?folder= so a refresh or a share of this URL does not keep resolving to a
    // folder that no longer exists — including a space that has been emptied down to zero
    // folders entirely. replaceState: the fallback is not a history entry. Gated on
    // foldersLoaded (not folders.length > 0) so we do not strip the param before the initial
    // folder fetch resolves, but still do strip it once we've confirmed there is nothing there.
    if (requestedFolderId && foldersLoaded && currentFolderId === null) {
      void goto(Route.viewSpaceAlbums({ id: space.id }), { replaceState: true });
    }
  });

  async function reload() {
    // Independent fetches: a folders failure must not also block the (usually far more
    // important) albums refresh the way an atomic Promise.all would. See handleError below for
    // what each half does when it fails.
    const [albumsResult, foldersResult] = await Promise.allSettled([
      getSharedSpaceAlbums({ id: space.id }),
      getSharedSpaceAlbumFolders({ id: space.id }),
    ]);

    // Both halves share one error message, so if both fail, show it once rather than stacking two
    // identical toasts.
    let notifiedLoadError = false;

    if (albumsResult.status === 'fulfilled') {
      albums = albumsResult.value;
    } else {
      handleError(albumsResult.reason, $t('spaces_linked_albums_error_load'));
      notifiedLoadError = true;
    }

    if (foldersResult.status === 'fulfilled') {
      folders = foldersResult.value;
      foldersLoaded = true;
      foldersLoadFailed = false;
    } else {
      // Deliberately leave `folders` (and foldersLoaded) as they were: a transient refetch
      // failure after a prior success should keep showing the last-known-good folder tree rather
      // than wiping it — `foldersUnavailable` above only forces the flat-list fallback when
      // `folders` is also empty, so a non-empty stale tree keeps scoping normally.
      foldersLoadFailed = true;
      handleError(foldersResult.reason, $t('spaces_linked_albums_error_load'), { notify: !notifiedLoadError });
    }
  }

  // linkedAlbums comes from the space layout's cached load, which isn't invalidated when an album is
  // edited on its detail page (rename, added photos, or abandoned-empty cleanup). Re-fetch on mount so
  // returning to the list always shows current names and counts.
  onMount(() => {
    void reload();
  });

  // A real (pushState) navigation, not a replace — drilling into a folder must be undoable with
  // the browser back button.
  const navigateToFolder = (folderId: string | null) => goto(Route.viewSpaceAlbums({ id: space.id, folderId }));

  async function handleUnlink(album: SharedSpaceLinkedAlbumDto) {
    const confirmed = await modalManager.showDialog({
      prompt: $t('spaces_linked_albums_unlink_confirmation', { values: { name: album.albumName } }),
      title: $t('spaces_linked_albums_unlink'),
    });
    if (!confirmed) {
      return;
    }
    try {
      await unlinkAlbum({ id: space.id, albumId: album.id });
      eventManager.emit('SpaceUnlinkAlbum', { spaceId: space.id });
      await reload();
      // Refresh the [spaceId] layout's cached linkedAlbums so other tabs (and a re-mount of this
      // page on tab navigation) reflect the change without a full page refresh.
      await invalidateAll();
    } catch (error) {
      handleError(error, $t('spaces_linked_albums_error_unlink'));
    }
  }

  // Editor-gated shared showInTimeline flag governing the space's own Photos tab. Hiding removes
  // the album from what EVERYONE in the space sees there, so it gets a confirm dialog stating a
  // count and offering the §2 bridge — a checked-by-default "also hide from my own timeline",
  // which writes only the actor's own row via the member-only endpoint below. Showing again needs
  // no confirmation.
  async function handleToggleTimeline(album: SharedSpaceLinkedAlbumDto) {
    try {
      if (album.showInTimeline) {
        const result = await modalManager.show(AlbumHideFromSpacePhotosConfirmModal, {
          albumName: album.albumName,
          spaceName: space.name,
        });
        if (!result?.confirmed) {
          return;
        }
        await updateSharedSpaceAlbum({
          id: space.id,
          albumId: album.id,
          sharedSpaceAlbumLinkUpdateDto: { showInTimeline: false },
        });
        // The shared flag is now committed on the server. Anything that fails below must NOT strand
        // the page showing the old flag — reconcile in `finally` regardless, or the row keeps
        // offering "Hide from the space's photos" for a flag that is already off.
        albums = albums.map((a) => (a.id === album.id ? { ...a, showInTimeline: false } : a));
        if (result.alsoHideFromMyTimeline && !album.hiddenFromMyTimeline) {
          await updateAlbumTimelineForMember({
            id: space.id,
            albumId: album.id,
            sharedSpaceAlbumMemberTimelineDto: { showInTimeline: false },
          });
          albums = albums.map((a) => (a.id === album.id ? { ...a, hiddenFromMyTimeline: true } : a));
        }
      } else {
        await updateSharedSpaceAlbum({
          id: space.id,
          albumId: album.id,
          sharedSpaceAlbumLinkUpdateDto: { showInTimeline: true },
        });
        albums = albums.map((a) => (a.id === album.id ? { ...a, showInTimeline: true } : a));
      }
      // Keep the layout's cached linkedAlbums in sync so the timeline tab + a re-mount reflect it.
      await invalidateAll();
    } catch (error) {
      handleError(error, $t('spaces_linked_albums_error_update'));
      // This handler makes TWO writes, and the first one may already have landed — so a failure
      // does not mean "nothing changed". Re-read rather than leave the page rendering a flag the
      // server no longer has. Deliberately here and not in a `finally`: the cancel path returns
      // early and must still not touch the server.
      await invalidateAll();
    }
  }

  // The member-facing "hide from my timeline" switch (#1041 §2) — own row only, never reaches
  // anyone else's library. Distinct from handleToggleTimeline above, which is the editor-gated
  // shared showInTimeline flag governing the space's own Photos tab. Hiding gets a confirm dialog
  // stating a count; showing again needs no confirmation.
  async function handleToggleMyTimeline(album: SharedSpaceLinkedAlbumDto) {
    try {
      if (!album.hiddenFromMyTimeline) {
        const { hiddenAssetCount, retainedAssetCount } = await getAlbumTimelineHidePreview({
          id: space.id,
          albumId: album.id,
        });
        const confirmed = await modalManager.show(AlbumHideFromMyTimelineConfirmModal, {
          albumName: album.albumName,
          count: hiddenAssetCount,
          retainedCount: retainedAssetCount,
        });
        if (!confirmed) {
          return;
        }
      }
      await updateAlbumTimelineForMember({
        id: space.id,
        albumId: album.id,
        sharedSpaceAlbumMemberTimelineDto: { showInTimeline: album.hiddenFromMyTimeline },
      });
      albums = albums.map((a) => (a.id === album.id ? { ...a, hiddenFromMyTimeline: !a.hiddenFromMyTimeline } : a));
      // Keep the layout's cached linkedAlbums in sync so the timeline tab + a re-mount reflect it.
      await invalidateAll();
    } catch (error) {
      handleError(error, $t('spaces_linked_albums_error_update'));
    }
  }

  async function handleCreateAlbum() {
    const newAlbum = await createAlbum();
    if (!newAlbum) {
      return; // create failed; createAlbum already showed a toast
    }
    try {
      // `?? undefined` is load-bearing, not cosmetic: linkAlbum's folderId query param is
      // `.optional()` and NOT nullable, so root must be OMITTED, not sent as null. Worse than a
      // 400 — oazapfts' `explode` helper filters only `undefined` out of the params object, and
      // `typeof null === 'object'`, so a literal `null` here makes it recurse into
      // `Object.entries(null)` and throw a TypeError, hard-breaking album creation at the space
      // root. Dropping this `??` isn't caught by unit tests because the SDK is module-mocked.
      await linkAlbum({ id: space.id, albumId: newAlbum.id, folderId: currentFolderId ?? undefined });
      eventManager.emit('SpaceLinkAlbum', { spaceId: space.id });
      await invalidateAll();
      await goto(Route.viewSpaceAlbum({ spaceId: space.id, albumId: newAlbum.id }));
    } catch (error) {
      handleError(error, $t('spaces_linked_albums_error_link'));
      await reload();
      await invalidateAll();
    }
  }

  async function openLinkAlbumModal() {
    // `?? undefined` is load-bearing here too — see the comment on the linkAlbum call in
    // handleCreateAlbum above: linkAlbum's folderId is optional-but-not-nullable, and a literal
    // null makes oazapfts' `explode` throw (Object.entries(null)) instead of 400ing, breaking
    // linking at the space root. Not caught by unit tests since the SDK is module-mocked.
    const linkedCount = await modalManager.show(SpaceLinkAlbumModal, {
      spaceId: space.id,
      linkedAlbumIds,
      folderId: currentFolderId ?? undefined,
    });
    // The modal returns how many albums it linked; only refresh when something changed.
    if (linkedCount) {
      eventManager.emit('SpaceLinkAlbum', { spaceId: space.id });
      // See handleCreateFolder: a link made during a search lands in the hidden current folder and
      // the results don't change unless the album happens to match the query.
      clearSearchToRevealResult();
      await reload();
      // Refresh the [spaceId] layout's cached linkedAlbums so other tabs (and a re-mount of this
      // page on tab navigation) reflect the change without a full page refresh.
      await invalidateAll();
    }
  }

  /**
   * Drops an active search so a just-created folder or newly-linked album becomes visible.
   *
   * Search flattens the whole space and hides both the breadcrumb and every folder row, but the
   * create/link actions stay enabled and keep targeting `currentFolderId`. The result therefore
   * lands somewhere the user can neither see nor is told about. Clearing the query is the smallest
   * fix that keeps the capability (disabling the buttons mid-search would remove it) while making
   * the outcome observable.
   */
  function clearSearchToRevealResult() {
    searchQuery = '';
  }

  // showDialog resolves to a boolean, so it cannot collect a name — this uses the dedicated
  // single-field modal from Task 9.
  async function handleCreateFolder() {
    const name = await modalManager.show(SpaceAlbumFolderNameModal, {
      title: $t('space_album_folder_new'),
    });
    if (!name) {
      return;
    }
    try {
      await createSharedSpaceAlbumFolder({
        id: space.id,
        sharedSpaceAlbumFolderCreateDto: { name, parentId: currentFolderId },
      });
      // A search hides the breadcrumb AND every folder row, so a folder created during one lands
      // in `currentFolderId` with nothing on screen saying where, and stays invisible afterwards.
      // The only feedback was the name-conflict 400 on the second attempt. Dropping the query puts
      // the user back on the level the folder was actually created in, where they can see it.
      clearSearchToRevealResult();
      await reload();
    } catch (error) {
      handleError(error, $t('space_album_folder_error_create'));
    }
  }

  async function handleRenameFolder(folder: SharedSpaceAlbumFolderDto) {
    const name = await modalManager.show(SpaceAlbumFolderNameModal, {
      title: $t('space_album_folder_rename'),
      initialName: folder.name,
    });
    if (!name || name === folder.name) {
      return;
    }
    try {
      await updateSharedSpaceAlbumFolder({
        id: space.id,
        folderId: folder.id,
        sharedSpaceAlbumFolderUpdateDto: { name },
      });
      await reload();
    } catch (error) {
      handleError(error, $t('space_album_folder_error_rename'));
    }
  }

  async function moveFolder(folderId: string, parentId: string | null) {
    try {
      await updateSharedSpaceAlbumFolder({
        id: space.id,
        folderId,
        sharedSpaceAlbumFolderUpdateDto: { parentId },
      });
      await reload();
    } catch (error) {
      handleError(error, $t('space_album_folder_error_move'));
    }
  }

  async function handleMoveFolder(folder: SharedSpaceAlbumFolderDto) {
    const result = await modalManager.show(SpaceAlbumFolderPickerModal, {
      folders,
      excludeFolderId: folder.id,
      currentFolderId: folder.parentId,
    });
    if (!result) {
      return;
    }
    await moveFolder(folder.id, result.folderId);
  }

  async function handleDeleteFolder(folder: SharedSpaceAlbumFolderDto) {
    const confirmed = await modalManager.showDialog({
      title: $t('space_album_folder_delete'),
      prompt: $t('space_album_folder_delete_confirm', { values: { name: folder.name } }),
    });
    if (!confirmed) {
      return;
    }
    try {
      await deleteSharedSpaceAlbumFolder({ id: space.id, folderId: folder.id });
      // If we were standing inside it, the fallback effect above returns us to the root.
      await reload();
      // Deleting a folder promotes its albums one level up, changing their folderId — so the
      // layout's cached linkedAlbums are now stale for the same reason as an explicit move.
      await invalidateAll();
    } catch (error) {
      handleError(error, $t('space_album_folder_error_delete'));
    }
  }

  // Shared by both entry points that move an album — a drag-and-drop and the card kebab's
  // "Move to folder…" — so both get the same optimistic-apply-then-rollback behaviour.
  async function moveAlbumToFolder(albumId: string, targetFolderId: string | null) {
    const previous = albums;
    albums = albums.map((a) => (a.id === albumId ? { ...a, folderId: targetFolderId } : a));
    try {
      await setSharedSpaceAlbumFolder({
        id: space.id,
        albumId,
        sharedSpaceAlbumFolderMoveAlbumDto: { folderId: targetFolderId },
      });
      await reload();
      // reload() only refreshes THIS page's state. The [spaceId] layout separately caches
      // linkedAlbums, and each of those rows carries the folderId that the album detail page's
      // back button navigates to — so without this, opening a just-moved album and pressing
      // back returns to the folder it used to live in.
      await invalidateAll();
    } catch (error) {
      albums = previous; // rollback
      handleError(error, $t('space_album_folder_error_move'));
      // Reload regardless: a "folder not found" failure means someone else deleted the target,
      // and the stale folder must disappear from the grid (W-19).
      await reload();
    }
  }

  async function handleMoveAlbum(album: SharedSpaceLinkedAlbumDto) {
    const result = await modalManager.show(SpaceAlbumFolderPickerModal, {
      folders,
      excludeFolderId: null,
      currentFolderId: album.folderId ?? null,
    });
    if (!result) {
      return;
    }
    await moveAlbumToFolder(album.id, result.folderId);
  }

  // The client-side canDrop guard means an illegal or pointless drop (dropping onto itself, a
  // descendant, or the parent it already has) never fires a request at all.
  async function handleDropItem(payload: DragPayload, targetFolderId: string | null) {
    if (!canDrop(folders, albums, payload, targetFolderId)) {
      return;
    }

    if (payload.kind === 'album') {
      await moveAlbumToFolder(payload.id, targetFolderId);
      return;
    }

    const previous = folders;
    folders = folders.map((f) => (f.id === payload.id ? { ...f, parentId: targetFolderId } : f));
    try {
      await updateSharedSpaceAlbumFolder({
        id: space.id,
        folderId: payload.id,
        sharedSpaceAlbumFolderUpdateDto: { parentId: targetFolderId },
      });
      await reload();
    } catch (error) {
      folders = previous; // rollback
      handleError(error, $t('space_album_folder_error_move'));
      await reload();
    }
  }
</script>

<div class="flex h-full flex-col">
  {#if albums.length === 0 && folders.length === 0}
    <div class="flex min-h-[calc(66vh-11rem)] w-full place-content-center items-center dark:text-white">
      <div class="flex flex-col content-center items-center gap-4 text-center">
        <Icon icon={mdiImageMultipleOutline} size="3.5em" />
        <p class="text-lg text-gray-500 dark:text-gray-400" data-testid="empty-state-message">
          {$t('space_albums_empty')}
        </p>
        {#if isEditor}
          <!-- Same pair as the populated view's toolbar (space-albums-controls.svelte): creating a
               fresh album is the primary action, linking an existing one the secondary. -->
          <div class="flex flex-wrap items-center justify-center gap-2">
            <Button
              leadingIcon={mdiPlus}
              onclick={() => void handleCreateAlbum()}
              data-testid="empty-create-album-button"
            >
              {$t('create_album')}
            </Button>
            <Button
              variant="ghost"
              leadingIcon={mdiLinkVariantPlus}
              onclick={() => void openLinkAlbumModal()}
              data-testid="empty-link-album-button"
            >
              {$t('space_albums_empty_editor_cta')}
            </Button>
            <!-- Otherwise a brand-new space has no way to make a folder until an album exists to
                 put in one. -->
            <Button
              variant="ghost"
              leadingIcon={mdiFolderPlusOutline}
              onclick={() => void handleCreateFolder()}
              data-testid="empty-create-folder-button"
            >
              {$t('space_album_folder_new')}
            </Button>
          </div>
        {/if}
      </div>
    </div>
  {:else}
    {#if folders.length > 0 && !isSearching}
      <!-- Search escapes the folder tree entirely (results are space-wide), so showing where we
           were would misrepresent where the results actually come from. -->
      <SpaceAlbumFolderBreadcrumb
        path={folderPath}
        {folders}
        {albums}
        canManage={isEditor}
        onNavigate={(id) => void navigateToFolder(id)}
        onDropItem={handleDropItem}
      />
    {/if}
    <SpaceAlbumsControls
      {groupIds}
      bind:searchQuery
      canManage={isEditor}
      onCreate={handleCreateAlbum}
      onLink={openLinkAlbumModal}
      onCreateFolder={handleCreateFolder}
    />
    <div class="px-4 pt-4">
      <SpaceAlbumsList
        spaceId={space.id}
        {albums}
        {folders}
        {foldersUnavailable}
        {currentFolderId}
        canManage={isEditor}
        {members}
        bind:groupIds
        {searchQuery}
        onUnlink={handleUnlink}
        onToggleTimeline={handleToggleTimeline}
        onToggleMyTimeline={handleToggleMyTimeline}
        onMoveAlbum={handleMoveAlbum}
        onOpenFolder={(f) => void navigateToFolder(f.id)}
        onRenameFolder={handleRenameFolder}
        onMoveFolder={handleMoveFolder}
        onDeleteFolder={handleDeleteFolder}
        onDropItem={handleDropItem}
      />
    </div>
  {/if}
</div>
