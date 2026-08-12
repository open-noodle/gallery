<script lang="ts">
  import SettingButtonsRow from '$lib/components/shared-components/settings/SystemConfigButtonRow.svelte';
  import SettingSwitch from '$lib/components/shared-components/settings/SettingSwitch.svelte';
  import { featureFlagsManager } from '$lib/managers/feature-flags-manager.svelte';
  import { systemConfigManager } from '$lib/managers/system-config-manager.svelte';
  import { Icon } from '@immich/ui';
  import { mdiHelpCircleOutline } from '@mdi/js';
  import { t } from 'svelte-i18n';
  import { fade } from 'svelte/transition';

  const disabled = $derived(featureFlagsManager.value.configFile);
  let configToEdit = $state(systemConfigManager.cloneValue());
</script>

<div class="mt-2">
  <div in:fade={{ duration: 500 }}>
    <form autocomplete="off" class="mx-4 mt-4" onsubmit={(event) => event.preventDefault()}>
      <div class="ms-4 mt-4 flex flex-col gap-4">
        <SettingSwitch
          title={$t('admin.storage_usage_include_derivatives_setting')}
          subtitle={$t('admin.storage_usage_include_derivatives_setting_description')}
          bind:checked={configToEdit.storageUsage.includeDerivatives}
          {disabled}
        />

        <p class="text-sm dark:text-immich-dark-fg">
          <Icon icon={mdiHelpCircleOutline} class="inline" size="15" />
          {$t('admin.storage_usage_derivatives_refresh_hint')}
        </p>
      </div>

      <SettingButtonsRow bind:configToEdit keys={['storageUsage']} {disabled} />
    </form>
  </div>
</div>
