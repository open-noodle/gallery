<script lang="ts">
  import SettingInputField from '#lib/components/shared-components/settings/SettingInputField.svelte';
  import SettingSwitch from '#lib/components/shared-components/settings/SettingSwitch.svelte';
  import { SettingInputFieldType } from '#lib/constants.ts';
  import type { AdminConfigDto } from '@immich/sdk';
  import { t } from 'svelte-i18n';

  // Pet sampling across the whole video, inside the pet detection section of the machine learning settings
  // (specs/2026-11-16-video-pet-detection-design.md).

  type Props = {
    configToEdit: AdminConfigDto;
    config: AdminConfigDto;
    disabled: boolean;
  };

  let { configToEdit = $bindable(), config, disabled }: Props = $props();

  // An older server sends no `video` block; the section is then hidden rather than shown with nothing to bind.
  const video = $derived(configToEdit.machineLearning.petDetection.video);
  const saved = $derived(config.machineLearning.petDetection.video);
  const detectionOff = $derived(
    disabled || !configToEdit.machineLearning.enabled || !configToEdit.machineLearning.petDetection.enabled,
  );
  const off = $derived(detectionOff || !video?.enabled);
</script>

{#if video}
  <hr />

  <SettingSwitch
    title={$t('admin.machine_learning_video_pets_setting')}
    subtitle={$t('admin.machine_learning_video_pets_setting_description')}
    bind:checked={configToEdit.machineLearning.petDetection.video.enabled}
    disabled={detectionOff}
  />

  <SettingInputField
    inputType={SettingInputFieldType.NUMBER}
    label={$t('admin.machine_learning_video_faces_interval')}
    description={$t('admin.machine_learning_video_pets_interval_description')}
    bind:value={configToEdit.machineLearning.petDetection.video.sampleInterval}
    step="0.5"
    min={0.5}
    max={60}
    disabled={off}
    isEdited={video.sampleInterval !== saved?.sampleInterval}
  />

  <SettingSwitch
    title={$t('admin.machine_learning_video_faces_scene_detection')}
    subtitle={$t('admin.machine_learning_video_faces_scene_detection_description')}
    bind:checked={configToEdit.machineLearning.petDetection.video.sceneDetection}
    disabled={off}
  />

  <SettingInputField
    inputType={SettingInputFieldType.NUMBER}
    label={$t('admin.machine_learning_video_faces_max_frames')}
    description={$t('admin.machine_learning_video_faces_max_frames_description')}
    bind:value={configToEdit.machineLearning.petDetection.video.maxFrames}
    step="10"
    min={10}
    max={10_000}
    disabled={off}
    isEdited={video.maxFrames !== saved?.maxFrames}
  />

  <SettingInputField
    inputType={SettingInputFieldType.NUMBER}
    label={$t('admin.machine_learning_video_pets_max_distance')}
    description={$t('admin.machine_learning_video_pets_max_distance_description')}
    bind:value={configToEdit.machineLearning.petDetection.video.maxDistance}
    step="0.05"
    min={0.1}
    max={2}
    disabled={off}
    isEdited={video.maxDistance !== saved?.maxDistance}
  />

  <SettingInputField
    inputType={SettingInputFieldType.NUMBER}
    label={$t('admin.machine_learning_video_pets_min_sightings')}
    description={$t('admin.machine_learning_video_pets_min_sightings_description')}
    bind:value={configToEdit.machineLearning.petDetection.video.minSightings}
    step="1"
    min={1}
    max={100}
    disabled={off}
    isEdited={video.minSightings !== saved?.minSightings}
  />
{/if}
