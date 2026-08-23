<script lang="ts">
  import SettingButtonsRow from '$lib/components/shared-components/settings/SystemConfigButtonRow.svelte';
  import SettingInputField from '$lib/components/shared-components/settings/SettingInputField.svelte';
  import SettingSwitch from '$lib/components/shared-components/settings/SettingSwitch.svelte';
  import { SettingInputFieldType } from '$lib/constants';
  import { featureFlagsManager } from '$lib/managers/feature-flags-manager.svelte';
  import { systemConfigManager } from '$lib/managers/system-config-manager.svelte';
  import { t, type Translations } from 'svelte-i18n';
  import { fade } from 'svelte/transition';

  // Mirrors the server-side memory-type registry keys.
  const memoryTypeKeys = [
    'on_this_day',
    'birthday',
    'recent_trip',
    'month_recap',
    'favorites_throwback',
    'on_this_day_place',
    'season_recap',
    'people_together',
    'video_moments',
    'trip_anniversary',
    'themed',
    'person_throwback',
  ];

  const disabled = $derived(featureFlagsManager.value.configFile);
  const config = $derived(systemConfigManager.value);
  let configToEdit = $state(systemConfigManager.cloneValue());

  // Seed the availability map so every known type renders with its effective value
  // (unset keys default to enabled, matching the registry default). `memoryTypes` shares
  // the reference held by configToEdit, so toggles flow through to the save payload.
  configToEdit.memories.types ??= {};
  const memoryTypes = configToEdit.memories.types;
  for (const key of memoryTypeKeys) {
    memoryTypes[key] ??= true;
  }
</script>

<div>
  <div in:fade={{ duration: 500 }}>
    <form autocomplete="off" onsubmit={(event) => event.preventDefault()}>
      <div class="ms-4 mt-4 flex flex-col gap-4">
        <SettingInputField
          inputType={SettingInputFieldType.NUMBER}
          min={0}
          label={$t('admin.memory_retention_setting')}
          description={$t('admin.memory_retention_setting_description')}
          bind:value={configToEdit.memories.retentionDays}
          required={true}
          {disabled}
          isEdited={configToEdit.memories.retentionDays !== config.memories.retentionDays}
        />
        {#each memoryTypeKeys as key (key)}
          <SettingSwitch
            title={$t(`admin.memory_type_${key}_setting` as Translations)}
            subtitle={$t(`admin.memory_type_${key}_setting_description` as Translations)}
            bind:checked={memoryTypes[key]}
            {disabled}
          />

          <!--
            Per-type tuning lives indented directly under the switch it belongs to, so it is
            unambiguous which memory type a knob affects. A type's knobs are only editable while
            that type is enabled — a disabled type never generates, so its thresholds are inert.
          -->
          {#if key === 'themed'}
            <div class="ms-4 flex flex-col gap-4">
              <SettingInputField
                inputType={SettingInputFieldType.NUMBER}
                min={0}
                max={2}
                step="0.05"
                label={$t('admin.memory_theme_max_distance_setting')}
                description={$t('admin.memory_theme_max_distance_setting_description')}
                bind:value={configToEdit.memories.themeMaxDistance}
                required={true}
                disabled={disabled || !memoryTypes[key]}
                isEdited={configToEdit.memories.themeMaxDistance !== config.memories.themeMaxDistance}
              />
            </div>
          {/if}

          {#if key === 'person_throwback'}
            <div class="ms-4 flex flex-col gap-4">
              <SettingInputField
                inputType={SettingInputFieldType.NUMBER}
                min={1}
                max={120}
                label={$t('admin.memory_person_throwback_dormancy_setting')}
                description={$t('admin.memory_person_throwback_dormancy_setting_description')}
                bind:value={configToEdit.memories.personThrowbackDormancyMonths}
                required={true}
                disabled={disabled || !memoryTypes[key]}
                isEdited={configToEdit.memories.personThrowbackDormancyMonths !==
                  config.memories.personThrowbackDormancyMonths}
              />
            </div>
          {/if}
        {/each}

        <SettingButtonsRow bind:configToEdit keys={['memories']} {disabled} />
      </div>
    </form>
  </div>
</div>
