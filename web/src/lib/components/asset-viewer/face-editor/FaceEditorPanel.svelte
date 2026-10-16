<script lang="ts">
  import { useAssetSpace } from '$lib/gallery/asset-viewer/asset-space';
  import type { AssetResponseDto } from '@immich/sdk';
  import FaceEditor from './FaceEditor.svelte';
  import SpaceFaceEditor from './SpaceFaceEditor.svelte';

  /**
   * Slice 8 gap closure — the single place that decides which face-drawing UI opens for a given
   * asset: the OWNER's `FaceEditor` (owner-only `createFace`) or the space-flavoured
   * `SpaceFaceEditor` (shared-space `createSpaceAssetFace`, spec §6.5). `PhotoViewer.svelte` and
   * `VideoNativeViewer.svelte` both render this, and it shares `useAssetSpace` with DetailPanel's
   * side-panel swap and People row, so no two surfaces disagree on the same asset.
   *
   * `asset` is the viewed asset, which for a live photo is the still (`assetId` is then its video).
   * Never render both editors, and never `SpaceFaceEditor` without a space id.
   */
  type Props = {
    htmlElement: HTMLImageElement | HTMLVideoElement;
    containerWidth: number;
    containerHeight: number;
    assetId: string;
    asset: AssetResponseDto;
    onClose: () => void;
  };

  let { htmlElement, containerWidth, containerHeight, assetId, asset, onClose }: Props = $props();

  const assetSpace = useAssetSpace(() => asset);
</script>

{#if assetSpace.canEditSpacePeople && assetSpace.spaceId}
  <SpaceFaceEditor {htmlElement} {containerWidth} {containerHeight} {assetId} spaceId={assetSpace.spaceId} {onClose} />
{:else}
  <FaceEditor {htmlElement} {containerWidth} {containerHeight} {assetId} />
{/if}
