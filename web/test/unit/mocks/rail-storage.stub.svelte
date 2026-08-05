<script lang="ts">
  // Distinct from noop-component.svelte on purpose: BottomInfo and RecentAlbums/RecentSpaces
  // already share that generic stub in user-sidebar.spec.ts, so a shared stub here would make
  // the rail-vs-expanded storage branch untestable (both branches would render an
  // indistinguishable noop-component node). This testid lets the spec assert which branch fired.
</script>

<div data-testid="rail-storage-stub"></div>
