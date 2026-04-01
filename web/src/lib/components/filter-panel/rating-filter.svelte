<script lang="ts">
  import { Icon } from '@immich/ui';
  import { mdiStar } from '@mdi/js';

  interface Props {
    selectedRating?: number;
    availableRatings?: number[];
    onRatingChange: (rating?: number) => void;
  }

  let { selectedRating, availableRatings, onRatingChange }: Props = $props();

  function handleStarClick(star: number) {
    if (selectedRating === star) {
      onRatingChange(undefined);
    } else {
      onRatingChange(star);
    }
  }

  let visibleStars = $derived(
    availableRatings
      ? [1, 2, 3, 4, 5].filter((s) => availableRatings.includes(s) || s === selectedRating)
      : [1, 2, 3, 4, 5],
  );
</script>

<div class="flex gap-1" data-testid="rating-filter">
  {#each visibleStars as star (star)}
    {@const filled = selectedRating !== undefined && star <= selectedRating}
    {@const isOrphaned = availableRatings !== undefined && !availableRatings.includes(star)}
    <button
      type="button"
      class="flex items-center justify-center p-0.5 {isOrphaned ? 'opacity-50' : ''}"
      onclick={() => handleStarClick(star)}
      data-testid="rating-star-{star}"
    >
      <Icon icon={mdiStar} size="20" class={filled ? 'text-amber-400' : 'text-gray-300 dark:text-gray-600'} />
    </button>
  {/each}
</div>
