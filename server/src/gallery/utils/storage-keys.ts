import { join } from 'node:path';
import { isDiskPath } from 'src/backends/disk-storage.backend.js';
import {
  ImagePathOptions,
  PersonThumbnailPathEntity,
  StorageCore,
  ThumbnailPathEntity,
} from 'src/cores/storage.core.js';
import { StorageFolder } from 'src/enum.js';

// Relative key builders (for S3 / backend-agnostic paths)

export function getRelativeNestedPath(folder: StorageFolder, ownerId: string, filename: string): string {
  return join(folder, ownerId, filename.slice(0, 2), filename.slice(2, 4), filename);
}

export function getRelativeImagePath(
  asset: ThumbnailPathEntity,
  { fileType, format, isEdited }: ImagePathOptions,
): string {
  const filename = `${asset.id}_${fileType}${isEdited ? '_edited' : ''}.${format}`;
  return getRelativeNestedPath(StorageFolder.Thumbnails, asset.ownerId, filename);
}

export function getRelativeEncodedVideoPath(asset: ThumbnailPathEntity): string {
  return getRelativeNestedPath(StorageFolder.EncodedVideo, asset.ownerId, `${asset.id}.mp4`);
}

function getEditedEncodedVideoFilename(asset: ThumbnailPathEntity): string {
  return `${asset.id}_edited.mp4`;
}

export function getEditedEncodedVideoPath(asset: ThumbnailPathEntity): string {
  return StorageCore.getNestedPath(StorageFolder.EncodedVideo, asset.ownerId, getEditedEncodedVideoFilename(asset));
}

export function getRelativeEditedEncodedVideoPath(asset: ThumbnailPathEntity): string {
  return getRelativeNestedPath(StorageFolder.EncodedVideo, asset.ownerId, getEditedEncodedVideoFilename(asset));
}

export function getRelativePersonThumbnailPath(person: PersonThumbnailPathEntity): string {
  return getRelativeNestedPath(StorageFolder.Thumbnails, person.ownerId, `${person.personGroupId}.jpeg`);
}

export function getRelativeProfileImagePath(userId: string, filename: string): string {
  return getRelativeNestedPath(StorageFolder.Profile, userId, filename);
}

/** Where an extracted motion video goes: upstream's disk path beside a disk original, a relative key beside an S3 one. */
export function getMotionVideoPath(
  asset: ThumbnailPathEntity & { originalPath: string },
  motionAssetId: string,
): string {
  return isDiskPath(asset.originalPath)
    ? StorageCore.getAndroidMotionPath(asset, motionAssetId)
    : getRelativeNestedPath(StorageFolder.EncodedVideo, asset.ownerId, `${motionAssetId}-MP.mp4`);
}
