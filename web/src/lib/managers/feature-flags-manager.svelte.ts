import { eventManager } from '$lib/managers/event-manager.svelte';
import { getServerFeatures, type ServerFeaturesDto } from '@immich/sdk';

class FeatureFlagsManager {
  #value?: ServerFeaturesDto = $state();

  constructor() {
    eventManager.on({
      SystemConfigUpdate: () => void this.#loadFeatureFlags(),
    });
  }

  async init() {
    await this.#loadFeatureFlags();
  }

  get value() {
    if (!this.#value) {
      throw new Error('Feature flags manager must be initialized first');
    }

    return this.#value;
  }

  /**
   * Safe read that returns undefined instead of throwing when the manager has not been
   * initialized. Use this at call sites that might run before `init()` completes — e.g.
   * global keyboard shortcuts that fire during the initial SSR→hydration window.
   */
  get valueOrUndefined(): ServerFeaturesDto | undefined {
    return this.#value;
  }

  async #loadFeatureFlags() {
    this.#value = await getServerFeatures();
  }
}

export const featureFlagsManager = new FeatureFlagsManager();
