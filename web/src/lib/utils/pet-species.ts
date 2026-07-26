// Maps a raw pet species string (as recorded by the pet-detection model, e.g. `pet_search.species`
// or a person's `species` field) to its i18n translation key. Add the translated key to
// `i18n/en.json` when adding a new entry here.
const PET_SPECIES_I18N_KEYS: Record<string, string> = {
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
 * Returns the i18n key for a known species (case-insensitive), or the raw species value
 * unchanged when it isn't in the map. The raw fallback is not a translation key, so passing it
 * through `$t()` simply renders it as literal text — which is the desired fallback display.
 */
export const getPetSpeciesI18nKey = (species: string): string =>
  PET_SPECIES_I18N_KEYS[species.toLowerCase()] ?? species;
