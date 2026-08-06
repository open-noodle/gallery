import { BadRequestException, Injectable } from '@nestjs/common';
import { AgentMessage, AgentSession } from 'src/database';
import { AgentMessageCreateDto, AgentMessageResponseDto } from 'src/dtos/agent-message.dto';
import { AuthDto } from 'src/dtos/auth.dto';
import { AgentMessageRole, AgentSessionStatus } from 'src/enum';
import { AgentMessageRepository } from 'src/repositories/agent-message.repository';
import { AgentSessionRepository } from 'src/repositories/agent-session.repository';
import { AgentRunnerService } from 'src/services/agent-runner.service';

@Injectable()
export class AgentMessageService {
  private static readonly appendableStatuses = [
    AgentSessionStatus.Created,
    AgentSessionStatus.Running,
    AgentSessionStatus.WaitingForToolApproval,
    AgentSessionStatus.WaitingForPlanReview,
    AgentSessionStatus.Interrupted,
  ];

  constructor(
    private readonly messageRepository: AgentMessageRepository,
    private readonly sessionRepository: AgentSessionRepository,
    private readonly agentRunnerService: AgentRunnerService,
  ) {}

  async appendUserMessage(
    auth: AuthDto,
    sessionId: string,
    dto: AgentMessageCreateDto,
  ): Promise<AgentMessageResponseDto> {
    const session = await this.getOwnedSession(auth, sessionId);

    if (!AgentMessageService.appendableStatuses.includes(session.status)) {
      throw new BadRequestException('Agent session does not accept new messages');
    }

    if (session.runnerSessionId && this.agentRunnerService.isSessionDispatchActive(session.id)) {
      throw new BadRequestException('Agent session already has a message in progress');
    }

    const message = await this.messageRepository.create({
      sessionId: session.id,
      role: AgentMessageRole.User,
      content: dto.content,
      providerMessageId: null,
      toolCallId: null,
    });

    if (session.runnerSessionId) {
      void this.agentRunnerService
        .sendMessage({
          userId: auth.user.id,
          sessionId: session.id,
          runnerSessionId: session.runnerSessionId,
          messageId: message.id,
          content: message.content,
        })
        .catch(() => {});
    }

    return this.map(message);
  }

  async getMessages(auth: AuthDto, sessionId: string): Promise<AgentMessageResponseDto[]> {
    const session = await this.getOwnedSession(auth, sessionId);
    const messages = await this.messageRepository.getBySessionId(session.id);
    return messages.map((message) => this.map(message));
  }

  private async getOwnedSession(auth: AuthDto, sessionId: string): Promise<AgentSession> {
    const session = await this.sessionRepository.getById(auth.user.id, sessionId);
    if (!session) {
      throw new BadRequestException('Agent session not found');
    }

    return session;
  }

  private map(message: AgentMessage): AgentMessageResponseDto {
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
}
