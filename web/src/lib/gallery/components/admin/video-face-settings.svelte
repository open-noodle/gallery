<script lang="ts">
  import SettingInputField from '$lib/components/shared-components/settings/SettingInputField.svelte';
  import SettingSwitch from '$lib/components/shared-components/settings/SettingSwitch.svelte';
  import { SettingInputFieldType } from '$lib/constants';
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
{/if}
