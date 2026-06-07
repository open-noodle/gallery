<script lang="ts">
  import type { TimelineManager } from '$lib/managers/timeline-manager/timeline-manager.svelte';
  import type { TimelineGrouping } from '$lib/managers/timeline-manager/types';
  import type { ActivatableTimelineBucket } from '$lib/utils/timeline-zoom-navigation';
  import type { Snippet } from 'svelte';

  interface Props {
    children?: Snippet;
    timelineManager?: TimelineManager | Record<string, unknown>;
    options?: Record<string, unknown>;
    grouping?: TimelineGrouping;
    onGroupingChange?: (grouping: TimelineGrouping) => void;
    onTimelineBucketActivate?: (bucket: ActivatableTimelineBucket) => void;
    temporalAnchor?: { year: number; month?: number };
    onTemporalAnchorResolved?: () => void;
    [key: string]: unknown;
  }

  let {
    children,
    timelineManager = $bindable(),
    options = {},
    grouping = 'day',
    onGroupingChange,
    onTimelineBucketActivate,
    temporalAnchor,
    onTemporalAnchorResolved,
    ...rest
  }: Props = $props();
  const serializedOptions = $derived(JSON.stringify(options ?? {}));

  $effect(() => {
    const assetCount = (globalThis as { __timelineStubAssetCount?: number }).__timelineStubAssetCount ?? 1;
    const nextTimelineManager = {
      months: assetCount > 0 ? [{ yearMonth: { year: 2024, month: 4 }, assetsCount: assetCount }] : [],
      timelineBuckets:
        assetCount > 0
          ? [{ grouping, date: { year: 2024, month: 4 }, count: assetCount, timeBucket: '2024-04-01' }]
          : [],
      assetCount,
      isInitialized: true,
      showAssetOwners: false,
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

<div
  {...rest}
  data-testid="timeline-stub"
  data-has-timeline={String(timelineManager !== undefined)}
  data-options={serializedOptions}
>
  <div data-testid="timeline-options">{serializedOptions}</div>
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
  <button type="button" data-testid="timeline-mobile-set-year" onclick={() => onGroupingChange?.('year')}>
    Mobile year
  </button>
  <div data-testid="timeline-mobile-grouping-props">
    {JSON.stringify({ grouping, hasHandler: Boolean(onGroupingChange) })}
  </div>
  <div data-testid="timeline-anchor">{JSON.stringify(temporalAnchor ?? null)}</div>
  <button type="button" data-testid="resolve-timeline-anchor" onclick={() => onTemporalAnchorResolved?.()}>
    Resolve anchor
  </button>
  {@render children?.()}
</div>
