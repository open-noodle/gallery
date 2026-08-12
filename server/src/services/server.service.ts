import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { serverVersion } from 'src/constants';
import { StorageCore } from 'src/cores/storage.core';
import { OnEvent } from 'src/decorators';
import { LicenseKeyDto, LicenseResponseDto } from 'src/dtos/license.dto';
import {
  ServerAboutResponseDto,
  ServerApkLinksDto,
  ServerConfigDto,
  ServerFeaturesDto,
  ServerMediaTypesResponseDto,
  ServerMlHealthResponseDto,
  ServerPingResponse,
  ServerStatsResponseDto,
  ServerStorageResponseDto,
  UsageByUserDto,
} from 'src/dtos/server.dto';
import { StorageFolder, SyncRequestType, SystemMetadataKey } from 'src/enum';
import { isActiveDistanceThreshold } from 'src/repositories/search.repository';
import { UserStatsQueryResponse } from 'src/repositories/user.repository';
import { BaseService } from 'src/services/base.service';
import { getAdminAvailableMemoryTypeKeys, MEMORY_TYPE_KEYS } from 'src/services/memory-rules/memory-type.metadata';
import { asHumanReadable } from 'src/utils/bytes';
import { mimeTypes } from 'src/utils/mime-types';
import {
  isDuplicateDetectionEnabled,
  isFacialRecognitionEnabled,
  isOcrEnabled,
  isSmartSearchEnabled,
} from 'src/utils/misc';

@Injectable()
export class ServerService extends BaseService {
  private mlHealthCache?: { value: ServerMlHealthResponseDto; expiresAt: number };
  private mlHealthInFlight?: Promise<ServerMlHealthResponseDto>;

  @OnEvent({ name: 'AppBootstrap' })
  async onBootstrap(): Promise<void> {
    const featureFlags = await this.getFeatures();
    if (featureFlags.configFile) {
      await this.systemMetadataRepository.set(SystemMetadataKey.AdminOnboarding, {
        isOnboarded: true,
      });
    }
    this.logger.log(`Feature Flags: ${JSON.stringify(await this.getFeatures(), null, 2)}`);
  }

  async getMlHealth(): Promise<ServerMlHealthResponseDto> {
    const now = Date.now();
    if (this.mlHealthCache && this.mlHealthCache.expiresAt > now) {
      return this.mlHealthCache.value;
    }
    if (this.mlHealthInFlight) {
      return this.mlHealthInFlight;
    }
    this.mlHealthInFlight = (async () => {
      try {
        const { ok } = await this.machineLearningRepository.ping();
        const value: ServerMlHealthResponseDto = { smartSearchHealthy: ok };
        this.mlHealthCache = { value, expiresAt: Date.now() + 30_000 };
        return value;
      } finally {
        this.mlHealthInFlight = undefined;
      }
    })();
    return this.mlHealthInFlight;
  }

  async getAboutInfo(): Promise<ServerAboutResponseDto> {
    const version = `v${serverVersion.toString()}`;
    const { buildMetadata } = this.configRepository.getEnv();
    const buildVersions = await this.serverInfoRepository.getBuildVersions();
    const licensed = await this.systemMetadataRepository.get(SystemMetadataKey.License);

    const repoUrl = buildMetadata.repositoryUrl || 'https://github.com/immich-app/immich';

    return {
      version,
      versionUrl: `${repoUrl}/releases/tag/${version}`,
      licensed: !!licensed,
      ...buildMetadata,
      ...buildVersions,
    };
  }

  getApkLinks(): ServerApkLinksDto {
    const { buildMetadata } = this.configRepository.getEnv();
    const repoUrl = buildMetadata.repositoryUrl || 'https://github.com/immich-app/immich';
    const baseUrl = `${repoUrl}/releases/download/v${serverVersion.toString()}`;
    return {
      arm64v8a: `${baseUrl}/app-arm64-v8a-release.apk`,
      armeabiv7a: `${baseUrl}/app-armeabi-v7a-release.apk`,
      universal: `${baseUrl}/app-release.apk`,
      x86_64: `${baseUrl}/app-x86_64-release.apk`,
    };
  }

  async getStorage(): Promise<ServerStorageResponseDto> {
    const libraryBase = StorageCore.getBaseFolder(StorageFolder.Library);
    const diskInfo = await this.storageRepository.checkDiskUsage(libraryBase);

    const usagePercentage = (((diskInfo.total - diskInfo.free) / diskInfo.total) * 100).toFixed(2);

    const serverInfo = new ServerStorageResponseDto();
    serverInfo.diskAvailable = asHumanReadable(diskInfo.available);
    serverInfo.diskSize = asHumanReadable(diskInfo.total);
    serverInfo.diskUse = asHumanReadable(diskInfo.total - diskInfo.free);
    serverInfo.diskAvailableRaw = diskInfo.available;
    serverInfo.diskSizeRaw = diskInfo.total;
    serverInfo.diskUseRaw = diskInfo.total - diskInfo.free;
    serverInfo.diskUsagePercentage = Number(usagePercentage);
    return serverInfo;
  }

  ping(): ServerPingResponse {
    return { res: 'pong' };
  }

  async getFeatures(): Promise<ServerFeaturesDto> {
    // Cached read — see search.service.ts for rationale. This endpoint is hit on
    // every web-app page load; the uncached buildConfig dominates latency on
    // slower CPUs. Cache invalidates on ConfigUpdate.
    const { reverseGeocoding, metadata, map, machineLearning, trash, oauth, passwordLogin, notifications, ffmpeg } =
      await this.getConfig({ withCache: true });
    const { configFile, peopleStatistics } = this.configRepository.getEnv();

    return {
      smartSearch: isSmartSearchEnabled(machineLearning),
      smartSearchHasCutoff:
        isSmartSearchEnabled(machineLearning) && isActiveDistanceThreshold(machineLearning.clip.maxDistance),
      facialRecognition: isFacialRecognitionEnabled(machineLearning),
      duplicateDetection: isDuplicateDetectionEnabled(machineLearning),
      map: map.enabled,
      reverseGeocoding: reverseGeocoding.enabled,
      importFaces: metadata.faces.import,
      sidecar: true,
      search: true,
      trash: trash.enabled,
      oauth: oauth.enabled,
      oauthAutoLaunch: oauth.autoLaunch,
      ocr: isOcrEnabled(machineLearning),
      passwordLogin: passwordLogin.enabled,
      configFile: !!configFile,
      email: notifications.smtp.enabled,
      realtimeTranscoding: ffmpeg.realtime.enabled,
      peopleStatistics,
      // Capability signal for mobile sync gating: /sync/stream 400s the whole request on any
      // type outside this enum, so clients must know the accepted set before asking. Version
      // numbers can't carry this (RC builds report the bare base version).
      syncRequestTypes: Object.values(SyncRequestType),
    };
  }

  async getTheme() {
    const { theme } = await this.getConfig({ withCache: true });
    return theme;
  }

  async getSystemConfig(): Promise<ServerConfigDto> {
    const config = await this.getConfig({ withCache: true });
    const isInitialized = !(await this.isSetupAvailable());
    const onboarding = await this.systemMetadataRepository.get(SystemMetadataKey.AdminOnboarding);

    return {
      loginPageMessage: config.server.loginPageMessage,
      trashDays: config.trash.days,
      userDeleteDelay: config.user.deleteDelay,
      oauthButtonText: config.oauth.buttonText,
      oauthAccountManagementUrl: config.oauth.accountManagementUrl,
      isInitialized,
      isOnboarded: onboarding?.isOnboarded || false,
      externalDomain: config.server.externalDomain,
      publicUsers: config.server.publicUsers,
      mapDarkStyleUrl: config.map.darkStyle,
      mapLightStyleUrl: config.map.lightStyle,
      maintenanceMode: false,
      minFaces: config.machineLearning.facialRecognition.minFaces,
      availableMemoryTypes: MEMORY_TYPE_KEYS.filter((key) => getAdminAvailableMemoryTypeKeys(config.memories).has(key)),
    };
  }

  async getStatistics(): Promise<ServerStatsResponseDto> {
    const userStats: UserStatsQueryResponse[] = await this.userRepository.getUserStats();
    const serverStats = new ServerStatsResponseDto();
    serverStats.photos ??= 0;
    serverStats.videos ??= 0;
    serverStats.usage ??= 0;
    serverStats.usagePhotos ??= 0;
    serverStats.usageVideos ??= 0;
    serverStats.usageByUser ??= [];

    for (const user of userStats) {
      const usage = new UsageByUserDto();
      usage.userId = user.userId;
      usage.userName = user.userName;
      usage.photos = user.photos;
      usage.videos = user.videos;
      usage.usage = user.usage;
      usage.usagePhotos = user.usagePhotos;
      usage.usageVideos = user.usageVideos;
      usage.quotaSizeInBytes = user.quotaSizeInBytes;

      serverStats.photos += usage.photos;
      serverStats.videos += usage.videos;
      serverStats.usage += usage.usage;
      serverStats.usagePhotos += usage.usagePhotos;
      serverStats.usageVideos += usage.usageVideos;

      serverStats.usageByUser.push(usage);
    }

    return serverStats;
  }

  getSupportedMediaTypes(): ServerMediaTypesResponseDto {
    return {
      video: Object.keys(mimeTypes.video),
      image: Object.keys(mimeTypes.image),
      sidecar: Object.keys(mimeTypes.sidecar),
    };
  }

  async deleteLicense(): Promise<void> {
    await this.systemMetadataRepository.delete(SystemMetadataKey.License);
  }

  async getLicense(): Promise<LicenseResponseDto> {
    const license = await this.systemMetadataRepository.get(SystemMetadataKey.License);
    if (!license) {
      throw new NotFoundException();
    }
    return license;
  }

  async setLicense(dto: LicenseKeyDto): Promise<LicenseResponseDto> {
    if (!dto.licenseKey.startsWith('IMSV-')) {
      throw new BadRequestException('Invalid license key');
    }
    const { licensePublicKey } = this.configRepository.getEnv();
    const isLicenseValid = this.cryptoRepository.verifySha256(
      dto.licenseKey,
      dto.activationKey,
      licensePublicKey.server,
    );
    if (!isLicenseValid) {
      throw new BadRequestException('Invalid license key');
    }

    const licenseData = { ...dto, activatedAt: new Date() };

    await this.systemMetadataRepository.set(SystemMetadataKey.License, licenseData);

    return licenseData;
  }
}
