import type { TimelineAsset } from '$lib/managers/timeline-manager/types';
import { getEditableAssetsWithWarning } from './editable-assets';

vi.mock('@immich/ui', async (orig) => {
  const actual = await orig<typeof import('@immich/ui')>();
  return {
    ...actual,
    toastManager: { primary: vi.fn(), danger: vi.fn(), warning: vi.fn(), success: vi.fn(), info: vi.fn() },
  };
});

describe('getEditableAssetsWithWarning (#734)', () => {
  const asset = (id: string): TimelineAsset => ({ id }) as unknown as TimelineAsset;

  it('returns the ids that are in editableAssetIds and warns of nothing when all are editable', async () => {
    const { toastManager } = await import('@immich/ui');

    const ids = getEditableAssetsWithWarning([asset('a'), asset('b')], ['a', 'b']);

    expect(ids).toEqual(['a', 'b']);
    expect(toastManager.warning).not.toHaveBeenCalled();
  });

  it('drops non-editable assets and reports the skipped count via a warning toast', async () => {
    const { toastManager } = await import('@immich/ui');

    const ids = getEditableAssetsWithWarning([asset('a'), asset('b'), asset('c')], ['a']);

    expect(ids).toEqual(['a']);
    expect(toastManager.warning).toHaveBeenCalledTimes(1);
  });
});
