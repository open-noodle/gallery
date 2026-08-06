import { AssetEditAction, MirrorAxis, TonalLevel } from 'src/dtos/editing.dto';
import { mergeEdits } from 'src/utils/asset-edit';

const adjust = (level: TonalLevel) => ({ action: AssetEditAction.Adjust, parameters: { brightness: level } }) as const;
const mirror = (axis: MirrorAxis) => ({ action: AssetEditAction.Mirror, parameters: { axis } }) as const;
const crop = { action: AssetEditAction.Crop, parameters: { x: 0, y: 0, width: 10, height: 10 } } as const;

describe('mergeEdits', () => {
  it('replaces an existing adjust, keeps a crop', () => {
    const merged = mergeEdits([crop, adjust(TonalLevel.SlightIncrease)], [adjust(TonalLevel.StrongIncrease)]);
    expect(merged.filter((e) => e.action === AssetEditAction.Adjust)).toHaveLength(1);
    expect(merged.find((e) => e.action === AssetEditAction.Adjust)?.parameters).toEqual({
      brightness: TonalLevel.StrongIncrease,
    });
    expect(merged[0].action).toBe(AssetEditAction.Crop); // crop stays first
  });

  it('keeps one mirror per axis (idempotent on same axis), allows both axes', () => {
    const merged = mergeEdits([mirror(MirrorAxis.Horizontal)], [mirror(MirrorAxis.Horizontal)]);
    expect(merged.filter((e) => e.action === AssetEditAction.Mirror)).toHaveLength(1);
    const both = mergeEdits([mirror(MirrorAxis.Horizontal)], [mirror(MirrorAxis.Vertical)]);
    expect(both.filter((e) => e.action === AssetEditAction.Mirror)).toHaveLength(2);
  });

  it('incoming crop replaces existing crop and stays first', () => {
    const merged = mergeEdits(
      [crop, adjust(TonalLevel.SlightIncrease)],
      [{ action: AssetEditAction.Crop, parameters: { x: 1, y: 1, width: 5, height: 5 } }],
    );
    expect(merged.filter((e) => e.action === AssetEditAction.Crop)).toHaveLength(1);
    expect(merged[0].action).toBe(AssetEditAction.Crop);
    expect(merged[0].parameters).toEqual({ x: 1, y: 1, width: 5, height: 5 });
  });

  it('empty existing returns incoming', () => {
    expect(mergeEdits([], [adjust(TonalLevel.SlightIncrease)])).toEqual([adjust(TonalLevel.SlightIncrease)]);
  });
});
