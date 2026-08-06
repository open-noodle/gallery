import {
  TRIP_PLACE_HINT_MAX_LENGTH,
  normalizeTripPlaceLabel,
  parseTripPlaceHint,
  tripPlaceMatchesHint,
} from 'src/services/trip-place-hint';

describe('trip place hints', () => {
  it('normalizes place labels conservatively', () => {
    expect(normalizeTripPlaceLabel('  París, Île-de-France!!  ')).toBe('paris ile de france');
  });

  it('treats empty hints as absent', () => {
    expect(parseTripPlaceHint()).toEqual({ status: 'none' });
    expect(parseTripPlaceHint('   ')).toEqual({ status: 'none' });
  });

  it('rejects overlong hints after trimming', () => {
    expect(parseTripPlaceHint('x'.repeat(TRIP_PLACE_HINT_MAX_LENGTH + 1))).toEqual({
      status: 'invalid',
      reason: 'too_long',
    });
  });

  it('matches USA aliases against country metadata equivalents', () => {
    const usa = parseTripPlaceHint('U.S.A.');
    const unitedStates = parseTripPlaceHint('United States');

    expect(usa.status).toBe('valid');
    expect(unitedStates.status).toBe('valid');

    if (usa.status !== 'valid' || unitedStates.status !== 'valid') {
      throw new Error('expected valid hints');
    }

    expect(tripPlaceMatchesHint({ country: 'United States of America' }, usa.hint)).toBe(true);
    expect(tripPlaceMatchesHint({ country: 'USA' }, unitedStates.hint)).toBe(true);
  });

  it('matches exact normalized city labels without geocoding unknown names', () => {
    const paris = parseTripPlaceHint('paris');
    const atlantis = parseTripPlaceHint('Atlantis');

    expect(paris.status).toBe('valid');
    expect(atlantis.status).toBe('valid');

    if (paris.status !== 'valid' || atlantis.status !== 'valid') {
      throw new Error('expected valid hints');
    }

    expect(tripPlaceMatchesHint({ country: 'France', city: 'Paris' }, paris.hint)).toBe(true);
    expect(tripPlaceMatchesHint({ country: 'France', city: 'Paris' }, atlantis.hint)).toBe(false);
  });
});
