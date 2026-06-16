<script lang="ts">
  import type { TimelineGrouping } from '$lib/managers/timeline-manager/types';
  import { t, type Translations } from 'svelte-i18n';
  import { twMerge } from 'tailwind-merge';

  type TimelineGroupingControlVariant = 'inline' | 'floating';

  type Props = {
    grouping: TimelineGrouping;
    variant?: TimelineGroupingControlVariant;
    disabled?: boolean;
    class?: string;
    onGroupingChange: (grouping: TimelineGrouping) => void;
  };

  const modes: { grouping: TimelineGrouping; labelKey: Translations }[] = [
    { grouping: 'year', labelKey: 'timeline_grouping_years' },
    { grouping: 'month', labelKey: 'timeline_grouping_months' },
    { grouping: 'day', labelKey: 'timeline_grouping_all' },
  ];

  let { grouping, variant = 'inline', disabled = false, class: className = '', onGroupingChange }: Props = $props();

  const rootClass = $derived(
    twMerge(
      'inline-flex items-center gap-1 rounded-full bg-white/95 p-1 ring-1 ring-black/10 dark:bg-immich-dark-gray dark:ring-white/10',
      variant === 'floating' && 'shadow-xl',
      className,
    ),
  );

  const buttonClass =
    'rounded-full px-3 py-1 text-sm font-medium text-gray-600 transition hover:bg-gray-100 hover:text-gray-900 aria-pressed:bg-immich-primary aria-pressed:text-white disabled:cursor-not-allowed disabled:opacity-60 dark:text-gray-300 dark:hover:bg-gray-700 dark:hover:text-white';

  const getModeIndex = (mode: TimelineGrouping) => modes.findIndex((item) => item.grouping === mode);

  const selectGrouping = (nextGrouping: TimelineGrouping) => {
    if (disabled || nextGrouping === grouping) {
      return;
    }

    onGroupingChange(nextGrouping);
  };

  const onModeKeyDown = (event: KeyboardEvent) => {
    if (disabled || (event.key !== 'ArrowRight' && event.key !== 'ArrowLeft')) {
      return;
    }

    event.preventDefault();

    const direction = event.key === 'ArrowRight' ? 1 : -1;
    const nextIndex = (getModeIndex(grouping) + direction + modes.length) % modes.length;
    selectGrouping(modes[nextIndex].grouping);
  };
</script>

<div
  class={rootClass}
  data-testid="timeline-grouping-control"
  data-variant={variant}
  role="group"
  aria-label={$t('timeline_grouping_selector')}
>
  {#each modes as mode (mode.grouping)}
    <button
      class={buttonClass}
      type="button"
      data-testid={`timeline-grouping-${mode.grouping}`}
      aria-pressed={mode.grouping === grouping}
      {disabled}
      onclick={() => selectGrouping(mode.grouping)}
      onkeydown={onModeKeyDown}
    >
      {$t(mode.labelKey)}
    </button>
  {/each}
</div>
