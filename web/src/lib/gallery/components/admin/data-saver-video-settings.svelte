<script lang="ts">
  import SettingAccordion from '#lib/components/shared-components/settings/SettingAccordion.svelte';
  import SettingInputField from '#lib/components/shared-components/settings/SettingInputField.svelte';
  import SettingSwitch from '#lib/components/shared-components/settings/SettingSwitch.svelte';
  import { SettingInputFieldType } from '#lib/constants.ts';
  import { DataSaverVideoCodec, DataSaverVideoResolution, type AdminConfigDto } from '@immich/sdk';
  import { t } from 'svelte-i18n';
  // the select lives beside the settings page it was written for; nothing in $lib exports one
  import SettingSelect from '../../../../routes/admin/system-settings/SettingSelect.svelte';

  // Data Saver video's section of the video transcoding settings (specs/2026-11-01-data-saver-video-design.md). Only
  // what differs from the normal transcode is here; acceleration, preset and tone-mapping follow the sections above.

  type Props = {
    configToEdit: AdminConfigDto;
    config: AdminConfigDto;
    disabled: boolean;
  };

  let { configToEdit = $bindable(), config, disabled }: Props = $props();

  const off = $derived(disabled || !configToEdit.ffmpeg.dataSaver.enabled);
</script>

<SettingAccordion
  key="data-saver-video"
  title={$t('admin.transcoding_data_saver')}
  subtitle={$t('admin.transcoding_data_saver_description')}
>
  <div class="ms-4 mt-4 flex flex-col gap-4">
    <SettingSwitch
      title={$t('admin.transcoding_data_saver_enabled')}
      subtitle={$t('admin.transcoding_data_saver_enabled_description')}
      bind:checked={configToEdit.ffmpeg.dataSaver.enabled}
      isEdited={configToEdit.ffmpeg.dataSaver.enabled !== config.ffmpeg.dataSaver.enabled}
      {disabled}
    />

    <SettingSelect
      label={$t('admin.transcoding_data_saver_video_codec')}
      desc={$t('admin.transcoding_data_saver_video_codec_description')}
      name="data-saver-video-codec"
      bind:value={configToEdit.ffmpeg.dataSaver.targetVideoCodec}
      options={[
        { value: DataSaverVideoCodec.Hevc, text: 'HEVC' },
        { value: DataSaverVideoCodec.H264, text: 'H.264' },
        { value: DataSaverVideoCodec.Av1, text: 'AV1' },
      ]}
      disabled={off}
      isEdited={configToEdit.ffmpeg.dataSaver.targetVideoCodec !== config.ffmpeg.dataSaver.targetVideoCodec}
    />

    <SettingSelect
      label={$t('admin.transcoding_data_saver_resolution')}
      desc={$t('admin.transcoding_data_saver_resolution_description')}
      name="data-saver-resolution"
      bind:value={configToEdit.ffmpeg.dataSaver.targetResolution}
      options={[
        { value: DataSaverVideoResolution.$1080, text: '1080p' },
        { value: DataSaverVideoResolution.$720, text: '720p' },
        { value: DataSaverVideoResolution.$480, text: '480p' },
      ]}
      disabled={off}
      isEdited={configToEdit.ffmpeg.dataSaver.targetResolution !== config.ffmpeg.dataSaver.targetResolution}
    />

    <SettingInputField
      inputType={SettingInputFieldType.TEXT}
      label={$t('admin.transcoding_data_saver_max_bitrate')}
      description={$t('admin.transcoding_data_saver_max_bitrate_description')}
      bind:value={configToEdit.ffmpeg.dataSaver.maxBitrate}
      required={true}
      disabled={off}
      isEdited={configToEdit.ffmpeg.dataSaver.maxBitrate !== config.ffmpeg.dataSaver.maxBitrate}
    />
  </div>
</SettingAccordion>
