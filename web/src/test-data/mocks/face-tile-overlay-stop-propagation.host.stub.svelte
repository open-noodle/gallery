<script lang="ts">
  import FaceTileOverlay from '$lib/components/face-cleanup/FaceTileOverlay.svelte';

  // Test-only host for FaceTileOverlay.spec.ts's stopPropagation probe.
  //
  // A raw `container.addEventListener('click', ...)` is NOT a faithful stand-in for "an ancestor tile button"
  // here: @testing-library/svelte mounts the component with `target = container`, and Svelte 5 registers its
  // OWN click-delegation listener on that very same `target` node (svelte/internal/client/render.js — "Add the
  // event listener to both the container and the document"). A listener added to `container` after render()
  // therefore sits on the SAME node as Svelte's delegation listener, and per native DOM semantics
  // `stopPropagation()` never suppresses a later listener on the SAME node — only `stopImmediatePropagation()`
  // does. Testing this via a raw container listener would fail even when the component is correct.
  //
  // A genuine ANCESTOR element, rendered by Svelte itself (so its `onclick` is registered through the same
  // delegated-handler mechanism the real page uses), is what actually exercises the propagation-stopping this
  // component relies on: Svelte's manual delegated walk checks `event.cancelBubble` between each ancestor and
  // stops early once it's set, which is what `event.stopPropagation()` inside FaceTileOverlay achieves.
  interface Props {
    localDateTime: string;
    onOpen: () => void;
    onAncestorClick: () => void;
  }

  const { localDateTime, onOpen, onAncestorClick }: Props = $props();
</script>

<!-- Test-only ancestor probe, not a real interactive control — a11y rules don't apply. -->
<!-- svelte-ignore a11y_click_events_have_key_events -->
<!-- svelte-ignore a11y_no_static_element_interactions -->
<div onclick={onAncestorClick} data-testid="ancestor">
  <FaceTileOverlay {localDateTime} {onOpen} />
</div>
