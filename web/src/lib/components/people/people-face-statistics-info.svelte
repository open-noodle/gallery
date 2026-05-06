<script lang="ts" module>
  import type { PeopleFaceStatisticsResponseDto } from '@immich/sdk';

  const statisticsCache = new Map<string, PeopleFaceStatisticsResponseDto>();

  export const clearPeopleFaceStatisticsInfoCache = () => statisticsCache.clear();
</script>

<script lang="ts">
  import { clickOutside } from '$lib/actions/click-outside';
  import { locale } from '$lib/stores/preferences.store';
  import { IconButton } from '@immich/ui';
  import { mdiInformationOutline } from '@mdi/js';
  import { t } from 'svelte-i18n';

  interface Props {
    cacheKey: string;
    loadStatistics: () => Promise<PeopleFaceStatisticsResponseDto>;
  }

  let { cacheKey, loadStatistics }: Props = $props();

  let isOpen = $state(false);
  let isLoading = $state(false);
  let error = $state(false);
  let statistics = $state<PeopleFaceStatisticsResponseDto | undefined>();
  let activeCacheKey = $state<string>();

  const formatNumber = (value: number) => value.toLocaleString($locale);

  const syncCacheKey = () => {
    if (activeCacheKey === cacheKey) {
      return;
    }

    activeCacheKey = cacheKey;
    statistics = statisticsCache.get(cacheKey);
    error = false;
    isLoading = false;
  };

  $effect(() => {
    syncCacheKey();
    if (isOpen && !statistics && !isLoading && !error) {
      void loadDetails();
    }
  });

  async function loadDetails() {
    syncCacheKey();
    const requestCacheKey = cacheKey;
    const cached = statisticsCache.get(requestCacheKey);
    if (cached) {
      statistics = cached;
      return;
    }

    isLoading = true;
    error = false;
    try {
      const loadedStatistics = await loadStatistics();
      statisticsCache.set(requestCacheKey, loadedStatistics);
      if (cacheKey === requestCacheKey) {
        statistics = loadedStatistics;
      }
    } catch {
      if (cacheKey === requestCacheKey) {
        statistics = undefined;
        error = true;
      }
    } finally {
      if (cacheKey === requestCacheKey) {
        isLoading = false;
      }
    }
  }

  function toggleDetails() {
    isOpen = !isOpen;
    if (isOpen) {
      error = false;
    }
  }

  const closeDetails = () => {
    isOpen = false;
  };
</script>

<div
  class="relative inline-flex"
  data-testid="people-face-statistics-info"
  use:clickOutside={{ onOutclick: closeDetails, onEscape: closeDetails }}
>
  <IconButton
    aria-controls="people-face-statistics-details"
    aria-expanded={isOpen}
    aria-label={$t('view_face_statistics_details')}
    color="secondary"
    icon={mdiInformationOutline}
    onclick={() => void toggleDetails()}
    shape="round"
    size="small"
    title={$t('view_face_statistics_details')}
    variant="ghost"
  />

  {#if isOpen}
    <div
      aria-label={$t('view_face_statistics_details')}
      class="absolute start-0 top-9 z-10 w-72 max-w-[calc(100vw-1rem)] rounded-lg border border-gray-200 bg-white p-3 text-sm shadow-lg dark:border-gray-700 dark:bg-immich-dark-gray"
      data-testid="people-face-statistics-details"
      id="people-face-statistics-details"
      role="dialog"
    >
      {#if isLoading}
        <p class="text-gray-500 dark:text-gray-300" role="status">{$t('loading_face_statistics')}</p>
      {:else if error}
        <p class="text-red-600 dark:text-red-400" role="alert">{$t('unable_to_load_face_statistics')}</p>
      {:else if statistics}
        <dl class="grid grid-cols-[1fr_auto] gap-x-4 gap-y-2">
          <dt class="text-gray-500 dark:text-gray-300">{$t('detected_faces')}</dt>
          <dd class="font-medium tabular-nums">{formatNumber(statistics.detectedFaceCount)}</dd>
          <dt class="text-gray-500 dark:text-gray-300">{$t('assigned_to_visible_people')}</dt>
          <dd class="font-medium tabular-nums">{formatNumber(statistics.assignedVisibleFaceCount)}</dd>
          <dt class="text-gray-500 dark:text-gray-300">{$t('assigned_to_hidden_people')}</dt>
          <dd class="font-medium tabular-nums">{formatNumber(statistics.assignedHiddenFaceCount)}</dd>
          <dt class="text-gray-500 dark:text-gray-300">{$t('unassigned')}</dt>
          <dd class="font-medium tabular-nums">{formatNumber(statistics.unassignedFaceCount)}</dd>
        </dl>
      {/if}
    </div>
  {/if}
</div>
