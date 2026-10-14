import { BadRequestException, Injectable } from '@nestjs/common';
import { Insertable } from 'kysely';
import sanitize from 'sanitize-filename';
import type { ClassConstructor } from 'src/types.js';
import type { LoginDetails } from 'src/services/auth.service.js';
import { SALT_ROUNDS } from 'src/constants.js';
import { StorageCore } from 'src/cores/storage.core.js';
import { UserAdmin } from 'src/database.js';
import { mapLoginResponse } from 'src/dtos/auth.dto.js';
import { SystemConfig } from 'src/dtos/config.dto.js';
import { FaceSearchRepository } from 'src/gallery/repositories/face-search.repository.js';
import { FilterSuggestionRepository } from 'src/gallery/repositories/filter-suggestion.repository.js';
import { GallerySyncRepository } from 'src/gallery/repositories/gallery-sync.repository.js';
import { MemoryRuleAssetRepository } from 'src/gallery/repositories/memory-rule-asset.repository.js';
import { PetFaceRepository } from 'src/gallery/repositories/pet-face.repository.js';
import { QueueMaintenanceRepository } from 'src/gallery/repositories/queue-maintenance.repository.js';
import { SmartFacetRepository } from 'src/gallery/repositories/smart-facet.repository.js';
import { SpaceAlbumRepository } from 'src/gallery/repositories/space-album.repository.js';
import { BackendMediaServer } from 'src/gallery/utils/backend-media-server.js';
import { computePhysicalUsage } from 'src/gallery/utils/storage-usage.js';
import { AccessRepository } from 'src/repositories/access.repository.js';
import { ActivityRepository } from 'src/repositories/activity.repository.js';
import { AlbumUserRepository } from 'src/repositories/album-user.repository.js';
import { AlbumRepository } from 'src/repositories/album.repository.js';
import { ApiKeyRepository } from 'src/repositories/api-key.repository.js';
import { AppRepository } from 'src/repositories/app.repository.js';
import { AssetEditRepository } from 'src/repositories/asset-edit.repository.js';
import { AssetFavoriteRepository } from 'src/repositories/asset-favorite.repository.js';
import { AssetFileRepository } from 'src/repositories/asset-file.repository.js';
import { AssetJobRepository } from 'src/repositories/asset-job.repository.js';
import { AssetRepository } from 'src/repositories/asset.repository.js';
import { AuthChallengeRepository } from 'src/repositories/auth-challenge.repository.js';
import { ClassificationRepository } from 'src/repositories/classification.repository.js';
import { ClusterGroupRepository } from 'src/repositories/cluster-group.repository.js';
import { ConfigRepository } from 'src/repositories/config.repository.js';
import { CronRepository } from 'src/repositories/cron.repository.js';
import { CryptoRepository } from 'src/repositories/crypto.repository.js';
import { DatabaseRepository } from 'src/repositories/database.repository.js';
import { DownloadRepository } from 'src/repositories/download.repository.js';
import { DuplicateRepository } from 'src/repositories/duplicate.repository.js';
import { EmailRepository } from 'src/repositories/email.repository.js';
import { EventRepository } from 'src/repositories/event.repository.js';
import { FaceIdentityRepository } from 'src/repositories/face-identity.repository.js';
import { FacePersonVerdictRepository } from 'src/repositories/face-person-verdict.repository.js';
import { FaceRepairDeclineRepository } from 'src/repositories/face-repair-decline.repository.js';
import { FaceRepairScanRepository } from 'src/repositories/face-repair-scan.repository.js';
import { FaceRepairRepository } from 'src/repositories/face-repair.repository.js';
import { IntegrityRepository } from 'src/repositories/integrity.repository.js';
import { JobRepository } from 'src/repositories/job.repository.js';
import { LibraryRepository } from 'src/repositories/library.repository.js';
import { LoggingRepository } from 'src/repositories/logging.repository.js';
import { MachineLearningRepository } from 'src/repositories/machine-learning.repository.js';
import { MapRepository } from 'src/repositories/map.repository.js';
import { MediaRepository } from 'src/repositories/media.repository.js';
import { MemoryRepository } from 'src/repositories/memory.repository.js';
import { MetadataRepository } from 'src/repositories/metadata.repository.js';
import { MoveRepository } from 'src/repositories/move.repository.js';
import { NotificationRepository } from 'src/repositories/notification.repository.js';
import { OAuthRepository } from 'src/repositories/oauth.repository.js';
import { OcrRepository } from 'src/repositories/ocr.repository.js';
import { PartnerRepository } from 'src/repositories/partner.repository.js';
import { PasskeyRepository } from 'src/repositories/passkey.repository.js';
import { PersonUserRepository } from 'src/repositories/person-user.repository.js';
import { PersonRepository } from 'src/repositories/person.repository.js';
import { PluginRepository } from 'src/repositories/plugin.repository.js';
import { ProcessRepository } from 'src/repositories/process.repository.js';
import { SearchRepository } from 'src/repositories/search.repository.js';
import { ServerInfoRepository } from 'src/repositories/server-info.repository.js';
import { SessionRepository } from 'src/repositories/session.repository.js';
import { SharedLinkAssetRepository } from 'src/repositories/shared-link-asset.repository.js';
import { SharedLinkRepository } from 'src/repositories/shared-link.repository.js';
import { SharedSpaceRepository } from 'src/repositories/shared-space.repository.js';
import { StackRepository } from 'src/repositories/stack.repository.js';
import { StorageMigrationRepository } from 'src/repositories/storage-migration.repository.js';
import { StorageRepository } from 'src/repositories/storage.repository.js';
import { SyncCheckpointRepository } from 'src/repositories/sync-checkpoint.repository.js';
import { SyncRepository } from 'src/repositories/sync.repository.js';
import { SystemMetadataRepository } from 'src/repositories/system-metadata.repository.js';
import { TagRepository } from 'src/repositories/tag.repository.js';
import { TelemetryRepository } from 'src/repositories/telemetry.repository.js';
import { TrashRepository } from 'src/repositories/trash.repository.js';
import { UserGroupRepository } from 'src/repositories/user-group.repository.js';
import { UserRepository } from 'src/repositories/user.repository.js';
import { VersionHistoryRepository } from 'src/repositories/version-history.repository.js';
import { VideoStreamRepository } from 'src/repositories/video-stream.repository.js';
import { ViewRepository } from 'src/repositories/view-repository.js';
import { WebAuthnRepository } from 'src/repositories/webauthn.repository.js';
import { WebsocketRepository } from 'src/repositories/websocket.repository.js';
import { WorkflowRepository } from 'src/repositories/workflow.repository.js';
import { UserTable } from 'src/schema/tables/user.table.js';
import { FaceAssignmentService } from 'src/services/face-assignment.service.js';
import { IdentityMergePropagationService } from 'src/services/identity-merge-propagation.service.js';
import {
  AccessPersonRequest,
  AccessRequest,
  checkAccess,
  checkPersonAccess,
  requireAccess,
  requirePersonAccess,
} from 'src/utils/access.js';
import { getConfig, updateConfig } from 'src/utils/config.js';
import { ViewerScopeArgs, ViewerSurface, resolveViewerScope } from 'src/utils/viewer-scope.js';

export const BASE_SERVICE_DEPENDENCIES = [
  LoggingRepository,
  AccessRepository,
  ActivityRepository,
  AlbumRepository,
  AlbumUserRepository,
  ApiKeyRepository,
  AppRepository,
  AssetRepository,
  AssetEditRepository,
  AssetFileRepository,
  AssetJobRepository,
  AuthChallengeRepository,
  ClusterGroupRepository,
  ConfigRepository,
  CronRepository,
  CryptoRepository,
  DatabaseRepository,
  DownloadRepository,
  DuplicateRepository,
  EmailRepository,
  EventRepository,
  IntegrityRepository,
  JobRepository,
  LibraryRepository,
  MachineLearningRepository,
  MapRepository,
  MediaRepository,
  MemoryRepository,
  MetadataRepository,
  MoveRepository,
  NotificationRepository,
  OAuthRepository,
  OcrRepository,
  PartnerRepository,
  PasskeyRepository,
  PersonRepository,
  PersonUserRepository,
  PluginRepository,
  ProcessRepository,
  SearchRepository,
  ServerInfoRepository,
  SessionRepository,
  SharedLinkRepository,
  SharedLinkAssetRepository,
  StackRepository,
  StorageRepository,
  SyncRepository,
  SyncCheckpointRepository,
  SystemMetadataRepository,
  TagRepository,
  TelemetryRepository,
  TrashRepository,
  UserRepository,
  VersionHistoryRepository,
  VideoStreamRepository,
  ViewRepository,
  WebAuthnRepository,
  WebsocketRepository,
  WorkflowRepository,
  // Gallery fork repositories: keep last, in the same order in every positional list
  AssetFavoriteRepository,
  ClassificationRepository,
  FaceIdentityRepository,
  FaceRepairRepository,
  FaceRepairScanRepository,
  FaceRepairDeclineRepository,
  FacePersonVerdictRepository,
  SharedSpaceRepository,
  StorageMigrationRepository,
  UserGroupRepository,
  FilterSuggestionRepository,
  MemoryRuleAssetRepository,
  QueueMaintenanceRepository,
  SmartFacetRepository,
  SpaceAlbumRepository,
  PetFaceRepository,
  FaceSearchRepository,
  GallerySyncRepository,
] as const;

@Injectable()
export class BaseService {
  protected storageCore: StorageCore;
  protected identityMergePropagationService: IdentityMergePropagationService;
  protected faceAssignmentService: FaceAssignmentService;
  protected backendMedia: BackendMediaServer;

  constructor(
    protected logger: LoggingRepository,
    protected accessRepository: AccessRepository,
    protected activityRepository: ActivityRepository,
    protected albumRepository: AlbumRepository,
    protected albumUserRepository: AlbumUserRepository,
    protected apiKeyRepository: ApiKeyRepository,
    protected appRepository: AppRepository,
    protected assetRepository: AssetRepository,
    protected assetEditRepository: AssetEditRepository,
    protected assetFileRepository: AssetFileRepository,
    protected assetJobRepository: AssetJobRepository,
    protected authChallengeRepository: AuthChallengeRepository,
    protected clusterGroupRepository: ClusterGroupRepository,
    protected configRepository: ConfigRepository,
    protected cronRepository: CronRepository,
    protected cryptoRepository: CryptoRepository,
    protected databaseRepository: DatabaseRepository,
    protected downloadRepository: DownloadRepository,
    protected duplicateRepository: DuplicateRepository,
    protected emailRepository: EmailRepository,
    protected eventRepository: EventRepository,
    protected integrityRepository: IntegrityRepository,
    protected jobRepository: JobRepository,
    protected libraryRepository: LibraryRepository,
    protected machineLearningRepository: MachineLearningRepository,
    protected mapRepository: MapRepository,
    protected mediaRepository: MediaRepository,
    protected memoryRepository: MemoryRepository,
    protected metadataRepository: MetadataRepository,
    protected moveRepository: MoveRepository,
    protected notificationRepository: NotificationRepository,
    protected oauthRepository: OAuthRepository,
    protected ocrRepository: OcrRepository,
    protected partnerRepository: PartnerRepository,
    protected passkeyRepository: PasskeyRepository,
    protected personRepository: PersonRepository,
    protected personUserRepository: PersonUserRepository,
    protected pluginRepository: PluginRepository,
    protected processRepository: ProcessRepository,
    protected searchRepository: SearchRepository,
    protected serverInfoRepository: ServerInfoRepository,
    protected sessionRepository: SessionRepository,
    protected sharedLinkRepository: SharedLinkRepository,
    protected sharedLinkAssetRepository: SharedLinkAssetRepository,
    protected stackRepository: StackRepository,
    protected storageRepository: StorageRepository,
    protected syncRepository: SyncRepository,
    protected syncCheckpointRepository: SyncCheckpointRepository,
    protected systemMetadataRepository: SystemMetadataRepository,
    protected tagRepository: TagRepository,
    protected telemetryRepository: TelemetryRepository,
    protected trashRepository: TrashRepository,
    protected userRepository: UserRepository,
    protected versionRepository: VersionHistoryRepository,
    protected videoStreamRepository: VideoStreamRepository,
    protected viewRepository: ViewRepository,
    protected webAuthnRepository: WebAuthnRepository,
    protected websocketRepository: WebsocketRepository,
    protected workflowRepository: WorkflowRepository,
    // Gallery fork repositories: keep last, in the same order in every positional list
    protected assetFavoriteRepository: AssetFavoriteRepository,
    protected classificationRepository: ClassificationRepository,
    protected faceIdentityRepository: FaceIdentityRepository,
    protected faceRepairRepository: FaceRepairRepository,
    protected faceRepairScanRepository: FaceRepairScanRepository,
    protected faceRepairDeclineRepository: FaceRepairDeclineRepository,
    protected facePersonVerdictRepository: FacePersonVerdictRepository,
    protected sharedSpaceRepository: SharedSpaceRepository,
    protected storageMigrationRepository: StorageMigrationRepository,
    protected userGroupRepository: UserGroupRepository,
    protected filterSuggestionRepository: FilterSuggestionRepository,
    protected memoryRuleAssetRepository: MemoryRuleAssetRepository,
    protected queueMaintenanceRepository: QueueMaintenanceRepository,
    protected smartFacetRepository: SmartFacetRepository,
    protected spaceAlbumRepository: SpaceAlbumRepository,
    protected petFaceRepository: PetFaceRepository,
    protected faceSearchRepository: FaceSearchRepository,
    protected gallerySyncRepository: GallerySyncRepository,
  ) {
    this.logger.setContext(this.constructor.name);
    this.storageCore = StorageCore.create(
      assetRepository,
      configRepository,
      cryptoRepository,
      moveRepository,
      personRepository,
      storageRepository,
      systemMetadataRepository,
      this.logger,
    );
    this.identityMergePropagationService = new IdentityMergePropagationService({
      databaseRepository,
      faceIdentityRepository,
      jobRepository,
      logger: this.logger,
      personRepository,
      sharedSpaceRepository,
    });
    this.faceAssignmentService = new FaceAssignmentService({
      databaseRepository,
      faceIdentityRepository,
      facePersonVerdictRepository,
      faceRepairDeclineRepository,
      faceRepairRepository,
      personRepository,
    });
    this.backendMedia = new BackendMediaServer({
      assetRepository,
      mediaRepository,
      storageRepository,
      getConfig: (options) => this.getConfig(options),
    });
  }

  static create<T extends ClassConstructor<typeof BaseService>>(Service: T, ctx: BaseService) {
    const service = new Service(
      LoggingRepository.create(),
      ctx.accessRepository,
      ctx.activityRepository,
      ctx.albumRepository,
      ctx.albumUserRepository,
      ctx.apiKeyRepository,
      ctx.appRepository,
      ctx.assetRepository,
      ctx.assetEditRepository,
      ctx.assetFileRepository,
      ctx.assetJobRepository,
      ctx.authChallengeRepository,
      ctx.clusterGroupRepository,
      ctx.configRepository,
      ctx.cronRepository,
      ctx.cryptoRepository,
      ctx.databaseRepository,
      ctx.downloadRepository,
      ctx.duplicateRepository,
      ctx.emailRepository,
      ctx.eventRepository,
      ctx.integrityRepository,
      ctx.jobRepository,
      ctx.libraryRepository,
      ctx.machineLearningRepository,
      ctx.mapRepository,
      ctx.mediaRepository,
      ctx.memoryRepository,
      ctx.metadataRepository,
      ctx.moveRepository,
      ctx.notificationRepository,
      ctx.oauthRepository,
      ctx.ocrRepository,
      ctx.partnerRepository,
      ctx.passkeyRepository,
      ctx.personRepository,
      ctx.personUserRepository,
      ctx.pluginRepository,
      ctx.processRepository,
      ctx.searchRepository,
      ctx.serverInfoRepository,
      ctx.sessionRepository,
      ctx.sharedLinkRepository,
      ctx.sharedLinkAssetRepository,
      ctx.stackRepository,
      ctx.storageRepository,
      ctx.syncRepository,
      ctx.syncCheckpointRepository,
      ctx.systemMetadataRepository,
      ctx.tagRepository,
      ctx.telemetryRepository,
      ctx.trashRepository,
      ctx.userRepository,
      ctx.versionRepository,
      ctx.videoStreamRepository,
      ctx.viewRepository,
      ctx.webAuthnRepository,
      ctx.websocketRepository,
      ctx.workflowRepository,
      // Gallery fork repositories: keep last, in the same order in every positional list
      ctx.assetFavoriteRepository,
      ctx.classificationRepository,
      ctx.faceIdentityRepository,
      ctx.faceRepairRepository,
      ctx.faceRepairScanRepository,
      ctx.faceRepairDeclineRepository,
      ctx.facePersonVerdictRepository,
      ctx.sharedSpaceRepository,
      ctx.storageMigrationRepository,
      ctx.userGroupRepository,
      ctx.filterSuggestionRepository,
      ctx.memoryRuleAssetRepository,
      ctx.queueMaintenanceRepository,
      ctx.smartFacetRepository,
      ctx.spaceAlbumRepository,
      ctx.petFaceRepository,
      ctx.faceSearchRepository,
      ctx.gallerySyncRepository,
    );

    service.logger.setContext(BaseService.name);

    return service as InstanceType<T>;
  }

  get worker() {
    return this.configRepository.getWorker();
  }

  private get configRepos() {
    return {
      configRepo: this.configRepository,
      metadataRepo: this.systemMetadataRepository,
      logger: this.logger,
    };
  }

  getConfig(options: { withCache: boolean }) {
    return getConfig(this.configRepos, options);
  }

  updateConfig(newConfig: SystemConfig) {
    return updateConfig(this.configRepos, newConfig);
  }

  requireAccess(request: AccessRequest) {
    return requireAccess(this.accessRepository, request);
  }

  checkAccess(request: AccessRequest) {
    return checkAccess(this.accessRepository, request);
  }

  requirePersonAccess(request: AccessPersonRequest) {
    return requirePersonAccess(this.accessRepository, request);
  }

  checkPersonAccess(request: AccessPersonRequest) {
    return checkPersonAccess(this.accessRepository, request);
  }

  /** Fork: what this viewer may see on a surface — see src/utils/viewer-scope.ts. */
  resolveViewerScope<S extends ViewerSurface>(...args: ViewerScopeArgs<S>) {
    const { sharedSpaceRepository, faceIdentityRepository } = this;
    return resolveViewerScope({ sharedSpaceRepository, faceIdentityRepository }, ...args);
  }

  async isSetupAvailable(): Promise<boolean> {
    const { setup } = this.configRepository.getEnv();
    return setup.allow && !(await this.userRepository.hasAdmin());
  }

  async requireSetupAvailable(): Promise<void> {
    if (!(await this.isSetupAvailable())) {
      throw new BadRequestException('Admin setup is not available');
    }
  }

  // Gallery-fork: upstream calls userRepository.syncUsage() directly from its two call sites
  // (user.service.ts handleUserSyncUsage and user-admin.service.ts). The fork routes both through
  // here so a single admin toggle can decide what quotaUsageInBytes means: upstream's originals-only
  // sum, or a physical walk that also counts thumbnails and transcodes. Either way the column holds
  // the figure the admin asked for, so display and quota enforcement need no knowledge of the
  // setting. The walk's own logic lives in src/gallery/utils/storage-usage.ts.
  protected async syncUsage(id?: string): Promise<void> {
    // The walk is expensive — hundreds of thousands of stat calls on a large install — so the
    // default path stays exactly as cheap as upstream's single statement.
    const { storageUsage } = await this.getConfig({ withCache: false });
    if (!storageUsage.includeDerivatives) {
      await this.userRepository.syncUsage(id);
      return;
    }

    // Deliberately either/or: running upstream's statement here too would immediately overwrite
    // the physical figure with the originals-only one.
    // lazy import to avoid circular dependency (StorageService extends BaseService)
    const { StorageService } = await import('./storage.service.js');
    const s3 = StorageService.getS3Backend();
    const users = id
      ? [await this.userRepository.get(id, { withDeleted: false })].filter((user): user is UserAdmin => !!user)
      : await this.userRepository.getList({ withDeleted: false });

    for (const user of users) {
      const usage = await computePhysicalUsage({
        user,
        assetRepository: this.assetRepository,
        storageRepository: this.storageRepository,
        s3,
      });
      await this.userRepository.setUsage(user.id, usage);
    }
  }

  async createUser(dto: Omit<Insertable<UserTable>, 'clusterGroupId'> & { email: string }): Promise<UserAdmin> {
    const exists = await this.userRepository.getByEmail(dto.email);
    if (exists) {
      this.logger.debug('User creation rejected: user already exists');
      throw new BadRequestException('Email is not available');
    }

    if (!dto.isAdmin) {
      const localAdmin = await this.userRepository.getAdmin();
      if (!localAdmin) {
        throw new BadRequestException('The first registered account must the administrator.');
      }
    }

    const payload: Omit<Insertable<UserTable>, 'clusterGroupId'> = { ...dto };
    if (payload.password) {
      payload.password = await this.cryptoRepository.hashBcrypt(payload.password, SALT_ROUNDS);
    }
    if (payload.storageLabel) {
      payload.storageLabel = sanitize(payload.storageLabel);
    }

    const clusterGroup = await this.clusterGroupRepository.create();
    const user = await this.userRepository.create({ ...payload, clusterGroupId: clusterGroup.id });

    await this.eventRepository.emit('UserCreate', user);

    return user;
  }

  protected async createLoginResponse(
    user: UserAdmin,
    loginDetails: LoginDetails,
    oauthSid?: string,
    oauthBearerToken?: string,
  ) {
    const token = this.cryptoRepository.randomBytesAsText(32);
    const hashed = this.cryptoRepository.hashSha256(token);

    await this.sessionRepository.create({
      token: hashed,
      deviceOS: loginDetails.deviceOS,
      deviceType: loginDetails.deviceType,
      appVersion: loginDetails.appVersion,
      userId: user.id,
      oauthSid: oauthSid ?? null,
      oauthBearerToken: oauthBearerToken ?? null,
    });

    return mapLoginResponse(user, token);
  }
}
