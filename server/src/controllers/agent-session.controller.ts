import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Param, Post, Put } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Endpoint, HistoryBuilder } from 'src/decorators';
import { AgentSessionActivityEventResponseDto } from 'src/dtos/agent-session-activity-event.dto';
import { AgentSessionCreateDto, AgentSessionResponseDto, AgentSessionUpdateDto } from 'src/dtos/agent-session.dto';
import { AuthDto } from 'src/dtos/auth.dto';
import { ApiTag, Permission } from 'src/enum';
import { Auth, Authenticated } from 'src/middleware/auth.guard';
import { AgentSessionActivityEventService } from 'src/services/agent-session-activity-event.service';
import { AgentSessionService } from 'src/services/agent-session.service';
import { UUIDParamDto } from 'src/validation';

@ApiTags(ApiTag.AgentSessions)
@Controller('agent/sessions')
export class AgentSessionController {
  constructor(
    private readonly service: AgentSessionService,
    private readonly activityEventService: AgentSessionActivityEventService,
  ) {}

  @Post()
  @Authenticated({ permission: Permission.AgentSessionCreate })
  @Endpoint({
    summary: 'Create an agent session',
    description:
      'Create a personal AI agent session with immutable credential, model, permission plan, and approval mode snapshots.',
    history: new HistoryBuilder().added('v2.7.5').alpha('v2.7.5'),
  })
  createAgentSession(@Auth() auth: AuthDto, @Body() dto: AgentSessionCreateDto): Promise<AgentSessionResponseDto> {
    return this.service.create(auth, dto);
  }

  @Post('validate')
  @HttpCode(HttpStatus.NO_CONTENT)
  @Authenticated({ permission: Permission.AgentSessionCreate })
  @Endpoint({
    summary: 'Validate an agent session setup',
    description:
      'Validate the selected provider credential and model with the configured runner before creating a persisted AI agent session.',
    history: new HistoryBuilder().added('v2.7.5').alpha('v2.7.5'),
  })
  validateAgentSession(@Auth() auth: AuthDto, @Body() dto: AgentSessionCreateDto): Promise<void> {
    return this.service.validateCreate(auth, dto);
  }

  @Get()
  @Authenticated({ permission: Permission.AgentSessionRead })
  @Endpoint({
    summary: 'List agent sessions',
    description: 'Retrieve all AI agent sessions owned by the current user.',
    history: new HistoryBuilder().added('v2.7.5').alpha('v2.7.5'),
  })
  getAgentSessions(@Auth() auth: AuthDto): Promise<AgentSessionResponseDto[]> {
    return this.service.getAll(auth);
  }

  @Get(':id')
  @Authenticated({ permission: Permission.AgentSessionRead })
  @Endpoint({
    summary: 'Retrieve an agent session',
    description: 'Retrieve an AI agent session by ID. The current user must own this session.',
    history: new HistoryBuilder().added('v2.7.5').alpha('v2.7.5'),
  })
  getAgentSession(@Auth() auth: AuthDto, @Param() { id }: UUIDParamDto): Promise<AgentSessionResponseDto> {
    return this.service.getById(auth, id);
  }

  @Get(':id/activity-events')
  @Authenticated({ permission: Permission.AgentSessionRead })
  @Endpoint({
    summary: 'List agent session activity events',
    description: 'Retrieve persisted activity events for an AI agent session owned by the current user.',
    history: new HistoryBuilder().added('v2.7.5').alpha('v2.7.5'),
  })
  getAgentSessionActivityEvents(
    @Auth() auth: AuthDto,
    @Param() { id }: UUIDParamDto,
  ): Promise<AgentSessionActivityEventResponseDto[]> {
    return this.activityEventService.getHistory(auth, id);
  }

  @Put(':id')
  @Authenticated({ permission: Permission.AgentSessionUpdate })
  @Endpoint({
    summary: 'Update an agent session',
    description: 'Update mutable metadata for an AI agent session owned by the current user.',
    history: new HistoryBuilder().added('v2.7.5').alpha('v2.7.5'),
  })
  updateAgentSession(
    @Auth() auth: AuthDto,
    @Param() { id }: UUIDParamDto,
    @Body() dto: AgentSessionUpdateDto,
  ): Promise<AgentSessionResponseDto> {
    return this.service.update(auth, id, dto);
  }

  @Delete(':id')
  @Authenticated({ permission: Permission.AgentSessionUpdate })
  @HttpCode(HttpStatus.NO_CONTENT)
  @Endpoint({
    summary: 'Delete an agent session',
    description: 'Delete an AI agent session owned by the current user.',
    history: new HistoryBuilder().added('v2.7.5').alpha('v2.7.5'),
  })
  deleteAgentSession(@Auth() auth: AuthDto, @Param() { id }: UUIDParamDto): Promise<void> {
    return this.service.delete(auth, id);
  }

  @Post(':id/cancel')
  @HttpCode(HttpStatus.OK)
  @Authenticated({ permission: Permission.AgentSessionUpdate })
  @Endpoint({
    summary: 'Cancel an agent session',
    description: 'Cancel an active AI agent session owned by the current user.',
    history: new HistoryBuilder().added('v2.7.5').alpha('v2.7.5'),
  })
  cancelAgentSession(@Auth() auth: AuthDto, @Param() { id }: UUIDParamDto): Promise<AgentSessionResponseDto> {
    return this.service.cancel(auth, id);
  }
}
