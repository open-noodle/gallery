<script lang="ts">
  import CleanupCalendar from '$lib/components/cleanup/CleanupCalendar.svelte';
  import CleanupQueueRail from '$lib/components/cleanup/CleanupQueueRail.svelte';
  import CleanupTile from '$lib/components/cleanup/CleanupTile.svelte';
  import UserPageLayout from '$lib/components/layouts/UserPageLayout.svelte';
  import { Route } from '$lib/route';
  import { handleEmptyTrash } from '$lib/services/trash.service';
  import { getByteUnitString } from '$lib/utils/byte-units';
  import { browserTimeZone, monthDayLabel, todayMonthDay } from '$lib/utils/cleanup';
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
  import { Breadcrumbs, Button, Card, Heading, Text } from '@immich/ui';
  import { mdiRewind, mdiSlashForward } from '@mdi/js';
  import { goto } from '$app/navigation';
  import { onDestroy, onMount } from 'svelte';
  import { locale, t } from 'svelte-i18n';
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

  // Queues whose first item doubles as the rail thumbnail. Bursts is left out on purpose: its
  // grouping query is the heaviest, so its row keeps the icon tile.
  const COVER_QUEUES: Partial<Record<CleanupCountQueue, CleanupListQueue>> = {
    [CleanupCountQueue.SpaceHogs]: CleanupListQueue.SpaceHogs,
    [CleanupCountQueue.Screenshots]: CleanupListQueue.Screenshots,
    [CleanupCountQueue.Blurry]: CleanupListQueue.Blurry,
  };

  const today = todayMonthDay();

  let calendar = $state<CleanupCalendarResponseDto>();
  let trash = $state<CleanupTrashResponseDto>();
  let counts = $state<Partial<Record<CleanupCountQueue, CleanupCountResponseDto>>>({});
  let covers = $state<Partial<Record<CleanupCountQueue, CleanupAssetDto>>>({});
  let settledCounts = $state(0);

  type Peek = { monthDay: number; photos: number; years: number; assets: CleanupAssetDto[] };
  let peekDay = $state(today);
  let peek = $state<Peek>();
  let peekTimer: ReturnType<typeof setTimeout> | undefined;
  let peekAbort: AbortController | undefined;
  const peekCache = new SvelteMap<number, Peek>();

  const lang = $derived($locale ?? 'en');
  // Shown only once every count has settled, so the figure never climbs while requests land.
  const couldStillFree = $derived(
    settledCounts < QUEUES.length ? undefined : Object.values(counts).reduce((sum, count) => sum + count.bytes, 0),
  );
  const peekLoaded = $derived(peek?.monthDay === peekDay ? peek : undefined);

  const loadCover = async (queue: CleanupCountQueue) => {
    const listQueue = COVER_QUEUES[queue];
    if (!listQueue) {
      return;
    }
    // Decorative only: the rail falls back to the queue icon when this fails.
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

  const loadPeek = async (monthDay: number, signal: AbortSignal) => {
    const { years } = await getCleanupRewindYears({ monthDay }, { signal });
    const photos = years.reduce((sum, year) => sum + year.count, 0);
    if (signal.aborted) {
      return;
    }
    let assets: CleanupAssetDto[] = [];
    if (years.length > 0) {
      // Years arrive most recent first.
      const response = await getCleanupRewindAssets({ monthDay, year: years[0].year }, { signal });
      assets = response.assets;
    }
    if (!signal.aborted) {
      peek = { monthDay, photos, years: years.length, assets: assets.slice(0, PEEK_THUMBNAILS) };
      peekCache.set(monthDay, peek);
    }
  };

  const startPeek = (monthDay: number, delay: number) => {
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

  const onEmptyTrash = async () => {
    await handleEmptyTrash();
    await loadTrash();
  };

  onMount(() => {
    void Promise.all([loadCalendar(), loadTrash(), ...QUEUES.map((queue) => loadCount(queue))]);
    startPeek(today, 0);
  });

  onDestroy(() => {
    clearTimeout(peekTimer);
    peekAbort?.abort();
  });
</script>

<UserPageLayout>
  <div class="mx-auto w-full max-w-7xl px-2 pt-2 pb-10 md:px-4" data-testid="cleanup-hub">
    <header class="mb-5 flex flex-wrap items-center gap-3">
      <div class="min-w-0">
        <Breadcrumbs
          items={[{ title: $t('utilities'), href: Route.utilities() }, { title: data.meta.title }]}
          separator={mdiSlashForward}
        />
        <Heading size="medium" tag="h2" class="mt-1">{data.meta.title}</Heading>
        {#if calendar}
          <Text size="small" color="muted" class="mt-1 tabular-nums" data-testid="cleanup-hub-subtitle">
            {$t('cleanup_days_reviewed', { values: { count: calendar.daysReviewed } })} · {$t('cleanup_streak', {
              values: { count: calendar.streak },
            })}
          </Text>
        {/if}
      </div>

      <div class="ms-auto flex flex-wrap items-center gap-2">
        {#if couldStillFree === undefined}
          <span
            class="inline-block h-6 w-36 animate-pulse rounded-full bg-gray-200 dark:bg-gray-700"
            data-testid="cleanup-could-still-free-pending"
          ></span>
        {:else}
          <span
            class="inline-flex items-center rounded-full border border-success/30 bg-success/10 px-3 py-1 text-xs font-medium whitespace-nowrap text-success tabular-nums"
            data-testid="cleanup-could-still-free"
          >
            {$t('cleanup_could_still_free', { values: { size: getByteUnitString(couldStillFree, lang) } })}
          </span>
        {/if}
        <Button href={Route.cleanupRewind({ monthDay: today })} size="small" leadingIcon={mdiRewind}>
          {$t('cleanup_rewind_today')}
        </Button>
      </div>
    </header>

    <div class="grid items-start gap-4 lg:grid-cols-[minmax(0,1fr)_300px]">
      <div class="min-w-0">
        <Card class="p-4">
          {#if calendar}
            <CleanupCalendar
              days={calendar.days}
              {today}
              onPeek={(monthDay) => schedulePeek(monthDay)}
              onOpen={(monthDay) => void goto(Route.cleanupRewind({ monthDay }))}
            />
          {:else}
            <div class="aspect-31/12 w-full animate-pulse rounded-lg bg-gray-200 dark:bg-gray-700"></div>
          {/if}
        </Card>

        <!-- Card renders its children inside its own flex column, so the grid lives on an inner div. -->
        <Card class="mt-3" data-testid="cleanup-day-peek">
          <div class="grid items-center gap-4 p-3.5 sm:grid-cols-[auto_minmax(0,1fr)_auto]">
            <div class="min-w-0">
              <Text size="tiny" color="muted">{$t('cleanup_day_peek_hovering')}</Text>
              <Text class="text-lg/tight font-bold">{monthDayLabel(peekDay, lang)}</Text>
              <Text size="tiny" color="muted" class="tabular-nums">
                {#if peekLoaded}
                  {$t('cleanup_day_peek_summary', {
                    values: { photos: peekLoaded.photos, years: peekLoaded.years },
                  })}
                {:else}
                  <span class="inline-block h-3 w-24 animate-pulse rounded-sm bg-gray-200 align-middle dark:bg-gray-700"
                  ></span>
                {/if}
              </Text>
            </div>

            <div class="flex min-w-0 gap-1 overflow-hidden">
              {#if peekLoaded}
                {#each peekLoaded.assets as asset (asset.id)}
                  <CleanupTile
                    id={asset.id}
                    thumbhash={asset.thumbhash}
                    alt={asset.originalFileName}
                    class="w-14 shrink-0"
                  />
                {/each}
              {:else}
                {#each { length: 6 }, i (i)}
                  <div class="aspect-square w-14 shrink-0 animate-pulse rounded-md bg-gray-200 dark:bg-gray-700"></div>
                {/each}
              {/if}
            </div>

            <Button href={Route.cleanupRewind({ monthDay: peekDay })} size="small">
              {$t('cleanup_rewind_this_day')}
            </Button>
          </div>
        </Card>
      </div>

      <CleanupQueueRail {counts} {trash} {covers} onEmptyTrash={() => void onEmptyTrash()} />
    </div>
  </div>
</UserPageLayout>
