<script lang="ts">
  import { websocketEvents, type AgentSessionClientEvent } from '$lib/stores/websocket';
  import { handleError } from '$lib/utils/handle-error';
  import {
    AgentSessionStatus,
    AgentToolApprovalDecision,
    approveToolCall,
    getAgentSession,
    getToolCalls,
    type AgentSessionResponseDto,
    type AgentToolCallResponseDto,
  } from '@immich/sdk';
  import { onDestroy, onMount } from 'svelte';
  import { t } from 'svelte-i18n';
  import AgentOperationPlanReviewPanel from './agent-operation-plan-review-panel.svelte';
  import AgentToolApprovalCard from './agent-tool-approval-card.svelte';
  import { areAgentTimelineToolCallListsEquivalent } from './agent-session-tool-call-state-ui';
  import { buildToolApprovalPayload, getPendingToolCalls, getTimelineToolCalls } from './agent-tool-approval-ui';

  interface Props {
    session: AgentSessionResponseDto;
    turnRunning?: boolean;
    onSessionUpdated?: (session: AgentSessionResponseDto) => void;
    onPendingApprovalCountChange?: (count: number) => void;
    onApprovalResumePendingChange?: (pending: boolean) => void;
    onRecentToolCallsChange?: (toolCalls: AgentToolCallResponseDto[]) => void;
  }

  let {
    session,
    turnRunning = false,
    onSessionUpdated,
    onPendingApprovalCountChange,
    onApprovalResumePendingChange,
    onRecentToolCallsChange,
  }: Props = $props();

  let toolCalls = $state<AgentToolCallResponseDto[]>([]);
  let loading = $state(true);
  let loadErrorMessage = $state<string | null>(null);
  let refreshErrorMessage = $state<string | null>(null);
  let busyByToolCallId = $state<Record<string, boolean>>({});
  let errorByToolCallId = $state<Record<string, string>>({});
  let cleanupWebsocketListener: (() => void) | undefined;
  let interval: ReturnType<typeof setInterval> | undefined;
  let loadSequence = 0;
  let destroyed = false;
  let activeSessionId: string | undefined;

  const pendingToolCalls = $derived(getPendingToolCalls(toolCalls));
  // Sessions rest at Running between turns — poll only while a turn is actually in
  // progress (signalled by the chat panel) or while approvals/apply work is pending.
  const shouldPoll = $derived(
    turnRunning ||
      session.status === AgentSessionStatus.WaitingForToolApproval ||
      session.status === AgentSessionStatus.Applying,
  );
  const canShowPlanReview = $derived((!loading || loadErrorMessage !== null) && pendingToolCalls.length === 0);

  const publishToolCallState = (nextToolCalls: AgentToolCallResponseDto[]) => {
    onPendingApprovalCountChange?.(getPendingToolCalls(nextToolCalls).length);
    onRecentToolCallsChange?.(getTimelineToolCalls(nextToolCalls));
  };

  const setToolCalls = (nextToolCalls: AgentToolCallResponseDto[]) => {
    if (areAgentTimelineToolCallListsEquivalent(toolCalls, nextToolCalls)) {
      return;
    }

    toolCalls = nextToolCalls;
    publishToolCallState(nextToolCalls);
  };

  const replaceToolCall = (toolCall: AgentToolCallResponseDto) => {
    const nextToolCalls = [toolCall, ...toolCalls.filter((existingToolCall) => existingToolCall.id !== toolCall.id)];
    setToolCalls(nextToolCalls);
  };

  const refreshSession = async () => {
    const sessionId = session.id;
    try {
      const nextSession = await getAgentSession({ id: sessionId });
      if (destroyed || nextSession.id !== session.id || nextSession.id !== sessionId) {
        return;
      }

      onSessionUpdated?.(nextSession);
    } catch {
      // Approval/plan refresh should still update local dock state when session status refresh misses once.
    }
  };

  const loadToolCalls = async ({ quiet = false }: { quiet?: boolean } = {}) => {
    const sequence = ++loadSequence;
    const sessionId = session.id;
    if (!quiet) {
      loading = true;
      loadErrorMessage = null;
    }

    try {
      const nextToolCalls = await getToolCalls({ id: sessionId });
      if (destroyed || sequence !== loadSequence || session.id !== sessionId) {
        return;
      }

      setToolCalls(nextToolCalls);
      loadErrorMessage = null;

      if (shouldPoll) {
        try {
          const nextSession = await getAgentSession({ id: sessionId });
          if (destroyed || sequence !== loadSequence || session.id !== sessionId || nextSession.id !== sessionId) {
            return;
          }

          onSessionUpdated?.(nextSession);
        } catch {
          // Tool-call polling should remain useful even if the session status refresh misses once.
        }
      }
    } catch (error) {
      if (destroyed || sequence !== loadSequence || session.id !== sessionId) {
        return;
      }

      if (quiet) {
        return;
      }

      loadErrorMessage = $t('assistant_approval_tool_calls_error');
      handleError(error, loadErrorMessage);
    } finally {
      if (!destroyed && sequence === loadSequence) {
        loading = false;
      }
    }
  };

  const refreshAfterDecision = async (toolCall: AgentToolCallResponseDto) => {
    try {
      const nextSession = await getAgentSession({ id: session.id });
      onSessionUpdated?.(nextSession);
      await loadToolCalls({ quiet: true });
    } catch (error) {
      refreshErrorMessage = $t('assistant_approval_refresh_error');
      replaceToolCall(toolCall);
      handleError(error, refreshErrorMessage);
    }
  };

  const decide = async (toolCallId: string, decision: AgentToolApprovalDecision, reason?: string) => {
    busyByToolCallId = { ...busyByToolCallId, [toolCallId]: true };
    onApprovalResumePendingChange?.(true);
    const remainingErrors = { ...errorByToolCallId };
    delete remainingErrors[toolCallId];
    errorByToolCallId = remainingErrors;
    refreshErrorMessage = null;

    try {
      const toolCall = await approveToolCall({
        id: session.id,
        toolCallId,
        agentToolApprovalDto: buildToolApprovalPayload(decision, reason),
      });
      await refreshAfterDecision(toolCall);
    } catch (error) {
      errorByToolCallId = { ...errorByToolCallId, [toolCallId]: $t('assistant_approval_action_error') };
      handleError(error, errorByToolCallId[toolCallId]);
    } finally {
      const remainingBusy = { ...busyByToolCallId };
      delete remainingBusy[toolCallId];
      busyByToolCallId = remainingBusy;
      onApprovalResumePendingChange?.(Object.values(remainingBusy).some(Boolean));
    }
  };

  const handleSessionEvent = (event: AgentSessionClientEvent) => {
    if (event.sessionId !== session.id) {
      return;
    }

    void loadToolCalls({ quiet: true });

    if (event.type === 'operation-plan-applied') {
      void refreshSession();
    }
  };

  const startPolling = () => {
    if (!shouldPoll || interval) {
      return;
    }

    interval = setInterval(() => void loadToolCalls({ quiet: true }), 3000);
  };

  const stopPolling = () => {
    if (interval) {
      clearInterval(interval);
      interval = undefined;
    }
  };

  $effect(() => {
    stopPolling();
    startPolling();
  });

  $effect(() => {
    const nextSessionId = session.id;
    if (activeSessionId === nextSessionId) {
      return;
    }

    activeSessionId = nextSessionId;
    loadSequence += 1;
    toolCalls = [];
    publishToolCallState([]);
    void loadToolCalls();
  });

  onMount(() => {
    cleanupWebsocketListener = websocketEvents.on('on_agent_session_event', handleSessionEvent);
  });

  onDestroy(() => {
    destroyed = true;
    loadSequence += 1;
    stopPolling();
    cleanupWebsocketListener?.();
    onPendingApprovalCountChange?.(0);
    onApprovalResumePendingChange?.(false);
    onRecentToolCallsChange?.([]);
  });
</script>

<section class="flex flex-col gap-3" aria-label={$t('assistant_approval_request')}>
  {#if loading}
    <p class="text-sm text-gray-500 dark:text-gray-400" role="status">{$t('loading')}</p>
  {/if}

  {#if loadErrorMessage}
    <p class="text-sm text-red-600 dark:text-red-400" role="alert">{loadErrorMessage}</p>
  {/if}

  {#if refreshErrorMessage}
    <p class="text-sm text-amber-700 dark:text-amber-300" role="alert">{refreshErrorMessage}</p>
  {/if}

  {#each pendingToolCalls as toolCall (toolCall.id)}
    <AgentToolApprovalCard
      {session}
      {toolCall}
      busy={busyByToolCallId[toolCall.id] === true}
      errorMessage={errorByToolCallId[toolCall.id] ?? null}
      onApprove={(id) => decide(id, AgentToolApprovalDecision.Approved)}
      onDeny={(id, reason) => decide(id, AgentToolApprovalDecision.Denied, reason)}
    />
  {/each}

  {#if canShowPlanReview}
    <AgentOperationPlanReviewPanel {session} variant="dock" hideEmpty />
  {/if}
</section>
