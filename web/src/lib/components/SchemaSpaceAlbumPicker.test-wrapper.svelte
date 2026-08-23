<script lang="ts">
  import SchemaSpaceAlbumPicker from './SchemaSpaceAlbumPicker.svelte';

  type Props = { spaceId?: string; nextSpaceId?: string; initial?: string };
  let { spaceId: initialSpaceId = undefined, nextSpaceId, initial = '' }: Props = $props();

  let spaceId = $state(initialSpaceId);
  let albumName = $state(initial);
</script>

<!-- Expose the wrapper's own state so tests can assert upward propagation, and let them drive a
     space change the way the sibling picker does, without fighting `rerender`'s prop shape. -->
<span data-testid="wrapper-album-name">{albumName}</span>
<button type="button" onclick={() => (spaceId = nextSpaceId)}>switch space</button>
<SchemaSpaceAlbumPicker label="Album name" {spaceId} bind:albumName />
