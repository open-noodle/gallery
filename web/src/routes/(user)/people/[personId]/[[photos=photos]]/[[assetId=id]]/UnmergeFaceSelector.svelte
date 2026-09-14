<script lang="ts">
  import { timeBeforeShowLoadingSpinner } from '$lib/constants';
  import { handleError } from '$lib/utils/handle-error';
  import { isSpaceScopedPerson, toScopedPersonRef } from '$lib/utils/scoped-person-ref';
  import {
    createPerson,
    getAllPeople,
    getSpacePeople,
    reassignFaces,
    reassignSpacePersonFaces,
    Type as ScopedPrimaryProfileType,
    Type3 as SpaceReassignNewTarget,
    Type4 as SpaceReassignExistingTarget,
    type AssetFaceUpdateItem,
    type PersonResponseDto,
    type SharedSpacePersonReassignDto,
    type SharedSpacePersonResponseDto,
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

  // The source space-person id (and its space id) live on primaryProfile, not on personAssets.id
  // itself — sending personAssets.id to the space endpoint would match zero rows.
  const spaceRef = $derived(
    isSpaceScopedPerson(personAssets) && personAssets.primaryProfile?.spaceId
      ? { spaceId: personAssets.primaryProfile.spaceId, personId: personAssets.primaryProfile.id }
      : undefined,
  );

  // The space people endpoint caps limit at 100 (same page size the space People tab loads with).
  const SPACE_PEOPLE_LIMIT = 100;

  // A space person carries no `person` row, so it is shaped into the PersonResponseDto the picker
  // renders. primaryProfile is the load-bearing field: FaceThumbnail resolves the avatar through it,
  // and toScopedPersonRef turns it into the space-scoped target ref the endpoint expects.
  const toSpaceCandidate = (person: SharedSpacePersonResponseDto, spaceId: string): PersonResponseDto => ({
    id: person.id,
    name: person.name,
    birthDate: person.birthDate ?? null,
    thumbnailPath: person.thumbnailPath,
    isHidden: person.isHidden,
    updatedAt: person.updatedAt,
    primaryProfile: { type: ScopedPrimaryProfileType.SpacePerson, id: person.id, spaceId },
  });

  onMount(async () => {
    // A space source may only reassign into a person of ITS OWN space: the endpoint rejects any other
    // target with "Target person not found in this space". getAllPeople({ withSharedSpaces: true })
    // spans every space the viewer belongs to and collapses each identity to one primary profile, so
    // it offers cross-space candidates that can only ever 400 — and hides the in-space profile of any
    // identity whose primary profile lives elsewhere. Ask the space itself for its people instead.
    if (spaceRef) {
      const spacePeople = await getSpacePeople({
        id: spaceRef.spaceId,
        limit: SPACE_PEOPLE_LIMIT,
        withHidden: false,
      });
      people = spacePeople.map((person) => toSpaceCandidate(person, spaceRef.spaceId));
      return;
    }

    // A normal owned person must keep seeing own people only — surfacing shared-space people here
    // would let picking one send a shared-space id to the personal reassignFaces branch below,
    // recreating #765's id-mismatch bug in reverse.
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

  // SharedSpacePersonReassignDto.assetIds is capped at 100 server-side, and "Select all" on this very
  // toolbar is unbounded — a >100 selection would 400 outright. Chunk instead.
  const SPACE_REASSIGN_ASSET_ID_LIMIT = 100;

  // Shared by both handlers so create/reassign cannot drift on the space-endpoint call shape.
  // spaceRef is a parameter (not read from the closure) so the "only call this for a space
  // source" invariant lives with the callers, who already narrow it via `if (spaceRef)`.
  //
  // Chunks are issued sequentially and their server-reported counts summed. A throw from any chunk
  // propagates: the callers treat a partially-applied reassign as a failure (danger toast, no
  // optimistic removal), which is the only safe reading when we cannot know what landed.
  // Caveat for a `new` target beyond one chunk: the endpoint mints the new person per request, so a
  // >100 selection lands as one new person per chunk. Strictly better than the 400 it used to be.
  const reassignInSpace = async (
    spaceRef: { spaceId: string; personId: string },
    target: SharedSpacePersonReassignDto['target'],
  ) => {
    let reassigned = 0;
    for (let offset = 0; offset < assetIds.length; offset += SPACE_REASSIGN_ASSET_ID_LIMIT) {
      const result = await reassignSpacePersonFaces({
        id: spaceRef.spaceId,
        personId: spaceRef.personId,
        sharedSpacePersonReassignDto: {
          assetIds: assetIds.slice(offset, offset + SPACE_REASSIGN_ASSET_ID_LIMIT),
          target,
        },
      });
      reassigned += result.reassigned;
    }
    return reassigned;
  };

  const handleCreate = async () => {
    const timeout = setTimeout(() => (showLoadingSpinnerCreate = true), timeBeforeShowLoadingSpinner);

    // onConfirm() drives the caller's optimistic removal (+page.svelte -> timelineManager.removeAssets).
    // Only fire it when something actually moved — a reassigned: 0 result already surfaces the
    // danger toast below, and advancing the UI as if it succeeded would empty the grid of assets
    // that never left. A thrown error means the same thing (nothing we can rely on moved), so the
    // catch clears it too: the space endpoint can reject outright (Editor gate, assetIds cap) and a
    // danger toast plus a silently emptied grid is exactly #765's symptom relocated.
    let shouldConfirm = true;

    try {
      disableButtons = true;
      let reassigned: number;
      if (spaceRef) {
        reassigned = await reassignInSpace(spaceRef, { type: SpaceReassignNewTarget.New });
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
      shouldConfirm = false;
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
            type: SpaceReassignExistingTarget.Existing,
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
      shouldConfirm = false;
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
