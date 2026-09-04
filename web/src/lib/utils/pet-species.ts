import type { Translations } from 'svelte-i18n';

// Maps a raw pet species string (as recorded by the pet-detection model, e.g. `pet_search.species`
// or a person's `species` field) to its i18n translation key. Add the translated key to
// `i18n/en.json` when adding a new entry here.
const PET_SPECIES_I18N_KEYS: Record<string, Translations> = {
  dog: 'species_dog',
  cat: 'species_cat',
  bird: 'species_bird',
  horse: 'species_horse',
  sheep: 'species_sheep',
  cow: 'species_cow',
  elephant: 'species_elephant',
  bear: 'species_bear',
  zebra: 'species_zebra',
  giraffe: 'species_giraffe',
};

/**
 * Returns the i18n key for a known species (case-insensitive), or `undefined` when the species
 * isn't in the map. Callers render the raw species value in that case — `$t()` takes a typed key,
 * not an arbitrary string, so the fallback has to happen at the call site rather than by passing
 * the raw value through as if it were a key.
 */
export const getPetSpeciesI18nKey = (species: string): Translations | undefined => {
  const normalized = species.toLowerCase();
  // `Object.hasOwn` rather than a bare lookup: a species literally named `constructor` or
  // `toString` would otherwise resolve to an inherited Object.prototype member and be handed to
  // `$t()` as a key. Unreachable with the COCO labels the detector emits, but the map is a plain
  // object and the input is model output, so don't rely on that staying true.
  return Object.hasOwn(PET_SPECIES_I18N_KEYS, normalized) ? PET_SPECIES_I18N_KEYS[normalized] : undefined;
};

/** Display label for a pet species: translated when known, the raw value otherwise. */
export const getPetSpeciesLabel = (
  species: string | null | undefined,
  translate: (key: Translations) => string,
): string | undefined => {
  if (!species) {
    return undefined;
  }

  const key = getPetSpeciesI18nKey(species);
  return key ? translate(key) : species;
};

/**
 * Label for the paw badge, which must always be named: `role="img"` with no accessible name is a
 * WCAG 1.1.1 failure. Species is the best label when we have one, but not every surface carries it —
 * a shared space projects its own person rows (`SharedSpacePersonResponseDto` has `type`, no
 * `species`), and a pet person can predate the species column — so fall back to a generic "Pet".
 */
export const getPetBadgeLabel = (
  species: string | null | undefined,
  translate: (key: Translations) => string,
): string => getPetSpeciesLabel(species, translate) ?? translate('pet');
