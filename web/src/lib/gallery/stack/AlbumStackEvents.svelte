<script lang="ts">
  import OnEvents from '$lib/components/OnEvents.svelte';
  import type { TimelineManager } from '$lib/managers/timeline-manager/timeline-manager.svelte';

  // An album page's stack reload triggers (specs/2026-11-01-album-stack-collapse-design.md). The timeline manager
  // listens for the same events itself, but in Safari a subscription made while the timeline renders can miss them;
  // one made from a mounted component does not. Both reach `reloadAlbumStacks`, which runs one reload per task.
  type Props = {
    albumId: string;
    timelineManager: TimelineManager | undefined;
  };

  const { albumId, timelineManager }: Props = $props();

  const reload = () => void timelineManager?.reloadAlbumStacks();
</script>

<OnEvents
  onStackCreate={reload}
  onStackUpdate={reload}
  onStackDelete={reload}
  onAlbumAddAssets={({ albumIds }) => albumIds.includes(albumId) && reload()}
/>
