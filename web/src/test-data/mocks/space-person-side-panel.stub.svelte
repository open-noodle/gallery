<script lang="ts">
  // Stands in for `asset-viewer/SpacePersonSidePanel.svelte` (Slice 8) in DetailPanel wiring
  // tests — echoes the props it received so a test can assert DetailPanel picked the
  // space-flavoured path (and not the owner's `PersonSidePanel`) without depending on the real
  // component's own shared-space SDK calls.
  const props: { spaceId?: string; assetId?: string; assetType?: string } = $props();
</script>

<div
  data-testid="space-person-side-panel-stub"
  data-space-id={props.spaceId}
  data-asset-id={props.assetId}
  data-asset-type={props.assetType}
></div>
