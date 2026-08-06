import { TonalLevel } from 'src/dtos/editing.dto';

export const BRIGHTNESS_FACTOR: Record<TonalLevel, number> = {
  [TonalLevel.StrongDecrease]: 0.7,
  [TonalLevel.ModerateDecrease]: 0.82,
  [TonalLevel.SlightDecrease]: 0.92,
  [TonalLevel.SlightIncrease]: 1.08,
  [TonalLevel.ModerateIncrease]: 1.18,
  [TonalLevel.StrongIncrease]: 1.32,
};

export const SATURATION_FACTOR: Record<TonalLevel, number> = {
  [TonalLevel.StrongDecrease]: 0.4,
  [TonalLevel.ModerateDecrease]: 0.65,
  [TonalLevel.SlightDecrease]: 0.85,
  [TonalLevel.SlightIncrease]: 1.15,
  [TonalLevel.ModerateIncrease]: 1.3,
  [TonalLevel.StrongIncrease]: 1.55,
};

export const CONTRAST_SLOPE: Record<TonalLevel, number> = {
  [TonalLevel.StrongDecrease]: 0.74,
  [TonalLevel.ModerateDecrease]: 0.84,
  [TonalLevel.SlightDecrease]: 0.92,
  [TonalLevel.SlightIncrease]: 1.1,
  [TonalLevel.ModerateIncrease]: 1.22,
  [TonalLevel.StrongIncrease]: 1.4,
};

/** Linear contrast pivoting around mid-gray: output = a*input + b, with a*mid + b = mid. */
export const contrastLinear = (level: TonalLevel, mid: number): { a: number; b: number } => {
  const a = CONTRAST_SLOPE[level];
  return { a, b: mid * (1 - a) };
};
