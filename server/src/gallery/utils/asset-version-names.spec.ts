import {
  editSourceBase,
  hasEditMark,
  namedAfter,
  sameShotName,
  searchNames,
  shotBase,
} from 'src/gallery/utils/asset-version-names.js';

// The names cameras and phones give the files of one shot, by maker: [the RAW, the camera's own picture(s), the base
// name both must come to]. Each row is a pair the rules must be able to find by name.
const SHOTS: Array<[maker: string, raw: string, pictures: string[], base: string]> = [
  ['Nikon', 'DSC_9425.NEF', ['DSC_9425.JPG', 'DSC_9425.HIF', 'DSC_9425.jpg'], 'dsc_9425'],
  ['Nikon, Adobe RGB', '_DSC9425.NEF', ['_DSC9425.JPG'], '_dsc9425'],
  ['Nikon compact', 'DSCN0412.NRW', ['DSCN0412.JPG'], 'dscn0412'],
  ['Canon', 'IMG_1234.CR3', ['IMG_1234.JPG', 'IMG_1234.HIF'], 'img_1234'],
  ['Canon, older', 'IMG_1234.CR2', ['IMG_1234.JPG'], 'img_1234'],
  ['Canon, Adobe RGB', '_MG_1234.CR2', ['_MG_1234.JPG'], '_mg_1234'],
  ['Sony', 'DSC01234.ARW', ['DSC01234.JPG', 'DSC01234.HIF', 'DSC01234.jpg'], 'dsc01234'],
  ['Sony, Adobe RGB', '_DSC1234.ARW', ['_DSC1234.JPG'], '_dsc1234'],
  ['Fujifilm', 'DSCF1234.RAF', ['DSCF1234.JPG', 'DSCF1234.HIF'], 'dscf1234'],
  ['Olympus / OM System', 'P1011234.ORF', ['P1011234.JPG'], 'p1011234'],
  ['Olympus, October to December', 'PA011234.ORF', ['PA011234.JPG'], 'pa011234'],
  ['Olympus, Adobe RGB', '_1011234.ORF', ['_1011234.JPG'], '_1011234'],
  ['Panasonic', 'P1001234.RW2', ['P1001234.JPG'], 'p1001234'],
  ['Pentax', 'IMGP1234.PEF', ['IMGP1234.JPG'], 'imgp1234'],
  ['Pentax, DNG', 'IMGP1234.DNG', ['IMGP1234.JPG'], 'imgp1234'],
  ['Leica', 'L1001234.DNG', ['L1001234.JPG'], 'l1001234'],
  ['Ricoh GR', 'R0001234.DNG', ['R0001234.JPG'], 'r0001234'],
  ['Sigma', 'SDIM1234.X3F', ['SDIM1234.JPG'], 'sdim1234'],
  ['Hasselblad', 'B0001234.3FR', ['B0001234.JPG'], 'b0001234'],
  ['DJI', 'DJI_0123.DNG', ['DJI_0123.JPG'], 'dji_0123'],
  ['GoPro', 'GOPR1234.GPR', ['GOPR1234.JPG'], 'gopr1234'],
  ['iPhone', 'IMG_9443.DNG', ['IMG_9443.HEIC', 'IMG_9443.JPG', 'IMG_9443.heic'], 'img_9443'],
  ['Samsung', '20231005_123456.dng', ['20231005_123456.jpg', '20231005_123456.heic'], '20231005_123456'],
  ['Xiaomi', 'IMG_20190504_123456.dng', ['IMG_20190504_123456.jpg'], 'img_20190504_123456'],
  ['Huawei', 'IMG_20190504_123456.dng', ['IMG_20190504_123456.jpg'], 'img_20190504_123456'],
  ['OnePlus', 'IMG20230115123456.dng', ['IMG20230115123456.jpg'], 'img20230115123456'],
  [
    'Google Pixel',
    'PXL_20261019_122824927.RAW-02.ORIGINAL.dng',
    ['PXL_20261019_122824927.RAW-01.COVER.jpg'],
    'pxl_20261019_122824927',
  ],
  ['Google Pixel, older', 'PXL_20201019_122824927.dng', ['PXL_20201019_122824927.jpg'], 'pxl_20201019_122824927'],
];

/** The same name with its last digit changed: the frame before or after. */
const next = (name: string) => name.replace(/(\d)(\D*)$/, (_all, digit, rest) => `${(Number(digit) + 1) % 10}${rest}`);

describe('shotBase: the name a device gave a shot', () => {
  it.each(SHOTS)('%s: the RAW and the camera’s picture come to the same name', (_maker, raw, pictures, base) => {
    expect(shotBase(raw)).toBe(base);
    for (const picture of pictures) {
      expect(shotBase(picture)).toBe(base);
      expect(sameShotName(raw, picture)).toBe(true);
    }
  });

  it.each(SHOTS)('%s: the next frame has another name', (_maker, raw, pictures) => {
    const extension = raw.slice(raw.lastIndexOf('.'));
    const stem = raw.slice(0, raw.length - extension.length).replace(/\.RAW-02\.ORIGINAL$/, '');
    const neighbour = `${next(stem)}${extension}`;
    expect(shotBase(neighbour)).not.toBe(shotBase(raw));
    for (const picture of pictures) {
      expect(sameShotName(neighbour, picture)).toBe(false);
    }
  });

  it('strips the labels a Pixel puts after the name', () => {
    const base = 'pxl_20261027_215742060';
    for (const label of [
      '',
      '.RAW-01.COVER',
      '.RAW-02.ORIGINAL',
      '.NIGHT',
      '.PORTRAIT',
      '.MP',
      '.PANO',
      '.LONG_EXPOSURE-01.COVER',
      '.LONG_EXPOSURE-02.ORIGINAL',
      '.LONG_EXPOSURE',
      '.MOTION-01.COVER',
      '.ACTION_PAN-01.COVER',
      '.ACTION_PAN-02.ORIGINAL',
      '.MACRO_FOCUS.RAW-01.COVER',
      '.NIGHT.RAW-01.COVER',
      '.PORTRAIT.ORIGINAL',
      '.TS',
    ]) {
      expect(shotBase(`PXL_20261027_215742060${label}.jpg`)).toBe(base);
    }
  });

  it('keeps what a person or a program added after a Pixel’s labels', () => {
    const base = 'pxl_20261027_215742060';
    for (const added of [
      // a copy number, as an importer or a download adds one
      '.RAW-01.COVER_1',
      '.RAW-01.COVER-2',
      '.RAW-01.COVER (1)',
      '.RAW-01.COVER~2',
      // a merge made from the shot
      '.RAW-02.ORIGINAL-HDR',
      '.RAW-02.ORIGINAL-Pano',
      '.RAW-02.ORIGINAL-Enhanced-NR',
      // in the shape of a label, and none of the phone's
      '.RAW-01.COVER-02',
      '.RAW-01.COVER_HDR',
      '.RAW-02.ORIGINAL.HDR',
      '.RAW-01.COVER.EDITED',
    ]) {
      expect(shotBase(`PXL_20261027_215742060${added}.jpg`)).not.toBe(base);
      expect(sameShotName(`PXL_20261027_215742060${added}.jpg`, 'PXL_20261027_215742060.RAW-02.ORIGINAL.dng')).toBe(
        false,
      );
    }
  });

  it('strips them in any case, and only from a name of that shape', () => {
    // a tool that lower-cased the names
    expect(shotBase('pxl_20261027_215742060.raw-01.cover.jpg')).toBe('pxl_20261027_215742060');
    expect(sameShotName('pxl_20261027_215742060.raw-01.cover.jpg', 'pxl_20261027_215742060.raw-02.original.dng')).toBe(
      true,
    );
    // in a name a person gave, a dot is part of the name
    expect(shotBase('trip.A.dng')).toBe('trip.a');
    expect(sameShotName('trip.A.dng', 'trip.B.jpg')).toBe(false);
    expect(shotBase('2026.10.19.LAKE.jpg')).toBe('2026.10.19.lake');
    // an extension left inside a name stays where it is
    expect(shotBase('P1011234.JPG-1.jpg')).toBe('p1011234.jpg-1');
  });

  it('keeps what tells frames and files apart', () => {
    // the frames of a burst
    expect(shotBase('IMG_20190504_123456_BURST1.jpg')).not.toBe(shotBase('IMG_20190504_123456_BURST2.jpg'));
    expect(shotBase('IMG_20190504_123456_BURST1.jpg')).not.toBe(shotBase('IMG_20190504_123456.jpg'));
    // a second shot in the same second, as some phones name it
    expect(shotBase('IMG_20190504_123456_1.jpg')).not.toBe(shotBase('IMG_20190504_123456.jpg'));
    // a phone's own HDR variant is another file, not the same one
    expect(shotBase('IMG_20190504_123456_HDR.jpg')).not.toBe(shotBase('IMG_20190504_123456.jpg'));
    // a copy is not the camera's file of the shot
    expect(shotBase('IMG_9443 (1).jpg')).not.toBe(shotBase('IMG_9443.jpg'));
    expect(shotBase('Copy of IMG_9443.jpg')).not.toBe(shotBase('IMG_9443.jpg'));
    expect(shotBase('Копия P1011234.JPG')).not.toBe(shotBase('P1011234.JPG'));
    expect(shotBase('IMG_1234-2.JPG')).not.toBe(shotBase('IMG_1234.JPG'));
    // a counter is never cut out of a name
    expect(shotBase('DSC_9425.JPG')).toBe('dsc_9425');
    expect(shotBase('DSC_9425.JPG')).not.toBe(shotBase('DSC_9426.JPG'));
    expect(shotBase('DSC_9425.JPG')).not.toBe(shotBase('DSC_942.JPG'));
  });

  it('leaves a name a person gave as it is, in lower case', () => {
    expect(shotBase('lake.jpeg')).toBe('lake');
    expect(shotBase('2026.10.19 lake.jpg')).toBe('2026.10.19 lake');
    expect(shotBase('Grandma & the Dog.JPG')).toBe('grandma & the dog');
    expect(shotBase('Изображение 123.jpg')).toBe('изображение 123');
    expect(shotBase('2026-10-19.jpg')).toBe('2026-10-19');
    expect(shotBase('123.JPG')).toBe('123');
  });

  it('never comes out empty', () => {
    expect(shotBase('.jpg')).toBe('.jpg');
    expect(shotBase('.RAW-01.COVER.jpg')).toBe('.raw-01.cover');
    expect(shotBase('PXL_.jpg')).toBe('pxl_');
    expect(shotBase('noextension')).toBe('noextension');
    expect(shotBase('archive.tar.gz')).toBe('archive.tar');
  });
});

describe('editSourceBase and hasEditMark: a name that marks an edit', () => {
  it.each([
    ['DSC_9425-edit.jpg', 'dsc_9425'],
    ['DSC_9425-Edit.jpg', 'dsc_9425'],
    ['DSC_9425_edit.jpg', 'dsc_9425'],
    ['DSC_9425 edit.jpg', 'dsc_9425'],
    ['DSC_9425-edited.jpg', 'dsc_9425'],
    ['DSC_9425_edited.tif', 'dsc_9425'],
    // Lightroom numbers a second export of the same name
    ['DSC_9425-Edit-2.jpg', 'dsc_9425'],
    ['DSC_9425-edit_3.jpg', 'dsc_9425'],
    ['DSC_9425-edit2.jpg', 'dsc_9425'],
    // the mark comes off before the device's label does
    ['PXL_20261027_215742060.PORTRAIT-edit.jpg', 'pxl_20261027_215742060'],
    // an iPhone's edited copy
    ['IMG_E9443.JPG', 'img_9443'],
    ['IMG_E9443.HEIC', 'img_9443'],
    ['IMG_E12345.JPG', 'img_12345'],
  ])('%s is an edit of %s', (fileName, source) => {
    expect(editSourceBase(fileName)).toBe(source);
    expect(hasEditMark(fileName)).toBe(true);
    expect(searchNames(fileName)).toEqual([shotBase(fileName), source]);
  });

  it.each([
    'DSC_9425.JPG',
    'DSC_9425.NEF',
    'IMG_9443.HEIC',
    'PXL_20261019_122824927.RAW-01.COVER.jpg',
    // a number or a copy mark alone is no edit
    'IMG_1234-2.JPG',
    'IMG_9443 (1).jpg',
    'Copy of IMG_9443.jpg',
    'IMG_20190504_123456_1.jpg',
    // what a device adds is no edit
    'IMG_20190504_123456_HDR.jpg',
    'IMG_20190504_123456_BURST1.jpg',
    'PXL_20261027_215742060.NIGHT.jpg',
    // any program's output, a merge as well: no edit of the file it is named after
    'P1011234_result.JPG',
    '123_result.JPG',
    // a copy as often as an edit
    'PXL_20261027_215742060~2.jpg',
    'PXL_20261027_215742060.PORTRAIT~3.jpg',
    'photo~2.jpg',
    // words that only contain "edit"
    'credit.jpg',
    'reedit.jpg',
    'edit.jpg',
    // an iPhone name with a letter that is not the edit mark
    'IMG_1234.JPG',
  ])('%s carries no edit mark', (fileName) => {
    expect(editSourceBase(fileName)).toBeNull();
    expect(hasEditMark(fileName)).toBe(false);
    expect(searchNames(fileName)[0]).toBe(shotBase(fileName));
  });

  it.each([
    ['IMG_1234.JPG', ['img_1234', 'img_e1234']],
    ['IMG_9443.HEIC', ['img_9443', 'img_e9443']],
    ['IMG_12345.JPG', ['img_12345', 'img_e12345']],
    // other names are searched by their own alone
    ['DSC_9425.JPG', ['dsc_9425']],
    ['IMG_20190504_123456_1.jpg', ['img_20190504_123456_1']],
    ['IMG_1234-2.JPG', ['img_1234-2']],
  ])('%s is searched by %j: an iPhone shot also by the name of its edited copy', (fileName, names) => {
    expect(searchNames(fileName)).toEqual(names);
  });
});

describe('namedAfter: an edit and the file it was made from, by their names', () => {
  it.each(SHOTS)('%s: an edit named after the shot goes with its RAW and its picture', (_maker, raw, pictures) => {
    const stem = raw.slice(0, raw.lastIndexOf('.')).replace(/\.RAW-02\.ORIGINAL$/, '');
    for (const edit of [`${stem}-edit.jpg`, `${stem}_edited.jpg`, `${stem}-Edit-2.jpg`]) {
      expect(namedAfter(edit, raw)).toBe(true);
      for (const picture of pictures) {
        expect(namedAfter(edit, picture)).toBe(true);
      }
    }
  });

  it('holds for an export saved under the very name of its source', () => {
    expect(namedAfter('DSC_9425.jpg', 'DSC_9425.NEF')).toBe(true);
    expect(namedAfter('DSC_9425.tif', 'DSC_9425.JPG')).toBe(true);
  });

  it('holds for an iPhone’s edited copy', () => {
    expect(namedAfter('IMG_E9443.JPG', 'IMG_9443.HEIC')).toBe(true);
  });

  it('does not hold for a copy mark or a program’s output name', () => {
    expect(namedAfter('PXL_20261027_215742060~2.jpg', 'PXL_20261027_215742060.jpg')).toBe(false);
    expect(namedAfter('PXL_20261027_215742060~2.jpg', 'PXL_20261027_215742060.RAW-02.ORIGINAL.dng')).toBe(false);
    expect(namedAfter('photo~2.jpg', 'photo.jpg')).toBe(false);
    expect(namedAfter('P1011234_result.JPG', 'P1011234.ORF')).toBe(false);
  });

  it('does not hold for another frame, a copy, or a name that only starts alike', () => {
    expect(namedAfter('DSC_9425-edit.jpg', 'DSC_9426.NEF')).toBe(false);
    expect(namedAfter('DSC_9425-edit.jpg', 'DSC_942.NEF')).toBe(false);
    expect(namedAfter('DSC_94250-edit.jpg', 'DSC_9425.NEF')).toBe(false);
    expect(namedAfter('IMG_9443 (1).jpg', 'IMG_9443.DNG')).toBe(false);
    expect(namedAfter('lake.jpg', 'DSC_9425.NEF')).toBe(false);
    // the source is named after nothing: the relation runs one way
    expect(namedAfter('DSC_9425.NEF', 'DSC_9425-edit.jpg')).toBe(false);
  });
});
