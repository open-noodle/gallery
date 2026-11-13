import type { BoundingBox } from 'src/repositories/machine-learning.repository.js';

// Pure parts of video face sampling (specs/2026-10-31-video-face-frames-design.md): which frames to look at, which
// detections are the same person, which view of them is best, and which existing face a new one replaces.

/** Bumped when sampling or tracking changes enough that videos should be rescanned. */
export const VIDEO_FACE_SAMPLER_VERSION = 3;

/**
Relaxation of the distance threshold for a detection where the track was in the previous sample: its centre within
one face of the old centre, at no more than twice or half the size. A box overlap test would miss small faces, which
a second's drift moves off their old box while their embeddings are at their noisiest.
*/
const CONTINUITY_RELAXATION = 0.1;
const CONTINUITY_MAX_SIZE_RATIO = 2;

/**
Offsets (seconds) from a person's best sample at which a sharper view is looked for. A sample a second apart can
catch someone mid-turn or blurred, with a clearer moment a quarter of a second away.
*/
const SHARPEN_OFFSETS = [-0.5, -0.25, 0.25, 0.5];

/** Sightings averaged into a face's embedding. */
const EMBEDDING_SIGHTINGS = 3;

/** The recognition model's input side: a face this tall or more counts as full size. */
const FULL_SIZE_FACE = 112;
const SHARPNESS_SCALE = 150;

/** An old single-frame face matches a sighting this early in the video, at this overlap, as the poster comes from there. */
const POSTER_WINDOW_SECONDS = 3;
const POSTER_IOU = 0.5;

/** Clips up to this long are sampled at least once a second, so a short clip still gives each person a few chances. */
const SHORT_CLIP_SECONDS = 60;
const SHORT_CLIP_INTERVAL = 1;

/**
Per-person confidence. Frames are searched at this lower detector score, and a person is kept when their best frame
reaches the configured minimum score, as a photo face must, or when they are seen again and again: in at least
`CONSISTENT_SIGHTINGS` frames, with a median score of at least this one and a median face of at least
`CONSISTENT_MIN_FACE` px. A face detected at 0.5 in ten frames in a row is almost certainly real; the size floor keeps
a crowd of faces too small to recognise out of the People list.
*/
export const VIDEO_FACE_LOW_SCORE = 0.45;
const CONSISTENT_SIGHTINGS = 3;
const CONSISTENT_MIN_FACE = 32;

/**
A person whose largest face is narrower than this (short side, frame px) is dropped however confident the detector
was: no crop of it, even widened, shows who it is, so it would only add a person nobody can name. The admin setting
`minFaceSize` overrides it.
*/
const MIN_FACE = 20;

/** Faces smaller than this (longest side, frame px) are cropped with surrounding context: up to 2.5x at half of it. */
const CONTEXT_FACE_SIZE = 80;
const CONTEXT_MAX_FACTOR = 2.5;

/** Tiled detection: frames with a long edge above this are also searched as four overlapping quarters. */
const TILE_MIN_LONG_EDGE = 960;
const TILE_OVERLAP = 0.15;
const TILE_MERGE_IOU = 0.4;
/** A find mostly inside another is that face cut by a quarter's edge, whatever their IoU. */
const TILE_CONTAINED = 0.8;

/** The sampling interval for a span: at least once a second for a short clip, else the configured one. */
export const sampleIntervalFor = (span: number, interval: number) =>
  span <= SHORT_CLIP_SECONDS ? Math.min(interval, SHORT_CLIP_INTERVAL) : interval;

export type SamplePlanOptions = {
  start: number;
  end: number;
  interval: number;
  maxFrames: number;
  cuts?: number[];
};

/**
Times to sample: every `interval` seconds starting half an interval in, plus just after each cut. When that is more
than `maxFrames`, the interval stretches until it fits, so a long video is still covered from start to end.
*/
export const planSampleTimes = ({ start, end, interval, maxFrames, cuts = [] }: SamplePlanOptions): number[] => {
  const span = end - start;
  if (!(span > 0) || maxFrames < 1) {
    return [];
  }

  // A cut sample sits a little after the cut, where the new shot has settled, but never past the end.
  const cutTimes = cuts
    .filter((cut) => cut > start && cut < end)
    .map((cut) => Math.min(cut + 0.2, end - 0.001))
    .slice(0, Math.floor(maxFrames / 2));

  const intervalBudget = Math.max(1, maxFrames - cutTimes.length);
  const step = Math.max(interval, span / intervalBudget);

  const times: number[] = [];
  for (let t = start + Math.min(step, span) / 2; t < end && times.length < intervalBudget; t += step) {
    times.push(t);
  }

  // A cut sample within half an interval of an interval sample adds nothing.
  for (const cut of cutTimes) {
    if (times.every((t) => !(Math.abs(t - cut) < step / 2))) {
      times.push(cut);
    }
  }

  return times.sort((a, b) => a - b).map((t) => Math.round(t * 1000) / 1000);
};

export const parseEmbedding = (embedding: string): number[] => normalize(JSON.parse(embedding) as number[]);

export const serializeEmbedding = (vector: number[]): string => `[${vector.join(',')}]`;

export const normalize = (vector: number[]): number[] => {
  let norm = 0;
  for (const value of vector) {
    norm += value * value;
  }
  norm = Math.sqrt(norm);
  return norm === 0 ? vector : vector.map((value) => value / norm);
};

/** Cosine distance of two unit vectors, the `<=>` face_search uses. */
export const cosineDistance = (a: number[], b: number[]): number => {
  let dot = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
  }
  return 1 - dot;
};

export const iou = (a: BoundingBox, b: BoundingBox): number => {
  const x1 = Math.max(a.x1, b.x1);
  const y1 = Math.max(a.y1, b.y1);
  const x2 = Math.min(a.x2, b.x2);
  const y2 = Math.min(a.y2, b.y2);
  const intersection = Math.max(0, x2 - x1) * Math.max(0, y2 - y1);
  const union = (a.x2 - a.x1) * (a.y2 - a.y1) + (b.x2 - b.x1) * (b.y2 - b.y1) - intersection;
  return union > 0 ? intersection / union : 0;
};

/** Detector confidence × size × sharpness, each in [0, 1]. */
export const sightingQuality = ({ score, box, sharpness }: { score: number; box: BoundingBox; sharpness: number }) => {
  const shortSide = Math.min(box.x2 - box.x1, box.y2 - box.y1);
  const size = Math.min(1, Math.max(0, shortSide) / FULL_SIZE_FACE);
  return score * size * (1 - Math.exp(-Math.max(0, sharpness) / SHARPNESS_SCALE));
};

export type Detection = {
  box: BoundingBox;
  score: number;
  /** Unit-length embedding. */
  embedding: number[];
  quality: number;
};

export type Sighting = Detection & { t: number; frameIndex: number };

export type FaceTrack = {
  sightings: Sighting[];
  best: Sighting;
  centroid: number[];
};

type MutableTrack = FaceTrack & { sum: number[]; last: Sighting };

/** What the final merge knows about two tracks (`comparePair`). */
type PairEvidence = {
  centroidDistance: number;
  /**
  Between their stored embeddings, the normalised mean of each one's best few confident sightings; Infinity when
  either has none.
  */
  embeddingDistance: number;
  /** The nearer of the two above: what pairs are ranked by. */
  distance: number;
  /** Seen in consecutive samples in the same place, confidently both times. */
  continuous: boolean;
  /** Frames both are seen in: each one is proof they are two people. */
  seenTogether: number;
  mergeable: boolean;
};

/** A pair of tracks the final merge left apart, reported for the debug log. */
export type UnmergedPair = { a: FaceTrack; b: FaceTrack } & Omit<PairEvidence, 'mergeable' | 'distance'>;

/** Pairs left apart this close to the merge threshold are reported, as the ones a threshold change would decide. */
const NEAR_MISS = 0.1;

/**
Detector score from which a sighting is a confident view of a face, and only then evidence for merging two tracks on
their best views or on continuity: the configured `minScore`, upstream's default here. Backs and sides of heads score
lower, and their embeddings look alike from one person to the next (issue 1306: three audience members seen from
behind, 0.29 apart, merged into one face).
*/
const CONFIDENT_SCORE = 0.7;

/**
Groups detections into one track per person, frame by frame in time order. A detection joins the nearest track
by embedding (its centroid or its latest sighting), with a looser threshold when it is where that track was in the
previous sample. Each frame is matched one-to-one, so two faces in one frame are never the same person.
*/
export class FaceTracker {
  private tracks: MutableTrack[] = [];

  constructor(
    private maxDistance: number,
    private confidentScore = CONFIDENT_SCORE,
  ) {}

  /** Adds one frame's detections. Returns, per detection, the index of the track it joined. */
  addFrame(t: number, frameIndex: number, detections: Detection[]): number[] {
    const pairs: { detection: number; track: number; distance: number }[] = [];
    for (const [detectionIndex, detection] of detections.entries()) {
      for (const [trackIndex, track] of this.tracks.entries()) {
        const distance = Math.min(
          cosineDistance(detection.embedding, track.centroid),
          cosineDistance(detection.embedding, track.last.embedding),
        );
        const continuous = track.last.frameIndex === frameIndex - 1 && nearby(detection.box, track.last.box);
        const threshold = this.maxDistance + (continuous ? CONTINUITY_RELAXATION : 0);
        if (distance < threshold) {
          pairs.push({ detection: detectionIndex, track: trackIndex, distance });
        }
      }
    }

    const assigned: number[] = Array.from({ length: detections.length }, () => -1);
    const takenTracks = new Set<number>();
    for (const pair of pairs.sort((a, b) => a.distance - b.distance)) {
      if (assigned[pair.detection] !== -1 || takenTracks.has(pair.track)) {
        continue;
      }
      assigned[pair.detection] = pair.track;
      takenTracks.add(pair.track);
    }

    for (const [detectionIndex, detection] of detections.entries()) {
      const sighting: Sighting = { ...detection, t, frameIndex };
      const trackIndex = assigned[detectionIndex];
      if (trackIndex === -1) {
        this.tracks.push({
          sightings: [sighting],
          best: sighting,
          last: sighting,
          sum: [...detection.embedding],
          centroid: detection.embedding,
        });
        assigned[detectionIndex] = this.tracks.length - 1;
        continue;
      }

      const track = this.tracks[trackIndex];
      track.sightings.push(sighting);
      track.last = sighting;
      if (sighting.quality > track.best.quality) {
        track.best = sighting;
      }
      for (let i = 0; i < track.sum.length; i++) {
        track.sum[i] += detection.embedding[i];
      }
      track.centroid = normalize(track.sum);
    }

    return assigned;
  }

  /**
  The tracks, after merging pairs that are the same person seen apart, closest pair first. Tracks seen together in a
  frame are two people and never merge. Any other pair merges on either kind of evidence (`comparePair`):

  - looks: the nearer of their centroids and their best few confident sightings (the embedding a face is stored
    with) is under `maxDistance`, so a track whose centroid sideways or blurred views dragged off still meets its
    other half;
  - continuity: one was seen in the sample right after the other, in the same place and confidently both times,
    within the relaxed threshold the tracker itself applies from one sample to the next: a person who turned their
    head between two samples.

  `report` hears about every pair left apart near the threshold, and why, for the debug log.
  */
  finish(report?: (pair: UnmergedPair) => void): FaceTrack[] {
    const tracks = this.tracks;
    const summarize = (track: FaceTrack) => summarizeTrack(track, this.confidentScore);
    let summaries = tracks.map((track) => summarize(track));
    const compare = (i: number, j: number) => comparePair(summaries[i], summaries[j], this.maxDistance);
    const pairs: PairEvidence[][] = tracks.map(() => []);
    for (let i = 0; i < tracks.length; i++) {
      for (let j = i + 1; j < tracks.length; j++) {
        pairs[i][j] = compare(i, j);
      }
    }
    const pairAt = (i: number, j: number) => (i < j ? pairs[i][j] : pairs[j][i]);

    for (;;) {
      let next: { i: number; j: number; distance: number } | undefined;
      for (let i = 0; i < tracks.length; i++) {
        for (let j = i + 1; j < tracks.length; j++) {
          const pair = pairs[i][j];
          if (pair.mergeable && (!next || pair.distance < next.distance)) {
            next = { i, j, distance: pair.distance };
          }
        }
      }
      if (!next) {
        break;
      }

      const { i, j } = next;
      tracks[i] = mergeTracks(tracks[i], tracks[j]);
      tracks.splice(j, 1);
      summaries = [...summaries.slice(0, j), ...summaries.slice(j + 1)];
      summaries[i] = summarize(tracks[i]);
      pairs.splice(j, 1);
      for (const row of pairs) {
        row.splice(j, 1);
      }
      for (let k = 0; k < tracks.length; k++) {
        if (k === i) {
          continue;
        }
        const pair = compare(Math.min(i, k), Math.max(i, k));
        if (k < i) {
          pairs[k][i] = pair;
        } else {
          pairs[i][k] = pair;
        }
      }
    }

    if (report) {
      for (let i = 0; i < tracks.length; i++) {
        for (let j = i + 1; j < tracks.length; j++) {
          const pair = pairAt(i, j);
          if (pair.distance < this.maxDistance + NEAR_MISS) {
            report({ a: tracks[i], b: tracks[j], ...pair });
          }
        }
      }
    }

    return tracks.map(({ sightings, best, centroid }) => ({ sightings, best, centroid }));
  }

  /** People found so far, before the final merge: what progress reports. */
  peopleSoFar(): number {
    return this.tracks.length;
  }

  /** Every track's current best sighting, so a frame that is nobody's best can be deleted early. */
  bestFrameIndexes(): Set<number> {
    return new Set(this.tracks.map((track) => track.best.frameIndex));
  }
}

const nearby = (a: BoundingBox, b: BoundingBox) => {
  const sizeA = Math.max(a.x2 - a.x1, a.y2 - a.y1);
  const sizeB = Math.max(b.x2 - b.x1, b.y2 - b.y1);
  const larger = Math.max(sizeA, sizeB);
  const drift = Math.hypot((a.x1 + a.x2 - b.x1 - b.x2) / 2, (a.y1 + a.y2 - b.y1 - b.y2) / 2);
  return drift <= larger && larger <= Math.min(sizeA, sizeB) * CONTINUITY_MAX_SIZE_RATIO;
};

/** How much of the smaller box the two boxes share: 1 when one holds the other. */
const overlapOfSmaller = (a: BoundingBox, b: BoundingBox) => {
  const width = Math.max(0, Math.min(a.x2, b.x2) - Math.max(a.x1, b.x1));
  const height = Math.max(0, Math.min(a.y2, b.y2) - Math.max(a.y1, b.y1));
  const smaller = Math.min((a.x2 - a.x1) * (a.y2 - a.y1), (b.x2 - b.x1) * (b.y2 - b.y1));
  return smaller > 0 ? (width * height) / smaller : 0;
};

type TrackSummary = {
  track: FaceTrack;
  /** The stored embedding over confident sightings only, when the track has any. */
  embedding?: number[];
  byFrame: Map<number, Sighting>;
  confidentScore: number;
};

const summarizeTrack = (track: FaceTrack, confidentScore: number): TrackSummary => {
  const confident = track.sightings.filter((sighting) => sighting.score >= confidentScore);
  return {
    track,
    embedding: confident.length > 0 ? trackEmbedding({ ...track, sightings: confident }) : undefined,
    byFrame: new Map(track.sightings.map((sighting) => [sighting.frameIndex, sighting])),
    confidentScore,
  };
};

const comparePair = (a: TrackSummary, b: TrackSummary, maxDistance: number): PairEvidence => {
  const centroidDistance = cosineDistance(a.track.centroid, b.track.centroid);
  const embeddingDistance = a.embedding && b.embedding ? cosineDistance(a.embedding, b.embedding) : Infinity;
  const distance = Math.min(centroidDistance, embeddingDistance);
  const confident = (sighting: Sighting) => sighting.score >= a.confidentScore;

  let seenTogether = 0;
  let continuous = false;
  for (const sighting of b.track.sightings) {
    if (a.byFrame.has(sighting.frameIndex)) {
      seenTogether++;
      continue;
    }
    for (const step of [-1, 1]) {
      const neighbour = a.byFrame.get(sighting.frameIndex + step);
      if (
        neighbour &&
        !b.byFrame.has(neighbour.frameIndex) &&
        confident(neighbour) &&
        confident(sighting) &&
        nearby(neighbour.box, sighting.box)
      ) {
        continuous = true;
      }
    }
  }

  const mergeable =
    seenTogether === 0 && (distance < maxDistance || (continuous && distance < maxDistance + CONTINUITY_RELAXATION));
  return { centroidDistance, embeddingDistance, distance, continuous, seenTogether, mergeable };
};

/** One track from two never seen together. */
const mergeTracks = (a: MutableTrack, b: MutableTrack): MutableTrack => {
  const sightings = [...a.sightings, ...b.sightings].sort((x, y) => x.t - y.t);
  const sum = a.sum.map((value, i) => value + b.sum[i]);
  return {
    sightings,
    best: a.best.quality >= b.best.quality ? a.best : b.best,
    last: sightings.at(-1)!,
    sum,
    centroid: normalize(sum),
  };
};

const roundTime = (t: number) => Math.round(t * 1000) / 1000;

/**
The extra frames that may hold a sharper view of the kept people: a few around each one's best sample, inside the
span, and not ones already sampled. People best seen at the same moment share them, so a crowd shot costs four
frames, not four per person.
*/
export const planSharpenTimes = (
  tracks: FaceTrack[],
  { start, end, sampled }: { start: number; end: number; sampled: number[] },
): number[] => {
  const taken = new Set(sampled.map((t) => roundTime(t)));
  const times = new Set<number>();
  for (const track of tracks) {
    for (const offset of SHARPEN_OFFSETS) {
      const t = roundTime(track.best.t + offset);
      if (t >= start && t < end && !taken.has(t)) {
        times.add(t);
      }
    }
  }
  return [...times].sort((a, b) => a - b);
};

/** Whether an extra frame at `t` is one planSharpenTimes chose for a track whose best sample was at `bestT`. */
export const isSharpenTimeFor = (t: number, bestT: number) =>
  Math.abs(t - bestT) <= Math.max(...SHARPEN_OFFSETS.map((offset) => Math.abs(offset))) + 0.001;

/**
The track's person among an extra frame's detections, by the tracker's continuity rule: where their best view was
and close enough in looks with the relaxation. The closest in looks when several qualify, as in a crowd.
*/
export const findAgain = (track: FaceTrack, detections: Detection[], maxDistance: number): Detection | undefined => {
  let found: Detection | undefined;
  let foundDistance = maxDistance + CONTINUITY_RELAXATION;
  for (const detection of detections) {
    if (!nearby(detection.box, track.best.box)) {
      continue;
    }
    const distance = Math.min(
      cosineDistance(detection.embedding, track.centroid),
      cosineDistance(detection.embedding, track.best.embedding),
    );
    if (distance >= foundDistance) {
      continue;
    }
    found = detection;
    foundDistance = distance;
  }
  return found;
};

/** The track with one more sighting, which becomes its best view when it is better. */
export const withSighting = (track: FaceTrack, sighting: Sighting): FaceTrack => ({
  ...track,
  sightings: [...track.sightings, sighting].sort((a, b) => a.t - b.t),
  best: sighting.quality > track.best.quality ? sighting : track.best,
});

/** The normalised mean of a track's best few sightings: steadier for recognition than any one frame. */
export const trackEmbedding = (track: FaceTrack): number[] => {
  const top = [...track.sightings].sort((a, b) => b.quality - a.quality).slice(0, EMBEDDING_SIGHTINGS);
  const sum = top[0].embedding.map(() => 0);
  for (const sighting of top) {
    for (let i = 0; i < sum.length; i++) {
      sum[i] += sighting.embedding[i];
    }
  }
  return normalize(sum);
};

export type ExistingVideoFace = {
  id: string;
  /** Unit-length embedding, when the face has one. */
  embedding?: number[];
  /** True for a face from an earlier multi-frame scan, whose box is in that scan's frame. */
  hasFrame: boolean;
  imageWidth: number;
  imageHeight: number;
  box: BoundingBox;
  /** The face's person, when it has one. */
  personGroupId?: string | null;
};

type MatchOptions = { maxDistance: number; frame: { width: number; height: number }; start: number };

/**
How well an existing face matches a track: its distance to the nearest sighting, under `maxDistance`, or, for a
single-frame face, `maxDistance` itself when it overlaps a sighting from the first few seconds after `start`, where
the poster it was found in comes from. Infinity when it does not match.
*/
const matchCost = (face: ExistingVideoFace, track: FaceTrack, { maxDistance, frame, start }: MatchOptions) => {
  let cost = Infinity;
  if (face.embedding) {
    for (const sighting of track.sightings) {
      cost = Math.min(cost, cosineDistance(face.embedding, sighting.embedding));
    }
  }
  if (cost >= maxDistance) {
    cost = Infinity;
  }

  if (!face.hasFrame && face.imageWidth > 0 && face.imageHeight > 0) {
    const scaled = scaleBox(face.box, face, frame);
    const nearPoster = track.sightings.some(
      (sighting) => sighting.t <= start + POSTER_WINDOW_SECONDS && iou(scaled, sighting.box) > POSTER_IOU,
    );
    if (nearPoster) {
      // Position is weaker evidence than appearance, so it only wins when no embedding match is closer.
      cost = Math.min(cost, maxDistance);
    }
  }
  return cost;
};

/**
Pairs existing faces with new tracks, one-to-one, so a re-scan keeps face ids and with them people. A face with a
person is matched before one without, so a track several old faces match keeps the name or the recognition result;
within each group the closest pairs go first.
*/
export const matchExistingFaces = (
  existing: ExistingVideoFace[],
  tracks: FaceTrack[],
  options: MatchOptions,
): Map<number, string> => {
  const pairs: { face: string; track: number; cost: number; hasPerson: boolean }[] = [];
  for (const face of existing) {
    for (const [trackIndex, track] of tracks.entries()) {
      const cost = matchCost(face, track, options);
      if (Number.isFinite(cost)) {
        pairs.push({ face: face.id, track: trackIndex, cost, hasPerson: !!face.personGroupId });
      }
    }
  }

  const matches = new Map<number, string>();
  const takenFaces = new Set<string>();
  for (const pair of pairs.sort((a, b) => Number(b.hasPerson) - Number(a.hasPerson) || a.cost - b.cost)) {
    if (takenFaces.has(pair.face) || matches.has(pair.track)) {
      continue;
    }
    matches.set(pair.track, pair.face);
    takenFaces.add(pair.face);
  }
  return matches;
};

/**
Old faces a re-scan merged into another one: unmatched, but matching a track whose kept face has the same person.
Usually one person an older tracker split in two, both halves since recognised as them (issue 1306). Deleting such
a face loses nothing, as the kept face carries the person; an unmatched face whose person differs is left alone.
*/
export const absorbedFaces = (
  existing: ExistingVideoFace[],
  tracks: FaceTrack[],
  matches: Map<number, string>,
  options: MatchOptions,
): Set<string> => {
  const matched = new Set(matches.values());
  const byId = new Map(existing.map((face) => [face.id, face]));
  const absorbed = new Set<string>();
  for (const face of existing) {
    if (matched.has(face.id) || !face.personGroupId) {
      continue;
    }
    for (const [trackIndex, track] of tracks.entries()) {
      const kept = byId.get(matches.get(trackIndex) ?? '');
      if (kept?.personGroupId === face.personGroupId && Number.isFinite(matchCost(face, track, options))) {
        absorbed.add(face.id);
        break;
      }
    }
  }
  return absorbed;
};

const scaleBox = (
  box: BoundingBox,
  from: { imageWidth: number; imageHeight: number },
  to: { width: number; height: number },
): BoundingBox => {
  const x = to.width / from.imageWidth;
  const y = to.height / from.imageHeight;
  return { x1: box.x1 * x, y1: box.y1 * y, x2: box.x2 * x, y2: box.y2 * y };
};

const median = (values: number[]) => {
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[middle - 1] + sorted[middle]) / 2 : sorted[middle];
};

/**
Whether a track is a person worth keeping: seen in at least `minSightings` frames, large enough to recognise
(`minFaceSize`, MIN_FACE by default), and confident once or consistent across frames (see VIDEO_FACE_LOW_SCORE).
*/
export const acceptTrack = (
  track: FaceTrack,
  minScore: number,
  { minFaceSize = MIN_FACE, minSightings = 1 }: { minFaceSize?: number; minSightings?: number } = {},
): boolean => {
  if (track.sightings.length < minSightings) {
    return false;
  }
  const sizes = track.sightings.map(({ box }) => Math.min(box.x2 - box.x1, box.y2 - box.y1));
  if (Math.max(...sizes) < minFaceSize) {
    return false;
  }
  const scores = track.sightings.map((sighting) => sighting.score);
  if (Math.max(...scores) >= minScore) {
    return true;
  }
  if (track.sightings.length < CONSISTENT_SIGHTINGS) {
    return false;
  }
  return median(scores) >= Math.min(minScore, VIDEO_FACE_LOW_SCORE) && median(sizes) >= CONSISTENT_MIN_FACE;
};

export type Tile = { left: number; top: number; width: number; height: number };

/**
Four overlapping quarters of a frame, for tiled detection: the detector shrinks its input to 640 px, so a quarter of
a 1080p frame shows each face at about twice the size the whole frame does. Empty for a frame small enough already.
The overlap lets a face cut by one quarter's edge appear whole in its neighbour.
*/
export const planTiles = ({ width, height }: { width: number; height: number }): Tile[] => {
  if (Math.max(width, height) <= TILE_MIN_LONG_EDGE) {
    return [];
  }
  const tileWidth = Math.round((width / 2) * (1 + TILE_OVERLAP));
  const tileHeight = Math.round((height / 2) * (1 + TILE_OVERLAP));
  const tiles: Tile[] = [];
  for (const top of [0, height - tileHeight]) {
    for (const left of [0, width - tileWidth]) {
      tiles.push({ left, top, width: tileWidth, height: tileHeight });
    }
  }
  return tiles;
};

/**
One list of detections from the whole frame and its tiles, boxes in frame pixels. Where two overlap they are the
same face found twice, and the more confident one is kept.
*/
export const mergeDetections = <T extends { boundingBox: BoundingBox; score: number }>(detections: T[]): T[] => {
  const kept: T[] = [];
  for (const detection of [...detections].sort((a, b) => b.score - a.score)) {
    const isSameFace = (other: T) =>
      iou(other.boundingBox, detection.boundingBox) > TILE_MERGE_IOU ||
      overlapOfSmaller(other.boundingBox, detection.boundingBox) > TILE_CONTAINED;
    if (kept.every((other) => !isSameFace(other))) {
      kept.push(detection);
    }
  }
  return kept;
};

/**
The region a small video face is cropped from: the face box widened around its centre, by up to 2.5x for a face half
of CONTEXT_FACE_SIZE or smaller, so the crop shows head, hair and shoulders instead of an upscaled smudge. A face at
CONTEXT_FACE_SIZE or larger is returned unchanged. The box stored on the face is never widened, only the crop.
*/
export const widenSmallFace = (box: BoundingBox, frame: { width: number; height: number }): BoundingBox => {
  const side = Math.max(box.x2 - box.x1, box.y2 - box.y1);
  if (!(side > 0) || side >= CONTEXT_FACE_SIZE) {
    return box;
  }
  const smallness = Math.min(1, (CONTEXT_FACE_SIZE - side) / (CONTEXT_FACE_SIZE / 2));
  const factor = 1 + (CONTEXT_MAX_FACTOR - 1) * smallness;
  const centreX = (box.x1 + box.x2) / 2;
  const centreY = (box.y1 + box.y2) / 2;
  const halfWidth = ((box.x2 - box.x1) * factor) / 2;
  const halfHeight = ((box.y2 - box.y1) * factor) / 2;
  return {
    x1: Math.max(0, Math.round(centreX - halfWidth)),
    y1: Math.max(0, Math.round(centreY - halfHeight)),
    x2: Math.min(frame.width, Math.round(centreX + halfWidth)),
    y2: Math.min(frame.height, Math.round(centreY + halfHeight)),
  };
};
