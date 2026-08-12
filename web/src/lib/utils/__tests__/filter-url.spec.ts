import { describe, expect, it } from 'vitest';
import { createFilterState, type FilterState } from '$lib/components/filter-panel/filter-panel';
import { clearFilterParams, decodeFilterParams, encodeFilterParams } from '$lib/utils/filter-url';

const encode = (filters: Partial<FilterState>): URLSearchParams => {
  const params = new URLSearchParams();
  encodeFilterParams(params, { ...createFilterState(), ...filters });
  return params;
};

describe('filter-url codec', () => {
  it('round-trips every filter field', () => {
    const filters: FilterState = {
      ...createFilterState(),
      personIds: ['person:p1', 'space-person:p2'],
      tagIds: ['t1', 't2'],
      city: 'Berlin',
      state: 'State of Berlin',
      country: 'Germany',
      make: 'Apple',
      model: 'iPhone 17 Pro Max',
      lensModel: 'iPhone 17 Pro Max back triple camera',
      albumId: 'a1',
      ownerId: 'u1',
      description: 'sunset',
      originalFileName: 'IMG_7465',
      ocr: 'hello',
      rating: 4,
      mediaType: 'image',
      isFavorite: true,
      dateAfter: '2026-01-01',
      dateBefore: '2026-01-31',
    };

    const decoded = decodeFilterParams(new URL(`https://g.test/photos?${encode(filters)}`));

    expect(decoded).toMatchObject({
      personIds: ['person:p1', 'space-person:p2'],
      tagIds: ['t1', 't2'],
      city: 'Berlin',
      state: 'State of Berlin',
      country: 'Germany',
      make: 'Apple',
      model: 'iPhone 17 Pro Max',
      lensModel: 'iPhone 17 Pro Max back triple camera',
      albumId: 'a1',
      ownerId: 'u1',
      description: 'sunset',
      originalFileName: 'IMG_7465',
      ocr: 'hello',
      rating: 4,
      mediaType: 'image',
      isFavorite: true,
      dateAfter: '2026-01-01',
      dateBefore: '2026-01-31',
    });
  });

  it('uses the short `owner` and `lens` param names', () => {
    const params = encode({ ownerId: 'u1', lensModel: 'RF24-70mm' });

    expect(params.get('owner')).toBe('u1');
    expect(params.get('lens')).toBe('RF24-70mm');
    expect(params.get('ownerId')).toBeNull();
    expect(params.get('lensModel')).toBeNull();
  });

  // E1 — mirrors the server: albumId takes precedence over isInAlbum/isNotInAlbum
  it('E1: never emits album=has|none alongside albumId', () => {
    const params = encode({ albumId: 'a1', isInAlbum: true });

    expect(params.get('albumId')).toBe('a1');
    expect(params.get('album')).toBeNull();
  });

  it('E1: decoding drops isInAlbum/isNotInAlbum when albumId is present', () => {
    const decoded = decodeFilterParams(new URL('https://g.test/photos?albumId=a1&album=has'));

    expect(decoded.albumId).toBe('a1');
    expect(decoded.isInAlbum).toBeUndefined();
    expect(decoded.isNotInAlbum).toBeUndefined();
  });

  // E7 — empty/whitespace values must not become filters
  it('E7: emits no param for empty or whitespace-only values', () => {
    const params = encode({ make: ' '.repeat(3), lensModel: '', state: '  ', ownerId: '' });

    expect(params.get('make')).toBeNull();
    expect(params.get('lens')).toBeNull();
    expect(params.get('state')).toBeNull();
    expect(params.get('owner')).toBeNull();
  });

  // E12 — URL-special characters must survive a round trip
  it('E12: round-trips values containing URL-special characters', () => {
    const lensModel = 'FE 24-70mm F2.8 GM / II + adapter & hood?';
    const decoded = decodeFilterParams(new URL(`https://g.test/photos?${encode({ lensModel })}`));

    expect(decoded.lensModel).toBe(lensModel);
  });

  // E13 — bound the URL length, on BOTH sides of the codec
  it('E13: truncates description to 200 characters when encoding', () => {
    const params = encode({ description: 'x'.repeat(500) });

    expect(params.get('description')).toHaveLength(200);
  });

  it('E13: clamps an over-long description param when decoding', () => {
    // A hand-crafted or legacy URL can carry more than the encoder would ever emit. Clamp on the
    // way in too, so encode(decode(u)) is stable and the filter panel does not silently rewrite
    // the user's URL on the next hydrate.
    const decoded = decodeFilterParams(new URL(`https://g.test/photos?description=${'x'.repeat(500)}`));

    expect(decoded.description).toHaveLength(200);
  });

  // The description clamp exists because a pasted 10KB value goes straight into the URL and reverse
  // proxies commonly cap request headers at ~8KB. filename and ocr are the same free-text inputs on
  // the same panel, so they need the same bound — symmetrically, on both sides of the codec.
  it('E13: truncates filename and ocr to 200 characters when encoding', () => {
    const params = encode({ originalFileName: 'f'.repeat(500), ocr: 'o'.repeat(500) });

    expect(params.get('filename')).toHaveLength(200);
    expect(params.get('ocr')).toHaveLength(200);
  });

  it('E13: clamps over-long filename and ocr params when decoding', () => {
    const decoded = decodeFilterParams(
      new URL(`https://g.test/photos?filename=${'f'.repeat(500)}&ocr=${'o'.repeat(500)}`),
    );

    expect(decoded.originalFileName).toHaveLength(200);
    expect(decoded.ocr).toHaveLength(200);
  });

  // A UTF-16 code-unit clamp (`.slice(0, 200)`) cuts an emoji that straddles the boundary in half:
  // the surviving lone surrogate is not serializable, so URLSearchParams writes U+FFFD instead —
  // silent, irreversible corruption of one character. Clamp on CODE POINTS.
  it('E13: does not split a surrogate pair that straddles the clamp boundary', () => {
    const value = 'x'.repeat(199) + '😀'; // 200 code points, 201 UTF-16 code units
    const params = encode({ description: value, originalFileName: value, ocr: value });
    const decoded = decodeFilterParams(new URL(`https://g.test/photos?${params.toString()}`));

    expect(decoded.description).toBe(value);
    expect(decoded.originalFileName).toBe(value);
    expect(decoded.ocr).toBe(value);
    expect(params.toString()).not.toContain('%EF%BF%BD');
  });

  it('E13: clamps a long emoji value to 200 code points, not 200 code units', () => {
    const decoded = decodeFilterParams(
      new URL(`https://g.test/photos?${encode({ description: '😀'.repeat(250) }).toString()}`),
    );

    expect([...decoded.description!]).toHaveLength(200);
    expect(decoded.description).not.toContain('�');
  });

  it('clearFilterParams removes every filter param but leaves q and sort alone', () => {
    const params = new URLSearchParams(
      'q=beach&sort=asc&make=Apple&lens=RF24&owner=u1&albumId=a1&state=Hamburg&year=2023&month=6',
    );

    clearFilterParams(params);

    expect(params.get('q')).toBe('beach');
    expect(params.get('sort')).toBe('asc');
    expect(params.get('make')).toBeNull();
    expect(params.get('lens')).toBeNull();
    expect(params.get('owner')).toBeNull();
    expect(params.get('albumId')).toBeNull();
    expect(params.get('state')).toBeNull();
    // Without these, buildFilterStateUrl's REPLACE semantics break: a cleared year could never be
    // removed from the URL, because the stale param would survive the clear and re-hydrate.
    expect(params.get('year')).toBeNull();
    expect(params.get('month')).toBeNull();
  });

  // D2 — the temporal picker's own control (selectedYear/selectedMonth) is IN the codec. It used to
  // be transient, so a shared link silently lost it and every URL-backed page needed a carry-over
  // slot to smuggle it across its own goto().
  describe('D2: year/month', () => {
    it('emits year and month', () => {
      const params = encode({ selectedYear: 2023, selectedMonth: 6 });

      expect(params.get('year')).toBe('2023');
      expect(params.get('month')).toBe('6');
    });

    it('emits a bare year with no month', () => {
      const params = encode({ selectedYear: 2023 });

      expect(params.get('year')).toBe('2023');
      expect(params.get('month')).toBeNull();
    });

    it('round-trips year and month', () => {
      const decoded = decodeFilterParams(
        new URL(`https://g.test/photos?${encode({ selectedYear: 2023, selectedMonth: 6 })}`),
      );

      expect(decoded).toEqual({ selectedYear: 2023, selectedMonth: 6 });
    });

    it('round-trips a bare year', () => {
      const decoded = decodeFilterParams(new URL(`https://g.test/photos?${encode({ selectedYear: 2023 })}`));

      expect(decoded).toEqual({ selectedYear: 2023 });
    });

    it.each(['abc', '0', '99999', '-2023', '2023.5', ''])('rejects a malformed year=%s', (year) => {
      const decoded = decodeFilterParams(new URL(`https://g.test/photos?year=${year}`));

      expect(decoded.selectedYear).toBeUndefined();
      expect(decoded.selectedMonth).toBeUndefined();
    });

    it.each(['13', '0', 'abc', '-1', '6.5'])('rejects a malformed month=%s but keeps a valid year', (month) => {
      const decoded = decodeFilterParams(new URL(`https://g.test/photos?year=2023&month=${month}`));

      expect(decoded.selectedYear).toBe(2023);
      expect(decoded.selectedMonth).toBeUndefined();
    });

    it('drops a month with no year — buildFilterContext ignores it, so it must not be counted', () => {
      const decoded = decodeFilterParams(new URL('https://g.test/photos?month=6'));

      expect(decoded).toEqual({});
    });

    // I2 — buildFilterContext (filter-panel.ts) prefers dateAfter/dateBefore over selectedYear, and
    // the panel keeps them mutually exclusive. A year emitted beside from/to would be inert in the
    // query but still COUNTED by getActiveFilterCount: exactly the counted-but-not-applied lie.
    it('I2: never emits year alongside from/to', () => {
      const params = encode({ selectedYear: 2023, selectedMonth: 6, dateAfter: '2024-01-01' });

      expect(params.get('from')).toBe('2024-01-01');
      expect(params.get('year')).toBeNull();
      expect(params.get('month')).toBeNull();
    });

    it('I2: never emits year alongside a bare `to`', () => {
      const params = encode({ selectedYear: 2023, dateBefore: '2024-12-31' });

      expect(params.get('to')).toBe('2024-12-31');
      expect(params.get('year')).toBeNull();
    });

    it('I2: decoding drops year/month when from/to is present', () => {
      const decoded = decodeFilterParams(new URL('https://g.test/photos?from=2024-01-01&year=2023&month=6'));

      expect(decoded).toEqual({ dateAfter: '2024-01-01' });
    });

    it('I2: an INVALID from does not suppress the year', () => {
      const decoded = decodeFilterParams(new URL('https://g.test/photos?from=soon&year=2023'));

      expect(decoded).toEqual({ selectedYear: 2023 });
    });
  });
});
