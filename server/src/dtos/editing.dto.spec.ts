import { AssetEditAction, AssetEditsCreateDto, TonalLevel } from 'src/dtos/editing.dto';
import { describe, expect, it } from 'vitest';

const parse = (edits: unknown) => AssetEditsCreateDto.schema.safeParse({ edits });

describe('AdjustParameters schema', () => {
  it('accepts a single manual field', () => {
    expect(
      parse([{ action: AssetEditAction.Adjust, parameters: { brightness: TonalLevel.ModerateIncrease } }]).success,
    ).toBe(true);
  });

  it('accepts all three manual fields', () => {
    const params = {
      brightness: TonalLevel.SlightIncrease,
      contrast: TonalLevel.ModerateIncrease,
      saturation: TonalLevel.StrongDecrease,
    };
    expect(parse([{ action: AssetEditAction.Adjust, parameters: params }]).success).toBe(true);
  });

  it('accepts autoEnhance alone', () => {
    expect(parse([{ action: AssetEditAction.Adjust, parameters: { autoEnhance: true } }]).success).toBe(true);
  });

  it('rejects an empty adjust (no fields)', () => {
    expect(parse([{ action: AssetEditAction.Adjust, parameters: {} }]).success).toBe(false);
  });

  it('rejects autoEnhance combined with a manual field', () => {
    expect(
      parse([
        { action: AssetEditAction.Adjust, parameters: { autoEnhance: true, brightness: TonalLevel.SlightIncrease } },
      ]).success,
    ).toBe(false);
  });

  it('rejects an invalid TonalLevel value', () => {
    expect(parse([{ action: AssetEditAction.Adjust, parameters: { brightness: 'mega' } }]).success).toBe(false);
  });

  it('rejects two adjust actions in one edits array (uniqueEditActions)', () => {
    expect(
      parse([
        { action: AssetEditAction.Adjust, parameters: { brightness: TonalLevel.SlightIncrease } },
        { action: AssetEditAction.Adjust, parameters: { contrast: TonalLevel.SlightIncrease } },
      ]).success,
    ).toBe(false);
  });

  it('accepts adjust coexisting with crop and mirror', () => {
    expect(
      parse([
        { action: AssetEditAction.Crop, parameters: { x: 0, y: 0, width: 100, height: 100 } },
        { action: AssetEditAction.Mirror, parameters: { axis: 'horizontal' } },
        { action: AssetEditAction.Adjust, parameters: { brightness: TonalLevel.SlightIncrease } },
      ]).success,
    ).toBe(true);
  });
});
