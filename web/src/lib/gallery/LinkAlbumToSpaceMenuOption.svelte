<script lang="ts">
  import MenuOption from '$lib/components/shared-components/context-menu/MenuOption.svelte';
  import { handleLinkAlbumToSpace } from '$lib/gallery/album-actions';
  import { isAlbumOwner } from '$lib/services/album.service';
  import type { AlbumResponseDto } from '@immich/sdk';
  import { mdiLinkVariantPlus } from '@mdi/js';
  import { t } from 'svelte-i18n';

  interface Props {
    album: AlbumResponseDto;
    onLinked: () => Promise<void>;
  }

  let { album, onLinked }: Props = $props();
</script>

{#if isAlbumOwner(album)}
  <MenuOption
    icon={mdiLinkVariantPlus}
    text={$t('link_album_to_space')}
    onClick={async () => {
      if (await handleLinkAlbumToSpace(album)) {
        await onLinked();
      }
    }}
  />
{/if}
