export interface Theme {
  key: string;
  /** CLIP text prompt */
  query: string;
}

export const THEMES: Theme[] = [
  { key: 'sunset', query: 'a beautiful sunset' },
  { key: 'beach', query: 'a beach with sand and ocean' },
  { key: 'food', query: 'a plate of food at a meal' },
  { key: 'mountains', query: 'mountains and hiking trails' },
  { key: 'snow', query: 'a snowy winter landscape' },
  { key: 'city_night', query: 'a city skyline at night' },
];

/** Deterministic for a given calendar month, forever. */
export const themeForMonth = (month: number): Theme => THEMES[(month - 1) % THEMES.length]!;
