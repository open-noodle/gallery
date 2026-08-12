<script lang="ts">
  import FaceCrop from '$lib/components/faces-page/face-crop.svelte';
  import { isSuggestionSnoozed, snoozeSuggestions } from '$lib/utils/face-suggestion-snooze';
  import type { PersonFaceSuggestionResponseDto, PersonResponseDto } from '@immich/sdk';
  import { Button } from '@immich/ui';
  import { mdiAccountQuestionOutline } from '@mdi/js';
  import { t } from 'svelte-i18n';

  interface Props {
    person: PersonResponseDto;
    // The identifier the CALLER's suggestion API calls use for this surface — deliberately not derived from
    // `person.id` in here. `/spaces/…` and `/people/…` route to different SDK calls (space-scoped vs
    // person-scoped) and must key "Not now" on whichever id their own calls use, so the two routes cannot
    // silently drift apart again (F32a). Pass it in explicitly from each route.
    snoozeId: string;
    total: number;
    previews: PersonFaceSuggestionResponseDto[];
    referenceThumbnailUrl: string;
    onReview: () => void;
  }

  let { person, snoozeId, total, previews, referenceThumbnailUrl, onReview }: Props = $props();

  let snoozeTick = $state(0);
  const visible = $derived.by(() => {
    if (snoozeTick < 0) {
      return false;
    }
    return total > 0 && !isSuggestionSnoozed(snoozeId, total);
  });
  const shownPreviews = $derived(previews.slice(0, 5));

  const title = $derived(
    person.name
      ? $t('face_suggestion_banner_title', { values: { name: person.name } })
      : $t('face_suggestion_banner_title_unnamed'),
  );

  const snooze = () => {
    snoozeSuggestions(snoozeId, total);
    snoozeTick++;
  };
</script>

{#if visible}
  <!-- `w-fit` keeps the card as wide as its content — at most five 56px crops and two small buttons — instead of
       stretching the full timeline width and leaving a metre of empty panel beside "N faces found". The two caps
       bound the one row that can actually grow, a long person name in the title: `max-w-full` keeps it inside a
       narrow viewport (where the title's `min-w-0` + `truncate` then engage), and `sm:max-w-2xl` stops a very
       long name from dragging the card across a wide desktop screen. -->
  <div
    data-testid="person-suggestion-banner"
    class="mx-4 my-3 flex w-fit max-w-full flex-col gap-3 rounded-2xl border border-gray-200 bg-light p-4 sm:mx-6 sm:max-w-2xl dark:border-gray-700"
  >
    <div class="flex items-center justify-between gap-3">
      <div class="flex min-w-0 items-center gap-3">
        <img
          data-testid="suggestion-banner-reference"
          src={referenceThumbnailUrl}
          alt={person.name || $t('face_suggestion_reference')}
          class="size-9 shrink-0 rounded-full object-cover"
        />
        <p class="truncate font-medium text-primary">{title}</p>
      </div>
      <p class="shrink-0 text-sm text-gray-500 dark:text-gray-400">
        {$t('face_suggestion_count', { values: { count: total } })}
      </p>
    </div>

    <div class="flex gap-2">
      {#each shownPreviews as item (item.assetFaceId)}
        <div class="w-14">
          <FaceCrop face={item} label={$t('face_suggestion_candidate')} />
        </div>
      {/each}
    </div>

    <div class="flex gap-2">
      <Button
        size="small"
        shape="round"
        leadingIcon={mdiAccountQuestionOutline}
        data-testid="suggestion-review-btn"
        onclick={onReview}
      >
        {$t('face_suggestion_review')}
      </Button>
      <Button size="small" shape="round" color="secondary" data-testid="suggestion-snooze-btn" onclick={snooze}>
        {$t('face_suggestion_not_now')}
      </Button>
    </div>
  </div>
{/if}
