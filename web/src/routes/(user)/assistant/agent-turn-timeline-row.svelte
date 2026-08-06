<script lang="ts">
  import { t } from 'svelte-i18n';
  import { formatAgentTimelineDuration, type AgentTurnTimelineRow } from './agent-turn-timeline-ui';

  interface Props {
    row: AgentTurnTimelineRow;
  }

  const { row }: Props = $props();

  let detailOpen = $state(false);

  const dotClass = $derived((): string => {
    switch (row.state) {
      case 'completed': {
        return 'bg-green-500';
      }
      case 'failed': {
        return 'bg-red-500';
      }
      case 'denied': {
        return 'bg-amber-500';
      }
      case 'in-flight': {
        return 'bg-blue-500 animate-pulse';
      }
      case 'cancelled': {
        return 'bg-gray-400';
      }
    }
  });
</script>

<button
  type="button"
  class="flex w-full items-start gap-2 rounded-xl border border-gray-200 px-3 py-2 text-left hover:bg-gray-50 dark:border-gray-800 dark:hover:bg-neutral-900"
  aria-expanded={detailOpen}
  aria-label={row.toolName}
  onclick={() => (detailOpen = !detailOpen)}
>
  <span class="mt-1.5 inline-flex shrink-0 items-center justify-center">
    <span class="h-1.5 w-1.5 rounded-full {dotClass()}"></span>
  </span>
  <span class="min-w-0 flex-1">
    <span class="flex flex-wrap items-center gap-x-2 gap-y-0.5">
      <span class="font-mono text-xs text-slate-700 dark:text-neutral-300">{row.toolName}</span>
      {#if row.summaryText}
        <span class="truncate text-xs text-gray-500 dark:text-gray-400" title={row.summaryText}>{row.summaryText}</span>
      {/if}
      {#if row.state === 'denied'}
        <span class="text-xs text-gray-500 dark:text-gray-400">{$t('assistant_timeline_denied')}</span>
      {:else if row.state === 'cancelled'}
        <span class="text-xs text-gray-500 dark:text-gray-400">{$t('assistant_timeline_cancelled')}</span>
      {/if}
      {#if row.durationMs !== null}
        <span class="shrink-0 text-xs text-gray-400 dark:text-gray-500"
          >{formatAgentTimelineDuration(row.durationMs)}</span
        >
      {/if}
    </span>

    {#if detailOpen}
      <div class="mt-2 rounded-lg bg-gray-50 px-3 py-2 text-xs dark:bg-neutral-900">
        {#if row.detail.requestSummary !== null}
          <div class="mb-1">
            <span class="font-medium text-gray-500 dark:text-gray-400">{$t('assistant_timeline_request')}: </span>
            <span class="break-words">{row.detail.requestSummary}</span>
          </div>
        {/if}
        {#if row.detail.responseSummary !== null}
          <div class="mb-1">
            <span class="font-medium text-gray-500 dark:text-gray-400">{$t('assistant_timeline_response')}: </span>
            <span class="break-words">{row.detail.responseSummary}</span>
          </div>
        {/if}
        {#if row.detail.error !== null}
          <div class="mb-1">
            <span class="font-medium text-red-600 dark:text-red-400">{$t('assistant_timeline_error')}: </span>
            <span class="break-words text-red-600 dark:text-red-400">{row.detail.error}</span>
          </div>
        {/if}
        {#if row.detail.assetCount !== null || row.detail.albumCount !== null}
          <div class="mb-1 text-gray-500 dark:text-gray-400">
            {#if row.detail.assetCount !== null}{row.detail.assetCount} assets{/if}{#if row.detail.assetCount !== null && row.detail.albumCount !== null}
              ·
            {/if}{#if row.detail.albumCount !== null}{row.detail.albumCount} albums{/if}
          </div>
        {/if}
        {#if row.detail.resultSize !== null}
          <div class="mb-1 text-gray-500 dark:text-gray-400">
            {row.detail.resultSize.returnedItems} items
            {#if row.detail.resultSize.truncated}
              <span class="ml-1 rounded bg-amber-100 px-1 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400"
                >truncated</span
              >
            {/if}
          </div>
        {/if}
        <div class="text-gray-400 dark:text-gray-500">
          {new Date(row.detail.startedAt).toLocaleTimeString()}
          {#if row.detail.completedAt !== null}
            → {new Date(row.detail.completedAt).toLocaleTimeString()}
          {/if}
        </div>
      </div>
    {/if}
  </span>
</button>
