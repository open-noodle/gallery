import { getNormalizedDotExtension, getRenameNameError } from 'src/gallery/utils/rename.js';

describe(getNormalizedDotExtension.name, () => {
  it.each([
    ['IMG_0007.JPEG', '.jpg'],
    ['clip.MPEG', '.mpg'],
    ['photo.heic', '.heic'],
    ['archive.tar.gz', '.gz'],
    ['no-extension', ''],
  ])('reads %s as %s', (fileName, expected) => {
    expect(getNormalizedDotExtension(fileName)).toBe(expected);
  });
});

describe(getRenameNameError.name, () => {
  it.each(['Beach 2006-08', 'IMG_0007', 'a.b', 'Zażółć gęślą', '日本語'])('accepts %s', (name) => {
    expect(getRenameNameError(name, '.jpg')).toBeNull();
  });

  it.each([
    ['', 'empty'],
    ['.', 'period'],
    ['..', 'period'],
    ['.hidden', 'period'],
    ['a/b', 'separator'],
    [String.raw`a\b`, 'separator'],
    ['a\0b', 'control'],
    ['a\nb', 'control'],
  ])('rejects %j', (name, reason) => {
    expect(getRenameNameError(name, '.jpg')).toMatch(new RegExp(reason));
  });

  it('counts bytes, with the extension, against the 255 limit', () => {
    expect(getRenameNameError('a'.repeat(251), '.jpg')).toBeNull();
    expect(getRenameNameError('a'.repeat(252), '.jpg')).toMatch(/longer/);
    // 4 bytes each
    expect(getRenameNameError('😀'.repeat(63), '.jpg')).toMatch(/longer/);
    expect(getRenameNameError('😀'.repeat(62), '.jpg')).toBeNull();
  });
});
