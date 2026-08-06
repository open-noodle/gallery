<script lang="ts">
  import {
    cancelAgentSession,
    getAgentSession,
    type AgentMessageResponseDto,
    type AgentSessionResponseDto,
    type AgentToolCallResponseDto,
  } from '@immich/sdk';
  import { onDestroy } from 'svelte';
  import { t } from 'svelte-i18n';
  import AgentSessionActionDock from './agent-session-action-dock.svelte';
  import AgentSessionChatPanel from './agent-session-chat-panel.svelte';
  import AgentSessionDetailsDrawer from './agent-session-details-drawer.svelte';
  import AgentSessionHeader from './agent-session-header.svelte';
  import { getAgentSessionComposerState, isAgentSessionCancellable } from './agent-session-lifecycle-ui';

  interface Props {
    session: AgentSessionResponseDto;
    title?: string | null;
    seedMessages?: AgentMessageResponseDto[];
    assistantResponsePending?: boolean;
    onNewChat: () => void;
    onTitleDiscovered?: (sessionId: string, title: string) => void;
    onSessionUpdated?: (session: AgentSessionResponseDto) => void;
  }

  let {
    session,
    title = null,
    seedMessages = [],
    assistantResponsePending = false,
    onNewChat,
    onTitleDiscovered,
    onSessionUpdated,
  }: Props = $props();

  let detailsOpen = $state(false);
  // Close the drawer only when actually switching sessions — the session prop's object
  // identity churns on periodic refreshes (dock poll), which must not affect the drawer.
  let detailsOpenSessionId = session.id;
  $effect(() => {
    if (session.id !== detailsOpenSessionId) {
      detailsOpenSessionId = session.id;
      detailsOpen = false;
    }
  });
  let pendingApprovalCount = $state(0);
  let approvalResumePending = $state(false);
  let recentToolCalls = $state<AgentToolCallResponseDto[]>([]);
  let turnRunning = $state(false);
  let cancelBusy = $state(false);
  let lifecycleError = $state<string | null>(null);
  let refreshSequence = 0;
  let cancelSequence = 0;
  let destroyed = false;

  const effectivePendingApprovalCount = $derived(approvalResumePending ? 0 : pendingApprovalCount);
  const composerState = $derived(
    getAgentSessionComposerState(session.status, { pendingApprovalCount: effectivePendingApprovalCount }),
  );
  const composerDisabledReason = $derived(composerState.disabledReasonKey ? $t(composerState.disabledReasonKey) : null);
  const terminalActionLabel = $derived(
    composerState.terminalActionLabelKey ? $t(composerState.terminalActionLabelKey) : undefined,
  );

  const isCurrentSession = (sessionId: string) => !destroyed && session.id === sessionId;

  const refreshSelectedSession = async (sessionId: string) => {
    const requestSequence = ++refreshSequence;

    try {
      const refreshedSession = await getAgentSession({ id: sessionId });

      if (!isCurrentSession(sessionId) || requestSequence !== refreshSequence || refreshedSession.id !== sessionId) {
        return;
      }

      lifecycleError = null;
      onSessionUpdated?.(refreshedSession);
    } catch {
      if (!isCurrentSession(sessionId) || requestSequence !== refreshSequence) {
        return;
      }

      lifecycleError = $t('assistant_message_refresh_error');
    }
  };

  const cancelSelectedSession = async () => {
    const sessionId = session.id;

    if (!isAgentSessionCancellable(session.status) || cancelBusy) {
      return;
    }

    const requestSequence = ++cancelSequence;
    cancelBusy = true;
    lifecycleError = null;

    try {
      const cancelledSession = await cancelAgentSession({ id: sessionId });

      if (!isCurrentSession(sessionId) || requestSequence !== cancelSequence || cancelledSession.id !== sessionId) {
        return;
      }

      onSessionUpdated?.(cancelledSession);
    } catch {
      if (!isCurrentSession(sessionId) || requestSequence !== cancelSequence) {
        return;
      }

      lifecycleError = $t('assistant_session_cancel_error');
    } finally {
      if (isCurrentSession(sessionId) && requestSequence === cancelSequence) {
        cancelBusy = false;
      }
    }
  };

  const cancelHandler = $derived(isAgentSessionCancellable(session.status) ? cancelSelectedSession : null);

  $effect(() => {
    void session.id;
    pendingApprovalCount = 0;
    approvalResumePending = false;
    recentToolCalls = [];
    lifecycleError = null;
    cancelBusy = false;
    refreshSequence += 1;
    cancelSequence += 1;
  });

  onDestroy(() => {
    destroyed = true;
    refreshSequence += 1;
    cancelSequence += 1;
  });
</script>

<section class="flex h-full min-h-0 flex-col text-black dark:text-white" aria-labelledby="agent-session-header-title">
  <AgentSessionHeader
    {session}
    {title}
    onCancel={cancelHandler}
    cancelDisabled={cancelBusy}
    onOpenDetails={() => (detailsOpen = true)}
  />
  <AgentSessionDetailsDrawer {session} open={detailsOpen} onClose={() => (detailsOpen = false)} />

  {#if lifecycleError}
    <div
      class="border-b border-red-100 bg-red-50 px-4 py-2 text-sm text-red-700 dark:border-red-900 dark:bg-red-950 dark:text-red-200 md:px-6"
      role="alert"
    >
      {lifecycleError}
    </div>
  {/if}

  <div class="min-h-0 flex-1 overflow-hidden">
    {#key session.id}
      {#snippet actionDock()}
        <AgentSessionActionDock
          {session}
          {turnRunning}
          {onSessionUpdated}
          onPendingApprovalCountChange={(count) => (pendingApprovalCount = count)}
          onApprovalResumePendingChange={(pending) => (approvalResumePending = pending)}
          onRecentToolCallsChange={(toolCalls) => (recentToolCalls = toolCalls)}
        />
      {/snippet}

      <AgentSessionChatPanel
        {session}
        {actionDock}
        toolCalls={recentToolCalls}
        {seedMessages}
        assistantResponsePending={assistantResponsePending || approvalResumePending}
        suppressPendingApprovalActivity={approvalResumePending}
        composerDisabled={composerState.disabled}
        {composerDisabledReason}
        composerPlaceholder={$t(composerState.placeholderKey)}
        submitLabel={$t(composerState.submitLabelKey)}
        {terminalActionLabel}
        onTerminalAction={terminalActionLabel ? onNewChat : undefined}
        onTurnRunningChange={(active) => (turnRunning = active)}
        onMessageSent={refreshSelectedSession}
        onRunnerError={refreshSelectedSession}
        {onTitleDiscovered}
      />
    {/key}
  </div>
</section>
