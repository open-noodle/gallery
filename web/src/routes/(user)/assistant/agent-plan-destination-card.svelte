<script lang="ts">
  import { t } from 'svelte-i18n';
  import type { OperationReviewGroup } from './agent-operation-plan-ui';
  import AgentPlanOperationRow from './agent-plan-operation-row.svelte';
  import AgentPlanPhotoStage from './agent-plan-photo-stage.svelte';

  interface Props {
    group: OperationReviewGroup;
    canChangeSelection: boolean;
    onToggleGroup: (group: OperationReviewGroup, checked: boolean) => void;
    onToggleOperation: (operationId: string, checked: boolean) => void;
    onSetFieldOverride: (operationId: string, fieldKey: string, value: string | undefined) => void;
    onResetFieldOverride: (operationId: string, fieldKey: string) => void;
    onOpenItemReview?: (operationId: string) => void;
  }

  let {
    group,
    canChangeSelection,
    onToggleGroup,
    onToggleOperation,
    onSetFieldOverride,
    onResetFieldOverride,
    onOpenItemReview = () => {},
  }: Props = $props();

  const getDestinationTitle = (reviewGroup: OperationReviewGroup) => {
    if (reviewGroup.destination.id && reviewGroup.destination.name === `Existing album ${reviewGroup.destination.id}`) {
      return 'Existing album';
    }

    return reviewGroup.destination.name || reviewGroup.title;
  };

  const destinationTitle = $derived(getDestinationTitle(group));
  const destinationSubtitle = $derived(group.operations[0]?.review.destination.subtitle ?? group.destination.subtitle);
  const enabledOperationCount = $derived(group.operations.filter((operation) => operation.enabled).length);
  const selectedAssetCount = $derived(
    new Set(
      group.operations
        .filter((operation) => operation.enabled && !operation.blocked)
        .flatMap((operation) => operation.selectedAssetIds),
    ).size,
  );
  const primaryPhotoReviewItem = $derived(
    group.operations.find((operation) => operation.review.selection.supportsItemSelection && operation.assetCount > 0),
  );
  const groupSelectionState = $derived({
    checked: enabledOperationCount === group.operations.length,
    mixed: enabledOperationCount > 0 && enabledOperationCount < group.operations.length,
  });

  const setMixedCheckbox = (node: HTMLInputElement, state: { checked: boolean; mixed: boolean }) => {
    const update = ({ checked, mixed }: { checked: boolean; mixed: boolean }) => {
      node.indeterminate = mixed;
      node.setAttribute('aria-checked', mixed ? 'mixed' : String(checked));
    };

    update(state);

    return { update };
  };
</script>

<div
  class="rounded-lg border border-gray-200 bg-white p-4 dark:border-gray-700 dark:bg-immich-dark-gray"
  role="region"
  aria-label={destinationTitle}
>
  <div class="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
    <div class="flex min-w-0 gap-3">
      <input
        class="mt-1 size-4 shrink-0"
        type="checkbox"
        aria-label={$t('assistant_operation_destination_toggle', { values: { name: destinationTitle } })}
        checked={groupSelectionState.checked}
        disabled={!canChangeSelection}
        use:setMixedCheckbox={groupSelectionState}
        onchange={(event) => onToggleGroup(group, event.currentTarget.checked)}
      />
      <div class="min-w-0">
        <h3 class="break-words font-medium leading-5 whitespace-normal">{destinationTitle}</h3>
        {#if destinationSubtitle}
          <p class="mt-1 text-sm text-gray-500 dark:text-gray-400">{destinationSubtitle}</p>
        {/if}
        {#if group.curationCriteria}
          <p
            class="mt-2 break-words text-sm text-gray-600 dark:text-gray-300"
            data-testid="agent-plan-curation-criteria"
          >
            {$t('assistant_operation_curation_criteria', { values: { criteria: group.curationCriteria } })}
          </p>
        {/if}
      </div>
    </div>

    <div class="flex flex-wrap gap-x-3 gap-y-1 text-sm text-gray-500 dark:text-gray-400 sm:justify-end">
      <span>
        {$t('assistant_operation_destination_selected_summary', {
          values: { selected: enabledOperationCount, total: group.operations.length },
        })}
      </span>
      {#if group.assetCount > 0}
        <span>
          {$t('assistant_operation_asset_selection_summary', {
            values: { selected: selectedAssetCount, total: group.assetCount },
          })}
        </span>
      {/if}
    </div>
  </div>

  <AgentPlanPhotoStage {group} primaryItem={primaryPhotoReviewItem} {onOpenItemReview} />

  <div class="mt-3 flex flex-col divide-y divide-gray-200 dark:divide-gray-700">
    {#each group.operations as item (item.id)}
      <AgentPlanOperationRow
        {item}
        {canChangeSelection}
        {onToggleOperation}
        {onSetFieldOverride}
        {onResetFieldOverride}
        {onOpenItemReview}
      />
    {/each}
  </div>
</div>
