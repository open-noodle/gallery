<script lang="ts">
  import FaceCrop from '$lib/components/faces-page/face-crop.svelte';
  import { getAssetMediaUrl } from '$lib/utils';
  import { getContentMetrics } from '$lib/utils/container-utils';
  import { handleError } from '$lib/utils/handle-error';
  import { getBoundingBox } from '$lib/utils/people-utils';
  import type { Faces } from '$lib/stores/people.store';
  import {
    AssetMediaSize,
    type PersonFaceSuggestionPageResponseDto,
    type PersonFaceSuggestionResponseDto,
    type PersonResponseDto,
  } from '@immich/sdk';
  import { Button, IconButton, Modal, ModalBody, ModalFooter } from '@immich/ui';
  import {
    mdiAccountCheckOutline,
    mdiAccountRemoveOutline,
    mdiChevronLeft,
    mdiChevronRight,
    mdiEyeOffOutline,
  } from '@mdi/js';
  import { onMount } from 'svelte';
  import { t } from 'svelte-i18n';

  type PageReq = { page: number; size: number };

  interface Props {
    person: PersonResponseDto;
    referenceThumbnailUrl: string;
    loadPage: (req: PageReq) => Promise<PersonFaceSuggestionPageResponseDto>;
    confirm: (assetFaceId: string) => Promise<void>;
    dismiss: (assetFaceId: string) => Promise<void>;
    ignore: (assetFaceId: string) => Promise<void>;
    onClose: (result: { confirmed: number }) => void;
  }

  let { person, referenceThumbnailUrl, loadPage, confirm, dismiss, ignore, onClose }: Props = $props();

  const PAGE_SIZE = 50;
  const PREFETCH = 3;

  let items = $state<PersonFaceSuggestionResponseDto[]>([]);
  let total = $state(0);
  let index = $state(0);
  let pageNumber = $state(0);
  let loading = $state(true);
  let busy = $state(false);
  let confirmed = $state(0);

  let imgEl = $state<HTMLImageElement | undefined>(undefined);
  let imgReady = $state(false);

  const current = $derived(items[index]);
  const photoUrl = $derived(current ? getAssetMediaUrl({ id: current.assetId, size: AssetMediaSize.Preview }) : '');

  const highlight = $derived.by(() => {
    if (!current || !imgReady || !imgEl) {
      return undefined;
    }
    return getBoundingBox(
      [
        {
          id: current.assetFaceId,
          imageWidth: current.imageWidth,
          imageHeight: current.imageHeight,
          boundingBoxX1: current.boundingBoxX1,
          boundingBoxX2: current.boundingBoxX2,
          boundingBoxY1: current.boundingBoxY1,
          boundingBoxY2: current.boundingBoxY2,
        } satisfies Faces,
      ],
      getContentMetrics(imgEl),
    )[0];
  });

  async function fetchPage(next: number) {
    const res = await loadPage({ page: next, size: PAGE_SIZE });
    total = res.total;
    items = next === 1 ? res.items : [...items, ...res.items];
    pageNumber = next;
  }

  onMount(async () => {
    try {
      await fetchPage(1);
    } catch (error) {
      handleError(error, $t('errors.unable_to_load_face_suggestions'));
      onClose({ confirmed });
      return;
    } finally {
      loading = false;
    }
    if (items.length === 0) {
      onClose({ confirmed });
    }
  });

  async function maybePrefetch() {
    if (items.length < total && index >= items.length - PREFETCH) {
      try {
        await fetchPage(pageNumber + 1);
      } catch {
        /* keep what we have */
      }
    }
  }

  async function advance() {
    index++;
    if (index >= items.length && items.length >= total) {
      onClose({ confirmed });
      return;
    }
    await maybePrefetch();
    if (index >= items.length) {
      onClose({ confirmed });
    }
  }

  async function act(kind: 'confirm' | 'dismiss' | 'ignore') {
    if (busy || !current) {
      return;
    }
    busy = true;
    const face = current.assetFaceId;
    try {
      if (kind === 'confirm') {
        await confirm(face);
        confirmed++;
      } else if (kind === 'dismiss') {
        await dismiss(face);
      } else {
        await ignore(face);
      }
    } catch {
      // edges 9/10/11: benign, advance anyway
    } finally {
      busy = false;
    }
    await advance();
  }

  const canPrev = $derived(index > 0);
  const canNext = $derived(index < items.length - 1);

  function step(delta: number) {
    if (busy) {
      return;
    }
    const next = index + delta;
    if (next >= 0 && next < items.length) {
      index = next;
    }
  }

  $effect(() => {
    void current?.assetFaceId;
    imgReady = false;
  });

  function onKeydown(event: KeyboardEvent) {
    if (loading) {
      return;
    }
    switch (event.key) {
      case 'ArrowRight': {
        event.preventDefault();
        void act('confirm');
        break;
      }
      case 'ArrowLeft': {
        event.preventDefault();
        void act('dismiss');
        break;
      }
      case 'ArrowDown': {
        event.preventDefault();
        void act('ignore');
        break;
      }
      case ']': {
        step(1);
        break;
      }
      case '[': {
        step(-1);
        break;
      }
    }
  }
</script>

<svelte:window onkeydown={onKeydown} />

<Modal
  title={person.name
    ? $t('face_suggestion_modal_title', { values: { name: person.name } })
    : $t('face_suggestion_modal_title_unnamed')}
  size="large"
  onClose={() => onClose({ confirmed })}
>
  <ModalBody>
    <div class="min-h-96">
      {#if loading}
        <div data-testid="suggestion-loading" class="h-96 animate-pulse rounded-lg bg-gray-200 dark:bg-gray-800"></div>
      {:else if current}
        <div class="flex flex-col gap-4">
          <p
            data-testid="suggestion-progress"
            data-current={index + 1}
            aria-live="polite"
            class="text-center text-sm text-gray-500 dark:text-gray-400"
          >
            {$t('face_suggestion_progress', { values: { current: index + 1, total } })}
          </p>

          <div class="relative mx-auto max-h-[60vh]">
            <img
              bind:this={imgEl}
              data-testid="suggestion-full-photo"
              src={photoUrl}
              alt={$t('face_suggestion_candidate')}
              class="max-h-[60vh] w-auto rounded-lg object-contain"
              onload={() => (imgReady = true)}
            />
            {#if highlight}
              <svg class="pointer-events-none absolute inset-0 h-full w-full">
                <defs>
                  <mask id="suggestion-dim-mask">
                    <rect width="100%" height="100%" fill="white" />
                    <rect
                      x={highlight.left}
                      y={highlight.top}
                      width={highlight.width}
                      height={highlight.height}
                      rx="8"
                      fill="black"
                    />
                  </mask>
                </defs>
                <rect width="100%" height="100%" fill="rgba(0,0,0,0.55)" mask="url(#suggestion-dim-mask)" />
              </svg>
              <div
                data-testid="suggestion-highlight"
                class="pointer-events-none absolute rounded-lg border-3 border-solid border-white"
                style="top: {highlight.top}px; left: {highlight.left}px; width: {highlight.width}px; height: {highlight.height}px;"
              ></div>
            {:else}
              <div data-testid="suggestion-highlight" class="hidden"></div>
            {/if}
          </div>

          <div class="mx-auto flex items-end gap-6">
            <div class="flex flex-col items-center gap-1">
              <img
                data-testid="suggestion-reference"
                src={referenceThumbnailUrl}
                alt={$t('face_suggestion_reference')}
                class="h-24 w-24 rounded-lg object-cover"
              />
              <span class="text-xs text-gray-500 dark:text-gray-400">{$t('face_suggestion_reference')}</span>
            </div>
            <div class="flex flex-col items-center gap-1">
              <div class="h-24 w-24">
                <FaceCrop face={current} label={$t('face_suggestion_candidate')} />
              </div>
              <span class="text-xs text-gray-500 dark:text-gray-400">{$t('face_suggestion_candidate')}</span>
            </div>
          </div>
        </div>
      {/if}
    </div>
  </ModalBody>

  <ModalFooter>
    <div class="flex w-full items-center justify-between gap-3">
      <IconButton
        variant="ghost"
        shape="round"
        icon={mdiChevronLeft}
        aria-label={$t('previous')}
        disabled={busy || !canPrev}
        data-testid="suggestion-prev-btn"
        onclick={() => step(-1)}
      />
      <div class="flex justify-center gap-3">
        <Button
          shape="round"
          color="secondary"
          disabled={busy || !current}
          leadingIcon={mdiAccountRemoveOutline}
          data-testid="suggestion-different-btn"
          onclick={() => act('dismiss')}
        >
          {$t('face_suggestion_different')}
        </Button>
        <Button
          shape="round"
          color="secondary"
          disabled={busy || !current}
          leadingIcon={mdiEyeOffOutline}
          data-testid="suggestion-ignore-btn"
          onclick={() => act('ignore')}
        >
          {$t('face_suggestion_ignore')}
        </Button>
        <Button
          shape="round"
          disabled={busy || !current}
          leadingIcon={mdiAccountCheckOutline}
          data-testid="suggestion-same-btn"
          onclick={() => act('confirm')}
        >
          {$t('face_suggestion_same')}
        </Button>
      </div>
      <IconButton
        variant="ghost"
        shape="round"
        icon={mdiChevronRight}
        aria-label={$t('next')}
        disabled={busy || !canNext}
        data-testid="suggestion-next-btn"
        onclick={() => step(1)}
      />
    </div>
  </ModalFooter>
</Modal>
