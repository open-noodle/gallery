<script lang="ts">
  import { afterNavigate, goto, invalidateAll } from '$app/navigation';
  import { page } from '$app/stores';
  import { clickOutside } from '$lib/actions/click-outside';
  import { listNavigation } from '$lib/actions/list-navigation';
  import { scrollMemoryClearer } from '$lib/actions/scroll-memory';
  import ImageThumbnail from '$lib/components/assets/thumbnail/ImageThumbnail.svelte';
  import PeopleMergeSelector from '$lib/components/people/people-merge-selector.svelte';
  import OnEvents from '$lib/components/OnEvents.svelte';
  import ButtonContextMenu from '$lib/components/shared-components/context-menu/ButtonContextMenu.svelte';
  import MenuOption from '$lib/components/shared-components/context-menu/MenuOption.svelte';
  import ControlAppBar from '$lib/components/shared-components/ControlAppBar.svelte';
  import ArchiveAction from '$lib/components/timeline/actions/ArchiveAction.svelte';
  import ChangeDate from '$lib/components/timeline/actions/ChangeDateAction.svelte';
  import ChangeDescription from '$lib/components/timeline/actions/ChangeDescriptionAction.svelte';
  import ChangeLocation from '$lib/components/timeline/actions/ChangeLocationAction.svelte';
  import CreateSharedLink from '$lib/components/timeline/actions/CreateSharedLinkAction.svelte';
  import DeleteAssets from '$lib/components/timeline/actions/DeleteAssetsAction.svelte';
  import DownloadAction from '$lib/components/timeline/actions/DownloadAction.svelte';
  import FavoriteAction from '$lib/components/timeline/actions/FavoriteAction.svelte';
  import SelectAllAssets from '$lib/components/timeline/actions/SelectAllAction.svelte';
  import SetVisibilityAction from '$lib/components/timeline/actions/SetVisibilityAction.svelte';
  import TagAction from '$lib/components/timeline/actions/TagAction.svelte';
  import AssetSelectControlBar from '$lib/components/timeline/AssetSelectControlBar.svelte';
  import Timeline from '$lib/components/timeline/Timeline.svelte';
  import TimelineRouteGroupingBar from '$lib/components/timeline/TimelineRouteGroupingBar.svelte';
  import SearchAddAllToCollectionModal from '$lib/modals/SearchAddAllToCollectionModal.svelte';
  import { PersonPageViewMode, QueryParameter, SessionStorageKey } from '$lib/constants';
  import { assetMultiSelectManager } from '$lib/managers/asset-multi-select-manager.svelte';
  import { authManager } from '$lib/managers/auth-manager.svelte';
  import { featureFlagsManager } from '$lib/managers/feature-flags-manager.svelte';
  import { TimelineManager } from '$lib/managers/timeline-manager/timeline-manager.svelte';
  import type { TimelineAsset, TimelineGrouping, TimelineTemporalAnchor } from '$lib/managers/timeline-manager/types';
  import PersonMergeSuggestionModal from '$lib/modals/PersonMergeSuggestionModal.svelte';
  import PersonSuggestionBanner from '$lib/components/faces-page/person-suggestion-banner.svelte';
  import PersonSuggestionReviewModal from '$lib/modals/PersonSuggestionReviewModal.svelte';
  import RepresentativeFacePickerModal from '$lib/modals/RepresentativeFacePickerModal.svelte';
  import { Route } from '$lib/route';
  import { getAssetBulkActions } from '$lib/services/asset.service';
  import {
    getPersonActions,
    getPersonFacesPage,
    getPersonFaceThumbnail,
    isSpaceEditor,
    updatePersonName,
    updatePersonRepresentativeFace,
  } from '$lib/services/person.service';
  import { lang, locale } from '$lib/stores/preferences.store';
  import { websocketEvents } from '$lib/stores/websocket';
  import { createUrl, getPeopleThumbnailUrl } from '$lib/utils';
  import {
    createCrossOwnerMergeHandlers,
    runMergeWithCrossOwnerConfirmation,
    runScopedMergeWithCrossOwnerConfirmation,
  } from '$lib/utils/cross-owner-merge';
  import { handleError } from '$lib/utils/handle-error';
  import { isExternalUrl } from '$lib/utils/navigation';
  import { isSpaceScopedPerson, toScopedPersonRef } from '$lib/utils/scoped-person-ref';
  import { normalizeSearchString } from '$lib/utils/string-utils';
  import { getTimelineBucketZoomTarget, type ActivatableTimelineBucket } from '$lib/utils/timeline-zoom-navigation';
  import { getTimelineTopVisibleAnchor } from '$lib/managers/timeline-manager/timeline-anchor';

  import {
    AssetVisibility,
    confirmPersonFaceSuggestion,
    confirmSpacePersonFaceSuggestion,
    detachScopedPerson,
    dismissPersonFaceSuggestion,
    dismissSpacePersonFaceSuggestion,
    getAllPeople,
    getPersonFaceSuggestions,
    getPerson,
    getSpacePersonFaceSuggestions,
    ignorePersonFaceSuggestion,
    ignoreSpacePersonFaceSuggestion,
    mergePerson,
    searchPerson,
    Type2 as ScopedPersonProfileType,
    type BulkIdResponseDto,
    type PersonFaceResponseDto,
    type PersonFaceSuggestionResponseDto,
    type PersonResponseDto,
  } from '@immich/sdk';
  import {
    ActionButton,
    CommandPaletteDefaultProvider,
    ContextMenuButton,
    LoadingSpinner,
    modalManager,
    toastManager,
    type ActionItem,
  } from '@immich/ui';
  import { mdiAccountBoxOutline, mdiAccountMultipleCheckOutline, mdiArrowLeft, mdiDotsVertical } from '@mdi/js';
  import { DateTime } from 'luxon';
  import { onMount } from 'svelte';
  import { t } from 'svelte-i18n';
  import type { PageData } from './$types';
  import EditNameInput from './EditNameInput.svelte';
  import { getPersonFamilyRelations, type PersonFamilyRelations } from './family-relations';
  import FamilyLinkDialog from '$lib/components/family/FamilyLinkDialog.svelte';
  import FamilyRelationsPanel from './FamilyRelationsPanel.svelte';
  import UnmergeFaceSelector from './UnmergeFaceSelector.svelte';

  interface Props {
    data: PageData;
  }

  let { data }: Props = $props();

  let person = $derived(data.person);
  let thumbnailData = $derived(getScopedThumbnailUrl(person));

  // Gallery-fork: family relationships, slice 8. Loaded outside `data` (rather than the page's
  // own `load`) because it must never block the rest of the page — a viewer with no family
  // access, or an instance with the feature disabled, still gets the whole person page instantly.
  let familyRelations = $state<PersonFamilyRelations>({ access: 'none', relations: [] });
  // The panel has always rendered an "Add a relationship" button, but the handler prop is
  // optional and this page never passed one — so it rendered `onclick={undefined}` and did
  // nothing at all. It opens the same dialog the /family page uses.
  let linkingRelationship = $state(false);
  const refreshFamilyRelations = (targetPerson: typeof person) =>
    getPersonFamilyRelations(targetPerson).then((result) => {
      // Guard against a slower, now-stale response landing after the viewer has already
      // navigated to a different person's page.
      if (person.id === targetPerson.id) {
        familyRelations = result;
      }
    });

  $effect(() => {
    void refreshFamilyRelations(person);
  });

  let timelineManager = $state<TimelineManager>() as TimelineManager;
  let timelineGrouping = $state<TimelineGrouping>('day');
  let temporalAnchor = $state<TimelineTemporalAnchor | undefined>();
  let numberOfAssets = $derived(timelineManager?.isInitialized ? timelineManager.assetCount : data.statistics.assets);

  const handleAddAllToCollection = () => {
    void modalManager.show(SearchAddAllToCollectionModal, {
      terms: {
        visibility: AssetVisibility.Timeline,
        personIds: [data.person.filterId ?? data.person.id],
        withSharedSpaces: true,
      },
      total: numberOfAssets,
      smartSearchEnabled: false,
      language: $lang,
    });
  };
  const baseTimelineOptions = $derived({
    visibility: AssetVisibility.Timeline,
    personIds: [data.person.filterId ?? data.person.id],
    withSharedSpaces: true,
  });
  const options = $derived({
    ...baseTimelineOptions,
    grouping: timelineGrouping,
  });

  let viewMode: PersonPageViewMode = $state(PersonPageViewMode.VIEW_ASSETS);
  let isEditingName = $state(false);
  let previousRoute = $state<string>(Route.explore());
  let personMerge1: PersonResponseDto | undefined = $state();
  let personMerge2: PersonResponseDto | undefined = $state();
  let potentialMergePeople: PersonResponseDto[] = $state([]);
  let isSuggestionSelectedByUser = $state(false);

  let personName = $derived(person.name);
  let suggestedPeople: PersonResponseDto[] = $state([]);

  /**
   * Save the word used to search people name: for example,
   * if searching 'r' and the server returns 15 people with names starting with 'r',
   * there's no need to search again people with name starting with 'ri'.
   * However, it needs to make a new api request if searching 'r' returns 20 names (arbitrary value, the limit sent back by the server).
   * or if the new search word starts with another word / letter
   **/
  let isSearchingPeople = $state(false);
  let suggestionContainer: HTMLElement | undefined = $state();

  function getScopedThumbnailUrl(person: PersonResponseDto, updatedAt?: string): string {
    const profile = person.primaryProfile;
    if (profile?.type === 'space-person' && profile.spaceId) {
      return createUrl(`/shared-spaces/${profile.spaceId}/people/${profile.id}/thumbnail`, {
        updatedAt: updatedAt ?? person.updatedAt,
      });
    }
    return getPeopleThumbnailUrl(person, updatedAt);
  }

  onMount(() => {
    const action = $page.url.searchParams.get(QueryParameter.ACTION);
    const getPreviousRoute = $page.url.searchParams.get(QueryParameter.PREVIOUS_ROUTE);
    if (getPreviousRoute && !isExternalUrl(getPreviousRoute)) {
      previousRoute = getPreviousRoute;
    } else if ($page.params.assetId) {
      previousRoute = Route.viewPerson(data.person);
    }
    if (action == 'merge') {
      viewMode = PersonPageViewMode.MERGE_PEOPLE;
    }

    return websocketEvents.on('on_person_thumbnail', (personId: string) => {
      if (person.id === personId) {
        thumbnailData = getScopedThumbnailUrl(person, Date.now().toString());
      }
    });
  });

  const handleEscape = async () => {
    if (assetMultiSelectManager.selectionActive) {
      assetMultiSelectManager.clear();
      return;
    }

    await goto(previousRoute);
    return;
  };

  const updateAssetCount = async () => {
    await invalidateAll();
  };

  afterNavigate(({ from }) => {
    // Prevent setting previousRoute to the current page.
    if (from?.url && from.route.id !== $page.route.id) {
      previousRoute = from.url.href;
    }
  });

  const handleUnmerge = () => {
    timelineManager.removeAssets(assetMultiSelectManager.assets.map((a) => a.id));
    assetMultiSelectManager.clear();
    viewMode = PersonPageViewMode.VIEW_ASSETS;
  };

  const handleReassignAssets = () => {
    viewMode = PersonPageViewMode.UNASSIGN_ASSETS;
  };

  const handleMerge = async (person: PersonResponseDto) => {
    await updateAssetCount();
    await handleGoBack();

    data = { ...data, person };
  };

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
      results = await mergePerson({
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

  const handleMergeSuggestion = async (): Promise<{ merged: boolean }> => {
    if (!personMerge1 || !personMerge2) {
      return { merged: false };
    }

    const result = await modalManager.show(PersonMergeSuggestionModal, {
      personToMerge: personMerge1,
      personToBeMergedInto: personMerge2,
      potentialMergePeople,
    });

    if (!result) {
      return { merged: false };
    }

    const [, personToBeMergedInto] = result;

    if (personToBeMergedInto.name != personName && person.id === personToBeMergedInto.id) {
      await updateAssetCount();
      return { merged: true };
    }
    await goto(Route.viewPerson(personToBeMergedInto), { replaceState: true });
    return { merged: true };
  };

  const handleSuggestPeople = async (person2: PersonResponseDto) => {
    isEditingName = false;
    if (person.id !== person2.id) {
      potentialMergePeople = [];
      personMerge1 = person;
      personMerge2 = person2;
      isSuggestionSelectedByUser = true;

      await handleMergeSuggestion();
    }
  };

  const changeName = async () => {
    viewMode = PersonPageViewMode.VIEW_ASSETS;
    person.name = personName;
    isEditingName = false;

    if (isSuggestionSelectedByUser) {
      // User canceled the merge
      isSuggestionSelectedByUser = false;
      return;
    }

    try {
      person = await updatePersonName(person, personName);
      toastManager.primary($t('change_name_successfully'));
    } catch (error) {
      handleError(error, $t('errors.unable_to_save_name'));
    }
  };

  const handleCancelEditName = () => {
    isSearchingPeople = false;
    isEditingName = false;
  };

  const handleNameChange = async (name: string) => {
    isEditingName = false;
    potentialMergePeople = [];
    personName = name;

    if (person.name === personName) {
      return;
    }
    if (name === '') {
      await changeName();
      return;
    }

    const result = await searchPerson({ name: personName, withHidden: true });

    const normalizedPersonName = normalizeSearchString(personName);
    const existingPerson = result.find(
      ({ name, id }: PersonResponseDto) =>
        normalizeSearchString(name) === normalizedPersonName && id !== person.id && name,
    );
    if (existingPerson) {
      personMerge2 = existingPerson;
      personMerge1 = person;
      potentialMergePeople = result
        .filter(
          (person: PersonResponseDto) =>
            normalizeSearchString(personMerge2?.name ?? '') === normalizeSearchString(person.name) &&
            person.id !== personMerge2?.id &&
            person.id !== personMerge1?.id &&
            !person.isHidden,
        )
        .slice(0, 3);
      const { merged } = await handleMergeSuggestion();
      if (merged) {
        return;
      }
    }
    await changeName();
  };

  const handleGoBack = async () => {
    viewMode = PersonPageViewMode.VIEW_ASSETS;
    if ($page.url.searchParams.has(QueryParameter.ACTION)) {
      $page.url.searchParams.delete(QueryParameter.ACTION);
      await goto($page.url);
    }
  };

  const handleDeleteAssets = async (assetIds: string[]) => {
    timelineManager.removeAssets(assetIds);
    await updateAssetCount();
  };

  const handleUndoDeleteAssets = async (assets: TimelineAsset[]) => {
    timelineManager.upsertAssets(assets);
    await updateAssetCount();
  };

  // Space-person writes need the editor role; default to offering the actions until the
  // membership resolves (the server enforces the role on every write regardless).
  let canEditSpacePerson = $state(true);
  $effect(() => {
    const profile = person.primaryProfile;
    canEditSpacePerson = true;
    if (profile?.type === 'space-person' && profile.spaceId) {
      const spaceId = profile.spaceId;
      void isSpaceEditor(spaceId, authManager.user.id).then((editable) => {
        if (person.primaryProfile?.spaceId === spaceId) {
          canEditSpacePerson = editable;
        }
      });
    }
  });

  let suggestionTotal = $state(0);
  let suggestionPreviews = $state<PersonFaceSuggestionResponseDto[]>([]);

  type SuggestionTarget = { type: 'person'; personId: string } | { type: 'space'; spaceId: string; personId: string };

  /**
   * A space member who holds no person row for this identity reaches the shared person through this
   * (global) route from the main People list — their primary profile IS the space profile, and the
   * owner-only person endpoints do not know that id. Route those reads and verdicts at the shared
   * space endpoints instead, so suggestions are not a /spaces-only affordance. The server returns an
   * empty page to members below editor, which keeps the banner hidden for viewers.
   */
  const getSuggestionTarget = (target: PersonResponseDto): SuggestionTarget => {
    const profile = target.primaryProfile;
    return profile?.type === 'space-person' && profile.spaceId
      ? { type: 'space', spaceId: profile.spaceId, personId: profile.id }
      : { type: 'person', personId: target.id };
  };

  const fetchSuggestions = (target: SuggestionTarget, page: number, size: number) =>
    target.type === 'space'
      ? getSpacePersonFaceSuggestions({ id: target.spaceId, personId: target.personId, page, size })
      : getPersonFaceSuggestions({ id: target.personId, page, size });

  // F24/S11b: the four action endpoints answer 200 with `{ acted }` — the acted/no-op signal is in the body
  // precisely because `oazapfts.ok()` resolves to the body and discards the status code for every 2xx, so a
  // 200-vs-204 contract could never reach a caller. These pass straight through to the modal; a genuine
  // 4xx/5xx still rejects into its handleError path.
  const confirmSuggestion = (target: SuggestionTarget, assetFaceId: string) =>
    target.type === 'space'
      ? confirmSpacePersonFaceSuggestion({ id: target.spaceId, personId: target.personId, assetFaceId })
      : confirmPersonFaceSuggestion({ id: target.personId, assetFaceId });

  const dismissSuggestion = (target: SuggestionTarget, assetFaceId: string) =>
    target.type === 'space'
      ? dismissSpacePersonFaceSuggestion({ id: target.spaceId, personId: target.personId, assetFaceId })
      : dismissPersonFaceSuggestion({ id: target.personId, assetFaceId });

  const ignoreSuggestion = (target: SuggestionTarget, assetFaceId: string) =>
    target.type === 'space'
      ? ignoreSpacePersonFaceSuggestion({ id: target.spaceId, personId: target.personId, assetFaceId })
      : ignorePersonFaceSuggestion({ id: target.personId, assetFaceId });

  const loadSuggestionSummary = async (currentPerson: PersonResponseDto) => {
    try {
      const res = await fetchSuggestions(getSuggestionTarget(currentPerson), 1, 5);
      if (currentPerson.id !== person.id) {
        return;
      }
      suggestionTotal = res.total;
      suggestionPreviews = res.items;
    } catch {
      if (currentPerson.id !== person.id) {
        return;
      }
      suggestionTotal = 0;
      suggestionPreviews = [];
    }
  };

  const openSuggestionReview = async () => {
    const currentPerson = person;
    const currentTarget = getSuggestionTarget(currentPerson);
    const currentThumbnailUrl = getScopedThumbnailUrl(currentPerson);

    const result = await modalManager.show(PersonSuggestionReviewModal, {
      person: currentPerson,
      referenceThumbnailUrl: currentThumbnailUrl,
      loadPage: ({ page, size }: { page: number; size: number }) => fetchSuggestions(currentTarget, page, size),
      confirm: (assetFaceId: string) => confirmSuggestion(currentTarget, assetFaceId),
      dismiss: (assetFaceId: string) => dismissSuggestion(currentTarget, assetFaceId),
      ignore: (assetFaceId: string) => ignoreSuggestion(currentTarget, assetFaceId),
    });
    await loadSuggestionSummary(currentPerson);
    if (result && result.confirmed > 0) {
      await invalidateAll();
      thumbnailData = getScopedThumbnailUrl(person, Date.now().toString());
    }
  };

  const handleSetVisibility = (assetIds: string[]) => {
    timelineManager.removeAssets(assetIds);
    assetMultiSelectManager.clear();
  };

  function handleTimelineGroupingChange(grouping: TimelineGrouping) {
    const anchor = getTimelineTopVisibleAnchor(timelineManager);
    timelineGrouping = grouping;
    temporalAnchor = anchor;
  }

  function handleTimelineBucketActivate(bucket: ActivatableTimelineBucket) {
    if (assetMultiSelectManager.selectionActive) {
      return;
    }

    const result = getTimelineBucketZoomTarget(bucket);
    if (!result) {
      return;
    }

    timelineGrouping = result.grouping;
    temporalAnchor = result.anchor;
  }

  const onPersonUpdate = async (response: PersonResponseDto) => {
    if (response.id !== person.id) {
      return;
    }

    if (response.isHidden) {
      await goto(previousRoute);
      return;
    }

    person = response;
  };

  const handlePersonAssetDelete = async ({ id, assetId }: { id: string; assetId: string }) => {
    if (id !== person.id) {
      return;
    }
    timelineManager.removeAssets([assetId]);
    await updateAssetCount();
  };

  const { SetDateOfBirth, Favorite, Unfavorite, HidePerson, ShowPerson } = $derived(
    getPersonActions($t, person, { canEditSpacePerson }),
  );
  const SelectRepresentativeFace: ActionItem = {
    title: $t('select_representative_face'),
    icon: mdiAccountBoxOutline,
    $if: () => canEditSpacePerson,
    onAction: async () => {
      const updated = await modalManager.show(RepresentativeFacePickerModal, {
        title: $t('select_representative_face'),
        loadFaces: ({ page, size }: { page: number; size: number }) => getPersonFacesPage(person, { page, size }),
        updateFace: async (faceId: string) => {
          person = await updatePersonRepresentativeFace(person, faceId);
        },
        getThumbnailUrl: (face: PersonFaceResponseDto) => getPersonFaceThumbnail(person, face.id),
        canUpdate: true,
      });

      if (updated) {
        thumbnailData = getScopedThumbnailUrl(person, Date.now().toString());
      }
    },
  };

  const Merge: ActionItem = {
    title: $t('merge_people'),
    icon: mdiAccountMultipleCheckOutline,
    $if: () => canEditSpacePerson,
    onAction: () => {
      viewMode = PersonPageViewMode.MERGE_PEOPLE;
    },
  };

  const SeparateFromGroupedPerson: ActionItem = {
    title: $t('separate_from_grouped_person'),
    icon: mdiAccountMultipleCheckOutline,
    onAction: async () => {
      const isConfirm = await modalManager.showDialog({ prompt: $t('separate_from_grouped_person_prompt') });
      if (!isConfirm) {
        return;
      }

      try {
        await detachScopedPerson({
          detachScopedPersonDto: { profile: { type: ScopedPersonProfileType.Person, id: person.id } },
        });
        await invalidateAll();
        toastManager.primary($t('separate_from_grouped_person'));
      } catch (error) {
        handleError(error, $t('errors.unable_to_save_name'));
      }
    },
  };

  $effect(() => {
    const currentPerson = person;
    suggestionTotal = 0;
    suggestionPreviews = [];
    void loadSuggestionSummary(currentPerson);
  });
</script>

<OnEvents
  {onPersonUpdate}
  onPersonAssetDelete={handlePersonAssetDelete}
  onAssetsDelete={updateAssetCount}
  onAssetsArchive={updateAssetCount}
  onAssetsUnarchive={updateAssetCount}
/>

<main
  class="relative z-0 flex h-dvh flex-col overflow-hidden px-2 pt-(--control-bar-height) md:px-6 md:pt-(--control-bar-height-md)"
  use:scrollMemoryClearer={{
    routeStartsWith: Route.people(),
    beforeClear: () => {
      sessionStorage.removeItem(SessionStorageKey.INFINITE_SCROLL_PAGE);
    },
  }}
>
  <!-- Sticky grouping switcher: lives outside the scrolling timeline so it stays visible (see Tags).
       mt-12 clears the taller ControlAppBar, which exceeds the --control-bar-height padding reserve. -->
  <TimelineRouteGroupingBar
    grouping={timelineGrouping}
    hidden={assetMultiSelectManager.selectionActive || viewMode !== PersonPageViewMode.VIEW_ASSETS}
    class="mt-12 shrink-0"
    resultCount={numberOfAssets}
    onGroupingChange={handleTimelineGroupingChange}
    onAddAllToCollection={handleAddAllToCollection}
  />
  <div class="relative min-h-0 flex-1">
    {#key person.id}
      <Timeline
        enableRouting={true}
        {person}
        bind:timelineManager
        {options}
        assetInteraction={assetMultiSelectManager}
        onEscape={handleEscape}
        {temporalAnchor}
        onTimelineBucketActivate={handleTimelineBucketActivate}
        onTemporalAnchorResolved={() => (temporalAnchor = undefined)}
        grouping={timelineGrouping}
        onGroupingChange={handleTimelineGroupingChange}
      >
        {#if viewMode === PersonPageViewMode.VIEW_ASSETS}
          <!-- Person information block -->
          <div
            class="relative p-4 pt-12 sm:px-6"
            use:clickOutside={{
              onOutclick: handleCancelEditName,
              onEscape: handleCancelEditName,
            }}
            use:listNavigation={suggestionContainer}
          >
            <div class="flex flex-wrap items-center gap-4" data-testid="person-timeline-header">
              <section class="flex w-fit place-items-center border-black" data-testid="person-timeline-identity">
                {#if isEditingName}
                  <EditNameInput
                    {person}
                    bind:suggestedPeople
                    name={person.name}
                    bind:isSearchingPeople
                    onChange={handleNameChange}
                    {thumbnailData}
                  />
                {:else}
                  <div class="relative">
                    <button
                      type="button"
                      class="flex items-center justify-center"
                      title={canEditSpacePerson ? $t('edit_name') : undefined}
                      onclick={() => (isEditingName = canEditSpacePerson)}
                    >
                      <ImageThumbnail
                        circle
                        shadow
                        url={thumbnailData}
                        altText={person.name}
                        widthStyle="3.375rem"
                        heightStyle="3.375rem"
                      />
                      <div class="flex flex-col justify-center px-4 text-start text-primary">
                        <p class="w-40 truncate font-medium">{person.name || $t('add_a_name')}</p>
                        <p class="text-sm text-gray-500 dark:text-gray-400">
                          {$t('assets_count', { values: { count: numberOfAssets } })}
                        </p>
                        {#if featureFlagsManager.value.peopleStatistics}
                          <p class="text-sm text-gray-500 dark:text-gray-400">
                            {$t('faces_count', { values: { count: data.statistics.faces } })}
                          </p>
                        {/if}
                        {#if person.birthDate}
                          <p class="text-sm text-gray-500 dark:text-gray-400">
                            {$t('person_birthdate', {
                              values: {
                                date: DateTime.fromISO(person.birthDate).toLocaleString(
                                  {
                                    month: 'numeric',
                                    day: 'numeric',
                                    year: 'numeric',
                                  },
                                  { locale: $locale },
                                ),
                              },
                            })}
                          </p>
                        {/if}
                      </div>
                    </button>
                  </div>
                {/if}
              </section>
            </div>
            <FamilyRelationsPanel
              isPet={person.type === 'pet'}
              access={familyRelations.access}
              relations={familyRelations.relations}
              onAddRelationship={() => (linkingRelationship = true)}
            />
            {#if linkingRelationship}
              <FamilyLinkDialog
                onClose={(created) => {
                  linkingRelationship = false;
                  if (created) {
                    void refreshFamilyRelations(person);
                  }
                }}
              />
            {/if}
            {#if isEditingName}
              <div class="absolute z-1 w-64 sm:w-96">
                {#if isSearchingPeople}
                  <div
                    class="flex h-14 place-items-center rounded-b-lg border border-gray-400 bg-gray-200 p-2 dark:border-immich-dark-gray dark:bg-gray-700"
                  >
                    <div class="flex w-full place-items-center">
                      <LoadingSpinner />
                    </div>
                  </div>
                {:else}
                  <div bind:this={suggestionContainer}>
                    {#each suggestedPeople as person, index (person.id)}
                      <button
                        type="button"
                        class="flex h-14 w-full place-items-center border border-gray-200 bg-gray-100 p-2 hover:bg-gray-300 focus:bg-gray-300 dark:border-immich-dark-gray dark:bg-gray-700 hover:dark:bg-[#232932] focus:dark:bg-[#232932] {index ===
                        suggestedPeople.length - 1
                          ? 'rounded-b-lg border-b'
                          : ''}"
                        onclick={() => handleSuggestPeople(person)}
                      >
                        <ImageThumbnail
                          circle
                          shadow
                          url={getPeopleThumbnailUrl(person)}
                          altText={person.name}
                          widthStyle="2rem"
                          heightStyle="2rem"
                        />
                        <p class="ms-4 text-gray-700 dark:text-gray-100">{person.name}</p>
                      </button>
                    {/each}
                  </div>
                {/if}
              </div>
            {/if}
          </div>
          {#if canEditSpacePerson}
            <!-- Defence in depth, not the primary gate: the server already returns an empty page (`total: 0`)
                 to space members below editor (loadSuggestionSummary/fetchSuggestions above), which is what
                 actually keeps this hidden from viewers today. `canEditSpacePerson` is always true for a
                 personal (non-space) person — only a space-scoped profile is role-gated. This client-side
                 check exists so that a future relaxation of that read gate ("let viewers see what is
                 pending") does not also silently expose the review action — it must be relaxed here
                 explicitly, not by accident. -->
            <PersonSuggestionBanner
              {person}
              snoozeId={getSuggestionTarget(person).personId}
              total={suggestionTotal}
              previews={suggestionPreviews}
              referenceThumbnailUrl={thumbnailData}
              onReview={openSuggestionReview}
            />
          {/if}
        {/if}
      </Timeline>
    {/key}
  </div>
</main>

<header>
  {#if assetMultiSelectManager.selectionActive}
    <AssetSelectControlBar>
      {@const Actions = getAssetBulkActions($t)}
      <CommandPaletteDefaultProvider name={$t('assets')} actions={Object.values(Actions)} />
      <CreateSharedLink />
      <SelectAllAssets {timelineManager} assetInteraction={assetMultiSelectManager} />
      <ActionButton action={Actions.AddToAlbum} />
      <FavoriteAction
        removeFavorite={assetMultiSelectManager.isAllFavorite}
        onFavorite={(ids, isFavorite) => timelineManager.update(ids, (asset) => (asset.isFavorite = isFavorite))}
      />
      <ButtonContextMenu icon={mdiDotsVertical} title={$t('menu')}>
        <DownloadAction menuItem filename="{person.name || 'immich'}.zip" />
        <MenuOption
          icon={mdiAccountMultipleCheckOutline}
          text={$t('fix_incorrect_match')}
          onClick={handleReassignAssets}
        />
        <ChangeDate menuItem />
        <ChangeDescription menuItem />
        <ChangeLocation menuItem />
        <ArchiveAction
          menuItem
          unarchive={assetMultiSelectManager.isAllArchived}
          onArchive={(ids, visibility) => timelineManager.update(ids, (asset) => (asset.visibility = visibility))}
        />
        {#if authManager.preferences.tags.enabled && assetMultiSelectManager.isAllUserOwned}
          <TagAction menuItem />
        {/if}
        <SetVisibilityAction menuItem onVisibilitySet={handleSetVisibility} />
        <DeleteAssets
          menuItem
          onAssetDelete={(assetIds) => handleDeleteAssets(assetIds)}
          onUndoDelete={(assets) => handleUndoDeleteAssets(assets)}
        />
      </ButtonContextMenu>
    </AssetSelectControlBar>
  {:else if viewMode === PersonPageViewMode.VIEW_ASSETS}
    <ControlAppBar backIcon={mdiArrowLeft} onClose={() => goto(previousRoute)}>
      {#snippet trailing()}
        <ContextMenuButton
          items={[
            SelectRepresentativeFace,
            HidePerson,
            ShowPerson,
            SetDateOfBirth,
            Merge,
            SeparateFromGroupedPerson,
            Favorite,
            Unfavorite,
          ]}
          aria-label={$t('open')}
        />
      {/snippet}
    </ControlAppBar>
  {/if}
</header>

{#if viewMode === PersonPageViewMode.UNASSIGN_ASSETS}
  <UnmergeFaceSelector
    assetIds={assetMultiSelectManager.assets.map((a) => a.id)}
    personAssets={person}
    onClose={() => (viewMode = PersonPageViewMode.VIEW_ASSETS)}
    onConfirm={handleUnmerge}
  />
{/if}

{#if viewMode === PersonPageViewMode.MERGE_PEOPLE}
  <PeopleMergeSelector
    {person}
    getDisplayName={getMergeDisplayName}
    getThumbnailUrl={getScopedThumbnailUrl}
    loadPeople={loadMergePeople}
    {mergePeople}
    searchPeople={(name) => searchPerson({ name, withHidden: true, withSharedSpaces: true })}
    onBack={handleGoBack}
    onMerge={handleMerge}
    onSwapPerson={handleSwapMergePerson}
  />
{/if}
