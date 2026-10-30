<script lang="ts">
  import { CleanupRoute } from '$lib/gallery/cleanup/cleanup-route';
  import { flipMotion } from '$lib/gallery/motion';
  import { flip } from 'svelte/animate';
  import CleanupTile from '$lib/gallery/cleanup/CleanupTile.svelte';
  import type { RewindMark } from '$lib/gallery/cleanup/rewind-session.svelte';
  import { getAssetMediaUrl } from '$lib/utils';
  import { AssetMediaSize, CleanupBlurReason, type CleanupAssetDto } from '@immich/sdk';
  import ShortcutKeycap from '$lib/gallery/components/shortcut-keycap.svelte';
  import RewindPhotoInfo from '$lib/gallery/cleanup/RewindPhotoInfo.svelte';
  import { Route } from '$lib/route';
  import { Icon, Text } from '@immich/ui';
  import {
    mdiArrowRight,
    mdiBlur,
    mdiCheck,
    mdiChevronRight,
    mdiClose,
    mdiHeart,
    mdiImageMultipleOutline,
    mdiOpenInNew,
  } from '@mdi/js';
  import { DateTime } from 'luxon';
  import { locale, t, type Translations } from 'svelte-i18n';

  type Props = {
    asset?: CleanupAssetDto;
    mark?: RewindMark;
    /** 1-based position of `asset` among the date's photos. */
    index: number;
    total: number;
    upNext: CleanupAssetDto[];
    marks: ReadonlyMap<string, RewindMark>;
    onTrash: () => void;
    onSkip: () => void;
    onFavorite: () => void;
    onKeep: () => void;
    onSelect: (id: string) => void;
    onOpen: (id: string) => void;
    /** Whether `asset` was taken within the burst gap of another photo of the date (see `burstMemberIds`). */
    inBurst?: boolean;
  };

  let {
    asset,
    mark,
    index,
    total,
    upNext,
    marks,
    onTrash,
    onSkip,
    onFavorite,
    onKeep,
    onSelect,
    onOpen,
    inBurst = false,
  }: Props = $props();

  const PRELOAD = 3;

  const QUALITY_HINTS: Partial<Record<CleanupBlurReason, Translations>> = {
    [CleanupBlurReason.Blurry]: 'cleanup_hint_blurry',
    [CleanupBlurReason.Dark]: 'cleanup_hint_dark',
    [CleanupBlurReason.Bright]: 'cleanup_hint_bright',
  };

  // Each hint points at the queue that collects photos like this one. `reason` is the Blurry
  // queue's reason at its default strictness, but that queue also hides photos with faces and ones
  // already kept there by default, so the link is a hint, not a promise the photo is listed.
  const hints = $derived.by(() => {
    const list: Array<{ testId: string; icon: string; label: Translations; queue: Translations; href: string }> = [];
    if (!asset) {
      return list;
    }
    if (inBurst) {
      list.push({
        testId: 'cleanup-hint-burst',
        icon: mdiImageMultipleOutline,
        label: 'cleanup_hint_burst',
        queue: 'cleanup_queue_bursts',
        href: CleanupRoute.queue({ queue: 'bursts' }),
      });
    }
    const quality = asset.reason ? QUALITY_HINTS[asset.reason] : undefined;
    if (quality) {
      list.push({
        testId: 'cleanup-hint-quality',
        icon: mdiBlur,
        label: quality,
        queue: 'cleanup_queue_blurry',
        href: CleanupRoute.queue({ queue: 'blurry' }),
      });
    }
    return list;
  });

  // localDateTime is the wall-clock capture time serialised as UTC, so it is read back in UTC.
  const taken = $derived(asset ? DateTime.fromISO(asset.localDateTime, { zone: 'utc' }) : undefined);
  const yearsAgo = $derived(taken ? new Date().getFullYear() - taken.year : 0);
  const time = $derived(taken?.setLocale($locale ?? 'en').toLocaleString(DateTime.TIME_SIMPLE));

  // The photo's own shape, so a portrait shot is not shrunk into a landscape box with black bars.
  const ratio = $derived(asset?.width && asset.height ? asset.width / asset.height : 4 / 3);

  let loadedPreviewId = $state<string>();
  const previewLoaded = $derived(!!asset && loadedPreviewId === asset.id);

  // Fetch the next few previews ahead, so stepping forward shows a photo that is already loaded.
  // The Image objects are kept so the requests are not dropped before they finish.
  let preloaded: Array<{ id: string; image: HTMLImageElement }> = [];
  const preload = (next: CleanupAssetDto) => {
    const image = new Image();
    image.src = getAssetMediaUrl({ id: next.id, size: AssetMediaSize.Preview, cacheKey: next.thumbhash });
    return image;
  };
  $effect(() => {
    preloaded = upNext
      .slice(0, PRELOAD)
      .map((next) => preloaded.find((entry) => entry.id === next.id) ?? { id: next.id, image: preload(next) });
  });

  const ringClass = $derived(
    mark === 'keep'
      ? 'ring-3 ring-success'
      : mark === 'fav'
        ? 'ring-3 ring-pink-500'
        : mark === 'trash'
          ? 'ring-3 ring-danger grayscale brightness-60'
          : '',
  );

  const buttons = $derived([
    { label: 'trash', key: 'Delete', icon: mdiClose, class: 'bg-danger text-white', onclick: onTrash },
    { label: 'skip', key: '→', icon: mdiArrowRight, class: 'bg-white text-black', onclick: onSkip },
    { label: 'favorite', key: 'F', icon: mdiHeart, class: 'bg-pink-500 text-white', onclick: onFavorite },
    { label: 'cleanup_shortcut_keep', key: 'K', icon: mdiCheck, class: 'bg-success text-white', onclick: onKeep },
  ] as const);
</script>

<div class="mt-4 grid items-start gap-4 lg:grid-cols-[minmax(0,1fr)_340px]" data-testid="cleanup-rewind-one">
  <div class="flex min-w-0 flex-col gap-3">
    <div class="relative flex flex-col items-center gap-4 rounded-2xl bg-[#15171d] px-3 pt-4 pb-5 sm:px-5">
      {#if asset && taken}
        <div class="flex w-full items-start justify-between gap-3 text-white">
          <div class="min-w-0">
            <p class="text-sm font-bold tabular-nums">
              {taken.year} · {$t('cleanup_years_ago', { values: { count: yearsAgo } })}
            </p>
            <p class="text-xs tabular-nums opacity-70">
              {#if asset.city}{asset.city} ·
              {/if}{time} · {$t('cleanup_photo_position', { values: { index, total } })}
            </p>
          </div>
          <a
            href={Route.viewAsset({ id: asset.id })}
            target="_blank"
            rel="noopener"
            class="inline-flex shrink-0 items-center gap-1.5 rounded-full border border-white/25 px-3 py-1 text-xs font-medium hover:bg-white/10"
            data-testid="cleanup-rewind-open-new-tab"
          >
            <Icon icon={mdiOpenInNew} size="14" />
            {$t('cleanup_open_in_new_tab')}
            <ShortcutKeycap key="O" />
          </a>
        </div>

        {#key asset.id}
          <button
            data-motion-reveal
            type="button"
            class="relative block max-w-full overflow-hidden rounded-[10px] bg-black {ringClass}"
            style:aspect-ratio={ratio}
            style:width="min(100%, calc(min(68vh, 760px) * {ratio}))"
            aria-label={asset.originalFileName}
            ondblclick={() => onOpen(asset.id)}
            data-testid="cleanup-rewind-stage-{asset.id}"
            data-asset-id={asset.id}
            data-asset={asset.id}
            data-mark={mark ?? 'none'}
          >
            <!-- The small thumbnail is usually cached from the Up next strip, so it shows at once while
                 the preview loads, instead of the preview painting in from top to bottom. -->
            {#if !previewLoaded}
              <img
                src={getAssetMediaUrl({ id: asset.id, size: AssetMediaSize.Thumbnail, cacheKey: asset.thumbhash })}
                alt=""
                draggable="false"
                class="absolute inset-0 size-full object-contain blur-[2px]"
              />
            {/if}
            <img
              src={getAssetMediaUrl({ id: asset.id, size: AssetMediaSize.Preview, cacheKey: asset.thumbhash })}
              alt={asset.originalFileName}
              draggable="false"
              class="absolute inset-0 size-full object-contain transition-opacity duration-150 {previewLoaded
                ? 'opacity-100'
                : 'opacity-0'}"
              onload={() => (loadedPreviewId = asset.id)}
            />
          </button>
        {/key}

        <div class="flex gap-3 sm:gap-4">
          {#each buttons as button (button.label)}
            <div class="flex flex-col items-center gap-1.5">
              <button
                type="button"
                class="grid size-13 place-items-center rounded-full shadow-md transition-transform hover:scale-105 focus-visible:outline-3 focus-visible:outline-offset-2 focus-visible:outline-white {button.class}"
                title="{$t(button.label)} ({button.key})"
                aria-label={$t(button.label)}
                onclick={button.onclick}
              >
                <Icon icon={button.icon} size="22" />
              </button>
              <span class="flex items-center gap-1 text-[11px] text-white/70">
                <ShortcutKeycap key={button.key} class="text-white" />
                <span class="pointer-fine:hidden">{$t(button.label)}</span>
              </span>
            </div>
          {/each}
        </div>
      {:else}
        <Text class="py-24 text-white/70">{$t('no_assets_to_show')}</Text>
      {/if}
    </div>

    {#if upNext.length > 0}
      <div class="rounded-2xl border bg-light p-3" data-testid="cleanup-rewind-up-next">
        <Text size="small" fontWeight="bold">{$t('cleanup_up_next')}</Text>
        <div class="mt-2 flex gap-1.5 overflow-x-auto pb-1">
          {#each upNext as next (next.id)}
            {@const nextMark = marks.get(next.id)}
            <button
              animate:flip={flipMotion()}
              type="button"
              class="block w-18 shrink-0 rounded-md"
              aria-label={next.originalFileName}
              data-testid="cleanup-rewind-next-{next.id}"
              onclick={() => onSelect(next.id)}
            >
              <CleanupTile
                id={next.id}
                thumbhash={next.thumbhash}
                class={nextMark === 'trash' ? '[&_img]:brightness-60 [&_img]:grayscale' : ''}
              />
            </button>
          {/each}
        </div>
      </div>
    {/if}
  </div>

  {#if asset}
    <RewindPhotoInfo photo={asset} prefetchIds={upNext.slice(0, 1).map((next) => next.id)}>
      {#if hints.length > 0}
        <div class="rounded-2xl border bg-light p-3.5" data-testid="cleanup-rewind-hints">
          <Text size="small" fontWeight="bold">{$t('cleanup_hints')}</Text>
          <ul class="mt-2 flex flex-col gap-2.5">
            {#each hints as hint (hint.testId)}
              <li class="flex items-start gap-2 text-xs" data-testid={hint.testId}>
                <Icon icon={hint.icon} size="16" class="mt-px shrink-0 text-muted" />
                <span class="min-w-0">
                  <span class="block">{$t(hint.label)}</span>
                  <a
                    href={hint.href}
                    class="inline-flex items-center gap-0.5 font-semibold text-primary hover:underline"
                  >
                    {$t(hint.queue)}
                    <Icon icon={mdiChevronRight} size="14" />
                  </a>
                </span>
              </li>
            {/each}
          </ul>
        </div>
      {/if}
    </RewindPhotoInfo>
  {/if}
</div>
