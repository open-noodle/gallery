<!--
  EmptyPlaceholder stub that SURFACES its props, unlike the noop mock most page specs use.

  The placeholder's whole job is to say which empty it is — "your library is empty, upload
  something" vs "your filters matched nothing" — and to offer the upload affordance only for the
  former. A noop mock renders neither, so a spec using it cannot tell a correct empty state from a
  misleading one.
-->
<script lang="ts">
  interface Props {
    text: string;
    title?: string;
    onClick?: undefined | (() => unknown);
    [key: string]: unknown;
  }

  let { text, title, onClick }: Props = $props();
</script>

<div data-testid="empty-placeholder" data-clickable={String(onClick !== undefined)}>
  {#if title}
    <span data-testid="empty-placeholder-title">{title}</span>
  {/if}
  <span data-testid="empty-placeholder-text">{text}</span>
</div>
