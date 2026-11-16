import {
  FaceTracker,
  matchExistingFaces,
  type Detection,
  type ExistingVideoFace,
  type FaceTrack,
  type Sighting,
} from 'src/gallery/utils/video-faces.js';
import type { BoundingBox } from 'src/repositories/machine-learning.repository.js';

// Pure parts of pet sampling across a video (specs/2026-11-16-video-pet-detection-design.md): which detections are the
// same pet, and which existing pet face a new one replaces. The frame plan, tracker and quality come from video faces.

/**
Bumped when pet sampling or tracking changes enough that videos should be rescanned. Its own series: pet frame rows
are never rewritten by face detection, so they must not be compared with VIDEO_FACE_SAMPLER_VERSION.
*/
export const VIDEO_PET_SAMPLER_VERSION = 1;

export type PetDetection = Omit<Detection, 'embedding'> & {
  label: string;
  /** Unit-length embedding; present only for a species pet recognition identifies, with recognition on. */
  embedding?: number[];
};

/**
One pet in a video. `embeddable` tracks carry pet embeddings and go to pet recognition; the others go to the owner's
species person, as on photos, and have empty embeddings.
*/
export type PetTrack = { label: string; embeddable: boolean; track: FaceTrack };

/**
Groups a video's pet detections, frame by frame in time order:

- with an embedding: one FaceTracker per species, so a dog and a cat are never one pet, and two pets of a species
  seen in one frame are two pets;
- without one: one track per species, holding that species' most confident box in each frame. Nothing tells two such
  animals apart, and on photos they all go to the same species person anyway.
*/
export class PetVideoTracker {
  private trackers = new Map<string, FaceTracker>();
  private buckets = new Map<string, { sightings: Sighting[]; best: Sighting }>();

  constructor(
    private maxDistance: number,
    private minScore: number,
  ) {}

  addFrame(t: number, frameIndex: number, detections: PetDetection[]): void {
    const embeddable = new Map<string, Detection[]>();
    const bucketed = new Map<string, PetDetection>();
    for (const detection of detections) {
      const { label, embedding } = detection;
      if (embedding) {
        const list = embeddable.get(label) ?? [];
        list.push({ ...detection, embedding });
        embeddable.set(label, list);
        continue;
      }
      const current = bucketed.get(label);
      if (!current || detection.score > current.score) {
        bucketed.set(label, detection);
      }
    }

    for (const [label, list] of embeddable) {
      let tracker = this.trackers.get(label);
      if (!tracker) {
        // Detection already ran at minScore, so every sighting counts as a confident view.
        tracker = new FaceTracker(this.maxDistance, this.minScore);
        this.trackers.set(label, tracker);
      }
      tracker.addFrame(t, frameIndex, list);
    }

    for (const [label, { box, score, quality }] of bucketed) {
      const sighting: Sighting = { box, score, quality, embedding: [], t, frameIndex };
      const bucket = this.buckets.get(label);
      if (!bucket) {
        this.buckets.set(label, { sightings: [sighting], best: sighting });
        continue;
      }
      bucket.sightings.push(sighting);
      if (sighting.quality > bucket.best.quality) {
        bucket.best = sighting;
      }
    }
  }

  /** Pets found so far, before the final merge: what progress reports. */
  petsSoFar(): number {
    let count = this.buckets.size;
    for (const tracker of this.trackers.values()) {
      count += tracker.peopleSoFar();
    }
    return count;
  }

  /** Every track's current best sighting, so a frame that is nobody's best can be deleted early. */
  bestFrameIndexes(): Set<number> {
    const indexes = new Set<number>();
    for (const tracker of this.trackers.values()) {
      for (const index of tracker.bestFrameIndexes()) {
        indexes.add(index);
      }
    }
    for (const { best } of this.buckets.values()) {
      indexes.add(best.frameIndex);
    }
    return indexes;
  }

  /** The pets seen in at least `minSightings` sampled frames, after merging each species' tracks seen apart. */
  finish(minSightings: number): PetTrack[] {
    const tracks: PetTrack[] = [];
    for (const [label, tracker] of this.trackers) {
      for (const track of tracker.finish()) {
        tracks.push({ label, embeddable: true, track });
      }
    }
    for (const [label, { sightings, best }] of this.buckets) {
      tracks.push({ label, embeddable: false, track: { sightings, best, centroid: [] } });
    }
    return tracks.filter(({ track }) => track.sightings.length >= minSightings);
  }
}

export type ExistingVideoPet = ExistingVideoFace & {
  /** The species of an embedded face (`pet_search.species`), or of a bucket face's person (`person_pet.species`). */
  species: string | null;
  /** Whether the face has a `pet_search` row: an individual pet rather than a species-bucket face. */
  embedded: boolean;
};

type PetMatchOptions = { maxDistance: number; frame: { width: number; height: number }; start: number };

/**
Pairs this video's existing pet faces with the new tracks, so a rescan keeps face ids and with them pets' names.
Returns, per index into `tracks`, the id of the face it replaces.

- An embedded face matches an embeddable track of its species as an existing video face does (`matchExistingFaces`:
  embedding distance, or position for an old poster face).
- A bucket face of a species gives its id to that species' bucket track: the person is the same either way. The
  first face with a frame is preferred, so a rescan updates the earlier scan's face rather than an old poster face.
*/
export const matchExistingPets = (
  existing: ExistingVideoPet[],
  tracks: PetTrack[],
  options: PetMatchOptions,
): Map<number, string> => {
  const matches = new Map<number, string>();
  const labels = new Set(tracks.map(({ label }) => label));
  for (const label of labels) {
    const indexes = tracks
      .keys()
      .filter((index) => tracks[index].label === label && tracks[index].embeddable)
      .toArray();
    const faces = existing.filter((face) => face.embedded && face.species === label);
    const speciesMatches = matchExistingFaces(
      faces,
      indexes.map((index) => tracks[index].track),
      options,
    );
    for (const [position, faceId] of speciesMatches) {
      matches.set(indexes[position], faceId);
    }
  }

  for (const [index, { label, embeddable }] of tracks.entries()) {
    if (embeddable) {
      continue;
    }
    const candidates = existing.filter((face) => !face.embedded && face.species === label);
    const face = candidates.find(({ hasFrame }) => hasFrame) ?? candidates[0];
    if (face) {
      matches.set(index, face.id);
    }
  }
  return matches;
};

/**
Old pet faces a rescan replaced without matching them: unmatched, with the same person as a face that was matched. For
a bucket that is every other face of the species on this video; for an individual, a face an older scan or the poster
found twice. Deleting one loses nothing: the matched face carries the person. An unmatched face whose person differs is
left alone, as is one without a person, which the caller deletes anyway.
*/
export const absorbedPets = (existing: ExistingVideoPet[], matches: Map<number, string>): Set<string> => {
  const matched = new Set(matches.values());
  const keptPeople = new Set(
    existing.filter((face) => matched.has(face.id) && face.personGroupId).map((face) => face.personGroupId),
  );
  return new Set(
    existing
      .filter((face) => !matched.has(face.id) && face.personGroupId && keptPeople.has(face.personGroupId))
      .map((face) => face.id),
  );
};

/** Rounds a box to whole pixels, as asset_face and the sightings store it. */
export const roundPetBox = ({ x1, y1, x2, y2 }: BoundingBox): BoundingBox => ({
  x1: Math.round(x1),
  y1: Math.round(y1),
  x2: Math.round(x2),
  y2: Math.round(y2),
});
