<script lang="ts">
  import SpaceAlbumsControls from './space-albums-controls.svelte';

  let searchQuery = $state('');
</script>

<!-- Expose the wrapper's own state so tests can assert upward propagation. -->
<span data-testid="wrapper-search-query">{searchQuery}</span>
<SpaceAlbumsControls bind:searchQuery />
