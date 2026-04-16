<script lang="ts" generics="T extends { id?: string; latitude?: number; longitude?: number }">
  import { Command } from 'bits-ui';
  import type { Snippet } from 'svelte';
  import type { ProviderStatus } from '$lib/managers/global-search-manager.svelte';
  import GlobalSearchSection from '../../global-search-section.svelte';

  interface Props {
    heading: string;
    status: ProviderStatus<T>;
    idPrefix: 'photo' | 'person' | 'place' | 'tag' | 'album' | 'space';
    renderRow: Snippet<[T]>;
    onActivate?: (item: T) => void;
    onSeeAll?: () => void;
  }
  let { heading, status, idPrefix, renderRow: renderRowProp, onActivate = () => {}, onSeeAll }: Props = $props();
</script>

<Command.Root>
  <Command.List>
    <GlobalSearchSection {heading} {status} {idPrefix} renderRow={renderRowProp} {onActivate} {onSeeAll} />
  </Command.List>
</Command.Root>
