<script lang="ts">
  import BottomInfo from '$lib/components/shared-components/side-bar/BottomInfo.svelte';
  import RailStorage from '$lib/components/shared-components/side-bar/rail-storage.svelte';
  import { sidebarModeStore } from '$lib/stores/sidebar-mode.svelte';

  const collapsed = $derived(sidebarModeStore.layout === 'rail' && !sidebarModeStore.railExpanded);
</script>

{#if collapsed}
  <RailStorage />
{:else}
  <!-- BottomInfo's three sections carry a start inset only (StorageSpace `ms-4`, PurchaseInfo
       `ps-4`, ServerStatus `ps-5`) because upstream let the sidebar's scrollbar gutter stand in
       for the other side, which reads as lopsided. Supply the matching end inset here rather
       than in BottomInfo itself, which AdminPageLayout also renders with its own chrome.
       `mt-auto` moves onto the wrapper - it is the flex child now, so BottomInfo's own `mt-auto`
       no longer has the panel's free space to absorb - and `gap-1` keeps the row spacing the
       sections had as direct children of the panel. -->
  <div class="mt-auto flex flex-col gap-1 pe-4">
    <BottomInfo />
  </div>
{/if}
