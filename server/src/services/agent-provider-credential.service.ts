import { BadRequestException, Injectable } from '@nestjs/common';
import { Updateable } from 'kysely';
import { AgentProviderCredential } from 'src/database';
import {
  AgentProviderCredentialCreateDto,
  AgentProviderCredentialResponseDto,
  AgentProviderCredentialUpdateDto,
} from 'src/dtos/agent-provider-credential.dto';
import { AuthDto } from 'src/dtos/auth.dto';
import { AgentProviderType } from 'src/enum';
import { AgentProviderCredentialRepository } from 'src/repositories/agent-provider-credential.repository';
import { AgentProviderCredentialTable } from 'src/schema/tables/agent-provider-credential.table';
import { EncryptedSecretService } from 'src/services/encrypted-secret.service';

@Injectable()
export class AgentProviderCredentialService {
  constructor(
    private readonly repository: AgentProviderCredentialRepository,
    private readonly encryptedSecretService: EncryptedSecretService,
  ) {}

  async create(auth: AuthDto, dto: AgentProviderCredentialCreateDto): Promise<AgentProviderCredentialResponseDto> {
    this.validateDefaultModel(dto.models ?? [], dto.defaultModel ?? null);

    const encryptedSecret = this.encryptedSecretService.encrypt(dto.secret);
    const credential = await this.repository.create({
      userId: auth.user.id,
      providerType: dto.providerType,
      label: dto.label,
      baseUrl: dto.baseUrl ?? null,
      encryptedSecret,
      secretVersion: 1,
      models: dto.models ?? [],
      defaultModel: dto.defaultModel ?? null,
    });

    return this.map(credential);
  }

  async getAll(auth: AuthDto): Promise<AgentProviderCredentialResponseDto[]> {
    const credentials = await this.repository.getByUserId(auth.user.id);
    return credentials.map((credential) => this.map(credential));
  }

  async getById(auth: AuthDto, id: string): Promise<AgentProviderCredentialResponseDto> {
    const credential = await this.getOwned(auth, id);
    return this.map(credential);
  }

  async update(
    auth: AuthDto,
    id: string,
    dto: AgentProviderCredentialUpdateDto,
  ): Promise<AgentProviderCredentialResponseDto> {
    const existing = await this.getOwned(auth, id);
    const providerType = dto.providerType ?? existing.providerType;
    const baseUrl = dto.baseUrl === undefined ? existing.baseUrl : dto.baseUrl;

    if (providerType === AgentProviderType.OpenAICompatible && !baseUrl) {
      throw new BadRequestException('baseUrl is required for openai-compatible providers');
    }

    this.validateDefaultModel(
      dto.models === undefined ? existing.models : dto.models,
      dto.defaultModel === undefined ? existing.defaultModel : dto.defaultModel,
    );

    const update: Updateable<AgentProviderCredentialTable> = {};
    if (dto.providerType !== undefined) {
      update.providerType = dto.providerType;
    }
    if (dto.label !== undefined) {
      update.label = dto.label;
    }
    if (dto.baseUrl !== undefined) {
      update.baseUrl = dto.baseUrl;
    }
    if (dto.models !== undefined) {
      update.models = dto.models;
    }
    if (dto.defaultModel !== undefined) {
      update.defaultModel = dto.defaultModel;
    }
    if (dto.secret !== undefined) {
      update.encryptedSecret = this.encryptedSecretService.encrypt(dto.secret);
      update.secretVersion = existing.secretVersion + 1;
    }

    if (Object.keys(update).length === 0) {
      throw new BadRequestException('No credential fields to update');
    }

    const credential = await this.repository.update(auth.user.id, id, update);
    return this.map(credential);
  }

  async delete(auth: AuthDto, id: string): Promise<void> {
    await this.getOwned(auth, id);
    await this.repository.delete(auth.user.id, id);
  }

  async getSecret(auth: AuthDto, id: string): Promise<string> {
    const credential = await this.getOwned(auth, id);
    return this.encryptedSecretService.decrypt(credential.encryptedSecret);
  }

  private async getOwned(auth: AuthDto, id: string) {
    const credential = await this.repository.getById(auth.user.id, id);
    if (!credential) {
      throw new BadRequestException('Agent provider credential not found');
    }

    return credential;
  }

  private validateDefaultModel(models: string[], defaultModel: string | null) {
    if (models.length > 0 && defaultModel && !models.includes(defaultModel)) {
      throw new BadRequestException('defaultModel must be listed in models');
    }
  }

  private map(credential: AgentProviderCredential): AgentProviderCredentialResponseDto {
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
