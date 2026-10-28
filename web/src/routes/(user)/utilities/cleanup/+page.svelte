<script lang="ts">
  import CleanupCalendar from '$lib/components/cleanup/CleanupCalendar.svelte';
  import UserPageLayout from '$lib/components/layouts/UserPageLayout.svelte';
  import CleanupDayBanner from '$lib/gallery/cleanup/CleanupDayBanner.svelte';
  import CleanupQuickWins from '$lib/gallery/cleanup/CleanupQuickWins.svelte';
  import type { DayPeek } from '$lib/gallery/cleanup/day-peek';
  import { finishedDay } from '$lib/gallery/cleanup/finished-day';
  import { countMotion, staggerDelay } from '$lib/gallery/motion';
  import { Route } from '$lib/route';
  import { handleEmptyTrash } from '$lib/services/trash.service';
  import { getByteUnitString } from '$lib/utils/byte-units';
  import { browserTimeZone, busiestYear, dominantCity, todayMonthDay } from '$lib/utils/cleanup';
  import { isTrashEnabled } from '$lib/utils/cleanup-actions';
  import { handleError } from '$lib/utils/handle-error';
  import {
    CleanupCountQueue,
    CleanupListQueue,
    getCleanupCalendar,
    getCleanupQueue,
    getCleanupQueueCount,
    getCleanupRewindAssets,
    getCleanupRewindYears,
    getCleanupTrash,
    type CleanupAssetDto,
    type CleanupCalendarResponseDto,
    type CleanupCountResponseDto,
    type CleanupTrashResponseDto,
  } from '@immich/sdk';
  import { Breadcrumbs, Card, Heading, Text } from '@immich/ui';
  import { mdiSlashForward } from '@mdi/js';
  import { goto } from '$app/navigation';
  import { onDestroy, onMount } from 'svelte';
  import { locale, t } from 'svelte-i18n';
  import { Tween } from 'svelte/motion';
  import { SvelteMap } from 'svelte/reactivity';
  import type { PageData } from './$types';

  type Props = {
    data: PageData;
  };

  let { data }: Props = $props();

  const PEEK_DEBOUNCE_MS = 150;
  const PEEK_THUMBNAILS = 14;
  const QUEUES = [
    CleanupCountQueue.SpaceHogs,
    CleanupCountQueue.Bursts,
    CleanupCountQueue.Screenshots,
    CleanupCountQueue.Duplicates,
    CleanupCountQueue.Blurry,
  ];

  // Queues whose first item doubles as the card cover. Bursts is left out on purpose: its grouping query is
  // the heaviest, so its card keeps the icon.
  const COVER_QUEUES: Partial<Record<CleanupCountQueue, CleanupListQueue>> = {
    [CleanupCountQueue.SpaceHogs]: CleanupListQueue.SpaceHogs,
    [CleanupCountQueue.Screenshots]: CleanupListQueue.Screenshots,
    [CleanupCountQueue.Blurry]: CleanupListQueue.Blurry,
  };

  const today = todayMonthDay();
  // With the trash turned off Cleanup deletes permanently, so there is no trash line to show.
  const showTrash = isTrashEnabled();
  // A date finished in rewind just now: its calendar cell lands green with a pop.
  const justReviewed = finishedDay.take();

  let calendar = $state<CleanupCalendarResponseDto>();
  let trash = $state<CleanupTrashResponseDto>();
  let counts = $state<Partial<Record<CleanupCountQueue, CleanupCountResponseDto>>>({});
  let covers = $state<Partial<Record<CleanupCountQueue, CleanupAssetDto>>>({});
  let settledCounts = $state(0);

  type Peek = DayPeek & { monthDay: number };
  let peekDay = $state(today);
  let peekDirection = $state<-1 | 0 | 1>(0);
  let peek = $state<Peek>();
  let peekTimer: ReturnType<typeof setTimeout> | undefined;
  let peekAbort: AbortController | undefined;
  const peekCache = new SvelteMap<number, Peek>();

  let banner = $state<HTMLElement>();
  let pinned = $state(false);

  const lang = $derived($locale ?? 'en');
  // Shown only once every count has settled, so the figure never climbs while requests land.
  const couldStillFree = $derived(
    settledCounts < QUEUES.length ? undefined : Object.values(counts).reduce((sum, count) => sum + count.bytes, 0),
  );
  // Counts up from zero once every queue has reported, then follows later changes.
  const couldStillFreeShown = Tween.of(() => couldStillFree ?? 0, countMotion());
  const peekLoaded = $derived(peek?.monthDay === peekDay ? peek : undefined);
  const peekReviewed = $derived.by(() => {
    const day = calendar?.days.find(({ monthDay }) => monthDay === peekDay);
    return !!day?.reviewedAt && day.assetCount > 0;
  });

  const loadCover = async (queue: CleanupCountQueue) => {
    const listQueue = COVER_QUEUES[queue];
    if (!listQueue) {
      return;
    }
    // Decorative only: the card falls back to the queue icon when this fails.
    const page = await getCleanupQueue({ queue: listQueue, limit: 1 }).catch(() => undefined);
    const cover = page?.items[0];
    if (cover) {
      covers[queue] = cover;
    }
  };

  const loadCount = async (queue: CleanupCountQueue) => {
    try {
      const count = await getCleanupQueueCount({ queue });
      counts[queue] = count;
      if (count.count > 0) {
        void loadCover(queue);
      }
    } catch (error) {
      handleError(error, $t('errors.failed_to_load_assets'));
    } finally {
      settledCounts++;
    }
  };

  const loadCalendar = async () => {
    try {
      calendar = await getCleanupCalendar({ tz: browserTimeZone() });
    } catch (error) {
      handleError(error, $t('errors.failed_to_load_assets'));
    }
  };

  const loadTrash = async () => {
    try {
      trash = await getCleanupTrash();
    } catch (error) {
      handleError(error, $t('errors.failed_to_load_assets'));
    }
  };

  /** One request for the years, one for the busiest year's photos: enough for the counts, collage and city. */
  const loadPeek = async (monthDay: number, signal: AbortSignal) => {
    const { years } = await getCleanupRewindYears({ monthDay }, { signal });
    if (signal.aborted) {
      return;
    }
    const photos = years.reduce((sum, year) => sum + year.count, 0);
    const busiest = busiestYear(years);
    let assets: CleanupAssetDto[] = [];
    if (busiest) {
      const response = await getCleanupRewindAssets({ monthDay, year: busiest.year }, { signal });
      assets = response.assets;
    }
    if (!signal.aborted) {
      peek = {
        monthDay,
        photos,
        years: years.length,
        busiest: busiest && { year: busiest.year, city: dominantCity(assets) ?? null },
        assets: assets.slice(0, PEEK_THUMBNAILS),
      };
      peekCache.set(monthDay, peek);
    }
  };

  const startPeek = (monthDay: number, delay: number) => {
    peekDirection = monthDay === peekDay ? 0 : monthDay > peekDay ? 1 : -1;
    peekDay = monthDay;
    clearTimeout(peekTimer);
    peekAbort?.abort();
    const cached = peekCache.get(monthDay);
    if (cached) {
      peek = cached;
      return;
    }
    peekTimer = setTimeout(() => {
      const controller = new AbortController();
      peekAbort = controller;
      loadPeek(monthDay, controller.signal).catch((error: unknown) => {
        if (!controller.signal.aborted) {
          handleError(error, $t('errors.failed_to_load_assets'));
        }
      });
    }, delay);
  };

  // Hovering then focusing the same cell must not abort and restart its request, so a day that is
  // already loading or loaded is left alone.
  const schedulePeek = (monthDay: number) => {
    if (monthDay !== peekDay) {
      startPeek(monthDay, PEEK_DEBOUNCE_MS);
    }
  };

  // Leaving the calendar returns the banner to today at once: today is cached from the first load.
  const returnToToday = () => {
    if (peekDay !== today) {
      startPeek(today, 0);
    }
  };

  const onEmptyTrash = async () => {
    await handleEmptyTrash();
    await loadTrash();
  };

  onMount(() => {
    void Promise.all([loadCalendar(), ...(showTrash ? [loadTrash()] : []), ...QUEUES.map((queue) => loadCount(queue))]);
    startPeek(today, 0);
  });

  // The slim banner pins once the full one has scrolled up out of view, so a day hovered in the calendar
  // further down is always previewed where the user can see it.
  $effect(() => {
    if (!banner || typeof IntersectionObserver === 'undefined') {
      return;
    }
    const observer = new IntersectionObserver(([entry]) => {
      pinned = !entry.isIntersecting && entry.boundingClientRect.top < 0;
    });
    observer.observe(banner);
    return () => observer.disconnect();
  });

  onDestroy(() => {
    clearTimeout(peekTimer);
    peekAbort?.abort();
  });
</script>

<UserPageLayout>
  <div class="mx-auto w-full max-w-7xl px-2 pt-2 pb-10 md:px-4" data-testid="cleanup-hub">
    <!-- A zero-height sticky layer, so pinning the slim banner never reflows the page under it. -->
    <div class="pointer-events-none sticky top-2 z-20 h-0">
      {#if pinned}
        <div class="pointer-events-auto mx-auto max-w-3xl" data-motion-reveal>
          <CleanupDayBanner
            monthDay={peekDay}
            isToday={peekDay === today}
            peek={peekLoaded}
            reviewed={peekReviewed}
            pinned
            direction={peekDirection}
          />
        </div>
      {/if}
    </div>

    <header class="mb-5 flex flex-wrap items-end gap-3">
      <div class="min-w-0">
        <Breadcrumbs
          items={[{ title: $t('utilities'), href: Route.utilities() }, { title: data.meta.title }]}
          separator={mdiSlashForward}
          class="text-muted"
        />
        <Heading size="large" tag="h2" class="mt-1 tracking-tight">{data.meta.title}</Heading>
        {#if calendar}
          <Text size="small" color="muted" class="mt-1 tabular-nums" data-testid="cleanup-hub-subtitle">
            {$t('cleanup_days_reviewed', { values: { count: calendar.daysReviewed } })} · {$t('cleanup_streak', {
              values: { count: calendar.streak },
            })}
          </Text>
        {/if}
      </div>

      <div class="ms-auto">
        {#if couldStillFree === undefined}
          <span
            class="inline-block h-7 w-40 animate-pulse rounded-full bg-gray-200 dark:bg-gray-700"
            data-testid="cleanup-could-still-free-pending"
          ></span>
        {:else}
          <span
            class="inline-flex items-center rounded-full border border-success/30 bg-success/10 px-3 py-1 text-xs font-medium whitespace-nowrap text-success tabular-nums"
            data-testid="cleanup-could-still-free"
          >
            {$t('cleanup_could_still_free', {
              values: { size: getByteUnitString(Math.round(couldStillFreeShown.current), lang) },
            })}
          </span>
        {/if}
      </div>
    </header>

    <div bind:this={banner} data-motion-reveal style:animation-delay={staggerDelay(0)}>
      <CleanupDayBanner
        monthDay={peekDay}
        isToday={peekDay === today}
        peek={peekLoaded}
        reviewed={peekReviewed}
        pinned={false}
        direction={peekDirection}
      />
    </div>

    <div class="mt-7">
      <CleanupQuickWins {counts} {trash} {covers} {showTrash} onEmptyTrash={() => void onEmptyTrash()} />
    </div>

    <Card class="mt-7 p-4 md:p-5" data-motion-reveal style="animation-delay: {staggerDelay(6)}">
      {#if calendar}
        <CleanupCalendar
          days={calendar.days}
          {today}
          {justReviewed}
          onPeek={(monthDay) => schedulePeek(monthDay)}
          onLeave={returnToToday}
          onOpen={(monthDay) => void goto(Route.cleanupRewind({ monthDay }))}
        />
      {:else}
        <div class="h-40 w-full animate-pulse rounded-lg bg-gray-200 dark:bg-gray-700"></div>
      {/if}
    </Card>
  </div>
</UserPageLayout>
