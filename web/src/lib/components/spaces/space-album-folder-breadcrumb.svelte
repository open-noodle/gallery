<script lang="ts">
  import { canDrop, getActiveDragPayload, readDragPayload, type DragPayload } from '$lib/utils/space-album-folder-dnd';
  import type { SharedSpaceAlbumFolderDto, SharedSpaceLinkedAlbumDto } from '@immich/sdk';
  import { Icon } from '@immich/ui';
  import { mdiChevronRight } from '@mdi/js';
  import { t } from 'svelte-i18n';

  interface Props {
    path: SharedSpaceAlbumFolderDto[];
    /** Needed to run the client-side canDrop check while a crumb is a drop target. */
    folders?: SharedSpaceAlbumFolderDto[];
    albums?: SharedSpaceLinkedAlbumDto[];
    canManage?: boolean;
    onNavigate?: (folderId: string | null) => void;
    onDropItem?: (payload: DragPayload, targetFolderId: string | null) => void;
  }

  let { path, folders = [], albums = [], canManage = false, onNavigate, onDropItem }: Props = $props();

  const MAX_VISIBLE = 4;

  // Which crumb (by folder id, or null for the root) is currently highlighted as a drop target.
  // A dedicated "is anything active" flag distinguishes "no crumb targeted" from "root targeted"
  // — both would otherwise collapse to the same `null` folder id.
  let dropTarget = $state<{ folderId: string | null } | null>(null);

  const canAccept = (targetFolderId: string | null) => {
    if (!canManage) {
      return false;
    }
    const payload = getActiveDragPayload();
    return !!payload && canDrop(folders, albums, payload, targetFolderId);
  };

  const handleDrop = (event: DragEvent, targetFolderId: string | null) => {
    event.preventDefault();
    dropTarget = null;
    const payload = event.dataTransfer && readDragPayload(event.dataTransfer);
    if (payload) {
      onDropItem?.(payload, targetFolderId);
    }
  };

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
    class:ring-2={dropTarget?.folderId === null}
    class:ring-primary={dropTarget?.folderId === null}
    data-testid="breadcrumb-root"
    onclick={() => onNavigate?.(null)}
    ondragover={(event) => {
      if (!canAccept(null)) {
        return;
      }
      event.preventDefault();
      dropTarget = { folderId: null };
    }}
    ondragleave={() => (dropTarget = null)}
    ondrop={(event) => handleDrop(event, null)}
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
        class:ring-2={dropTarget?.folderId === entry.folder.id}
        class:ring-primary={dropTarget?.folderId === entry.folder.id}
        data-testid="breadcrumb-{entry.folder.id}"
        onclick={() => onNavigate?.(entry.folder.id)}
        ondragover={(event) => {
          if (!canAccept(entry.folder.id)) {
            return;
          }
          event.preventDefault();
          dropTarget = { folderId: entry.folder.id };
        }}
        ondragleave={() => (dropTarget = null)}
        ondrop={(event) => handleDrop(event, entry.folder.id)}
      >
        {entry.folder.name}
      </button>
    {/if}
  {/each}
</nav>
