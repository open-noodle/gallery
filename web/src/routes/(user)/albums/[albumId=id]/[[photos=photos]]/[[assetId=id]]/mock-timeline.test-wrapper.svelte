<script lang="ts">
  import type { Snippet } from 'svelte';
  import type { TimelineManager } from '$lib/managers/timeline-manager/timeline-manager.svelte';
  import type { TimelineGrouping } from '$lib/managers/timeline-manager/types';
  import type { ActivatableTimelineBucket } from '$lib/utils/timeline-zoom-navigation';

  interface Props {
    timelineManager?: TimelineManager | Record<string, unknown>;
    options?: Record<string, unknown>;
    album?: { id?: string; assetCount?: number };
    onTimelineBucketActivate?: (bucket: ActivatableTimelineBucket) => void;
    temporalAnchor?: { year: number; month?: number };
    onTemporalAnchorResolved?: () => void;
    grouping?: TimelineGrouping;
    onGroupingChange?: (grouping: TimelineGrouping) => void;
    children?: Snippet;
  }

  let {
    timelineManager = $bindable(),
    options = {},
    album,
    children,
    onTimelineBucketActivate,
    temporalAnchor,
    onTemporalAnchorResolved,
    grouping = 'day',
    onGroupingChange,
  }: Props = $props();

  $effect(() => {
    if (album?.id === 'without-bound-timeline-manager') {
      return;
    }

    const tagIds = Array.isArray(options.tagIds) ? options.tagIds : [];
    const empty = tagIds.includes('tag-no-match') || album?.assetCount === 0;
    const monthsOnly = album?.id === 'timeline-months-only';

    const nextTimelineManager = {
      months: empty ? [] : [{ yearMonth: { year: 2024, month: 4 }, assetsCount: 2 }],
      assetCount: empty || monthsOnly ? 0 : 2,
      isInitialized: true,
      showAssetOwners: false,
      albumAssets: new Set(['asset-in-album']),
      suspendTransitions: false,
      removeAssets: () => {},
      upsertAssets: () => {},
      update: () => {},
      toggleShowAssetOwners: () => {},
      getRandomAsset: () => Promise.resolve(undefined),
    };

    if (timelineManager) {
      Object.assign(timelineManager, nextTimelineManager);
    } else {
      timelineManager = nextTimelineManager;
    }
  });
</script>

<div data-testid="timeline-options">{JSON.stringify(options)}</div>
<button
  type="button"
  data-testid="activate-year-bucket"
  onclick={() => onTimelineBucketActivate?.({ grouping: 'year', date: { year: 2015 } })}
>
  Activate year
</button>
<button
  type="button"
  data-testid="activate-month-bucket"
  onclick={() => onTimelineBucketActivate?.({ grouping: 'month', date: { year: 2015, month: 8 } })}
>
  Activate month
</button>
<div data-testid="timeline-anchor">{JSON.stringify(temporalAnchor ?? null)}</div>
<button type="button" data-testid="resolve-timeline-anchor" onclick={() => onTemporalAnchorResolved?.()}>
  Resolve anchor
</button>
<button type="button" data-testid="timeline-mobile-set-year" onclick={() => onGroupingChange?.('year')}>
  Mobile year
</button>
<div data-testid="timeline-mobile-grouping-props">
  {JSON.stringify({ grouping, hasHandler: Boolean(onGroupingChange) })}
</div>
<div data-testid="mock-disabled-asset" data-asset="asset-in-album" data-disabled="true"></div>
<div data-testid="mock-timeline-asset-count">{timelineManager?.assetCount ?? 0}</div>
{@render children?.()}
