<script lang="ts">
  import type { GlobalSearchManager, SearchMode } from '$lib/managers/global-search-manager.svelte';
  import { t } from 'svelte-i18n';

  interface Props {
    manager: GlobalSearchManager;
  }
  let { manager }: Props = $props();

  const options: Array<{ value: SearchMode; labelKey: string }> = [
    { value: 'smart', labelKey: 'cmdk_mode_smart' },
    { value: 'metadata', labelKey: 'cmdk_mode_filename' },
    { value: 'description', labelKey: 'cmdk_mode_description' },
    { value: 'ocr', labelKey: 'cmdk_mode_ocr' },
  ];
</script>

<div class="flex items-center justify-between border-t border-gray-200 px-4 py-2 dark:border-gray-700">
  <div
    role="radiogroup"
    aria-label={$t('cmdk_search_mode')}
    class="flex gap-0 rounded-md bg-subtle/40 p-0.5 font-mono text-[11px] font-medium uppercase"
  >
    {#each options as opt (opt.value)}
      <label class="relative">
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
            ? 'bg-primary/10 text-primary'
            : 'text-gray-500 dark:text-gray-400'}"
        >
          {$t(opt.labelKey)}
        </span>
      </label>
    {/each}
  </div>

  <span class="font-mono text-[11px] text-gray-500 dark:text-gray-400">
    <kbd class="rounded-sm border border-gray-200 bg-subtle/60 px-1.5 py-0.5 dark:border-gray-700">Ctrl+/</kbd>
    <span class="ml-1">{$t('cmdk_cycle_mode_hint')}</span>
  </span>
</div>
