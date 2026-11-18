import { describe, expect, it } from 'vitest';
import {
  chooseLook,
  linkFile,
  namesOfMissingCameraFile,
  type Attachments,
  type VersionCandidate,
} from 'src/gallery/utils/asset-version-rules.js';
import { isEdit, toCaptureSignature } from 'src/gallery/utils/asset-version-signature.js';

// Tag shapes as exiftool-vendored returns them for real files (2026-11, serials and ids replaced).
const date = (rawValue: string) => ({ _ctor: 'ExifDateTime', rawValue });

const nikon = {
  Make: 'NIKON CORPORATION',
  Model: 'NIKON Z50_2',
  Software: 'Ver.01.11',
  OffsetTimeOriginal: '-04:00',
  SerialNumber: 1_234_567,
  ShutterCount: 3196,
  SubSecTimeOriginal: 60,
  SubSecDateTimeOriginal: date('2026:08:17 20:59:04.60-04:00'),
  DateTimeOriginal: date('2026:08:17 20:59:04.60-04:00'),
};

const lightroomExport = {
  ...nikon,
  ShutterCount: undefined,
  ImageNumber: 3196,
  Software: 'Adobe Photoshop Lightroom Classic 15.6 (Macintosh)',
  DocumentID: 'xmp.did:97db1183-0000-0000-0000-f9efb4964bf2',
  InstanceID: 'xmp.iid:97db1183-0000-0000-0000-f9efb4964bf2',
  OriginalDocumentID: 'B25A0BF6000000000000CE332927F58D',
  PreservedFileName: 'DSC_3198.NEF',
  RawFileName: 'DSC_3198.NEF',
  History: [
    { Action: 'derived', Parameters: 'converted from image/x-nikon-nef to image/jpeg, saved to new location' },
    { Action: 'saved', SoftwareAgent: 'Adobe Photoshop Lightroom Classic 15.6 (Macintosh)' },
  ],
  DerivedFrom: {
    DocumentID: 'B25A0BF6000000000000CE332927F58D',
    OriginalDocumentID: 'B25A0BF6000000000000CE332927F58D',
  },
};

const pixel = (subSecond: string, InstanceID: string) => ({
  Make: 'Google',
  Model: 'Pixel 11 Pro',
  Software: 'HDR+ 1.0.982810169zd',
  OffsetTimeOriginal: '+02:00',
  InstanceID,
  SubSecDateTimeOriginal: date(`2026:10:19 14:28:24.${subSecond}+02:00`),
  DateTimeOriginal: date(`2026:10:19 14:28:24.${subSecond}+02:00`),
});

// An Olympus E-PL1 (2015): a serial, no shot counter, no sub-second time. Canon's EOS 250D writes no counter either.
const olympus = {
  Make: 'OLYMPUS IMAGING CORP.',
  Model: 'E-PL1',
  Software: 'Version 1.1',
  SerialNumber: 'ABC123456',
  DateTimeOriginal: date('2015:09:20 18:09:44'),
};

// A Sony A7 V (2025): serial and shutter count in Sony's maker notes only. The count is of the mechanical shutter, so
// it stands still through a silent burst.
const sony = (time: string, extra: Record<string, unknown> = {}) => ({
  Make: 'SONY',
  Model: 'ILCE-7M5',
  Software: 'ILCE-7M5 v1.00',
  OffsetTimeOriginal: '+01:00',
  InternalSerialNumber: 'c8500000 0000',
  ShutterCount: 673,
  SubSecDateTimeOriginal: date(`2026:10:13 ${time}+01:00`),
  DateTimeOriginal: date(`2026:10:13 ${time}+01:00`),
  ...extra,
});

// Its Lightroom Classic export: the maker notes are gone, and with them the serial and the count.
const sonyExport = (source: string) => ({
  ...sony('17:05:25.632', { InternalSerialNumber: undefined, ShutterCount: undefined }),
  Software: 'Adobe Photoshop Lightroom Classic 15.5.1 (Macintosh)',
  DocumentID: 'xmp.did:2ad9f77c-0000-0000-0000-af684e0aae6d',
  InstanceID: 'xmp.iid:2ad9f77c-0000-0000-0000-af684e0aae6d',
  OriginalDocumentID: 'urn:uuid:3e262c7c-0000-0000-0000-0d14849e5aa2',
  PreservedFileName: source,
  RawFileName: source,
  History: [{ Action: 'derived', Parameters: 'converted from image/x-sony-arw to image/jpeg, saved to new location' }],
});

let checksum = 0;
const candidate = (
  id: string,
  fileName: string,
  tags: Record<string, unknown>,
  extra: Partial<VersionCandidate> = {},
) =>
  ({
    id,
    ownerId: 'owner',
    libraryId: null,
    originalFileName: fileName,
    // each in a folder of its own: the folder rule takes part only where a test puts two files side by side
    originalPath: `/photos/${id}/${fileName}`,
    addedAtMs: 0,
    checksum: String(checksum++),
    isLivePhoto: false,
    eligible: true,
    versionOf: null,
    hasVersions: false,
    editedAtMs: 0,
    signature: toCaptureSignature(tags, fileName),
    ...extra,
  }) satisfies VersionCandidate;

/** What hangs on the files, by id: `{ edit: ['album:a', 'favorite:me'] }`. */
const attached = (entries: Record<string, string[]> = {}): Attachments =>
  new Map(Object.entries(entries).map(([id, keys]) => [id, new Set(keys)]));

type Options = { attachments?: Attachments; detectEdits?: boolean; matchByTime?: boolean; unreadable?: string[] };

/** What the job of one file decides, from the files found for it. */
const link = (fileId: string, all: VersionCandidate[], options: Options = {}) => {
  const { attachments = attached(), detectEdits = true, matchByTime = true, unreadable = [] } = options;
  const { photoId, pairings, notCombined } = linkFile(fileId, all, attachments, {
    detectEdits,
    matchByTime,
    unreadable,
  });
  return { photoId, pairings, notCombined };
};

/** What goes behind what, as [file, photo, kind], whichever file's job it is: the answer must not depend on that. */
const moves = (all: VersionCandidate[], options: Options = {}) => {
  const sorted = (fileId: string) =>
    link(fileId, all, options)
      .pairings.map(({ versionId, photoId, kind }) => [versionId, photoId, kind])
      .toSorted(byText);
  const [first, ...others] = all.filter((file) => !file.versionOf).map((file) => sorted(file.id));
  for (const other of others) {
    expect(other).toEqual(first);
  }
  return first;
};

const shotJpeg = (extra: Partial<VersionCandidate> = {}) => candidate('jpeg', 'DSC_3198.JPG', nikon, extra);
const shotRaw = (extra: Partial<VersionCandidate> = {}) => candidate('raw', 'DSC_3198.NEF', nikon, extra);
/** A Lightroom export under a name of its own: it is found by its time, and says inside what it was made from. */
const exportAt = (id: string, editedAtMs: number) =>
  candidate(id, `${id}.jpg`, { ...lightroomExport, InstanceID: `xmp.iid:${id}` }, { editedAtMs });
/** A Lightroom export named after its source. */
const namedExport = (extra: Partial<VersionCandidate> = {}) =>
  candidate('edit', 'DSC_3198-Edit.jpg', lightroomExport, extra);

// A Pixel names the two files of one shot alike, up to the labels after the name; they differ in their fraction.
const phoneJpeg = () => candidate('jpeg', 'PXL_20261019_122824927.RAW-01.COVER.jpg', pixel('927', 'b77e'));
const phoneRaw = () => candidate('raw', 'PXL_20261019_122824927.RAW-02.ORIGINAL.dng', pixel('794000', 'd861'));
const file = (id: string, kind: 'raw' | 'original' | 'edit', editedAtMs = 0) => ({ id, kind, editedAtMs });

const byText = (a: unknown, b: unknown) => String(a).localeCompare(String(b));
/** The Nikon's tags with another capture time. */
const nikonAt = (time: string) => ({ ...nikon, SubSecDateTimeOriginal: date(time), DateTimeOriginal: date(time) });
/** A frame of a Sony's silent burst: serial, counter and second are the same for every frame. */
const burstFrame = (n: number, raw: boolean) =>
  candidate(`${raw ? 'raw' : 'jpeg'}-${n}`, `DSC_010${n}.${raw ? 'ARW' : 'JPG'}`, sony(`17:05:25.${n}00`));
const inBurst = (id: string, name: string, burst: string) => candidate(id, name, { ...nikon, BurstUUID: burst });
/** An export that says it is one and names no source, taken in the Nikon's second with this fraction. */
const unnamedExportAt = (fraction: string) => {
  const time = `2026:08:17 20:59:04${fraction}-04:00`;
  return {
    ...lightroomExport,
    PreservedFileName: undefined,
    RawFileName: undefined,
    SubSecDateTimeOriginal: date(time),
    DateTimeOriginal: date(time),
    SubSecTimeOriginal: undefined,
  };
};
/** What goes behind what from the job of each of these files: a file left apart decides nothing in its own job. */
const movesFrom = (fileIds: string[], all: VersionCandidate[]) => {
  const answers = fileIds.map((fileId) =>
    link(fileId, all)
      .pairings.map(({ versionId, photoId, kind }) => [versionId, photoId, kind])
      .toSorted(byText),
  );
  for (const answer of answers) {
    expect(answer).toEqual(answers[0]);
  }
  return answers[0];
};
const nothing = { photoId: null, pairings: [], notCombined: [] };
/** The same export, naming the file it was made from. */
const exportAtFraction = (fraction: string) =>
  candidate('lake', 'lake.jpg', { ...unnamedExportAt(fraction), PreservedFileName: 'DSC_3198.NEF' });
/** A copy of the camera's JPEG under a name of its own, with these instructions: only the camera's metadata otherwise. */
const fix = (instructions: string[]) =>
  candidate('fix', 'glare-fix-12.jpg', { ...nikon, ShutterCount: undefined, Instructions: instructions.join('\n') });
/** A file with only the camera's metadata and a `noodle-gallery:version-of=` instruction naming `names`. */
const tagged = (id: string, names: string, extra: Partial<VersionCandidate> = {}) =>
  candidate(
    id,
    `${id}.jpg`,
    { ...nikon, ShutterCount: undefined, Instructions: `noodle-gallery:version-of=${names}` },
    extra,
  );
const outcomeOf = (fileId: string, all: VersionCandidate[]) =>
  linkFile(fileId, all, attached(), { detectEdits: true, matchByTime: true });

describe('what is read from a file', () => {
  it('keeps the sub-second digits as written, not the numeric tag', () => {
    expect(toCaptureSignature(pixel('060', 'a'), 'a.jpg')).toMatchObject({
      captureSecond: '2026-10-19T14:28:24',
      subSecond: 0.06,
      offsetMinutes: 120,
    });
  });

  it('reads what Lightroom writes into an export', () => {
    expect(toCaptureSignature(lightroomExport, 'export.jpg')).toMatchObject({
      cameraSerial: '1234567',
      // Lightroom's ImageNumber is not read as the shot counter: it is the shutter count for this Nikon, and another
      // number for a Canon or a Sony
      shotNumber: null,
      sourceFileNames: ['DSC_3198.NEF'],
      isEdit: true,
      isRaw: false,
    });
  });

  it("reads darktable's DerivedFrom string as the source's file name", () => {
    expect(toCaptureSignature({ ...nikon, DerivedFrom: 'DSC_3198.NEF' }, 'x.jpg')).toMatchObject({
      sourceFileNames: ['DSC_3198.NEF'],
      isEdit: true,
    });
  });

  it('keeps every name an export records for its source, once each', () => {
    // renamed in Lightroom: the camera's name for the file, and the name it has now
    const renamed = { ...lightroomExport, PreservedFileName: 'DSC_3198.NEF', RawFileName: '2026-08-17 lake.NEF' };
    expect(toCaptureSignature(renamed, 'x.jpg').sourceFileNames).toEqual(['DSC_3198.NEF', '2026-08-17 lake.NEF']);
    expect(toCaptureSignature(nikon, 'DSC_3198.JPG').sourceFileNames).toEqual([]);
    expect(toCaptureSignature(renamed, 'x.jpg').sourceFromInstruction).toBe(false);
  });

  it('takes the time the picture was taken, never the time the file was made', () => {
    const scan = { Software: 'GIMP 2.10', CreateDate: date('2026:08:17 20:59:04') };
    expect(toCaptureSignature(scan, 'scan.jpg')).toMatchObject({ captureSecond: null, subSecond: null });
  });

  it('keeps a merge apart: an HDR, a panorama, a file made from several sources', () => {
    expect(toCaptureSignature({ ...nikon, IsMergedHDR: true }, 'x.dng').keepApart).toBe(true);
    expect(toCaptureSignature({ ...nikon, IsMergedPanorama: 'True' }, 'x.dng').keepApart).toBe(true);
    expect(toCaptureSignature({ ...nikon, DerivedFrom: ['a.NEF', 'b.NEF'] }, 'x.jpg').keepApart).toBe(true);
    expect(toCaptureSignature(nikon, 'x.dng').keepApart).toBe(false);
    // what was placed into a picture in an editor is not looked at
    expect(
      toCaptureSignature({ ...nikon, Ingredients: [{ FilePath: 'a.jpg' }, { FilePath: 'b.jpg' }] }, 'x.jpg').keepApart,
    ).toBe(false);
  });

  it('reads the two instructions a person can give a file, from the Instructions field in either of its forms', () => {
    for (const field of ['Instructions', 'SpecialInstructions']) {
      // among other text, on a line of its own or after a `;`
      expect(
        toCaptureSignature({ ...nikon, [field]: 'print 20x30\nnoodle-gallery:keep-apart' }, 'x.jpg').keepApart,
      ).toBe(true);
      expect(
        toCaptureSignature({ ...nikon, [field]: 'crop tighter; Noodle-Gallery:Keep-Apart' }, 'x.jpg').keepApart,
      ).toBe(true);
      // only the full name, as a part of its own: something another program could write does nothing
      expect(toCaptureSignature({ ...nikon, [field]: 'gallery:keep-apart' }, 'x.jpg').keepApart).toBe(false);
      expect(toCaptureSignature({ ...nikon, [field]: 'not noodle-gallery:keep-apart' }, 'x.jpg').keepApart).toBe(false);
      expect(
        toCaptureSignature({ ...nikon, [field]: 'noodle-gallery:version-of=DSC_3198.JPG' }, 'fix.jpg'),
      ).toMatchObject({
        sourceFileNames: ['DSC_3198.JPG'],
        sourceFromInstruction: true,
        isEdit: true,
        keepApart: false,
      });
    }
    // the same instruction in both forms, as a program writes it, is one
    expect(
      toCaptureSignature(
        {
          ...nikon,
          Instructions: 'noodle-gallery:version-of=DSC_3198.JPG',
          SpecialInstructions: 'noodle-gallery:version-of=DSC_3198.JPG',
        },
        'fix.jpg',
      ),
    ).toMatchObject({ sourceFileNames: ['DSC_3198.JPG'], keepApart: false });
    expect(toCaptureSignature({ ...nikon, Instructions: 'lake' }, 'x.jpg')).toMatchObject({
      keepApart: false,
      sourceFileNames: [],
      isEdit: false,
    });
    // an instruction with no name after it says nothing
    expect(toCaptureSignature({ ...nikon, Instructions: 'noodle-gallery:version-of=' }, 'x.jpg')).toMatchObject({
      sourceFileNames: [],
      isEdit: false,
    });
  });

  it('does not read the keywords: Immich turns those into tags', () => {
    for (const field of ['Keywords', 'Subject', 'TagsList']) {
      expect(toCaptureSignature({ ...nikon, [field]: ['noodle-gallery:keep-apart'] }, 'x.jpg').keepApart).toBe(false);
      expect(
        toCaptureSignature({ ...nikon, [field]: ['noodle-gallery:version-of=DSC_3198.JPG'] }, 'fix.jpg'),
      ).toMatchObject({ sourceFileNames: [], sourceFromInstruction: false, isEdit: false });
    }
  });

  it("reads the sidecar's instructions as the file's own", () => {
    expect(toCaptureSignature(nikon, 'DSC_3198.NEF', ['noodle-gallery:keep-apart']).keepApart).toBe(true);
    expect(toCaptureSignature(nikon, 'fix.jpg', ['noodle-gallery:version-of=DSC_3198.JPG'])).toMatchObject({
      sourceFileNames: ['DSC_3198.JPG'],
      sourceFromInstruction: true,
      isEdit: true,
    });
    // the file and its sidecar naming different photos: neither is followed
    expect(
      toCaptureSignature({ ...nikon, Instructions: 'noodle-gallery:version-of=DSC_3197.JPG' }, 'fix.jpg', [
        'noodle-gallery:version-of=DSC_3198.JPG',
      ]).keepApart,
    ).toBe(true);
  });

  it('takes a person’s instruction over what an editor recorded', () => {
    const tagged = { ...lightroomExport, Instructions: 'noodle-gallery:version-of=DSC_3200.NEF' };
    expect(toCaptureSignature(tagged, 'x.jpg').sourceFileNames).toEqual(['DSC_3200.NEF']);
  });
});

describe('isEdit: the markers of an edit', () => {
  it('is an edit when its name carries an edit mark, whatever is inside', () => {
    for (const name of ['DSC_3198-edit.jpg', 'DSC_3198_edited.jpg', 'IMG_E9443.JPG']) {
      expect(isEdit(nikon, name)).toBe(true);
    }
  });

  it('is not an edit for a program’s output name or a copy mark', () => {
    expect(isEdit(nikon, 'P1011234_result.JPG')).toBe(false);
    expect(isEdit(pixel('927', 'a'), 'PXL_20261019_122824927~2.jpg')).toBe(false);
  });

  it('is an edit when the file says so inside, whatever its name', () => {
    expect(isEdit(lightroomExport, 'lake.jpg')).toBe(true);
    expect(isEdit({ ...nikon, PreservedFileName: 'DSC_3198.NEF' }, 'lake.jpg')).toBe(true);
    expect(isEdit({ ...nikon, RawFileName: 'DSC_3198.NEF' }, 'lake.jpg')).toBe(true);
    expect(isEdit({ ...nikon, DerivedFrom: 'DSC_3198.NEF' }, 'lake.jpg')).toBe(true);
    expect(isEdit({ ...nikon, DerivedFrom: { InstanceID: 'xmp.iid:source' } }, 'lake.jpg')).toBe(true);
    expect(isEdit({ ...nikon, DerivedFrom: { DocumentID: 'xmp.did:source' } }, 'lake.jpg')).toBe(true);
    expect(isEdit({ ...nikon, History: [{ Action: 'derived' }] }, 'lake.jpg')).toBe(true);
    expect(isEdit({ ...nikon, History: [{ Action: 'converted' }] }, 'lake.jpg')).toBe(true);
  });

  it('is not an edit for a camera’s own file: the software tag alone says nothing', () => {
    expect(isEdit(nikon, 'DSC_3198.JPG')).toBe(false);
    expect(isEdit(olympus, 'P9201234.JPG')).toBe(false);
    expect(isEdit(pixel('927', 'a'), 'PXL_20261019_122824927.RAW-01.COVER.jpg')).toBe(false);
    expect(isEdit({ ...nikon, Software: 'Adobe Photoshop Lightroom Classic 15.6' }, 'DSC_3198.JPG')).toBe(false);
    // a History that only records a save
    expect(isEdit({ ...nikon, History: [{ Action: 'saved' }] }, 'DSC_3198.JPG')).toBe(false);
    // a copy or a number is no edit
    expect(isEdit(nikon, 'DSC_3198 (1).JPG')).toBe(false);
    expect(isEdit(nikon, 'DSC_3198-2.JPG')).toBe(false);
  });

  it('is not an edit for a camera file that records its own name, and keeps the source of an export named like it', () => {
    // some programs write the name a camera's JPEG already has into it
    for (const field of ['PreservedFileName', 'RawFileName', 'DerivedFrom']) {
      const own = toCaptureSignature({ ...olympus, [field]: 'P9201234.JPG' }, 'P9201234.JPG');
      expect(own).toMatchObject({ isEdit: false, sourceFileNames: [] });
    }
    // an export saved under its source's name, from the RAW or from the camera JPEG
    expect(toCaptureSignature({ ...nikon, PreservedFileName: 'DSC_3198.NEF' }, 'DSC_3198.jpg')).toMatchObject({
      isEdit: true,
      sourceFileNames: ['DSC_3198.NEF'],
    });
    expect(toCaptureSignature({ ...nikon, PreservedFileName: 'DSC_3198.JPG' }, 'DSC_3198.jpg')).toMatchObject({
      isEdit: true,
      sourceFileNames: ['DSC_3198.JPG'],
    });
    // such a camera file is the camera file of its shot: its RAW goes behind it
    const jpeg = candidate('jpeg', 'P9201234.JPG', { ...olympus, PreservedFileName: 'P9201234.JPG' });
    const raw = candidate('raw', 'P9201234.ORF', olympus);
    expect(moves([jpeg, raw])).toEqual([['raw', 'jpeg', 'raw']]);
  });

  it('is never an edit for a RAW', () => {
    expect(isEdit(nikon, 'DSC_3198.NEF')).toBe(false);
    expect(isEdit(nikon, 'DSC_3198-edit.NEF')).toBe(false);
    expect(isEdit(lightroomExport, 'DSC_3198.dng')).toBe(false);
  });
});

describe('a RAW and the camera’s own file', () => {
  it('go together by name: the RAW goes behind the JPEG, whichever job it is', () => {
    expect(link('raw', [shotJpeg(), shotRaw()])).toEqual({
      photoId: 'jpeg',
      pairings: [{ versionId: 'raw', photoId: 'jpeg', kind: 'raw', rule: 'raw:name' }],
      notCombined: [],
    });
    expect(link('jpeg', [shotRaw(), shotJpeg()])).toEqual(link('raw', [shotJpeg(), shotRaw()]));
  });

  it('go together for a phone as for a camera: a Pixel’s RAW and JPEG, by the name without its labels', () => {
    expect(moves([phoneJpeg(), phoneRaw()])).toEqual([['raw', 'jpeg', 'raw']]);
  });

  it('go together for a camera that writes a serial and no shot counter, and no fraction of a second', () => {
    const jpeg = candidate('jpeg', 'P9201234.JPG', olympus);
    const raw = candidate('raw', 'P9201234.ORF', olympus);
    expect(moves([jpeg, raw])).toEqual([['raw', 'jpeg', 'raw']]);
  });

  it('go together up to ten seconds apart, and not beyond', () => {
    const jpeg = candidate('jpeg', 'DSC_3198.JPG', nikonAt('2026:08:17 20:59:04.60-04:00'));
    const near = candidate('raw', 'DSC_3198.NEF', nikonAt('2026:08:17 20:59:14.60-04:00'));
    const far = candidate('raw', 'DSC_3198.NEF', nikonAt('2026:08:17 20:59:14.70-04:00'));
    expect(moves([jpeg, near])).toEqual([['raw', 'jpeg', 'raw']]);
    expect(link('raw', [jpeg, far])).toEqual({ photoId: null, pairings: [], notCombined: [] });
  });

  it('do not go together under different names, however close in time: nothing to report', () => {
    const other = candidate('raw', 'DSC_3199.NEF', nikon);
    expect(link('raw', [shotJpeg(), other])).toEqual({ photoId: null, pairings: [], notCombined: [] });
    expect(link('jpeg', [shotJpeg(), other])).toEqual({ photoId: null, pairings: [], notCombined: [] });
  });

  it('do not go together when the same name comes round again: file numbers start over after 9999', () => {
    const later = {
      ...nikon,
      SubSecDateTimeOriginal: date('2027:03:02 10:00:00.10-05:00'),
      DateTimeOriginal: undefined,
    };
    expect(link('raw', [shotJpeg(), candidate('raw', 'DSC_3198.NEF', later)]).pairings).toEqual([]);
  });

  it('pair each frame of a burst with its own RAW: the frames share the second, and differ in name', () => {
    const burst = [1, 2, 3].flatMap((n) => [burstFrame(n, false), burstFrame(n, true)]);
    for (const n of [1, 2, 3]) {
      expect(link(`raw-${n}`, burst).pairings).toEqual([
        { versionId: `raw-${n}`, photoId: `jpeg-${n}`, kind: 'raw', rule: 'raw:name' },
      ]);
      // the job of one frame leaves the other frames alone
      expect(link(`jpeg-${n}`, burst).pairings.map(({ versionId }) => versionId)).toEqual([`raw-${n}`]);
    }
  });

  it('are left apart when a RAW has two camera files of its name, and that is reported', () => {
    const second = candidate('jpeg2', 'DSC_3198.jpg', nikon);
    expect(link('raw', [shotJpeg(), second, shotRaw()])).toEqual({
      photoId: null,
      pairings: [],
      notCombined: [{ assetId: 'raw', reason: 'ambiguous-camera-file', otherId: 'jpeg' }],
    });
    // from a camera file's job too: neither takes the RAW
    expect(link('jpeg', [shotJpeg(), second, shotRaw()])).toEqual({
      photoId: null,
      pairings: [],
      notCombined: [{ assetId: 'raw', reason: 'ambiguous-camera-file', otherId: 'jpeg' }],
    });
  });

  it('are left apart when a camera file has two RAWs of its name, and that is reported', () => {
    const second = candidate('raw2', 'DSC_3198.dng', nikon);
    expect(link('jpeg', [shotJpeg(), shotRaw(), second])).toEqual({
      photoId: null,
      pairings: [],
      notCombined: [
        { assetId: 'raw', reason: 'ambiguous-raw', otherId: 'jpeg' },
        { assetId: 'raw2', reason: 'ambiguous-raw', otherId: 'jpeg' },
      ],
    });
    expect(link('raw', [shotJpeg(), shotRaw(), second]).pairings).toEqual([]);
  });

  it('are not blocked by a copy of the camera’s file: a copy has another name, and is no camera file of the shot', () => {
    const copy = candidate('copy', 'DSC_3198 (1).JPG', nikon);
    const all = [shotJpeg(), shotRaw(), copy];
    for (const job of ['raw', 'jpeg']) {
      expect(link(job, all).pairings).toEqual([{ versionId: 'raw', photoId: 'jpeg', kind: 'raw', rule: 'raw:name' }]);
    }
    // the copy itself has nothing to go with
    expect(link('copy', all)).toEqual({ photoId: null, pairings: [], notCombined: [] });
  });
});

describe('what says no to a pair, whatever the names and times', () => {
  const none = { photoId: null, pairings: [], notCombined: [] };

  it('another camera: make, model or serial', () => {
    for (const other of [{ Make: 'Canon' }, { Model: 'NIKON Z6_3' }, { SerialNumber: 7_654_321 }]) {
      expect(link('raw', [shotJpeg(), candidate('raw', 'DSC_3198.NEF', { ...nikon, ...other })])).toEqual(none);
    }
  });

  it('another shot counter, burst or time zone', () => {
    const elsewhere = date('2026:08:17 20:59:04.60+02:00');
    for (const other of [
      { ShutterCount: 3197 },
      { OffsetTimeOriginal: '+02:00', SubSecDateTimeOriginal: elsewhere, DateTimeOriginal: elsewhere },
    ]) {
      expect(link('raw', [shotJpeg(), candidate('raw', 'DSC_3198.NEF', { ...nikon, ...other })])).toEqual(none);
    }
    expect(link('raw', [inBurst('jpeg', 'DSC_3198.JPG', 'a'), inBurst('raw', 'DSC_3198.NEF', 'b')])).toEqual(none);
  });

  it('only where both files record it: an export seldom has all its source has', () => {
    const bare = { ...nikon, SerialNumber: undefined, ShutterCount: undefined, OffsetTimeOriginal: undefined };
    const time = '2026:08:17 20:59:04.60';
    const jpeg = candidate('jpeg', 'DSC_3198.JPG', {
      ...bare,
      SubSecDateTimeOriginal: date(time),
      DateTimeOriginal: date(time),
    });
    expect(moves([jpeg, shotRaw()])).toEqual([['raw', 'jpeg', 'raw']]);
  });

  it('a live photo, a merged HDR or panorama', () => {
    expect(link('raw', [shotJpeg({ isLivePhoto: true }), shotRaw()])).toEqual(none);
    expect(link('raw', [shotJpeg(), candidate('raw', 'DSC_3198.NEF', { ...nikon, IsMergedHDR: true })])).toEqual(none);
    expect(link('raw', [shotJpeg(), candidate('raw', 'DSC_3198.NEF', { ...nikon, IsMergedPanorama: 1 })])).toEqual(
      none,
    );
  });

  it('another owner or another library', () => {
    expect(link('raw', [shotJpeg({ ownerId: 'someone-else' }), shotRaw()])).toEqual(none);
    expect(link('raw', [shotJpeg({ libraryId: 'library-1' }), shotRaw()])).toEqual(none);
  });

  it('the same bytes', () => {
    expect(link('edit', [shotJpeg({ checksum: 'same' }), namedExport({ checksum: 'same' })])).toEqual(none);
  });

  it('not an XMP instance id kept from the other file: a tool that edits a file may copy its metadata whole', () => {
    const source = candidate('jpeg', 'DSC_3198.JPG', { ...nikon, InstanceID: 'xmp.iid:one' });
    const copy = candidate('edit', 'DSC_3198-edit.jpg', { ...nikon, InstanceID: 'xmp.iid:one' });
    expect(moves([source, copy])).toEqual([['edit', 'jpeg', 'edit']]);
  });

  it('a file that records no capture time: it is within ten seconds of nothing', () => {
    const undated = {
      ...nikon,
      SubSecDateTimeOriginal: undefined,
      DateTimeOriginal: undefined,
      SubSecTimeOriginal: undefined,
    };
    expect(link('raw', [candidate('jpeg', 'DSC_3198.JPG', undated), shotRaw()])).toEqual(none);
    expect(
      link('raw', [candidate('jpeg', 'DSC_3198.JPG', undated), candidate('raw', 'DSC_3198.NEF', undated)]),
    ).toEqual(none);
  });

  it('files that only a third brings together and that contradict each other: nothing of the shot is combined', () => {
    // the RAW records no serial; the JPEG and the export each fit it, and name two different bodies
    const raw = candidate('raw', 'DSC_3198.NEF', { ...nikon, SerialNumber: undefined });
    const edit = candidate('edit', 'DSC_3198-edit.jpg', { ...lightroomExport, SerialNumber: 7_654_321 });
    expect(link('raw', [shotJpeg(), raw, edit])).toEqual({
      photoId: null,
      pairings: [],
      notCombined: [
        { assetId: 'raw', reason: 'contradicting-files', otherId: 'jpeg' },
        { assetId: 'edit', reason: 'contradicting-files', otherId: 'jpeg' },
      ],
    });
  });

  it('a file of the same name that could not be read: the others are not taken for the only match', () => {
    expect(link('raw', [shotJpeg(), shotRaw()], { unreadable: ['DSC_3198.jpg'] })).toEqual({
      photoId: null,
      pairings: [],
      notCombined: [{ assetId: 'raw', reason: 'unreadable-file' }],
    });
    // an unreadable file of another name, or a copy, stops nothing
    expect(moves([shotJpeg(), shotRaw()], { unreadable: ['DSC_3199.JPG', 'DSC_3198 (1).JPG', 'lake.jpg'] })).toEqual([
      ['raw', 'jpeg', 'raw'],
    ]);
  });
});

describe('an edit and the file it was made from', () => {
  it('go together by name: an export named after the shot goes behind the camera JPEG, with the RAW', () => {
    expect(link('edit', [namedExport(), shotRaw(), shotJpeg()])).toEqual({
      photoId: 'jpeg',
      pairings: [
        { versionId: 'raw', photoId: 'jpeg', kind: 'raw', rule: 'raw:name' },
        { versionId: 'edit', photoId: 'jpeg', kind: 'edit', rule: 'edit:name' },
      ],
      notCombined: [],
    });
    expect(moves([namedExport(), shotRaw(), shotJpeg()])).toEqual([
      ['edit', 'jpeg', 'edit'],
      ['raw', 'jpeg', 'raw'],
    ]);
  });

  it('go together by exactly the same time when the edit’s name says nothing', () => {
    expect(link('lake', [exportAt('lake', 1000), shotJpeg(), shotRaw()]).pairings).toEqual([
      { versionId: 'raw', photoId: 'jpeg', kind: 'raw', rule: 'raw:name' },
      { versionId: 'lake', photoId: 'jpeg', kind: 'edit', rule: 'edit:time' },
    ]);
    expect(moves([exportAt('lake', 1000), shotJpeg(), shotRaw()])).toEqual([
      ['lake', 'jpeg', 'edit'],
      ['raw', 'jpeg', 'raw'],
    ]);
  });

  it('take a RAW and its JPEG for one shot, not for two possible sources', () => {
    // the export fits both files of the shot, by name and by time
    expect(link('edit', [namedExport(), shotRaw(), shotJpeg()]).notCombined).toEqual([]);
    expect(link('lake', [exportAt('lake', 1000), shotRaw(), shotJpeg()]).notCombined).toEqual([]);
  });

  it('go together when Gallery has only the camera JPEG of a shot whose RAW was edited', () => {
    expect(moves([shotJpeg(), namedExport()])).toEqual([['edit', 'jpeg', 'edit']]);
    expect(moves([shotJpeg(), exportAt('lake', 1000)])).toEqual([['lake', 'jpeg', 'edit']]);
  });

  it('keep the RAW as the photo of a RAW-only shot, with its export behind it', () => {
    expect(moves([namedExport(), shotRaw()])).toEqual([['edit', 'raw', 'edit']]);
  });

  it('go together when only the RAW records a serial and a counter (a Sony, exported from Lightroom)', () => {
    const raw = candidate('raw', 'DSC00101.ARW', sony('17:05:25.632'));
    const jpeg = candidate('jpeg', 'DSC00101.JPG', sony('17:05:25.632'));
    const edit = candidate('edit', 'DSC00101-Edit.jpg', sonyExport('DSC00101.ARW'));
    expect(moves([raw, jpeg, edit])).toEqual([
      ['edit', 'jpeg', 'edit'],
      ['raw', 'jpeg', 'raw'],
    ]);
  });

  it('go together for an iPhone’s edited copy; a copy a phone numbered (`~2`) stays apart', () => {
    const copy = candidate('copy', 'PXL_20261019_122824927~2.jpg', pixel('927', 'c001'));
    expect(movesFrom(['jpeg', 'raw'], [phoneJpeg(), phoneRaw(), copy])).toEqual([['raw', 'jpeg', 'raw']]);
    expect(link('copy', [phoneJpeg(), phoneRaw(), copy])).toEqual(nothing);
    const iphone = {
      Make: 'Apple',
      Model: 'iPhone 17 Pro',
      SubSecDateTimeOriginal: date('2026:05:01 10:00:00.123+02:00'),
    };
    const heic = candidate('heic', 'IMG_9443.HEIC', iphone);
    const edited = candidate('edited', 'IMG_E9443.JPG', iphone);
    expect(moves([heic, edited])).toEqual([['edited', 'heic', 'edit']]);
  });

  it('are left alone when edits are switched off, and the RAW is still paired', () => {
    const all = [namedExport(), exportAt('lake', 1000), shotRaw(), shotJpeg()];
    expect(link('raw', all, { detectEdits: false }).pairings).toEqual([
      { versionId: 'raw', photoId: 'jpeg', kind: 'raw', rule: 'raw:name' },
    ]);
    expect(link('edit', all, { detectEdits: false })).toEqual({ photoId: null, pairings: [], notCombined: [] });
    expect(link('lake', all, { detectEdits: false })).toEqual({ photoId: null, pairings: [], notCombined: [] });
  });

  it('are left alone when the source is not in Gallery: nothing to report', () => {
    expect(link('edit', [namedExport()])).toEqual({ photoId: null, pairings: [], notCombined: [] });
    // two exports of a shot Gallery does not have do not go behind each other
    expect(link('a', [exportAt('a', 1000), exportAt('b', 2000)])).toEqual({
      photoId: null,
      pairings: [],
      notCombined: [],
    });
  });

  it('do not go with the file they are named after when they say inside that they were made from another', () => {
    // exported from P9201234 and saved under the next frame's name by mistake
    const shot = candidate('jpeg', 'P9201235.JPG', olympus);
    const edit = candidate('edit', 'P9201235-edit.jpg', { ...olympus, PreservedFileName: 'P9201234.ORF' });
    expect(link('edit', [shot, edit])).toEqual({ photoId: null, pairings: [], notCombined: [] });
    expect(link('jpeg', [shot, edit])).toEqual({ photoId: null, pairings: [], notCombined: [] });
    // the same edit, saying nothing inside, goes by its name
    const silent = candidate('edit', 'P9201235-edit.jpg', olympus);
    expect(moves([shot, silent])).toEqual([['edit', 'jpeg', 'edit']]);
  });

  describe('with an instruction a person gave the file', () => {
    it('`noodle-gallery:version-of=` makes a file a version of the photo it names, taken at the same time', () => {
      // a copy of the camera's JPEG with the glare removed: the camera's own metadata, a name of its own
      expect(moves([shotJpeg(), shotRaw(), fix(['noodle-gallery:version-of=DSC_3198.JPG'])])).toEqual([
        ['fix', 'jpeg', 'edit'],
        ['raw', 'jpeg', 'raw'],
      ]);
      expect(link('fix', [shotJpeg(), fix(['noodle-gallery:version-of=DSC_3198.JPG'])]).pairings).toEqual([
        { versionId: 'fix', photoId: 'jpeg', kind: 'edit', rule: 'edit:time' },
      ]);
    });

    it('without the instruction the same file is a photo of its own', () => {
      expect(movesFrom(['jpeg', 'raw'], [shotJpeg(), shotRaw(), fix([])])).toEqual([['raw', 'jpeg', 'raw']]);
      expect(link('fix', [shotJpeg(), shotRaw(), fix([])])).toEqual(nothing);
    });

    it('`noodle-gallery:version-of=` goes with no other photo than the one it names', () => {
      const all = [shotJpeg(), fix(['noodle-gallery:version-of=DSC_3199.JPG'])];
      expect(link('fix', all)).toEqual({ photoId: null, pairings: [], notCombined: [] });
      expect(link('jpeg', all)).toEqual({ photoId: null, pairings: [], notCombined: [] });
      // nor with the photo it names when that was taken at another time: the name alone is used again by the camera
      const later = candidate('later', 'DSC_3198.JPG', nikonAt('2027:03:02 10:00:00.10-04:00'));
      expect(link('fix', [later, fix(['noodle-gallery:version-of=DSC_3198.JPG'])]).pairings).toEqual([]);
    });

    it('`noodle-gallery:keep-apart` keeps a file out of every pair, and the rest of its shot is combined without it', () => {
      const keptEdit = candidate('edit', 'DSC_3198-Edit.jpg', {
        ...lightroomExport,
        Instructions: 'noodle-gallery:keep-apart',
      });
      expect(movesFrom(['jpeg', 'raw'], [shotJpeg(), shotRaw(), keptEdit])).toEqual([['raw', 'jpeg', 'raw']]);
      expect(link('edit', [shotJpeg(), shotRaw(), keptEdit])).toEqual(nothing);
      const keptRaw = candidate('raw', 'DSC_3198.NEF', { ...nikon, SpecialInstructions: 'noodle-gallery:keep-apart' });
      expect(movesFrom(['jpeg', 'edit'], [shotJpeg(), keptRaw, namedExport()])).toEqual([['edit', 'jpeg', 'edit']]);
      expect(link('raw', [shotJpeg(), keptRaw, namedExport()])).toEqual(nothing);
      const keptJpeg = candidate('jpeg', 'DSC_3198.JPG', { ...nikon, Instructions: 'noodle-gallery:keep-apart' });
      expect(link('jpeg', [keptJpeg, shotRaw()])).toEqual(nothing);
      expect(link('raw', [keptJpeg, shotRaw()])).toEqual(nothing);
    });

    it('two `noodle-gallery:version-of=` instructions that name different photos are followed by neither', () => {
      // a correction that reached one form of the field and not the other
      const twice = candidate('fix', 'glare-fix-12.jpg', {
        ...nikon,
        ShutterCount: undefined,
        SpecialInstructions: 'noodle-gallery:version-of=DSC_3199.JPG',
        Instructions: 'noodle-gallery:version-of=DSC_3198.JPG',
      });
      expect(twice.signature).toMatchObject({ keepApart: true });
      expect(link('fix', [shotJpeg(), twice])).toEqual(nothing);
      expect(link('jpeg', [shotJpeg(), twice])).toEqual(nothing);
      // the same photo named twice, by its JPEG and by its RAW, is one thing said twice
      const same = candidate('fix', 'glare-fix-12.jpg', {
        ...nikon,
        ShutterCount: undefined,
        Instructions: 'noodle-gallery:version-of=DSC_3198.JPG; noodle-gallery:version-of=dsc_3198.nef',
      });
      expect(same.signature).toMatchObject({ keepApart: false });
      expect(moves([shotJpeg(), same])).toEqual([['fix', 'jpeg', 'edit']]);
    });

    it('a photo given `noodle-gallery:keep-apart` after files went behind it keeps them and takes no new one', () => {
      const photo = candidate(
        'jpeg',
        'DSC_3198.JPG',
        { ...nikon, Instructions: 'noodle-gallery:keep-apart' },
        { hasVersions: true },
      );
      const raw = shotRaw({ versionOf: 'jpeg', eligible: false });
      // an export of the RAW arrives: it fits the hidden RAW, whose photo is the marked one
      for (const fileId of ['edit', 'raw', 'jpeg']) {
        expect(link(fileId, [photo, raw, namedExport()]).pairings).toEqual([]);
      }
      // without the instruction it goes behind the photo
      const unmarked = [shotJpeg({ hasVersions: true }), raw, namedExport()];
      expect(link('edit', unmarked).pairings).toEqual([
        { versionId: 'edit', photoId: 'jpeg', kind: 'edit', rule: 'edit:name' },
      ]);
    });

    describe('naming an edit, or a file behind a photo', () => {
      it('goes behind the same photo as the file it names, whatever that file is', () => {
        // a RAW behind its camera JPEG
        const raw = shotRaw({ versionOf: 'jpeg', eligible: false });
        expect(link('fix', [shotJpeg({ hasVersions: true }), raw, tagged('fix', 'DSC_3198.NEF')]).pairings).toEqual([
          { versionId: 'fix', photoId: 'jpeg', kind: 'edit', rule: 'edit:time' },
        ]);
        // an edit behind the camera JPEG
        const exported = namedExport({ versionOf: 'jpeg', eligible: false });
        expect(
          link('fix', [shotJpeg({ hasVersions: true }), exported, tagged('fix', 'DSC_3198-Edit.jpg')]).pairings,
        ).toEqual([{ versionId: 'fix', photoId: 'jpeg', kind: 'edit', rule: 'edit:time' }]);
        // the photo itself
        expect(link('fix', [shotJpeg({ hasVersions: true }), tagged('fix', 'DSC_3198.JPG')]).pairings).toEqual([
          { versionId: 'fix', photoId: 'jpeg', kind: 'edit', rule: 'edit:time' },
        ]);
      });

      it('makes the edit it names the photo when Gallery has neither the RAW nor the camera file', () => {
        // a fix made from an export whose RAW is kept elsewhere: from either file's job
        expect(moves([namedExport(), tagged('fix', 'DSC_3198-Edit.jpg')])).toEqual([['fix', 'edit', 'edit']]);
        // and a second fix, made from the first one, joins the same photo
        const photo = namedExport({ hasVersions: true });
        const first = tagged('first', 'DSC_3198-Edit.jpg', { versionOf: 'edit', eligible: false });
        expect(link('second', [photo, first, tagged('second', 'first.jpg')]).pairings).toEqual([
          { versionId: 'second', photoId: 'edit', kind: 'edit', rule: 'edit:time' },
        ]);
      });

      it('keeps the camera file the photo when the edit it names has its camera file in Gallery', () => {
        expect(moves([shotJpeg(), shotRaw(), namedExport(), tagged('fix', 'DSC_3198-Edit.jpg')])).toEqual([
          ['edit', 'jpeg', 'edit'],
          ['fix', 'jpeg', 'edit'],
          ['raw', 'jpeg', 'raw'],
        ]);
      });

      it('puts a RAW that arrives later behind the edit that became the photo', () => {
        const photo = namedExport({ hasVersions: true });
        const behind = tagged('fix', 'DSC_3198-Edit.jpg', { versionOf: 'edit', eligible: false });
        expect(link('raw', [photo, behind, shotRaw()]).pairings).toEqual([
          { versionId: 'raw', photoId: 'edit', kind: 'raw', rule: 'raw:name' },
        ]);
        // a RAW only of another shot does not
        const other = candidate('other', 'DSC_3199.NEF', nikonAt('2026:08:17 20:59:04.60-04:00'));
        expect(link('other', [photo, behind, other]).pairings).toEqual([]);
      });

      it('does nothing for an edit that only an editor named, not a person', () => {
        const second = candidate('second', 'lake.jpg', {
          ...lightroomExport,
          InstanceID: 'xmp.iid:second',
          PreservedFileName: 'DSC_3198-Edit.jpg',
          RawFileName: undefined,
        });
        expect(link('second', [namedExport(), second])).toEqual(nothing);
        expect(link('edit', [namedExport(), second])).toEqual(nothing);
      });

      it('needs the same capture time, and gives way to `noodle-gallery:keep-apart` on the edit it names', () => {
        const later = candidate('fix', 'fix.jpg', {
          ...nikonAt('2026:08:17 20:59:05.60-04:00'),
          ShutterCount: undefined,
          Instructions: 'noodle-gallery:version-of=DSC_3198-Edit.jpg',
        });
        expect(link('fix', [namedExport(), later])).toEqual(nothing);
        const keptApart = candidate('edit', 'DSC_3198-Edit.jpg', {
          ...lightroomExport,
          Instructions: 'noodle-gallery:keep-apart',
        });
        expect(link('fix', [keptApart, tagged('fix', 'DSC_3198-Edit.jpg')])).toEqual(nothing);
      });

      it('ends when two files name each other: one goes behind the other, and it stays so', () => {
        const a = tagged('a', 'b.jpg');
        const b = tagged('b', 'a.jpg');
        expect(link('a', [a, b]).pairings).toEqual([{ versionId: 'a', photoId: 'b', kind: 'edit', rule: 'edit:time' }]);
        const combined = [
          tagged('a', 'b.jpg', { versionOf: 'b', eligible: false }),
          tagged('b', 'a.jpg', { hasVersions: true }),
        ];
        for (const fileId of ['a', 'b']) {
          expect(link(fileId, combined)).toEqual({ photoId: 'b', pairings: [], notCombined: [] });
        }
      });
    });

    it('`noodle-gallery:keep-apart` wins over `noodle-gallery:version-of=` on the same file', () => {
      const both = fix(['noodle-gallery:version-of=DSC_3198.JPG', 'noodle-gallery:keep-apart']);
      expect(link('fix', [shotJpeg(), both])).toEqual({ photoId: null, pairings: [], notCombined: [] });
    });
  });

  describe('by the time, for an edit that says inside what it was made from', () => {
    it('needs the same fraction of a second: a Pixel’s RAW and JPEG differ, and an export goes with the one it matches', () => {
      // the export of the RAW carries the RAW's time; the JPEG of the shot is found for the RAW by name
      const edit = candidate('lake', 'lake.jpg', {
        ...pixel('794000', 'e001'),
        PreservedFileName: 'PXL_20261019_122824927.RAW-02.ORIGINAL.dng',
        History: [{ Action: 'derived' }],
      });
      expect(moves([phoneJpeg(), phoneRaw(), edit])).toEqual([
        ['lake', 'jpeg', 'edit'],
        ['raw', 'jpeg', 'raw'],
      ]);
    });

    it('takes `.60` and `.600000` for the same time, and not `.60` and `.61`, nor `.60` and no fraction', () => {
      expect(moves([shotJpeg(), exportAtFraction('.600000')])).toEqual([['lake', 'jpeg', 'edit']]);
      expect(link('lake', [shotJpeg(), exportAtFraction('.61')]).pairings).toEqual([]);
      expect(link('lake', [shotJpeg(), exportAtFraction('')]).pairings).toEqual([]);
    });

    it('takes no fraction for `.0` of the second', () => {
      for (const fraction of ['.0', '.00', '.000']) {
        const jpeg = candidate('jpeg', 'DSC_3198.JPG', nikonAt(`2026:08:17 20:59:04${fraction}-04:00`));
        expect(moves([jpeg, exportAtFraction('')])).toEqual([['lake', 'jpeg', 'edit']]);
        expect(
          moves([candidate('jpeg', 'DSC_3198.JPG', nikonAt('2026:08:17 20:59:04-04:00')), exportAtFraction(fraction)]),
        ).toEqual([['lake', 'jpeg', 'edit']]);
      }
      // but not `.001`
      const jpeg = candidate('jpeg', 'DSC_3198.JPG', nikonAt('2026:08:17 20:59:04.001-04:00'));
      expect(link('lake', [jpeg, exportAtFraction('')]).pairings).toEqual([]);
    });

    it('holds for two files that both record no fraction', () => {
      const jpeg = candidate('jpeg', 'P9201234.JPG', olympus);
      const edit = candidate('lake', 'lake.jpg', { ...olympus, PreservedFileName: 'P9201234.ORF' });
      expect(moves([jpeg, edit])).toEqual([['lake', 'jpeg', 'edit']]);
    });

    it('never makes a pair alone: an edit that names no source stays apart, though taken at the very same time', () => {
      // the frame it was made from may not be in Gallery, and another frame of the burst is
      const unnamed = candidate('lake', 'lake.jpg', unnamedExportAt('.60'));
      expect(link('lake', [shotJpeg(), shotRaw(), unnamed])).toEqual({ photoId: null, pairings: [], notCombined: [] });
      expect(link('jpeg', [shotJpeg(), shotRaw(), unnamed]).pairings).toEqual([
        { versionId: 'raw', photoId: 'jpeg', kind: 'raw', rule: 'raw:name' },
      ]);
      const jpeg = candidate('jpeg', 'P9201234.JPG', olympus);
      const edit = candidate('lake', 'lake.jpg', { ...olympus, History: [{ Action: 'derived' }] });
      expect(link('lake', [jpeg, edit])).toEqual({ photoId: null, pairings: [], notCombined: [] });
      expect(link('jpeg', [jpeg, edit])).toEqual({ photoId: null, pairings: [], notCombined: [] });
    });

    it('waits when a file the edit names could not be read: the one that could is not taken for the only match', () => {
      // renamed in Lightroom, and Gallery has a file under each of the two names, taken at the same time
      const renamed = { ...lightroomExport, PreservedFileName: 'DSC_3198.NEF', RawFileName: 'lake.NEF' };
      const edit = candidate('edit', 'DSC_3198-Edit.jpg', renamed);
      const other = candidate('other', 'lake.NEF', { ...nikon, SerialNumber: undefined });
      // both read: the edit fits two shots
      expect(link('edit', [shotJpeg(), other, edit]).pairings).toEqual([]);
      // one of them unreadable: no pairing either, by name or by time
      for (const matchByTime of [true, false]) {
        const outcome = link('edit', [shotJpeg(), edit], { unreadable: ['lake.NEF'], matchByTime });
        expect(outcome.pairings).toEqual([]);
        expect(outcome.notCombined).toEqual([{ assetId: 'edit', reason: 'unreadable-file' }]);
      }
    });

    it('goes by either name a renamed file has: the camera’s, or the one it was given in Lightroom', () => {
      const renamed = { ...lightroomExport, PreservedFileName: 'DSC_3198.NEF', RawFileName: '2026-08-17 lake.NEF' };
      // Gallery has the file under the camera's name
      expect(moves([shotRaw(), candidate('edit', 'final.jpg', renamed)])).toEqual([['edit', 'raw', 'edit']]);
      // or under the new one
      const raw = candidate('raw', '2026-08-17 lake.NEF', nikon);
      expect(moves([raw, candidate('edit', 'final.jpg', renamed)])).toEqual([['edit', 'raw', 'edit']]);
      expect(moves([raw, candidate('edit', '2026-08-17 lake.jpg', renamed)])).toEqual([['edit', 'raw', 'edit']]);
    });

    it('is dropped when the edit names another file as its source: two shots in one second, with no fractions', () => {
      // shot A was exported; Gallery has the export and shot B, taken in the same second
      const shotB = candidate('b', 'P9201235.JPG', olympus);
      const exportOfA = candidate('lake', 'lake.jpg', {
        ...olympus,
        PreservedFileName: 'P9201234.ORF',
        History: [{ Action: 'derived' }],
      });
      expect(link('lake', [shotB, exportOfA])).toEqual({ photoId: null, pairings: [], notCombined: [] });
      expect(link('b', [shotB, exportOfA])).toEqual({ photoId: null, pairings: [], notCombined: [] });
      // with the shot it names, it goes
      const shotA = candidate('a', 'P9201234.JPG', olympus);
      expect(link('lake', [shotA, shotB, exportOfA]).pairings).toEqual([
        { versionId: 'lake', photoId: 'a', kind: 'edit', rule: 'edit:time' },
      ]);
    });

    it('is switched off when ten or more files share the time; a match by name is not', () => {
      const all = [exportAt('lake', 1000), namedExport(), shotJpeg(), shotRaw()];
      expect(link('lake', all, { matchByTime: false })).toEqual({ photoId: null, pairings: [], notCombined: [] });
      expect(link('raw', all, { matchByTime: false }).pairings).toEqual([
        { versionId: 'raw', photoId: 'jpeg', kind: 'raw', rule: 'raw:name' },
        { versionId: 'edit', photoId: 'jpeg', kind: 'edit', rule: 'edit:name' },
      ]);
    });

    it('is left apart, and reported, when the edit fits two shots', () => {
      // two cameras of one model fired in the same instant, at the same number of their counters
      const one = candidate('one', 'DSC_3198.JPG', { ...nikon, SerialNumber: undefined });
      const two = candidate('two', 'DSC_3198.jpeg', { ...nikon, SerialNumber: undefined });
      const edit = candidate('lake', 'lake.jpg', {
        ...nikon,
        SerialNumber: undefined,
        PreservedFileName: 'DSC_3198.NEF',
      });
      expect(link('lake', [one, two, edit])).toEqual({
        photoId: null,
        pairings: [],
        notCombined: [{ assetId: 'lake', reason: 'ambiguous-source' }],
      });
      // and from the job of either shot: the edit is reported, and nothing is combined
      expect(link('one', [one, two, edit])).toEqual({
        photoId: null,
        pairings: [],
        notCombined: [{ assetId: 'lake', reason: 'ambiguous-source' }],
      });
    });
  });
});

describe('what is combined already stays together', () => {
  it('changes nothing for a file that is behind its photo, and stores nothing about it', () => {
    const all = [shotJpeg({ hasVersions: true }), shotRaw({ versionOf: 'jpeg', eligible: false })];
    expect(link('raw', all)).toEqual({ photoId: 'jpeg', pairings: [], notCombined: [] });
    expect(link('jpeg', all)).toEqual({ photoId: 'jpeg', pairings: [], notCombined: [] });
  });

  it('lets the job of a file that is behind a photo put a newly arrived edit behind the same photo', () => {
    const all = [shotJpeg({ hasVersions: true }), shotRaw({ versionOf: 'jpeg', eligible: false }), namedExport()];
    expect(link('raw', all)).toEqual({
      photoId: 'jpeg',
      pairings: [{ versionId: 'edit', photoId: 'jpeg', kind: 'edit', rule: 'edit:name' }],
      notCombined: [],
    });
  });

  it('brings the photo along when a new edit finds only a hidden file of the shot', () => {
    // a Pixel's RAW is behind its JPEG; an export of the RAW arrives under another name, at the RAW's exact time.
    // The JPEG's fraction differs, so it is found neither by name nor by time: it comes with the RAW it has behind it
    const jpeg = { ...phoneJpeg(), hasVersions: true };
    const raw = { ...phoneRaw(), versionOf: 'jpeg', eligible: false };
    const edit = candidate('lake', 'lake.jpg', {
      ...pixel('794000', 'e001'),
      PreservedFileName: 'PXL_20261019_122824927.RAW-02.ORIGINAL.dng',
    });
    expect(link('lake', [raw, jpeg, edit])).toEqual({
      photoId: 'jpeg',
      pairings: [{ versionId: 'lake', photoId: 'jpeg', kind: 'edit', rule: 'edit:time' }],
      notCombined: [],
    });
  });

  it('keeps a file with its photo though its name was changed since', () => {
    const renamed = candidate('raw', 'lake.NEF', nikon, { versionOf: 'jpeg', eligible: false });
    const all = [shotJpeg({ hasVersions: true }), renamed, namedExport()];
    expect(link('raw', all)).toEqual({
      photoId: 'jpeg',
      pairings: [{ versionId: 'edit', photoId: 'jpeg', kind: 'edit', rule: 'edit:name' }],
      notCombined: [],
    });
  });

  it('never reports a file that is behind a photo, whatever a later look at its shot finds', () => {
    // a second camera file of the same name turns up: the RAW now fits two, and it is behind its photo
    const all = [
      shotJpeg({ hasVersions: true }),
      shotRaw({ versionOf: 'jpeg', eligible: false }),
      candidate('jpeg2', 'DSC_3198.jpg', nikon),
    ];
    expect(link('jpeg2', all).notCombined).toEqual([]);
    expect(link('raw', all).notCombined).toEqual([]);
    expect(link('jpeg', all).notCombined).toEqual([]);
  });

  it('takes nothing from another photo: a file that is behind one stays there, and nothing is stored about it', () => {
    expect(link('jpeg', [shotJpeg(), shotRaw({ versionOf: 'elsewhere', eligible: false })])).toEqual({
      photoId: 'jpeg',
      pairings: [],
      notCombined: [],
    });
  });

  it('keeps an edit with its photo while edits are switched off: the photo is still the job’s photo', () => {
    // the edit was organised, so it became the photo; later the administrator switched edits off
    const photo = namedExport({ hasVersions: true });
    const all = [
      photo,
      shotJpeg({ versionOf: 'edit', eligible: false }),
      shotRaw({ versionOf: 'edit', eligible: false }),
    ];
    expect(link('edit', all, { detectEdits: false })).toEqual({ photoId: 'edit', pairings: [], notCombined: [] });
    // and an edit that is behind a photo
    const behind = [shotJpeg({ hasVersions: true }), namedExport({ versionOf: 'jpeg', eligible: false })];
    expect(link('edit', behind, { detectEdits: false })).toEqual({ photoId: 'jpeg', pairings: [], notCombined: [] });
  });

  it('does not let a combined edit bring a stranger in: what it fits now counts only when it is its own shot', () => {
    // the edit is behind its photo; after a correction of its time it fits only another camera's file, taken then
    const photo = candidate('photo', 'DSC_3198.JPG', nikonAt('2026:08:17 10:00:00.00-04:00'), { hasVersions: true });
    const stranger = candidate('stranger', 'DSC_7001.JPG', { ...nikon, SerialNumber: undefined });
    const edit = candidate(
      'lake',
      'lake.jpg',
      { ...nikon, SerialNumber: undefined, History: [{ Action: 'derived' }] },
      { versionOf: 'photo', eligible: false },
    );
    for (const job of ['lake', 'photo']) {
      expect(link(job, [photo, stranger, edit])).toEqual({ photoId: 'photo', pairings: [], notCombined: [] });
    }
    // the stranger's own job does not take the edit either: it is behind a photo
    expect(link('stranger', [photo, stranger, edit]).pairings).toEqual([]);
  });

  it('keeps an edit with its photo though it now fits two shots', () => {
    // another camera of the model fired in the same instant, and its file arrived later
    const one = candidate('one', 'DSC_3198.JPG', { ...nikon, SerialNumber: undefined }, { hasVersions: true });
    const two = candidate('two', 'DSC_7001.JPG', { ...nikon, SerialNumber: undefined });
    const edit = candidate(
      'lake',
      'lake.jpg',
      { ...nikon, SerialNumber: undefined, History: [{ Action: 'derived' }] },
      { versionOf: 'one', eligible: false },
    );
    expect(link('lake', [one, two, edit])).toEqual({ photoId: 'one', pairings: [], notCombined: [] });
  });
});

describe('which file is the photo', () => {
  it('is the camera file when nothing is attached to any of them, whatever their dates', () => {
    expect(moves([shotJpeg(), shotRaw(), exportAt('a', 1000), exportAt('b', 2000)])).toEqual([
      ['a', 'jpeg', 'edit'],
      ['b', 'jpeg', 'edit'],
      ['raw', 'jpeg', 'raw'],
    ]);
  });

  it('is the edit when the edit is what was organised: nothing has to move', () => {
    const attachments = attached({ a: ['album:best', 'favorite:me'] });
    expect(moves([shotJpeg(), shotRaw(), exportAt('a', 1000)], { attachments })).toEqual([
      ['jpeg', 'a', 'original'],
      ['raw', 'a', 'raw'],
    ]);
  });

  it('is the file that has everything the others have, and more', () => {
    // the pair is in one album, and someone favourited the RAW
    const attachments = attached({ jpeg: ['album:trip'], raw: ['album:trip', 'favorite:me'] });
    expect(moves([shotJpeg(), shotRaw()], { attachments })).toEqual([['jpeg', 'raw', 'original']]);
  });

  it('stays the same once chosen: a file with versions behind it is the photo, whatever arrives later', () => {
    const photo = shotJpeg({ hasVersions: true });
    const behind = shotRaw({ versionOf: 'jpeg', eligible: false });
    expect(moves([photo, behind, exportAt('a', 1000)])).toEqual([['a', 'jpeg', 'edit']]);
    // even an edit that is in an album of its own does not take over: it stays a separate photo
    const attachments = attached({ a: ['album:x'] });
    expect(link('a', [photo, behind, exportAt('a', 1000)], { attachments })).toEqual({
      photoId: 'jpeg',
      pairings: [],
      notCombined: [{ assetId: 'a', reason: 'has-own-attachments', otherId: 'jpeg' }],
    });
  });

  it('stays the RAW when the RAW was combined with an edit before the camera JPEG arrived', () => {
    const raw = shotRaw({ hasVersions: true });
    const edit = namedExport({ versionOf: 'raw', eligible: false });
    expect(link('jpeg', [shotJpeg(), raw, edit])).toEqual({
      photoId: 'raw',
      pairings: [{ versionId: 'jpeg', photoId: 'raw', kind: 'original', rule: 'original:name' }],
      notCombined: [],
    });
  });

  it('leaves a file apart when it has something the photo does not, and combines the rest', () => {
    // the JPEG is in two albums, the edit in a third: the JPEG has more and is the photo; the edit keeps its album
    const attachments = attached({ jpeg: ['album:a', 'album:b'], edit: ['album:c'] });
    expect(link('raw', [shotJpeg(), shotRaw(), namedExport()], { attachments })).toEqual({
      photoId: 'jpeg',
      pairings: [{ versionId: 'raw', photoId: 'jpeg', kind: 'raw', rule: 'raw:name' }],
      notCombined: [{ assetId: 'edit', reason: 'has-own-attachments', otherId: 'jpeg' }],
    });
  });

  it('never lets comments go behind: a file with comments is the photo or stays apart', () => {
    // comments are keyed by the file itself, so no other file "has them too"
    const commented = attached({ raw: ['album:trip', 'activity:raw'], jpeg: ['album:trip'] });
    expect(moves([shotJpeg(), shotRaw()], { attachments: commented })).toEqual([['jpeg', 'raw', 'original']]);
    const both = attached({ raw: ['activity:raw'], jpeg: ['activity:jpeg'] });
    expect(link('raw', [shotJpeg(), shotRaw()], { attachments: both })).toEqual({
      photoId: 'jpeg',
      pairings: [],
      notCombined: [{ assetId: 'raw', reason: 'has-own-attachments', otherId: 'jpeg' }],
    });
  });

  it('waits while the photo is in the trash, and leaves two photos of one shot as they are', () => {
    const trashed = shotJpeg({ hasVersions: true, eligible: false });
    expect(link('raw', [trashed, shotRaw()])).toEqual({
      photoId: null,
      pairings: [],
      notCombined: [{ assetId: 'raw', reason: 'not-eligible', otherId: 'jpeg' }],
    });
    const two = [shotJpeg({ hasVersions: true }), shotRaw({ hasVersions: true })];
    expect(link('raw', two)).toEqual({
      photoId: null,
      pairings: [],
      notCombined: [{ assetId: 'raw', reason: 'two-photos', otherId: 'jpeg' }],
    });
  });
});

describe('the job’s file and the files found for it', () => {
  it('decides nothing for a file that has nothing to go with', () => {
    expect(link('jpeg', [shotJpeg()])).toEqual({ photoId: null, pairings: [], notCombined: [] });
    expect(link('raw', [shotRaw()])).toEqual({ photoId: null, pairings: [], notCombined: [] });
    // files of other shots around it change nothing
    const others = [candidate('x', 'DSC_3199.JPG', nikon), candidate('y', 'DSC_3200.NEF', nikon)];
    expect(link('jpeg', [shotJpeg(), ...others])).toEqual({ photoId: null, pairings: [], notCombined: [] });
  });

  it('decides nothing when the job’s own file is not among the files that could be read', () => {
    expect(link('gone', [shotJpeg(), shotRaw()])).toEqual({ photoId: null, pairings: [], notCombined: [] });
  });

  it('gives the same answer whichever file’s job runs, once all the files are there', () => {
    const all = [shotJpeg(), shotRaw(), namedExport()];
    for (const job of ['jpeg', 'raw', 'edit']) {
      expect(
        link(job, all)
          .pairings.map(({ versionId, photoId }) => [versionId, photoId])
          .toSorted(byText),
      ).toEqual([
        ['edit', 'jpeg'],
        ['raw', 'jpeg'],
      ]);
    }
  });

  it('ends with one photo and every other file behind it, in every order the files can arrive in', () => {
    const make = { jpeg: shotJpeg, raw: shotRaw, edit: () => namedExport() };
    type Name = keyof typeof make;
    const orders: Name[][] = [
      ['jpeg', 'raw', 'edit'],
      ['jpeg', 'edit', 'raw'],
      ['raw', 'jpeg', 'edit'],
      ['raw', 'edit', 'jpeg'],
      ['edit', 'jpeg', 'raw'],
      ['edit', 'raw', 'jpeg'],
    ];
    for (const order of orders) {
      // each file arrives, its job runs on the files that are there, and what it decides is applied
      const there: VersionCandidate[] = [];
      for (const name of order) {
        there.push(make[name]());
        for (const { versionId, photoId } of link(name, there).pairings) {
          Object.assign(
            there.find(({ id }) => id === versionId)!,
            { versionOf: photoId, eligible: false },
          );
          Object.assign(
            there.find(({ id }) => id === photoId)!,
            { hasVersions: true },
          );
        }
      }
      const photos = there.filter((file) => !file.versionOf);
      expect(photos, order.join(', ')).toHaveLength(1);
      expect(
        there.filter((file) => file.versionOf === photos[0].id),
        order.join(', '),
      ).toHaveLength(2);
      // the camera's file is the photo, unless the RAW and its edit were combined before it arrived: then the RAW
      // stays the photo (in the service, a JPEG that is in Gallery by then is looked for first)
      expect(photos[0].id, order.join(', ')).toBe(order.indexOf('jpeg') === 2 ? 'raw' : 'jpeg');
    }
  });
});

describe('namesOfMissingCameraFile: a RAW about to become the photo with an edit behind it', () => {
  it('gives the names to look for the camera’s file by', () => {
    expect(namesOfMissingCameraFile(outcomeOf('edit', [shotRaw(), namedExport()]))).toEqual([
      'DSC_3198.NEF',
      'DSC_3198-Edit.jpg',
    ]);
    // a renamed export that found its RAW by time: the JPEG to look for carries the RAW's name, not the export's
    expect(namesOfMissingCameraFile(outcomeOf('lake', [shotRaw(), exportAt('lake', 1000)]))).toEqual([
      'DSC_3198.NEF',
      'lake.jpg',
    ]);
  });

  it('gives nothing when the shot has its camera file, has no edit, or the RAW is the photo already', () => {
    expect(namesOfMissingCameraFile(outcomeOf('edit', [shotJpeg(), shotRaw(), namedExport()]))).toBeNull();
    expect(namesOfMissingCameraFile(outcomeOf('raw', [shotRaw()]))).toBeNull();
    expect(namesOfMissingCameraFile(outcomeOf('raw', [shotJpeg(), shotRaw()]))).toBeNull();
    const photo = shotRaw({ hasVersions: true });
    const behind = namedExport({ versionOf: 'raw', eligible: false });
    expect(namesOfMissingCameraFile(outcomeOf('new', [photo, behind, exportAt('new', 2000)]))).toBeNull();
  });
});

describe('whose picture the photo shows', () => {
  it('is the newest edit, the file written last', () => {
    const versions = [file('raw', 'raw'), file('a', 'edit', 1000), file('b', 'edit', 2000)];
    expect(chooseLook(file('jpeg', 'original'), versions)).toBe('b');
    expect(chooseLook(file('jpeg', 'original'), versions.toReversed())).toBe('b');
  });

  it('is its own file when it has no edit, or is itself the newest edit', () => {
    expect(chooseLook(file('jpeg', 'original'), [file('raw', 'raw')])).toBeNull();
    expect(chooseLook(file('a', 'edit', 3000), [file('jpeg', 'original'), file('b', 'edit', 2000)])).toBeNull();
  });

  it('is a newer edit when the photo is an older one', () => {
    expect(chooseLook(file('a', 'edit', 1000), [file('jpeg', 'original'), file('b', 'edit', 2000)])).toBe('b');
  });

  it('is the camera file for a RAW that is the photo and has no edit', () => {
    expect(chooseLook(file('raw', 'raw'), [file('jpeg', 'original')])).toBe('jpeg');
    expect(chooseLook(file('raw', 'raw'), [file('jpeg', 'original'), file('a', 'edit', 1)])).toBe('a');
    expect(chooseLook(file('raw', 'raw'), [])).toBeNull();
  });
});

/** A file stored in the folder `/library/Roll 12`, added to Gallery at `addedAtMs`. */
const stored = (id: string, name: string, tags: Record<string, unknown>, extra: Partial<VersionCandidate> = {}) =>
  candidate(id, name, tags, { originalPath: `/library/Roll 12/${name}`, ...extra });
/** A film scan's master and a picture made from it: no camera, no capture time. */
const scanner = { Software: 'VueScan 9.8' };
const viewer = { Software: 'Photos 9.0' };

describe('the folder rule: files stored side by side under one name', () => {
  it('puts a scan’s TIFF behind its HEIC, with no capture time on either', () => {
    const tif = stored('tif', 'roll12_07.tif', scanner);
    const heic = stored('heic', 'roll12_07.heic', viewer);
    expect(tif.signature).toMatchObject({ isRaw: true, isEdit: false });
    expect(moves([tif, heic])).toEqual([['tif', 'heic', 'raw']]);
    expect(link('tif', [tif, heic]).pairings).toEqual([
      { versionId: 'tif', photoId: 'heic', kind: 'raw', rule: 'raw:folder' },
    ]);
  });

  it('puts an export saved over its source’s name behind the source, as an edit, with no capture time', () => {
    const tif = stored('tif', 'roll12_07.tif', scanner);
    const exported = stored('jpg', 'roll12_07.jpg', {
      Software: 'Adobe Photoshop 27.0',
      PreservedFileName: 'roll12_07.tif',
    });
    expect(moves([tif, exported])).toEqual([['jpg', 'tif', 'edit']]);
    expect(link('jpg', [tif, exported]).pairings).toEqual([
      { versionId: 'jpg', photoId: 'tif', kind: 'edit', rule: 'edit:folder' },
    ]);
    // stored elsewhere, the same two say nothing about each other: there is no time to go by
    const elsewhere = candidate('jpg', 'roll12_07.jpg', { PreservedFileName: 'roll12_07.tif' });
    expect(link('jpg', [tif, elsewhere])).toEqual(nothing);
  });

  it('keeps an edited TIFF an edit: only a TIFF that is not one is a master', () => {
    expect(toCaptureSignature(scanner, 'roll12_07.tif')).toMatchObject({ isRaw: true, isEdit: false });
    expect(toCaptureSignature(nikon, 'DSC_3198-Edit.tif')).toMatchObject({ isRaw: false, isEdit: true });
    expect(toCaptureSignature(lightroomExport, 'DSC_3198.tif')).toMatchObject({ isRaw: false, isEdit: true });
  });

  it('puts a RAW behind its JPEG that lost its capture time', () => {
    const raw = stored('raw', 'DSC_3198.NEF', nikon);
    const jpeg = stored('jpeg', 'DSC_3198.JPG', { Make: 'NIKON CORPORATION', Model: 'NIKON Z50_2' });
    expect(moves([raw, jpeg])).toEqual([['raw', 'jpeg', 'raw']]);
  });

  it('leaves apart two files of one name whose capture times are far apart: a counter that came round again', () => {
    const raw = stored('raw', 'DSC_0001.NEF', nikonAt('2024:05:01 10:00:00.10-04:00'));
    const jpeg = stored('jpeg', 'DSC_0001.JPG', nikonAt('2019:03:02 11:00:00.20-04:00'));
    expect(link('raw', [raw, jpeg])).toEqual(nothing);
    expect(link('jpeg', [raw, jpeg])).toEqual(nothing);
  });

  it('combines every file of the name in the folder: a JPEG with two RAWs, and RAWs alone', () => {
    const jpeg = stored('jpeg', 'DSC_3198.JPG', nikon);
    const nef = stored('nef', 'DSC_3198.NEF', nikon, { addedAtMs: 1 });
    const dng = stored('dng', 'DSC_3198.DNG', { ...nikon, Software: 'Adobe DNG Converter 17.0' }, { addedAtMs: 2 });
    expect(moves([jpeg, nef, dng])).toEqual([
      ['dng', 'jpeg', 'raw'],
      ['nef', 'jpeg', 'raw'],
    ]);
    // with no JPEG: the RAW added first is the photo
    expect(moves([nef, dng])).toEqual([['dng', 'nef', 'raw']]);
    // outside a folder, a JPEG with two RAWs is still left apart
    const apart = [shotJpeg(), shotRaw(), candidate('dng', 'DSC_3198.DNG', nikon)];
    expect(link('jpeg', apart).pairings).toEqual([]);
  });

  it('combines two camera files of one name: the first added is the photo', () => {
    const jpeg = stored('jpeg', 'IMG_0001.JPG', { Make: 'Apple', Model: 'iPhone 17' }, { addedAtMs: 5 });
    const heic = stored('heic', 'IMG_0001.HEIC', { Make: 'Apple', Model: 'iPhone 17' }, { addedAtMs: 3 });
    expect(moves([jpeg, heic])).toEqual([['jpeg', 'heic', 'original']]);
  });

  it('keeps the organised file the photo: a TIFF in an album takes its HEIC behind it', () => {
    const tif = stored('tif', 'roll12_07.tif', scanner);
    const heic = stored('heic', 'roll12_07.heic', viewer);
    const attachments = attached({ tif: ['album:a'] });
    expect(link('heic', [tif, heic], { attachments }).pairings).toEqual([
      { versionId: 'heic', photoId: 'tif', kind: 'original', rule: 'original:folder' },
    ]);
  });

  it('keeps a file stored beside its pair out of a match in another folder, also when the one beside it has no time', () => {
    const raw = stored('raw', 'DSC_3198.NEF', nikon);
    const jpeg = stored('jpeg', 'DSC_3198.JPG', { Make: 'NIKON CORPORATION', Model: 'NIKON Z50_2' });
    // a copy of the JPEG in another folder, with the capture time the one beside the RAW lost
    const copy = candidate('copy', 'DSC_3198.JPG', nikon);
    for (const fileId of ['raw', 'jpeg']) {
      expect(link(fileId, [raw, jpeg, copy]).pairings).toEqual([
        { versionId: 'raw', photoId: 'jpeg', kind: 'raw', rule: 'raw:folder' },
      ]);
    }
    expect(link('copy', [raw, jpeg, copy]).pairings).toEqual([]);
  });

  it('among files organised alike, prefers a camera file to a RAW or TIFF, then the first added', () => {
    const jpeg = stored('jpeg', 'roll12_07.jpg', viewer, { addedAtMs: 1 });
    const heic = stored('heic', 'roll12_07.heic', viewer, { addedAtMs: 2 });
    // written last, which no longer decides
    const tif = stored('tif', 'roll12_07.tif', scanner, { addedAtMs: 3, editedAtMs: 99 });
    const attachments = attached({ heic: ['album:a'], tif: ['album:a'] });
    for (const fileId of ['jpeg', 'heic', 'tif']) {
      expect(link(fileId, [jpeg, heic, tif], { attachments }).photoId).toBe('heic');
    }
  });

  it('compares the stored names: an upload stored under its id, or renamed by the storage template, matches nothing', () => {
    // two uploads in one of Immich's shared folders, each stored under its id
    const a = candidate('a', 'scan.tif', scanner, { originalPath: '/data/upload/u/ab/cd/abcd0001.tif' });
    const b = candidate('b', 'scan.heic', viewer, { originalPath: '/data/upload/u/ab/cd/abcd0002.heic' });
    expect(link('a', [a, b])).toEqual(nothing);
    // a second `scan` of one day, stored by the template as `scan+1`
    const c = candidate('c', 'scan.tif', scanner, { originalPath: '/data/library/u/2026/2026-11-14/scan+1.tif' });
    const d = candidate('d', 'scan.heic', viewer, { originalPath: '/data/library/u/2026/2026-11-14/scan.heic' });
    expect(link('c', [c, d])).toEqual(nothing);
  });

  it('gives way to what says no: an instruction, another camera', () => {
    const tif = stored('tif', 'roll12_07.tif', { ...scanner, Instructions: 'noodle-gallery:keep-apart' });
    const heic = stored('heic', 'roll12_07.heic', viewer);
    expect(link('heic', [tif, heic])).toEqual(nothing);
    const raw = stored('raw', 'DSC_3198.NEF', nikon);
    const other = stored('jpeg', 'DSC_3198.JPG', { Make: 'SONY', Model: 'ILCE-7M5' });
    expect(link('raw', [raw, other])).toEqual(nothing);
  });
});
