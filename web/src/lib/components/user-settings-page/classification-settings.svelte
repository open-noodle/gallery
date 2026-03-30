<script lang="ts">
  import { handleError } from '$lib/utils/handle-error';
  import { getCategories, type ClassificationCategoryResponseDto } from '@immich/sdk';
  import { Text } from '@immich/ui';
  import { onMount } from 'svelte';
  import { t } from 'svelte-i18n';

  let categories: ClassificationCategoryResponseDto[] = $state([]);

  const getSimilarityLabel = (value: number): string => {
    if (value < 0.22) {
      return 'Loose';
    }
    if (value > 0.35) {
      return 'Strict';
    }
    return 'Normal';
  };

  const actionLabels: Record<string, string> = {
    tag: 'Tag only',
    tag_and_archive: 'Tag and archive',
  };

  onMount(async () => {
    try {
      categories = await getCategories();
    } catch (error) {
      handleError(error, 'Unable to load classification categories');
    }
  });
</script>

<section class="my-4">
  <Text size="small" color="muted" class="mb-4">
    {$t('classification_managed_by_admin')}
  </Text>

  {#if categories.length > 0}
    {#each categories as category (category.id)}
      <div
        class="rounded-2xl border border-gray-200 dark:border-gray-800 mt-3 bg-slate-50 dark:bg-gray-900 p-4"
        class:opacity-50={!category.enabled}
      >
        <div class="flex items-center gap-2">
          <Text fontWeight="medium">{category.name}</Text>
          <span
            class="inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium
              {category.action === 'tag_and_archive'
              ? 'bg-amber-100 text-amber-800 dark:bg-amber-900 dark:text-amber-200'
              : 'bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200'}"
          >
            {actionLabels[category.action] ?? category.action}
          </span>
          {#if !category.enabled}
            <span class="text-xs text-gray-500 dark:text-gray-400">(Disabled)</span>
          {/if}
        </div>
        <Text size="tiny" color="muted">
          {getSimilarityLabel(category.similarity)} ({category.similarity.toFixed(2)})
        </Text>
      </div>
    {/each}
  {:else}
    <Text color="muted">{$t('no_classification_categories')}</Text>
  {/if}
</section>
