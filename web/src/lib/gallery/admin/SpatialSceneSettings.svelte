<script lang="ts">
  import SettingAccordion from '$lib/components/shared-components/settings/SettingAccordion.svelte';
  import SettingSwitch from '$lib/components/shared-components/settings/SettingSwitch.svelte';
  import type { AdminConfigDto } from '@immich/sdk';
  import { t } from 'svelte-i18n';
  // the select lives beside the settings page it was written for; nothing in $lib exports one
  import SettingSelect from '../../../routes/admin/system-settings/SettingSelect.svelte';

  // Spatial Scene's section of the machine learning settings (specs/2026-10-29-spatial-scene-design.md). The
  // suitability thresholds are config-file only: the defaults were tuned on real libraries, and the admin UI keeps to
  // the choices an admin actually makes.

  type Props = {
    configToEdit: AdminConfigDto;
    config: AdminConfigDto;
    disabled: boolean;
  };

  let { configToEdit = $bindable(), config, disabled }: Props = $props();

  const off = $derived(
    disabled || !configToEdit.machineLearning.enabled || !configToEdit.machineLearning.spatialScene.enabled,
  );
</script>

<SettingAccordion
  key="spatial-scene"
  title={$t('admin.machine_learning_spatial_scene')}
  subtitle={$t('admin.machine_learning_spatial_scene_description')}
>
  <div class="ms-4 mt-4 flex flex-col gap-4">
    <SettingSwitch
      title={$t('admin.machine_learning_spatial_scene_setting')}
      subtitle={$t('admin.machine_learning_spatial_scene_setting_description')}
      bind:checked={configToEdit.machineLearning.spatialScene.enabled}
      disabled={disabled || !configToEdit.machineLearning.enabled}
    />

    <hr />

    <SettingSelect
      label={$t('admin.machine_learning_spatial_scene_model')}
      desc={$t('admin.machine_learning_spatial_scene_model_description')}
      name="spatial-scene-model"
      bind:value={configToEdit.machineLearning.spatialScene.modelName}
      options={[
        { value: 'depth-anything-v2-small', text: 'depth-anything-v2-small (any CPU, recommended)' },
        { value: 'distill-any-depth-small', text: 'distill-any-depth-small (any CPU)' },
        { value: 'distill-any-depth-large', text: 'distill-any-depth-large (GPU, sharpest)' },
      ]}
      disabled={off}
      isEdited={configToEdit.machineLearning.spatialScene.modelName !== config.machineLearning.spatialScene.modelName}
    />

    <SettingSelect
      label={$t('admin.machine_learning_spatial_scene_offer')}
      desc={$t('admin.machine_learning_spatial_scene_offer_description')}
      name="spatial-scene-offer"
      bind:value={configToEdit.machineLearning.spatialScene.offer}
      options={[
        { value: 'suitable', text: $t('admin.spatial_scene_offer_suitable') },
        { value: 'all', text: $t('admin.spatial_scene_offer_all') },
      ]}
      disabled={off}
      isEdited={configToEdit.machineLearning.spatialScene.offer !== config.machineLearning.spatialScene.offer}
    />
  </div>
</SettingAccordion>
