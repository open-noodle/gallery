// What a file's name says about its shot (specs/2026-11-07-asset-versions-design.md, "Detection"). Files are found for
// combining by name and time, so the name logic is in one place, pure, and tested against the names the common
// cameras and phones write (asset-version-names.spec.ts).
//
// A name is never loosened further than these two functions do. A number that tells frames apart is part of the name
// (`DSC_9425`, `_BURST1`), and so is a copy mark (` (1)`, `Copy of`): a copy is not the camera's file of a shot.

/**
The labels a Pixel puts after the name: it writes `PXL_20261018_205308614.RAW-01.COVER.jpg` and
`….RAW-02.ORIGINAL.dng` for one shot, and `.NIGHT`, `.PORTRAIT`, `.MP`, `.PANO`, `.LONG_EXPOSURE-01.COVER`. Only
for a name of that device's shape, in any case: in a name a person gave, a dot is part of the name (`trip.A.dng`
and `trip.B.jpg` are two files). And only the phone's own labels: what a person or a program added after them
(`.COVER_1`, `.COVER_HDR`, `.ORIGINAL-HDR`, `.ORIGINAL.HDR`, `.COVER~2`) stays in the name, and so does a label
this list does not know (the two files of such a shot are then left as two photos).
*/
const PIXEL_MODE = String.raw`(?:raw|night|portrait|long_exposure|motion|action_pan|macro_focus)(?:-\d\d)?`;
const PIXEL_LABELS = new RegExp(String.raw`^(pxl_\d{8}_\d{6,})(\.(?:${PIXEL_MODE}|cover|original|mp|pano|ts))+$`);

const withoutExtension = (fileName: string) => fileName.replace(/\.[^.]*$/, '') || fileName;

/** A name without its extension, as the device gave it to the shot. */
const asShot = (stem: string) => stem.toLowerCase().replace(PIXEL_LABELS, '$1');

/**
The name the device gave the shot: the file name without its extension and without a device's labels, in lower
case. The RAW and the JPEG or HEIC of one frame have the same; the frames of a burst have different ones.
*/
export const shotBase = (fileName: string) => asShot(withoutExtension(fileName));

/**
`DSC_9425-edit`, `DSC_9425_edited`, `DSC_9425-Edit-2`: what editors and people add to an edit. Not `_result` (any
program's output, a merge as well) and not `~2` (a copy as often as an edit).
*/
const EDIT_SUFFIX = /[-_ ](edit|edited)([-_ ]?\d{1,3})?$/;
/** `IMG_E1234`: an iPhone's edited copy of `IMG_1234`. */
const IPHONE_EDIT = /^(img_)e(\d{4,})$/;

/**
For a file whose name marks it as an edit: the name of the shot it was made from (`DSC_9425-edit.jpg` gives
`dsc_9425`). Null when the name carries no edit mark. The mark comes off before a device's labels do: a Pixel's
`PXL_….PORTRAIT-edit.jpg` is an edit of `PXL_….PORTRAIT.jpg`, whose shot is `pxl_…`.
*/
export const editSourceBase = (fileName: string): string | null => {
  const stem = withoutExtension(fileName).toLowerCase();
  const unmarked = stem.replace(IPHONE_EDIT, '$1$2').replace(EDIT_SUFFIX, '');
  return unmarked === stem || unmarked === '' ? null : asShot(unmarked);
};

/** The name says the file is an edit. What is inside the file can say so too: see `isEdit`. */
export const hasEditMark = (fileName: string) => editSourceBase(fileName) !== null;

/** `IMG_1234`: the name of a shot an iPhone may have an edited copy of (`IMG_E1234`). */
const IPHONE_SHOT = /^(img_)(\d{4,})$/;

/**
The names a file is searched by: its own, and for an edit the name of the shot it was made from. A shot of an
iPhone's shape is also searched by the name of its edited copy, which does not contain its own: so the two find each
other whichever arrives first.
*/
export const searchNames = (fileName: string): string[] => {
  const base = shotBase(fileName);
  const source = editSourceBase(fileName);
  if (source) {
    return [base, source];
  }
  return IPHONE_SHOT.test(base) ? [base, base.replace(IPHONE_SHOT, '$1e$2')] : [base];
};

/** Two files the device named alike: the RAW and the camera's JPEG or HEIC of one frame. */
export const sameShotName = (a: string, b: string) => shotBase(a) === shotBase(b);

/** The edit's name is the source's with an edit mark, or the very same (an export saved under the source's name). */
export const namedAfter = (edit: string, source: string) =>
  editSourceBase(edit) === shotBase(source) || shotBase(edit) === shotBase(source);

/**
Where a file is stored, split for the folder rule: the folder (everything before the last `/`) and the stored file
name without its extension, both as they are, in their own case. Within one folder a stored name is unique, on disk
and in S3 alike, so `roll12_07.tif` and `roll12_07.heic` there are the only two files of that name. The stored name,
not the original one: an upload is stored under its id (`upload/<user>/<aa>/<bb>/<id>.jpg`, a folder shared by
unrelated files), and the storage template stores a second `scan.jpg` of one day as `scan+1.jpg`; neither then
matches anything.
*/
export const storedPlace = (originalPath: string) => {
  const slash = originalPath.lastIndexOf('/');
  const stored = originalPath.slice(slash + 1);
  const dot = stored.lastIndexOf('.');
  return {
    folder: originalPath.slice(0, Math.max(slash, 0)),
    stem: dot > 0 ? stored.slice(0, dot) : stored,
  };
};

/** Two files stored in the same folder under the same name, only the extension differing. */
export const sameStoredName = (a: string, b: string) => {
  if (a === b) {
    return false;
  }
  const x = storedPlace(a);
  const y = storedPlace(b);
  return x.folder === y.folder && x.stem === y.stem;
};
