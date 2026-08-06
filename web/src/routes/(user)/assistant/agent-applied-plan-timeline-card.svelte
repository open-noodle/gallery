<script lang="ts">
  import {
    buildOperationReviewApplyStateSummary,
    buildOperationReviewImpactSummary,
    buildOperationReviewModel,
    createInitialOperationEnabledState,
    type OperationReviewItem,
  } from './agent-operation-plan-ui';
  import AgentPlanThumbnailStrip from './agent-plan-thumbnail-strip.svelte';
  import type { AgentOperationPlanResponseDto } from '@immich/sdk';
  import { t, type Translations } from 'svelte-i18n';

  interface Props {
    plan: AgentOperationPlanResponseDto;
  }

  let { plan }: Props = $props();

  const model = $derived(buildOperationReviewModel(plan, createInitialOperationEnabledState(plan)));
  const impact = $derived(buildOperationReviewImpactSummary(model));
  const applyStateSummary = $derived(buildOperationReviewApplyStateSummary(model));

  const getOperationStatusLabelKey = (item: OperationReviewItem) => {
    if (item.applyState.kind === 'partial') {
      return 'assistant_operation_status_partial' as Translations;
    }

    return `assistant_operation_status_${item.applyState.kind}` as Translations;
  };
</script>

<article
  data-chat-item
  class="mr-auto w-full max-w-[92%] rounded-lg border border-gray-200 bg-white px-4 py-3 text-sm text-slate-800 shadow-sm dark:border-neutral-800 dark:bg-neutral-950 dark:text-neutral-100"
  aria-label={$t('assistant_operation_applied_plan_label', { values: { summary: plan.summary } })}
>
  <header class="flex flex-col gap-3 border-b border-gray-100 pb-3 dark:border-neutral-800">
    <div class="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
      <div class="min-w-0">
        <p class="text-xs font-semibold uppercase text-immich-primary">{$t('assistant_operation_applied_plan')}</p>
        <h3 class="mt-1 break-words text-base font-semibold text-slate-950 dark:text-neutral-50">{plan.summary}</h3>
      </div>
      <time class="shrink-0 text-xs text-gray-500 dark:text-gray-400" datetime={plan.updatedAt}>
        {new Date(plan.updatedAt).toLocaleString()}
      </time>
    </div>

    <div class="flex flex-wrap gap-2 text-xs text-gray-600 dark:text-gray-300">
      <span class="rounded-md bg-gray-100 px-2 py-1 dark:bg-neutral-900">
        {$t('assistant_operation_plan_destination_count', { values: { count: impact.destinationCount } })}
      </span>
      <span class="rounded-md bg-gray-100 px-2 py-1 dark:bg-neutral-900">
        {$t('assistant_operation_plan_selected_change_count', {
          values: { count: impact.selectedOperationCount },
        })}
      </span>
      <span class="rounded-md bg-gray-100 px-2 py-1 dark:bg-neutral-900">
        {$t('assistant_operation_plan_selected_asset_count', { values: { count: impact.selectedAssetCount } })}
      </span>
    </div>

    <p class="text-xs font-medium text-gray-600 dark:text-gray-300">
      {$t('assistant_operation_apply_partial_summary', {
        values: {
          applied: applyStateSummary.appliedCount,
          skipped: applyStateSummary.skippedCount,
          failed: applyStateSummary.failedCount,
        },
      })}
    </p>
  </header>

  <div class="mt-3 flex flex-col gap-3">
    {#each model.groups as group (group.id)}
      <section
        class="rounded-md border border-gray-100 p-3 dark:border-neutral-800"
        aria-label={group.destination.name}
      >
        <div class="flex flex-col gap-1 sm:flex-row sm:items-start sm:justify-between">
          <div class="min-w-0">
            <h4 class="break-words font-medium text-slate-950 dark:text-neutral-50">{group.destination.name}</h4>
            {#if group.destination.subtitle}
              <p class="text-xs text-gray-500 dark:text-gray-400">{group.destination.subtitle}</p>
            {/if}
          </div>
          {#if group.assetCount > 0}
            <p class="text-xs text-gray-500 dark:text-gray-400">
              {$t('assistant_operation_asset_selection_summary', {
                values: { selected: group.assetCount, total: group.assetCount },
              })}
            </p>
          {/if}
        </div>

        <AgentPlanThumbnailStrip {group} maxVisible={6} />

        <ul class="mt-3 divide-y divide-gray-100 dark:divide-neutral-800">
          {#each group.operations as item (item.id)}
            <li class="py-2 first:pt-0 last:pb-0">
              <div class="flex flex-col gap-1 sm:flex-row sm:items-start sm:justify-between">
                <div class="min-w-0">
                  <p class="break-words font-medium">{item.review.summary}</p>
                  <p class="text-xs text-gray-500 dark:text-gray-400">{$t(item.typeLabelKey)}</p>
                </div>
                <span
                  class="w-fit rounded-full bg-gray-100 px-2 py-0.5 text-xs font-medium text-gray-700 dark:bg-neutral-900 dark:text-gray-200"
                >
                  {$t(getOperationStatusLabelKey(item))}
                </span>
              </div>

              {#if item.review.selection.totalCount > 0}
                <p class="mt-1 text-xs text-gray-500 dark:text-gray-400">
                  {$t('assistant_operation_asset_count', { values: { count: item.review.selection.totalCount } })}
                </p>
              {/if}

              {#if item.applyState.kind === 'failed' && item.applyState.error}
                <p class="mt-1 text-xs text-red-700 dark:text-red-300" role="alert">{item.applyState.error}</p>
              {:else if item.applyState.kind === 'partial' && item.applyState.error}
                <p class="mt-1 text-xs text-red-700 dark:text-red-300" role="alert">{item.applyState.error}</p>
              {:else if item.applyState.kind === 'skipped' && item.applyState.reason}
                <p class="mt-1 text-xs text-amber-700 dark:text-amber-300">{item.applyState.reason}</p>
              {/if}
            </li>
          {/each}
        </ul>
      </section>
    {/each}
  </div>
</article>
