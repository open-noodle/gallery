<script lang="ts">
  import { handleError } from '$lib/utils/handle-error';
  import { unlinkAlbum, type AlbumResponseDto } from '@immich/sdk';
  import { IconButton, modalManager } from '@immich/ui';
  import { mdiLinkVariantOff } from '@mdi/js';
  import { t } from 'svelte-i18n';
  import { SvelteSet } from 'svelte/reactivity';

  interface Props {
    album: AlbumResponseDto;
  }

  let { album }: Props = $props();

  // Owner-only: the server populates `sharedSpaceLinks` on GET /albums/:id only for the album owner
  // (rbac-6). Every other caller — album editors/viewers, space-only readers, shared-link viewers —
  // gets `undefined`, so this component naturally renders nothing for them.
  //
  // `links` is derived (not snapshotted) off `album.sharedSpaceLinks` because SvelteKit reuses this
  // component instance across album navigation (only the `album` prop changes) — a one-time `$state`
  // snapshot would keep rendering the PREVIOUS album's links, and unlink would then target a space
  // that isn't actually linked to the album currently on screen (L9).
  let removedSpaceIds = new SvelteSet<string>();

  $effect(() => {
    // Reset optimistic-unlink tracking whenever the album identity changes — a `removedSpaceIds`
    // entry from a previous album must not hide a same-numbered space link that legitimately
    // belongs to the new album's server-provided list.
    void album.id;
    removedSpaceIds.clear();
  });

  let links = $derived((album.sharedSpaceLinks ?? []).filter((link) => !removedSpaceIds.has(link.spaceId)));

  const handleUnlink = async (spaceId: string, spaceName: string) => {
    const confirmed = await modalManager.showDialog({
      prompt: $t('unlink_album_from_space_confirmation', { values: { space: spaceName } }),
      title: $t('unlink_album_from_space', { values: { space: spaceName } }),
    });
    if (!confirmed) {
      return;
    }

    try {
      await unlinkAlbum({ id: spaceId, albumId: album.id });
      removedSpaceIds.add(spaceId);
    } catch (error) {
      // Reuse the space-albums-list unlink error copy — same failure mode, opposite direction.
      handleError(error, $t('spaces_linked_albums_error_unlink'));
    }
  };
</script>

{#if links.length > 0}
  <section data-testid="album-space-links" class="my-3 flex flex-col gap-2">
    <h2 class="text-sm font-medium text-gray-500">{$t('linked_spaces')}</h2>
    <ul class="flex flex-col gap-1">
      {#each links as link (link.spaceId)}
        <li class="flex items-center justify-between gap-2" data-testid="album-space-link">
          <span class="flex items-center gap-2 text-sm dark:text-immich-dark-fg">
            <span>{link.spaceName}</span>
            {#if !link.showInTimeline}
              <span class="text-xs text-gray-500">· {$t('space_albums_hidden_from_timeline')}</span>
            {/if}
          </span>
          <IconButton
            shape="round"
            variant="ghost"
            color="secondary"
            size="small"
            icon={mdiLinkVariantOff}
            aria-label={$t('unlink_album_from_space', { values: { space: link.spaceName } })}
            data-testid="album-space-link-unlink"
            onclick={() => handleUnlink(link.spaceId, link.spaceName)}
          />
        </li>
      {/each}
    </ul>
  </section>
{/if}
