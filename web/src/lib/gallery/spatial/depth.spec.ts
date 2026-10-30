import { contain, depthFromRgba, dilate, stepSpring, subjectDepth } from '$lib/gallery/spatial/depth';

describe('depthFromRgba', () => {
  it('keeps the red channel of each pixel', () => {
    expect(depthFromRgba(new Uint8ClampedArray([10, 0, 0, 255, 200, 1, 2, 255]))).toEqual(new Uint8Array([10, 200]));
  });
});

describe('subjectDepth', () => {
  it('is the mean depth of the nearer group', () => {
    // a near subject (230/250) on a far background (20)
    const depth = new Uint8Array([20, 20, 20, 20, 20, 20, 230, 250]);
    expect(subjectDepth(depth)).toBeCloseTo(240 / 255, 5);
  });

  it('falls back to the overall mean for a flat map', () => {
    expect(subjectDepth(new Uint8Array([100, 100, 100]))).toBeCloseTo(100 / 255, 5);
  });
});

describe('dilate', () => {
  it('grows near pixels by the radius in both directions', () => {
    const depth = new Uint8Array(25);
    depth[12] = 255; // the centre of a 5×5 map
    const out = dilate(depth, 5, 5, 1);
    const grown = [...out.keys()].filter((i) => out[i] === 255);
    expect(grown).toEqual([6, 7, 8, 11, 12, 13, 16, 17, 18]);
  });

  it('returns the map untouched for radius 0', () => {
    const depth = new Uint8Array([1, 2, 3]);
    expect(dilate(depth, 3, 1, 0)).toBe(depth);
  });
});

describe('contain', () => {
  it('fits a landscape image in a portrait box', () => {
    expect(contain(4000, 3000, 400, 800)).toEqual({ width: 400, height: 300 });
  });

  it('fits a portrait image in a landscape box', () => {
    expect(contain(3000, 4000, 1200, 800)).toEqual({ width: 600, height: 800 });
  });
});

describe('stepSpring', () => {
  it('settles on the target', () => {
    const state = { position: 0, velocity: 0 };
    for (let i = 0; i < 300; i++) {
      stepSpring(state, 1, 1 / 60);
    }
    expect(state.position).toBeCloseTo(1, 3);
  });
});
