import { describe, expect, it } from 'vitest';
import { getPetSpeciesI18nKey } from './pet-species';

// R8.5 (pet-recognition review-fixes, F13): pet-species.ts maps a raw species string (as recorded
// by the pet-detection model) to its i18n translation key, with a raw-value fallback for species
// the map doesn't cover — the badge components ($t(getPetSpeciesI18nKey(species))) render that
// fallback as literal text since it never matches a real translation key.
describe('getPetSpeciesI18nKey', () => {
  it('maps every known species to its i18n key', () => {
    expect(getPetSpeciesI18nKey('dog')).toBe('species_dog');
    expect(getPetSpeciesI18nKey('cat')).toBe('species_cat');
    expect(getPetSpeciesI18nKey('bird')).toBe('species_bird');
    expect(getPetSpeciesI18nKey('horse')).toBe('species_horse');
    expect(getPetSpeciesI18nKey('sheep')).toBe('species_sheep');
    expect(getPetSpeciesI18nKey('cow')).toBe('species_cow');
    expect(getPetSpeciesI18nKey('elephant')).toBe('species_elephant');
    expect(getPetSpeciesI18nKey('bear')).toBe('species_bear');
    expect(getPetSpeciesI18nKey('zebra')).toBe('species_zebra');
    expect(getPetSpeciesI18nKey('giraffe')).toBe('species_giraffe');
  });

  it('is case-insensitive for known species', () => {
    expect(getPetSpeciesI18nKey('Dog')).toBe('species_dog');
    expect(getPetSpeciesI18nKey('CAT')).toBe('species_cat');
  });

  it('returns the raw value, unchanged, for a species the map does not cover', () => {
    expect(getPetSpeciesI18nKey('axolotl')).toBe('axolotl');
    expect(getPetSpeciesI18nKey('Axolotl')).toBe('Axolotl');
  });
});
