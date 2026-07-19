import {
  SharedSpaceAssetAddDto,
  SharedSpaceAssetRemoveDto,
  SharedSpaceLibraryParamDto,
  SharedSpaceMemberParamDto,
  SharedSpacePersonFaceParamDto,
  SharedSpacePersonParamDto,
} from 'src/dtos/shared-space.dto';

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

  it('should accept 10,001 asset IDs (above the old cap, below the new one)', () => {
    const result = SharedSpaceAssetAddDto.schema.safeParse({ assetIds: makeUUIDs(10_001) });
    expect(result.success).toBe(true);
  });

  it('should accept exactly 50,000 asset IDs', () => {
    const result = SharedSpaceAssetAddDto.schema.safeParse({ assetIds: makeUUIDs(50_000) });
    expect(result.success).toBe(true);
  });

  it('should reject 50,001 asset IDs', () => {
    const result = SharedSpaceAssetAddDto.schema.safeParse({ assetIds: makeUUIDs(50_001) });
    expect(result.success).toBe(false);
  });
});

describe('SharedSpaceAssetRemoveDto', () => {
  it('should accept exactly 50,000 asset IDs', () => {
    const result = SharedSpaceAssetRemoveDto.schema.safeParse({ assetIds: makeUUIDs(50_000) });
    expect(result.success).toBe(true);
  });

  it('should reject 50,001 asset IDs', () => {
    const result = SharedSpaceAssetRemoveDto.schema.safeParse({ assetIds: makeUUIDs(50_001) });
    expect(result.success).toBe(false);
  });
});

describe('shared-space param DTOs (security-9)', () => {
  const uuid = '11111111-1111-4111-8111-111111111111';

  it('SharedSpaceMemberParamDto rejects a non-UUID userId', () => {
    expect(SharedSpaceMemberParamDto.schema.safeParse({ id: uuid, userId: 'not-a-uuid' }).success).toBe(false);
    expect(SharedSpaceMemberParamDto.schema.safeParse({ id: uuid, userId: uuid }).success).toBe(true);
  });

  it('SharedSpacePersonParamDto rejects a non-UUID personId', () => {
    expect(SharedSpacePersonParamDto.schema.safeParse({ id: uuid, personId: 'nope' }).success).toBe(false);
    expect(SharedSpacePersonParamDto.schema.safeParse({ id: uuid, personId: uuid }).success).toBe(true);
  });

  it('SharedSpacePersonFaceParamDto rejects a non-UUID faceId', () => {
    expect(SharedSpacePersonFaceParamDto.schema.safeParse({ id: uuid, personId: uuid, faceId: 'nope' }).success).toBe(
      false,
    );
    expect(SharedSpacePersonFaceParamDto.schema.safeParse({ id: uuid, personId: uuid, faceId: uuid }).success).toBe(
      true,
    );
  });

  it('SharedSpaceLibraryParamDto rejects a non-UUID libraryId', () => {
    expect(SharedSpaceLibraryParamDto.schema.safeParse({ id: uuid, libraryId: 'nope' }).success).toBe(false);
    expect(SharedSpaceLibraryParamDto.schema.safeParse({ id: uuid, libraryId: uuid }).success).toBe(true);
  });
});
