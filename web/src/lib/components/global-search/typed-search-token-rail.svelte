<script lang="ts">
  import type { TypedSearchDisplayToken } from '$lib/utils/typed-search/typed-search-parser';

  interface Props {
    tokens: TypedSearchDisplayToken[];
  }

  let { tokens }: Props = $props();
</script>

{#if tokens.length > 0}
  <div class="flex min-w-0 flex-wrap items-center gap-1.5 px-4 pt-2 pb-1" data-testid="typed-search-token-rail">
    {#each tokens as token (`${token.raw}:${token.status}`)}
      <span
        data-testid={`typed-search-token-${token.key}`}
        data-status={token.status}
        aria-label={token.issue?.message}
        class="inline-flex max-w-full items-center gap-1 rounded-md border px-2 py-1 text-[11px] leading-none
          {token.status === 'error'
          ? 'border-red-400/70 bg-red-50 text-red-700 dark:border-red-500/50 dark:bg-red-950/30 dark:text-red-200'
          : token.status === 'pending-entity'
            ? 'border-dashed border-gray-300 bg-gray-50 text-gray-600 dark:border-gray-600 dark:bg-gray-800/60 dark:text-gray-300'
            : 'border-gray-200 bg-subtle/60 text-gray-700 dark:border-gray-700 dark:text-gray-200'}"
      >
        <span class="font-semibold">{token.key}</span>
        <span class="truncate">{token.value}</span>
      </span>
    {/each}
  </div>
{/if}
