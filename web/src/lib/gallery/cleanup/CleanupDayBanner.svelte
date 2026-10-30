<script lang="ts">
  import { CleanupRoute } from '$lib/gallery/cleanup/cleanup-route';
  import type { DayPeek } from '$lib/gallery/cleanup/day-peek';
  import { countMotion, duration, ease, slideFrom } from '$lib/gallery/motion';
  import { getAssetMediaUrl } from '$lib/utils';
  import { monthDayLabel, rewindMinutes } from '$lib/gallery/cleanup/cleanup';
  import { AssetMediaSize, type CleanupAssetDto } from '@immich/sdk';
  import { Button } from '@immich/ui';
  import { mdiPlay } from '@mdi/js';
  import { locale, t } from 'svelte-i18n';
  import { Tween } from 'svelte/motion';

  type Props = {
    monthDay: number;
    isToday: boolean;
    /** Undefined while the date loads. */
    peek?: DayPeek;
    reviewed: boolean;
    /**
     * The slim bar the hub pins under the top bar once the full banner has scrolled away. It is a separate
     * instance rather than the full banner shrinking, so the page never reflows while it pins.
     */
    pinned: boolean;
    /** 1 when the shown date moved later, -1 earlier: the text slides in from that side. */
    direction: -1 | 0 | 1;
  };

  let { monthDay, isToday, peek, reviewed, pinned, direction }: Props = $props();

  const COLLAGE = 5;

  const lang = $derived($locale ?? 'en');
  const date = $derived(monthDayLabel(monthDay, lang));
  const photos = new Tween(0, countMotion());
  const years = new Tween(0, countMotion());
  $effect(() => {
    void photos.set(peek?.photos ?? 0);
    void years.set(peek?.years ?? 0);
  });

  const isEmpty = $derived(peek?.photos === 0);
  const minutes = $derived(peek ? rewindMinutes(peek.photos) : undefined);
  // With more photos than the collage holds, its last cell becomes a "+N" tile.
  const shown = $derived(
    peek ? peek.assets.slice(0, peek.photos > COLLAGE ? COLLAGE - 1 : COLLAGE) : ([] as CleanupAssetDto[]),
  );
  const more = $derived(peek && peek.photos > COLLAGE ? peek.photos - (COLLAGE - 1) : 0);
  const href = $derived(CleanupRoute.rewind({ monthDay }));
  const startLabel = $derived(isToday ? $t('cleanup_start_todays_rewind') : $t('cleanup_rewind_this_day'));
  const countsLabel = $derived(
    $t('cleanup_banner_photos_years', {
      values: { photos: Math.round(photos.current), years: Math.round(years.current) },
    }),
  );

  const thumbnail = (asset: CleanupAssetDto, size = AssetMediaSize.Thumbnail) =>
    getAssetMediaUrl({ id: asset.id, size, cacheKey: asset.thumbhash });

  let text = $state<HTMLElement>();
  let previousMonthDay: number | undefined;
  // A new date slides its text in from the side it came from; the first render stays still.
  $effect(() => {
    const current = monthDay;
    if (previousMonthDay !== undefined && previousMonthDay !== current && text?.animate) {
      text.animate(slideFrom(direction), { duration: duration.base, easing: ease.settle });
    }
    previousMonthDay = current;
  });
</script>

{#snippet startButton(size: 'small' | 'medium')}
  {#if isEmpty}
    <Button {size} shape="round" disabled leadingIcon={mdiPlay} data-testid="cleanup-banner-start">{startLabel}</Button>
  {:else}
    <Button {size} shape="round" {href} leadingIcon={mdiPlay} data-testid="cleanup-banner-start">{startLabel}</Button>
  {/if}
{/snippet}

{#if pinned}
  <div
    class="flex items-center gap-3 rounded-full border bg-light/85 py-1.5 ps-1.5 pe-2 shadow-lg backdrop-blur-md"
    data-testid="cleanup-day-banner"
    data-pinned="true"
  >
    <div class="flex -space-x-2" data-testid="cleanup-banner-slim">
      {#each (peek?.assets ?? []).slice(0, 3) as asset (asset.id)}
        <img
          src={thumbnail(asset)}
          alt=""
          draggable="false"
          class="size-9 rounded-full border-2 border-light object-cover"
        />
      {/each}
    </div>
    <div class="min-w-0 flex-1 truncate text-sm">
      <b>{isToday ? $t('cleanup_banner_today', { values: { date } }) : date}</b>
      {#if peek}<span class="text-muted tabular-nums"> · {countsLabel}</span>{/if}
    </div>
    {@render startButton('small')}
  </div>
{:else}
  <section
    class="grid items-center gap-5 overflow-hidden rounded-3xl border bg-linear-to-br from-primary/15 via-primary/5 to-transparent p-4 md:grid-cols-[1.1fr_1fr] md:p-5"
    data-testid="cleanup-day-banner"
    data-pinned="false"
  >
    {#if peek}
      <div
        class="grid h-44 grid-cols-[2fr_1fr_1fr] grid-rows-2 gap-1.5 md:h-52"
        data-testid="cleanup-banner-collage"
        data-shared-element="cleanup-day-photos"
      >
        {#key monthDay}
          {#each shown as asset, index (asset.id)}
            <img
              src={thumbnail(asset, index === 0 ? AssetMediaSize.Preview : AssetMediaSize.Thumbnail)}
              alt={asset.originalFileName}
              draggable="false"
              data-motion-reveal
              class="size-full rounded-xl bg-subtle object-cover {index === 0 ? 'row-span-2 rounded-2xl' : ''}"
            />
          {/each}
          {#if more > 0}
            <div class="grid place-items-center rounded-xl bg-subtle font-semibold tabular-nums">+{more}</div>
          {/if}
          {#if shown.length === 0}
            <div class="col-span-3 row-span-2 rounded-2xl bg-subtle"></div>
          {/if}
        {/key}
      </div>
    {:else}
      <div class="h-44 animate-pulse rounded-2xl bg-subtle md:h-52" data-testid="cleanup-banner-loading"></div>
    {/if}

    <div bind:this={text} class="min-w-0">
      <p class="text-xs font-semibold tracking-widest text-muted uppercase" data-shared-element="cleanup-day-title">
        {isToday ? $t('cleanup_banner_today', { values: { date } }) : date}
      </p>
      {#if peek}
        {#if isEmpty}
          <p class="my-2 text-2xl font-bold tracking-tight">{$t('cleanup_banner_empty')}</p>
        {:else}
          <p class="my-1.5 text-3xl font-bold tracking-tight tabular-nums">{countsLabel}</p>
          <p class="mb-4 text-sm text-muted" data-testid="cleanup-banner-detail">
            {#if reviewed}
              {$t('cleanup_banner_reviewed')}
            {:else if minutes}
              {$t('cleanup_banner_estimate', { values: { minutes } })}
            {/if}
            {#if peek.busiest}
              {peek.busiest.city
                ? $t('cleanup_banner_busiest_city', {
                    values: { year: String(peek.busiest.year), city: peek.busiest.city },
                  })
                : $t('cleanup_banner_busiest', { values: { year: String(peek.busiest.year) } })}
            {/if}
          </p>
        {/if}
      {:else}
        <div class="my-3 h-8 w-64 animate-pulse rounded-lg bg-subtle"></div>
        <div class="mb-4 h-4 w-48 animate-pulse rounded-sm bg-subtle"></div>
      {/if}
      {@render startButton('medium')}
    </div>
  </section>
{/if}
