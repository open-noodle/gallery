import {
  AgentApprovalMode,
  AgentMessageRole,
  AgentMessageTextBlockType,
  AgentPermissionPreset,
  AgentProviderType,
  Kind as AgentSessionActivityEventKind,
  AgentSessionActivityEventSource,
  AgentSessionActivityEventStatus,
  AgentSessionStatus,
  AgentToolCallStatus,
  AgentToolDataClass,
  AgentToolName,
  type AgentMessageResponseDto,
  type AgentSessionResponseDto,
  type AgentToolCallResponseDto,
} from '@immich/sdk';
import type { AgentActivityEvent } from './agent-session-activity-turns-ui';
import { buildAgentTurnTimelines, formatAgentTimelineDuration } from './agent-turn-timeline-ui';

const sessionId = '00000000-0000-4000-8000-000000000100';

const makeSession = (status: AgentSessionStatus = AgentSessionStatus.Running): AgentSessionResponseDto => ({
  id: sessionId,
  status,
  providerCredentialId: '00000000-0000-4000-8000-000000000001',
  credentialSnapshot: {
    id: '00000000-0000-4000-8000-000000000001',
    providerType: AgentProviderType.Openai,
    label: 'OpenAI personal',
    baseUrl: null,
    models: ['gpt-5.1'],
    defaultModel: 'gpt-5.1',
  },
  modelSnapshot: {
    model: 'gpt-5.1',
    providerCredentialId: '00000000-0000-4000-8000-000000000001',
  },
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
  runnerCapabilitiesSnapshot: {
    protocolVersion: '2026-05-14',
    streaming: true,
    tools: ['echo'],
    models: [],
  },
  runnerEndpoint: 'http://agent-runner:4477',
  runnerSessionId: 'stub-session',
  createdAt: '2026-05-18T10:00:00.000Z',
  updatedAt: '2026-05-18T10:00:10.000Z',
  endedAt: null,
});

const makeUserMessage = (id: string, createdAt: string): AgentMessageResponseDto => ({
  id,
  sessionId,
  role: AgentMessageRole.User,
  providerMessageId: null,
  toolCallId: null,
  content: { blocks: [{ type: AgentMessageTextBlockType.Text, text: 'Do something' }] },
  createdAt,
});

const makeAssistantMessage = (id: string, createdAt: string): AgentMessageResponseDto => ({
  id,
  sessionId,
  role: AgentMessageRole.Assistant,
  providerMessageId: null,
  toolCallId: null,
  content: { blocks: [{ type: AgentMessageTextBlockType.Text, text: 'Done' }] },
  createdAt,
});

const makeToolCall = (
  overrides: Partial<AgentToolCallResponseDto> & { id: string; startedAt: string },
): AgentToolCallResponseDto => ({
  sessionId,
  toolName: AgentToolName.SearchAssets,
  status: AgentToolCallStatus.Completed,
  approvalDecision: null,
  requestSummary: 'Request summary',
  responseSummary: 'Response summary',
  dataClass: AgentToolDataClass.Metadata,
  assetCount: 0,
  albumCount: 0,
  completedAt: null,
  error: null,
  ...overrides,
});

const makeActivityEvent = (
  overrides: Partial<Omit<AgentActivityEvent, 'kind'>> & { kind?: AgentActivityEvent['kind'] } = {},
): AgentActivityEvent => ({
  id: overrides.id ?? 'event-1',
  sessionId,
  kind: overrides.kind ?? AgentSessionActivityEventKind.StartProcessing,
  status: overrides.status ?? AgentSessionActivityEventStatus.Running,
  summary: overrides.summary ?? null,
  source: overrides.source ?? AgentSessionActivityEventSource.Server,
  counts: overrides.counts ?? null,
  createdAt: overrides.createdAt ?? '2026-05-18T10:00:01.000Z',
});

const build = (
  session: AgentSessionResponseDto,
  messages: AgentMessageResponseDto[],
  toolCalls: AgentToolCallResponseDto[] = [],
  activityEvents: AgentActivityEvent[] = [],
) => buildAgentTurnTimelines({ session, messages, toolCalls, activityEvents });

describe('buildAgentTurnTimelines', () => {
  it('E1 zero tool calls — settled turn has null summary and empty rows', () => {
    const timelines = build(makeSession(AgentSessionStatus.Completed), [
      makeUserMessage('user-1', '2026-05-18T10:00:00.000Z'),
    ]);

    expect(timelines).toHaveLength(1);
    expect(timelines[0].summary).toBeNull();
    expect(timelines[0].rows).toEqual([]);
    expect(timelines[0].oneLiner).toBeNull();
  });

  it('E2 running, no tool call yet — oneLiner understanding key', () => {
    const timelines = build(makeSession(AgentSessionStatus.Running), [
      makeUserMessage('user-1', '2026-05-18T10:00:00.000Z'),
    ]);

    expect(timelines).toHaveLength(1);
    expect(timelines[0].state).toBe('running');
    expect(timelines[0].oneLiner).toEqual({ kind: 'key', key: 'assistant_timeline_understanding' });
  });

  it('E3 running, in-flight known tool — oneLiner verb key', () => {
    const timelines = build(
      makeSession(AgentSessionStatus.Running),
      [makeUserMessage('user-1', '2026-05-18T10:00:00.000Z')],
      [
        makeToolCall({
          id: 'tc-1',
          toolName: AgentToolName.SearchAssets,
          status: AgentToolCallStatus.Executing,
          startedAt: '2026-05-18T10:00:05.000Z',
        }),
      ],
    );

    expect(timelines[0].oneLiner).toEqual({ kind: 'key', key: 'assistant_timeline_verb_searching' });
  });

  it('E3b running, in-flight unknown tool — oneLiner raw toolName', () => {
    const timelines = build(
      makeSession(AgentSessionStatus.Running),
      [makeUserMessage('user-1', '2026-05-18T10:00:00.000Z')],
      [
        makeToolCall({
          id: 'tc-1',
          toolName: 'someNewTool' as AgentToolName,
          status: AgentToolCallStatus.Executing,
          startedAt: '2026-05-18T10:00:05.000Z',
        }),
      ],
    );

    expect(timelines[0].oneLiner).toEqual({ kind: 'raw', toolName: 'someNewTool' });
  });

  it('E3c running, between calls — oneLiner thinking key', () => {
    const timelines = build(
      makeSession(AgentSessionStatus.Running),
      [makeUserMessage('user-1', '2026-05-18T10:00:00.000Z')],
      [
        makeToolCall({
          id: 'tc-1',
          toolName: AgentToolName.SearchAssets,
          status: AgentToolCallStatus.Completed,
          startedAt: '2026-05-18T10:00:05.000Z',
          completedAt: '2026-05-18T10:00:07.000Z',
        }),
      ],
    );

    expect(timelines[0].oneLiner).toEqual({ kind: 'key', key: 'assistant_timeline_thinking' });
  });

  it('mapping: completed — row state completed, durationMs computed', () => {
    const timelines = build(
      makeSession(AgentSessionStatus.Completed),
      [makeUserMessage('user-1', '2026-05-18T10:00:00.000Z')],
      [
        makeToolCall({
          id: 'tc-1',
          status: AgentToolCallStatus.Completed,
          startedAt: '2026-05-18T10:00:05.000Z',
          completedAt: '2026-05-18T10:00:07.000Z',
        }),
      ],
    );

    expect(timelines[0].rows[0].state).toBe('completed');
    expect(timelines[0].rows[0].durationMs).toBe(2000);
  });

  it('mapping: failed + E7 — row failed, detail.error, summary.failedCount 1', () => {
    const timelines = build(
      makeSession(AgentSessionStatus.Completed),
      [makeUserMessage('user-1', '2026-05-18T10:00:00.000Z')],
      [
        makeToolCall({
          id: 'tc-1',
          status: AgentToolCallStatus.Failed,
          startedAt: '2026-05-18T10:00:05.000Z',
          completedAt: '2026-05-18T10:00:07.000Z',
          error: 'boom',
        }),
      ],
    );

    expect(timelines[0].rows[0].state).toBe('failed');
    expect(timelines[0].rows[0].detail.error).toBe('boom');
    expect(timelines[0].summary?.failedCount).toBe(1);
  });

  it('mapping: denied + E6 — row denied, summary.failedCount 0', () => {
    const timelines = build(
      makeSession(AgentSessionStatus.Completed),
      [makeUserMessage('user-1', '2026-05-18T10:00:00.000Z')],
      [
        makeToolCall({
          id: 'tc-1',
          status: AgentToolCallStatus.Denied,
          startedAt: '2026-05-18T10:00:05.000Z',
          completedAt: '2026-05-18T10:00:07.000Z',
        }),
      ],
    );

    expect(timelines[0].rows[0].state).toBe('denied');
    expect(timelines[0].summary?.failedCount).toBe(0);
  });

  it('mapping: in-flight — executing call in running last turn is in-flight', () => {
    const timelines = build(
      makeSession(AgentSessionStatus.Running),
      [makeUserMessage('user-1', '2026-05-18T10:00:00.000Z')],
      [
        makeToolCall({
          id: 'tc-1',
          status: AgentToolCallStatus.Executing,
          startedAt: '2026-05-18T10:00:05.000Z',
        }),
      ],
    );

    expect(timelines[0].rows[0].state).toBe('in-flight');
  });

  it('E4/E5 cancelled — executing call + Cancelled session → cancelled row, summary.cancelled true, settled', () => {
    const timelines = build(
      makeSession(AgentSessionStatus.Cancelled),
      [makeUserMessage('user-1', '2026-05-18T10:00:00.000Z')],
      [
        makeToolCall({
          id: 'tc-1',
          status: AgentToolCallStatus.Executing,
          startedAt: '2026-05-18T10:00:05.000Z',
        }),
      ],
    );

    expect(timelines[0].rows[0].state).toBe('cancelled');
    expect(timelines[0].summary?.cancelled).toBe(true);
    expect(timelines[0].state).toBe('settled');
  });

  // AgentSessionStatus.Interrupted exists in the SDK (verified).
  it('E5b interrupted — executing call + Interrupted session → same as E4', () => {
    const timelines = build(
      makeSession(AgentSessionStatus.Interrupted),
      [makeUserMessage('user-1', '2026-05-18T10:00:00.000Z')],
      [
        makeToolCall({
          id: 'tc-1',
          status: AgentToolCallStatus.Executing,
          startedAt: '2026-05-18T10:00:05.000Z',
        }),
      ],
    );

    expect(timelines[0].rows[0].state).toBe('cancelled');
    expect(timelines[0].summary?.cancelled).toBe(true);
    expect(timelines[0].state).toBe('settled');
  });

  it('E8 null completedAt — second row durationMs null; summary.durationMs uses first call span', () => {
    const timelines = build(
      makeSession(AgentSessionStatus.Completed),
      [makeUserMessage('user-1', '2026-05-18T10:00:00.000Z')],
      [
        makeToolCall({
          id: 'tc-1',
          status: AgentToolCallStatus.Completed,
          startedAt: '2026-05-18T10:00:05.000Z',
          completedAt: '2026-05-18T10:00:07.000Z',
        }),
        makeToolCall({
          id: 'tc-2',
          status: AgentToolCallStatus.Completed,
          startedAt: '2026-05-18T10:00:08.000Z',
          completedAt: null,
        }),
      ],
    );

    expect(timelines[0].rows[1].durationMs).toBeNull();
    // summary.durationMs = last non-null completedAt (tc-1) - first startedAt (tc-1)
    expect(timelines[0].summary?.durationMs).toBe(2000);
  });

  it('E9-adjacent: multi-turn split — two timelines, rows grouped correctly; earlier turn settled even while running', () => {
    const timelines = build(
      makeSession(AgentSessionStatus.Running),
      [
        makeUserMessage('user-a', '2026-05-18T10:00:00.000Z'),
        makeAssistantMessage('assistant-a', '2026-05-18T10:00:20.000Z'),
        makeUserMessage('user-b', '2026-05-18T10:01:00.000Z'),
      ],
      [
        makeToolCall({
          id: 'tc-a',
          status: AgentToolCallStatus.Completed,
          startedAt: '2026-05-18T10:00:05.000Z',
          completedAt: '2026-05-18T10:00:10.000Z',
        }),
        makeToolCall({
          id: 'tc-b',
          status: AgentToolCallStatus.Executing,
          startedAt: '2026-05-18T10:01:05.000Z',
        }),
      ],
    );

    expect(timelines).toHaveLength(2);
    expect(timelines[0].anchorMessageId).toBe('user-a');
    expect(timelines[1].anchorMessageId).toBe('user-b');
    expect(timelines[0].rows.map((r) => r.id)).toEqual(['tc-a']);
    expect(timelines[1].rows.map((r) => r.id)).toEqual(['tc-b']);
    // Earlier turn is settled even though session is Running
    expect(timelines[0].state).toBe('settled');
    expect(timelines[1].state).toBe('running');
  });

  it('E10 long summaries are truncated at 500 chars via redaction pipeline', () => {
    const longText = 'x'.repeat(600);
    const truncated = `${'x'.repeat(500)} [truncated]`;
    const timelines = build(
      makeSession(AgentSessionStatus.Completed),
      [makeUserMessage('user-1', '2026-05-18T10:00:00.000Z')],
      [
        makeToolCall({
          id: 'tc-1',
          status: AgentToolCallStatus.Completed,
          startedAt: '2026-05-18T10:00:05.000Z',
          completedAt: '2026-05-18T10:00:07.000Z',
          responseSummary: longText,
        }),
      ],
    );

    expect(timelines[0].rows[0].summaryText).toBe(truncated);
    expect(timelines[0].rows[0].detail.responseSummary).toBe(truncated);
  });

  it('E11 no router event — routerAnnotation null', () => {
    const timelines = build(
      makeSession(AgentSessionStatus.Completed),
      [makeUserMessage('user-1', '2026-05-18T10:00:00.000Z')],
      [],
      [],
    );

    expect(timelines[0].routerAnnotation).toBeNull();
  });

  it('router annotation parse — last strict_router_decision wins', () => {
    const timelines = build(
      makeSession(AgentSessionStatus.Completed),
      [makeUserMessage('user-1', '2026-05-18T10:00:00.000Z')],
      [],
      [
        makeActivityEvent({
          id: 'event-router-1',
          kind: AgentSessionActivityEventKind.StrictRouterDecision,
          status: AgentSessionActivityEventStatus.Completed,
          summary: 'matched=false workflow=other_workflow via=llm',
          createdAt: '2026-05-18T10:00:05.000Z',
        }),
        makeActivityEvent({
          id: 'event-router-2',
          kind: AgentSessionActivityEventKind.StrictRouterDecision,
          status: AgentSessionActivityEventStatus.Completed,
          summary: 'matched=true workflow=create_recent_trip_album via=regex',
          createdAt: '2026-05-18T10:00:10.000Z',
        }),
      ],
    );

    expect(timelines[0].routerAnnotation).toEqual({
      matched: true,
      workflow: 'create_recent_trip_album',
      via: 'regex',
    });
  });

  it('E12 sort — rows sorted by startedAt then id', () => {
    const timelines = build(
      makeSession(AgentSessionStatus.Completed),
      [makeUserMessage('user-1', '2026-05-18T10:00:00.000Z')],
      [
        makeToolCall({
          id: 'tc-later-id',
          status: AgentToolCallStatus.Completed,
          startedAt: '2026-05-18T10:00:08.000Z',
          completedAt: '2026-05-18T10:00:09.000Z',
        }),
        makeToolCall({
          id: 'tc-earlier-id',
          status: AgentToolCallStatus.Completed,
          startedAt: '2026-05-18T10:00:05.000Z',
          completedAt: '2026-05-18T10:00:07.000Z',
        }),
      ],
    );

    expect(timelines[0].rows.map((r) => r.id)).toEqual(['tc-earlier-id', 'tc-later-id']);
  });

  it('E12 sort tie-break — same startedAt sorted by id ascending', () => {
    const timelines = build(
      makeSession(AgentSessionStatus.Completed),
      [makeUserMessage('user-1', '2026-05-18T10:00:00.000Z')],
      [
        makeToolCall({
          id: 'tc-b',
          status: AgentToolCallStatus.Completed,
          startedAt: '2026-05-18T10:00:05.000Z',
          completedAt: '2026-05-18T10:00:07.000Z',
        }),
        makeToolCall({
          id: 'tc-a',
          status: AgentToolCallStatus.Completed,
          startedAt: '2026-05-18T10:00:05.000Z',
          completedAt: '2026-05-18T10:00:07.000Z',
        }),
      ],
    );

    expect(timelines[0].rows.map((r) => r.id)).toEqual(['tc-a', 'tc-b']);
  });

  it('summary line numbers — 3 calls (2 completed 1 failed), steps/durationMs/failedCount/cancelled', () => {
    const timelines = build(
      makeSession(AgentSessionStatus.Completed),
      [makeUserMessage('user-1', '2026-05-18T10:00:00.000Z')],
      [
        makeToolCall({
          id: 'tc-1',
          status: AgentToolCallStatus.Completed,
          startedAt: '2026-05-18T10:00:05.000Z',
          completedAt: '2026-05-18T10:00:07.000Z',
        }),
        makeToolCall({
          id: 'tc-2',
          status: AgentToolCallStatus.Completed,
          startedAt: '2026-05-18T10:00:07.000Z',
          completedAt: '2026-05-18T10:00:09.000Z',
        }),
        makeToolCall({
          id: 'tc-3',
          status: AgentToolCallStatus.Failed,
          startedAt: '2026-05-18T10:00:09.000Z',
          completedAt: '2026-05-18T10:00:12.000Z',
          error: 'network error',
        }),
      ],
    );

    expect(timelines[0].summary).toEqual({
      steps: 3,
      durationMs: 7000, // 10:00:12 - 10:00:05 = 7000ms
      failedCount: 1,
      cancelled: false,
    });
  });

  it('summaryText prefers responseSummary then requestSummary', () => {
    const timelines = build(
      makeSession(AgentSessionStatus.Completed),
      [makeUserMessage('user-1', '2026-05-18T10:00:00.000Z')],
      [
        makeToolCall({
          id: 'tc-1',
          status: AgentToolCallStatus.Completed,
          startedAt: '2026-05-18T10:00:05.000Z',
          completedAt: '2026-05-18T10:00:07.000Z',
          responseSummary: 'response text',
          requestSummary: 'request text',
        }),
      ],
    );

    expect(timelines[0].rows[0].summaryText).toBe('response text');
  });

  it('summaryText falls back to requestSummary when responseSummary null', () => {
    const timelines = build(
      makeSession(AgentSessionStatus.Completed),
      [makeUserMessage('user-1', '2026-05-18T10:00:00.000Z')],
      [
        makeToolCall({
          id: 'tc-1',
          status: AgentToolCallStatus.Completed,
          startedAt: '2026-05-18T10:00:05.000Z',
          completedAt: '2026-05-18T10:00:07.000Z',
          responseSummary: null,
          requestSummary: 'request text',
        }),
      ],
    );

    expect(timelines[0].rows[0].summaryText).toBe('request text');
  });

  it('redacts Bearer token in requestSummary from summaryText and detail fields', () => {
    const timelines = build(
      makeSession(AgentSessionStatus.Completed),
      [makeUserMessage('user-1', '2026-05-18T10:00:00.000Z')],
      [
        makeToolCall({
          id: 'tc-secret',
          status: AgentToolCallStatus.Completed,
          startedAt: '2026-05-18T10:00:05.000Z',
          completedAt: '2026-05-18T10:00:07.000Z',
          requestSummary: 'Authorization: Bearer abc123token',
          responseSummary: null,
          error: null,
        }),
      ],
    );

    const row = timelines[0].rows[0];
    expect(row.summaryText).toContain('[REDACTED]');
    expect(row.summaryText).not.toContain('abc123token');
    expect(row.detail.requestSummary).toContain('[REDACTED]');
    expect(row.detail.requestSummary).not.toContain('abc123token');
  });

  it('redacts api_key in responseSummary and error from summaryText and detail fields', () => {
    const timelines = build(
      makeSession(AgentSessionStatus.Completed),
      [makeUserMessage('user-1', '2026-05-18T10:00:00.000Z')],
      [
        makeToolCall({
          id: 'tc-secret-2',
          status: AgentToolCallStatus.Failed,
          startedAt: '2026-05-18T10:00:05.000Z',
          completedAt: '2026-05-18T10:00:07.000Z',
          requestSummary: undefined,
          responseSummary: 'api_key=sk-proj-supersecret123',
          error: 'provider key sk-live-456 rejected',
        }),
      ],
    );

    const row = timelines[0].rows[0];
    expect(row.summaryText).toContain('[REDACTED]');
    expect(row.summaryText).not.toContain('sk-proj-supersecret123');
    expect(row.detail.responseSummary).toContain('[REDACTED]');
    expect(row.detail.responseSummary).not.toContain('sk-proj-supersecret123');
    expect(row.detail.error).toContain('[REDACTED]');
    expect(row.detail.error).not.toContain('sk-live-456');
  });

  it('passes clean summaries through unchanged', () => {
    const timelines = build(
      makeSession(AgentSessionStatus.Completed),
      [makeUserMessage('user-1', '2026-05-18T10:00:00.000Z')],
      [
        makeToolCall({
          id: 'tc-clean',
          status: AgentToolCallStatus.Completed,
          startedAt: '2026-05-18T10:00:05.000Z',
          completedAt: '2026-05-18T10:00:07.000Z',
          requestSummary: 'Search for beach photos',
          responseSummary: 'Found 12 beach photos',
          error: null,
        }),
      ],
    );

    const row = timelines[0].rows[0];
    expect(row.summaryText).toBe('Found 12 beach photos');
    expect(row.detail.requestSummary).toBe('Search for beach photos');
    expect(row.detail.responseSummary).toBe('Found 12 beach photos');
  });

  it('pending_approval in running last turn is in-flight', () => {
    const timelines = build(
      makeSession(AgentSessionStatus.WaitingForToolApproval),
      [makeUserMessage('user-1', '2026-05-18T10:00:00.000Z')],
      [
        makeToolCall({
          id: 'tc-1',
          status: AgentToolCallStatus.PendingApproval,
          startedAt: '2026-05-18T10:00:05.000Z',
        }),
      ],
    );

    expect(timelines[0].state).toBe('running');
    expect(timelines[0].rows[0].state).toBe('in-flight');
  });

  it('approved in running last turn is in-flight', () => {
    const timelines = build(
      makeSession(AgentSessionStatus.WaitingForPlanReview),
      [makeUserMessage('user-1', '2026-05-18T10:00:00.000Z')],
      [
        makeToolCall({
          id: 'tc-1',
          status: AgentToolCallStatus.Approved,
          startedAt: '2026-05-18T10:00:05.000Z',
        }),
      ],
    );

    expect(timelines[0].state).toBe('running');
    expect(timelines[0].rows[0].state).toBe('in-flight');
  });

  it('Applying session status is treated as active (in-flight)', () => {
    const timelines = build(
      makeSession(AgentSessionStatus.Applying),
      [makeUserMessage('user-1', '2026-05-18T10:00:00.000Z')],
      [
        makeToolCall({
          id: 'tc-1',
          status: AgentToolCallStatus.Executing,
          startedAt: '2026-05-18T10:00:05.000Z',
        }),
      ],
    );

    expect(timelines[0].state).toBe('running');
    expect(timelines[0].rows[0].state).toBe('in-flight');
  });

  it('detail block contains all fields from the tool call DTO', () => {
    const timelines = build(
      makeSession(AgentSessionStatus.Completed),
      [makeUserMessage('user-1', '2026-05-18T10:00:00.000Z')],
      [
        makeToolCall({
          id: 'tc-1',
          status: AgentToolCallStatus.Completed,
          startedAt: '2026-05-18T10:00:05.000Z',
          completedAt: '2026-05-18T10:00:07.000Z',
          requestSummary: 'req',
          responseSummary: 'resp',
          assetCount: 5,
          albumCount: 2,
          error: null,
        }),
      ],
    );

    const detail = timelines[0].rows[0].detail;
    expect(detail.requestSummary).toBe('req');
    expect(detail.responseSummary).toBe('resp');
    expect(detail.assetCount).toBe(5);
    expect(detail.albumCount).toBe(2);
    expect(detail.error).toBeNull();
    expect(detail.startedAt).toBe('2026-05-18T10:00:05.000Z');
    expect(detail.completedAt).toBe('2026-05-18T10:00:07.000Z');
  });

  it('settles the last turn once the assistant has answered, even while the session stays running', () => {
    const result = buildAgentTurnTimelines({
      session: makeSession(AgentSessionStatus.Running),
      messages: [
        makeUserMessage('user-a', '2026-06-10T10:00:00.000Z'),
        makeAssistantMessage('assistant-a', '2026-06-10T10:00:05.000Z'),
      ],
      toolCalls: [
        makeToolCall({ id: 'tc-a', startedAt: '2026-06-10T10:00:01.000Z', completedAt: '2026-06-10T10:00:02.000Z' }),
      ],
      activityEvents: [],
    });

    expect(result).toHaveLength(1);
    expect(result[0].state).toBe('settled');
    expect(result[0].oneLiner).toBeNull();
    expect(result[0].summary).not.toBeNull();
  });
});

describe('formatAgentTimelineDuration', () => {
  it('formats sub-minute durations with one decimal', () => {
    expect(formatAgentTimelineDuration(2300)).toBe('2.3s');
    expect(formatAgentTimelineDuration(400)).toBe('0.4s');
  });

  it('formats minute durations', () => {
    expect(formatAgentTimelineDuration(65_000)).toBe('1m 5s');
  });

  it('clamps negatives to zero', () => {
    expect(formatAgentTimelineDuration(-50)).toBe('0.0s');
  });
});
