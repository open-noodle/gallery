<script lang="ts">
  import VideoFaceSightings from '$lib/gallery/asset-viewer/VideoFaceSightings.svelte';
  import { videoPersonSightings } from '$lib/gallery/asset-viewer/video-person-sightings.svelte';
  import type { AssetResponseDto } from '@immich/sdk';
  import { IconButton, Text } from '@immich/ui';
  import { mdiClose } from '@mdi/js';
  import { t } from 'svelte-i18n';

  /**
   * The moments of the person picked with the film button on their People tile, under the People grid: the assign
   * picker's sighting strip, one click from the info panel (specs/2026-10-31-video-face-frames-design.md, Phase 2).
   */
  interface Props {
    asset: AssetResponseDto;
    /** The asset's owner, who holds face delete: each moment gets a button to take it out of the person's face. */
    canRemove?: boolean;
  }

  let { asset, canRemove = false }: Props = $props();

  const selection = $derived(
    videoPersonSightings.current?.assetId === asset.id ? videoPersonSightings.current : undefined,
  );
</script>

{#if selection}
  <div class="mt-3" data-testid="video-person-moments">
    <div class="flex h-8 items-center justify-between">
      <Text size="small" class="truncate font-medium" title={selection.name}>{selection.name}</Text>
      <IconButton
        icon={mdiClose}
        aria-label={$t('close')}
        size="small"
        shape="round"
        color="secondary"
        variant="ghost"
        onclick={() => videoPersonSightings.clear()}
      />
    </div>
    <VideoFaceSightings faceIds={selection.faceIds} {canRemove}>
      {#snippet empty()}
        <Text size="small" color="muted" class="mb-4">{$t('video_person_sightings_none')}</Text>
      {/snippet}
    </VideoFaceSightings>
  </div>
{/if}
