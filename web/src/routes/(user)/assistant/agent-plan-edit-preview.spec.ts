import { describe, expect, it, vi } from 'vitest';
import { editActionsForOperation, fetchEditPreview } from './agent-plan-edit-preview';

vi.mock('@immich/sdk', () => ({
  getBaseUrl: vi.fn(() => 'http://localhost'),
}));

describe('editActionsForOperation', () => {
  it('maps asset.adjust to an adjust edit action', () => {
    expect(
      editActionsForOperation('asset.adjust', { brightness: 'moderate_increase', contrast: 'slight_increase' }),
    ).toEqual([{ action: 'adjust', parameters: { brightness: 'moderate_increase', contrast: 'slight_increase' } }]);
  });

  it('maps asset.adjust autoEnhance', () => {
    expect(editActionsForOperation('asset.adjust', { autoEnhance: true })).toEqual([
      { action: 'adjust', parameters: { autoEnhance: true } },
    ]);
  });

  it('maps asset.flip to a mirror edit action', () => {
    expect(editActionsForOperation('asset.flip', { axis: 'horizontal' })).toEqual([
      { action: 'mirror', parameters: { axis: 'horizontal' } },
    ]);
  });

  it('returns null for a non-edit operation', () => {
    expect(editActionsForOperation('album.addAssets', {})).toBeNull();
  });

  it('returns null for an unknown operation', () => {
    expect(editActionsForOperation('asset.trash', { force: false })).toBeNull();
  });

  it('returns null for undefined payload', () => {
    expect(editActionsForOperation('asset.adjust', undefined)).toBeNull();
  });
});

describe('fetchEditPreview', () => {
  it('posts edits and returns an object URL on 200', async () => {
    const blob = new Blob(['img'], { type: 'image/jpeg' });
    const fetchSpy = vi.fn().mockResolvedValue({ ok: true, blob: () => Promise.resolve(blob) });
    vi.stubGlobal('fetch', fetchSpy);
    vi.stubGlobal('URL', { ...URL, createObjectURL: vi.fn(() => 'blob:abc') });

    const url = await fetchEditPreview('asset-1', [
      { action: 'adjust', parameters: { brightness: 'moderate_increase' } },
    ]);

    expect(url).toBe('blob:abc');
    expect(fetchSpy).toHaveBeenCalledWith(
      expect.stringContaining('/assets/asset-1/edits/preview?size=thumbnail'),
      expect.objectContaining({ method: 'POST', credentials: 'include' }),
    );

    vi.unstubAllGlobals();
  });

  it('throws when the response is not ok', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 400 }));

    await expect(
      fetchEditPreview('asset-1', [{ action: 'adjust', parameters: { autoEnhance: true } }]),
    ).rejects.toThrow();

    vi.unstubAllGlobals();
  });

  it('passes the abort signal to fetch', async () => {
    const blob = new Blob(['img'], { type: 'image/jpeg' });
    const fetchSpy = vi.fn().mockResolvedValue({ ok: true, blob: () => Promise.resolve(blob) });
    vi.stubGlobal('fetch', fetchSpy);
    vi.stubGlobal('URL', { ...URL, createObjectURL: vi.fn(() => 'blob:xyz') });

    const ac = new AbortController();
    await fetchEditPreview('asset-2', [{ action: 'mirror', parameters: { axis: 'horizontal' } }], ac.signal);

    expect(fetchSpy).toHaveBeenCalledWith(expect.any(String), expect.objectContaining({ signal: ac.signal }));

    vi.unstubAllGlobals();
  });
});
