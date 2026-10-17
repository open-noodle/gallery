import { AssetEditAction, type AssetEditActionItemDto } from '@immich/sdk';
import { mergeRotation, normalizeAngle } from '$lib/gallery/asset-actions';

describe('normalizeAngle', () => {
  it('should return 0 for 0', () => {
    expect(normalizeAngle(0)).toBe(0);
  });

  it('should return 90 for 90', () => {
    expect(normalizeAngle(90)).toBe(90);
  });

  it('should convert -90 to 270', () => {
    expect(normalizeAngle(-90)).toBe(270);
  });

  it('should convert 360 to 0', () => {
    expect(normalizeAngle(360)).toBe(0);
  });

  it('should convert 450 to 90', () => {
    expect(normalizeAngle(450)).toBe(90);
  });

  it('should convert -180 to 180', () => {
    expect(normalizeAngle(-180)).toBe(180);
  });
});

describe('mergeRotation', () => {
  it('should add rotation to empty edits', () => {
    const result = mergeRotation([], 90);
    expect(result).toEqual([{ action: AssetEditAction.Rotate, parameters: { angle: 90 } }]);
  });

  it('should merge rotation with existing rotation', () => {
    const existing: AssetEditActionItemDto[] = [{ action: AssetEditAction.Rotate, parameters: { angle: 90 } }];
    const result = mergeRotation(existing, 90);
    expect(result).toEqual([{ action: AssetEditAction.Rotate, parameters: { angle: 180 } }]);
  });

  it('should remove rotation when merged angle is 0 (full circle)', () => {
    const existing: AssetEditActionItemDto[] = [{ action: AssetEditAction.Rotate, parameters: { angle: 270 } }];
    const result = mergeRotation(existing, 90);
    expect(result).toEqual([]);
  });

  it('should preserve other edit actions when merging', () => {
    const existing: AssetEditActionItemDto[] = [
      { action: AssetEditAction.Crop, parameters: { x: 0, y: 0, width: 100, height: 100 } },
      { action: AssetEditAction.Rotate, parameters: { angle: 90 } },
    ];
    const result = mergeRotation(existing, 90);
    expect(result).toEqual([
      { action: AssetEditAction.Crop, parameters: { x: 0, y: 0, width: 100, height: 100 } },
      { action: AssetEditAction.Rotate, parameters: { angle: 180 } },
    ]);
  });

  it('should preserve other edit actions when rotation cancels out', () => {
    const existing: AssetEditActionItemDto[] = [
      { action: AssetEditAction.Crop, parameters: { x: 0, y: 0, width: 100, height: 100 } },
      { action: AssetEditAction.Rotate, parameters: { angle: 270 } },
    ];
    const result = mergeRotation(existing, 90);
    expect(result).toEqual([{ action: AssetEditAction.Crop, parameters: { x: 0, y: 0, width: 100, height: 100 } }]);
  });

  it('should handle rotate left (270 degrees)', () => {
    const result = mergeRotation([], 270);
    expect(result).toEqual([{ action: AssetEditAction.Rotate, parameters: { angle: 270 } }]);
  });

  it('should handle 180 degree rotation', () => {
    const result = mergeRotation([], 180);
    expect(result).toEqual([{ action: AssetEditAction.Rotate, parameters: { angle: 180 } }]);
  });

  it('should handle multiple successive rotations correctly', () => {
    let edits: AssetEditActionItemDto[] = [];
    edits = mergeRotation(edits, 90); // 90
    edits = mergeRotation(edits, 90); // 180
    edits = mergeRotation(edits, 90); // 270
    expect(edits).toEqual([{ action: AssetEditAction.Rotate, parameters: { angle: 270 } }]);
    edits = mergeRotation(edits, 90); // 360 -> 0 -> removed
    expect(edits).toEqual([]);
  });
});
