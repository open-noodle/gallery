import {
  PersonFaceSuggestionPageQueryDto,
  PersonFaceSuggestionPageResponseDto,
  PersonFaceSuggestionParamsDto,
} from 'src/dtos/person.dto';
import { SpacePersonFaceSuggestionParamsDto, SpacePersonParamsDto } from 'src/dtos/shared-space-person.dto';
import { describe, expect, it } from 'vitest';

describe('PersonFaceSuggestion DTOs', () => {
  it('query schema coerces and defaults page/size', () => {
    expect(PersonFaceSuggestionPageQueryDto.schema.parse({})).toEqual({ page: 1, size: 50 });
    expect(PersonFaceSuggestionPageQueryDto.schema.parse({ page: '2', size: '10' })).toEqual({ page: 2, size: 10 });
  });

  it('query schema rejects size > 100 and page < 1', () => {
    expect(() => PersonFaceSuggestionPageQueryDto.schema.parse({ size: 101 })).toThrow();
    expect(() => PersonFaceSuggestionPageQueryDto.schema.parse({ page: 0 })).toThrow();
  });

  it('params schema requires two uuids', () => {
    expect(() => PersonFaceSuggestionParamsDto.schema.parse({ id: 'not-a-uuid', assetFaceId: 'x' })).toThrow();
    const ok = PersonFaceSuggestionParamsDto.schema.parse({
      id: '00000000-0000-4000-8000-000000000001',
      assetFaceId: '00000000-0000-4000-8000-000000000002',
    });
    expect(ok.assetFaceId).toBe('00000000-0000-4000-8000-000000000002');
  });

  it('page response schema accepts a fully-populated item', () => {
    const parsed = PersonFaceSuggestionPageResponseDto.schema.parse({
      total: 1,
      items: [
        {
          assetFaceId: '00000000-0000-4000-8000-000000000003',
          assetId: '00000000-0000-4000-8000-000000000004',
          distance: 0.62,
          imageWidth: 4000,
          imageHeight: 3000,
          boundingBoxX1: 10,
          boundingBoxX2: 110,
          boundingBoxY1: 20,
          boundingBoxY2: 140,
          fileCreatedAt: '2026-01-01T00:00:00.000Z',
        },
      ],
    });
    expect(parsed.total).toBe(1);
    expect(parsed.items[0].distance).toBe(0.62);
  });

  it('space person params schema requires space and person uuids', () => {
    expect(() => SpacePersonParamsDto.schema.parse({ id: 'not-a-uuid', personId: 'x' })).toThrow();
    expect(SpacePersonParamsDto.schema.shape.id.description).toBe('Shared space ID');
    expect(SpacePersonParamsDto.schema.shape.personId.description).toBe('Space person ID');
    const ok = SpacePersonParamsDto.schema.parse({
      id: '00000000-0000-4000-8000-000000000005',
      personId: '00000000-0000-4000-8000-000000000006',
    });
    expect(ok).toEqual({
      id: '00000000-0000-4000-8000-000000000005',
      personId: '00000000-0000-4000-8000-000000000006',
    });
  });

  it('space person face suggestion params schema requires space, person, and face uuids', () => {
    expect(SpacePersonFaceSuggestionParamsDto.schema.shape.assetFaceId.description).toBe(
      'Unassigned asset face ID being reviewed',
    );
    const invalidFace = SpacePersonFaceSuggestionParamsDto.schema.safeParse({
      id: '00000000-0000-4000-8000-000000000007',
      personId: '00000000-0000-4000-8000-000000000008',
      assetFaceId: 'x',
    });
    expect(invalidFace.success).toBe(false);
    expect(invalidFace.error?.issues.map((issue) => issue.path)).toContainEqual(['assetFaceId']);
    const ok = SpacePersonFaceSuggestionParamsDto.schema.parse({
      id: '00000000-0000-4000-8000-000000000007',
      personId: '00000000-0000-4000-8000-000000000008',
      assetFaceId: '00000000-0000-4000-8000-000000000009',
    });
    expect(ok.assetFaceId).toBe('00000000-0000-4000-8000-000000000009');
  });
});
