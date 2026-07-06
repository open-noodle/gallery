<script lang="ts">
  import { invalidateAll } from '$app/navigation';
  import SpaceLinkLibraryModal from '$lib/modals/SpaceLinkLibraryModal.svelte';
  import { handleError } from '$lib/utils/handle-error';
  import { unlinkLibrary, type SharedSpaceLinkedLibraryDto, type SharedSpaceResponseDto } from '@immich/sdk';
  import { Button, Icon, modalManager } from '@immich/ui';
  import { mdiBookshelf, mdiLinkVariantOff, mdiLinkVariantPlus } from '@mdi/js';
  import { t } from 'svelte-i18n';
  import type { PageData } from './$types';

  interface Props {
    data: PageData;
  }

  let { data }: Props = $props();

  const space = $derived<SharedSpaceResponseDto>(data.space);
  const libraries = $derived<SharedSpaceLinkedLibraryDto[]>(space.linkedLibraries ?? []);
  const linkedLibraryIds = $derived(libraries.map((library) => library.libraryId));

  async function openLinkLibraryModal() {
    const linkedCount = await modalManager.show(SpaceLinkLibraryModal, {
      spaceId: space.id,
      linkedLibraryIds,
    });
    // The modal returns how many libraries it linked; refresh the shell's cached space only on change.
    if (linkedCount) {
      await invalidateAll();
    }
  }

  async function handleUnlink(library: SharedSpaceLinkedLibraryDto) {
    const confirmed = await modalManager.showDialog({
      prompt: $t('spaces_linked_libraries_unlink_confirmation', { values: { name: library.libraryName } }),
      title: $t('spaces_linked_libraries_unlink'),
    });
    if (!confirmed) {
      return;
    }
    try {
      await unlinkLibrary({ id: space.id, libraryId: library.libraryId });
      await invalidateAll();
    } catch (error) {
      handleError(error, $t('spaces_linked_libraries_error_unlink'));
    }
  }
</script>

<div class="flex h-full flex-col">
  <div class="flex items-center justify-between px-4 py-2">
    <p class="text-sm text-gray-500">{$t('space_libraries_count', { values: { count: libraries.length } })}</p>
    <Button
      size="small"
      variant="ghost"
      leadingIcon={mdiLinkVariantPlus}
      onclick={() => void openLinkLibraryModal()}
      data-testid="link-library-button"
    >
      {$t('spaces_linked_libraries_link_library')}
    </Button>
  </div>

  {#if libraries.length === 0}
    <div class="flex min-h-[calc(66vh-11rem)] w-full place-content-center items-center dark:text-white">
      <div class="flex flex-col content-center items-center gap-4 text-center">
        <Icon icon={mdiBookshelf} size="3.5em" />
        <p class="text-lg text-gray-500 dark:text-gray-400" data-testid="empty-state-message">
          {$t('space_libraries_empty')}
        </p>
        <Button onclick={() => void openLinkLibraryModal()} data-testid="empty-link-library-button">
          {$t('space_libraries_empty_admin_cta')}
        </Button>
      </div>
    </div>
  {:else}
    <div class="px-4 pt-4">
      <div class="mx-auto flex max-w-3xl flex-col gap-2" data-testid="linked-library-list">
        {#each libraries as library (library.libraryId)}
          <div
            class="flex items-center justify-between gap-3 rounded-xl border border-gray-200 px-4 py-3 dark:border-gray-800"
            data-testid="linked-library-row"
          >
            <div class="flex min-w-0 items-center gap-3">
              <div class="flex size-10 shrink-0 items-center justify-center rounded-md bg-gray-100 dark:bg-gray-800">
                <Icon icon={mdiBookshelf} size="1.25rem" class="text-gray-400" />
              </div>
              <div class="min-w-0">
                <p class="truncate text-sm font-medium">{library.libraryName}</p>
                <p class="truncate text-xs text-gray-400">{$t('spaces_linked_libraries_external')}</p>
              </div>
            </div>
            <Button
              size="tiny"
              variant="ghost"
              color="danger"
              leadingIcon={mdiLinkVariantOff}
              onclick={() => void handleUnlink(library)}
              data-testid="unlink-library-button"
            >
              {$t('spaces_linked_libraries_unlink')}
            </Button>
          </div>
        {/each}
      </div>
    </div>
  {/if}
</div>
