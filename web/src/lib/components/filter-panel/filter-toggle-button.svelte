<script lang="ts">
  import { Icon } from '@immich/ui';
  import { mdiTune } from '@mdi/js';
  import { t } from 'svelte-i18n';

  interface Props {
    // Whether any filter is active — shown as a dot on the button.
    active?: boolean;
    onExpand: () => void;
  }

  let { active = false, onExpand }: Props = $props();
</script>

<button
  type="button"
  class="relative flex size-9 shrink-0 items-center justify-center rounded-lg text-gray-500 hover:bg-subtle dark:text-gray-400"
  onclick={onExpand}
  data-testid="filter-toggle-btn"
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
