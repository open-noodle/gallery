import {
  AgentApprovalMode,
  AgentMessageRole,
  AgentMessageTextBlockType,
  AgentOperationApplyStatus,
  AgentOperationPlanStatus,
  AgentOperationRiskLevel,
  AgentOperationStatus,
  AgentOperationTargetKind,
  AgentOperationType,
  AgentPermissionPreset,
  AgentProviderType,
  AgentSessionStatus,
  AgentToolApprovalDecision,
  AgentToolCallStatus,
  AgentToolDataClass,
  AgentToolName,
  type AgentMessageResponseDto,
  type AgentOperationPlanResponseDto,
  type AgentOperationResponseDto,
  type AgentSessionResponseDto,
  type AgentToolCallResponseDto,
} from '@immich/sdk';
import { fireEvent, render, screen, waitFor } from '@testing-library/svelte';
import { readable } from 'svelte/store';
import { sdkMock } from '$lib/__mocks__/sdk.mock';
import { websocketMock } from '@test-data/mocks/websocket.mock';
import AgentConversationPane from './agent-conversation-pane.svelte';

vi.mock('$lib/stores/websocket');

vi.mock('svelte-i18n', () => {
  const messages: Record<string, string> = {
    assistant_approval_mode: 'Approval mode',
    assistant_approval_behavior_all_actions: 'Strict',
    assistant_approval_review_pending: 'Review pending approvals before sending a message.',
    assistant_approval_request: 'Approval request',
    assistant_approval_album_count: '{count} albums',
    assistant_approval_approve: 'Approve',
    assistant_approval_action_error: 'Unable to record approval decision',
    assistant_approval_asset_count: '{count} assets',
    assistant_approval_data_access: 'Data access',
    assistant_approval_deny: 'Deny',
    assistant_approval_recent_activity: 'Recent activity ({count})',
    assistant_approval_refresh_error: 'Approval was recorded, but refresh failed.',
    assistant_approval_tool_calls_error: 'Unable to load approval requests',
    assistant_agent_tool_data_class_metadata: 'Metadata',
    assistant_agent_tool_name_searchAssets: 'Search photos',
    assistant_agent_tool_status_completed: 'Completed',
    assistant_agent_tool_status_denied: 'Denied',
    assistant_agent_tool_status_failed: 'Failed',
    assistant_close_session: 'Close session',
    assistant_chat: 'Chat',
    assistant_details: 'Details',
    assistant_close_details: 'Close details',
    assistant_created_at: 'Created',
    assistant_dismiss_details: 'Dismiss details',
    assistant_ended_at: 'Ended',
    assistant_message: 'Message',
    assistant_message_disabled_applying: 'Operations are being applied. You can review this session after it finishes.',
    assistant_message_disabled_placeholder: 'This session is read-only.',
    assistant_message_disabled_terminal: 'This session has ended. Start a new chat to continue.',
    assistant_message_load_error: 'Unable to load messages',
    assistant_message_plan_review_placeholder: 'Describe what should change in the proposed plan.',
    assistant_message_refresh_error: 'Message was sent, but the latest session state could not be refreshed.',
    assistant_message_resume_placeholder: 'Describe what changed or what the assistant should try next.',
    assistant_model: 'Model',
    assistant_models: 'Models',
    assistant_new_chat: 'New chat',
    assistant_no: 'no',
    assistant_not_available: 'Not available',
    assistant_operation_plan_empty: 'No proposed album plan yet.',
    assistant_operation_plan_error: 'Unable to load proposed album plan',
    assistant_operation_plan_loading: 'Loading proposed album plan',
    assistant_operation_apply_applying: 'Applying operations',
    assistant_operation_apply_success: 'Applied {applied} operations. {failed} failed.',
    assistant_operation_apply_selected: 'Apply {count} selected',
    assistant_operation_asset_count: '{count} assets',
    assistant_operation_blocked_by: 'Blocked by {dependencies}',
    assistant_operation_plan_review: 'Plan review',
    assistant_operation_risk_low: 'Low risk',
    assistant_operation_selected_count: '{count} selected',
    assistant_operation_type_album_create: 'Create album',
    assistant_permission_preset: 'Permission preset',
    assistant_permission_preset_careful: 'Careful',
    assistant_protocol_version: 'Protocol version',
    assistant_provider_credential: 'Provider credential',
    assistant_runner_capabilities: 'Runner capabilities',
    assistant_resume: 'Resume',
    assistant_send: 'Send',
    assistant_session_cancel_error: 'Unable to cancel assistant session',
    assistant_session_details: 'Session details',
    assistant_session_status_applying: 'Applying',
    assistant_session_status_cancelled: 'Cancelled',
    assistant_session_status_completed: 'Completed',
    assistant_session_status_created: 'Created',
    assistant_session_status_interrupted: 'Interrupted',
    assistant_session_status_running: 'Running',
    assistant_session_status_waiting_for_plan_review: 'Waiting for plan review',
    assistant_session_status_waiting_for_tool_approval: 'Waiting for tool approval',
    assistant_start_new_chat: 'Start new chat',
    assistant_streaming: 'Streaming',
    assistant_tools: 'Tools',
    assistant_updated_at: 'Updated',
    assistant_yes: 'yes',
    status: 'Status',
    assistant_timeline_understanding: 'Understanding request…',
    assistant_timeline_thinking: 'Thinking…',
    assistant_timeline_verb_searching: 'Searching photos…',
    assistant_timeline_verb_browsing_albums: 'Browsing albums…',
    assistant_timeline_steps_one: '1 step',
    assistant_timeline_steps: '{steps} steps',
    assistant_timeline_failed_count: '{count} failed',
    assistant_timeline_cancelled: 'cancelled',
    assistant_timeline_denied: 'denied',
    assistant_timeline_request: 'Request',
    assistant_timeline_response: 'Response',
    assistant_timeline_error: 'Error',
    assistant_timeline_router_matched: 'Matched workflow {workflow} via {via}',
    assistant_timeline_router_none: 'No workflow matched (via {via})',
  };

  return {
    t: readable((key: string, options?: { values?: Record<string, string | number> }) => {
      let message = messages[key] ?? key;

      for (const [name, value] of Object.entries(options?.values ?? {})) {
        message = message.replaceAll(`{${name}}`, String(value));
      }

      return message;
    }),
  };
});

const makeSession = (overrides: Partial<AgentSessionResponseDto> = {}): AgentSessionResponseDto => {
  const id = overrides.id ?? '00000000-0000-4000-8000-000000000100';

  return {
    id,
    status: AgentSessionStatus.Running,
    providerCredentialId: '00000000-0000-4000-8000-000000000001',
    credentialSnapshot: {
      id: '00000000-0000-4000-8000-000000000001',
      providerType: AgentProviderType.Openai,
      label: 'OpenAI personal',
      baseUrl: null,
      models: ['gpt-5.1'],
      defaultModel: 'gpt-5.1',
    },
    modelSnapshot: { model: 'gpt-5.1', providerCredentialId: '00000000-0000-4000-8000-000000000001' },
    initialContextSnapshot: {},
    permissionPlanSnapshot: {
      assetScope: { locked: true, owned: true, sharedSpaces: false },
      limits: {
        expiresInMinutes: null,
        maxAssetsPerSession: 200,
        maxAssetsPerToolCall: 50,
        maxOriginalsPerToolCall: 10,
        maxPreviewsPerToolCall: 50,
      },
      providerExposure: { allowOriginalsForExternalProviders: false, metadata: true, originals: false, previews: true },
      read: { metadata: true, originals: false, previews: true },
      writeScope: {
        addAssets: true,
        addAssetsToSpaces: true,
        addMembersToSpaces: true,
        archiveAssets: true,
        createAlbum: true,
        createSpace: true,
        editAssets: true,
        favoriteAssets: true,
        removeAssets: true,
        removeAssetsFromSpaces: true,
        removeMembersFromSpaces: true,
        setCover: true,
        tagAssets: true,
        updateDetails: true,
        updateAssetMetadata: true,
        updateSpaceDetails: true,
        updateSpaceMemberRoles: true,
        trashAssets: true,
        createSharedLinks: false,
        manageStacks: false,
        managePeople: false,
        shareAlbums: false,
        lockAssets: false,
        deleteContainers: false,
      },
    },
    permissionPreset: AgentPermissionPreset.Careful,
    approvalMode: AgentApprovalMode.Strict,
    runnerCapabilitiesSnapshot: { protocolVersion: '2026-05-14', streaming: true, tools: ['echo'], models: [] },
    runnerEndpoint: 'http://agent-runner:4477',
    runnerSessionId: `stub-${id}`,
    createdAt: '2026-05-14T00:00:00.000Z',
    updatedAt: '2026-05-14T01:00:00.000Z',
    endedAt: null,
    ...overrides,
  };
};

const makeMessage = (sessionId: string, text: string, role = AgentMessageRole.User): AgentMessageResponseDto => ({
  id: `${sessionId}-message-${text}`,
  sessionId,
  role,
  providerMessageId: null,
  toolCallId: null,
  content: {
    blocks: [{ type: AgentMessageTextBlockType.Text, text }],
  },
  createdAt: '2026-05-14T00:00:00.000Z',
});

const makePlan = (sessionId: string): AgentOperationPlanResponseDto => ({
  id: '00000000-0000-4000-8000-000000000500',
  sessionId,
  revision: 1,
  status: AgentOperationPlanStatus.Proposed,
  summary: 'Organize Portugal holiday',
  operations: [
    {
      id: '00000000-0000-4000-8000-000000000501',
      planId: '00000000-0000-4000-8000-000000000500',
      type: AgentOperationType.AlbumCreate,
      summary: 'Create Portugal album',
      targetKind: AgentOperationTargetKind.NewAlbum,
      targetId: null,
      temporaryTargetId: 'album-portugal',
      assetIds: [],
      dependencyIds: [],
      riskLevel: AgentOperationRiskLevel.Low,
      enabled: true,
      status: AgentOperationStatus.Proposed,
      payload: { albumName: 'Portugal' },
      result: null,
      error: null,
      createdAt: '2026-05-15T00:00:00.000Z',
      updatedAt: '2026-05-15T00:00:00.000Z',
    } satisfies AgentOperationResponseDto,
  ],
  createdAt: '2026-05-15T00:00:00.000Z',
  updatedAt: '2026-05-15T00:00:00.000Z',
});

const makeToolCall = (sessionId: string): AgentToolCallResponseDto => ({
  id: 'tool-call-1',
  sessionId,
  toolName: AgentToolName.SearchAssets,
  status: AgentToolCallStatus.PendingApproval,
  approvalDecision: null,
  requestSummary: 'Search recent favorites',
  responseSummary: null,
  dataClass: 'metadata' as AgentToolDataClass,
  assetCount: 4,
  albumCount: 0,
  startedAt: '2026-05-16T10:00:00.000Z',
  completedAt: null,
  error: null,
});

describe(AgentConversationPane.name, () => {
  let storageValues: Map<string, string>;

  beforeEach(() => {
    vi.clearAllMocks();
    storageValues = new Map();
    vi.stubGlobal('localStorage', {
      getItem: vi.fn((key: string) => storageValues.get(key) ?? null),
      setItem: vi.fn((key: string, value: string) => storageValues.set(key, value)),
    });
    sdkMock.getAgentSession.mockReset();
    websocketMock.websocketEvents.on.mockReturnValue(vi.fn());
    sdkMock.getAgentSessionMessages.mockResolvedValue([]);
    sdkMock.getCurrentOperationPlan.mockResolvedValue(null);
    sdkMock.getToolCalls.mockResolvedValue([]);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('renders a compact header and chat without the old separate plan review block', async () => {
    const session = makeSession({ status: AgentSessionStatus.Completed });
    sdkMock.getAgentSessionMessages.mockResolvedValue([makeMessage(session.id, 'Archive winter screenshots')]);

    render(AgentConversationPane, {
      props: {
        session,
        title: 'Archive winter screenshots',
        onNewChat: vi.fn(),
        onTitleDiscovered: vi.fn(),
      },
    });

    expect(screen.getByRole('heading', { name: 'Archive winter screenshots' })).toBeInTheDocument();
    expect(screen.getByText('Completed')).toBeInTheDocument();
    expect(screen.getByText('OpenAI personal')).toBeInTheDocument();
    expect(screen.getByText('gpt-5.1')).toBeInTheDocument();
    expect(screen.getByText('Strict')).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Selected session' })).not.toBeInTheDocument();
    expect(await screen.findByText('Archive winter screenshots')).toBeInTheDocument();
    expect(screen.queryByText('No proposed album plan yet.')).not.toBeInTheDocument();
  });

  it('renders plan review through the action dock above the composer', async () => {
    const session = makeSession({ status: AgentSessionStatus.WaitingForPlanReview });
    sdkMock.getAgentSessionMessages.mockResolvedValue([makeMessage(session.id, 'Review this plan')]);
    sdkMock.getCurrentOperationPlan.mockResolvedValue(makePlan(session.id));

    render(AgentConversationPane, {
      props: {
        session,
        title: 'Plan session',
        onNewChat: vi.fn(),
        onTitleDiscovered: vi.fn(),
      },
    });

    expect(await screen.findByRole('heading', { name: 'Plan review' })).toBeInTheDocument();
    expect(screen.getByText('Organize Portugal holiday')).toBeInTheDocument();
    expect(screen.getByRole('textbox', { name: 'Message' })).toBeEnabled();
  });

  it('refreshes from plan review to running after apply and keeps follow-up composer enabled', async () => {
    const handlers: Parameters<typeof websocketMock.websocketEvents.on>[1][] = [];
    const session = makeSession({ status: AgentSessionStatus.WaitingForPlanReview });
    const runningSession = makeSession({ id: session.id, status: AgentSessionStatus.Running });
    const onSessionUpdated = vi.fn();
    websocketMock.websocketEvents.on.mockImplementation((_eventName, nextHandler) => {
      handlers.push(nextHandler);
      return vi.fn();
    });
    sdkMock.getCurrentOperationPlan.mockResolvedValue(makePlan(session.id));
    sdkMock.getAgentSession.mockResolvedValue(runningSession);

    const view = render(AgentConversationPane, {
      props: {
        session,
        title: 'Plan session',
        onNewChat: vi.fn(),
        onTitleDiscovered: vi.fn(),
        onSessionUpdated,
      },
    });

    expect(await screen.findByRole('heading', { name: 'Plan review' })).toBeInTheDocument();

    const event = {
      type: 'operation-plan-applied',
      sessionId: session.id,
      planId: '00000000-0000-4000-8000-000000000500',
      status: AgentOperationApplyStatus.Applied,
      appliedCount: 1,
      skippedCount: 0,
      failedCount: 0,
    } as const;
    for (const handler of handlers) {
      handler(event);
    }

    await waitFor(() => expect(onSessionUpdated).toHaveBeenCalledWith(runningSession));
    await view.rerender({
      session: runningSession,
      title: 'Plan session',
      onNewChat: vi.fn(),
      onTitleDiscovered: vi.fn(),
      onSessionUpdated,
    });

    const input = screen.getByRole('textbox', { name: 'Message' });
    expect(input).toBeEnabled();
    expect(input).toHaveAttribute('placeholder', 'assistant_message_placeholder');
    expect(screen.queryByRole('button', { name: 'Start new chat' })).not.toBeInTheDocument();
  });

  it('keeps the composer enabled while waiting for plan review without pending approvals', async () => {
    const session = makeSession({ status: AgentSessionStatus.WaitingForPlanReview });

    render(AgentConversationPane, {
      props: {
        session,
        title: null,
        onNewChat: vi.fn(),
        onTitleDiscovered: vi.fn(),
      },
    });

    expect(await screen.findByRole('textbox', { name: 'Message' })).toBeEnabled();
    expect(screen.getByRole('textbox', { name: 'Message' })).toHaveAttribute(
      'placeholder',
      'Describe what should change in the proposed plan.',
    );
    expect(screen.getByRole('button', { name: 'Send' })).toBeDisabled();
  });

  it('disables the composer while pending approvals are actionable', async () => {
    const session = makeSession({ status: AgentSessionStatus.WaitingForToolApproval });
    sdkMock.getToolCalls.mockResolvedValue([makeToolCall(session.id)]);

    render(AgentConversationPane, {
      props: {
        session,
        title: null,
        onNewChat: vi.fn(),
        onTitleDiscovered: vi.fn(),
      },
    });

    expect(await screen.findByText('Pi wants to search your photos.')).toBeInTheDocument();
    expect(screen.getByRole('textbox', { name: 'Message' })).toBeDisabled();
    expect(screen.getByText('Review pending approvals before sending a message.')).toBeInTheDocument();
  });

  it('renders handled tool calls inline in the chat instead of a recent activity pile', async () => {
    const session = makeSession({ status: AgentSessionStatus.Completed });
    sdkMock.getAgentSessionMessages.mockResolvedValue([
      makeMessage(session.id, 'Find my beach photos', AgentMessageRole.User),
      {
        ...makeMessage(session.id, 'I found the best candidates.', AgentMessageRole.Assistant),
        createdAt: '2026-05-14T00:01:00.000Z',
      },
    ]);
    sdkMock.getToolCalls.mockResolvedValue([
      {
        ...makeToolCall(session.id),
        id: 'tool-call-completed',
        status: AgentToolCallStatus.Completed,
        requestSummary: 'Search recent favorites',
        responseSummary: 'Found matching photos',
        startedAt: '2026-05-14T00:00:30.000Z',
        completedAt: '2026-05-14T00:00:45.000Z',
      },
    ]);

    render(AgentConversationPane, {
      props: {
        session,
        title: null,
        onNewChat: vi.fn(),
        onTitleDiscovered: vi.fn(),
      },
    });

    // Settled timeline: "1 step" summary button
    const timeline = await screen.findByTestId('agent-turn-timeline');
    expect(screen.getByRole('button', { name: /1 step/i })).toBeInTheDocument();
    expect(timeline).not.toHaveTextContent('Search recent favorites');
    expect(screen.queryByText('Recent activity (1)')).not.toBeInTheDocument();

    // Expand the timeline to see the tool call row
    await fireEvent.click(screen.getByRole('button', { name: /1 step/i }));
    await fireEvent.click(screen.getByRole('button', { name: 'searchAssets' }));
    expect(timeline).toHaveTextContent('Found matching photos');

    const transcript = screen.getByTestId('agent-session-chat-transcript');
    expect(Array.from(transcript.querySelectorAll('[data-chat-item]')).map((item) => item.textContent)).toEqual([
      expect.stringContaining('Find my beach photos'),
      expect.stringContaining('1 step'),
      expect.stringContaining('I found the best candidates.'),
    ]);
  });

  it('hides an approved pending card and shows the handled tool card in chat after refresh', async () => {
    const session = makeSession({ status: AgentSessionStatus.WaitingForToolApproval });
    const pendingToolCall = makeToolCall(session.id);
    const completedToolCall: AgentToolCallResponseDto = {
      ...pendingToolCall,
      status: AgentToolCallStatus.Completed,
      approvalDecision: AgentToolApprovalDecision.Approved,
      responseSummary: 'Found matching photos',
      completedAt: '2026-05-16T10:00:10.000Z',
    };
    sdkMock.getToolCalls.mockResolvedValueOnce([pendingToolCall]).mockResolvedValueOnce([completedToolCall]);
    sdkMock.approveToolCall.mockResolvedValue({
      ...pendingToolCall,
      status: AgentToolCallStatus.Approved,
      approvalDecision: AgentToolApprovalDecision.Approved,
    });
    sdkMock.getAgentSessionMessages.mockResolvedValue([makeMessage(session.id, 'Find recent photos')]);
    sdkMock.getAgentSession.mockResolvedValue(makeSession({ id: session.id, status: AgentSessionStatus.Running }));

    render(AgentConversationPane, {
      props: {
        session,
        title: null,
        onNewChat: vi.fn(),
        onTitleDiscovered: vi.fn(),
      },
    });

    expect(await screen.findByText('Pi wants to search your photos.')).toBeInTheDocument();
    await fireEvent.click(screen.getByRole('button', { name: 'Approve' }));

    await waitFor(() => expect(screen.queryByRole('article', { name: 'Approval request' })).not.toBeInTheDocument());
    // After approval + refresh (Running session with completed tool call): timeline shown
    const timeline = await screen.findByTestId('agent-turn-timeline');
    expect(timeline).toBeInTheDocument();
  });

  it('shows Pi working while an approved tool call resumes the assistant', async () => {
    const session = makeSession({ status: AgentSessionStatus.WaitingForToolApproval });
    const pendingToolCall = makeToolCall(session.id);
    let resolveApproval: (toolCall: AgentToolCallResponseDto) => void;
    sdkMock.getAgentSessionMessages.mockResolvedValue([makeMessage(session.id, 'Find recent photos')]);
    sdkMock.getToolCalls.mockResolvedValue([pendingToolCall]);
    sdkMock.approveToolCall.mockReturnValue(
      new Promise<AgentToolCallResponseDto>((resolve) => {
        resolveApproval = resolve;
      }),
    );

    render(AgentConversationPane, {
      props: {
        session,
        title: null,
        onNewChat: vi.fn(),
        onTitleDiscovered: vi.fn(),
      },
    });

    expect(await screen.findByText('Pi wants to search your photos.')).toBeInTheDocument();
    await fireEvent.click(screen.getByRole('button', { name: 'Approve' }));

    // After approval click while approval is in-flight: timeline shows (pending tool → in-flight row)
    expect(await screen.findByTestId('agent-turn-timeline')).toBeInTheDocument();

    resolveApproval!({
      ...pendingToolCall,
      status: AgentToolCallStatus.Approved,
      approvalDecision: AgentToolApprovalDecision.Approved,
    });
  });

  it('keeps Pi working after approval returns while the refreshed session is still running', async () => {
    const session = makeSession({ status: AgentSessionStatus.WaitingForToolApproval });
    const pendingToolCall = makeToolCall(session.id);
    const completedToolCall: AgentToolCallResponseDto = {
      ...pendingToolCall,
      status: AgentToolCallStatus.Completed,
      approvalDecision: AgentToolApprovalDecision.Approved,
      responseSummary: 'Found matching photos',
      completedAt: '2026-05-16T10:00:10.000Z',
    };
    sdkMock.getToolCalls.mockResolvedValueOnce([pendingToolCall]).mockResolvedValueOnce([completedToolCall]);
    sdkMock.approveToolCall.mockResolvedValue({
      ...pendingToolCall,
      status: AgentToolCallStatus.Approved,
      approvalDecision: AgentToolApprovalDecision.Approved,
    });
    sdkMock.getAgentSessionMessages.mockResolvedValue([makeMessage(session.id, 'Find recent photos')]);
    sdkMock.getAgentSession.mockResolvedValue(makeSession({ id: session.id, status: AgentSessionStatus.Running }));

    render(AgentConversationPane, {
      props: {
        session,
        title: null,
        onNewChat: vi.fn(),
        onTitleDiscovered: vi.fn(),
      },
    });

    expect(await screen.findByText('Pi wants to search your photos.')).toBeInTheDocument();
    await fireEvent.click(screen.getByRole('button', { name: 'Approve' }));

    await waitFor(() => expect(sdkMock.getAgentSession).toHaveBeenCalledWith({ id: session.id }));
    // Still running with a completed tool call → running timeline shown (oneLiner "Thinking…")
    expect(screen.getByTestId('agent-turn-timeline')).toBeInTheDocument();
  });

  it('shows Pi working for a running resumed session loaded after an approved tool call', async () => {
    const session = makeSession({ status: AgentSessionStatus.Running });
    sdkMock.getAgentSessionMessages.mockResolvedValue([makeMessage(session.id, 'Find recent photos')]);
    sdkMock.getToolCalls.mockResolvedValue([
      {
        ...makeToolCall(session.id),
        status: AgentToolCallStatus.Completed,
        approvalDecision: AgentToolApprovalDecision.Approved,
        responseSummary: 'Returned metadata for 8 assets',
        completedAt: '2026-05-16T10:00:10.000Z',
      },
    ]);

    render(AgentConversationPane, {
      props: {
        session,
        title: null,
        onNewChat: vi.fn(),
        onTitleDiscovered: vi.fn(),
      },
    });

    expect(await screen.findByText('Find recent photos')).toBeInTheDocument();
    // Running session with completed tool call → running timeline shown
    expect(await screen.findByTestId('agent-turn-timeline')).toBeInTheDocument();
  });

  it('resumes interrupted sessions through append and refreshes the selected session', async () => {
    const session = makeSession({ status: AgentSessionStatus.Interrupted });
    const refreshedSession = makeSession({ id: session.id, status: AgentSessionStatus.Running });
    const onSessionUpdated = vi.fn();
    sdkMock.appendAgentSessionMessage.mockResolvedValue(makeMessage(session.id, 'Try again'));
    sdkMock.getAgentSession.mockResolvedValue(refreshedSession);

    render(AgentConversationPane, {
      props: {
        session,
        title: null,
        onNewChat: vi.fn(),
        onTitleDiscovered: vi.fn(),
        onSessionUpdated,
      },
    });

    const input = await screen.findByRole('textbox', { name: 'Message' });
    expect(input).toHaveAttribute('placeholder', 'Describe what changed or what the assistant should try next.');
    await fireEvent.input(input, { target: { value: 'Try again' } });
    await fireEvent.click(screen.getByRole('button', { name: 'Resume' }));

    await waitFor(() => expect(sdkMock.appendAgentSessionMessage).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(sdkMock.getAgentSession).toHaveBeenCalledWith({ id: session.id }));
    expect(onSessionUpdated).toHaveBeenCalledWith(refreshedSession);
  });

  it('keeps append success visible when selected-session refresh fails', async () => {
    const session = makeSession({ status: AgentSessionStatus.Interrupted });
    const onSessionUpdated = vi.fn();
    sdkMock.appendAgentSessionMessage.mockResolvedValue(makeMessage(session.id, 'Still sent'));
    sdkMock.getAgentSession.mockRejectedValue(new Error('refresh failed'));

    render(AgentConversationPane, {
      props: {
        session,
        title: null,
        onNewChat: vi.fn(),
        onTitleDiscovered: vi.fn(),
        onSessionUpdated,
      },
    });

    const input = await screen.findByRole('textbox', { name: 'Message' });
    await fireEvent.input(input, { target: { value: 'Still sent' } });
    await fireEvent.click(screen.getByRole('button', { name: 'Resume' }));

    expect(await screen.findByText('Still sent')).toBeInTheDocument();
    expect(input).toHaveValue('');
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Message was sent, but the latest session state could not be refreshed.',
    );
    expect(onSessionUpdated).not.toHaveBeenCalled();
  });

  it('refreshes the selected session when a runner error arrives after approval resume', async () => {
    const session = makeSession({ status: AgentSessionStatus.Running });
    const interruptedSession = makeSession({ id: session.id, status: AgentSessionStatus.Interrupted });
    const onSessionUpdated = vi.fn();
    const handlers: Parameters<typeof websocketMock.websocketEvents.on>[1][] = [];

    websocketMock.websocketEvents.on.mockImplementation((_eventName, nextHandler) => {
      handlers.push(nextHandler);
      return vi.fn();
    });
    sdkMock.getAgentSession.mockResolvedValue(interruptedSession);

    render(AgentConversationPane, {
      props: {
        session,
        title: null,
        onNewChat: vi.fn(),
        onTitleDiscovered: vi.fn(),
        onSessionUpdated,
      },
    });

    await screen.findByRole('textbox', { name: 'Message' });

    const event = {
      type: 'runner-error',
      sessionId: session.id,
      message: 'The assistant runner stopped while processing the message.',
      createdAt: '2026-05-14T00:00:02.000Z',
    } as const;
    for (const handler of handlers) {
      handler(event);
    }

    await waitFor(() => expect(sdkMock.getAgentSession).toHaveBeenCalledWith({ id: session.id }));
    expect(onSessionUpdated).toHaveBeenCalledWith(interruptedSession);
  });

  it.each([
    [AgentSessionStatus.Completed, 'Completed'],
    [AgentSessionStatus.Cancelled, 'Cancelled'],
    [AgentSessionStatus.Failed, 'assistant_session_status_failed'],
  ])('shows terminal Start new chat composer action for %s sessions', async (status) => {
    const onNewChat = vi.fn();
    const session = makeSession({ status });

    render(AgentConversationPane, {
      props: {
        session,
        title: null,
        onNewChat,
        onTitleDiscovered: vi.fn(),
      },
    });

    expect(await screen.findByRole('textbox', { name: 'Message' })).toBeDisabled();
    expect(screen.getByText('This session has ended. Start a new chat to continue.')).toBeInTheDocument();

    await fireEvent.click(screen.getByRole('button', { name: 'Start new chat' }));

    expect(onNewChat).toHaveBeenCalledTimes(1);
    expect(sdkMock.appendAgentSessionMessage).not.toHaveBeenCalled();
  });

  it('disables applying sessions without replacing send with Start new chat', async () => {
    const session = makeSession({ status: AgentSessionStatus.Applying });

    render(AgentConversationPane, {
      props: {
        session,
        title: null,
        onNewChat: vi.fn(),
        onTitleDiscovered: vi.fn(),
      },
    });

    expect(await screen.findByRole('textbox', { name: 'Message' })).toBeDisabled();
    expect(
      screen.getByText('Operations are being applied. You can review this session after it finishes.'),
    ).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Start new chat' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Send' })).toBeDisabled();
  });

  it('cancels cancellable sessions and forwards the returned selected session', async () => {
    const session = makeSession({ status: AgentSessionStatus.Running });
    const cancelledSession = makeSession({ id: session.id, status: AgentSessionStatus.Cancelled });
    const onSessionUpdated = vi.fn();
    sdkMock.cancelAgentSession.mockResolvedValue(cancelledSession);

    render(AgentConversationPane, {
      props: {
        session,
        title: null,
        onNewChat: vi.fn(),
        onTitleDiscovered: vi.fn(),
        onSessionUpdated,
      },
    });

    await fireEvent.click(screen.getByRole('button', { name: 'Close session' }));

    await waitFor(() => expect(sdkMock.cancelAgentSession).toHaveBeenCalledWith({ id: session.id }));
    expect(onSessionUpdated).toHaveBeenCalledWith(cancelledSession);
  });

  it('shows localized cancel failure without changing the selected session', async () => {
    const session = makeSession({ status: AgentSessionStatus.Running });
    const onSessionUpdated = vi.fn();
    sdkMock.cancelAgentSession.mockRejectedValue(new Error('cancel failed'));

    render(AgentConversationPane, {
      props: {
        session,
        title: null,
        onNewChat: vi.fn(),
        onTitleDiscovered: vi.fn(),
        onSessionUpdated,
      },
    });

    await fireEvent.click(screen.getByRole('button', { name: 'Close session' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('Unable to cancel assistant session');
    expect(onSessionUpdated).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'Close session' })).toBeEnabled();
  });

  it('does not offer or invoke cancel for non-cancellable sessions', () => {
    const session = makeSession({ status: AgentSessionStatus.Completed });

    render(AgentConversationPane, {
      props: {
        session,
        title: null,
        onNewChat: vi.fn(),
        onTitleDiscovered: vi.fn(),
      },
    });

    expect(screen.queryByRole('button', { name: 'Close session' })).not.toBeInTheDocument();
    expect(sdkMock.cancelAgentSession).not.toHaveBeenCalled();
  });

  it('ignores stale cancel responses after switching sessions', async () => {
    const firstSession = makeSession({ id: '00000000-0000-4000-8000-000000000101' });
    const secondSession = makeSession({ id: '00000000-0000-4000-8000-000000000102' });
    const onSessionUpdated = vi.fn();
    let resolveCancel: (session: AgentSessionResponseDto) => void;
    sdkMock.cancelAgentSession.mockReturnValue(
      new Promise<AgentSessionResponseDto>((resolve) => {
        resolveCancel = resolve;
      }),
    );

    const view = render(AgentConversationPane, {
      props: {
        session: firstSession,
        title: null,
        onNewChat: vi.fn(),
        onTitleDiscovered: vi.fn(),
        onSessionUpdated,
      },
    });

    await fireEvent.click(screen.getByRole('button', { name: 'Close session' }));
    await view.rerender({
      session: secondSession,
      title: null,
      onNewChat: vi.fn(),
      onTitleDiscovered: vi.fn(),
      onSessionUpdated,
    });

    resolveCancel!(makeSession({ id: firstSession.id, status: AgentSessionStatus.Cancelled }));
    await waitFor(() => expect(sdkMock.cancelAgentSession).toHaveBeenCalledTimes(1));
    expect(onSessionUpdated).not.toHaveBeenCalled();
  });

  it('opens and closes session details from the compact header', async () => {
    const session = makeSession();

    render(AgentConversationPane, {
      props: {
        session,
        title: null,
        onNewChat: vi.fn(),
        onTitleDiscovered: vi.fn(),
      },
    });

    expect(screen.queryByRole('dialog', { name: 'Session details' })).not.toBeInTheDocument();

    await fireEvent.click(screen.getByRole('button', { name: 'Details' }));
    expect(screen.getByRole('dialog', { name: 'Session details' })).toBeInTheDocument();
    expect(screen.getByText('Careful')).toBeInTheDocument();

    await fireEvent.click(screen.getByRole('button', { name: 'Close details' }));
    expect(screen.queryByRole('dialog', { name: 'Session details' })).not.toBeInTheDocument();
  });

  it('keeps the details drawer open across equivalent session refreshes, closing only on a session switch', async () => {
    const session = makeSession({ status: AgentSessionStatus.Running });
    sdkMock.getAgentSessionMessages.mockResolvedValue([]);

    const view = render(AgentConversationPane, {
      props: {
        session,
        title: null,
        onNewChat: vi.fn(),
        onTitleDiscovered: vi.fn(),
      },
    });

    await fireEvent.click(screen.getByRole('button', { name: 'Details' }));
    expect(screen.getByRole('dialog', { name: 'Session details' })).toBeInTheDocument();

    // dock-style periodic refresh: same content, new object identity
    await view.rerender({ session: { ...session } });
    expect(screen.getByRole('dialog', { name: 'Session details' })).toBeInTheDocument();

    // a genuinely different session still closes the drawer
    await view.rerender({
      session: makeSession({ id: '00000000-0000-4000-8000-00000000beef', status: AgentSessionStatus.Running }),
    });
    expect(screen.queryByRole('dialog', { name: 'Session details' })).not.toBeInTheDocument();
  });

  it('forwards New chat from the terminal action and discovered titles', async () => {
    const session = makeSession({ status: AgentSessionStatus.Completed });
    const onNewChat = vi.fn();
    const onTitleDiscovered = vi.fn();
    sdkMock.getAgentSessionMessages.mockResolvedValue([makeMessage(session.id, 'Build a family highlights album')]);

    render(AgentConversationPane, {
      props: {
        session,
        title: null,
        onNewChat,
        onTitleDiscovered,
      },
    });

    await fireEvent.click(await screen.findByRole('button', { name: 'Start new chat' }));
    expect(onNewChat).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(onTitleDiscovered).toHaveBeenCalledWith(session.id, 'Build a family highlights album'));
  });

  it('remounts chat and plan state when the keyed session changes', async () => {
    const firstSession = makeSession({ id: '00000000-0000-4000-8000-000000000101' });
    const secondSession = makeSession({ id: '00000000-0000-4000-8000-000000000102' });
    sdkMock.getAgentSessionMessages.mockImplementation(({ id }) =>
      Promise.resolve([makeMessage(id, id === firstSession.id ? 'First transcript' : 'Second transcript')]),
    );

    const view = render(AgentConversationPane, {
      props: {
        session: firstSession,
        title: null,
        onNewChat: vi.fn(),
        onTitleDiscovered: vi.fn(),
      },
    });

    const input = await screen.findByRole('textbox', { name: 'Message' });
    await fireEvent.input(input, { target: { value: 'Unsaved first draft' } });
    expect(input).toHaveValue('Unsaved first draft');

    await view.rerender({
      session: secondSession,
      title: null,
      onNewChat: vi.fn(),
      onTitleDiscovered: vi.fn(),
    });

    expect(await screen.findByText('Second transcript')).toBeInTheDocument();
    expect(screen.queryByText('First transcript')).not.toBeInTheDocument();
    expect(screen.getByRole('textbox', { name: 'Message' })).toHaveValue('');
    expect(sdkMock.getCurrentOperationPlan).toHaveBeenLastCalledWith({ id: secondSession.id });
  });

  it('keeps the header visible when transcript loading fails', async () => {
    const session = makeSession();
    sdkMock.getAgentSessionMessages.mockRejectedValue(new Error('failed'));

    render(AgentConversationPane, {
      props: {
        session,
        title: 'Still visible',
        onNewChat: vi.fn(),
        onTitleDiscovered: vi.fn(),
      },
    });

    expect(screen.getByRole('heading', { name: 'Still visible' })).toBeInTheDocument();
    expect(await screen.findByRole('alert')).toHaveTextContent('Unable to load messages');
  });

  it('keeps chat and header visible when plan loading fails', async () => {
    const session = makeSession();
    sdkMock.getAgentSessionMessages.mockResolvedValue([makeMessage(session.id, 'Chat survives')]);
    sdkMock.getCurrentOperationPlan.mockRejectedValue(new Error('failed'));

    render(AgentConversationPane, {
      props: {
        session,
        title: 'Plan error session',
        onNewChat: vi.fn(),
        onTitleDiscovered: vi.fn(),
      },
    });

    expect(screen.getByRole('heading', { name: 'Plan error session' })).toBeInTheDocument();
    expect(await screen.findByText('Chat survives')).toBeInTheDocument();
    expect(await screen.findByRole('alert')).toHaveTextContent('Unable to load proposed album plan');
  });
});
