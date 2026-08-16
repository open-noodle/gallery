<script lang="ts">
  import { page } from '$app/state';
  import AdminPageLayout from '$lib/components/layouts/AdminPageLayout.svelte';
  import { handleError } from '$lib/utils/handle-error';
  import {
    RoutedTo,
    StorageMigrationDirection,
    getEstimate as getEstimateRaw,
    getRoutingStatus,
    getStatus as getStatusRaw,
    start as startMigrationRaw,
    rollback as rollbackRaw,
    type StorageMigrationFileTypesDto,
    type StorageMigrationStartDto,
    type StorageRoutingStatusDto,
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

  // Maps each of the 8 migrator file types onto the storage-routing knob (Task 1) that governs
  // where new writes of that kind land, mirrored here from the server's own mapping.
  const FILE_TYPE_TO_KIND: Record<string, 'originals' | 'thumbnails' | 'encodedVideo'> = {
    originals: 'originals',
    sidecars: 'originals',
    thumbnails: 'thumbnails',
    previews: 'thumbnails',
    fullsize: 'thumbnails',
    personThumbnails: 'thumbnails',
    profileImages: 'thumbnails',
    encodedVideos: 'encodedVideo',
  };

  // StorageMigrationDirection
  let direction: StorageMigrationDirection = $state(StorageMigrationDirection.ToS3);

  // File types — a single keyed record (rather than one binding per type) so the query-param
  // prefill and the routing-blocked lookup can both index by the DTO's field name.
  let selectedFileTypes = $state<Record<string, boolean>>({
    originals: true,
    thumbnails: true,
    previews: true,
    fullsize: true,
    encodedVideos: true,
    sidecars: true,
    personThumbnails: true,
    profileImages: true,
  });

  // Resolved storage-routing status (Task 6), used to disable file types whose new writes go the
  // other way. Left undefined on failure, same as the estimate/status fetches — fetchRoutingStatus's
  // catch leaves it unset, and isBlocked below fails open (nothing blocked) when it's unset, since
  // the server still enforces the rule either way.
  let routingStatus = $state<StorageRoutingStatusDto | undefined>(undefined);

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

  // A file type whose new writes go the other way can never converge, and the server rejects it
  // anyway — disable it in the UI so the invalid combination is unreachable there too.
  const isBlocked = (fileType: string) => {
    if (!routingStatus) {
      return false;
    }
    const target = direction === StorageMigrationDirection.ToS3 ? RoutedTo.S3 : RoutedTo.Disk;
    return routingStatus[FILE_TYPE_TO_KIND[fileType]].routedTo !== target;
  };

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

  // Fetched once on mount; not on an interval like status/estimate — routing only changes via the
  // system-settings form, which is a full page navigation away.
  async function fetchRoutingStatus() {
    try {
      routingStatus = await getRoutingStatus();
    } catch (error) {
      handleError(error, $t('admin.storage_routing_fetch_status_failed'));
    }
  }

  async function handleStart() {
    starting = true;
    try {
      const dto: StorageMigrationStartDto = {
        direction,
        deleteSource,
        concurrency,
        // Re-applies isBlocked rather than trusting selectedFileTypes as-is: a type left checked
        // from before a direction change (or before routingStatus resolved) that's now blocked
        // must never reach the server, even though its checkbox is merely disabled, not cleared.
        fileTypes: Object.fromEntries(
          Object.keys(FILE_TYPE_TO_KIND).map((key) => [key, selectedFileTypes[key] && !isBlocked(key)]),
        ) as StorageMigrationFileTypesDto,
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

  onMount(() => {
    mounted = true;
    void fetchStatus();
    void fetchRoutingStatus();

    // Prefill from the migrate link on the storage-routing settings page (Task 6's migrateHref):
    // ?direction=toS3&fileTypes=thumbnails,previews,...
    const params = page.url.searchParams;
    const requestedDirection = params.get('direction');
    if (
      requestedDirection === StorageMigrationDirection.ToS3 ||
      requestedDirection === StorageMigrationDirection.ToDisk
    ) {
      direction = requestedDirection as StorageMigrationDirection;
    }
    const requestedFileTypes = params.get('fileTypes');
    if (requestedFileTypes) {
      const wanted = new Set(requestedFileTypes.split(','));
      // Only apply the prefill when at least one requested value is a file type we know about —
      // a typo'd or stale ?fileTypes= (nothing recognized) must leave the "all checked" defaults
      // alone rather than silently clearing every checkbox.
      const knownKeys = Object.keys(FILE_TYPE_TO_KIND);
      if (knownKeys.some((key) => wanted.has(key))) {
        for (const key of knownKeys) {
          selectedFileTypes[key] = wanted.has(key);
        }
      }
    }

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
          {#each Object.entries(fileTypeLabels) as [key, label] (key)}
            <label class="flex cursor-pointer items-center gap-2">
              <input
                type="checkbox"
                bind:checked={selectedFileTypes[key]}
                disabled={isBlocked(key)}
                title={isBlocked(key) ? $t('admin.storage_migration_blocked_by_routing') : undefined}
              />
              <span>{label}</span>
            </label>
          {/each}
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
