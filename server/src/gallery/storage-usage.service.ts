import { Injectable } from '@nestjs/common';
import { SystemConfig } from 'src/config';
import { OnEvent } from 'src/decorators';
import { JobName } from 'src/enum';
import { ArgOf } from 'src/repositories/event.repository';
import { BaseService } from 'src/services/base.service';

const derivativesEnabled = (config: SystemConfig) =>
  config.storageUsage.includeDerivativesInDisplay || config.storageUsage.includeDerivativesInQuota;

@Injectable()
export class StorageUsageService extends BaseService {
  /**
   * The physical-usage column is only maintained while at least one toggle is on, so switching one
   * on would otherwise show a stale or zero figure until the next nightly sync. Queue a resync on
   * the off -> on transition only; flipping the second toggle on, or turning one off, needs nothing.
   */
  @OnEvent({ name: 'ConfigUpdate', server: true })
  async onConfigUpdate({ newConfig, oldConfig }: ArgOf<'ConfigUpdate'>) {
    if (!derivativesEnabled(oldConfig) && derivativesEnabled(newConfig)) {
      await this.jobRepository.queue({ name: JobName.UserSyncUsage });
    }
  }
}
