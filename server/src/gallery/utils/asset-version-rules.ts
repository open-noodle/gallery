import { namedAfter, sameShotName, sameStoredName } from 'src/gallery/utils/asset-version-names.js';
import type { CaptureSignature } from 'src/gallery/utils/asset-version-signature.js';

// The rules of version detection (specs/2026-11-07-asset-versions-design.md, "Detection"). Pure: the job's file and the
// candidates found for it go in, the decisions come out.
//
// Files are found by name and time, and by folder (asset-version-names.ts, and the search in the repository). What was
// read from inside a file says what it is (a RAW, an edit, the camera's own file) and gives the reasons to say no. It
// is never what finds a pair.
//
// - linkFile: everything below, for one job. The one function the service calls.
// - shotOf: the shot the job's file is in: its RAW, its camera file, their edits.
// - planShot: which file of the shot is the photo (it keeps its id for good) and which go behind it. The photo is
//   chosen once, by what is already attached to the files, so that nothing has to be moved.
// - chooseLook: whose picture the photo shows: the newest edit of the shot.

export type VersionCandidate = {
  id: string;
  ownerId: string;
  libraryId: string | null;
  originalFileName: string;
  /** Where the file is stored: the folder rule compares the folder and the stored name (`sameStoredName`). */
  originalPath: string;
  /** When the file was added to Gallery (ms): among files of one folder that nothing else tells apart, the first. */
  addedAtMs: number;
  /** hex */
  checksum: string;
  isLivePhoto: boolean;
  /** Visible (timeline or archive), not trashed, not locked. A version already paired counts through `versionOf`. */
  eligible: boolean;
  /** The photo this asset is already a version of. */
  versionOf: string | null;
  /** Other files are behind it already: it is the photo of its shot, and stays that. */
  hasVersions: boolean;
  /** When the file was last written (ms): among the edits of one shot, the newest is the one shown. */
  editedAtMs: number;
  signature: CaptureSignature;
};

/** What a file is within its shot: the RAW, the camera's own JPEG/HEIC, or an edit made from them. */
export type VersionKind = 'raw' | 'original' | 'edit';
export type VersionPairing = { versionId: string; photoId: string; kind: VersionKind; rule: string };
/** A file that has a candidate to be combined with and was left apart; `otherId` is that candidate. */
export type VersionRefusal = { assetId: string; reason: string; otherId?: string };
/**
`rule` is how the file was found for its shot: `name`, `time`, `folder` (stored beside it under the same name), or
`paired` for one that was combined before.
*/
export type ShotFile = { candidate: VersionCandidate; kind: VersionKind; rule: string };
/** The files of one shot; the first is its root (the camera's file, or the RAW of a RAW-only shot). */
export type Shot = { rootId: string; files: ShotFile[] };

/** Files of the same name are one shot when they were taken within this long of each other. */
export const NAME_WINDOW_SECONDS = 10;
/** This many files at one exact time is a camera whose clock was never set: the time then finds nothing. */
export const SAME_TIME_LIMIT = 10;

const differ = (a: string | null, b: string | null) => !!a && !!b && a.toLowerCase() !== b.toLowerCase();

const captureMs = ({ captureSecond, subSecond }: CaptureSignature) =>
  captureSecond ? Date.parse(`${captureSecond}Z`) + Math.round((subSecond ?? 0) * 1000) : null;

/** What a file is, from what was read from it: a RAW, an edit, or the camera's own file. */
export const kindOf = (signature: Pick<CaptureSignature, 'isRaw' | 'isEdit'>): VersionKind =>
  signature.isRaw ? 'raw' : signature.isEdit ? 'edit' : 'original';

const isRaw = (c: VersionCandidate) => kindOf(c.signature) === 'raw';
const isCameraFile = (c: VersionCandidate) => kindOf(c.signature) === 'original';
const isEditFile = (c: VersionCandidate) => kindOf(c.signature) === 'edit';

/**
What stops any pair, whatever the names and times say: another owner or library, a file that is kept apart (a
person marked it so, or it is a merge of several shots), a live photo, or the same bytes.
*/
const vetoed = (a: VersionCandidate, b: VersionCandidate) =>
  a.id === b.id ||
  a.ownerId !== b.ownerId ||
  a.libraryId !== b.libraryId ||
  a.signature.keepApart ||
  b.signature.keepApart ||
  a.isLivePhoto ||
  b.isLivePhoto ||
  a.checksum === b.checksum;

/**
What the two files say about their shot that cannot both be true: another camera (make, model, serial), another
shot counter or burst, another time zone. Only where both files record it: an export seldom has all its source has.
*/
const contradicts = ({ signature: x }: VersionCandidate, { signature: y }: VersionCandidate) =>
  differ(x.make, y.make) ||
  differ(x.model, y.model) ||
  differ(x.cameraSerial, y.cameraSerial) ||
  differ(x.shotNumber, y.shotNumber) ||
  differ(x.burstId, y.burstId) ||
  (x.offsetMinutes !== null && y.offsetMinutes !== null && x.offsetMinutes !== y.offsetMinutes);

const rejected = (a: VersionCandidate, b: VersionCandidate) => vetoed(a, b) || contradicts(a, b);

/** Taken within ten seconds of each other. A file that records no capture time is within nothing. */
const takenTogether = (a: VersionCandidate, b: VersionCandidate) => {
  const ta = captureMs(a.signature);
  const tb = captureMs(b.signature);
  return ta !== null && tb !== null && Math.abs(ta - tb) <= NAME_WINDOW_SECONDS * 1000;
};

/**
For files stored in one folder under the same name, the time only says no: when both record a capture time and they
are further apart than ten seconds (a camera's counter that came round again). One without a time agrees.
*/
const timesAgree = (a: VersionCandidate, b: VersionCandidate) => {
  const ta = captureMs(a.signature);
  const tb = captureMs(b.signature);
  return ta === null || tb === null || Math.abs(ta - tb) <= NAME_WINDOW_SECONDS * 1000;
};

/**
The folder rule: stored in one folder under the same name, only the extension differing, and nothing saying
otherwise, the capture time included where both have one. A stored name is unique in its folder, so the two are the
only files of that name there: a scan's TIFF and its HEIC with no capture time, or a RAW whose JPEG lost its time.
*/
const sameFolderShot = (a: VersionCandidate, b: VersionCandidate) =>
  !rejected(a, b) && sameStoredName(a.originalPath, b.originalPath) && timesAgree(a, b);

/**
Taken at exactly the same time: the same second and the same fraction of it, to the millisecond (`.60` and
`.600000` agree). A file that records no fraction is at `.0` of its second: it agrees with one at `.0` or `.000`, and
not with one at `.60`.
*/
const sameInstant = ({ signature: x }: VersionCandidate, { signature: y }: VersionCandidate) =>
  !!x.captureSecond &&
  x.captureSecond === y.captureSecond &&
  Math.abs((x.subSecond ?? 0) - (y.subSecond ?? 0)) < 0.0005;

/**
A RAW and the camera's own JPEG or HEIC are one shot when the device gave them the same name and they were taken
within ten seconds of each other, and nothing in them says otherwise. A camera uses a name again only after 10,000
shots; the frames of a burst each have their own. (Files stored side by side under one name are one shot through the
folder rule, `folderGroupOf`.)
*/
const rawAndCamera = (raw: VersionCandidate, camera: VersionCandidate) =>
  isRaw(raw) &&
  isCameraFile(camera) &&
  !rejected(raw, camera) &&
  sameShotName(raw.originalFileName, camera.originalFileName) &&
  takenTogether(raw, camera);

/** How an edit was found for its source, best first. */
const EDIT_RULES = ['name', 'folder', 'time'] as const;
type EditRule = (typeof EDIT_RULES)[number];

/**
How an edit goes with a RAW or a camera file, if it does: by `name` (it is named after that file, and both were
taken within ten seconds), by `folder` (stored beside it under the same name: an export saved over its source's name),
or by `time` (the edit says inside that it was made from that file, and both were taken at exactly the same time). The time alone never makes a pair: a camera takes two shots in one second. And what the
edit says inside comes first: an edit that names another file as the one it was made from does not go with this
one, whatever its own name is. The source is a RAW or a camera file; it is another edit only when a person named it
with a `noodle-gallery:version-of=` instruction, and then by the same time alone.
*/
const editAndSource = (edit: VersionCandidate, source: VersionCandidate, matchByTime: boolean): EditRule | null => {
  if (!isEditFile(edit) || rejected(edit, source)) {
    return null;
  }
  const named = edit.signature.sourceFileNames;
  const namesIt = named.some((name) => sameShotName(name, source.originalFileName));
  if (named.length > 0 && !namesIt) {
    return null;
  }
  if (isEditFile(source)) {
    return edit.signature.sourceFromInstruction && namesIt && matchByTime && sameInstant(edit, source) ? 'time' : null;
  }
  if (namedAfter(edit.originalFileName, source.originalFileName) && takenTogether(edit, source)) {
    return 'name';
  }
  if (sameFolderShot(edit, source)) {
    return 'folder';
  }
  if (namesIt && matchByTime && sameInstant(edit, source)) {
    return 'time';
  }
  return null;
};

/**
A shot's RAW and camera file; `others`, the further RAWs and camera files of a folder group, and `rule` how they
were found (`name` unless said).
*/
type Core = {
  raw?: VersionCandidate;
  camera?: VersionCandidate;
  others?: VersionCandidate[];
  rule?: 'name' | 'folder';
  refusals: VersionRefusal[];
};

const firstAdded = (files: VersionCandidate[]) =>
  files.toSorted((a, b) => a.addedAtMs - b.addedAtMs || a.id.localeCompare(b.id))[0] as VersionCandidate | undefined;

/**
The files stored beside a RAW or a camera file under the same name (`sameFolderShot`): all of them are one shot,
however many there are, RAWs only (a NEF and its DNG) or camera files only (a JPEG and a HEIC) too. Within one folder
the names cannot belong to two shots, so the one-to-one rule below does not apply. Its RAW and camera file are the
first added of each, so that every file of the group finds the same shot.
*/
const folderGroupOf = (file: VersionCandidate, all: VersionCandidate[]): Core | null => {
  const group = [file, ...all.filter((c) => c.id !== file.id && !isEditFile(c) && sameFolderShot(file, c))];
  if (group.length < 2) {
    return null;
  }
  const camera = firstAdded(group.filter((c) => isCameraFile(c)));
  const raw = firstAdded(group.filter((c) => isRaw(c)));
  return { camera, raw, others: group.filter((c) => c !== camera && c !== raw), rule: 'folder', refusals: [] };
};

/**
The RAW and the camera file of the shot a RAW or a camera file is in: those stored beside it under its name, else
those found by name and time. Unique both ways then: a RAW with two camera files, or a camera file with two RAWs, is
left apart.
*/
const coreOf = (file: VersionCandidate, all: VersionCandidate[]): Core => {
  const inFolder = folderGroupOf(file, all);
  if (inFolder) {
    return inFolder;
  }
  // a file stored beside a file of its name is that file's: it is no one else's match by name and time, even when the
  // file beside it has no capture time to be counted by (a JPEG without one, and a copy of it in another folder)
  const besideItsPair = (c: VersionCandidate) =>
    all.some((other) => other.id !== c.id && !isEditFile(other) && sameFolderShot(c, other));
  const free = all.filter((c) => !besideItsPair(c));
  const camerasOf = (raw: VersionCandidate) => free.filter((c) => rawAndCamera(raw, c));
  const rawsOf = (camera: VersionCandidate) => free.filter((c) => rawAndCamera(c, camera));

  if (isRaw(file)) {
    const cameras = camerasOf(file);
    if (cameras.length > 1) {
      return { raw: file, refusals: [{ assetId: file.id, reason: 'ambiguous-camera-file', otherId: cameras[0].id }] };
    }
    if (cameras.length === 1 && rawsOf(cameras[0]).length > 1) {
      return { raw: file, refusals: [{ assetId: file.id, reason: 'ambiguous-raw', otherId: cameras[0].id }] };
    }
    return { raw: file, camera: cameras[0], refusals: [] };
  }

  const raws = rawsOf(file);
  if (raws.length > 1) {
    return {
      camera: file,
      refusals: raws.map((raw) => ({ assetId: raw.id, reason: 'ambiguous-raw', otherId: file.id })),
    };
  }
  if (raws.length === 1 && camerasOf(raws[0]).length > 1) {
    return { camera: file, refusals: [{ assetId: raws[0].id, reason: 'ambiguous-camera-file', otherId: file.id }] };
  }
  return { camera: file, raw: raws[0], refusals: [] };
};

/**
Which shot a RAW and camera file are: the photo they are combined with, when they are (so that two files of one
photo are one shot though their names no longer say so), else the two files themselves.
*/
const shotKey = ({ raw, camera }: Core) => {
  const photoId = [camera, raw]
    .map((file) => file && (file.versionOf ?? (file.hasVersions ? file.id : null)))
    .find(Boolean);
  return photoId ? `photo:${photoId}` : `${camera?.id ?? ''}|${raw?.id ?? ''}`;
};

/**
The shots an edit could have been made from: a RAW and its JPEG are one shot, not two. An edit that a person named
(`noodle-gallery:version-of=`) leads to the shot that edit is in, one step only, so that two files naming each other
end; when Gallery has neither its RAW nor its camera file, the shot hangs on that edit.
*/
const sourcesOf = (
  edit: VersionCandidate,
  all: VersionCandidate[],
  matchByTime: boolean,
  throughNamedEdit = true,
): Array<{ core: Core; rule: EditRule }> => {
  const cores = new Map<string, { core: Core; rule: EditRule }>();
  const put = (core: Core, rule: EditRule) => {
    const known = cores.get(shotKey(core));
    // found one way through one file of the shot and another way through another: by name, then folder, then time
    const rank = (found: EditRule | undefined) => (found ? EDIT_RULES.indexOf(found) : EDIT_RULES.length);
    cores.set(shotKey(core), { core: known?.core ?? core, rule: rank(known?.rule) <= rank(rule) ? known!.rule : rule });
  };
  for (const source of all) {
    if (isEditFile(source) && !throughNamedEdit) {
      continue;
    }
    const rule = editAndSource(edit, source, matchByTime);
    if (!rule) {
      continue;
    }
    if (isEditFile(source)) {
      const ofNamed = sourcesOf(source, all, matchByTime, false);
      for (const { core } of ofNamed.length > 0 ? ofNamed : [{ core: { camera: source, refusals: [] } }]) {
        put(core, rule);
      }
      continue;
    }
    put(coreOf(source, all), rule);
  }
  return cores.values().toArray();
};

/** A photo that is an edit with only edits behind it: a shot that hangs on an edit a person named. */
const hangsOnAnEdit = (photoId: string, all: VersionCandidate[]) =>
  all.some((c) => c.id === photoId && isEditFile(c)) &&
  all.filter((c) => c.versionOf === photoId).every((c) => isEditFile(c));

export type LinkOptions = {
  /** Off: exported edits are left alone, and only a RAW is grouped with its camera file. */
  detectEdits: boolean;
  /** False when ten or more files share the file's exact time: the time then finds nothing. */
  matchByTime: boolean;
};

/**
The shot the job's file is in, among the candidates found for it: the camera's file and its RAW (found by name),
the edits made from them (by name, or named inside the edit and taken at exactly the same time), and whatever is
already combined with any of them. Null when the file has nothing to go with. A refusal is a file that has a
candidate and was left apart, with the reason.
*/
export const shotOf = (
  file: VersionCandidate,
  all: VersionCandidate[],
  { detectEdits, matchByTime }: LinkOptions,
): { shot: Shot | null; refusals: VersionRefusal[] } => {
  const refusals: VersionRefusal[] = [];
  let core: Core;
  if (isEditFile(file)) {
    // an edit that is combined already (behind a photo, or the photo itself) goes with that photo whatever its name
    // and time say now, and while edits are switched off too: its job still restores the photo's tags and picture.
    // What it is found to fit now counts only when that is its own shot: a corrected time must not bring a stranger in
    const photoId = file.versionOf ?? (file.hasVersions ? file.id : null);
    const sources = detectEdits ? sourcesOf(file, all, matchByTime) : [];
    // an edit with no source in Gallery: a shot hangs on it if a person named it (`noodle-gallery:version-of=`)
    const itself: Core = { camera: file, refusals: [] };
    if (photoId) {
      core =
        sources.find(({ core: found }) => shotKey(found) === `photo:${photoId}`)?.core ??
        (photoId === file.id ? itself : { refusals: [] });
    } else if (sources.length === 1) {
      core = sources[0].core;
    } else if (sources.length === 0) {
      core = itself;
    } else {
      return { shot: null, refusals: [{ assetId: file.id, reason: 'ambiguous-source' }] };
    }
  } else {
    core = coreOf(file, all);
  }
  refusals.push(...core.refusals);

  const files = new Map<string, ShotFile>();
  const add = (candidate: VersionCandidate, rule: string) => {
    if (files.has(candidate.id)) {
      return;
    }

    const kind = kindOf(candidate.signature);
    files.set(candidate.id, { candidate, kind, rule });
  };
  if (core.camera) {
    add(core.camera, core.rule ?? 'name');
  }
  if (core.raw) {
    add(core.raw, core.rule ?? 'name');
  }
  for (const other of core.others ?? []) {
    add(other, core.rule ?? 'name');
  }

  // the edits made from this shot
  for (const edit of detectEdits ? all.filter((c) => isEditFile(c)) : []) {
    const sources = sourcesOf(edit, all, matchByTime);
    const mine = sources.find(({ core: other }) => shotKey(other) === shotKey(core));
    if (!mine) {
      continue;
    }
    // an edit that is combined with another photo is not this shot's, whatever it fits now. Except the edit a shot
    // hangs on (a person named it): its RAW or camera file, arriving later, goes behind it
    const combinedWith = edit.versionOf ?? (edit.hasVersions ? edit.id : null);
    const isLater = (!!core.camera && !isEditFile(core.camera)) || !!core.raw;
    if (
      combinedWith &&
      shotKey(core) !== `photo:${combinedWith}` &&
      !(combinedWith === edit.id && isLater && hangsOnAnEdit(edit.id, all))
    ) {
      continue;
    }
    if (sources.length > 1) {
      refusals.push({ assetId: edit.id, reason: 'ambiguous-source' });
      continue;
    }
    add(edit, mine.rule);
  }

  // what is combined already stays together: a file behind a photo brings its photo, a photo the files behind it
  const byId = new Map(all.map((c) => [c.id, c]));
  const photoIds = new Set<string>();
  for (const { candidate } of [...files.values(), { candidate: file }]) {
    if (candidate.versionOf) {
      photoIds.add(candidate.versionOf);
    } else if (candidate.hasVersions) {
      photoIds.add(candidate.id);
    }
  }
  for (const photoId of photoIds) {
    const photo = byId.get(photoId);
    if (photo) {
      add(photo, 'paired');
    }
    for (const candidate of all) {
      if (candidate.versionOf === photoId) {
        add(candidate, 'paired');
      }
    }
  }

  const members = files.values().toArray();
  if (members.length < 2) {
    return { shot: null, refusals };
  }
  // the root: the camera's file, or the RAW of a RAW-only shot. An edit only for a shot that hangs on it (a person
  // named it, and Gallery has neither): the edit then, or the photo it has become
  const onAnEdit = !!core.camera && isEditFile(core.camera);
  const root =
    (onAnEdit ? undefined : core.camera) ??
    members.find(({ kind }) => kind === 'original')?.candidate ??
    core.raw ??
    members.find(({ kind }) => kind === 'raw')?.candidate ??
    (onAnEdit ? core.camera : undefined) ??
    members.find(({ candidate }) => candidate.hasVersions && hangsOnAnEdit(candidate.id, all))?.candidate;
  if (!root) {
    // only edits, and none a person named: their source is not in Gallery (yet), and there is no shot to group them
    return { shot: null, refusals };
  }
  // each file was checked against the one it was found by; the files brought together through a third must not
  // contradict each other either (a JPEG of one camera and an export of another, each matching a RAW that names
  // neither): then this is not one shot, and nothing of it is combined
  if (members.some((a) => members.some((b) => a !== b && contradicts(a.candidate, b.candidate)))) {
    for (const { candidate } of members) {
      if (candidate.id !== root.id) {
        refusals.push({ assetId: candidate.id, reason: 'contradicting-files', otherId: root.id });
      }
    }
    return { shot: null, refusals };
  }
  const others = members.filter(({ candidate }) => candidate.id !== root.id);
  const rootFile: ShotFile = { ...files.get(root.id)!, rule: others[0].rule };
  return { shot: { rootId: root.id, files: [rootFile, ...others] }, refusals };
};

/** What hangs on each file (albums, favourites, comments, shared links, Space links, ...), as keys that compare. */
export type Attachments = Map<string, Set<string>>;

/**
The photo of a shot, and the files that go behind it. The photo keeps its id for good, so it is chosen once:
a file that already has others behind it stays the photo. Otherwise it is the file with the most attached to it (so
what people organised keeps pointing at the same id, and nothing is moved); with nothing to tell them apart, the
camera's own file, the regular case. A file goes behind the photo only when the photo already has everything that
file has; one that has something of its own (a comment, an album the photo is not in) stays a separate photo.
A photo that is kept apart (its owner's instruction) takes no new file behind it; what is behind it already stays.
*/
export const planShot = (
  { rootId, files }: Shot,
  attachments: Attachments,
): { photoId: string | null; pairings: VersionPairing[]; refusals: VersionRefusal[] } => {
  const refusals: VersionRefusal[] = [];
  const attached = (file: ShotFile) => attachments.get(file.candidate.id) ?? new Set<string>();
  const shown = files.filter((file) => file.candidate.versionOf === null);

  const photos = shown.filter((file) => file.candidate.hasVersions);
  if (photos.length > 1) {
    // two files of one shot each have versions behind them: left as they are
    const [first, ...others] = photos;
    for (const other of others) {
      refusals.push({ assetId: other.candidate.id, reason: 'two-photos', otherId: first.candidate.id });
    }
    return { photoId: null, pairings: [], refusals };
  }

  // the regular order when nothing else decides: the camera's file (the shot's root), then the newest edit, then a
  // camera file before a RAW or TIFF, then the first added
  const KIND_ORDER: Record<VersionKind, number> = { edit: 1, original: 2, raw: 3 };
  const regular = (file: ShotFile) => (file.candidate.id === rootId ? 0 : KIND_ORDER[file.kind]);
  const eligible = shown.filter((file) => file.candidate.eligible);
  const byMostAttached = eligible.toSorted(
    (a, b) =>
      attached(b).size - attached(a).size ||
      regular(a) - regular(b) ||
      (a.kind === 'edit' && b.kind === 'edit' ? b.candidate.editedAtMs - a.candidate.editedAtMs : 0) ||
      a.candidate.addedAtMs - b.candidate.addedAtMs ||
      a.candidate.id.localeCompare(b.candidate.id),
  );
  const photo = photos[0] ?? byMostAttached[0];
  if (!photo) {
    return { photoId: null, pairings: [], refusals };
  }
  if (!photo.candidate.eligible) {
    // the photo is in the trash, offline or locked: the shot waits
    for (const file of eligible) {
      refusals.push({ assetId: file.candidate.id, reason: 'not-eligible', otherId: photo.candidate.id });
    }
    return { photoId: null, pairings: [], refusals };
  }

  const photoId = photo.candidate.id;
  if (photo.candidate.signature.keepApart) {
    // marked to be kept apart after files went behind it: they stay, and nothing new joins them
    return { photoId, pairings: [], refusals };
  }
  const pairings: VersionPairing[] = [];
  for (const file of files) {
    const { candidate } = file;
    if (candidate.id === photoId || candidate.versionOf === photoId) {
      continue;
    }
    if (candidate.versionOf) {
      refusals.push({ assetId: candidate.id, reason: 'version-of-another-photo', otherId: photoId });
      continue;
    }
    if (!candidate.eligible) {
      refusals.push({ assetId: candidate.id, reason: 'not-eligible', otherId: photoId });
      continue;
    }
    if (!attached(file).isSubsetOf(attached(photo))) {
      refusals.push({ assetId: candidate.id, reason: 'has-own-attachments', otherId: photoId });
      continue;
    }
    // why it belongs with the photo: its own evidence; for the shot's root, the evidence of the file that is the photo
    const rule = candidate.id === rootId ? photo.rule : file.rule;
    pairings.push({ versionId: candidate.id, photoId, kind: file.kind, rule: `${file.kind}:${rule}` });
  }
  return { photoId, pairings, refusals };
};

/** The newest edit: the file written last; two written in the same millisecond are told apart by id. */
const newest = <T extends { id: string; editedAtMs: number }>(edits: T[]) => {
  let latest = edits[0];
  for (const edit of edits) {
    if (edit.editedAtMs > latest.editedAtMs || (edit.editedAtMs === latest.editedAtMs && edit.id > latest.id)) {
      latest = edit;
    }
  }
  return latest;
};

/**
Whose picture a photo shows. The newest edit of the shot; when that is the photo's own file, or there is no
edit, its own file (null). A RAW that is the photo shows its camera JPEG/HEIC when it has one behind it and no edit.
*/
export const chooseLook = (
  photo: { id: string; kind: VersionKind; editedAtMs: number },
  versions: Array<{ id: string; kind: VersionKind; editedAtMs: number }>,
): string | null => {
  const edits = [photo, ...versions].filter((file) => file.kind === 'edit');
  if (edits.length > 0) {
    const latest = newest(edits);
    return latest.id === photo.id ? null : latest.id;
  }
  if (photo.kind === 'raw') {
    const originals = versions.filter((file) => file.kind === 'original').toSorted((a, b) => a.id.localeCompare(b.id));
    return originals[0]?.id ?? null;
  }
  return null;
};

/** Two names that could be of one shot, either way round: the same name, or one named after the other. */
const namesRelated = (a: string, b: string) => sameShotName(a, b) || namedAfter(a, b) || namedAfter(b, a);

export type LinkOutcome = {
  /** The photo of the file's shot, when there is one. Also when nothing new goes behind it. */
  photoId: string | null;
  pairings: VersionPairing[];
  /** What was left apart and why. Never about a file that is behind a photo: its decision stands. */
  notCombined: VersionRefusal[];
  /** The shot the decisions are about. */
  shot: Shot | null;
};

/**
Everything one job decides, from what it loaded: the job's file, the candidates found for it by name and time (the
file itself among them) with what was read from each, and what hangs on each (albums, favourites, ...).

`unreadable` are the names of candidates that were found and could not be read. They take no part, but they are
not forgotten: a shot one of them could belong to is left alone, or the files that could be read would look like
the only match.
*/
export const linkFile = (
  fileId: string,
  candidates: VersionCandidate[],
  attachments: Attachments,
  options: LinkOptions & { unreadable?: string[] },
): LinkOutcome => {
  const file = candidates.find((candidate) => candidate.id === fileId);
  if (!file) {
    return { photoId: null, pairings: [], notCombined: [], shot: null };
  }
  const behindAPhoto = new Set(candidates.filter((c) => c.versionOf).map((c) => c.id));
  const standing = (refusals: VersionRefusal[]) => refusals.filter(({ assetId }) => !behindAPhoto.has(assetId));

  const { shot, refusals } = shotOf(file, candidates, options);
  if (!shot) {
    return { photoId: null, pairings: [], notCombined: standing(refusals), shot: null };
  }
  // by its name, or by a name an edit of the shot records for the file it was made from
  const unreadable = (options.unreadable ?? []).some((name) =>
    shot.files.some(
      ({ candidate }) =>
        namesRelated(name, candidate.originalFileName) ||
        candidate.signature.sourceFileNames.some((source) => sameShotName(source, name)),
    ),
  );
  if (unreadable) {
    return {
      photoId: null,
      pairings: [],
      notCombined: standing([...refusals, { assetId: file.id, reason: 'unreadable-file' }]),
      shot,
    };
  }
  const plan = planShot(shot, attachments);
  return {
    photoId: plan.photoId,
    pairings: plan.pairings,
    notCombined: standing([...refusals, ...plan.refusals]),
    shot,
  };
};

/**
The one choice that cannot be put right later: a RAW becoming the photo with an edit behind it, when the camera's
JPEG of the shot is in Gallery but was not found, because its date is still provisional (Immich has not read its
metadata yet). Returns the names to look for such a file by, or null when the outcome is not that case.
*/
export const namesOfMissingCameraFile = ({ photoId, pairings, shot }: LinkOutcome): string[] | null => {
  if (!shot || !photoId || pairings.every(({ kind }) => kind !== 'edit')) {
    return null;
  }
  const photo = shot.files.find(({ candidate }) => candidate.id === photoId);
  if (!photo || photo.kind !== 'raw' || photo.candidate.hasVersions) {
    return null;
  }
  if (shot.files.some(({ kind }) => kind === 'original')) {
    return null;
  }
  return [...new Set(shot.files.map(({ candidate }) => candidate.originalFileName))];
};
