<script lang="ts">
  import { sidebarModeStore } from '$lib/stores/sidebar-mode.svelte';
  import { NavbarGroup } from '@immich/ui';

  interface Props {
    title: string;
  }

  let { title }: Props = $props();

  const collapsed = $derived(sidebarModeStore.layout === 'rail' && !sidebarModeStore.railExpanded);
</script>

{#if collapsed}
  <!-- A text heading is unreadable at 5rem, so the group boundary becomes a rule - the same
       treatment Google Photos uses in its rail. The heading itself stays mounted, hidden, to
       reserve its height: swapping it for a bare rule made the group boundary 47px shorter
       than in the expanded sidebar, so every row below it jumped that far when the rail
       collapsed and back again on hover. Reserving via the real component rather than a
       hard-coded height keeps the two in step if @immich/ui restyles NavbarGroup. -->
  <div class="relative">
    <div class="invisible" aria-hidden="true"><NavbarGroup {title} size="tiny" /></div>
    <hr data-testid="sidebar-group-divider" class="absolute inset-x-0 top-1/2 mx-3 border-subtle" />
  </div>
{:else}
  <NavbarGroup {title} size="tiny" />
{/if}
