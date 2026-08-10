<script lang="ts">
  import { Icon } from '@immich/ui';
  import { mdiTune } from '@mdi/js';
  import { t } from 'svelte-i18n';

  interface Props {
    // Whether any filter is active — shown as a dot on the button.
    active?: boolean;
    onExpand: () => void;
    // Overridable so a page can keep its own selector; the map's mobile drawer toggle is a
    // separate control from the desktop header toggle and the two are asserted on separately.
    testId?: string;
  }

  let { active = false, onExpand, testId = 'filter-toggle-btn' }: Props = $props();
</script>

<button
  type="button"
  class="relative flex size-9 shrink-0 items-center justify-center rounded-lg text-gray-500 hover:bg-subtle dark:text-gray-400"
  onclick={onExpand}
  data-testid={testId}
  aria-label={$t('filters')}
  title={$t('filters')}
>
  <Icon icon={mdiTune} size="20" />
  {#if active}
    <span
      class="absolute -top-0.5 -right-0.5 size-2 rounded-full border-[1.5px] border-light bg-immich-primary dark:bg-immich-dark-primary"
    ></span>
  {/if}
</button>
