<script lang="ts">
  import { page } from '$app/state';
  import RecentSpaces from '$lib/components/shared-components/side-bar/recent-spaces.svelte';
  import SidebarNavItem from '$lib/components/sidebar/sidebar-nav-item.svelte';
  import { Route } from '$lib/route';
  import { recentSpacesDropdown } from '$lib/gallery/stores/preferences.store';
  import { mdiAccountGroup, mdiAccountGroupOutline } from '@mdi/js';
  import { t } from 'svelte-i18n';
  import { fly } from 'svelte/transition';
</script>

<!-- Exact match, not SidebarNavItem's default `startsWith`: the rows this expands into (spaces, and
     their albums) highlight themselves, so a prefix match would light up two rows at once. -->
<SidebarNavItem
  title={$t('spaces')}
  href={Route.spaces()}
  isActive={() => page.url.pathname === Route.spaces()}
  icon={mdiAccountGroupOutline}
  activeIcon={mdiAccountGroup}
  bind:expanded={$recentSpacesDropdown}
>
  {#snippet items()}
    <span in:fly={{ y: -20 }} class="hidden md:block">
      <RecentSpaces />
    </span>
  {/snippet}
</SidebarNavItem>
