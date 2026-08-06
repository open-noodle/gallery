<script lang="ts">
  import { t } from 'svelte-i18n';
  import { AgentOperationPlanStatus } from '@immich/sdk';
  import {
    buildOperationReviewApplyStateSummary,
    buildOperationReviewImpactSummary,
    type OperationReviewGroup,
    type OperationReviewModel,
  } from './agent-operation-plan-ui';
  import AgentPlanApplyBar from './agent-plan-apply-bar.svelte';
  import AgentPlanDestinationCard from './agent-plan-destination-card.svelte';
  import AgentPlanPhotoReviewModal from './agent-plan-photo-review-modal.svelte';

  interface Props {
    model: OperationReviewModel;
    selectedOperationIds: string[];
    canChangeSelection: boolean;
    canApply: boolean;
    applying: boolean;
    showHeader?: boolean;
    errorMessage: string | null;
    applyErrorMessage: string | null;
    applyMessage: string | null;
    onToggleGroup: (group: OperationReviewGroup, checked: boolean) => void;
    onToggleOperation: (operationId: string, checked: boolean) => void;
    onToggleItem?: (operationId: string, assetId: string, selected: boolean) => void;
    onBulkSetItems?: (operationId: string, assetIds: string[], selected: boolean) => void;
    onSetOnlyItems?: (operationId: string, assetIds: string[]) => void;
    onResetItemSelection?: (operationId: string) => void;
    onSetFieldOverride?: (operationId: string, fieldKey: string, value: string | undefined) => void;
    onResetFieldOverride?: (operationId: string, fieldKey: string) => void;
    onApply: () => void;
  }

  let {
    model,
    selectedOperationIds,
    canChangeSelection,
    canApply,
    applying,
    showHeader = true,
    errorMessage,
    applyErrorMessage,
    applyMessage,
    onToggleGroup,
    onToggleOperation,
    onToggleItem = () => {},
    onBulkSetItems = () => {},
    onSetOnlyItems = () => {},
    onResetItemSelection = () => {},
    onSetFieldOverride = () => {},
    onResetFieldOverride = () => {},
    onApply,
  }: Props = $props();

  let activeReviewOperationId = $state<string | null>(null);

  const impact = $derived(buildOperationReviewImpactSummary(model));
  const applyStateSummary = $derived(buildOperationReviewApplyStateSummary(model));
  const effectiveCanChangeSelection = $derived(
    canChangeSelection && model.plan.status === AgentOperationPlanStatus.Proposed,
  );
  const activeReviewItem = $derived(
    activeReviewOperationId ? model.operationsById.get(activeReviewOperationId) : undefined,
  );

  $effect(() => {
    if (activeReviewOperationId && !model.operationsById.has(activeReviewOperationId)) {
      activeReviewOperationId = null;
    }
  });
</script>

<div
  class="flex flex-col gap-4"
  role={showHeader ? 'region' : undefined}
  aria-labelledby={showHeader ? 'assistant-operation-plan-title' : undefined}
>
  {#if showHeader}
    <header class="flex flex-col gap-3 border-b border-gray-200 pb-4 dark:border-gray-800">
      <div class="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h2 id="assistant-operation-plan-title" class="text-lg font-semibold">
            {$t('assistant_operation_plan_review')}
          </h2>
          <p class="mt-1 text-sm text-gray-600 dark:text-gray-300">{model.plan.summary}</p>
        </div>
        <p class="text-sm font-medium text-gray-600 dark:text-gray-300">
          {$t('assistant_operation_plan_no_destructive_changes')}
        </p>
      </div>

      <div class="flex flex-wrap gap-2 text-sm text-gray-500 dark:text-gray-400">
        <span class="rounded-md bg-gray-100 px-2 py-1 dark:bg-gray-800">
          {$t('assistant_operation_plan_destination_count', { values: { count: impact.destinationCount } })}
        </span>
        <span class="rounded-md bg-gray-100 px-2 py-1 dark:bg-gray-800">
          {$t('assistant_operation_plan_selected_change_count', { values: { count: impact.selectedOperationCount } })}
        </span>
        <span class="rounded-md bg-gray-100 px-2 py-1 dark:bg-gray-800">
          {$t('assistant_operation_plan_selected_asset_count', { values: { count: impact.selectedAssetCount } })}
        </span>
      </div>
    </header>
  {/if}

  <div class="flex flex-col gap-3">
    {#each model.groups as group (group.id)}
      <AgentPlanDestinationCard
        {group}
        canChangeSelection={effectiveCanChangeSelection}
        {onToggleGroup}
        {onToggleOperation}
        {onSetFieldOverride}
        {onResetFieldOverride}
        onOpenItemReview={(operationId) => (activeReviewOperationId = operationId)}
      />
    {/each}
  </div>

  {#if errorMessage}
    <p
      class="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700 dark:border-red-900 dark:bg-red-950 dark:text-red-200"
      role="alert"
    >
      {errorMessage}
    </p>
  {/if}

  {#if applyErrorMessage}
    <p
      class="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700 dark:border-red-900 dark:bg-red-950 dark:text-red-200"
      role="alert"
    >
      {applyErrorMessage}
    </p>
  {/if}

  {#if applyMessage}
    <p
      class="rounded-lg border border-green-200 bg-green-50 p-3 text-sm text-green-700 dark:border-green-900 dark:bg-green-950 dark:text-green-200"
      role="status"
    >
      {applyMessage}
    </p>
  {/if}

  {#if applyStateSummary.hasFailures || applyStateSummary.skippedCount > 0}
    <p
      class="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-200"
      role="status"
    >
      {$t('assistant_operation_apply_partial_summary', {
        values: {
          applied: applyStateSummary.appliedCount,
          skipped: applyStateSummary.skippedCount,
          failed: applyStateSummary.failedCount,
        },
      })}
    </p>
  {/if}

  <AgentPlanApplyBar {impact} {selectedOperationIds} {canApply} {applying} {onApply} />

  {#if activeReviewItem}
    <AgentPlanPhotoReviewModal
      item={activeReviewItem}
      canChangeSelection={effectiveCanChangeSelection}
      onClose={() => (activeReviewOperationId = null)}
      {onToggleItem}
      {onBulkSetItems}
      {onSetOnlyItems}
      onResetSelection={onResetItemSelection}
    />
  {/if}
</div>
