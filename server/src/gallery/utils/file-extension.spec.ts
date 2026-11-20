import { normalizeFileExtension } from 'src/gallery/utils/file-extension.js';

describe(normalizeFileExtension.name, () => {
  it.each([
    ['jpeg', 'jpg'],
    ['JPEG', 'jpg'],
    ['jpe', 'jpg'],
    ['tif', 'tiff'],
    ['3gpp', '3gp'],
    ['mpeg', 'mpg'],
    ['mpe', 'mpg'],
    ['m2ts', 'mts'],
    ['m2t', 'mts'],
  ])('folds %s to %s', (extension, expected) => {
    expect(normalizeFileExtension(extension)).toBe(expected);
  });

  it('lowercases an extension without an alias', () => {
    expect(normalizeFileExtension('HEIC')).toBe('heic');
    expect(normalizeFileExtension('png')).toBe('png');
  });

  it('leaves an empty extension empty', () => {
    expect(normalizeFileExtension('')).toBe('');
  });
});
