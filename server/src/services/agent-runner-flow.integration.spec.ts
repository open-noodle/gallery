import { BadRequestException } from '@nestjs/common';
import { AgentMessage, AgentSession, AgentSessionActivityEvent, AgentToolCall } from 'src/database';
import {
  AgentApprovalMode,
  AgentMessageRole,
  AgentOperationApplyStatus,
  AgentOperationPlanStatus,
  AgentOperationRiskLevel,
  AgentOperationStatus,
  AgentOperationTargetKind,
  AgentOperationType,
  AgentPermissionPreset,
  AgentProviderType,
  AgentSessionActivityEventKind,
  AgentSessionActivityEventSource,
  AgentSessionActivityEventStatus,
  AgentSessionStatus,
  AgentToolApprovalDecision,
  AgentToolCallStatus,
  AgentToolDataClass,
  AgentToolName,
  AssetType,
  AssetVisibility,
} from 'src/enum';
import { AccessRepository } from 'src/repositories/access.repository';
import { AgentMessageRepository } from 'src/repositories/agent-message.repository';
import {
  AgentOperationPlanRepository,
  AgentOperationPlanWithOperations,
} from 'src/repositories/agent-operation-plan.repository';
import { AgentRunnerRepository } from 'src/repositories/agent-runner.repository';
import { AgentSelectionHandleRepository } from 'src/repositories/agent-selection-handle.repository';
import { AgentSessionRepository } from 'src/repositories/agent-session.repository';
import { AgentToolCallRepository } from 'src/repositories/agent-tool-call.repository';
import { AlbumRepository } from 'src/repositories/album.repository';
import { AssetRepository } from 'src/repositories/asset.repository';
import { ConfigRepository } from 'src/repositories/config.repository';
import { DuplicateRepository } from 'src/repositories/duplicate.repository';
import { LoggingRepository } from 'src/repositories/logging.repository';
import { MachineLearningRepository } from 'src/repositories/machine-learning.repository';
import { MapRepository } from 'src/repositories/map.repository';
import { PersonRepository } from 'src/repositories/person.repository';
import { SharedSpaceRepository } from 'src/repositories/shared-space.repository';
import { SystemMetadataRepository } from 'src/repositories/system-metadata.repository';
import { WebsocketRepository } from 'src/repositories/websocket.repository';
import { AgentAssetSearchFilterResolverService } from 'src/services/agent-asset-search-filter-resolver.service';
import { AgentMcpToolContractService } from 'src/services/agent-mcp-tool-contract.service';
import { AgentMcpToolRegistryService } from 'src/services/agent-mcp-tool-registry.service';
import { AgentMcpService } from 'src/services/agent-mcp.service';
import { AgentMessageService } from 'src/services/agent-message.service';
import { AgentOperationPlanService } from 'src/services/agent-operation-plan.service';
import { AgentProviderCredentialService } from 'src/services/agent-provider-credential.service';
import { AgentRunnerToolTokenService } from 'src/services/agent-runner-tool-token.service';
import { AgentRunnerService } from 'src/services/agent-runner.service';
import { AgentSessionActivityEventService } from 'src/services/agent-session-activity-event.service';
import { AgentSessionService } from 'src/services/agent-session.service';
import { AgentToolService } from 'src/services/agent-tool.service';
import type { TripCandidate } from 'src/services/trip-candidate.service';
import { AgentMcpSuccessResponse, AgentMcpToolCallResult } from 'src/types/agent-mcp.types';
import { AgentMessageContent } from 'src/types/agent-message.types';
import { AgentAlbumOperationInput } from 'src/types/agent-operation.types';
import { AgentAlbumSummary, AgentAssetMetadata, AgentSpaceSummary } from 'src/types/agent-tool.types';
import { AuthFactory } from 'test/factories/auth.factory';
import { newAccessRepositoryMock } from 'test/repositories/access.repository.mock';
import { newUuid } from 'test/small.factory';

const waitFor = async (assertion: () => void | Promise<void>) => {
  let lastError: unknown;

  for (let index = 0; index < 50; index++) {
    try {
      await assertion();
      return;
    } catch (error) {
      lastError = error;
      await new Promise((resolve) => setTimeout(resolve, 0));
    }
  }

  throw lastError;
};

const nonActivityEventTypes = (events: Array<{ event: Record<string, unknown> }>) =>
  events.map(({ event }) => event.type).filter((type) => type !== 'activity');

const makeMcpToolCallRequest = (toolName: AgentToolName, args: unknown) => ({
  jsonrpc: '2.0',
  id: `${toolName}-call-${newUuid()}`,
  method: 'tools/call',
  params: { name: toolName, arguments: args },
});

const getMcpToolResult = (response: unknown): AgentMcpToolCallResult => {
  expect(response).toMatchObject({ jsonrpc: '2.0', result: expect.any(Object) });
  return (response as AgentMcpSuccessResponse).result as AgentMcpToolCallResult;
};

const normalizeRunnerActivityEvent = (event: Record<string, unknown>) => ({
  kind: event.kind,
  status: event.status ?? AgentSessionActivityEventStatus.Running,
  source: AgentSessionActivityEventSource.Runner,
  summary: event.summary,
  counts: event.counts,
});

const now = () => new Date();

const album = (ownerId: string): AgentAlbumSummary => ({
  id: '00000000-0000-4000-8000-000000000301',
  albumName: 'Portugal',
  description: 'Summer trip',
  ownerId,
  assetCount: 1,
  startDate: new Date('2026-05-01T00:00:00.000Z'),
  endDate: new Date('2026-05-02T00:00:00.000Z'),
  albumThumbnailAssetId: null,
});

const space = (createdById: string): AgentSpaceSummary & { createdAt: Date; updatedAt: Date } => ({
  id: '00000000-0000-4000-8000-000000000401',
  name: 'Family',
  description: 'Shared family photos',
  color: 'blue',
  createdById,
  assetCount: 0,
  memberCount: 1,
  thumbnailAssetId: null,
  recentAssetIds: [],
  createdAt: new Date('2026-05-01T00:00:00.000Z'),
  updatedAt: new Date('2026-05-02T00:00:00.000Z'),
});

const resolveZero = () => Promise.resolve(0);

const metadata = (id: string): AgentAssetMetadata => ({
  id,
  ownerId: '00000000-0000-4000-8000-000000000101',
  type: AssetType.Image,
  originalFileName: `${id}.jpg`,
  localDateTime: new Date('2026-05-01T10:00:00.000Z'),
  fileCreatedAt: new Date('2026-05-01T10:00:00.000Z'),
  fileModifiedAt: new Date('2026-05-01T10:00:00.000Z'),
  isFavorite: false,
  visibility: AssetVisibility.Timeline,
  exifInfo: null,
  tags: [],
  qualityInfo: null,
});

type AcceptanceSearchCase = {
  name: string;
  prompt: string;
  request: Parameters<AgentToolService['searchAssets']>[2];
  expectedRequestSummary: string;
  expectedRequestMetadata: Record<string, unknown>;
  expectedSearchPath: 'metadata' | 'smart';
};

const fixedAssetId = '00000000-0000-4000-8000-000000000501';
const alexPersonId = '00000000-0000-4000-8000-000000000601';
const familySpaceId = '00000000-0000-4000-8000-000000000401';
const acceptanceReferenceDate = '2026-05-21';
const berlinLastSummerStart = new Date('2025-06-01T00:00:00.000Z');
const berlinLastSummerEnd = new Date('2025-08-31T23:59:59.999Z');
const invoiceScreenshotsStart = new Date('2024-01-01T00:00:00.000Z');
const invoiceScreenshotsEnd = new Date('2024-12-31T23:59:59.999Z');
const sonyMayStart = new Date('2026-05-01T00:00:00.000Z');
const sonyMayEnd = new Date('2026-05-21T23:59:59.999Z');

class InMemoryAgentSessionRepository {
  sessions = new Map<string, AgentSession>();

  create = vi.fn((dto: Partial<AgentSession>) => {
    const session: AgentSession = {
      id: newUuid(),
      userId: dto.userId!,
      providerCredentialId: dto.providerCredentialId ?? null,
      credentialSnapshot: dto.credentialSnapshot!,
      modelSnapshot: dto.modelSnapshot!,
      permissionPreset: dto.permissionPreset!,
      permissionPlanSnapshot: dto.permissionPlanSnapshot!,
      approvalMode: dto.approvalMode!,
      runnerEndpoint: dto.runnerEndpoint ?? null,
      runnerSessionId: dto.runnerSessionId ?? null,
      runnerCapabilitiesSnapshot: dto.runnerCapabilitiesSnapshot ?? null,
      workflowState: dto.workflowState ?? null,
      status: dto.status ?? AgentSessionStatus.Created,
      initialContextSnapshot: dto.initialContextSnapshot ?? {},
      title: dto.title ?? null,
      createdAt: now(),
      updatedAt: now(),
      endedAt: null,
      updateId: newUuid(),
    };
    this.sessions.set(session.id, session);
    return Promise.resolve(session);
  });

  getById = vi.fn((userId: string, id: string) => {
    const session = this.sessions.get(id);
    return Promise.resolve(session?.userId === userId ? session : undefined);
  });

  update = vi.fn(async (userId: string, id: string, dto: Partial<AgentSession>) => {
    const session = await this.getById(userId, id);
    if (!session) {
      throw new BadRequestException('Agent session not found');
    }

    const updated = { ...session, ...dto, updatedAt: now(), updateId: newUuid() };
    this.sessions.set(id, updated);
    return updated;
  });

  markRunningFromCreated = vi.fn(async (userId: string, id: string, dto: Partial<AgentSession>) => {
    const session = await this.getById(userId, id);
    if (!session || session.status !== AgentSessionStatus.Created) {
      return;
    }

    const updated = { ...session, ...dto, updatedAt: now(), updateId: newUuid() };
    this.sessions.set(id, updated);
    return updated;
  });

  markInterruptedFromActive = vi.fn(async (userId: string, id: string) => {
    const session = await this.getById(userId, id);
    if (
      !session ||
      ![
        AgentSessionStatus.Running,
        AgentSessionStatus.WaitingForToolApproval,
        AgentSessionStatus.WaitingForPlanReview,
        AgentSessionStatus.Interrupted,
      ].includes(session.status)
    ) {
      return;
    }

    const updated = { ...session, status: AgentSessionStatus.Interrupted, updatedAt: now(), updateId: newUuid() };
    this.sessions.set(id, updated);
    return updated;
  });
}

class InMemoryAgentMessageRepository {
  messages: AgentMessage[] = [];

  create = vi.fn((dto: Partial<AgentMessage>) => {
    const message: AgentMessage = {
      id: newUuid(),
      sessionId: dto.sessionId!,
      role: dto.role!,
      content: dto.content!,
      providerMessageId: dto.providerMessageId ?? null,
      toolCallId: dto.toolCallId ?? null,
      createdAt: now(),
    };
    this.messages.push(message);
    return Promise.resolve(message);
  });

  getBySessionId = vi.fn((sessionId: string) =>
    Promise.resolve(
      this.messages
        .filter((message) => message.sessionId === sessionId)
        .toSorted(
          (first, second) =>
            first.createdAt.getTime() - second.createdAt.getTime() || first.id.localeCompare(second.id),
        ),
    ),
  );
}

class InMemoryAgentToolCallRepository {
  toolCalls: AgentToolCall[] = [];

  create = vi.fn((dto: Partial<AgentToolCall>) => {
    const toolCall: AgentToolCall = {
      id: newUuid(),
      sessionId: dto.sessionId!,
      toolName: dto.toolName!,
      status: dto.status!,
      approvalDecision: dto.approvalDecision ?? null,
      requestSummary: dto.requestSummary!,
      responseSummary: dto.responseSummary ?? null,
      redactedRequestMetadata: dto.redactedRequestMetadata!,
      redactedResponseMetadata: dto.redactedResponseMetadata ?? null,
      dataClass: dto.dataClass!,
      assetCount: dto.assetCount ?? 0,
      albumCount: dto.albumCount ?? 0,
      providerSnapshot: dto.providerSnapshot!,
      startedAt: now(),
      completedAt: dto.completedAt ?? null,
      error: dto.error ?? null,
    };
    this.toolCalls.push(toolCall);
    return Promise.resolve(toolCall);
  });

  createWithSessionLimit = vi.fn(async (dto: Partial<AgentToolCall>) => ({
    status: 'created' as const,
    toolCall: await this.create(dto),
  }));

  getBySessionId = vi.fn((sessionId: string) =>
    Promise.resolve(
      this.toolCalls
        .filter((toolCall) => toolCall.sessionId === sessionId)
        .toSorted(
          (first, second) =>
            second.startedAt.getTime() - first.startedAt.getTime() || second.id.localeCompare(first.id),
        ),
    ),
  );

  getByIdForSession = vi.fn((sessionId: string, id: string) =>
    Promise.resolve(this.toolCalls.find((toolCall) => toolCall.sessionId === sessionId && toolCall.id === id)),
  );

  getCountedAssetCountBySession = vi.fn(resolveZero);
  getCountedAssetCountBySessionAndDataClass = vi.fn(resolveZero);

  transition = vi.fn(
    (sessionId: string, id: string, expectedStatus: AgentToolCallStatus, dto: Partial<AgentToolCall>) => {
      const index = this.toolCalls.findIndex(
        (toolCall) => toolCall.sessionId === sessionId && toolCall.id === id && toolCall.status === expectedStatus,
      );
      if (index === -1) {
        return Promise.resolve();
      }

      const updated = { ...this.toolCalls[index], ...dto };
      this.toolCalls[index] = updated;
      return Promise.resolve(updated);
    },
  );

  transitionWithSessionLimit = vi.fn(
    async (sessionId: string, id: string, expectedStatus: AgentToolCallStatus, dto: Partial<AgentToolCall>) => {
      const toolCall = await this.transition(sessionId, id, expectedStatus, dto);
      return toolCall ? { status: 'transitioned' as const, toolCall } : { status: 'stale' as const };
    },
  );
}

class InMemoryAgentSessionActivityEventService {
  activityEvents: AgentSessionActivityEvent[] = [];

  constructor(
    private readonly sessions: InMemoryAgentSessionRepository,
    private readonly websocketRepository: {
      clientSend: (eventName: string, userId: string, event: Record<string, unknown>) => void;
    },
  ) {}

  createSystemEvent = vi.fn(async (userId: string, sessionId: string, event: Record<string, unknown>) => {
    const session = await this.sessions.getById(userId, sessionId);
    if (!session) {
      return null;
    }

    const activityEvent: AgentSessionActivityEvent = {
      id: newUuid(),
      sessionId,
      kind: event.kind as AgentSessionActivityEventKind,
      status: (event.status ?? AgentSessionActivityEventStatus.Running) as AgentSessionActivityEventStatus,
      source: (event.source ?? AgentSessionActivityEventSource.Server) as AgentSessionActivityEventSource,
      summary: (event.summary as string | null | undefined) ?? null,
      counts: (event.counts as Record<string, number> | null | undefined) ?? null,
      createdAt: now(),
    };
    this.activityEvents.push(activityEvent);
    this.websocketRepository.clientSend('on_agent_session_event', userId, {
      type: 'activity',
      sessionId,
      event: activityEvent,
      createdAt: activityEvent.createdAt.toISOString(),
    });
    return activityEvent;
  });

  normalizeRunnerEvent = vi.fn(normalizeRunnerActivityEvent);

  getActivityHistory(sessionId: string) {
    return this.activityEvents.filter((event) => event.sessionId === sessionId);
  }
}

class InMemoryAgentSelectionHandleRepository {
  handles: Array<{
    id: string;
    sessionId: string;
    userId: string;
    sourceToolCallId: string | null;
    assetIds: string[];
    assetCount: number;
    sampleAssetIds: string[];
    expiresAt: Date;
    createdAt: Date;
    updateId: string;
  }> = [];

  create = vi.fn(
    (dto: {
      sessionId: string;
      userId: string;
      sourceToolCallId: string | null;
      assetIds: string[];
      expiresAt: Date;
    }) => {
      const assetIds = [...new Set(dto.assetIds)];
      const handle = {
        id: newUuid(),
        sessionId: dto.sessionId,
        userId: dto.userId,
        sourceToolCallId: dto.sourceToolCallId,
        assetIds,
        assetCount: assetIds.length,
        sampleAssetIds: assetIds.slice(0, 25),
        expiresAt: dto.expiresAt,
        createdAt: now(),
        updateId: newUuid(),
      };
      this.handles.push(handle);
      return Promise.resolve(handle);
    },
  );

  getValidForPlanning = vi.fn((dto: { id: string; sessionId: string; userId: string; now: Date }) =>
    Promise.resolve(
      this.handles.find(
        (handle) =>
          handle.id === dto.id &&
          handle.sessionId === dto.sessionId &&
          handle.userId === dto.userId &&
          handle.expiresAt > dto.now,
      ),
    ),
  );

  listValidForRecovery = vi.fn((dto: { sessionId: string; userId: string; now: Date; limit: number }) =>
    Promise.resolve(
      this.handles
        .filter(
          (handle) => handle.sessionId === dto.sessionId && handle.userId === dto.userId && handle.expiresAt > dto.now,
        )
        .toSorted(
          (first, second) =>
            second.createdAt.getTime() - first.createdAt.getTime() || second.id.localeCompare(first.id),
        )
        .slice(0, dto.limit)
        .map(({ id, assetCount, sourceToolCallId, createdAt, expiresAt }) => ({
          id,
          assetCount,
          sourceToolCallId,
          createdAt,
          expiresAt,
        })),
    ),
  );

  getForRecovery = vi.fn((dto: { id: string; sessionId: string; userId: string }) =>
    Promise.resolve(
      this.handles
        .filter((handle) => handle.id === dto.id && handle.sessionId === dto.sessionId && handle.userId === dto.userId)
        .map(({ id, assetCount, sourceToolCallId, createdAt, expiresAt }) => ({
          id,
          assetCount,
          sourceToolCallId,
          createdAt,
          expiresAt,
        }))[0],
    ),
  );
}

class InMemoryAgentOperationPlanRepository {
  plans: AgentOperationPlanWithOperations[] = [];

  constructor(private readonly sessions: InMemoryAgentSessionRepository) {}

  createReplacementRevision = vi.fn(
    (
      sessionId: string,
      dto: {
        plan: { sessionId: string; status: AgentOperationPlanStatus; summary: string };
        operations: AgentAlbumOperationInput[];
      },
    ) => {
      const session = this.sessions.sessions.get(sessionId);
      if (
        session &&
        [
          AgentSessionStatus.Applying,
          AgentSessionStatus.Completed,
          AgentSessionStatus.Cancelled,
          AgentSessionStatus.Interrupted,
          AgentSessionStatus.Failed,
        ].includes(session.status)
      ) {
        return;
      }

      for (const plan of this.plans) {
        if (plan.sessionId === sessionId && plan.status === AgentOperationPlanStatus.Proposed) {
          plan.status = AgentOperationPlanStatus.Superseded;
        }
      }

      const revision = this.plans.filter((plan) => plan.sessionId === sessionId).length + 1;
      const createdAt = now();
      const planId = newUuid();
      const operations = dto.operations.map((operation, position) => {
        const created = {
          id: newUuid(),
          planId,
          type: operation.type,
          position,
          summary: operation.summary,
          targetKind: operation.targetKind,
          targetId: operation.targetId ?? null,
          temporaryTargetId: operation.temporaryTargetId ?? null,
          assetIds: operation.assetIds ?? [],
          payload: operation.payload ?? {},
          dependencyIds: operation.dependencyIds ?? [],
          riskLevel: operation.riskLevel,
          enabled: operation.enabled,
          status: AgentOperationStatus.Proposed,
          result: null,
          error: null,
          createdAt,
          updatedAt: createdAt,
          updateId: newUuid(),
        };
        return created;
      });

      const plan: AgentOperationPlanWithOperations = {
        id: planId,
        sessionId,
        revision,
        status: dto.plan.status,
        summary: dto.plan.summary,
        createdAt,
        updatedAt: createdAt,
        operations,
      };
      this.plans.push(plan);
      return plan;
    },
  );

  getByIdForSession = vi.fn((sessionId: string, id: string) =>
    Promise.resolve(this.plans.find((plan) => plan.sessionId === sessionId && plan.id === id)),
  );

  getCurrentBySessionId = vi.fn((sessionId: string) =>
    Promise.resolve(
      this.plans
        .filter((plan) => plan.sessionId === sessionId && plan.status === AgentOperationPlanStatus.Proposed)
        .toSorted((first, second) => second.revision - first.revision)[0],
    ),
  );

  getAppliedBySessionId = vi.fn((sessionId: string) =>
    Promise.resolve(
      this.plans.filter((plan) => plan.sessionId === sessionId && plan.status === AgentOperationPlanStatus.Applied),
    ),
  );

  claimCurrentForApply = vi.fn((sessionId: string, planId: string) => {
    const session = this.sessions.sessions.get(sessionId);
    const plan = this.plans.find(
      (candidate) =>
        candidate.sessionId === sessionId &&
        candidate.id === planId &&
        candidate.status === AgentOperationPlanStatus.Proposed,
    );
    if (!session || session.status !== AgentSessionStatus.WaitingForPlanReview || !plan) {
      return Promise.resolve();
    }

    session.status = AgentSessionStatus.Applying;
    session.updatedAt = now();
    session.updateId = newUuid();
    plan.status = AgentOperationPlanStatus.Applied;
    plan.updatedAt = now();
    return Promise.resolve(plan);
  });

  completeApply = vi.fn(
    (
      planId: string,
      updates: Array<{ id: string; status: AgentOperationStatus; result: unknown; error: string | null }>,
    ) => {
      const plan = this.plans.find((candidate) => candidate.id === planId);
      if (!plan) {
        throw new Error(`Missing plan ${planId}`);
      }

      for (const update of updates) {
        const operation = plan.operations.find((candidate) => candidate.id === update.id);
        if (!operation) {
          continue;
        }

        operation.status = update.status;
        operation.result = update.result as never;
        operation.error = update.error;
        operation.updatedAt = now();
      }

      plan.updatedAt = now();
      return Promise.resolve(plan);
    },
  );
}

const setup = () => {
  const auth = AuthFactory.create();
  const sessions = new InMemoryAgentSessionRepository();
  const messages = new InMemoryAgentMessageRepository();
  const toolCalls = new InMemoryAgentToolCallRepository();
  const selectionHandles = new InMemoryAgentSelectionHandleRepository();
  const operationPlans = new InMemoryAgentOperationPlanRepository(sessions);
  const websocketEvents: Array<{ userId: string; event: Record<string, unknown> }> = [];
  const runnerResumeBodies: unknown[] = [];

  const toolServiceContainer = {} as { current: AgentToolService };
  let resumeMode: 'success' | 'error' = 'success';
  let runnerMessageHandler: (input: {
    body: { gallerySessionId: string; content: AgentMessageContent };
  }) => AsyncGenerator<Record<string, unknown>>;

  runnerMessageHandler = async function* ({ body }) {
    const result = await toolServiceContainer.current.listSpaces(auth, body.gallerySessionId, {});
    if (result.status !== 'approval-required') {
      throw new Error('Expected listSpaces to request approval');
    }

    yield {
      type: 'tool-approval-needed',
      sessionId: body.gallerySessionId,
      runnerSessionId: 'runner-session-1',
      toolCallId: result.toolCall.id,
    };
  };

  const runnerRepository = {
    createSession: vi.fn(() =>
      Promise.resolve({
        runnerSessionId: 'runner-session-1',
        capabilities: { protocolVersion: '2026-05-14', streaming: true, tools: ['gallery'], models: [] },
      }),
    ),
    streamMessage: vi.fn((input: { body: { gallerySessionId: string; content: AgentMessageContent } }) =>
      runnerMessageHandler(input),
    ),
    streamResume: vi.fn(async function* ({ body }: { body: { gallerySessionId: string } }) {
      await Promise.resolve();
      runnerResumeBodies.push(body);
      if (resumeMode === 'error') {
        yield {
          type: 'runner-error',
          sessionId: body.gallerySessionId,
          runnerSessionId: 'runner-session-1',
          message: 'Provider refused the resumed request.',
        };
        return;
      }

      yield {
        type: 'assistant-message-delta',
        sessionId: body.gallerySessionId,
        runnerSessionId: 'runner-session-1',
        delta: 'I found one space.',
        sequence: 1,
      };
      yield {
        type: 'assistant-message-completed',
        sessionId: body.gallerySessionId,
        runnerSessionId: 'runner-session-1',
        providerMessageId: 'provider-message-1',
        content: { blocks: [{ type: 'text', text: 'I found one space.' }] },
      };
    }),
  };

  const configRepository = {
    getEnv: vi.fn(() => ({
      agent: {
        runnerUrl: 'http://agent-runner:4477',
        mcpGatewayUrl: 'http://gallery:2283/api/agent/internal/mcp/',
        runnerHealthTimeoutMs: 3000,
        runnerMessageStreamTimeoutMs: 120_000,
      },
    })),
  };
  const websocketRepository = {
    clientSend: vi.fn((_eventName: string, userId: string, event: Record<string, unknown>) => {
      websocketEvents.push({ userId, event });
    }),
  };
  const toolTokenService = { create: vi.fn(() => 'runner-tool-token') };
  const activityService = new InMemoryAgentSessionActivityEventService(sessions, websocketRepository);

  const runnerService = new AgentRunnerService(
    configRepository as unknown as ConfigRepository,
    runnerRepository as unknown as AgentRunnerRepository,
    messages as unknown as AgentMessageRepository,
    sessions as unknown as AgentSessionRepository,
    websocketRepository as unknown as WebsocketRepository,
    toolTokenService as unknown as AgentRunnerToolTokenService,
    toolCalls as unknown as AgentToolCallRepository,
    activityService as never,
  );

  const credential = {
    id: '00000000-0000-4000-8000-000000000201',
    providerType: AgentProviderType.OpenAI,
    label: 'OpenAI personal',
    baseUrl: null,
    models: ['gpt-5.1'],
    defaultModel: 'gpt-5.1',
    createdAt: now(),
    updatedAt: now(),
    lastUsedAt: null,
  };
  const credentialService = {
    getById: vi.fn(() => Promise.resolve(credential)),
    getSecret: vi.fn(() => Promise.resolve('sk-test')),
  };

  const sessionService = new AgentSessionService(
    sessions as unknown as AgentSessionRepository,
    credentialService as unknown as AgentProviderCredentialService,
    runnerService,
    { closeOpenLifecycleEvents: vi.fn() } as unknown as AgentSessionActivityEventService,
  );
  const messageService = new AgentMessageService(
    messages as unknown as AgentMessageRepository,
    sessions as unknown as AgentSessionRepository,
    runnerService,
  );
  const albumRepository = { getAgentAlbums: vi.fn(() => Promise.resolve([album(auth.user.id)])) };
  const currentSpace = space(auth.user.id);
  const sharedSpaceRepository = {
    getAllByUserId: vi.fn(() => Promise.resolve([currentSpace])),
    getMembers: vi.fn(() =>
      Promise.resolve([
        {
          spaceId: currentSpace.id,
          userId: auth.user.id,
          role: 'owner',
          joinedAt: now(),
          showInTimeline: true,
          sharePersonMetadata: true,
          lastViewedAt: null,
          name: 'Pierre',
          email: 'pierre@example.com',
          profileImagePath: null,
          profileChangedAt: now(),
          avatarColor: null,
        },
      ]),
    ),
    getMember: vi.fn((spaceId: string, userId: string) =>
      Promise.resolve(
        spaceId === currentSpace.id && userId === auth.user.id ? { spaceId, userId, role: 'owner' } : null,
      ),
    ),
    getAssetCount: vi.fn(() => Promise.resolve(0)),
    getRecentAssets: vi.fn(() => Promise.resolve([])),
  };
  const accessRepository = newAccessRepositoryMock();
  const assetService = { updateAll: vi.fn(() => Promise.resolve()) };
  const assetRepository = {
    getAgentReadableIds: vi.fn((assetIds: Set<string>) => Promise.resolve(new Set(assetIds))),
    getAgentLockedIds: vi.fn(() => Promise.resolve(new Set())),
    getAgentMetadataByIds: vi.fn((assetIds: string[]) => Promise.resolve(assetIds.map((assetId) => metadata(assetId)))),
    getAgentMetadataReviewByIds: vi.fn((assetIds: string[]) =>
      Promise.resolve(
        assetIds.map((assetId) => ({
          id: assetId,
          exifInfo: {
            description: 'Old description',
            rating: null,
            dateTimeOriginal: new Date('2026-05-01T10:00:00.000Z'),
            timeZone: 'UTC',
            latitude: null,
            longitude: null,
          },
        })),
      ),
    ),
  };
  const searchRepository = {
    searchMetadata: vi.fn((_pagination?: unknown, _options?: unknown) =>
      Promise.resolve({ items: [] as Array<{ id: string }>, hasNextPage: false }),
    ),
    searchSmart: vi.fn((_pagination?: unknown, _options?: unknown) =>
      Promise.resolve({ items: [] as Array<{ id: string }>, hasNextPage: false }),
    ),
    getFilterSuggestions: vi.fn(() =>
      Promise.resolve({
        people: [] as Array<{ id: string; name: string }>,
        tags: [] as Array<{ id: string; value: string }>,
        countries: [] as string[],
        cameraMakes: [] as string[],
        ratings: [] as number[],
        mediaTypes: [] as string[],
        hasUnnamedPeople: false,
      }),
    ),
    getCameraModels: vi.fn(() => Promise.resolve([])),
    getCameraLensModels: vi.fn(() => Promise.resolve([])),
  };
  const machineLearningRepository = { encodeText: vi.fn(() => Promise.resolve('[1, 2, 3]')) };
  const systemMetadataRepository = {
    get: vi.fn(() =>
      Promise.resolve({
        machineLearning: { clip: { enabled: true, modelName: 'ViT-Test', maxDistance: 0.42 } },
      }),
    ),
  };
  const toolService = new AgentToolService(
    accessRepository as unknown as AccessRepository,
    assetRepository as unknown as AssetRepository,
    searchRepository as never,
    { error: vi.fn(), warn: vi.fn() } as unknown as LoggingRepository,
    { getEnv: vi.fn(() => ({ configFile: undefined })) } as unknown as ConfigRepository,
    machineLearningRepository as unknown as MachineLearningRepository,
    systemMetadataRepository as unknown as SystemMetadataRepository,
    albumRepository as unknown as AlbumRepository,
    sharedSpaceRepository as unknown as SharedSpaceRepository,
    { getAll: vi.fn(() => Promise.resolve([])) } as unknown as DuplicateRepository,
    sessions as unknown as AgentSessionRepository,
    selectionHandles as unknown as AgentSelectionHandleRepository,
    toolCalls as unknown as AgentToolCallRepository,
    runnerService,
    { search: vi.fn(() => Promise.resolve([])) } as never,
    new AgentAssetSearchFilterResolverService(
      searchRepository as never,
      albumRepository as unknown as AlbumRepository,
      sharedSpaceRepository as unknown as SharedSpaceRepository,
    ),
    { searchPlaces: vi.fn(() => Promise.resolve([])) } as unknown as MapRepository,
    { getByName: vi.fn(() => Promise.resolve([])) } as unknown as PersonRepository,
  );
  toolServiceContainer.current = toolService;
  const mcpToolContractService = new AgentMcpToolContractService();
  const operationPlanService = new AgentOperationPlanService(
    accessRepository as unknown as AccessRepository,
    assetRepository as unknown as AssetRepository,
    {} as never,
    sessions as unknown as AgentSessionRepository,
    selectionHandles as unknown as AgentSelectionHandleRepository,
    searchRepository as never,
    sharedSpaceRepository as unknown as SharedSpaceRepository,
    new AgentAssetSearchFilterResolverService(
      searchRepository as never,
      albumRepository as unknown as AlbumRepository,
      sharedSpaceRepository as unknown as SharedSpaceRepository,
    ),
    albumRepository as unknown as AlbumRepository,
    operationPlans as unknown as AgentOperationPlanRepository,
    toolCalls as unknown as AgentToolCallRepository,
    websocketRepository as unknown as WebsocketRepository,
    {} as never,
    assetService as never,
    {} as never,
    {} as never,
    {} as never,
    activityService as never,
    {} as never,
  );
  const mcpService = new AgentMcpService(
    new AgentMcpToolRegistryService(mcpToolContractService),
    mcpToolContractService,
    toolService,
    operationPlanService,
    {} as never,
  );

  return {
    auth,
    messageService,
    runnerRepository,
    runnerResumeBodies,
    sessionService,
    sessions,
    configureRunnerMessage: (
      handler: (input: {
        body: { gallerySessionId: string; content: AgentMessageContent };
      }) => AsyncGenerator<Record<string, unknown>>,
    ) => {
      runnerMessageHandler = handler;
    },
    accessRepository,
    assetService,
    assetRepository,
    machineLearningRepository,
    searchRepository,
    systemMetadataRepository,
    setResumeMode: (mode: 'success' | 'error') => {
      resumeMode = mode;
    },
    toolCalls,
    toolService,
    mcpService,
    operationPlans,
    operationPlanService,
    selectionHandles,
    getActivityHistory: (sessionId: string) => activityService.getActivityHistory(sessionId),
    websocketEvents,
  };
};

type AgentRunnerFlowHarness = ReturnType<typeof setup>;

const makeRecentUsaTripCandidate = (overrides: Partial<TripCandidate> = {}): TripCandidate => ({
  dedupeKey: 'trip:usa:new-york:2026-05-03:2026-05-12',
  title: 'Recent trip to New York, USA',
  subtitle: '4 photos over 10 days',
  countries: ['USA'],
  states: ['New York'],
  cities: ['New York'],
  takenAfter: new Date('2026-05-03T00:00:00.000Z'),
  takenBefore: new Date('2026-05-12T23:59:59.000Z'),
  assetCount: 4,
  albumAssetCount: 4,
  excludedDuplicateCount: 0,
  excludedStackChildCount: 0,
  dayCount: 10,
  score: 90,
  confidence: 'high',
  source: {
    kind: 'tripCandidate',
    dedupeKey: 'trip:usa:new-york:2026-05-03:2026-05-12',
    takenAfter: new Date('2026-05-03T00:00:00.000Z'),
    takenBefore: new Date('2026-05-12T23:59:59.000Z'),
    places: [{ country: 'USA', state: 'New York', city: 'New York' }],
    placeLabels: ['New York, USA'],
  },
  placeKey: 'USA|New York|New York',
  placeLabel: 'New York, USA',
  ...overrides,
});

const configureRecentTripCandidateHarness = (
  harness: AgentRunnerFlowHarness,
  options: { assetIds: string[]; candidate?: TripCandidate },
) => {
  const { assetIds } = options;
  const candidate =
    options.candidate ?? makeRecentUsaTripCandidate({ assetCount: assetIds.length, albumAssetCount: assetIds.length });

  harness.accessRepository.asset.checkOwnerAccess.mockResolvedValue(new Set(assetIds));
  harness.accessRepository.asset.checkSpaceAccess.mockResolvedValue(new Set());
  harness.assetRepository.getAgentReadableIds.mockResolvedValue(new Set(assetIds));
  (
    harness.toolService as unknown as {
      tripCandidateService: {
        findRecentTripCandidates: ReturnType<typeof vi.fn>;
        materializeAlbumReadySelection: ReturnType<typeof vi.fn>;
      };
    }
  ).tripCandidateService = {
    findRecentTripCandidates: vi.fn((request: { ownerId: string; placeHint?: string }) => {
      expect(request.ownerId).toBe(harness.auth.user.id);
      expect(request.placeHint).toBe('USA');
      return Promise.resolve([candidate]);
    }),
    materializeAlbumReadySelection: vi.fn((ownerId: string, source: TripCandidate['source']) => {
      expect(ownerId).toBe(harness.auth.user.id);
      expect(source.dedupeKey).toBe(candidate.dedupeKey);
      return Promise.resolve({
        assetIds,
        assetCount: assetIds.length,
        albumAssetCount: assetIds.length,
        excludedDuplicateCount: candidate.excludedDuplicateCount,
        excludedStackChildCount: candidate.excludedStackChildCount,
        hydrated: true,
      });
    }),
  };

  return { candidate };
};

describe('Pi agent runner flow harness', () => {
  it('creates a strict recent-trip album plan from the trip candidate handle', async () => {
    const harness = setup();
    const tripAssetIds = [newUuid(), newUuid(), newUuid(), newUuid()];
    const { candidate } = configureRecentTripCandidateHarness(harness, { assetIds: tripAssetIds });
    let tripCandidateSelectionHandleId: string | undefined;

    harness.configureRunnerMessage(async function* ({ body }) {
      const prompt = body.content.blocks
        .filter((block) => block.type === 'text')
        .map((block) => block.text)
        .join('\n');
      expect(prompt).toBe('Create an album for my recent trip to USA');

      const tripResult = getMcpToolResult(
        await harness.mcpService.handle(
          harness.auth,
          body.gallerySessionId,
          makeMcpToolCallRequest(AgentToolName.FindTripCandidates, { placeHint: 'USA' }),
        ),
      );
      expect(tripResult.isError).not.toBe(true);
      const tripContent = tripResult.structuredContent as {
        recommendation: { action: string; candidateDedupeKey?: string };
        candidates: Array<{
          dedupeKey: string;
          selectionHandle: { id: string; assetCount: number };
        }>;
      };
      expect(tripContent.recommendation).toMatchObject({
        action: 'use_top_candidate',
        candidateDedupeKey: candidate.dedupeKey,
      });
      expect(tripContent.candidates).toHaveLength(1);
      tripCandidateSelectionHandleId = tripContent.candidates[0].selectionHandle.id;
      expect(tripContent.candidates[0].selectionHandle.assetCount).toBe(tripAssetIds.length);

      const created = getMcpToolResult(
        await harness.mcpService.handle(
          harness.auth,
          body.gallerySessionId,
          makeMcpToolCallRequest(AgentToolName.ProposeAlbumFromSelection, {
            summary: `Create USA Trip with ${tripAssetIds.length} trip assets from New York, USA.`,
            albumName: 'USA Trip',
            description: 'Album-ready trip selection from New York, USA.',
            selectionHandleId: tripCandidateSelectionHandleId,
          }),
        ),
      );
      expect(created.isError).not.toBe(true);
      expect((created.structuredContent as { plan: { id: string } }).plan.id).toEqual(expect.any(String));

      yield {
        type: 'assistant-message-completed',
        sessionId: body.gallerySessionId,
        runnerSessionId: 'runner-session-1',
        providerMessageId: 'provider-message-strict-trip-plan',
        content: {
          blocks: [
            {
              type: 'text',
              text: `I found a likely New York, USA trip from May 3-12, 2026 and proposed USA Trip with ${tripAssetIds.length} assets. Review the plan before applying it.`,
            },
          ],
        },
      };
    });

    const session = await harness.sessionService.create(harness.auth, {
      providerCredentialId: '00000000-0000-4000-8000-000000000201',
      model: 'gpt-5.1',
      permissionPreset: AgentPermissionPreset.VisualOrganizer,
      approvalMode: AgentApprovalMode.PlanOnly,
      initialContext: { entrypoint: 'assistant-page' },
    });

    await harness.messageService.appendUserMessage(harness.auth, session.id, {
      content: {
        blocks: [{ type: 'text', text: 'Create an album for my recent trip to USA' }],
      },
    });

    await waitFor(async () => {
      const messages = await harness.messageService.getMessages(harness.auth, session.id);
      const reloadedSession = await harness.sessions.getById(harness.auth.user.id, session.id);
      expect(reloadedSession?.status).toBe(AgentSessionStatus.WaitingForPlanReview);
      expect(messages).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            role: AgentMessageRole.Assistant,
            providerMessageId: 'provider-message-strict-trip-plan',
            content: {
              blocks: [
                expect.objectContaining({
                  type: 'text',
                  text: expect.stringMatching(/May 3-12, 2026.*4 assets.*Review the plan/i),
                }),
              ],
            },
          }),
        ]),
      );
    });

    expect(tripCandidateSelectionHandleId).toEqual(expect.any(String));
    expect(harness.toolCalls.toolCalls.map((toolCall) => toolCall.toolName)).toEqual([
      AgentToolName.FindTripCandidates,
      AgentToolName.ProposeAlbumFromSelection,
    ]);
    expect(harness.toolCalls.toolCalls.map((toolCall) => toolCall.toolName)).not.toContain(AgentToolName.SearchAssets);
    expect(harness.searchRepository.searchMetadata).not.toHaveBeenCalled();
    expect(harness.searchRepository.searchSmart).not.toHaveBeenCalled();

    expect(harness.selectionHandles.handles).toHaveLength(1);
    expect(harness.selectionHandles.handles[0]).toMatchObject({
      id: tripCandidateSelectionHandleId,
      assetIds: tripAssetIds,
      assetCount: tripAssetIds.length,
    });

    expect(harness.operationPlans.plans).toHaveLength(1);
    const [plan] = harness.operationPlans.plans;
    expect(plan.status).toBe(AgentOperationPlanStatus.Proposed);
    expect(plan.operations).toHaveLength(2);
    expect(plan.operations[0]).toMatchObject({
      type: AgentOperationType.AlbumCreate,
      targetKind: AgentOperationTargetKind.NewAlbum,
      temporaryTargetId: 'tmp-album-from-selection',
      payload: { albumName: 'USA Trip', description: 'Album-ready trip selection from New York, USA.' },
    });
    expect(plan.operations[1]).toMatchObject({
      type: AgentOperationType.AlbumAddAssets,
      targetKind: AgentOperationTargetKind.NewAlbum,
      temporaryTargetId: 'tmp-album-from-selection',
      assetIds: tripAssetIds,
      payload: {},
    });
    expect(plan.operations[1]).not.toHaveProperty('assetSelectionHandleId');

    expect(harness.websocketEvents.map(({ event }) => event.type)).toContain('operation-plan-ready');

    const assistantMessages = await harness.messageService.getMessages(harness.auth, session.id);
    const assistantText = assistantMessages
      .filter((message) => message.role === AgentMessageRole.Assistant)
      .flatMap((message) => message.content.blocks)
      .filter((block) => block.type === 'text')
      .map((block) => block.text)
      .join('\n');
    expect(assistantText).not.toMatch(/rough dates|start and end|what dates|date range before/i);
  });

  it('does not show a strict recent-trip plan card or success copy when planning fails', async () => {
    const harness = setup();
    const tripAssetIds = [newUuid(), newUuid()];
    configureRecentTripCandidateHarness(harness, { assetIds: tripAssetIds });

    harness.configureRunnerMessage(async function* ({ body }) {
      const tripResult = getMcpToolResult(
        await harness.mcpService.handle(
          harness.auth,
          body.gallerySessionId,
          makeMcpToolCallRequest(AgentToolName.FindTripCandidates, { placeHint: 'USA' }),
        ),
      );
      expect(tripResult.isError).not.toBe(true);

      const denied = getMcpToolResult(
        await harness.mcpService.handle(
          harness.auth,
          body.gallerySessionId,
          makeMcpToolCallRequest(AgentToolName.ProposeAlbumFromSelection, {
            summary: 'Create USA Trip with an invalid trip handle.',
            albumName: 'USA Trip',
            description: 'Album-ready trip selection from New York, USA.',
            selectionHandleId: '00000000-0000-4000-8000-000000009999',
          }),
        ),
      );
      expect(denied.isError).toBe(true);

      yield {
        type: 'assistant-message-completed',
        sessionId: body.gallerySessionId,
        runnerSessionId: 'runner-session-1',
        providerMessageId: 'provider-message-strict-trip-failed-plan',
        content: {
          blocks: [
            {
              type: 'text',
              text: 'I could not create a reviewable album plan. Please try again or provide a more specific date range or place.',
            },
          ],
        },
      };
    });

    const session = await harness.sessionService.create(harness.auth, {
      providerCredentialId: '00000000-0000-4000-8000-000000000201',
      model: 'gpt-5.1',
      permissionPreset: AgentPermissionPreset.VisualOrganizer,
      approvalMode: AgentApprovalMode.PlanOnly,
      initialContext: { entrypoint: 'assistant-page' },
    });

    await harness.messageService.appendUserMessage(harness.auth, session.id, {
      content: {
        blocks: [{ type: 'text', text: 'Create an album for my recent trip to USA' }],
      },
    });

    await waitFor(async () => {
      const messages = await harness.messageService.getMessages(harness.auth, session.id);
      expect(messages).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            role: AgentMessageRole.Assistant,
            providerMessageId: 'provider-message-strict-trip-failed-plan',
          }),
        ]),
      );
    });

    const reloadedSession = await harness.sessions.getById(harness.auth.user.id, session.id);
    expect(reloadedSession?.status).toBe(AgentSessionStatus.Interrupted);
    expect(harness.operationPlans.plans).toHaveLength(0);
    expect(harness.websocketEvents.map(({ event }) => event.type)).not.toContain('operation-plan-ready');
    expect(harness.toolCalls.toolCalls.map((toolCall) => toolCall.toolName)).toEqual([
      AgentToolName.FindTripCandidates,
      AgentToolName.ProposeAlbumFromSelection,
    ]);
    expect(harness.toolCalls.toolCalls.map((toolCall) => toolCall.toolName)).not.toContain(AgentToolName.SearchAssets);

    const assistantMessages = await harness.messageService.getMessages(harness.auth, session.id);
    const assistantText = assistantMessages
      .filter((message) => message.role === AgentMessageRole.Assistant)
      .flatMap((message) => message.content.blocks)
      .filter((block) => block.type === 'text')
      .map((block) => block.text)
      .join('\n');
    expect(assistantText).toMatch(/could not create a reviewable album plan/i);
    expect(assistantText).not.toMatch(/plan is ready|I created|I proposed|Review the plan/i);
  });

  it('recovers from an example selection handle and creates a plan with resolved people filters', async () => {
    const harness = setup();
    const personAlphaId = newUuid();
    const personBetaId = newUuid();
    const assetIds = [newUuid(), newUuid(), newUuid()];
    const albumTemporaryTargetId = 'south-africa-people-album';
    const planSummary = 'Create South Africa people album.';
    const albumName = 'South Africa with Person Alpha and Person Beta (Jan 2026)';
    const exampleHandleId = '00000000-0000-4000-8000-000000000333';

    harness.searchRepository.getFilterSuggestions = vi.fn(() =>
      Promise.resolve({
        people: [
          { id: personAlphaId, name: 'Person Alpha' },
          { id: personBetaId, name: 'Person Beta' },
        ],
        tags: [],
        countries: [],
        cameraMakes: [],
        ratings: [],
        mediaTypes: [],
        hasUnnamedPeople: false,
      }),
    );
    harness.searchRepository.getCameraModels = vi.fn(() => Promise.resolve([]));
    harness.searchRepository.getCameraLensModels = vi.fn(() => Promise.resolve([]));
    harness.accessRepository.person.checkOwnerAccess.mockResolvedValue(new Set([personAlphaId, personBetaId]));
    harness.accessRepository.asset.checkOwnerAccess.mockResolvedValue(new Set(assetIds));
    harness.accessRepository.asset.checkSpaceAccess.mockResolvedValue(new Set());
    harness.assetRepository.getAgentReadableIds.mockResolvedValue(new Set(assetIds));
    harness.searchRepository.searchMetadata.mockResolvedValue({
      items: assetIds.map((id) => ({ id })) as never,
      hasNextPage: false,
    });

    let realHandleId: string | undefined;
    const proposeOperations = (assetSelectionHandleId: string): AgentAlbumOperationInput[] => [
      {
        type: AgentOperationType.AlbumCreate,
        summary: 'Create the destination album.',
        targetKind: AgentOperationTargetKind.NewAlbum,
        temporaryTargetId: albumTemporaryTargetId,
        payload: { albumName, description: 'January 2026 South Africa photos with selected people.' },
        riskLevel: AgentOperationRiskLevel.Low,
        enabled: true,
      },
      {
        type: AgentOperationType.AlbumAddAssets,
        summary: 'Add the matching photos.',
        targetKind: AgentOperationTargetKind.NewAlbum,
        temporaryTargetId: albumTemporaryTargetId,
        assetSelectionHandleId,
        payload: {},
        riskLevel: AgentOperationRiskLevel.Medium,
        enabled: true,
      },
    ];

    harness.configureRunnerMessage(async function* ({ body }) {
      const mcpService = harness.mcpService as AgentMcpService;
      const resolved = getMcpToolResult(
        await mcpService.handle(
          harness.auth,
          body.gallerySessionId,
          makeMcpToolCallRequest(AgentToolName.ResolveAssetSearchFilters, {
            people: ['Person Alpha', 'Person Beta'],
          }),
        ),
      );
      expect(resolved.isError).not.toBe(true);
      const resolvedContent = resolved.structuredContent as {
        resolvedFilters: { personIds: string[] };
      };
      expect(resolvedContent.resolvedFilters.personIds).toEqual([personAlphaId, personBetaId]);

      const search = getMcpToolResult(
        await mcpService.handle(
          harness.auth,
          body.gallerySessionId,
          makeMcpToolCallRequest(AgentToolName.SearchAssets, {
            filters: {
              ...resolvedContent.resolvedFilters,
              country: 'South Africa',
              takenAfter: '2026-01-01T00:00:00.000Z',
              takenBefore: '2026-01-31T23:59:59.999Z',
            },
            detail: 'ids',
            limit: 50,
            createSelectionHandle: true,
            sampleSize: 2,
          }),
        ),
      );
      expect(search.isError).not.toBe(true);
      const searchContent = search.structuredContent as {
        selectionHandle: { id: string; assetCount: number };
      };
      realHandleId = searchContent.selectionHandle.id;
      expect(realHandleId).toEqual(expect.any(String));
      expect(searchContent.selectionHandle.assetCount).toBe(3);
      expect(searchContent).not.toHaveProperty('assetIds');
      expect(searchContent.selectionHandle).not.toHaveProperty('sampleAssetIds');

      const denied = getMcpToolResult(
        await mcpService.handle(
          harness.auth,
          body.gallerySessionId,
          makeMcpToolCallRequest(AgentToolName.ProposeAlbumOperations, {
            summary: planSummary,
            operations: proposeOperations(exampleHandleId),
          }),
        ),
      );
      expect(denied.isError).toBe(true);
      const deniedContent = denied.structuredContent as {
        recovery: {
          kind: string;
          looksLikeExamplePlaceholder: boolean;
          availableSelectionHandles: Array<{ id: string }>;
        };
      };
      expect(deniedContent.recovery.kind).toBe('invalid-selection-handle');
      expect(deniedContent.recovery.looksLikeExamplePlaceholder).toBe(true);
      expect(deniedContent.recovery.availableSelectionHandles[0].id).toBe(realHandleId);
      expect(harness.operationPlans.plans).toHaveLength(0);

      const created = getMcpToolResult(
        await mcpService.handle(
          harness.auth,
          body.gallerySessionId,
          makeMcpToolCallRequest(AgentToolName.ProposeAlbumOperations, {
            summary: planSummary,
            operations: proposeOperations(realHandleId!),
          }),
        ),
      );
      expect(created.isError).not.toBe(true);
      expect((created.structuredContent as { plan: { id: string } }).plan.id).toEqual(expect.any(String));
      expect(harness.operationPlans.plans).toHaveLength(1);

      yield {
        type: 'assistant-message-completed',
        sessionId: body.gallerySessionId,
        runnerSessionId: 'runner-session-1',
        providerMessageId: 'provider-message-plan',
        content: { blocks: [{ type: 'text', text: 'I prepared the album plan.' }] },
      };
    });

    const session = await harness.sessionService.create(harness.auth, {
      providerCredentialId: '00000000-0000-4000-8000-000000000201',
      model: 'gpt-5.1',
      permissionPreset: AgentPermissionPreset.VisualOrganizer,
      approvalMode: AgentApprovalMode.PlanOnly,
      initialContext: { entrypoint: 'assistant-page' },
    });

    await harness.messageService.appendUserMessage(harness.auth, session.id, {
      content: {
        blocks: [{ type: 'text', text: 'Create an album for Person Alpha and Person Beta in South Africa.' }],
      },
    });

    await waitFor(async () => {
      const messages = await harness.messageService.getMessages(harness.auth, session.id);
      const reloadedSession = await harness.sessions.getById(harness.auth.user.id, session.id);
      expect(messages).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            role: AgentMessageRole.Assistant,
            providerMessageId: 'provider-message-plan',
          }),
        ]),
      );
      expect(reloadedSession?.status).toBe(AgentSessionStatus.WaitingForPlanReview);
    });

    const searchOptions = harness.searchRepository.searchMetadata.mock.calls[0]?.[1];
    expect(harness.searchRepository.searchMetadata).toHaveBeenCalledTimes(1);
    expect(searchOptions).toEqual(
      expect.objectContaining({
        personIds: [personAlphaId, personBetaId],
        country: 'South Africa',
        takenAfter: new Date('2026-01-01T00:00:00.000Z'),
        takenBefore: new Date('2026-01-31T23:59:59.999Z'),
      }),
    );

    expect(harness.operationPlans.plans).toHaveLength(1);
    const [plan] = harness.operationPlans.plans;
    expect(plan.status).toBe(AgentOperationPlanStatus.Proposed);
    expect(plan.summary).toBe(planSummary);
    expect(plan.operations.map((operation) => operation.temporaryTargetId)).toEqual([
      albumTemporaryTargetId,
      albumTemporaryTargetId,
    ]);
    expect(plan.operations[1]).toEqual(
      expect.objectContaining({
        type: AgentOperationType.AlbumAddAssets,
        assetIds,
      }),
    );
    expect(plan.operations[1]).not.toHaveProperty('assetSelectionHandleId');

    const proposeToolCalls = harness.toolCalls.toolCalls.filter(
      (toolCall) => toolCall.toolName === AgentToolName.ProposeAlbumOperations,
    );
    expect(proposeToolCalls.filter((toolCall) => toolCall.status === AgentToolCallStatus.Denied)).toHaveLength(1);
    expect(proposeToolCalls.filter((toolCall) => toolCall.status === AgentToolCallStatus.Completed)).toHaveLength(1);
    expect(harness.websocketEvents.map(({ event }) => event.type)).toContain('operation-plan-ready');
  });

  it('creates a metadata update plan from an assistant prompt and continues after apply', async () => {
    const harness = setup();
    const assetIds = [newUuid(), newUuid()];
    const planSummary = 'Set description on newest photos.';

    harness.searchRepository.searchMetadata.mockResolvedValue({
      items: assetIds.map((id) => ({ id })) as never,
      hasNextPage: false,
    });
    harness.accessRepository.asset.checkOwnerAccess.mockResolvedValue(new Set(assetIds));
    harness.accessRepository.asset.checkSpaceAccess.mockResolvedValue(new Set());
    harness.accessRepository.asset.checkSpaceEditAccess.mockResolvedValue(new Set());
    harness.assetRepository.getAgentReadableIds.mockResolvedValue(new Set(assetIds));

    harness.configureRunnerMessage(async function* ({ body }) {
      const text = body.content.blocks
        .filter((block) => block.type === 'text')
        .map((block) => block.text)
        .join('\n');

      if (text === 'Set the description on the 5 newest photos to Test batch.') {
        const created = getMcpToolResult(
          await harness.mcpService.handle(
            harness.auth,
            body.gallerySessionId,
            makeMcpToolCallRequest(AgentToolName.ProposeAssetBatchFromSearch, {
              summary: planSummary,
              action: { type: AgentOperationType.AssetUpdateMetadata, description: 'Test batch' },
              assetSource: { kind: 'search', filters: {}, materialization: 'all-matches-with-limit' },
            }),
          ),
        );
        expect(created.isError).not.toBe(true);

        yield {
          type: 'assistant-message-completed',
          sessionId: body.gallerySessionId,
          runnerSessionId: 'runner-session-1',
          providerMessageId: 'provider-message-metadata-plan',
          content: { blocks: [{ type: 'text', text: 'I prepared the metadata update plan.' }] },
        };
        return;
      }

      yield {
        type: 'assistant-message-completed',
        sessionId: body.gallerySessionId,
        runnerSessionId: 'runner-session-1',
        providerMessageId: 'provider-message-after-metadata-apply',
        content: { blocks: [{ type: 'text', text: 'The chat is ready for another request.' }] },
      };
    });

    const session = await harness.sessionService.create(harness.auth, {
      providerCredentialId: '00000000-0000-4000-8000-000000000201',
      model: 'gpt-5.1',
      permissionPreset: AgentPermissionPreset.VisualOrganizer,
      approvalMode: AgentApprovalMode.PlanOnly,
      initialContext: { entrypoint: 'assistant-page' },
    });

    await harness.messageService.appendUserMessage(harness.auth, session.id, {
      content: {
        blocks: [{ type: 'text', text: 'Set the description on the 5 newest photos to Test batch.' }],
      },
    });

    await waitFor(async () => {
      const reloadedSession = await harness.sessions.getById(harness.auth.user.id, session.id);
      const messages = await harness.messageService.getMessages(harness.auth, session.id);
      expect(reloadedSession?.status).toBe(AgentSessionStatus.WaitingForPlanReview);
      expect(messages).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            role: AgentMessageRole.Assistant,
            providerMessageId: 'provider-message-metadata-plan',
          }),
        ]),
      );
    });

    expect(harness.operationPlans.plans).toHaveLength(1);
    const [plan] = harness.operationPlans.plans;
    expect(plan).toMatchObject({
      status: AgentOperationPlanStatus.Proposed,
      summary: planSummary,
    });
    expect(plan.operations).toHaveLength(1);
    expect(plan.operations[0]).toMatchObject({
      type: AgentOperationType.AssetUpdateMetadata,
      targetKind: AgentOperationTargetKind.AssetBatch,
      assetIds,
      payload: { description: 'Test batch' },
    });

    const applyResult = await harness.operationPlanService.applyApprovedOperations(harness.auth, session.id, plan.id, {
      operationIds: [plan.operations[0].id],
    });

    expect(applyResult).toMatchObject({
      status: AgentOperationApplyStatus.Applied,
      appliedOperationIds: [plan.operations[0].id],
      failedOperationIds: [],
      skippedOperationIds: [],
    });
    expect(harness.assetService.updateAll).toHaveBeenCalledWith(harness.auth, {
      ids: assetIds,
      description: 'Test batch',
    });
    await waitFor(async () => {
      const reloadedSession = await harness.sessions.getById(harness.auth.user.id, session.id);
      expect(reloadedSession?.status).toBe(AgentSessionStatus.Running);
    });

    await harness.messageService.appendUserMessage(harness.auth, session.id, {
      content: { blocks: [{ type: 'text', text: 'Thanks, keep going.' }] },
    });

    await waitFor(async () => {
      const messages = await harness.messageService.getMessages(harness.auth, session.id);
      const reloadedSession = await harness.sessions.getById(harness.auth.user.id, session.id);
      expect(reloadedSession?.status).toBe(AgentSessionStatus.Running);
      expect(messages).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            role: AgentMessageRole.Assistant,
            providerMessageId: 'provider-message-after-metadata-apply',
          }),
        ]),
      );
    });
  });

  it('asks for coordinates for a place-name metadata prompt without creating a plan', async () => {
    const harness = setup();

    harness.configureRunnerMessage(async function* ({ body }) {
      await Promise.resolve();
      expect(body.content).toEqual({ blocks: [{ type: 'text', text: 'Set these photos to Paris.' }] });

      yield {
        type: 'assistant-message-completed',
        sessionId: body.gallerySessionId,
        runnerSessionId: 'runner-session-1',
        providerMessageId: 'provider-message-coordinate-clarification',
        content: {
          blocks: [
            {
              type: 'text',
              text: 'I can update location metadata when you provide explicit latitude and longitude.',
            },
          ],
        },
      };
    });

    const session = await harness.sessionService.create(harness.auth, {
      providerCredentialId: '00000000-0000-4000-8000-000000000201',
      model: 'gpt-5.1',
      permissionPreset: AgentPermissionPreset.VisualOrganizer,
      approvalMode: AgentApprovalMode.PlanOnly,
      initialContext: { entrypoint: 'assistant-page' },
    });

    await harness.messageService.appendUserMessage(harness.auth, session.id, {
      content: { blocks: [{ type: 'text', text: 'Set these photos to Paris.' }] },
    });

    await waitFor(async () => {
      const messages = await harness.messageService.getMessages(harness.auth, session.id);
      const reloadedSession = await harness.sessions.getById(harness.auth.user.id, session.id);
      expect(reloadedSession?.status).toBe(AgentSessionStatus.Running);
      expect(messages).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            role: AgentMessageRole.Assistant,
            providerMessageId: 'provider-message-coordinate-clarification',
            content: {
              blocks: [
                expect.objectContaining({
                  type: 'text',
                  text: expect.stringMatching(/latitude and longitude/i),
                }),
              ],
            },
          }),
        ]),
      );
    });

    expect(harness.operationPlans.plans).toHaveLength(0);
    expect(
      harness.toolCalls.toolCalls.filter((toolCall) => toolCall.toolName === AgentToolName.ProposeAssetBatchFromSearch),
    ).toHaveLength(0);
  });

  it('returns truncated metadata results with omitted fields without leaking inaccessible assets', async () => {
    const harness = setup();
    const visibleAssetIds = [newUuid(), newUuid(), newUuid()];
    const inaccessibleAssetId = newUuid();
    const session = await harness.sessionService.create(harness.auth, {
      providerCredentialId: '00000000-0000-4000-8000-000000000201',
      model: 'gpt-5.1',
      permissionPreset: AgentPermissionPreset.VisualOrganizer,
      approvalMode: AgentApprovalMode.PlanOnly,
      initialContext: {},
    });

    harness.accessRepository.asset.checkOwnerAccess.mockResolvedValue(new Set(visibleAssetIds));
    harness.accessRepository.asset.checkSpaceAccess.mockResolvedValue(new Set());
    harness.assetRepository.getAgentReadableIds.mockResolvedValue(new Set(visibleAssetIds));
    harness.assetRepository.getAgentMetadataByIds.mockResolvedValue(visibleAssetIds.map((id) => metadata(id)) as never);
    vi.spyOn(
      harness.toolService as unknown as { getReadToolResponseBudgetBytes: () => number },
      'getReadToolResponseBudgetBytes',
    ).mockReturnValue(256);

    const result = await harness.toolService.readAssetMetadata(harness.auth, session.id, {
      assetIds: visibleAssetIds,
      detail: 'allSafe',
    });

    expect(result.status).toBe('success');
    if (result.status !== 'success') {
      return;
    }

    expect(result.resultSize).toEqual(
      expect.objectContaining({
        truncated: true,
        omittedFields: ['assets'],
      }),
    );
    expect(JSON.stringify(result)).not.toContain(inaccessibleAssetId);

    const denied = await harness.toolService.readAssetMetadata(harness.auth, session.id, {
      assetIds: [visibleAssetIds[0], inaccessibleAssetId],
      detail: 'basic',
    });

    expect(denied.status).toBe('denied');
    expect(JSON.stringify(denied)).not.toContain(inaccessibleAssetId);
  });

  it('keeps stable paging order when multiple compact search pages accumulate size telemetry', async () => {
    const harness = setup();
    const pageOneIds = [newUuid(), newUuid()];
    const pageTwoIds = [newUuid()];
    const allAssetIds = [...pageOneIds, ...pageTwoIds];
    const session = await harness.sessionService.create(harness.auth, {
      providerCredentialId: '00000000-0000-4000-8000-000000000201',
      model: 'gpt-5.1',
      permissionPreset: AgentPermissionPreset.VisualOrganizer,
      approvalMode: AgentApprovalMode.PlanOnly,
      initialContext: {},
    });

    harness.searchRepository.searchMetadata
      .mockResolvedValueOnce({
        items: pageOneIds.map((id) => ({ id })) as never,
        hasNextPage: true,
      })
      .mockResolvedValueOnce({
        items: pageTwoIds.map((id) => ({ id })) as never,
        hasNextPage: false,
      });
    harness.accessRepository.asset.checkOwnerAccess.mockImplementation((_userId, assetIds: Set<string>) =>
      Promise.resolve(new Set([...assetIds].filter((id) => allAssetIds.includes(id)))),
    );
    harness.accessRepository.asset.checkSpaceAccess.mockResolvedValue(new Set());
    harness.assetRepository.getAgentReadableIds.mockResolvedValue(new Set(allAssetIds));

    const first = await harness.toolService.searchAssets(harness.auth, session.id, {
      filters: {},
      limit: 2,
      page: 1,
      detail: 'ids',
    });
    const second = await harness.toolService.searchAssets(harness.auth, session.id, {
      filters: {},
      limit: 2,
      page: 2,
      detail: 'ids',
    });

    expect(first.status).toBe('success');
    expect(second.status).toBe('success');
    if (first.status !== 'success' || second.status !== 'success') {
      return;
    }

    expect(first.selectionHandle.assetCount).toBe(pageOneIds.length);
    expect(first.resultSize).toMatchObject({ returnedItems: 2, hasMore: true, nextPage: '2' });
    expect(second.selectionHandle.assetCount).toBe(pageTwoIds.length);
    expect(second.resultSize).toMatchObject({ returnedItems: 1, hasMore: false, nextPage: null });
  });

  const expectAcceptanceSearchFlow = async (testCase: AcceptanceSearchCase) => {
    const harness = setup();
    const isSpaceScopedSearch = testCase.request.filters?.spaceId === familySpaceId;
    harness.accessRepository.asset.checkOwnerAccess.mockResolvedValue(
      isSpaceScopedSearch ? new Set() : new Set([fixedAssetId]),
    );
    harness.accessRepository.asset.checkSpaceAccess.mockResolvedValue(
      isSpaceScopedSearch ? new Set([fixedAssetId]) : new Set(),
    );
    harness.accessRepository.person.checkOwnerAccess.mockResolvedValue(new Set([alexPersonId]));
    harness.searchRepository.searchMetadata.mockResolvedValue({
      items: [{ id: fixedAssetId }] as never,
      hasNextPage: false,
    });
    harness.searchRepository.searchSmart.mockResolvedValue({
      items: [{ id: fixedAssetId }] as never,
      hasNextPage: false,
    });
    harness.assetRepository.getAgentMetadataByIds.mockResolvedValue([metadata(fixedAssetId)] as never);

    harness.configureRunnerMessage(async function* ({ body }) {
      expect(body.content).toEqual({ blocks: [{ type: 'text', text: testCase.prompt }] });
      const result = await harness.toolService.searchAssets(harness.auth, body.gallerySessionId, testCase.request);
      if (result.status !== 'approval-required') {
        throw new Error(`Expected searchAssets approval for ${testCase.name}`);
      }

      yield {
        type: 'tool-approval-needed',
        sessionId: body.gallerySessionId,
        runnerSessionId: 'runner-session-1',
        toolCallId: result.toolCall.id,
      };
    });

    const session = await harness.sessionService.create(harness.auth, {
      providerCredentialId: '00000000-0000-4000-8000-000000000201',
      model: 'gpt-5.1',
      permissionPreset: AgentPermissionPreset.VisualOrganizer,
      approvalMode: AgentApprovalMode.Strict,
      initialContext: {
        entrypoint: 'assistant-page',
        acceptancePrompt: testCase.name,
        acceptanceReferenceDate,
      },
    });

    const userMessage = await harness.messageService.appendUserMessage(harness.auth, session.id, {
      content: { blocks: [{ type: 'text', text: testCase.prompt }] },
    });

    expect(userMessage.role).toBe(AgentMessageRole.User);
    await waitFor(async () => {
      const [pendingToolCall] = await harness.toolService.getToolCalls(harness.auth, session.id);
      expect(pendingToolCall).toEqual(
        expect.objectContaining({
          toolName: AgentToolName.SearchAssets,
          status: AgentToolCallStatus.PendingApproval,
          requestSummary: testCase.expectedRequestSummary,
        }),
      );
    });

    const [pendingToolCall] = await harness.toolService.getToolCalls(harness.auth, session.id);
    expect(
      harness.toolCalls.toolCalls.find((toolCall) => toolCall.id === pendingToolCall.id)?.redactedRequestMetadata,
    ).toEqual(testCase.expectedRequestMetadata);

    await harness.toolService.approveToolCall(harness.auth, session.id, pendingToolCall.id, {
      decision: AgentToolApprovalDecision.Approved,
    });

    await waitFor(() => {
      expect(harness.runnerRepository.streamResume).toHaveBeenCalledTimes(1);
      expect(harness.runnerResumeBodies).toEqual([
        expect.objectContaining({
          gallerySessionId: session.id,
          toolCallId: pendingToolCall.id,
          approvalDecision: AgentToolApprovalDecision.Approved,
          toolResult: expect.objectContaining({
            status: 'success',
            returnedCount: 1,
            hasMore: false,
          }),
        }),
      ]);
    });

    if (testCase.expectedSearchPath === 'smart') {
      expect(harness.searchRepository.searchSmart).toHaveBeenCalledWith(
        { page: 1, size: 50 },
        expect.objectContaining({
          query: 'beach sunset',
          embedding: '[1, 2, 3]',
          maxDistance: 0.42,
          spaceId: familySpaceId,
        }),
      );
      expect(harness.searchRepository.searchMetadata).not.toHaveBeenCalled();
    } else {
      expect(harness.searchRepository.searchMetadata).toHaveBeenCalled();
      expect(harness.searchRepository.searchSmart).not.toHaveBeenCalled();
    }

    await waitFor(async () => {
      const messages = await harness.messageService.getMessages(harness.auth, session.id);
      const toolCalls = await harness.toolService.getToolCalls(harness.auth, session.id);
      const reloadedSession = await harness.sessions.getById(harness.auth.user.id, session.id);

      expect(messages).toEqual([
        expect.objectContaining({
          role: AgentMessageRole.User,
          content: { blocks: [{ type: 'text', text: testCase.prompt }] },
        }),
        expect.objectContaining({
          role: AgentMessageRole.Assistant,
          providerMessageId: 'provider-message-1',
        }),
      ]);
      expect(toolCalls).toEqual([
        expect.objectContaining({
          id: pendingToolCall.id,
          toolName: AgentToolName.SearchAssets,
          status: AgentToolCallStatus.Completed,
          approvalDecision: AgentToolApprovalDecision.Approved,
          responseSummary: 'Created a selection handle for 1 asset',
          assetCount: 1,
        }),
      ]);
      expect(reloadedSession?.status).toBe(AgentSessionStatus.Running);
    });

    expect(nonActivityEventTypes(harness.websocketEvents)).toEqual([
      'tool-approval-needed',
      'assistant-message-delta',
      'assistant-message-created',
    ]);
  };

  it('persists and resumes the approval flow from reloadable state', async () => {
    const harness = setup();
    const session = await harness.sessionService.create(harness.auth, {
      providerCredentialId: '00000000-0000-4000-8000-000000000201',
      model: 'gpt-5.1',
      permissionPreset: AgentPermissionPreset.VisualOrganizer,
      approvalMode: AgentApprovalMode.Strict,
      initialContext: { entrypoint: 'assistant-page' },
    });

    expect(session.status).toBe(AgentSessionStatus.Running);

    const userMessage = await harness.messageService.appendUserMessage(harness.auth, session.id, {
      content: { blocks: [{ type: 'text', text: 'List my spaces.' }] },
    });

    expect(userMessage.role).toBe(AgentMessageRole.User);
    const initialMessages = await harness.messageService.getMessages(harness.auth, session.id);
    expect(initialMessages).toHaveLength(1);

    await waitFor(async () => {
      const pendingCalls = await harness.toolService.getToolCalls(harness.auth, session.id);
      const reloadedSession = await harness.sessions.getById(harness.auth.user.id, session.id);
      expect(pendingCalls).toEqual([
        expect.objectContaining({
          toolName: AgentToolName.ListSpaces,
          status: AgentToolCallStatus.PendingApproval,
          requestSummary: 'List spaces',
        }),
      ]);
      expect(reloadedSession?.status).toBe(AgentSessionStatus.WaitingForToolApproval);
    });

    expect(harness.websocketEvents.filter(({ event }) => event.type !== 'activity')).toEqual([
      expect.objectContaining({
        userId: harness.auth.user.id,
        event: expect.objectContaining({ type: 'tool-approval-needed', sessionId: session.id }),
      }),
    ]);

    const [pendingToolCall] = await harness.toolService.getToolCalls(harness.auth, session.id);
    await harness.toolService.approveToolCall(harness.auth, session.id, pendingToolCall.id, {
      decision: AgentToolApprovalDecision.Approved,
    });

    await waitFor(() => {
      expect(harness.runnerRepository.streamResume).toHaveBeenCalledTimes(1);
      expect(harness.runnerResumeBodies).toEqual([
        expect.objectContaining({
          gallerySessionId: session.id,
          toolCallId: pendingToolCall.id,
          approvalDecision: AgentToolApprovalDecision.Approved,
          toolResult: expect.objectContaining({ status: 'success' }),
        }),
      ]);
    });

    await waitFor(async () => {
      const messages = await harness.messageService.getMessages(harness.auth, session.id);
      const toolCalls = await harness.toolService.getToolCalls(harness.auth, session.id);
      const reloadedSession = await harness.sessions.getById(harness.auth.user.id, session.id);
      expect(messages).toEqual([
        expect.objectContaining({ role: AgentMessageRole.User }),
        expect.objectContaining({
          role: AgentMessageRole.Assistant,
          providerMessageId: 'provider-message-1',
          content: { blocks: [{ type: 'text', text: 'I found one space.' }] },
        }),
      ]);
      expect(toolCalls).toEqual([
        expect.objectContaining({
          id: pendingToolCall.id,
          status: AgentToolCallStatus.Completed,
          approvalDecision: AgentToolApprovalDecision.Approved,
          responseSummary: 'Returned 1 space(s)',
          albumCount: 0,
          assetCount: 0,
        }),
      ]);
      expect(harness.toolCalls.toolCalls[0].redactedResponseMetadata).toEqual(
        expect.objectContaining({
          spaceIds: ['00000000-0000-4000-8000-000000000401'],
        }),
      );
      expect(reloadedSession?.status).toBe(AgentSessionStatus.Running);
    });

    expect(nonActivityEventTypes(harness.websocketEvents)).toEqual([
      'tool-approval-needed',
      'assistant-message-delta',
      'assistant-message-created',
    ]);

    await expect(
      harness.toolService.approveToolCall(harness.auth, session.id, pendingToolCall.id, {
        decision: AgentToolApprovalDecision.Approved,
      }),
    ).rejects.toThrow('Agent tool call is not pending approval');
    expect(harness.runnerRepository.streamResume).toHaveBeenCalledTimes(1);
  });

  it('keeps handled tool state reloadable when approval continuation reports a runner error', async () => {
    const harness = setup();
    harness.setResumeMode('error');
    const session = await harness.sessionService.create(harness.auth, {
      providerCredentialId: '00000000-0000-4000-8000-000000000201',
      model: 'gpt-5.1',
      permissionPreset: AgentPermissionPreset.VisualOrganizer,
      approvalMode: AgentApprovalMode.Strict,
      initialContext: {},
    });
    await harness.messageService.appendUserMessage(harness.auth, session.id, {
      content: { blocks: [{ type: 'text', text: 'List my spaces.' }] },
    });
    await waitFor(async () => {
      const toolCalls = await harness.toolService.getToolCalls(harness.auth, session.id);
      expect(toolCalls).toHaveLength(1);
    });

    const [pendingToolCall] = await harness.toolService.getToolCalls(harness.auth, session.id);
    await harness.toolService.approveToolCall(harness.auth, session.id, pendingToolCall.id, {
      decision: AgentToolApprovalDecision.Approved,
    });

    await waitFor(async () => {
      const reloadedSession = await harness.sessions.getById(harness.auth.user.id, session.id);
      const toolCalls = await harness.toolService.getToolCalls(harness.auth, session.id);
      const messages = await harness.messageService.getMessages(harness.auth, session.id);

      expect(reloadedSession?.status).toBe(AgentSessionStatus.Interrupted);
      expect(toolCalls).toEqual([
        expect.objectContaining({
          id: pendingToolCall.id,
          status: AgentToolCallStatus.Completed,
          responseSummary: 'Returned 1 space(s)',
        }),
      ]);
      expect(harness.websocketEvents.map(({ event }) => event.type)).toContain('runner-error');
      expect(messages).toEqual([expect.objectContaining({ role: AgentMessageRole.User })]);
    });
  });

  it('cleans up active work after an unrecovered planning tool failure assistant response', async () => {
    const harness = setup();
    harness.configureRunnerMessage(async function* ({ body }) {
      await harness.toolCalls.create({
        sessionId: body.gallerySessionId,
        toolName: AgentToolName.ProposeAlbumOperations,
        status: AgentToolCallStatus.Denied,
        approvalDecision: AgentToolApprovalDecision.Denied,
        requestSummary: 'Propose album plan',
        responseSummary: null,
        redactedRequestMetadata: {},
        redactedResponseMetadata: null,
        dataClass: AgentToolDataClass.Metadata,
        providerSnapshot: {
          providerCredentialId: '00000000-0000-4000-8000-000000000201',
          providerType: AgentProviderType.OpenAI,
          label: 'OpenAI personal',
          baseUrl: null,
          model: 'gpt-5.1',
        },
        error: 'Selection handle is expired or not available for this session',
        completedAt: new Date(),
      });
      yield {
        type: 'assistant-message-completed',
        sessionId: body.gallerySessionId,
        runnerSessionId: 'runner-session-1',
        providerMessageId: 'provider-message-failure',
        content: { blocks: [{ type: 'text', text: 'I could not create the plan because the selection expired.' }] },
      };
    });

    const session = await harness.sessionService.create(harness.auth, {
      providerCredentialId: '00000000-0000-4000-8000-000000000201',
      model: 'gpt-5.1',
      permissionPreset: AgentPermissionPreset.VisualOrganizer,
      approvalMode: AgentApprovalMode.PlanOnly,
      initialContext: {},
    });

    await harness.messageService.appendUserMessage(harness.auth, session.id, {
      content: { blocks: [{ type: 'text', text: 'Create the album plan.' }] },
    });

    await waitFor(async () => {
      const messages = await harness.messageService.getMessages(harness.auth, session.id);
      const reloadedSession = await harness.sessions.getById(harness.auth.user.id, session.id);
      const activityHistory = harness.getActivityHistory(session.id);

      expect(messages).toHaveLength(2);
      expect(messages).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            role: AgentMessageRole.User,
            content: { blocks: [{ type: 'text', text: 'Create the album plan.' }] },
          }),
          expect.objectContaining({
            role: AgentMessageRole.Assistant,
            providerMessageId: 'provider-message-failure',
            content: {
              blocks: [{ type: 'text', text: 'I could not create the plan because the selection expired.' }],
            },
          }),
        ]),
      );
      expect(reloadedSession?.status).toBe(AgentSessionStatus.Interrupted);
      expect(activityHistory).toEqual([
        expect.objectContaining({
          kind: AgentSessionActivityEventKind.StartProcessing,
          status: AgentSessionActivityEventStatus.Running,
        }),
        expect.objectContaining({
          kind: AgentSessionActivityEventKind.StartProcessing,
          status: AgentSessionActivityEventStatus.Failed,
          summary: 'The assistant stopped after a Gallery tool error.',
        }),
      ]);
    });

    await harness.messageService.appendUserMessage(harness.auth, session.id, {
      content: { blocks: [{ type: 'text', text: 'I refreshed the selection. Try again.' }] },
    });

    const messages = await harness.messageService.getMessages(harness.auth, session.id);
    expect(messages).toHaveLength(3);
    expect(harness.websocketEvents).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          userId: harness.auth.user.id,
          event: expect.objectContaining({
            type: 'activity',
            event: expect.objectContaining({
              kind: AgentSessionActivityEventKind.StartProcessing,
              status: AgentSessionActivityEventStatus.Failed,
            }),
          }),
        }),
      ]),
    );
    expect(harness.websocketEvents.map(({ event }) => event.type)).not.toContain('runner-error');
  });

  it('keeps a people-search assistant flow open after approval and resume', async () => {
    const harness = setup();
    const personId = newUuid();
    const assetId = newUuid();
    harness.accessRepository.person.checkOwnerAccess.mockResolvedValue(new Set([personId]));
    harness.accessRepository.asset.checkOwnerAccess.mockResolvedValue(new Set([assetId]));
    harness.searchRepository.searchMetadata.mockResolvedValue({ items: [{ id: assetId }], hasNextPage: false });
    harness.configureRunnerMessage(async function* ({ body }) {
      const result = await harness.toolService.searchAssets(harness.auth, body.gallerySessionId, {
        filters: { personIds: [personId] },
        limit: 25,
      });
      if (result.status !== 'approval-required') {
        throw new Error('Expected searchAssets to request approval');
      }

      yield {
        type: 'tool-approval-needed',
        sessionId: body.gallerySessionId,
        runnerSessionId: 'runner-session-1',
        toolCallId: result.toolCall.id,
      };
    });

    const session = await harness.sessionService.create(harness.auth, {
      providerCredentialId: '00000000-0000-4000-8000-000000000201',
      model: 'gpt-5.1',
      permissionPreset: AgentPermissionPreset.VisualOrganizer,
      approvalMode: AgentApprovalMode.Strict,
      initialContext: { entrypoint: 'assistant-page' },
    });

    const userMessage = await harness.messageService.appendUserMessage(harness.auth, session.id, {
      content: { blocks: [{ type: 'text', text: 'Find photos of Alex.' }] },
    });

    expect(userMessage.role).toBe(AgentMessageRole.User);
    await waitFor(async () => {
      const pendingCalls = await harness.toolService.getToolCalls(harness.auth, session.id);
      expect(pendingCalls).toEqual([
        expect.objectContaining({
          toolName: AgentToolName.SearchAssets,
          status: AgentToolCallStatus.PendingApproval,
          requestSummary: 'Search metadata assets (limit 25, handle)',
        }),
      ]);
    });

    const [pendingToolCall] = await harness.toolService.getToolCalls(harness.auth, session.id);
    await harness.toolService.approveToolCall(harness.auth, session.id, pendingToolCall.id, {
      decision: AgentToolApprovalDecision.Approved,
    });

    await waitFor(() => {
      expect(harness.runnerRepository.streamResume).toHaveBeenCalledTimes(1);
      expect(harness.runnerResumeBodies).toEqual([
        expect.objectContaining({
          gallerySessionId: session.id,
          toolCallId: pendingToolCall.id,
          approvalDecision: AgentToolApprovalDecision.Approved,
          toolResult: expect.objectContaining({ status: 'success' }),
        }),
      ]);
    });

    await waitFor(async () => {
      const messages = await harness.messageService.getMessages(harness.auth, session.id);
      const toolCalls = await harness.toolService.getToolCalls(harness.auth, session.id);
      const reloadedSession = await harness.sessions.getById(harness.auth.user.id, session.id);
      expect(messages).toEqual([
        expect.objectContaining({
          role: AgentMessageRole.User,
          content: { blocks: [{ type: 'text', text: 'Find photos of Alex.' }] },
        }),
        expect.objectContaining({
          role: AgentMessageRole.Assistant,
          providerMessageId: 'provider-message-1',
        }),
      ]);
      expect(toolCalls).toEqual([
        expect.objectContaining({
          id: pendingToolCall.id,
          toolName: AgentToolName.SearchAssets,
          status: AgentToolCallStatus.Completed,
          approvalDecision: AgentToolApprovalDecision.Approved,
          responseSummary: 'Created a selection handle for 1 asset',
          assetCount: 1,
        }),
      ]);
      expect(reloadedSession?.status).toBe(AgentSessionStatus.Running);
    });

    expect(nonActivityEventTypes(harness.websocketEvents)).toEqual([
      'tool-approval-needed',
      'assistant-message-delta',
      'assistant-message-created',
    ]);
  });

  it.each([
    {
      name: 'alex berlin last summer unalbumed',
      prompt: 'Find photos of Alex in Berlin from last summer that are not in any album.',
      request: {
        mode: 'metadata',
        filters: {
          personIds: [alexPersonId],
          city: 'Berlin',
          takenAfter: berlinLastSummerStart,
          takenBefore: berlinLastSummerEnd,
          isNotInAlbum: true,
        },
        limit: 50,
        page: 1,
        order: 'desc',
      },
      expectedRequestSummary: 'Search metadata assets (limit 50, handle)',
      expectedRequestMetadata: {
        mode: 'metadata',
        filters: {
          personIds: [alexPersonId],
          city: 'Berlin',
          takenAfter: berlinLastSummerStart,
          takenBefore: berlinLastSummerEnd,
          isNotInAlbum: true,
        },
        limit: 50,
        page: 1,
        order: 'desc',
        detail: 'handle',
        fields: [],
      },
      expectedSearchPath: 'metadata',
    },
    {
      name: 'five-star Japan videos',
      prompt: 'Create an album from 5-star videos from Japan.',
      request: {
        filters: { rating: 5, type: AssetType.Video, country: 'Japan' },
        limit: 50,
      },
      expectedRequestSummary: 'Search metadata assets (limit 50, handle)',
      expectedRequestMetadata: {
        mode: 'metadata',
        filters: { rating: 5, type: AssetType.Video, country: 'Japan' },
        limit: 50,
        page: 1,
        order: 'desc',
        detail: 'handle',
        fields: [],
      },
      expectedSearchPath: 'metadata',
    },
    {
      name: 'invoice OCR screenshots',
      prompt: 'Find screenshots from 2024 that mention invoices.',
      request: {
        mode: 'ocr',
        query: 'invoice',
        filters: {
          takenAfter: invoiceScreenshotsStart,
          takenBefore: invoiceScreenshotsEnd,
          type: AssetType.Image,
        },
        limit: 50,
      },
      expectedRequestSummary: 'Search ocr assets (limit 50, handle)',
      expectedRequestMetadata: {
        mode: 'ocr',
        filters: {
          takenAfter: invoiceScreenshotsStart,
          takenBefore: invoiceScreenshotsEnd,
          type: AssetType.Image,
        },
        limit: 50,
        page: 1,
        order: 'desc',
        detail: 'handle',
        fields: [],
        query: 'invoice',
      },
      expectedSearchPath: 'metadata',
    },
    {
      name: 'family beach sunset smart search',
      prompt: 'Add beach sunset photos from the Family space to a new album.',
      request: {
        mode: 'smart',
        query: 'beach sunset',
        filters: { spaceId: familySpaceId },
        limit: 50,
        page: 1,
      },
      expectedRequestSummary: 'Search smart assets (limit 50, handle)',
      expectedRequestMetadata: {
        mode: 'smart',
        filters: { spaceId: familySpaceId },
        limit: 50,
        page: 1,
        detail: 'handle',
        fields: [],
        query: 'beach sunset',
      },
      expectedSearchPath: 'smart',
    },
    {
      name: 'Sony camera May',
      prompt: 'Find photos taken with my Sony camera in May.',
      request: {
        filters: {
          make: 'Sony',
          takenAfter: sonyMayStart,
          takenBefore: sonyMayEnd,
        },
        limit: 50,
      },
      expectedRequestSummary: 'Search metadata assets (limit 50, handle)',
      expectedRequestMetadata: {
        mode: 'metadata',
        filters: {
          make: 'Sony',
          takenAfter: sonyMayStart,
          takenBefore: sonyMayEnd,
        },
        limit: 50,
        page: 1,
        order: 'desc',
        detail: 'handle',
        fields: [],
      },
      expectedSearchPath: 'metadata',
    },
  ] satisfies AcceptanceSearchCase[])('supports Slice 8 acceptance prompt: $name', expectAcceptanceSearchFlow);
});
