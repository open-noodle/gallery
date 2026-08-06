<script lang="ts">
  import { t } from 'svelte-i18n';
  import { formatAgentTimelineDuration, type AgentTurnTimeline } from './agent-turn-timeline-ui';
  import AgentTurnTimelineRow from './agent-turn-timeline-row.svelte';

  interface Props {
    timeline: AgentTurnTimeline;
  }

  const { timeline }: Props = $props();

  let expanded = $state(false);
</script>

{#if timeline.state === 'running' && timeline.oneLiner !== null}
  <div data-testid="agent-turn-timeline" data-chat-item>
    <button
      type="button"
      class="flex items-center gap-2 text-sm italic text-gray-500 dark:text-neutral-400"
      aria-expanded={expanded}
      onclick={() => (expanded = !expanded)}
    >
      <span class="h-1.5 w-1.5 rounded-full bg-blue-500 animate-pulse"></span>
      <span>
        {#if timeline.oneLiner.kind === 'key'}
          {$t(timeline.oneLiner.key)}
        {:else}
          {timeline.oneLiner.toolName}
        {/if}
      </span>
    </button>

    {#if expanded}
      <div class="mt-2 space-y-1">
        {#if timeline.routerAnnotation !== null}
          <p class="text-xs text-gray-400 dark:text-gray-500">
            {#if timeline.routerAnnotation.matched}
              {$t('assistant_timeline_router_matched', {
                values: {
                  workflow: timeline.routerAnnotation.workflow ?? '',
                  via: timeline.routerAnnotation.via ?? '',
                },
              })}
            {:else}
              {$t('assistant_timeline_router_none', {
                values: { via: timeline.routerAnnotation.via ?? '' },
              })}
            {/if}
          </p>
        {/if}
        {#each timeline.rows as row (row.id)}
          <AgentTurnTimelineRow {row} />
        {/each}
      </div>
    {/if}
  </div>
{:else if timeline.state === 'settled' && timeline.summary !== null}
  <div data-testid="agent-turn-timeline" data-chat-item>
    <button
      type="button"
      class="flex flex-wrap items-center gap-1.5 text-sm text-gray-500 dark:text-neutral-400"
      aria-expanded={expanded}
      onclick={() => (expanded = !expanded)}
    >
      <span>
        {#if timeline.summary.steps === 1}
          {$t('assistant_timeline_steps_one')}
        {:else}
          {$t('assistant_timeline_steps', { values: { steps: timeline.summary.steps } })}
        {/if}
      </span>
      {#if timeline.summary.durationMs !== null}
        <span>· {formatAgentTimelineDuration(timeline.summary.durationMs)}</span>
      {/if}
      {#if timeline.summary.failedCount > 0}
        <span class="text-red-600 dark:text-red-400">
          · {$t('assistant_timeline_failed_count', { values: { count: timeline.summary.failedCount } })}
        </span>
      {/if}
      {#if timeline.summary.cancelled}
        <span>· {$t('assistant_timeline_cancelled')}</span>
      {/if}
    </button>

    {#if expanded}
      <div class="mt-2 space-y-1">
        {#if timeline.routerAnnotation !== null}
          <p class="text-xs text-gray-400 dark:text-gray-500">
            {#if timeline.routerAnnotation.matched}
              {$t('assistant_timeline_router_matched', {
                values: {
                  workflow: timeline.routerAnnotation.workflow ?? '',
                  via: timeline.routerAnnotation.via ?? '',
                },
              })}
            {:else}
              {$t('assistant_timeline_router_none', {
                values: { via: timeline.routerAnnotation.via ?? '' },
              })}
            {/if}
          </p>
        {/if}
        {#each timeline.rows as row (row.id)}
          <AgentTurnTimelineRow {row} />
        {/each}
      </div>
    {/if}
  </div>
{/if}
