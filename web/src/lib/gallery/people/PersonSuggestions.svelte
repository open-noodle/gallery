<script lang="ts">
  import { invalidateAll } from '$app/navigation';
  import PersonSuggestionBanner from '$lib/components/faces-page/person-suggestion-banner.svelte';
  import PersonSuggestionReviewModal from '$lib/modals/PersonSuggestionReviewModal.svelte';
  import { getGlobalPersonThumbnailUrl } from '$lib/utils/global-person-route';
  import {
    confirmPersonFaceSuggestion,
    confirmSpacePersonFaceSuggestion,
    dismissPersonFaceSuggestion,
    dismissSpacePersonFaceSuggestion,
    getPersonFaceSuggestions,
    getSpacePersonFaceSuggestions,
    ignorePersonFaceSuggestion,
    ignoreSpacePersonFaceSuggestion,
    type PersonFaceSuggestionResponseDto,
    type PersonResponseDto,
  } from '@immich/sdk';
  import { modalManager } from '@immich/ui';

  // Face suggestions banner and review on the person page. `onConfirmed` runs after a review that
  // confirmed faces has reloaded the page data, so the page can refresh its thumbnail.
  interface Props {
    person: PersonResponseDto;
    canEditSpacePerson: boolean;
    thumbnailData: string;
    onConfirmed: () => void;
  }

  let { person, canEditSpacePerson, thumbnailData, onConfirmed }: Props = $props();

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
    const currentThumbnailUrl = getGlobalPersonThumbnailUrl(currentPerson);

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
      onConfirmed();
    }
  };

  $effect(() => {
    const currentPerson = person;
    suggestionTotal = 0;
    suggestionPreviews = [];
    void loadSuggestionSummary(currentPerson);
  });
</script>

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
