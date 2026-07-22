<script lang="ts">
  import AdminPageLayout from '$lib/components/layouts/AdminPageLayout.svelte';
  import { authManager } from '$lib/managers/auth-manager.svelte';
  import { handleError } from '$lib/utils/handle-error';
  import {
    StorageMigrationDirection,
    getEstimate as getEstimateRaw,
    getStatus as getStatusRaw,
    start as startMigrationRaw,
    rollback as rollbackRaw,
    type StorageMigrationStartDto,
  } from '@immich/sdk';
  import { Button, Container } from '@immich/ui';
  import { onMount } from 'svelte';
  import { t } from 'svelte-i18n';
  import type { PageData } from './$types';

  type Props = {
    data: PageData;
  };

  const { data }: Props = $props();

  interface FileCounts {
    originals: number;
    thumbnails: number;
    previews: number;
    fullsize: number;
    encodedVideos: number;
    sidecars: number;
    personThumbnails: number;
    profileImages: number;
    total: number;
  }

  interface EstimateResponse {
    direction: string;
    fileCounts: FileCounts;
    estimatedSizeBytes: number;
  }

  interface StatusResponse {
    isActive: boolean;
    active: number;
    waiting: number;
    completed: number;
    failed: number;
    delayed: number;
    paused: number;
  }

  // StorageMigrationDirection
  let direction: StorageMigrationDirection = $state(StorageMigrationDirection.ToS3);

  // File types
  let originals = $state(true);
  let thumbnails = $state(true);
  let previews = $state(true);
  let fullsize = $state(true);
  let encodedVideos = $state(true);
  let sidecars = $state(true);
  let personThumbnails = $state(true);
  let profileImages = $state(true);

  // Options
  let deleteSource = $state(false);
  let concurrency = $state(5);

  // Estimate & Status
  let estimate: EstimateResponse | undefined = $state(undefined);
  let status: StatusResponse | undefined = $state(undefined);
  let loadingEstimate = $state(false);
  let loadingStatus = $state(false);
  let starting = $state(false);
  let rollingBack = $state(false);

  // Rollback
  let rollbackBatchId = $state('');

  const fileTypeLabels = $derived<Record<string, string>>({
    originals: $t('admin.storage_migration_file_type_originals'),
    thumbnails: $t('admin.storage_migration_file_type_thumbnails'),
    previews: $t('admin.storage_migration_file_type_previews'),
    fullsize: $t('admin.storage_migration_file_type_full_size'),
    encodedVideos: $t('admin.storage_migration_file_type_encoded_videos'),
    sidecars: $t('admin.storage_migration_file_type_sidecars'),
    personThumbnails: $t('admin.storage_migration_file_type_person_thumbnails'),
    profileImages: $t('admin.storage_migration_file_type_profile_images'),
  });

  function formatBytes(bytes: number): string {
    if (bytes === 0) {
      return '0 B';
    }
    const units = ['B', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.floor(Math.log(bytes) / Math.log(1024));
    const value = bytes / Math.pow(1024, i);
    return `${value.toFixed(i === 0 ? 0 : 1)} ${units[i]}`;
  }

  async function fetchEstimate() {
    loadingEstimate = true;
    try {
      const text = await getEstimateRaw({ direction });
      estimate = JSON.parse(text) as EstimateResponse;
    } catch (error) {
      handleError(error, $t('admin.storage_migration_fetch_estimate_failed'));
    } finally {
      loadingEstimate = false;
    }
  }

  async function fetchStatus() {
    loadingStatus = true;
    try {
      const text = await getStatusRaw();
      status = JSON.parse(text) as StatusResponse;
    } catch (error) {
      handleError(error, $t('admin.storage_migration_fetch_status_failed'));
    } finally {
      loadingStatus = false;
    }
  }

  async function handleStart() {
    starting = true;
    try {
      const dto: StorageMigrationStartDto = {
        direction,
        deleteSource,
        concurrency,
        fileTypes: {
          originals,
          thumbnails,
          previews,
          fullsize,
          encodedVideos,
          sidecars,
          personThumbnails,
          profileImages,
        },
      };
      await startMigrationRaw({ storageMigrationStartDto: dto });
      await fetchStatus();
    } catch (error) {
      handleError(error, $t('admin.storage_migration_start_failed'));
    } finally {
      starting = false;
    }
  }

  async function handleRollback() {
    if (!rollbackBatchId.trim()) {
      return;
    }
    rollingBack = true;
    try {
      await rollbackRaw({ batchId: rollbackBatchId.trim() });
      rollbackBatchId = '';
      await fetchStatus();
    } catch (error) {
      handleError(error, $t('admin.storage_migration_rollback_failed'));
    } finally {
      rollingBack = false;
    }
  }

  let mounted = $state(false);
  const isReadOnlyDemo = $derived(authManager.isReadOnlyDemo);

  onMount(() => {
    mounted = true;
    if (isReadOnlyDemo) {
      return;
    }
    void fetchStatus();

    const interval = setInterval(() => void fetchStatus(), 5000);
    return () => clearInterval(interval);
  });

  $effect(() => {
    // Re-fetch estimate when direction changes
    // eslint-disable-next-line @typescript-eslint/no-unused-expressions
    direction;
    if (mounted) {
      void fetchEstimate();
    }
  });
</script>

<AdminPageLayout breadcrumbs={[{ title: data.meta.title }]}>
  <Container size="medium" center>
    <div class="flex flex-col gap-8 pb-28">
      <!-- Migration direction -->
      <section class="rounded-lg border border-gray-200 bg-white p-6 dark:border-gray-700 dark:bg-gray-900">
        <h2 class="mb-4 text-lg font-semibold">{$t('admin.storage_migration_direction')}</h2>
        <div class="flex gap-6">
          <label class="flex cursor-pointer items-center gap-2">
            <input type="radio" bind:group={direction} value={StorageMigrationDirection.ToS3} class="accent-primary" />
            <span>{$t('admin.storage_migration_disk_to_s3')}</span>
          </label>
          <label class="flex cursor-pointer items-center gap-2">
            <input
              type="radio"
              bind:group={direction}
              value={StorageMigrationDirection.ToDisk}
              class="accent-primary"
            />
            <span>{$t('admin.storage_migration_s3_to_disk')}</span>
          </label>
        </div>
      </section>

      <!-- File Types -->
      <section class="rounded-lg border border-gray-200 bg-white p-6 dark:border-gray-700 dark:bg-gray-900">
        <h2 class="mb-4 text-lg font-semibold">{$t('admin.storage_migration_file_types')}</h2>
        <div class="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <label class="flex cursor-pointer items-center gap-2">
            <input type="checkbox" bind:checked={originals} />
            <span>{$t('admin.storage_migration_file_type_originals')}</span>
          </label>
          <label class="flex cursor-pointer items-center gap-2">
            <input type="checkbox" bind:checked={thumbnails} />
            <span>{$t('admin.storage_migration_file_type_thumbnails')}</span>
          </label>
          <label class="flex cursor-pointer items-center gap-2">
            <input type="checkbox" bind:checked={previews} />
            <span>{$t('admin.storage_migration_file_type_previews')}</span>
          </label>
          <label class="flex cursor-pointer items-center gap-2">
            <input type="checkbox" bind:checked={fullsize} />
            <span>{$t('admin.storage_migration_file_type_full_size')}</span>
          </label>
          <label class="flex cursor-pointer items-center gap-2">
            <input type="checkbox" bind:checked={encodedVideos} />
            <span>{$t('admin.storage_migration_file_type_encoded_videos')}</span>
          </label>
          <label class="flex cursor-pointer items-center gap-2">
            <input type="checkbox" bind:checked={sidecars} />
            <span>{$t('admin.storage_migration_file_type_sidecars')}</span>
          </label>
          <label class="flex cursor-pointer items-center gap-2">
            <input type="checkbox" bind:checked={personThumbnails} />
            <span>{$t('admin.storage_migration_file_type_person_thumbnails')}</span>
          </label>
          <label class="flex cursor-pointer items-center gap-2">
            <input type="checkbox" bind:checked={profileImages} />
            <span>{$t('admin.storage_migration_file_type_profile_images')}</span>
          </label>
        </div>
      </section>

      <!-- Estimate -->
      <section class="rounded-lg border border-gray-200 bg-white p-6 dark:border-gray-700 dark:bg-gray-900">
        <h2 class="mb-4 text-lg font-semibold">{$t('admin.storage_migration_estimate')}</h2>
        {#if loadingEstimate}
          <p class="text-sm text-gray-500 dark:text-gray-400">{$t('admin.storage_migration_loading_estimate')}</p>
        {:else if estimate}
          <div class="grid grid-cols-2 gap-2 text-sm sm:grid-cols-4">
            {#each Object.entries(fileTypeLabels) as [key, label] (key)}
              <div class="flex flex-col">
                <span class="text-gray-500 dark:text-gray-400">{label}</span>
                <span class="font-medium"
                  >{(estimate.fileCounts as unknown as Record<string, number>)[key]?.toLocaleString() ?? 0}</span
                >
              </div>
            {/each}
            <div class="flex flex-col">
              <span class="text-gray-500 dark:text-gray-400">{$t('admin.storage_migration_total_files')}</span>
              <span class="font-bold">{estimate.fileCounts.total.toLocaleString()}</span>
            </div>
            <div class="flex flex-col">
              <span class="text-gray-500 dark:text-gray-400">{$t('admin.storage_migration_estimated_size')}</span>
              <span class="font-bold">{formatBytes(estimate.estimatedSizeBytes)}</span>
            </div>
          </div>
        {:else}
          <p class="text-sm text-gray-500 dark:text-gray-400">{$t('admin.storage_migration_no_estimate')}</p>
        {/if}
      </section>

      <!-- Options -->
      <section class="rounded-lg border border-gray-200 bg-white p-6 dark:border-gray-700 dark:bg-gray-900">
        <h2 class="mb-4 text-lg font-semibold">{$t('options')}</h2>
        <div class="flex flex-col gap-4">
          <label class="flex cursor-pointer items-center gap-2">
            <input type="checkbox" bind:checked={deleteSource} />
            <span>{$t('admin.storage_migration_delete_source')}</span>
          </label>

          <div class="flex flex-col gap-1">
            <label for="concurrency-slider" class="text-sm font-medium"
              >{$t('admin.storage_migration_concurrency', { values: { value: concurrency } })}</label
            >
            <input
              id="concurrency-slider"
              type="range"
              min="1"
              max="20"
              bind:value={concurrency}
              class="w-full max-w-xs accent-primary"
            />
            <span class="text-xs text-gray-500 dark:text-gray-400"
              >{$t('admin.storage_migration_concurrency_help')}</span
            >
          </div>
        </div>
      </section>

      <!-- Start -->
      <section class="rounded-lg border border-gray-200 bg-white p-6 dark:border-gray-700 dark:bg-gray-900">
        <h2 class="mb-4 text-lg font-semibold">{$t('admin.storage_migration_start_heading')}</h2>
        <div class="flex items-center gap-4">
          <Button
            onclick={handleStart}
            disabled={starting || (status?.isActive ?? false) || (estimate?.fileCounts.total ?? 0) === 0}
          >
            {starting ? $t('admin.storage_migration_starting') : $t('admin.storage_migration_start_heading')}
          </Button>
          {#if status?.isActive}
            <span class="text-sm font-medium text-yellow-600 dark:text-yellow-400"
              >{$t('admin.storage_migration_active')}</span
            >
          {:else if (estimate?.fileCounts.total ?? 0) === 0}
            <span class="text-sm text-gray-500 dark:text-gray-400">{$t('admin.storage_migration_no_files')}</span>
          {/if}
        </div>
      </section>

      {#if !isReadOnlyDemo}
        <!-- Status -->
        <section class="rounded-lg border border-gray-200 bg-white p-6 dark:border-gray-700 dark:bg-gray-900">
          <h2 class="mb-4 text-lg font-semibold">{$t('status')}</h2>
          {#if loadingStatus && !status}
            <p class="text-sm text-gray-500 dark:text-gray-400">{$t('admin.storage_migration_loading_status')}</p>
          {:else if status}
            <div class="grid grid-cols-2 gap-3 text-sm sm:grid-cols-3">
              <div class="flex flex-col">
                <span class="text-gray-500 dark:text-gray-400">{$t('active')}</span>
                <span class="font-medium">{status.isActive ? $t('yes') : $t('no')}</span>
              </div>
              <div class="flex flex-col">
                <span class="text-gray-500 dark:text-gray-400">{$t('admin.storage_migration_active_jobs')}</span>
                <span class="font-medium">{status.active}</span>
              </div>
              <div class="flex flex-col">
                <span class="text-gray-500 dark:text-gray-400">{$t('waiting')}</span>
                <span class="font-medium">{status.waiting}</span>
              </div>
              <div class="flex flex-col">
                <span class="text-gray-500 dark:text-gray-400">{$t('completed')}</span>
                <span class="font-medium">{status.completed}</span>
              </div>
              <div class="flex flex-col">
                <span class="text-gray-500 dark:text-gray-400">{$t('failed')}</span>
                <span class="font-medium">{status.failed}</span>
              </div>
              <div class="flex flex-col">
                <span class="text-gray-500 dark:text-gray-400">{$t('admin.storage_migration_delayed')}</span>
                <span class="font-medium">{status.delayed}</span>
              </div>
            </div>
          {:else}
            <p class="text-sm text-gray-500 dark:text-gray-400">{$t('admin.storage_migration_no_status')}</p>
          {/if}
        </section>
      {/if}

      <!-- Rollback -->
      <section class="rounded-lg border border-gray-200 bg-white p-6 dark:border-gray-700 dark:bg-gray-900">
        <h2 class="mb-4 text-lg font-semibold">{$t('admin.storage_migration_rollback')}</h2>
        <p class="mb-3 text-sm text-gray-500 dark:text-gray-400">
          {$t('admin.storage_migration_rollback_description')}
        </p>
        <div class="flex items-end gap-3">
          <div class="flex flex-col gap-1">
            <label for="batch-id-input" class="text-sm font-medium">{$t('admin.storage_migration_batch_id')}</label>
            <input
              id="batch-id-input"
              type="text"
              bind:value={rollbackBatchId}
              placeholder="xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"
              class="w-80 rounded-sm border border-gray-300 px-3 py-2 text-sm dark:border-gray-600 dark:bg-gray-800"
            />
          </div>
          <Button onclick={handleRollback} disabled={rollingBack || !rollbackBatchId.trim()}>
            {rollingBack ? $t('admin.storage_migration_rolling_back') : $t('admin.storage_migration_rollback')}
          </Button>
        </div>
      </section>
    </div>
  </Container>
</AdminPageLayout>
