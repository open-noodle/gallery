export const TRIP_PLACE_HINT_MAX_LENGTH = 80;

export interface TripPlaceHint {
  raw: string;
  normalized: string;
  aliases: string[];
}

export type TripPlaceHintParseResult =
  | { status: 'none' }
  | { status: 'invalid'; reason: 'too_long' }
  | { status: 'valid'; hint: TripPlaceHint };

type PlaceLike = {
  country?: string | null;
  state?: string | null;
  city?: string | null;
};

const UNITED_STATES_ALIASES = [
  'us',
  'u s',
  'usa',
  'u s a',
  'united states',
  'united states america',
  'united states of america',
];

const COUNTRY_ALIAS_GROUPS = [UNITED_STATES_ALIASES];

export const normalizeTripPlaceLabel = (value: string) => {
  return value
    .normalize('NFKD')
    .replaceAll(/[\u0300-\u036F]/g, '')
    .toLowerCase()
    .replaceAll('&', ' and ')
    .replaceAll(/[^a-z0-9]+/g, ' ')
    .trim()
    .replaceAll(/\s+/g, ' ');
};

const expandAliases = (normalized: string) => {
  const aliasGroup = COUNTRY_ALIAS_GROUPS.find((group) => group.includes(normalized));
  return aliasGroup ?? [normalized];
};

const uniqueValues = (values: string[]) => [...new Set(values)];

export const parseTripPlaceHint = (placeHint?: string): TripPlaceHintParseResult => {
  const raw = placeHint?.trim();
  if (!raw) {
    return { status: 'none' };
  }

  if (raw.length > TRIP_PLACE_HINT_MAX_LENGTH) {
    return { status: 'invalid', reason: 'too_long' };
  }

  const normalized = normalizeTripPlaceLabel(raw);
  if (!normalized) {
    return { status: 'none' };
  }

  return {
    status: 'valid',
    hint: {
      raw,
      normalized,
      aliases: uniqueValues(expandAliases(normalized)),
    },
  };
};

export const tripPlaceMatchesHint = (place: PlaceLike, hint: TripPlaceHint) => {
  const countryAliases = place.country ? expandAliases(normalizeTripPlaceLabel(place.country)) : [];
  const stateAndCityAliases = [place.state, place.city]
    .filter((value): value is string => !!value)
    .map((value) => normalizeTripPlaceLabel(value));

  return [...countryAliases, ...stateAndCityAliases].some((alias) => hint.aliases.includes(alias));
};
