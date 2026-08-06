import { Body, Controller, Get, Param, Post } from '@nestjs/common';
import { ApiCreatedResponse, ApiOkResponse, ApiTags, getSchemaPath } from '@nestjs/swagger';
import { Endpoint, HistoryBuilder } from 'src/decorators';
import {
  AgentOperationPlanApplyRequestDto,
  AgentOperationPlanApplyResponseDto,
  AgentOperationPlanParamsDto,
  AgentOperationPlanResponseDto,
  AgentOperationPlanSummaryRequestDto,
  AgentOperationPlanToolResponseDto,
  AgentProposeAlbumOperationsDto,
  AgentReviseAlbumOperationsDto,
} from 'src/dtos/agent-operation.dto';
import { AuthDto } from 'src/dtos/auth.dto';
import { ApiTag, Permission } from 'src/enum';
import { Auth, Authenticated } from 'src/middleware/auth.guard';
import { AgentOperationPlanService } from 'src/services/agent-operation-plan.service';
import { UUIDParamDto } from 'src/validation';

@ApiTags(ApiTag.AgentSessions)
@Controller('agent/sessions/:id/operation-plan')
export class AgentOperationPlanController {
  constructor(private readonly service: AgentOperationPlanService) {}

  @Get()
  @Authenticated({ permission: Permission.AgentSessionRead })
  @ApiOkResponse({
    schema: {
      oneOf: [{ $ref: getSchemaPath(AgentOperationPlanResponseDto) }, { type: 'null' }],
    },
  })
  @Endpoint({
    summary: 'Get the current agent operation plan',
    description: 'Get the current proposed album operation plan for an AI agent session owned by the current user.',
    history: new HistoryBuilder().added('v2.7.5').alpha('v2.7.5'),
  })
  async getCurrentOperationPlan(
    @Auth() auth: AuthDto,
    @Param() { id }: UUIDParamDto,
  ): Promise<AgentOperationPlanResponseDto | null> {
    return this.service.getCurrentPlan(auth, id);
  }

  @Get('applied')
  @Authenticated({ permission: Permission.AgentSessionRead })
  @ApiOkResponse({ type: AgentOperationPlanResponseDto, isArray: true })
  @Endpoint({
    summary: 'Get applied agent operation plans',
    description: 'Get applied album operation plan history for an AI agent session owned by the current user.',
    history: new HistoryBuilder().added('v2.7.5').alpha('v2.7.5'),
  })
  getAppliedOperationPlans(
    @Auth() auth: AuthDto,
    @Param() { id }: UUIDParamDto,
  ): Promise<AgentOperationPlanResponseDto[]> {
    return this.service.getAppliedPlans(auth, id);
  }

  @Post('proposals')
  @Authenticated({ permission: Permission.AgentSessionUpdate })
  @ApiCreatedResponse({ type: AgentOperationPlanToolResponseDto })
  @Endpoint({
    summary: 'Propose agent album operations',
    description: 'Internal route for storing a structured album operation proposal for an AI agent session.',
    history: new HistoryBuilder().added('v2.7.5').internal('v2.7.5'),
  })
  proposeAlbumOperations(
    @Auth() auth: AuthDto,
    @Param() { id }: UUIDParamDto,
    @Body() dto: AgentProposeAlbumOperationsDto,
  ): Promise<AgentOperationPlanToolResponseDto> {
    return this.service.proposeAlbumOperations(auth, id, dto);
  }

  @Post(':planId/revisions')
  @Authenticated({ permission: Permission.AgentSessionUpdate })
  @ApiCreatedResponse({ type: AgentOperationPlanToolResponseDto })
  @Endpoint({
    summary: 'Revise agent album operations',
    description: 'Internal route for replacing a proposed operation plan with a new revision.',
    history: new HistoryBuilder().added('v2.7.5').internal('v2.7.5'),
  })
  reviseProposedOperations(
    @Auth() auth: AuthDto,
    @Param() { id, planId }: AgentOperationPlanParamsDto,
    @Body() dto: AgentReviseAlbumOperationsDto,
  ): Promise<AgentOperationPlanToolResponseDto> {
    return this.service.reviseProposedOperations(auth, id, planId, dto);
  }

  @Post(':planId/summary')
  @Authenticated({ permission: Permission.AgentSessionRead })
  @ApiCreatedResponse({ type: AgentOperationPlanToolResponseDto })
  @Endpoint({
    summary: 'Summarize an agent operation plan',
    description: 'Internal route for returning a compact summary of a stored operation plan.',
    history: new HistoryBuilder().added('v2.7.5').internal('v2.7.5'),
  })
  summarizePlan(
    @Auth() auth: AuthDto,
    @Param() { id, planId }: AgentOperationPlanParamsDto,
    @Body() dto: AgentOperationPlanSummaryRequestDto,
  ): Promise<AgentOperationPlanToolResponseDto> {
    return this.service.summarizePlan(auth, id, planId, dto);
  }

  @Post(':planId/apply')
  @Authenticated({ permission: Permission.AgentSessionUpdate })
  @ApiCreatedResponse({ type: AgentOperationPlanApplyResponseDto })
  @Endpoint({
    summary: 'Apply approved agent album operations',
    description: 'Apply selected album operations from the current proposed agent operation plan.',
    history: new HistoryBuilder().added('v2.7.5').alpha('v2.7.5'),
  })
  applyApprovedOperations(
    @Auth() auth: AuthDto,
    @Param() { id, planId }: AgentOperationPlanParamsDto,
    @Body() dto: AgentOperationPlanApplyRequestDto,
  ): Promise<AgentOperationPlanApplyResponseDto> {
    return this.service.applyApprovedOperations(auth, id, planId, dto);
  }
}
