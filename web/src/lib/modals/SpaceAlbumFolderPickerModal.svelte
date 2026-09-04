<script lang="ts">
  import { buildFolderTree, isDescendant, type FolderNode } from '$lib/utils/space-album-folders';
  import type { SharedSpaceAlbumFolderDto } from '@immich/sdk';
  import { FormModal, Icon } from '@immich/ui';
  import { mdiFolder } from '@mdi/js';
  import { t } from 'svelte-i18n';

  interface Props {
    folders: SharedSpaceAlbumFolderDto[];
    /** When moving a FOLDER, its own subtree is not a legal destination. Null when moving an album. */
    excludeFolderId: string | null;
    currentFolderId: string | null;
    onClose: (result?: { folderId: string | null }) => void;
  }

  let { folders, excludeFolderId, currentFolderId, onClose }: Props = $props();

  let selected = $state<string | null>(currentFolderId);

  const tree = $derived(buildFolderTree(folders));

  // Disabling the moved folder and its descendants means the illegal choice is never
  // selectable — the user cannot produce a request the server would have to reject.
  const isDisabled = (id: string) =>
    !!excludeFolderId && (id === excludeFolderId || isDescendant(folders, id, excludeFolderId));

  const flatten = (nodes: FolderNode[], depth = 0): { folder: SharedSpaceAlbumFolderDto; depth: number }[] =>
    nodes.flatMap((node) => [{ folder: node.folder, depth }, ...flatten(node.children, depth + 1)]);

  const rows = $derived(flatten(tree));
</script>

<FormModal
  title={$t('space_album_folder_move')}
  onClose={() => onClose()}
  onSubmit={() => onClose({ folderId: selected })}
  submitText={$t('space_album_folder_move_here')}
>
  <div class="flex max-h-80 flex-col overflow-y-auto">
    <button
      type="button"
      class="flex items-center gap-2 rounded-md p-2 text-start hover:bg-gray-100 disabled:opacity-40 dark:hover:bg-gray-800"
      class:font-semibold={selected === null}
      data-testid="folder-option-root"
      onclick={() => (selected = null)}
    >
      {$t('space_album_folder_root')}
    </button>

    {#each rows as row (row.folder.id)}
      <button
        type="button"
        class="flex items-center gap-2 rounded-md p-2 text-start hover:bg-gray-100 disabled:cursor-not-allowed disabled:opacity-40 dark:hover:bg-gray-800"
        class:font-semibold={selected === row.folder.id}
        style="padding-inline-start: {row.depth * 1.25 + 0.5}rem"
        disabled={isDisabled(row.folder.id)}
        data-testid="folder-option-{row.folder.id}"
        onclick={() => (selected = row.folder.id)}
      >
        <Icon icon={mdiFolder} size="18" />
        {row.folder.name}
      </button>
    {/each}
  </div>
</FormModal>
