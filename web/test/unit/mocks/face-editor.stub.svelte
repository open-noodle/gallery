<script lang="ts">
  // Stands in for the OWNER'S `face-editor/FaceEditor.svelte` in PhotoViewer/VideoNativeViewer
  // wiring tests — echoes the props it received so a test can assert the owner path was picked
  // (and not the space-flavoured sibling) without depending on FaceEditor's own fabric.js canvas
  // and owner-only SDK calls.
  const props: { assetId?: string } = $props();
</script>

<div data-testid="face-editor-stub" data-asset-id={props.assetId}></div>
