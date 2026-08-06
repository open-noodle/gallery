<script lang="ts">
  import type { AgentSessionResponseDto, AgentToolCallResponseDto } from '@immich/sdk';
  import { Button } from '@immich/ui';
  import { t } from 'svelte-i18n';
  import {
    getAgentToolCallPendingText,
    getAgentToolCallScopeText,
    getAgentToolDataClassLabelKey,
    getAgentToolNameLabelKey,
  } from './agent-tool-approval-ui';

  interface Props {
    session: AgentSessionResponseDto;
    toolCall: AgentToolCallResponseDto;
    busy?: boolean;
    errorMessage?: string | null;
    onApprove: (toolCallId: string) => void | Promise<void>;
    onDeny: (toolCallId: string, reason?: string) => void | Promise<void>;
  }

  let { session, toolCall, busy = false, errorMessage = null, onApprove, onDeny }: Props = $props();

  let reasonOpen = $state(false);
  let detailsOpen = $state(false);
  let reason = $state('');
  const toolName = $derived($t(getAgentToolNameLabelKey(toolCall.toolName)));
  const dataClass = $derived($t(getAgentToolDataClassLabelKey(toolCall.dataClass)));
  const actionText = $derived(getAgentToolCallPendingText(toolCall));
  const scopeText = $derived(getAgentToolCallScopeText(toolCall));
  const startedTime = $derived(new Date(toolCall.startedAt).toLocaleString());

  const deny = () => {
    const trimmedReason = reason.trim();
    void onDeny(toolCall.id, reasonOpen && trimmedReason ? trimmedReason : undefined);
  };

  const formatResultSizeBytes = (bytes: number | null | undefined) => {
    if (bytes === null || bytes === undefined) {
      return 'not estimated';
    }

    if (bytes < 1024) {
      return `${bytes} B`;
    }

    return `${Math.round(bytes / 1024)} KB`;
  };
</script>

<article
  class="rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm text-gray-900 shadow-sm dark:border-amber-700/70 dark:bg-amber-950/30 dark:text-gray-100"
  aria-label={$t('assistant_approval_request')}
>
  <div class="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
    <div class="min-w-0">
      <h3 class="break-words text-base font-semibold">{actionText}</h3>
      <p class="mt-1 break-words text-gray-700 dark:text-gray-300">It may use {scopeText}.</p>
    </div>
    <button
      type="button"
      class="shrink-0 rounded-full border border-amber-200 bg-white px-3 py-1 text-xs font-medium text-gray-700 hover:bg-amber-100 dark:border-amber-800 dark:bg-neutral-950 dark:text-gray-200 dark:hover:bg-amber-950"
      aria-expanded={detailsOpen}
      onclick={() => (detailsOpen = !detailsOpen)}
    >
      Details
    </button>
  </div>

  {#if detailsOpen}
    <div
      class="mt-4 rounded-md border border-amber-200/80 bg-white/70 p-3 dark:border-amber-800 dark:bg-neutral-950/80"
    >
      <p class="break-words text-sm text-gray-800 dark:text-gray-200">{toolCall.requestSummary}</p>
      <dl class="mt-3 grid gap-2 text-xs text-gray-600 sm:grid-cols-2 dark:text-gray-300">
        <div>
          <dt class="font-medium text-gray-500 dark:text-gray-400">Action</dt>
          <dd>{toolName}</dd>
        </div>
        <div>
          <dt class="font-medium text-gray-500 dark:text-gray-400">Data</dt>
          <dd>{dataClass}</dd>
        </div>
        {#if toolCall.resultSize}
          <div>
            <dt class="font-medium text-gray-500 dark:text-gray-400">Response size</dt>
            <dd>{formatResultSizeBytes(toolCall.resultSize.estimatedBytes)}</dd>
          </div>
          <div>
            <dt class="font-medium text-gray-500 dark:text-gray-400">Returned items</dt>
            <dd>{toolCall.resultSize.returnedItems}</dd>
          </div>
          <div>
            <dt class="font-medium text-gray-500 dark:text-gray-400">Truncated</dt>
            <dd>{toolCall.resultSize.truncated ? 'yes' : 'no'}</dd>
          </div>
        {/if}
        <div>
          <dt class="font-medium text-gray-500 dark:text-gray-400">{$t('assistant_approval_data_access')}</dt>
          <dd>
            {$t('assistant_approval_asset_count', { values: { count: toolCall.assetCount } })} ·
            {$t('assistant_approval_album_count', { values: { count: toolCall.albumCount } })}
          </dd>
        </div>
        <div>
          <dt class="font-medium text-gray-500 dark:text-gray-400">{$t('assistant_provider_credential')}</dt>
          <dd class="truncate">{session.credentialSnapshot.label} / {session.modelSnapshot.model}</dd>
        </div>
        <div>
          <dt class="font-medium text-gray-500 dark:text-gray-400">{$t('assistant_created_at')}</dt>
          <dd>{startedTime}</dd>
        </div>
      </dl>
    </div>
  {/if}

  {#if reasonOpen}
    <label
      class="mt-4 block text-xs font-medium text-gray-600 dark:text-gray-300"
      for={`approval-reason-${toolCall.id}`}
    >
      {$t('assistant_approval_reason')}
    </label>
    <textarea
      id={`approval-reason-${toolCall.id}`}
      class="mt-1 min-h-16 w-full resize-y rounded-md border border-gray-300 bg-white px-3 py-2 text-sm dark:border-gray-700 dark:bg-gray-900"
      bind:value={reason}
      disabled={busy}
    ></textarea>
  {/if}

  {#if errorMessage}
    <p class="mt-3 text-sm text-red-600 dark:text-red-400" role="alert">{errorMessage}</p>
  {/if}

  <div class="mt-4 flex flex-wrap gap-2">
    <Button type="button" size="small" disabled={busy} loading={busy} onclick={() => onApprove(toolCall.id)}>
      {$t('assistant_approval_approve')}
    </Button>
    <Button type="button" size="small" color="secondary" disabled={busy} onclick={deny}>
      {$t('assistant_approval_deny')}
    </Button>
    {#if !reasonOpen}
      <Button type="button" size="small" color="secondary" disabled={busy} onclick={() => (reasonOpen = true)}>
        {$t('assistant_approval_reason')}
      </Button>
    {/if}
  </div>
</article>
