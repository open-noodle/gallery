<script lang="ts">
  import { beforeNavigate } from '$app/navigation';
  import { clickOutside } from '$lib/actions/click-outside';
  import { focusTrap } from '$lib/actions/focus-trap';
  import { menuButtonId } from '$lib/components/shared-components/navigation-bar/NavigationBar.svelte';
  import { sidebarModeStore } from '$lib/stores/sidebar-mode.svelte';
  import { sidebarStore } from '$lib/stores/sidebar.svelte';
  import type { Snippet } from 'svelte';

  interface Props {
    ariaLabel?: string;
    children?: Snippet;
  }

  let { ariaLabel, children }: Props = $props();

  const layout = $derived(sidebarModeStore.layout);
  const isRail = $derived(layout === 'rail');
  const isOverlay = $derived(layout === 'overlay');

  // In rail mode expansion comes solely from our own transient flags. Upstream
  // `sidebarStore.isOpen` is $derived from the 850px query, so above 850px it is
  // permanently true and would pin the rail open.
  const isExpanded = $derived(
    layout === 'expanded' ||
      (isRail && (sidebarModeStore.hoverExpanded || sidebarModeStore.railOverlayOpen)) ||
      (isOverlay && sidebarStore.isOpen),
  );

  const isHidden = $derived(isOverlay && !sidebarStore.isOpen);

  // Returning to rail after a stint at another width must not resurface a stale
  // hover state, so clear both flags whenever the layout leaves rail.
  $effect(() => {
    if (!isRail) {
      sidebarModeStore.resetTransient();
    }
  });

  const closeOverlay = () => {
    if (!isOverlay || !sidebarStore.isOpen) {
      return;
    }

    sidebarStore.reset();
    // `reset()` always closes below 850px, and `inert` then lands on this nav with focus
    // still inside it - on the focus trap's backup sentinel after an Escape. Nothing else
    // restores it: deactivating the trap does not destroy the action. Without this the
    // keyboard user is dropped to <body>. Upstream Sidebar returned focus the same way.
    document.querySelector<HTMLButtonElement>(`#${menuButtonId}`)?.focus();
  };

  beforeNavigate(() => {
    // The pointer is still over the rail after clicking a link, so hoverExpanded is
    // left alone - only the explicit tap/keyboard overlay closes.
    sidebarModeStore.railOverlayOpen = false;
    // Upstream Sidebar closed the sub-850px overlay from onMount, which fired on every
    // navigation because UserPageLayout remounts per page. Do it explicitly instead of
    // relying on a remount, or the overlay covers the page the user just navigated to.
    closeOverlay();
  });

  const collapse = () => {
    // Escape dismisses the rail outright, so both inputs are cleared - the pointer may well
    // still be over it, and leaving that half set would re-expand immediately.
    sidebarModeStore.pointerInside = false;
    sidebarModeStore.focusInside = false;
    sidebarModeStore.railOverlayOpen = false;
    // The sub-850px overlay is modal, and upstream Sidebar - which this shell replaces -
    // dismissed it on Escape, so that has to survive the swap.
    closeOverlay();
  };

  const handleOutclick = () => {
    if (isRail) {
      // Only the explicit tap/keyboard overlay closes: hoverExpanded is owned by the
      // pointer, which has already left the rail by the time a click lands elsewhere.
      sidebarModeStore.railOverlayOpen = false;
      return;
    }
    closeOverlay();
  };
</script>

<nav
  id="sidebar"
  aria-label={ariaLabel}
  tabindex="-1"
  data-testid="sidebar-parent"
  data-layout={layout}
  data-expanded={String(isExpanded)}
  inert={isHidden}
  class="relative z-10 h-full"
  onpointerenter={() => isRail && (sidebarModeStore.pointerInside = true)}
  onpointerleave={() => {
    if (!isRail) {
      return;
    }
    sidebarModeStore.pointerInside = false;
    // Drop the focus half too. Clicking a row - a sub-tree chevron especially - leaves focus
    // sitting on it, and nothing takes it away until the user clicks elsewhere, so on its own
    // the focus half pinned the rail open after the pointer had gone. A pointer leaving means a
    // mouse user is done with it. Keyboard users never reach here: they never had a pointer in.
    sidebarModeStore.focusInside = false;
  }}
  onfocusin={() => isRail && (sidebarModeStore.focusInside = true)}
  onfocusout={(event) => {
    if (!isRail) {
      return;
    }
    // `focusout` bubbles, so this also fires when focus moves from one row to another inside
    // the sidebar. Treat it as leaving only when the next focus target is outside: otherwise
    // every click on a row would report a departure. `relatedTarget` is null when focus falls
    // to <body>, which is a real departure for the keyboard - the pointer half of the union
    // is what keeps the rail open for a mouse still hovering it.
    const next = event.relatedTarget;
    sidebarModeStore.focusInside = next instanceof Node && event.currentTarget.contains(next);
  }}
  use:clickOutside={{ onOutclick: handleOutclick, onEscape: collapse }}
  use:focusTrap={{ active: isOverlay && sidebarStore.isOpen }}
>
  <!--
    The nav is the grid item and carries no width of its own, so nothing here can resize
    the slot; this inner container is absolutely positioned and grows over the content
    instead, so the justified timeline never reflows on hover. The slot's actual width is
    set by the grid column in the page layout, keyed off `data-layout`.

    A collapsed panel hides its scrollbar. It stays scrollable - focusing a row below the fold
    still scrolls it into view - but the bar itself is unusable there: reaching for it expands
    the rail, so the thing being aimed at is gone before the pointer arrives. Painting one down
    a 5rem column of icons is then pure clutter. It returns with the width, on hover and in the
    expanded/overlay layouts, where the pointer is already inside and can work it.
  -->
  <div
    data-testid="sidebar-panel"
    class="absolute inset-s-0 top-0 flex h-full flex-col gap-1 overflow-x-hidden overflow-y-auto bg-light pt-8 transition-[width] duration-200 motion-reduce:transition-none"
    class:immich-scrollbar={isExpanded}
    class:scrollbar-hidden={!isExpanded}
    class:w-64={isExpanded}
    class:w-20={isRail && !isExpanded}
    class:w-0={isHidden}
    class:shadow-2xl={isExpanded && layout !== 'expanded'}
  >
    {@render children?.()}
  </div>
</nav>
