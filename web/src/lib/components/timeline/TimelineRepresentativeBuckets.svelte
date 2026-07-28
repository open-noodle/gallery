<script lang="ts">
  import TimelineBucketCard from '$lib/components/timeline/TimelineBucketCard.svelte';
  import type { TimelineGrouping } from '$lib/managers/timeline-manager/types';
  import type { ActivatableTimelineBucket } from '$lib/utils/timeline-zoom-navigation';

  const OVERSCAN_PX = 900;

  export type RepresentativeTimelineBucket = ActivatableTimelineBucket & {
    viewId: string;
    timeBucket: string;
    top: number;
    height: number;
    isLoaded: boolean;
    count: number;
    representativeAssetId: string | null;
    representativeThumbhash: string | null;
    representativeRatio: number | null;
  };

  interface VisibleWindow {
    top: number;
    bottom: number;
  }

  interface Props {
    grouping: TimelineGrouping;
    buckets: RepresentativeTimelineBucket[];
    visibleWindow: VisibleWindow;
    locale?: string;
    disabled?: boolean;
    renderOffset?: number;
    onTimelineBucketActivate?: (bucket: ActivatableTimelineBucket) => void;
    onRequestCovers?: (timeBuckets: string[]) => void;
  }

  let {
    grouping,
    buckets,
    visibleWindow,
    locale = 'en-US',
    disabled = false,
    renderOffset = 0,
    onTimelineBucketActivate,
    onRequestCovers,
  }: Props = $props();

  const intersectsVisibleWindow = (bucket: RepresentativeTimelineBucket, window: VisibleWindow) =>
    bucket.top + bucket.height >= window.top - OVERSCAN_PX && bucket.top <= window.bottom + OVERSCAN_PX;

  let visibleBuckets = $derived(buckets.filter((bucket) => intersectsVisibleWindow(bucket, visibleWindow)));
  let visibleBucketKeys = $derived(visibleBuckets.map((b) => b.timeBucket));

  $effect(() => {
    if (grouping !== 'day' && visibleBucketKeys.length > 0) {
      onRequestCovers?.(visibleBucketKeys);
    }
  });

  const activate = (bucket: ActivatableTimelineBucket) => {
    if (disabled) {
      return;
    }

    onTimelineBucketActivate?.(bucket);
  };
</script>

{#if grouping !== 'day'}
  <div data-testid="timeline-representative-buckets" data-grouping={grouping}>
    {#each visibleBuckets as bucket (bucket.viewId)}
      <div
        style={`position: absolute; height: ${bucket.height}px; width: 100%; transform: translateY(${bucket.top + renderOffset}px);`}
        data-testid={`timeline-bucket-shell-${bucket.timeBucket}`}
      >
        <div class="mx-auto h-full max-w-5xl px-4" data-testid="timeline-bucket-frame">
          <TimelineBucketCard {bucket} {locale} loading={!bucket.isLoaded} {disabled} onActivate={activate} />
        </div>
      </div>
    {/each}
  </div>
{/if}
