<script lang="ts">
  import { page } from '$app/state';
  import BottomInfo from '$lib/components/shared-components/side-bar/BottomInfo.svelte';
  import RailStorage from '$lib/components/shared-components/side-bar/rail-storage.svelte';
  import RecentAlbums from '$lib/components/shared-components/side-bar/RecentAlbums.svelte';
  import RecentSpaces from '$lib/components/shared-components/side-bar/recent-spaces.svelte';
  import SidebarNavGroup from '$lib/components/sidebar/sidebar-nav-group.svelte';
  import SidebarNavItem from '$lib/components/sidebar/sidebar-nav-item.svelte';
  import Sidebar from '$lib/components/sidebar/sidebar-shell.svelte';
  import { authManager } from '$lib/managers/auth-manager.svelte';
  import { familyAccessManager } from '$lib/managers/family-access-manager.svelte';
  import { featureFlagsManager } from '$lib/managers/feature-flags-manager.svelte';
  import { Route } from '$lib/route';
  import { recentAlbumsDropdown, recentSpacesDropdown } from '$lib/stores/preferences.store';
  import { sidebarModeStore } from '$lib/stores/sidebar-mode.svelte';
  import {
    mdiAccount,
    mdiAccountMultiple,
    mdiAccountGroup,
    mdiAccountGroupOutline,
    mdiAccountMultipleOutline,
    mdiAccountOutline,
    mdiArchiveArrowDown,
    mdiArchiveArrowDownOutline,
    mdiDatabaseImportOutline,
    mdiFamilyTree,
    mdiFolderOutline,
    mdiHeart,
    mdiHeartOutline,
    mdiHistory,
    mdiImageAlbum,
    mdiImageMultiple,
    mdiImageMultipleOutline,
    mdiLink,
    mdiLock,
    mdiLockOutline,
    mdiMagnify,
    mdiMap,
    mdiMapOutline,
    mdiTagMultipleOutline,
    mdiToolbox,
    mdiToolboxOutline,
    mdiTrashCan,
    mdiTrashCanOutline,
    mdiUploadOutline,
  } from '@mdi/js';
  import { t } from 'svelte-i18n';
  import { fly } from 'svelte/transition';

  const collapsed = $derived(sidebarModeStore.layout === 'rail' && !sidebarModeStore.railExpanded);
</script>

<Sidebar ariaLabel={$t('primary')}>
  <SidebarNavItem
    title={$t('photos')}
    href={Route.photos()}
    icon={mdiImageMultipleOutline}
    activeIcon={mdiImageMultiple}
  />

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

  {#if featureFlagsManager.value.search}
    <SidebarNavItem title={$t('explore')} href={Route.explore()} icon={mdiMagnify} />
  {/if}

  {#if featureFlagsManager.value.map}
    <SidebarNavItem title={$t('map')} href={Route.map()} icon={mdiMapOutline} activeIcon={mdiMap} />
  {/if}

  {#if authManager.preferences.people.enabled && authManager.preferences.people.sidebarWeb}
    <SidebarNavItem title={$t('people')} href={Route.people()} icon={mdiAccountOutline} activeIcon={mdiAccount} />
  {/if}

  <!-- Gallery-fork: family relationships (A1/A12). Renders nothing at all — not a disabled entry
       — when the viewer's effective family access is `none`, so this feature never advertises
       itself to someone who cannot use it. Placed immediately after People per the design spec. -->
  {#if familyAccessManager.granted}
    <SidebarNavItem title={$t('family_canvas_nav_item')} href={Route.family()} icon={mdiFamilyTree} />
  {/if}

  {#if authManager.preferences.sharedLinks.enabled && authManager.preferences.sharedLinks.sidebarWeb}
    <SidebarNavItem title={$t('shared_links')} href={Route.sharedLinks()} icon={mdiLink} />
  {/if}

  <SidebarNavItem
    title={$t('sharing')}
    href={Route.sharing()}
    icon={mdiAccountMultipleOutline}
    activeIcon={mdiAccountMultiple}
  />

  <SidebarNavGroup title={$t('library')} />

  <SidebarNavItem title={$t('favorites')} href={Route.favorites()} icon={mdiHeartOutline} activeIcon={mdiHeart} />

  {#if authManager.preferences.memories.enabled}
    <SidebarNavItem title={$t('memories')} href={Route.memories()} icon={mdiHistory} />
  {/if}

  <SidebarNavItem
    title={$t('albums')}
    href={Route.albums()}
    icon={{ icon: mdiImageAlbum, flipped: true }}
    bind:expanded={$recentAlbumsDropdown}
  >
    {#snippet items()}
      <span in:fly={{ y: -20 }} class="hidden md:block">
        <RecentAlbums />
      </span>
    {/snippet}
  </SidebarNavItem>

  {#if authManager.preferences.tags.enabled && authManager.preferences.tags.sidebarWeb}
    <SidebarNavItem title={$t('tags')} href={Route.tags()} icon={{ icon: mdiTagMultipleOutline, flipped: true }} />
  {/if}

  {#if authManager.preferences.recentlyAdded.sidebarWeb}
    <SidebarNavItem
      title={$t('recently_added')}
      href={Route.recentlyAdded()}
      icon={{ icon: mdiUploadOutline, flipped: true }}
    />
  {/if}

  {#if authManager.preferences.folders.enabled && authManager.preferences.folders.sidebarWeb}
    <SidebarNavItem title={$t('folders')} href={Route.folders()} icon={{ icon: mdiFolderOutline, flipped: true }} />
  {/if}

  <SidebarNavItem title={$t('utilities')} href={Route.utilities()} icon={mdiToolboxOutline} activeIcon={mdiToolbox} />

  <SidebarNavItem title={$t('import')} href={Route.import()} icon={mdiDatabaseImportOutline} />

  <SidebarNavItem
    title={$t('archive')}
    href={Route.archive()}
    icon={mdiArchiveArrowDownOutline}
    activeIcon={mdiArchiveArrowDown}
  />

  <SidebarNavItem title={$t('locked_folder')} href={Route.locked()} icon={mdiLockOutline} activeIcon={mdiLock} />

  {#if featureFlagsManager.value.trash}
    <SidebarNavItem title={$t('trash')} href={Route.trash()} icon={mdiTrashCanOutline} activeIcon={mdiTrashCan} />
  {/if}

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
</Sidebar>
