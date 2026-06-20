<script lang="ts">
  import { SCROLL_PROPERTIES } from '$lib/components/shared-components/album-selection/album-selection-utils';
  import { isValidNewSpaceName } from '$lib/components/shared-components/collection-selection/collection-selection-utils';
  import { Icon } from '@immich/ui';
  import { mdiPlus } from '@mdi/js';
  import type { Action } from 'svelte/action';
  import { t } from 'svelte-i18n';

  interface Props {
    searchQuery?: string;
    selected: boolean;
    onNewSpace: (name: string) => void;
  }

  let { searchQuery = '', selected = false, onNewSpace }: Props = $props();

  const disabled = $derived(!isValidNewSpaceName(searchQuery));
  const trimmed = $derived(searchQuery.trim());

  const scrollIntoViewIfSelected: Action = (node) => {
    $effect(() => {
      if (selected) {
        node.scrollIntoView(SCROLL_PROPERTIES);
      }
    });
  };
</script>

<button
  type="button"
  {disabled}
  title={disabled ? $t('new_space_requires_name') : undefined}
  onclick={() => {
    if (!disabled) {
      onNewSpace(trimmed);
    }
  }}
  use:scrollIntoViewIfSelected
  class="flex w-full items-center gap-4 px-6 py-2 rounded-xl transition-colors disabled:opacity-40 disabled:cursor-not-allowed enabled:hover:bg-gray-200 dark:enabled:hover:bg-gray-700"
  class:bg-gray-200={selected && !disabled}
  class:dark:bg-gray-700={selected && !disabled}
  data-testid="new-space-row"
>
  <div class="flex h-12 w-12 items-center justify-center">
    <Icon icon={mdiPlus} size="30" />
  </div>
  <p>
    {$t('new_space')}
    {#if trimmed.length > 0}<b>{trimmed}</b>{/if}
  </p>
</button>
