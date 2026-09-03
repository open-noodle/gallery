<script lang="ts">
  import { Button, Icon, Modal, ModalBody, ModalFooter } from '@immich/ui';
  import { mdiChevronLeft, mdiChevronRight } from '@mdi/js';
  import { DateTime } from 'luxon';
  import { locale, t } from 'svelte-i18n';
  import { dateFormats } from '$lib/constants';
  import { getContentMetrics, type ContentMetrics } from '$lib/utils/container-utils';
  import {
    clampFaceBoxToImage,
    getAdminFacePreviewUrl,
    getBoundingBox,
    isUsableFaceBox,
  } from '$lib/utils/people-utils';
  import type { FacePhotoFace } from '$lib/components/face-cleanup/face-photo';

  // #1061: a 250px face crop cannot separate two similar-looking children. This shows the SOURCE PHOTO with
  // the detection boxed, through the admin-gated preview route — never /photos/{assetId}, which enforces
  // Permission.AssetView with no admin bypass and would 403 on every cluster the admin does not own.
  //
  // Escape-to-dismiss and the focus trap come from @immich/ui's Modal; they are not re-implemented or
  // re-asserted here.
  interface Props {
    faces: FacePhotoFace[];
    index: number;
    onClose: () => void;
  }

  const { faces, index, onClose }: Props = $props();

  // Clamped, never wrapped: the modal only knows the faces LOADED in the grid it was opened from, and both
  // grids paginate — wrapping would imply a cycle over the whole cluster that this array does not represent.
  let current = $state(index);
  const face = $derived(faces[current]);
  const hasPrev = $derived(current > 0);
  const hasNext = $derived(current < faces.length - 1);

  let metrics = $state<ContentMetrics | null>(null);
  const onImageLoad = (event: Event) => {
    metrics = getContentMetrics(event.currentTarget as HTMLImageElement);
  };

  // Re-measure when the face changes: a portrait following a landscape has different content metrics, and a
  // stale measurement would paint the box in the wrong place for one frame.
  $effect(() => {
    void face.assetFaceId;
    metrics = null;
  });

  const box = $derived.by(() => {
    if (!metrics || !isUsableFaceBox(face)) {
      return null;
    }
    return getBoundingBox([{ id: face.assetFaceId, ...clampFaceBoxToImage(face) }], metrics)[0] ?? null;
  });

  // Luxon directly rather than fromISODateTimeUTC: that helper casts to `DateTime<true>`, which erases the
  // invalid case at the type level — and the invalid case is exactly what this guard is for. UTC because
  // localDateTime stores local wall-clock time as a UTC timestamp; the viewer's zone would shift a 00:30
  // photo to the previous day.
  const takenLabel = $derived.by(() => {
    const parsed = DateTime.fromISO(face.localDateTime, { zone: 'UTC', locale: $locale ?? undefined });
    return parsed.isValid ? parsed.toLocaleString(dateFormats.album) : null;
  });
</script>

<Modal title={$t('admin.face_cleanup_photo_modal_title')} {onClose} size="large">
  <ModalBody>
    <div class="flex max-h-[70vh] justify-center">
      <!-- Shrink-wrapping origin: `justify-center` on the OUTER flex row shifts the img right by
           (container − img)/2, so a box positioned from the outer div's edge lands offset on any photo whose
           aspect ratio doesn't fill the row (portrait previews inside this modal's ~728px body). This inner
           div is a flex item sized to its own content (the img), so it and the img share one coordinate
           origin — see PersonSuggestionReviewModal.svelte for the same shrink-wrap principle. -->
      <div class="relative">
        <img
          src={getAdminFacePreviewUrl(face.assetFaceId)}
          alt=""
          class="max-h-[70vh] w-auto object-contain"
          data-testid="face-photo"
          onload={onImageLoad}
        />
        {#if box}
          <!-- Only the CLICKED face is boxed. The console holds no data for the other people in the frame, and
               one box answers the question the admin is actually asking. -->
          <div
            class="pointer-events-none absolute rounded-sm border-2 border-primary shadow-[0_0_0_9999px_rgba(0,0,0,0.35)]"
            style="top: {box.top}px; left: {box.left}px; width: {box.width}px; height: {box.height}px;"
            data-testid="face-photo-box"
          ></div>
        {/if}
      </div>
    </div>

    {#if takenLabel}
      <p class="mt-3 text-center text-sm text-gray-500 dark:text-gray-400" data-testid="face-photo-taken">
        {$t('admin.face_cleanup_photo_modal_taken', { values: { date: takenLabel } })}
      </p>
    {/if}
  </ModalBody>

  <ModalFooter>
    <div class="flex w-full items-center justify-between gap-2">
      <Button
        shape="round"
        color="secondary"
        disabled={!hasPrev}
        onclick={() => (current -= 1)}
        data-testid="face-photo-prev"
      >
        <Icon icon={mdiChevronLeft} size="18" />
      </Button>
      <span class="text-sm text-gray-500 dark:text-gray-400">{current + 1} / {faces.length}</span>
      <Button
        shape="round"
        color="secondary"
        disabled={!hasNext}
        onclick={() => (current += 1)}
        data-testid="face-photo-next"
      >
        <Icon icon={mdiChevronRight} size="18" />
      </Button>
    </div>
  </ModalFooter>
</Modal>

<svelte:window
  onkeydown={(event) => {
    if (event.key === 'ArrowLeft' && hasPrev) {
      current -= 1;
    }
    if (event.key === 'ArrowRight' && hasNext) {
      current += 1;
    }
  }}
/>
