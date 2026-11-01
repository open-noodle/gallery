import { describe, expect, it } from 'vitest';
import {
  type Detection,
  FaceTracker,
  acceptTrack,
  findAgain,
  isSharpenTimeFor,
  matchExistingFaces,
  mergeDetections,
  normalize,
  planSampleTimes,
  planSharpenTimes,
  planTiles,
  sampleIntervalFor,
  sightingQuality,
  trackEmbedding,
  widenSmallFace,
  withSighting,
} from 'src/gallery/utils/video-faces.js';

// Two people far apart in embedding space, and a slightly different view of each.
const alice = normalize([1, 0, 0, 0]);
const aliceTurned = normalize([0.9, 0.3, 0, 0]);
const bob = normalize([0, 0, 1, 0]);

const box = (x1: number, y1 = 100, size = 120) => ({ x1, y1, x2: x1 + size, y2: y1 + size });

const detection = (embedding: number[], at = box(100), quality = 0.5): Detection => ({
  box: at,
  score: 0.9,
  embedding,
  quality,
});

describe('planSampleTimes', () => {
  it('samples every interval, starting half an interval in', () => {
    expect(planSampleTimes({ start: 0, end: 10, interval: 2, maxFrames: 100 })).toEqual([1, 3, 5, 7, 9]);
  });

  it('gives a clip shorter than the interval one frame', () => {
    expect(planSampleTimes({ start: 0, end: 1, interval: 2, maxFrames: 100 })).toEqual([0.5]);
  });

  it('stretches the interval to fit the budget instead of stopping early, so a long video is covered to the end', () => {
    const times = planSampleTimes({ start: 0, end: 3600, interval: 2, maxFrames: 100 });

    expect(times).toHaveLength(100);
    expect(times[0]).toBe(18);
    expect(times.at(-1)).toBe(3582);
  });

  it('samples only inside a trim', () => {
    const times = planSampleTimes({ start: 30, end: 40, interval: 2, maxFrames: 100 });

    expect(times).toEqual([31, 33, 35, 37, 39]);
  });

  it('adds a sample just after a cut, unless an interval sample is already near it', () => {
    const times = planSampleTimes({ start: 0, end: 10, interval: 4, maxFrames: 100, cuts: [2.1, 5.9, 12] });

    // Interval samples at 2 and 6. The cut at 2.1 is beside the sample at 2, the one at 5.9 beside 6, and 12 is
    // past the end.
    expect(times).toEqual([2, 6]);
    // Halfway between the samples at 3 and 9, a cut adds its own.
    expect(planSampleTimes({ start: 0, end: 12, interval: 6, maxFrames: 100, cuts: [5.8] })).toEqual([3, 6, 9]);
  });

  it('keeps cut samples within the budget', () => {
    const cuts = Array.from({ length: 50 }, (_, i) => i + 0.5);
    const times = planSampleTimes({ start: 0, end: 60, interval: 10, maxFrames: 20, cuts });

    expect(times.length).toBeLessThanOrEqual(20);
  });

  it('returns nothing for an empty range', () => {
    expect(planSampleTimes({ start: 5, end: 5, interval: 2, maxFrames: 100 })).toEqual([]);
  });
});

describe('sightingQuality', () => {
  it('prefers a sharper, larger, more confident view', () => {
    const sharp = sightingQuality({ score: 0.9, box: box(0, 0, 150), sharpness: 600 });
    const blurred = sightingQuality({ score: 0.9, box: box(0, 0, 150), sharpness: 20 });
    const small = sightingQuality({ score: 0.9, box: box(0, 0, 30), sharpness: 600 });
    const unsure = sightingQuality({ score: 0.5, box: box(0, 0, 150), sharpness: 600 });

    expect(sharp).toBeGreaterThan(blurred);
    expect(sharp).toBeGreaterThan(small);
    expect(sharp).toBeGreaterThan(unsure);
    expect(sharp).toBeLessThanOrEqual(1);
  });
});

describe('FaceTracker', () => {
  it('follows one person across frames and keeps their best view', () => {
    const tracker = new FaceTracker(0.5);
    tracker.addFrame(1, 0, [detection(alice, box(100), 0.2)]);
    tracker.addFrame(3, 1, [detection(aliceTurned, box(110), 0.8)]);
    tracker.addFrame(5, 2, [detection(alice, box(120), 0.4)]);

    const tracks = tracker.finish();

    expect(tracks).toHaveLength(1);
    expect(tracks[0].sightings.map(({ t }) => t)).toEqual([1, 3, 5]);
    expect(tracks[0].best.t).toBe(3);
  });

  it('never puts two faces of one frame in the same track', () => {
    const tracker = new FaceTracker(0.5);
    tracker.addFrame(1, 0, [detection(alice, box(100)), detection(aliceTurned, box(400))]);

    expect(tracker.finish()).toHaveLength(2);
  });

  it('finds a person who only appears late in the video', () => {
    const tracker = new FaceTracker(0.5);
    tracker.addFrame(1, 0, [detection(alice)]);
    tracker.addFrame(3, 1, [detection(alice)]);
    tracker.addFrame(61, 30, [detection(alice), detection(bob, box(400))]);

    const tracks = tracker.finish();

    expect(tracks).toHaveLength(2);
    expect(tracks.find((track) => track.centroid[2] > 0.9)?.sightings.map(({ t }) => t)).toEqual([61]);
  });

  it('accepts a looser match when the face is where the track just was', () => {
    // 0.55 from alice: too far on appearance alone at 0.5, close enough with the continuity relaxation.
    const drifted = normalize([0.45, 0.893, 0, 0]);

    const continuous = new FaceTracker(0.5);
    continuous.addFrame(1, 0, [detection(alice, box(100))]);
    continuous.addFrame(3, 1, [detection(drifted, box(105))]);
    expect(continuous.finish()).toHaveLength(1);

    const elsewhere = new FaceTracker(0.5);
    elsewhere.addFrame(1, 0, [detection(alice, box(100))]);
    elsewhere.addFrame(3, 1, [detection(drifted, box(900))]);
    expect(elsewhere.finish()).toHaveLength(2);
  });

  it('accepts a looser match for a small face that drifted off its old box', () => {
    // A 12 px face 6 px to the side overlaps its old box by an IoU of 0.18, and is too noisy to match on looks alone.
    const drifted = normalize([0.45, 0.893, 0, 0]);

    const tracker = new FaceTracker(0.5);
    tracker.addFrame(1, 0, [detection(alice, box(50, 60, 12))]);
    tracker.addFrame(2, 1, [detection(drifted, box(44, 64, 11))]);
    expect(tracker.finish()).toHaveLength(1);

    const resized = new FaceTracker(0.5);
    resized.addFrame(1, 0, [detection(alice, box(50, 60, 12))]);
    resized.addFrame(2, 1, [detection(drifted, box(44, 60, 30))]);
    expect(resized.finish()).toHaveLength(2);
  });

  it('merges two tracks of one person seen apart, but not two people seen together', () => {
    // A profile view too far from alice to join her track starts a second one. Later views between the two pull that
    // track's centroid within reach of hers, and since the two were never on screen together they are one person.
    const profile = normalize([0.3, 0.954, 0, 0]);
    const between = normalize([0.6, 0.8, 0, 0]);
    const apart = new FaceTracker(0.5);
    apart.addFrame(1, 0, [detection(alice, box(100))]);
    apart.addFrame(30, 1, [detection(profile, box(900))]);
    apart.addFrame(40, 2, [detection(between, box(900))]);
    apart.addFrame(50, 3, [detection(between, box(900))]);
    expect(apart.finish()).toHaveLength(1);

    const together = new FaceTracker(0.5);
    together.addFrame(1, 0, [detection(alice, box(100)), detection(profile, box(900))]);
    together.addFrame(40, 1, [detection(between, box(900))]);
    together.addFrame(50, 2, [detection(between, box(900))]);
    expect(together.finish()).toHaveLength(2);
  });

  it('reports which frames are somebody’s best view, so the others can be deleted early', () => {
    const tracker = new FaceTracker(0.5);
    tracker.addFrame(1, 0, [detection(alice, box(100), 0.2)]);
    tracker.addFrame(3, 1, [detection(alice, box(100), 0.9)]);
    tracker.addFrame(5, 2, []);

    expect(tracker.bestFrameIndexes()).toEqual(new Set([1]));
  });
});

describe('trackEmbedding', () => {
  it('is the unit-length mean of the best sightings', () => {
    const tracker = new FaceTracker(0.5);
    tracker.addFrame(1, 0, [detection(alice, box(100), 0.9)]);
    tracker.addFrame(3, 1, [detection(aliceTurned, box(100), 0.8)]);
    const [track] = tracker.finish();

    const embedding = trackEmbedding(track);

    expect(Math.hypot(...embedding)).toBeCloseTo(1);
    expect(embedding[0]).toBeGreaterThan(embedding[1]);
  });
});

/** One track per person, each seen once, 20 s apart. */
const tracksOf = (...people: number[][]) => {
  const tracker = new FaceTracker(0.5);
  for (const [index, embedding] of people.entries()) {
    tracker.addFrame(10 + index * 20, index, [detection(embedding, box(100 + index * 500))]);
  }
  return tracker.finish();
};

describe('matchExistingFaces', () => {
  const frame = { width: 1920, height: 1080 };

  it('matches by embedding, one face to one track', () => {
    const tracks = tracksOf(alice, bob);
    const existing = [
      { id: 'face-bob', embedding: bob, hasFrame: true, imageWidth: 1920, imageHeight: 1080, box: box(0) },
      { id: 'face-alice', embedding: aliceTurned, hasFrame: true, imageWidth: 1920, imageHeight: 1080, box: box(0) },
      { id: 'face-alice-2', embedding: alice, hasFrame: true, imageWidth: 1920, imageHeight: 1080, box: box(0) },
    ];

    const matches = matchExistingFaces(existing, tracks, { maxDistance: 0.5, frame, start: 0 });

    expect(matches.get(0)).toBe('face-alice-2');
    expect(matches.get(1)).toBe('face-bob');
    expect(matches.size).toBe(2);
  });

  it('matches an old poster face by position when its embedding is too blurred to match', () => {
    const tracker = new FaceTracker(0.5);
    tracker.addFrame(1, 0, [detection(alice, { x1: 960, y1: 540, x2: 1080, y2: 660 })]);
    const blurred = normalize([0, 1, 0, 0]);
    // Found in a 1440 x 810 poster, at the same place in the picture.
    const existing = [
      {
        id: 'old-face',
        embedding: blurred,
        hasFrame: false,
        imageWidth: 1440,
        imageHeight: 810,
        box: { x1: 720, y1: 405, x2: 810, y2: 495 },
      },
    ];

    expect(matchExistingFaces(existing, tracker.finish(), { maxDistance: 0.5, frame, start: 0 }).get(0)).toBe(
      'old-face',
    );
  });

  it('does not match a poster face by position to someone only seen later', () => {
    const tracker = new FaceTracker(0.5);
    tracker.addFrame(20, 0, [detection(alice, { x1: 960, y1: 540, x2: 1080, y2: 660 })]);
    const existing = [
      {
        id: 'old-face',
        hasFrame: false,
        imageWidth: 1920,
        imageHeight: 1080,
        box: { x1: 960, y1: 540, x2: 1080, y2: 660 },
      },
    ];

    expect(matchExistingFaces(existing, tracker.finish(), { maxDistance: 0.5, frame, start: 0 }).size).toBe(0);
  });
});

describe('sampleIntervalFor', () => {
  it('samples a clip of a minute or less at least once a second', () => {
    expect(sampleIntervalFor(23, 2)).toBe(1);
    expect(sampleIntervalFor(60, 2)).toBe(1);
    expect(sampleIntervalFor(23, 0.5)).toBe(0.5);
  });

  it('keeps the configured interval for longer videos', () => {
    expect(sampleIntervalFor(61, 2)).toBe(2);
  });
});

/** One person's track, one sighting per frame, each with the given score and face size. */
const trackOf = (...sightings: { score: number; size?: number }[]) => {
  const tracker = new FaceTracker(0.5);
  for (const [index, { score, size = 60 }] of sightings.entries()) {
    tracker.addFrame(index, index, [{ ...detection(alice, box(100, 100, size)), score }]);
  }
  return tracker.finish()[0];
};

describe('acceptTrack', () => {
  it('keeps a person confident in at least one frame, as a photo face would be', () => {
    expect(acceptTrack(trackOf({ score: 0.72 }), 0.7)).toBe(true);
  });

  it('keeps a person seen consistently in three or more frames, never confident in one', () => {
    expect(acceptTrack(trackOf({ score: 0.5 }, { score: 0.55 }, { score: 0.47 }), 0.7)).toBe(true);
  });

  it('drops a low-confidence face seen fewer than three times', () => {
    expect(acceptTrack(trackOf({ score: 0.6 }, { score: 0.6 }), 0.7)).toBe(false);
  });

  it('drops a face whose typical score is below the low threshold', () => {
    expect(acceptTrack(trackOf({ score: 0.46 }, { score: 0.4 }, { score: 0.41 }), 0.7)).toBe(false);
  });

  it('drops a consistent face too small to recognise', () => {
    expect(
      acceptTrack(trackOf({ score: 0.6, size: 20 }, { score: 0.6, size: 20 }, { score: 0.6, size: 20 }), 0.7),
    ).toBe(false);
  });

  it('drops a face too small to recognise however confident the detector was', () => {
    expect(acceptTrack(trackOf({ score: 0.73, size: 12 }), 0.7)).toBe(false);
    expect(acceptTrack(trackOf({ score: 0.73, size: 12 }, { score: 0.6, size: 20 }), 0.7)).toBe(true);
  });

  it('never asks more of a consistent face than an admin who lowered the photo threshold', () => {
    expect(acceptTrack(trackOf({ score: 0.42 }, { score: 0.42 }, { score: 0.42 }), 0.4)).toBe(true);
  });
});

/** A one-sighting track for alice at `t`, in a 60 px box at x = 100. */
const trackAt = (t: number) => {
  const tracker = new FaceTracker(0.5);
  tracker.addFrame(t, 0, [detection(alice, box(100, 100, 60))]);
  return tracker.finish()[0];
};

describe('sharper view', () => {
  it('plans four frames around each best sample, shared, inside the span and not already sampled', () => {
    expect(planSharpenTimes([trackAt(1), trackAt(1)], { start: 0, end: 10, sampled: [1, 3] })).toEqual([
      0.5, 0.75, 1.25, 1.5,
    ]);
    expect(planSharpenTimes([trackAt(0.25)], { start: 0, end: 10, sampled: [0.25, 0.5] })).toEqual([0, 0.75]);
    expect(planSharpenTimes([trackAt(9.75)], { start: 0, end: 10, sampled: [] })).toEqual([9.25, 9.5]);
  });

  it('matches an extra frame only to the tracks it was planned for', () => {
    expect(isSharpenTimeFor(1.5, 1)).toBe(true);
    expect(isSharpenTimeFor(0.5, 1)).toBe(true);
    expect(isSharpenTimeFor(1.75, 1)).toBe(false);
  });

  it('finds the same person where they were, never someone else or the same looks elsewhere', () => {
    const track = trackAt(1);
    const near = detection(aliceTurned, box(110, 105, 64));

    expect(findAgain(track, [detection(bob, box(110, 105, 64)), near], 0.5)).toBe(near);
    expect(findAgain(track, [detection(alice, box(900, 100, 60))], 0.5)).toBeUndefined();
    expect(findAgain(track, [detection(bob, box(100, 100, 60))], 0.5)).toBeUndefined();
  });

  it('adds a sighting in time order, as the best view only when it is better', () => {
    const track = trackAt(1);
    const better = { ...detection(alice, box(100), 0.9), t: 0.75, frameIndex: 5 };
    const worse = { ...detection(alice, box(100), 0.1), t: 1.25, frameIndex: 6 };

    expect(withSighting(track, better).best).toBe(better);
    expect(withSighting(track, better).sightings.map(({ t }) => t)).toEqual([0.75, 1]);
    expect(withSighting(track, worse).best).toBe(track.best);
  });
});

describe('planTiles', () => {
  it('splits a 1080p frame into four quarters that overlap', () => {
    const tiles = planTiles({ width: 1920, height: 1080 });

    expect(tiles).toEqual([
      { left: 0, top: 0, width: 1104, height: 621 },
      { left: 816, top: 0, width: 1104, height: 621 },
      { left: 0, top: 459, width: 1104, height: 621 },
      { left: 816, top: 459, width: 1104, height: 621 },
    ]);
    // Neighbours share a band wider than a typical face, so one cut by an edge is whole in the other.
    expect(tiles[0].width - tiles[1].left).toBe(288);
  });

  it('does not tile a frame the detector already sees at full size', () => {
    expect(planTiles({ width: 960, height: 540 })).toEqual([]);
    expect(planTiles({ width: 320, height: 240 })).toEqual([]);
  });
});

describe('mergeDetections', () => {
  it('keeps the more confident of two finds of the same face, and every distinct face', () => {
    const merged = mergeDetections([
      { boundingBox: box(100), score: 0.6 },
      { boundingBox: box(104), score: 0.8 },
      { boundingBox: box(600), score: 0.5 },
    ]);

    expect(merged).toEqual([
      { boundingBox: box(104), score: 0.8 },
      { boundingBox: box(600), score: 0.5 },
    ]);
  });
});

describe('widenSmallFace', () => {
  const frame = { width: 1920, height: 1080 };

  it('crops a tiny face 2.5 times wider, around its centre', () => {
    expect(widenSmallFace({ x1: 500, y1: 300, x2: 526, y2: 330 }, frame)).toEqual({
      x1: 481,
      y1: 278,
      x2: 546,
      y2: 353,
    });
  });

  it('widens less as the face grows, and not at all from 80 px', () => {
    const medium = widenSmallFace({ x1: 500, y1: 300, x2: 560, y2: 360 }, frame);
    expect(medium.x2 - medium.x1).toBe(105);
    expect(widenSmallFace({ x1: 500, y1: 300, x2: 580, y2: 400 }, frame)).toEqual({
      x1: 500,
      y1: 300,
      x2: 580,
      y2: 400,
    });
  });

  it('stays inside the frame', () => {
    expect(widenSmallFace({ x1: 0, y1: 0, x2: 20, y2: 20 }, frame)).toMatchObject({ x1: 0, y1: 0 });
    expect(widenSmallFace({ x1: 1900, y1: 1060, x2: 1920, y2: 1080 }, frame)).toMatchObject({ x2: 1920, y2: 1080 });
  });
});
