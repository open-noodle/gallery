import { FilteredMapMarkerDto } from 'src/dtos/gallery-map.dto';

function parse(plain: Record<string, unknown>) {
  return FilteredMapMarkerDto.schema.safeParse(plain);
}

describe('FilteredMapMarkerDto', () => {
  describe('personIds', () => {
    it('should normalize a single string to an array', () => {
      const result = parse({ personIds: '7e57d004-2b97-4e7a-b45f-5387367791cd' });
      expect(result.success).toBe(true);
      expect(result.data?.personIds).toEqual(['7e57d004-2b97-4e7a-b45f-5387367791cd']);
    });

    it('should keep an array as-is', () => {
      const ids = ['7e57d004-2b97-4e7a-b45f-5387367791cd', '8e57d004-2b97-4e7a-b45f-5387367791cd'];
      const result = parse({ personIds: ids });
      expect(result.success).toBe(true);
      expect(result.data?.personIds).toEqual(ids);
    });

    it('should accept scoped shared-space person tokens', () => {
      const result = parse({ personIds: 'space-person:7e57d004-2b97-4e7a-b45f-5387367791cd' });

      expect(result.success).toBe(true);
      expect(result.data?.personIds).toEqual(['space-person:7e57d004-2b97-4e7a-b45f-5387367791cd']);
    });

    it('should leave undefined when not provided and pass validation', () => {
      const result = parse({});
      expect(result.success).toBe(true);
      expect(result.data?.personIds).toBeUndefined();
    });
  });

  describe('tagIds', () => {
    it('should normalize a single string to an array', () => {
      const result = parse({ tagIds: '7e57d004-2b97-4e7a-b45f-5387367791cd' });
      expect(result.success).toBe(true);
      expect(result.data?.tagIds).toEqual(['7e57d004-2b97-4e7a-b45f-5387367791cd']);
    });

    it('should leave undefined when not provided and pass validation', () => {
      const result = parse({});
      expect(result.success).toBe(true);
      expect(result.data?.tagIds).toBeUndefined();
    });
  });

  describe('rating', () => {
    it('should coerce string to number', () => {
      const result = parse({ rating: '3' });
      expect(result.success).toBe(true);
      expect(result.data?.rating).toBe(3);
      expect(typeof result.data?.rating).toBe('number');
    });

    it('should reject rating outside range', () => {
      const result = parse({ rating: '6' });
      expect(result.success).toBe(false);
    });

    it('should leave undefined when not provided', () => {
      const result = parse({});
      expect(result.success).toBe(true);
      expect(result.data?.rating).toBeUndefined();
    });
  });

  describe('city and country', () => {
    it('should accept city and country strings', () => {
      const result = parse({ city: 'Paris', country: 'France' });
      expect(result.success).toBe(true);
      expect(result.data?.city).toBe('Paris');
      expect(result.data?.country).toBe('France');
    });

    it('should leave undefined when not provided', () => {
      const result = parse({});
      expect(result.success).toBe(true);
      expect(result.data?.city).toBeUndefined();
      expect(result.data?.country).toBeUndefined();
    });
  });

  describe('isNotInAlbum', () => {
    it('should coerce true string to boolean', () => {
      const result = parse({ isNotInAlbum: 'true' });

      expect(result.success).toBe(true);
      expect(result.data?.isNotInAlbum).toBe(true);
    });

    it('should coerce false string to boolean', () => {
      const result = parse({ isNotInAlbum: 'false' });

      expect(result.success).toBe(true);
      expect(result.data?.isNotInAlbum).toBe(false);
    });

    it('should leave undefined when not provided', () => {
      const result = parse({});

      expect(result.success).toBe(true);
      expect(result.data?.isNotInAlbum).toBeUndefined();
    });
  });

  describe('isInAlbum', () => {
    it('should coerce true string to boolean', () => {
      const result = parse({ isInAlbum: 'true' });

      expect(result.success).toBe(true);
      expect(result.data?.isInAlbum).toBe(true);
    });

    it('should coerce false string to boolean', () => {
      const result = parse({ isInAlbum: 'false' });

      expect(result.success).toBe(true);
      expect(result.data?.isInAlbum).toBe(false);
    });

    it('should leave undefined when not provided', () => {
      const result = parse({});

      expect(result.success).toBe(true);
      expect(result.data?.isInAlbum).toBeUndefined();
    });
  });

  // #802 — the Map filter panel now renders the "Text" section, so the marker endpoint has to
  // accept the same three predicates the map timeline (TimeBucketDto) already accepts.
  describe.each(['description', 'originalFileName', 'ocr'] as const)('%s', (field) => {
    it('should accept a plain string', () => {
      const result = parse({ [field]: 'birthday cake' });

      expect(result.success).toBe(true);
      expect(result.data?.[field]).toBe('birthday cake');
    });

    it('should accept a string containing regex and wildcard characters verbatim', () => {
      const result = parse({ [field]: '100% off (2024) [draft].jpg' });

      expect(result.success).toBe(true);
      expect(result.data?.[field]).toBe('100% off (2024) [draft].jpg');
    });

    it('should accept an empty string', () => {
      const result = parse({ [field]: '' });

      expect(result.success).toBe(true);
      expect(result.data?.[field]).toBe('');
    });

    it('should leave undefined when not provided', () => {
      const result = parse({});

      expect(result.success).toBe(true);
      expect(result.data?.[field]).toBeUndefined();
    });

    it('should reject a non-string value', () => {
      const result = parse({ [field]: 42 });

      expect(result.success).toBe(false);
    });

    // The three free-text ILIKE filters are bounded server-side to mirror the web clamp
    // (TEXT_FILTER_MAX_CODE_POINTS = 200), so a direct API caller cannot push a multi-kilobyte
    // pattern into the query. The bound counts CODE POINTS, not UTF-16 units.
    it.each(['description', 'originalFileName', 'ocr'])('accepts %s at exactly 200 code points', (field) => {
      const result = parse({ [field]: 'a'.repeat(200) });
      expect(result.success).toBe(true);
    });

    it.each(['description', 'originalFileName', 'ocr'])('rejects %s longer than 200 code points', (field) => {
      const result = parse({ [field]: 'a'.repeat(201) });
      expect(result.success).toBe(false);
    });

    it('bounds by code points, so 200 astral characters (400 UTF-16 units) still pass', () => {
      // A value the web already clamped to 200 code points must never be rejected by the server.
      expect(parse({ description: '😀'.repeat(200) }).success).toBe(true);
      expect(parse({ description: '😀'.repeat(201) }).success).toBe(false);
    });
  });

  // The new contributor/album/lens/state facets this feature wired onto the map endpoint. Their
  // presence + type rules had no DTO-level test — only indirect e2e coverage.
  describe('ownerId, albumId, lensModel, state', () => {
    const uuid = '7e57d004-2b97-4e7a-b45f-5387367791cd';

    it('accepts a valid ownerId and albumId', () => {
      const result = parse({ ownerId: uuid, albumId: uuid });
      expect(result.success).toBe(true);
      expect(result.data?.ownerId).toBe(uuid);
      expect(result.data?.albumId).toBe(uuid);
    });

    it('rejects a non-uuid ownerId (a scoped token or arbitrary string must not reach SQL)', () => {
      expect(parse({ ownerId: 'not-a-uuid' }).success).toBe(false);
      expect(parse({ ownerId: `space-person:${uuid}` }).success).toBe(false);
    });

    it('rejects a non-uuid albumId', () => {
      expect(parse({ albumId: 'not-a-uuid' }).success).toBe(false);
    });

    it('accepts lensModel and state strings, and leaves all four undefined when absent', () => {
      const present = parse({ lensModel: 'RF24-70mm', state: 'Bavaria' });
      expect(present.success).toBe(true);
      expect(present.data?.lensModel).toBe('RF24-70mm');
      expect(present.data?.state).toBe('Bavaria');

      const absent = parse({});
      expect(absent.success).toBe(true);
      expect(absent.data?.ownerId).toBeUndefined();
      expect(absent.data?.albumId).toBeUndefined();
      expect(absent.data?.lensModel).toBeUndefined();
      expect(absent.data?.state).toBeUndefined();
    });
  });

  it('should accept all three text filters together alongside the existing filters', () => {
    const result = parse({
      description: 'birthday cake',
      originalFileName: 'IMG_1234.jpg',
      ocr: 'happy birthday',
      rating: '4',
      isFavorite: 'true',
    });

    expect(result.success).toBe(true);
    expect(result.data).toEqual(
      expect.objectContaining({
        description: 'birthday cake',
        originalFileName: 'IMG_1234.jpg',
        ocr: 'happy birthday',
        rating: 4,
        isFavorite: true,
      }),
    );
  });
});
