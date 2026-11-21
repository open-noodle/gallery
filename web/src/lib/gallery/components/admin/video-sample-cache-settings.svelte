<script lang="ts">
  import SettingInputField from '#lib/components/shared-components/settings/SettingInputField.svelte';
  import { SettingInputFieldType } from '#lib/constants.ts';
  import type { AdminConfigServerDto } from '@immich/sdk';
  import { t } from 'svelte-i18n';

  interface Props {
    server: AdminConfigServerDto;
    saved: AdminConfigServerDto;
    disabled: boolean;
  }

  let { server = $bindable(), saved, disabled }: Props = $props();
</script>

{#if server.videoSampleCache}
  <div class="mt-6 flex flex-col gap-4">
    <div>
      <h3 class="font-medium">{$t('admin.video_sample_cache')}</h3>
      <p class="text-sm text-subtle">{$t('admin.video_sample_cache_description')}</p>
    </div>

    <SettingInputField
      inputType={SettingInputFieldType.NUMBER}
      label={$t('admin.video_sample_cache_size')}
      description={$t('admin.video_sample_cache_size_description')}
      bind:value={server.videoSampleCache.maxSizeGiB}
      min={0}
      max={1024}
      step="0.25"
      required
      {disabled}
      isEdited={server.videoSampleCache.maxSizeGiB !== saved.videoSampleCache?.maxSizeGiB}
    />

    <SettingInputField
      inputType={SettingInputFieldType.NUMBER}
      label={$t('admin.video_sample_cache_retention')}
      description={$t('admin.video_sample_cache_retention_description')}
      bind:value={server.videoSampleCache.retentionHours}
      min={1}
      max={8760}
      step="1"
      required
      {disabled}
      isEdited={server.videoSampleCache.retentionHours !== saved.videoSampleCache?.retentionHours}
    />
  </div>
{/if}
