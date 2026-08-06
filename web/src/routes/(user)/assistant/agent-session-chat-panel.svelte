<script lang="ts">
  import { websocketEvents, type AgentSessionClientEvent } from '$lib/stores/websocket';
  import { getAssetMediaUrl } from '$lib/utils';
  import { handleError } from '$lib/utils/handle-error';
  import {
    appendAgentSessionMessage,
    getAgentSessionMessages,
    getAppliedOperationPlans,
    getCurrentOperationPlan,
  } from '@immich/sdk';
  import * as agentSdk from '@immich/sdk';
  import {
    AgentMessageClarificationBlockType,
    AgentMessageRole,
    AgentMessageTextBlockType,
    AgentSessionStatus,
    AgentSessionActivityEventStatus,
    AgentToolCallStatus,
    AssetMediaSize,
    type AgentMessageClarificationBlock,
    type AgentMessageClarificationChoice,
    type AgentMessageResponseDto,
    type AgentOperationPlanResponseDto,
    type AgentSessionResponseDto,
    type AgentToolCallResponseDto,
  } from '@immich/sdk';
  import { Button } from '@immich/ui';
  import { onDestroy, onMount, type Snippet } from 'svelte';
  import { SvelteMap, SvelteSet } from 'svelte/reactivity';
  import { t } from 'svelte-i18n';
  import { type AgentActivityEvent } from './agent-session-activity-turns-ui';
  import {
    areAgentTimelineToolCallListsEquivalent,
    mergeAgentTimelineToolCalls,
  } from './agent-session-tool-call-state-ui';
  import {
    getAgentToolCallCompletedText,
    getAgentToolCallScopeText,
    getAgentToolDataClassLabelKey,
    getAgentToolNameLabelKey,
  } from './agent-tool-approval-ui';
  import { buildAgentClarificationChoiceReply, getAgentClarificationInitials } from './agent-message-clarification-ui';
  import { deriveAgentSessionTitleFromMessages } from './agent-session-workspace-ui';
  import { buildAgentTurnTimelines, type AgentTurnTimeline } from './agent-turn-timeline-ui';
  import AgentTurnTimelineComponent from './agent-turn-timeline.svelte';
  import AgentAppliedPlanTimelineCard from './agent-applied-plan-timeline-card.svelte';

  interface Props {
    session: AgentSessionResponseDto;
    actionDock?: Snippet;
    toolCalls?: AgentToolCallResponseDto[];
    seedMessages?: AgentMessageResponseDto[];
    assistantResponsePending?: boolean;
    suppressPendingApprovalActivity?: boolean;
    composerDisabled?: boolean;
    composerDisabledReason?: string | null;
    composerPlaceholder?: string;
    submitLabel?: string;
    terminalActionLabel?: string;
    onTerminalAction?: () => void;
    onTurnRunningChange?: (turnRunning: boolean) => void;
    onMessageSent?: (sessionId: string) => void | Promise<void>;
    onRunnerError?: (sessionId: string) => void | Promise<void>;
    onTitleDiscovered?: (sessionId: string, title: string) => void;
  }

  type AssistantMarkdownInlineSegment =
    | {
        type: 'text' | 'strong' | 'emphasis' | 'code';
        text: string;
      }
    | {
        type: 'link';
        text: string;
        url: string;
        title: string | null;
      }
    | {
        type: 'image';
        alt: string;
        url: string;
        title: string | null;
      };

  type AssistantMarkdownBlock =
    | { type: 'paragraph'; segments: AssistantMarkdownInlineSegment[] }
    | { type: 'heading'; level: 1 | 2 | 3; segments: AssistantMarkdownInlineSegment[] }
    | { type: 'list'; items: AssistantMarkdownInlineSegment[][] }
    | { type: 'table'; headers: AssistantMarkdownInlineSegment[][]; rows: AssistantMarkdownInlineSegment[][][] }
    | { type: 'codeBlock'; code: string; language: string | null };

  type ChatTimelineItem =
    | { type: 'message'; id: string; occurredAt: string; message: AgentMessageResponseDto }
    | { type: 'turn-timeline'; id: string; occurredAt: string; timeline: AgentTurnTimeline }
    | { type: 'tool-call'; id: string; occurredAt: string; toolCall: AgentToolCallResponseDto }
    | { type: 'applied-plan'; id: string; occurredAt: string; plan: AgentOperationPlanResponseDto };

  let {
    session,
    actionDock,
    toolCalls = [],
    seedMessages = [],
    assistantResponsePending = false,
    suppressPendingApprovalActivity = false,
    composerDisabled = false,
    composerDisabledReason = null,
    composerPlaceholder,
    submitLabel,
    terminalActionLabel,
    onTerminalAction,
    onTurnRunningChange,
    onMessageSent,
    onRunnerError,
    onTitleDiscovered,
  }: Props = $props();

  let messages = $state<AgentMessageResponseDto[]>([]);
  let appliedPlans = $state<AgentOperationPlanResponseDto[]>([]);
  let draft = $state('');
  let isSending = $state(false);
  let isAssistantActive = $state(false);
  let errorMessage = $state<string | null>(null);
  let messagesLoaded = $state(false);
  let streamingText = $state('');
  let expandedToolCallIds = $state<Record<string, boolean>>({});
  let currentPlan = $state<AgentOperationPlanResponseDto | null>(null);
  let activityEvents = $state<AgentActivityEvent[]>([]);
  let timelineToolCalls = $state<AgentToolCallResponseDto[]>([]);
  let timelineToolCallSessionId = $state<string | null>(null);
  let lastPublishedTitle: string | null = null;
  let cleanupWebsocketListener: (() => void) | undefined;
  let appliedPlanLoadSequence = 0;
  let currentPlanLoadSequence = 0;
  let activityEventLoadSequence = 0;

  const assistantContinuationToolStatuses = new Set<AgentToolCallStatus>([
    AgentToolCallStatus.Approved,
    AgentToolCallStatus.Completed,
    AgentToolCallStatus.Denied,
  ]);
  const latestAssistantMessageAt = $derived(
    messages
      .filter((message) => message.role === AgentMessageRole.Assistant)
      .map((message) => message.createdAt)
      .sort()
      .at(-1) ?? null,
  );
  const latestActivityNeedingAssistantAt = $derived(
    [
      ...messages.filter((message) => message.role === AgentMessageRole.User).map((message) => message.createdAt),
      ...timelineToolCalls
        .filter((toolCall) => assistantContinuationToolStatuses.has(toolCall.status))
        .map((toolCall) => toolCall.completedAt ?? toolCall.startedAt),
    ]
      .sort()
      .at(-1) ?? null,
  );
  const isRunningAwaitingAssistant = $derived(
    session.status === AgentSessionStatus.Running &&
      errorMessage === null &&
      latestActivityNeedingAssistantAt !== null &&
      (latestAssistantMessageAt === null || latestActivityNeedingAssistantAt > latestAssistantMessageAt),
  );
  const canHavePendingAssistantResponse = $derived(
    session.status === AgentSessionStatus.Created ||
      session.status === AgentSessionStatus.Running ||
      session.status === AgentSessionStatus.WaitingForToolApproval ||
      session.status === AgentSessionStatus.WaitingForPlanReview,
  );
  const isResponsePending = $derived(
    isSending ||
      (canHavePendingAssistantResponse &&
        (isAssistantActive || assistantResponsePending || isRunningAwaitingAssistant)),
  );
  const canSend = $derived(draft.trim().length > 0 && !isResponsePending && !composerDisabled);
  const activitySession = $derived(
    session.status === AgentSessionStatus.Applying && appliedPlans.length > 0
      ? { ...session, status: AgentSessionStatus.Running }
      : session,
  );
  const pendingApprovalToolCallIdsSuppressedForResume = $derived(
    new Set(
      suppressPendingApprovalActivity
        ? timelineToolCalls
            .filter((toolCall) => toolCall.status === AgentToolCallStatus.PendingApproval)
            .map((toolCall) => toolCall.id)
        : [],
    ),
  );
  const activityToolCalls = $derived(
    suppressPendingApprovalActivity
      ? timelineToolCalls.filter((toolCall) => toolCall.status !== AgentToolCallStatus.PendingApproval)
      : timelineToolCalls,
  );
  const turnTimelines = $derived(
    buildAgentTurnTimelines({
      session: activitySession,
      messages,
      toolCalls: activityToolCalls,
      activityEvents,
    }),
  );
  const latestTurnRunning = $derived(turnTimelines.at(-1)?.state === 'running');
  $effect(() => {
    onTurnRunningChange?.(latestTurnRunning);
  });
  // Websocket delivery is best-effort (dev restarts, reconnect gaps, mount races on fast
  // turns). While the latest turn is running, poll messages + activity events so the chat
  // converges without events; the poll stops itself the moment the turn settles.
  $effect(() => {
    if (!latestTurnRunning) {
      return;
    }
    const interval = setInterval(() => {
      void loadMessages();
      void loadActivityEvents();
    }, 2500);
    return () => clearInterval(interval);
  });
  const coveredToolCallIds = $derived(
    new Set([
      ...turnTimelines.flatMap((timeline) => timeline.rows.map((row) => row.id)),
      ...pendingApprovalToolCallIdsSuppressedForResume,
    ]),
  );
  const chatTimelineItems = $derived(
    buildChatTimelineItems(
      messages,
      timelineToolCalls,
      appliedPlans,
      turnTimelines,
      coveredToolCallIds,
      messagesLoaded || messages.length > 0,
    ),
  );
  const terminalStatuses = new Set<AgentSessionStatus>([
    AgentSessionStatus.Applying,
    AgentSessionStatus.Completed,
    AgentSessionStatus.Cancelled,
    AgentSessionStatus.Failed,
  ]);

  type AgentMessageBlock = AgentMessageResponseDto['content']['blocks'][number];

  const isTextMessageBlock = (block: AgentMessageBlock) => block.type === AgentMessageTextBlockType.Text;

  const isClarificationMessageBlock = (block: AgentMessageBlock): block is AgentMessageClarificationBlock =>
    block.type === AgentMessageClarificationBlockType.Clarification;

  const hasRenderableMessageBlocks = (message: AgentMessageResponseDto) =>
    message.content.blocks.some(
      (block) =>
        isTextMessageBlock(block) ||
        (message.role === AgentMessageRole.Assistant && isClarificationMessageBlock(block)),
    );

  function buildChatTimelineItems(
    timelineMessages: AgentMessageResponseDto[],
    timelineToolCalls: AgentToolCallResponseDto[],
    timelineAppliedPlans: AgentOperationPlanResponseDto[],
    timelineTurnTimelines: AgentTurnTimeline[],
    timelineCoveredToolCallIds: Set<string>,
    renderUncoveredToolCalls: boolean,
  ): ChatTimelineItem[] {
    const typePriority: Record<ChatTimelineItem['type'], number> = {
      message: 0,
      'turn-timeline': 1,
      'tool-call': 2,
      'applied-plan': 3,
    };

    // find the anchor user message createdAt for a timeline by its anchorMessageId
    const anchorCreatedAt = (anchorMessageId: string): string => {
      const msg = timelineMessages.find((m) => m.id === anchorMessageId);
      return msg?.createdAt ?? anchorMessageId;
    };

    return [
      ...timelineMessages.map((message) => ({
        type: 'message' as const,
        id: `message-${message.id}`,
        occurredAt: message.createdAt,
        message,
      })),
      ...timelineTurnTimelines
        .filter((timeline) => timeline.summary !== null || timeline.state === 'running')
        .map((timeline) => ({
          type: 'turn-timeline' as const,
          id: `turn-timeline-${timeline.anchorMessageId}`,
          occurredAt: anchorCreatedAt(timeline.anchorMessageId),
          timeline,
        })),
      ...(renderUncoveredToolCalls
        ? timelineToolCalls
            .filter((toolCall) => !timelineCoveredToolCallIds.has(toolCall.id))
            .map((toolCall) => ({
              type: 'tool-call' as const,
              id: `tool-call-${toolCall.id}`,
              occurredAt: toolCall.startedAt,
              toolCall,
            }))
        : []),
      ...dedupeAppliedPlans(timelineAppliedPlans).map((plan) => ({
        type: 'applied-plan' as const,
        id: `applied-plan-${plan.id}-${plan.revision}`,
        occurredAt: plan.updatedAt,
        plan,
      })),
    ].sort(
      (first, second) =>
        first.occurredAt.localeCompare(second.occurredAt) ||
        typePriority[first.type] - typePriority[second.type] ||
        first.id.localeCompare(second.id),
    );
  }

  function dedupeAppliedPlans(plans: AgentOperationPlanResponseDto[]) {
    const plansByKey = new SvelteMap<string, AgentOperationPlanResponseDto>();

    for (const plan of plans) {
      plansByKey.set(`${plan.id}:${plan.revision}`, plan);
    }

    return [...plansByKey.values()];
  }

  const loadAppliedOperationPlans = async (sessionId: string) => {
    const response = await getAppliedOperationPlans({ id: sessionId });

    return Array.isArray(response) ? response : [];
  };

  const loadAgentSessionActivityEvents = async (sessionId: string): Promise<AgentActivityEvent[]> => {
    const response = await agentSdk.getAgentSessionActivityEvents({ id: sessionId });

    return Array.isArray(response) ? response : [];
  };

  const getToolCallStatusLabel = (status: AgentToolCallStatus) => {
    if (status === AgentToolCallStatus.Completed) {
      return 'Done';
    }

    if (status === AgentToolCallStatus.Denied) {
      return 'Not allowed';
    }

    if (status === AgentToolCallStatus.Approved) {
      return 'Approved';
    }

    return 'Failed';
  };

  const toggleToolCallDetails = (toolCallId: string) => {
    expandedToolCallIds = { ...expandedToolCallIds, [toolCallId]: !expandedToolCallIds[toolCallId] };
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

  const parseAssistantInlineMarkdown = (text: string): AssistantMarkdownInlineSegment[] => {
    const segments: AssistantMarkdownInlineSegment[] = [];
    const inlinePattern =
      /(!\[([^\]\n]*)\]\(([^\s)]+)(?:\s+"([^"\n]*)")?\)|\[([^\]\n]+)\]\(([^\s)]+)(?:\s+"([^"\n]*)")?\)|`([^`\n]+)`|\*\*([^*\n]+)\*\*|\*([^*\n]+)\*)/g;
    let lastIndex = 0;
    let match: RegExpExecArray | null;

    while ((match = inlinePattern.exec(text))) {
      if (match.index > lastIndex) {
        segments.push({ type: 'text', text: text.slice(lastIndex, match.index) });
      }

      if (match[2] !== undefined && match[3]) {
        segments.push({ type: 'image', alt: match[2], url: match[3], title: match[4] ?? null });
      } else if (match[5] && match[6]) {
        segments.push({ type: 'link', text: match[5], url: match[6], title: match[7] ?? null });
      } else if (match[8]) {
        segments.push({ type: 'code', text: match[8] });
      } else if (match[9]) {
        segments.push({ type: 'strong', text: match[9] });
      } else if (match[10]) {
        segments.push({ type: 'emphasis', text: match[10] });
      }

      lastIndex = match.index + match[0].length;
    }

    if (lastIndex < text.length) {
      segments.push({ type: 'text', text: text.slice(lastIndex) });
    }

    return segments.length > 0 ? segments : [{ type: 'text', text }];
  };

  const parseAssistantMarkdown = (text: string): AssistantMarkdownBlock[] => {
    const blocks: AssistantMarkdownBlock[] = [];
    const lines = text.replaceAll('\r\n', '\n').split('\n');
    const paragraphLines: string[] = [];
    let listItems: AssistantMarkdownInlineSegment[][] = [];
    let codeBlockLines: string[] | null = null;
    let codeBlockLanguage: string | null = null;

    const flushParagraph = () => {
      if (paragraphLines.length === 0) {
        return;
      }

      blocks.push({ type: 'paragraph', segments: parseAssistantInlineMarkdown(paragraphLines.join('\n')) });
      paragraphLines.length = 0;
    };

    const flushList = () => {
      if (listItems.length === 0) {
        return;
      }

      blocks.push({ type: 'list', items: listItems });
      listItems = [];
    };

    const splitTableRow = (line: string) => {
      const trimmedLine = line.trim();
      const withoutOuterPipes = trimmedLine.replace(/^\|/, '').replace(/\|$/, '');

      return withoutOuterPipes.split('|').map((cell) => cell.trim());
    };

    const isTableSeparatorRow = (line: string) => {
      const cells = splitTableRow(line);

      return cells.length > 1 && cells.every((cell) => /^:?-{3,}:?$/.test(cell));
    };

    const isTableDataRow = (line: string) => splitTableRow(line).length > 1;

    for (let index = 0; index < lines.length; index++) {
      const line = lines[index];
      if (codeBlockLines) {
        if (/^```\s*$/.test(line)) {
          blocks.push({ type: 'codeBlock', code: codeBlockLines.join('\n'), language: codeBlockLanguage });
          codeBlockLines = null;
          codeBlockLanguage = null;
        } else {
          codeBlockLines.push(line);
        }
        continue;
      }

      const codeBlockMatch = line.match(/^```(\S*)\s*$/);
      if (codeBlockMatch) {
        flushParagraph();
        flushList();
        codeBlockLines = [];
        codeBlockLanguage = codeBlockMatch[1] || null;
        continue;
      }

      if (isTableDataRow(line) && lines[index + 1] && isTableSeparatorRow(lines[index + 1])) {
        flushParagraph();
        flushList();

        const headers = splitTableRow(line).map((header) => parseAssistantInlineMarkdown(header));
        const rows: AssistantMarkdownInlineSegment[][][] = [];
        index += 2;

        while (index < lines.length && lines[index].trim().length > 0 && isTableDataRow(lines[index])) {
          rows.push(splitTableRow(lines[index]).map((cell) => parseAssistantInlineMarkdown(cell)));
          index++;
        }

        index--;
        blocks.push({ type: 'table', headers, rows });
        continue;
      }

      const headingMatch = line.match(/^(#{1,3})\s+(.+)$/);
      if (headingMatch) {
        flushParagraph();
        flushList();
        blocks.push({
          type: 'heading',
          level: headingMatch[1].length as 1 | 2 | 3,
          segments: parseAssistantInlineMarkdown(headingMatch[2]),
        });
        continue;
      }

      const listMatch = line.match(/^-\s+(.+)$/);
      if (listMatch) {
        flushParagraph();
        listItems.push(parseAssistantInlineMarkdown(listMatch[1]));
        continue;
      }

      flushList();
      if (line.trim().length === 0) {
        flushParagraph();
        continue;
      }

      paragraphLines.push(line);
    }

    flushParagraph();
    flushList();
    if (codeBlockLines) {
      blocks.push({ type: 'codeBlock', code: codeBlockLines.join('\n'), language: codeBlockLanguage });
    }

    return blocks;
  };

  const mergeMessages = (firstMessages: AgentMessageResponseDto[], secondMessages: AgentMessageResponseDto[]) => {
    const seenIds = new SvelteSet<string>();
    const mergedMessages: AgentMessageResponseDto[] = [];

    for (const message of [...firstMessages, ...secondMessages]) {
      if (seenIds.has(message.id)) {
        continue;
      }

      seenIds.add(message.id);
      mergedMessages.push(message);
    }

    return mergedMessages;
  };

  const mergeActivityEvents = (firstEvents: AgentActivityEvent[], secondEvents: AgentActivityEvent[]) => {
    const eventsById = new SvelteMap<string, AgentActivityEvent>();

    for (const event of [...firstEvents, ...secondEvents]) {
      eventsById.set(event.id, event);
    }

    return [...eventsById.values()];
  };

  const publishDiscoveredTitle = (nextMessages: AgentMessageResponseDto[]) => {
    const title = deriveAgentSessionTitleFromMessages(nextMessages);

    if (!title || title === lastPublishedTitle) {
      return;
    }

    lastPublishedTitle = title;
    onTitleDiscovered?.(session.id, title);
  };

  const notifyMessageSent = () => {
    try {
      void onMessageSent?.(session.id)?.catch(() => undefined);
    } catch {
      // Follow-up refresh errors must not undo the successful append.
    }
  };

  const notifyRunnerError = () => {
    try {
      void onRunnerError?.(session.id)?.catch(() => undefined);
    } catch {
      // Follow-up refresh errors must not hide the runner error in chat.
    }
  };

  const appendIfNew = (message: AgentMessageResponseDto) => {
    const nextMessages = mergeMessages(messages, [message]);
    messages = nextMessages;
    publishDiscoveredTitle(nextMessages);
  };

  const removeMessageById = (messageId: string) => {
    messages = messages.filter((message) => message.id !== messageId);
  };

  const appendActivityEventIfNew = (event: AgentActivityEvent) => {
    activityEvents = mergeActivityEvents(activityEvents, [event]);
  };

  const handleSessionEvent = (event: AgentSessionClientEvent) => {
    if (event.sessionId !== session.id) {
      return;
    }

    if (event.type === 'assistant-message-delta') {
      isAssistantActive = true;
      streamingText += event.delta;
      return;
    }

    if (event.type === 'assistant-message-created') {
      isAssistantActive = false;
      streamingText = '';
      appendIfNew(event.message);
      return;
    }

    if (event.type === 'operation-plan-ready') {
      void loadCurrentPlan(session.id);
      return;
    }

    if (event.type === 'operation-plan-applied') {
      if (currentPlan?.id === event.planId) {
        currentPlan = null;
      }
      void loadAppliedPlans();
      return;
    }

    if (event.type === 'activity') {
      appendActivityEventIfNew(event.event);
      if (event.event.status !== AgentSessionActivityEventStatus.Running) {
        // A terminal lifecycle event marks a settled turn — re-sync messages in case the
        // assistant-message-created event raced this panel's subscription (merge is idempotent).
        void loadMessages();
      }
      return;
    }

    if (event.type === 'tool-approval-needed') {
      isAssistantActive = false;
      streamingText = '';
      return;
    }

    isAssistantActive = false;
    streamingText = '';
    errorMessage = event.message;
    notifyRunnerError();
  };

  const loadMessages = async () => {
    try {
      const loadedMessages = await getAgentSessionMessages({ id: session.id });
      const nextMessages = mergeMessages(loadedMessages, messages);
      messages = nextMessages;
      publishDiscoveredTitle(nextMessages);
    } catch (error) {
      errorMessage = $t('assistant_message_load_error');
      handleError(error, errorMessage);
    } finally {
      messagesLoaded = true;
    }
  };

  const loadAppliedPlans = async () => {
    const sequence = ++appliedPlanLoadSequence;

    try {
      const nextAppliedPlans = dedupeAppliedPlans(await loadAppliedOperationPlans(session.id));
      if (sequence !== appliedPlanLoadSequence) {
        return;
      }

      appliedPlans = nextAppliedPlans;
    } catch (error) {
      if (sequence !== appliedPlanLoadSequence) {
        return;
      }

      errorMessage = $t('assistant_message_load_error');
      handleError(error, errorMessage);
    }
  };

  const loadActivityEvents = async () => {
    const sequence = ++activityEventLoadSequence;

    try {
      const loadedActivityEvents = await loadAgentSessionActivityEvents(session.id);
      if (sequence !== activityEventLoadSequence) {
        return;
      }

      activityEvents = mergeActivityEvents(loadedActivityEvents, activityEvents);
    } catch (error) {
      if (sequence !== activityEventLoadSequence) {
        return;
      }

      handleError(error, $t('assistant_message_load_error'));
    }
  };

  const loadCurrentPlan = async (sessionId: string) => {
    const sequence = ++currentPlanLoadSequence;

    try {
      const nextPlan = await getCurrentOperationPlan({ id: sessionId });
      if (sequence !== currentPlanLoadSequence || session.id !== sessionId) {
        return;
      }

      currentPlan = nextPlan;
    } catch (error) {
      if (sequence !== currentPlanLoadSequence || session.id !== sessionId) {
        return;
      }

      handleError(error, $t('assistant_operation_plan_error'));
    }
  };

  const sendMessage = async () => {
    const text = draft.trim();

    if (!text || isSending || composerDisabled) {
      return;
    }

    isSending = true;
    errorMessage = null;
    isAssistantActive = true;
    draft = '';
    const pendingMessageId = `pending-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const pendingMessage: AgentMessageResponseDto = {
      id: pendingMessageId,
      sessionId: session.id,
      role: AgentMessageRole.User,
      providerMessageId: null,
      toolCallId: null,
      content: {
        blocks: [{ type: AgentMessageTextBlockType.Text, text }],
      },
      createdAt: new Date().toISOString(),
    };
    appendIfNew(pendingMessage);

    try {
      const message = await appendAgentSessionMessage({
        id: session.id,
        agentMessageCreateDto: {
          content: {
            blocks: [{ type: AgentMessageTextBlockType.Text, text }],
          },
        },
      });

      removeMessageById(pendingMessageId);
      appendIfNew(message);
      notifyMessageSent();
    } catch (error) {
      removeMessageById(pendingMessageId);
      draft = text;
      errorMessage = $t('assistant_message_send_error');
      handleError(error, errorMessage);
      isAssistantActive = false;
    } finally {
      isSending = false;
    }
  };

  const sendClarificationChoice = async (
    block: AgentMessageClarificationBlock,
    choice: AgentMessageClarificationChoice,
  ) => {
    if (isResponsePending || composerDisabled) {
      return;
    }

    draft = buildAgentClarificationChoiceReply(block, choice);
    await sendMessage();
  };

  const handleComposerKeydown = (event: KeyboardEvent) => {
    if (
      event.key !== 'Enter' ||
      event.shiftKey ||
      event.ctrlKey ||
      event.altKey ||
      event.metaKey ||
      event.isComposing
    ) {
      return;
    }

    event.preventDefault();
    void sendMessage();
  };

  onMount(() => {
    cleanupWebsocketListener = websocketEvents.on('on_agent_session_event', handleSessionEvent);
    void loadMessages();
    void loadAppliedPlans();
    void loadActivityEvents();
  });

  $effect(() => {
    const nextToolCalls = mergeAgentTimelineToolCalls(
      timelineToolCallSessionId === session.id ? timelineToolCalls : [],
      toolCalls,
      session.id,
    );

    timelineToolCallSessionId = session.id;

    if (!areAgentTimelineToolCallListsEquivalent(timelineToolCalls, nextToolCalls)) {
      timelineToolCalls = nextToolCalls;
    }
  });

  $effect(() => {
    if (canHavePendingAssistantResponse && !terminalStatuses.has(session.status)) {
      return;
    }

    isAssistantActive = false;
    streamingText = '';
  });

  $effect(() => {
    if (seedMessages.length === 0) {
      return;
    }

    const existingMessageIds = new SvelteSet(messages.map((message) => message.id));
    if (seedMessages.every((message) => existingMessageIds.has(message.id))) {
      return;
    }

    const nextMessages = mergeMessages(messages, seedMessages);
    messages = nextMessages;
    messagesLoaded = true;
    publishDiscoveredTitle(nextMessages);
  });

  $effect(() => {
    if (!assistantResponsePending) {
      return;
    }

    isAssistantActive = true;
  });

  $effect(() => {
    if (!composerDisabled) {
      return;
    }

    isAssistantActive = false;
    streamingText = '';
  });

  onDestroy(() => {
    appliedPlanLoadSequence += 1;
    currentPlanLoadSequence += 1;
    activityEventLoadSequence += 1;
    cleanupWebsocketListener?.();
  });
</script>

{#snippet assistantMarkdownInline(segments: AssistantMarkdownInlineSegment[])}
  {#each segments as segment (segment)}
    {#if segment.type === 'strong'}
      <strong class="font-semibold">{segment.text}</strong>
    {:else if segment.type === 'emphasis'}
      <em>{segment.text}</em>
    {:else if segment.type === 'code'}
      <code class="rounded bg-black/5 px-1 py-0.5 font-mono text-[0.92em] dark:bg-white/10">{segment.text}</code>
    {:else if segment.type === 'link'}
      <a
        class="text-blue-600 underline underline-offset-2 hover:text-blue-700 dark:text-blue-400 dark:hover:text-blue-300"
        href={segment.url}
        title={segment.title ?? undefined}
        target="_blank"
        rel="noreferrer"
      >
        {segment.text}
      </a>
    {:else if segment.type === 'image'}
      <img
        class="my-2 max-h-64 max-w-full rounded-md border border-gray-200 object-contain dark:border-neutral-800"
        src={segment.url}
        alt={segment.alt}
        title={segment.title ?? undefined}
      />
    {:else}
      {segment.text}
    {/if}
  {/each}
{/snippet}

{#snippet assistantMarkdown(blocks: AssistantMarkdownBlock[])}
  <div class="space-y-2">
    {#each blocks as block (block)}
      {#if block.type === 'paragraph'}
        <p class="whitespace-pre-wrap">{@render assistantMarkdownInline(block.segments)}</p>
      {:else if block.type === 'heading'}
        {#if block.level === 1}
          <h3 class="text-xl font-semibold">{@render assistantMarkdownInline(block.segments)}</h3>
        {:else if block.level === 2}
          <h4 class="text-lg font-semibold">{@render assistantMarkdownInline(block.segments)}</h4>
        {:else}
          <h5 class="text-base font-medium">{@render assistantMarkdownInline(block.segments)}</h5>
        {/if}
      {:else if block.type === 'list'}
        <ul class="list-disc space-y-1 pl-5">
          {#each block.items as item (item)}
            <li>{@render assistantMarkdownInline(item)}</li>
          {/each}
        </ul>
      {:else if block.type === 'codeBlock'}
        <pre class="overflow-x-auto rounded-md bg-black/5 p-3 text-xs leading-relaxed dark:bg-white/10"><code
            class="font-mono whitespace-pre">{block.code}</code
          ></pre>
      {:else}
        <div class="overflow-x-auto">
          <table class="min-w-full border-collapse text-left text-xs">
            <thead>
              <tr class="border-b border-gray-200 dark:border-neutral-700">
                {#each block.headers as header (header)}
                  <th class="px-3 py-2 font-semibold text-slate-950 dark:text-neutral-50">
                    {@render assistantMarkdownInline(header)}
                  </th>
                {/each}
              </tr>
            </thead>
            <tbody>
              {#each block.rows as row (row)}
                <tr class="border-b border-gray-100 last:border-0 dark:border-neutral-800">
                  {#each row as cell (cell)}
                    <td class="px-3 py-2 align-top text-slate-700 dark:text-neutral-200">
                      {@render assistantMarkdownInline(cell)}
                    </td>
                  {/each}
                </tr>
              {/each}
            </tbody>
          </table>
        </div>
      {/if}
    {/each}
  </div>
{/snippet}

<section
  class="relative h-full min-h-0 w-full overflow-hidden text-black dark:text-white"
  aria-labelledby="assistant-chat-title"
>
  <h2 id="assistant-chat-title" class="sr-only">{$t('assistant_chat')}</h2>

  {#if errorMessage}
    <div
      class="mx-auto w-full max-w-3xl shrink-0 border-b border-red-100 px-4 py-3 text-sm text-red-600 dark:border-red-900 dark:text-red-400 md:px-0"
      role="alert"
    >
      {errorMessage}
    </div>
  {/if}

  <div class="h-full overflow-y-auto" aria-live="polite">
    <div
      class="mx-auto flex min-h-full w-full max-w-5xl flex-col gap-4 px-4 pb-36 pt-6 md:px-0"
      data-testid="agent-session-chat-transcript"
    >
      {#each chatTimelineItems as item (item.id)}
        {#if item.type === 'message'}
          {@const message = item.message}
          {#if hasRenderableMessageBlocks(message)}
            <article
              data-chat-item
              data-testid="agent-session-message-bubble"
              class={[
                'max-w-[min(80%,48rem)] rounded-2xl px-4 py-3 text-sm whitespace-pre-wrap',
                message.role === AgentMessageRole.User
                  ? 'ml-auto bg-slate-100 text-slate-950 dark:bg-neutral-800 dark:text-neutral-50'
                  : 'mr-auto text-slate-950 dark:text-neutral-100',
              ]}
            >
              <div class="space-y-3">
                {#each message.content.blocks as block, blockIndex (`${message.id}-${blockIndex}`)}
                  {#if isTextMessageBlock(block)}
                    {#if message.role === AgentMessageRole.Assistant}
                      {@render assistantMarkdown(parseAssistantMarkdown(block.text))}
                    {:else}
                      <p class="whitespace-pre-wrap">{block.text}</p>
                    {/if}
                  {:else if message.role === AgentMessageRole.Assistant && isClarificationMessageBlock(block)}
                    <div class="space-y-3 whitespace-normal">
                      <div>
                        <p class="text-sm text-slate-950 dark:text-neutral-100">{block.summary}</p>
                        <p class="mt-1 text-xs text-gray-500 dark:text-gray-400">{block.textFallback}</p>
                      </div>
                      <div role="group" aria-label={$t('assistant_clarification_choices_label')} class="grid gap-2">
                        {#each block.choices as choice (choice.choiceRef)}
                          <button
                            type="button"
                            class="flex min-w-0 items-center gap-3 rounded-lg border border-gray-200 bg-white p-2 text-left shadow-sm hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-60 dark:border-neutral-800 dark:bg-neutral-950 dark:hover:bg-neutral-900"
                            aria-label={$t('assistant_clarification_send_choice', { values: { label: choice.label } })}
                            disabled={isResponsePending || composerDisabled}
                            onclick={() => sendClarificationChoice(block, choice)}
                          >
                            <span
                              class="relative flex size-10 shrink-0 items-center justify-center overflow-hidden rounded-md bg-gray-100 text-xs font-semibold text-gray-600 dark:bg-neutral-800 dark:text-neutral-300"
                            >
                              {#if choice.thumbnailAssetId}
                                <img
                                  class="size-full object-cover"
                                  src={getAssetMediaUrl({
                                    id: choice.thumbnailAssetId,
                                    size: AssetMediaSize.Thumbnail,
                                  })}
                                  alt={$t('assistant_clarification_choice_thumbnail_alt', {
                                    values: { label: choice.label },
                                  })}
                                  loading="lazy"
                                  draggable="false"
                                />
                              {:else}
                                <span aria-hidden="true">{getAgentClarificationInitials(choice.label)}</span>
                                <span class="sr-only">{$t('assistant_clarification_choice_unavailable')}</span>
                              {/if}
                            </span>
                            <span class="min-w-0">
                              <span class="block truncate text-sm font-medium text-slate-950 dark:text-neutral-50">
                                {choice.label}
                              </span>
                              {#if choice.description}
                                <span class="block truncate text-xs text-gray-500 dark:text-gray-400">
                                  {choice.description}
                                </span>
                              {/if}
                            </span>
                          </button>
                        {/each}
                      </div>
                    </div>
                  {/if}
                {/each}
              </div>
            </article>
          {/if}
        {:else if item.type === 'turn-timeline'}
          <AgentTurnTimelineComponent timeline={item.timeline} />
        {:else if item.type === 'applied-plan'}
          <AgentAppliedPlanTimelineCard plan={item.plan} />
        {:else}
          {@const toolCall = item.toolCall}
          {@const toolName = $t(getAgentToolNameLabelKey(toolCall.toolName))}
          {@const dataClass = $t(getAgentToolDataClassLabelKey(toolCall.dataClass))}
          {@const toolStatus = getToolCallStatusLabel(toolCall.status)}
          {@const actionText = getAgentToolCallCompletedText(toolCall)}
          {@const scopeText = getAgentToolCallScopeText(toolCall)}
          {@const detailsOpen = expandedToolCallIds[toolCall.id] === true}
          <article
            data-chat-item
            class="mr-auto w-full max-w-4xl rounded-lg border border-gray-200 bg-gray-50 px-3 py-2 text-xs text-slate-700 shadow-sm dark:border-neutral-800 dark:bg-neutral-950 dark:text-neutral-200"
            aria-label={`${actionText.replace(/\.$/, '')}: ${toolStatus}`}
          >
            <div class="flex flex-wrap items-center gap-2">
              <span class="rounded-full bg-white px-2 py-0.5 text-[0.7rem] font-medium dark:bg-neutral-900">
                {toolStatus}
              </span>
              <span class="font-medium text-slate-950 dark:text-neutral-50">{actionText}</span>
              <span class="text-gray-500 dark:text-gray-400">{scopeText}</span>
            </div>
            <button
              type="button"
              class="mt-2 rounded-full border border-gray-200 bg-white px-2.5 py-1 text-[0.7rem] font-medium text-gray-600 hover:bg-gray-100 dark:border-neutral-800 dark:bg-neutral-900 dark:text-gray-300 dark:hover:bg-neutral-800"
              aria-expanded={detailsOpen}
              onclick={() => toggleToolCallDetails(toolCall.id)}
            >
              Details
            </button>
            {#if detailsOpen}
              <div
                class="mt-2 rounded-md border border-gray-200 bg-white p-3 dark:border-neutral-800 dark:bg-neutral-900"
              >
                <dl class="grid gap-2">
                  <div>
                    <dt class="font-medium text-gray-500 dark:text-gray-400">Action</dt>
                    <dd class="break-words">{toolName}</dd>
                  </div>
                  <div>
                    <dt class="font-medium text-gray-500 dark:text-gray-400">Request</dt>
                    <dd class="break-words">{toolCall.requestSummary}</dd>
                  </div>
                  {#if toolCall.responseSummary || toolCall.error}
                    <div>
                      <dt class="font-medium text-gray-500 dark:text-gray-400">Result</dt>
                      <dd class="break-words">{toolCall.responseSummary || toolCall.error}</dd>
                    </div>
                  {/if}
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
                    {#if toolCall.resultSize.omittedFields.length > 0}
                      <div>
                        <dt class="font-medium text-gray-500 dark:text-gray-400">Omitted fields</dt>
                        <dd>{toolCall.resultSize.omittedFields.join(', ')}</dd>
                      </div>
                    {/if}
                  {/if}
                  <div>
                    <dt class="font-medium text-gray-500 dark:text-gray-400">Data</dt>
                    <dd>{dataClass}</dd>
                  </div>
                  <div>
                    <dt class="font-medium text-gray-500 dark:text-gray-400">Time</dt>
                    <dd>
                      <time datetime={toolCall.completedAt ?? toolCall.startedAt}>
                        {new Date(toolCall.completedAt ?? toolCall.startedAt).toLocaleString()}
                      </time>
                    </dd>
                  </div>
                </dl>
              </div>
            {/if}
          </article>
        {/if}
      {/each}

      {#if streamingText}
        <article
          class="mr-auto max-w-[min(80%,48rem)] rounded-2xl px-4 py-3 text-sm text-slate-950 dark:text-neutral-100"
        >
          <div class="text-xs font-medium text-gray-500 dark:text-gray-400">{$t('assistant_streaming_response')}</div>
          <div class="mt-1">{@render assistantMarkdown(parseAssistantMarkdown(streamingText))}</div>
        </article>
      {/if}

      {#if actionDock}
        <div class="mt-auto">
          {@render actionDock()}
        </div>
      {/if}
    </div>
  </div>

  <form
    class="absolute inset-x-0 bottom-0 z-10 bg-gradient-to-t from-white via-white to-white/0 px-4 pb-4 pt-8 dark:from-black dark:via-black dark:to-black/0"
    onsubmit={(event) => {
      event.preventDefault();
      void sendMessage();
    }}
  >
    <label for="assistant-message" class="sr-only">{$t('assistant_message')}</label>
    <div class="mx-auto flex w-full max-w-3xl items-end gap-3">
      <textarea
        id="assistant-message"
        aria-label={$t('assistant_message')}
        class="min-h-14 flex-1 resize-none rounded-2xl border border-gray-300 bg-white px-4 py-3 text-sm shadow-lg dark:border-neutral-700 dark:bg-neutral-900"
        bind:value={draft}
        placeholder={composerPlaceholder ?? $t('assistant_message_placeholder')}
        disabled={isResponsePending || composerDisabled}
        onkeydown={handleComposerKeydown}
      ></textarea>

      {#if terminalActionLabel && onTerminalAction}
        <Button type="button" onclick={onTerminalAction}>{terminalActionLabel}</Button>
      {:else}
        <Button type="submit" disabled={!canSend}>{submitLabel ?? $t('assistant_send')}</Button>
      {/if}
    </div>
    <div class="mx-auto w-full max-w-3xl">
      {#if composerDisabled && composerDisabledReason}
        <p class="mt-2 text-sm text-gray-500 dark:text-gray-400" role="status">{composerDisabledReason}</p>
      {/if}
    </div>
  </form>
</section>
