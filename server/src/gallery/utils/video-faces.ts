import type { BoundingBox } from 'src/repositories/machine-learning.repository.js';

// Pure parts of video face sampling (specs/2026-10-31-video-face-frames-design.md): which frames to look at, which
// detections are the same person, which view of them is best, and which existing face a new one replaces.

/** Bumped when sampling or tracking changes enough that videos should be rescanned. */
export const VIDEO_FACE_SAMPLER_VERSION = 1;

/** Relaxation of the distance threshold for a detection that overlaps the track's box in the previous sample. */
const CONTINUITY_RELAXATION = 0.1;
const CONTINUITY_IOU = 0.3;

/** Sightings averaged into a face's embedding. */
const EMBEDDING_SIGHTINGS = 3;

/** The recognition model's input side: a face this tall or more counts as full size. */
const FULL_SIZE_FACE = 112;
const SHARPNESS_SCALE = 150;

/** An old single-frame face matches a sighting this early in the video, at this overlap, as the poster comes from there. */
const POSTER_WINDOW_SECONDS = 3;
const POSTER_IOU = 0.5;

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
 * by embedding (its centroid or its latest sighting), with a looser threshold when it overlaps where that track was in
 * the previous sample. Each frame is matched one-to-one, so two faces in one frame are never the same person.
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
        const continuous =
          track.last.frameIndex === frameIndex - 1 && iou(detection.box, track.last.box) > CONTINUITY_IOU;
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

  /** Every track's current best sighting, so a frame that is nobody's best can be deleted early. */
  bestFrameIndexes(): Set<number> {
    return new Set(this.tracks.map((track) => track.best.frameIndex));
  }
}

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
