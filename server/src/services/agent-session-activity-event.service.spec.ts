import { BadRequestException } from '@nestjs/common';
import { AgentSession, AgentSessionActivityEvent } from 'src/database';
import { AgentSessionActivityEventCreateDto } from 'src/dtos/agent-session-activity-event.dto';
import {
  AgentApprovalMode,
  AgentPermissionPreset,
  AgentProviderType,
  AgentSessionActivityEventKind,
  AgentSessionActivityEventSource,
  AgentSessionActivityEventStatus,
  AgentSessionStatus,
} from 'src/enum';
import { AgentSessionActivityEventRepository } from 'src/repositories/agent-session-activity-event.repository';
import { AgentSessionRepository } from 'src/repositories/agent-session.repository';
import { WebsocketRepository } from 'src/repositories/websocket.repository';
import { AgentSessionActivityEventService } from 'src/services/agent-session-activity-event.service';
import { AuthFactory } from 'test/factories/auth.factory';
import { factory } from 'test/small.factory';
import { automock } from 'test/utils';

const makeSession = (overrides: Partial<AgentSession> = {}): AgentSession => ({
  id: factory.uuid(),
  userId: factory.uuid(),
  status: AgentSessionStatus.Running,
  title: null,
  providerCredentialId: factory.uuid(),
  credentialSnapshot: {
    id: factory.uuid(),
    providerType: AgentProviderType.OpenAI,
    label: 'OpenAI',
    baseUrl: null,
    models: ['gpt-5.1'],
    defaultModel: 'gpt-5.1',
  },
  modelSnapshot: { providerCredentialId: factory.uuid(), model: 'gpt-5.1' },
  permissionPreset: AgentPermissionPreset.Careful,
  permissionPlanSnapshot: {
    read: { metadata: true, previews: true, originals: false },
    providerExposure: { metadata: true, previews: true, originals: false, allowOriginalsForExternalProviders: false },
    assetScope: { owned: true, sharedSpaces: false, locked: false },
    writeScope: {
      createAlbum: true,
      addAssets: true,
      removeAssets: false,
      updateDetails: false,
      setCover: false,
      createSpace: false,
      addAssetsToSpaces: false,
      removeAssetsFromSpaces: false,
      updateSpaceDetails: false,
      editAssets: false,
      favoriteAssets: false,
      archiveAssets: false,
      tagAssets: false,
    },
    limits: {
      maxAssetsPerToolCall: 20,
      maxAssetsPerSession: 100,
      maxPreviewsPerToolCall: 10,
      maxOriginalsPerToolCall: 0,
      expiresInMinutes: 60,
    },
  },
  approvalMode: AgentApprovalMode.Strict,
  runnerEndpoint: 'http://agent-runner:4477',
  runnerSessionId: 'runner-session',
  runnerCapabilitiesSnapshot: { protocolVersion: '2026-05-14', streaming: true, tools: [], models: [] },
  workflowState: null,
  initialContextSnapshot: {},
  createdAt: new Date('2026-05-18T10:00:00.000Z'),
  updatedAt: new Date('2026-05-18T10:00:00.000Z'),
  updateId: factory.uuid(),
  endedAt: null,
  ...overrides,
});

const makeEvent = (overrides: Partial<AgentSessionActivityEvent> = {}): AgentSessionActivityEvent => ({
  id: factory.uuid(),
  sessionId: factory.uuid(),
  kind: AgentSessionActivityEventKind.StartProcessing,
  status: AgentSessionActivityEventStatus.Running,
  source: AgentSessionActivityEventSource.Server,
  summary: null,
  counts: null,
  createdAt: new Date('2026-05-18T10:00:00.000Z'),
  ...overrides,
});

describe(AgentSessionActivityEventService.name, () => {
  const auth = AuthFactory.create();
  let sut: AgentSessionActivityEventService;
  let repository: ReturnType<typeof automock<AgentSessionActivityEventRepository>>;
  let sessionRepository: ReturnType<typeof automock<AgentSessionRepository>>;
  let websocketRepository: ReturnType<typeof automock<WebsocketRepository>>;

  beforeEach(() => {
    repository = automock(AgentSessionActivityEventRepository, { args: [{} as never] });
    sessionRepository = automock(AgentSessionRepository, { args: [{} as never] });
    websocketRepository = automock(WebsocketRepository, { args: [{} as never, { setContext: () => {} } as never] });
    websocketRepository.clientSend.mockImplementation(() => {});
    sut = new AgentSessionActivityEventService(repository, sessionRepository, websocketRepository);
  });

  it('returns owned history ordered by repository order', async () => {
    const session = makeSession({ userId: auth.user.id });
    const first = makeEvent({ sessionId: session.id, createdAt: new Date('2026-05-18T10:01:00.000Z') });
    const second = makeEvent({ sessionId: session.id, createdAt: new Date('2026-05-18T10:01:00.000Z') });
    sessionRepository.getById.mockResolvedValue(session);
    repository.getBySessionId.mockResolvedValue([first, second]);

    await expect(sut.getHistory(auth, session.id)).resolves.toEqual([first, second]);

    expect(sessionRepository.getById).toHaveBeenCalledWith(auth.user.id, session.id);
    expect(repository.getBySessionId).toHaveBeenCalledWith(session.id);
  });

  it('returns an empty owned history', async () => {
    const session = makeSession({ userId: auth.user.id });
    sessionRepository.getById.mockResolvedValue(session);
    repository.getBySessionId.mockResolvedValue([]);

    await expect(sut.getHistory(auth, session.id)).resolves.toEqual([]);
  });

  it('rejects history for sessions not owned by the current user', async () => {
    sessionRepository.getById.mockImplementation(() => Promise.resolve(undefined as never));

    await expect(sut.getHistory(auth, factory.uuid())).rejects.toBeInstanceOf(BadRequestException);
  });

  it.each([AgentSessionStatus.Completed, AgentSessionStatus.Cancelled, AgentSessionStatus.Failed])(
    'ignores new events for terminal %s sessions',
    async (status) => {
      const session = makeSession({ userId: auth.user.id, status });
      sessionRepository.getById.mockResolvedValue(session);

      await expect(sut.create(auth, session.id, makeCreateDto())).resolves.toBeNull();

      expect(repository.create).not.toHaveBeenCalled();
    },
  );

  it('redacts secrets before persistence', async () => {
    const session = makeSession({ userId: auth.user.id });
    sessionRepository.getById.mockResolvedValue(session);
    repository.create.mockImplementation((event) =>
      Promise.resolve(
        makeEvent({
          ...event,
          createdAt: new Date('2026-05-18T10:00:00.000Z'),
        }),
      ),
    );

    const result = await sut.create(auth, session.id, makeCreateDto({ summary: 'Using Bearer sk-secret123456789' }));

    expect(result?.summary).toBe('Using Bearer [REDACTED]');
  });

  it('websockets persisted activity events', async () => {
    const session = makeSession({ userId: auth.user.id });
    const event = makeEvent({ sessionId: session.id });
    sessionRepository.getById.mockResolvedValue(session);
    repository.create.mockResolvedValue(event);

    await expect(sut.create(auth, session.id, makeCreateDto())).resolves.toEqual(event);

    expect(websocketRepository.clientSend).toHaveBeenCalledWith('on_agent_session_event', auth.user.id, {
      type: 'activity',
      sessionId: session.id,
      event,
      createdAt: event.createdAt.toISOString(),
    });
  });

  it('accepts apply progress while the session is applying', async () => {
    const session = makeSession({ userId: auth.user.id, status: AgentSessionStatus.Applying });
    const event = makeEvent({
      sessionId: session.id,
      kind: AgentSessionActivityEventKind.ApplyProgress,
      counts: { total: 5, applied: 2, skipped: 0, failed: 0 },
    });
    sessionRepository.getById.mockResolvedValue(session);
    repository.create.mockResolvedValue(event);

    await expect(
      sut.create(
        auth,
        session.id,
        makeCreateDto({
          kind: AgentSessionActivityEventKind.ApplyProgress,
          counts: { total: 5, applied: 2, skipped: 0, failed: 0 },
        }),
      ),
    ).resolves.toEqual(event);
  });

  it.each([
    AgentSessionActivityEventKind.StrictRouterDecision,
    AgentSessionActivityEventKind.StrictWorkflowOutcome,
    AgentSessionActivityEventKind.StrictSuccessGateBlock,
    AgentSessionActivityEventKind.StrictContinuation,
  ])('round-trips strict workflow observability runner event %s', (kind) => {
    const normalized = sut.normalizeRunnerEvent({
      type: 'activity',
      sessionId: factory.uuid(),
      runnerSessionId: 'runner-session',
      kind,
      status: AgentSessionActivityEventStatus.Completed,
      summary: 'matched=true via=regex',
    } as never);

    expect(normalized).not.toBeNull();
    expect(normalized?.kind).toBe(kind);
    expect(normalized?.source).toBe(AgentSessionActivityEventSource.Runner);
  });

  it('persists strict observability events as activity (not user chat) and websockets them as activity', async () => {
    const session = makeSession({ userId: auth.user.id });
    const event = makeEvent({
      sessionId: session.id,
      kind: AgentSessionActivityEventKind.StrictSuccessGateBlock,
      status: AgentSessionActivityEventStatus.Failed,
      source: AgentSessionActivityEventSource.Runner,
    });
    sessionRepository.getById.mockResolvedValue(session);
    repository.create.mockResolvedValue(event);

    const result = await sut.create(
      auth,
      session.id,
      makeCreateDto({
        kind: AgentSessionActivityEventKind.StrictSuccessGateBlock,
        status: AgentSessionActivityEventStatus.Failed,
        source: AgentSessionActivityEventSource.Runner,
        summary: 'planned outcome blocked: missing planId',
      }),
    );

    expect(result).toEqual(event);
    // Strict observability rides the activity channel; it is never surfaced as an
    // assistant message in the user-facing transcript.
    expect(websocketRepository.clientSend).toHaveBeenCalledWith(
      'on_agent_session_event',
      auth.user.id,
      expect.objectContaining({ type: 'activity', sessionId: session.id }),
    );
    const payload = websocketRepository.clientSend.mock.calls[0][2];
    expect((payload as { type: string }).type).toBe('activity');
    expect(payload).not.toHaveProperty('message');
  });

  it('suppresses prompt and reasoning summaries before persistence', async () => {
    const session = makeSession({ userId: auth.user.id });
    sessionRepository.getById.mockResolvedValue(session);
    repository.create.mockImplementation((event) =>
      Promise.resolve(
        makeEvent({
          ...event,
          createdAt: new Date('2026-05-18T10:00:00.000Z'),
        }),
      ),
    );

    const result = await sut.create(
      auth,
      session.id,
      makeCreateDto({
        summary: 'chain-of-thought: hidden reasoning',
      }),
    );

    expect(result?.summary).toBe('Activity update');
    expect(repository.create).toHaveBeenCalledWith(
      expect.objectContaining({
        summary: 'Activity update',
      }),
    );
  });

  describe('closeOpenLifecycleEvents', () => {
    it('inserts a terminal sibling for each lifecycle kind whose latest event is running', async () => {
      const session = makeSession();
      sessionRepository.getById.mockResolvedValue(session);
      repository.getBySessionId.mockResolvedValue([
        makeEvent({
          sessionId: session.id,
          kind: AgentSessionActivityEventKind.StartProcessing,
          status: AgentSessionActivityEventStatus.Running,
        }),
        makeEvent({
          sessionId: session.id,
          kind: AgentSessionActivityEventKind.PlanComposing,
          status: AgentSessionActivityEventStatus.Running,
        }),
      ]);
      const closer = makeEvent({ sessionId: session.id, status: AgentSessionActivityEventStatus.Completed });
      repository.create.mockResolvedValue(closer);

      const result = await sut.closeOpenLifecycleEvents(
        session.userId,
        session.id,
        AgentSessionActivityEventStatus.Completed,
      );

      expect(repository.create).toHaveBeenCalledTimes(2);
      expect(repository.create).toHaveBeenCalledWith({
        sessionId: session.id,
        kind: AgentSessionActivityEventKind.StartProcessing,
        status: AgentSessionActivityEventStatus.Completed,
        source: AgentSessionActivityEventSource.Server,
        summary: null,
        counts: null,
      });
      expect(repository.create).toHaveBeenCalledWith(
        expect.objectContaining({
          kind: AgentSessionActivityEventKind.PlanComposing,
          status: AgentSessionActivityEventStatus.Completed,
        }),
      );
      expect(websocketRepository.clientSend).toHaveBeenCalledWith(
        'on_agent_session_event',
        session.userId,
        expect.objectContaining({ type: 'activity', sessionId: session.id, event: closer }),
      );
      expect(result).toHaveLength(2);
    });

    it('is idempotent: inserts nothing when the latest lifecycle event is already terminal', async () => {
      const session = makeSession();
      sessionRepository.getById.mockResolvedValue(session);
      repository.getBySessionId.mockResolvedValue([
        makeEvent({
          kind: AgentSessionActivityEventKind.StartProcessing,
          status: AgentSessionActivityEventStatus.Running,
        }),
        makeEvent({
          kind: AgentSessionActivityEventKind.StartProcessing,
          status: AgentSessionActivityEventStatus.Completed,
        }),
      ]);

      await sut.closeOpenLifecycleEvents(session.userId, session.id, AgentSessionActivityEventStatus.Completed);

      expect(repository.create).not.toHaveBeenCalled();
    });

    it('never closes strict observability events', async () => {
      const session = makeSession();
      sessionRepository.getById.mockResolvedValue(session);
      repository.getBySessionId.mockResolvedValue([
        makeEvent({
          kind: AgentSessionActivityEventKind.StrictRouterDecision,
          status: AgentSessionActivityEventStatus.Running,
        }),
      ]);

      await sut.closeOpenLifecycleEvents(session.userId, session.id, AgentSessionActivityEventStatus.Completed);

      expect(repository.create).not.toHaveBeenCalled();
    });

    it('closes events even when the session is already terminal (cancel path)', async () => {
      const session = makeSession({ status: AgentSessionStatus.Cancelled });
      sessionRepository.getById.mockResolvedValue(session);
      repository.getBySessionId.mockResolvedValue([
        makeEvent({
          sessionId: session.id,
          kind: AgentSessionActivityEventKind.StartProcessing,
          status: AgentSessionActivityEventStatus.Running,
        }),
      ]);
      repository.create.mockResolvedValue(makeEvent({ status: AgentSessionActivityEventStatus.Skipped }));

      await sut.closeOpenLifecycleEvents(session.userId, session.id, AgentSessionActivityEventStatus.Skipped);

      expect(repository.create).toHaveBeenCalledWith(
        expect.objectContaining({
          kind: AgentSessionActivityEventKind.StartProcessing,
          status: AgentSessionActivityEventStatus.Skipped,
        }),
      );
    });

    it('returns empty without inserting when called with a non-terminal status', async () => {
      const session = makeSession();
      sessionRepository.getById.mockResolvedValue(session);
      repository.getBySessionId.mockResolvedValue([
        makeEvent({
          sessionId: session.id,
          kind: AgentSessionActivityEventKind.StartProcessing,
          status: AgentSessionActivityEventStatus.Running,
        }),
      ]);
      const result = await sut.closeOpenLifecycleEvents(
        session.userId,
        session.id,
        AgentSessionActivityEventStatus.Running,
      );
      expect(result).toEqual([]);
      expect(repository.create).not.toHaveBeenCalled();
    });

    it('returns empty and inserts nothing when the session is not found', async () => {
      sessionRepository.getById.mockResolvedValue(void 0);

      const result = await sut.closeOpenLifecycleEvents(
        factory.uuid(),
        factory.uuid(),
        AgentSessionActivityEventStatus.Completed,
      );

      expect(result).toEqual([]);
      expect(repository.create).not.toHaveBeenCalled();
    });
  });
});

const makeCreateDto = (
  overrides: Partial<AgentSessionActivityEventCreateDto> = {},
): AgentSessionActivityEventCreateDto => ({
  kind: AgentSessionActivityEventKind.StartProcessing,
  status: AgentSessionActivityEventStatus.Running,
  source: AgentSessionActivityEventSource.Server,
  summary: 'Starting',
  counts: null,
  ...overrides,
});
