<script lang="ts">
  import SettingButtonsRow from '$lib/components/shared-components/settings/SystemConfigButtonRow.svelte';
  import SettingSwitch from '$lib/components/shared-components/settings/SettingSwitch.svelte';
  import { featureFlagsManager } from '$lib/managers/feature-flags-manager.svelte';
  import { systemConfigManager } from '$lib/managers/system-config-manager.svelte';
  import { t } from 'svelte-i18n';
  import { fade } from 'svelte/transition';
  import SettingSelect from './SettingSelect.svelte';
  import { ReleaseChannel } from '@immich/sdk';

  const disabled = $derived(featureFlagsManager.value.configFile);
  const config = $derived(systemConfigManager.value);
  let configToEdit = $state(systemConfigManager.cloneValue());
</script>

<div>
  <div in:fade={{ duration: 500 }}>
    <form autocomplete="off" onsubmit={(event) => event.preventDefault()}>
      <div class="ms-4 mt-4 flex flex-col gap-4">
        <SettingSwitch
          title={$t('admin.version_check_enabled_description')}
          subtitle={$t('admin.version_check_implications', { values: { server: 'version.immich.cloud' } })}
          bind:checked={configToEdit.newVersionCheck.enabled}
          {disabled}
        />
        <!-- Gallery fork: the version-check URL is overridden in server-info.repository.ts,
             so `channel` is never sent upstream and this selector would be a silent no-op.
             Hidden rather than removed to keep future upstream diffs to this block visible. -->
        {#if false}
          <SettingSelect
            label={$t('admin.version_check_channel')}
            desc={$t('admin.version_check_channel_description')}
            bind:value={configToEdit.newVersionCheck.channel}
            options={[
              {
                value: ReleaseChannel.Stable,
                text: $t('admin.release_channel_stable'),
              },
              { value: ReleaseChannel.ReleaseCandidate, text: $t('admin.release_channel_release_candidate') },
            ]}
            isEdited={configToEdit.newVersionCheck.channel !== config.newVersionCheck.channel}
            {disabled}
          />
        {/if}
        <SettingButtonsRow bind:configToEdit keys={['newVersionCheck']} {disabled} />
      </div>
    </form>
  </div>
</div>
