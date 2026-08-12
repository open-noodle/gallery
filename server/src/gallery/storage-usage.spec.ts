import { getDerivativeAssetId } from 'src/gallery/storage-usage';

describe('getDerivativeAssetId', () => {
  const id = '0f9b1e2c-4a5d-4c8e-9f10-2b3c4d5e6f70';

  it('should extract the asset id from a preview filename', () => {
    expect(getDerivativeAssetId(`${id}_preview.webp`)).toBe(id);
  });

  it('should extract the asset id from an edited thumbnail filename', () => {
    expect(getDerivativeAssetId(`${id}_thumbnail_edited.webp`)).toBe(id);
  });

  it('should extract the asset id from a transcode filename', () => {
    expect(getDerivativeAssetId(`${id}.mp4`)).toBe(id);
  });

  it('should lowercase the extracted id from an uppercase filename', () => {
    // getExternalAssetIds compares against Postgres-lowercased uuids, so the extraction
    // must normalise casing rather than preserve the filename's own casing.
    expect(getDerivativeAssetId(`${id.toUpperCase()}.mp4`)).toBe(id);
  });

  it('should return null for a filename that is not asset derived', () => {
    expect(getDerivativeAssetId('not-a-uuid.webp')).toBeNull();
    expect(getDerivativeAssetId('segment-00001.ts')).toBeNull();
  });

  it('should return null for a filename shorter than a uuid', () => {
    expect(getDerivativeAssetId('short.webp')).toBeNull();
    expect(getDerivativeAssetId('')).toBeNull();
  });

  it('should return null when the uuid is not followed by a known separator', () => {
    expect(getDerivativeAssetId(`${id}extra.webp`)).toBeNull();
  });

  it('should return null for an Android motion sidecar', () => {
    // StorageCore.getAndroidMotionPath creates ${uuid}-MP.mp4 where uuid is fresh, not the asset id
    expect(getDerivativeAssetId(`${id}-MP.mp4`)).toBeNull();
  });
});
