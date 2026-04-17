<script lang="ts">
  import type { GlobalSearchManager, SearchMode } from '$lib/managers/global-search-manager.svelte';
  import ShortcutsModal from '$lib/modals/ShortcutsModal.svelte';
  import { Icon, modalManager } from '@immich/ui';
  import { mdiHelpCircleOutline } from '@mdi/js';
  import { t, type Translations } from 'svelte-i18n';

  interface Props {
    manager: GlobalSearchManager;
  }
  let { manager }: Props = $props();

  const options: Array<{ value: SearchMode; labelKey: Translations }> = [
    { value: 'smart', labelKey: 'cmdk_mode_smart' as Translations },
    { value: 'metadata', labelKey: 'cmdk_mode_filename' as Translations },
    { value: 'description', labelKey: 'cmdk_mode_description' as Translations },
    { value: 'ocr', labelKey: 'cmdk_mode_ocr' as Translations },
  ];

  // Sliding pill indicator — tracks the currently selected label's bounding box
  // so the pill actually moves (per design spec line 409: "Selected pill slides
  // between positions" over 180 ms ease-out). Color-only transitions look static.
  const labelRefs: HTMLLabelElement[] = $state([]);
  let pillLeft = $state(0);
  let pillWidth = $state(0);
  let pillReady = $state(false);

  // Under a prefix scope the mode pills are informational — setMode is a no-op
  // (see GlobalSearchManager.setMode's `scope !== 'all'` short-circuit). Visually
  // communicate this with a 50 % opacity dim. Intentionally NO aria-disabled: the
  // radios stay focusable and keyboard-reachable so users can still cycle the
  // pending mode for when they clear the prefix.
  const isScoped = $derived(manager.scope !== 'all');

  // Shared class for footer kbd chips. Extracted so both kbd tags fit on a
  // single line — otherwise prettier breaks `</kbd\n>` across lines, which
  // causes Svelte to merge adjacent text nodes into the kbd. A cosmetic but
  // test-visible bug.
  const kbdClass = 'rounded-sm border border-gray-200 bg-subtle/60 px-1.5 py-0.5 dark:border-gray-700';

  $effect(() => {
    const idx = options.findIndex((o) => o.value === manager.mode);
    const el = labelRefs[idx];
    if (el) {
      pillLeft = el.offsetLeft;
      pillWidth = el.offsetWidth;
      pillReady = true;
    }
  });
</script>

<div class="flex items-center justify-between border-t border-gray-200 px-4 py-2 dark:border-gray-700">
  <div
    role="radiogroup"
    aria-label={$t('cmdk_search_mode')}
    class="relative flex gap-0 rounded-md bg-subtle/40 p-0.5 font-mono text-[11px] font-medium uppercase {isScoped
      ? 'opacity-50'
      : ''}"
  >
    {#if pillReady}
      <div
        aria-hidden="true"
        class="absolute top-0.5 bottom-0.5 rounded-sm bg-primary/10 transition-all duration-[180ms] ease-out"
        style:left="{pillLeft}px"
        style:width="{pillWidth}px"
      ></div>
    {/if}
    {#each options as opt, idx (opt.value)}
      <label class="relative" bind:this={labelRefs[idx]}>
        <input
          type="radio"
          name="cmdk-mode"
          value={opt.value}
          checked={manager.mode === opt.value}
          onchange={() => manager.setMode(opt.value)}
          class="sr-only"
        />
        <span
          class="block cursor-pointer rounded-sm px-2.5 py-1 tabular-nums transition-colors duration-[180ms] ease-out {manager.mode ===
          opt.value
            ? 'text-primary'
            : 'text-gray-500 dark:text-gray-400'}"
        >
          {$t(opt.labelKey)}
        </span>
      </label>
    {/each}
  </div>

  <div class="flex items-center gap-4 font-mono text-[11px] text-gray-500 dark:text-gray-400">
    <span class="flex items-center gap-1.5">
      <kbd class={kbdClass}>Ctrl+/</kbd>
      <span>{$t('cmdk_cycle_mode_hint')}</span>
    </span>
    <span class="flex items-center gap-1.5">
      <kbd class={kbdClass}>{$t('cmdk_scope_hint_footer')}</kbd>
      <span>{$t('cmdk_scope_hint_footer_label')}</span>
    </span>
    <button
      data-cmdk-shortcuts-trigger
      type="button"
      aria-label={$t('cmdk_show_shortcuts')}
      title={$t('cmdk_show_shortcuts')}
      onclick={() => void modalManager.show(ShortcutsModal, {})}
      class="hidden h-5 w-5 items-center justify-center rounded-full text-gray-500 hover:bg-white/5 hover:text-gray-300 sm:flex"
    >
      <Icon icon={mdiHelpCircleOutline} size="1em" aria-hidden />
    </button>
  </div>
</div>
