<script lang="ts">
  import { Icon } from '@immich/ui';
  import { mdiChevronDown } from '@mdi/js';
  import type { Snippet } from 'svelte';

  interface Props {
    title: string;
    testId: string;
    children: Snippet;
  }

  let { title, testId, children }: Props = $props();
  let expanded = $state(true);
</script>

<div class="border-b border-[var(--border)]" data-testid="filter-section-{testId}">
  <button
    type="button"
    class="flex w-full items-center justify-between px-3 py-2.5 hover:bg-[var(--primary-soft)]"
    onclick={() => (expanded = !expanded)}
  >
    <span class="text-[10px] font-bold uppercase tracking-[0.7px] text-[var(--fg-muted)]">
      {title}
    </span>
    <Icon
      icon={mdiChevronDown}
      size="14"
      class="text-[var(--fg-faint)] transition-transform {expanded ? '' : '-rotate-90'}"
    />
  </button>
  {#if expanded}
    <div class="px-3 pb-2.5">
      {@render children()}
    </div>
  {/if}
</div>
