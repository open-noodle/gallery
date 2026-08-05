<script lang="ts">
  import type { SharedSpaceAlbumFolderDto } from '@immich/sdk';
  import { Icon } from '@immich/ui';
  import { mdiChevronRight } from '@mdi/js';
  import { t } from 'svelte-i18n';

  interface Props {
    path: SharedSpaceAlbumFolderDto[];
    onNavigate?: (folderId: string | null) => void;
  }

  let { path, onNavigate }: Props = $props();

  const MAX_VISIBLE = 4;

  // Past four levels, keep the first and the last two and elide the middle, so a deep tree
  // cannot push the toolbar off a narrow viewport.
  const visible = $derived.by(() => {
    if (path.length <= MAX_VISIBLE) {
      return path.map((folder) => ({ kind: 'crumb' as const, folder }));
    }
    return [
      { kind: 'crumb' as const, folder: path[0] },
      { kind: 'ellipsis' as const },
      ...path.slice(-2).map((folder) => ({ kind: 'crumb' as const, folder })),
    ];
  });
</script>

<nav class="flex flex-wrap items-center gap-1 px-4 pt-3 text-sm" data-testid="space-album-folder-breadcrumb">
  <button
    type="button"
    class="rounded-md px-2 py-1 hover:bg-gray-100 dark:hover:bg-gray-800"
    data-testid="breadcrumb-root"
    onclick={() => onNavigate?.(null)}
  >
    {$t('space_album_folder_root')}
  </button>

  {#each visible as entry, index (entry.kind === 'crumb' ? entry.folder.id : `ellipsis-${index}`)}
    <Icon icon={mdiChevronRight} size="16" class="opacity-60" />
    {#if entry.kind === 'ellipsis'}
      <span class="px-1 opacity-60">…</span>
    {:else}
      <button
        type="button"
        class="rounded-md px-2 py-1 hover:bg-gray-100 dark:hover:bg-gray-800"
        data-testid="breadcrumb-{entry.folder.id}"
        onclick={() => onNavigate?.(entry.folder.id)}
      >
        {entry.folder.name}
      </button>
    {/if}
  {/each}
</nav>
