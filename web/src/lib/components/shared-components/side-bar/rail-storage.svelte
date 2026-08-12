<script lang="ts">
  import { getStorageSpace } from '$lib/gallery/storage-usage';
  import { authManager } from '$lib/managers/auth-manager.svelte';
  import { serverConfigManager } from '$lib/managers/server-config-manager.svelte';
  import { locale } from '$lib/stores/preferences.store';
  import { userInteraction } from '$lib/stores/user.svelte';
  import { requestServerInfo } from '$lib/utils/auth';
  import { getByteUnitString } from '$lib/utils/byte-units';
  import { Icon } from '@immich/ui';
  import { mdiCloudOutline } from '@mdi/js';
  import { onMount } from 'svelte';
  import { t } from 'svelte-i18n';

  // Gallery-fork: derivation shared with StorageSpace.svelte, see $lib/gallery/storage-usage.
  let space = $derived(
    getStorageSpace({
      user: authManager.user,
      authenticated: authManager.authenticated,
      serverInfo: userInteraction.serverInfo,
      serverConfig: serverConfigManager.valueOrUndefined,
    }),
  );
  let availableBytes = $derived(space.availableBytes);
  let usedBytes = $derived(space.usedBytes);

  onMount(async () => {
    if (userInteraction.serverInfo && authManager.authenticated) {
      return;
    }
    await requestServerInfo();
  });
</script>

<div
  data-testid="rail-storage"
  class="mt-auto mb-6 flex justify-center py-2"
  data-used={usedBytes}
  data-available={availableBytes}
  title={$t('storage_usage', {
    values: {
      used: getByteUnitString(usedBytes, $locale, 3),
      available: getByteUnitString(availableBytes, $locale, 3),
    },
  })}
>
  <Icon icon={mdiCloudOutline} size="1.375em" aria-label={$t('storage')} />
</div>
