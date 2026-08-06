import { BadRequestException, Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { AgentSession } from 'src/database';
import { AgentSessionCreateDto, AgentSessionResponseDto, AgentSessionUpdateDto } from 'src/dtos/agent-session.dto';
import { AuthDto } from 'src/dtos/auth.dto';
import { AgentPermissionPreset, AgentSessionActivityEventStatus, AgentSessionStatus } from 'src/enum';
import { AgentSessionRepository } from 'src/repositories/agent-session.repository';
import { AgentProviderCredentialService } from 'src/services/agent-provider-credential.service';
import { AgentRunnerService } from 'src/services/agent-runner.service';
import { AgentSessionActivityEventService } from 'src/services/agent-session-activity-event.service';
import {
  AgentCredentialSnapshot,
  AgentNormalizedPermissionPlanSnapshot,
  AgentPermissionPlanSnapshot,
  AgentPermissionPresetMap,
} from 'src/types/agent-session.types';

@Injectable()
export class AgentSessionService {
  private static readonly legacyWriteScopeDefaults = {
    removeAssets: false,
    createSpace: false,
    addAssetsToSpaces: false,
    removeAssetsFromSpaces: false,
    updateSpaceDetails: false,
    addMembersToSpaces: false,
    removeMembersFromSpaces: false,
    updateSpaceMemberRoles: false,
    editAssets: false,
    favoriteAssets: false,
    archiveAssets: false,
    tagAssets: false,
    updateAssetMetadata: false,
    trashAssets: false,
    createSharedLinks: false,
    shareAlbums: false,
    lockAssets: false,
    deleteContainers: false,
    manageStacks: false,
    managePeople: false,
  };

  static readonly permissionPresets: AgentPermissionPresetMap = {
    [AgentPermissionPreset.Careful]: {
      read: { metadata: true, previews: false, originals: false },
      providerExposure: {
        metadata: true,
        previews: false,
        originals: false,
        allowOriginalsForExternalProviders: false,
      },
      assetScope: { owned: true, sharedSpaces: false, locked: false },
      writeScope: {
        createAlbum: true,
        addAssets: true,
        removeAssets: false,
        updateDetails: true,
        setCover: true,
        createSpace: true,
        addAssetsToSpaces: true,
        removeAssetsFromSpaces: false,
        updateSpaceDetails: true,
        addMembersToSpaces: false,
        removeMembersFromSpaces: false,
        updateSpaceMemberRoles: false,
        editAssets: false,
        favoriteAssets: true,
        archiveAssets: false,
        tagAssets: true,
        updateAssetMetadata: false,
        trashAssets: false,
        createSharedLinks: false,
        shareAlbums: false,
        lockAssets: false,
        deleteContainers: false,
        manageStacks: false,
        managePeople: false,
      },
      limits: {
        maxAssetsPerToolCall: 1000,
        maxAssetsPerSession: 10_000,
        maxPreviewsPerToolCall: 0,
        maxPreviewsPerSession: 0,
        maxOriginalsPerToolCall: 0,
        maxOriginalsPerSession: 0,
        expiresInMinutes: 120,
      },
    },
    [AgentPermissionPreset.VisualOrganizer]: {
      read: { metadata: true, previews: true, originals: false },
      providerExposure: {
        metadata: true,
        previews: true,
        originals: false,
        allowOriginalsForExternalProviders: false,
      },
      assetScope: { owned: true, sharedSpaces: true, locked: false },
      writeScope: {
        createAlbum: true,
        addAssets: true,
        removeAssets: true,
        updateDetails: true,
        setCover: true,
        createSpace: true,
        addAssetsToSpaces: true,
        removeAssetsFromSpaces: true,
        updateSpaceDetails: true,
        addMembersToSpaces: true,
        removeMembersFromSpaces: true,
        updateSpaceMemberRoles: true,
        editAssets: true,
        favoriteAssets: true,
        archiveAssets: true,
        tagAssets: true,
        updateAssetMetadata: true,
        trashAssets: true,
        createSharedLinks: false,
        shareAlbums: true,
        lockAssets: false,
        deleteContainers: false,
        manageStacks: true,
        managePeople: true,
      },
      limits: {
        maxAssetsPerToolCall: 2000,
        maxAssetsPerSession: 20_000,
        maxPreviewsPerToolCall: 100,
        maxPreviewsPerSession: 500,
        maxOriginalsPerToolCall: 0,
        maxOriginalsPerSession: 0,
        expiresInMinutes: 120,
      },
    },
    [AgentPermissionPreset.LocalPowerUser]: {
      read: { metadata: true, previews: true, originals: true },
      providerExposure: {
        metadata: true,
        previews: true,
        originals: true,
        allowOriginalsForExternalProviders: false,
      },
      assetScope: { owned: true, sharedSpaces: true, locked: false },
      writeScope: {
        createAlbum: true,
        addAssets: true,
        removeAssets: true,
        updateDetails: true,
        setCover: true,
        createSpace: true,
        addAssetsToSpaces: true,
        removeAssetsFromSpaces: true,
        updateSpaceDetails: true,
        addMembersToSpaces: true,
        removeMembersFromSpaces: true,
        updateSpaceMemberRoles: true,
        editAssets: true,
        favoriteAssets: true,
        archiveAssets: true,
        tagAssets: true,
        updateAssetMetadata: true,
        trashAssets: true,
        createSharedLinks: true,
        shareAlbums: true,
        lockAssets: true,
        deleteContainers: true,
        manageStacks: true,
        managePeople: true,
      },
      limits: {
        maxAssetsPerToolCall: 5000,
        maxAssetsPerSession: 50_000,
        maxPreviewsPerToolCall: 100,
        maxPreviewsPerSession: 500,
        maxOriginalsPerToolCall: 25,
        maxOriginalsPerSession: 50,
        expiresInMinutes: 120,
      },
    },
  };

  constructor(
    private readonly repository: AgentSessionRepository,
    private readonly credentialService: AgentProviderCredentialService,
    private readonly agentRunnerService: AgentRunnerService,
    private readonly activityEventService: AgentSessionActivityEventService,
  ) {}

  async create(auth: AuthDto, dto: AgentSessionCreateDto): Promise<AgentSessionResponseDto> {
    const permissionPlanSnapshot = this.resolvePermissionPlan(dto);
    const { credential, credentialSecret, credentialSnapshot } = await this.resolveCredential(auth, dto);

    const session = await this.repository.create({
      userId: auth.user.id,
      providerCredentialId: credential.id,
      credentialSnapshot,
      modelSnapshot: {
        providerCredentialId: credential.id,
        model: dto.model,
      },
      permissionPreset: dto.permissionPreset,
      permissionPlanSnapshot,
      approvalMode: dto.approvalMode,
      runnerEndpoint: dto.runnerEndpoint ?? null,
      runnerSessionId: null,
      runnerCapabilitiesSnapshot: null,
      status: AgentSessionStatus.Created,
      initialContextSnapshot: dto.initialContext ?? {},
      title: null,
    });

    let runnerSession: Awaited<ReturnType<AgentRunnerService['createSession']>>;
    try {
      runnerSession = await this.agentRunnerService.createSession({
        userId: auth.user.id,
        gallerySessionId: session.id,
        credential: { ...session.credentialSnapshot, secret: credentialSecret },
        model: session.modelSnapshot.model,
        permissionPreset: session.permissionPreset,
        permissionPlan: session.permissionPlanSnapshot,
        approvalMode: session.approvalMode,
        initialContext: session.initialContextSnapshot,
      });
    } catch (error) {
      try {
        await this.repository.markFailedFromCreated(auth.user.id, session.id, new Date());
      } catch {
        // Preserve the runner start error; failed-state marking is best-effort diagnostics.
      }
      throw error;
    }

    const runningSession = await this.repository.markRunningFromCreated(auth.user.id, session.id, {
      status: AgentSessionStatus.Running,
      runnerEndpoint: runnerSession.runnerEndpoint,
      runnerSessionId: runnerSession.runnerSessionId,
      runnerCapabilitiesSnapshot: runnerSession.runnerCapabilitiesSnapshot,
    });

    if (!runningSession) {
      const current = await this.repository.getById(auth.user.id, session.id);
      if (current) {
        return this.map(current);
      }

      throw new BadRequestException('Agent session not found');
    }

    return this.map(runningSession);
  }

  async validateCreate(auth: AuthDto, dto: AgentSessionCreateDto): Promise<void> {
    const permissionPlanSnapshot = this.resolvePermissionPlan(dto);
    const { credentialSecret, credentialSnapshot } = await this.resolveCredential(auth, dto);

    await this.agentRunnerService.validateSession({
      userId: auth.user.id,
      gallerySessionId: randomUUID(),
      credential: { ...credentialSnapshot, secret: credentialSecret },
      model: dto.model,
      permissionPreset: dto.permissionPreset,
      permissionPlan: permissionPlanSnapshot,
      approvalMode: dto.approvalMode,
      initialContext: dto.initialContext ?? {},
    });
  }

  async getAll(auth: AuthDto): Promise<AgentSessionResponseDto[]> {
    const sessions = await this.repository.getByUserId(auth.user.id);
    return sessions.map((session) => this.map(session));
  }

  async getById(auth: AuthDto, id: string): Promise<AgentSessionResponseDto> {
    const session = await this.getOwned(auth, id);
    return this.map(session);
  }

  async update(auth: AuthDto, id: string, dto: AgentSessionUpdateDto): Promise<AgentSessionResponseDto> {
    await this.getOwned(auth, id);
    return this.map(await this.repository.updateMetadata(auth.user.id, id, { title: dto.title?.trim() || null }));
  }

  async delete(auth: AuthDto, id: string): Promise<void> {
    const deleted = await this.repository.delete(auth.user.id, id);
    if (!deleted) {
      throw new BadRequestException('Agent session not found');
    }
  }

  async cancel(auth: AuthDto, id: string): Promise<AgentSessionResponseDto> {
    const session = await this.getOwned(auth, id);

    if (session.status === AgentSessionStatus.Cancelled) {
      return this.map(session);
    }

    if (
      session.status === AgentSessionStatus.Applying ||
      session.status === AgentSessionStatus.Completed ||
      session.status === AgentSessionStatus.Failed
    ) {
      throw new BadRequestException('Agent session cannot be cancelled in its current state');
    }

    const updated = await this.repository.cancel(auth.user.id, id, new Date());

    if (!updated) {
      const current = await this.repository.getById(auth.user.id, id);
      if (current?.status === AgentSessionStatus.Cancelled) {
        return this.map(current);
      }

      throw new BadRequestException('Agent session cannot be cancelled in its current state');
    }

    await this.cancelRunnerSession(session);

    try {
      await this.activityEventService.closeOpenLifecycleEvents(
        auth.user.id,
        id,
        AgentSessionActivityEventStatus.Skipped,
      );
    } catch {
      // Closing activity events is best-effort; the database cancellation is authoritative.
    }

    return this.map(updated);
  }

  private async cancelRunnerSession(session: AgentSession): Promise<void> {
    try {
      await this.agentRunnerService.cancelSession({
        runnerEndpoint: session.runnerEndpoint,
        runnerSessionId: session.runnerSessionId,
      });
    } catch {
      // The database cancellation is authoritative; runner cleanup is best-effort.
    }
  }

  private resolvePermissionPlan(dto: AgentSessionCreateDto): AgentPermissionPlanSnapshot {
    if (dto.permissionPreset === AgentPermissionPreset.Custom) {
      if (!dto.permissionPlan) {
        throw new BadRequestException('permissionPlan is required when permissionPreset is custom');
      }

      return this.backfillPermissionPlan(structuredClone(dto.permissionPlan));
    }

    if (dto.permissionPlan) {
      throw new BadRequestException('permissionPlan is only accepted when permissionPreset is custom');
    }

    return structuredClone(AgentSessionService.permissionPresets[dto.permissionPreset]);
  }

  private async resolveCredential(auth: AuthDto, dto: AgentSessionCreateDto) {
    const credential = await this.credentialService.getById(auth, dto.providerCredentialId);

    if (credential.models.length > 0 && !credential.models.includes(dto.model)) {
      throw new BadRequestException('Model is not listed for the selected credential');
    }

    const credentialSecret = await this.credentialService.getSecret(auth, dto.providerCredentialId);

    const credentialSnapshot: AgentCredentialSnapshot = {
      id: credential.id,
      providerType: credential.providerType,
      label: credential.label,
      baseUrl: credential.baseUrl,
      models: credential.models,
      defaultModel: credential.defaultModel,
    };

    return { credential, credentialSecret, credentialSnapshot };
  }

  private backfillPermissionPlan(permissionPlan: AgentPermissionPlanSnapshot): AgentNormalizedPermissionPlanSnapshot {
    return {
      ...permissionPlan,
      writeScope: {
        ...AgentSessionService.legacyWriteScopeDefaults,
        ...permissionPlan.writeScope,
      },
      limits: {
        ...permissionPlan.limits,
        maxPreviewsPerSession:
          permissionPlan.limits.maxPreviewsPerSession ?? permissionPlan.limits.maxPreviewsPerToolCall,
        maxOriginalsPerSession:
          permissionPlan.limits.maxOriginalsPerSession ?? permissionPlan.limits.maxOriginalsPerToolCall,
      },
    };
  }

  private async getOwned(auth: AuthDto, id: string) {
    const session = await this.repository.getById(auth.user.id, id);
    if (!session) {
      throw new BadRequestException('Agent session not found');
    }

    return session;
  }

  private map(session: AgentSession): AgentSessionResponseDto {
    return {
      id: session.id,
      status: session.status,
      title: session.title,
      providerCredentialId: session.providerCredentialId,
      credentialSnapshot: session.credentialSnapshot,
      modelSnapshot: session.modelSnapshot,
      permissionPreset: session.permissionPreset,
      permissionPlanSnapshot: this.backfillPermissionPlan(structuredClone(session.permissionPlanSnapshot)),
      approvalMode: session.approvalMode,
      runnerEndpoint: session.runnerEndpoint,
      runnerSessionId: session.runnerSessionId,
      runnerCapabilitiesSnapshot: session.runnerCapabilitiesSnapshot,
      initialContextSnapshot: session.initialContextSnapshot,
      createdAt: session.createdAt,
      updatedAt: session.updatedAt,
      endedAt: session.endedAt,
    };
  }
}
