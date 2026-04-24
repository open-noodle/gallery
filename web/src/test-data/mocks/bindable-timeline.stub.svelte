<script lang="ts">
  interface Props {
    timelineManager?: unknown;
    [key: string]: unknown;
  }

  let { timelineManager = $bindable() }: Props = $props();
</script>

<div data-testid="timeline-stub" data-has-timeline={String(timelineManager !== undefined)}></div>
