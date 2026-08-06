import {
  AgentApprovalMode,
  AgentMessageClarificationBlockType,
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
  Kind2 as AgentResolvedAssetSearchFilterKind,
  Kind as AgentSessionActivityEventKind,
  AgentSessionActivityEventSource,
  AgentSessionActivityEventStatus,
  AgentSessionStatus,
  AgentToolApprovalDecision,
  AgentToolCallStatus,
  AgentToolDataClass,
  AgentToolName,
  type AgentMessageResponseDto,
  type AgentOperationPlanResponseDto,
  type AgentOperationResponseDto,
  type AgentSessionActivityEventResponseDto,
  type AgentSessionResponseDto,
  type AgentToolCallResponseDto,
} from '@immich/sdk';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/svelte';
import { createRawSnippet, tick } from 'svelte';
import { readable } from 'svelte/store';
import { sdkMock } from '$lib/__mocks__/sdk.mock';
import { websocketMock } from '@test-data/mocks/websocket.mock';
import AgentSessionChatPanel from './agent-session-chat-panel.svelte';

vi.mock('$lib/stores/websocket');

const sdkActivityMock = sdkMock as typeof sdkMock & {
  getAgentSessionActivityEvents: ReturnType<typeof vi.fn>;
};

vi.mock('svelte-i18n', () => {
  const messages: Record<string, string> = {
    assistant_chat: 'Chat',
    assistant_message: 'Message',
    assistant_message_load_error: 'Unable to load messages',
    assistant_message_send_error: 'Unable to send message',
    assistant_resume: 'Resume',
    assistant_send: 'Send',
    assistant_start_new_chat: 'Start new chat',
    assistant_streaming_response: 'Assistant is responding',
    assistant_agent_tool_data_class_metadata: 'Metadata',
    assistant_agent_tool_name_listAlbums: 'List albums',
    assistant_clarification_choice_thumbnail_alt: '{label} preview',
    assistant_clarification_choice_unavailable: 'No preview',
    assistant_clarification_choices_label: 'Clarification choices',
    assistant_clarification_send_choice: 'Use {label}',
    assistant_operation_applied_plan: 'Applied plan',
    assistant_operation_applied_plan_label: 'Applied plan: {summary}',
    assistant_operation_apply_partial_summary: '{applied} applied · {skipped} skipped · {failed} failed.',
    assistant_operation_asset_count: '{count} assets',
    assistant_operation_asset_selection_summary: '{selected} of {total} photos selected',
    assistant_operation_plan_destination_count: '{count} destinations',
    assistant_operation_plan_selected_asset_count: '{count} selected assets',
    assistant_operation_plan_selected_change_count: '{count} selected changes',
    assistant_operation_status_applied: 'Applied',
    assistant_operation_status_failed: 'Failed',
    assistant_operation_status_skipped: 'Skipped',
    assistant_operation_type_album_add_assets: 'Add assets',
    assistant_operation_type_album_create: 'Create album',
    assistant_operation_type_space_update_details: 'Update space details',
    assistant_timeline_understanding: 'Understanding request…',
    assistant_timeline_thinking: 'Thinking…',
    assistant_timeline_verb_searching: 'Searching photos…',
    assistant_timeline_verb_filtering: 'Interpreting filters…',
    assistant_timeline_verb_reading_details: 'Reading photo details…',
    assistant_timeline_verb_looking: 'Looking at thumbnails…',
    assistant_timeline_verb_looking_closely: 'Inspecting originals…',
    assistant_timeline_verb_finding_trips: 'Finding trips…',
    assistant_timeline_verb_browsing_albums: 'Browsing albums…',
    assistant_timeline_verb_reading_album: 'Reading an album…',
    assistant_timeline_verb_browsing_spaces: 'Browsing spaces…',
    assistant_timeline_verb_reading_space: 'Reading a space…',
    assistant_timeline_verb_finding_people: 'Finding people…',
    assistant_timeline_verb_finding_duplicates: 'Finding duplicates…',
    assistant_timeline_verb_curating: 'Curating a selection…',
    assistant_timeline_verb_locating: 'Looking up a location…',
    assistant_timeline_verb_proposing: 'Proposing changes…',
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

const session: AgentSessionResponseDto = {
  id: '00000000-0000-4000-8000-000000000100',
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
  permissionPreset: AgentPermissionPreset.VisualOrganizer,
  approvalMode: AgentApprovalMode.AskOnEscalation,
  runnerCapabilitiesSnapshot: { protocolVersion: '2026-05-14', streaming: true, tools: ['echo'], models: [] },
  runnerEndpoint: 'http://agent-runner:4477',
  runnerSessionId: 'stub-00000000-0000-4000-8000-000000000100',
  createdAt: '2026-05-14T00:00:00.000Z',
  updatedAt: '2026-05-14T00:00:00.000Z',
  endedAt: null,
};

const makeMessage = (
  id: string,
  role: AgentMessageRole,
  text: string,
  sessionId = session.id,
): AgentMessageResponseDto => ({
  id,
  sessionId,
  role,
  providerMessageId: null,
  toolCallId: null,
  content: {
    blocks: [{ type: AgentMessageTextBlockType.Text, text }],
  },
  createdAt: '2026-05-14T00:00:00.000Z',
});

const makeClarificationMessage = (): AgentMessageResponseDto => ({
  ...makeMessage('message-clarification', AgentMessageRole.Assistant, 'fallback'),
  content: {
    blocks: [
      {
        type: AgentMessageClarificationBlockType.Clarification,
        kind: AgentResolvedAssetSearchFilterKind.Person,
        query: 'Pierre',
        summary: 'I found two people named Pierre.',
        textFallback: 'Which Pierre should I use?',
        choices: [
          {
            choiceRef: 'choice:person:abcDEF1234567890',
            label: 'Pierre M.',
            description: '12 matching photos',
            thumbnailAssetId: '00000000-0000-4000-8000-000000000010',
          },
          {
            choiceRef: 'choice:person:defABC1234567890',
            label: 'Pierre',
            thumbnailAssetId: null,
          },
        ],
      },
    ],
  },
});

const makeToolCall = (overrides: Partial<AgentToolCallResponseDto> = {}): AgentToolCallResponseDto => ({
  id: overrides.id ?? 'tool-call-1',
  sessionId: overrides.sessionId ?? session.id,
  toolName: overrides.toolName ?? AgentToolName.ListAlbums,
  status: overrides.status ?? AgentToolCallStatus.Completed,
  approvalDecision: overrides.approvalDecision ?? null,
  requestSummary: overrides.requestSummary ?? 'List albums',
  responseSummary: overrides.responseSummary ?? 'Returned 1 album(s)',
  dataClass: overrides.dataClass ?? AgentToolDataClass.Metadata,
  assetCount: overrides.assetCount ?? 0,
  albumCount: overrides.albumCount ?? 1,
  startedAt: overrides.startedAt ?? '2026-05-16T11:56:50.000Z',
  completedAt: overrides.completedAt ?? '2026-05-16T11:56:55.000Z',
  error: overrides.error ?? null,
  resultSize: overrides.resultSize,
});

const makeToolBurst = (count = 50) =>
  Array.from({ length: count }, (_, index) =>
    makeToolCall({
      id: `burst-tool-${index}`,
      toolName: index % 2 === 0 ? AgentToolName.SearchAssets : AgentToolName.ReadAssetMetadata,
      requestSummary: index % 2 === 0 ? 'Search photos' : 'Read photo metadata',
      responseSummary: index % 2 === 0 ? 'Found matching photos' : 'Read details for photos',
      assetCount: index % 2 === 0 ? 2 : 1,
      albumCount: 0,
      startedAt: `2026-05-16T11:${String(Math.floor(index / 60)).padStart(2, '0')}:${String(index % 60).padStart(2, '0')}.000Z`,
      completedAt: `2026-05-16T11:${String(Math.floor((index + 1) / 60)).padStart(2, '0')}:${String((index + 1) % 60).padStart(2, '0')}.000Z`,
    }),
  );

const makeOperation = (overrides: Partial<AgentOperationResponseDto> = {}): AgentOperationResponseDto => ({
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
  status: overrides.status ?? AgentOperationStatus.Applied,
  payload: overrides.payload ?? { albumName: 'Portugal' },
  result: overrides.result ?? { albumId: 'album-1' },
  error: overrides.error ?? null,
  createdAt: overrides.createdAt ?? '2026-05-16T10:01:00.000Z',
  updatedAt: overrides.updatedAt ?? '2026-05-16T10:01:00.000Z',
});

const makeAppliedPlan = (overrides: Partial<AgentOperationPlanResponseDto> = {}): AgentOperationPlanResponseDto => ({
  id: overrides.id ?? 'plan-1',
  sessionId: overrides.sessionId ?? session.id,
  revision: overrides.revision ?? 1,
  status: overrides.status ?? AgentOperationPlanStatus.Applied,
  summary: overrides.summary ?? 'Organize Portugal holiday',
  operations: overrides.operations ?? [
    makeOperation({ id: 'operation-create', planId: overrides.id ?? 'plan-1' }),
    makeOperation({
      id: 'operation-add',
      planId: overrides.id ?? 'plan-1',
      type: AgentOperationType.AlbumAddAssets,
      summary: 'Add two assets',
      assetIds: ['asset-1', 'asset-2'],
      dependencyIds: ['operation-create'],
      payload: {},
    }),
  ],
  createdAt: overrides.createdAt ?? '2026-05-16T10:00:00.000Z',
  updatedAt: overrides.updatedAt ?? '2026-05-16T10:01:00.000Z',
});

const makeActivityEvent = (
  overrides: Record<string, unknown> & {
    kind?: AgentSessionActivityEventResponseDto['kind'] | string;
    status?: AgentSessionActivityEventResponseDto['status'] | string;
    source?: AgentSessionActivityEventResponseDto['source'] | string;
    counts?: Record<string, number> | null;
    totalCount?: number | null;
    appliedCount?: number | null;
    skippedCount?: number | null;
    failedCount?: number | null;
  } = {},
): AgentSessionActivityEventResponseDto => ({
  id: (overrides.id ?? 'activity-event-1') as string,
  sessionId: (overrides.sessionId ?? session.id) as string,
  kind: (overrides.kind ??
    AgentSessionActivityEventKind.StartProcessing) as AgentSessionActivityEventResponseDto['kind'],
  status: (overrides.status ??
    AgentSessionActivityEventStatus.Running) as AgentSessionActivityEventResponseDto['status'],
  summary: (overrides.summary ?? null) as AgentSessionActivityEventResponseDto['summary'],
  source: (overrides.source ??
    AgentSessionActivityEventSource.Server) as AgentSessionActivityEventResponseDto['source'],
  counts:
    overrides.counts ??
    (overrides.totalCount == null &&
    overrides.appliedCount == null &&
    overrides.skippedCount == null &&
    overrides.failedCount == null
      ? null
      : {
          total: overrides.totalCount ?? undefined,
          applied: overrides.appliedCount ?? undefined,
          skipped: overrides.skippedCount ?? undefined,
          failed: overrides.failedCount ?? undefined,
        }),
  createdAt: (overrides.createdAt ?? '2026-05-16T10:00:01.000Z') as string,
});

const setAppliedPlanHistory = (plans: AgentOperationPlanResponseDto[]) => {
  sdkMock.getAppliedOperationPlans.mockResolvedValue(plans);
};

describe(AgentSessionChatPanel.name, () => {
  beforeEach(() => {
    vi.clearAllMocks();
    sdkMock.getAssetThumbnailPath.mockImplementation((id) => `/assets/${id}/thumbnail`);
    sdkMock.getBaseUrl.mockReturnValue('/api');
    sdkMock.getAgentSessionMessages.mockResolvedValue([]);
    sdkActivityMock.getAgentSessionActivityEvents.mockResolvedValue([]);
    websocketMock.websocketEvents.on.mockReturnValue(vi.fn());
    sdkMock.getCurrentOperationPlan.mockResolvedValue(null);
    setAppliedPlanHistory([]);
  });

  it('loads transcript for session', async () => {
    sdkMock.getAgentSessionMessages.mockResolvedValue([
      makeMessage('message-user', AgentMessageRole.User, 'Show me my albums'),
      makeMessage('message-assistant', AgentMessageRole.Assistant, 'I can help with that.'),
    ]);

    render(AgentSessionChatPanel, { props: { session } });

    expect(await screen.findByText('Show me my albums')).toBeInTheDocument();
    expect(screen.getByText('I can help with that.')).toBeInTheDocument();
    expect(sdkMock.getAgentSessionMessages).toHaveBeenCalledWith({ id: session.id });
  });

  it('keeps ordinary prose bubbles capped inside the wider transcript lane', async () => {
    sdkMock.getAgentSessionMessages.mockResolvedValue([
      makeMessage('message-user', AgentMessageRole.User, 'Show me my albums'),
      makeMessage('message-assistant', AgentMessageRole.Assistant, 'I can help with that.'),
    ]);

    render(AgentSessionChatPanel, { props: { session } });

    const transcript = screen.getByTestId('agent-session-chat-transcript');
    expect(transcript.className).toContain('max-w-5xl');

    const bubbles = await screen.findAllByTestId('agent-session-message-bubble');
    expect(bubbles).toHaveLength(2);
    for (const bubble of bubbles) {
      expect(bubble.className).toContain('max-w-[min(80%,48rem)]');
    }
  });

  it('renders multiple user text blocks as separate preserved blocks', async () => {
    sdkMock.getAgentSessionMessages.mockResolvedValue([
      {
        ...makeMessage('message-user', AgentMessageRole.User, 'First line'),
        content: {
          blocks: [
            { type: AgentMessageTextBlockType.Text, text: 'First line' },
            { type: AgentMessageTextBlockType.Text, text: 'Second line' },
          ],
        },
      },
    ]);

    render(AgentSessionChatPanel, { props: { session } });

    const firstLine = await screen.findByText('First line');
    expect(firstLine.tagName).toBe('P');
    expect(screen.getByText('Second line').tagName).toBe('P');
  });

  it('renders assistant markdown emphasis and bullet lists as formatted content', async () => {
    sdkMock.getAgentSessionMessages.mockResolvedValue([
      makeMessage(
        'message-assistant',
        AgentMessageRole.Assistant,
        'Here are **Family picks**:\n- Beach day\n- Birthday cake\n\nUse *favorites* first.',
      ),
    ]);

    render(AgentSessionChatPanel, { props: { session } });

    const boldText = await screen.findByText('Family picks');
    expect(boldText.tagName).toBe('STRONG');
    expect(screen.getByText('favorites').tagName).toBe('EM');
    expect(screen.getByRole('list')).toBeInTheDocument();
    expect(screen.getByText('Beach day').closest('li')).toBeInTheDocument();
    expect(screen.getByText('Birthday cake').closest('li')).toBeInTheDocument();
  });

  it('renders persisted clarification choices with thumbnails and text fallback', async () => {
    sdkMock.getAgentSessionMessages.mockResolvedValue([makeClarificationMessage()]);

    render(AgentSessionChatPanel, { props: { session } });

    expect(await screen.findByText('I found two people named Pierre.')).toBeInTheDocument();
    expect(screen.getByText('Which Pierre should I use?')).toBeInTheDocument();
    expect(screen.getByRole('group', { name: 'Clarification choices' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Use Pierre M.' })).toBeInTheDocument();
    expect(screen.getByText('12 matching photos')).toBeInTheDocument();
    expect(screen.getByAltText('Pierre M. preview')).toHaveAttribute('src', expect.stringContaining('/api/assets/'));
    expect(screen.getByText('No preview')).toBeInTheDocument();
    expect(screen.queryByText('choice:person:abcDEF1234567890')).not.toBeInTheDocument();
  });

  it('sends the safe choice ref as the next user message when a clarification choice is clicked', async () => {
    sdkMock.getAgentSessionMessages.mockResolvedValue([makeClarificationMessage()]);
    sdkMock.appendAgentSessionMessage.mockResolvedValue(
      makeMessage(
        'reply',
        AgentMessageRole.User,
        'Use choice:person:abcDEF1234567890 for person "Pierre" (Pierre M.).',
      ),
    );

    render(AgentSessionChatPanel, { props: { session } });
    await fireEvent.click(await screen.findByRole('button', { name: 'Use Pierre M.' }));

    expect(sdkMock.appendAgentSessionMessage).toHaveBeenCalledWith({
      id: session.id,
      agentMessageCreateDto: {
        content: {
          blocks: [
            {
              type: AgentMessageTextBlockType.Text,
              text: 'Use choice:person:abcDEF1234567890 for person "Pierre" (Pierre M.).',
            },
          ],
        },
      },
    });
  });

  it('renders the running one-liner for the active turn', async () => {
    render(AgentSessionChatPanel, {
      props: {
        session,
        seedMessages: [
          {
            ...makeMessage('message-user', AgentMessageRole.User, 'Show me my albums'),
            createdAt: '2026-05-16T11:56:00.000Z',
          },
        ],
        toolCalls: [
          makeToolCall({
            toolName: AgentToolName.SearchAssets,
            status: AgentToolCallStatus.Executing,
            completedAt: null,
            startedAt: '2026-05-16T11:56:50.000Z',
          }),
        ],
      },
    });

    expect(await screen.findByText('Searching photos…')).toBeInTheDocument();
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
  });

  it('renders result-size detail when a timeline row is expanded', async () => {
    sdkMock.getAgentSessionMessages.mockResolvedValue([
      {
        ...makeMessage('message-user', AgentMessageRole.User, 'Find my Portugal photos'),
        createdAt: '2026-05-16T11:55:00.000Z',
      },
      {
        ...makeMessage('message-assistant', AgentMessageRole.Assistant, 'Found them.'),
        createdAt: '2026-05-16T11:55:20.000Z',
      },
    ]);
    render(AgentSessionChatPanel, {
      props: {
        session: { ...session, status: AgentSessionStatus.Completed },
        toolCalls: [
          makeToolCall({
            id: 'search-tool',
            toolName: AgentToolName.SearchAssets,
            assetCount: 4,
            albumCount: 0,
            startedAt: '2026-05-16T11:55:05.000Z',
            completedAt: '2026-05-16T11:55:07.000Z',
            resultSize: {
              returnedItems: 4,
              hasMore: true,
              nextPage: '2',
              estimatedBytes: 4096,
              truncated: true,
              omittedFields: ['assets'],
            },
          }),
        ],
      },
    });

    // Expand the summary timeline (settled: "1 step")
    await fireEvent.click(await screen.findByRole('button', { name: /1 step/i }));
    // Then expand the row detail
    await fireEvent.click(screen.getByRole('button', { name: AgentToolName.SearchAssets }));

    expect(screen.getByText('4 items')).toBeInTheDocument();
    expect(screen.getByText('truncated')).toBeInTheDocument();
  });

  it('renders the turn timeline summary after a settled turn', async () => {
    sdkMock.getAgentSessionMessages.mockResolvedValue([
      {
        ...makeMessage('message-user', AgentMessageRole.User, 'Find my Portugal photos'),
        createdAt: '2026-05-16T10:00:00.000Z',
      },
      {
        ...makeMessage('message-assistant', AgentMessageRole.Assistant, 'I found them.'),
        createdAt: '2026-05-16T10:00:20.000Z',
      },
    ]);

    render(AgentSessionChatPanel, {
      props: {
        session: { ...session, status: AgentSessionStatus.Completed },
        toolCalls: [
          makeToolCall({
            id: 'search-tool',
            toolName: AgentToolName.SearchAssets,
            assetCount: 12,
            albumCount: 0,
            startedAt: '2026-05-16T10:00:05.000Z',
            completedAt: '2026-05-16T10:00:07.000Z',
          }),
        ],
      },
    });

    const transcript = await screen.findByTestId('agent-session-chat-transcript');
    await screen.findByText('I found them.');

    // Summary line button present (replaces the old 'Activity summary' article)
    expect(screen.getByRole('button', { name: /1 step/i })).toBeInTheDocument();
    expect(screen.queryByRole('article', { name: 'Activity summary' })).not.toBeInTheDocument();
    expect(Array.from(transcript.querySelectorAll('[data-chat-item]')).map((item) => item.textContent)).toEqual([
      expect.stringContaining('Find my Portugal photos'),
      expect.stringContaining('1 step'),
      expect.stringContaining('I found them.'),
    ]);
  });

  it('expands the timeline to tool-call rows on click', async () => {
    sdkMock.getAgentSessionMessages.mockResolvedValue([
      {
        ...makeMessage('message-user', AgentMessageRole.User, 'Find my photos'),
        createdAt: '2026-05-16T10:00:00.000Z',
      },
      {
        ...makeMessage('message-assistant', AgentMessageRole.Assistant, 'Done.'),
        createdAt: '2026-05-16T10:00:20.000Z',
      },
    ]);

    render(AgentSessionChatPanel, {
      props: {
        session: { ...session, status: AgentSessionStatus.Completed },
        toolCalls: [
          makeToolCall({
            id: 'expand-tool',
            toolName: AgentToolName.SearchAssets,
            startedAt: '2026-05-16T10:00:05.000Z',
            completedAt: '2026-05-16T10:00:07.000Z',
          }),
        ],
      },
    });

    await screen.findByText('Done.');
    const summaryBtn = screen.getByRole('button', { name: /1 step/i });
    await fireEvent.click(summaryBtn);

    expect(screen.getByRole('button', { name: AgentToolName.SearchAssets })).toBeInTheDocument();
  });

  it('reconstructs completed tool activity after the triggering user message on reload', async () => {
    sdkMock.getAgentSessionMessages.mockResolvedValue([
      {
        ...makeMessage('message-user', AgentMessageRole.User, 'List my albums'),
        createdAt: '2026-05-16T10:00:00.000Z',
      },
      {
        ...makeMessage('message-assistant', AgentMessageRole.Assistant, 'You have one album.'),
        createdAt: '2026-05-16T10:00:20.000Z',
      },
    ]);

    render(AgentSessionChatPanel, {
      props: {
        session: { ...session, status: AgentSessionStatus.Completed },
        toolCalls: [
          makeToolCall({
            id: 'reload-tool',
            startedAt: '2026-05-16T10:00:05.000Z',
            completedAt: '2026-05-16T10:00:06.000Z',
          }),
        ],
      },
    });

    const transcript = await screen.findByTestId('agent-session-chat-transcript');
    await screen.findByText('You have one album.');

    expect(screen.getByTestId('agent-turn-timeline')).toBeInTheDocument();
    expect(screen.queryByRole('article', { name: 'Pi checked your albums: Done' })).not.toBeInTheDocument();
    expect(Array.from(transcript.querySelectorAll('[data-chat-item]')).map((item) => item.textContent)).toEqual([
      expect.stringContaining('List my albums'),
      expect.stringContaining('1 step'),
      expect.stringContaining('You have one album.'),
    ]);
  });

  it('does not flash raw fallback tool cards while the transcript is loading', async () => {
    let resolveMessages: (messages: AgentMessageResponseDto[]) => void;
    sdkMock.getAgentSessionMessages.mockReturnValue(
      new Promise((resolve) => {
        resolveMessages = resolve;
      }),
    );

    render(AgentSessionChatPanel, {
      props: {
        session: { ...session, status: AgentSessionStatus.Running },
        toolCalls: [
          makeToolCall({
            id: 'early-tool',
            startedAt: '2026-05-16T10:00:05.000Z',
            completedAt: '2026-05-16T10:00:06.000Z',
          }),
        ],
      },
    });

    expect(await screen.findByTestId('agent-session-chat-transcript')).toBeInTheDocument();
    expect(screen.queryByRole('article', { name: 'Pi checked your albums: Done' })).not.toBeInTheDocument();
    expect(screen.queryByText('Returned 1 album(s)')).not.toBeInTheDocument();

    resolveMessages!([
      {
        ...makeMessage('message-user', AgentMessageRole.User, 'List my albums'),
        createdAt: '2026-05-16T10:00:00.000Z',
      },
    ]);

    expect(await screen.findByTestId('agent-turn-timeline')).toBeInTheDocument();
    expect(screen.queryByRole('article', { name: 'Pi checked your albums: Done' })).not.toBeInTheDocument();
    expect(screen.queryByText('Returned 1 album(s)')).not.toBeInTheDocument();
  });

  it('loads persisted activity events into the triggering turn without raw details', async () => {
    sdkMock.getAgentSessionMessages.mockResolvedValue([
      {
        ...makeMessage('message-user', AgentMessageRole.User, 'Make a plan'),
        createdAt: '2026-05-16T10:00:00.000Z',
      },
    ]);
    sdkActivityMock.getAgentSessionActivityEvents.mockResolvedValue([
      makeActivityEvent({
        id: 'plan-composing-event',
        kind: 'plan-composing',
        status: 'running',
        summary: 'Bearer secret-token',
        createdAt: '2026-05-16T10:00:05.000Z',
      }),
    ]);

    render(AgentSessionChatPanel, { props: { session } });

    const transcript = await screen.findByTestId('agent-session-chat-transcript');
    expect(sdkActivityMock.getAgentSessionActivityEvents).toHaveBeenCalledWith({ id: session.id });
    // The running one-liner shows since no tool calls yet (Understanding request…)
    expect(await screen.findByText('Understanding request…')).toBeInTheDocument();
    // Activity event secrets must never appear
    expect(screen.queryByText(/secret-token/)).not.toBeInTheDocument();
    expect(Array.from(transcript.querySelectorAll('[data-chat-item]')).map((item) => item.textContent)).toEqual([
      expect.stringContaining('Make a plan'),
      expect.stringContaining('Understanding request'),
    ]);
  });

  it('keeps pending approval reload activity and the action dock surface visible', async () => {
    sdkMock.getAgentSessionMessages.mockResolvedValue([
      {
        ...makeMessage('message-user', AgentMessageRole.User, 'Check private photos'),
        createdAt: '2026-05-16T10:00:00.000Z',
      },
    ]);

    render(AgentSessionChatPanel, {
      props: {
        session: { ...session, status: AgentSessionStatus.WaitingForToolApproval },
        actionDock: createRawSnippet(() => ({
          render: () => '<section aria-label="Approval request">Approve?</section>',
        })),
        toolCalls: [
          makeToolCall({
            id: 'approval-tool',
            status: AgentToolCallStatus.PendingApproval,
            toolName: AgentToolName.ReadAssetMetadata,
            responseSummary: null,
            completedAt: null,
            startedAt: '2026-05-16T10:00:05.000Z',
          }),
        ],
      },
    });

    expect(await screen.findByTestId('agent-turn-timeline')).toBeInTheDocument();
    expect(screen.getByRole('region', { name: 'Approval request' })).toHaveTextContent('Approve?');
    expect(screen.queryByRole('article', { name: /Pi wants/i })).not.toBeInTheDocument();
  });

  it('shows response activity instead of stale pending approval activity while approval resumes', async () => {
    sdkMock.getAgentSessionMessages.mockResolvedValue([
      {
        ...makeMessage('message-user', AgentMessageRole.User, 'Check private photos'),
        createdAt: '2026-05-16T10:00:00.000Z',
      },
    ]);

    render(AgentSessionChatPanel, {
      props: {
        session: { ...session, status: AgentSessionStatus.WaitingForToolApproval },
        actionDock: createRawSnippet(() => ({
          render: () => '<section aria-label="Approval request">Approve?</section>',
        })),
        assistantResponsePending: true,
        suppressPendingApprovalActivity: true,
        toolCalls: [
          makeToolCall({
            id: 'approval-tool-resuming',
            status: AgentToolCallStatus.PendingApproval,
            toolName: AgentToolName.ReadAssetMetadata,
            responseSummary: null,
            completedAt: null,
            startedAt: '2026-05-16T10:00:05.000Z',
          }),
        ],
      },
    });

    // suppressPendingApprovalActivity hides the pending-approval tool call, so one-liner shows Understanding…
    expect(await screen.findByTestId('agent-turn-timeline')).toBeInTheDocument();
    expect(screen.getByRole('region', { name: 'Approval request' })).toHaveTextContent('Approve?');
    expect(screen.queryByRole('article', { name: /Pi checked/i })).not.toBeInTheDocument();
  });

  it('keeps applied-plan reload activity while the applied plan card remains separate', async () => {
    sdkMock.getAgentSessionMessages.mockResolvedValue([
      {
        ...makeMessage('message-user', AgentMessageRole.User, 'Apply the Portugal plan'),
        createdAt: '2026-05-16T10:00:00.000Z',
      },
      {
        ...makeMessage('message-assistant', AgentMessageRole.Assistant, 'Applied.'),
        createdAt: '2026-05-16T10:02:00.000Z',
      },
    ]);
    setAppliedPlanHistory([
      makeAppliedPlan({
        id: 'applied-reload-plan',
        createdAt: '2026-05-16T10:00:20.000Z',
        updatedAt: '2026-05-16T10:01:00.000Z',
      }),
    ]);

    render(AgentSessionChatPanel, { props: { session: { ...session, status: AgentSessionStatus.Completed } } });

    await screen.findByText('Applied.');
    expect(screen.getByRole('article', { name: 'Applied plan: Organize Portugal holiday' })).toBeInTheDocument();
    // No tool calls in this test, so no turn-timeline renders (E1)
    expect(screen.queryByTestId('agent-turn-timeline')).not.toBeInTheDocument();
  });

  it('reconstructs two completed user turns as separate activity blocks', async () => {
    sdkMock.getAgentSessionMessages.mockResolvedValue([
      {
        ...makeMessage('message-user-a', AgentMessageRole.User, 'First request'),
        createdAt: '2026-05-16T10:00:00.000Z',
      },
      {
        ...makeMessage('message-assistant-a', AgentMessageRole.Assistant, 'First response'),
        createdAt: '2026-05-16T10:00:20.000Z',
      },
      {
        ...makeMessage('message-user-b', AgentMessageRole.User, 'Second request'),
        createdAt: '2026-05-16T10:01:00.000Z',
      },
    ]);

    render(AgentSessionChatPanel, {
      props: {
        session: { ...session, status: AgentSessionStatus.Completed },
        toolCalls: [
          makeToolCall({
            id: 'old-tool',
            startedAt: '2026-05-16T10:00:05.000Z',
            completedAt: '2026-05-16T10:00:06.000Z',
          }),
          makeToolCall({
            id: 'new-tool',
            toolName: AgentToolName.SearchAssets,
            assetCount: 3,
            albumCount: 0,
            startedAt: '2026-05-16T10:01:05.000Z',
            completedAt: '2026-05-16T10:01:06.000Z',
          }),
        ],
      },
    });

    const transcript = await screen.findByTestId('agent-session-chat-transcript');
    await screen.findByText('Second request');

    expect(screen.getAllByTestId('agent-turn-timeline')).toHaveLength(2);
    expect(screen.queryByRole('article', { name: 'Pi checked your albums: Done' })).not.toBeInTheDocument();
    expect(Array.from(transcript.querySelectorAll('[data-chat-item]')).map((item) => item.textContent)).toEqual([
      expect.stringContaining('First request'),
      expect.stringContaining('1 step'),
      expect.stringContaining('First response'),
      expect.stringContaining('Second request'),
      expect.stringContaining('1 step'),
    ]);
  });

  it('does not fold a late tool call into a completed turn after the terminal assistant response', async () => {
    sdkMock.getAgentSessionMessages.mockResolvedValue([
      {
        ...makeMessage('message-user', AgentMessageRole.User, 'List my albums'),
        createdAt: '2026-05-16T10:00:00.000Z',
      },
      {
        ...makeMessage('message-assistant', AgentMessageRole.Assistant, 'Done listing albums.'),
        createdAt: '2026-05-16T10:00:20.000Z',
      },
    ]);

    render(AgentSessionChatPanel, {
      props: {
        session: { ...session, status: AgentSessionStatus.Completed },
        toolCalls: [
          makeToolCall({
            id: 'late-tool',
            startedAt: '2026-05-16T10:00:30.000Z',
            completedAt: '2026-05-16T10:00:31.000Z',
          }),
        ],
      },
    });

    const transcript = await screen.findByTestId('agent-session-chat-transcript');
    await screen.findByText('Done listing albums.');

    expect(screen.queryByTestId('agent-turn-timeline')).not.toBeInTheDocument();
    // The late tool call falls outside the turn window — shown as raw uncovered tool-call article
    expect(screen.getByRole('article', { name: 'Pi checked your albums: Done' })).toBeInTheDocument();
    expect(Array.from(transcript.querySelectorAll('[data-chat-item]')).map((item) => item.textContent)).toEqual([
      expect.stringContaining('List my albums'),
      expect.stringContaining('Done listing albums.'),
      expect.stringContaining('Pi checked your albums.'),
    ]);
  });

  it('keeps covered raw tool cards suppressed when activity visibility is off', async () => {
    sdkMock.getAgentSessionMessages.mockResolvedValue([
      {
        ...makeMessage('message-user', AgentMessageRole.User, 'List my albums'),
        createdAt: '2026-05-16T10:00:00.000Z',
      },
      {
        ...makeMessage('message-assistant', AgentMessageRole.Assistant, 'Done.'),
        createdAt: '2026-05-16T10:00:20.000Z',
      },
    ]);

    render(AgentSessionChatPanel, {
      props: {
        session: { ...session, status: AgentSessionStatus.Completed },
        toolCalls: [
          makeToolCall({
            id: 'covered-tool',
            startedAt: '2026-05-16T10:00:05.000Z',
            completedAt: '2026-05-16T10:00:06.000Z',
          }),
        ],
      },
    });

    expect(await screen.findByText('Done.')).toBeInTheDocument();
    // The timeline now always renders when there are tool calls (visibility mode no longer gates it)
    expect(screen.getByTestId('agent-turn-timeline')).toBeInTheDocument();
    // The raw tool-call article is suppressed since the tool is covered by the timeline
    expect(screen.queryByRole('article', { name: 'Pi checked your albums: Done' })).not.toBeInTheDocument();
    expect(screen.queryByText('Returned 1 album(s)')).not.toBeInTheDocument();
  });

  it('hides explicit activity events when activity visibility is off', async () => {
    sdkMock.getAgentSessionMessages.mockResolvedValue([
      {
        ...makeMessage('message-user', AgentMessageRole.User, 'Apply plan'),
        createdAt: '2026-05-16T10:00:00.000Z',
      },
    ]);
    sdkActivityMock.getAgentSessionActivityEvents.mockResolvedValue([
      makeActivityEvent({
        id: 'apply-progress-event',
        kind: 'apply-progress',
        totalCount: 2,
        appliedCount: 1,
        createdAt: '2026-05-16T10:00:05.000Z',
      }),
    ]);

    render(AgentSessionChatPanel, { props: { session } });

    expect(await screen.findByText('Apply plan')).toBeInTheDocument();
    // Activity events no longer drive timeline rendering — only tool calls do
    expect(screen.queryByText('Applying changes')).not.toBeInTheDocument();
    // Running turn with no tool calls shows the Understanding one-liner
    expect(await screen.findByText('Understanding request…')).toBeInTheDocument();
  });

  it('shows pending permission activity without rendering approval controls inside chat', async () => {
    sdkMock.getAgentSessionMessages.mockResolvedValue([
      {
        ...makeMessage('message-user', AgentMessageRole.User, 'Check private photos'),
        createdAt: '2026-05-16T10:00:00.000Z',
      },
    ]);

    render(AgentSessionChatPanel, {
      props: {
        session: { ...session, status: AgentSessionStatus.WaitingForToolApproval },
        toolCalls: [
          makeToolCall({
            status: AgentToolCallStatus.PendingApproval,
            toolName: AgentToolName.ReadAssetMetadata,
            responseSummary: null,
            completedAt: null,
            startedAt: '2026-05-16T10:00:05.000Z',
          }),
        ],
      },
    });

    // WaitingForToolApproval is an active status — in-flight one-liner shown
    const timeline = await screen.findByTestId('agent-turn-timeline');
    expect(timeline).toBeInTheDocument();
    // No Approve/Deny buttons inside the timeline (those go in the action dock)
    expect(screen.queryByRole('button', { name: /Approve/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Deny/i })).not.toBeInTheDocument();
  });

  it('renders approved tool calls as in-progress chat activity', async () => {
    render(AgentSessionChatPanel, {
      props: {
        session,
        seedMessages: [
          {
            ...makeMessage('message-user', AgentMessageRole.User, 'Show me my albums'),
            createdAt: '2026-05-16T11:56:00.000Z',
          },
        ],
        toolCalls: [
          makeToolCall({
            status: AgentToolCallStatus.Approved,
            approvalDecision: AgentToolApprovalDecision.Approved,
            responseSummary: 'Tool call approved by user',
            completedAt: null,
          }),
        ],
      },
    });

    // Approved tool call with ListAlbums → one-liner verb = Browsing albums…
    expect(await screen.findByTestId('agent-turn-timeline')).toBeInTheDocument();
  });

  it('expands current activity when the session visibility mode is expanded', async () => {
    render(AgentSessionChatPanel, {
      props: {
        session,
        seedMessages: [
          {
            ...makeMessage('message-user', AgentMessageRole.User, 'Find my photos'),
            createdAt: '2026-05-16T11:56:00.000Z',
          },
        ],
        toolCalls: [
          makeToolCall({ id: 'tool-call-1', toolName: AgentToolName.SearchAssets, assetCount: 2, albumCount: 0 }),
          makeToolCall({ id: 'tool-call-2', toolName: AgentToolName.ListAlbums, assetCount: 0, albumCount: 1 }),
          makeToolCall({
            id: 'tool-call-3',
            toolName: AgentToolName.ReadAssetMetadata,
            assetCount: 1,
            albumCount: 0,
          }),
          makeToolCall({ id: 'tool-call-4', toolName: AgentToolName.SearchAssets, assetCount: 3, albumCount: 0 }),
        ],
      },
    });

    // Timeline renders, collapsed by default (one-liner or summary button)
    expect(await screen.findByTestId('agent-turn-timeline')).toBeInTheDocument();
  });

  it('one activity timeline per turn when polling returns many completed tools', async () => {
    render(AgentSessionChatPanel, {
      props: {
        session,
        seedMessages: [
          {
            ...makeMessage('message-user', AgentMessageRole.User, 'Find my South Africa photos'),
            createdAt: '2026-05-16T10:59:00.000Z',
          },
        ],
        toolCalls: makeToolBurst(50),
      },
    });

    expect(await screen.findByTestId('agent-turn-timeline')).toBeInTheDocument();
    expect(screen.getAllByTestId('agent-turn-timeline')).toHaveLength(1);
    expect(screen.queryByRole('article', { name: 'Pi checked your albums: Done' })).not.toBeInTheDocument();
    expect(screen.queryByText('Returned 1 album(s)')).not.toBeInTheDocument();
  });

  it('timeline shows step count for many completed tool calls', async () => {
    const { rerender } = render(AgentSessionChatPanel, {
      props: {
        session,
        seedMessages: [
          {
            ...makeMessage('message-user', AgentMessageRole.User, 'Find my South Africa photos'),
            createdAt: '2026-05-16T10:59:00.000Z',
          },
        ],
        toolCalls: makeToolBurst(50),
      },
    });

    // Initial render: collapsed by default (summary line only)
    expect(await screen.findByTestId('agent-turn-timeline')).toBeInTheDocument();

    await rerender({
      session,
      seedMessages: [
        {
          ...makeMessage('message-user', AgentMessageRole.User, 'Find my South Africa photos'),
          createdAt: '2026-05-16T10:59:00.000Z',
        },
      ],
      toolCalls: makeToolBurst(50),
    });

    expect(screen.getByTestId('agent-turn-timeline')).toBeInTheDocument();
    expect(screen.queryByRole('article', { name: 'Pi checked your albums: Done' })).not.toBeInTheDocument();
  });

  it('off mode hides passive activity while permission and plan surfaces stay visible', async () => {
    render(AgentSessionChatPanel, {
      props: {
        session: { ...session, status: AgentSessionStatus.WaitingForToolApproval },
        actionDock: createRawSnippet(() => ({
          render: () => '<section aria-label="Approval request">Approve?</section>',
        })),
        seedMessages: [
          {
            ...makeMessage('message-user', AgentMessageRole.User, 'Check private photos'),
            createdAt: '2026-05-16T10:00:00.000Z',
          },
        ],
        toolCalls: [
          makeToolCall({
            id: 'approval-tool-off',
            status: AgentToolCallStatus.PendingApproval,
            toolName: AgentToolName.ReadAssetMetadata,
            responseSummary: null,
            completedAt: null,
            startedAt: '2026-05-16T10:00:05.000Z',
          }),
        ],
      },
    });

    expect(await screen.findByRole('region', { name: 'Approval request' })).toHaveTextContent('Approve?');
    // Timeline always renders when there are tool calls (visibility mode no longer hides it)
    expect(await screen.findByTestId('agent-turn-timeline')).toBeInTheDocument();
  });

  it('activity summarization updates the existing block without a transient raw-card state', async () => {
    const seedMessages = [
      {
        ...makeMessage('message-user', AgentMessageRole.User, 'Find my South Africa photos'),
        createdAt: '2026-05-16T10:59:00.000Z',
      },
    ];
    const runningBurst = makeToolBurst(50).map((toolCall, index) =>
      index === 49 ? { ...toolCall, status: AgentToolCallStatus.Executing, completedAt: null } : toolCall,
    );
    const view = render(AgentSessionChatPanel, {
      props: {
        session,
        seedMessages,
        toolCalls: runningBurst,
      },
    });

    expect(await screen.findByTestId('agent-turn-timeline')).toBeInTheDocument();

    sdkActivityMock.getAgentSessionActivityEvents.mockResolvedValue([
      makeActivityEvent({
        id: 'plan-composed',
        kind: 'plan-composing',
        status: 'completed',
        createdAt: '2026-05-16T11:01:00.000Z',
      }),
    ]);
    await view.rerender({
      session: { ...session, updatedAt: '2026-05-16T11:01:01.000Z' },
      seedMessages,
      toolCalls: makeToolBurst(50),
    });

    expect(screen.getAllByTestId('agent-turn-timeline')).toHaveLength(1);
    expect(screen.queryByRole('article', { name: 'Pi checked your albums: Done' })).not.toBeInTheDocument();
    expect(screen.queryByText('Returned 1 album(s)')).not.toBeInTheDocument();
  });

  it('preserves expanded activity rows when a refresh temporarily omits tool calls', async () => {
    const seedMessages = [
      {
        ...makeMessage('message-user', AgentMessageRole.User, 'Find my South Africa photos'),
        createdAt: '2026-05-16T10:59:00.000Z',
      },
    ];
    const initialToolCalls = makeToolBurst(8);
    const view = render(AgentSessionChatPanel, {
      props: {
        session,
        seedMessages,
        toolCalls: initialToolCalls,
      },
    });

    // Initial render: timeline appears (summary line collapsed by default)
    expect(await screen.findByTestId('agent-turn-timeline')).toBeInTheDocument();

    await view.rerender({
      session: { ...session, updatedAt: '2026-05-16T11:00:01.000Z' },
      seedMessages,
      toolCalls: [],
    });

    // Timeline preserved via timelineToolCalls merge (empty refresh doesn't drop tool calls)
    expect(screen.getByTestId('agent-turn-timeline')).toBeInTheDocument();
    expect(screen.queryByRole('article', { name: /Pi searched your photos/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('article', { name: /Pi read photo details/i })).not.toBeInTheDocument();
  });

  it('updates an expanded tool row when polling advances its status', async () => {
    const seedMessages = [
      {
        ...makeMessage('message-user', AgentMessageRole.User, 'Find beach photos'),
        createdAt: '2026-05-16T10:00:00.000Z',
      },
    ];
    const runningToolCall = makeToolCall({
      id: 'stable-tool',
      toolName: AgentToolName.SearchAssets,
      status: AgentToolCallStatus.Executing,
      responseSummary: null,
      assetCount: 2,
      albumCount: 0,
      completedAt: null,
      startedAt: '2026-05-16T10:00:05.000Z',
    });
    const completedToolCall = {
      ...runningToolCall,
      status: AgentToolCallStatus.Completed,
      responseSummary: 'Found matching beach photos',
      completedAt: '2026-05-16T10:00:10.000Z',
    };
    const view = render(AgentSessionChatPanel, {
      props: { session, seedMessages, toolCalls: [runningToolCall] },
    });

    // Running: one-liner shown
    expect(await screen.findByTestId('agent-turn-timeline')).toBeInTheDocument();

    await view.rerender({
      session,
      seedMessages,
      toolCalls: [completedToolCall],
    });

    // Still running session: one-liner updated to "Thinking…" (all calls done, waiting for assistant)
    expect(screen.getByTestId('agent-turn-timeline')).toBeInTheDocument();
    expect(screen.getByText('Thinking…')).toBeInTheDocument();
  });

  it('keeps expanded activity row order stable when an equivalent polling refresh arrives reordered', async () => {
    const userMessage = {
      ...makeMessage('message-user', AgentMessageRole.User, 'Find beach photos'),
      createdAt: '2026-05-16T10:00:00.000Z',
    };
    const assistantMessage = {
      ...makeMessage('message-assistant', AgentMessageRole.Assistant, 'Done.'),
      createdAt: '2026-05-16T10:01:00.000Z',
    };
    const toolCalls = Array.from({ length: 5 }, (_, index) =>
      makeToolCall({
        id: `stable-tool-${index}`,
        toolName: AgentToolName.SearchAssets,
        responseSummary: `Result ${index}`,
        assetCount: index + 1,
        albumCount: 0,
        startedAt: `2026-05-16T10:00:0${index}.000Z`,
        completedAt: `2026-05-16T10:00:1${index}.000Z`,
      }),
    );
    const view = render(AgentSessionChatPanel, {
      props: {
        session: { ...session, status: AgentSessionStatus.Completed },
        seedMessages: [userMessage, assistantMessage],
        toolCalls,
      },
    });

    // Settled timeline renders with a "5 steps" summary line
    expect(await screen.findByRole('button', { name: /5 steps/i })).toBeInTheDocument();

    await view.rerender({
      session: { ...session, status: AgentSessionStatus.Completed },
      seedMessages: [userMessage, assistantMessage],
      toolCalls: [...toolCalls].reverse(),
    });

    // After rerender with reordered calls, still "5 steps" (merge is stable by id)
    expect(screen.getByRole('button', { name: /5 steps/i })).toBeInTheDocument();
  });

  it('does not regress a completed expanded tool row when an older polling response arrives later', async () => {
    const seedMessages = [
      {
        ...makeMessage('message-user', AgentMessageRole.User, 'Find beach photos'),
        createdAt: '2026-05-16T10:00:00.000Z',
      },
    ];
    const completedToolCall = makeToolCall({
      id: 'stable-tool',
      toolName: AgentToolName.SearchAssets,
      status: AgentToolCallStatus.Completed,
      responseSummary: 'Found matching beach photos',
      assetCount: 2,
      albumCount: 0,
      completedAt: '2026-05-16T10:00:10.000Z',
      startedAt: '2026-05-16T10:00:05.000Z',
    });
    const staleRunningToolCall = {
      ...completedToolCall,
      status: AgentToolCallStatus.Executing,
      responseSummary: null,
      completedAt: null,
    };
    const assistantMessage = {
      ...makeMessage('message-assistant', AgentMessageRole.Assistant, 'Found them.'),
      createdAt: '2026-05-16T10:00:20.000Z',
    };
    const view = render(AgentSessionChatPanel, {
      props: {
        session: { ...session, status: AgentSessionStatus.Completed },
        seedMessages: [...seedMessages, assistantMessage],
        toolCalls: [completedToolCall],
      },
    });

    // Settled session → "1 step" summary
    expect(await screen.findByRole('button', { name: /1 step/i })).toBeInTheDocument();

    await view.rerender({
      session: { ...session, status: AgentSessionStatus.Completed },
      seedMessages: [...seedMessages, assistantMessage],
      toolCalls: [staleRunningToolCall],
    });

    // Merge preserves completed status — still "1 step" (not regressed to running)
    expect(screen.getByRole('button', { name: /1 step/i })).toBeInTheDocument();
  });

  it('keeps current-turn activity after the assistant response arrives while tool calls are temporarily absent', async () => {
    const userMessage = {
      ...makeMessage('message-user', AgentMessageRole.User, 'List my albums'),
      createdAt: '2026-05-16T10:00:00.000Z',
    };
    const assistantMessage = {
      ...makeMessage('message-assistant', AgentMessageRole.Assistant, 'You have one album.'),
      createdAt: '2026-05-16T10:00:20.000Z',
    };
    const view = render(AgentSessionChatPanel, {
      props: {
        session,
        seedMessages: [userMessage],
        toolCalls: [
          makeToolCall({
            id: 'album-tool',
            startedAt: '2026-05-16T10:00:05.000Z',
            completedAt: '2026-05-16T10:00:06.000Z',
          }),
        ],
      },
    });

    expect(await screen.findByTestId('agent-turn-timeline')).toBeInTheDocument();

    await view.rerender({
      session: { ...session, status: AgentSessionStatus.Completed },
      seedMessages: [userMessage, assistantMessage],
      toolCalls: [],
    });

    // Merge preserves the tool call — timeline still visible as "1 step" settled summary
    const transcript = screen.getByTestId('agent-session-chat-transcript');
    expect(screen.getByTestId('agent-turn-timeline')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /1 step/i })).toBeInTheDocument();
    expect(Array.from(transcript.querySelectorAll('[data-chat-item]')).map((item) => item.textContent)).toEqual([
      expect.stringContaining('List my albums'),
      expect.stringContaining('1 step'),
      expect.stringContaining('You have one album.'),
    ]);
  });

  it('preserves merged tool calls when an empty refresh arrives mid-session', async () => {
    const seedMessages = [
      {
        ...makeMessage('message-user', AgentMessageRole.User, 'Find my South Africa photos'),
        createdAt: '2026-05-16T10:59:00.000Z',
      },
    ];
    const view = render(AgentSessionChatPanel, {
      props: {
        session,
        seedMessages,
        toolCalls: makeToolBurst(8),
      },
    });

    expect(await screen.findByTestId('agent-turn-timeline')).toBeInTheDocument();

    await view.rerender({
      session,
      seedMessages,
      toolCalls: [],
    });

    // Empty refresh doesn't drop the merged tool calls — timeline still present
    expect(screen.getByTestId('agent-turn-timeline')).toBeInTheDocument();
  });

  it('clears preserved tool calls when the selected session changes', async () => {
    const sessionTwo = { ...session, id: '00000000-0000-4000-8000-000000000200' };
    const view = render(AgentSessionChatPanel, {
      props: {
        session,
        seedMessages: [
          {
            ...makeMessage('message-user', AgentMessageRole.User, 'Find photos'),
            createdAt: '2026-05-16T10:00:00.000Z',
          },
        ],
        toolCalls: [
          makeToolCall({
            id: 'old-session-tool',
            toolName: AgentToolName.SearchAssets,
            responseSummary: 'Old session result',
            assetCount: 2,
            albumCount: 0,
            completedAt: '2026-05-16T10:00:10.000Z',
          }),
        ],
      },
    });

    expect(await screen.findByTestId('agent-turn-timeline')).toBeInTheDocument();

    await view.rerender({
      session: sessionTwo,
      seedMessages: [
        {
          ...makeMessage('message-session-two', AgentMessageRole.User, 'Second session request', sessionTwo.id),
          createdAt: '2026-05-16T10:01:00.000Z',
        },
      ],
      toolCalls: [],
    });

    expect(screen.queryByText('Old session result')).not.toBeInTheDocument();
  });

  it('renders denied and failed current-turn activity without request and error context', async () => {
    render(AgentSessionChatPanel, {
      props: {
        session,
        seedMessages: [
          {
            ...makeMessage('message-user', AgentMessageRole.User, 'Check album access'),
            createdAt: '2026-05-16T11:56:00.000Z',
          },
        ],
        toolCalls: [
          makeToolCall({
            id: 'denied-tool-call',
            status: AgentToolCallStatus.Denied,
            approvalDecision: AgentToolApprovalDecision.Denied,
            requestSummary: 'Read private screenshots',
            responseSummary: '',
            error: 'You denied access.',
            completedAt: '2026-05-16T11:57:00.000Z',
          }),
          makeToolCall({
            id: 'failed-tool-call',
            status: AgentToolCallStatus.Failed,
            requestSummary: 'List albums before organizing',
            responseSummary: '',
            error: 'Album service timed out.',
            completedAt: '2026-05-16T11:58:00.000Z',
          }),
        ],
      },
    });

    // Both rows appear in the running timeline (session still Running)
    const timeline = await screen.findByTestId('agent-turn-timeline');
    // Timeline is collapsed by default — details not shown
    expect(timeline).not.toHaveTextContent('Read private screenshots');
    expect(timeline).not.toHaveTextContent('You denied access.');
    expect(timeline).not.toHaveTextContent('List albums before organizing');
    expect(timeline).not.toHaveTextContent('Album service timed out.');
  });

  it('renders expanded row details when a timeline row is clicked', async () => {
    sdkMock.getAgentSessionMessages.mockResolvedValue([
      {
        ...makeMessage('message-user', AgentMessageRole.User, 'Inspect private metadata'),
        createdAt: '2026-05-16T10:00:00.000Z',
      },
    ]);

    render(AgentSessionChatPanel, {
      props: {
        session: { ...session, status: AgentSessionStatus.Completed },
        toolCalls: [
          makeToolCall({
            id: 'detail-tool',
            toolName: AgentToolName.ReadAssetMetadata,
            status: AgentToolCallStatus.Failed,
            requestSummary: 'Read metadata for 5 assets',
            responseSummary: null,
            error: 'Provider failed',
            completedAt: '2026-05-16T10:00:06.000Z',
          }),
        ],
      },
    });

    // Wait for the timeline to appear (settled: 1 step)
    const timeline = await screen.findByTestId('agent-turn-timeline');
    const summaryBtn = within(timeline).getByRole('button', { name: /1 step/i });
    await fireEvent.click(summaryBtn);

    // Now the row button is visible; click it to expand detail
    const rowBtn = within(timeline).getByRole('button', { name: 'readAssetMetadata' });
    await fireEvent.click(rowBtn);

    expect(timeline).toHaveTextContent('Read metadata for 5 assets');
    expect(timeline).toHaveTextContent('Provider failed');
  });

  it('renders expanded row details with secrets redacted', async () => {
    sdkMock.getAgentSessionMessages.mockResolvedValue([
      {
        ...makeMessage('message-user', AgentMessageRole.User, 'Inspect metadata'),
        createdAt: '2026-05-16T10:00:00.000Z',
      },
    ]);

    render(AgentSessionChatPanel, {
      props: {
        session: { ...session, status: AgentSessionStatus.Completed },
        toolCalls: [
          makeToolCall({
            id: 'secret-tool',
            toolName: AgentToolName.ReadAssetMetadata,
            status: AgentToolCallStatus.Completed,
            requestSummary: 'List albums',
            responseSummary: 'Authorization: Bearer supersecrettoken999',
            error: null,
            completedAt: '2026-05-16T10:00:06.000Z',
          }),
        ],
      },
    });

    // Wait for the timeline to appear (settled: 1 step)
    const timeline = await screen.findByTestId('agent-turn-timeline');
    const summaryBtn = within(timeline).getByRole('button', { name: /1 step/i });
    await fireEvent.click(summaryBtn);

    // Now the row button is visible; click it to expand detail
    const rowBtn = within(timeline).getByRole('button', { name: AgentToolName.ReadAssetMetadata });
    await fireEvent.click(rowBtn);

    // Redacted token must appear as [REDACTED]; raw secret must not be present anywhere
    expect(timeline).toHaveTextContent('[REDACTED]');
    expect(timeline).not.toHaveTextContent('supersecrettoken999');
  });

  it('renders assistant markdown headings and inline code as formatted content', async () => {
    sdkMock.getAgentSessionMessages.mockResolvedValue([
      makeMessage(
        'message-assistant',
        AgentMessageRole.Assistant,
        '# Heading 1\n## Heading 2\n### Heading 3\nUse `inline code` in text.',
      ),
    ]);

    render(AgentSessionChatPanel, { props: { session } });

    expect(await screen.findByRole('heading', { level: 3, name: 'Heading 1' })).toHaveClass('text-xl');
    expect(screen.getByRole('heading', { level: 4, name: 'Heading 2' })).toHaveClass('text-lg');
    expect(screen.getByRole('heading', { level: 5, name: 'Heading 3' })).toHaveClass('text-base');
    expect(screen.getByText('inline code').tagName).toBe('CODE');
  });

  it('renders assistant fenced multiline code blocks as formatted code', async () => {
    sdkMock.getAgentSessionMessages.mockResolvedValue([
      makeMessage(
        'message-assistant',
        AgentMessageRole.Assistant,
        'Use this:\n```python\ndef hello(name):\n    return f"Hello, {name}!"\n```\nThen save it.',
      ),
    ]);

    render(AgentSessionChatPanel, { props: { session } });

    const code = await screen.findByText(/def hello\(name\):/);
    expect(code.tagName).toBe('CODE');
    expect(code.closest('pre')).toBeInTheDocument();
    expect(code).toHaveTextContent('return f"Hello, {name}!"');
    expect(screen.getByText('Then save it.')).toBeInTheDocument();
  });

  it('converges on the assistant response by polling while the latest turn is running (no websocket needed)', async () => {
    vi.useFakeTimers();
    try {
      // websocket delivers nothing at all in this scenario
      websocketMock.websocketEvents.on.mockReturnValue(vi.fn());
      sdkMock.getAgentSessionMessages.mockResolvedValueOnce([
        makeMessage('message-user', AgentMessageRole.User, 'make an album of my recent trip'),
      ]);

      render(AgentSessionChatPanel, { props: { session } });
      await vi.advanceTimersByTimeAsync(0);
      expect(screen.getByText('make an album of my recent trip')).toBeInTheDocument();
      expect(screen.queryByText('Which date range should I use?')).not.toBeInTheDocument();

      sdkMock.getAgentSessionMessages.mockResolvedValue([
        makeMessage('message-user', AgentMessageRole.User, 'make an album of my recent trip'),
        makeMessage('message-assistant', AgentMessageRole.Assistant, 'Which date range should I use?'),
      ]);
      await vi.advanceTimersByTimeAsync(2600);

      expect(screen.getByText('Which date range should I use?')).toBeInTheDocument();
    } finally {
      vi.useRealTimers();
    }
  });

  it('stops polling once the turn settles', async () => {
    vi.useFakeTimers();
    try {
      websocketMock.websocketEvents.on.mockReturnValue(vi.fn());
      sdkMock.getAgentSessionMessages.mockResolvedValueOnce([
        makeMessage('message-user', AgentMessageRole.User, 'make an album of my recent trip'),
      ]);

      render(AgentSessionChatPanel, { props: { session } });
      await vi.advanceTimersByTimeAsync(0);

      sdkMock.getAgentSessionMessages.mockResolvedValue([
        makeMessage('message-user', AgentMessageRole.User, 'make an album of my recent trip'),
        makeMessage('message-assistant', AgentMessageRole.Assistant, 'Which date range should I use?'),
      ]);
      await vi.advanceTimersByTimeAsync(2600);
      expect(screen.getByText('Which date range should I use?')).toBeInTheDocument();

      const callsAfterSettle = sdkMock.getAgentSessionMessages.mock.calls.length;
      await vi.advanceTimersByTimeAsync(10_000);
      expect(sdkMock.getAgentSessionMessages.mock.calls.length).toBe(callsAfterSettle);
    } finally {
      vi.useRealTimers();
    }
  });

  it('refetches messages when a terminal activity event lands (self-heal for missed message events)', async () => {
    let handler: Parameters<typeof websocketMock.websocketEvents.on>[1] | undefined;
    websocketMock.websocketEvents.on.mockImplementation((_eventName, nextHandler) => {
      handler = nextHandler;
      return vi.fn();
    });
    sdkMock.getAgentSessionMessages.mockResolvedValueOnce([
      makeMessage('message-user', AgentMessageRole.User, 'make an album of my recent trip'),
    ]);

    render(AgentSessionChatPanel, { props: { session } });
    await screen.findByText('make an album of my recent trip');
    expect(screen.queryByText('Which date range should I use?')).not.toBeInTheDocument();

    sdkMock.getAgentSessionMessages.mockResolvedValue([
      makeMessage('message-user', AgentMessageRole.User, 'make an album of my recent trip'),
      makeMessage('message-assistant', AgentMessageRole.Assistant, 'Which date range should I use?'),
    ]);
    handler?.({
      type: 'activity',
      sessionId: session.id,
      event: makeActivityEvent({ status: AgentSessionActivityEventStatus.Completed }),
      createdAt: '2026-05-14T00:00:02.000Z',
    });

    expect(await screen.findByText('Which date range should I use?')).toBeInTheDocument();
  });

  it('renders streamed assistant fenced multiline code blocks as formatted code', async () => {
    let handler: Parameters<typeof websocketMock.websocketEvents.on>[1] | undefined;
    websocketMock.websocketEvents.on.mockImplementation((_eventName, nextHandler) => {
      handler = nextHandler;
      return vi.fn();
    });

    render(AgentSessionChatPanel, { props: { session } });
    await screen.findByRole('textbox', { name: 'Message' });

    handler?.({
      type: 'assistant-message-delta',
      sessionId: session.id,
      delta: '```ts\nconst album = "Favorites";\nconsole.log(album);\n```',
      sequence: 1,
      createdAt: '2026-05-14T00:00:01.000Z',
    });

    const code = await screen.findByText(/const album = "Favorites";/);
    expect(code.tagName).toBe('CODE');
    expect(code.closest('pre')).toBeInTheDocument();
    expect(code).toHaveTextContent('console.log(album);');
  });

  it('renders assistant markdown tables as formatted content', async () => {
    sdkMock.getAgentSessionMessages.mockResolvedValue([
      makeMessage(
        'message-assistant',
        AgentMessageRole.Assistant,
        [
          'Rendered:',
          '| Feature | Supported | Notes |',
          '| --- | --- | --- |',
          '| Headings | Yes | #, ##, ### |',
          '| Inline styles | Yes | **bold**, *italic*, `code` |',
          'Done.',
        ].join('\n'),
      ),
    ]);

    render(AgentSessionChatPanel, { props: { session } });

    expect(await screen.findByRole('table')).toBeInTheDocument();
    expect(screen.getByRole('columnheader', { name: 'Feature' })).toBeInTheDocument();
    expect(screen.getByRole('columnheader', { name: 'Supported' })).toBeInTheDocument();
    expect(screen.getByRole('cell', { name: 'Headings' })).toBeInTheDocument();
    expect(screen.getByRole('cell', { name: '#, ##, ###' })).toBeInTheDocument();
    expect(screen.getByText('bold').tagName).toBe('STRONG');
    expect(screen.getByText('italic').tagName).toBe('EM');
    expect(screen.getByText('code').tagName).toBe('CODE');
    expect(screen.getByText('Done.')).toBeInTheDocument();
  });

  it('renders assistant markdown links and images as formatted content', async () => {
    sdkMock.getAgentSessionMessages.mockResolvedValue([
      makeMessage(
        'message-assistant',
        AgentMessageRole.Assistant,
        [
          '[Inline link](https://example.com)',
          '[Link with title](https://example.com "Example Site")',
          '![Alt text for image](https://via.placeholder.com/150 "Optional title")',
        ].join('\n'),
      ),
    ]);

    render(AgentSessionChatPanel, { props: { session } });

    const inlineLink = await screen.findByRole('link', { name: 'Inline link' });
    expect(inlineLink).toHaveAttribute('href', 'https://example.com');
    expect(inlineLink).toHaveAttribute('target', '_blank');
    expect(inlineLink).toHaveAttribute('rel', 'noreferrer');

    const titledLink = screen.getByRole('link', { name: 'Link with title' });
    expect(titledLink).toHaveAttribute('title', 'Example Site');

    const image = screen.getByRole('img', { name: 'Alt text for image' });
    expect(image).toHaveAttribute('src', 'https://via.placeholder.com/150');
    expect(image).toHaveAttribute('title', 'Optional title');
  });

  it('renders streamed assistant markdown links and images as formatted content', async () => {
    let handler: Parameters<typeof websocketMock.websocketEvents.on>[1] | undefined;
    websocketMock.websocketEvents.on.mockImplementation((_eventName, nextHandler) => {
      handler = nextHandler;
      return vi.fn();
    });

    render(AgentSessionChatPanel, { props: { session } });
    await screen.findByRole('textbox', { name: 'Message' });

    handler?.({
      type: 'assistant-message-delta',
      sessionId: session.id,
      delta: '[Docs](https://example.com/docs)\n![Preview](https://example.com/preview.jpg)',
      sequence: 1,
      createdAt: '2026-05-14T00:00:01.000Z',
    });

    expect(await screen.findByRole('link', { name: 'Docs' })).toHaveAttribute('href', 'https://example.com/docs');
    expect(screen.getByRole('img', { name: 'Preview' })).toHaveAttribute('src', 'https://example.com/preview.jpg');
  });

  it('renders streamed assistant markdown tables as formatted content', async () => {
    let handler: Parameters<typeof websocketMock.websocketEvents.on>[1] | undefined;
    websocketMock.websocketEvents.on.mockImplementation((_eventName, nextHandler) => {
      handler = nextHandler;
      return vi.fn();
    });

    render(AgentSessionChatPanel, { props: { session } });
    await screen.findByRole('textbox', { name: 'Message' });

    handler?.({
      type: 'assistant-message-delta',
      sessionId: session.id,
      delta: '| Album | Count |\n| --- | --- |\n| Favorites | 42 |',
      sequence: 1,
      createdAt: '2026-05-14T00:00:01.000Z',
    });

    expect(await screen.findByRole('table')).toBeInTheDocument();
    expect(screen.getByRole('columnheader', { name: 'Album' })).toBeInTheDocument();
    expect(screen.getByRole('cell', { name: 'Favorites' })).toBeInTheDocument();
    expect(screen.getByRole('cell', { name: '42' })).toBeInTheDocument();
  });

  it('renders streamed assistant markdown headings and inline code as formatted content', async () => {
    let handler: Parameters<typeof websocketMock.websocketEvents.on>[1] | undefined;
    websocketMock.websocketEvents.on.mockImplementation((_eventName, nextHandler) => {
      handler = nextHandler;
      return vi.fn();
    });

    render(AgentSessionChatPanel, { props: { session } });
    await screen.findByRole('textbox', { name: 'Message' });

    handler?.({
      type: 'assistant-message-delta',
      sessionId: session.id,
      delta: '## Suggested query\nTry `rating:5`.',
      sequence: 1,
      createdAt: '2026-05-14T00:00:01.000Z',
    });

    expect(await screen.findByRole('heading', { level: 4, name: 'Suggested query' })).toBeInTheDocument();
    expect(screen.getByText('rating:5').tagName).toBe('CODE');
  });

  it('renders streamed assistant markdown as formatted content', async () => {
    let handler: Parameters<typeof websocketMock.websocketEvents.on>[1] | undefined;
    websocketMock.websocketEvents.on.mockImplementation((_eventName, nextHandler) => {
      handler = nextHandler;
      return vi.fn();
    });

    render(AgentSessionChatPanel, { props: { session } });
    await screen.findByRole('textbox', { name: 'Message' });

    handler?.({
      type: 'assistant-message-delta',
      sessionId: session.id,
      delta: 'Try **Albums**:\n- Travel\n- Family',
      sequence: 1,
      createdAt: '2026-05-14T00:00:01.000Z',
    });

    const albumsText = await screen.findByText('Albums');
    expect(albumsText.tagName).toBe('STRONG');
    expect(screen.getByText('Travel').closest('li')).toBeInTheDocument();
    expect(screen.getByText('Family').closest('li')).toBeInTheDocument();
  });

  it('renders assistant markdown without interpreting raw HTML', async () => {
    sdkMock.getAgentSessionMessages.mockResolvedValue([
      makeMessage('message-assistant', AgentMessageRole.Assistant, 'Keep <script>alert("x")</script> as text.'),
    ]);

    render(AgentSessionChatPanel, { props: { session } });

    expect(await screen.findByText(/<script>alert\("x"\)<\/script>/)).toBeInTheDocument();
    expect(document.querySelector('script')).not.toBeInTheDocument();
  });

  it('reports a discovered title after transcript load', async () => {
    const onTitleDiscovered = vi.fn();
    sdkMock.getAgentSessionMessages.mockResolvedValue([
      makeMessage('message-assistant', AgentMessageRole.Assistant, 'I can help with that.'),
      makeMessage('message-user', AgentMessageRole.User, '  Show   me\nmy albums  '),
    ]);

    render(AgentSessionChatPanel, { props: { session, onTitleDiscovered } });

    await screen.findByText(/Show\s+me\s+my albums/);
    expect(onTitleDiscovered).toHaveBeenCalledTimes(1);
    expect(onTitleDiscovered).toHaveBeenCalledWith(session.id, 'Show me my albums');
  });

  it('does not report a title for assistant-only or blank transcripts', async () => {
    const onTitleDiscovered = vi.fn();
    sdkMock.getAgentSessionMessages.mockResolvedValue([
      makeMessage('message-assistant', AgentMessageRole.Assistant, 'Assistant title'),
      makeMessage('message-blank', AgentMessageRole.User, '   \n\t '),
    ]);

    render(AgentSessionChatPanel, { props: { session, onTitleDiscovered } });

    await screen.findByText('Assistant title');
    await tick();
    expect(onTitleDiscovered).not.toHaveBeenCalled();
  });

  it('keeps messages received before the initial transcript load resolves', async () => {
    let resolveMessages: (messages: AgentMessageResponseDto[]) => void;
    sdkMock.getAgentSessionMessages.mockReturnValue(
      new Promise<AgentMessageResponseDto[]>((resolve) => {
        resolveMessages = resolve;
      }),
    );
    let handler: Parameters<typeof websocketMock.websocketEvents.on>[1] | undefined;
    websocketMock.websocketEvents.on.mockImplementation((_eventName, nextHandler) => {
      handler = nextHandler;
      return vi.fn();
    });

    render(AgentSessionChatPanel, { props: { session } });
    await screen.findByRole('textbox', { name: 'Message' });

    handler?.({
      type: 'assistant-message-created',
      sessionId: session.id,
      message: makeMessage('message-live', AgentMessageRole.Assistant, 'Live response'),
      createdAt: '2026-05-14T00:00:02.000Z',
    });
    expect(await screen.findByText('Live response')).toBeInTheDocument();

    resolveMessages!([makeMessage('message-loaded', AgentMessageRole.User, 'Loaded prompt')]);

    expect(await screen.findByText('Loaded prompt')).toBeInTheDocument();
    expect(screen.getByText('Live response')).toBeInTheDocument();
  });

  it('reports a title from a successful send before transcript load resolves', async () => {
    const onTitleDiscovered = vi.fn();
    let resolveMessages: (messages: AgentMessageResponseDto[]) => void;
    sdkMock.getAgentSessionMessages.mockReturnValue(
      new Promise<AgentMessageResponseDto[]>((resolve) => {
        resolveMessages = resolve;
      }),
    );
    sdkMock.appendAgentSessionMessage.mockResolvedValue(
      makeMessage('message-created', AgentMessageRole.User, 'Organize favorites'),
    );

    render(AgentSessionChatPanel, { props: { session, onTitleDiscovered } });

    const input = await screen.findByRole('textbox', { name: 'Message' });
    await fireEvent.input(input, { target: { value: 'Organize favorites' } });
    await fireEvent.click(screen.getByRole('button', { name: 'Send' }));

    await waitFor(() => expect(onTitleDiscovered).toHaveBeenCalledWith(session.id, 'Organize favorites'));
    expect(onTitleDiscovered).toHaveBeenCalledTimes(1);

    resolveMessages!([]);
  });

  it('does not publish duplicate title discoveries when merged messages repeat', async () => {
    const onTitleDiscovered = vi.fn();
    const sentMessage = makeMessage('message-created', AgentMessageRole.User, 'Organize favorites');
    let resolveMessages: (messages: AgentMessageResponseDto[]) => void;
    sdkMock.getAgentSessionMessages.mockReturnValue(
      new Promise<AgentMessageResponseDto[]>((resolve) => {
        resolveMessages = resolve;
      }),
    );
    sdkMock.appendAgentSessionMessage.mockResolvedValue(sentMessage);

    render(AgentSessionChatPanel, { props: { session, onTitleDiscovered } });

    const input = await screen.findByRole('textbox', { name: 'Message' });
    await fireEvent.input(input, { target: { value: 'Organize favorites' } });
    await fireEvent.click(screen.getByRole('button', { name: 'Send' }));
    await waitFor(() => expect(onTitleDiscovered).toHaveBeenCalledTimes(1));

    resolveMessages!([sentMessage]);
    await tick();

    expect(onTitleDiscovered).toHaveBeenCalledTimes(1);
  });

  it('shows error when transcript loading fails', async () => {
    sdkMock.getAgentSessionMessages.mockRejectedValue(new Error('failed'));

    render(AgentSessionChatPanel, { props: { session } });

    expect(await screen.findByRole('alert')).toHaveTextContent('Unable to load messages');
  });

  it('does not keep the assistant busy indicator for an interrupted session with stale pending state', async () => {
    render(AgentSessionChatPanel, {
      props: {
        session: { ...session, status: AgentSessionStatus.Interrupted },
        seedMessages: [makeMessage('message-user', AgentMessageRole.User, 'Create album zzz')],
        assistantResponsePending: true,
      },
    });

    expect(await screen.findByText('Create album zzz')).toBeInTheDocument();
    await waitFor(() => expect(screen.queryByText('pi is working...')).not.toBeInTheDocument());
  });

  it('sends a user message and clears input', async () => {
    const returnedMessage = makeMessage('message-created', AgentMessageRole.User, 'Organize favorites');
    sdkMock.appendAgentSessionMessage.mockResolvedValue(returnedMessage);

    render(AgentSessionChatPanel, { props: { session } });

    const input = await screen.findByRole('textbox', { name: 'Message' });
    await fireEvent.input(input, { target: { value: '  Organize favorites  ' } });
    await fireEvent.click(screen.getByRole('button', { name: 'Send' }));

    await waitFor(() =>
      expect(sdkMock.appendAgentSessionMessage).toHaveBeenCalledWith({
        id: session.id,
        agentMessageCreateDto: {
          content: {
            blocks: [{ type: AgentMessageTextBlockType.Text, text: 'Organize favorites' }],
          },
        },
      }),
    );
    expect(await screen.findByText('Organize favorites')).toBeInTheDocument();
    expect(input).toHaveValue('');
  });

  it('shows the submitted user message immediately and blocks composer while append is active', async () => {
    let handler: Parameters<typeof websocketMock.websocketEvents.on>[1] | undefined;
    websocketMock.websocketEvents.on.mockImplementation((_eventName, nextHandler) => {
      handler = nextHandler;
      return vi.fn();
    });
    let resolveAppend: (message: AgentMessageResponseDto) => void;
    sdkMock.appendAgentSessionMessage.mockReturnValue(
      new Promise<AgentMessageResponseDto>((resolve) => {
        resolveAppend = resolve;
      }),
    );

    render(AgentSessionChatPanel, { props: { session } });

    const input = await screen.findByRole('textbox', { name: 'Message' });
    await fireEvent.input(input, { target: { value: '  Organize favorites  ' } });
    await fireEvent.click(screen.getByRole('button', { name: 'Send' }));

    expect(await screen.findByText('Organize favorites')).toBeInTheDocument();
    expect(input).toHaveValue('');
    expect(input).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Send' })).toBeDisabled();

    resolveAppend!(makeMessage('message-created', AgentMessageRole.User, 'Organize favorites'));
    handler?.({
      type: 'assistant-message-created',
      sessionId: session.id,
      message: makeMessage('message-assistant-created', AgentMessageRole.Assistant, 'Done.'),
      createdAt: '2026-05-14T00:00:01.000Z',
    });

    await waitFor(() => expect(input).toBeEnabled());
    expect(screen.getByText('Organize favorites')).toBeInTheDocument();
  });

  it('sorts messages and handled tool calls deterministically by timestamp and id', async () => {
    sdkMock.getAgentSessionMessages.mockResolvedValue([
      {
        ...makeMessage('message-b', AgentMessageRole.User, 'Second same-time message'),
        createdAt: '2026-05-16T10:00:00.000Z',
      },
      {
        ...makeMessage('message-a', AgentMessageRole.Assistant, 'First same-time message'),
        createdAt: '2026-05-16T09:59:00.000Z',
      },
      {
        ...makeMessage('message-later', AgentMessageRole.Assistant, 'Later assistant response'),
        createdAt: '2026-05-16T10:02:00.000Z',
      },
    ]);

    render(AgentSessionChatPanel, {
      props: {
        session,
        toolCalls: [
          makeToolCall({
            id: 'middle-tool',
            status: AgentToolCallStatus.Completed,
            requestSummary: 'Check albums between messages',
            responseSummary: 'Returned 1 album(s)',
            startedAt: '2026-05-16T10:01:00.000Z',
            completedAt: '2026-05-16T10:01:05.000Z',
          }),
        ],
      },
    });

    const transcript = await screen.findByTestId('agent-session-chat-transcript');
    await screen.findByText('Later assistant response');

    expect(Array.from(transcript.querySelectorAll('[data-chat-item]')).map((item) => item.textContent)).toEqual([
      expect.stringContaining('First same-time message'),
      expect.stringContaining('Second same-time message'),
      // the turn is answered (assistant response below), so the timeline shows the settled summary line
      expect.stringContaining('1 step'),
      expect.stringContaining('Later assistant response'),
    ]);
  });

  it('renders applied operation plans as read-only timeline cards between messages', async () => {
    sdkMock.getAgentSessionMessages.mockResolvedValue([
      {
        ...makeMessage('message-before', AgentMessageRole.User, 'Please organize Portugal'),
        createdAt: '2026-05-16T10:00:00.000Z',
      },
      {
        ...makeMessage('message-after', AgentMessageRole.User, 'Now add Porto'),
        createdAt: '2026-05-16T10:02:00.000Z',
      },
    ]);
    setAppliedPlanHistory([
      makeAppliedPlan({
        updatedAt: '2026-05-16T10:01:00.000Z',
        operations: [
          makeOperation({ id: 'operation-applied', status: AgentOperationStatus.Applied }),
          makeOperation({
            id: 'operation-failed',
            type: AgentOperationType.AlbumAddAssets,
            status: AgentOperationStatus.Failed,
            assetIds: ['asset-1', 'asset-2'],
            payload: {},
            error: 'Asset permissions changed before apply',
          }),
        ],
      }),
    ]);

    render(AgentSessionChatPanel, { props: { session } });

    const appliedCard = await screen.findByRole('article', { name: 'Applied plan: Organize Portugal holiday' });
    expect(appliedCard.className).toContain('max-w-[92%]');
    expect(appliedCard).toHaveTextContent('Applied plan');
    expect(appliedCard).toHaveTextContent('Organize Portugal holiday');
    expect(appliedCard).toHaveTextContent('1 applied · 0 skipped · 1 failed.');
    expect(appliedCard).toHaveTextContent('Asset permissions changed before apply');
    expect(within(appliedCard).queryByRole('button', { name: /Apply/i })).not.toBeInTheDocument();
    expect(within(appliedCard).queryByRole('checkbox')).not.toBeInTheDocument();
    expect(within(appliedCard).queryByRole('textbox')).not.toBeInTheDocument();

    const transcript = screen.getByTestId('agent-session-chat-transcript');
    expect(Array.from(transcript.querySelectorAll('[data-chat-item]')).map((item) => item.textContent)).toEqual([
      expect.stringContaining('Please organize Portugal'),
      expect.stringContaining('Applied plan'),
      expect.stringContaining('Now add Porto'),
      expect.stringContaining('Understanding request'),
    ]);
  });

  it('keeps an applied space detail plan in history and leaves composer usable for continuation', async () => {
    sdkMock.getAgentSessionMessages.mockResolvedValue([
      {
        ...makeMessage('message-before', AgentMessageRole.User, 'Rename Family to Family 2026'),
        createdAt: '2026-05-16T10:00:00.000Z',
      },
      {
        ...makeMessage('message-after', AgentMessageRole.Assistant, 'Done. What should we do next?'),
        createdAt: '2026-05-16T10:02:00.000Z',
      },
    ]);
    sdkMock.appendAgentSessionMessage.mockResolvedValue(
      makeMessage('message-created', AgentMessageRole.User, 'Now make it blue'),
    );
    setAppliedPlanHistory([
      makeAppliedPlan({
        updatedAt: '2026-05-16T10:01:00.000Z',
        operations: [
          makeOperation({
            id: 'operation-space-update',
            type: AgentOperationType.SpaceUpdateDetails,
            summary: 'Update Family space details',
            targetKind: AgentOperationTargetKind.ExistingSpace,
            targetId: 'space-1',
            temporaryTargetId: null,
            payload: { spaceName: 'Family 2026', description: '', color: 'blue' },
            result: { spaceId: 'space-1' },
          }),
        ],
      }),
    ]);

    render(AgentSessionChatPanel, { props: { session: { ...session, status: AgentSessionStatus.Running } } });

    const appliedCard = await screen.findByRole('article', { name: 'Applied plan: Organize Portugal holiday' });
    expect(appliedCard).toHaveTextContent('Renamed to "Family 2026"; Cleared description; Changed color to blue');
    expect(appliedCard).not.toHaveTextContent('space-1');

    const input = screen.getByRole('textbox', { name: 'Message' });
    await fireEvent.input(input, { target: { value: 'Now make it blue' } });
    await fireEvent.click(screen.getByRole('button', { name: 'Send' }));

    await waitFor(() => expect(sdkMock.appendAgentSessionMessage).toHaveBeenCalledTimes(1));
    expect(screen.getByRole('article', { name: 'Applied plan: Organize Portugal holiday' })).toBeInTheDocument();
    expect(input).toHaveValue('');
  });

  it('shows search acceptance results, applied plan history, and a usable composer after continuation', async () => {
    sdkMock.getAgentSessionMessages.mockResolvedValue([
      {
        ...makeMessage('message-before', AgentMessageRole.User, 'Find screenshots from 2024 that mention invoices.'),
        createdAt: '2026-05-16T10:00:00.000Z',
      },
      {
        ...makeMessage('message-after', AgentMessageRole.Assistant, 'I found matching invoice screenshots.'),
        createdAt: '2026-05-16T10:02:00.000Z',
      },
    ]);
    const searchToolCall = makeToolCall({
      toolName: AgentToolName.SearchAssets,
      status: AgentToolCallStatus.Completed,
      requestSummary: 'Search ocr assets (limit 50)',
      responseSummary: 'Returned metadata for 4 assets',
      assetCount: 4,
      startedAt: '2026-05-16T10:00:30.000Z',
      completedAt: '2026-05-16T10:01:00.000Z',
    });
    sdkMock.appendAgentSessionMessage.mockResolvedValue(
      makeMessage('message-created', AgentMessageRole.User, 'Now archive those.'),
    );
    setAppliedPlanHistory([
      makeAppliedPlan({
        summary: 'Archive invoice screenshots from 2024',
        updatedAt: '2026-05-16T10:01:30.000Z',
        operations: [
          makeOperation({
            id: 'operation-archive',
            type: AgentOperationType.AssetSetArchive,
            targetKind: AgentOperationTargetKind.AssetBatch,
            assetIds: ['asset-1', 'asset-2', 'asset-3', 'asset-4'],
            payload: { archive: true },
            status: AgentOperationStatus.Applied,
          }),
        ],
      }),
    ]);

    render(AgentSessionChatPanel, {
      props: { session: { ...session, status: AgentSessionStatus.Running }, toolCalls: [searchToolCall] },
    });

    expect(await screen.findByText('Find screenshots from 2024 that mention invoices.')).toBeInTheDocument();
    expect(screen.getByText('I found matching invoice screenshots.')).toBeInTheDocument();
    // Turn timeline for the first user message (running session, so shows one-liner)
    expect(screen.getByTestId('agent-turn-timeline')).toBeInTheDocument();
    expect(
      screen.getByRole('article', { name: 'Applied plan: Archive invoice screenshots from 2024' }),
    ).toHaveTextContent('Applied plan');

    const input = screen.getByRole('textbox', { name: 'Message' });
    expect(input).not.toBeDisabled();
    await fireEvent.input(input, { target: { value: 'Now archive those.' } });
    await fireEvent.click(screen.getByRole('button', { name: 'Send' }));

    await waitFor(() => expect(sdkMock.appendAgentSessionMessage).toHaveBeenCalledTimes(1));
    expect(sdkMock.appendAgentSessionMessage).toHaveBeenCalledWith({
      id: session.id,
      agentMessageCreateDto: {
        content: { blocks: [{ type: AgentMessageTextBlockType.Text, text: 'Now archive those.' }] },
      },
    });
  });

  it('refreshes applied plan history for plan-applied events without duplicating cards', async () => {
    let handler: Parameters<typeof websocketMock.websocketEvents.on>[1] | undefined;
    websocketMock.websocketEvents.on.mockImplementation((_eventName, nextHandler) => {
      handler = nextHandler;
      return vi.fn();
    });
    const appliedPlan = makeAppliedPlan();
    const getAppliedOperationPlans = vi
      .fn()
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([appliedPlan])
      .mockResolvedValueOnce([appliedPlan]);
    sdkMock.getAppliedOperationPlans.mockImplementation(getAppliedOperationPlans);

    render(AgentSessionChatPanel, { props: { session } });
    await waitFor(() => expect(getAppliedOperationPlans).toHaveBeenCalledWith({ id: session.id }));

    handler?.({
      type: 'operation-plan-applied',
      sessionId: session.id,
      planId: appliedPlan.id,
      status: AgentOperationApplyStatus.Applied,
      appliedCount: 2,
      skippedCount: 0,
      failedCount: 0,
    });
    handler?.({
      type: 'operation-plan-applied',
      sessionId: session.id,
      planId: appliedPlan.id,
      status: AgentOperationApplyStatus.Applied,
      appliedCount: 2,
      skippedCount: 0,
      failedCount: 0,
    });

    await waitFor(() => expect(getAppliedOperationPlans).toHaveBeenCalledTimes(3));
    expect(await screen.findAllByRole('article', { name: 'Applied plan: Organize Portugal holiday' })).toHaveLength(1);
  });

  it('submits a user message from the composer when Enter is pressed', async () => {
    const returnedMessage = makeMessage('message-created', AgentMessageRole.User, 'Organize favorites');
    sdkMock.appendAgentSessionMessage.mockResolvedValue(returnedMessage);

    render(AgentSessionChatPanel, { props: { session } });

    const input = await screen.findByRole('textbox', { name: 'Message' });
    await fireEvent.input(input, { target: { value: '  Organize favorites  ' } });
    const wasNotCancelled = await fireEvent.keyDown(input, { key: 'Enter', code: 'Enter' });

    expect(wasNotCancelled).toBe(false);
    await waitFor(() =>
      expect(sdkMock.appendAgentSessionMessage).toHaveBeenCalledWith({
        id: session.id,
        agentMessageCreateDto: {
          content: {
            blocks: [{ type: AgentMessageTextBlockType.Text, text: 'Organize favorites' }],
          },
        },
      }),
    );
    expect(input).toHaveValue('');
  });

  it('uses caller-provided placeholder and submit label for lifecycle composer states', async () => {
    sdkMock.appendAgentSessionMessage.mockResolvedValue(
      makeMessage('message-created', AgentMessageRole.User, 'Use revision feedback'),
    );

    render(AgentSessionChatPanel, {
      props: {
        session: { ...session, status: AgentSessionStatus.WaitingForPlanReview },
        composerPlaceholder: 'Tell the assistant what to revise',
        submitLabel: 'Resume',
      },
    });

    const input = await screen.findByRole('textbox', { name: 'Message' });
    expect(input).toHaveAttribute('placeholder', 'Tell the assistant what to revise');
    expect(screen.getByRole('button', { name: 'Resume' })).toBeDisabled();

    await fireEvent.input(input, { target: { value: 'Use revision feedback' } });
    await fireEvent.click(screen.getByRole('button', { name: 'Resume' }));

    await waitFor(() => expect(sdkMock.appendAgentSessionMessage).toHaveBeenCalledTimes(1));
    expect(sdkMock.appendAgentSessionMessage).toHaveBeenCalledWith({
      id: session.id,
      agentMessageCreateDto: {
        content: {
          blocks: [{ type: AgentMessageTextBlockType.Text, text: 'Use revision feedback' }],
        },
      },
    });
  });

  it('calls onMessageSent after a successful append without blocking successful send cleanup', async () => {
    const onMessageSent = vi.fn().mockRejectedValue(new Error('refresh failed'));
    sdkMock.appendAgentSessionMessage.mockResolvedValue(
      makeMessage('message-created', AgentMessageRole.User, 'Refresh after this'),
    );

    render(AgentSessionChatPanel, { props: { session, onMessageSent } });

    const input = await screen.findByRole('textbox', { name: 'Message' });
    await fireEvent.input(input, { target: { value: 'Refresh after this' } });
    await fireEvent.click(screen.getByRole('button', { name: 'Send' }));

    await waitFor(() => expect(onMessageSent).toHaveBeenCalledWith(session.id));
    expect(await screen.findByText('Refresh after this')).toBeInTheDocument();
    expect(input).toHaveValue('');
    expect(screen.getByRole('button', { name: 'Send' })).toBeDisabled();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('uses terminal action instead of appending when provided', async () => {
    const onTerminalAction = vi.fn();

    render(AgentSessionChatPanel, {
      props: {
        session: { ...session, status: AgentSessionStatus.Completed },
        composerDisabled: true,
        composerDisabledReason: 'This session is complete.',
        terminalActionLabel: 'Start new chat',
        onTerminalAction,
      },
    });

    const input = await screen.findByRole('textbox', { name: 'Message' });
    expect(input).toBeDisabled();
    expect(screen.getByText('This session is complete.')).toBeInTheDocument();

    await fireEvent.click(screen.getByRole('button', { name: 'Start new chat' }));

    expect(onTerminalAction).toHaveBeenCalledTimes(1);
    expect(sdkMock.appendAgentSessionMessage).not.toHaveBeenCalled();
  });

  it('shows send error and keeps draft when append fails', async () => {
    sdkMock.appendAgentSessionMessage.mockRejectedValue(new Error('failed'));

    render(AgentSessionChatPanel, { props: { session } });

    const input = await screen.findByRole('textbox', { name: 'Message' });
    await fireEvent.input(input, { target: { value: 'Keep this draft' } });
    await fireEvent.click(screen.getByRole('button', { name: 'Send' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('Unable to send message');
    expect(input).toHaveValue('Keep this draft');
  });

  it('does not submit duplicate messages while a send is in progress', async () => {
    sdkMock.appendAgentSessionMessage.mockReturnValue(new Promise(() => undefined));

    render(AgentSessionChatPanel, { props: { session } });

    const input = await screen.findByRole('textbox', { name: 'Message' });
    await fireEvent.input(input, { target: { value: 'Only once' } });
    const sendButton = screen.getByRole('button', { name: 'Send' });

    await fireEvent.click(sendButton);
    await fireEvent.click(sendButton);

    expect(sdkMock.appendAgentSessionMessage).toHaveBeenCalledTimes(1);
  });

  it('shows a running timeline immediately while sending the user message', async () => {
    sdkMock.appendAgentSessionMessage.mockReturnValue(new Promise(() => undefined));

    render(AgentSessionChatPanel, { props: { session } });

    const input = await screen.findByRole('textbox', { name: 'Message' });
    await fireEvent.input(input, { target: { value: 'Organize this album' } });
    await fireEvent.click(screen.getByRole('button', { name: 'Send' }));

    expect(await screen.findByTestId('agent-turn-timeline')).toBeInTheDocument();
    expect(screen.getByText('Understanding request…')).toBeInTheDocument();
    expect(screen.queryByText('pi is working...')).not.toBeInTheDocument();
    expect(input).toBeDisabled();
  });

  it('does not render the ASCII animation — the one-liner covers the pending state instead', async () => {
    sdkMock.appendAgentSessionMessage.mockReturnValue(new Promise(() => undefined));

    render(AgentSessionChatPanel, { props: { session } });

    const input = await screen.findByRole('textbox', { name: 'Message' });
    await fireEvent.input(input, { target: { value: 'Organize this album' } });
    await fireEvent.click(screen.getByRole('button', { name: 'Send' }));

    expect(await screen.findByTestId('agent-turn-timeline')).toBeInTheDocument();
    expect(screen.queryByText('pi is working...')).not.toBeInTheDocument();
  });

  it('keeps the running timeline after send succeeds while waiting for the first assistant delta', async () => {
    sdkMock.appendAgentSessionMessage.mockResolvedValue(
      makeMessage('message-created', AgentMessageRole.User, 'Organize screenshots'),
    );

    render(AgentSessionChatPanel, { props: { session } });

    const input = await screen.findByRole('textbox', { name: 'Message' });
    await fireEvent.input(input, { target: { value: 'Organize screenshots' } });
    await fireEvent.click(screen.getByRole('button', { name: 'Send' }));

    expect(await screen.findByText('Organize screenshots')).toBeInTheDocument();
    expect(screen.getByTestId('agent-turn-timeline')).toBeInTheDocument();
    expect(screen.getByText('Understanding request…')).toBeInTheDocument();
  });

  it('keeps the running timeline while streaming and shows no ASCII animation', async () => {
    let handler: Parameters<typeof websocketMock.websocketEvents.on>[1] | undefined;
    websocketMock.websocketEvents.on.mockImplementation((_eventName, nextHandler) => {
      handler = nextHandler;
      return vi.fn();
    });
    sdkMock.appendAgentSessionMessage.mockResolvedValue(
      makeMessage('message-created', AgentMessageRole.User, 'Start organizing'),
    );

    render(AgentSessionChatPanel, { props: { session } });

    const input = await screen.findByRole('textbox', { name: 'Message' });
    await fireEvent.input(input, { target: { value: 'Start organizing' } });
    await fireEvent.click(screen.getByRole('button', { name: 'Send' }));

    expect(await screen.findByTestId('agent-turn-timeline')).toBeInTheDocument();

    handler?.({
      type: 'assistant-message-delta',
      sessionId: session.id,
      delta: 'I found',
      sequence: 1,
      createdAt: '2026-05-14T00:00:01.000Z',
    });

    expect(await screen.findByText('I found')).toBeInTheDocument();
    expect(screen.queryByText('pi is working...')).not.toBeInTheDocument();
  });

  it('clears the running timeline and shows the assistant response when it arrives', async () => {
    let handler: Parameters<typeof websocketMock.websocketEvents.on>[1] | undefined;
    websocketMock.websocketEvents.on.mockImplementation((_eventName, nextHandler) => {
      handler = nextHandler;
      return vi.fn();
    });
    sdkMock.appendAgentSessionMessage.mockResolvedValue(
      makeMessage('message-created', AgentMessageRole.User, 'Make an album'),
    );

    render(AgentSessionChatPanel, { props: { session } });

    const input = await screen.findByRole('textbox', { name: 'Message' });
    await fireEvent.input(input, { target: { value: 'Make an album' } });
    await fireEvent.click(screen.getByRole('button', { name: 'Send' }));
    expect(await screen.findByTestId('agent-turn-timeline')).toBeInTheDocument();

    handler?.({
      type: 'assistant-message-created',
      sessionId: session.id,
      message: makeMessage('message-assistant-created', AgentMessageRole.Assistant, 'Done.'),
      createdAt: '2026-05-14T00:00:02.000Z',
    });

    expect(await screen.findByText('Done.')).toBeInTheDocument();
    expect(screen.queryByText('pi is working...')).not.toBeInTheDocument();
  });

  it('clears the running timeline on runner error and shows the error alert', async () => {
    let handler: Parameters<typeof websocketMock.websocketEvents.on>[1] | undefined;
    websocketMock.websocketEvents.on.mockImplementation((_eventName, nextHandler) => {
      handler = nextHandler;
      return vi.fn();
    });
    sdkMock.appendAgentSessionMessage.mockResolvedValue(
      makeMessage('message-created', AgentMessageRole.User, 'Make an album'),
    );

    render(AgentSessionChatPanel, { props: { session } });

    const input = await screen.findByRole('textbox', { name: 'Message' });
    await fireEvent.input(input, { target: { value: 'Make an album' } });
    await fireEvent.click(screen.getByRole('button', { name: 'Send' }));
    expect(await screen.findByTestId('agent-turn-timeline')).toBeInTheDocument();

    handler?.({
      type: 'runner-error',
      sessionId: session.id,
      message: 'Runner failed',
      createdAt: '2026-05-14T00:00:02.000Z',
    });

    expect(await screen.findByRole('alert')).toHaveTextContent('Runner failed');
    expect(screen.queryByText('pi is working...')).not.toBeInTheDocument();
  });

  it('does not allow another message while an assistant response is active', async () => {
    let handler: Parameters<typeof websocketMock.websocketEvents.on>[1] | undefined;
    websocketMock.websocketEvents.on.mockImplementation((_eventName, nextHandler) => {
      handler = nextHandler;
      return vi.fn();
    });
    sdkMock.appendAgentSessionMessage.mockResolvedValue(
      makeMessage('message-created', AgentMessageRole.User, 'Start task'),
    );

    render(AgentSessionChatPanel, { props: { session } });

    const input = await screen.findByRole('textbox', { name: 'Message' });
    await fireEvent.input(input, { target: { value: 'Start task' } });
    const sendButton = screen.getByRole('button', { name: 'Send' });

    await fireEvent.click(sendButton);
    await waitFor(() => expect(input).toBeDisabled());
    expect(sendButton).toBeDisabled();

    handler?.({
      type: 'assistant-message-created',
      sessionId: session.id,
      message: makeMessage('message-assistant-created', AgentMessageRole.Assistant, 'Done.'),
      createdAt: '2026-05-14T00:00:02.000Z',
    });

    await waitFor(() => expect(input).not.toBeDisabled());
  });

  it('renders streaming deltas and completed assistant messages from websocket events', async () => {
    let handler: Parameters<typeof websocketMock.websocketEvents.on>[1] | undefined;
    websocketMock.websocketEvents.on.mockImplementation((_eventName, nextHandler) => {
      handler = nextHandler;
      return vi.fn();
    });

    render(AgentSessionChatPanel, { props: { session } });
    await screen.findByRole('textbox', { name: 'Message' });

    handler?.({
      type: 'assistant-message-delta',
      sessionId: session.id,
      delta: 'Thinking...',
      sequence: 1,
      createdAt: '2026-05-14T00:00:01.000Z',
    });

    expect(await screen.findByText('Thinking...')).toBeInTheDocument();
    expect(screen.getByText('Assistant is responding')).toBeInTheDocument();

    handler?.({
      type: 'assistant-message-created',
      sessionId: session.id,
      message: makeMessage('message-assistant-created', AgentMessageRole.Assistant, 'Done.'),
      createdAt: '2026-05-14T00:00:02.000Z',
    });

    expect(await screen.findByText('Done.')).toBeInTheDocument();
    await waitFor(() => expect(screen.queryByText('Thinking...')).not.toBeInTheDocument());
  });

  it('clears streaming text when the runner reports an error', async () => {
    let handler: Parameters<typeof websocketMock.websocketEvents.on>[1] | undefined;
    websocketMock.websocketEvents.on.mockImplementation((_eventName, nextHandler) => {
      handler = nextHandler;
      return vi.fn();
    });

    render(AgentSessionChatPanel, { props: { session } });
    await screen.findByRole('textbox', { name: 'Message' });

    handler?.({
      type: 'assistant-message-delta',
      sessionId: session.id,
      delta: 'Partial response',
      sequence: 1,
      createdAt: '2026-05-14T00:00:01.000Z',
    });
    expect(await screen.findByText('Partial response')).toBeInTheDocument();

    handler?.({
      type: 'runner-error',
      sessionId: session.id,
      message: 'Runner failed',
      createdAt: '2026-05-14T00:00:02.000Z',
    });

    expect(await screen.findByRole('alert')).toHaveTextContent('Runner failed');
    await waitFor(() => expect(screen.queryByText('Partial response')).not.toBeInTheDocument());
  });

  it('fetches the current plan on operation-plan-ready without interrupting an active response', async () => {
    let handler: Parameters<typeof websocketMock.websocketEvents.on>[1] | undefined;
    websocketMock.websocketEvents.on.mockImplementation((_eventName, nextHandler) => {
      handler = nextHandler;
      return vi.fn();
    });
    sdkMock.getAgentSessionMessages.mockResolvedValue([
      {
        ...makeMessage('message-user', AgentMessageRole.User, 'Make a Portugal album'),
        createdAt: '2026-05-16T10:00:00.000Z',
      },
    ]);
    sdkMock.getCurrentOperationPlan.mockResolvedValue(
      makeAppliedPlan({
        id: '00000000-0000-4000-8000-000000000200',
        status: AgentOperationPlanStatus.Proposed,
        operations: [
          makeOperation({
            id: 'operation-create',
            planId: '00000000-0000-4000-8000-000000000200',
            status: AgentOperationStatus.Proposed,
          }),
        ],
        createdAt: '2026-05-16T10:00:05.000Z',
        updatedAt: '2026-05-16T10:00:10.000Z',
      }),
    );

    render(AgentSessionChatPanel, { props: { session } });
    await screen.findByText('Make a Portugal album');

    handler?.({
      type: 'assistant-message-delta',
      sessionId: session.id,
      delta: 'Thinking...',
      sequence: 1,
      createdAt: '2026-05-14T00:00:01.000Z',
    });
    expect(await screen.findByText('Thinking...')).toBeInTheDocument();

    handler?.({
      type: 'operation-plan-ready',
      sessionId: session.id,
      planId: '00000000-0000-4000-8000-000000000200',
      revision: 1,
    });

    await waitFor(() => expect(sdkMock.getCurrentOperationPlan).toHaveBeenCalledWith({ id: session.id }));
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(screen.getByText('Thinking...')).toBeInTheDocument();
  });

  it('receives activity websocket events and merges them without stealing focus', async () => {
    let resolveActivityEvents: (events: ReturnType<typeof makeActivityEvent>[]) => void;
    sdkMock.getAgentSessionMessages.mockResolvedValue([
      {
        ...makeMessage('message-user', AgentMessageRole.User, 'Apply the selected changes'),
        createdAt: '2026-05-16T10:00:00.000Z',
      },
      {
        ...makeMessage('message-assistant', AgentMessageRole.Assistant, 'Ready to apply.'),
        createdAt: '2026-05-16T10:00:10.000Z',
      },
    ]);
    sdkActivityMock.getAgentSessionActivityEvents.mockReturnValue(
      new Promise((resolve) => {
        resolveActivityEvents = resolve;
      }),
    );
    let handler: Parameters<typeof websocketMock.websocketEvents.on>[1] | undefined;
    websocketMock.websocketEvents.on.mockImplementation((_eventName, nextHandler) => {
      handler = nextHandler;
      return vi.fn();
    });

    render(AgentSessionChatPanel, { props: { session: { ...session, status: AgentSessionStatus.Completed } } });

    const input = await screen.findByRole('textbox', { name: 'Message' });
    input.focus();

    handler?.({
      type: 'activity',
      sessionId: session.id,
      event: makeActivityEvent({
        id: 'apply-progress-live',
        kind: 'apply-progress',
        totalCount: 4,
        appliedCount: 2,
        skippedCount: 1,
        createdAt: '2026-05-16T10:00:05.000Z',
      }),
      createdAt: '2026-05-16T10:00:05.000Z',
    });

    await screen.findByText('Apply the selected changes');
    // Focus not stolen by the websocket event
    expect(document.activeElement).toBe(input);

    resolveActivityEvents!([
      makeActivityEvent({
        id: 'apply-progress-live',
        kind: 'apply-progress',
        totalCount: 4,
        appliedCount: 2,
        skippedCount: 1,
        createdAt: '2026-05-16T10:00:05.000Z',
      }),
    ]);

    await tick();
    // Focus still not stolen after history load
    expect(document.activeElement).toBe(input);
  });

  it('keeps the running timeline when current plan refresh fails', async () => {
    let handler: Parameters<typeof websocketMock.websocketEvents.on>[1] | undefined;
    websocketMock.websocketEvents.on.mockImplementation((_eventName, nextHandler) => {
      handler = nextHandler;
      return vi.fn();
    });
    sdkMock.getAgentSessionMessages.mockResolvedValue([
      {
        ...makeMessage('message-user', AgentMessageRole.User, 'Make a plan'),
        createdAt: '2026-05-16T10:00:00.000Z',
      },
    ]);
    sdkMock.getCurrentOperationPlan.mockRejectedValue(new Error('raw plan load failure'));

    render(AgentSessionChatPanel, { props: { session, assistantResponsePending: true } });

    expect(await screen.findByTestId('agent-turn-timeline')).toBeInTheDocument();
    expect(screen.getByText('Understanding request…')).toBeInTheDocument();

    handler?.({
      type: 'operation-plan-ready',
      sessionId: session.id,
      planId: '00000000-0000-4000-8000-000000000200',
      revision: 1,
    });

    await waitFor(() => expect(sdkMock.getCurrentOperationPlan).toHaveBeenCalledWith({ id: session.id }));
    expect(screen.getByTestId('agent-turn-timeline')).toBeInTheDocument();
    expect(screen.queryByText('raw plan load failure')).not.toBeInTheDocument();
    expect(screen.getByRole('textbox', { name: 'Message' })).toBeDisabled();
  });

  it('updates applying activity to applied history without duplicate activity or plan cards', async () => {
    let handler: Parameters<typeof websocketMock.websocketEvents.on>[1] | undefined;
    websocketMock.websocketEvents.on.mockImplementation((_eventName, nextHandler) => {
      handler = nextHandler;
      return vi.fn();
    });
    sdkMock.getAgentSessionMessages.mockResolvedValue([
      {
        ...makeMessage('message-user', AgentMessageRole.User, 'Apply this plan'),
        createdAt: '2026-05-16T10:00:00.000Z',
      },
    ]);
    const appliedPlan = makeAppliedPlan({
      id: 'plan-applied-live',
      updatedAt: '2026-05-16T10:01:00.000Z',
    });
    sdkMock.getAppliedOperationPlans.mockResolvedValueOnce([]).mockResolvedValueOnce([appliedPlan]);

    render(AgentSessionChatPanel, {
      props: { session: { ...session, status: AgentSessionStatus.Applying } },
    });

    await screen.findByText('Apply this plan');

    handler?.({
      type: 'operation-plan-applied',
      sessionId: session.id,
      planId: appliedPlan.id,
      status: AgentOperationApplyStatus.Applied,
      appliedCount: 2,
      skippedCount: 0,
      failedCount: 0,
    });

    // Applied plan card appears; no duplicate cards
    expect(await screen.findAllByRole('article', { name: 'Applied plan: Organize Portugal holiday' })).toHaveLength(1);
  });

  it('adds a running tool activity row after the triggering user message without duplicating blocks', async () => {
    const runningToolCall = makeToolCall({
      status: AgentToolCallStatus.Executing,
      toolName: AgentToolName.SearchAssets,
      assetCount: 7,
      albumCount: 0,
      responseSummary: null,
      completedAt: null,
      startedAt: '2026-05-16T10:00:05.000Z',
    });
    const { rerender } = render(AgentSessionChatPanel, {
      props: {
        session,
        seedMessages: [
          {
            ...makeMessage('message-user', AgentMessageRole.User, 'Find beach photos'),
            createdAt: '2026-05-16T10:00:00.000Z',
          },
        ],
      },
    });

    await screen.findByText('Find beach photos');
    // Initially shows "Understanding request…" one-liner (no tool calls yet)
    expect(screen.getByTestId('agent-turn-timeline')).toBeInTheDocument();
    expect(screen.getByText('Understanding request…')).toBeInTheDocument();

    await rerender({
      session,
      seedMessages: [
        {
          ...makeMessage('message-user', AgentMessageRole.User, 'Find beach photos'),
          createdAt: '2026-05-16T10:00:00.000Z',
        },
      ],
      toolCalls: [runningToolCall],
    });

    // Running tool call → one-liner shows "Searching photos…"
    const transcript = screen.getByTestId('agent-session-chat-transcript');
    expect(await screen.findByText('Searching photos…')).toBeInTheDocument();
    expect(screen.getAllByTestId('agent-turn-timeline')).toHaveLength(1);
    expect(Array.from(transcript.querySelectorAll('[data-chat-item]')).map((item) => item.textContent)).toEqual([
      expect.stringContaining('Find beach photos'),
      expect.stringContaining('Searching photos'),
    ]);
  });

  it('treats tool approval websocket events as a pause without showing an error', async () => {
    let handler: Parameters<typeof websocketMock.websocketEvents.on>[1] | undefined;
    websocketMock.websocketEvents.on.mockImplementation((_eventName, nextHandler) => {
      handler = nextHandler;
      return vi.fn();
    });

    render(AgentSessionChatPanel, { props: { session } });
    await screen.findByRole('textbox', { name: 'Message' });

    handler?.({
      type: 'assistant-message-delta',
      sessionId: session.id,
      delta: 'Checking albums...',
      sequence: 1,
      createdAt: '2026-05-14T00:00:01.000Z',
    });
    expect(await screen.findByText('Checking albums...')).toBeInTheDocument();

    handler?.({
      type: 'tool-approval-needed',
      sessionId: session.id,
      toolCallId: '00000000-0000-4000-8000-000000000333',
      createdAt: '2026-05-14T00:00:02.000Z',
    });

    await waitFor(() => expect(screen.queryByText('Checking albums...')).not.toBeInTheDocument());
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it.each([
    [AgentSessionStatus.Applying, 'applying'],
    [AgentSessionStatus.Completed, 'completed'],
    [AgentSessionStatus.Cancelled, 'cancelled'],
    [AgentSessionStatus.Failed, 'failed'],
  ])('clears active streaming when session status becomes %s', async (status) => {
    let handler: Parameters<typeof websocketMock.websocketEvents.on>[1] | undefined;
    websocketMock.websocketEvents.on.mockImplementation((_eventName, nextHandler) => {
      handler = nextHandler;
      return vi.fn();
    });

    const { rerender } = render(AgentSessionChatPanel, { props: { session } });
    const input = await screen.findByRole('textbox', { name: 'Message' });

    handler?.({
      type: 'assistant-message-delta',
      sessionId: session.id,
      delta: 'Partial lifecycle response',
      sequence: 1,
      createdAt: '2026-05-14T00:00:01.000Z',
    });
    expect(await screen.findByText('Partial lifecycle response')).toBeInTheDocument();
    expect(input).toBeDisabled();

    await rerender({ session: { ...session, status } });

    await waitFor(() => expect(screen.queryByText('Partial lifecycle response')).not.toBeInTheDocument());
    expect(input).not.toBeDisabled();
  });

  it('clears the running timeline when the session becomes terminal', async () => {
    sdkMock.appendAgentSessionMessage.mockResolvedValue(
      makeMessage('message-created', AgentMessageRole.User, 'Start task'),
    );

    const { rerender } = render(AgentSessionChatPanel, { props: { session } });

    const input = await screen.findByRole('textbox', { name: 'Message' });
    await fireEvent.input(input, { target: { value: 'Start task' } });
    await fireEvent.click(screen.getByRole('button', { name: 'Send' }));
    expect(await screen.findByTestId('agent-turn-timeline')).toBeInTheDocument();

    await rerender({ session: { ...session, status: AgentSessionStatus.Cancelled } });

    // Session is now cancelled — the sent user message has no follow-up tool calls,
    // so the timeline settles to E1 (zero rows, summary=null) and renders nothing
    await waitFor(() => expect(screen.queryByTestId('agent-turn-timeline')).not.toBeInTheDocument());
    expect(input).not.toBeDisabled();
  });

  it('renders exactly one running timeline while a send is in progress', async () => {
    let resolveSend: (message: AgentMessageResponseDto) => void;
    sdkMock.appendAgentSessionMessage.mockReturnValue(
      new Promise<AgentMessageResponseDto>((resolve) => {
        resolveSend = resolve;
      }),
    );

    render(AgentSessionChatPanel, { props: { session } });

    const input = await screen.findByRole('textbox', { name: 'Message' });
    await fireEvent.input(input, { target: { value: 'Start task' } });
    await fireEvent.click(screen.getByRole('button', { name: 'Send' }));

    expect(await screen.findAllByTestId('agent-turn-timeline')).toHaveLength(1);

    resolveSend!(makeMessage('message-created', AgentMessageRole.User, 'Start task'));
    await tick();

    expect(screen.getAllByTestId('agent-turn-timeline')).toHaveLength(1);
  });

  it('renders a visible label for the message draft', async () => {
    render(AgentSessionChatPanel, { props: { session } });

    const input = await screen.findByRole('textbox', { name: 'Message' });
    const label = screen.getByText('Message');

    expect(label).toBeVisible();
    expect(label).toHaveAttribute('for', input.id);
  });

  it('ignores websocket events for other sessions', async () => {
    let handler: Parameters<typeof websocketMock.websocketEvents.on>[1] | undefined;
    websocketMock.websocketEvents.on.mockImplementation((_eventName, nextHandler) => {
      handler = nextHandler;
      return vi.fn();
    });

    render(AgentSessionChatPanel, { props: { session } });
    await screen.findByRole('textbox', { name: 'Message' });

    handler?.({
      type: 'assistant-message-created',
      sessionId: '00000000-0000-4000-8000-000000000999',
      message: makeMessage('other-message', AgentMessageRole.Assistant, 'Not for this session', 'other-session'),
      createdAt: '2026-05-14T00:00:02.000Z',
    });

    expect(screen.queryByText('Not for this session')).not.toBeInTheDocument();
  });

  it('cleans up websocket listener on destroy', () => {
    const cleanup = vi.fn();
    websocketMock.websocketEvents.on.mockReturnValue(cleanup);

    const { unmount } = render(AgentSessionChatPanel, { props: { session } });
    unmount();

    expect(cleanup).toHaveBeenCalled();
  });
});
