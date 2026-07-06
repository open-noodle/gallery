<script lang="ts">
  import type { TimelineGrouping } from '$lib/managers/timeline-manager/types';

  interface Props {
    grouping: TimelineGrouping;
    onGroupingChange: (grouping: TimelineGrouping) => void;
  }

  let { grouping, onGroupingChange }: Props = $props();
</script>

<!-- Test double for TimelineGroupingControl: renders a clickable button per mode so tests can
     trigger onGroupingChange and assert the page re-derives the timeline options. -->
<div data-testid="mock-grouping-control" data-active-grouping={grouping}>
  <button type="button" data-testid="set-grouping-day" onclick={() => onGroupingChange('day')}>All</button>
  <button type="button" data-testid="set-grouping-month" onclick={() => onGroupingChange('month')}>Months</button>
  <button type="button" data-testid="set-grouping-year" onclick={() => onGroupingChange('year')}>Years</button>
</div>
