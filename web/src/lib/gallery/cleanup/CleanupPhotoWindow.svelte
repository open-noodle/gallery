<script lang="ts">
  import { shortcuts } from '$lib/actions/shortcut';
  import Thumbhash from '$lib/components/Thumbhash.svelte';
  import AssetContextDetails from '$lib/gallery/asset-context/asset-context-details.svelte';
  import ShortcutKeycap from '$lib/gallery/components/shortcut-keycap.svelte';
  import { duration, ease, slideFrom } from '$lib/gallery/motion';
  import { prefersReducedMotion } from '$lib/gallery/motion/tokens';
  import { Route } from '$lib/route';
  import { getAssetMediaUrl } from '$lib/utils';
  import { AssetMediaSize, AssetTypeEnum, type CleanupAssetDto } from '@immich/sdk';
  import { Button, Icon, IconButton, Modal, ModalBody } from '@immich/ui';
  import {
    mdiCheck,
    mdiCheckboxBlankOutline,
    mdiCheckboxMarked,
    mdiChevronLeft,
    mdiChevronRight,
    mdiOpenInNew,
    mdiPlay,
    mdiTrashCanOutline,
  } from '@mdi/js';
  import { onMount } from 'svelte';
  import { t, type Translations } from 'svelte-i18n';

  export type PhotoSignal = {
    /** Why the photo is in the queue (Blurry, Too dark, Too bright). */
    label?: Translations;
    /** Where a burst frame ranks by sharpness within its series. */
    sharpness?: { value: number; rank: number; of: number };
  };

  type Props = {
    /** The queue's live list; read again on every step, so removed and newly loaded photos are seen. */
    items: () => CleanupAssetDto[];
    startId: string;
    signal?: (asset: CleanupAssetDto) => PhotoSignal | undefined;
    /** Blurry and Screenshots: the grid's selection, mirrored here. */
    selection?: { has: (id: string) => boolean; toggle: (id: string) => void };
    /** Bursts: the frame's keep or trash mark within its series. */
    markOf?: (id: string) => 'keep' | 'trash' | undefined;
    /** Resolve true when the photo left the list (kept or trashed for good). */
    onKeep: (id: string) => Promise<boolean>;
    onTrash: (id: string) => Promise<boolean>;
    /** True: after Keep or Trash, move on to the next photo. False (bursts): stay on the frame. */
    advanceOnAction: boolean;
    /** Load the queue's next page; resolve true when more photos arrived. */
    loadMore?: () => Promise<boolean>;
    openViewer: (id: string) => void;
    /** The tile the window was opened from, so the photo can grow out of it. */
    originRect?: DOMRect;
    onClose: () => void;
  };

  let {
    items,
    startId,
    signal,
    selection,
    markOf,
    onKeep,
    onTrash,
    advanceOnAction,
    loadMore,
    openViewer,
    originRect,
    onClose,
  }: Props = $props();

  // svelte-ignore state_referenced_locally
  let currentId = $state(startId);
  let busy = $state(false);
  let photo = $state<HTMLImageElement>();
  let loaded = $state(false);
  // Bumped on every step so the photo element is recreated and slides in.
  let direction: -1 | 0 | 1 = 0;

  // Looked up by id, never by position: Keep and Trash take photos out of the list under the window.
  const current = $derived(items().find((item) => item.id === currentId));
  const index = $derived(items().findIndex((item) => item.id === currentId));
  const total = $derived(items().length);
  const currentSignal = $derived(current ? signal?.(current) : undefined);
  const selected = $derived(current ? (selection?.has(current.id) ?? false) : false);
  const mark = $derived(current ? markOf?.(current.id) : undefined);

  const show = (id: string, step: -1 | 0 | 1) => {
    direction = step;
    loaded = false;
    currentId = id;
  };

  const step = async (delta: -1 | 1) => {
    const next = items()[index + delta];
    if (next) {
      show(next.id, delta);
      return;
    }
    if (delta === 1 && loadMore && (await loadMore())) {
      const more = items()[index + 1];
      if (more) {
        show(more.id, 1);
      }
    }
  };

  const act = async (action: (id: string) => Promise<boolean>) => {
    if (!current || busy) {
      return;
    }
    const id = current.id;
    const position = index;
    busy = true;
    try {
      const left = await action(id);
      if (!advanceOnAction || !left) {
        return;
      }
      // The photo left the list, so the next one now sits where it was.
      let next = items()[position];
      if (!next && loadMore && (await loadMore())) {
        next = items()[position];
      }
      if (next) {
        show(next.id, 1);
      } else {
        close();
      }
    } finally {
      busy = false;
    }
  };

  const openInNewTab = () => {
    if (current) {
      open(Route.viewAsset({ id: current.id }), '_blank', 'noopener');
    }
  };

  const toggleSelection = () => {
    if (current && selection) {
      selection.toggle(current.id);
    }
  };

  const toOrigin = (): Keyframe[] | undefined => {
    if (!originRect || !photo || prefersReducedMotion()) {
      return;
    }
    const rect = photo.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) {
      return;
    }
    const x = originRect.left + originRect.width / 2 - (rect.left + rect.width / 2);
    const y = originRect.top + originRect.height / 2 - (rect.top + rect.height / 2);
    const scale = Math.min(originRect.width / rect.width, originRect.height / rect.height);
    return [
      { translate: `${x}px ${y}px`, scale: String(scale), opacity: 0.6 },
      { translate: '0 0', scale: '1', opacity: 1 },
    ];
  };

  // The photo grows out of the tile it was opened from.
  onMount(() => {
    const frames = toOrigin();
    if (frames && photo?.animate) {
      photo.animate(frames, { duration: duration.slow, easing: ease.settle });
    }
  });

  // ...and shrinks back into it on close, when that tile is still where it was.
  const close = () => {
    const frames = toOrigin();
    const animation =
      frames && photo?.animate
        ? photo.animate(frames.reverse(), { duration: duration.base, easing: ease.exit, fill: 'forwards' })
        : undefined;
    if (animation?.finished) {
      void animation.finished.then(onClose).catch(onClose);
    } else {
      onClose();
    }
  };

  // Each step slides the new photo in from the side it came from.
  $effect(() => {
    void currentId;
    if (direction !== 0 && photo?.animate) {
      photo.animate(slideFrom(direction, 32), { duration: duration.base, easing: ease.settle });
    }
  });

  type KeyHint = { keys: string[]; label: Translations };
  const keys = $derived.by(() => {
    const hints: KeyHint[] = [
      { keys: ['←', '→'], label: 'cleanup_photo_window_move' },
      { keys: ['K'], label: 'keep' },
      { keys: ['Delete'], label: 'trash' },
    ];
    if (selection) {
      hints.push({ keys: ['Space'], label: 'select' });
    }
    hints.push({ keys: ['O'], label: 'cleanup_open_in_new_tab' });
    return hints;
  });
</script>

<svelte:document
  use:shortcuts={[
    { shortcut: { key: 'ArrowRight' }, onShortcut: () => void step(1) },
    { shortcut: { key: 'ArrowLeft' }, onShortcut: () => void step(-1) },
    { shortcut: { key: 'k' }, onShortcut: () => void act(onKeep) },
    { shortcut: { key: 'Delete' }, onShortcut: () => void act(onTrash) },
    { shortcut: { key: 'Backspace' }, onShortcut: () => void act(onTrash) },
    { shortcut: { key: ' ' }, onShortcut: toggleSelection, preventDefault: true },
    { shortcut: { key: 'o' }, onShortcut: openInNewTab },
  ]}
/>

<Modal title={$t('cleanup_photo_details')} size="giant" onClose={close}>
  <ModalBody>
    {#if current}
      <div class="grid gap-4 md:grid-cols-[minmax(0,1fr)_320px]" data-testid="cleanup-photo-window">
        <div class="relative grid min-h-[50vh] place-items-center overflow-hidden rounded-2xl bg-black">
          {#if current.thumbhash && !loaded}
            <Thumbhash base64ThumbHash={current.thumbhash} class="absolute inset-0 size-full opacity-60" />
          {/if}
          {#key current.id}
            <img
              bind:this={photo}
              src={getAssetMediaUrl({ id: current.id, size: AssetMediaSize.Preview, cacheKey: current.thumbhash })}
              alt={current.originalFileName}
              draggable="false"
              data-testid="cleanup-photo-window-photo"
              data-asset-id={current.id}
              class="relative max-h-[72vh] w-full object-contain"
              onload={() => (loaded = true)}
            />
          {/key}
          {#if current.type === AssetTypeEnum.Video}
            <span class="absolute bottom-3 left-3 rounded-full bg-black/60 px-2.5 py-1 text-xs text-white">
              <Icon icon={mdiPlay} size="14" class="inline" />
            </span>
          {/if}
          {#if mark}
            <span
              class="absolute top-3 right-3 rounded-full px-2.5 py-1 text-xs font-semibold text-white uppercase {mark ===
              'keep'
                ? 'bg-success'
                : 'bg-danger'}"
            >
              {$t(mark === 'keep' ? 'keep' : 'trash')}
            </span>
          {/if}
          <IconButton
            icon={mdiChevronLeft}
            shape="round"
            color="secondary"
            class="absolute inset-s-3 top-1/2 -translate-y-1/2 bg-black/55! text-white!"
            aria-label={$t('previous')}
            disabled={index <= 0}
            onclick={() => void step(-1)}
          />
          <IconButton
            icon={mdiChevronRight}
            shape="round"
            color="secondary"
            class="absolute inset-e-3 top-1/2 -translate-y-1/2 bg-black/55! text-white!"
            aria-label={$t('next')}
            onclick={() => void step(1)}
          />
          <span class="absolute bottom-3 rounded-full bg-black/60 px-2.5 py-1 text-xs text-white tabular-nums">
            {index + 1} / {total}
          </span>
        </div>

        <aside class="flex min-w-0 flex-col gap-4">
          <div>
            <p class="truncate font-semibold" title={current.originalFileName}>{current.originalFileName}</p>
            {#if currentSignal?.label || currentSignal?.sharpness}
              <div class="mt-2" data-testid="cleanup-photo-window-signal">
                {#if currentSignal.label}
                  <span class="rounded-full bg-warning/15 px-2.5 py-0.5 text-xs font-semibold text-warning">
                    {$t(currentSignal.label)}
                  </span>
                {/if}
                {#if currentSignal.sharpness}
                  {@const { value, rank, of } = currentSignal.sharpness}
                  <p class="text-xs font-semibold tracking-wide text-muted uppercase">{$t('cleanup_sharpness')}</p>
                  <div class="mt-1 h-1.5 overflow-hidden rounded-full bg-subtle">
                    <span class="block h-full bg-success" style:width="{Math.min(100, Math.max(4, value))}%"></span>
                  </div>
                  <p class="mt-1 text-xs text-muted">
                    {rank === 1
                      ? $t('cleanup_sharpest_of', { values: { count: of } })
                      : $t('cleanup_sharpness_rank', { values: { rank, count: of } })}
                  </p>
                {/if}
              </div>
            {/if}
          </div>

          {#key current.id}
            <AssetContextDetails assetId={current.id} class="text-sm" />
          {/key}

          <div class="flex flex-wrap gap-2">
            <Button
              size="small"
              variant="outline"
              color="secondary"
              shape="round"
              leadingIcon={mdiOpenInNew}
              href={Route.viewAsset({ id: current.id })}
              target="_blank"
              rel="noopener"
            >
              {$t('cleanup_open_in_new_tab')}
            </Button>
            <Button
              size="small"
              variant="ghost"
              color="secondary"
              shape="round"
              data-testid="cleanup-photo-window-viewer"
              onclick={() => {
                openViewer(current.id);
                onClose();
              }}
            >
              {$t('cleanup_open_in_viewer')}
            </Button>
          </div>

          <div class="mt-auto flex flex-wrap gap-2">
            <Button
              size="small"
              color="success"
              shape="round"
              leadingIcon={mdiCheck}
              disabled={busy}
              onclick={() => void act(onKeep)}
            >
              {$t('keep')}
            </Button>
            <Button
              size="small"
              color="danger"
              shape="round"
              leadingIcon={mdiTrashCanOutline}
              disabled={busy}
              onclick={() => void act(onTrash)}
            >
              {$t('trash')}
            </Button>
            {#if selection}
              <Button
                size="small"
                variant="outline"
                color="secondary"
                shape="round"
                leadingIcon={selected ? mdiCheckboxMarked : mdiCheckboxBlankOutline}
                onclick={toggleSelection}
              >
                {$t(selected ? 'selected' : 'select')}
              </Button>
            {/if}
          </div>

          <div class="flex flex-wrap gap-x-3 gap-y-1 text-xs text-muted">
            {#each keys as hint (hint.label)}
              <span class="inline-flex items-center gap-1">
                {#each hint.keys as key (key)}<ShortcutKeycap {key} />{/each}
                {$t(hint.label)}
              </span>
            {/each}
          </div>
        </aside>
      </div>
    {/if}
  </ModalBody>
</Modal>
