<script lang="ts">
  import type { TimelineManager } from '$lib/managers/timeline-manager/timeline-manager.svelte';
  import type { TimelineGrouping } from '$lib/managers/timeline-manager/types';
  import type { ActivatableTimelineBucket } from '$lib/utils/timeline-zoom-navigation';
  import type { Snippet } from 'svelte';

  interface Props {
    timelineManager?: TimelineManager | Record<string, unknown>;
    options?: Record<string, unknown>;
    onTimelineBucketActivate?: (bucket: ActivatableTimelineBucket) => void;
    grouping?: TimelineGrouping;
    onGroupingChange?: (grouping: TimelineGrouping) => void;
    temporalAnchor?: { year: number; month?: number };
    onTemporalAnchorResolved?: () => void;
    withStacked?: boolean;
    space?: { id: string; canWrite: boolean };
    children?: Snippet;
    [key: string]: unknown;
  }

  let {
    timelineManager = $bindable(),
    children,
    options = {},
    onTimelineBucketActivate,
    grouping = 'day',
    onGroupingChange,
    temporalAnchor,
    onTemporalAnchorResolved,
    withStacked = false,
    space,
    ...rest
  }: Props = $props();

  $effect(() => {
    const spacePersonIds = Array.isArray(options.spacePersonIds) ? options.spacePersonIds : [];
    const assetCount = spacePersonIds.includes('empty-person') ? 0 : 2;
    const nextTimelineManager = {
      months: [{ yearMonth: { year: 2026, month: 1 }, assetsCount: 2 }],
      assetCount,
      isInitialized: true,
      // Stub is always "settled" for the current options, so empty ⇔ assetCount === 0.
      isEmptyForOptions: () => assetCount === 0,
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

<div {...rest} data-testid="timeline-stub" data-has-timeline={String(timelineManager !== undefined)}>
  <div data-testid="timeline-options">{JSON.stringify(options)}</div>
  <div data-testid="timeline-withstacked">{String(withStacked)}</div>
  <div data-testid="timeline-space">{JSON.stringify(space ?? null)}</div>
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
  {@render children?.()}
</div>
