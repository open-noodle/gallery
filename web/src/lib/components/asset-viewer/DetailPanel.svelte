<script lang="ts">
  import { lazyComponent } from '$lib/utils/lazy-component.svelte';
  import { goto } from '$app/navigation';
  import { page } from '$app/state';
  import DetailPanelDate from '$lib/components/asset-viewer/DetailPanelDate.svelte';
  import DetailPanelDescription from '$lib/components/asset-viewer/DetailPanelDescription.svelte';
  import DetailPanelLocation from '$lib/components/asset-viewer/DetailPanelLocation.svelte';
  import DetailPanelRating from '$lib/components/asset-viewer/DetailPanelStarRating.svelte';
  import DetailPanelTags from '$lib/components/asset-viewer/DetailPanelTags.svelte';
  import { timeToLoadTheMap } from '$lib/constants';
  import { assetViewerManager } from '$lib/managers/asset-viewer-manager.svelte';
  import { authManager } from '$lib/managers/auth-manager.svelte';
  import { featureFlagsManager } from '$lib/managers/feature-flags-manager.svelte';
  import { Route } from '$lib/route';
  import { locale } from '$lib/stores/preferences.store';
  import { getAssetMediaUrl } from '$lib/utils';
  import { delay, getDimensions } from '$lib/utils/asset-utils';
  import { getByteUnitString } from '$lib/utils/byte-units';
  import { getMapProviderLinks } from '$lib/utils/exif-utils';
  import { applyContextualFilter, buildContextualMapUrl, resolveFilterTarget } from '$lib/utils/filter-target';
  import { handleError } from '$lib/utils/handle-error';
  import { getParentPath } from '$lib/utils/tree-utils';
  import {
    AssetMediaSize,
    getAllAlbums,
    getAssetInfo,
    type AlbumResponseDto,
    type AssetResponseDto,
  } from '@immich/sdk';
  import { Icon, IconButton, Link, Text } from '@immich/ui';
  import {
    mdiCamera,
    mdiCameraIris,
    mdiClose,
    mdiFilterOutline,
    mdiImageOutline,
    mdiInformationOutline,
    mdiMagnify,
  } from '@mdi/js';
  import { onDestroy } from 'svelte';
  import { t } from 'svelte-i18n';
  import { slide } from 'svelte/transition';
  import PersonSidePanel from '../faces-page/PersonSidePanel.svelte';
  import OnEvents from '../OnEvents.svelte';
  import UserAvatar from '../shared-components/UserAvatar.svelte';
  import AlbumListItemDetails from './AlbumListItemDetails.svelte';
  import DetailPanelPeople from '$lib/components/asset-viewer/DetailPanelPeople.svelte';
  import { faceManager } from '$lib/stores/face.svelte';
  import LoadingSpinner from '$lib/components/shared-components/LoadingSpinner.svelte';

  interface Props {
    asset: AssetResponseDto;
    currentAlbum?: AlbumResponseDto | null;
    spaceId?: string;
  }

  let { asset, currentAlbum = null, spaceId }: Props = $props();
  let effectiveSpaceId = $derived(spaceId || asset.resolvedSpaceId);

  let isOwner = $derived(authManager.authenticated && authManager.user.id === asset.ownerId);

  // R4/E2 — shared links get NO filter affordance at all (they have no /photos to land on).
  // Threaded down to child rows the same way `isOwner` is; camera/lens live inline here.
  let canFilter = $derived(!authManager.isSharedLink);

  let filterTarget = $derived(resolveFilterTarget(page.url));

  // E5 — the 🔍 "search everywhere" icon is redundant (a no-op) when already on /photos.
  let isOnPhotos = $derived(filterTarget?.kind === 'photos');

  /**
   * E9 — an album surface offers NO `albumId` filter affordance at all, for any album.
   *
   * buildAlbumTimelineOptions never forwards `albumId` (the route already scopes the query), while
   * getActiveFilterCount counts it and a chip renders. So on /albums/A, filtering by album B would
   * show a "1 filter" badge and a removable B chip over a grid that is still the whole of A — a
   * filter the UI claims is active but the server never sees. Filtering album A by album B is not
   * a query the album timeline can express, so we do not offer it.
   */
  let isOnAlbum = $derived(filterTarget?.kind === 'album');
  // A space-scoped map cannot represent an album filter — space ∩ album is unsatisfiable and the
  // server 400s it (hydrateMapFilters drops albumId there). Treat it like the album surface and
  // withhold the album filter affordance, so we never offer a control that silently does nothing.
  let albumFilterUnsupported = $derived(isOnAlbum || (filterTarget?.kind === 'map' && !!filterTarget.spaceId));

  // R9/E6/E7 — a value that is empty or whitespace-only trims to nothing (filter-url.ts's
  // setTrimmed), so it must not render as a clickable filter affordance: the click would close the
  // viewer and apply no filter at all.
  let cameraLabel = $derived(
    [asset.exifInfo?.make, asset.exifInfo?.model]
      .map((value) => value?.trim())
      .filter(Boolean)
      .join(' '),
  );
  let lensLabel = $derived(asset.exifInfo?.lensModel?.trim() ?? '');

  const cameraFilterPatch = () => ({
    make: asset.exifInfo?.make ?? undefined,
    model: asset.exifInfo?.model ?? undefined,
  });
  const lensFilterPatch = () => ({ lensModel: asset.exifInfo?.lensModel ?? undefined });

  /**
   * The filename WITHOUT its extension — that is what surfaces a RAW/JPEG pair (IMG_1234.CR3 +
   * IMG_1234.jpg) and edited variants of the same shot, which is the whole point of the filter.
   *
   * Only the LAST dot is an extension separator (`my.photo.v2.jpg` → `my.photo.v2`), and a
   * leading-dot name (`.jpg`) has an EMPTY basename — R9: no affordance is rendered for it.
   */
  const getFilenameBasename = (filename: string) => {
    const lastDot = filename.lastIndexOf('.');
    return (lastDot === -1 ? filename : filename.slice(0, lastDot)).trim();
  };

  let filenameBasename = $derived(getFilenameBasename(asset.originalFileName));

  let latlng = $derived(
    (() => {
      const lat = asset.exifInfo?.latitude;
      const lng = asset.exifInfo?.longitude;

      if (lat && lng) {
        return { lat: Number(lat.toFixed(7)), lng: Number(lng.toFixed(7)) };
      }
    })(),
  );
  /**
   * #767 class — the embedded map's "open in map view" control used to call Route.map({...latlng})
   * directly, dropping the Space scope AND every active filter (and it would have landed an album
   * viewer on the global map). It reuses buildContextualMapUrl now, exactly like the location row's
   * pin: null (→ no control at all) on an album, which has no map URL to be honest with.
   */
  let mapViewUrl = $derived(latlng && canFilter ? buildContextualMapUrl(page.url, { ...latlng, zoom: 12.5 }) : null);

  let previousId: string | undefined = $state();
  let previousRoute = $derived(currentAlbum?.id ? Route.viewAlbum(currentAlbum) : Route.photos());

  const refreshAlbums = async () => {
    if (authManager.isSharedLink) {
      return [];
    }

    try {
      return await getAllAlbums({ assetId: asset.id });
    } catch (error) {
      handleError(error, 'Error getting asset album membership');
      return [];
    }
  };

  let albums = $derived(refreshAlbums());

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
    asset = await getAssetInfo({ id: asset.id, spaceId: effectiveSpaceId });
    assetViewerManager.closeEditFacesPanel();
    faceManager.clear();
    await faceManager.getAssetFaces(asset.id);
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
  const LazyMap = lazyComponent(() => import('$lib/components/shared-components/map/Map.svelte'));
</script>

<OnEvents onAlbumAddAssets={() => (albums = refreshAlbums())} />

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

    <DetailPanelDescription {asset} {isOwner} {canFilter} />
    <DetailPanelRating {asset} {isOwner} {canFilter} />
    <DetailPanelPeople {asset} {isOwner} {canFilter} {previousRoute} spaceId={effectiveSpaceId} />

    <div class="p-4">
      {#if asset.exifInfo}
        <div class="flex h-10 w-full items-center justify-between text-sm">
          <Text size="small" color="muted">{$t('details')}</Text>
        </div>
      {:else}
        <Text size="small" color="muted">{$t('no_exif_info_available')}</Text>
      {/if}

      <DetailPanelDate {asset} {isOwner} {canFilter} />

      <div class="flex gap-4 py-4" data-testid="detail-panel-filename">
        <div><Icon icon={mdiImageOutline} size="24" /></div>

        <div>
          <p class="flex place-items-center gap-2 break-all whitespace-pre-wrap">
            {#if canFilter && filenameBasename}
              <button
                type="button"
                class="text-left break-all whitespace-pre-wrap hover:text-primary"
                aria-label="{$t('filter_by_filename')}: {filenameBasename}"
                onclick={() => applyContextualFilter({ originalFileName: filenameBasename })}
              >
                {asset.originalFileName}
              </button>
            {:else}
              {asset.originalFileName}
            {/if}
            {#if asset.originalPath}
              <IconButton
                icon={mdiInformationOutline}
                aria-label={$t('show_file_location')}
                size="small"
                shape="round"
                color="secondary"
                variant="ghost"
                onclick={() => assetViewerManager.toggleAssetPath()}
              />
            {/if}
          </p>
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
                {@const { width, height } = getDimensions(asset.exifInfo)}
                <p>{width} x {height}</p>
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
              <p class="flex items-center gap-1">
                {#if canFilter && cameraLabel}
                  <button
                    type="button"
                    class="text-left hover:text-primary"
                    aria-label="{$t('filter_by_camera')}: {cameraLabel}"
                    onclick={() => applyContextualFilter(cameraFilterPatch())}
                  >
                    {asset.exifInfo.make || ''}
                    {asset.exifInfo.model || ''}
                  </button>
                  {#if !isOnPhotos}
                    <IconButton
                      icon={mdiMagnify}
                      aria-label="{$t('search_everywhere')}: {cameraLabel}"
                      size="small"
                      shape="round"
                      color="secondary"
                      variant="ghost"
                      onclick={() => applyContextualFilter(cameraFilterPatch(), { global: true })}
                    />
                  {/if}
                {:else}
                  <span>{asset.exifInfo.make || ''} {asset.exifInfo.model || ''}</span>
                {/if}
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
                {#if canFilter && lensLabel}
                  <button
                    type="button"
                    class="line-clamp-1 text-left hover:text-primary"
                    aria-label="{$t('filter_by_lens')}: {lensLabel}"
                    onclick={() => applyContextualFilter(lensFilterPatch())}
                  >
                    {asset.exifInfo.lensModel}
                  </button>
                  {#if !isOnPhotos}
                    <IconButton
                      icon={mdiMagnify}
                      aria-label="{$t('search_everywhere')}: {lensLabel}"
                      size="small"
                      shape="round"
                      color="secondary"
                      variant="ghost"
                      onclick={() => applyContextualFilter(lensFilterPatch(), { global: true })}
                    />
                  {/if}
                {:else}
                  <span class="line-clamp-1">{asset.exifInfo.lensModel}</span>
                {/if}
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

      <DetailPanelLocation {isOwner} {canFilter} {asset} />
    </div>
  </section>

  {#if latlng && featureFlagsManager.value.map}
    <div class="h-90">
      {#if LazyMap.current}
        {@const Map = LazyMap.current}
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
          onOpenInMapView={mapViewUrl ? () => goto(mapViewUrl) : undefined}
        >
          {#snippet popup({ marker })}
            {@const { lat, lon } = marker}
            {@const mapProviderLinks = getMapProviderLinks(lat, lon)}
            <div class="flex flex-col items-center gap-1">
              <Text fontWeight="bold">{lat.toPrecision(6)}, {lon.toPrecision(6)}</Text>
              <div class="flex flex-col items-center gap-1">
                {#each mapProviderLinks as link (link.key)}
                  <Link href={link.url} class="text-primary">
                    {$t(link.label)}
                  </Link>
                {/each}
              </div>
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
          <!--
            E2 — unlike tags/people/rating/albums, this row is NOT shared-link-suppressed, so
            `canFilter` is the gate that actually does the work here.
          -->
          {#if canFilter}
            <button
              type="button"
              class="text-left hover:text-primary"
              aria-label="{$t('filter_by_owner')}: {asset.owner.name}"
              onclick={() => applyContextualFilter({ ownerId: asset.owner?.id })}
            >
              {asset.owner.name}
            </button>
          {:else}
            <p>
              {asset.owner.name}
            </p>
          {/if}
        </div>
      </div>
    </section>
  {/if}

  {#await albums then albums}
    {#if albums.length > 0}
      <section class="p-6 dark:text-immich-dark-fg">
        <div class="pb-4">
          <Text size="small" color="muted">{$t('appears_in')}</Text>
        </div>
        {#each albums as album (album.id)}
          <!--
            R6 — the whole card is an <a> to the album, so the filter cannot live on the value (a
            button nested inside an anchor is invalid HTML). The ⚗️ sits BESIDE the card.
          -->
          <div class="flex items-center gap-1">
            <a href={Route.viewAlbum(album)} class="min-w-0 flex-1">
              <div class="flex items-center gap-4 pt-2 hover:cursor-pointer">
                <div>
                  <img
                    alt={album.albumName}
                    class="size-12.5 rounded-sm object-cover"
                    src={album.albumThumbnailAssetId &&
                      getAssetMediaUrl({ id: album.albumThumbnailAssetId, size: AssetMediaSize.Preview })}
                    draggable="false"
                  />
                </div>

                <div class="my-auto">
                  <p class="dark:text-immich-dark-primary">{album.albumName}</p>
                  <div class="flex flex-col gap-0 text-sm">
                    <div>
                      <AlbumListItemDetails {album} />
                    </div>
                  </div>
                </div>
              </div>
            </a>
            {#if canFilter && !albumFilterUnsupported}
              <IconButton
                icon={mdiFilterOutline}
                aria-label="{$t('filter_by_album')}: {album.albumName}"
                size="small"
                shape="round"
                color="secondary"
                variant="ghost"
                onclick={() => applyContextualFilter({ albumId: album.id })}
              />
            {/if}
          </div>
        {/each}
      </section>
    {/if}
  {/await}

  {#if authManager.authenticated && authManager.preferences.tags.enabled}
    <section class="relative px-2 pb-12 dark:bg-immich-dark-bg dark:text-immich-dark-fg">
      <DetailPanelTags {asset} {isOwner} {canFilter} spaceId={effectiveSpaceId} />
    </section>
  {/if}
{/if}

{#if assetViewerManager.isEditFacesPanelOpen}
  <PersonSidePanel
    assetId={asset.id}
    assetType={asset.type}
    onClose={() => assetViewerManager.closeEditFacesPanel()}
    onRefresh={handleRefreshPeople}
  />
{/if}
