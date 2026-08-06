import { BadRequestException, Inject, Injectable, Optional } from '@nestjs/common';
import { AgentMessage } from 'src/database';
import { AgentRunnerStatusDto } from 'src/dtos/agent-runner.dto';
import {
  AgentMessageRole,
  AgentSessionActivityEventKind,
  AgentSessionActivityEventStatus,
  AgentSessionStatus,
  AgentToolCallStatus,
} from 'src/enum';
import { AgentMessageRepository } from 'src/repositories/agent-message.repository';
import { AgentRunnerRepository } from 'src/repositories/agent-runner.repository';
import { AgentSessionRepository } from 'src/repositories/agent-session.repository';
import { AgentToolCallRepository } from 'src/repositories/agent-tool-call.repository';
import { ConfigRepository } from 'src/repositories/config.repository';
import { WebsocketRepository } from 'src/repositories/websocket.repository';
import { AgentRunnerToolTokenService } from 'src/services/agent-runner-tool-token.service';
import { AgentSessionActivityEventService } from 'src/services/agent-session-activity-event.service';
import { AgentMessageContent } from 'src/types/agent-message.types';
import {
  AgentRunnerActivityStreamEvent,
  AgentRunnerCreateSessionInput,
  AgentRunnerStreamEvent,
} from 'src/types/agent-runner.types';

const RUNNER_STATUS_CACHE_MS = 15_000;

const buildMcpSessionUrl = (mcpGatewayBaseUrl: string, sessionId: string) =>
  new URL(`sessions/${encodeURIComponent(sessionId)}`, `${mcpGatewayBaseUrl.replace(/\/+$/, '')}/`).toString();

class RunnerReportedError extends Error {}

type AgentSessionActivityServiceLike = {
  createSystemEvent: (userId: string, sessionId: string, event: Record<string, unknown>) => Promise<unknown>;
  normalizeRunnerEvent: (event: AgentRunnerActivityStreamEvent) => Record<string, unknown> | null | undefined;
  closeOpenLifecycleEvents: (
    userId: string,
    sessionId: string,
    terminalStatus: AgentSessionActivityEventStatus,
  ) => Promise<unknown>;
};

type RunnerActivityContext = {
  kind: AgentSessionActivityEventKind;
  failureSummary: string;
};

type RunnerStreamCleanupContext = {
  activityContext: RunnerActivityContext;
  baselineToolCallIds: Set<string> | undefined;
  approvedToolResultFailed: boolean;
};

@Injectable()
export class AgentRunnerService {
  private static readonly completionActiveStatuses = [
    AgentSessionStatus.Running,
    AgentSessionStatus.WaitingForPlanReview,
  ];

  private statusCache?: { key: string; value: AgentRunnerStatusDto; expiresAt: number };
  private statusInFlight = new Map<string, Promise<AgentRunnerStatusDto>>();
  private sessionDispatches = new Map<string, Promise<void>>();

  constructor(
    private readonly configRepository: ConfigRepository,
    private readonly agentRunnerRepository: AgentRunnerRepository,
    private readonly messageRepository: AgentMessageRepository,
    private readonly sessionRepository: AgentSessionRepository,
    private readonly websocketRepository: WebsocketRepository,
    private readonly toolTokenService: AgentRunnerToolTokenService,
    @Optional()
    private readonly toolCallRepository?: AgentToolCallRepository,
    @Optional()
    @Inject(AgentSessionActivityEventService)
    private readonly activityService?: Partial<AgentSessionActivityServiceLike>,
  ) {}

  async createSession(input: AgentRunnerCreateSessionInput) {
    const { userId, ...body } = input;
    const { runnerUrl, runnerHealthTimeoutMs, mcpGatewayUrl } = this.configRepository.getEnv().agent;
    if (!runnerUrl) {
      throw new BadRequestException('Agent runner is not configured');
    }
    if (!mcpGatewayUrl) {
      throw new BadRequestException('Agent MCP gateway is not configured');
    }

    const mcpGateway = {
      url: buildMcpSessionUrl(mcpGatewayUrl, body.gallerySessionId),
      token: this.toolTokenService.create({
        sessionId: body.gallerySessionId,
        userId,
        expiresAt: body.permissionPlan.limits.expiresInMinutes
          ? new Date(Date.now() + body.permissionPlan.limits.expiresInMinutes * 60_000)
          : new Date(Date.now() + 2 * 60 * 60_000),
      }),
    };

    const result = await this.agentRunnerRepository.createSession({
      url: runnerUrl,
      timeoutMs: runnerHealthTimeoutMs,
      body: { ...body, mcpGateway },
    });

    return {
      runnerEndpoint: runnerUrl,
      runnerSessionId: result.runnerSessionId,
      runnerCapabilitiesSnapshot: result.capabilities,
    };
  }

  async validateSession(input: AgentRunnerCreateSessionInput) {
    const { userId: _userId, ...body } = input;
    const { runnerUrl, runnerMessageStreamTimeoutMs } = this.configRepository.getEnv().agent;
    if (!runnerUrl) {
      throw new BadRequestException('Agent runner is not configured');
    }

    await this.agentRunnerRepository.validateSession({
      url: runnerUrl,
      timeoutMs: runnerMessageStreamTimeoutMs,
      body: { ...body, mcpGateway: null },
    });
  }

  async cancelSession({
    runnerEndpoint,
    runnerSessionId,
  }: {
    runnerEndpoint: string | null;
    runnerSessionId: string | null;
  }): Promise<void> {
    if (!runnerEndpoint || !runnerSessionId) {
      return;
    }

    const { runnerHealthTimeoutMs } = this.configRepository.getEnv().agent;
    await this.agentRunnerRepository.cancelSession({
      url: runnerEndpoint,
      runnerSessionId,
      timeoutMs: runnerHealthTimeoutMs,
    });
  }

  async getStatus(): Promise<AgentRunnerStatusDto> {
    const { runnerUrl, runnerHealthTimeoutMs, mcpGatewayUrl } = this.configRepository.getEnv().agent;
    if (!runnerUrl || !mcpGatewayUrl) {
      return this.notConfigured();
    }

    const now = Date.now();
    const cacheKey = `${runnerUrl}:${runnerHealthTimeoutMs}`;
    if (this.statusCache && this.statusCache.key === cacheKey && this.statusCache.expiresAt > now) {
      return this.statusCache.value;
    }

    const statusInFlight = this.statusInFlight.get(cacheKey);
    if (statusInFlight) {
      return statusInFlight;
    }

    const nextStatusInFlight = (async () => {
      try {
        const probe = await this.agentRunnerRepository.getStatus({ url: runnerUrl, timeoutMs: runnerHealthTimeoutMs });
        const value: AgentRunnerStatusDto = {
          configured: true,
          healthy: probe.healthy,
          reason: probe.reason,
          version: probe.version,
          capabilities: probe.capabilities,
          checkedAt: new Date(),
        };
        this.statusCache = { key: cacheKey, value, expiresAt: Date.now() + RUNNER_STATUS_CACHE_MS };
        return value;
      } finally {
        this.statusInFlight.delete(cacheKey);
      }
    })();

    this.statusInFlight.set(cacheKey, nextStatusInFlight);
    return nextStatusInFlight;
  }

  private notConfigured(): AgentRunnerStatusDto {
    return {
      configured: false,
      healthy: false,
      reason: 'not-configured',
      version: null,
      capabilities: null,
      checkedAt: new Date(),
    };
  }

  async sendMessage({
    userId,
    sessionId,
    runnerSessionId,
    messageId,
    content,
  }: {
    userId: string;
    sessionId: string;
    runnerSessionId: string;
    messageId: string;
    content: AgentMessageContent;
  }) {
    const activeDispatch = this.sessionDispatches.get(sessionId);
    if (activeDispatch) {
      throw new BadRequestException('Agent session already has a message in progress');
    }

    const dispatch = this.sendMessageToRunner({ userId, sessionId, runnerSessionId, messageId, content });
    this.sessionDispatches.set(sessionId, dispatch);

    try {
      await dispatch;
    } finally {
      if (this.sessionDispatches.get(sessionId) === dispatch) {
        this.sessionDispatches.delete(sessionId);
      }
    }
  }

  async resumeAfterToolApproval({
    userId,
    sessionId,
    runnerSessionId,
    toolCallId,
    approvalDecision,
    toolResult,
  }: {
    userId: string;
    sessionId: string;
    runnerSessionId: string;
    toolCallId?: string;
    approvalDecision?: 'approved' | 'denied';
    toolResult?: unknown;
  }) {
    const activeDispatch = this.sessionDispatches.get(sessionId);
    if (activeDispatch) {
      await activeDispatch;
    }

    if (this.sessionDispatches.has(sessionId)) {
      throw new BadRequestException('Agent session already has a message in progress');
    }

    const dispatch = this.resumeRunnerSession({
      userId,
      sessionId,
      runnerSessionId,
      toolCallId,
      approvalDecision,
      toolResult,
    });
    this.sessionDispatches.set(sessionId, dispatch);

    try {
      await dispatch;
    } finally {
      if (this.sessionDispatches.get(sessionId) === dispatch) {
        this.sessionDispatches.delete(sessionId);
      }
    }
  }

  isSessionDispatchActive(sessionId: string) {
    return this.sessionDispatches.has(sessionId);
  }

  private async sendMessageToRunner({
    userId,
    sessionId,
    runnerSessionId,
    messageId,
    content,
  }: {
    userId: string;
    sessionId: string;
    runnerSessionId: string;
    messageId: string;
    content: AgentMessageContent;
  }) {
    try {
      const { runnerUrl, runnerMessageStreamTimeoutMs } = this.configRepository.getEnv().agent;
      if (!runnerUrl) {
        throw new BadRequestException('Agent runner is not configured');
      }

      const activityContext = {
        kind: AgentSessionActivityEventKind.StartProcessing,
        failureSummary: 'The assistant stopped while processing the message.',
      };
      const [baselineToolCallIds, workflowState] = await Promise.all([
        this.listToolCallIds(sessionId),
        this.loadWorkflowState(userId, sessionId),
      ]);

      this.createActivityEvent(userId, sessionId, {
        kind: AgentSessionActivityEventKind.StartProcessing,
        status: AgentSessionActivityEventStatus.Running,
      });

      await this.processRunnerStream({
        userId,
        sessionId,
        runnerSessionId,
        stream: this.agentRunnerRepository.streamMessage({
          url: runnerUrl,
          runnerSessionId,
          timeoutMs: runnerMessageStreamTimeoutMs,
          body: {
            gallerySessionId: sessionId,
            messageId,
            content,
            ...(workflowState === undefined ? {} : { workflowState }),
          },
        }),
        emptyStreamMessage: 'Agent runner message stream ended before completion',
        cleanupContext: { activityContext, baselineToolCallIds, approvedToolResultFailed: false },
      });
    } catch (error) {
      await this.emitRunnerFailure(userId, sessionId, error, {
        kind: AgentSessionActivityEventKind.StartProcessing,
        failureSummary: 'The assistant stopped while processing the message.',
      });
      throw error;
    }
  }

  private async resumeRunnerSession({
    userId,
    sessionId,
    runnerSessionId,
    toolCallId,
    approvalDecision,
    toolResult,
  }: {
    userId: string;
    sessionId: string;
    runnerSessionId: string;
    toolCallId?: string;
    approvalDecision?: 'approved' | 'denied';
    toolResult?: unknown;
  }) {
    try {
      const { runnerUrl, runnerMessageStreamTimeoutMs } = this.configRepository.getEnv().agent;
      if (!runnerUrl) {
        throw new BadRequestException('Agent runner is not configured');
      }

      const [baselineToolCallIds, workflowState] = await Promise.all([
        this.listToolCallIds(sessionId),
        this.loadWorkflowState(userId, sessionId),
      ]);
      const body = {
        gallerySessionId: sessionId,
        ...(toolCallId ? { toolCallId } : {}),
        ...(approvalDecision ? { approvalDecision } : {}),
        ...(toolResult === undefined ? {} : { toolResult }),
        ...(workflowState === undefined ? {} : { workflowState }),
      };

      const activityContext = {
        kind: AgentSessionActivityEventKind.RunnerRecovery,
        failureSummary: 'The assistant stopped while resuming after approval.',
      };

      this.createActivityEvent(userId, sessionId, {
        kind: AgentSessionActivityEventKind.RunnerRecovery,
        status: AgentSessionActivityEventStatus.Running,
      });

      await this.processRunnerStream({
        userId,
        sessionId,
        runnerSessionId,
        stream: this.agentRunnerRepository.streamResume({
          url: runnerUrl,
          runnerSessionId,
          timeoutMs: runnerMessageStreamTimeoutMs,
          body,
        }),
        emptyStreamMessage: 'Agent runner resume stream ended before completion',
        cleanupContext: {
          activityContext,
          baselineToolCallIds,
          approvedToolResultFailed: approvalDecision === 'approved' && this.isFailedToolResult(toolResult),
        },
      });
    } catch (error) {
      await this.emitRunnerFailure(userId, sessionId, error, {
        kind: AgentSessionActivityEventKind.RunnerRecovery,
        failureSummary: 'The assistant stopped while resuming after approval.',
      });
      throw error;
    }
  }

  private async processRunnerStream({
    userId,
    sessionId,
    runnerSessionId,
    stream,
    emptyStreamMessage,
    cleanupContext,
  }: {
    userId: string;
    sessionId: string;
    runnerSessionId: string;
    stream: AsyncGenerator<AgentRunnerStreamEvent>;
    emptyStreamMessage: string;
    cleanupContext: RunnerStreamCleanupContext;
  }) {
    let completedEvent: Extract<AgentRunnerStreamEvent, { type: 'assistant-message-completed' }> | undefined;
    let suppressAssistantOutput = false;
    for await (const event of stream) {
      if (event.sessionId !== sessionId || event.runnerSessionId !== runnerSessionId) {
        continue;
      }

      if (event.type === 'activity') {
        void this.createRunnerActivityEvent(userId, sessionId, event);
        continue;
      }

      if (event.type === 'workflow-state-update') {
        await this.persistWorkflowState(userId, sessionId, event.workflowState);
        continue;
      }

      if (event.type === 'assistant-message-delta') {
        suppressAssistantOutput ||= await this.isWaitingForToolApproval(userId, sessionId);
        if (suppressAssistantOutput) {
          continue;
        }

        this.websocketRepository.clientSend('on_agent_session_event', userId, {
          type: 'assistant-message-delta',
          sessionId,
          delta: event.delta,
          sequence: event.sequence,
          createdAt: this.toIsoNow(),
        });
        continue;
      }

      if (event.type === 'runner-error') {
        throw new RunnerReportedError(event.message);
      }

      if (event.type === 'tool-approval-needed') {
        this.websocketRepository.clientSend('on_agent_session_event', userId, {
          type: 'tool-approval-needed',
          sessionId,
          toolCallId: event.toolCallId,
          createdAt: this.toIsoNow(),
        });
        return;
      }

      completedEvent = event;
    }

    if (!completedEvent) {
      throw new Error(emptyStreamMessage);
    }

    const session = await this.sessionRepository.getById(userId, sessionId);
    if (!session || !AgentRunnerService.completionActiveStatuses.includes(session.status)) {
      return;
    }

    const message = await this.messageRepository.create({
      sessionId,
      role: AgentMessageRole.Assistant,
      content: completedEvent.content,
      providerMessageId: completedEvent.providerMessageId,
      toolCallId: null,
    });
    this.websocketRepository.clientSend('on_agent_session_event', userId, {
      type: 'assistant-message-created',
      sessionId,
      message: this.mapMessage(message),
      createdAt: this.toIsoNow(),
    });
    await this.cleanupSameTurnToolFailure(userId, sessionId, session.status, cleanupContext);
    this.closeLifecycleEvents(userId, sessionId, AgentSessionActivityEventStatus.Completed);
  }

  private async isWaitingForToolApproval(userId: string, sessionId: string) {
    const session = await this.sessionRepository.getById(userId, sessionId);
    return session?.status === AgentSessionStatus.WaitingForToolApproval;
  }

  private async emitRunnerFailure(
    userId: string,
    sessionId: string,
    error: unknown,
    activityContext: RunnerActivityContext,
  ) {
    try {
      await this.sessionRepository.markInterruptedFromActive(userId, sessionId);
    } catch {
      // Runner failure reporting must continue even if session cleanup races another state transition.
    }
    this.createFailedActivityEvent(userId, sessionId, activityContext.kind, activityContext.failureSummary);
    this.websocketRepository.clientSend('on_agent_session_event', userId, {
      type: 'runner-error',
      sessionId,
      message:
        error instanceof RunnerReportedError && error.message.trim().length > 0
          ? error.message
          : 'The assistant runner stopped while processing the message.',
      createdAt: this.toIsoNow(),
    });
  }

  private async loadWorkflowState(userId: string, sessionId: string): Promise<object | null | undefined> {
    try {
      const session = await this.sessionRepository.getById(userId, sessionId);
      return session?.workflowState ?? undefined;
    } catch {
      // Rehydration is best-effort: a read failure must not block dispatching the turn.
      return undefined;
    }
  }

  private async persistWorkflowState(userId: string, sessionId: string, workflowState: object | null) {
    try {
      await this.sessionRepository.setWorkflowState(userId, sessionId, workflowState);
    } catch {
      // Workflow-state durability is best-effort and must not abort the active assistant stream.
    }
  }

  private async listToolCallIds(sessionId: string): Promise<Set<string> | undefined> {
    if (!this.toolCallRepository) {
      return undefined;
    }

    try {
      const toolCalls = await this.toolCallRepository.getBySessionId(sessionId);
      return new Set(toolCalls.map((toolCall) => toolCall.id));
    } catch {
      return undefined;
    }
  }

  private async cleanupSameTurnToolFailure(
    userId: string,
    sessionId: string,
    sessionStatus: AgentSessionStatus,
    cleanupContext: RunnerStreamCleanupContext,
  ) {
    if (sessionStatus !== AgentSessionStatus.Running) {
      return;
    }

    const hasSameTurnFailure =
      cleanupContext.approvedToolResultFailed || (await this.hasNewFailedToolCall(sessionId, cleanupContext));
    if (!hasSameTurnFailure) {
      return;
    }

    try {
      await this.sessionRepository.markInterruptedFromActive(userId, sessionId);
    } catch {
      // Activity cleanup is best-effort and must not hide the assistant response.
    }
    this.createFailedActivityEvent(
      userId,
      sessionId,
      cleanupContext.activityContext.kind,
      'The assistant stopped after a Gallery tool error.',
    );
  }

  private async hasNewFailedToolCall(sessionId: string, cleanupContext: RunnerStreamCleanupContext) {
    if (!cleanupContext.baselineToolCallIds || !this.toolCallRepository) {
      return false;
    }

    let toolCalls;
    try {
      toolCalls = await this.toolCallRepository.getBySessionId(sessionId);
    } catch {
      return false;
    }

    return toolCalls.some(
      (toolCall) =>
        !cleanupContext.baselineToolCallIds?.has(toolCall.id) &&
        [AgentToolCallStatus.Denied, AgentToolCallStatus.Failed].includes(toolCall.status),
    );
  }

  private isFailedToolResult(toolResult: unknown) {
    if (!toolResult || typeof toolResult !== 'object' || Array.isArray(toolResult)) {
      return false;
    }

    const { status } = toolResult as { status?: unknown };
    return status === 'denied' || status === 'error';
  }

  private createRunnerActivityEvent(userId: string, sessionId: string, event: AgentRunnerActivityStreamEvent) {
    const normalizedEvent =
      typeof this.activityService?.normalizeRunnerEvent === 'function'
        ? this.activityService.normalizeRunnerEvent(event)
        : undefined;
    if (!normalizedEvent) {
      return;
    }

    return this.createActivityEvent(userId, sessionId, normalizedEvent);
  }

  private createActivityEvent(userId: string, sessionId: string, event: Record<string, unknown>) {
    try {
      if (typeof this.activityService?.createSystemEvent !== 'function') {
        return;
      }

      void Promise.resolve(this.activityService.createSystemEvent(userId, sessionId, event)).catch(() => {
        // Activity events are audit hints and must not block the assistant stream.
      });
    } catch {
      // Activity events are audit hints and must not block the assistant stream.
    }
  }

  private closeLifecycleEvents(userId: string, sessionId: string, terminalStatus: AgentSessionActivityEventStatus) {
    try {
      if (typeof this.activityService?.closeOpenLifecycleEvents !== 'function') {
        return;
      }

      void Promise.resolve(this.activityService.closeOpenLifecycleEvents(userId, sessionId, terminalStatus)).catch(
        () => {
          // Activity events are audit hints and must not block the assistant stream.
        },
      );
    } catch {
      // Activity events are audit hints and must not block the assistant stream.
    }
  }

  private createFailedActivityEvent(
    userId: string,
    sessionId: string,
    kind: AgentSessionActivityEventKind,
    summary: string,
  ) {
    this.createActivityEvent(userId, sessionId, {
      kind,
      status: AgentSessionActivityEventStatus.Failed,
      summary,
    });
  }

  private mapMessage(message: AgentMessage) {
    return {
      id: message.id,
      sessionId: message.sessionId,
      role: message.role,
      content: message.content,
      providerMessageId: message.providerMessageId,
      toolCallId: message.toolCallId,
      createdAt: message.createdAt,
    };
  }

  private toIsoNow() {
    return new Date().toISOString();
  }
}
