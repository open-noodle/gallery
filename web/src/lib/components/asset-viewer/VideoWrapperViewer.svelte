<script lang="ts">
  import VideoNativeViewer from '$lib/components/asset-viewer/VideoNativeViewer.svelte';
  import VideoPanoramaViewer from '$lib/components/asset-viewer/VideoPanoramaViewer.svelte';
  import { ProjectionType } from '$lib/constants';
  import type { AssetResponseDto } from '@immich/sdk';

  interface Props {
    asset: AssetResponseDto;
    assetId?: string;
    projectionType: string | null | undefined;
    cacheKey: string | null;
    loopVideo: boolean;
    playOriginalVideo: boolean;
    extendedControls?: boolean;
    onClose?: () => void;
    onPreviousAsset?: () => void;
    onNextAsset?: () => void;
    onVideoEnded?: () => void;
    onVideoStarted?: () => void;
    /** Slice 8 gap closure — threaded through to VideoNativeViewer's FaceEditorPanel. */
    spaceId?: string;
    canEditSpacePeople?: boolean;
  }

  let {
    asset,
    assetId,
    projectionType,
    cacheKey,
    loopVideo,
    playOriginalVideo,
    extendedControls = false,
    onPreviousAsset,
    onClose,
    onNextAsset,
    onVideoEnded,
    onVideoStarted,
    spaceId,
    canEditSpacePeople,
  }: Props = $props();

  const effectiveAssetId = $derived(assetId ?? asset.id);
</script>

{#if projectionType === ProjectionType.EQUIRECTANGULAR}
  <VideoPanoramaViewer {asset} />
{:else}
  <VideoNativeViewer
    {loopVideo}
    {cacheKey}
    {asset}
    assetId={effectiveAssetId}
    {playOriginalVideo}
    {extendedControls}
    {onPreviousAsset}
    {onNextAsset}
    {onVideoEnded}
    {onVideoStarted}
    {onClose}
    {spaceId}
    {canEditSpacePeople}
  />
{/if}
