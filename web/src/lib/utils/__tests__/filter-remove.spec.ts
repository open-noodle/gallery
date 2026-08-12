import { describe, expect, it } from 'vitest';
import { createFilterState } from '$lib/components/filter-panel/filter-panel';
import { handleRemoveFilter } from '$lib/utils/filter-remove';

describe('handleRemoveFilter', () => {
  it('clears lensModel for the lens chip', () => {
    const filters = { ...createFilterState(), lensModel: 'RF24-70mm F2.8 L IS USM' };
    const result = handleRemoveFilter(filters, 'lens');
    expect(result.lensModel).toBeUndefined();
  });

  it('clears albumId for the album chip', () => {
    const filters = { ...createFilterState(), albumId: 'aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa' };
    const result = handleRemoveFilter(filters, 'album');
    expect(result.albumId).toBeUndefined();
  });

  it('clears ownerId for the owner chip', () => {
    const filters = { ...createFilterState(), ownerId: 'bbbbbbbb-bbbb-4bbb-bbbb-bbbbbbbbbbbb' };
    const result = handleRemoveFilter(filters, 'owner');
    expect(result.ownerId).toBeUndefined();
  });

  it('clears city, state, and country together for the location chip', () => {
    const filters = { ...createFilterState(), city: 'Berlin', state: 'Berlin State', country: 'Germany' };
    const result = handleRemoveFilter(filters, 'location');
    expect(result.city).toBeUndefined();
    expect(result.state).toBeUndefined();
    expect(result.country).toBeUndefined();
  });

  it('clears make and model together for the camera chip, but keeps lensModel — it has its own chip', () => {
    const filters = {
      ...createFilterState(),
      make: 'Sony',
      model: 'A7III',
      lensModel: 'RF24-70mm F2.8 L IS USM',
    };
    const result = handleRemoveFilter(filters, 'camera');
    expect(result.make).toBeUndefined();
    expect(result.model).toBeUndefined();
    expect(result.lensModel).toBe('RF24-70mm F2.8 L IS USM');
  });

  it('clears isInAlbum and isNotInAlbum together for the albums chip, but keeps albumId — it has its own chip', () => {
    const filters = {
      ...createFilterState(),
      isInAlbum: true,
      isNotInAlbum: true,
      albumId: 'aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa',
    };
    const result = handleRemoveFilter(filters, 'albums');
    expect(result.isInAlbum).toBeUndefined();
    expect(result.isNotInAlbum).toBeUndefined();
    expect(result.albumId).toBe('aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa');
  });

  it('preserves every other filter when clearing the lens chip', () => {
    const filters = {
      ...createFilterState(),
      lensModel: 'RF24-70mm F2.8 L IS USM',
      country: 'Germany',
      rating: 4,
      personIds: ['p1'],
    };
    const result = handleRemoveFilter(filters, 'lens');
    expect(result.country).toBe('Germany');
    expect(result.rating).toBe(4);
    expect(result.personIds).toEqual(['p1']);
  });

  it('preserves every other filter when clearing the album chip', () => {
    const filters = {
      ...createFilterState(),
      albumId: 'aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa',
      country: 'Germany',
      rating: 4,
      personIds: ['p1'],
    };
    const result = handleRemoveFilter(filters, 'album');
    expect(result.country).toBe('Germany');
    expect(result.rating).toBe(4);
    expect(result.personIds).toEqual(['p1']);
  });

  it('preserves every other filter when clearing the owner chip', () => {
    const filters = {
      ...createFilterState(),
      ownerId: 'bbbbbbbb-bbbb-4bbb-bbbb-bbbbbbbbbbbb',
      country: 'Germany',
      rating: 4,
      personIds: ['p1'],
    };
    const result = handleRemoveFilter(filters, 'owner');
    expect(result.country).toBe('Germany');
    expect(result.rating).toBe(4);
    expect(result.personIds).toEqual(['p1']);
  });

  it('preserves every other filter when clearing the location chip', () => {
    const filters = {
      ...createFilterState(),
      city: 'Berlin',
      state: 'Berlin State',
      country: 'Germany',
      rating: 4,
      personIds: ['p1'],
    };
    const result = handleRemoveFilter(filters, 'location');
    expect(result.rating).toBe(4);
    expect(result.personIds).toEqual(['p1']);
  });

  it('preserves every other filter when clearing the camera chip', () => {
    const filters = {
      ...createFilterState(),
      make: 'Sony',
      model: 'A7III',
      lensModel: 'RF24-70mm F2.8 L IS USM',
      country: 'Germany',
      rating: 4,
      personIds: ['p1'],
    };
    const result = handleRemoveFilter(filters, 'camera');
    expect(result.country).toBe('Germany');
    expect(result.rating).toBe(4);
    expect(result.personIds).toEqual(['p1']);
  });

  it('preserves every other filter when clearing the albums chip', () => {
    const filters = {
      ...createFilterState(),
      isInAlbum: true,
      isNotInAlbum: true,
      albumId: 'aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa',
      country: 'Germany',
      rating: 4,
      personIds: ['p1'],
    };
    const result = handleRemoveFilter(filters, 'albums');
    expect(result.country).toBe('Germany');
    expect(result.rating).toBe(4);
    expect(result.personIds).toEqual(['p1']);
  });

  it('is a no-op for an unknown filter type', () => {
    const filters = { ...createFilterState(), country: 'Germany', rating: 4 };
    const result = handleRemoveFilter(filters, 'not-a-real-type');
    expect(result).toBe(filters);
  });
});
