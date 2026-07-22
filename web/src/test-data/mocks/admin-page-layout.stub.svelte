<script lang="ts">
  import type { BreadcrumbItem } from '@immich/ui';
  import type { Snippet } from 'svelte';

  type Action = { title: string };

  // Test double for AdminPageLayout. Unlike sidebar.stub.svelte (which the face-cleanup specs used to share
  // with the sidebar's own tests), this one RENDERS the breadcrumbs prop, mirroring @immich/ui's Breadcrumbs:
  // an item with an href becomes a link, one without becomes plain text.
  //
  // The data-testid is required, not cosmetic. Several face-cleanup pages deliberately carry an in-page back
  // link with the SAME accessible name and href as a crumb — they lead to the same place — so an unscoped
  // getByRole('link', { name }) throws "found multiple elements". Scope every breadcrumb query with
  // `within(screen.getByTestId('breadcrumbs'))`.
  //
  // No aria-label on the nav: the real Breadcrumbs has none, and asserting one would test the stub rather
  // than production.
  interface Props {
    breadcrumbs?: BreadcrumbItem[];
    // Rendered as buttons so the read-only-demo specs can assert which mutating actions a page still offers.
    actions?: Action[];
    children?: Snippet;
    // Pages that pin an action bar to the bottom of the content region pass it as AdminPageLayout's `footer`
    // snippet, NOT as part of `children`. The stub has to render it too, or that whole bar — bulk actions,
    // tally, Apply — silently vanishes from the page under test.
    footer?: Snippet;
  }

  let { breadcrumbs = [], actions = [], children, footer }: Props = $props();
</script>

<nav data-testid="breadcrumbs">
  {#each breadcrumbs as crumb, index (index)}
    {#if crumb.href}
      <a href={crumb.href}>{crumb.title}</a>
    {:else}
      <span>{crumb.title}</span>
    {/if}
  {/each}
</nav>

<div data-testid="page-actions">
  {#each actions as action (action.title)}
    <button type="button">{action.title}</button>
  {/each}
</div>

{@render children?.()}
{@render footer?.()}
