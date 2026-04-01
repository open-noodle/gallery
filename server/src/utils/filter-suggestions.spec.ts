import { without } from 'src/utils/filter-suggestions';

describe('without', () => {
  it('should remove a single key', () => {
    const opts = { country: 'Germany', make: 'Canon', rating: 4 };
    expect(without(opts, 'country')).toEqual({ country: undefined, make: 'Canon', rating: 4 });
  });

  it('should remove hierarchical pair (country + city)', () => {
    const opts = { country: 'Germany', city: 'Munich', make: 'Canon' };
    expect(without(opts, 'country', 'city')).toEqual({ country: undefined, city: undefined, make: 'Canon' });
  });

  it('should remove hierarchical pair (make + model)', () => {
    const opts = { make: 'Canon', model: 'EOS R5', country: 'Germany' };
    expect(without(opts, 'make', 'model')).toEqual({ make: undefined, model: undefined, country: 'Germany' });
  });

  it('should preserve keys not in the exclusion list', () => {
    const opts = { country: 'Germany', personIds: ['p1'], takenAfter: new Date('2024-01-01'), spaceId: 'sp1' };
    const result = without(opts, 'country');
    expect(result.personIds).toEqual(['p1']);
    expect(result.takenAfter).toEqual(new Date('2024-01-01'));
    expect(result.spaceId).toBe('sp1');
  });

  it('should handle keys that are already undefined', () => {
    const opts = { country: undefined, make: 'Canon' };
    expect(without(opts, 'country')).toEqual({ country: undefined, make: 'Canon' });
  });

  it('should not mutate the original object', () => {
    const opts = { country: 'Germany', make: 'Canon' };
    without(opts, 'country');
    expect(opts.country).toBe('Germany');
  });
});
