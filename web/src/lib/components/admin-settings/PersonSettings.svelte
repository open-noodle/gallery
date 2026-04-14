<script lang="ts">
  import SettingButtonsRow from '$lib/components/shared-components/settings/SystemConfigButtonRow.svelte';
  import SettingSelect from '$lib/components/shared-components/settings/setting-select.svelte';
  import { featureFlagsManager } from '$lib/managers/feature-flags-manager.svelte';
  import { systemConfigManager } from '$lib/managers/system-config-manager.svelte';
  import { Alert } from '@immich/ui';
  import { PersonDatabaseMode } from '@immich/sdk';
  import { t } from 'svelte-i18n';
  import { fade } from 'svelte/transition';

  const disabled = $derived(featureFlagsManager.value.configFile);
  const config = $derived(systemConfigManager.value);
  let configToEdit = $state(systemConfigManager.cloneValue());

  const modeOptions = $derived([
    { text: $t('admin.person_mode_space'), value: PersonDatabaseMode.Space },
    { text: $t('admin.person_mode_global'), value: PersonDatabaseMode.Global },
  ]);

  const currentMode = $derived(config?.person?.databaseMode ?? PersonDatabaseMode.Space);
  const selectedMode = $derived(configToEdit?.person?.databaseMode ?? PersonDatabaseMode.Space);
  const isChangingToGlobal = $derived(selectedMode === 'global' && currentMode !== 'global');
  const isChangingToSpace = $derived(selectedMode === 'space' && currentMode !== 'space');
</script>

<div>
  <div in:fade={{ duration: 500 }}>
    <form autocomplete="off" onsubmit={(e) => e.preventDefault()}>
      <div class="ms-4 mt-4 flex flex-col gap-4">
        <SettingSelect
          options={modeOptions}
          name="databaseMode"
          label={$t('admin.person_database_mode')}
          description={$t('admin.person_database_mode_description')}
          {disabled}
          bind:value={configToEdit.person.databaseMode}
          isEdited={selectedMode !== currentMode}
        />

        {#if isChangingToGlobal}
          <Alert color="warning" title={$t('admin.person_mode_switch_warning_title')}>
            {$t('admin.person_mode_global_warning')}
          </Alert>
        {/if}

        {#if isChangingToSpace}
          <Alert color="warning" title={$t('admin.person_mode_switch_warning_title')}>
            {$t('admin.person_mode_space_warning')}
          </Alert>
        {/if}
      </div>

      <div class="ms-4">
        <SettingButtonsRow bind:configToEdit keys={['person']} {disabled} />
      </div>
    </form>
  </div>
</div>
