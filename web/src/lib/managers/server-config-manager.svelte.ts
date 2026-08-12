import { getServerConfig, type ServerConfigDto } from '@immich/sdk';
import { eventManager } from '$lib/managers/event-manager.svelte';

class ServerConfigManager {
  #value?: ServerConfigDto = $state();

  constructor() {
    eventManager.on({
      SystemConfigUpdate: () => this.loadServerConfig(),
    });
  }

  async init() {
    await this.loadServerConfig();
  }

  get value() {
    if (!this.#value) {
      throw new Error('Server config manager must be initialized first');
    }

    return this.#value;
  }

  // Gallery-fork: the storage meters render before the root layout's init() has resolved, and a
  // missing config there just means "fall back to upstream behaviour" rather than a hard error.
  get valueOrUndefined() {
    return this.#value;
  }

  async loadServerConfig() {
    this.#value = await getServerConfig();
  }
}

export const serverConfigManager = new ServerConfigManager();
