import { Injectable } from '@nestjs/common';
import { OnEvent } from 'src/decorators.js';
import { ImmichWorker } from 'src/enum.js';
import { galleryVideoSampleCacheDefaults } from 'src/gallery/dtos/config.dto.js';
import { videoSampleCache } from 'src/gallery/utils/video-sample-cache.js';
import type { ArgOf } from 'src/repositories/event.repository.js';
import { BaseService } from 'src/services/base.service.js';

@Injectable()
export class VideoSampleCacheService extends BaseService {
  @OnEvent({ name: 'ConfigInit', workers: [ImmichWorker.Microservices] })
  async onConfigInit({ newConfig }: ArgOf<'ConfigInit'>) {
    await this.apply(newConfig.server.videoSampleCache);
  }

  @OnEvent({ name: 'ConfigUpdate', workers: [ImmichWorker.Microservices], server: true })
  async onConfigUpdate({ newConfig }: ArgOf<'ConfigUpdate'>) {
    await this.apply(newConfig.server.videoSampleCache);
  }

  private async apply(settings: typeof galleryVideoSampleCacheDefaults | undefined) {
    try {
      await videoSampleCache.configure(settings ?? galleryVideoSampleCacheDefaults);
    } catch (error) {
      // Settings are already active; optional cache cleanup must not reject a config save or worker startup.
      this.logger.warn(`Could not prune the video sample cache: ${error}`);
    }
  }
}
