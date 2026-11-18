import {
  FaceTracker,
  isSameBox,
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

/**
A pet is kept only when at least one of its sightings reaches this detector score. Detection runs at the photo
`minScore` (0.3 by default), and across hundreds of frames that lets through small, unsure boxes: on the owner's library
copy, every pet found in a random sample of 60 videos with no pet on their poster was one (best scores 0.35 to 0.53, 75
to 86 px), and pet recognition matched three of them to named pets. A real pet in a video is seen clearly at least once.
*/
export const VIDEO_PET_CONFIDENT_SCORE = 0.5;

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

/** A sighting that remembers the label the detector gave it in that frame. */
type LabelledSighting = Sighting & { label?: string };

/**
The label most of a track's sightings carry, weighted by score. The detector's label for one animal flips from frame to
frame (a cat called a dog in a third of the frames of a public clip), so a pet's species is a vote, not a frame.
*/
const majorityLabel = (sightings: LabelledSighting[], fallback: string) => {
  const votes = new Map<string, number>();
  for (const { label, score } of sightings) {
    if (label) {
      votes.set(label, (votes.get(label) ?? 0) + score);
    }
  }
  let best = fallback;
  let bestVotes = -1;
  for (const [label, total] of votes) {
    if (!(total > bestVotes)) {
      continue;
    }

    best = label;
    bestVotes = total;
  }
  return best;
};

/**
One frame's detections with the duplicates dropped: boxes where one animal found twice would be (`isSameBox`), whatever
their labels, keep only the most confident. RF-DETR has no non-maximum suppression and puts a second box, sometimes
under the other species, on one animal; left in, the pair reads as two pets seen together and keeps that animal's
tracks from ever merging.
*/
export const dedupePetDetections = <T extends Pick<PetDetection, 'box' | 'score'>>(detections: T[]): T[] => {
  const kept: T[] = [];
  for (const detection of [...detections].sort((a, b) => b.score - a.score)) {
    if (kept.every((other) => !isSameBox(other.box, detection.box))) {
      kept.push(detection);
    }
  }
  return kept;
};

/**
Groups a video's pet detections, frame by frame in time order, after dropping duplicate boxes:

- with an embedding: one FaceTracker for every species together, so an animal whose label flips stays one pet, and two
  pets seen in one frame are two pets. Each pet's species is the label most of its sightings carry;
- without one: one track per species, holding that species' most confident box in each frame. Nothing tells two such
  animals apart, and on photos they all go to the same species person anyway.
*/
export class PetVideoTracker {
  private tracker: FaceTracker;
  private buckets = new Map<string, { sightings: Sighting[]; best: Sighting }>();

  constructor(maxDistance: number, minScore: number) {
    // Detection already ran at minScore, so every sighting counts as a confident view.
    this.tracker = new FaceTracker(maxDistance, minScore);
  }

  addFrame(t: number, frameIndex: number, detections: PetDetection[]): void {
    const embeddable: (Detection & { label: string })[] = [];
    const bucketed = new Map<string, PetDetection>();
    for (const detection of dedupePetDetections(detections)) {
      const { label, embedding } = detection;
      if (embedding) {
        // The label rides along on the sighting the tracker makes from it (the detection is spread into it).
        embeddable.push({ ...detection, embedding, label });
        continue;
      }
      const current = bucketed.get(label);
      if (!current || detection.score > current.score) {
        bucketed.set(label, detection);
      }
    }

    if (embeddable.length > 0) {
      this.tracker.addFrame(t, frameIndex, embeddable);
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
    return this.tracker.peopleSoFar() + this.buckets.size;
  }

  /** Every track's current best sighting, so a frame that is nobody's best can be deleted early. */
  bestFrameIndexes(): Set<number> {
    const indexes = this.tracker.bestFrameIndexes();
    for (const { best } of this.buckets.values()) {
      indexes.add(best.frameIndex);
    }
    return indexes;
  }

  /**
  The pets seen in at least `minSightings` sampled frames and confidently at least once (VIDEO_PET_CONFIDENT_SCORE),
  after merging the tracks seen apart.
  */
  finish(minSightings: number): PetTrack[] {
    const tracks: PetTrack[] = Array.from(this.tracker.finish(), (track) => ({
      label: majorityLabel(track.sightings, 'pet'),
      embeddable: true,
      track,
    }));
    for (const [label, { sightings, best }] of this.buckets) {
      tracks.push({ label, embeddable: false, track: { sightings, best, centroid: [] } });
    }
    return tracks.filter(
      ({ track }) =>
        track.sightings.length >= minSightings &&
        track.sightings.some(({ score }) => score >= VIDEO_PET_CONFIDENT_SCORE),
    );
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

- An embedded face matches an embeddable track as an existing video face does (`matchExistingFaces`: embedding
  distance, or position for an old poster face), whatever species either was given.
- A bucket face of a species gives its id to that species' bucket track: the person is the same either way. The
  first face with a frame is preferred, so a rescan updates the earlier scan's face rather than an old poster face.
*/
export const matchExistingPets = (
  existing: ExistingVideoPet[],
  tracks: PetTrack[],
  options: PetMatchOptions,
): Map<number, string> => {
  const matches = new Map<number, string>();
  // Every species together, as the tracker groups them: a pet's species is a vote that can come out differently from
  // one scan to the next.
  const indexes = tracks
    .keys()
    .filter((index) => tracks[index].embeddable)
    .toArray();
  const embeddedMatches = matchExistingFaces(
    existing.filter((face) => face.embedded),
    indexes.map((index) => tracks[index].track),
    options,
  );
  for (const [position, faceId] of embeddedMatches) {
    matches.set(indexes[position], faceId);
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
