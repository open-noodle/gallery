<script lang="ts">
  import { Icon } from '@immich/ui';
  import { t } from 'svelte-i18n';
  import type { CommandItem } from '$lib/managers/command-items';
  import type { Translations } from 'svelte-i18n';

  interface Props {
    item: CommandItem;
    /** True while this row is awaiting the second Enter of a destructive confirm. */
    pending?: boolean;
  }
  let { item, pending = false }: Props = $props();
</script>

<div
  class="flex h-[52px] items-center gap-3 rounded-lg px-3 py-2 transition-colors duration-[80ms] ease-out {pending
    ? 'bg-danger/10 ring-1 ring-inset ring-danger/40'
    : 'group-data-[selected]:bg-primary/10'}"
>
  <div class="flex h-8 w-8 items-center justify-center rounded-md {pending ? 'bg-danger/15' : 'bg-subtle/40'}">
    <Icon icon={item.icon} size="1.125em" class={pending ? 'text-danger' : 'text-gray-500 dark:text-gray-400'} />
  </div>
  <div class="min-w-0 flex-1">
    <div class="truncate text-sm font-medium">{$t(item.labelKey as Translations)}</div>
    {#if pending}
      <div class="truncate text-xs font-medium text-danger">{$t('cmdk_cmd_confirm_hint')}</div>
    {:else}
      <div class="truncate text-xs text-gray-500 dark:text-gray-400">
        {$t(item.descriptionKey as Translations)}
      </div>
    {/if}
  </div>
</div>
