<script lang="ts">
  import { t } from 'svelte-i18n';
  import type { OperationReviewGroup, OperationReviewItem } from './agent-operation-plan-ui';
  import AgentPlanThumbnailStrip from './agent-plan-thumbnail-strip.svelte';

  interface Props {
    group: OperationReviewGroup;
    primaryItem?: OperationReviewItem;
    onOpenItemReview?: (operationId: string) => void;
  }

  let { group, primaryItem, onOpenItemReview = () => undefined }: Props = $props();

  const selectedAssetIds = $derived(
    Array.from(
      new Set(
        group.operations
          .filter((operation) => operation.enabled && !operation.blocked)
          .flatMap((operation) => operation.selectedAssetIds),
      ),
    ),
  );
  const selectedAssetCount = $derived(selectedAssetIds.length);
  const selectedThumbnailGroup = $derived({
    ...group,
    assetCount: selectedAssetCount,
    thumbnailSummary: {
      totalCount: selectedAssetCount,
      representativeAssetIds: selectedAssetIds,
      hasMore: false,
    },
    representativeAssetIds: selectedAssetIds,
  });
  const supportsItemSelection = $derived(Boolean(primaryItem?.review.selection.supportsItemSelection));
</script>

{#if group.assetCount > 0}
  <section
    class="mt-4 rounded-lg border border-gray-200 bg-gray-50 p-3 dark:border-gray-700 dark:bg-gray-900/40"
    data-testid="agent-plan-photo-stage"
    aria-label={$t('assistant_operation_photo_stage_title')}
  >
    <div class="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
      <div class="min-w-0">
        <h4 class="text-sm font-semibold text-gray-900 dark:text-gray-100">
          {$t('assistant_operation_photo_stage_title')}
        </h4>
        <p class="mt-1 text-2xl font-semibold leading-7 text-gray-900 dark:text-gray-100">{selectedAssetCount}</p>
        <p class="mt-1 text-sm text-gray-500 dark:text-gray-400">
          {$t('assistant_operation_photo_stage_summary', { values: { count: selectedAssetCount } })}
        </p>
      </div>

      {#if supportsItemSelection && primaryItem}
        <button
          type="button"
          class="inline-flex items-center justify-center rounded-full border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-700 shadow-sm transition-colors hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-immich-primary dark:border-gray-700 dark:bg-gray-800 dark:text-gray-100 dark:hover:bg-gray-700"
          onclick={() => onOpenItemReview(primaryItem.id)}
        >
          {$t('assistant_operation_photo_stage_review')}
        </button>
      {/if}
    </div>

    <AgentPlanThumbnailStrip group={selectedThumbnailGroup} variant="mosaic" maxVisible={7} />
  </section>
{/if}
