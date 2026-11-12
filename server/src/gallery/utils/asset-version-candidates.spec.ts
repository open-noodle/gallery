import { AssetType, AssetVisibility } from 'src/enum.js';
import {
  shouldLook,
  toLinkInput,
  usableTimeMatches,
  type CandidateRow,
} from 'src/gallery/utils/asset-version-candidates.js';
import type { FileRead } from 'src/gallery/utils/asset-version-signature.js';

describe('shouldLook: step 1 of a versions job', () => {
  const on = { enabled: true };
  const picture = { type: AssetType.Image, deletedAt: null };

  it('looks at a picture that is not in the trash, while versions are on', () => {
    expect(shouldLook(on, picture)).toBe(true);
  });

  it('does not look while versions are off', () => {
    expect(shouldLook({ enabled: false }, picture)).toBe(false);
  });

  it('does not look at a file that is gone, in the trash, or no picture', () => {
    expect(shouldLook(on, undefined)).toBe(false);
    expect(shouldLook(on, null)).toBe(false);
    expect(shouldLook(on, { ...picture, deletedAt: new Date() })).toBe(false);
    expect(shouldLook(on, { ...picture, type: AssetType.Video })).toBe(false);
    expect(shouldLook(on, { ...picture, type: AssetType.Audio })).toBe(false);
  });
});

describe('usableTimeMatches: the search by exactly the same time', () => {
  it('uses the files found while fewer than the limit share the time', () => {
    expect(usableTimeMatches(['a', 'b', 'c'], 10)).toEqual({ rows: ['a', 'b', 'c'], matchByTime: true });
    expect(usableTimeMatches([], 10)).toEqual({ rows: [], matchByTime: true });
    expect(usableTimeMatches(Array.from({ length: 9 }), 10).matchByTime).toBe(true);
  });

  it('finds nothing by time once the limit is reached: the clock was never set', () => {
    expect(
      usableTimeMatches(
        Array.from({ length: 10 }, (_, i) => i),
        10,
      ),
    ).toEqual({ rows: [], matchByTime: false });
  });
});

const SIGNATURE = {
  make: 'NIKON CORPORATION',
  model: 'NIKON Z50_2',
  cameraSerial: '6001234',
  shotNumber: '9425',
  captureSecond: '2026-11-01T15:47:38',
  subSecond: 0.78,
  offsetMinutes: -240,
  sourceFileNames: [],
  sourceFromInstruction: false,
  software: 'Ver.01.11',
  isEdit: false,
  keepApart: false,
  isRaw: false,
  burstId: null,
};

const read = (status: FileRead['status'] = 'ok', parserVersion = 1, signature = SIGNATURE): FileRead => ({
  status,
  parserVersion,
  readAt: '2026-11-13T10:00:00.000Z',
  signature: status === 'ok' ? signature : null,
});

const row = (overrides: Partial<CandidateRow> = {}): CandidateRow =>
  ({
    id: 'jpeg',
    ownerId: 'owner',
    libraryId: null,
    originalPath: '/data/DSC_9425.JPG',
    originalFileName: 'DSC_9425.JPG',
    checksum: Buffer.from('ab12', 'hex'),
    visibility: AssetVisibility.Timeline,
    deletedAt: null,
    isOffline: false,
    livePhotoVideoId: null,
    fileModifiedAt: new Date('2026-11-02T14:40:25.000Z'),
    createdAt: new Date('2026-11-03T09:00:00.000Z'),
    versionOf: null,
    hasVersions: false,
    isMotionPart: false,
    attachments: [],
    read: null,
    ...overrides,
  }) as CandidateRow;

/** The linking's input for these rows, with each file read by the job (as `reads`) unless the row keeps its read. */
const link = (rows: CandidateRow[], reads: Record<string, FileRead> = {}) =>
  toLinkInput(rows, new Map(Object.entries(reads)), 1);
const readAll = (rows: CandidateRow[]) => link(rows, Object.fromEntries(rows.map((r) => [r.id, read()])));

const candidateOf = (overrides: Partial<CandidateRow>) => readAll([row(overrides)]).candidates[0];

describe('toLinkInput: what the database returned, as the linking takes it', () => {
  it('carries over what was read from a file and what Gallery knows about it', () => {
    const { candidates } = readAll([row()]);
    expect(candidates).toEqual([
      {
        id: 'jpeg',
        ownerId: 'owner',
        libraryId: null,
        originalFileName: 'DSC_9425.JPG',
        originalPath: '/data/DSC_9425.JPG',
        addedAtMs: Date.parse('2026-11-03T09:00:00.000Z'),
        checksum: 'ab12',
        isLivePhoto: false,
        eligible: true,
        versionOf: null,
        hasVersions: false,
        editedAtMs: Date.parse('2026-11-02T14:40:25.000Z'),
        signature: SIGNATURE,
      },
    ]);
  });

  it('takes the read a combined file keeps on its row, unless an older parser made it or the job read it again', () => {
    const kept = { ...SIGNATURE, model: 'kept' };
    const fresh = { ...SIGNATURE, model: 'fresh' };
    expect(link([row({ read: read('ok', 1, kept) })]).candidates[0].signature.model).toBe('kept');
    expect(
      link([row({ read: read('ok', 1, kept) })], { jpeg: read('ok', 1, fresh) }).candidates[0].signature.model,
    ).toBe('fresh');
    // read by an older parser: as if never read
    expect(link([row({ read: read('ok', 0, kept) })]).candidates).toEqual([]);
  });

  it('takes a file for combinable only while it shows: not hidden, locked, offline or in the trash', () => {
    expect(candidateOf({ visibility: AssetVisibility.Archive }).eligible).toBe(true);
    expect(candidateOf({ visibility: AssetVisibility.Hidden }).eligible).toBe(false);
    expect(candidateOf({ visibility: AssetVisibility.Locked }).eligible).toBe(false);
    expect(candidateOf({ isOffline: true }).eligible).toBe(false);
    expect(candidateOf({ deletedAt: new Date() as never }).eligible).toBe(false);
  });

  it('knows a live photo from either of its two files', () => {
    expect(candidateOf({ livePhotoVideoId: 'video' }).isLivePhoto).toBe(true);
    expect(candidateOf({ isMotionPart: true }).isLivePhoto).toBe(true);
  });

  it('leaves a file that could not be read out of the linking, and keeps its name', () => {
    const rows = [
      row(),
      row({ id: 'broken', originalFileName: 'DSC_9425.jpg' }),
      row({ id: 'empty', originalFileName: 'scan.jpg' }),
      // found, and for some reason never read
      row({ id: 'unread', originalFileName: 'DSC_9426.JPG' }),
    ];
    const { candidates, unreadable } = link(rows, { jpeg: read(), broken: read('failed'), empty: read('no-tags') });
    expect(candidates.map(({ id }) => id)).toEqual(['jpeg']);
    expect(unreadable).toEqual(['DSC_9425.jpg', 'scan.jpg', 'DSC_9426.JPG']);
  });

  it('gives what hangs on each file as a set: two comments are one key', () => {
    const rows = [
      row({ attachments: ['album:trip', 'activity:jpeg', 'activity:jpeg'] }),
      row({ id: 'raw', originalFileName: 'DSC_9425.NEF' }),
    ];
    const { attachments } = readAll(rows);
    expect(attachments.get('jpeg')).toEqual(new Set(['album:trip', 'activity:jpeg']));
    // a file with nothing has no entry
    expect(attachments.has('raw')).toBe(false);
  });
});
