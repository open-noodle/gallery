import { AssetStatus, AssetVisibility } from 'src/enum.js';

// Undoing versions (specs/2026-11-07-asset-versions-design.md, "Undoing versions"): while versions are switched off,
// an administrator can have every version made a photo of its own again. What each one returns to is decided here,
// from how its photo is now and how the file was shown before it went behind it. Plain values in, plain values out.

/** The photo a version is behind, as it is now. */
export type UndonePhoto = { visibility: AssetVisibility; deletedAt: Date | null; status: AssetStatus };

/** A version: how it was shown before it went behind its photo, and its own trash state now. */
export type UndoneVersion = {
  priorVisibility: string;
  wasStacked: boolean;
  deletedAt: Date | null;
  status: AssetStatus;
};

export type RestoredState = {
  visibility: AssetVisibility;
  deletedAt: Date | null;
  status: AssetStatus;
  /** Whether it goes into a stack with its photo, the photo on top. */
  stackedWithPhoto: boolean;
};

/**
What a version becomes when versions are undone.

- It is shown the way its photo is now where that is a decision about the shot: locked with a locked photo,
  archived with an archived one. Otherwise the way it was shown before: in the timeline, or the archive.
- It is in the trash when its photo is, with the photo's trash state (the timestamp and the status go together:
  Restore and Empty Trash select by status). Its own trash state, if it has one, stays.
- It is stacked with its photo only if it was when it went behind it. A locked photo is in no stack.
*/
export const restoredState = (photo: UndonePhoto, version: UndoneVersion): RestoredState => {
  let visibility = AssetVisibility.Timeline;
  if (photo.visibility === AssetVisibility.Locked) {
    visibility = AssetVisibility.Locked;
  } else if (photo.visibility === AssetVisibility.Archive || version.priorVisibility === AssetVisibility.Archive) {
    visibility = AssetVisibility.Archive;
  }
  const trashedWithPhoto = !version.deletedAt && !!photo.deletedAt;
  return {
    visibility,
    deletedAt: version.deletedAt ?? photo.deletedAt,
    status: trashedWithPhoto ? photo.status : version.status,
    stackedWithPhoto: version.wasStacked && visibility !== AssetVisibility.Locked,
  };
};
