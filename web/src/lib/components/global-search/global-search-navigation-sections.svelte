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
    // strongest matches per category. `preSliceCount` captures the pre-slice count
    // per category so the chip + heading-count can report truncation.
    const byCategory = new SvelteMap<NavigationCategory, NavigationItem[]>();
    const preSliceCount = new SvelteMap<NavigationCategory, number>();
    for (const item of status.items) {
      preSliceCount.set(item.category, (preSliceCount.get(item.category) ?? 0) + 1);
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
        preSliceCount: preSliceCount.get(category) ?? 0,
      }),
    );
  });

  // Gate chip + count rendering on a first filter pass having produced results.
  // Without this, if the component re-mounts with a hot status (e.g. rehydrated
  // session), the chip could flash before the user has typed. `status.status === 'ok'`
  // is the nav-provider's equivalent of "filter pass against a non-empty query ran":
  // the provider returns `empty` when the query is empty, so `ok` implies query > 0.
  // Per feedback_svelte_derived_no_mutation: flip via $effect, not inside $derived.
  let hasResolvedOnce = $state(false);
  $effect(() => {
    if (!hasResolvedOnce && status.status === 'ok') {
      hasResolvedOnce = true;
    }
  });
</script>

{#if status.status === 'ok' && buckets.length > 0}
  <div in:fade={{ duration: 120 }} out:fade={{ duration: 80 }}>
    {#each buckets as bucket (bucket.category)}
      {@const showChip = hasResolvedOnce && bucket.preSliceCount > TOP_N}
      <Command.Group class="mb-4">
        <Command.GroupHeading
          class="px-3 pb-1 text-[11px] font-semibold uppercase tracking-wider text-gray-500 dark:text-gray-400"
        >
          {$t(bucket.headingKey)}{#if showChip}
            <span class="tabular-nums"> ({$t('cmdk_section_count_of', { values: { shown: bucket.items.length, total: bucket.preSliceCount } })})</span>
          {/if}
        </Command.GroupHeading>
        <Command.GroupItems>
          {#each bucket.items as item (item.id)}
            <Command.Item value={item.id} onSelect={() => onActivate(item)} class="group">
              <NavigationRow {item} />
            </Command.Item>
          {/each}
          {#if showChip}
            <div
              data-testid="more-chip"
              aria-hidden="true"
              class="mt-1 px-3 py-1 text-[12px] font-[410] text-gray-500 dark:text-gray-400 tabular-nums"
            >
              {$t('cmdk_section_more_count', { values: { count: bucket.preSliceCount - bucket.items.length } })}
            </div>
          {/if}
        </Command.GroupItems>
      </Command.Group>
    {/each}
  </div>
{/if}
