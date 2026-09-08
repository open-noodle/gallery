<script lang="ts">
  import { timeBeforeShowLoadingSpinner } from '$lib/constants';
  import { handleError } from '$lib/utils/handle-error';
  import {
    createPerson,
    getAllPeople,
    reassignFaces,
    type AssetFaceUpdateItem,
    type PersonResponseDto,
  } from '@immich/sdk';
  import { Button, toastManager } from '@immich/ui';
  import { mdiMerge, mdiPlus } from '@mdi/js';
  import { onMount, type Snippet } from 'svelte';
  import { t } from 'svelte-i18n';
  import { quintOut } from 'svelte/easing';
  import { fly } from 'svelte/transition';
  import ControlAppBar from '$lib/components/shared-components/ControlAppBar.svelte';
  import FaceThumbnail from './FaceThumbnail.svelte';
  import PeopleList from './PeopleList.svelte';

  interface Props {
    assetIds: string[];
    personAssets: PersonResponseDto;
    onConfirm: () => void;
    onClose: () => void;
    header?: Snippet;
    merge?: Snippet;
  }

  let { assetIds, personAssets, onConfirm, onClose, header, merge }: Props = $props();

  let people: PersonResponseDto[] = $state([]);
  let selectedPerson: PersonResponseDto | null = $state(null);
  let disableButtons = $state(false);
  let showLoadingSpinnerCreate = $state(false);
  let showLoadingSpinnerReassign = $state(false);
  let hasSelection = $state(false);

  let peopleToNotShow = $derived(selectedPerson ? [personAssets, selectedPerson] : [personAssets]);

  const selectedPeople: AssetFaceUpdateItem[] = Array.from(assetIds, (assetId) => ({
    assetId,
    personId: personAssets.id,
  }));

  onMount(async () => {
    const data = await getAllPeople({ withHidden: false });
    people = data.people;
  });

  const handleSelectedPerson = (person: PersonResponseDto) => {
    if (selectedPerson && selectedPerson.id === person.id) {
      handleRemoveSelectedPerson();
      return;
    }
    selectedPerson = person;
    hasSelection = true;
  };

  const handleRemoveSelectedPerson = () => {
    selectedPerson = null;
    hasSelection = false;
  };

  const handleCreate = async () => {
    const timeout = setTimeout(() => (showLoadingSpinnerCreate = true), timeBeforeShowLoadingSpinner);

    try {
      disableButtons = true;
      const data = await createPerson({ personCreateDto: {} });
      await reassignFaces({ id: data.id, assetFaceUpdateDto: { data: selectedPeople } });
      toastManager.primary($t('reassigned_assets_to_new_person', { values: { count: assetIds.length } }));
    } catch (error) {
      handleError(error, $t('errors.unable_to_reassign_assets_new_person'));
    } finally {
      clearTimeout(timeout);
    }

    showLoadingSpinnerCreate = false;
    onConfirm();
  };

  const handleReassign = async () => {
    const timeout = setTimeout(() => (showLoadingSpinnerReassign = true), timeBeforeShowLoadingSpinner);
    try {
      disableButtons = true;
      if (selectedPerson) {
        await reassignFaces({ id: selectedPerson.id, assetFaceUpdateDto: { data: selectedPeople } });
        toastManager.primary(
          $t('reassigned_assets_to_existing_person', {
            values: { count: assetIds.length, name: selectedPerson.name || null },
          }),
        );
      }
    } catch (error) {
      handleError(
        error,
        $t('errors.unable_to_reassign_assets_existing_person', { values: { name: selectedPerson?.name || null } }),
      );
    } finally {
      clearTimeout(timeout);
    }

    showLoadingSpinnerReassign = false;
    onConfirm();
  };
</script>

{#snippet actions()}
  <Button
    class="min-w-0 grow sm:grow-0"
    shape="round"
    title={$t('create_new_person_hint')}
    leadingIcon={mdiPlus}
    loading={showLoadingSpinnerCreate}
    size="small"
    disabled={disableButtons || hasSelection}
    onclick={handleCreate}
  >
    <span class="truncate">{$t('create_new_person')}</span>
  </Button>
  <Button
    class="min-w-0 grow sm:grow-0"
    size="small"
    shape="round"
    title={$t('reassing_hint')}
    leadingIcon={mdiMerge}
    loading={showLoadingSpinnerReassign}
    disabled={disableButtons || !hasSelection}
    onclick={handleReassign}
  >
    <span class="truncate">{$t('reassign')}</span>
  </Button>
{/snippet}

<section
  transition:fly={{ y: 500, duration: 100, easing: quintOut }}
  class="absolute inset-s-0 top-0 flex size-full flex-col bg-light"
>
  <ControlAppBar {onClose}>
    {#snippet leading()}
      {@render header?.()}
      <div></div>
    {/snippet}
    {#snippet trailing()}
      <!-- The control bar never shrinks its overflow slot, so on a phone these two labelled buttons
           run off the edge (#1082) — below `sm` they move to the action bar at the bottom instead. -->
      <div class="hidden gap-4 sm:flex">
        {@render actions()}
      </div>
    {/snippet}
    <!-- Below `sm` the actions move to the bottom bar, which would otherwise leave the app bar empty
         but for the close button — name the screen there instead. This is the bar's content slot
         rather than its header, because only the content slot shrinks (so `truncate` bites on a
         locale whose title is longer than the bar). -->
    <p class="min-w-0 truncate text-sm font-medium text-dark sm:hidden">{$t('fix_incorrect_match')}</p>
  </ControlAppBar>
  {@render merge?.()}
  <section class="flex min-h-0 flex-1 flex-col px-4 pt-20 pb-4 md:px-17.5 md:pt-25 md:pb-6">
    {#if selectedPerson !== null}
      <div class="mb-4 shrink-0 md:mb-10">
        <p class="mb-3 text-center text-sm uppercase md:mb-4 md:text-base dark:text-white">
          {$t('choose_matching_faces_to_reassign')}
        </p>

        <div class="flex place-content-center">
          <div class="w-24 md:w-45">
            <FaceThumbnail person={selectedPerson} border circle selectable onClick={handleRemoveSelectedPerson} />
          </div>
        </div>
      </div>
    {/if}

    <PeopleList {people} {peopleToNotShow} onSelect={handleSelectedPerson} />

    <div class="mt-4 flex shrink-0 gap-2 sm:hidden">
      {@render actions()}
    </div>
  </section>
</section>
