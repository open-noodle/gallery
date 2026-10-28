<script lang="ts">
  import { pop } from '$lib/gallery/motion';
  import { monthDayLabel, shadeLevel, shadeScale } from '$lib/utils/cleanup';
  import type { CleanupCalendarDayDto } from '@immich/sdk';
  import { Text } from '@immich/ui';
  import { locale, t } from 'svelte-i18n';

  type Props = {
    days: CleanupCalendarDayDto[];
    today: number;
    /** A day the user just finished in rewind: its cell turns green with a pop. */
    justReviewed?: number;
    onPeek: (monthDay: number) => void;
    /** The pointer or keyboard focus left the calendar. */
    onLeave: () => void;
    onOpen: (monthDay: number) => void;
  };

  let { days, today, justReviewed, onPeek, onLeave, onOpen }: Props = $props();
  let container = $state<HTMLElement>();

  type CellState = 'none' | 'l1' | 'l2' | 'l3' | 'l4' | 'reviewed';

  // 2000 is a leap year, so February has its 29th.
  const MONTHS = Array.from({ length: 12 }, (_, i) => ({
    month: i + 1,
    days: Array.from({ length: new Date(2000, i + 1, 0).getDate() }, (_, day) => day + 1),
  }));
  const currentMonth = $derived(Math.floor(today / 100));

  $effect(() => {
    const cell =
      justReviewed && container?.querySelector(`[data-testid="cleanup-cal-${CSS.escape(String(justReviewed))}"]`);
    if (cell) {
      pop(cell);
    }
  });

  const onFocusOut = (event: FocusEvent) => {
    if (!(event.relatedTarget instanceof Node && container?.contains(event.relatedTarget))) {
      onLeave();
    }
  };

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

<!-- A cell is a date across every year, so the days run from the 1st in rows of seven and never line up
     under weekdays. Cells keep out of the site-wide press/hover scale (data-no-press): hover brightens them
     and rings them instead, since the scale fought their own and left smeared traces. -->
<div class="mb-3 flex flex-wrap items-baseline justify-between gap-2">
  <Text fontWeight="semi-bold">{$t('cleanup_your_year')}</Text>
  <Text size="tiny" color="muted">{$t('cleanup_your_year_hint')}</Text>
</div>
<div
  bind:this={container}
  class="grid grid-cols-3 gap-x-3 gap-y-4 sm:grid-cols-6 lg:grid-cols-12"
  data-testid="cleanup-calendar"
  role="group"
  aria-label={$t('cleanup_your_year')}
  onpointerleave={() => onLeave()}
  onfocusout={onFocusOut}
>
  {#each MONTHS as { month, days: monthDays } (month)}
    {@const isCurrent = month === currentMonth}
    <div data-testid="cleanup-month-{month}" data-current={isCurrent ? 'true' : undefined}>
      <Text size="tiny" class="mb-1.5 {isCurrent ? 'font-semibold text-dark' : 'text-muted'}">
        {monthFormatter.format(new Date(2000, month - 1, 1))}
      </Text>
      <div class="grid grid-cols-7 gap-0.5" data-testid="cleanup-month-days">
        {#each monthDays as dayNumber (dayNumber)}
          {@const monthDay = month * 100 + dayNumber}
          {@const day = byMonthDay.get(monthDay)}
          {@const state = cellState(day)}
          <button
            type="button"
            data-testid="cleanup-cal-{monthDay}"
            data-state={state}
            data-today={monthDay === today ? 'true' : undefined}
            data-no-press
            aria-label={cellLabel(monthDay, day)}
            class="aspect-square rounded-[3px] transition-[filter,box-shadow] duration-(--motion-quick) ease-(--ease-standard) hover:ring-2 hover:ring-primary/60 hover:brightness-125 focus-visible:ring-2 focus-visible:ring-primary focus-visible:outline-none {cellClass(
              day,
              state,
            )} {monthDay === today
              ? 'outline-2 outline-offset-1 outline-dark motion-safe:animate-[gallery-pop_var(--spring-bouncy-duration)_var(--spring-bouncy)] dark:outline-light'
              : ''}"
            onmouseenter={() => onPeek(monthDay)}
            onfocus={() => onPeek(monthDay)}
            onclick={() => onOpen(monthDay)}
          ></button>
        {/each}
      </div>
    </div>
  {/each}
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
