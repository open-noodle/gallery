import { AssetType, AssetVisibility } from 'src/enum.js';
import type { AssetVersionRepository } from 'src/gallery/repositories/asset-version.repository.js';
import type { Attachments, VersionCandidate } from 'src/gallery/utils/asset-version-rules.js';
import type { FileRead } from 'src/gallery/utils/asset-version-signature.js';

// The small steps of a versions job around the linking (asset-version-rules.ts): whether to look at a file at all,
// and turning what the database returned into what the linking takes. Pure, so each is tested by itself.

/** Step 1: versions are on, the file exists, is a picture and is not in the trash. */
export const shouldLook = (
  settings: { enabled: boolean },
  file: { type: AssetType; deletedAt: unknown } | undefined | null,
): boolean => settings.enabled && !!file && file.type === AssetType.Image && !file.deletedAt;

export type CandidateRow = Awaited<ReturnType<AssetVersionRepository['getCandidatesAtTime']>>[number];

const SHOWN = new Set<AssetVisibility>([AssetVisibility.Timeline, AssetVisibility.Archive]);

/**
What was read from a file: by this job (`reads`), else what its row keeps, if it is part of a combined shot and was
read by the current parser. Nothing for a file not read yet.
*/
export const readOf = (
  row: { id: string; read: FileRead | null },
  reads: Map<string, FileRead>,
  parserVersion: number,
) => reads.get(row.id) ?? (row.read?.parserVersion === parserVersion ? row.read : undefined);

export type LinkInput = {
  /** The files that could be read, with what was read from each. */
  candidates: VersionCandidate[];
  /** What hangs on each file (albums, favourites, comments, ...), as a set: the same key can come twice. */
  attachments: Attachments;
  /** The names of the files that were found and could not be read. They take no part, and are not forgotten. */
  unreadable: string[];
};

/** Rows of the candidate searches, with what was read from each, as the linking takes them. */
export const toLinkInput = (rows: CandidateRow[], reads: Map<string, FileRead>, parserVersion: number): LinkInput => {
  const signatureOf = (row: CandidateRow) => readOf(row, reads, parserVersion)?.signature ?? null;
  const readable = rows.filter((row) => signatureOf(row) !== null);
  return {
    candidates: readable.map((row) => ({
      id: row.id,
      ownerId: row.ownerId,
      libraryId: row.libraryId,
      originalFileName: row.originalFileName,
      originalPath: row.originalPath,
      addedAtMs: new Date(row.createdAt as unknown as string | Date).getTime(),
      checksum: row.checksum.toString('hex'),
      isLivePhoto: !!row.livePhotoVideoId || !!row.isMotionPart,
      eligible: !row.deletedAt && !row.isOffline && SHOWN.has(row.visibility),
      versionOf: row.versionOf,
      hasVersions: !!row.hasVersions,
      editedAtMs: new Date(row.fileModifiedAt as unknown as string | Date).getTime(),
      signature: signatureOf(row)!,
    })),
    attachments: new Map(
      readable.filter((row) => row.attachments.length > 0).map((row) => [row.id, new Set(row.attachments)]),
    ),
    unreadable: rows.filter((row) => signatureOf(row) === null).map((row) => row.originalFileName),
  };
};

/**
The search by exact time, read with a limit: a full read means that many files or more share the time, which is a
camera whose clock was never set, and then the time finds nothing. The search by name is not affected.
*/
export const usableTimeMatches = <T>(rows: T[], limit: number): { rows: T[]; matchByTime: boolean } =>
  rows.length >= limit ? { rows: [], matchByTime: false } : { rows, matchByTime: true };
