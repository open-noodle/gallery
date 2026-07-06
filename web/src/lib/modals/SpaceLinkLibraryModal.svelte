<script lang="ts">
  import LoadingSpinner from '$lib/components/shared-components/LoadingSpinner.svelte';
  import { handleError } from '$lib/utils/handle-error';
  import { getAllLibraries, linkLibrary, type LibraryResponseDto } from '@immich/sdk';
  import { FormModal, Icon, Input, ListButton, Stack, Text } from '@immich/ui';
  import { mdiBookshelf, mdiLinkVariantPlus, mdiMagnify } from '@mdi/js';
  import { onMount } from 'svelte';
  import { t } from 'svelte-i18n';
  import { SvelteSet } from 'svelte/reactivity';

  type Props = {
    spaceId: string;
    linkedLibraryIds: string[];
    onClose: (linkedCount?: number) => void;
  };

  const { spaceId, linkedLibraryIds, onClose }: Props = $props();

  let libraries = $state<LibraryResponseDto[]>([]);
  let loading = $state(true);
  let submitting = $state(false);
  let search = $state('');
  const selectedIds = new SvelteSet<string>();

  // External libraries are an admin concept; offer every library not already linked to this space.
  const linkable = $derived(libraries.filter((library) => !linkedLibraryIds.includes(library.id)));

  const query = $derived(search.trim().toLowerCase());
  const filtered = $derived(
    query ? linkable.filter((library) => library.name.toLowerCase().includes(query)) : linkable,
  );

  onMount(async () => {
    try {
      libraries = await getAllLibraries();
    } catch (error) {
      handleError(error, $t('spaces_linked_libraries_error_load'));
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
    for (const libraryId of selectedIds) {
      try {
        await linkLibrary({ id: spaceId, sharedSpaceLibraryLinkDto: { libraryId } });
        linked++;
      } catch (error) {
        handleError(error, $t('spaces_linked_libraries_error_link'));
      }
    }
    submitting = false;
    onClose(linked);
  };
</script>

<FormModal
  icon={mdiLinkVariantPlus}
  title={$t('spaces_linked_libraries_link_library')}
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
    <Text class="py-6" color="muted">{$t('spaces_linked_libraries_no_libraries')}</Text>
  {:else}
    <Stack gap={2}>
      <Input bind:value={search} placeholder={$t('search')} leadingIcon={mdiMagnify} />
      <div
        class="-mr-2 flex max-h-96 immich-scrollbar flex-col gap-1 overflow-y-auto pr-2"
        data-testid="library-picker"
      >
        {#each filtered as library (library.id)}
          <ListButton
            selected={selectedIds.has(library.id)}
            onclick={() => toggle(library.id)}
            data-testid="library-picker-item"
          >
            <div class="flex min-w-0 items-center gap-3">
              <div class="flex size-10 shrink-0 items-center justify-center rounded-md bg-gray-100 dark:bg-gray-800">
                <Icon icon={mdiBookshelf} size="1.25rem" class="text-gray-400" />
              </div>
              <div class="min-w-0 text-start">
                <Text fontWeight="medium" class="truncate">{library.name}</Text>
                <Text size="tiny" color="muted" class="truncate">
                  {$t('items_count', { values: { count: library.assetCount } })}{library.importPaths.length > 0
                    ? ` · ${library.importPaths[0]}`
                    : ''}
                </Text>
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
