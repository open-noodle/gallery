import { authManager } from '#lib/managers/auth-manager.svelte.ts';
import { createUrl } from '#lib/utils.ts';
import {
  AssetVersionImageSize,
  AssetVersionKind,
  type AssetResponseDto,
  type AssetVersionResponseDto,
} from '@immich/sdk';
import { DateTime, FixedOffsetZone } from 'luxon';

// Asset versions (specs/2026-11-07-asset-versions-design.md): the files of a photo's shot (its edits, the camera's
// own file, the RAW), listed in the photo's detail panel; the photo's own file is one of them, under the photo's id. A version is a hidden asset reached only through its photo, so every URL goes through the photo.

const versionPath = (assetId: string, versionId: string) =>
  `/assets/${encodeURIComponent(assetId)}/versions/${encodeURIComponent(versionId)}`;

/** The version's own thumbnail or preview, with the shared-link key/slug like the asset media URLs. */
export const getAssetVersionThumbnailUrl = (
  assetId: string,
  version: Pick<AssetVersionResponseDto, 'id' | 'thumbhash'>,
  size: AssetVersionImageSize = AssetVersionImageSize.Thumbnail,
) => createUrl(`${versionPath(assetId, version.id)}/thumbnail`, { ...authManager.params, size, c: version.thumbhash });

/** The version's file as an attachment download (the server enforces the photo's download rule). */
export const getAssetVersionDownloadUrl = (assetId: string, versionId: string) =>
  createUrl(`${versionPath(assetId, versionId)}/original`, { ...authManager.params, download: true });

const POPUP_WIDTH = 700;
const POPUP_MIN_WIDTH = 200;
const POPUP_GAP = 12;

/** Immich's info panel in the photo viewer (`AssetViewer.svelte`), which the larger picture goes beside. */
export const DETAIL_PANEL = '[data-testid="detail-panel"]';

/**
Where the larger picture of a version goes while the mouse is on its thumbnail: beside the info panel, over the
photo, level with the thumbnail and inside the window. It is 700 px wide when there is room and smaller in a
narrower or lower window. The panel sits on the right of the window, or on the left in a right-to-left language:
the picture takes the side with more room. Undefined when less than 200 px is free: a picture that small shows no
more than the thumbnail does, and a click still opens the large one. All numbers are window pixels.
*/
export const versionPopupBox = (
  thumbnail: { top: number; height: number },
  panel: { left: number; right: number },
  shape: { width: number; height: number },
  viewport: { width: number; height: number },
) => {
  const roomLeft = panel.left;
  const roomRight = viewport.width - panel.right;
  const aspect = shape.height / shape.width;
  let width = Math.min(POPUP_WIDTH, Math.max(roomLeft, roomRight) - 2 * POPUP_GAP);
  let height = width * aspect;
  const maxHeight = viewport.height - 2 * POPUP_GAP;
  if (height > maxHeight) {
    height = maxHeight;
    width = height / aspect;
  }
  if (width < POPUP_MIN_WIDTH) {
    return;
  }
  const centred = thumbnail.top + thumbnail.height / 2 - height / 2;
  const top = Math.min(Math.max(centred, POPUP_GAP), viewport.height - height - POPUP_GAP);
  const left = roomLeft >= roomRight ? panel.left - POPUP_GAP - width : panel.right + POPUP_GAP;
  return { top: Math.round(top), left: Math.round(left), width: Math.round(width), height: Math.round(height) };
};

const KIND_KEYS = {
  [AssetVersionKind.Raw]: 'asset_versions_kind_raw',
  [AssetVersionKind.Original]: 'asset_versions_kind_original',
  [AssetVersionKind.Edit]: 'asset_versions_kind_edit',
} as const;

/** The badge of a file: RAW, Original (the camera's own JPEG or HEIC) or Edit. */
export const versionKindKey = (kind: AssetVersionKind) => KIND_KEYS[kind];

/** The file format as people name it: the extension (NEF, DNG, JPG), else the MIME subtype. */
export const versionFormat = ({ originalFileName, originalMimeType }: AssetVersionResponseDto) => {
  const dot = originalFileName.lastIndexOf('.');
  if (dot > 0 && dot < originalFileName.length - 1) {
    return originalFileName.slice(dot + 1).toUpperCase();
  }
  const subtype = originalMimeType?.split('/', 2)[1];
  return subtype ? subtype.toUpperCase() : undefined;
};

/**
When a version was taken, on the camera's clock: the time the info panel shows for the photo, not the browser's
time zone. The server sends a version's time as an instant. The files of one shot were taken in the same moment,
so the photo's distance from UTC (its local time minus its instant) is theirs too.
*/
export const versionCapturedAt = (
  version: Pick<AssetVersionResponseDto, 'fileCreatedAt'>,
  photo: Pick<AssetResponseDto, 'fileCreatedAt' | 'localDateTime'>,
) => {
  const utc = (iso: string) => DateTime.fromISO(iso, { zone: 'utc' });
  const fromUtc = Math.round(utc(photo.localDateTime).diff(utc(photo.fileCreatedAt)).as('minutes'));
  if (!Number.isFinite(fromUtc)) {
    return;
  }
  const taken = DateTime.fromISO(version.fileCreatedAt, { zone: FixedOffsetZone.instance(fromUtc) });
  return taken.isValid ? taken : undefined;
};

/**
The time a version's card shows. An edit: when it was made, which is when its file was last written, the time
that also decides which edit is the newest; in the viewer's own time zone, because an edit is made at a computer,
not on the camera's clock. Any other file, and an edit from a server that does not say when it was written: when
it was taken, on the camera's clock.
*/
export const versionTime = (
  version: Pick<AssetVersionResponseDto, 'kind' | 'fileCreatedAt'> & { fileModifiedAt?: string },
  photo: Pick<AssetResponseDto, 'fileCreatedAt' | 'localDateTime'>,
) => {
  if (version.kind === AssetVersionKind.Edit && version.fileModifiedAt) {
    const made = DateTime.fromISO(version.fileModifiedAt);
    if (made.isValid) {
      return made;
    }
  }
  return versionCapturedAt(version, photo);
};

/**
The time zone to write after a version's time, in the short form the cards have room for: GMT-4, GMT+5:30, GMT.
A time on the camera's clock gets one only when the photo records a zone, as in the info panel, which writes
none for a photo that has none. An edit's time is in the viewer's own zone, which is always known.
*/
export const versionZoneLabel = (at: DateTime, photoHasZone: boolean) => {
  if (at.zone.type === 'fixed' && !photoHasZone) {
    return;
  }
  const minutes = Math.abs(at.offset);
  if (minutes === 0) {
    return 'GMT';
  }
  const rest = minutes % 60;
  return `GMT${at.offset < 0 ? '-' : '+'}${Math.floor(minutes / 60)}${rest ? `:${String(rest).padStart(2, '0')}` : ''}`;
};
