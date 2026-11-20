import { countryMatchesQuery, localizeCountry, sortCountries } from '#lib/gallery/utils/country-names.ts';

describe('localizeCountry', () => {
  it('translates a stored GeoNames name into the UI language', () => {
    expect(localizeCountry('Germany', 'de')).toBe('Deutschland');
    expect(localizeCountry('Switzerland', 'de')).toBe('Schweiz');
    expect(localizeCountry('Germany', 'fr')).toBe('Allemagne');
  });

  it('resolves names that differ from the CLDR English name', () => {
    expect(localizeCountry('United States', 'de')).toBe('Vereinigte Staaten');
    expect(localizeCountry('The Netherlands', 'de')).toBe('Niederlande');
    expect(localizeCountry('Czechia', 'de')).toBe('Tschechien');
  });

  it('accepts the BCP 47 tags the UI locale uses', () => {
    expect(localizeCountry('Germany', 'zh-Hans')).toBe('德国');
    expect(localizeCountry('Germany', 'zh-Hant')).toBe('德國');
  });

  it('keeps the stored name for English locales', () => {
    expect(localizeCountry('The Netherlands', 'en')).toBe('The Netherlands');
    expect(localizeCountry('The Netherlands', 'en-GB')).toBe('The Netherlands');
    expect(localizeCountry('The Netherlands', 'en_US')).toBe('The Netherlands');
  });

  it('keeps the stored name when there is nothing to translate it with', () => {
    expect(localizeCountry('Germany')).toBe('Germany');
    expect(localizeCountry('Germany', null)).toBe('Germany');
    expect(localizeCountry('Germany', 'dev')).toBe('Germany');
    expect(localizeCountry('Germany', 'not a locale')).toBe('Germany');
    expect(localizeCountry('Atlantis', 'de')).toBe('Atlantis');
    expect(localizeCountry('', 'de')).toBe('');
  });
});

describe('countryMatchesQuery', () => {
  it('matches the localized and the stored name', () => {
    expect(countryMatchesQuery('Germany', 'de', 'deutsch')).toBe(true);
    expect(countryMatchesQuery('Germany', 'de', 'germ')).toBe(true);
    expect(countryMatchesQuery('Germany', 'de', 'france')).toBe(false);
  });
});

describe('sortCountries', () => {
  const stored = ['Austria', 'Germany', 'South Africa', 'Switzerland', 'United States'];

  it('orders by the localized name and returns the stored names', () => {
    expect(sortCountries(stored, 'de')).toEqual(['Germany', 'Austria', 'Switzerland', 'South Africa', 'United States']);
  });

  it('keeps the English order for English and unknown locales', () => {
    expect(sortCountries(stored, 'en-US')).toEqual(stored);
    expect(sortCountries(stored, 'not a locale')).toEqual(stored);
    expect(sortCountries(stored)).toEqual(stored);
  });

  it('does not change the input', () => {
    const input = ['Switzerland', 'Germany'];
    sortCountries(input, 'de');
    expect(input).toEqual(['Switzerland', 'Germany']);
  });
});
