<script lang="ts">
  type ActionItem = {
    title: string;
    onAction?: () => void;
    $if?: () => boolean;
  };

  interface Props {
    items?: ActionItem[];
    [key: string]: unknown;
  }

  let { items = [], ...rest }: Props = $props();
  const ariaLabel = $derived(String(rest['aria-label'] ?? 'menu'));
  // Mirror @immich/ui's isEnabled: items without $if are always shown.
  const visibleItems = $derived(items.filter((item) => item.$if?.() ?? true));
</script>

{#if visibleItems.length > 0}
  <div>
    <button type="button" aria-label={ariaLabel}>menu</button>
    {#each visibleItems as item (item.title)}
      <button type="button" onclick={() => item.onAction?.()}>{item.title}</button>
    {/each}
  </div>
{/if}
