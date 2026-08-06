import { TonalLevel } from 'src/dtos/editing.dto';
import { BRIGHTNESS_FACTOR, CONTRAST_SLOPE, contrastLinear, SATURATION_FACTOR } from 'src/utils/editor-adjust';
import { describe, expect, it } from 'vitest';

describe('editor-adjust factor tables', () => {
  it('brightness factors match the contract', () => {
    expect(BRIGHTNESS_FACTOR[TonalLevel.StrongDecrease]).toBe(0.7);
    expect(BRIGHTNESS_FACTOR[TonalLevel.SlightIncrease]).toBe(1.08);
    expect(BRIGHTNESS_FACTOR[TonalLevel.StrongIncrease]).toBe(1.32);
  });

  it('saturation factors match the contract', () => {
    expect(SATURATION_FACTOR[TonalLevel.StrongDecrease]).toBe(0.4);
    expect(SATURATION_FACTOR[TonalLevel.StrongIncrease]).toBe(1.55);
  });

  it('contrast slopes match the contract', () => {
    expect(CONTRAST_SLOPE[TonalLevel.SlightIncrease]).toBe(1.1);
    expect(CONTRAST_SLOPE[TonalLevel.StrongDecrease]).toBe(0.74);
  });

  describe('contrastLinear pivots around mid', () => {
    it('8-bit srgb mid=128', () => {
      expect(contrastLinear(TonalLevel.SlightIncrease, 128)).toEqual({ a: 1.1, b: 128 * (1 - 1.1) });
    });
    it('16-bit rgb16 mid=32768', () => {
      expect(contrastLinear(TonalLevel.SlightIncrease, 32_768)).toEqual({ a: 1.1, b: 32_768 * (1 - 1.1) });
    });
    it('a decrease level (a<1) yields b>0', () => {
      const { a, b } = contrastLinear(TonalLevel.ModerateDecrease, 128);
      expect(a).toBeLessThan(1);
      expect(b).toBeGreaterThan(0);
    });
  });
});
