<script lang="ts">
  import ShortcutsModal from '$lib/modals/ShortcutsModal.svelte';
  import { Icon, modalManager } from '@immich/ui';
  import { mdiHelpCircleOutline } from '@mdi/js';
  import { t } from 'svelte-i18n';

  // Shared class for footer kbd chips. Extracted so the kbd tag fits on a single
  // line — otherwise prettier breaks `</kbd\n>` across lines, which causes Svelte
  // to merge adjacent text nodes into the kbd. A cosmetic but test-visible bug.
  const kbdClass = 'rounded-sm border border-gray-200 bg-subtle/60 px-1.5 py-0.5 dark:border-gray-700';
</script>

<!-- The search-mode segmented control used to live here. It moved to `SearchModeControl`,
     which renders as a rail under the palette input and as a chip inside the inline search
     field, so the mode is reachable by touch and visible without opening the footer. The
     `Ctrl+/` hint went with it: the control is on screen now, and dropping both items stops
     this `justify-between` row from overflowing on a phone. -->
<div class="flex items-center justify-end border-t border-gray-200 px-4 py-2 dark:border-gray-700">
  <div class="flex items-center gap-4 font-mono text-[11px] text-gray-500 dark:text-gray-400">
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
      class="hidden size-5 items-center justify-center rounded-full text-gray-500 hover:bg-white/5 hover:text-gray-300 sm:flex"
    >
      <Icon icon={mdiHelpCircleOutline} size="1em" aria-hidden />
    </button>
  </div>
</div>
