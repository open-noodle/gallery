<script lang="ts">
  import type { TimelineGrouping, TimelineTemporalAnchor } from '$lib/managers/timeline-manager/types';
  import type { ActivatableTimelineBucket } from '$lib/utils/timeline-zoom-navigation';
  import type { Snippet } from 'svelte';

  interface Props {
    timelineManager?: Record<string, unknown>;
    options?: Record<string, unknown>;
    enableRouting?: boolean;
    spaceId?: string;
    space?: { id: string; canWrite: boolean };
    grouping?: TimelineGrouping;
    onGroupingChange?: (grouping: TimelineGrouping) => void;
    onTimelineBucketActivate?: (bucket: ActivatableTimelineBucket) => void;
    temporalAnchor?: TimelineTemporalAnchor;
    onTemporalAnchorResolved?: () => void;
    children?: Snippet;
    empty?: Snippet;
  }

  let {
    timelineManager = $bindable(),
    options = {},
    enableRouting = false,
    spaceId,
    space,
    grouping = 'day',
    onGroupingChange,
    onTimelineBucketActivate,
    temporalAnchor,
    onTemporalAnchorResolved,
    children,
    empty,
  }: Props = $props();
  const serializedOptions = $derived(JSON.stringify(options));

  $effect(() => {
    const nextTimelineManager = {
      months: [{ yearMonth: { year: 2015, month: 8 }, assetsCount: 1 }],
      timelineBuckets: [{ grouping, date: { year: 2015, month: 8 }, count: 1, timeBucket: '2015-08-01' }],
      assetCount: 1,
      isInitialized: false,
      removeAssets: () => undefined,
      update: () => undefined,
    };

    if (timelineManager) {
      Object.assign(timelineManager, nextTimelineManager);
    } else {
      timelineManager = nextTimelineManager;
    }
  });
</script>

<div
  data-testid="space-person-timeline"
  data-enable-routing={String(enableRouting)}
  data-space-id={spaceId}
  data-space={JSON.stringify(space ?? null)}
  data-has-timeline-manager={String(timelineManager !== undefined)}
>
  <div data-testid="timeline-stub" data-options={serializedOptions}></div>
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
  {@render empty?.()}
</div>
