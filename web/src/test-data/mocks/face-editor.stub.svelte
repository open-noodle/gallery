<script lang="ts">
  // Stands in for `face-editor/FaceEditor.svelte` in PhotoViewer/VideoNativeViewer wiring tests —
  // echoes the props it received so a test can assert whether the space mode was picked, without
  // depending on FaceEditor's own fabric.js canvas and SDK calls. Tests mock `getFaceEditorSpace`
  // to return `{ spaceId }`.
  const props: { assetId?: string; spaceFaces?: { spaceId?: string } } = $props();
</script>

<div data-testid="face-editor-stub" data-asset-id={props.assetId} data-space-id={props.spaceFaces?.spaceId}></div>
