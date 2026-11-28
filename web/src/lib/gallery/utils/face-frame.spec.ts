import { frameAroundFace } from '#lib/gallery/utils/face-frame.ts';
import { describe, expect, it } from 'vitest';

describe('frameAroundFace', () => {
  it('leaves 6px between a face and the ring on every side', () => {
    expect(frameAroundFace({ left: 40, top: 70, width: 120, height: 60 })).toEqual({
      left: 34,
      top: 64,
      width: 132,
      height: 72,
    });
  });

  it('gives a tiny face a 40px window centred on it, so the ring clears it', () => {
    // A 10x8px face centred on (105, 204).
    expect(frameAroundFace({ left: 100, top: 200, width: 10, height: 8 })).toEqual({
      left: 85,
      top: 184,
      width: 40,
      height: 40,
    });
  });

  it('applies the minimum to each axis on its own', () => {
    expect(frameAroundFace({ left: 0, top: 0, width: 100, height: 4 })).toEqual({
      left: -6,
      top: -18,
      width: 112,
      height: 40,
    });
  });
});
