import { SharedSpaceAssetAddDto, SharedSpaceAssetRemoveDto } from 'src/dtos/shared-space.dto';

// Generates valid v4 UUIDs by varying the last 12 hex chars
const makeUUIDs = (count: number) =>
  Array.from({ length: count }, (_, i) => {
    const hex = i.toString(16).padStart(12, '0');
    return `3fe388e4-2078-44d7-b36c-${hex}`;
  });

describe('SharedSpaceAssetAddDto', () => {
  it('should accept an empty array', () => {
    const result = SharedSpaceAssetAddDto.schema.safeParse({ assetIds: [] });
    expect(result.success).toBe(true);
  });

  it('should accept a single asset ID', () => {
    const result = SharedSpaceAssetAddDto.schema.safeParse({ assetIds: makeUUIDs(1) });
    expect(result.success).toBe(true);
  });

  it('should accept 9,999 asset IDs', () => {
    const result = SharedSpaceAssetAddDto.schema.safeParse({ assetIds: makeUUIDs(9999) });
    expect(result.success).toBe(true);
  });

  it('should accept exactly 10,000 asset IDs', () => {
    const result = SharedSpaceAssetAddDto.schema.safeParse({ assetIds: makeUUIDs(10_000) });
    expect(result.success).toBe(true);
  });

  it('should reject 10,001 asset IDs', () => {
    const result = SharedSpaceAssetAddDto.schema.safeParse({ assetIds: makeUUIDs(10_001) });
    expect(result.success).toBe(false);
  });
});

describe('SharedSpaceAssetRemoveDto', () => {
  it('should accept exactly 10,000 asset IDs', () => {
    const result = SharedSpaceAssetRemoveDto.schema.safeParse({ assetIds: makeUUIDs(10_000) });
    expect(result.success).toBe(true);
  });

  it('should reject 10,001 asset IDs', () => {
    const result = SharedSpaceAssetRemoveDto.schema.safeParse({ assetIds: makeUUIDs(10_001) });
    expect(result.success).toBe(false);
  });
});
