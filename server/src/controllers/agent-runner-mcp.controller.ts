import { Body, Controller, HttpCode, HttpStatus, Param, Post, Res, UseGuards } from '@nestjs/common';
import { ApiAcceptedResponse, ApiOkResponse, ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import { AgentRunnerTokenGuard } from 'src/controllers/agent-runner-token.guard';
import { Endpoint, HistoryBuilder } from 'src/decorators';
import { AuthDto } from 'src/dtos/auth.dto';
import { ApiTag } from 'src/enum';
import { Auth } from 'src/middleware/auth.guard';
import { AgentMcpService } from 'src/services/agent-mcp.service';
import type { AgentMcpHandleResponse } from 'src/types/agent-mcp.types';
import { UUIDParamDto } from 'src/validation';

const history = () => new HistoryBuilder().added('v2.7.5').internal('v2.7.5');

@ApiTags(ApiTag.AgentSessions)
@Controller('agent/internal/mcp/sessions/:id')
@UseGuards(AgentRunnerTokenGuard)
export class AgentRunnerMcpController {
  constructor(private readonly service: AgentMcpService) {}

  @Post()
  @HttpCode(HttpStatus.OK)
  @ApiOkResponse({ description: 'MCP JSON-RPC response' })
  @ApiAcceptedResponse({ description: 'MCP notification accepted' })
  @Endpoint({
    summary: 'Handle the internal runner MCP endpoint',
    description: 'Internal runner MCP endpoint for a first-party Pi agent session.',
    history: history(),
  })
  async handle(
    @Auth() auth: AuthDto,
    @Param() { id }: UUIDParamDto,
    @Body() body: unknown,
    @Res({ passthrough: true }) response: Response,
  ): Promise<AgentMcpHandleResponse> {
    const result = await this.service.handle(auth, id, body);
    if (result === undefined) {
      response.status(HttpStatus.ACCEPTED);
    }

    return result;
  }
}
