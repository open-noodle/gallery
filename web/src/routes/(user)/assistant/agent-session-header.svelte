<script lang="ts">
  import { Icon } from '@immich/ui';
  import { mdiInformationOutline } from '@mdi/js';
  import type { AgentSessionResponseDto } from '@immich/sdk';
  import { t } from 'svelte-i18n';
  import { getApprovalModeLabelKey } from './agent-session-ui';
  import { getAgentSessionStatusBadge, getAgentSessionStatusLabelKey } from './agent-session-workspace-ui';

  interface Props {
    session: AgentSessionResponseDto;
    title?: string | null;
    cancelDisabled?: boolean;
    onCancel?: (() => void) | null;
    onOpenDetails: () => void;
  }

  let { session, title = null, cancelDisabled = false, onCancel = null, onOpenDetails }: Props = $props();

  const displayTitle = $derived(title?.trim() || $t('assistant_new_chat'));
  const statusBadge = $derived(getAgentSessionStatusBadge(session.status));
  const statusTone = $derived(statusBadge?.tone ?? 'muted');
  const statusClass = $derived.by(() => {
    switch (statusTone) {
      case 'active': {
        return 'bg-blue-50 text-blue-700 ring-blue-200 dark:bg-blue-950 dark:text-blue-200 dark:ring-blue-800';
      }

      case 'attention': {
        return 'bg-amber-50 text-amber-700 ring-amber-200 dark:bg-amber-950 dark:text-amber-200 dark:ring-amber-800';
      }

      case 'danger': {
        return 'bg-red-50 text-red-700 ring-red-200 dark:bg-red-950 dark:text-red-200 dark:ring-red-800';
      }

      case 'success': {
        return 'bg-green-50 text-green-700 ring-green-200 dark:bg-green-950 dark:text-green-200 dark:ring-green-800';
      }

      default: {
        return 'bg-gray-100 text-gray-600 ring-gray-200 dark:bg-gray-800 dark:text-gray-300 dark:ring-gray-700';
      }
    }
  });
</script>

<section
  data-testid="agent-session-header"
  class="flex min-h-16 shrink-0 flex-wrap items-center gap-3 border-b border-gray-200 px-4 py-3 dark:border-gray-800 md:px-6"
  aria-labelledby="agent-session-header-title"
>
  <div data-testid="agent-session-header-title-group" class="min-w-0 flex-1 basis-72">
    <div class="flex min-w-0 items-center gap-2">
      <h1
        id="agent-session-header-title"
        data-testid="agent-session-header-title"
        class="min-w-0 truncate text-lg font-semibold text-black dark:text-white"
      >
        {displayTitle}
      </h1>
      <span class={['shrink-0 rounded-full px-2 py-0.5 text-xs font-medium ring-1', statusClass]} role="status">
        {$t(getAgentSessionStatusLabelKey(session.status))}
      </span>
    </div>
    <div
      data-testid="agent-session-header-meta"
      class="mt-1 flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1 text-sm text-gray-500 dark:text-gray-400"
    >
      <span data-testid="agent-session-header-credential" class="min-w-0 max-w-full truncate">
        {session.credentialSnapshot.label}
      </span>
      <span data-testid="agent-session-header-model" class="min-w-0 max-w-full truncate">
        {session.modelSnapshot.model}
      </span>
      <span class="shrink-0">{$t(getApprovalModeLabelKey(session.approvalMode))}</span>
    </div>
  </div>

  <div data-testid="agent-session-header-actions" class="flex min-w-0 flex-wrap items-center justify-end gap-2">
    {#if onCancel}
      <button
        type="button"
        class="rounded-full border border-red-300 px-3 py-2 text-sm font-medium text-red-700 hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-60 dark:border-red-800 dark:text-red-300 dark:hover:bg-red-950"
        disabled={cancelDisabled}
        onclick={onCancel}
      >
        {$t('assistant_close_session')}
      </button>
    {/if}
    <button
      type="button"
      class="inline-flex h-9 w-9 items-center justify-center rounded-full border border-gray-300 text-gray-600 hover:bg-gray-50 dark:border-gray-700 dark:text-neutral-300 dark:hover:bg-gray-800"
      aria-label={$t('assistant_details')}
      title={$t('assistant_details')}
      onclick={onOpenDetails}
    >
      <Icon icon={mdiInformationOutline} size="18" />
    </button>
  </div>
</section>
