import type { Translations } from 'svelte-i18n';
import { describe, expect, it } from 'vitest';
import { getPetSpeciesI18nKey, getPetSpeciesLabel } from './pet-species';

// R8.5 (pet-recognition review-fixes, F13): pet-species.ts maps a raw species string (as recorded
// by the pet-detection model) to its i18n translation key. `$t()` takes a typed key rather than an
// arbitrary string, so an unmapped species yields `undefined` and the raw value is substituted by
// getPetSpeciesLabel at the call site instead of being passed through as a pseudo-key.
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

  it('returns undefined for a species the map does not cover', () => {
    expect(getPetSpeciesI18nKey('axolotl')).toBeUndefined();
    expect(getPetSpeciesI18nKey('Axolotl')).toBeUndefined();
  });
});

describe('getPetSpeciesLabel', () => {
  const translate = (key: Translations) => `translated:${key}`;

  it('translates a known species', () => {
    expect(getPetSpeciesLabel('dog', translate)).toBe('translated:species_dog');
    expect(getPetSpeciesLabel('CAT', translate)).toBe('translated:species_cat');
  });

  it('falls back to the raw value, unchanged, for an unmapped species', () => {
    expect(getPetSpeciesLabel('axolotl', translate)).toBe('axolotl');
    expect(getPetSpeciesLabel('Axolotl', translate)).toBe('Axolotl');
  });

  it('returns undefined when there is no species at all', () => {
    expect(getPetSpeciesLabel(null, translate)).toBeUndefined();
    expect(getPetSpeciesLabel(undefined, translate)).toBeUndefined();
    expect(getPetSpeciesLabel('', translate)).toBeUndefined();
  });
});
