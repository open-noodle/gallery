<script lang="ts">
  import RenameFileModal from '#lib/gallery/asset-viewer/RenameFileModal.svelte';
  import { type AssetResponseDto } from '@immich/sdk';
  import { IconButton, modalManager } from '@immich/ui';
  import { mdiPencil } from '@mdi/js';
  import { t } from 'svelte-i18n';

  type Props = {
    asset: AssetResponseDto;
    /** Only the owner renames a file (a space editor edits the photo, not its file). */
    isOwner: boolean;
  };

  const { asset, isOwner }: Props = $props();
</script>

{#if isOwner && !asset.isTrashed}
  <IconButton
    icon={mdiPencil}
    aria-label={$t('rename_file')}
    class="-my-1 shrink-0"
    size="small"
    shape="round"
    color="secondary"
    variant="ghost"
    onclick={() => modalManager.show(RenameFileModal, { asset })}
    data-testid="detail-panel-rename-button"
  />
{/if}
