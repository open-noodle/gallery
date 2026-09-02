<script lang="ts">
  import { goto, invalidateAll } from '$app/navigation';
  import { page } from '$app/state';
  import UserPageLayout from '$lib/components/layouts/UserPageLayout.svelte';
  import ButtonContextMenu from '$lib/components/shared-components/context-menu/ButtonContextMenu.svelte';
  import MenuOption from '$lib/components/shared-components/context-menu/MenuOption.svelte';
  import SpaceHero from '$lib/components/spaces/space-hero.svelte';
  import SpaceTabs from '$lib/components/spaces/space-tabs.svelte';
  import { authManager } from '$lib/managers/auth-manager.svelte';
  import { spaceUiManager } from '$lib/managers/space-ui-manager.svelte';
  import SpaceEditModal from '$lib/modals/SpaceEditModal.svelte';
  import { Route } from '$lib/route';
  import { handleError } from '$lib/utils/handle-error';
  import { getSearchablePageState } from '$lib/utils/searchable-page-search';
  import {
    bulkAddAssets,
    removeMember,
    removeSpace,
    SharedSpaceRole,
    updateMemberPreferences,
    updateMemberTimeline,
    updateSpace,
    UserAvatarColor,
  } from '@immich/sdk';
  import { Button, IconButton, modalManager, toastManager } from '@immich/ui';
  import {
    mdiArrowLeft,
    mdiDeleteOutline,
    mdiDotsVertical,
    mdiExitToApp,
    mdiEyeOffOutline,
    mdiEyeOutline,
    mdiFaceRecognition,
    mdiImageMultipleOutline,
    mdiImagePlusOutline,
    mdiPaw,
    mdiPencilOutline,
  } from '@mdi/js';
  import type { Snippet } from 'svelte';
  import { t } from 'svelte-i18n';
  import type { LayoutData } from './$types';

  interface Props {
    data: LayoutData;
    children?: Snippet;
  }

  let { data, children }: Props = $props();

  const space = $derived(data.space);
  const members = $derived(data.members);
  const base = $derived(`/spaces/${space.id}`);

  const currentMember = $derived(members.find((m) => m.userId === authManager.user.id));
  const isOwner = $derived(currentMember?.role === SharedSpaceRole.Owner);
  const isEditor = $derived(
    currentMember?.role === SharedSpaceRole.Owner || currentMember?.role === SharedSpaceRole.Editor,
  );
  const showInTimeline = $derived(currentMember?.showInTimeline ?? true);
  const sharePersonMetadata = $derived(currentMember?.sharePersonMetadata ?? true);

  // L16: departing members' own albums are auto-unlinked on leave (cleanupDepartingMemberAlbums) —
  // warn upfront when the current member has any, so leaving isn't a surprise for the space's
  // other members.
  const hasOwnLinkedAlbums = $derived(data.linkedAlbums.some((album) => album.addedById === authManager.user.id));

  // A detail route (person or album) suppresses the cover + tabs; it keeps its own back nav.
  const suffix = $derived(page.url.pathname.slice(base.length));
  const isDetailRoute = $derived(/^\/(people|albums)\/[^/]+/.test(suffix));
  const showChrome = $derived(!isDetailRoute && !spaceUiManager.chromeHidden);

  // The cover (SpaceHero) is tall + scroll-collapsible on the Photos route, compact on other tabs.
  let repositioning = $state(false);
  const onPhotosTab = $derived(page.url.pathname === base || page.url.pathname.startsWith(`${base}/photos`));

  // It is compact on the Photos route too while a search is showing results — a results view leads
  // with the results. A phone leaves the space ~520 CSS px of page height, and a tall cover stacked
  // with the app bar, tabs and search header left the grid a sliver of it (#1028). The query is read
  // from the URL (`?q=`), the same source the Photos page commits it from.
  const searchActive = $derived(onPhotosTab && getSearchablePageState(page.url).query.length > 0);

  // No-cover spaces fall back to a per-space colored gradient derived from space.color.
  const gradientClasses: Record<string, string> = {
    [UserAvatarColor.Primary]: 'from-immich-primary/60 to-immich-primary',
    [UserAvatarColor.Pink]: 'from-pink-300 to-pink-500',
    [UserAvatarColor.Red]: 'from-red-400 to-red-600',
    [UserAvatarColor.Yellow]: 'from-yellow-300 to-yellow-500',
    [UserAvatarColor.Blue]: 'from-blue-400 to-blue-600',
    [UserAvatarColor.Green]: 'from-green-400 to-green-700',
    [UserAvatarColor.Purple]: 'from-purple-400 to-purple-700',
    [UserAvatarColor.Orange]: 'from-orange-400 to-orange-600',
    [UserAvatarColor.Gray]: 'from-gray-400 to-gray-600',
    [UserAvatarColor.Amber]: 'from-amber-400 to-amber-600',
  };

  const spaceGradient = $derived(gradientClasses[space.color ?? 'primary'] ?? gradientClasses[UserAvatarColor.Primary]);

  const handleChangeCover = () => {
    spaceUiManager.requestChangeCover();
    if (page.url.pathname !== base) {
      void goto(base);
    }
  };

  const handleSavePosition = async (cropY: number) => {
    try {
      await updateSpace({ id: space.id, sharedSpaceUpdateDto: { thumbnailCropY: cropY } });
      repositioning = false;
      await invalidateAll();
      toastManager.success($t('space_cover_updated'));
    } catch (error) {
      handleError(error, $t('errors.unable_to_update_space_cover'));
    }
  };

  const handleEditSpace = async () => {
    const updated = await modalManager.show(SpaceEditModal, { space });
    if (updated) {
      await invalidateAll();
    }
  };

  const handleAddPhotos = () => {
    spaceUiManager.requestAddPhotos();
    if (page.url.pathname !== base) {
      void goto(base);
    }
  };

  const handleToggleTimeline = async () => {
    try {
      await updateMemberTimeline({
        id: space.id,
        sharedSpaceMemberTimelineDto: { showInTimeline: !showInTimeline },
      });
      await invalidateAll();
    } catch (error) {
      handleError(error, $t('errors.unable_to_update_timeline_display_status'));
    }
  };

  const handleTogglePersonMetadataSharing = async () => {
    try {
      await updateMemberPreferences({
        id: space.id,
        sharedSpaceMemberPreferencesDto: { sharePersonMetadata: !sharePersonMetadata },
      });
      await invalidateAll();
    } catch (error) {
      handleError(error, $t('errors.unable_to_update_person_metadata_sharing'));
    }
  };

  const handleBulkAddAssets = async () => {
    const confirmed = await modalManager.showDialog({
      title: $t('add_all_photos'),
      prompt: $t('bulk_add_confirmation'),
    });
    if (!confirmed) {
      return;
    }
    try {
      await bulkAddAssets({ id: space.id });
      toastManager.success($t('bulk_add_started'));
    } catch (error) {
      handleError(error, $t('errors.error_adding_assets_to_space'));
    }
  };

  const handleTogglePets = async () => {
    try {
      await updateSpace({ id: space.id, sharedSpaceUpdateDto: { petsEnabled: !space.petsEnabled } });
      await invalidateAll();
    } catch (error) {
      handleError(error, $t('spaces_toggle_pets_failed'));
    }
  };

  const handleLeave = async () => {
    const confirmed = await modalManager.showDialog({
      prompt: $t(hasOwnLinkedAlbums ? 'spaces_leave_confirmation_with_albums' : 'spaces_leave_confirmation', {
        values: { name: space.name },
      }),
      title: $t('spaces_leave'),
    });
    if (!confirmed) {
      return;
    }
    try {
      await removeMember({ id: space.id, userId: authManager.user.id });
      toastManager.success($t('spaces_leave_success', { values: { name: space.name } }));
      await goto(Route.spaces());
    } catch (error) {
      handleError(error, $t('spaces_leave_failed'));
    }
  };

  const handleDelete = async () => {
    const confirmed = await modalManager.showDialog({
      prompt: $t('spaces_delete_confirmation', { values: { name: space.name } }),
      title: $t('spaces_delete'),
    });
    if (!confirmed) {
      return;
    }
    await removeSpace({ id: space.id });
    await goto(Route.spaces());
  };
</script>

{#if isDetailRoute}
  <!-- Person/album detail pages render their OWN UserPageLayout; the shell defers to them
       entirely so the app doesn't nest inside itself. -->
  {@render children?.()}
{:else}
  <UserPageLayout hideNavbar={spaceUiManager.chromeHidden} title={space.name} scrollbar={false}>
    {#snippet leading()}
      {#if !spaceUiManager.chromeHidden}
        <IconButton
          variant="ghost"
          shape="round"
          color="secondary"
          aria-label={$t('back')}
          onclick={() => goto(Route.spaces())}
          icon={mdiArrowLeft}
        />
      {/if}
    {/snippet}

    {#snippet buttons()}
      {#if !spaceUiManager.chromeHidden}
        <div class="flex items-center gap-1">
          {#if isEditor}
            <!-- Mockup: a labeled primary "＋ Add photos" button; text hides on narrow widths → icon only. -->
            <Button
              size="small"
              leadingIcon={mdiImagePlusOutline}
              onclick={handleAddPhotos}
              aria-label={$t('add_photos')}
              data-testid="space-add-photos"
            >
              <span class="hidden sm:inline">{$t('add_photos')}</span>
            </Button>
          {/if}
          <ButtonContextMenu
            direction="left"
            align="top-right"
            color="secondary"
            title={$t('more')}
            icon={mdiDotsVertical}
            data-testid="space-overflow"
          >
            <MenuOption
              text={showInTimeline ? $t('spaces_hide_from_timeline') : $t('spaces_show_on_timeline')}
              icon={showInTimeline ? mdiEyeOutline : mdiEyeOffOutline}
              onClick={handleToggleTimeline}
            />
            <MenuOption
              text={sharePersonMetadata
                ? $t('spaces_stop_sharing_person_metadata')
                : $t('spaces_share_person_metadata')}
              icon={mdiFaceRecognition}
              onClick={handleTogglePersonMetadataSharing}
            />
            {#if isEditor}
              <hr class="my-1 border-gray-300" />
              <MenuOption text={$t('spaces_edit')} icon={mdiPencilOutline} onClick={handleEditSpace} />
              <MenuOption text={$t('add_all_photos')} icon={mdiImageMultipleOutline} onClick={handleBulkAddAssets} />
            {/if}
            {#if currentMember && !isOwner}
              <hr class="my-1 border-gray-300" />
              <MenuOption
                text={$t('spaces_leave')}
                icon={mdiExitToApp}
                textColor="text-red-500"
                onClick={handleLeave}
              />
            {/if}
            {#if isOwner}
              {#if space.faceRecognitionEnabled && space.hasPets}
                <hr class="my-1 border-gray-300" />
                <MenuOption
                  text={space.petsEnabled ? $t('spaces_hide_pets') : $t('spaces_show_pets')}
                  icon={mdiPaw}
                  onClick={handleTogglePets}
                />
              {/if}
              <hr class="my-1 border-gray-300" />
              <MenuOption
                text={$t('spaces_delete')}
                icon={mdiDeleteOutline}
                textColor="text-red-500"
                onClick={handleDelete}
              />
            {/if}
          </ButtonContextMenu>
        </div>
      {/if}
    {/snippet}

    <div class="flex h-full flex-col">
      {#if showChrome}
        <SpaceHero
          {space}
          assetCount={space.assetCount ?? 0}
          gradientClass={spaceGradient}
          currentRole={currentMember?.role}
          canEdit={isEditor}
          onChangeCover={handleChangeCover}
          onEditSpace={handleEditSpace}
          onReposition={() => (repositioning = true)}
          {repositioning}
          onSavePosition={handleSavePosition}
          onCancelReposition={() => (repositioning = false)}
          compact={!onPhotosTab || searchActive}
          collapsed={onPhotosTab && spaceUiManager.coverCollapsed}
        />
        <SpaceTabs
          spaceId={space.id}
          faceRecognitionEnabled={space.faceRecognitionEnabled}
          photoCount={space.assetCount ?? 0}
          albumCount={data.linkedAlbums.length}
          memberCount={members.length}
          isAdmin={authManager.user?.isAdmin ?? false}
          libraryCount={space.linkedLibraries?.length ?? 0}
        />
      {/if}
      <div class="min-h-0 flex-1">
        {@render children?.()}
      </div>
    </div>
  </UserPageLayout>
{/if}
