import { Injectable } from '@nestjs/common';
import { OnEvent } from 'src/decorators';
import { ImmichWorker, JobName } from 'src/enum';
import { ArgOf } from 'src/repositories/event.repository';
import { BaseService } from 'src/services/base.service';

@Injectable()
export class StorageUsageService extends BaseService {
  /**
   * Config-file installs never emit ConfigUpdate — SystemConfigService.updateSystemConfig rejects
   * outright while IMMICH_CONFIG_FILE is set — so the toggle can only ever change across a restart,
   * and the handler below would never see the transition. Resync at boot instead, which is the only
   * signal those installs give us. Repeated on every restart while the toggle is on: that is the
   * cost of having no persisted previous config to diff against, and it is bounded by how often the
   * server restarts, which is far less than the nightly job that keeps the column fresh anyway.
   *
   * Pinned to the Microservices worker for the same reason as onConfigUpdate: UserSyncUsage has no
   * jobId, so an unpinned handler would enqueue one full walk per worker.
   */
  @OnEvent({ name: 'ConfigInit', workers: [ImmichWorker.Microservices] })
  async onConfigInit({ newConfig }: ArgOf<'ConfigInit'>) {
    const { configFile } = this.configRepository.getEnv();
    if (configFile && newConfig.storageUsage.includeDerivatives) {
      await this.jobRepository.queue({ name: JobName.UserSyncUsage });
    }
  }

  /**
   * quotaUsageInBytes holds whichever figure the toggle selects, so *both* directions leave it
   * stale: switching on leaves an originals-only number until the next nightly sync, and switching
   * off leaves a derivative-inclusive one. Queue a resync on any change.
   *
   * Pinned to the Microservices worker: the API worker emits ConfigUpdate locally AND relays it over
   * the redis adapter, so an unpinned handler would enqueue the walk once per worker (and once more
   * per extra API replica). UserSyncUsage has no jobId/deduplication, so every enqueue really walks.
   */
  @OnEvent({ name: 'ConfigUpdate', workers: [ImmichWorker.Microservices], server: true })
  async onConfigUpdate({ newConfig, oldConfig }: ArgOf<'ConfigUpdate'>) {
    if (oldConfig.storageUsage.includeDerivatives !== newConfig.storageUsage.includeDerivatives) {
      await this.jobRepository.queue({ name: JobName.UserSyncUsage });
    }
  }
}
