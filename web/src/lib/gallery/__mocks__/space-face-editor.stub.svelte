<script lang="ts">
  // Stands in for `face-editor/SpaceFaceEditor.svelte` (Slice 8) in PhotoViewer/VideoNativeViewer
  // wiring tests — echoes the props it received so a test can assert the space-flavoured path was
  // picked (and not the owner's `FaceEditor`) without depending on the real component's own
  // fabric.js canvas and shared-space SDK calls.
  const props: { assetId?: string; spaceId?: string } = $props();
</script>

<div data-testid="space-face-editor-stub" data-asset-id={props.assetId} data-space-id={props.spaceId}></div>
