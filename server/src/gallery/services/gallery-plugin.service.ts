import { Injectable } from '@nestjs/common';
import { OnEvent } from 'src/decorators.js';
import { BootstrapEventPriority, ImmichWorker } from 'src/enum.js';
import { BaseService } from 'src/services/base.service.js';

const GALLERY_PLUGIN = 'gallery-core';

@Injectable()
export class GalleryPluginService extends BaseService {
  /**
   * The Immich trial in the switch-back guide disables the gallery-core plugin, and nothing turns it back on: upstream's
   * plugin import never touches `enabled`. Without this line a forgotten re-enable only shows up as
   * "No loaded plugin found for <uuid>" on every workflow run that has a Gallery step.
   */
  @OnEvent({ name: 'AppBootstrap', priority: BootstrapEventPriority.PluginLoad, workers: [ImmichWorker.Microservices] })
  async onPluginLoad() {
    const plugin = await this.pluginRepository.getByName(GALLERY_PLUGIN);
    if (!plugin) {
      return;
    }

    const loaded = await this.pluginRepository.getForLoad();
    if (loaded.every(({ name }) => name !== GALLERY_PLUGIN)) {
      this.logger.warn(
        `The ${GALLERY_PLUGIN} plugin is disabled, so workflows with a Gallery step fail. ` +
          `Re-enable it with: UPDATE plugin SET enabled = true WHERE name = '${GALLERY_PLUGIN}';`,
      );
    }
  }
}
