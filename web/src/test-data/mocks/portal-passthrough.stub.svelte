<script lang="ts">
  import type { Snippet } from 'svelte';

  // Renders the portalled content in place (happy-dom has no paint order to reproduce) while
  // recording the target, so tests can assert *that* a subtree leaves the page's stacking context.
  interface Props {
    target?: HTMLElement | string;
    children?: Snippet;
  }

  let { target = 'body', children }: Props = $props();
</script>

<div data-testid="portal" data-portal-target={typeof target === 'string' ? target : target.tagName.toLowerCase()}>
  {@render children?.()}
</div>
