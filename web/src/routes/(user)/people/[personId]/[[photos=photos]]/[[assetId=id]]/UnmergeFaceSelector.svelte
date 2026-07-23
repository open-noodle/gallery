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
    // Only ask for shared-space candidates when the source itself is a space person. A normal
    // owned person must keep seeing own people only — surfacing shared-space people here too
    // would let picking one send a shared-space id to the personal reassignFaces branch below,
    // recreating #765's id-mismatch bug in reverse.
    const data = await getAllPeople({ withHidden: false, ...(spaceRef && { withSharedSpaces: true }) });
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
  // spaceRef is a parameter (not read from the closure) so the "only call this for a space
  // source" invariant lives with the callers, who already narrow it via `if (spaceRef)`.
  const reassignInSpace = async (
    spaceRef: { spaceId: string; personId: string },
    target: { type: 'new' } | { type: 'existing'; profile: ScopedPersonProfileRefDto },
  ) => {
    const { reassigned } = await reassignSpacePersonFaces({
      id: spaceRef.spaceId,
      personId: spaceRef.personId,
      sharedSpacePersonReassignDto: { assetIds, target },
    });
    return reassigned;
  };

  const handleCreate = async () => {
    const timeout = setTimeout(() => (showLoadingSpinnerCreate = true), timeBeforeShowLoadingSpinner);

    // onConfirm() drives the caller's optimistic removal (+page.svelte -> timelineManager.removeAssets).
    // Only fire it when something actually moved — a reassigned: 0 result already surfaces the
    // danger toast below, and advancing the UI as if it succeeded would empty the grid of assets
    // that never left. Left true on a thrown error, matching existing behaviour on that path.
    let shouldConfirm = true;

    try {
      disableButtons = true;
      let reassigned: number;
      if (spaceRef) {
        reassigned = await reassignInSpace(spaceRef, { type: 'new' });
      } else {
        const data = await createPerson({ personCreateDto: {} });
        await reassignFaces({ id: data.id, assetFaceUpdateDto: { data: selectedPeople } });
        reassigned = assetIds.length;
      }

      if (reassigned > 0) {
        toastManager.primary($t('reassigned_assets_to_new_person', { values: { count: reassigned } }));
      } else {
        toastManager.danger($t('errors.unable_to_reassign_assets_new_person'));
        shouldConfirm = false;
      }
    } catch (error) {
      handleError(error, $t('errors.unable_to_reassign_assets_new_person'));
    } finally {
      clearTimeout(timeout);
    }

    showLoadingSpinnerCreate = false;
    disableButtons = false;
    if (shouldConfirm) {
      onConfirm();
    }
  };

  const handleReassign = async () => {
    const timeout = setTimeout(() => (showLoadingSpinnerReassign = true), timeBeforeShowLoadingSpinner);
    // See handleCreate: only fire onConfirm's optimistic removal when something actually moved.
    let shouldConfirm = true;
    try {
      disableButtons = true;
      if (selectedPerson) {
        let reassigned: number;
        if (spaceRef) {
          reassigned = await reassignInSpace(spaceRef, {
            type: 'existing',
            profile: toScopedPersonRef(selectedPerson),
          });
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
          shouldConfirm = false;
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
    disableButtons = false;
    if (shouldConfirm) {
      onConfirm();
    }
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
