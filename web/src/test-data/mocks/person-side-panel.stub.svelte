<script lang="ts">
  // Stands in for the OWNER'S `faces-page/PersonSidePanel.svelte` in DetailPanel wiring tests —
  // echoes the props it received so a test can assert DetailPanel picked the owner path (and not
  // the space-flavoured sibling) without depending on PersonSidePanel's own owner-only SDK calls.
  const props: { assetId?: string; assetType?: string } = $props();
</script>

<div data-testid="person-side-panel-stub" data-asset-id={props.assetId} data-asset-type={props.assetType}></div>
