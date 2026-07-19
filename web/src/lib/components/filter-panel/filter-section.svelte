<script lang="ts">
  import { mediaQueryManager } from '$lib/stores/media-query-manager.svelte';
  import { Icon } from '@immich/ui';
  import { mdiChevronDown } from '@mdi/js';
  import type { Snippet } from 'svelte';
  import { slide } from 'svelte/transition';
  import { slideMotion } from './motion';

  interface Props {
    title: string;
    testId: string;
    children: Snippet;
    refetching?: boolean;
    count?: number;
    expanded?: boolean;
    onToggleExpanded?: () => void;
  }

  let { title, testId, children, refetching = false, count, expanded = true, onToggleExpanded }: Props = $props();

  let isEmpty = $derived(count === 0);
  let isOpen = $derived(expanded && !isEmpty);
</script>

<div class="mx-1.5 mb-0.5" data-testid="filter-section-{testId}">
  <button
    type="button"
    class="flex w-full items-center justify-between rounded-xl px-3 py-2.5 text-start hover:bg-subtle {isEmpty
      ? 'opacity-50'
      : ''}"
    onclick={() => {
      if (!isEmpty && onToggleExpanded) {
        onToggleExpanded();
      }
    }}
    disabled={isEmpty}
  >
    <span class="text-sm font-medium">
      {title}{isEmpty ? ' (0)' : ''}
    </span>
    {#if !isEmpty}
      <Icon
        icon={mdiChevronDown}
        size="16"
        class="text-gray-500 transition-transform duration-150 ease-[cubic-bezier(0.22,1,0.36,1)] motion-reduce:transition-none dark:text-gray-400 {expanded
          ? ''
          : '-rotate-90'}"
      />
    {/if}
  </button>
  {#if isOpen}
    <div transition:slide|local={slideMotion(mediaQueryManager.reducedMotion)}>
      <div class="filter-section-content px-3 pt-2 pb-3.5" class:refetching>
        {@render children()}
      </div>
    </div>
  {/if}
</div>

<style>
  .filter-section-content {
    transition: opacity 0.2s ease 150ms;
  }
  .filter-section-content.refetching {
    opacity: 0.5;
  }
</style>
