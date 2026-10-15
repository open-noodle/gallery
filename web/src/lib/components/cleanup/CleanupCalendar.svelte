<script lang="ts">
  import { monthDayLabel, shadeLevel, shadeScale } from '$lib/utils/cleanup';
  import type { CleanupCalendarDayDto } from '@immich/sdk';
  import { Text } from '@immich/ui';
  import { locale, t } from 'svelte-i18n';

  type Props = {
    days: CleanupCalendarDayDto[];
    today: number;
    onPeek: (monthDay: number) => void;
    onOpen: (monthDay: number) => void;
  };

  let { days, today, onPeek, onOpen }: Props = $props();

  type CellState = 'none' | 'l1' | 'l2' | 'l3' | 'l4' | 'reviewed';

  const DAY_NUMBERS = Array.from({ length: 31 }, (_, i) => i + 1);
  const LABELLED_DAY_NUMBERS = new Set([1, 5, 10, 15, 20, 25, 30]);
  // 2000 is a leap year, so February has its 29th.
  const MONTHS = Array.from({ length: 12 }, (_, i) => ({
    month: i + 1,
    length: new Date(2000, i + 1, 0).getDate(),
  }));

  const stateClasses: Record<CellState, string> = {
    none: 'bg-gray-200 dark:bg-gray-700',
    l1: 'bg-primary/35',
    l2: 'bg-primary/55',
    l3: 'bg-primary/75',
    l4: 'bg-primary',
    reviewed: 'bg-green-500',
  };
  // A reviewed day with few photos reads lighter, as in the mockup.
  const REVIEWED_LIGHT_CLASS = 'bg-green-500/55';

  const lang = $derived($locale ?? 'en');
  const byMonthDay = $derived(new Map(days.map((day) => [day.monthDay, day])));
  const scale = $derived(shadeScale(days.map((day) => day.assetCount)));
  const monthFormatter = $derived(new Intl.DateTimeFormat(lang, { month: 'short' }));

  // A day without photos has nothing to review, so it never shows as reviewed.
  const isReviewed = (day: CleanupCalendarDayDto | undefined) => !!day?.reviewedAt && day.assetCount > 0;

  const cellState = (day: CleanupCalendarDayDto | undefined): CellState => {
    const level = shadeLevel(day?.assetCount ?? 0, scale);
    if (level === 0) {
      return 'none';
    }
    return isReviewed(day) ? 'reviewed' : `l${level}`;
  };

  const cellClass = (day: CleanupCalendarDayDto | undefined, state: CellState) =>
    state === 'reviewed' && shadeLevel(day?.assetCount ?? 0, scale) <= 2 ? REVIEWED_LIGHT_CLASS : stateClasses[state];

  const cellLabel = (monthDay: number, day: CleanupCalendarDayDto | undefined) =>
    $t(isReviewed(day) ? 'cleanup_calendar_day_label_reviewed' : 'cleanup_calendar_day_label', {
      values: { date: monthDayLabel(monthDay, lang), count: day?.assetCount ?? 0 },
    });
</script>

<div class="overflow-x-auto">
  <div class="grid min-w-[640px] grid-cols-[2.5rem_repeat(31,minmax(1rem,1fr))] gap-1" data-testid="cleanup-calendar">
    <span aria-hidden="true"></span>
    {#each DAY_NUMBERS as dayNumber (dayNumber)}
      <span class="text-center text-[9px] text-gray-400 tabular-nums dark:text-gray-500" aria-hidden="true">
        {LABELLED_DAY_NUMBERS.has(dayNumber) ? dayNumber : ''}
      </span>
    {/each}

    {#each MONTHS as { month, length } (month)}
      <Text size="tiny" color="muted" class="self-center">
        {monthFormatter.format(new Date(2000, month - 1, 1))}
      </Text>
      {#each DAY_NUMBERS as dayNumber (dayNumber)}
        {#if dayNumber <= length}
          {@const monthDay = month * 100 + dayNumber}
          {@const day = byMonthDay.get(monthDay)}
          {@const state = cellState(day)}
          <button
            type="button"
            data-testid="cleanup-cal-{monthDay}"
            data-state={state}
            data-today={monthDay === today ? 'true' : undefined}
            aria-label={cellLabel(monthDay, day)}
            class="aspect-square rounded-sm transition-transform hover:scale-125 focus-visible:scale-125 focus-visible:outline-2 focus-visible:outline-primary {cellClass(
              day,
              state,
            )} {monthDay === today ? 'outline-2 outline-offset-1 outline-dark dark:outline-light' : ''}"
            onmouseenter={() => onPeek(monthDay)}
            onfocus={() => onPeek(monthDay)}
            onclick={() => onOpen(monthDay)}
          ></button>
        {:else}
          <span class="aspect-square" data-testid="cleanup-cal-spacer" aria-hidden="true"></span>
        {/if}
      {/each}
    {/each}
  </div>
</div>

<div class="mt-3 flex flex-wrap items-center gap-x-4 gap-y-2 text-xs text-gray-500 dark:text-gray-400">
  <span class="flex items-center gap-1.5">
    <i class="inline-block size-3 rounded-sm bg-gray-200 dark:bg-gray-700"></i>{$t('cleanup_legend_no_photos')}
  </span>
  <span class="flex items-center gap-1.5">
    <span class="flex gap-0.5">
      <i class="inline-block size-3 rounded-sm bg-primary/35"></i>
      <i class="inline-block size-3 rounded-sm bg-primary/55"></i>
      <i class="inline-block size-3 rounded-sm bg-primary/75"></i>
      <i class="inline-block size-3 rounded-sm bg-primary"></i>
    </span>
    {$t('cleanup_legend_to_review')}
  </span>
  <span class="flex items-center gap-1.5">
    <i class="inline-block size-3 rounded-sm bg-green-500"></i>{$t('cleanup_legend_reviewed')}
  </span>
  <span class="flex items-center gap-1.5">
    <i
      class="inline-block size-3 rounded-sm bg-gray-200 outline-2 outline-offset-1 outline-dark dark:bg-gray-700 dark:outline-light"
    ></i>{$t('cleanup_legend_today')}
  </span>
</div>
