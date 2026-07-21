<script lang="ts">
  import { goto, invalidateAll } from '$app/navigation';
  import { onMount } from 'svelte';
  import SpaceAlbumsControls from '$lib/components/spaces/space-albums-controls.svelte';
  import SpaceAlbumsList from '$lib/components/spaces/space-albums-list.svelte';
  import { authManager } from '$lib/managers/auth-manager.svelte';
  import { eventManager } from '$lib/managers/event-manager.svelte';
  import SpaceLinkAlbumModal from '$lib/modals/SpaceLinkAlbumModal.svelte';
  import { Route } from '$lib/route';
  import { handleError } from '$lib/utils/handle-error';
  import { createAlbum } from '$lib/utils/album-utils';
  import {
    getSharedSpaceAlbums,
    linkAlbum,
    SharedSpaceRole,
    unlinkAlbum,
    updateSharedSpaceAlbum,
    type SharedSpaceLinkedAlbumDto,
    type SharedSpaceMemberResponseDto,
    type SharedSpaceResponseDto,
  } from '@immich/sdk';
  import { Button, Icon, modalManager } from '@immich/ui';
  import { mdiImageMultipleOutline } from '@mdi/js';
  import { t } from 'svelte-i18n';
  import type { PageData } from './$types';

  interface Props {
    data: PageData;
  }

  let { data }: Props = $props();

  const space = $derived<SharedSpaceResponseDto>(data.space);
  const members = $derived<SharedSpaceMemberResponseDto[]>(data.members);
  let albums = $state<SharedSpaceLinkedAlbumDto[]>(data.linkedAlbums);
  let groupIds = $state<string[]>([]);
  let searchQuery = $state('');

  const currentMember = $derived(members.find((m) => m.userId === authManager.user.id));
  const isEditor = $derived(
    currentMember?.role === SharedSpaceRole.Owner || currentMember?.role === SharedSpaceRole.Editor,
  );

  const linkedAlbumIds = $derived(albums.map((a) => a.id));

  async function reload() {
    try {
      albums = await getSharedSpaceAlbums({ id: space.id });
    } catch (error) {
      handleError(error, $t('spaces_linked_albums_error_load'));
    }
  }

  // linkedAlbums comes from the space layout's cached load, which isn't invalidated when an album is
  // edited on its detail page (rename, added photos, or abandoned-empty cleanup). Re-fetch on mount so
  // returning to the list always shows current names and counts.
  onMount(() => {
    void reload();
  });

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

  async function handleToggleTimeline(album: SharedSpaceLinkedAlbumDto) {
    try {
      await updateSharedSpaceAlbum({
        id: space.id,
        albumId: album.id,
        sharedSpaceAlbumLinkUpdateDto: { showInTimeline: !album.showInTimeline },
      });
      albums = albums.map((a) => (a.id === album.id ? { ...a, showInTimeline: !album.showInTimeline } : a));
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
      await linkAlbum({ id: space.id, albumId: newAlbum.id });
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
    const linkedCount = await modalManager.show(SpaceLinkAlbumModal, {
      spaceId: space.id,
      linkedAlbumIds,
    });
    // The modal returns how many albums it linked; only refresh when something changed.
    if (linkedCount) {
      eventManager.emit('SpaceLinkAlbum', { spaceId: space.id });
      await reload();
      // Refresh the [spaceId] layout's cached linkedAlbums so other tabs (and a re-mount of this
      // page on tab navigation) reflect the change without a full page refresh.
      await invalidateAll();
    }
  }
</script>

<div class="flex h-full flex-col">
  {#if albums.length === 0}
    <div class="flex min-h-[calc(66vh-11rem)] w-full place-content-center items-center dark:text-white">
      <div class="flex flex-col content-center items-center gap-4 text-center">
        <Icon icon={mdiImageMultipleOutline} size="3.5em" />
        <p class="text-lg text-gray-500 dark:text-gray-400" data-testid="empty-state-message">
          {$t('space_albums_empty')}
        </p>
        {#if isEditor}
          <Button onclick={() => void openLinkAlbumModal()} data-testid="empty-link-album-button">
            {$t('space_albums_empty_editor_cta')}
          </Button>
        {/if}
      </div>
    </div>
  {:else}
    <SpaceAlbumsControls
      {groupIds}
      bind:searchQuery
      canManage={isEditor}
      onCreate={handleCreateAlbum}
      onLink={openLinkAlbumModal}
    />
    <div class="px-4 pt-4">
      <SpaceAlbumsList
        spaceId={space.id}
        {albums}
        canManage={isEditor}
        {members}
        bind:groupIds
        {searchQuery}
        onUnlink={handleUnlink}
        onToggleTimeline={handleToggleTimeline}
      />
    </div>
  {/if}
</div>
