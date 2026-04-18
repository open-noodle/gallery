<script lang="ts">
  import { Icon } from '@immich/ui';
  import { t } from 'svelte-i18n';
  import type { CommandItem } from '$lib/managers/command-items';
  import type { Translations } from 'svelte-i18n';

  interface Props {
    item: CommandItem;
  }
  let { item }: Props = $props();
</script>

<div
  class="flex h-[52px] items-center gap-3 rounded-lg px-3 py-2 transition-colors duration-[80ms] ease-out group-data-[selected]:bg-primary/10"
>
  <div class="flex h-8 w-8 items-center justify-center rounded-md bg-subtle/40">
    <Icon icon={item.icon} size="1.125em" class="text-gray-500 dark:text-gray-400" />
  </div>
  <div class="min-w-0 flex-1">
    <div class="truncate text-sm font-medium">{$t(item.labelKey as Translations)}</div>
    <div class="truncate text-xs text-gray-500 dark:text-gray-400">
      {$t(item.descriptionKey as Translations)}
    </div>
  </div>
</div>
