<script lang="ts">
  import type { Snippet } from 'svelte';

  interface Props {
    title: string;
    href?: string;
    isActive?: () => boolean;
    expanded?: boolean;
    items?: Snippet;
  }

  let { title, href = '#', isActive, expanded = $bindable(false), items }: Props = $props();

  // Mirrors navbar-item.stub.svelte: surface the isActive override's verdict so tests can
  // assert what the real component highlights. Rows without an override render no
  // data-active at all, keeping the default prefix match untested here.
  const active = $derived(isActive?.());
</script>

<a {href} data-expanded={expanded} data-active={active === undefined ? undefined : String(active)}>{title}</a>

{#if items}
  {@render items()}
{/if}
