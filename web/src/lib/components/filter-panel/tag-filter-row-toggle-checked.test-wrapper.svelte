<script lang="ts">
  import { TooltipProvider } from '@immich/ui';
  import TagFilterRow from './tag-filter-row.svelte';

  interface Props {
    id: string;
    name: string;
    initialChecked: boolean;
    onToggle: (id: string) => void;
  }

  let { id, name, initialChecked, onToggle }: Props = $props();

  // Only R17 uses this. `checked` must be a genuine local $state flipped by a click handled inside
  // THIS component, not a prop pushed in from the test via rerender(): @testing-library/svelte's
  // rerender() replaces the whole props object as one shallow `$state.raw` box (see
  // @testing-library/svelte-core's createProps), so any partial update invalidates every prop
  // reader together — which would mask exactly the fine-grained per-prop dependency bug R17 exists
  // to catch (TagFilterRow's clampOverflow key depending on `name` but not `checked`). Toggling here
  // instead gives TagFilterRow a real, independently-tracked `checked` prop, the same as it gets from
  // its actual parent, tags-filter.svelte.
  let checked = $state(initialChecked);
</script>

<TooltipProvider>
  <button type="button" data-testid="toggle-checked" onclick={() => (checked = !checked)}>toggle</button>
  <TagFilterRow {id} {name} {checked} {onToggle} />
</TooltipProvider>
