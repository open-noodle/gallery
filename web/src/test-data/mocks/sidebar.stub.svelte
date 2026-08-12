<script lang="ts">
  import type { Snippet } from 'svelte';

  interface Props {
    ariaLabel?: string;
    children?: Snippet;
    // Pages that pin an action bar to the bottom of the admin content region pass it as AdminPageLayout's
    // `footer` snippet (see BreadcrumbActionPage), NOT as part of `children`. The stub has to render it too, or
    // that whole bar — bulk actions, tally, Apply — silently vanishes from the page under test.
    footer?: Snippet;
  }

  let { ariaLabel, children, footer }: Props = $props();
</script>

<nav aria-label={ariaLabel}>
  {@render children?.()}
  {@render footer?.()}
</nav>
