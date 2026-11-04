<script lang="ts">
  // Variant of `space-person-side-panel.stub.svelte` that also exposes `onRefresh` as a clickable
  // button, so a test can drive DetailPanel's post-face-edit refresh without standing up the real
  // panel's shared-space SDK calls. The plain stub only echoes props, which cannot trigger the
  // refresh path at all.
  const props: { spaceId?: string; assetId?: string; onRefresh?: () => void } = $props();
</script>

<div data-testid="space-person-side-panel-stub" data-space-id={props.spaceId} data-asset-id={props.assetId}>
  <button type="button" data-testid="trigger-refresh" onclick={() => props.onRefresh?.()}>refresh</button>
</div>
