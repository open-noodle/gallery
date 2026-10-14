import { getTimeBuckets } from '@immich/sdk';
import { authManager } from '$lib/managers/auth-manager.svelte';
import type { TimelineManager } from '$lib/managers/timeline-manager/timeline-manager.svelte';
import { buildRecentlyAddedFilterConfig } from '$lib/utils/recently-added-filter-config';
import {
  buildRecentlyAddedPickerBucketOptions,
  buildRecentlyAddedTimelineOptions,
} from '$lib/utils/recently-added-filter-options';
import { FilteredTimelineController } from './filtered-timeline-controller.svelte';

/** `/recently-added`: own + partner assets ordered by upload date; no shared-space scope. */
export const createRecentlyAddedTimeline = (getTimelineManager: () => TimelineManager | undefined) => {
  // The temporal picker emits takenAfter/takenBefore, so its grid must come from *taken*-date
  // buckets; the timeline groups by *added* date and would list upload years that then match
  // nothing. Query mode keeps the smart-search facets, which already bucket on takenAt.
  let pickerBuckets = $state<Array<{ timeBucket: string; count: number }>>([]);
  const browseConfig = buildRecentlyAddedFilterConfig();

  const controller = new FilteredTimelineController({
    name: 'recently-added',
    getTimelineManager,
    scope: () => ({ withSharedSpaces: false }),
    timelineOptions: (filters) => buildRecentlyAddedTimelineOptions(filters, authManager.user.id),
    browseConfig: () => browseConfig,
    browseTimeBuckets: () => pickerBuckets,
    resolveNames: false,
  });

  const pickerBucketOptions = $derived(buildRecentlyAddedPickerBucketOptions(controller.filters, authManager.user.id));
  $effect(() => {
    // Read up front so every filter change is tracked.
    const options = pickerBucketOptions;
    if (controller.showSearchResults) {
      return;
    }
    const abort = new AbortController();
    void getTimeBuckets(options, { signal: abort.signal })
      .then((buckets) => {
        pickerBuckets = buckets.map(({ timeBucket, count }) => ({ timeBucket, count }));
      })
      .catch((error: unknown) => {
        if (!abort.signal.aborted) {
          console.error('Failed to fetch Recently Added filter buckets:', error);
        }
      });
    return () => abort.abort();
  });

  return controller;
};
