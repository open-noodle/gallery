<script lang="ts">
  import { getFaceEditorSpace } from '$lib/gallery/asset-viewer/space-face-editor';
  import { useAssetSpace } from '$lib/gallery/asset-viewer/asset-space';
  import type { AssetResponseDto } from '@immich/sdk';
  import FaceEditor from './FaceEditor.svelte';

  /**
   * Slice 8 gap closure — the single place that decides how the face-drawing UI behaves for a given
   * asset: the owner's `FaceEditor` (owner-only `createFace`), or the same editor in its space mode
   * (`getFaceEditorSpace`: the space's people, shared-space `createSpaceAssetFace`, spec §6.5).
   * `PhotoViewer.svelte` and `VideoNativeViewer.svelte` both render this, and it shares
   * `useAssetSpace` with DetailPanel's side-panel swap and People row, so no two surfaces disagree
   * on the same asset.
   *
   * `asset` is the viewed asset, which for a live photo is the still (`assetId` is then its video).
   * Keyed on the space so a change of mode remounts the editor rather than mixing candidate lists.
   */
  type Props = {
    htmlElement: HTMLImageElement | HTMLVideoElement;
    containerWidth: number;
    containerHeight: number;
    assetId: string;
    asset: AssetResponseDto;
  };

  let { htmlElement, containerWidth, containerHeight, assetId, asset }: Props = $props();

  const assetSpace = useAssetSpace(() => asset);
  const spaceId = $derived(assetSpace.canEditSpacePeople ? assetSpace.spaceId : undefined);
</script>

{#key spaceId}
  <FaceEditor
    {htmlElement}
    {containerWidth}
    {containerHeight}
    {assetId}
    spaceFaces={spaceId ? getFaceEditorSpace(spaceId, assetId) : undefined}
  />
{/key}
