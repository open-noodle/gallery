import { BadRequestException } from '@nestjs/common';
import { AssetType } from 'src/enum.js';
import type { AssetVersionRepository } from 'src/gallery/repositories/asset-version.repository.js';
import { hasEditMark } from 'src/gallery/utils/asset-version-names.js';
import { chooseLook, kindOf, type VersionKind } from 'src/gallery/utils/asset-version-rules.js';
import type { BackendMediaServer } from 'src/gallery/utils/backend-media-server.js';
import type { AssetJobRepository } from 'src/repositories/asset-job.repository.js';
import { mimeTypes } from 'src/utils/mime-types.js';

// The picture of a photo that has versions (specs/2026-11-07-asset-versions-design.md): the photo keeps its id and its
// own file, and its edited thumbnail, preview and full-size image are rendered from its newest edit, another file of
// the same shot. The same shape as a colour adjustment (image-adjust.ts): a fork table says what the edited files are
// made from, and Immich's edit job makes them.

type ThumbnailAsset = NonNullable<Awaited<ReturnType<AssetJobRepository['getForGenerateThumbnailJob']>>>;

const ms = (date: unknown) => new Date(date as string | Date).getTime();

type PhotoRow = NonNullable<Awaited<ReturnType<AssetVersionRepository['getPhoto']>>>;

/** What the base photo's own file is: a RAW, an edit or a camera file. One with no row goes by its name. */
export const photoKind = (photo: PhotoRow): VersionKind => {
  if (photo.kind) {
    return photo.kind;
  }
  const isRaw = mimeTypes.isRaw(photo.originalFileName);
  return kindOf({ isRaw, isEdit: !isRaw && hasEditMark(photo.originalFileName) });
};

export type LookSource = { id: string; modifiedAt: Date };

/**
The file a photo's picture should come from, as things are now: one of its versions (with its date: the same file
written again is a new picture), or null for its own file (it has no versions, no edit among them is newer than
it, or it is gone).
*/
export const desiredLook = async (repository: AssetVersionRepository, photoId: string): Promise<LookSource | null> => {
  // asked first: the edit job runs for every edited photo, and almost none of them has versions
  if (!(await repository.hasVersions(photoId))) {
    return null;
  }
  const versions = await repository.getVersions(photoId);
  const photo = await repository.getPhoto(photoId);
  if (!photo) {
    return null;
  }
  const id = chooseLook(
    { id: photo.id, kind: photoKind(photo), editedAtMs: ms(photo.fileModifiedAt) },
    versions.map((version) => ({ id: version.id, kind: version.kind, editedAtMs: ms(version.fileModifiedAt) })),
  );
  const source = versions.find((version) => version.id === id);
  return source ? { id: source.id, modifiedAt: new Date(source.fileModifiedAt as unknown as string | Date) } : null;
};

/**
For Gallery's own editor: crop, rotate and mirror work on the photo's own file (the editor shows that file, and
the edit job applies them to it). On a photo that shows an edit made elsewhere, the user would be editing another
picture than the one they were looking at, and saving would silently replace the edit they see. So it is refused
while the photo's picture comes from another file. Removing edits stays allowed, and colour adjustments apply on
top of the shown picture. Decided 2026-11-10, after a review.
*/
export const requireOwnPicture = async (repository: AssetVersionRepository | undefined, photoId: string) => {
  // without the repository (a service put together without the fork's, as Immich's own tests do) no photo has versions
  if (repository && (await desiredLook(repository, photoId))) {
    throw new BadRequestException(
      'This photo shows an edit made in another program, so it cannot be cropped or rotated here',
    );
  }
};

/** Whether the photo's edited files were rendered from that file as it is now. */
export const isLookCurrent = (
  photo: { lookSourceId: string | null; lookSourceModifiedAt: unknown },
  desired: LookSource | null,
) =>
  desired
    ? photo.lookSourceId === desired.id &&
      !!photo.lookSourceModifiedAt &&
      ms(photo.lookSourceModifiedAt) === desired.modifiedAt.getTime()
    : !photo.lookSourceId;

/**
For the edit job: when the photo's picture comes from one of its versions, the asset to render (the photo's id and
owner, so the files are the photo's; the version's file and orientation), that file's local path, and `published`,
which the job calls once the picture's files are stored and registered: only then is the look recorded and the
photo marked edited, so a render that fails leaves the record as it was and is seen as outdated, and of two renders
at once the record holds the one that wrote last. When no look applies any more, the record is removed, and the job
then removes the edited files as it does after the last crop is undone. A reset that finds, under the photo's lock,
that a pairing has given the photo something to show after all renders that instead: the edited files are never
removed while a look applies. Edits made in Gallery's own editor before the photo had an edit to
show win while they exist: they apply to the photo's own file, and the look comes back when they are removed (new
ones are refused meanwhile: `requireOwnPicture`).
*/
export const resolveVersionLook = async (
  {
    assetVersionRepository,
    assetJobRepository,
    backendMedia,
  }: {
    assetVersionRepository: AssetVersionRepository;
    assetJobRepository: AssetJobRepository;
    backendMedia: BackendMediaServer;
  },
  asset: ThumbnailAsset,
): Promise<
  | ({
      asset: ThumbnailAsset;
      localPath: string;
      published: (dimensions?: { width: number; height: number }) => Promise<void>;
    } & AsyncDisposable)
  | undefined
> => {
  if (asset.type !== AssetType.Image || asset.edits.length > 0) {
    return;
  }
  let desired = await desiredLook(assetVersionRepository, asset.id);
  let source = desired ? await assetJobRepository.getForGenerateThumbnailJob(desired.id) : undefined;
  if (!desired || !source) {
    // asked again under the photo's lock: a pairing may have put an edit behind it meanwhile
    const reset = await assetVersionRepository.clearLook(
      asset.id,
      async () => !(await desiredLook(assetVersionRepository, asset.id)),
    );
    if (reset !== 'refused') {
      return;
    }
    desired = await desiredLook(assetVersionRepository, asset.id);
    source = desired ? await assetJobRepository.getForGenerateThumbnailJob(desired.id) : undefined;
    if (!desired || !source) {
      // changed again: the job fails and leaves the edited files as they are; the next change queues it again
      throw new Error(`The picture of asset ${asset.id} changed while it was being reset`);
    }
  }
  const local = await backendMedia.ensureLocalFile(source.originalPath);
  return {
    asset: {
      ...asset,
      originalPath: source.originalPath,
      originalFileName: source.originalFileName,
      exifInfo: source.exifInfo,
    },
    localPath: local.localPath,
    published: (dimensions) => assetVersionRepository.setLook(asset.id, desired, dimensions),
    [Symbol.asyncDispose]: local[Symbol.asyncDispose],
  };
};

/**
For `generateEditedThumbnails`: its result, with the step that records the look (`published` of
`resolveVersionLook`) for its callers to take once they have stored and registered the files. Nothing to take when
no look applied.
*/
export const withLookPublished = <T extends { fullsizeDimensions?: { width: number; height: number } }>(
  generated: T | undefined,
  published: ((dimensions?: { width: number; height: number }) => Promise<void>) | undefined,
): (T & { published?: () => Promise<void> }) | undefined =>
  generated && { ...generated, published: published && (() => published(generated.fullsizeDimensions)) };
