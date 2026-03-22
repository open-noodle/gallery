<script lang="ts">
  import { Icon } from '@immich/ui';
  import { mdiStar } from '@mdi/js';

  interface Props {
    selectedRating?: number;
    onRatingChange: (rating?: number) => void;
  }

  let { selectedRating, onRatingChange }: Props = $props();

  function handleStarClick(star: number) {
    if (selectedRating === star) {
      onRatingChange(undefined);
    } else {
      onRatingChange(star);
    }
  }
</script>

<div class="flex gap-[2px]" data-testid="rating-filter">
  {#each [1, 2, 3, 4, 5] as star (star)}
    {@const filled = selectedRating !== undefined && star <= selectedRating}
    <button
      type="button"
      class="flex items-center justify-center"
      onclick={() => handleStarClick(star)}
      data-testid="rating-star-{star}"
    >
      <Icon icon={mdiStar} size="14" class={filled ? 'text-[#f59e0b]' : 'text-[var(--border)]'} />
    </button>
  {/each}
</div>
