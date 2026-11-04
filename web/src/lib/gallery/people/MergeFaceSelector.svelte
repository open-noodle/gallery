<script lang="ts">
  import { goto } from '$app/navigation';
  import PeopleMergeSelector from '$lib/components/people/people-merge-selector.svelte';
  import { Route } from '$lib/route';
  import { getGlobalPersonThumbnailUrl } from '$lib/utils/global-person-route';
  import {
    createCrossOwnerMergeHandlers,
    runMergeWithCrossOwnerConfirmation,
    runScopedMergeWithCrossOwnerConfirmation,
  } from '$lib/utils/cross-owner-merge';
  import { isSpaceScopedPerson, toScopedPersonRef } from '$lib/utils/scoped-person-ref';
  import {
    getAllPeople,
    getPerson,
    mergePersonLegacy,
    searchPerson,
    type BulkIdResponseDto,
    type PersonResponseDto,
  } from '@immich/sdk';
  import { toastManager } from '@immich/ui';
  import { t } from 'svelte-i18n';

  // The person page's merge view: upstream's MergeFaceSelector props, with the merge routed for
  // space people and the cross-owner confirmation.
  interface Props {
    person: PersonResponseDto;
    onBack: () => void;
    onMerge: (mergedPerson: PersonResponseDto) => void;
  }

  let { person, onBack, onMerge }: Props = $props();

  const getScopedThumbnailUrl = (person: PersonResponseDto) => getGlobalPersonThumbnailUrl(person);

  const getMergeDisplayName = (person: PersonResponseDto) => person.name;

  const loadMergePeople = async (sortFaces: boolean, person: PersonResponseDto) => {
    const data = await getAllPeople({
      withHidden: false,
      withSharedSpaces: true,
      closestPersonId: sortFaces ? person.id : undefined,
    });
    return data.people;
  };

  // Runs a scoped merge, transparently handling the cross-owner boundary (issue #733):
  // - a descriptive `blocked` error is shown as a clean toast (never the raw server string);
  // - a `confirmationRequired` response prompts a strong confirmation, then re-runs with the
  //   acknowledgement so the server commits the cross-owner merge.
  // Returns the number of merged people, or `undefined` when nothing was merged (blocked/declined).
  const mergeScopedPeopleWithCrossOwnerConfirmation = async (
    targetPerson: PersonResponseDto,
    sourcePeople: PersonResponseDto[],
  ): Promise<number | undefined> => {
    const committed = await runScopedMergeWithCrossOwnerConfirmation(
      {
        target: toScopedPersonRef(targetPerson),
        sources: sourcePeople.map((sourcePerson) => toScopedPersonRef(sourcePerson)),
      },
      createCrossOwnerMergeHandlers(),
    );
    return committed ? sourcePeople.length : undefined;
  };

  // Same as above, for the classic `POST /people/:id/merge` endpoint, which can now also 403/409
  // across an owner boundary. Returns the number of *successfully* merged sources (mirroring the
  // per-id BulkIdResponseDto results), or `undefined` when nothing was merged (blocked/declined).
  const mergePersonWithCrossOwnerConfirmation = async (
    targetPerson: PersonResponseDto,
    sourcePeople: PersonResponseDto[],
  ): Promise<number | undefined> => {
    let results: BulkIdResponseDto[] = [];
    const committed = await runMergeWithCrossOwnerConfirmation(async (confirmCrossOwner) => {
      results = await mergePersonLegacy({
        id: targetPerson.id,
        mergePersonDto: confirmCrossOwner
          ? { ids: sourcePeople.map(({ id }) => id), confirmCrossOwner: true }
          : { ids: sourcePeople.map(({ id }) => id) },
      });
    }, createCrossOwnerMergeHandlers());
    return committed ? results.filter(({ success }) => success).length : undefined;
  };

  const mergePeople = async (targetCandidate: PersonResponseDto, selectedPeople: PersonResponseDto[]) => {
    const targetPerson = person;
    const sourcePeople =
      targetCandidate.id === targetPerson.id
        ? selectedPeople
        : [targetCandidate, ...selectedPeople.filter((selectedPerson) => selectedPerson.id !== targetPerson.id)];
    const usesScopedRepair =
      isSpaceScopedPerson(targetPerson) || sourcePeople.some((sourcePerson) => isSpaceScopedPerson(sourcePerson));

    const mergedCount = usesScopedRepair
      ? await mergeScopedPeopleWithCrossOwnerConfirmation(targetPerson, sourcePeople)
      : await mergePersonWithCrossOwnerConfirmation(targetPerson, sourcePeople);

    if (mergedCount === undefined) {
      // Cross-owner merge was blocked or the user declined the confirmation — nothing merged.
      return;
    }

    const mergedPerson = await getPerson({ id: targetPerson.id });
    toastManager.primary($t('merged_people_count', { values: { count: mergedCount } }));
    return mergedPerson;
  };

  const handleSwapMergePerson = async (person: PersonResponseDto) => {
    const profile = person.primaryProfile;
    if (profile?.type === 'space-person' && profile.spaceId) {
      await goto(
        Route.viewSpacePerson(profile.spaceId, profile.id, { previousRoute: Route.people(), action: 'merge' }),
      );
      return;
    }

    await goto(Route.viewPerson(person, { previousRoute: Route.people(), action: 'merge' }));
  };
</script>

<PeopleMergeSelector
  {person}
  getDisplayName={getMergeDisplayName}
  getThumbnailUrl={getScopedThumbnailUrl}
  loadPeople={loadMergePeople}
  {mergePeople}
  searchPeople={(name) => searchPerson({ name, withHidden: true, withSharedSpaces: true })}
  {onBack}
  {onMerge}
  onSwapPerson={handleSwapMergePerson}
/>
