<script lang="ts">
  import OnEvents from '$lib/components/OnEvents.svelte';
  import DetailPanelDate from '$lib/components/asset-viewer/DetailPanelDate.svelte';
  import DetailPanelDescription from '$lib/components/asset-viewer/DetailPanelDescription.svelte';
  import DetailPanelLocation from '$lib/components/asset-viewer/DetailPanelLocation.svelte';
  import DetailPanelRating from '$lib/components/asset-viewer/DetailPanelStarRating.svelte';
  import DetailPanelTags from '$lib/components/asset-viewer/DetailPanelTags.svelte';
  import { assetCacheManager } from '$lib/managers/AssetCacheManager.svelte';
  import { authManager } from '$lib/managers/auth-manager.svelte';
  import { featureFlagsManager } from '$lib/managers/feature-flags-manager.svelte';
  import { canEditAsset } from '$lib/utils/asset-editability';
  import { getDimensions } from '$lib/utils/asset-utils';
  import { getByteUnitString } from '$lib/utils/byte-units';
  import { getGlobalPersonThumbnailUrl } from '$lib/utils/global-person-route';
  import { lazyComponent } from '$lib/utils/lazy-component.svelte';
  import { getAllAlbums, type AlbumResponseDto, type AssetResponseDto, type CleanupAssetDto } from '@immich/sdk';
  import { Icon, Text } from '@immich/ui';
  import { mdiCamera, mdiImageAlbum, mdiImageOutline } from '@mdi/js';
  import { DateTime } from 'luxon';
  import type { Snippet } from 'svelte';
  import { locale, t } from 'svelte-i18n';

  type Props = {
    /** The photo on stage. Its summary row draws the heading before the full record arrives. */
    photo: CleanupAssetDto;
    /** Photos shown next; their full records are fetched ahead so stepping forward is instant. */
    prefetchIds?: string[];
    /** Extra cards at the bottom (the cleanup hints). */
    children?: Snippet;
  };

  const { photo, prefetchIds = [], children }: Props = $props();

  // The full record, with the people, tags, EXIF and edit rights the summary row lacks.
  let asset = $state<AssetResponseDto>();
  let albums = $state<AlbumResponseDto[]>([]);
  // Plain bookkeeping, not state: the effect reads and writes it.
  let loadingFor: string | undefined;

  const load = async (id: string) => {
    loadingFor = id;
    try {
      const [loaded, memberships] = await Promise.all([
        assetCacheManager.getAsset({ id }),
        getAllAlbums({ assetId: id }).catch(() => [] as AlbumResponseDto[]),
      ]);
      if (loadingFor === id) {
        asset = loaded;
        albums = memberships;
      }
    } catch {
      // The heading still shows from the summary row; the rest stays empty.
    }
  };

  $effect(() => {
    const id = photo.id;
    if (loadingFor === id) {
      return;
    }
    if (asset?.id !== id) {
      asset = undefined;
      albums = [];
    }
    void load(id);
  });

  $effect(() => {
    for (const id of prefetchIds) {
      void assetCacheManager.getAsset({ id }).catch(() => {});
    }
  });

  // A date or tag change made from this panel arrives as an update event; reload so the rows follow.
  const onAssetUpdate = (updated: AssetResponseDto) => {
    if (updated.id === photo.id) {
      loadingFor = undefined;
      void load(updated.id);
    }
  };

  const userId = $derived(authManager.authenticated ? authManager.user.id : undefined);
  const isOwner = $derived(!!asset && asset.ownerId === userId);
  const canEdit = $derived(!!asset && canEditAsset(asset, { userId }));

  // localDateTime is the wall-clock capture time serialised as UTC, so it is read back in UTC.
  const taken = $derived(DateTime.fromISO(photo.localDateTime, { zone: 'utc' }).setLocale($locale ?? 'en'));
  const yearsAgo = $derived(new Date().getFullYear() - taken.year);

  const namedPeople = $derived((asset?.people ?? []).filter((person) => person.name?.trim()));
  const unnamedCount = $derived((asset?.people ?? []).length - namedPeople.length);

  const fileLine = $derived.by(() => {
    const exif = asset?.exifInfo;
    const parts: string[] = [];
    if (exif?.exifImageWidth && exif.exifImageHeight) {
      const megapixel = Math.round((exif.exifImageWidth * exif.exifImageHeight) / 1_000_000);
      if (megapixel > 0) {
        parts.push(`${megapixel} MP`);
      }
      const { width, height } = getDimensions(exif);
      parts.push(`${width} × ${height}`);
    }
    if (exif?.fileSizeInByte) {
      parts.push(getByteUnitString(exif.fileSizeInByte, $locale ?? undefined));
    }
    return parts.join(' · ');
  });

  const camera = $derived([asset?.exifInfo?.make, asset?.exifInfo?.model].filter(Boolean).join(' '));
  const lens = $derived(
    [
      asset?.exifInfo?.focalLength ? `${Math.round(asset.exifInfo.focalLength)} mm` : undefined,
      asset?.exifInfo?.fNumber ? `ƒ/${asset.exifInfo.fNumber}` : undefined,
      asset?.exifInfo?.exposureTime ?? undefined,
      asset?.exifInfo?.iso ? `ISO ${asset.exifInfo.iso}` : undefined,
    ]
      .filter(Boolean)
      .join(' · '),
  );

  const latlng = $derived.by(() => {
    const lat = asset?.exifInfo?.latitude;
    const lng = asset?.exifInfo?.longitude;
    return lat && lng ? { lat: Number(lat.toFixed(7)), lng: Number(lng.toFixed(7)) } : undefined;
  });

  // Mounting the map through `{#await}` can leave the surrounding subtree unreactive; see lazyComponent().
  const LazyMap = lazyComponent(() => import('$lib/components/shared-components/map/Map.svelte'));
</script>

<OnEvents {onAssetUpdate} />

<!-- The info panel's own rows, with their "filter by this" links off (`canFilter` false) so nothing
     navigates away from a half-reviewed day. Face tagging stays in the full viewer (Open in new tab). -->
<aside class="flex min-w-0 flex-col gap-3" data-testid="cleanup-rewind-info">
  <div class="rounded-2xl border bg-light px-4 py-3.5">
    <p class="text-lg/snug font-bold" data-testid="cleanup-rewind-info-date">
      {taken.toLocaleString(DateTime.DATE_HUGE)}
    </p>
    <p class="text-sm text-muted tabular-nums">
      {$t('cleanup_years_ago', { values: { count: yearsAgo } })} · {taken.toLocaleString(DateTime.TIME_SIMPLE)}
    </p>

    {#if namedPeople.length > 0 || unnamedCount > 0}
      <div class="mt-3 flex flex-wrap items-center gap-1.5" data-testid="cleanup-rewind-info-people">
        {#each namedPeople as person (person.id)}
          <span class="flex items-center gap-1.5 rounded-full border py-0.5 ps-0.5 pe-2.5 text-xs">
            <img class="size-6 rounded-full object-cover" src={getGlobalPersonThumbnailUrl(person, {})} alt="" />
            {person.name}
          </span>
        {/each}
        {#if unnamedCount > 0}
          <span class="text-xs text-muted">
            {$t('face_suggestion_unnamed_faces', { values: { count: unnamedCount } })}
          </span>
        {/if}
      </div>
    {/if}
  </div>

  {#if asset}
    {#key asset.id}
      <div class="rounded-2xl border bg-light px-2 text-sm">
        <DetailPanelLocation bind:asset isOwner={canEdit} />
        {#if latlng && featureFlagsManager.value.map}
          <div class="mb-3 h-40 overflow-hidden rounded-xl">
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
                zoom={11}
                simplified
                useLocationPin
              />
            {/if}
          </div>
        {/if}
      </div>

      <div class="rounded-2xl border bg-light text-sm">
        <DetailPanelDescription {asset} isOwner={canEdit} />
        <DetailPanelRating {asset} isOwner={canEdit} />
        {#if authManager.authenticated && authManager.preferences.tags.enabled}
          <div class="px-2 pb-2">
            <DetailPanelTags bind:asset {isOwner} {canEdit} />
          </div>
        {/if}
      </div>

      <div class="rounded-2xl border bg-light px-4 py-1 text-sm">
        <DetailPanelDate {asset} isOwner={canEdit} />
        <div class="flex gap-4 py-3">
          <Icon icon={mdiImageOutline} size="24" class="shrink-0" aria-label={$t('filename')} />
          <p class="min-w-0">
            <span class="break-all">{asset.originalFileName}</span>
            {#if fileLine}<span class="block text-xs text-muted">{fileLine}</span>{/if}
          </p>
        </div>
        {#if camera}
          <div class="flex gap-4 py-3">
            <Icon icon={mdiCamera} size="24" class="shrink-0" aria-label={$t('camera')} />
            <p class="min-w-0">
              {camera}
              {#if lens}<span class="block text-xs text-muted">{lens}</span>{/if}
            </p>
          </div>
        {/if}
        {#if albums.length > 0}
          <div class="flex gap-4 py-3" data-testid="cleanup-rewind-info-albums">
            <Icon icon={mdiImageAlbum} size="24" class="shrink-0" aria-label={$t('albums')} />
            <p class="min-w-0">{albums.map((album) => album.albumName).join(', ')}</p>
          </div>
        {/if}
      </div>
    {/key}
  {:else}
    <div class="h-40 animate-pulse rounded-2xl bg-subtle" aria-hidden="true"></div>
    <Text size="small" color="muted" class="sr-only">{$t('loading')}</Text>
  {/if}

  {@render children?.()}
</aside>
