<script lang="ts">
  // Snippet props can't be supplied from a plain props object in @testing-library/svelte, so this wrapper
  // supplies `summary` and `apply` and forwards everything else verbatim. Same convention as
  // src/lib/components/people/person-tile.test-wrapper.svelte.
  import type { ComponentProps } from 'svelte';
  import FaceReviewDock from './FaceReviewDock.svelte';

  // Typed as the dock's own props minus the two snippets this wrapper supplies. A `Record<string, unknown>`
  // here compiles under tsc but fails check:svelte, which cannot prove the spread satisfies the required props.
  const props: Omit<ComponentProps<typeof FaceReviewDock>, 'summary' | 'apply'> = $props();
</script>

<FaceReviewDock {...props}>
  {#snippet summary()}
    <div data-testid="harness-summary">summary</div>
  {/snippet}
  {#snippet apply()}
    <div data-testid="harness-apply">apply</div>
  {/snippet}
</FaceReviewDock>
