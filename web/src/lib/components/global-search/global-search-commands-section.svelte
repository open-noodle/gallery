<script lang="ts">
  import type { CommandItem } from '$lib/managers/command-items';
  import { globalSearchManager as manager, type ProviderStatus } from '$lib/managers/global-search-manager.svelte';
  import { Command } from 'bits-ui';
  import { t } from 'svelte-i18n';
  import { fade } from 'svelte/transition';
  import CommandRow from './rows/command-row.svelte';

  interface Props {
    status: ProviderStatus<CommandItem>;
    onActivate: (item: CommandItem) => void;
  }
  let { status, onActivate }: Props = $props();
</script>

{#if status.status === 'ok' && status.items.length > 0}
  <div in:fade={{ duration: 120 }} out:fade={{ duration: 80 }}>
    <Command.Group class="mb-4" data-cmdk-commands-section>
      <Command.GroupHeading
        class="px-3 pb-1 text-[11px] font-semibold uppercase tracking-wider text-gray-500 dark:text-gray-400"
      >
        {$t('cmdk_section_commands')}
      </Command.GroupHeading>
      <Command.GroupItems>
        {#each status.items as item (item.id)}
          <Command.Item value={item.id} onSelect={() => onActivate(item)} class="group">
            <CommandRow {item} pending={item.id === manager.pendingConfirmId} />
          </Command.Item>
        {/each}
      </Command.GroupItems>
    </Command.Group>
  </div>
{/if}
