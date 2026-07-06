<script lang="ts">
  import { handleError } from '$lib/utils/handle-error';
  import {
    getAllLibraries,
    linkLibrary,
    unlinkLibrary,
    type SharedSpaceLinkedLibraryDto,
    type SharedSpaceResponseDto,
  } from '@immich/sdk';
  import { Button, Field, Icon, modalManager, Select, type SelectOption } from '@immich/ui';
  import { mdiBookshelf, mdiLinkVariantOff, mdiLinkVariantPlus } from '@mdi/js';
  import { t } from 'svelte-i18n';

  interface Props {
    space: SharedSpaceResponseDto;
    onChanged: () => void;
  }

  let { space, onChanged }: Props = $props();

  let linkedLibraries = $derived(space.linkedLibraries ?? []);
  let availableLibraries = $state<SelectOption<string>[]>([]);
  let selectedLibraryId = $state<string>('');
  let linking = $state(false);
  let loadingLibraries = $state(true);

  $effect(() => {
    void linkedLibraries;
    void loadAvailableLibraries();
  });

  async function loadAvailableLibraries() {
    try {
      loadingLibraries = true;
      const allLibraries = await getAllLibraries();
      const linkedIds = new Set(linkedLibraries.map((l: SharedSpaceLinkedLibraryDto) => l.libraryId));
      availableLibraries = allLibraries
        .filter((lib) => !linkedIds.has(lib.id))
        .map((lib) => ({ label: lib.name, value: lib.id }));
      selectedLibraryId = '';
    } catch (error) {
      handleError(error, $t('spaces_error_loading_libraries'));
    } finally {
      loadingLibraries = false;
    }
  }

  async function handleLink() {
    if (!selectedLibraryId) {
      return;
    }
    try {
      linking = true;
      await linkLibrary({
        id: space.id,
        sharedSpaceLibraryLinkDto: { libraryId: selectedLibraryId },
      });
      onChanged();
    } catch (error) {
      handleError(error, $t('spaces_error_linking_library'));
    } finally {
      linking = false;
    }
  }

  async function handleUnlink(libraryId: string, libraryName: string) {
    const confirmed = await modalManager.showDialog({
      prompt: $t('spaces_unlink_library_confirmation', { values: { name: libraryName } }),
      title: $t('spaces_unlink_library'),
    });
    if (!confirmed) {
      return;
    }
    try {
      await unlinkLibrary({ id: space.id, libraryId });
      onChanged();
    } catch (error) {
      handleError(error, $t('spaces_error_unlinking_library'));
    }
  }
</script>

<div class="flex flex-col gap-4 px-5 py-4" data-testid="linked-libraries">
  <!-- Header -->
  <div class="flex items-center gap-2">
    <Icon icon={mdiBookshelf} size="20" class="text-gray-500" />
    <h3 class="text-sm font-semibold">{$t('spaces_connected_libraries')}</h3>
  </div>

  <!-- Linked libraries list -->
  {#if linkedLibraries.length === 0}
    <p class="text-sm italic text-gray-400">{$t('spaces_no_libraries_connected')}</p>
  {:else}
    <div class="flex flex-col gap-2" data-testid="linked-library-list">
      {#each linkedLibraries as lib (lib.libraryId)}
        <div class="flex items-center justify-between rounded-lg border border-gray-200 px-3 py-2 dark:border-gray-700">
          <div class="min-w-0 flex-1">
            <p class="truncate text-sm font-medium">{lib.libraryName}</p>
          </div>
          <Button
            size="tiny"
            variant="ghost"
            color="danger"
            leadingIcon={mdiLinkVariantOff}
            onclick={() => handleUnlink(lib.libraryId, lib.libraryName)}
          >
            {$t('spaces_unlink')}
          </Button>
        </div>
      {/each}
    </div>
  {/if}

  <!-- Link new library -->
  {#if loadingLibraries}
    <p class="text-xs text-gray-400">{$t('spaces_loading_libraries')}</p>
  {:else if availableLibraries.length > 0}
    <div class="flex items-end gap-2">
      <Field label={$t('spaces_add_library')} class="flex-1">
        <Select options={availableLibraries} value={selectedLibraryId} onChange={(v) => (selectedLibraryId = v)} />
      </Field>
      <Button
        size="small"
        leadingIcon={mdiLinkVariantPlus}
        onclick={handleLink}
        disabled={!selectedLibraryId || linking}
      >
        {$t('link')}
      </Button>
    </div>
  {:else if linkedLibraries.length > 0}
    <p class="text-xs text-gray-400">{$t('spaces_all_libraries_connected')}</p>
  {/if}
</div>
