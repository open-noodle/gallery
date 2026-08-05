<script lang="ts">
  import { clickOutside } from '$lib/actions/click-outside';
  import { mediaQueryManager } from '$lib/stores/media-query-manager.svelte';
  import { Icon } from '@immich/ui';
  import { mdiCheck, mdiCog } from '@mdi/js';
  import { t } from 'svelte-i18n';
  import { slide } from 'svelte/transition';
  import type { FilterSection } from './filter-panel';
  import { slideMotion } from './motion';

  interface Props {
    sections: FilterSection[];
    visible: Set<FilterSection>;
    titles: Record<string, string>;
    toggleLabels: Record<string, string>;
    hasActiveFilter: (section: FilterSection) => boolean;
    onToggle: (section: FilterSection) => void;
    onShowAll: () => void;
    open?: boolean;
  }

  let {
    sections,
    visible,
    titles,
    toggleLabels,
    hasActiveFilter,
    onToggle,
    onShowAll,
    open = $bindable(false),
  }: Props = $props();

  let trigger = $state<HTMLButtonElement>();

  const MENU_ID = 'filter-section-menu';

  // One predicate, both cues: a section is "filtering out of sight" when it is hidden and still
  // holds a value. The row marker is the per-section answer, the cog dot the aggregate - deriving
  // them separately is how the two drift apart.
  const isHiddenAndFiltering = (section: FilterSection) => !visible.has(section) && hasActiveFilter(section);
  const anyHiddenAndFiltering = $derived(sections.some((section) => isHiddenAndFiltering(section)));

  // Escape dismisses and hands focus back; an outside click leaves focus wherever the user put it.
  const closeAndRefocus = () => {
    open = false;
    trigger?.focus();
  };
</script>

<!--
  clickOutside goes on this wrapper, enclosing BOTH the cog and the popover, not on the popover
  alone. The action binds keydown to its own node rather than the document, so on the popover alone
  Escape would be dead whenever focus sat on the trigger. It also early-returns from onOutclick for
  clicks inside the node, which is why a second cog click closes via the button's own handler below
  and there is no double-handling to guard against.
-->
<div class="relative" use:clickOutside={{ onOutclick: () => (open = false), onEscape: closeAndRefocus }}>
  <button
    type="button"
    bind:this={trigger}
    class="relative flex size-6 items-center justify-center rounded-full text-gray-500 hover:bg-subtle dark:text-gray-400"
    onclick={() => (open = !open)}
    aria-expanded={open}
    aria-controls={MENU_ID}
    aria-label={$t('filter_manage_sections')}
    title={$t('filter_manage_sections')}
    data-testid="section-menu-btn"
  >
    <Icon icon={mdiCog} size="16" />
    {#if anyHiddenAndFiltering}
      <span
        class="absolute -inset-e-0.5 -top-0.5 size-2 rounded-full border-[1.5px] border-light bg-immich-primary dark:bg-immich-dark-primary"
        data-testid="section-menu-dot"
      ></span>
    {/if}
  </button>

  {#if open}
    <!-- Anchored with logical inset so the popover lands correctly in both writing directions. It
         renders inside the header, which is sticky, because the panel body is overflow-y-auto and
         would clip anything absolutely positioned within it. z-10 clears the header's own z-5. -->
    <div
      id={MENU_ID}
      class="absolute inset-s-0 top-full z-10 mt-1 w-56 rounded-lg border border-gray-200 bg-light py-1 shadow-lg dark:border-gray-700"
      data-testid="section-menu"
      transition:slide|local={slideMotion(mediaQueryManager.reducedMotion)}
    >
      {#each sections as section (section)}
        <button
          type="button"
          class="flex w-full items-center gap-2 px-3 py-1.5 text-sm hover:bg-subtle"
          onclick={() => onToggle(section)}
          aria-pressed={visible.has(section)}
          aria-label={toggleLabels[section]}
          data-testid="section-toggle-{section}"
        >
          <span class="flex size-4 shrink-0 items-center justify-center text-primary">
            {#if visible.has(section)}
              <Icon icon={mdiCheck} size="14" />
            {/if}
          </span>
          <span class="flex-1 truncate text-start">{titles[section]}</span>
          {#if isHiddenAndFiltering(section)}
            <span
              class="size-2 shrink-0 rounded-full bg-immich-primary dark:bg-immich-dark-primary"
              data-testid="section-toggle-dot-{section}"
            ></span>
          {/if}
        </button>
      {/each}

      <div class="my-1 border-t border-gray-200 dark:border-gray-700"></div>

      <button
        type="button"
        class="w-full px-3 py-1.5 text-start text-sm font-medium text-primary hover:bg-subtle"
        onclick={onShowAll}
        data-testid="section-menu-show-all"
      >
        {$t('filter_show_all_sections')}
      </button>
    </div>
  {/if}
</div>
