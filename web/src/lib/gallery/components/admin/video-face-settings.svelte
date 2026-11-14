<script lang="ts">
  import SettingInputField from '#lib/components/shared-components/settings/SettingInputField.svelte';
  import SettingSwitch from '#lib/components/shared-components/settings/SettingSwitch.svelte';
  import { SettingInputFieldType } from '#lib/constants.ts';
  import type { AdminConfigDto } from '@immich/sdk';
  import { t } from 'svelte-i18n';

  // Video face sampling, inside the facial recognition section of the machine learning settings
  // (specs/2026-10-31-video-face-frames-design.md).

  type Props = {
    configToEdit: AdminConfigDto;
    config: AdminConfigDto;
    disabled: boolean;
  };

  let { configToEdit = $bindable(), config, disabled }: Props = $props();

  // An older server sends no `video` block; the section is then hidden rather than shown with nothing to bind.
  const video = $derived(configToEdit.machineLearning.facialRecognition.video);
  const saved = $derived(config.machineLearning.facialRecognition.video);
  const recognitionOff = $derived(
    disabled || !configToEdit.machineLearning.enabled || !configToEdit.machineLearning.facialRecognition.enabled,
  );
  const off = $derived(recognitionOff || !video?.enabled);
</script>

{#if video}
  <hr />

  <SettingSwitch
    title={$t('admin.machine_learning_video_faces_setting')}
    subtitle={$t('admin.machine_learning_video_faces_setting_description')}
    bind:checked={configToEdit.machineLearning.facialRecognition.video.enabled}
    disabled={recognitionOff}
  />

  <SettingInputField
    inputType={SettingInputFieldType.NUMBER}
    label={$t('admin.machine_learning_video_faces_interval')}
    description={$t('admin.machine_learning_video_faces_interval_description')}
    bind:value={configToEdit.machineLearning.facialRecognition.video.sampleInterval}
    step="0.5"
    min={0.5}
    max={60}
    disabled={off}
    isEdited={video.sampleInterval !== saved?.sampleInterval}
  />

  <SettingSwitch
    title={$t('admin.machine_learning_video_faces_scene_detection')}
    subtitle={$t('admin.machine_learning_video_faces_scene_detection_description')}
    bind:checked={configToEdit.machineLearning.facialRecognition.video.sceneDetection}
    disabled={off}
  />

  <SettingInputField
    inputType={SettingInputFieldType.NUMBER}
    label={$t('admin.machine_learning_video_faces_max_frames')}
    description={$t('admin.machine_learning_video_faces_max_frames_description')}
    bind:value={configToEdit.machineLearning.facialRecognition.video.maxFrames}
    step="10"
    min={10}
    max={10_000}
    disabled={off}
    isEdited={video.maxFrames !== saved?.maxFrames}
  />

  <SettingSwitch
    title={$t('admin.machine_learning_video_faces_tiled_detection')}
    subtitle={$t('admin.machine_learning_video_faces_tiled_detection_description')}
    bind:checked={configToEdit.machineLearning.facialRecognition.video.tiledDetection}
    disabled={off}
  />

  <!-- Each of these is hidden against an older server that does not send it (issue 1306 added them). -->
  {#if video.maxDistance !== undefined}
    <SettingInputField
      inputType={SettingInputFieldType.NUMBER}
      label={$t('admin.machine_learning_video_faces_max_distance')}
      description={$t('admin.machine_learning_video_faces_max_distance_description')}
      bind:value={configToEdit.machineLearning.facialRecognition.video.maxDistance}
      step="0.05"
      min={0.1}
      max={1}
      disabled={off}
      isEdited={video.maxDistance !== saved?.maxDistance}
    />
  {/if}

  {#if video.minFaceSize !== undefined}
    <SettingInputField
      inputType={SettingInputFieldType.NUMBER}
      label={$t('admin.machine_learning_video_faces_min_face_size')}
      description={$t('admin.machine_learning_video_faces_min_face_size_description')}
      bind:value={configToEdit.machineLearning.facialRecognition.video.minFaceSize}
      step="1"
      min={0}
      max={500}
      disabled={off}
      isEdited={video.minFaceSize !== saved?.minFaceSize}
    />
  {/if}

  {#if video.minSightings !== undefined}
    <SettingInputField
      inputType={SettingInputFieldType.NUMBER}
      label={$t('admin.machine_learning_video_faces_min_sightings')}
      description={$t('admin.machine_learning_video_faces_min_sightings_description')}
      bind:value={configToEdit.machineLearning.facialRecognition.video.minSightings}
      step="1"
      min={1}
      max={100}
      disabled={off}
      isEdited={video.minSightings !== saved?.minSightings}
    />
  {/if}

  {#if video.createPeople !== undefined}
    <SettingSwitch
      title={$t('admin.machine_learning_video_faces_create_people')}
      subtitle={$t('admin.machine_learning_video_faces_create_people_description')}
      bind:checked={configToEdit.machineLearning.facialRecognition.video.createPeople}
      disabled={off}
    />
  {/if}
{/if}
