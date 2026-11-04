import { isDiskPath } from 'src/backends/disk-storage.backend.js';
import { StorageCore } from 'src/cores/storage.core.js';
import { StorageFolder } from 'src/enum.js';

/**
Whether a motion video is one Immich extracted from a motion photo, so deleting it also deletes the
file. Upstream (immich-32833) checks for an absolute encoded-video path; Gallery's S3 backend stores
extracted motion videos under a relative `encoded-video/...` key (see `isDiskPath`), so that form
counts too.
*/
export const isExtractedMotionPath = (originalPath: string) =>
  isDiskPath(originalPath)
    ? StorageCore.isAndroidMotionPath(originalPath)
    : originalPath.startsWith(`${StorageFolder.EncodedVideo}/`);
