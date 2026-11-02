<script lang="ts">
  import { goto } from '$app/navigation';
  import FilterPanel from '$lib/components/filter-panel/filter-panel.svelte';
  import FilterToggleButton from '$lib/components/filter-panel/filter-toggle-button.svelte';
  import { getActiveFilterCount } from '$lib/components/filter-panel/filter-panel';
  import UserPageLayout from '$lib/components/layouts/UserPageLayout.svelte';
  import OnEvents from '$lib/components/OnEvents.svelte';
  import Portal from '$lib/elements/Portal.svelte';
  import { IconButton } from '@immich/ui';
  import { mdiArrowLeft } from '@mdi/js';
  import { onMount, type Snippet } from 'svelte';
  import { t } from 'svelte-i18n';
  import type { MapFilterController } from './map-filter-controller.svelte';

  type Props = {
    controller: MapFilterController;
    title?: string;
    children: Snippet;
  };

  // Stands in for the route's `<UserPageLayout>`: header filter toggles, the mobile filter drawer and
  // the desktop filter panel beside the route's map pane.
  let { controller: map, title, children }: Props = $props();

  let showMobileFilters = $state(false);
  let isMobile = $state(false);

  function checkMobile() {
    isMobile = window.innerWidth < 640;
    if (!isMobile) {
      showMobileFilters = false;
    }
  }

  onMount(() => {
    checkMobile();
    // ResizeObserver observes elements, not the viewport; this tracks window width
    // to switch the map between mobile and desktop layouts.
    // eslint-disable-next-line unicorn/prefer-observer-apis
    window.addEventListener('resize', checkMobile);
    return () => window.removeEventListener('resize', checkMobile);
  });

  // On mobile the panel *is* the drawer, so its collapse control has to dismiss the whole overlay.
  // Left to collapse itself it shrinks to a 48px icon strip under a full-screen scrim, which reads
  // as "stuck open" (#964). Feeding it a constant `false` also stops a close from persisting as
  // "collapsed" into the next open.
  function onMobileFilterCollapse(collapsed: boolean) {
    if (collapsed) {
      showMobileFilters = false;
    }
  }
</script>

<UserPageLayout {title}>
  {#snippet leading()}
    {#if map.spaceId}
      <IconButton
        variant="ghost"
        shape="round"
        color="secondary"
        aria-label={$t('back')}
        onclick={() => goto(`/spaces/${map.spaceId}`)}
        icon={mdiArrowLeft}
      />
    {/if}
    {#if isMobile}
      <!-- The same component the desktop header uses, rather than a hand-rolled button: that
           duplicate had drifted onto a different icon (mdiFilterVariant vs the mdiTune every
           other filter affordance uses) and carried no accessible name. -->
      <FilterToggleButton
        active={getActiveFilterCount(map.filters) > 0}
        onExpand={() => (showMobileFilters = !showMobileFilters)}
        testId="map-mobile-filter-toggle"
      />
    {/if}
  {/snippet}
  {#snippet descriptionTrailing()}
    <!-- Filter toggle right after the "Map" title: descriptionTrailing renders inside the title
         cluster, so the button sits next to the title without shifting it (leading) or drifting to
         the far right (buttons). -ms-6 pulls it back over the title's built-in pe-8 trailing pad so
         it sits snug against "Map". -->
    {#if !isMobile && map.filterCollapsed}
      <div class="-ms-6">
        <FilterToggleButton
          active={getActiveFilterCount(map.filters) > 0}
          onExpand={() => (map.filterCollapsed = false)}
        />
      </div>
    {/if}
  {/snippet}
  <OnEvents onAssetsDelete={map.refresh} />
  {#if isMobile && showMobileFilters}
    <!-- Portalled to the body, not nested in the map layout: the page header row is a later
         sibling of the content pane inside <main>, so it paints over everything the pane holds,
         and the `isolate` below traps any z-index that tries to out-rank it. That is what put
         "Map" on top of the panel's "Timeline" heading (#964).

         Offsetting the top by the navbar height rather than using `inset-0` keeps the panel's own
         header - close button and section menu - out of the navbar band, where iOS Safari paints
         the navbar over it, and leaves the main menu reachable while the drawer is open. -->
    <Portal target="body">
      <div
        class="fixed inset-x-0 top-(--navbar-height) bottom-0 z-30 max-md:top-(--navbar-height-md)"
        data-testid="map-mobile-filter-overlay"
      >
        <button
          type="button"
          class="absolute inset-0 bg-black/50"
          aria-label="Close filters"
          onclick={() => (showMobileFilters = false)}
        ></button>
        <div class="absolute inset-y-0 left-0 w-72 bg-light shadow-xl dark:bg-immich-dark-bg">
          <FilterPanel
            bind:filters={map.filters}
            bind:collapsed={() => false, onMobileFilterCollapse}
            config={map.filterConfig}
            timeBuckets={map.timeBuckets}
            storageKey="gallery-filter-visible-sections-map"
            persistCollapsed={false}
            onFiltersChange={map.syncUrl}
          />
        </div>
      </div>
    </Portal>
  {/if}
  <div class="isolate flex size-full">
    {#if !isMobile}
      <FilterPanel
        bind:filters={map.filters}
        bind:collapsed={map.filterCollapsed}
        externalToggle
        config={map.filterConfig}
        timeBuckets={map.timeBuckets}
        storageKey="gallery-filter-visible-sections-map"
        onFiltersChange={map.syncUrl}
      />
    {/if}
    {@render children()}
  </div>
</UserPageLayout>
