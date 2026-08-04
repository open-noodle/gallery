<script lang="ts">
  import type { Snippet } from 'svelte';
  import type { TimelineGrouping, TimelineTemporalAnchor } from '$lib/managers/timeline-manager/types';
  import type { ActivatableTimelineBucket } from '$lib/utils/timeline-zoom-navigation';
  import { mockTimelineState } from './mock-timeline-state';

  interface Props {
    options?: Record<string, unknown>;
    enableRouting?: boolean;
    isSelectionMode?: boolean;
    singleSelect?: boolean;
    assetInteraction?: unknown;
    timelineManager?: Record<string, unknown>;
    space?: { id: string; canWrite: boolean };
    grouping?: TimelineGrouping;
    onGroupingChange?: (grouping: TimelineGrouping) => void;
    onTimelineBucketActivate?: (bucket: ActivatableTimelineBucket) => void;
    temporalAnchor?: TimelineTemporalAnchor;
    onTemporalAnchorResolved?: () => void;
    empty?: Snippet;
  }

  let {
    options = {},
    enableRouting = false,
    isSelectionMode = false,
    singleSelect = false,
    assetInteraction,
    timelineManager = $bindable(),
    space,
    grouping = 'day',
    empty,
    // remaining props accepted but not used in mock rendering
    ...rest
  }: Props = $props();

  void rest;

  $effect(() => {
    const stub = { ...mockTimelineState };
    if (timelineManager) {
      Object.assign(timelineManager, stub);
    } else {
      timelineManager = stub;
    }
  });

  const serializedOptions = $derived(JSON.stringify(options));
  // Detect which mode the page is in from the options shape
  const derivedMode = $derived('timelineAlbumId' in options ? 'add' : 'browse');
</script>

<div
  data-testid="space-album-timeline"
  data-enable-routing={String(enableRouting)}
  data-has-asset-interaction={String(assetInteraction !== undefined)}
  data-is-selection-mode={String(isSelectionMode)}
  data-single-select={String(singleSelect)}
  data-mode={derivedMode}
  data-grouping={grouping}
  data-space={JSON.stringify(space ?? null)}
>
  <div data-testid="timeline-options">{serializedOptions}</div>
  {@render empty?.()}
</div>
