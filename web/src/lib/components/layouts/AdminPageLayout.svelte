<script lang="ts">
  import BreadcrumbActionPage from '$lib/components/BreadcrumbActionPage.svelte';
  import NavigationBar from '$lib/components/shared-components/navigation-bar/NavigationBar.svelte';
  import BottomInfo from '$lib/components/shared-components/side-bar/BottomInfo.svelte';
  import { Route } from '$lib/route';
  import { sidebarStore } from '$lib/stores/sidebar.svelte';
  import type { HeaderButtonActionItem } from '$lib/types';
  import { AppShell, AppShellHeader, AppShellSidebar, MenuItemType, NavbarItem, type BreadcrumbItem } from '@immich/ui';
  import {
    mdiAccountMultipleOutline,
    mdiBookshelf,
    mdiCog,
    mdiCloudSyncOutline,
    mdiFaceRecognition,
    mdiServer,
    mdiTrayFull,
    mdiWrench,
  } from '@mdi/js';
  import type { Snippet } from 'svelte';
  import { t } from 'svelte-i18n';

  type Props = {
    breadcrumbs: BreadcrumbItem[];
    actions?: Array<HeaderButtonActionItem | MenuItemType>;
    children?: Snippet;
    // Optional bottom-pinned action bar — see BreadcrumbActionPage. Sits below the scroll area, never over the
    // sidebar.
    footer?: Snippet;
  };

  let { breadcrumbs, actions, children, footer }: Props = $props();
</script>

<div class="demo-admin-shell">
  <AppShell>
    <AppShellHeader class="max-md:h-(--navbar-height-md) h-(--navbar-height)">
      <NavigationBar noBorder />
    </AppShellHeader>
    <AppShellSidebar
      bind:open={sidebarStore.isOpen}
      class="flex h-full flex-col justify-between gap-2 border-none shadow-none"
    >
      <div class="flex flex-col gap-1 pe-4 pt-8">
        <NavbarItem title={$t('users')} href={Route.users()} icon={mdiAccountMultipleOutline} />
        <NavbarItem title={$t('external_libraries')} href={Route.libraries()} icon={mdiBookshelf} />
        <NavbarItem title={$t('admin.queues')} href={Route.queues()} icon={mdiTrayFull} />
        <NavbarItem title={$t('admin.face_cleanup')} href={Route.faceCleanup()} icon={mdiFaceRecognition} />
        <NavbarItem title={$t('settings')} href={Route.systemSettings()} icon={mdiCog} />
        <NavbarItem title={$t('admin.maintenance_settings')} href={Route.systemMaintenance()} icon={mdiWrench} />
        <NavbarItem title="Storage Migration" href={Route.storageMigration()} icon={mdiCloudSyncOutline} />
        <NavbarItem title={$t('server_stats')} href={Route.systemStatistics()} icon={mdiServer} />
      </div>

      <div class="me-4 mb-2">
        <BottomInfo />
      </div>
    </AppShellSidebar>

    <BreadcrumbActionPage {breadcrumbs} {actions} {footer}>
      {@render children?.()}
    </BreadcrumbActionPage>
  </AppShell>
</div>
