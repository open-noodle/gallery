import type { BoundingBox } from 'src/repositories/machine-learning.repository.js';

// Pure parts of video face sampling (specs/2026-10-31-video-face-frames-design.md): which frames to look at, which
// detections are the same person, which view of them is best, and which existing face a new one replaces.

/** Bumped when sampling or tracking changes enough that videos should be rescanned. */
export const VIDEO_FACE_SAMPLER_VERSION = 2;

/**
 * Relaxation of the distance threshold for a detection where the track was in the previous sample: its centre within
 * one face of the old centre, at no more than twice or half the size. A box overlap test would miss small faces, which
 * a second's drift moves off their old box while their embeddings are at their noisiest.
 */
const CONTINUITY_RELAXATION = 0.1;
const CONTINUITY_MAX_SIZE_RATIO = 2;

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
 * Per-person confidence. Frames are searched at this lower detector score, and a person is kept when their best frame
 * reaches the configured minimum score, as a photo face must, or when they are seen again and again: in at least
 * `CONSISTENT_SIGHTINGS` frames, with a median score of at least this one and a median face of at least
 * `CONSISTENT_MIN_FACE` px. A face detected at 0.5 in ten frames in a row is almost certainly real; the size floor keeps
 * a crowd of faces too small to recognise out of the People list.
 */
export const VIDEO_FACE_LOW_SCORE = 0.45;
const CONSISTENT_SIGHTINGS = 3;
const CONSISTENT_MIN_FACE = 32;

/**
 * A person whose largest face is narrower than this (short side, frame px) is dropped however confident the detector
 * was: no crop of it, even widened, shows who it is, so it would only add a person nobody can name.
 */
const MIN_FACE = 20;

/** Faces smaller than this (longest side, frame px) are cropped with surrounding context: up to 2.5x at half of it. */
const CONTEXT_FACE_SIZE = 80;
const CONTEXT_MAX_FACTOR = 2.5;

/** Tiled detection: frames with a long edge above this are also searched as four overlapping quarters. */
const TILE_MIN_LONG_EDGE = 960;
const TILE_OVERLAP = 0.15;
const TILE_MERGE_IOU = 0.4;

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
 * Times to sample: every `interval` seconds starting half an interval in, plus just after each cut. When that is more
 * than `maxFrames`, the interval stretches until it fits, so a long video is still covered from start to end.
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

/**
 * Groups detections into one track per person, frame by frame in time order. A detection joins the nearest track
 * by embedding (its centroid or its latest sighting), with a looser threshold when it is where that track was in the
 * previous sample. Each frame is matched one-to-one, so two faces in one frame are never the same person.
 */
export class FaceTracker {
  private tracks: MutableTrack[] = [];

  constructor(private maxDistance: number) {}

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

  /** The tracks, after merging pairs that are the same person seen apart (never in the same frame). */
  finish(): FaceTrack[] {
    let merged = true;
    while (merged) {
      merged = false;
      outer: for (let i = 0; i < this.tracks.length; i++) {
        for (let j = i + 1; j < this.tracks.length; j++) {
          const a = this.tracks[i];
          const b = this.tracks[j];
          if (cosineDistance(a.centroid, b.centroid) >= this.maxDistance || coOccur(a, b)) {
            continue;
          }
          this.tracks[i] = mergeTracks(a, b);
          this.tracks.splice(j, 1);
          merged = true;
          break outer;
        }
      }
    }
    return this.tracks.map(({ sightings, best, centroid }) => ({ sightings, best, centroid }));
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

const coOccur = (a: FaceTrack, b: FaceTrack) => {
  const frames = new Set(a.sightings.map((sighting) => sighting.frameIndex));
  return b.sightings.some((sighting) => frames.has(sighting.frameIndex));
};

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
};

/**
 * Pairs existing faces with new tracks, one-to-one, best first, so a re-scan keeps face ids and with them people.
 * A face matches by embedding (its distance to the nearest sighting), or, for a single-frame face, by overlapping a
 * sighting from the first few seconds after `start`, where the poster it was found in comes from.
 */
export const matchExistingFaces = (
  existing: ExistingVideoFace[],
  tracks: FaceTrack[],
  { maxDistance, frame, start }: { maxDistance: number; frame: { width: number; height: number }; start: number },
): Map<number, string> => {
  const pairs: { face: string; track: number; cost: number }[] = [];
  for (const face of existing) {
    for (const [trackIndex, track] of tracks.entries()) {
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

      if (Number.isFinite(cost)) {
        pairs.push({ face: face.id, track: trackIndex, cost });
      }
    }
  }

  const matches = new Map<number, string>();
  const takenFaces = new Set<string>();
  for (const pair of pairs.sort((a, b) => a.cost - b.cost)) {
    if (takenFaces.has(pair.face) || matches.has(pair.track)) {
      continue;
    }
    matches.set(pair.track, pair.face);
    takenFaces.add(pair.face);
  }
  return matches;
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
 * Whether a track is a person worth keeping: large enough to recognise (MIN_FACE), and confident once or consistent
 * across frames (see VIDEO_FACE_LOW_SCORE).
 */
export const acceptTrack = (track: FaceTrack, minScore: number): boolean => {
  const sizes = track.sightings.map(({ box }) => Math.min(box.x2 - box.x1, box.y2 - box.y1));
  if (Math.max(...sizes) < MIN_FACE) {
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
 * Four overlapping quarters of a frame, for tiled detection: the detector shrinks its input to 640 px, so a quarter of
 * a 1080p frame shows each face at about twice the size the whole frame does. Empty for a frame small enough already.
 * The overlap lets a face cut by one quarter's edge appear whole in its neighbour.
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
 * One list of detections from the whole frame and its tiles, boxes in frame pixels. Where two overlap they are the
 * same face found twice, and the more confident one is kept.
 */
export const mergeDetections = <T extends { boundingBox: BoundingBox; score: number }>(detections: T[]): T[] => {
  const kept: T[] = [];
  for (const detection of [...detections].sort((a, b) => b.score - a.score)) {
    if (kept.every((other) => iou(other.boundingBox, detection.boundingBox) <= TILE_MERGE_IOU)) {
      kept.push(detection);
    }
  }
  return kept;
};

/**
 * The region a small video face is cropped from: the face box widened around its centre, by up to 2.5x for a face half
 * of CONTEXT_FACE_SIZE or smaller, so the crop shows head, hair and shoulders instead of an upscaled smudge. A face at
 * CONTEXT_FACE_SIZE or larger is returned unchanged. The box stored on the face is never widened, only the crop.
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
