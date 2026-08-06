import {
  AgentApprovalMode,
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
  type AgentOperationPlanResponseDto,
  type AgentOperationResponseDto,
  type AgentSessionResponseDto,
  type AgentToolCallResponseDto,
} from '@immich/sdk';
import { fireEvent, render, screen, waitFor } from '@testing-library/svelte';
import { readable } from 'svelte/store';
import { sdkMock } from '$lib/__mocks__/sdk.mock';
import { websocketMock } from '@test-data/mocks/websocket.mock';
import AgentSessionActionDock from './agent-session-action-dock.svelte';

vi.mock('$lib/stores/websocket');

vi.mock('svelte-i18n', () => {
  const messages: Record<string, string> = {
    assistant_approval_action_error: 'Unable to record approval decision',
    assistant_approval_album_count: '{count} albums',
    assistant_approval_approve: 'Approve',
    assistant_approval_asset_count: '{count} assets',
    assistant_approval_data_access: 'Data access',
    assistant_approval_deny: 'Deny',
    assistant_approval_recent_activity: 'Recent activity ({count})',
    assistant_approval_refresh_error: 'Approval was recorded, but refresh failed.',
    assistant_approval_request: 'Approval request',
    assistant_approval_tool_calls_error: 'Unable to load approval requests',
    assistant_agent_tool_data_class_metadata: 'Metadata',
    assistant_agent_tool_name_readAssetPreviews: 'Read previews',
    assistant_agent_tool_name_searchAssets: 'Search photos',
    assistant_agent_tool_status_completed: 'Completed',
    assistant_agent_tool_status_denied: 'Denied',
    assistant_agent_tool_status_failed: 'Failed',
    assistant_created_at: 'Created',
    assistant_operation_apply_applying: 'Applying operations',
    assistant_operation_apply_selected: 'Apply {count} selected',
    assistant_operation_asset_count: '{count} assets',
    assistant_operation_blocked_by: 'Blocked by {dependencies}',
    assistant_operation_plan_error: 'Unable to load proposed album plan',
    assistant_operation_plan_loading: 'Loading proposed album plan',
    assistant_operation_plan_review: 'Plan review',
    assistant_operation_risk_low: 'Low risk',
    assistant_operation_selected_count: '{count} selected',
    assistant_operation_type_album_create: 'Create album',
    assistant_provider_credential: 'Provider credential',
    loading: 'Loading',
  };

  return {
    t: readable((key: string, options?: { values?: Record<string, string | number> }) =>
      (messages[key] ?? key).replace('{count}', String(options?.values?.count ?? '')),
    ),
  };
});

const operation = (overrides: Partial<AgentOperationResponseDto> = {}): AgentOperationResponseDto => ({
  id: overrides.id ?? 'operation-1',
  planId: overrides.planId ?? 'plan-1',
  type: overrides.type ?? AgentOperationType.AlbumCreate,
  summary: overrides.summary ?? 'Create Portugal album',
  targetKind: overrides.targetKind ?? AgentOperationTargetKind.NewAlbum,
  targetId: overrides.targetId ?? null,
  temporaryTargetId: overrides.temporaryTargetId ?? 'album-portugal',
  assetIds: overrides.assetIds ?? [],
  dependencyIds: overrides.dependencyIds ?? [],
  riskLevel: overrides.riskLevel ?? AgentOperationRiskLevel.Low,
  enabled: overrides.enabled ?? true,
  status: overrides.status ?? AgentOperationStatus.Proposed,
  payload: overrides.payload ?? { albumName: 'Portugal' },
  result: overrides.result ?? null,
  error: overrides.error ?? null,
  createdAt: overrides.createdAt ?? '2026-05-15T00:00:00.000Z',
  updatedAt: overrides.updatedAt ?? '2026-05-15T00:00:00.000Z',
});

const plan = (overrides: Partial<AgentOperationPlanResponseDto> = {}): AgentOperationPlanResponseDto => ({
  id: overrides.id ?? 'plan-1',
  sessionId: overrides.sessionId ?? 'session-1',
  revision: overrides.revision ?? 1,
  status: overrides.status ?? AgentOperationPlanStatus.Proposed,
  summary: overrides.summary ?? 'Organize Portugal holiday',
  operations: overrides.operations ?? [operation()],
  createdAt: overrides.createdAt ?? '2026-05-15T00:00:00.000Z',
  updatedAt: overrides.updatedAt ?? '2026-05-15T00:00:00.000Z',
});

const makeSession = (overrides: Partial<AgentSessionResponseDto> = {}): AgentSessionResponseDto => ({
  id: overrides.id ?? 'session-1',
  status: AgentSessionStatus.WaitingForToolApproval,
  providerCredentialId: 'credential-1',
  credentialSnapshot: {
    id: 'credential-1',
    providerType: AgentProviderType.Openai,
    label: 'OpenAI personal',
    baseUrl: null,
    models: ['gpt-5.1'],
    defaultModel: 'gpt-5.1',
  },
  modelSnapshot: { model: 'gpt-5.1', providerCredentialId: 'credential-1' },
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
  permissionPreset: AgentPermissionPreset.VisualOrganizer,
  approvalMode: AgentApprovalMode.Strict,
  runnerCapabilitiesSnapshot: { protocolVersion: '2026-05-14', streaming: true, tools: [], models: [] },
  runnerEndpoint: null,
  runnerSessionId: null,
  createdAt: '2026-05-15T00:00:00.000Z',
  updatedAt: '2026-05-15T00:00:00.000Z',
  endedAt: null,
  ...overrides,
});

const toolCall = (overrides: Partial<AgentToolCallResponseDto> = {}): AgentToolCallResponseDto => ({
  id: overrides.id ?? 'tool-call-1',
  sessionId: overrides.sessionId ?? 'session-1',
  toolName: overrides.toolName ?? AgentToolName.SearchAssets,
  status: overrides.status ?? AgentToolCallStatus.PendingApproval,
  approvalDecision: overrides.approvalDecision ?? null,
  requestSummary: overrides.requestSummary ?? 'Search recent favorites',
  responseSummary: overrides.responseSummary ?? null,
  dataClass: overrides.dataClass ?? ('metadata' as AgentToolDataClass),
  assetCount: overrides.assetCount ?? 4,
  albumCount: overrides.albumCount ?? 0,
  startedAt: overrides.startedAt ?? '2026-05-16T10:00:00.000Z',
  completedAt: overrides.completedAt ?? null,
  error: overrides.error ?? null,
  resultSize: overrides.resultSize,
});

describe(AgentSessionActionDock.name, () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useRealTimers();
    websocketMock.websocketEvents.on.mockReturnValue(vi.fn());
    sdkMock.getToolCalls.mockResolvedValue([]);
    sdkMock.getAgentSession.mockResolvedValue(makeSession({ status: AgentSessionStatus.Running }));
    sdkMock.getCurrentOperationPlan.mockResolvedValue(null);
  });

  it('loads pending approvals for the selected session and reports count', async () => {
    const onPendingApprovalCountChange = vi.fn();
    sdkMock.getToolCalls.mockResolvedValue([
      toolCall({ id: 'b', startedAt: '2026-05-16T11:00:00.000Z' }),
      toolCall({ id: 'a', startedAt: '2026-05-16T10:00:00.000Z', toolName: AgentToolName.ReadAssetPreviews }),
    ]);

    render(AgentSessionActionDock, { props: { session: makeSession(), onPendingApprovalCountChange } });

    expect(await screen.findByText('Pi wants to view photo previews.')).toBeInTheDocument();
    expect(screen.getByText('Pi wants to search your photos.')).toBeInTheDocument();
    expect(sdkMock.getToolCalls).toHaveBeenCalledWith({ id: 'session-1' });
    expect(onPendingApprovalCountChange).toHaveBeenLastCalledWith(2);
  });

  it('shows load errors without throwing away the dock', async () => {
    sdkMock.getToolCalls.mockRejectedValue(new Error('failed'));

    render(AgentSessionActionDock, { props: { session: makeSession() } });

    expect(await screen.findByRole('alert')).toHaveTextContent('Unable to load approval requests');
  });

  it('approves through the API and refreshes session and tool calls', async () => {
    const onSessionUpdated = vi.fn();
    sdkMock.getToolCalls.mockResolvedValueOnce([toolCall()]).mockResolvedValue([]);
    sdkMock.approveToolCall.mockResolvedValue(toolCall({ status: AgentToolCallStatus.Approved }));
    sdkMock.getAgentSession.mockResolvedValue(makeSession({ status: AgentSessionStatus.Running }));

    render(AgentSessionActionDock, { props: { session: makeSession(), onSessionUpdated } });

    await fireEvent.click(await screen.findByRole('button', { name: 'Approve' }));

    await waitFor(() =>
      expect(sdkMock.approveToolCall).toHaveBeenCalledWith({
        id: 'session-1',
        toolCallId: 'tool-call-1',
        agentToolApprovalDto: { decision: AgentToolApprovalDecision.Approved },
      }),
    );
    await waitFor(() => expect(onSessionUpdated).toHaveBeenCalledWith(expect.objectContaining({ id: 'session-1' })));
    expect(sdkMock.getToolCalls).toHaveBeenCalledTimes(2);
  });

  it('prevents duplicate approval submissions while a decision is busy', async () => {
    let resolveApproval: (toolCall: AgentToolCallResponseDto) => void;
    sdkMock.getToolCalls.mockResolvedValue([toolCall()]);
    sdkMock.approveToolCall.mockReturnValue(
      new Promise<AgentToolCallResponseDto>((resolve) => {
        resolveApproval = resolve;
      }),
    );

    render(AgentSessionActionDock, { props: { session: makeSession() } });

    const approveButton = await screen.findByRole('button', { name: 'Approve' });
    await fireEvent.click(approveButton);
    await fireEvent.click(approveButton);

    expect(sdkMock.approveToolCall).toHaveBeenCalledTimes(1);
    expect(approveButton).toBeDisabled();

    resolveApproval!(toolCall({ status: AgentToolCallStatus.Approved }));
  });

  it('keeps cards actionable when approval fails', async () => {
    sdkMock.getToolCalls.mockResolvedValue([toolCall()]);
    sdkMock.approveToolCall.mockRejectedValue(new Error('already handled'));

    render(AgentSessionActionDock, { props: { session: makeSession() } });

    await fireEvent.click(await screen.findByRole('button', { name: 'Approve' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('Unable to record approval decision');
    expect(screen.getByRole('button', { name: 'Approve' })).toBeEnabled();
  });

  it('publishes recent activity without rendering it in the dock', async () => {
    const onRecentToolCallsChange = vi.fn();
    sdkMock.getToolCalls.mockResolvedValue([
      toolCall({
        id: 'recent',
        status: AgentToolCallStatus.Completed,
        responseSummary: 'Found matching photos',
        completedAt: '2026-05-16T11:00:00.000Z',
      }),
    ]);

    render(AgentSessionActionDock, { props: { session: makeSession(), onRecentToolCallsChange } });

    await waitFor(() =>
      expect(onRecentToolCallsChange).toHaveBeenCalledWith([expect.objectContaining({ id: 'recent' })]),
    );
    expect(screen.queryByText('Recent activity (1)')).not.toBeInTheDocument();
    expect(screen.queryByText('Found matching photos')).not.toBeInTheDocument();
  });

  it('refreshes active session state while polling tool calls so missed runner errors stop stale loading UI', async () => {
    const onSessionUpdated = vi.fn();
    const interruptedSession = makeSession({ status: AgentSessionStatus.Interrupted });
    sdkMock.getToolCalls.mockResolvedValue([]);
    sdkMock.getAgentSession.mockResolvedValue(interruptedSession);

    render(AgentSessionActionDock, {
      props: { session: makeSession({ status: AgentSessionStatus.Running }), onSessionUpdated, turnRunning: true },
    });

    await waitFor(() => expect(sdkMock.getAgentSession).toHaveBeenCalledWith({ id: 'session-1' }));
    expect(onSessionUpdated).toHaveBeenCalledWith(interruptedSession);
  });

  it('renders plan review inside the dock when there are no pending approvals', async () => {
    sdkMock.getCurrentOperationPlan.mockResolvedValue(plan());

    render(AgentSessionActionDock, {
      props: { session: makeSession({ status: AgentSessionStatus.WaitingForPlanReview }) },
    });

    expect(await screen.findByRole('heading', { name: 'Plan review' })).toBeInTheDocument();
    expect(screen.getByText('Organize Portugal holiday')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Apply 1 selected' })).toBeInTheDocument();
    expect(sdkMock.getCurrentOperationPlan).toHaveBeenCalledWith({ id: 'session-1' });
  });

  it('clears the dock after a proposed operation plan is applied', async () => {
    sdkMock.getCurrentOperationPlan.mockResolvedValue(plan());
    sdkMock.applyApprovedOperations.mockResolvedValue({
      status: AgentOperationApplyStatus.Applied,
      plan: plan({
        status: AgentOperationPlanStatus.Applied,
        operations: [operation({ status: AgentOperationStatus.Applied, result: { albumId: 'album-1' } })],
      }),
      appliedOperationIds: ['operation-1'],
      skippedOperationIds: [],
      failedOperationIds: [],
      summary: 'Applied 1 operation(s), skipped 0, failed 0.',
    });

    const { container } = render(AgentSessionActionDock, {
      props: { session: makeSession({ status: AgentSessionStatus.WaitingForPlanReview }) },
    });

    await fireEvent.click(await screen.findByRole('button', { name: 'Apply 1 selected' }));

    await waitFor(() => expect(screen.queryByRole('heading', { name: 'Plan review' })).not.toBeInTheDocument());
    expect(container).not.toHaveTextContent('Applied 1 operations');
    expect(container.querySelector('button')).not.toBeInTheDocument();
  });

  it('refreshes the selected session after a same-session plan-applied event', async () => {
    const handlers: Parameters<typeof websocketMock.websocketEvents.on>[1][] = [];
    const onSessionUpdated = vi.fn();
    const runningSession = makeSession({ status: AgentSessionStatus.Running });
    websocketMock.websocketEvents.on.mockImplementation((_eventName, nextHandler) => {
      handlers.push(nextHandler);
      return vi.fn();
    });
    sdkMock.getAgentSession.mockResolvedValue(runningSession);

    render(AgentSessionActionDock, {
      props: {
        session: makeSession({ status: AgentSessionStatus.WaitingForPlanReview }),
        onSessionUpdated,
      },
    });
    await waitFor(() => expect(handlers.length).toBeGreaterThan(0));

    const event = {
      type: 'operation-plan-applied',
      sessionId: 'session-1',
      planId: 'plan-1',
      status: AgentOperationApplyStatus.Applied,
      appliedCount: 1,
      skippedCount: 0,
      failedCount: 0,
    } as const;
    for (const handler of handlers) {
      handler(event);
    }

    await waitFor(() => expect(sdkMock.getAgentSession).toHaveBeenCalledWith({ id: 'session-1' }));
    expect(onSessionUpdated).toHaveBeenCalledWith(runningSession);
  });

  it('keeps pending approvals as the active dock work before plan review', async () => {
    sdkMock.getToolCalls.mockResolvedValue([toolCall()]);
    sdkMock.getCurrentOperationPlan.mockResolvedValue(plan());

    render(AgentSessionActionDock, { props: { session: makeSession() } });

    expect(await screen.findByText('Pi wants to search your photos.')).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Plan review' })).not.toBeInTheDocument();
    expect(sdkMock.getCurrentOperationPlan).not.toHaveBeenCalled();
  });

  it('waits for the initial approval load before showing plan review', async () => {
    let resolveToolCalls: (toolCalls: AgentToolCallResponseDto[]) => void;
    sdkMock.getToolCalls.mockReturnValue(
      new Promise<AgentToolCallResponseDto[]>((resolve) => {
        resolveToolCalls = resolve;
      }),
    );
    sdkMock.getCurrentOperationPlan.mockResolvedValue(plan());

    render(AgentSessionActionDock, {
      props: { session: makeSession({ status: AgentSessionStatus.WaitingForPlanReview }) },
    });

    expect(screen.queryByRole('heading', { name: 'Plan review' })).not.toBeInTheDocument();
    expect(sdkMock.getCurrentOperationPlan).not.toHaveBeenCalled();

    resolveToolCalls!([]);

    expect(await screen.findByRole('heading', { name: 'Plan review' })).toBeInTheDocument();
  });

  it('shows plan review after pending approvals refresh away', async () => {
    sdkMock.getToolCalls.mockResolvedValueOnce([toolCall()]).mockResolvedValue([]);
    sdkMock.approveToolCall.mockResolvedValue(toolCall({ status: AgentToolCallStatus.Approved }));
    sdkMock.getCurrentOperationPlan.mockResolvedValue(plan());

    render(AgentSessionActionDock, { props: { session: makeSession() } });

    await fireEvent.click(await screen.findByRole('button', { name: 'Approve' }));

    expect(await screen.findByRole('heading', { name: 'Plan review' })).toBeInTheDocument();
  });

  it('allows plan review to render when approval loading fails', async () => {
    sdkMock.getToolCalls.mockRejectedValue(new Error('failed'));
    sdkMock.getCurrentOperationPlan.mockResolvedValue(plan());

    render(AgentSessionActionDock, {
      props: { session: makeSession({ status: AgentSessionStatus.WaitingForPlanReview }) },
    });

    expect(await screen.findByText('Unable to load approval requests')).toBeInTheDocument();
    expect(await screen.findByRole('heading', { name: 'Plan review' })).toBeInTheDocument();
  });

  it('keeps recent approval activity published when plan loading fails', async () => {
    const onRecentToolCallsChange = vi.fn();
    sdkMock.getToolCalls.mockResolvedValue([
      toolCall({
        id: 'recent',
        status: AgentToolCallStatus.Completed,
        responseSummary: 'Found matching photos',
        completedAt: '2026-05-16T11:00:00.000Z',
      }),
    ]);
    sdkMock.getCurrentOperationPlan.mockRejectedValue(new Error('failed'));

    render(AgentSessionActionDock, {
      props: { session: makeSession({ status: AgentSessionStatus.WaitingForPlanReview }), onRecentToolCallsChange },
    });

    expect(await screen.findByRole('alert')).toHaveTextContent('Unable to load proposed album plan');
    await waitFor(() =>
      expect(onRecentToolCallsChange).toHaveBeenCalledWith([expect.objectContaining({ id: 'recent' })]),
    );
    expect(screen.queryByText('Recent activity (1)')).not.toBeInTheDocument();
    expect(screen.queryByText('Found matching photos')).not.toBeInTheDocument();
  });

  it('refreshes on selected websocket events and polls active sessions', async () => {
    vi.useFakeTimers();
    const handlers: Array<Parameters<typeof websocketMock.websocketEvents.on>[1]> = [];
    websocketMock.websocketEvents.on.mockImplementation((_eventName, nextHandler) => {
      handlers.push(nextHandler);
      return vi.fn();
    });

    render(AgentSessionActionDock, {
      props: { session: makeSession({ status: AgentSessionStatus.Running }), turnRunning: true },
    });
    await waitFor(() => expect(sdkMock.getToolCalls).toHaveBeenCalledTimes(1));

    for (const handler of handlers) {
      handler({
        type: 'runner-error',
        sessionId: 'other-session',
        message: 'ignored',
        createdAt: '2026-05-16T10:00:00Z',
      });
    }
    await Promise.resolve();
    expect(sdkMock.getToolCalls).toHaveBeenCalledTimes(1);

    for (const handler of handlers) {
      handler({
        type: 'tool-approval-needed',
        sessionId: 'session-1',
        toolCallId: 'tool-call-1',
        createdAt: '2026-05-16T10:00:00Z',
      });
    }
    await waitFor(() => expect(sdkMock.getToolCalls).toHaveBeenCalledTimes(2));

    await vi.advanceTimersByTimeAsync(3000);
    expect(sdkMock.getToolCalls).toHaveBeenCalledTimes(3);
    vi.useRealTimers();
  });

  it('does not poll an idle running session without an active turn', async () => {
    vi.useFakeTimers();
    try {
      render(AgentSessionActionDock, { props: { session: makeSession({ status: AgentSessionStatus.Running }) } });
      await waitFor(() => expect(sdkMock.getToolCalls).toHaveBeenCalledTimes(1));

      await vi.advanceTimersByTimeAsync(7000);
      expect(sdkMock.getToolCalls).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it('publishes completed tool calls after a same-session websocket refresh', async () => {
    const handlers: Array<Parameters<typeof websocketMock.websocketEvents.on>[1]> = [];
    const onRecentToolCallsChange = vi.fn();
    websocketMock.websocketEvents.on.mockImplementation((_eventName, nextHandler) => {
      handlers.push(nextHandler);
      return vi.fn();
    });
    sdkMock.getToolCalls
      .mockResolvedValueOnce([toolCall({ status: AgentToolCallStatus.Executing })])
      .mockResolvedValueOnce([
        toolCall({
          status: AgentToolCallStatus.Completed,
          responseSummary: 'Found matching photos',
          completedAt: '2026-05-16T10:01:00.000Z',
        }),
      ]);

    render(AgentSessionActionDock, {
      props: {
        session: makeSession({ status: AgentSessionStatus.Running }),
        onRecentToolCallsChange,
        turnRunning: true,
      },
    });
    await waitFor(() => expect(sdkMock.getToolCalls).toHaveBeenCalledTimes(1));

    for (const handler of handlers) {
      handler({
        type: 'tool-call-completed',
        sessionId: 'session-1',
        toolCallId: 'tool-call-1',
        createdAt: '2026-05-16T10:01:00Z',
      });
    }

    await waitFor(() =>
      expect(onRecentToolCallsChange).toHaveBeenLastCalledWith([
        expect.objectContaining({ id: 'tool-call-1', status: AgentToolCallStatus.Completed }),
      ]),
    );
  });

  it('publishes completed tool calls after a polling refresh', async () => {
    vi.useFakeTimers();
    const onRecentToolCallsChange = vi.fn();
    sdkMock.getToolCalls
      .mockResolvedValueOnce([toolCall({ status: AgentToolCallStatus.Executing })])
      .mockResolvedValueOnce([
        toolCall({
          status: AgentToolCallStatus.Completed,
          responseSummary: 'Found matching photos',
          completedAt: '2026-05-16T10:01:00.000Z',
        }),
      ]);

    render(AgentSessionActionDock, {
      props: {
        session: makeSession({ status: AgentSessionStatus.Running }),
        onRecentToolCallsChange,
        turnRunning: true,
      },
    });
    await waitFor(() => expect(sdkMock.getToolCalls).toHaveBeenCalledTimes(1));

    await vi.advanceTimersByTimeAsync(3000);

    await waitFor(() =>
      expect(onRecentToolCallsChange).toHaveBeenLastCalledWith([
        expect.objectContaining({ id: 'tool-call-1', status: AgentToolCallStatus.Completed }),
      ]),
    );
    vi.useRealTimers();
  });

  it('publishes executing tool calls to the chat timeline while polling', async () => {
    const onRecentToolCallsChange = vi.fn();
    sdkMock.getToolCalls.mockResolvedValue([
      toolCall({
        id: 'executing-tool',
        status: AgentToolCallStatus.Executing,
        responseSummary: null,
        completedAt: null,
      }),
    ]);

    render(AgentSessionActionDock, {
      props: {
        session: makeSession({ status: AgentSessionStatus.Running }),
        onRecentToolCallsChange,
        turnRunning: true,
      },
    });

    await waitFor(() =>
      expect(onRecentToolCallsChange).toHaveBeenLastCalledWith([
        expect.objectContaining({ id: 'executing-tool', status: AgentToolCallStatus.Executing }),
      ]),
    );
  });

  it('does not republish recent tool calls when a polling refresh returns unchanged data', async () => {
    vi.useFakeTimers();
    const onRecentToolCallsChange = vi.fn();
    const completedToolCall = toolCall({
      status: AgentToolCallStatus.Completed,
      responseSummary: 'Found matching photos',
      completedAt: '2026-05-16T10:01:00.000Z',
    });
    sdkMock.getToolCalls.mockResolvedValue([completedToolCall]);

    render(AgentSessionActionDock, {
      props: {
        session: makeSession({ status: AgentSessionStatus.Running }),
        onRecentToolCallsChange,
        turnRunning: true,
      },
    });
    await waitFor(() =>
      expect(onRecentToolCallsChange).toHaveBeenLastCalledWith([expect.objectContaining({ id: completedToolCall.id })]),
    );
    const publishCountAfterInitialLoad = onRecentToolCallsChange.mock.calls.length;

    await vi.advanceTimersByTimeAsync(3000);
    await waitFor(() => expect(sdkMock.getToolCalls).toHaveBeenCalledTimes(2));

    expect(onRecentToolCallsChange).toHaveBeenCalledTimes(publishCountAfterInitialLoad);
    vi.useRealTimers();
  });

  it('publishes richer same-status tool-call details after a polling refresh', async () => {
    vi.useFakeTimers();
    const onRecentToolCallsChange = vi.fn();
    const initialCompletedToolCall = toolCall({
      status: AgentToolCallStatus.Completed,
      requestSummary: 'Search photos',
      responseSummary: 'Found matching photos',
      assetCount: 0,
      completedAt: '2026-05-16T10:01:00.000Z',
      resultSize: undefined,
    });
    const richerCompletedToolCall = toolCall({
      status: AgentToolCallStatus.Completed,
      requestSummary: 'Search favorites in May',
      responseSummary: 'Found matching photos',
      assetCount: 12,
      completedAt: '2026-05-16T10:01:00.000Z',
      resultSize: {
        returnedItems: 12,
        hasMore: false,
        nextPage: null,
        estimatedBytes: 8192,
        truncated: false,
        omittedFields: [],
      },
    });
    sdkMock.getToolCalls
      .mockResolvedValueOnce([initialCompletedToolCall])
      .mockResolvedValueOnce([richerCompletedToolCall]);

    render(AgentSessionActionDock, {
      props: {
        session: makeSession({ status: AgentSessionStatus.Running }),
        onRecentToolCallsChange,
        turnRunning: true,
      },
    });
    await waitFor(() =>
      expect(onRecentToolCallsChange).toHaveBeenLastCalledWith([
        expect.objectContaining({
          id: 'tool-call-1',
          requestSummary: 'Search photos',
          assetCount: 0,
          resultSize: undefined,
        }),
      ]),
    );

    await vi.advanceTimersByTimeAsync(3000);
    expect(sdkMock.getToolCalls).toHaveBeenCalledTimes(2);
    await Promise.resolve();

    expect(onRecentToolCallsChange).toHaveBeenLastCalledWith([
      expect.objectContaining({
        id: 'tool-call-1',
        requestSummary: 'Search favorites in May',
        assetCount: 12,
        resultSize: expect.objectContaining({ returnedItems: 12, estimatedBytes: 8192 }),
      }),
    ]);
    vi.useRealTimers();
  });

  it('ignores stale out-of-order quiet refresh responses', async () => {
    const handlers: Array<Parameters<typeof websocketMock.websocketEvents.on>[1]> = [];
    const onRecentToolCallsChange = vi.fn();
    let resolveStaleRefresh: (toolCalls: AgentToolCallResponseDto[]) => void;
    let resolveLatestRefresh: (toolCalls: AgentToolCallResponseDto[]) => void;
    websocketMock.websocketEvents.on.mockImplementation((_eventName, nextHandler) => {
      handlers.push(nextHandler);
      return vi.fn();
    });
    sdkMock.getToolCalls
      .mockResolvedValueOnce([])
      .mockReturnValueOnce(
        new Promise<AgentToolCallResponseDto[]>((resolve) => {
          resolveStaleRefresh = resolve;
        }),
      )
      .mockReturnValueOnce(
        new Promise<AgentToolCallResponseDto[]>((resolve) => {
          resolveLatestRefresh = resolve;
        }),
      );

    render(AgentSessionActionDock, {
      props: {
        session: makeSession({ status: AgentSessionStatus.Running }),
        onRecentToolCallsChange,
        turnRunning: true,
      },
    });
    await waitFor(() => expect(sdkMock.getToolCalls).toHaveBeenCalledTimes(1));

    for (const handler of handlers) {
      handler({
        type: 'tool-call-completed',
        sessionId: 'session-1',
        toolCallId: 'tool-call-1',
        createdAt: '2026-05-16T10:01:00Z',
      });
      handler({
        type: 'tool-call-completed',
        sessionId: 'session-1',
        toolCallId: 'tool-call-1',
        createdAt: '2026-05-16T10:02:00Z',
      });
    }
    await waitFor(() => expect(sdkMock.getToolCalls).toHaveBeenCalledTimes(3));

    resolveLatestRefresh!([
      toolCall({
        status: AgentToolCallStatus.Completed,
        responseSummary: 'Latest result',
        completedAt: '2026-05-16T10:02:00.000Z',
      }),
    ]);
    await waitFor(() =>
      expect(onRecentToolCallsChange).toHaveBeenLastCalledWith([
        expect.objectContaining({ responseSummary: 'Latest result' }),
      ]),
    );

    resolveStaleRefresh!([
      toolCall({
        status: AgentToolCallStatus.Completed,
        responseSummary: 'Stale result',
        completedAt: '2026-05-16T10:01:00.000Z',
      }),
    ]);
    await Promise.resolve();

    expect(onRecentToolCallsChange).toHaveBeenLastCalledWith([
      expect.objectContaining({ responseSummary: 'Latest result' }),
    ]);
  });

  it('ignores late refresh responses from a previous session after switching sessions', async () => {
    const onRecentToolCallsChange = vi.fn();
    let resolveFirstSession: (toolCalls: AgentToolCallResponseDto[]) => void;
    sdkMock.getToolCalls
      .mockReturnValueOnce(
        new Promise<AgentToolCallResponseDto[]>((resolve) => {
          resolveFirstSession = resolve;
        }),
      )
      .mockResolvedValueOnce([
        toolCall({
          id: 'tool-call-2',
          sessionId: 'session-2',
          status: AgentToolCallStatus.Completed,
          responseSummary: 'New session result',
          completedAt: '2026-05-16T10:02:00.000Z',
        }),
      ]);
    const view = render(AgentSessionActionDock, {
      props: { session: makeSession({ id: 'session-1' }), onRecentToolCallsChange },
    });
    await waitFor(() => expect(sdkMock.getToolCalls).toHaveBeenCalledWith({ id: 'session-1' }));

    await view.rerender({ session: makeSession({ id: 'session-2' }), onRecentToolCallsChange });

    await waitFor(() =>
      expect(onRecentToolCallsChange).toHaveBeenLastCalledWith([
        expect.objectContaining({ id: 'tool-call-2', responseSummary: 'New session result' }),
      ]),
    );

    resolveFirstSession!([
      toolCall({
        status: AgentToolCallStatus.Completed,
        responseSummary: 'Old session result',
        completedAt: '2026-05-16T10:03:00.000Z',
      }),
    ]);
    await Promise.resolve();

    expect(onRecentToolCallsChange).toHaveBeenLastCalledWith([
      expect.objectContaining({ id: 'tool-call-2', responseSummary: 'New session result' }),
    ]);
  });

  it('ignores late refresh responses after the dock is destroyed', async () => {
    const onRecentToolCallsChange = vi.fn();
    let resolveToolCalls: (toolCalls: AgentToolCallResponseDto[]) => void;
    sdkMock.getToolCalls.mockReturnValue(
      new Promise<AgentToolCallResponseDto[]>((resolve) => {
        resolveToolCalls = resolve;
      }),
    );
    const { unmount } = render(AgentSessionActionDock, {
      props: { session: makeSession(), onRecentToolCallsChange },
    });
    await waitFor(() => expect(sdkMock.getToolCalls).toHaveBeenCalledWith({ id: 'session-1' }));

    unmount();
    resolveToolCalls!([
      toolCall({
        status: AgentToolCallStatus.Completed,
        responseSummary: 'Late result',
        completedAt: '2026-05-16T10:01:00.000Z',
      }),
    ]);
    await Promise.resolve();

    expect(onRecentToolCallsChange).toHaveBeenLastCalledWith([]);
  });

  it('preserves last known tool-call state when a quiet refresh fails', async () => {
    const handlers: Array<Parameters<typeof websocketMock.websocketEvents.on>[1]> = [];
    const onRecentToolCallsChange = vi.fn();
    websocketMock.websocketEvents.on.mockImplementation((_eventName, nextHandler) => {
      handlers.push(nextHandler);
      return vi.fn();
    });
    sdkMock.getToolCalls
      .mockResolvedValueOnce([
        toolCall({
          status: AgentToolCallStatus.Completed,
          responseSummary: 'Known result',
          completedAt: '2026-05-16T10:01:00.000Z',
        }),
      ])
      .mockRejectedValueOnce(new Error('refresh failed'));

    const { container } = render(AgentSessionActionDock, {
      props: {
        session: makeSession({ status: AgentSessionStatus.Running }),
        onRecentToolCallsChange,
        turnRunning: true,
      },
    });
    await waitFor(() =>
      expect(onRecentToolCallsChange).toHaveBeenLastCalledWith([
        expect.objectContaining({ responseSummary: 'Known result' }),
      ]),
    );

    for (const handler of handlers) {
      handler({
        type: 'tool-call-completed',
        sessionId: 'session-1',
        toolCallId: 'tool-call-1',
        createdAt: '2026-05-16T10:02:00Z',
      });
    }
    await waitFor(() => expect(sdkMock.getToolCalls).toHaveBeenCalledTimes(2));

    expect(container).not.toHaveTextContent('Unable to load approval requests');
    expect(onRecentToolCallsChange).toHaveBeenLastCalledWith([
      expect.objectContaining({ responseSummary: 'Known result' }),
    ]);
  });
});
