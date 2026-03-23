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
    <div class="mb-2 flex items-center gap-1 text-xs text-gray-500 dark:text-gray-300">
      <button
        type="button"
        class="font-medium text-immich-primary hover:underline dark:text-immich-dark-primary"
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
          class="flex flex-col items-center rounded-lg border border-gray-200 px-2 py-2 transition-all duration-100 dark:border-gray-700
            {m.count === 0
            ? 'cursor-default opacity-30'
            : 'cursor-pointer hover:border-immich-primary hover:bg-immich-primary/5 dark:hover:border-immich-dark-primary dark:hover:bg-immich-dark-primary/5'}"
          onclick={() => handleMonthClick(selectedYear!, m.month, m.count)}
          data-testid="month-btn-{m.month}"
        >
          <span class="text-xs font-semibold">{m.label}</span>
          <span class="text-xs text-gray-400 dark:text-gray-500">{m.count}</span>
          <div class="mt-1 h-[3px] w-full overflow-hidden rounded-sm bg-gray-200 dark:bg-gray-700">
            <div
              class="h-full rounded-sm bg-immich-primary transition-[width] duration-300 dark:bg-immich-dark-primary"
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
          class="year-chip flex min-w-[54px] flex-1 basis-[calc(25%-5px)] flex-col items-center rounded-lg border border-gray-200 px-2 py-1.5 transition-all duration-100 dark:border-gray-700
            {y.count === 0
            ? 'cursor-default opacity-30'
            : 'cursor-pointer hover:border-immich-primary hover:bg-immich-primary/5 dark:hover:border-immich-dark-primary dark:hover:bg-immich-dark-primary/5'}"
          onclick={() => handleYearClick(y.year, y.count)}
          data-testid="year-btn-{y.year}"
        >
          <span class="text-xs font-semibold leading-tight">{y.year}</span>
          <span class="text-xs leading-tight text-gray-400 opacity-60 dark:text-gray-500">{y.count}</span>
          <div class="mt-0.5 h-[2px] w-full overflow-hidden rounded-sm bg-gray-200 dark:bg-gray-700">
            <div
              class="h-full rounded-sm bg-immich-primary transition-[width] duration-300 dark:bg-immich-dark-primary"
              style="width: {y.volumePercent}%"
            ></div>
          </div>
        </button>
      {/each}
    </div>
  {/if}
</div>
