<script lang="ts">
  import PillGroup from '$lib/gallery/pill-group/PillGroup.svelte';
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
</script>

<PillGroup
  class={twMerge(variant === 'floating' && 'shadow-xl', className)}
  data-testid="timeline-grouping-control"
  data-variant={variant}
  label={$t('timeline_grouping_selector')}
  options={modes.map((mode) => ({
    value: mode.grouping,
    label: $t(mode.labelKey),
    testId: `timeline-grouping-${mode.grouping}`,
  }))}
  value={grouping}
  {disabled}
  onChange={onGroupingChange}
/>
