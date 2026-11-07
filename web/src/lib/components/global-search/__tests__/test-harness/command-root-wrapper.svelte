<script lang="ts">
  import type { ProviderStatus } from '#lib/managers/global-search-manager.svelte.ts';
  import type { NavigationItem } from '#lib/managers/navigation-items.ts';
  import { Command } from 'bits-ui';
  import GlobalSearchNavigationSections from '../../global-search-navigation-sections.svelte';

  interface Props {
    status: ProviderStatus<NavigationItem>;
    onActivate?: (item: NavigationItem) => void;
  }
  let { status, onActivate = () => {} }: Props = $props();
</script>

<Command.Root>
  <Command.List>
    <GlobalSearchNavigationSections {status} {onActivate} />
  </Command.List>
</Command.Root>
