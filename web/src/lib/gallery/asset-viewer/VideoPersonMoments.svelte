<script lang="ts">
  import VideoFaceSightings from '$lib/gallery/asset-viewer/VideoFaceSightings.svelte';
  import { videoPersonSightings } from '$lib/gallery/asset-viewer/video-person-sightings.svelte';
  import { faceManager } from '$lib/stores/face.svelte';
  import { handleError } from '$lib/utils/handle-error';
  import { mergeVideoFaces, type AssetResponseDto } from '@immich/sdk';
  import { IconButton, Text, toastManager } from '@immich/ui';
  import { mdiClose, mdiSetMerge } from '@mdi/js';
  import { t } from 'svelte-i18n';

  /**
   * The moments of the person picked with the film button on their People tile, under the People grid: the assign
   * picker's sighting strip, one click from the info panel (specs/2026-10-31-video-face-frames-design.md, Phase 2).
   */
  interface Props {
    asset: AssetResponseDto;
    /**
     * The asset's owner, who holds face delete: each moment gets a menu to move it or take it out of the face, and a
     * person with several faces in the video can have them combined into one.
     */
    canEdit?: boolean;
  }

  let { asset, canEdit = false }: Props = $props();

  // A move adds a face to the asset (and maybe a person), and its undo takes it away: the People grid reads these.
  // When the person has no face left in the asset (their only one moved or deleted), their moments close.
  // The strip follows the person's faces as they now are: one gained by a move back, ones merged away.
  const reloadFaces = async () => {
    faceManager.clear();
    await faceManager.getAssetFaces(asset.id);
    const current = videoPersonSightings.current;
    if (!current) {
      return;
    }
    const faceIds = (faceManager.facesByPersonId.get(current.personId) ?? []).map(({ id }) => id);
    if (faceIds.length === 0) {
      videoPersonSightings.clear();
    } else if (faceIds.toSorted().join(',') !== current.faceIds.toSorted().join(',')) {
      videoPersonSightings.current = { ...current, faceIds };
    }
  };

  let combining = $state(false);

  /** Folds the person's several faces in this video into one, which keeps all their moments. */
  const combine = async (faceIds: string[]) => {
    combining = true;
    try {
      await mergeVideoFaces({ videoFaceMergeDto: { faceIds } });
      toastManager.primary($t('video_person_faces_combined'));
    } catch (error) {
      handleError(error, $t('video_person_faces_combine_failed'));
    } finally {
      combining = false;
    }
    await reloadFaces();
  };

  const selection = $derived(
    videoPersonSightings.current?.assetId === asset.id ? videoPersonSightings.current : undefined,
  );
</script>

{#if selection}
  <div class="mt-3" data-testid="video-person-moments">
    <div class="flex h-8 items-center justify-between">
      <Text size="small" class="truncate font-medium" title={selection.name}>{selection.name}</Text>
      <div class="flex items-center">
        {#if canEdit && selection.faceIds.length > 1}
          <IconButton
            icon={mdiSetMerge}
            aria-label={$t('video_person_faces_combine')}
            title={$t('video_person_faces_combine')}
            size="small"
            shape="round"
            color="secondary"
            variant="ghost"
            disabled={combining}
            onclick={() => combine(selection.faceIds)}
          />
        {/if}
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
    </div>
    <VideoFaceSightings
      faceIds={selection.faceIds}
      {canEdit}
      personId={selection.personId}
      onFacesChanged={() => void reloadFaces()}
    >
      {#snippet empty()}
        <Text size="small" color="muted" class="mb-4">{$t('video_person_sightings_none')}</Text>
      {/snippet}
    </VideoFaceSightings>
  </div>
{/if}
