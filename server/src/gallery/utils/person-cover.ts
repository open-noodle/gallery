import type { SystemConfig } from 'src/dtos/config.dto.js';
import { cosineDistance, normalize } from 'src/gallery/utils/video-faces.js';

/**
Person covers picked by quality (specs/2026-11-21-person-cover-quality-design.md, "Choosing a cover"). Pure: the
service reads the candidates and the pixels of the pool, this module chooses.

`PERSON_COVER_VERSION` is stamped on every automatic pick. Bump it whenever a change here makes `pickCover` return
another face for the same input; the next Missing run then re-picks every automatic cover from an older version.
*/
export const PERSON_COVER_VERSION = 1;

/** The job keeps the current cover unless the best face scores at least this much above it (0–1 score range). */
export const PERSON_COVER_MARGIN = 0.1;

/** Faces scored per person: the largest of the pool. Bounds the preview reads of one pick. */
export const PERSON_COVER_POOL_SIZE = 40;

/** Year windows before the latest trusted date, tried in order until one holds enough faces. */
const PERSON_COVER_WINDOWS_YEARS = [3, 6, 10, 20] as const;

/** Side, in pixels, of the grey square each face is reduced to before scoring. */
export const PERSON_COVER_CROP_SIZE = 128;

export const PERSON_COVER_EXPOSURE = { minBrightness: 64, maxBrightness: 204, maxClippedDark: 0.25 } as const;

const PERSON_COVER_WEIGHTS = { sharpness: 0.35, typicality: 0.3, size: 0.2, date: 0.15 } as const;

/** A Missing run looks again at an automatic cover once the person has this many times the candidates it had. */
export const PERSON_COVER_GROWTH = 1.25;

const DAY_MS = 86_400_000;

export const isPersonCoverEnabled = (machineLearning: SystemConfig['machineLearning']) =>
  machineLearning.facialRecognition.covers.enabled;

/** `missing` and `all` are the job's runs; `action` is Choose automatically on one person. */
export type PersonCoverMode = 'missing' | 'all' | 'action';

type PersonCoverState = { source: 'auto' | 'manual' | 'unknown'; faceId: string | null };

/**
The three-state rule (specs/2026-11-21-person-cover-quality-design.md, "Where a cover came from"). A row holds while
its face is the person's current cover. A holding `manual` cover is never replaced by the job; a holding `unknown`
one (a cover from before the table) only by an All run. Choose automatically replaces either: the owner asked.
*/
export const isCoverProtected = (
  cover: PersonCoverState | undefined,
  currentFaceId: string | null,
  mode: PersonCoverMode,
): boolean => {
  if (mode === 'action' || !cover || cover.faceId === null || cover.faceId !== currentFaceId) {
    return false;
  }
  return cover.source === 'manual' || (cover.source === 'unknown' && mode === 'missing');
};

/**
Whether a Missing run should look at an automatic cover again: no pick recorded, the recorded face is no longer the
cover, the pick is from an older `PERSON_COVER_VERSION`, or the candidates grew by `PERSON_COVER_GROWTH`. The
selection query applies the same rule in SQL.
*/
export const isPickStale = (
  pick: { faceId: string | null; version: number | null; candidateCount: number | null } | undefined,
  currentFaceId: string | null,
  candidateCount: number,
): boolean =>
  !pick ||
  pick.faceId !== currentFaceId ||
  pick.version !== PERSON_COVER_VERSION ||
  hasGrownSincePick(pick.candidateCount ?? 0, candidateCount);

export type CoverCandidate = {
  faceId: string;
  assetId: string;
  /** `asset.localDateTime`. */
  date: Date;
  /** A camera make in EXIF, or a date the owner edited. */
  trustedDate: boolean;
  /** Short side of the face box, in the coordinates face detection stored. */
  size: number;
  embedding: number[];
};

export type CoverPixels = { sharpness: number; brightness: number; clippedDark: number };

export type CoverPick = {
  faceId: string;
  score: number;
  /** The current cover's score, when it was among the kept faces. */
  currentScore?: number;
};

/** Whether a recorded automatic pick is stale because the person has gained enough candidates since. */
export const hasGrownSincePick = (recorded: number, current: number) =>
  current > recorded && current >= Math.ceil(recorded * PERSON_COVER_GROWTH);

/**
The faces worth reading pixels for: the trusted candidates (all of them when none is trusted) within the shortest
window before the latest that holds `k` of them, cut to the largest `PERSON_COVER_POOL_SIZE`.
*/
export const selectCoverPool = <T extends CoverCandidate>(candidates: T[]): T[] => {
  const trusted = candidates.filter((candidate) => candidate.trustedDate);
  const dated = trusted.length > 0 ? trusted : candidates;
  if (dated.length === 0) {
    return [];
  }

  const latest = Math.max(...dated.map((candidate) => candidate.date.getTime()));
  const k = Math.min(10, Math.max(3, Math.ceil(dated.length / 2)));
  let pool = dated;
  for (const years of PERSON_COVER_WINDOWS_YEARS) {
    const inWindow = dated.filter((candidate) => latest - candidate.date.getTime() <= years * 365 * DAY_MS);
    if (inWindow.length >= k) {
      pool = inWindow;
      break;
    }
  }

  return pool
    .toSorted((a, b) => b.size - a.size || b.date.getTime() - a.date.getTime() || a.faceId.localeCompare(b.faceId))
    .slice(0, PERSON_COVER_POOL_SIZE);
};

/** Each value's rank among `values`, scaled to 0–1; equal values share their average rank. */
export const scaledRanks = (values: number[]): number[] => {
  const n = values.length;
  if (n < 2) {
    return values.map(() => 0);
  }

  const order = values.map((value, index) => ({ value, index })).toSorted((a, b) => a.value - b.value);
  const ranks = Array.from<number>({ length: n });
  for (let start = 0; start < n;) {
    let end = start;
    while (end + 1 < n && order[end + 1].value === order[start].value) {
      end++;
    }
    const rank = (start + end) / 2 / (n - 1);
    for (let i = start; i <= end; i++) {
      ranks[order[i].index] = rank;
    }
    start = end + 1;
  }
  return ranks;
};

/** Cosine similarity of each candidate's embedding to the normalised mean of all the candidates' embeddings. */
export const typicality = (candidates: CoverCandidate[]): Map<string, number> => {
  const vectors = candidates.map(({ embedding }) => normalize(embedding));
  const sum = Array.from({ length: vectors[0]?.length ?? 0 }, () => 0);
  for (const vector of vectors) {
    for (let i = 0; i < sum.length; i++) {
      sum[i] += vector[i];
    }
  }
  const center = normalize(sum);
  return new Map(candidates.map(({ faceId }, index) => [faceId, 1 - cosineDistance(vectors[index], center)]));
};

const isWellExposed = ({ brightness, clippedDark }: CoverPixels) =>
  brightness >= PERSON_COVER_EXPOSURE.minBrightness &&
  brightness <= PERSON_COVER_EXPOSURE.maxBrightness &&
  clippedDark < PERSON_COVER_EXPOSURE.maxClippedDark;

/**
The cover for these candidates. `pixels` holds the scores read for the pool (`selectCoverPool`); a pool face without
them (its preview could not be read) is left out. With `margin`, the current cover stays when it is among the kept
faces and the best scores less than `margin` above it. Undefined when no pool face could be read.
*/
export const pickCover = ({
  candidates,
  pixels,
  currentFaceId,
  margin = 0,
}: {
  candidates: CoverCandidate[];
  pixels: ReadonlyMap<string, CoverPixels>;
  currentFaceId?: string | null;
  margin?: number;
}): CoverPick | undefined => {
  const read = selectCoverPool(candidates).filter((candidate) => pixels.has(candidate.faceId));
  if (read.length === 0) {
    return;
  }

  const exposed = read.filter((candidate) => isWellExposed(pixels.get(candidate.faceId)!));
  const kept = exposed.length > 0 ? exposed : read;
  const typical = typicality(candidates);
  const { sharpness, typicality: typicalityWeight, size, date } = PERSON_COVER_WEIGHTS;
  const ranks = {
    sharpness: scaledRanks(kept.map(({ faceId }) => pixels.get(faceId)!.sharpness)),
    typicality: scaledRanks(kept.map(({ faceId }) => typical.get(faceId)!)),
    size: scaledRanks(kept.map((candidate) => candidate.size)),
    date: scaledRanks(kept.map((candidate) => candidate.date.getTime())),
  };
  const scored = kept.map((candidate, i) => ({
    candidate,
    score:
      sharpness * ranks.sharpness[i] +
      typicalityWeight * ranks.typicality[i] +
      size * ranks.size[i] +
      date * ranks.date[i],
  }));

  // Scores within rounding of each other are a tie, which goes to the more recent face.
  const [best] = scored.toSorted(
    (a, b) =>
      (Math.abs(b.score - a.score) > 1e-9 ? b.score - a.score : 0) ||
      b.candidate.date.getTime() - a.candidate.date.getTime() ||
      a.candidate.faceId.localeCompare(b.candidate.faceId),
  );
  const current = scored.find(({ candidate }) => candidate.faceId === currentFaceId);
  if (current && best.score - current.score < margin) {
    return { faceId: current.candidate.faceId, score: current.score, currentScore: current.score };
  }

  return { faceId: best.candidate.faceId, score: best.score, currentScore: current?.score };
};
