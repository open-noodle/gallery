import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Param, Post, Put } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Endpoint, HistoryBuilder } from 'src/decorators';
import {
  AgentProviderCredentialCreateDto,
  AgentProviderCredentialResponseDto,
  AgentProviderCredentialUpdateDto,
} from 'src/dtos/agent-provider-credential.dto';
import { AuthDto } from 'src/dtos/auth.dto';
import { ApiTag, Permission } from 'src/enum';
import { Auth, Authenticated } from 'src/middleware/auth.guard';
import { AgentProviderCredentialService } from 'src/services/agent-provider-credential.service';
import { UUIDParamDto } from 'src/validation';

@ApiTags(ApiTag.AgentCredentials)
@Controller('agent/provider-credentials')
export class AgentProviderCredentialController {
  constructor(private service: AgentProviderCredentialService) {}

  @Post()
  @Authenticated({ permission: Permission.AgentCredentialCreate })
  @Endpoint({
    summary: 'Create an agent provider credential',
    description: 'Create an encrypted AI agent provider credential for the current user.',
    history: new HistoryBuilder().added('v2.7.5').alpha('v2.7.5'),
  })
  async createAgentProviderCredential(
    @Auth() auth: AuthDto,
    @Body() dto: AgentProviderCredentialCreateDto,
  ): Promise<AgentProviderCredentialResponseDto> {
    return this.map(await this.service.create(auth, dto));
  }

  @Get()
  @Authenticated({ permission: Permission.AgentCredentialRead })
  @Endpoint({
    summary: 'List agent provider credentials',
    description: 'Retrieve all AI agent provider credentials owned by the current user.',
    history: new HistoryBuilder().added('v2.7.5').alpha('v2.7.5'),
  })
  async getAgentProviderCredentials(@Auth() auth: AuthDto): Promise<AgentProviderCredentialResponseDto[]> {
    const credentials = await this.service.getAll(auth);
    return credentials.map((credential) => this.map(credential));
  }

  @Get(':id')
  @Authenticated({ permission: Permission.AgentCredentialRead })
  @Endpoint({
    summary: 'Retrieve an agent provider credential',
    description: 'Retrieve an AI agent provider credential by ID. The current user must own this credential.',
    history: new HistoryBuilder().added('v2.7.5').alpha('v2.7.5'),
  })
  async getAgentProviderCredential(
    @Auth() auth: AuthDto,
    @Param() { id }: UUIDParamDto,
  ): Promise<AgentProviderCredentialResponseDto> {
    return this.map(await this.service.getById(auth, id));
  }

  @Put(':id')
  @Authenticated({ permission: Permission.AgentCredentialUpdate })
  @Endpoint({
    summary: 'Update an agent provider credential',
    description: 'Update an AI agent provider credential by ID. The current user must own this credential.',
    history: new HistoryBuilder().added('v2.7.5').alpha('v2.7.5'),
  })
  async updateAgentProviderCredential(
    @Auth() auth: AuthDto,
    @Param() { id }: UUIDParamDto,
    @Body() dto: AgentProviderCredentialUpdateDto,
  ): Promise<AgentProviderCredentialResponseDto> {
    return this.map(await this.service.update(auth, id, dto));
  }

  @Delete(':id')
  @Authenticated({ permission: Permission.AgentCredentialDelete })
  @HttpCode(HttpStatus.NO_CONTENT)
  @Endpoint({
    summary: 'Delete an agent provider credential',
    description: 'Delete an AI agent provider credential by ID. The current user must own this credential.',
    history: new HistoryBuilder().added('v2.7.5').alpha('v2.7.5'),
  })
  deleteAgentProviderCredential(@Auth() auth: AuthDto, @Param() { id }: UUIDParamDto): Promise<void> {
    return this.service.delete(auth, id);
  }

  private map(credential: AgentProviderCredentialResponseDto): AgentProviderCredentialResponseDto {
    return {
      id: credential.id,
      providerType: credential.providerType,
      label: credential.label,
      baseUrl: credential.baseUrl,
      models: credential.models,
      defaultModel: credential.defaultModel,
      createdAt: credential.createdAt,
      updatedAt: credential.updatedAt,
      lastUsedAt: credential.lastUsedAt,
    };
  }
}
