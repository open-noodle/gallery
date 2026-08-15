<script lang="ts">
  import SettingButtonsRow from '$lib/components/shared-components/settings/SystemConfigButtonRow.svelte';
  import { featureFlagsManager } from '$lib/managers/feature-flags-manager.svelte';
  import { systemConfigManager } from '$lib/managers/system-config-manager.svelte';
  import { handleError } from '$lib/utils/handle-error';
  import { getRoutingStatus, StorageRouting, type StorageRoutingStatusDto } from '@immich/sdk';
  import { Icon } from '@immich/ui';
  import { mdiHelpCircleOutline } from '@mdi/js';
  import { onMount } from 'svelte';
  import { t } from 'svelte-i18n';
  import { fade } from 'svelte/transition';
  import SettingSelect from './SettingSelect.svelte';

  const disabled = $derived(featureFlagsManager.value.configFile);
  const s3Available = $derived(featureFlagsManager.value.s3Storage);
  let configToEdit = $state(systemConfigManager.cloneValue());
  // Left undefined on failure (mirroring the loading state) rather than guessing — see optionsFor,
  // which must not assert a resolved backend when this is unset.
  let status = $state<StorageRoutingStatusDto>();

  onMount(async () => {
    try {
      status = await getRoutingStatus();
    } catch (error) {
      handleError(error, $t('admin.storage_routing_fetch_status_failed'));
    }
  });

  // The three storage-routing knobs, each backed by its own SystemConfigStorageRoutingDto field
  // and its own set of file-migration types (see fileTypesFor below).
  const kinds = [
    { key: 'originals', label: 'storage_routing_originals', desc: 'storage_routing_originals_description' },
    { key: 'thumbnails', label: 'storage_routing_thumbnails', desc: 'storage_routing_thumbnails_description' },
    {
      key: 'encodedVideo',
      label: 'storage_routing_encoded_video',
      desc: 'storage_routing_encoded_video_description',
    },
  ] as const;

  type Kind = (typeof kinds)[number]['key'];

  const optionsFor = (resolved: string | undefined) => [
    {
      value: StorageRouting.Auto,
      // Still loading or the status fetch failed: don't assert a backend we don't actually know.
      text: resolved
        ? $t('admin.storage_routing_option_auto', {
            values: { backend: resolved === 's3' ? 'S3' : $t('admin.storage_routing_option_disk') },
          })
        : $t('admin.storage_routing_option_auto_unresolved'),
    },
    { value: StorageRouting.Disk, text: $t('admin.storage_routing_option_disk') },
    { value: StorageRouting.S3, text: $t('admin.storage_routing_option_s3'), disabled: !s3Available },
  ];

  const fileTypesFor = (key: Kind) => {
    switch (key) {
      case 'originals': {
        return 'originals,sidecars';
      }
      case 'thumbnails': {
        return 'thumbnails,previews,fullsize,personThumbnails,profileImages';
      }
      case 'encodedVideo': {
        return 'encodedVideos';
      }
    }
  };

  // Misplaced files sit on the backend OTHER than routedTo, so migrating them means moving them
  // onto the currently-routed backend.
  const migrateHref = (key: Kind, routedTo: string) =>
    `/admin/storage-migration?direction=${routedTo === 's3' ? 'toS3' : 'toDisk'}&fileTypes=${fileTypesFor(key)}`;
</script>

<div class="mt-2">
  <div in:fade={{ duration: 500 }}>
    <form autocomplete="off" class="mx-4 mt-4" onsubmit={(event) => event.preventDefault()}>
      <div class="ms-4 mt-4 flex flex-col gap-4">
        {#each kinds as kind (kind.key)}
          <div>
            <SettingSelect
              label={$t(`admin.${kind.label}`)}
              desc={$t(`admin.${kind.desc}`)}
              name={kind.key}
              bind:value={configToEdit.storage.routing[kind.key]}
              options={optionsFor(status?.[kind.key]?.routedTo)}
              {disabled}
            />
            {#if status && status[kind.key].misplacedCount > 0}
              <p class="text-sm dark:text-immich-dark-fg">
                {$t('admin.storage_routing_misplaced', { values: { count: status[kind.key].misplacedCount } })}
                <a class="underline" href={migrateHref(kind.key, status[kind.key].routedTo)}>
                  {$t('admin.storage_routing_migrate_link')}
                </a>
              </p>
            {/if}
          </div>
        {/each}

        {#if !s3Available}
          <p class="text-sm dark:text-immich-dark-fg">
            <Icon icon={mdiHelpCircleOutline} class="inline" size="15" />
            {$t('admin.storage_routing_s3_unavailable')}
          </p>
        {/if}

        <p class="text-sm dark:text-immich-dark-fg">
          <Icon icon={mdiHelpCircleOutline} class="inline" size="15" />
          {$t('admin.storage_routing_only_affects_new_files')}
        </p>
      </div>

      <SettingButtonsRow bind:configToEdit keys={['storage']} {disabled} />
    </form>
  </div>
</div>
