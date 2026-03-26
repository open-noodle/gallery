<script lang="ts">
  import VideoNativeViewer from '$lib/components/asset-viewer/video-native-viewer.svelte';
  import VideoPanoramaViewer from '$lib/components/asset-viewer/video-panorama-viewer.svelte';
  import { ProjectionType } from '$lib/constants';
  import type { AssetResponseDto } from '@immich/sdk';

  interface Props {
    asset: AssetResponseDto;
    assetId?: string;
    projectionType: string | null | undefined;
    cacheKey: string | null;
    loopVideo: boolean;
    playOriginalVideo: boolean;
    isEditing?: boolean;
    onClose?: () => void;
    onPreviousAsset?: () => void;
    onNextAsset?: () => void;
    onVideoEnded?: () => void;
    onVideoStarted?: () => void;
    onVideoElementReady?: (element: HTMLVideoElement) => void;
  }

  let {
    asset,
    assetId,
    projectionType,
    cacheKey,
    loopVideo,
    playOriginalVideo,
    isEditing = false,
    onPreviousAsset,
    onClose,
    onNextAsset,
    onVideoEnded,
    onVideoStarted,
    onVideoElementReady,
  }: Props = $props();

  const effectiveAssetId = $derived(assetId ?? asset.id);
</script>

{#if projectionType === ProjectionType.EQUIRECTANGULAR}
  <VideoPanoramaViewer {asset} />
{:else}
  <VideoNativeViewer
    {loopVideo}
    {cacheKey}
    assetId={effectiveAssetId}
    {playOriginalVideo}
    {isEditing}
    {onPreviousAsset}
    {onNextAsset}
    {onVideoEnded}
    {onVideoStarted}
    {onClose}
    {onVideoElementReady}
  />
{/if}
