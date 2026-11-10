<script lang="ts">
  import DetailPanelDate from '#lib/components/asset-viewer/DetailPanelDate.svelte';
  import DetailPanelDescription from '#lib/components/asset-viewer/DetailPanelDescription.svelte';
  import DetailPanelLocation from '#lib/components/asset-viewer/DetailPanelLocation.svelte';
  import DetailPanelPeople from '#lib/components/asset-viewer/DetailPanelPeople.svelte';
  import DetailPanelRating from '#lib/components/asset-viewer/DetailPanelStarRating.svelte';
  import DetailPanelTags from '#lib/components/asset-viewer/DetailPanelTags.svelte';
  import { timeToLoadTheMap } from '#lib/constants.ts';
  import AppearsInAlbum from '#lib/gallery/asset-viewer/AppearsInAlbum.svelte';
  import FilterValue from '#lib/gallery/asset-viewer/FilterValue.svelte';
  import MapProviderLinks from '#lib/gallery/asset-viewer/MapProviderLinks.svelte';
  import SpacePeopleSidePanel from '#lib/gallery/asset-viewer/SpacePeopleSidePanel.svelte';
  import { useAssetSpace } from '#lib/gallery/asset-viewer/asset-space.ts';
  import {
    cameraFilter,
    filenameFilter,
    getOpenInMapView,
    lensFilter,
    ownerFilter,
  } from '#lib/gallery/asset-viewer/detail-panel-filters.ts';
  import { assetViewerManager } from '#lib/managers/asset-viewer-manager.svelte.ts';
  import { authManager } from '#lib/managers/auth-manager.svelte.ts';
  import { getAlbumsByAssetQuery } from '#lib/queries/album.query.ts';
  import { createPreloadedQuery, queryClient } from '#lib/queries/client.ts';
  import { getPublicConfigQuery } from '#lib/queries/config-public.query.ts';
  import { Route } from '#lib/route.ts';
  import { locale } from '#lib/stores/preferences.store.ts';
  import { truncateMiddle } from '#lib/utils.ts';
  import { canEditAsset } from '#lib/utils/asset-editability.ts';
  import { delay, getDimensions } from '#lib/utils/asset-utils.ts';
  import { getByteUnitString } from '#lib/utils/byte-units.ts';
  import { getCameraName } from '#lib/utils/camera-utils.ts';
  import { lazyComponent } from '#lib/utils/lazy-component.svelte.ts';
  import { refreshAssetPeople } from '#lib/utils/refresh-asset-people.ts';
  import { getParentPath } from '#lib/utils/tree-utils.ts';
  import { type AlbumResponseDto, type AssetResponseDto } from '@immich/sdk';
  import { Icon, IconButton, LoadingSpinner, Text } from '@immich/ui';
  import { mdiCamera, mdiCameraIris, mdiClose, mdiImageOutline, mdiInformationOutline } from '@mdi/js';
  import { createQuery } from '@tanstack/svelte-query';
  import { onDestroy } from 'svelte';
  import { t } from 'svelte-i18n';
  import { slide } from 'svelte/transition';
  import PersonSidePanel from '../faces-page/PersonSidePanel.svelte';
  import UserAvatar from '../shared-components/UserAvatar.svelte';

  const query = createPreloadedQuery(getPublicConfigQuery);
  const publicConfig = $derived(query.data);

  interface Props {
    asset: AssetResponseDto;
    currentAlbum?: AlbumResponseDto | null;
  }

  let { asset, currentAlbum = null }: Props = $props();
  const assetSpace = useAssetSpace(() => asset);

  let isOwner = $derived(authManager.authenticated && authManager.user.id === asset.ownerId);
  // #734: a space Owner/Editor may edit a member's asset (server-authoritative `asset.canEdit`).
  let canEdit = $derived(canEditAsset(asset, { userId: authManager.authenticated ? authManager.user.id : undefined }));
  // R4/E2 — shared links get NO filter affordance at all (they have no timeline to land on).
  let canFilter = $derived(!authManager.isSharedLink);

  let latlng = $derived(
    (() => {
      const lat = asset.exifInfo?.latitude;
      const lng = asset.exifInfo?.longitude;

      if (lat && lng) {
        return { lat: Number(lat.toFixed(7)), lng: Number(lng.toFixed(7)) };
      }
    })(),
  );
  let previousId: string | undefined = $state();
  let previousRoute = $derived(currentAlbum?.id ? Route.viewAlbum(currentAlbum) : Route.photos());

  const albumsQuery = createQuery(
    () => ({ ...getAlbumsByAssetQuery(asset.id), enabled: !authManager.isSharedLink }),
    () => queryClient,
  );
  const albums = $derived(albumsQuery.data ?? []);

  $effect(() => {
    if (!previousId) {
      previousId = asset.id;
      return;
    }

    if (asset.id === previousId) {
      return;
    }

    assetViewerManager.closeEditFacesPanel();
    previousId = asset.id;
  });

  const getMegapixel = (width: number, height: number): number | undefined => {
    const megapixel = Math.round((height * width) / 1_000_000);

    if (megapixel) {
      return megapixel;
    }

    return undefined;
  };

  const handleRefreshPeople = async () => {
    // Also refreshes the asset itself, which assigning `asset` here would not reach (see refreshAssetPeople).
    await refreshAssetPeople(asset.id, assetSpace.spaceId);
    assetViewerManager.closeEditFacesPanel();
  };

  const getAssetFolderHref = (asset: AssetResponseDto) => {
    // Remove the last part of the path to get the parent path
    return Route.folders({ path: getParentPath(asset.originalPath) });
  };

  onDestroy(() => {
    assetViewerManager.closeEditFacesPanel();
  });

  // Mounting the map through `{#await}` can leave the surrounding subtree unreactive.
  // See lazyComponent().
  const LazyMap = lazyComponent(() => import('#lib/components/shared-components/map/Map.svelte'));
</script>

{#if !assetViewerManager.isEditFacesPanelOpen}
  <section class="relative p-2">
    <div class="flex place-items-center gap-2">
      <IconButton
        icon={mdiClose}
        aria-label={$t('close')}
        onclick={() => assetViewerManager.closeDetailPanel()}
        shape="round"
        color="secondary"
        variant="ghost"
      />
      <p class="text-lg text-immich-fg dark:text-immich-dark-fg">{$t('info')}</p>
    </div>

    {#if asset.isOffline}
      <section class="p-4">
        <div role="alert">
          <div class="rounded-t bg-red-500 px-4 py-2 font-bold text-white">
            {$t('asset_offline')}
          </div>
          <div class="border border-t-0 border-red-400 bg-red-100 px-4 py-3 text-red-700">
            <p>
              {#if authManager.authenticated && authManager.user.isAdmin}
                {$t('admin.asset_offline_description')}
              {:else}
                {$t('asset_offline_description')}
              {/if}
            </p>
          </div>
          <div class="rounded-b bg-red-500 px-4 py-2 text-sm text-white">
            <p>{asset.originalPath}</p>
          </div>
        </div>
      </section>
    {/if}

    <DetailPanelDescription {asset} isOwner={canEdit} {canFilter} />
    <DetailPanelRating {asset} isOwner={canEdit} {canFilter} />
    <DetailPanelPeople
      {asset}
      {isOwner}
      canEditSpacePeople={assetSpace.canEditSpacePeople}
      {canFilter}
      {previousRoute}
      spaceId={assetSpace.spaceId}
    />

    <div class="p-4">
      {#if asset.exifInfo}
        <div class="flex h-10 w-full items-center justify-between text-sm">
          <Text size="small" color="muted">{$t('details')}</Text>
        </div>
      {:else}
        <Text size="small" color="muted">{$t('no_exif_info_available')}</Text>
      {/if}

      <DetailPanelDate {asset} isOwner={canEdit} {canFilter} />

      <div class="flex gap-4 py-4" data-testid="detail-panel-filename">
        <div><Icon icon={mdiImageOutline} size="24" /></div>

        <div>
          <div class="flex place-items-start justify-end gap-2 break-all whitespace-pre-wrap">
            <FilterValue
              label={$t('filter_by_filename')}
              filter={filenameFilter(asset)}
              class="break-all whitespace-pre-wrap"
            >
              <span title={asset.originalFileName}>{truncateMiddle(asset.originalFileName)}</span>
            </FilterValue>
            {#if asset.originalPath}
              <IconButton
                icon={mdiInformationOutline}
                aria-label={$t('show_file_location')}
                class="shrink-0"
                size="small"
                shape="round"
                color="secondary"
                variant="ghost"
                onclick={() => assetViewerManager.toggleAssetPath()}
              />
            {/if}
          </div>
          {#if assetViewerManager.isShowAssetPath}
            <p class="pb-2 text-xs break-all opacity-50 hover:text-primary" transition:slide={{ duration: 250 }}>
              <!-- eslint-disable-next-line svelte/no-navigation-without-resolve this is supposed to be treated as an absolute/external link -->
              <a href={getAssetFolderHref(asset)} title={$t('go_to_folder')} class="whitespace-pre-wrap">
                {asset.originalPath}
              </a>
            </p>
          {/if}
          {#if (asset.exifInfo?.exifImageHeight && asset.exifInfo.exifImageWidth) || asset.exifInfo?.fileSizeInByte}
            <div class="flex gap-2 text-sm">
              {#if asset.exifInfo?.exifImageHeight && asset.exifInfo.exifImageWidth}
                {#if getMegapixel(asset.exifInfo.exifImageHeight, asset.exifInfo.exifImageWidth)}
                  <p>
                    {getMegapixel(asset.exifInfo.exifImageHeight, asset.exifInfo.exifImageWidth)} MP
                  </p>
                {/if}
                {const { width, height } = $derived(getDimensions(asset.exifInfo))}
                <p>{width} × {height}</p>
              {/if}
              {#if asset.exifInfo?.fileSizeInByte}
                <p>{getByteUnitString(asset.exifInfo.fileSizeInByte, $locale)}</p>
              {/if}
            </div>
          {/if}
        </div>
      </div>

      {#if asset.exifInfo?.make || asset.exifInfo?.model || asset.exifInfo?.exposureTime || asset.exifInfo?.iso}
        <div class="flex gap-4 py-4" data-testid="detail-panel-camera">
          <div><Icon icon={mdiCamera} size="24" /></div>

          <div>
            {#if asset.exifInfo?.make || asset.exifInfo?.model}
              {const cameraName = $derived(getCameraName(asset.exifInfo.make, asset.exifInfo.model))}
              <p class="flex items-center gap-1">
                <FilterValue label={$t('filter_by_camera')} filter={cameraFilter(asset)} searchEverywhere>
                  {cameraName}
                </FilterValue>
              </p>
            {/if}

            <div class="flex gap-2 text-sm">
              {#if asset.exifInfo.exposureTime}
                <p>{`${asset.exifInfo.exposureTime} s`}</p>
              {/if}

              {#if asset.exifInfo.iso}
                <p>{`ISO ${asset.exifInfo.iso}`}</p>
              {/if}
            </div>
          </div>
        </div>
      {/if}

      {#if asset.exifInfo?.lensModel || asset.exifInfo?.fNumber || asset.exifInfo?.focalLength}
        <div class="flex gap-4 py-4" data-testid="detail-panel-lens">
          <div><Icon icon={mdiCameraIris} size="24" /></div>

          <div>
            {#if asset.exifInfo?.lensModel}
              <p class="flex items-center gap-1">
                <FilterValue
                  label={$t('filter_by_lens')}
                  filter={lensFilter(asset)}
                  class="line-clamp-1"
                  searchEverywhere
                >
                  {asset.exifInfo.lensModel}
                </FilterValue>
              </p>
            {/if}

            <div class="flex gap-2 text-sm">
              {#if asset.exifInfo?.fNumber}
                <p>ƒ/{asset.exifInfo.fNumber.toLocaleString($locale)}</p>
              {/if}

              {#if asset.exifInfo.focalLength}
                <p>{`${asset.exifInfo.focalLength.toLocaleString($locale)} mm`}</p>
              {/if}
            </div>
          </div>
        </div>
      {/if}

      <DetailPanelLocation isOwner={canEdit} {canFilter} {asset} />
    </div>
  </section>

  {#if latlng && publicConfig.map.enabled}
    <div class="h-90">
      {#if LazyMap.current}
        {const Map = $derived(LazyMap.current)}
        <Map
          mapMarkers={[
            {
              lat: latlng.lat,
              lon: latlng.lng,
              id: asset.id,
              city: asset.exifInfo?.city ?? null,
              state: asset.exifInfo?.state ?? null,
              country: asset.exifInfo?.country ?? null,
            },
          ]}
          center={latlng}
          showSettings={false}
          zoom={12.5}
          simplified
          useLocationPin
          showSimpleControls={!assetViewerManager.isEditFacesPanelOpen}
          onOpenInMapView={getOpenInMapView(latlng)}
        >
          {#snippet popup({ marker })}
            <div class="flex flex-col items-center gap-1">
              {const { lat, lon } = $derived(marker)}
              <Text fontWeight="bold">{lat.toPrecision(6)}, {lon.toPrecision(6)}</Text>
              <MapProviderLinks {lat} {lon} />
            </div>
          {/snippet}
        </Map>
      {:else}
        {#await delay(timeToLoadTheMap) then}
          <!-- show the loading spinner only if loading the map takes too much time -->
          <div class="flex size-full items-center justify-center">
            <LoadingSpinner />
          </div>
        {/await}
      {/if}
    </div>
  {/if}

  {#if currentAlbum && currentAlbum.albumUsers.length > 1 && asset.owner}
    <section class="mt-4 px-6 dark:text-immich-dark-fg">
      <Text size="small" color="muted">{$t('shared_by')}</Text>
      <div class="flex gap-4 pt-4">
        <div>
          <UserAvatar user={asset.owner} size="md" />
        </div>

        <div class="my-auto">
          <p>
            <FilterValue label={$t('filter_by_owner')} filter={ownerFilter(asset)}>
              {asset.owner.name}
            </FilterValue>
          </p>
        </div>
      </div>
    </section>
  {/if}

  {#if albums.length > 0}
    <section class="p-6 dark:text-immich-dark-fg">
      <div class="pb-4">
        <Text size="small" color="muted">{$t('appears_in')}</Text>
      </div>
      {#each albums as album (album.id)}
        <AppearsInAlbum {album} />
      {/each}
    </section>
  {/if}

  {#if authManager.authenticated && authManager.preferences.tags.enabled}
    <section class="relative px-2 pb-12 dark:bg-immich-dark-bg dark:text-immich-dark-fg">
      <DetailPanelTags {asset} {isOwner} {canEdit} {canFilter} spaceId={assetSpace.spaceId} />
    </section>
  {/if}
{/if}

<!-- The owner and space panels call different endpoints, so they never both render (Slice 8). -->
{#if assetViewerManager.isEditFacesPanelOpen && assetSpace.canEditSpacePeople && assetSpace.spaceId}
  <SpacePeopleSidePanel {asset} spaceId={assetSpace.spaceId} />
{:else if assetViewerManager.isEditFacesPanelOpen}
  <PersonSidePanel
    assetId={asset.id}
    assetType={asset.type}
    onClose={() => assetViewerManager.closeEditFacesPanel()}
    onRefresh={handleRefreshPeople}
  />
{/if}
