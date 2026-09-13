<script lang="ts">
  import { shortcut } from '$lib/actions/shortcut';
  import ImageThumbnail from '$lib/components/assets/thumbnail/ImageThumbnail.svelte';
  import LoadingSpinner from '$lib/components/shared-components/LoadingSpinner.svelte';
  import {
    computeFaceCroppedCoordinates,
    computeImageContentMetrics,
    computeSelectorPosition,
  } from '$lib/utils/face-box-drag';
  import { handleError } from '$lib/utils/handle-error';
  import { refreshAssetPeople } from '$lib/utils/refresh-asset-people';
  import { getSpacePersonThumbnailUrl } from '$lib/utils/people-utils';
  import { normalizeSearchString } from '$lib/utils/string-utils';
  import CreateSpaceFaceModal from '$lib/modals/CreateSpaceFaceModal.svelte';
  import { createSpaceAssetFace, getSpacePeople, type SharedSpacePersonResponseDto } from '@immich/sdk';
  import { Button, Input, modalManager, toastManager } from '@immich/ui';
  import { Canvas, InteractiveFabricObject, Rect } from 'fabric';
  import { onMount, tick } from 'svelte';
  import { t } from 'svelte-i18n';

  /**
   * Space-flavoured sibling of `FaceEditor.svelte` (Slice 8, Task 2) -- draws a face box on a
   * member's asset and attaches it to a space person (spec §6.5), instead of the owner's
   * `createFace`. The drag/canvas math (`computeImageContentMetrics`,
   * `computeFaceCroppedCoordinates`, `computeSelectorPosition`) is shared with `FaceEditor.svelte`
   * via `$lib/utils/face-box-drag` -- the SAME transform, so a rotated/edited asset (#992) is
   * handled identically to the owner path. Only the SDK calls and the candidate source (space
   * people, not the owner's global people) differ.
   *
   * `SpaceAssetFaceCreateDto.spacePersonId` is REQUIRED (spec §6.5) -- unlike the owner path, a box
   * cannot be drawn "unassigned" here, so "create a new person" is `CreateSpaceFaceModal`'s
   * create-then-draw, not a bare `createFace`.
   */
  type Props = {
    htmlElement: HTMLImageElement | HTMLVideoElement;
    containerWidth: number;
    containerHeight: number;
    assetId: string;
    spaceId: string;
    onClose: () => void;
  };

  let { htmlElement, containerWidth, containerHeight, assetId, spaceId, onClose }: Props = $props();

  let canvasEl: HTMLCanvasElement | undefined = $state();
  let canvas: Canvas | undefined = $state();
  let faceRect: Rect | undefined = $state();
  let faceSelectorEl: HTMLDivElement | undefined = $state();
  let scrollableListEl: HTMLDivElement | undefined = $state();
  let searchInputEl: HTMLInputElement | null = $state(null);
  let candidates = $state<SharedSpacePersonResponseDto[]>([]);
  let isLoadingCandidates = $state(false);

  let searchTerm = $state('');
  let faceBoxPosition = $state({ left: 0, top: 0, width: 0, height: 0 });

  let filteredCandidates = $derived(
    searchTerm
      ? candidates.filter((person) => normalizeSearchString(person.name).includes(normalizeSearchString(searchTerm)))
      : candidates,
  );

  const configureControlStyle = () => {
    InteractiveFabricObject.ownDefaults = {
      ...InteractiveFabricObject.ownDefaults,
      cornerStyle: 'circle',
      cornerColor: 'rgb(153,166,251)',
      cornerSize: 10,
      padding: 8,
      transparentCorners: false,
      lockRotation: true,
      hasBorders: true,
    };
  };

  const setupCanvas = () => {
    if (!canvasEl || !htmlElement) {
      return;
    }

    canvas = new Canvas(canvasEl);
    configureControlStyle();

    // eslint-disable-next-line tscompat/tscompat
    faceRect = new Rect({
      fill: 'rgba(66,80,175,0.25)',
      stroke: 'rgb(66,80,175)',
      strokeWidth: 2,
      strokeUniform: true,
      width: 112,
      height: 112,
      objectCaching: true,
      rx: 8,
      ry: 8,
    });

    canvas.add(faceRect);
    canvas.setActiveObject(faceRect);
    setDefaultFaceRectanglePosition(faceRect);
  };

  onMount(async () => {
    setupCanvas();
    await getCandidates();
    await tick();
    searchInputEl?.focus();
  });

  const imageContentMetrics = $derived(computeImageContentMetrics(htmlElement, containerWidth, containerHeight));

  const setDefaultFaceRectanglePosition = (faceRect: Rect) => {
    const { offsetX, offsetY } = imageContentMetrics;

    faceRect.set({
      top: offsetY + 200,
      left: offsetX + 200,
    });

    faceRect.setCoords();
    positionFaceSelector();
  };

  $effect(() => {
    if (!canvas) {
      return;
    }

    canvas.setDimensions({
      width: containerWidth,
      height: containerHeight,
    });

    if (!faceRect) {
      return;
    }

    if (!isFaceRectIntersectingCanvas(faceRect, canvas)) {
      setDefaultFaceRectanglePosition(faceRect);
    }
  });

  const isFaceRectIntersectingCanvas = (faceRect: Rect, canvas: Canvas) => {
    const faceBox = faceRect.getBoundingRect();
    return !(
      0 > faceBox.left + faceBox.width ||
      0 > faceBox.top + faceBox.height ||
      canvas.width < faceBox.left ||
      canvas.height < faceBox.top
    );
  };

  const getCandidates = async () => {
    isLoadingCandidates = true;
    try {
      candidates = await getSpacePeople({ id: spaceId, withHidden: false });
    } catch (error) {
      handleError(error, $t('errors.cant_get_faces'));
    } finally {
      isLoadingCandidates = false;
    }
  };

  const MAX_LIST_HEIGHT = 250;

  const positionFaceSelector = () => {
    if (!faceRect || !faceSelectorEl || !scrollableListEl) {
      return;
    }

    const gap = 15;
    const padding = faceRect.padding ?? 0;
    const rawBox = faceRect.getBoundingRect();
    const faceBox = {
      left: rawBox.left - padding,
      top: rawBox.top - padding,
      width: rawBox.width + padding * 2,
      height: rawBox.height + padding * 2,
    };
    const selectorWidth = faceSelectorEl.offsetWidth;
    const chromeHeight = faceSelectorEl.offsetHeight - scrollableListEl.offsetHeight;
    const listHeight = Math.min(MAX_LIST_HEIGHT, containerHeight - gap * 2 - chromeHeight);
    const selectorHeight = listHeight + chromeHeight;

    const bestPosition = computeSelectorPosition({
      faceBox,
      selectorWidth,
      selectorHeight,
      containerWidth,
      containerHeight,
      gap,
    });

    faceSelectorEl.style.top = `${bestPosition.top}px`;
    faceSelectorEl.style.left = `${bestPosition.left}px`;
    scrollableListEl.style.height = `${listHeight}px`;
    faceBoxPosition = { left: faceBox.left, top: faceBox.top, width: faceBox.width, height: faceBox.height };
  };

  $effect(() => {
    const rect = faceRect;
    const cvs = canvas;
    if (rect && cvs) {
      rect.on('moving', positionFaceSelector);
      rect.on('scaling', positionFaceSelector);
      cvs.on('object:modified', () => searchInputEl?.focus());
      return () => {
        rect.off('moving', positionFaceSelector);
        rect.off('scaling', positionFaceSelector);
        cvs.off('object:modified', () => searchInputEl?.focus());
      };
    }
  });

  const getFaceCroppedCoordinates = () => {
    if (!faceRect || !htmlElement) {
      return;
    }

    return computeFaceCroppedCoordinates(faceRect.getBoundingRect(), htmlElement, containerWidth, containerHeight);
  };

  const tagFace = async (person: SharedSpacePersonResponseDto) => {
    try {
      const data = getFaceCroppedCoordinates();
      if (!data) {
        toastManager.warning($t('error_tag_face_bounding_box'));
        return;
      }

      await createSpaceAssetFace({
        id: spaceId,
        assetId,
        spaceAssetFaceCreateDto: { spacePersonId: person.id, ...data },
      });

      // Without this the editor just closed: the People row and the face boxes over the photo both
      // kept their pre-tag contents until a full page reload. The owner's FaceEditor at least
      // cleared faceManager here; this path did neither.
      await refreshAssetPeople(assetId, spaceId);
      onClose();
    } catch (error) {
      handleError(error, 'Error tagging face');
      onClose();
    }
  };

  const showCreateFaceModal = async () => {
    try {
      const data = getFaceCroppedCoordinates();
      if (!data) {
        return;
      }

      const created = await modalManager.show(CreateSpaceFaceModal, { spaceId, assetId, ...data });
      if (!created) {
        return;
      }

      // The reported case: naming a BRAND NEW person left them invisible until a page reload.
      await refreshAssetPeople(assetId, spaceId);
      onClose();
    } catch (error) {
      handleError(error, 'Error creating and tagging person');
    }
  };
</script>

<svelte:document use:shortcut={{ shortcut: { key: 'Escape' }, onShortcut: onClose, ignoreInputFields: false }} />

<div
  id="space-face-editor-data"
  class="absolute inset-s-0 top-0 z-5 size-full overflow-hidden"
  data-overlay-interactive
  data-face-left={faceBoxPosition.left}
  data-face-top={faceBoxPosition.top}
  data-face-width={faceBoxPosition.width}
  data-face-height={faceBoxPosition.height}
>
  <canvas bind:this={canvasEl} id="space-face-editor" class="absolute inset-s-0 top-0"></canvas>

  <div
    id="space-face-selector"
    bind:this={faceSelectorEl}
    class="absolute inset-s-[calc(50%-125px)] top-[calc(50%-250px)] w-62.5 max-w-62.5 rounded-xl border border-gray-200 bg-white px-2 py-4 backdrop-blur-sm transition-[top,left] duration-200 ease-out dark:border-gray-800 dark:bg-immich-dark-gray dark:text-immich-dark-fg"
  >
    <p class="text-center text-sm">{$t('select_person_to_tag')}</p>

    <div class="relative my-3">
      <Input placeholder={$t('search_people')} bind:value={searchTerm} bind:ref={searchInputEl} size="tiny" />
    </div>

    <div bind:this={scrollableListEl} class="mt-2 h-62.5 overflow-y-auto">
      {#if isLoadingCandidates}
        <div class="flex items-center justify-center py-4">
          <LoadingSpinner />
        </div>
      {:else if filteredCandidates.length > 0}
        <div class="mt-2 rounded-lg">
          {#each filteredCandidates as person (person.id)}
            <button
              onclick={() => tagFace(person)}
              type="button"
              class="flex w-full place-items-center gap-2 rounded-lg py-2 ps-1 pe-4 hover:bg-immich-primary/25"
            >
              <ImageThumbnail
                curve
                shadow
                url={getSpacePersonThumbnailUrl(spaceId, person.id, person.updatedAt)}
                altText={person.name}
                title={person.name}
                widthStyle="30px"
                heightStyle="30px"
              />
              <p class="text-sm">
                {person.name}
              </p>
            </button>
          {/each}
        </div>
      {:else}
        <div class="flex items-center justify-center py-4">
          <p class="text-sm text-gray-500">{$t('no_people_found')}</p>
        </div>
      {/if}
    </div>

    <Button size="small" fullWidth onclick={showCreateFaceModal} variant="outline" class="mt-2">
      {$t('create_person')}
    </Button>

    <Button size="small" fullWidth onclick={onClose} color="danger" class="mt-2">
      {$t('cancel')}
    </Button>
  </div>
</div>
