<script lang="ts">
  import CleanupTile from '$lib/components/cleanup/CleanupTile.svelte';
  import type { RewindMark } from '$lib/managers/rewind-session.svelte';
  import { Route } from '$lib/route';
  import { getAssetMediaUrl } from '$lib/utils';
  import { AssetMediaSize, CleanupBlurReason, type CleanupAssetDto } from '@immich/sdk';
  import { Card, Icon, Text } from '@immich/ui';
  import {
    mdiArrowRight,
    mdiBlur,
    mdiCheck,
    mdiChevronRight,
    mdiClose,
    mdiHeart,
    mdiImageMultipleOutline,
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
        href: Route.cleanupQueue({ queue: 'bursts' }),
      });
    }
    const quality = asset.reason ? QUALITY_HINTS[asset.reason] : undefined;
    if (quality) {
      list.push({
        testId: 'cleanup-hint-quality',
        icon: mdiBlur,
        label: quality,
        queue: 'cleanup_queue_blurry',
        href: Route.cleanupQueue({ queue: 'blurry' }),
      });
    }
    return list;
  });

  // localDateTime is the wall-clock capture time serialised as UTC, so it is read back in UTC.
  const taken = $derived(asset ? DateTime.fromISO(asset.localDateTime, { zone: 'utc' }) : undefined);
  const yearsAgo = $derived(taken ? new Date().getFullYear() - taken.year : 0);
  const time = $derived(taken?.setLocale($locale ?? 'en').toLocaleString(DateTime.TIME_SIMPLE));

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

<div class="mt-4 grid items-start gap-4 lg:grid-cols-[minmax(0,1fr)_260px]" data-testid="cleanup-rewind-one">
  <div class="relative grid min-h-[430px] place-items-center rounded-2xl bg-[#15171d] px-5 pt-16 pb-24">
    {#if asset && taken}
      <div class="absolute inset-s-5 top-4 text-white">
        <p class="text-sm font-bold tabular-nums">
          {taken.year} · {$t('cleanup_years_ago', { values: { count: yearsAgo } })}
        </p>
        <p class="text-xs tabular-nums opacity-70">
          {#if asset.city}{asset.city} ·
          {/if}{time} · {$t('cleanup_photo_position', { values: { index, total } })}
        </p>
      </div>

      {#key asset.id}
        <button
          type="button"
          class="block w-[min(520px,100%)] overflow-hidden rounded-[10px] {ringClass}"
          aria-label={asset.originalFileName}
          ondblclick={() => onOpen(asset.id)}
          data-testid="cleanup-rewind-stage-{asset.id}"
          data-asset-id={asset.id}
          data-mark={mark ?? 'none'}
        >
          <img
            src={getAssetMediaUrl({ id: asset.id, size: AssetMediaSize.Preview, cacheKey: asset.thumbhash })}
            alt={asset.originalFileName}
            draggable="false"
            class="aspect-4/3 w-full bg-black object-contain"
          />
        </button>
      {/key}

      <div class="absolute bottom-5 flex gap-3">
        {#each buttons as button (button.label)}
          <button
            type="button"
            class="grid size-13 place-items-center rounded-full shadow-md transition-transform hover:scale-105 focus-visible:outline-3 focus-visible:outline-offset-2 focus-visible:outline-white {button.class}"
            title="{$t(button.label)} ({button.key})"
            aria-label={$t(button.label)}
            onclick={button.onclick}
          >
            <Icon icon={button.icon} size="22" />
          </button>
        {/each}
      </div>
    {:else}
      <Text class="text-white/70">{$t('no_assets_to_show')}</Text>
    {/if}
  </div>

  <div class="flex flex-col gap-3">
    <Card>
      <div class="p-3.5">
        <Text size="small" fontWeight="bold">{$t('cleanup_up_next')}</Text>
        <div class="mt-2 grid grid-cols-4 gap-1">
          {#each upNext as next (next.id)}
            {@const nextMark = marks.get(next.id)}
            <button
              type="button"
              class="block rounded-md"
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
    </Card>

    {#if hints.length > 0}
      <Card>
        <div class="p-3.5" data-testid="cleanup-rewind-hints">
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
      </Card>
    {/if}
  </div>
</div>
