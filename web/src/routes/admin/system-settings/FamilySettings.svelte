<script lang="ts">
  import SettingButtonsRow from '$lib/components/shared-components/settings/SystemConfigButtonRow.svelte';
  import SettingSelect from './SettingSelect.svelte';
  import SettingSwitch from '$lib/components/shared-components/settings/SettingSwitch.svelte';
  import { featureFlagsManager } from '$lib/managers/feature-flags-manager.svelte';
  import { systemConfigManager } from '$lib/managers/system-config-manager.svelte';
  import { DefaultAccess } from '@immich/sdk';
  import { t } from 'svelte-i18n';
  import { fade } from 'svelte/transition';
  import FamilyAccessGrants from './FamilyAccessGrants.svelte';

  // Gallery-fork: family relationships (D2). Layer 1 — the instance-wide switch plus default
  // access level — lives here, following the exact TrashSettings shape: SettingSwitch,
  // SettingSelect, SettingButtonsRow bound to the `familyTree` config key. Layer 2 — the
  // per-user grant table that overrides this default — is `FamilyAccessGrants.svelte`, rendered
  // below. The two are separate storage (E66): saving here only ever touches `familyTree`, never
  // any row in the grants table.
  const disabled = $derived(featureFlagsManager.value.configFile);
  const config = $derived(systemConfigManager.value);
  let configToEdit = $state(systemConfigManager.cloneValue());
</script>

<div>
  <div in:fade={{ duration: 500 }}>
    <form autocomplete="off" onsubmit={(event) => event.preventDefault()}>
      <div class="ms-4 mt-4 flex flex-col gap-4">
        <SettingSwitch
          title={$t('admin.family_admin_enable_title')}
          subtitle={$t('admin.family_admin_enable_description')}
          {disabled}
          bind:checked={configToEdit.familyTree.enabled}
        />

        <hr />

        <SettingSelect
          label={$t('admin.family_admin_default_access_label')}
          desc={$t('admin.family_admin_default_access_description')}
          bind:value={configToEdit.familyTree.defaultAccess}
          name="family-admin-default-access"
          options={[
            { value: DefaultAccess.None, text: $t('admin.family_admin_access_level_none') },
            { value: DefaultAccess.View, text: $t('admin.family_admin_access_level_view') },
            { value: DefaultAccess.Contribute, text: $t('admin.family_admin_access_level_contribute') },
          ]}
          isEdited={configToEdit.familyTree.defaultAccess !== config.familyTree.defaultAccess}
          disabled={disabled || !configToEdit.familyTree.enabled}
        />

        <SettingButtonsRow bind:configToEdit keys={['familyTree']} {disabled} />

        <hr />

        <FamilyAccessGrants />
      </div>
    </form>
  </div>
</div>
