<script lang="ts">
  import type { Snippet } from 'svelte';

  interface Props {
    title: string;
    href?: string;
    isActive?: () => boolean;
    expanded?: boolean;
    items?: Snippet;
    class?: string;
    onclick?: () => void;
  }

  let {
    title,
    href = '#',
    isActive,
    expanded = $bindable(false),
    items,
    class: className,
    onclick,
  }: Props = $props();

  // @immich/ui's NavbarItem prefers an `isActive` override over its default `pathname.startsWith(href)`
  // match. Surface the override's verdict so tests can assert what the real component would highlight;
  // items that don't override it render no data-active at all (they keep the default prefix match).
  const active = $derived(isActive?.());
</script>

<a
  {href}
  data-expanded={expanded}
  data-active={active === undefined ? undefined : String(active)}
  class={className}
  {onclick}>{title}</a
>

{#if items}
  {@render items()}
{/if}
