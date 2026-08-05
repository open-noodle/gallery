<script lang="ts">
  import LoadingSpinner from '$lib/components/shared-components/LoadingSpinner.svelte';
  import { authManager } from '$lib/managers/auth-manager.svelte';
  import { getAssetMediaUrl } from '$lib/utils';
  import { handleError } from '$lib/utils/handle-error';
  import { AlbumUserRole, getAllAlbums, linkAlbum, type AlbumResponseDto } from '@immich/sdk';
  import { FormModal, Icon, Input, ListButton, Stack, Text } from '@immich/ui';
  import { mdiImageAlbum, mdiLinkVariantPlus, mdiMagnify } from '@mdi/js';
  import { onMount } from 'svelte';
  import { t } from 'svelte-i18n';
  import { SvelteSet } from 'svelte/reactivity';

  type Props = {
    spaceId: string;
    linkedAlbumIds: string[];
    /** The folder open when the modal was launched; newly linked albums land here in one request. */
    folderId?: string | null;
    onClose: (linkedCount?: number) => void;
  };

  const { spaceId, linkedAlbumIds, folderId = null, onClose }: Props = $props();

  let albums = $state<AlbumResponseDto[]>([]);
  let loading = $state(true);
  let submitting = $state(false);
  let search = $state('');
  const selectedIds = new SvelteSet<string>();

  // Only albums the current user can link: not already linked, and they own or co-edit it.
  const linkable = $derived(
    albums.filter((album) => {
      if (linkedAlbumIds.includes(album.id)) {
        return false;
      }
      const myRole = album.albumUsers.find((au) => au.user.id === authManager.user.id)?.role;
      return myRole === AlbumUserRole.Owner || myRole === AlbumUserRole.Editor;
    }),
  );

  const query = $derived(search.trim().toLowerCase());
  const filtered = $derived(
    query ? linkable.filter((album) => album.albumName.toLowerCase().includes(query)) : linkable,
  );

  onMount(async () => {
    try {
      albums = await getAllAlbums({});
    } catch (error) {
      handleError(error, $t('spaces_linked_albums_error_load'));
    } finally {
      loading = false;
    }
  });

  const toggle = (id: string) => {
    if (selectedIds.has(id)) {
      selectedIds.delete(id);
    } else {
      selectedIds.add(id);
    }
  };

  const onSubmit = async () => {
    submitting = true;
    let linked = 0;
    for (const albumId of selectedIds) {
      try {
        await linkAlbum({ id: spaceId, albumId, folderId: folderId ?? undefined });
        linked++;
      } catch (error) {
        handleError(error, $t('spaces_linked_albums_error_link'));
      }
    }
    submitting = false;
    onClose(linked);
  };
</script>

<FormModal
  icon={mdiLinkVariantPlus}
  title={$t('spaces_linked_albums_link_album')}
  submitText={$t('link')}
  cancelText={$t('cancel')}
  disabled={selectedIds.size === 0 || submitting}
  {onSubmit}
  {onClose}
>
  {#if loading}
    <div class="flex w-full place-content-center place-items-center p-4">
      <LoadingSpinner />
    </div>
  {:else if linkable.length === 0}
    <Text class="py-6" color="muted">{$t('spaces_linked_albums_no_albums')}</Text>
  {:else}
    <Stack gap={2}>
      <Input bind:value={search} placeholder={$t('search')} leadingIcon={mdiMagnify} />
      <div class="-mr-2 flex max-h-96 immich-scrollbar flex-col gap-1 overflow-y-auto pr-2" data-testid="album-picker">
        {#each filtered as album (album.id)}
          <ListButton
            selected={selectedIds.has(album.id)}
            onclick={() => toggle(album.id)}
            data-testid="album-picker-item"
          >
            <div class="flex min-w-0 items-center gap-3">
              <div class="size-10 shrink-0 overflow-hidden rounded-md bg-gray-100 dark:bg-gray-800">
                {#if album.albumThumbnailAssetId}
                  <img
                    alt=""
                    src={getAssetMediaUrl({ id: album.albumThumbnailAssetId })}
                    class="size-full object-cover"
                    loading="lazy"
                  />
                {:else}
                  <div class="flex size-full items-center justify-center">
                    <Icon icon={mdiImageAlbum} size="1.25rem" class="text-gray-400" />
                  </div>
                {/if}
              </div>
              <div class="min-w-0 text-start">
                <Text fontWeight="medium" class="truncate">{album.albumName}</Text>
                <Text size="tiny" color="muted">{$t('items_count', { values: { count: album.assetCount } })}</Text>
              </div>
            </div>
          </ListButton>
        {:else}
          <Text class="py-6" color="muted">{$t('search_no_result')}</Text>
        {/each}
      </div>
    </Stack>
  {/if}
</FormModal>
