import { normalizeFileExtension } from 'src/gallery/utils/file-extension.js';
import { getFilenameExtension } from 'src/utils/file.js';

const MAX_FILE_NAME_BYTES = 255;

// eslint-disable-next-line no-control-regex
const CONTROL_CHARACTERS = /[\u{0}-\u{1F}\u{7F}]/u;

/** The extension of a file name with its dot, normalized as a templated rename does; empty when it has none. */
export const getNormalizedDotExtension = (fileName: string): string => {
  const extension = getFilenameExtension(fileName);
  return extension ? `.${normalizeFileExtension(extension.slice(1))}` : '';
};

/** Why `name` (a file name without its extension) cannot be used, or null when it can. */
export const getRenameNameError = (name: string, extension: string): string | null => {
  if (name.length === 0) {
    return 'The name must not be empty';
  }

  if (name === '.' || name === '..' || name.startsWith('.')) {
    return 'The name must not start with a period';
  }

  if (name.includes('/') || name.includes('\\')) {
    return 'The name must not contain a path separator';
  }

  if (CONTROL_CHARACTERS.test(name)) {
    return 'The name must not contain control characters';
  }

  if (Buffer.byteLength(name + extension, 'utf8') > MAX_FILE_NAME_BYTES) {
    return `The name must not be longer than ${MAX_FILE_NAME_BYTES} bytes`;
  }

  return null;
};
