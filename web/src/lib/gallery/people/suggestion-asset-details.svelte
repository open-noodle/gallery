<script lang="ts">
  import { cleanClass } from '$lib';
  import { assetCacheManager } from '$lib/managers/AssetCacheManager.svelte';
  import { getDimensions } from '$lib/utils/asset-utils';
  import { getByteUnitString } from '$lib/utils/byte-units';
  import { getGlobalPersonThumbnailUrl } from '$lib/utils/global-person-route';
  import { getAllAlbums, type AlbumResponseDto, type AssetResponseDto } from '@immich/sdk';
  import { Icon } from '@immich/ui';
  import { mdiCalendarBlankOutline, mdiCamera, mdiImageAlbum, mdiImageOutline, mdiMapMarkerOutline } from '@mdi/js';
  import { DateTime } from 'luxon';
  import { locale, t } from 'svelte-i18n';

  interface Props {
    /** The asset the candidate face was detected in. */
    assetId: string;
    /** Set only when the review is running inside a Space: the lookup and the avatars are space-scoped then. */
    spaceId?: string;
    class?: string;
  }

  const { assetId, spaceId, class: className }: Props = $props();

  let asset = $state<AssetResponseDto | undefined>();
  let albums = $state<AlbumResponseDto[]>([]);

  // Deliberately NOT `$state`: this is the effect's own bookkeeping, and an effect that reads reactive state
  // it also writes re-runs itself forever. Nothing renders from it.
  let loadedFor: string | undefined;

  $effect(() => {
    const id = assetId;
    const scopedSpaceId = spaceId;

    // Mounted only while Details is open; the asset cache memoizes, so re-opening costs no request.
    if (loadedFor === id) {
      return;
    }

    loadedFor = id;
    asset = undefined;
    albums = [];

    void (async () => {
      try {
        // Album membership is a second call and a nice-to-have; losing it must not cost the reviewer the
        // metadata rows, which are the reason the block was opened.
        const [loaded, memberships] = await Promise.all([
          assetCacheManager.getAsset({ id, spaceId: scopedSpaceId }),
          getAllAlbums({ assetId: id }).catch(() => [] as AlbumResponseDto[]),
        ]);

        // The reviewer has already moved on; this response is for a face that is no longer on screen.
        if (loadedFor !== id) {
          return;
        }

        asset = loaded;
        albums = memberships;
      } catch {
        // A failed lookup leaves the panel empty. The summary row's date and link never needed a request.
        if (loadedFor === id) {
          asset = undefined;
        }
      }
    })();
  });

  // The authoritative timestamp, the same one the asset viewer's info panel prefers: the EXIF capture time
  // read in the photo's OWN zone, falling back to the stored local wall clock. The summary row's
  // `fileCreatedAt` is only an approximation of this — it is all the suggestion payload carries.
  const takenAt = $derived.by(() => {
    if (!asset) {
      return null;
    }
    const timeZone = asset.exifInfo?.timeZone ?? undefined;
    const parsed =
      timeZone && asset.exifInfo?.dateTimeOriginal
        ? DateTime.fromISO(asset.exifInfo.dateTimeOriginal, { zone: timeZone, locale: $locale ?? undefined })
        : DateTime.fromISO(asset.localDateTime, { zone: 'UTC', locale: $locale ?? undefined });
    return parsed.isValid ? parsed.toLocaleString(DateTime.DATETIME_MED) : null;
  });

  const place = $derived(
    [asset?.exifInfo?.city, asset?.exifInfo?.state, asset?.exifInfo?.country]
      .map((part) => part?.trim())
      .filter(Boolean)
      .join(', '),
  );

  const size = $derived.by(() => {
    const exifInfo = asset?.exifInfo;
    if (!exifInfo) {
      return [];
    }
    const parts: string[] = [];
    if (exifInfo.exifImageWidth && exifInfo.exifImageHeight) {
      const megapixel = Math.round((exifInfo.exifImageWidth * exifInfo.exifImageHeight) / 1_000_000);
      if (megapixel > 0) {
        parts.push(`${megapixel} MP`);
      }
      const { width, height } = getDimensions(exifInfo);
      parts.push(`${width} × ${height}`);
    }
    if (exifInfo.fileSizeInByte) {
      parts.push(getByteUnitString(exifInfo.fileSizeInByte, $locale ?? undefined));
    }
    return parts;
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

  // Only NAMED people carry the signal this row exists for ("the frame already has Alice and Bob in it").
  // An unrecognised face has nothing to show, so it is counted rather than rendered as an empty chip.
  const namedPeople = $derived((asset?.people ?? []).filter((person) => person.name?.trim()));
  const unnamedCount = $derived((asset?.people ?? []).length - namedPeople.length);
</script>

<!-- Everything here is READ-ONLY on purpose. The info panel's own rows carry edit pencils and
     filter-by-this-value buttons; either would open a modal over this modal or navigate the person page
     out from under an open review queue. -->
<div
  class={cleanClass(
    'mt-2 rounded-xl border border-gray-200 bg-gray-50 px-3 text-sm dark:border-gray-700 dark:bg-gray-800/50',
    className,
  )}
  data-testid="suggestion-context-details"
>
  {#if takenAt}
    <div class="flex gap-3 border-b border-gray-200 py-2.5 dark:border-gray-700" data-testid="suggestion-context-taken">
      <Icon icon={mdiCalendarBlankOutline} size="20" class="shrink-0 text-gray-400" aria-label={$t('date_and_time')} />
      <span>{takenAt}</span>
    </div>
  {/if}

  {#if asset}
    <div class="flex gap-3 border-b border-gray-200 py-2.5 dark:border-gray-700" data-testid="suggestion-context-file">
      <Icon icon={mdiImageOutline} size="20" class="shrink-0 text-gray-400" aria-label={$t('filename')} />
      <span class="min-w-0">
        <span class="break-all">{asset.originalFileName}</span>
        {#if size.length > 0}
          <span class="block text-xs text-gray-500 dark:text-gray-400">{size.join(' · ')}</span>
        {/if}
      </span>
    </div>
  {/if}

  {#if place}
    <div
      class="flex gap-3 border-b border-gray-200 py-2.5 dark:border-gray-700"
      data-testid="suggestion-context-location"
    >
      <Icon icon={mdiMapMarkerOutline} size="20" class="shrink-0 text-gray-400" aria-label={$t('location')} />
      <span>{place}</span>
    </div>
  {/if}

  {#if camera}
    <div
      class="flex gap-3 border-b border-gray-200 py-2.5 dark:border-gray-700"
      data-testid="suggestion-context-camera"
    >
      <Icon icon={mdiCamera} size="20" class="shrink-0 text-gray-400" aria-label={$t('camera')} />
      <span class="min-w-0">
        <span>{camera}</span>
        {#if lens}
          <span class="block text-xs text-gray-500 dark:text-gray-400">{lens}</span>
        {/if}
      </span>
    </div>
  {/if}

  {#if albums.length > 0}
    <div
      class="flex gap-3 border-b border-gray-200 py-2.5 dark:border-gray-700"
      data-testid="suggestion-context-albums"
    >
      <Icon icon={mdiImageAlbum} size="20" class="shrink-0 text-gray-400" aria-label={$t('albums')} />
      <span>{albums.map((album) => album.albumName).join(', ')}</span>
    </div>
  {/if}

  {#if namedPeople.length > 0 || unnamedCount > 0}
    <div class="py-2.5" data-testid="suggestion-context-people">
      <p class="mb-1.5 text-xs text-gray-500 dark:text-gray-400">{$t('face_suggestion_also_in_photo')}</p>
      <div class="flex flex-wrap items-center gap-1.5">
        {#each namedPeople as person (person.id)}
          <span
            class="flex items-center gap-1.5 rounded-full border border-gray-200 py-0.5 pr-2.5 pl-0.5 text-xs dark:border-gray-700"
            data-testid="suggestion-context-person"
          >
            <!-- `spaceId` as the Info panel passes it (getRepresentativeThumbnailUrl): inside a Space the
                 asset's people carry a `spacePersonId`, whose face is the space profile's, not the owner's. -->
            <img
              class="size-5 rounded-full object-cover"
              src={getGlobalPersonThumbnailUrl(person, { spaceId })}
              alt=""
            />
            {person.name}
          </span>
        {/each}
        {#if unnamedCount > 0}
          <span class="text-xs text-gray-500 dark:text-gray-400">
            {$t('face_suggestion_unnamed_faces', { values: { count: unnamedCount } })}
          </span>
        {/if}
      </div>
    </div>
  {/if}
</div>
