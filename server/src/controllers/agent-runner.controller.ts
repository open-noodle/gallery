import { Controller, Get } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Endpoint, HistoryBuilder } from 'src/decorators';
import { AgentRunnerStatusDto } from 'src/dtos/agent-runner.dto';
import { ApiTag, Permission } from 'src/enum';
import { Authenticated } from 'src/middleware/auth.guard';
import { AgentRunnerService } from 'src/services/agent-runner.service';

@ApiTags(ApiTag.AgentRunner)
@Controller('agent/runner')
export class AgentRunnerController {
  constructor(private service: AgentRunnerService) {}

  @Get('status')
  @Authenticated({ permission: Permission.AgentRunnerRead })
  @Endpoint({
    summary: 'Get agent runner status',
    description: 'Retrieve AI agent runner configuration, health, and capability status.',
    history: new HistoryBuilder().added('v2.7.5').alpha('v2.7.5'),
  })
  getAgentRunnerStatus(): Promise<AgentRunnerStatusDto> {
    return this.service.getStatus();
  }
}
