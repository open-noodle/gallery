export interface Theme {
  key: string;
  /** CLIP text prompt */
  query: string;
  /** human label used in the memory title */
  label: string;
}

export const THEMES: Theme[] = [
  { key: 'sunset', query: 'a beautiful sunset', label: 'Sunsets' },
  { key: 'beach', query: 'a beach with sand and ocean', label: 'Beach days' },
  { key: 'food', query: 'a plate of food at a meal', label: 'Food' },
  { key: 'mountains', query: 'mountains and hiking trails', label: 'Mountains' },
  { key: 'snow', query: 'a snowy winter landscape', label: 'Snow days' },
  { key: 'city_night', query: 'a city skyline at night', label: 'City lights' },
];

/** Deterministic for a given calendar month, forever. */
export const themeForMonth = (month: number): Theme => THEMES[(month - 1) % THEMES.length]!;
