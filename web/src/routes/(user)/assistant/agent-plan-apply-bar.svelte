<script lang="ts">
  import { t } from 'svelte-i18n';
  import type { OperationReviewImpactSummary } from './agent-operation-plan-ui';

  interface Props {
    impact: OperationReviewImpactSummary;
    selectedOperationIds: string[];
    canApply: boolean;
    applying: boolean;
    onApply: () => void;
  }

  let { impact, selectedOperationIds, canApply, applying, onApply }: Props = $props();
</script>

<div
  class="sticky bottom-3 z-10 mt-3 flex flex-col items-stretch gap-3 rounded-3xl border border-gray-200 bg-white/95 p-3 shadow-xl shadow-black/10 backdrop-blur dark:border-neutral-800 dark:bg-neutral-950/95 dark:shadow-black/40 sm:flex-row sm:items-center sm:justify-between"
  data-testid="agent-operation-plan-sticky-actions"
  role="region"
  aria-label={$t('assistant_operation_apply_bar_label')}
  aria-describedby="assistant-operation-apply-summary"
>
  <div id="assistant-operation-apply-summary" class="min-w-0 text-sm font-medium text-gray-600 dark:text-gray-300">
    {$t('assistant_operation_apply_summary', {
      values: { changes: impact.selectedOperationCount, assets: impact.selectedAssetCount },
    })}
  </div>
  <button
    type="button"
    class="rounded-full bg-immich-primary px-4 py-2 text-sm font-semibold text-white hover:bg-immich-primary/90 focus:outline-none focus:ring-2 focus:ring-immich-primary disabled:cursor-not-allowed disabled:opacity-60"
    disabled={!canApply}
    onclick={onApply}
  >
    {applying
      ? $t('assistant_operation_apply_applying')
      : $t('assistant_operation_apply_selected', { values: { count: selectedOperationIds.length } })}
  </button>
</div>
