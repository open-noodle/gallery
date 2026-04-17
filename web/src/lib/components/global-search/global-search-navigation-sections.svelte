<script lang="ts">
  import type { NavigationItem, NavigationCategory } from '$lib/managers/navigation-items';
  import type { ProviderStatus } from '$lib/managers/global-search-manager.svelte';
  import { Command } from 'bits-ui';
  import { t, type Translations } from 'svelte-i18n';
  import { SvelteMap } from 'svelte/reactivity';
  import { fade } from 'svelte/transition';
  import NavigationRow from './rows/navigation-row.svelte';

  interface Props {
    status: ProviderStatus<NavigationItem>;
    onActivate: (item: NavigationItem) => void;
  }
  let { status, onActivate }: Props = $props();

  const TOP_N = 5;
  // Fixed render order. Each entry holds the i18n key for the group heading.
  const ORDER: ReadonlyArray<{ category: NavigationCategory; headingKey: Translations }> = [
    { category: 'systemSettings', headingKey: 'cmdk_section_system_settings' as Translations },
    { category: 'admin', headingKey: 'cmdk_section_admin' as Translations },
    { category: 'userPages', headingKey: 'cmdk_section_user_pages' as Translations },
    { category: 'actions', headingKey: 'cmdk_section_actions' as Translations },
  ];

  const buckets = $derived.by(() => {
    if (status.status !== 'ok') {
      return [];
    }
    // Group by category at render time, slicing each to TOP_N. The manager already
    // sorted the flat list by score descending, so topN-per-bucket preserves the
    // strongest matches per category.
    const byCategory = new SvelteMap<NavigationCategory, NavigationItem[]>();
    for (const item of status.items) {
      const arr = byCategory.get(item.category) ?? [];
      if (arr.length < TOP_N) {
        arr.push(item);
        byCategory.set(item.category, arr);
      }
    }
    return ORDER.filter(({ category }) => (byCategory.get(category)?.length ?? 0) > 0).map(
      ({ category, headingKey }) => ({
        category,
        headingKey,
        items: byCategory.get(category) ?? [],
      }),
    );
  });
</script>

{#if status.status === 'ok' && buckets.length > 0}
  <div in:fade={{ duration: 120 }} out:fade={{ duration: 80 }}>
    {#each buckets as bucket (bucket.category)}
      <Command.Group class="mb-4" data-cmdk-nav-section>
        <Command.GroupHeading
          class="px-3 pb-1 text-[11px] font-semibold uppercase tracking-wider text-gray-500 dark:text-gray-400"
        >
          {$t(bucket.headingKey)}
        </Command.GroupHeading>
        <Command.GroupItems>
          {#each bucket.items as item (item.id)}
            <Command.Item value={item.id} onSelect={() => onActivate(item)} class="group">
              <NavigationRow {item} />
            </Command.Item>
          {/each}
        </Command.GroupItems>
      </Command.Group>
    {/each}
  </div>
{/if}
