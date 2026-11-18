<script lang="ts">
  import SettingAccordion from '#lib/components/shared-components/settings/SettingAccordion.svelte';
  import SettingSwitch from '#lib/components/shared-components/settings/SettingSwitch.svelte';
  import { handleError } from '#lib/utils/handle-error.ts';
  import { clearSpatialSceneChoices, getSpatialSceneChoices, type AdminConfigDto } from '@immich/sdk';
  import { Button, modalManager, toastManager } from '@immich/ui';
  import { mdiRestore } from '@mdi/js';
  import { onMount } from 'svelte';
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

  // Per-photo choices made from the viewer menu ("Per-photo actions" in the design). Clearing them is data, not
  // config, so it works while the feature is off and while the config comes from a file.
  let choices = $state<number>();
  let clearing = $state(false);

  onMount(async () => {
    try {
      ({ count: choices } = await getSpatialSceneChoices());
    } catch {
      // leave the count unknown; the button stays disabled
    }
  });

  const handleClear = async () => {
    const count = choices ?? 0;
    const confirmed = await modalManager.showDialog({
      title: $t('admin.spatial_scene_choices_clear'),
      prompt: $t('admin.spatial_scene_choices_clear_confirm', { values: { count } }),
      confirmText: $t('admin.spatial_scene_choices_clear'),
      confirmColor: 'danger',
    });
    if (!confirmed) {
      return;
    }
    clearing = true;
    try {
      const { count: cleared } = await clearSpatialSceneChoices();
      choices = 0;
      toastManager.success($t('admin.spatial_scene_choices_cleared', { values: { count: cleared } }));
    } catch (error) {
      handleError(error, $t('admin.spatial_scene_choices_clear_failed'));
    } finally {
      clearing = false;
    }
  };
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

    <hr />

    <div class="flex flex-wrap items-center justify-between gap-4">
      <div>
        <p class="text-sm font-medium text-primary">{$t('admin.spatial_scene_choices')}</p>
        <p class="text-sm dark:text-immich-dark-fg">
          {choices === undefined
            ? $t('admin.spatial_scene_choices_description')
            : $t('admin.spatial_scene_choices_count', { values: { count: choices } })}
        </p>
      </div>
      <Button
        shape="round"
        size="small"
        color="danger"
        variant="outline"
        leadingIcon={mdiRestore}
        onclick={() => void handleClear()}
        disabled={clearing || !choices}>{$t('admin.spatial_scene_choices_clear')}</Button
      >
    </div>
  </div>
</SettingAccordion>
