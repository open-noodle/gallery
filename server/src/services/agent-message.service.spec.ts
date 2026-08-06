import { AgentMessage, AgentSession } from 'src/database';
import { AgentMessageCreateDto } from 'src/dtos/agent-message.dto';
import {
  AgentApprovalMode,
  AgentMessageRole,
  AgentPermissionPreset,
  AgentProviderType,
  AgentSessionStatus,
} from 'src/enum';
import { AgentMessageRepository } from 'src/repositories/agent-message.repository';
import { AgentSessionRepository } from 'src/repositories/agent-session.repository';
import { AgentMessageService } from 'src/services/agent-message.service';
import { AgentRunnerService } from 'src/services/agent-runner.service';
import { AgentPermissionPlanSnapshot } from 'src/types/agent-session.types';
import { AuthFactory } from 'test/factories/auth.factory';
import { newUuid } from 'test/small.factory';
import { automock } from 'test/utils';

const now = new Date('2026-05-14T12:00:00.000Z');
const permissionPlanSnapshot: AgentPermissionPlanSnapshot = {
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
    maxAssetsPerToolCall: 100,
    maxAssetsPerSession: 1000,
    maxPreviewsPerToolCall: 0,
    maxOriginalsPerToolCall: 0,
    expiresInMinutes: 60,
  },
};

const makeSession = (overrides: Partial<AgentSession> = {}): AgentSession => {
  const providerCredentialId = newUuid();

  return {
    id: newUuid(),
    userId: newUuid(),
    providerCredentialId,
    credentialSnapshot: {
      id: providerCredentialId,
      providerType: AgentProviderType.OpenAI,
      label: 'OpenAI personal',
      baseUrl: null,
      models: ['gpt-5.1'],
      defaultModel: 'gpt-5.1',
    },
    modelSnapshot: { providerCredentialId, model: 'gpt-5.1' },
    permissionPreset: AgentPermissionPreset.Careful,
    permissionPlanSnapshot,
    approvalMode: AgentApprovalMode.Strict,
    runnerEndpoint: null,
    runnerSessionId: null,
    runnerCapabilitiesSnapshot: null,
    workflowState: null,
    status: AgentSessionStatus.Running,
    initialContextSnapshot: {},
    title: null,
    createdAt: now,
    updatedAt: now,
    endedAt: null,
    updateId: newUuid(),
    ...overrides,
  };
};

const makeMessage = (overrides: Partial<AgentMessage> = {}): AgentMessage => ({
  id: newUuid(),
  sessionId: newUuid(),
  role: AgentMessageRole.User,
  content: { blocks: [{ type: 'text', text: 'Organize my photos.' }] },
  providerMessageId: null,
  toolCallId: null,
  createdAt: now,
  ...overrides,
});

describe(AgentMessageService.name, () => {
  let sut: AgentMessageService;
  let messageRepository: ReturnType<typeof automock<AgentMessageRepository>>;
  let sessionRepository: ReturnType<typeof automock<AgentSessionRepository>>;
  let agentRunnerService: ReturnType<typeof automock<AgentRunnerService>>;

  beforeEach(() => {
    messageRepository = automock(AgentMessageRepository, { args: [{} as never] });
    sessionRepository = automock(AgentSessionRepository, { args: [{} as never] });
    agentRunnerService = automock(AgentRunnerService);
    agentRunnerService.isSessionDispatchActive.mockReturnValue(false);
    sut = new AgentMessageService(messageRepository, sessionRepository, agentRunnerService);
  });

  it('appends a user message to an owned active session', async () => {
    const auth = AuthFactory.create();
    const session = makeSession({ userId: auth.user.id });
    const dto: AgentMessageCreateDto = {
      content: { blocks: [{ type: 'text', text: 'Organize my Portugal photos.' }] },
    };
    const saved = makeMessage({ sessionId: session.id, content: dto.content });

    sessionRepository.getById.mockResolvedValue(session);
    messageRepository.create.mockResolvedValue(saved);

    const result = await sut.appendUserMessage(auth, session.id, dto);

    expect(sessionRepository.getById).toHaveBeenCalledWith(auth.user.id, session.id);
    expect(messageRepository.create).toHaveBeenCalledWith({
      sessionId: session.id,
      role: AgentMessageRole.User,
      content: dto.content,
      providerMessageId: null,
      toolCallId: null,
    });
    expect(result).toEqual(saved);
  });

  it('queues appended user messages to the runner when a runner session exists', async () => {
    const auth = AuthFactory.create();
    const session = makeSession({ userId: auth.user.id, runnerSessionId: 'runner-session-1' });
    const dto: AgentMessageCreateDto = {
      content: { blocks: [{ type: 'text', text: 'Organize my Portugal photos.' }] },
    };
    const saved = makeMessage({ sessionId: session.id, content: dto.content });

    sessionRepository.getById.mockResolvedValue(session);
    messageRepository.create.mockResolvedValue(saved);
    agentRunnerService.sendMessage.mockReturnValue(new Promise<void>(() => {}));

    await expect(sut.appendUserMessage(auth, session.id, dto)).resolves.toEqual(saved);
    expect(agentRunnerService.sendMessage).toHaveBeenCalledWith({
      userId: auth.user.id,
      sessionId: session.id,
      runnerSessionId: 'runner-session-1',
      messageId: saved.id,
      content: saved.content,
    });
  });

  it('accepts follow-up user messages after plan apply returns the session to running', async () => {
    const auth = AuthFactory.create();
    const session = makeSession({
      userId: auth.user.id,
      status: AgentSessionStatus.Running,
      endedAt: null,
      runnerSessionId: 'runner-session-1',
    });
    const dto: AgentMessageCreateDto = {
      content: { blocks: [{ type: 'text', text: 'Now make a smaller album from that result.' }] },
    };
    const saved = makeMessage({ sessionId: session.id, content: dto.content });

    sessionRepository.getById.mockResolvedValue(session);
    messageRepository.create.mockResolvedValue(saved);
    agentRunnerService.sendMessage.mockReturnValue(new Promise<void>(() => {}));

    await expect(sut.appendUserMessage(auth, session.id, dto)).resolves.toEqual(saved);
    expect(messageRepository.create).toHaveBeenCalledWith({
      sessionId: session.id,
      role: AgentMessageRole.User,
      content: dto.content,
      providerMessageId: null,
      toolCallId: null,
    });
    expect(agentRunnerService.sendMessage).toHaveBeenCalledWith({
      userId: auth.user.id,
      sessionId: session.id,
      runnerSessionId: 'runner-session-1',
      messageId: saved.id,
      content: saved.content,
    });
  });

  it('does not fail the append request when asynchronous runner dispatch rejects', async () => {
    const auth = AuthFactory.create();
    const session = makeSession({ userId: auth.user.id, runnerSessionId: 'runner-session-1' });
    const dto: AgentMessageCreateDto = { content: { blocks: [{ type: 'text', text: 'Hello' }] } };
    const saved = makeMessage({ sessionId: session.id, content: dto.content });

    sessionRepository.getById.mockResolvedValue(session);
    messageRepository.create.mockResolvedValue(saved);
    agentRunnerService.sendMessage.mockRejectedValue(new Error('connection refused'));

    await expect(sut.appendUserMessage(auth, session.id, dto)).resolves.toEqual(saved);
  });

  it('rejects a new user message while the session already has an active runner dispatch', async () => {
    const auth = AuthFactory.create();
    const session = makeSession({ userId: auth.user.id, runnerSessionId: 'runner-session-1' });
    const dto: AgentMessageCreateDto = { content: { blocks: [{ type: 'text', text: 'Hello' }] } };

    sessionRepository.getById.mockResolvedValue(session);
    agentRunnerService.isSessionDispatchActive.mockReturnValue(true);

    await expect(sut.appendUserMessage(auth, session.id, dto)).rejects.toThrow(
      'Agent session already has a message in progress',
    );

    expect(messageRepository.create).not.toHaveBeenCalled();
    expect(agentRunnerService.sendMessage).not.toHaveBeenCalled();
  });

  it('persists the user message and skips dispatch before runner session creation', async () => {
    const auth = AuthFactory.create();
    const session = makeSession({ userId: auth.user.id, status: AgentSessionStatus.Created, runnerSessionId: null });
    const dto: AgentMessageCreateDto = { content: { blocks: [{ type: 'text', text: 'Hello' }] } };
    const saved = makeMessage({ sessionId: session.id, content: dto.content });

    sessionRepository.getById.mockResolvedValue(session);
    messageRepository.create.mockResolvedValue(saved);

    await expect(sut.appendUserMessage(auth, session.id, dto)).resolves.toEqual(saved);
    expect(agentRunnerService.sendMessage).not.toHaveBeenCalled();
  });

  it.each([
    AgentSessionStatus.Created,
    AgentSessionStatus.Running,
    AgentSessionStatus.WaitingForToolApproval,
    AgentSessionStatus.WaitingForPlanReview,
    AgentSessionStatus.Interrupted,
  ])('allows append while session status is %s', async (status) => {
    const auth = AuthFactory.create();
    const session = makeSession({ userId: auth.user.id, status });
    const dto: AgentMessageCreateDto = { content: { blocks: [{ type: 'text', text: 'Hello' }] } };
    const saved = makeMessage({ sessionId: session.id, content: dto.content });

    sessionRepository.getById.mockResolvedValue(session);
    messageRepository.create.mockResolvedValue(saved);

    await expect(sut.appendUserMessage(auth, session.id, dto)).resolves.toEqual(saved);
  });

  it.each([
    AgentSessionStatus.Applying,
    AgentSessionStatus.Completed,
    AgentSessionStatus.Cancelled,
    AgentSessionStatus.Failed,
  ])('rejects append while session status is %s', async (status) => {
    const auth = AuthFactory.create();
    const session = makeSession({ userId: auth.user.id, status });

    sessionRepository.getById.mockResolvedValue(session);

    await expect(
      sut.appendUserMessage(auth, session.id, { content: { blocks: [{ type: 'text', text: 'Hello' }] } }),
    ).rejects.toThrow('Agent session does not accept new messages');
    expect(messageRepository.create).not.toHaveBeenCalled();
  });

  it('rejects append for missing or cross-user sessions', async () => {
    const auth = AuthFactory.create();
    const sessionId = newUuid();

    sessionRepository.getById.mockResolvedValue(void 0);

    await expect(
      sut.appendUserMessage(auth, sessionId, { content: { blocks: [{ type: 'text', text: 'Hello' }] } }),
    ).rejects.toThrow('Agent session not found');
    expect(messageRepository.create).not.toHaveBeenCalled();
  });

  it('lists messages for an owned session', async () => {
    const auth = AuthFactory.create();
    const session = makeSession({ userId: auth.user.id });
    const messages = [
      makeMessage({ sessionId: session.id, role: AgentMessageRole.User }),
      makeMessage({ sessionId: session.id, role: AgentMessageRole.Assistant }),
    ];

    sessionRepository.getById.mockResolvedValue(session);
    messageRepository.getBySessionId.mockResolvedValue(messages);

    const result = await sut.getMessages(auth, session.id);

    expect(sessionRepository.getById).toHaveBeenCalledWith(auth.user.id, session.id);
    expect(messageRepository.getBySessionId).toHaveBeenCalledWith(session.id);
    expect(result).toEqual(messages);
  });

  it('rejects list for missing or cross-user sessions', async () => {
    const auth = AuthFactory.create();
    const sessionId = newUuid();

    sessionRepository.getById.mockResolvedValue(void 0);

    await expect(sut.getMessages(auth, sessionId)).rejects.toThrow('Agent session not found');
    expect(messageRepository.getBySessionId).not.toHaveBeenCalled();
  });
});
