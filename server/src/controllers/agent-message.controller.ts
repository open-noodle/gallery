import { Body, Controller, Get, Param, Post } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Endpoint, HistoryBuilder } from 'src/decorators';
import { AgentMessageCreateDto, AgentMessageResponseDto } from 'src/dtos/agent-message.dto';
import { AuthDto } from 'src/dtos/auth.dto';
import { ApiTag, Permission } from 'src/enum';
import { Auth, Authenticated } from 'src/middleware/auth.guard';
import { AgentMessageService } from 'src/services/agent-message.service';
import { UUIDParamDto } from 'src/validation';

@ApiTags(ApiTag.AgentSessions)
@Controller('agent/sessions/:id/messages')
export class AgentMessageController {
  constructor(private readonly service: AgentMessageService) {}

  @Post()
  @Authenticated({ permission: Permission.AgentSessionUpdate })
  @Endpoint({
    summary: 'Append an agent session message',
    description: 'Append a user-authored message to an AI agent session owned by the current user.',
    history: new HistoryBuilder().added('v2.7.5').alpha('v2.7.5'),
  })
  appendAgentSessionMessage(
    @Auth() auth: AuthDto,
    @Param() { id }: UUIDParamDto,
    @Body() dto: AgentMessageCreateDto,
  ): Promise<AgentMessageResponseDto> {
    return this.service.appendUserMessage(auth, id, dto);
  }

  @Get()
  @Authenticated({ permission: Permission.AgentSessionRead })
  @Endpoint({
    summary: 'List agent session messages',
    description: 'Retrieve persisted chat messages for an AI agent session owned by the current user.',
    history: new HistoryBuilder().added('v2.7.5').alpha('v2.7.5'),
  })
  getAgentSessionMessages(@Auth() auth: AuthDto, @Param() { id }: UUIDParamDto): Promise<AgentMessageResponseDto[]> {
    return this.service.getMessages(auth, id);
  }
}
