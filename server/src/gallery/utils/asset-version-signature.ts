import { basename, extname } from 'node:path';
import { hasEditMark, shotBase } from 'src/gallery/utils/asset-version-names.js';
import type { ImmichTags } from 'src/repositories/metadata.repository.js';
import { mimeTypes } from 'src/utils/mime-types.js';

// Reads what a file says about its shot (specs/2026-11-07-asset-versions-design.md, "Detection"). Pure: tags in,
// signature out, so the rules can be tested on recorded tags. Files are found for combining by name and time; what is
// read here says what a file is (a RAW, an edit, the camera's own file) and gives the rules their reasons to say no.

/** Bumped whenever the parser reads a field differently; stored signatures of an older parser are read again. */
export const READ_PARSER_VERSION = 1;

export type CaptureSignature = {
  make: string | null;
  model: string | null;
  cameraSerial: string | null;
  shotNumber: string | null;
  /** `YYYY-MM-DDTHH:MM:SS` on the camera's clock. */
  captureSecond: string | null;
  subSecond: number | null;
  offsetMinutes: number | null;
  /**
  The file an edit says it was made from, by name: the `noodle-gallery:version-of=` instruction a person gave it, and
  nothing else then; otherwise PreservedFileName, crs:RawFileName and DerivedFrom, each that is there (after a rename
  in Lightroom the first is the camera's name for the file and the second the new one).
  */
  sourceFileNames: string[];
  /**
  The names come from a `noodle-gallery:version-of=` instruction: a person said which file this one is a version of.
  Only then may the named file be an edit (see `editAndSource`).
  */
  sourceFromInstruction: boolean;
  software: string | null;
  /** The file is an edit: see `isEdit`. */
  isEdit: boolean;
  /**
  Never combined with anything: a person gave it the `noodle-gallery:keep-apart` instruction (or two
  `noodle-gallery:version-of=` instructions that disagree), or it is marked as a merge of several shots (an HDR, a
  panorama, more than one source).
  */
  keepApart: boolean;
  /** A RAW, or a master that is not an edit (a scan's TIFF): it goes behind the shot's JPEG or HEIC. */
  isRaw: boolean;
  burstId: string | null;
};

/**
What one read of a file with ExifTool gave: whether it could be read (`ok`), could not (`failed`) or had no tags
(`no-tags`); what the rules take from it (null unless `ok`); and which parser read it, when. Kept in the file's
`asset_version` row while it is part of a combined shot.
*/
export type FileRead = {
  status: 'ok' | 'failed' | 'no-tags';
  parserVersion: number;
  readAt: string;
  signature: CaptureSignature | null;
};

type Tags = Partial<Record<keyof ImmichTags, unknown>> & Record<string, unknown>;

const text = (value: unknown): string | null => {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return String(value);
  }
  if (typeof value !== 'string') {
    return null;
  }
  const trimmed = value.trim();
  return trimmed === '' ? null : trimmed;
};

/** A serial of zeros or a placeholder is no serial. */
const serial = (value: unknown) => {
  const found = text(value);
  return found && !/^0+$/.test(found) ? found : null;
};

const shot = (value: unknown) => {
  const found = text(value);
  if (!found || !/^\d+$/.test(found)) {
    return null;
  }
  const number = Number(found);
  return number > 0 ? String(number) : null;
};

// `2026:08:17 20:59:04.60-04:00`: exiftool's raw value keeps the sub-second digits as written. Its numeric
// SubSecTimeOriginal drops leading zeros (`.060` reads as 60), so the fraction is taken from the date string.
const DATE_PATTERN = /^(\d{4})[:-](\d\d)[:-](\d\d)[ T](\d\d):(\d\d):(\d\d)(\.\d+)?\s*(Z|[+-]\d\d:?\d\d)?/;

const rawDate = (value: unknown): string | null => {
  if (typeof value === 'string') {
    return value;
  }
  if (value && typeof value === 'object' && 'rawValue' in value && typeof value.rawValue === 'string') {
    return value.rawValue;
  }
  return null;
};

const parseOffset = (value: string | undefined | null): number | null => {
  if (!value) {
    return null;
  }
  if (value === 'Z') {
    return 0;
  }
  const match = /^([+-])(\d\d):?(\d\d)$/.exec(value.trim());
  if (!match) {
    return null;
  }
  const minutes = Number(match[2]) * 60 + Number(match[3]);
  return match[1] === '-' ? -minutes : minutes;
};

const parseCapture = (tags: Tags) => {
  // the time the picture was taken only. Not CreateDate: for a graphic or a scan that is when the file was saved,
  // and two unrelated files saved in one second would look like one shot
  const raw = rawDate(tags.SubSecDateTimeOriginal) ?? rawDate(tags.DateTimeOriginal);
  const match = raw ? DATE_PATTERN.exec(raw) : null;
  if (!match) {
    return { captureSecond: null, subSecond: null, offsetMinutes: null };
  }
  const [, year, month, day, hour, minute, second, fraction, offset] = match;
  let subSecond = fraction ? Number(`0${fraction}`) : null;
  if (subSecond === null && typeof tags.SubSecTimeOriginal === 'string' && /^\d+$/.test(tags.SubSecTimeOriginal)) {
    subSecond = Number(`0.${tags.SubSecTimeOriginal}`);
  }
  return {
    captureSecond: `${year}-${month}-${day}T${hour}:${minute}:${second}`,
    subSecond,
    offsetMinutes: parseOffset(offset) ?? parseOffset(text(tags.OffsetTimeOriginal)),
  };
};

const asList = (value: unknown): unknown[] => {
  if (Array.isArray(value)) {
    return value;
  }
  return value === undefined || value === null ? [] : [value];
};

const field = (value: unknown, key: string): string | null =>
  value && typeof value === 'object' ? text((value as Record<string, unknown>)[key]) : null;

const fileName = (value: string | null) => (value ? basename(value.replaceAll('\\', '/')) : null);

/** xmpMM:DerivedFrom is a ResourceRef (Adobe) or, from darktable, the source's file name as a plain string. */
const parseDerivedFrom = (tags: Tags) => {
  const sources = asList(tags.DerivedFrom);
  const first = sources[0];
  if (typeof first === 'string') {
    return { documentId: null, instanceId: null, fileName: fileName(text(first)), count: sources.length };
  }
  return {
    documentId: field(first, 'DocumentID') ?? text(tags.DerivedFromDocumentID),
    instanceId: field(first, 'InstanceID') ?? text(tags.DerivedFromInstanceID),
    fileName: fileName(field(first, 'FilePath') ?? text(tags.DerivedFromFilePath)),
    count: sources.length,
  };
};

const hasDerivedEvent = (tags: Tags) =>
  asList(tags.History).some((event) => {
    const action = field(event, 'Action') ?? (typeof event === 'string' ? event : null);
    return !!action && /\b(derived|converted)\b/i.test(action);
  });

const truthy = (value: unknown) => [true, 1, 'True', 'true'].includes(value as never);

/** An instruction that keeps a file out of versions: a person's "do not combine this one". */
export const KEEP_APART_INSTRUCTION = 'noodle-gallery:keep-apart';
/** An instruction that names the photo a file is a version of: `noodle-gallery:version-of=DSC_9422.JPG`. */
export const VERSION_OF_INSTRUCTION = 'noodle-gallery:version-of=';

/**
The instructions a person gave a file, from the IPTC Instructions field (XMP photoshop:Instructions, IPTC
SpecialInstructions), which photo programs offer for "how to handle this picture" and Immich does not read, so an
instruction never becomes a tag. One field holds several, one per line or separated by `;`; any other text in it is
left alone. Not the keywords: Immich turns those into tags.
*/
export const instructionsOf = (tags: Record<string, unknown>): string[] =>
  [tags.Instructions, tags.SpecialInstructions]
    .flatMap((value) => asList(value))
    .flatMap((value) => (text(value) ?? '').split(/[\n\r;]+/))
    .map((part) => text(part))
    .filter((part): part is string => part !== null);

const hasInstruction = (instructions: string[], instruction: string) =>
  instructions.some((value) => value.toLowerCase() === instruction);

/**
The file names the file's `noodle-gallery:version-of=` instructions give, each once. A program writes the field in two
places, and a correction may reach only one of them: more than one name here is a file that says two things.
*/
const versionOfNames = (instructions: string[]): string[] => {
  const names = new Map<string, string>();
  for (const instruction of instructions) {
    const name = instruction.toLowerCase().startsWith(VERSION_OF_INSTRUCTION)
      ? fileName(text(instruction.slice(VERSION_OF_INSTRUCTION.length)))
      : null;
    if (name) {
      names.set(shotBase(name), name);
    }
  }
  return names.values().toArray();
};

/**
The names an editor recorded for the file this one was made from. A file that records its own name says nothing about
where it came from (some programs write the name a camera's JPEG already has): that name is left out. Only the very
same name: an export saved under its source's name (`DSC_9425.jpg` from `DSC_9425.NEF` or `DSC_9425.JPG`) keeps it.
*/
const recordedNames = (tags: Tags, originalFileName: string): string[] => {
  const recorded = [
    fileName(text(tags.PreservedFileName)),
    fileName(text(tags.RawFileName)),
    parseDerivedFrom(tags).fileName,
  ];
  const own = basename(originalFileName);
  return [...new Set(recorded.filter((name): name is string => name !== null && name !== own))];
};

const sourceFileNames = (tags: Tags, instructions: string[], originalFileName: string): string[] => {
  const given = versionOfNames(instructions);
  if (given.length > 0) {
    return given;
  }
  return recordedNames(tags, originalFileName);
};

/**
Whether a file is an edit, by the markers there are: its name carries an edit mark (`-edit`, `_edited`, an
iPhone's `IMG_E…`), or the file says so inside (it names the file it was made from, by an instruction or a metadata
field, points at one by id, or its History records a `derived` or `converted` step). A RAW is never an edit. The
software tag alone says nothing: every camera writes one.
*/
export const isEdit = (tags: Tags, originalFileName: string, instructions = instructionsOf(tags)): boolean => {
  if (mimeTypes.isRaw(originalFileName)) {
    return false;
  }
  const derivedFrom = parseDerivedFrom(tags);
  return (
    hasEditMark(originalFileName) ||
    versionOfNames(instructions).length > 0 ||
    recordedNames(tags, originalFileName).length > 0 ||
    !!derivedFrom.documentId ||
    !!derivedFrom.instanceId ||
    hasDerivedEvent(tags)
  );
};

/**
`sidecarInstructions`: the instructions of the file's XMP sidecar, which is where programs write a RAW's metadata.
They count as the file's own.
*/
/**
Formats kept as a picture's master although Immich does not list them as RAW: a scan's TIFF. One that is not an edit
(no edit mark, nothing inside naming a source) counts as the shot's RAW, so a JPEG or HEIC of it is the photo and
the TIFF goes behind it. An edited TIFF (`DSC_0001-Edit.tif`) stays an edit.
*/
const MASTER_EXTENSIONS = new Set(['.tif', '.tiff']);

export const toCaptureSignature = (
  tags: Tags,
  originalFileName: string,
  sidecarInstructions: string[] = [],
): CaptureSignature => {
  const derivedFrom = parseDerivedFrom(tags);
  const instructions = [...instructionsOf(tags), ...sidecarInstructions];
  const edit = isEdit(tags, originalFileName, instructions);
  return {
    make: text(tags.Make),
    model: text(tags.Model),
    cameraSerial: serial(tags.SerialNumber) ?? serial(tags.InternalSerialNumber) ?? serial(tags.BodySerialNumber),
    // the camera's own counters only. Not ImageNumber: Lightroom writes one into its exports (aux:ImageNumber) that
    // is the shutter count for a Nikon and another number for a Canon or a Sony, and would contradict the source.
    shotNumber: shot(tags.ShutterCount) ?? shot(tags.ImageCount),
    ...parseCapture(tags),
    sourceFileNames: sourceFileNames(tags, instructions, originalFileName),
    sourceFromInstruction: versionOfNames(instructions).length > 0,
    software: text(tags.Software) ?? text(tags.CreatorTool),
    isEdit: edit,
    keepApart:
      hasInstruction(instructions, KEEP_APART_INSTRUCTION) ||
      // two `noodle-gallery:version-of=` instructions that name different photos: neither is followed
      versionOfNames(instructions).length > 1 ||
      truthy(tags.IsMergedHDR) ||
      truthy(tags.IsMergedPanorama) ||
      derivedFrom.count > 1,
    isRaw:
      mimeTypes.isRaw(originalFileName) || (MASTER_EXTENSIONS.has(extname(originalFileName).toLowerCase()) && !edit),
    burstId: text(tags.BurstUUID) ?? text(tags.BurstID),
  };
};

export const hasTags = (tags: Record<string, unknown>) => Object.keys(tags).length > 0;
