import { describe, expect, it } from 'vitest';
import { normalize } from 'src/gallery/utils/video-faces.js';
import {
  PetVideoTracker,
  absorbedPets,
  dedupePetDetections,
  matchExistingPets,
  type ExistingVideoPet,
  type PetDetection,
  type PetTrack,
} from 'src/gallery/utils/video-pets.js';

const rex = normalize([1, 0, 0, 0]);
const fido = normalize([0, 0, 1, 0]);
const tom = normalize([0, 1, 0, 0]);

const pet = (label: string, x1: number, options: { embedding?: number[]; score?: number; quality?: number } = {}) =>
  ({
    label,
    box: { x1, y1: 100, x2: x1 + 200, y2: 300 },
    score: options.score ?? 0.8,
    quality: options.quality ?? 0.5,
    embedding: options.embedding,
  }) satisfies PetDetection;

const tracked = (tracker: PetVideoTracker, minSightings = 1) =>
  tracker
    .finish(minSightings)
    .map(({ label, embeddable, track }) => ({ label, embeddable, times: track.sightings.map(({ t }) => t) }));

describe('PetVideoTracker', () => {
  it('follows one dog across frames by its embedding', () => {
    const tracker = new PetVideoTracker(0.55, 0.3);
    tracker.addFrame(1, 0, [pet('dog', 100, { embedding: rex })]);
    tracker.addFrame(3, 1, [pet('dog', 400, { embedding: rex })]);
    tracker.addFrame(5, 2, [pet('dog', 800, { embedding: rex })]);

    expect(tracked(tracker)).toEqual([{ label: 'dog', embeddable: true, times: [1, 3, 5] }]);
  });

  it('keeps two dogs, and a dog and a cat, seen in one frame apart', () => {
    const tracker = new PetVideoTracker(0.55, 0.3);
    tracker.addFrame(1, 0, [pet('dog', 100, { embedding: rex }), pet('dog', 600, { embedding: fido })]);
    // A cat that looks, to the embedding, exactly like Rex is still not Rex while both are in the frame.
    tracker.addFrame(3, 1, [pet('dog', 120, { embedding: rex }), pet('cat', 900, { embedding: rex })]);

    expect(tracked(tracker)).toEqual(
      expect.arrayContaining([
        { label: 'dog', embeddable: true, times: [1, 3] },
        { label: 'dog', embeddable: true, times: [1] },
        { label: 'cat', embeddable: true, times: [3] },
      ]),
    );
    expect(tracked(tracker)).toHaveLength(3);
  });

  it('keeps one animal whose label flips between frames as one pet, labelled by its sightings', () => {
    const tracker = new PetVideoTracker(0.55, 0.3);
    tracker.addFrame(1, 0, [pet('cat', 100, { embedding: tom, score: 0.9 })]);
    tracker.addFrame(3, 1, [pet('dog', 110, { embedding: tom, score: 0.5 })]);
    tracker.addFrame(5, 2, [pet('cat', 120, { embedding: tom, score: 0.8 })]);

    expect(tracked(tracker)).toEqual([{ label: 'cat', embeddable: true, times: [1, 3, 5] }]);
  });

  it('drops a second box on the same animal, whatever its label, keeping the more confident one', () => {
    const tracker = new PetVideoTracker(0.55, 0.3);
    tracker.addFrame(1, 0, [
      pet('cat', 100, { embedding: tom, score: 0.6 }),
      { ...pet('dog', 110, { embedding: fido, score: 0.4 }) },
    ]);
    tracker.addFrame(3, 1, [pet('cat', 100, { embedding: tom, score: 0.7 })]);

    const [only, ...others] = tracker.finish(1);
    expect(others).toEqual([]);
    expect(only).toMatchObject({ label: 'cat', embeddable: true });
    expect(only.track.sightings.map(({ score }) => score)).toEqual([0.6, 0.7]);
  });

  it('drops duplicate boxes of the same species too, so they never keep one pet in two tracks', () => {
    const tracker = new PetVideoTracker(0.55, 0.3);
    tracker.addFrame(1, 0, [
      pet('dog', 100, { embedding: rex, score: 0.9 }),
      pet('dog', 105, { embedding: fido, score: 0.3 }),
    ]);
    tracker.addFrame(3, 1, [pet('dog', 100, { embedding: fido, score: 0.8 })]);

    expect(tracked(tracker)).toHaveLength(2);
    expect(
      dedupePetDetections([pet('dog', 100, { score: 0.9 }), pet('cat', 105, { score: 0.3 }), pet('dog', 900)]),
    ).toEqual([pet('dog', 100, { score: 0.9 }), pet('dog', 900)]);
  });

  it('puts every animal of a species without an embedding in one track, with its most confident box per frame', () => {
    const tracker = new PetVideoTracker(0.55, 0.3);
    tracker.addFrame(1, 0, [pet('bird', 100, { score: 0.4 }), pet('bird', 700, { score: 0.9 })]);
    tracker.addFrame(3, 1, [pet('bird', 300, { score: 0.6 })]);

    const [bird] = tracker.finish(1);
    expect(bird).toMatchObject({ label: 'bird', embeddable: false });
    expect(bird.track.sightings.map(({ t, box }) => [t, box.x1])).toEqual([
      [1, 700],
      [3, 300],
    ]);
  });

  it('takes the best quality sighting as a bucket track best view', () => {
    const tracker = new PetVideoTracker(0.55, 0.3);
    tracker.addFrame(1, 0, [pet('horse', 100, { quality: 0.2 })]);
    tracker.addFrame(3, 1, [pet('horse', 100, { quality: 0.7 })]);
    tracker.addFrame(5, 2, [pet('horse', 100, { quality: 0.4 })]);

    expect(tracker.finish(1)[0].track.best.t).toBe(3);
    expect(tracker.bestFrameIndexes()).toEqual(new Set([1]));
  });

  it('separates embeddable dogs from embedding-less animals of other species in the same frame', () => {
    const tracker = new PetVideoTracker(0.55, 0.3);
    tracker.addFrame(1, 0, [pet('dog', 100, { embedding: rex }), pet('bird', 500)]);

    expect(tracked(tracker)).toEqual(
      expect.arrayContaining([
        { label: 'dog', embeddable: true, times: [1] },
        { label: 'bird', embeddable: false, times: [1] },
      ]),
    );
    expect(tracker.petsSoFar()).toBe(2);
  });

  it('drops a pet never seen at a confident score, however often it was seen', () => {
    const tracker = new PetVideoTracker(0.55, 0.3);
    for (const [index, t] of [1, 3, 5, 7].entries()) {
      tracker.addFrame(t, index, [
        pet('dog', 100, { embedding: rex, score: 0.45 }),
        pet('cat', 900, { embedding: tom, score: index === 2 ? 0.5 : 0.35 }),
      ]);
    }

    expect(tracked(tracker)).toEqual([{ label: 'cat', embeddable: true, times: [1, 3, 5, 7] }]);
  });

  it('drops pets seen in fewer than minSightings frames', () => {
    const tracker = new PetVideoTracker(0.55, 0.3);
    tracker.addFrame(1, 0, [pet('dog', 100, { embedding: rex }), pet('cat', 600, { embedding: tom })]);
    tracker.addFrame(3, 1, [pet('dog', 100, { embedding: rex })]);

    expect(tracked(tracker, 2)).toEqual([{ label: 'dog', embeddable: true, times: [1, 3] }]);
  });
});

const existing = (overrides: Partial<ExistingVideoPet>): ExistingVideoPet => ({
  id: 'face',
  embedding: undefined,
  hasFrame: true,
  imageWidth: 1920,
  imageHeight: 1080,
  box: { x1: 0, y1: 0, x2: 10, y2: 10 },
  personGroupId: null,
  species: 'dog',
  embedded: true,
  ...overrides,
});

const trackOf = (label: string, embeddable: boolean, embedding: number[] = []): PetTrack => {
  const sighting = {
    box: { x1: 100, y1: 100, x2: 300, y2: 300 },
    score: 0.8,
    quality: 0.5,
    embedding,
    t: 10,
    frameIndex: 0,
  };
  return { label, embeddable, track: { sightings: [sighting], best: sighting, centroid: embedding } };
};

const matchOptions = { maxDistance: 0.55, frame: { width: 1920, height: 1080 }, start: 0 };

describe('matchExistingPets', () => {
  it('keeps the id of an individual pet whose embedding matches a track of its species', () => {
    const faces = [existing({ id: 'rex-face', embedding: rex, personGroupId: 'rex' })];
    const matches = matchExistingPets(faces, [trackOf('dog', true, fido), trackOf('dog', true, rex)], matchOptions);

    expect(matches).toEqual(new Map([[1, 'rex-face']]));
  });

  it('matches an individual face to a track whatever species either was given, as the species is a vote', () => {
    const faces = [existing({ id: 'rex-face', embedding: rex, species: 'dog' })];

    expect(matchExistingPets(faces, [trackOf('cat', true, rex)], matchOptions)).toEqual(new Map([[0, 'rex-face']]));
  });

  it('gives a species bucket track the id of an earlier sampled bucket face before a poster one', () => {
    const faces = [
      existing({ id: 'poster-bird', embedded: false, species: 'bird', hasFrame: false, personGroupId: 'birds' }),
      existing({ id: 'sampled-bird', embedded: false, species: 'bird', hasFrame: true, personGroupId: 'birds' }),
    ];

    expect(matchExistingPets(faces, [trackOf('bird', false)], matchOptions)).toEqual(new Map([[0, 'sampled-bird']]));
  });

  it('does not give a bucket track an individual face, or an individual track a bucket face', () => {
    const faces = [
      existing({ id: 'rex-face', embedding: rex, species: 'dog', embedded: true }),
      existing({ id: 'dog-bucket', species: 'dog', embedded: false, personGroupId: 'dogs' }),
    ];
    const matches = matchExistingPets(faces, [trackOf('dog', false), trackOf('dog', true, rex)], matchOptions);

    expect(matches).toEqual(
      new Map([
        [0, 'dog-bucket'],
        [1, 'rex-face'],
      ]),
    );
  });
});

describe('absorbedPets', () => {
  it('absorbs the other faces of a matched face person, and leaves other people and unassigned faces alone', () => {
    const faces = [
      existing({ id: 'kept', personGroupId: 'birds' }),
      existing({ id: 'same-person', personGroupId: 'birds' }),
      existing({ id: 'other-person', personGroupId: 'rex' }),
      existing({ id: 'nobody' }),
    ];

    expect(absorbedPets(faces, new Map([[0, 'kept']]))).toEqual(new Set(['same-person']));
  });
});
