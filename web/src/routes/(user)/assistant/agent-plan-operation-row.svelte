<script lang="ts">
  import { t, type Translations } from 'svelte-i18n';
  import type { AgentOperationMetadataDisplayText, OperationReviewItem } from './agent-operation-plan-ui';
  import AgentPlanInlineFieldEditor from './agent-plan-inline-field-editor.svelte';
  import AgentPlanTechnicalDetails from './agent-plan-technical-details.svelte';

  interface Props {
    item: OperationReviewItem;
    canChangeSelection: boolean;
    onToggleOperation: (operationId: string, checked: boolean) => void;
    onSetFieldOverride?: (operationId: string, fieldKey: string, value: string | undefined) => void;
    onResetFieldOverride?: (operationId: string, fieldKey: string) => void;
    onOpenItemReview?: (operationId: string) => void;
  }

  let {
    item,
    canChangeSelection,
    onToggleOperation,
    onSetFieldOverride = () => {},
    onResetFieldOverride = () => {},
    onOpenItemReview = () => {},
  }: Props = $props();
  let technicalDetailsOpen = $state(false);

  const checkboxState = $derived({
    checked: item.enabled,
    mixed: item.mixed,
  });

  const canOpenItemReview = $derived(item.review.selection.supportsItemSelection && item.assetCount > 0);

  const formatMetadataText = (text: AgentOperationMetadataDisplayText) =>
    text.kind === 'translation' ? $t(text.key, text.values ? { values: text.values } : undefined) : text.text;

  const statusLabelKey = $derived.by(() => {
    if (item.applyState.kind === 'partial') {
      return 'assistant_operation_status_partial' as Translations;
    }

    return `assistant_operation_status_${item.applyState.kind}` as Translations;
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

<div class="grid gap-3 py-4 sm:grid-cols-[auto_minmax(0,1fr)]">
  <input
    class="mt-1 size-4 shrink-0"
    type="checkbox"
    aria-label={item.review.summary}
    checked={checkboxState.checked}
    disabled={!canChangeSelection || item.blocked}
    use:setMixedCheckbox={checkboxState}
    onchange={(event) => onToggleOperation(item.id, event.currentTarget.checked)}
  />

  <div class="min-w-0 flex-1">
    <p class="font-medium leading-5">{item.review.summary}</p>

    <div class="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-sm text-gray-500 dark:text-gray-400">
      {#if item.review.selection.totalCount > 0}
        <span>
          {#if item.review.selection.supportsItemSelection}
            {$t('assistant_operation_asset_selection_summary', {
              values: { selected: item.review.selection.selectedCount, total: item.review.selection.totalCount },
            })}
          {:else}
            {$t('assistant_operation_asset_count', { values: { count: item.review.selection.totalCount } })}
          {/if}
        </span>
      {/if}
      <span>{$t(statusLabelKey)}</span>
      {#if item.applyState.kind === 'partial'}
        <span>
          {$t('assistant_operation_partial_asset_summary', {
            values: { applied: item.applyState.appliedAssetCount, failed: item.applyState.failedAssetCount },
          })}
        </span>
      {:else if item.applyState.kind === 'skipped' && item.applyState.reason}
        <span>{$t('assistant_operation_skipped_reason', { values: { reason: item.applyState.reason } })}</span>
      {/if}
    </div>

    {#if item.applyState.kind === 'failed' && item.applyState.error}
      <span class="mt-1 block text-sm text-red-700 dark:text-red-300" role="alert">
        {item.applyState.error}
      </span>
    {/if}

    {#if item.blocked}
      <span class="mt-1 block text-sm text-amber-700 dark:text-amber-300">
        {$t('assistant_operation_blocked_by', { values: { dependencies: item.blockedBy.join(', ') } })}
      </span>
    {/if}

    {#if item.metadataReview}
      <div class="mt-3 overflow-x-auto">
        <table class="w-full min-w-96 border-separate border-spacing-0 text-left text-sm">
          <thead class="text-xs uppercase text-gray-500 dark:text-gray-400">
            <tr>
              <th class="border-b border-gray-200 py-1.5 pr-3 font-semibold dark:border-neutral-700">
                {$t('assistant_operation_metadata_column_field')}
              </th>
              <th class="border-b border-gray-200 px-3 py-1.5 font-semibold dark:border-neutral-700">
                {$t('assistant_operation_metadata_column_current')}
              </th>
              <th class="border-b border-gray-200 py-1.5 pl-3 font-semibold dark:border-neutral-700">
                {$t('assistant_operation_metadata_column_proposed')}
              </th>
            </tr>
          </thead>
          <tbody>
            {#each item.metadataReview.fields as field (field.key)}
              <tr>
                <th class="border-b border-gray-100 py-2 pr-3 align-top font-medium dark:border-neutral-800">
                  {formatMetadataText(field.label)}
                </th>
                <td
                  class="border-b border-gray-100 px-3 py-2 align-top text-gray-600 dark:border-neutral-800 dark:text-gray-300"
                >
                  <div class="flex flex-col gap-0.5">
                    {#each field.currentValues as currentValue (currentValue.assetId)}
                      <span>{formatMetadataText(currentValue.text)}</span>
                    {/each}
                  </div>
                </td>
                <td
                  class="border-b border-gray-100 py-2 pl-3 align-top text-gray-900 dark:border-neutral-800 dark:text-gray-100"
                >
                  {formatMetadataText(field.proposedText)}
                </td>
              </tr>
            {/each}
          </tbody>
        </table>

        {#each item.metadataReview.warnings as warning (formatMetadataText(warning))}
          <p class="mt-2 text-sm text-amber-700 dark:text-amber-300">{formatMetadataText(warning)}</p>
        {/each}
      </div>
    {/if}

    <AgentPlanInlineFieldEditor {item} {canChangeSelection} {onSetFieldOverride} {onResetFieldOverride} />

    <div class="mt-2 flex flex-wrap gap-2">
      {#if canOpenItemReview}
        <button
          type="button"
          class="inline-flex items-center justify-center rounded-full border border-gray-200 bg-gray-50 px-3 py-1.5 text-xs font-semibold text-gray-700 transition-colors hover:bg-gray-100 focus:outline-none focus:ring-2 focus:ring-immich-primary disabled:cursor-not-allowed disabled:opacity-50 dark:border-neutral-700 dark:bg-neutral-900 dark:text-gray-200 dark:hover:bg-neutral-800"
          disabled={!canChangeSelection}
          onclick={() => onOpenItemReview(item.id)}
        >
          {$t('assistant_operation_item_change_selection')}
        </button>
      {/if}

      <button
        type="button"
        class="inline-flex items-center justify-center rounded-full border border-gray-200 bg-gray-50 px-3 py-1.5 text-xs font-semibold text-gray-700 transition-colors hover:bg-gray-100 focus:outline-none focus:ring-2 focus:ring-immich-primary dark:border-neutral-700 dark:bg-neutral-900 dark:text-gray-200 dark:hover:bg-neutral-800"
        aria-expanded={technicalDetailsOpen}
        onclick={() => (technicalDetailsOpen = !technicalDetailsOpen)}
      >
        {$t(technicalDetailsOpen ? 'assistant_operation_detail_hide' : 'assistant_operation_detail_show')}
      </button>
    </div>

    <AgentPlanTechnicalDetails {item} expanded={technicalDetailsOpen} showToggle={false} />
  </div>
</div>
