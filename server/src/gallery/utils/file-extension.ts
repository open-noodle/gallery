// The aliases a templated rename folds together, shared with the in-app rename so both name a file alike.
const EXTENSION_ALIASES: Record<string, string> = {
  jpeg: 'jpg',
  jpe: 'jpg',
  tif: 'tiff',
  '3gpp': '3gp',
  mpeg: 'mpg',
  mpe: 'mpg',
  m2ts: 'mts',
  m2t: 'mts',
};

/** Lowercases an extension given without its dot and folds the aliases above. */
export const normalizeFileExtension = (extension: string): string => {
  const lower = extension.toLowerCase();
  return EXTENSION_ALIASES[lower] ?? lower;
};
