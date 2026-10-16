<script lang="ts">
  import { dateFormats } from '$lib/constants';
  import ShortcutKeycap from '$lib/gallery/components/shortcut-keycap.svelte';
  import { faceSuggestionContextExpanded as expanded } from '$lib/gallery/people/face-suggestion-context.store';
  import { getSuggestionAssetHref } from '$lib/gallery/people/suggestion-asset-href';
  import { DateTime } from 'luxon';
  import { locale, t } from 'svelte-i18n';

  interface Props {
    /** The asset the candidate face was detected in. */
    assetId: string;
    /** Straight off the suggestion payload — no request needed to show the date. */
    fileCreatedAt?: string;
    /**
     * Set only when the review is running inside a Space. Not derived in here: the caller knows which
     * surface it is on, and a space viewer's link target is not a variation of the personal one — it is a
     * different route with different access (see `getSuggestionAssetHref`).
     */
    spaceId?: string;
  }

  const { assetId, fileCreatedAt, spaceId }: Props = $props();

  // Luxon directly rather than fromISODateTimeUTC: that helper casts to `DateTime<true>`, which erases the
  // invalid case at the type level — and the invalid case is exactly what this guard is for. Fixed to UTC so
  // the day shown never depends on where the person reviewing happens to be sitting; same reasoning as
  // FacePhotoModal.svelte.
  const summaryDate = $derived.by(() => {
    if (!fileCreatedAt) {
      return null;
    }
    const parsed = DateTime.fromISO(fileCreatedAt, { zone: 'UTC', locale: $locale ?? undefined });
    return parsed.isValid ? parsed.toLocaleString(dateFormats.album) : null;
  });

  const openHref = $derived(getSuggestionAssetHref(assetId, spaceId));
</script>

<!-- The row under the photo in the face suggestion review (#1039). It needs no request: the date is on the
     suggestion payload and the link is built from ids. The Details toggle opens suggestion-asset-details, which
     the review modal places under the photo or beside it. -->
<div class="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm" data-testid="suggestion-context">
  {#if summaryDate}
    <span class="font-medium" data-testid="suggestion-context-date">{summaryDate}</span>
  {/if}

  <button
    type="button"
    class="flex items-center gap-1 rounded-lg px-1.5 py-0.5 text-gray-500 hover:text-primary dark:text-gray-400"
    aria-expanded={$expanded}
    data-testid="suggestion-context-toggle"
    onclick={() => expanded.set(!$expanded)}
  >
    {$t('details')}
    <span class="text-xs" aria-hidden="true">{$expanded ? '▴' : '▾'}</span>
    <ShortcutKeycap key="m" class="ms-1" />
  </button>

  <span class="grow"></span>

  <!-- A new tab, deliberately: the review queue, its position and the append-only `items` buffer all survive
       the trip, which is exactly what the right-click-open workaround in #1039 was preserving by hand. -->
  <a
    class="flex shrink-0 items-center gap-1.5 font-medium text-primary hover:underline"
    href={openHref}
    target="_blank"
    rel="noopener noreferrer"
    data-testid="suggestion-context-open"
  >
    {$t('face_suggestion_open_photo')}
    <ShortcutKeycap key="o" />
  </a>
</div>
