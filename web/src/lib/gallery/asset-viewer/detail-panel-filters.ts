import type { AssetResponseDto } from '@immich/sdk';
import { goto } from '$app/navigation';
import { page } from '$app/state';
import type { FilterState } from '$lib/components/filter-panel/filter-panel';
import { authManager } from '$lib/managers/auth-manager.svelte';
import { buildContextualMapUrl } from '$lib/utils/filter-target';

export type ValueFilter = { value: string; patch: Partial<FilterState> };

// R9/E6/E7 — a value that is empty or whitespace-only trims to nothing (filter-url.ts's
// setTrimmed), so it gets no affordance: the click would close the viewer and apply no filter.
const valueFilter = (value: string, patch: Partial<FilterState>): ValueFilter | undefined =>
  value ? { value, patch } : undefined;

/**
 * The filename WITHOUT its extension — that is what surfaces a RAW/JPEG pair (IMG_1234.CR3 +
 * IMG_1234.jpg) and edited variants of the same shot, which is the whole point of the filter.
 *
 * Only the LAST dot is an extension separator (`my.photo.v2.jpg` → `my.photo.v2`), and a
 * leading-dot name (`.jpg`) has an EMPTY basename, so no affordance.
 */
export const filenameFilter = ({ originalFileName }: AssetResponseDto) => {
  const lastDot = originalFileName.lastIndexOf('.');
  const basename = (lastDot === -1 ? originalFileName : originalFileName.slice(0, lastDot)).trim();
  return valueFilter(basename, { originalFileName: basename });
};

export const cameraFilter = ({ exifInfo }: AssetResponseDto) =>
  valueFilter(
    [exifInfo?.make, exifInfo?.model]
      .map((value) => value?.trim())
      .filter(Boolean)
      .join(' '),
    { make: exifInfo?.make ?? undefined, model: exifInfo?.model ?? undefined },
  );

export const lensFilter = ({ exifInfo }: AssetResponseDto) =>
  valueFilter(exifInfo?.lensModel?.trim() ?? '', { lensModel: exifInfo?.lensModel ?? undefined });

/** Offered even for an empty name: the owner id is the filter, not the name. */
export const ownerFilter = ({ owner }: AssetResponseDto): ValueFilter | undefined =>
  owner && { value: owner.name, patch: { ownerId: owner.id } };

/**
 * #767 class — the embedded map's "open in map view" control used to call Route.map({...latlng})
 * directly, dropping the Space scope AND every active filter (and it would have landed an album
 * viewer on the global map). It reuses buildContextualMapUrl now, exactly like the location row's
 * pin: undefined (→ no control at all) on an album, which has no map URL to be honest with, and on
 * a shared link.
 */
export const getOpenInMapView = (point: { lat: number; lng: number }) => {
  const url = authManager.isSharedLink ? null : buildContextualMapUrl(page.url, { ...point, zoom: 12.5 });
  return url ? () => goto(url) : undefined;
};
