import { AgentMessage, AgentToolCall } from 'src/database';
import {
  AgentApprovalMode,
  AgentMessageRole,
  AgentPermissionPreset,
  AgentProviderType,
  AgentSessionActivityEventKind,
  AgentSessionActivityEventStatus,
  AgentSessionStatus,
  AgentToolApprovalDecision,
  AgentToolCallStatus,
  AgentToolDataClass,
  AgentToolName,
} from 'src/enum';
import { AgentMessageRepository } from 'src/repositories/agent-message.repository';
import { AgentRunnerRepository } from 'src/repositories/agent-runner.repository';
import { AgentSessionRepository } from 'src/repositories/agent-session.repository';
import { AgentToolCallRepository } from 'src/repositories/agent-tool-call.repository';
import { ConfigRepository } from 'src/repositories/config.repository';
import { WebsocketRepository } from 'src/repositories/websocket.repository';
import { AgentRunnerToolTokenService } from 'src/services/agent-runner-tool-token.service';
import { AgentRunnerService } from 'src/services/agent-runner.service';
import { AgentMessageContent } from 'src/types/agent-message.types';
import { AgentRunnerCreateSessionRequest, AgentRunnerStreamEvent } from 'src/types/agent-runner.types';
import { automock } from 'test/utils';

const userId = '00000000-0000-4000-8000-000000000001';

const makeCreateSessionBody = (): Omit<AgentRunnerCreateSessionRequest, 'mcpGateway'> & { userId: string } => ({
  userId,
  gallerySessionId: '00000000-0000-4000-8000-000000000100',
  credential: {
    id: '00000000-0000-4000-8000-000000000001',
    providerType: AgentProviderType.OpenAI,
    label: 'OpenAI personal',
    baseUrl: null,
    models: ['gpt-5.1'],
    defaultModel: 'gpt-5.1',
    secret: 'sk-session-secret',
  },
  model: 'gpt-5.1',
  permissionPreset: AgentPermissionPreset.Careful,
  permissionPlan: {
    read: { metadata: true, previews: false, originals: false },
    providerExposure: {
      metadata: true,
      previews: false,
      originals: false,
      allowOriginalsForExternalProviders: false,
    },
    assetScope: { owned: true, sharedSpaces: false, locked: false },
    writeScope: { createAlbum: true, addAssets: true, updateDetails: true, setCover: true },
    limits: {
      maxAssetsPerToolCall: 200,
      maxAssetsPerSession: 2000,
      maxPreviewsPerToolCall: 0,
      maxOriginalsPerToolCall: 0,
      expiresInMinutes: 120,
    },
  },
  approvalMode: AgentApprovalMode.Strict,
  initialContext: {},
});

const makeAssistantMessage = (overrides: Partial<AgentMessage> = {}): AgentMessage => ({
  id: '00000000-0000-4000-8000-000000000301',
  sessionId: '00000000-0000-4000-8000-000000000100',
  role: AgentMessageRole.Assistant,
  content: { blocks: [{ type: 'text', text: 'Done.' }] },
  providerMessageId: 'provider-message-1',
  toolCallId: null,
  createdAt: new Date('2026-05-14T10:00:01.000Z'),
  ...overrides,
});

const makeToolCall = (overrides: Partial<AgentToolCall> = {}): AgentToolCall => ({
  id: '00000000-0000-4000-8000-000000000333',
  sessionId: '00000000-0000-4000-8000-000000000100',
  toolName: AgentToolName.ProposeAlbumOperations,
  status: AgentToolCallStatus.Completed,
  approvalDecision: AgentToolApprovalDecision.Approved,
  requestSummary: 'Tool call',
  responseSummary: null,
  redactedRequestMetadata: {},
  redactedResponseMetadata: null,
  dataClass: AgentToolDataClass.Metadata,
  assetCount: 0,
  albumCount: 0,
  providerSnapshot: {
    providerCredentialId: '00000000-0000-4000-8000-000000000201',
    providerType: AgentProviderType.OpenAI,
    label: 'OpenAI personal',
    baseUrl: null,
    model: 'gpt-5.1',
  },
  startedAt: new Date('2026-05-14T10:00:00.000Z'),
  completedAt: new Date('2026-05-14T10:00:01.000Z'),
  error: null,
  ...overrides,
});

const streamEvents = (events: AgentRunnerStreamEvent[]): AsyncGenerator<AgentRunnerStreamEvent> =>
  (async function* () {
    await Promise.resolve();
    for (const event of events) {
      yield event;
    }
  })();

const failingStream = (error: Error): AsyncGenerator<AgentRunnerStreamEvent> =>
  (async function* () {
    await Promise.resolve();
    throw error;
    yield undefined as never;
  })();

describe(AgentRunnerService.name, () => {
  let sut: AgentRunnerService;
  let configRepository: ReturnType<typeof automock<ConfigRepository>>;
  let agentRunnerRepository: ReturnType<typeof automock<AgentRunnerRepository>>;
  let messageRepository: ReturnType<typeof automock<AgentMessageRepository>>;
  let sessionRepository: ReturnType<typeof automock<AgentSessionRepository>>;
  let toolCallRepository: ReturnType<typeof automock<AgentToolCallRepository>>;
  let websocketRepository: ReturnType<typeof automock<WebsocketRepository>>;
  let toolTokenService: ReturnType<typeof automock<AgentRunnerToolTokenService>>;
  let activityService: {
    createSystemEvent: ReturnType<typeof vi.fn>;
    normalizeRunnerEvent: ReturnType<typeof vi.fn>;
    closeOpenLifecycleEvents: ReturnType<typeof vi.fn>;
  };

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-05-14T10:00:00.000Z'));
    configRepository = automock(ConfigRepository);
    agentRunnerRepository = automock(AgentRunnerRepository);
    messageRepository = automock(AgentMessageRepository, { args: [{} as never] });
    sessionRepository = automock(AgentSessionRepository, { args: [{} as never] });
    toolCallRepository = automock(AgentToolCallRepository, { args: [{} as never] });
    toolCallRepository.getBySessionId.mockResolvedValue([]);
    websocketRepository = automock(WebsocketRepository, {
      args: [{} as never, { setContext: vi.fn() } as never],
      strict: false,
    });
    toolTokenService = automock(AgentRunnerToolTokenService, { args: [{} as never] });
    activityService = {
      createSystemEvent: vi.fn((_userId, _sessionId, event) => Promise.resolve({ ...event, id: 'activity-event-1' })),
      normalizeRunnerEvent: vi.fn((event) => event),
      closeOpenLifecycleEvents: vi.fn(),
    };
    sut = new AgentRunnerService(
      configRepository,
      agentRunnerRepository,
      messageRepository,
      sessionRepository,
      websocketRepository,
      toolTokenService,
      toolCallRepository,
      activityService,
    );
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('creates a runner session through the configured runner', async () => {
    configRepository.getEnv.mockReturnValue({
      agent: {
        runnerUrl: 'http://agent-runner:4477',
        runnerHealthTimeoutMs: 3000,
        runnerMessageStreamTimeoutMs: 120_000,
        mcpGatewayUrl: 'http://immich-server:2283/api/agent/internal/mcp',
      },
    } as never);
    toolTokenService.create.mockReturnValue('tool-token');
    agentRunnerRepository.createSession.mockResolvedValue({
      runnerSessionId: 'stub-00000000-0000-4000-8000-000000000100',
      capabilities: { protocolVersion: '2026-05-14', streaming: true, tools: ['mcp:gallery'], models: [] },
    });

    await expect(sut.createSession(makeCreateSessionBody())).resolves.toEqual({
      runnerEndpoint: 'http://agent-runner:4477',
      runnerSessionId: 'stub-00000000-0000-4000-8000-000000000100',
      runnerCapabilitiesSnapshot: {
        protocolVersion: '2026-05-14',
        streaming: true,
        tools: ['mcp:gallery'],
        models: [],
      },
    });
    expect(agentRunnerRepository.createSession).toHaveBeenCalledWith({
      url: 'http://agent-runner:4477',
      timeoutMs: 3000,
      body: expect.objectContaining({
        gallerySessionId: '00000000-0000-4000-8000-000000000100',
        model: 'gpt-5.1',
        mcpGateway: {
          url: 'http://immich-server:2283/api/agent/internal/mcp/sessions/00000000-0000-4000-8000-000000000100',
          token: 'tool-token',
        },
      }),
    });
    expect(agentRunnerRepository.createSession.mock.calls[0][0].body).not.toHaveProperty('userId');
    expect(agentRunnerRepository.createSession.mock.calls[0][0].body).not.toHaveProperty('toolGateway');
  });

  it('passes configured MCP gateway session URL and short-lived token to the runner without returning the token', async () => {
    configRepository.getEnv.mockReturnValue({
      agent: {
        runnerUrl: 'http://agent-runner:4477',
        runnerHealthTimeoutMs: 3000,
        runnerMessageStreamTimeoutMs: 120_000,
        mcpGatewayUrl: 'http://immich-server:2283/api/agent/internal/mcp',
      },
    } as never);
    const body = makeCreateSessionBody();
    body.permissionPlan.limits.expiresInMinutes = 45;
    toolTokenService.create.mockReturnValue('tool-token');
    agentRunnerRepository.createSession.mockResolvedValue({
      runnerSessionId: 'stub-00000000-0000-4000-8000-000000000100',
      capabilities: { protocolVersion: '2026-05-14', streaming: true, tools: ['mcp:gallery'], models: [] },
    });

    await expect(sut.createSession(body)).resolves.toEqual({
      runnerEndpoint: 'http://agent-runner:4477',
      runnerSessionId: 'stub-00000000-0000-4000-8000-000000000100',
      runnerCapabilitiesSnapshot: {
        protocolVersion: '2026-05-14',
        streaming: true,
        tools: ['mcp:gallery'],
        models: [],
      },
    });

    expect(toolTokenService.create).toHaveBeenCalledWith({
      sessionId: '00000000-0000-4000-8000-000000000100',
      userId,
      expiresAt: new Date('2026-05-14T10:45:00.000Z'),
    });
    expect(agentRunnerRepository.createSession).toHaveBeenCalledWith({
      url: 'http://agent-runner:4477',
      timeoutMs: 3000,
      body: expect.objectContaining({
        gallerySessionId: '00000000-0000-4000-8000-000000000100',
        mcpGateway: {
          url: 'http://immich-server:2283/api/agent/internal/mcp/sessions/00000000-0000-4000-8000-000000000100',
          token: 'tool-token',
        },
      }),
    });
    expect(agentRunnerRepository.createSession.mock.calls[0][0].body).not.toHaveProperty('userId');
    expect(agentRunnerRepository.createSession.mock.calls[0][0].body).not.toHaveProperty('toolGateway');
  });

  it('builds the MCP session URL without duplicate slashes and encodes the session id', async () => {
    const body = makeCreateSessionBody();
    body.gallerySessionId = 'session/with spaces';
    configRepository.getEnv.mockReturnValue({
      agent: {
        runnerUrl: 'http://agent-runner:4477',
        runnerHealthTimeoutMs: 3000,
        runnerMessageStreamTimeoutMs: 120_000,
        mcpGatewayUrl: 'http://immich-server:2283/api/agent/internal/mcp/',
      },
    } as never);
    toolTokenService.create.mockReturnValue('tool-token');
    agentRunnerRepository.createSession.mockResolvedValue({
      runnerSessionId: 'stub-session-with-spaces',
      capabilities: { protocolVersion: '2026-05-14', streaming: true, tools: ['mcp:gallery'], models: [] },
    });

    await sut.createSession(body);

    expect(agentRunnerRepository.createSession).toHaveBeenCalledWith({
      url: 'http://agent-runner:4477',
      timeoutMs: 3000,
      body: expect.objectContaining({
        gallerySessionId: 'session/with spaces',
        mcpGateway: {
          url: 'http://immich-server:2283/api/agent/internal/mcp/sessions/session%2Fwith%20spaces',
          token: 'tool-token',
        },
      }),
    });
  });

  it('uses the default two-hour MCP gateway token expiry when the permission plan has no explicit expiry', async () => {
    const body = makeCreateSessionBody();
    body.permissionPlan.limits.expiresInMinutes = null;
    configRepository.getEnv.mockReturnValue({
      agent: {
        runnerUrl: 'http://agent-runner:4477',
        runnerHealthTimeoutMs: 3000,
        runnerMessageStreamTimeoutMs: 120_000,
        mcpGatewayUrl: 'http://immich-server:2283/api/agent/internal/mcp',
      },
    } as never);
    toolTokenService.create.mockReturnValue('tool-token');
    agentRunnerRepository.createSession.mockResolvedValue({
      runnerSessionId: 'stub-00000000-0000-4000-8000-000000000100',
      capabilities: { protocolVersion: '2026-05-14', streaming: true, tools: ['mcp:gallery'], models: [] },
    });

    await sut.createSession(body);

    expect(toolTokenService.create).toHaveBeenCalledWith(
      expect.objectContaining({
        expiresAt: new Date('2026-05-14T12:00:00.000Z'),
      }),
    );
  });

  it('rejects runner session creation when the runner is not configured', async () => {
    configRepository.getEnv.mockReturnValue({
      agent: { runnerHealthTimeoutMs: 2000 },
    } as never);

    await expect(sut.createSession(makeCreateSessionBody())).rejects.toThrow('Agent runner is not configured');
    expect(agentRunnerRepository.createSession).not.toHaveBeenCalled();
  });

  it('throws a clear error when the runner is configured without an MCP gateway', async () => {
    configRepository.getEnv.mockReturnValue({
      agent: {
        runnerUrl: 'http://agent-runner:4477',
        mcpGatewayUrl: undefined,
        runnerHealthTimeoutMs: 3000,
        runnerMessageStreamTimeoutMs: 300_000,
      },
    } as never);

    await expect(sut.createSession(makeCreateSessionBody())).rejects.toThrow('Agent MCP gateway is not configured');
    expect(agentRunnerRepository.createSession).not.toHaveBeenCalled();
    expect(toolTokenService.create).not.toHaveBeenCalled();
  });

  it('validates runner session setup with MCP disabled and without legacy gateway fields', async () => {
    configRepository.getEnv.mockReturnValue({
      agent: {
        runnerUrl: 'http://agent-runner:4477',
        runnerMessageStreamTimeoutMs: 120_000,
      },
    } as never);
    agentRunnerRepository.validateSession.mockResolvedValue({
      ok: true,
      capabilities: { protocolVersion: '2026-05-14', streaming: true, tools: [], models: [] },
    });

    await sut.validateSession(makeCreateSessionBody());

    expect(agentRunnerRepository.validateSession).toHaveBeenCalledWith({
      url: 'http://agent-runner:4477',
      timeoutMs: 120_000,
      body: expect.objectContaining({
        gallerySessionId: '00000000-0000-4000-8000-000000000100',
        model: 'gpt-5.1',
        mcpGateway: null,
      }),
    });
    expect(agentRunnerRepository.validateSession.mock.calls[0][0].body).not.toHaveProperty('userId');
    expect(agentRunnerRepository.validateSession.mock.calls[0][0].body).not.toHaveProperty('toolGateway');
    expect(toolTokenService.create).not.toHaveBeenCalled();
  });

  it('cancels a runner session with the stored runner endpoint and configured timeout', async () => {
    configRepository.getEnv.mockReturnValue({
      agent: {
        runnerHealthTimeoutMs: 3000,
      },
    } as never);
    agentRunnerRepository.cancelSession.mockResolvedValue();

    await sut.cancelSession({
      runnerEndpoint: 'http://agent-runner:4477',
      runnerSessionId: 'runner-session-1',
    });

    expect(agentRunnerRepository.cancelSession).toHaveBeenCalledWith({
      url: 'http://agent-runner:4477',
      runnerSessionId: 'runner-session-1',
      timeoutMs: 3000,
    });
  });

  it('skips runner cancellation when the runner session was never created', async () => {
    await sut.cancelSession({
      runnerEndpoint: null,
      runnerSessionId: null,
    });

    expect(agentRunnerRepository.cancelSession).not.toHaveBeenCalled();
  });

  it('streams a user message to the runner, emits deltas, and persists the completed assistant message', async () => {
    const userId = '00000000-0000-4000-8000-000000000001';
    const sessionId = '00000000-0000-4000-8000-000000000100';
    const runnerSessionId = 'runner-session-1';
    const messageId = '00000000-0000-4000-8000-000000000200';
    const content: AgentMessageContent = { blocks: [{ type: 'text', text: 'Organize my photos.' }] };
    const assistantContent: AgentMessageContent = { blocks: [{ type: 'text', text: 'I can help with that.' }] };
    const assistantMessage = makeAssistantMessage({ sessionId, content: assistantContent });

    configRepository.getEnv.mockReturnValue({
      agent: {
        runnerUrl: 'http://agent-runner:4477',
        runnerHealthTimeoutMs: 3000,
        runnerMessageStreamTimeoutMs: 120_000,
      },
    } as never);
    agentRunnerRepository.streamMessage.mockReturnValue(
      streamEvents([
        {
          type: 'assistant-message-delta',
          sessionId,
          runnerSessionId,
          delta: 'I can',
          sequence: 1,
        },
        {
          type: 'assistant-message-completed',
          sessionId,
          runnerSessionId,
          providerMessageId: 'provider-message-1',
          content: assistantContent,
        },
      ]),
    );
    messageRepository.create.mockResolvedValue(assistantMessage);
    sessionRepository.getById.mockResolvedValue({ status: AgentSessionStatus.Running } as never);

    await sut.sendMessage({ userId, sessionId, runnerSessionId, messageId, content });

    expect(agentRunnerRepository.streamMessage).toHaveBeenCalledWith({
      url: 'http://agent-runner:4477',
      runnerSessionId,
      timeoutMs: 120_000,
      body: { gallerySessionId: sessionId, messageId, content },
    });
    expect(websocketRepository.clientSend).toHaveBeenNthCalledWith(1, 'on_agent_session_event', userId, {
      type: 'assistant-message-delta',
      sessionId,
      delta: 'I can',
      sequence: 1,
      createdAt: '2026-05-14T10:00:00.000Z',
    });
    expect(messageRepository.create).toHaveBeenCalledWith({
      sessionId,
      role: AgentMessageRole.Assistant,
      content: assistantContent,
      providerMessageId: 'provider-message-1',
      toolCallId: null,
    });
    expect(websocketRepository.clientSend).toHaveBeenNthCalledWith(2, 'on_agent_session_event', userId, {
      type: 'assistant-message-created',
      sessionId,
      message: {
        id: assistantMessage.id,
        sessionId,
        role: AgentMessageRole.Assistant,
        content: assistantContent,
        providerMessageId: 'provider-message-1',
        toolCallId: null,
        createdAt: new Date('2026-05-14T10:00:01.000Z'),
      },
      createdAt: '2026-05-14T10:00:00.000Z',
    });
  });

  it('persists a workflow-state-update event without surfacing it to the websocket', async () => {
    const userId = '00000000-0000-4000-8000-000000000001';
    const sessionId = '00000000-0000-4000-8000-000000000100';
    const runnerSessionId = 'runner-session-1';
    const messageId = '00000000-0000-4000-8000-000000000200';
    const content: AgentMessageContent = { blocks: [{ type: 'text', text: 'Create an album for my recent trip.' }] };
    const assistantContent: AgentMessageContent = {
      blocks: [{ type: 'text', text: 'Which recent trip should I use?' }],
    };
    const workflowState = { workflowKind: 'create_recent_trip_album', kind: 'selection', continuation: { foo: 'bar' } };

    configRepository.getEnv.mockReturnValue({
      agent: {
        runnerUrl: 'http://agent-runner:4477',
        runnerHealthTimeoutMs: 3000,
        runnerMessageStreamTimeoutMs: 120_000,
      },
    } as never);
    agentRunnerRepository.streamMessage.mockReturnValue(
      streamEvents([
        {
          type: 'workflow-state-update',
          sessionId,
          runnerSessionId,
          workflowState,
        },
        {
          type: 'assistant-message-completed',
          sessionId,
          runnerSessionId,
          providerMessageId: null,
          content: assistantContent,
        },
      ]),
    );
    messageRepository.create.mockResolvedValue(makeAssistantMessage({ sessionId, content: assistantContent }));
    sessionRepository.getById.mockResolvedValue({ status: AgentSessionStatus.Running } as never);

    await sut.sendMessage({ userId, sessionId, runnerSessionId, messageId, content });

    expect(sessionRepository.setWorkflowState).toHaveBeenCalledWith(userId, sessionId, workflowState);
    expect(websocketRepository.clientSend).not.toHaveBeenCalledWith(
      'on_agent_session_event',
      userId,
      expect.objectContaining({ type: 'workflow-state-update' }),
    );
  });

  it('clears persisted workflow state when a workflow-state-update event carries null', async () => {
    const userId = '00000000-0000-4000-8000-000000000001';
    const sessionId = '00000000-0000-4000-8000-000000000100';
    const runnerSessionId = 'runner-session-1';
    const messageId = '00000000-0000-4000-8000-000000000200';
    const content: AgentMessageContent = { blocks: [{ type: 'text', text: 'Use the first one.' }] };
    const assistantContent: AgentMessageContent = {
      blocks: [{ type: 'text', text: 'Review the plan before applying it.' }],
    };

    configRepository.getEnv.mockReturnValue({
      agent: {
        runnerUrl: 'http://agent-runner:4477',
        runnerHealthTimeoutMs: 3000,
        runnerMessageStreamTimeoutMs: 120_000,
      },
    } as never);
    agentRunnerRepository.streamMessage.mockReturnValue(
      streamEvents([
        {
          type: 'workflow-state-update',
          sessionId,
          runnerSessionId,
          workflowState: null,
        },
        {
          type: 'assistant-message-completed',
          sessionId,
          runnerSessionId,
          providerMessageId: null,
          content: assistantContent,
        },
      ]),
    );
    messageRepository.create.mockResolvedValue(makeAssistantMessage({ sessionId, content: assistantContent }));
    sessionRepository.getById.mockResolvedValue({ status: AgentSessionStatus.Running } as never);

    await sut.sendMessage({ userId, sessionId, runnerSessionId, messageId, content });

    expect(sessionRepository.setWorkflowState).toHaveBeenCalledWith(userId, sessionId, null);
  });

  it('includes persisted workflow state in the message runner request', async () => {
    const userId = '00000000-0000-4000-8000-000000000001';
    const sessionId = '00000000-0000-4000-8000-000000000100';
    const runnerSessionId = 'runner-session-1';
    const messageId = '00000000-0000-4000-8000-000000000200';
    const content: AgentMessageContent = { blocks: [{ type: 'text', text: 'Use the first one.' }] };
    const assistantContent: AgentMessageContent = {
      blocks: [{ type: 'text', text: 'Review the plan before applying it.' }],
    };
    const workflowState = { workflowKind: 'create_recent_trip_album', kind: 'selection', continuation: { foo: 'bar' } };

    configRepository.getEnv.mockReturnValue({
      agent: {
        runnerUrl: 'http://agent-runner:4477',
        runnerHealthTimeoutMs: 3000,
        runnerMessageStreamTimeoutMs: 120_000,
      },
    } as never);
    agentRunnerRepository.streamMessage.mockReturnValue(
      streamEvents([
        {
          type: 'assistant-message-completed',
          sessionId,
          runnerSessionId,
          providerMessageId: null,
          content: assistantContent,
        },
      ]),
    );
    messageRepository.create.mockResolvedValue(makeAssistantMessage({ sessionId, content: assistantContent }));
    sessionRepository.getById.mockResolvedValue({ status: AgentSessionStatus.Running, workflowState } as never);

    await sut.sendMessage({ userId, sessionId, runnerSessionId, messageId, content });

    expect(agentRunnerRepository.streamMessage).toHaveBeenCalledWith({
      url: 'http://agent-runner:4477',
      runnerSessionId,
      timeoutMs: 120_000,
      body: { gallerySessionId: sessionId, messageId, content, workflowState },
    });
  });

  it('includes persisted workflow state in the resume runner request', async () => {
    const userId = '00000000-0000-4000-8000-000000000001';
    const sessionId = '00000000-0000-4000-8000-000000000100';
    const runnerSessionId = 'runner-session-1';
    const assistantContent: AgentMessageContent = {
      blocks: [{ type: 'text', text: 'Review the plan before applying it.' }],
    };
    const workflowState = { workflowKind: 'create_recent_trip_album', kind: 'approval', toolCallId: 'tc-1' };

    configRepository.getEnv.mockReturnValue({
      agent: {
        runnerUrl: 'http://agent-runner:4477',
        runnerHealthTimeoutMs: 3000,
        runnerMessageStreamTimeoutMs: 120_000,
      },
    } as never);
    agentRunnerRepository.streamResume.mockReturnValue(
      streamEvents([
        {
          type: 'assistant-message-completed',
          sessionId,
          runnerSessionId,
          providerMessageId: null,
          content: assistantContent,
        },
      ]),
    );
    messageRepository.create.mockResolvedValue(makeAssistantMessage({ sessionId, content: assistantContent }));
    sessionRepository.getById.mockResolvedValue({ status: AgentSessionStatus.Running, workflowState } as never);

    await sut.resumeAfterToolApproval({
      userId,
      sessionId,
      runnerSessionId,
      toolCallId: '00000000-0000-4000-8000-000000000333',
      approvalDecision: 'approved',
      toolResult: { status: 'success', plan: { id: 'plan-1' } },
    });

    expect(agentRunnerRepository.streamResume).toHaveBeenCalledWith({
      url: 'http://agent-runner:4477',
      runnerSessionId,
      timeoutMs: 120_000,
      body: {
        gallerySessionId: sessionId,
        toolCallId: '00000000-0000-4000-8000-000000000333',
        approvalDecision: 'approved',
        toolResult: { status: 'success', plan: { id: 'plan-1' } },
        workflowState,
      },
    });
  });

  it('creates a start-processing activity event before dispatching a user message', async () => {
    const sessionId = '00000000-0000-4000-8000-000000000100';
    const runnerSessionId = 'runner-session-1';
    const messageId = '00000000-0000-4000-8000-000000000200';
    const content: AgentMessageContent = { blocks: [{ type: 'text', text: 'Organize my photos.' }] };
    const assistantContent: AgentMessageContent = { blocks: [{ type: 'text', text: 'Done.' }] };

    configRepository.getEnv.mockReturnValue({
      agent: {
        runnerUrl: 'http://agent-runner:4477',
        runnerHealthTimeoutMs: 3000,
        runnerMessageStreamTimeoutMs: 120_000,
      },
    } as never);
    agentRunnerRepository.streamMessage.mockReturnValue(
      streamEvents([
        {
          type: 'assistant-message-completed',
          sessionId,
          runnerSessionId,
          providerMessageId: null,
          content: assistantContent,
        },
      ]),
    );
    messageRepository.create.mockResolvedValue(makeAssistantMessage({ sessionId, content: assistantContent }));
    sessionRepository.getById.mockResolvedValue({ status: AgentSessionStatus.Running } as never);

    await sut.sendMessage({ userId, sessionId, runnerSessionId, messageId, content });

    expect(activityService.createSystemEvent).toHaveBeenNthCalledWith(1, userId, sessionId, {
      kind: 'start-processing',
      status: 'running',
    });
    expect(agentRunnerRepository.streamMessage).toHaveBeenCalledTimes(1);
    expect(activityService.createSystemEvent.mock.invocationCallOrder[0]).toBeLessThan(
      agentRunnerRepository.streamMessage.mock.invocationCallOrder[0],
    );
  });

  it('marks a completed assistant turn interrupted when a same-turn planning tool was denied', async () => {
    const sessionId = '00000000-0000-4000-8000-000000000100';
    const runnerSessionId = 'runner-session-1';
    const messageId = '00000000-0000-4000-8000-000000000200';
    const content: AgentMessageContent = { blocks: [{ type: 'text', text: 'Create an album plan.' }] };
    const assistantContent: AgentMessageContent = {
      blocks: [{ type: 'text', text: 'I could not create the plan because the selection expired.' }],
    };
    const assistantMessage = makeAssistantMessage({ sessionId, content: assistantContent });

    configRepository.getEnv.mockReturnValue({
      agent: {
        runnerUrl: 'http://agent-runner:4477',
        runnerHealthTimeoutMs: 3000,
        runnerMessageStreamTimeoutMs: 120_000,
      },
    } as never);
    toolCallRepository.getBySessionId.mockResolvedValueOnce([]).mockResolvedValueOnce([
      makeToolCall({
        sessionId,
        toolName: AgentToolName.ProposeAlbumOperations,
        status: AgentToolCallStatus.Denied,
        approvalDecision: AgentToolApprovalDecision.Denied,
        error: 'Selection handle is expired or not available for this session',
      }),
    ]);
    agentRunnerRepository.streamMessage.mockReturnValue(
      streamEvents([
        {
          type: 'assistant-message-completed',
          sessionId,
          runnerSessionId,
          providerMessageId: 'provider-message-failure',
          content: assistantContent,
        },
      ]),
    );
    messageRepository.create.mockResolvedValue(assistantMessage);
    sessionRepository.getById.mockResolvedValue({ status: AgentSessionStatus.Running } as never);

    await sut.sendMessage({ userId, sessionId, runnerSessionId, messageId, content });

    expect(messageRepository.create).toHaveBeenCalledWith({
      sessionId,
      role: AgentMessageRole.Assistant,
      content: assistantContent,
      providerMessageId: 'provider-message-failure',
      toolCallId: null,
    });
    expect(websocketRepository.clientSend).toHaveBeenCalledWith(
      'on_agent_session_event',
      userId,
      expect.objectContaining({ type: 'assistant-message-created' }),
    );
    expect(sessionRepository.markInterruptedFromActive).toHaveBeenCalledWith(userId, sessionId);
    expect(activityService.createSystemEvent).toHaveBeenCalledWith(userId, sessionId, {
      kind: AgentSessionActivityEventKind.StartProcessing,
      status: AgentSessionActivityEventStatus.Failed,
      summary: 'The assistant stopped after a Gallery tool error.',
    });
    expect(websocketRepository.clientSend).not.toHaveBeenCalledWith(
      'on_agent_session_event',
      userId,
      expect.objectContaining({ type: 'runner-error' }),
    );
  });

  it('ignores historical failed tool calls that existed before this runner turn', async () => {
    const sessionId = '00000000-0000-4000-8000-000000000100';
    const runnerSessionId = 'runner-session-1';
    const messageId = '00000000-0000-4000-8000-000000000200';
    const content: AgentMessageContent = { blocks: [{ type: 'text', text: 'Try again.' }] };
    const assistantContent: AgentMessageContent = { blocks: [{ type: 'text', text: 'Done.' }] };
    const historicalFailure = makeToolCall({
      sessionId,
      status: AgentToolCallStatus.Denied,
      approvalDecision: AgentToolApprovalDecision.Denied,
      error: 'Selection handle is expired or not available for this session',
    });

    configRepository.getEnv.mockReturnValue({
      agent: {
        runnerUrl: 'http://agent-runner:4477',
        runnerHealthTimeoutMs: 3000,
        runnerMessageStreamTimeoutMs: 120_000,
      },
    } as never);
    toolCallRepository.getBySessionId.mockResolvedValue([historicalFailure]);
    agentRunnerRepository.streamMessage.mockReturnValue(
      streamEvents([
        {
          type: 'assistant-message-completed',
          sessionId,
          runnerSessionId,
          providerMessageId: 'provider-message-1',
          content: assistantContent,
        },
      ]),
    );
    messageRepository.create.mockResolvedValue(makeAssistantMessage({ sessionId, content: assistantContent }));
    sessionRepository.getById.mockResolvedValue({ status: AgentSessionStatus.Running } as never);

    await sut.sendMessage({ userId, sessionId, runnerSessionId, messageId, content });

    expect(sessionRepository.markInterruptedFromActive).not.toHaveBeenCalled();
    expect(activityService.createSystemEvent).not.toHaveBeenCalledWith(
      userId,
      sessionId,
      expect.objectContaining({ status: AgentSessionActivityEventStatus.Failed }),
    );
  });

  it('does not mark normal assistant completions failed when no same-turn tool failure exists', async () => {
    const sessionId = '00000000-0000-4000-8000-000000000100';
    const runnerSessionId = 'runner-session-1';
    const messageId = '00000000-0000-4000-8000-000000000200';
    const content: AgentMessageContent = { blocks: [{ type: 'text', text: 'Organize my photos.' }] };
    const assistantContent: AgentMessageContent = { blocks: [{ type: 'text', text: 'Done.' }] };

    configRepository.getEnv.mockReturnValue({
      agent: {
        runnerUrl: 'http://agent-runner:4477',
        runnerHealthTimeoutMs: 3000,
        runnerMessageStreamTimeoutMs: 120_000,
      },
    } as never);
    toolCallRepository.getBySessionId
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([makeToolCall({ sessionId, status: AgentToolCallStatus.Completed })]);
    agentRunnerRepository.streamMessage.mockReturnValue(
      streamEvents([
        {
          type: 'assistant-message-completed',
          sessionId,
          runnerSessionId,
          providerMessageId: 'provider-message-1',
          content: assistantContent,
        },
      ]),
    );
    messageRepository.create.mockResolvedValue(makeAssistantMessage({ sessionId, content: assistantContent }));
    sessionRepository.getById.mockResolvedValue({ status: AgentSessionStatus.Running } as never);

    await sut.sendMessage({ userId, sessionId, runnerSessionId, messageId, content });

    expect(sessionRepository.markInterruptedFromActive).not.toHaveBeenCalled();
    expect(activityService.createSystemEvent).not.toHaveBeenCalledWith(
      userId,
      sessionId,
      expect.objectContaining({ status: AgentSessionActivityEventStatus.Failed }),
    );
  });

  it('does not mark a completed turn failed when the pre-dispatch tool-call baseline cannot be read', async () => {
    const sessionId = '00000000-0000-4000-8000-000000000100';
    const runnerSessionId = 'runner-session-1';
    const messageId = '00000000-0000-4000-8000-000000000200';
    const content: AgentMessageContent = { blocks: [{ type: 'text', text: 'Organize my photos.' }] };
    const assistantContent: AgentMessageContent = { blocks: [{ type: 'text', text: 'Done.' }] };

    configRepository.getEnv.mockReturnValue({
      agent: {
        runnerUrl: 'http://agent-runner:4477',
        runnerHealthTimeoutMs: 3000,
        runnerMessageStreamTimeoutMs: 120_000,
      },
    } as never);
    toolCallRepository.getBySessionId.mockRejectedValueOnce(new Error('repository unavailable'));
    agentRunnerRepository.streamMessage.mockReturnValue(
      streamEvents([
        {
          type: 'assistant-message-completed',
          sessionId,
          runnerSessionId,
          providerMessageId: 'provider-message-1',
          content: assistantContent,
        },
      ]),
    );
    messageRepository.create.mockResolvedValue(makeAssistantMessage({ sessionId, content: assistantContent }));
    sessionRepository.getById.mockResolvedValue({ status: AgentSessionStatus.Running } as never);

    await sut.sendMessage({ userId, sessionId, runnerSessionId, messageId, content });

    expect(messageRepository.create).toHaveBeenCalled();
    expect(sessionRepository.markInterruptedFromActive).not.toHaveBeenCalled();
    expect(activityService.createSystemEvent).not.toHaveBeenCalledWith(
      userId,
      sessionId,
      expect.objectContaining({ status: AgentSessionActivityEventStatus.Failed }),
    );
  });

  it('does not mark a completed plan-review wait failed when a same-turn tool failure exists', async () => {
    const sessionId = '00000000-0000-4000-8000-000000000100';
    const runnerSessionId = 'runner-session-1';
    const messageId = '00000000-0000-4000-8000-000000000200';
    const content: AgentMessageContent = { blocks: [{ type: 'text', text: 'Create a plan.' }] };
    const assistantContent: AgentMessageContent = { blocks: [{ type: 'text', text: 'Please review this plan.' }] };

    configRepository.getEnv.mockReturnValue({
      agent: {
        runnerUrl: 'http://agent-runner:4477',
        runnerHealthTimeoutMs: 3000,
        runnerMessageStreamTimeoutMs: 120_000,
      },
    } as never);
    toolCallRepository.getBySessionId.mockResolvedValueOnce([]).mockResolvedValueOnce([
      makeToolCall({
        sessionId,
        id: '00000000-0000-4000-8000-000000000334',
        status: AgentToolCallStatus.Failed,
        error: 'Plan tool failed',
      }),
    ]);
    agentRunnerRepository.streamMessage.mockReturnValue(
      streamEvents([
        {
          type: 'assistant-message-completed',
          sessionId,
          runnerSessionId,
          providerMessageId: 'provider-message-plan-review',
          content: assistantContent,
        },
      ]),
    );
    messageRepository.create.mockResolvedValue(makeAssistantMessage({ sessionId, content: assistantContent }));
    sessionRepository.getById.mockResolvedValue({ status: AgentSessionStatus.WaitingForPlanReview } as never);

    await sut.sendMessage({ userId, sessionId, runnerSessionId, messageId, content });

    expect(messageRepository.create).toHaveBeenCalled();
    expect(sessionRepository.markInterruptedFromActive).not.toHaveBeenCalled();
    expect(activityService.createSystemEvent).not.toHaveBeenCalledWith(
      userId,
      sessionId,
      expect.objectContaining({ status: AgentSessionActivityEventStatus.Failed }),
    );
  });

  it('creates runner activity events from matching runner stream activity frames', async () => {
    const sessionId = '00000000-0000-4000-8000-000000000100';
    const runnerSessionId = 'runner-session-1';
    const messageId = '00000000-0000-4000-8000-000000000200';
    const content: AgentMessageContent = { blocks: [{ type: 'text', text: 'Organize my photos.' }] };
    const assistantContent: AgentMessageContent = { blocks: [{ type: 'text', text: 'Done.' }] };
    const runnerActivity = {
      type: 'activity' as const,
      sessionId,
      runnerSessionId,
      kind: 'plan-composing' as const,
      status: 'running' as const,
      summary: 'Composing the plan',
    };
    const normalizedActivity = { kind: 'plan-composing', status: 'running', summary: 'Composing the plan' };

    configRepository.getEnv.mockReturnValue({
      agent: {
        runnerUrl: 'http://agent-runner:4477',
        runnerHealthTimeoutMs: 3000,
        runnerMessageStreamTimeoutMs: 120_000,
      },
    } as never);
    activityService.normalizeRunnerEvent.mockReturnValue(normalizedActivity);
    agentRunnerRepository.streamMessage.mockReturnValue(
      streamEvents([
        runnerActivity,
        {
          type: 'assistant-message-completed',
          sessionId,
          runnerSessionId,
          providerMessageId: null,
          content: assistantContent,
        },
      ]),
    );
    messageRepository.create.mockResolvedValue(makeAssistantMessage({ sessionId, content: assistantContent }));
    sessionRepository.getById.mockResolvedValue({ status: AgentSessionStatus.Running } as never);

    await sut.sendMessage({ userId, sessionId, runnerSessionId, messageId, content });

    expect(activityService.normalizeRunnerEvent).toHaveBeenCalledWith(runnerActivity);
    expect(activityService.createSystemEvent).toHaveBeenCalledWith(userId, sessionId, normalizedActivity);
  });

  it('ignores runner activity events when the activity service rejects them as structurally invalid', async () => {
    const sessionId = '00000000-0000-4000-8000-000000000100';
    const runnerSessionId = 'runner-session-1';
    const messageId = '00000000-0000-4000-8000-000000000200';
    const content: AgentMessageContent = { blocks: [{ type: 'text', text: 'Organize my photos.' }] };
    const assistantContent: AgentMessageContent = { blocks: [{ type: 'text', text: 'Done.' }] };
    const runnerActivity = {
      type: 'activity' as const,
      sessionId,
      runnerSessionId,
      kind: 'apply-progress' as const,
      status: 'running' as const,
      counts: { total: 2 },
    };

    configRepository.getEnv.mockReturnValue({
      agent: {
        runnerUrl: 'http://agent-runner:4477',
        runnerHealthTimeoutMs: 3000,
        runnerMessageStreamTimeoutMs: 120_000,
      },
    } as never);
    activityService.normalizeRunnerEvent.mockReturnValue(null);
    agentRunnerRepository.streamMessage.mockReturnValue(
      streamEvents([
        runnerActivity,
        {
          type: 'assistant-message-completed',
          sessionId,
          runnerSessionId,
          providerMessageId: null,
          content: assistantContent,
        },
      ]),
    );
    messageRepository.create.mockResolvedValue(makeAssistantMessage({ sessionId, content: assistantContent }));
    sessionRepository.getById.mockResolvedValue({ status: AgentSessionStatus.Running } as never);

    await sut.sendMessage({ userId, sessionId, runnerSessionId, messageId, content });

    expect(activityService.createSystemEvent).toHaveBeenCalledWith(userId, sessionId, {
      kind: 'start-processing',
      status: 'running',
    });
    expect(activityService.createSystemEvent).toHaveBeenCalledTimes(1);
  });

  it('suppresses assistant output when a tool call moves the session into approval review', async () => {
    const userId = '00000000-0000-4000-8000-000000000001';
    const sessionId = '00000000-0000-4000-8000-000000000100';
    const runnerSessionId = 'runner-session-1';
    const messageId = '00000000-0000-4000-8000-000000000200';
    const content: AgentMessageContent = { blocks: [{ type: 'text', text: 'How many photos are in this album?' }] };
    const assistantContent: AgentMessageContent = {
      blocks: [{ type: 'text', text: 'I requested permission to read your albums.' }],
    };

    configRepository.getEnv.mockReturnValue({
      agent: {
        runnerUrl: 'http://agent-runner:4477',
        runnerHealthTimeoutMs: 3000,
        runnerMessageStreamTimeoutMs: 120_000,
      },
    } as never);
    agentRunnerRepository.streamMessage.mockReturnValue(
      streamEvents([
        {
          type: 'assistant-message-delta',
          sessionId,
          runnerSessionId,
          delta: 'I requested permission',
          sequence: 1,
        },
        {
          type: 'assistant-message-completed',
          sessionId,
          runnerSessionId,
          providerMessageId: 'provider-message-1',
          content: assistantContent,
        },
      ]),
    );
    messageRepository.create.mockResolvedValue(makeAssistantMessage({ sessionId, content: assistantContent }));
    sessionRepository.getById.mockResolvedValue({ status: AgentSessionStatus.WaitingForToolApproval } as never);

    await sut.sendMessage({ userId, sessionId, runnerSessionId, messageId, content });

    expect(websocketRepository.clientSend).not.toHaveBeenCalled();
    expect(messageRepository.create).not.toHaveBeenCalled();
  });

  it('finishes the active dispatch without runner error when a tool pauses for approval', async () => {
    const userId = '00000000-0000-4000-8000-000000000001';
    const sessionId = '00000000-0000-4000-8000-000000000100';
    const runnerSessionId = 'runner-session-1';
    const messageId = '00000000-0000-4000-8000-000000000200';
    const content: AgentMessageContent = { blocks: [{ type: 'text', text: 'How many photos are in this album?' }] };

    configRepository.getEnv.mockReturnValue({
      agent: {
        runnerUrl: 'http://agent-runner:4477',
        runnerHealthTimeoutMs: 3000,
        runnerMessageStreamTimeoutMs: 120_000,
      },
    } as never);
    agentRunnerRepository.streamMessage.mockReturnValue(
      streamEvents([
        {
          type: 'tool-approval-needed',
          sessionId,
          runnerSessionId,
          toolCallId: '00000000-0000-4000-8000-000000000333',
        },
      ]),
    );

    await sut.sendMessage({ userId, sessionId, runnerSessionId, messageId, content });

    expect(sessionRepository.markInterruptedFromActive).not.toHaveBeenCalled();
    expect(websocketRepository.clientSend).not.toHaveBeenCalledWith(
      'on_agent_session_event',
      userId,
      expect.objectContaining({ type: 'runner-error' }),
    );
    expect(messageRepository.create).not.toHaveBeenCalled();
    expect(sut.isSessionDispatchActive(sessionId)).toBe(false);
    expect(activityService.createSystemEvent).not.toHaveBeenCalledWith(
      userId,
      sessionId,
      expect.objectContaining({ status: AgentSessionActivityEventStatus.Failed }),
    );
  });

  it('resumes a runner session after tool approval and streams the continued assistant message', async () => {
    const sessionId = '00000000-0000-4000-8000-000000000100';
    const runnerSessionId = 'runner-session-1';
    const assistantContent: AgentMessageContent = { blocks: [{ type: 'text', text: 'I added those photos.' }] };
    const assistantMessage = makeAssistantMessage({ sessionId, content: assistantContent });

    configRepository.getEnv.mockReturnValue({
      agent: {
        runnerUrl: 'http://agent-runner:4477',
        runnerHealthTimeoutMs: 3000,
        runnerMessageStreamTimeoutMs: 120_000,
      },
    } as never);
    agentRunnerRepository.streamResume.mockReturnValue(
      streamEvents([
        {
          type: 'assistant-message-delta',
          sessionId,
          runnerSessionId,
          delta: 'I added',
          sequence: 1,
        },
        {
          type: 'assistant-message-completed',
          sessionId,
          runnerSessionId,
          providerMessageId: 'provider-message-2',
          content: assistantContent,
        },
      ]),
    );
    messageRepository.create.mockResolvedValue(assistantMessage);
    sessionRepository.getById.mockResolvedValue({ status: AgentSessionStatus.Running } as never);

    await sut.resumeAfterToolApproval({
      userId,
      sessionId,
      runnerSessionId,
      toolCallId: '00000000-0000-4000-8000-000000000333',
      approvalDecision: 'approved',
      toolResult: { status: 'success', albums: [{ id: 'album-1', albumName: 'Test Pierre' }] },
    });

    expect(agentRunnerRepository.streamResume).toHaveBeenCalledWith({
      url: 'http://agent-runner:4477',
      runnerSessionId,
      timeoutMs: 120_000,
      body: {
        gallerySessionId: sessionId,
        toolCallId: '00000000-0000-4000-8000-000000000333',
        approvalDecision: 'approved',
        toolResult: { status: 'success', albums: [{ id: 'album-1', albumName: 'Test Pierre' }] },
      },
    });
    expect(websocketRepository.clientSend).toHaveBeenNthCalledWith(1, 'on_agent_session_event', userId, {
      type: 'assistant-message-delta',
      sessionId,
      delta: 'I added',
      sequence: 1,
      createdAt: '2026-05-14T10:00:00.000Z',
    });
    expect(messageRepository.create).toHaveBeenCalledWith({
      sessionId,
      role: AgentMessageRole.Assistant,
      content: assistantContent,
      providerMessageId: 'provider-message-2',
      toolCallId: null,
    });
  });

  it('creates a runner-recovery activity event before resuming a runner session', async () => {
    const sessionId = '00000000-0000-4000-8000-000000000100';
    const runnerSessionId = 'runner-session-1';
    const assistantContent: AgentMessageContent = { blocks: [{ type: 'text', text: 'Continued.' }] };

    configRepository.getEnv.mockReturnValue({
      agent: {
        runnerUrl: 'http://agent-runner:4477',
        runnerHealthTimeoutMs: 3000,
        runnerMessageStreamTimeoutMs: 120_000,
      },
    } as never);
    agentRunnerRepository.streamResume.mockReturnValue(
      streamEvents([
        {
          type: 'assistant-message-completed',
          sessionId,
          runnerSessionId,
          providerMessageId: null,
          content: assistantContent,
        },
      ]),
    );
    messageRepository.create.mockResolvedValue(makeAssistantMessage({ sessionId, content: assistantContent }));
    sessionRepository.getById.mockResolvedValue({ status: AgentSessionStatus.Running } as never);

    await sut.resumeAfterToolApproval({
      userId,
      sessionId,
      runnerSessionId,
      toolCallId: '00000000-0000-4000-8000-000000000333',
      approvalDecision: 'approved',
    });

    expect(activityService.createSystemEvent).toHaveBeenNthCalledWith(1, userId, sessionId, {
      kind: 'runner-recovery',
      status: 'running',
    });
    expect(agentRunnerRepository.streamResume).toHaveBeenCalledTimes(1);
    expect(activityService.createSystemEvent.mock.invocationCallOrder[0]).toBeLessThan(
      agentRunnerRepository.streamResume.mock.invocationCallOrder[0],
    );
  });

  it('resumes a runner session with denied approval context and no tool result', async () => {
    const sessionId = '00000000-0000-4000-8000-000000000100';
    const runnerSessionId = 'runner-session-1';
    const assistantContent: AgentMessageContent = { blocks: [{ type: 'text', text: 'I will avoid that action.' }] };
    const assistantMessage = makeAssistantMessage({
      sessionId,
      content: assistantContent,
      providerMessageId: 'provider-message-denied',
    });

    configRepository.getEnv.mockReturnValue({
      agent: {
        runnerUrl: 'http://agent-runner:4477',
        runnerHealthTimeoutMs: 3000,
        runnerMessageStreamTimeoutMs: 120_000,
      },
    } as never);
    agentRunnerRepository.streamResume.mockReturnValue(
      streamEvents([
        {
          type: 'assistant-message-delta',
          sessionId,
          runnerSessionId,
          delta: 'I will avoid',
          sequence: 1,
        },
        {
          type: 'assistant-message-completed',
          sessionId,
          runnerSessionId,
          providerMessageId: 'provider-message-denied',
          content: assistantContent,
        },
      ]),
    );
    messageRepository.create.mockResolvedValue(assistantMessage);
    sessionRepository.getById.mockResolvedValue({ status: AgentSessionStatus.Running } as never);

    await sut.resumeAfterToolApproval({
      userId,
      sessionId,
      runnerSessionId,
      toolCallId: '00000000-0000-4000-8000-000000000333',
      approvalDecision: 'denied',
    });

    expect(agentRunnerRepository.streamResume).toHaveBeenCalledWith({
      url: 'http://agent-runner:4477',
      runnerSessionId,
      timeoutMs: 120_000,
      body: {
        gallerySessionId: sessionId,
        toolCallId: '00000000-0000-4000-8000-000000000333',
        approvalDecision: 'denied',
      },
    });
    expect(websocketRepository.clientSend).toHaveBeenNthCalledWith(1, 'on_agent_session_event', userId, {
      type: 'assistant-message-delta',
      sessionId,
      delta: 'I will avoid',
      sequence: 1,
      createdAt: '2026-05-14T10:00:00.000Z',
    });
    expect(messageRepository.create).toHaveBeenCalledWith({
      sessionId,
      role: AgentMessageRole.Assistant,
      content: assistantContent,
      providerMessageId: 'provider-message-denied',
      toolCallId: null,
    });
  });

  it('marks a completed resume turn interrupted when the approved tool result failed before continuation', async () => {
    const sessionId = '00000000-0000-4000-8000-000000000100';
    const runnerSessionId = 'runner-session-1';
    const toolCallId = '00000000-0000-4000-8000-000000000333';
    const assistantContent: AgentMessageContent = {
      blocks: [{ type: 'text', text: 'I could not read those photos because Gallery returned an error.' }],
    };
    const failedToolCall = makeToolCall({
      id: toolCallId,
      sessionId,
      toolName: AgentToolName.ReadAssetMetadata,
      status: AgentToolCallStatus.Failed,
      approvalDecision: AgentToolApprovalDecision.Approved,
      error: 'Metadata read failed',
    });

    configRepository.getEnv.mockReturnValue({
      agent: {
        runnerUrl: 'http://agent-runner:4477',
        runnerHealthTimeoutMs: 3000,
        runnerMessageStreamTimeoutMs: 120_000,
      },
    } as never);
    toolCallRepository.getBySessionId.mockResolvedValue([failedToolCall]);
    agentRunnerRepository.streamResume.mockReturnValue(
      streamEvents([
        {
          type: 'assistant-message-completed',
          sessionId,
          runnerSessionId,
          providerMessageId: 'provider-message-tool-error',
          content: assistantContent,
        },
      ]),
    );
    messageRepository.create.mockResolvedValue(
      makeAssistantMessage({ sessionId, content: assistantContent, providerMessageId: 'provider-message-tool-error' }),
    );
    sessionRepository.getById.mockResolvedValue({ status: AgentSessionStatus.Running } as never);

    await sut.resumeAfterToolApproval({
      userId,
      sessionId,
      runnerSessionId,
      toolCallId,
      approvalDecision: 'approved',
      toolResult: { status: 'error', message: 'Approved tool call failed before returning a result.' },
    });

    expect(messageRepository.create).toHaveBeenCalledWith({
      sessionId,
      role: AgentMessageRole.Assistant,
      content: assistantContent,
      providerMessageId: 'provider-message-tool-error',
      toolCallId: null,
    });
    expect(sessionRepository.markInterruptedFromActive).toHaveBeenCalledWith(userId, sessionId);
    expect(activityService.createSystemEvent).toHaveBeenCalledWith(userId, sessionId, {
      kind: AgentSessionActivityEventKind.RunnerRecovery,
      status: AgentSessionActivityEventStatus.Failed,
      summary: 'The assistant stopped after a Gallery tool error.',
    });
    expect(websocketRepository.clientSend).not.toHaveBeenCalledWith(
      'on_agent_session_event',
      userId,
      expect.objectContaining({ type: 'runner-error' }),
    );
  });

  it('marks the session interrupted and emits an error when runner message streaming fails', async () => {
    const userId = '00000000-0000-4000-8000-000000000001';
    const sessionId = '00000000-0000-4000-8000-000000000100';
    const runnerSessionId = 'runner-session-1';
    const messageId = '00000000-0000-4000-8000-000000000200';
    const content: AgentMessageContent = { blocks: [{ type: 'text', text: 'Organize my photos.' }] };
    const error = new Error('connection refused');

    configRepository.getEnv.mockReturnValue({
      agent: {
        runnerUrl: 'http://agent-runner:4477',
        runnerHealthTimeoutMs: 3000,
        runnerMessageStreamTimeoutMs: 120_000,
      },
    } as never);
    agentRunnerRepository.streamMessage.mockReturnValue(failingStream(error));
    sessionRepository.markInterruptedFromActive.mockResolvedValue({} as never);

    await expect(sut.sendMessage({ userId, sessionId, runnerSessionId, messageId, content })).rejects.toBe(error);

    expect(sessionRepository.markInterruptedFromActive).toHaveBeenCalledWith(userId, sessionId);
    expect(sessionRepository.update).not.toHaveBeenCalled();
    expect(websocketRepository.clientSend).toHaveBeenCalledWith('on_agent_session_event', userId, {
      type: 'runner-error',
      sessionId,
      message: 'The assistant runner stopped while processing the message.',
      createdAt: '2026-05-14T10:00:00.000Z',
    });
    expect(activityService.createSystemEvent).toHaveBeenCalledWith(userId, sessionId, {
      kind: AgentSessionActivityEventKind.StartProcessing,
      status: AgentSessionActivityEventStatus.Failed,
      summary: 'The assistant stopped while processing the message.',
    });
  });

  it('marks the session interrupted and emits an error when runner resume streaming fails', async () => {
    const sessionId = '00000000-0000-4000-8000-000000000100';
    const runnerSessionId = 'runner-session-1';
    const error = new Error('resume connection failed with sk-secret');

    configRepository.getEnv.mockReturnValue({
      agent: {
        runnerUrl: 'http://agent-runner:4477',
        runnerHealthTimeoutMs: 3000,
        runnerMessageStreamTimeoutMs: 120_000,
      },
    } as never);
    agentRunnerRepository.streamResume.mockReturnValue(failingStream(error));
    sessionRepository.markInterruptedFromActive.mockResolvedValue({} as never);

    await expect(
      sut.resumeAfterToolApproval({
        userId,
        sessionId,
        runnerSessionId,
        toolCallId: '00000000-0000-4000-8000-000000000333',
        approvalDecision: 'approved',
        toolResult: { status: 'success' },
      }),
    ).rejects.toBe(error);

    expect(sessionRepository.markInterruptedFromActive).toHaveBeenCalledWith(userId, sessionId);
    expect(websocketRepository.clientSend).toHaveBeenCalledWith('on_agent_session_event', userId, {
      type: 'runner-error',
      sessionId,
      message: 'The assistant runner stopped while processing the message.',
      createdAt: '2026-05-14T10:00:00.000Z',
    });
    expect(activityService.createSystemEvent).toHaveBeenCalledWith(userId, sessionId, {
      kind: AgentSessionActivityEventKind.RunnerRecovery,
      status: AgentSessionActivityEventStatus.Failed,
      summary: 'The assistant stopped while resuming after approval.',
    });
  });

  it('marks the session interrupted with a runner-reported resume failure', async () => {
    const sessionId = '00000000-0000-4000-8000-000000000100';
    const runnerSessionId = 'runner-session-1';

    configRepository.getEnv.mockReturnValue({
      agent: {
        runnerUrl: 'http://agent-runner:4477',
        runnerHealthTimeoutMs: 3000,
        runnerMessageStreamTimeoutMs: 120_000,
      },
    } as never);
    agentRunnerRepository.streamResume.mockReturnValue(
      streamEvents([
        {
          type: 'runner-error',
          sessionId,
          runnerSessionId,
          message: 'Provider rejected the approval continuation',
        },
      ]),
    );
    sessionRepository.markInterruptedFromActive.mockResolvedValue({} as never);

    await expect(
      sut.resumeAfterToolApproval({
        userId,
        sessionId,
        runnerSessionId,
        toolCallId: '00000000-0000-4000-8000-000000000333',
        approvalDecision: 'approved',
        toolResult: { status: 'success' },
      }),
    ).rejects.toThrow('Provider rejected the approval continuation');

    expect(websocketRepository.clientSend).toHaveBeenCalledWith('on_agent_session_event', userId, {
      type: 'runner-error',
      sessionId,
      message: 'Provider rejected the approval continuation',
      createdAt: '2026-05-14T10:00:00.000Z',
    });
    expect(activityService.createSystemEvent).toHaveBeenCalledWith(userId, sessionId, {
      kind: AgentSessionActivityEventKind.RunnerRecovery,
      status: AgentSessionActivityEventStatus.Failed,
      summary: 'The assistant stopped while resuming after approval.',
    });
  });

  it('emits actionable context-window runner errors without replacing the runner message', async () => {
    const sessionId = '00000000-0000-4000-8000-000000000100';
    const runnerSessionId = 'runner-session-1';
    const messageId = '00000000-0000-4000-8000-000000000200';
    const content: AgentMessageContent = { blocks: [{ type: 'text', text: 'Find every photo in my library.' }] };
    const runnerMessage =
      'The assistant hit the model context limit while processing Gallery data. Narrow the request or inspect fewer photos at a time.';

    configRepository.getEnv.mockReturnValue({
      agent: {
        runnerUrl: 'http://agent-runner:4477',
        runnerHealthTimeoutMs: 3000,
        runnerMessageStreamTimeoutMs: 120_000,
      },
    } as never);
    agentRunnerRepository.streamMessage.mockReturnValue(
      streamEvents([
        {
          type: 'runner-error',
          sessionId,
          runnerSessionId,
          message: runnerMessage,
        },
      ]),
    );
    sessionRepository.markInterruptedFromActive.mockResolvedValue({} as never);

    await expect(sut.sendMessage({ userId, sessionId, runnerSessionId, messageId, content })).rejects.toThrow(
      runnerMessage,
    );

    expect(websocketRepository.clientSend).toHaveBeenCalledWith('on_agent_session_event', userId, {
      type: 'runner-error',
      sessionId,
      message: runnerMessage,
      createdAt: '2026-05-14T10:00:00.000Z',
    });
    expect(activityService.createSystemEvent).toHaveBeenCalledWith(userId, sessionId, {
      kind: AgentSessionActivityEventKind.StartProcessing,
      status: AgentSessionActivityEventStatus.Failed,
      summary: 'The assistant stopped while processing the message.',
    });
  });

  it('marks the session interrupted and emits an error when the runner stream ends empty', async () => {
    const userId = '00000000-0000-4000-8000-000000000001';
    const sessionId = '00000000-0000-4000-8000-000000000100';
    const runnerSessionId = 'runner-session-1';
    const messageId = '00000000-0000-4000-8000-000000000200';
    const content: AgentMessageContent = { blocks: [{ type: 'text', text: 'Organize my photos.' }] };

    configRepository.getEnv.mockReturnValue({
      agent: {
        runnerUrl: 'http://agent-runner:4477',
        runnerHealthTimeoutMs: 3000,
        runnerMessageStreamTimeoutMs: 120_000,
      },
    } as never);
    agentRunnerRepository.streamMessage.mockReturnValue(streamEvents([]));
    sessionRepository.markInterruptedFromActive.mockResolvedValue({} as never);

    await expect(sut.sendMessage({ userId, sessionId, runnerSessionId, messageId, content })).rejects.toThrow(
      'Agent runner message stream ended before completion',
    );

    expect(messageRepository.create).not.toHaveBeenCalled();
    expect(sessionRepository.markInterruptedFromActive).toHaveBeenCalledWith(userId, sessionId);
    expect(websocketRepository.clientSend).toHaveBeenCalledWith('on_agent_session_event', userId, {
      type: 'runner-error',
      sessionId,
      message: 'The assistant runner stopped while processing the message.',
      createdAt: '2026-05-14T10:00:00.000Z',
    });
    expect(activityService.createSystemEvent).toHaveBeenCalledWith(userId, sessionId, {
      kind: AgentSessionActivityEventKind.StartProcessing,
      status: AgentSessionActivityEventStatus.Failed,
      summary: 'The assistant stopped while processing the message.',
    });
  });

  it('marks the session interrupted and emits an error when the runner stream ends after deltas without completion', async () => {
    const userId = '00000000-0000-4000-8000-000000000001';
    const sessionId = '00000000-0000-4000-8000-000000000100';
    const runnerSessionId = 'runner-session-1';
    const messageId = '00000000-0000-4000-8000-000000000200';
    const content: AgentMessageContent = { blocks: [{ type: 'text', text: 'Organize my photos.' }] };

    configRepository.getEnv.mockReturnValue({
      agent: {
        runnerUrl: 'http://agent-runner:4477',
        runnerHealthTimeoutMs: 3000,
        runnerMessageStreamTimeoutMs: 120_000,
      },
    } as never);
    agentRunnerRepository.streamMessage.mockReturnValue(
      streamEvents([
        {
          type: 'assistant-message-delta',
          sessionId,
          runnerSessionId,
          delta: 'Partial',
          sequence: 1,
        },
      ]),
    );
    sessionRepository.getById.mockResolvedValue({ status: AgentSessionStatus.Running } as never);
    sessionRepository.markInterruptedFromActive.mockResolvedValue({} as never);

    await expect(sut.sendMessage({ userId, sessionId, runnerSessionId, messageId, content })).rejects.toThrow(
      'Agent runner message stream ended before completion',
    );

    expect(messageRepository.create).not.toHaveBeenCalled();
    expect(sessionRepository.markInterruptedFromActive).toHaveBeenCalledWith(userId, sessionId);
    expect(websocketRepository.clientSend).toHaveBeenLastCalledWith('on_agent_session_event', userId, {
      type: 'runner-error',
      sessionId,
      message: 'The assistant runner stopped while processing the message.',
      createdAt: '2026-05-14T10:00:00.000Z',
    });
  });

  it('marks the session interrupted with the runner-reported provider failure', async () => {
    const userId = '00000000-0000-4000-8000-000000000001';
    const sessionId = '00000000-0000-4000-8000-000000000100';
    const runnerSessionId = 'runner-session-1';
    const messageId = '00000000-0000-4000-8000-000000000200';
    const content: AgentMessageContent = { blocks: [{ type: 'text', text: 'Organize my photos.' }] };

    configRepository.getEnv.mockReturnValue({
      agent: {
        runnerUrl: 'http://agent-runner:4477',
        runnerHealthTimeoutMs: 3000,
        runnerMessageStreamTimeoutMs: 120_000,
      },
    } as never);
    agentRunnerRepository.streamMessage.mockReturnValue(
      streamEvents([
        {
          type: 'runner-error',
          sessionId,
          runnerSessionId,
          message: 'OpenAI rejected the request.',
        },
      ]),
    );
    sessionRepository.markInterruptedFromActive.mockResolvedValue({} as never);

    await expect(sut.sendMessage({ userId, sessionId, runnerSessionId, messageId, content })).rejects.toThrow(
      'OpenAI rejected the request.',
    );

    expect(sessionRepository.markInterruptedFromActive).toHaveBeenCalledWith(userId, sessionId);
    expect(messageRepository.create).not.toHaveBeenCalled();
    expect(websocketRepository.clientSend).toHaveBeenCalledWith('on_agent_session_event', userId, {
      type: 'runner-error',
      sessionId,
      message: 'OpenAI rejected the request.',
      createdAt: '2026-05-14T10:00:00.000Z',
    });
  });

  it('does not persist assistant completion when a later matching runner error arrives', async () => {
    const userId = '00000000-0000-4000-8000-000000000001';
    const sessionId = '00000000-0000-4000-8000-000000000100';
    const runnerSessionId = 'runner-session-1';
    const messageId = '00000000-0000-4000-8000-000000000200';
    const content: AgentMessageContent = { blocks: [{ type: 'text', text: 'Organize my photos.' }] };
    const assistantContent: AgentMessageContent = { blocks: [{ type: 'text', text: 'I started organizing.' }] };
    const assistantMessage = makeAssistantMessage({ sessionId, content: assistantContent });

    configRepository.getEnv.mockReturnValue({
      agent: {
        runnerUrl: 'http://agent-runner:4477',
        runnerHealthTimeoutMs: 3000,
        runnerMessageStreamTimeoutMs: 120_000,
      },
    } as never);
    agentRunnerRepository.streamMessage.mockReturnValue(
      streamEvents([
        {
          type: 'assistant-message-completed',
          sessionId,
          runnerSessionId,
          providerMessageId: 'provider-message-1',
          content: assistantContent,
        },
        {
          type: 'runner-error',
          sessionId,
          runnerSessionId,
          message: 'Provider failed after completion.',
        },
      ]),
    );
    sessionRepository.getById.mockResolvedValue({ status: AgentSessionStatus.Running } as never);
    messageRepository.create.mockResolvedValue(assistantMessage);
    sessionRepository.markInterruptedFromActive.mockResolvedValue({} as never);

    await expect(sut.sendMessage({ userId, sessionId, runnerSessionId, messageId, content })).rejects.toThrow(
      'Provider failed after completion.',
    );

    expect(messageRepository.create).not.toHaveBeenCalled();
    expect(sessionRepository.markInterruptedFromActive).toHaveBeenCalledWith(userId, sessionId);
    expect(websocketRepository.clientSend).toHaveBeenCalledWith('on_agent_session_event', userId, {
      type: 'runner-error',
      sessionId,
      message: 'Provider failed after completion.',
      createdAt: '2026-05-14T10:00:00.000Z',
    });
  });

  it.each([AgentSessionStatus.Cancelled, AgentSessionStatus.Interrupted])(
    'does not persist or emit assistant completion when the session is %s',
    async (status) => {
      const userId = '00000000-0000-4000-8000-000000000001';
      const sessionId = '00000000-0000-4000-8000-000000000100';
      const runnerSessionId = 'runner-session-1';
      const messageId = '00000000-0000-4000-8000-000000000200';
      const content: AgentMessageContent = { blocks: [{ type: 'text', text: 'Organize my photos.' }] };
      const assistantContent: AgentMessageContent = { blocks: [{ type: 'text', text: 'I can help with that.' }] };

      configRepository.getEnv.mockReturnValue({
        agent: {
          runnerUrl: 'http://agent-runner:4477',
          runnerHealthTimeoutMs: 3000,
          runnerMessageStreamTimeoutMs: 120_000,
        },
      } as never);
      agentRunnerRepository.streamMessage.mockReturnValue(
        streamEvents([
          {
            type: 'assistant-message-completed',
            sessionId,
            runnerSessionId,
            providerMessageId: 'provider-message-1',
            content: assistantContent,
          },
        ]),
      );
      sessionRepository.getById.mockResolvedValue({ status } as never);

      await sut.sendMessage({ userId, sessionId, runnerSessionId, messageId, content });

      expect(sessionRepository.getById).toHaveBeenCalledWith(userId, sessionId);
      expect(messageRepository.create).not.toHaveBeenCalled();
      expect(websocketRepository.clientSend).not.toHaveBeenCalledWith(
        'on_agent_session_event',
        userId,
        expect.objectContaining({ type: 'assistant-message-created' }),
      );
    },
  );

  it('emits a runner error and attempts conditional interruption when runner config is removed', async () => {
    const userId = '00000000-0000-4000-8000-000000000001';
    const sessionId = '00000000-0000-4000-8000-000000000100';
    const runnerSessionId = 'runner-session-1';
    const messageId = '00000000-0000-4000-8000-000000000200';
    const content: AgentMessageContent = { blocks: [{ type: 'text', text: 'Organize my photos.' }] };

    configRepository.getEnv.mockReturnValue({
      agent: { runnerHealthTimeoutMs: 3000 },
    } as never);
    sessionRepository.markInterruptedFromActive.mockResolvedValue({} as never);

    await expect(sut.sendMessage({ userId, sessionId, runnerSessionId, messageId, content })).rejects.toThrow(
      'Agent runner is not configured',
    );

    expect(agentRunnerRepository.streamMessage).not.toHaveBeenCalled();
    expect(sessionRepository.markInterruptedFromActive).toHaveBeenCalledWith(userId, sessionId);
    expect(sessionRepository.update).not.toHaveBeenCalled();
    expect(websocketRepository.clientSend).toHaveBeenCalledWith('on_agent_session_event', userId, {
      type: 'runner-error',
      sessionId,
      message: 'The assistant runner stopped while processing the message.',
      createdAt: '2026-05-14T10:00:00.000Z',
    });
  });

  it('still emits runner error and rethrows the stream error when conditional interruption fails', async () => {
    const userId = '00000000-0000-4000-8000-000000000001';
    const sessionId = '00000000-0000-4000-8000-000000000100';
    const runnerSessionId = 'runner-session-1';
    const messageId = '00000000-0000-4000-8000-000000000200';
    const content: AgentMessageContent = { blocks: [{ type: 'text', text: 'Organize my photos.' }] };
    const streamError = new Error('connection refused');

    configRepository.getEnv.mockReturnValue({
      agent: { runnerUrl: 'http://agent-runner:4477', runnerHealthTimeoutMs: 3000 },
    } as never);
    agentRunnerRepository.streamMessage.mockReturnValue(failingStream(streamError));
    sessionRepository.markInterruptedFromActive.mockRejectedValue(new Error('row update failed'));

    await expect(sut.sendMessage({ userId, sessionId, runnerSessionId, messageId, content })).rejects.toBe(streamError);

    expect(sessionRepository.markInterruptedFromActive).toHaveBeenCalledWith(userId, sessionId);
    expect(websocketRepository.clientSend).toHaveBeenCalledWith('on_agent_session_event', userId, {
      type: 'runner-error',
      sessionId,
      message: 'The assistant runner stopped while processing the message.',
      createdAt: '2026-05-14T10:00:00.000Z',
    });
  });

  it('ignores runner stream events for another Gallery or runner session', async () => {
    const userId = '00000000-0000-4000-8000-000000000001';
    const sessionId = '00000000-0000-4000-8000-000000000100';
    const runnerSessionId = 'runner-session-1';
    const messageId = '00000000-0000-4000-8000-000000000200';
    const content: AgentMessageContent = { blocks: [{ type: 'text', text: 'Organize my photos.' }] };

    configRepository.getEnv.mockReturnValue({
      agent: { runnerUrl: 'http://agent-runner:4477', runnerHealthTimeoutMs: 3000 },
    } as never);
    agentRunnerRepository.streamMessage.mockReturnValue(
      streamEvents([
        {
          type: 'assistant-message-delta',
          sessionId: '00000000-0000-4000-8000-000000000999',
          runnerSessionId,
          delta: 'wrong gallery session',
          sequence: 1,
        },
        {
          type: 'assistant-message-completed',
          sessionId,
          runnerSessionId: 'other-runner-session',
          providerMessageId: 'provider-message-1',
          content: { blocks: [{ type: 'text', text: 'Wrong runner session.' }] },
        },
      ]),
    );
    sessionRepository.markInterruptedFromActive.mockResolvedValue({} as never);

    await expect(sut.sendMessage({ userId, sessionId, runnerSessionId, messageId, content })).rejects.toThrow(
      'Agent runner message stream ended before completion',
    );

    expect(messageRepository.create).not.toHaveBeenCalled();
    expect(websocketRepository.clientSend).toHaveBeenCalledWith('on_agent_session_event', userId, {
      type: 'runner-error',
      sessionId,
      message: 'The assistant runner stopped while processing the message.',
      createdAt: '2026-05-14T10:00:00.000Z',
    });
  });

  it('ignores runner-reported errors for another Gallery or runner session', async () => {
    const userId = '00000000-0000-4000-8000-000000000001';
    const sessionId = '00000000-0000-4000-8000-000000000100';
    const runnerSessionId = 'runner-session-1';
    const messageId = '00000000-0000-4000-8000-000000000200';
    const content: AgentMessageContent = { blocks: [{ type: 'text', text: 'Organize my photos.' }] };

    configRepository.getEnv.mockReturnValue({
      agent: {
        runnerUrl: 'http://agent-runner:4477',
        runnerHealthTimeoutMs: 3000,
        runnerMessageStreamTimeoutMs: 120_000,
      },
    } as never);
    agentRunnerRepository.streamMessage.mockReturnValue(
      streamEvents([
        {
          type: 'runner-error',
          sessionId: '00000000-0000-4000-8000-000000000999',
          runnerSessionId,
          message: 'Wrong Gallery session error.',
        },
        {
          type: 'runner-error',
          sessionId,
          runnerSessionId: 'other-runner-session',
          message: 'Wrong runner session error.',
        },
      ]),
    );
    sessionRepository.markInterruptedFromActive.mockResolvedValue({} as never);

    await expect(sut.sendMessage({ userId, sessionId, runnerSessionId, messageId, content })).rejects.toThrow(
      'Agent runner message stream ended before completion',
    );

    expect(messageRepository.create).not.toHaveBeenCalled();
    expect(websocketRepository.clientSend).toHaveBeenCalledWith('on_agent_session_event', userId, {
      type: 'runner-error',
      sessionId,
      message: 'The assistant runner stopped while processing the message.',
      createdAt: '2026-05-14T10:00:00.000Z',
    });
  });

  it('tracks active runner dispatches per session while a stream is in flight', async () => {
    const userId = '00000000-0000-4000-8000-000000000001';
    const sessionId = '00000000-0000-4000-8000-000000000100';
    const runnerSessionId = 'runner-session-1';
    const messageId = '00000000-0000-4000-8000-000000000200';
    const content: AgentMessageContent = { blocks: [{ type: 'text', text: 'Organize my photos.' }] };
    const assistantContent: AgentMessageContent = { blocks: [{ type: 'text', text: 'Done.' }] };
    const assistantMessage = makeAssistantMessage({ sessionId, content: assistantContent });
    let finishStream!: () => void;
    async function* controlledStream(): AsyncGenerator<AgentRunnerStreamEvent> {
      await new Promise<void>((resolve) => {
        finishStream = resolve;
      });
      yield {
        type: 'assistant-message-completed',
        sessionId,
        runnerSessionId,
        providerMessageId: 'provider-message-1',
        content: assistantContent,
      };
    }

    configRepository.getEnv.mockReturnValue({
      agent: {
        runnerUrl: 'http://agent-runner:4477',
        runnerHealthTimeoutMs: 3000,
        runnerMessageStreamTimeoutMs: 120_000,
      },
    } as never);
    agentRunnerRepository.streamMessage.mockReturnValue(controlledStream());
    messageRepository.create.mockResolvedValue(assistantMessage);
    sessionRepository.getById.mockResolvedValue({ status: AgentSessionStatus.Running } as never);

    expect(sut.isSessionDispatchActive(sessionId)).toBe(false);
    const first = sut.sendMessage({ userId, sessionId, runnerSessionId, messageId, content });
    // Flush the pre-dispatch baseline/workflow-state reads before the runner stream opens.
    while (agentRunnerRepository.streamMessage.mock.calls.length === 0) {
      await Promise.resolve();
    }

    expect(sut.isSessionDispatchActive(sessionId)).toBe(true);
    expect(agentRunnerRepository.streamMessage).toHaveBeenCalledTimes(1);
    finishStream();
    await first;
    expect(sut.isSessionDispatchActive(sessionId)).toBe(false);
  });

  it('waits for an active message dispatch before resuming after tool approval', async () => {
    const sessionId = '00000000-0000-4000-8000-000000000100';
    const runnerSessionId = 'runner-session-1';
    let releaseMessageStream: (() => void) | undefined;
    const assistantContent: AgentMessageContent = { blocks: [{ type: 'text', text: 'Continued.' }] };

    configRepository.getEnv.mockReturnValue({
      agent: {
        runnerUrl: 'http://agent-runner:4477',
        runnerHealthTimeoutMs: 3000,
        runnerMessageStreamTimeoutMs: 120_000,
      },
    } as never);
    agentRunnerRepository.streamMessage.mockReturnValue(
      (async function* () {
        await new Promise<void>((resolve) => {
          releaseMessageStream = resolve;
        });
        yield {
          type: 'tool-approval-needed',
          sessionId,
          runnerSessionId,
          toolCallId: '00000000-0000-4000-8000-000000000333',
        };
      })(),
    );
    agentRunnerRepository.streamResume.mockReturnValue(
      streamEvents([
        {
          type: 'assistant-message-completed',
          sessionId,
          runnerSessionId,
          providerMessageId: 'provider-message-2',
          content: assistantContent,
        },
      ]),
    );
    messageRepository.create.mockResolvedValue(makeAssistantMessage({ sessionId }));
    sessionRepository.getById.mockResolvedValue({ status: AgentSessionStatus.Running } as never);

    const activeSend = sut.sendMessage({
      userId,
      sessionId,
      runnerSessionId,
      messageId: '00000000-0000-4000-8000-000000000200',
      content: { blocks: [{ type: 'text', text: 'Start.' }] },
    });

    // Let the first dispatch open its (blocked) runner stream before resuming.
    while (agentRunnerRepository.streamMessage.mock.calls.length === 0) {
      await Promise.resolve();
    }

    const resume = sut.resumeAfterToolApproval({
      userId,
      sessionId,
      runnerSessionId,
      toolCallId: '00000000-0000-4000-8000-000000000333',
      approvalDecision: 'approved',
      toolResult: { status: 'success' },
    });

    await Promise.resolve();
    expect(agentRunnerRepository.streamResume).not.toHaveBeenCalled();

    releaseMessageStream?.();
    await activeSend;
    await resume;

    expect(agentRunnerRepository.streamResume).toHaveBeenCalledWith({
      url: 'http://agent-runner:4477',
      runnerSessionId,
      timeoutMs: 120_000,
      body: {
        gallerySessionId: sessionId,
        toolCallId: '00000000-0000-4000-8000-000000000333',
        approvalDecision: 'approved',
        toolResult: { status: 'success' },
      },
    });
  });

  it('returns disabled status without probing when runner URL is missing', async () => {
    configRepository.getEnv.mockReturnValue({
      agent: { runnerHealthTimeoutMs: 2000 },
    } as never);

    await expect(sut.getStatus()).resolves.toEqual({
      configured: false,
      healthy: false,
      reason: 'not-configured',
      version: null,
      capabilities: null,
      checkedAt: new Date('2026-05-14T10:00:00.000Z'),
    });
    expect(agentRunnerRepository.getStatus).not.toHaveBeenCalled();
  });

  it('reports the runner as not configured when the MCP gateway is missing', async () => {
    configRepository.getEnv.mockReturnValue({
      agent: {
        runnerUrl: 'http://agent-runner:4477',
        mcpGatewayUrl: undefined,
        runnerHealthTimeoutMs: 3000,
      },
    } as never);

    await expect(sut.getStatus()).resolves.toMatchObject({
      configured: false,
      healthy: false,
      reason: 'not-configured',
      capabilities: null,
    });
    expect(agentRunnerRepository.getStatus).not.toHaveBeenCalled();
  });

  it('probes the configured runner and maps a healthy response', async () => {
    configRepository.getEnv.mockReturnValue({
      agent: {
        runnerUrl: 'http://agent-runner:4477',
        mcpGatewayUrl: 'http://immich-server:2283/api/agent/internal/mcp',
        runnerHealthTimeoutMs: 3000,
      },
    } as never);
    agentRunnerRepository.getStatus.mockResolvedValue({
      healthy: true,
      reason: 'healthy',
      version: '0.1.0',
      capabilities: {
        protocolVersion: '2026-05-14',
        streaming: true,
        tools: ['mcp:gallery'],
        models: [],
      },
    });

    await expect(sut.getStatus()).resolves.toEqual({
      configured: true,
      healthy: true,
      reason: 'healthy',
      version: '0.1.0',
      capabilities: {
        protocolVersion: '2026-05-14',
        streaming: true,
        tools: ['mcp:gallery'],
        models: [],
      },
      checkedAt: new Date('2026-05-14T10:00:00.000Z'),
    });
    expect(agentRunnerRepository.getStatus).toHaveBeenCalledWith({
      url: 'http://agent-runner:4477',
      timeoutMs: 3000,
    });
  });

  it('maps unhealthy probes while preserving configured=true', async () => {
    configRepository.getEnv.mockReturnValue({
      agent: {
        runnerUrl: 'http://agent-runner:4477',
        mcpGatewayUrl: 'http://immich-server:2283/api/agent/internal/mcp',
        runnerHealthTimeoutMs: 3000,
      },
    } as never);
    agentRunnerRepository.getStatus.mockResolvedValue({
      healthy: false,
      reason: 'timeout',
      version: null,
      capabilities: null,
    });

    await expect(sut.getStatus()).resolves.toMatchObject({
      configured: true,
      healthy: false,
      reason: 'timeout',
      version: null,
      capabilities: null,
    });
  });

  it('caches configured runner status briefly', async () => {
    configRepository.getEnv.mockReturnValue({
      agent: {
        runnerUrl: 'http://agent-runner:4477',
        mcpGatewayUrl: 'http://immich-server:2283/api/agent/internal/mcp',
        runnerHealthTimeoutMs: 3000,
      },
    } as never);
    agentRunnerRepository.getStatus.mockResolvedValue({
      healthy: true,
      reason: 'healthy',
      version: null,
      capabilities: { protocolVersion: null, streaming: false, tools: [], models: [] },
    });

    await sut.getStatus();
    await sut.getStatus();

    expect(agentRunnerRepository.getStatus).toHaveBeenCalledTimes(1);
  });

  it('refreshes cached status when runner config changes', async () => {
    configRepository.getEnv
      .mockReturnValueOnce({
        agent: {
          runnerUrl: 'http://agent-runner-a:4477',
          mcpGatewayUrl: 'http://immich-server:2283/api/agent/internal/mcp',
          runnerHealthTimeoutMs: 3000,
        },
      } as never)
      .mockReturnValueOnce({
        agent: {
          runnerUrl: 'http://agent-runner-b:4477',
          mcpGatewayUrl: 'http://immich-server:2283/api/agent/internal/mcp',
          runnerHealthTimeoutMs: 5000,
        },
      } as never);
    agentRunnerRepository.getStatus.mockResolvedValue({
      healthy: true,
      reason: 'healthy',
      version: null,
      capabilities: { protocolVersion: null, streaming: false, tools: [], models: [] },
    });

    await sut.getStatus();
    await sut.getStatus();

    expect(agentRunnerRepository.getStatus).toHaveBeenCalledTimes(2);
    expect(agentRunnerRepository.getStatus).toHaveBeenLastCalledWith({
      url: 'http://agent-runner-b:4477',
      timeoutMs: 5000,
    });
  });

  it('deduplicates concurrent configured runner status probes', async () => {
    configRepository.getEnv.mockReturnValue({
      agent: {
        runnerUrl: 'http://agent-runner:4477',
        mcpGatewayUrl: 'http://immich-server:2283/api/agent/internal/mcp',
        runnerHealthTimeoutMs: 3000,
      },
    } as never);

    let resolveProbe: (value: Awaited<ReturnType<AgentRunnerRepository['getStatus']>>) => void;
    agentRunnerRepository.getStatus.mockReturnValue(
      new Promise((resolve) => {
        resolveProbe = resolve;
      }),
    );

    const first = sut.getStatus();
    const second = sut.getStatus();

    expect(agentRunnerRepository.getStatus).toHaveBeenCalledTimes(1);

    resolveProbe!({
      healthy: true,
      reason: 'healthy',
      version: null,
      capabilities: { protocolVersion: null, streaming: false, tools: [], models: [] },
    });

    await expect(Promise.all([first, second])).resolves.toEqual([
      {
        configured: true,
        healthy: true,
        reason: 'healthy',
        version: null,
        capabilities: { protocolVersion: null, streaming: false, tools: [], models: [] },
        checkedAt: new Date('2026-05-14T10:00:00.000Z'),
      },
      {
        configured: true,
        healthy: true,
        reason: 'healthy',
        version: null,
        capabilities: { protocolVersion: null, streaming: false, tools: [], models: [] },
        checkedAt: new Date('2026-05-14T10:00:00.000Z'),
      },
    ]);
  });

  it('does not deduplicate concurrent probes for different runner configs', async () => {
    configRepository.getEnv
      .mockReturnValueOnce({
        agent: {
          runnerUrl: 'http://agent-runner-a:4477',
          mcpGatewayUrl: 'http://immich-server:2283/api/agent/internal/mcp',
          runnerHealthTimeoutMs: 3000,
        },
      } as never)
      .mockReturnValueOnce({
        agent: {
          runnerUrl: 'http://agent-runner-b:4477',
          mcpGatewayUrl: 'http://immich-server:2283/api/agent/internal/mcp',
          runnerHealthTimeoutMs: 5000,
        },
      } as never);

    let resolveFirst: (value: Awaited<ReturnType<AgentRunnerRepository['getStatus']>>) => void;
    let resolveSecond: (value: Awaited<ReturnType<AgentRunnerRepository['getStatus']>>) => void;
    agentRunnerRepository.getStatus
      .mockReturnValueOnce(
        new Promise((resolve) => {
          resolveFirst = resolve;
        }),
      )
      .mockReturnValueOnce(
        new Promise((resolve) => {
          resolveSecond = resolve;
        }),
      );

    const first = sut.getStatus();
    const second = sut.getStatus();

    expect(agentRunnerRepository.getStatus).toHaveBeenCalledTimes(2);
    expect(agentRunnerRepository.getStatus).toHaveBeenNthCalledWith(1, {
      url: 'http://agent-runner-a:4477',
      timeoutMs: 3000,
    });
    expect(agentRunnerRepository.getStatus).toHaveBeenNthCalledWith(2, {
      url: 'http://agent-runner-b:4477',
      timeoutMs: 5000,
    });

    resolveFirst!({
      healthy: true,
      reason: 'healthy',
      version: 'a',
      capabilities: { protocolVersion: null, streaming: false, tools: [], models: [] },
    });
    resolveSecond!({
      healthy: true,
      reason: 'healthy',
      version: 'b',
      capabilities: { protocolVersion: null, streaming: false, tools: [], models: [] },
    });

    await expect(first).resolves.toMatchObject({ version: 'a' });
    await expect(second).resolves.toMatchObject({ version: 'b' });
  });

  it('deduplicates matching runner configs when another config is also in flight', async () => {
    configRepository.getEnv
      .mockReturnValueOnce({
        agent: {
          runnerUrl: 'http://agent-runner-a:4477',
          mcpGatewayUrl: 'http://immich-server:2283/api/agent/internal/mcp',
          runnerHealthTimeoutMs: 3000,
        },
      } as never)
      .mockReturnValueOnce({
        agent: {
          runnerUrl: 'http://agent-runner-b:4477',
          mcpGatewayUrl: 'http://immich-server:2283/api/agent/internal/mcp',
          runnerHealthTimeoutMs: 5000,
        },
      } as never)
      .mockReturnValueOnce({
        agent: {
          runnerUrl: 'http://agent-runner-a:4477',
          mcpGatewayUrl: 'http://immich-server:2283/api/agent/internal/mcp',
          runnerHealthTimeoutMs: 3000,
        },
      } as never);

    let resolveFirst: (value: Awaited<ReturnType<AgentRunnerRepository['getStatus']>>) => void;
    let resolveSecond: (value: Awaited<ReturnType<AgentRunnerRepository['getStatus']>>) => void;
    agentRunnerRepository.getStatus
      .mockReturnValueOnce(
        new Promise((resolve) => {
          resolveFirst = resolve;
        }),
      )
      .mockReturnValueOnce(
        new Promise((resolve) => {
          resolveSecond = resolve;
        }),
      );

    const first = sut.getStatus();
    const second = sut.getStatus();
    const third = sut.getStatus();

    expect(agentRunnerRepository.getStatus).toHaveBeenCalledTimes(2);

    resolveFirst!({
      healthy: true,
      reason: 'healthy',
      version: 'a',
      capabilities: { protocolVersion: null, streaming: false, tools: [], models: [] },
    });
    resolveSecond!({
      healthy: true,
      reason: 'healthy',
      version: 'b',
      capabilities: { protocolVersion: null, streaming: false, tools: [], models: [] },
    });

    await expect(first).resolves.toMatchObject({ version: 'a' });
    await expect(second).resolves.toMatchObject({ version: 'b' });
    await expect(third).resolves.toMatchObject({ version: 'a' });
  });

  it('refreshes cached status after the cache window', async () => {
    configRepository.getEnv.mockReturnValue({
      agent: {
        runnerUrl: 'http://agent-runner:4477',
        mcpGatewayUrl: 'http://immich-server:2283/api/agent/internal/mcp',
        runnerHealthTimeoutMs: 3000,
      },
    } as never);
    agentRunnerRepository.getStatus.mockResolvedValue({
      healthy: true,
      reason: 'healthy',
      version: null,
      capabilities: { protocolVersion: null, streaming: false, tools: [], models: [] },
    });

    await sut.getStatus();
    vi.advanceTimersByTime(15_001);
    await sut.getStatus();

    expect(agentRunnerRepository.getStatus).toHaveBeenCalledTimes(2);
  });

  it('closes open lifecycle events after a successful turn', async () => {
    const sessionId = '00000000-0000-4000-8000-000000000100';
    const runnerSessionId = 'runner-session-1';
    const messageId = '00000000-0000-4000-8000-000000000200';
    const content: AgentMessageContent = { blocks: [{ type: 'text', text: 'Organize my photos.' }] };
    const assistantContent: AgentMessageContent = { blocks: [{ type: 'text', text: 'Done.' }] };

    configRepository.getEnv.mockReturnValue({
      agent: {
        runnerUrl: 'http://agent-runner:4477',
        runnerHealthTimeoutMs: 3000,
        runnerMessageStreamTimeoutMs: 120_000,
      },
    } as never);
    agentRunnerRepository.streamMessage.mockReturnValue(
      streamEvents([
        {
          type: 'assistant-message-completed',
          sessionId,
          runnerSessionId,
          providerMessageId: null,
          content: assistantContent,
        },
      ]),
    );
    messageRepository.create.mockResolvedValue(makeAssistantMessage({ sessionId, content: assistantContent }));
    sessionRepository.getById.mockResolvedValue({ status: AgentSessionStatus.Running } as never);

    await sut.sendMessage({ userId, sessionId, runnerSessionId, messageId, content });

    expect(activityService.closeOpenLifecycleEvents).toHaveBeenCalledWith(
      userId,
      sessionId,
      AgentSessionActivityEventStatus.Completed,
    );
  });

  it('does not close lifecycle events when pausing for tool approval', async () => {
    const sessionId = '00000000-0000-4000-8000-000000000100';
    const runnerSessionId = 'runner-session-1';
    const messageId = '00000000-0000-4000-8000-000000000200';
    const content: AgentMessageContent = { blocks: [{ type: 'text', text: 'How many photos are in this album?' }] };

    configRepository.getEnv.mockReturnValue({
      agent: {
        runnerUrl: 'http://agent-runner:4477',
        runnerHealthTimeoutMs: 3000,
        runnerMessageStreamTimeoutMs: 120_000,
      },
    } as never);
    agentRunnerRepository.streamMessage.mockReturnValue(
      streamEvents([
        {
          type: 'tool-approval-needed',
          sessionId,
          runnerSessionId,
          toolCallId: '00000000-0000-4000-8000-000000000333',
        },
      ]),
    );

    await sut.sendMessage({ userId, sessionId, runnerSessionId, messageId, content });

    expect(activityService.closeOpenLifecycleEvents).not.toHaveBeenCalled();
  });

  it('does not close lifecycle events on runner failure (failure event already records it)', async () => {
    const sessionId = '00000000-0000-4000-8000-000000000100';
    const runnerSessionId = 'runner-session-1';
    const messageId = '00000000-0000-4000-8000-000000000200';
    const content: AgentMessageContent = { blocks: [{ type: 'text', text: 'Organize my photos.' }] };
    const error = new Error('connection refused');

    configRepository.getEnv.mockReturnValue({
      agent: {
        runnerUrl: 'http://agent-runner:4477',
        runnerHealthTimeoutMs: 3000,
        runnerMessageStreamTimeoutMs: 120_000,
      },
    } as never);
    agentRunnerRepository.streamMessage.mockReturnValue(failingStream(error));
    sessionRepository.markInterruptedFromActive.mockResolvedValue({} as never);

    await expect(sut.sendMessage({ userId, sessionId, runnerSessionId, messageId, content })).rejects.toBe(error);

    expect(activityService.closeOpenLifecycleEvents).not.toHaveBeenCalled();
  });
});
