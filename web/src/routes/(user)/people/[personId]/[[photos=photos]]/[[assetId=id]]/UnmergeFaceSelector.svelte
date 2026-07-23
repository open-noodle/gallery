<script lang="ts">
  import { timeBeforeShowLoadingSpinner } from '$lib/constants';
  import { handleError } from '$lib/utils/handle-error';
  import { isSpaceScopedPerson, toScopedPersonRef } from '$lib/utils/scoped-person-ref';
  import {
    createPerson,
    getAllPeople,
    reassignFaces,
    reassignSpacePersonFaces,
    type AssetFaceUpdateItem,
    type PersonResponseDto,
    type ScopedPersonProfileRefDto,
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
  let screenHeight: number = $state(0);

  let peopleToNotShow = $derived(selectedPerson ? [personAssets, selectedPerson] : [personAssets]);

  const selectedPeople: AssetFaceUpdateItem[] = Array.from(assetIds, (assetId) => ({
    assetId,
    personId: personAssets.id,
  }));

  // The source space-person id (and its space id) live on primaryProfile, not on personAssets.id
  // itself — sending personAssets.id to the space endpoint would match zero rows.
  const spaceRef = $derived(
    isSpaceScopedPerson(personAssets) && personAssets.primaryProfile?.spaceId
      ? { spaceId: personAssets.primaryProfile.spaceId, personId: personAssets.primaryProfile.id }
      : undefined,
  );

  onMount(async () => {
    const data = await getAllPeople({ withHidden: false, withSharedSpaces: true });
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

  // Shared by both handlers so create/reassign cannot drift on the space-endpoint call shape.
  const reassignInSpace = async (
    target: { type: 'new' } | { type: 'existing'; profile: ScopedPersonProfileRefDto },
  ) => {
    const { reassigned } = await reassignSpacePersonFaces({
      id: spaceRef!.spaceId,
      personId: spaceRef!.personId,
      sharedSpacePersonReassignDto: { assetIds, target },
    });
    return reassigned;
  };

  const handleCreate = async () => {
    const timeout = setTimeout(() => (showLoadingSpinnerCreate = true), timeBeforeShowLoadingSpinner);

    try {
      disableButtons = true;
      let reassigned: number;
      if (spaceRef) {
        reassigned = await reassignInSpace({ type: 'new' });
      } else {
        const data = await createPerson({ personCreateDto: {} });
        await reassignFaces({ id: data.id, assetFaceUpdateDto: { data: selectedPeople } });
        reassigned = assetIds.length;
      }

      if (reassigned > 0) {
        toastManager.primary($t('reassigned_assets_to_new_person', { values: { count: reassigned } }));
      } else {
        toastManager.danger($t('errors.unable_to_reassign_assets_new_person'));
      }
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
        let reassigned: number;
        if (spaceRef) {
          reassigned = await reassignInSpace({ type: 'existing', profile: toScopedPersonRef(selectedPerson) });
        } else {
          await reassignFaces({ id: selectedPerson.id, assetFaceUpdateDto: { data: selectedPeople } });
          reassigned = assetIds.length;
        }

        if (reassigned > 0) {
          toastManager.primary(
            $t('reassigned_assets_to_existing_person', {
              values: { count: reassigned, name: selectedPerson.name || null },
            }),
          );
        } else {
          toastManager.danger(
            $t('errors.unable_to_reassign_assets_existing_person', { values: { name: selectedPerson.name || null } }),
          );
        }
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

<svelte:window bind:innerHeight={screenHeight} />

<section
  transition:fly={{ y: 500, duration: 100, easing: quintOut }}
  class="absolute inset-s-0 top-0 size-full bg-light"
>
  <ControlAppBar {onClose}>
    {#snippet leading()}
      {@render header?.()}
      <div></div>
    {/snippet}
    {#snippet trailing()}
      <div class="flex gap-4">
        <Button
          shape="round"
          title={$t('create_new_person_hint')}
          leadingIcon={mdiPlus}
          loading={showLoadingSpinnerCreate}
          size="small"
          disabled={disableButtons || hasSelection}
          onclick={handleCreate}
        >
          {$t('create_new_person')}</Button
        >
        <Button
          size="small"
          shape="round"
          title={$t('reassing_hint')}
          leadingIcon={mdiMerge}
          loading={showLoadingSpinnerReassign}
          disabled={disableButtons || !hasSelection}
          onclick={handleReassign}
        >
          {$t('reassign')}
        </Button>
      </div>
    {/snippet}
  </ControlAppBar>
  {@render merge?.()}
  <section class="px-17.5 pt-25">
    <section id="merge-face-selector relative">
      {#if selectedPerson !== null}
        <div class="mb-10 h-50 place-content-center place-items-center">
          <p class="mb-4 text-center uppercase dark:text-white">{$t('choose_matching_faces_to_reassign')}</p>

          <div class="grid grid-flow-col-dense place-content-center place-items-center gap-4">
            <FaceThumbnail
              person={selectedPerson}
              border
              circle
              selectable
              thumbnailSize={180}
              onClick={handleRemoveSelectedPerson}
            />
          </div>
        </div>
      {/if}
      <PeopleList {people} {peopleToNotShow} {screenHeight} onSelect={handleSelectedPerson} />
    </section>
  </section>
</section>
