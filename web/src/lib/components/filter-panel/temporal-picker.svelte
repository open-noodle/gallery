<script lang="ts">
  import { aggregateYears, getMonthsForYear } from './temporal-utils';
  interface Props {
    timeBuckets: Array<{ timeBucket: string; count: number }>;
    onYearSelect?: (year: number) => void;
    onMonthSelect?: (year: number, month: number) => void;
  }

  let { timeBuckets, onYearSelect, onMonthSelect }: Props = $props();

  let selectedYear = $state<number | undefined>(undefined);
  let years = $derived(aggregateYears(timeBuckets));
  let months = $derived(selectedYear === undefined ? [] : getMonthsForYear(timeBuckets, selectedYear));

  function handleYearClick(year: number, count: number) {
    if (count === 0) {
      return;
    }
    selectedYear = year;
    onYearSelect?.(year);
  }

  function handleMonthClick(year: number, month: number, count: number) {
    if (count === 0) {
      return;
    }
    onMonthSelect?.(year, month);
  }

  function handleBackToAll() {
    selectedYear = undefined;
  }
</script>

<div data-testid="temporal-picker">
  {#if selectedYear !== undefined}
    <!-- Breadcrumb -->
    <div class="mb-2 flex items-center gap-1 text-[11px] text-[var(--fg-muted)]">
      <button
        type="button"
        class="font-medium text-[var(--primary)] hover:underline"
        onclick={handleBackToAll}
        data-testid="temporal-breadcrumb-all"
      >
        All
      </button>
      <span class="opacity-50">/</span>
      <span class="font-semibold">{selectedYear}</span>
    </div>

    <!-- Month grid: 4-column CSS grid -->
    <div class="grid grid-cols-4 gap-1.5" data-testid="month-grid">
      {#each months as m (m.month)}
        {@const maxMonthCount = Math.max(...months.map((mo) => mo.count), 1)}
        {@const monthVolume = Math.round((m.count / maxMonthCount) * 100)}
        <button
          type="button"
          class="flex flex-col items-center rounded-lg border border-[var(--border)] px-2 py-2 transition-all duration-100
            {m.count === 0
            ? 'cursor-default opacity-30'
            : 'cursor-pointer hover:border-[var(--primary)] hover:bg-[var(--primary)]/5'}"
          onclick={() => handleMonthClick(selectedYear!, m.month, m.count)}
          data-testid="month-btn-{m.month}"
        >
          <span class="text-[13px] font-semibold">{m.label}</span>
          <span class="text-[11px] text-[var(--fg-muted)]">{m.count}</span>
          <div class="mt-1 h-[3px] w-full overflow-hidden rounded-sm bg-[var(--border)]">
            <div
              class="h-full rounded-sm bg-[var(--primary)] transition-[width] duration-300"
              style="width: {m.count === 0 ? 0 : monthVolume}%"
            ></div>
          </div>
        </button>
      {/each}
    </div>
  {:else}
    <!-- Year grid: 4-column flex wrap -->
    <div class="flex flex-wrap gap-1.5" data-testid="year-grid">
      {#each years as y (y.year)}
        <button
          type="button"
          class="year-chip flex min-w-[54px] flex-1 basis-[calc(25%-5px)] flex-col items-center rounded-lg border border-[var(--border)] px-2 py-1.5 transition-all duration-100
            {y.count === 0
            ? 'cursor-default opacity-30'
            : 'cursor-pointer hover:border-[var(--primary)] hover:bg-[var(--primary)]/5'}"
          onclick={() => handleYearClick(y.year, y.count)}
          data-testid="year-btn-{y.year}"
        >
          <span class="text-[10px] font-semibold leading-tight">{y.year}</span>
          <span class="text-[8px] leading-tight text-[var(--fg-muted)] opacity-60">{y.count}</span>
          <div class="mt-0.5 h-[2px] w-full overflow-hidden rounded-sm bg-[var(--border)]">
            <div
              class="h-full rounded-sm bg-[var(--primary)] transition-[width] duration-300"
              style="width: {y.volumePercent}%"
            ></div>
          </div>
        </button>
      {/each}
    </div>
  {/if}
</div>
