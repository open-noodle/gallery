import { ExifDateTime } from 'exiftool-vendored';
import {
  getGoogleTakeoutJsonCandidates,
  GoogleTakeoutMetadata,
  googleTakeoutToImmichTags,
  isGoogleTakeoutJsonSidecar,
  parseGoogleTakeoutJson,
} from 'src/utils/google-takeout';

describe('parseGoogleTakeoutJson', () => {
  it('should parse valid Google Takeout JSON', () => {
    const json = JSON.stringify({
      title: 'IMG_1234.jpg',
      description: 'A nice photo',
      photoTakenTime: { timestamp: '1609459200', formatted: 'Jan 1, 2021, 12:00:00 AM UTC' },
      geoData: { latitude: 40.7128, longitude: -74.006, altitude: 10 },
    });

    const result = parseGoogleTakeoutJson(json);
    expect(result).not.toBeNull();
    expect(result!.title).toBe('IMG_1234.jpg');
    expect(result!.description).toBe('A nice photo');
    expect(result!.photoTakenTime?.timestamp).toBe('1609459200');
    expect(result!.geoData?.latitude).toBe(40.7128);
  });

  it('should return null for invalid JSON', () => {
    expect(parseGoogleTakeoutJson('not json')).toBeNull();
    expect(parseGoogleTakeoutJson('')).toBeNull();
    expect(parseGoogleTakeoutJson('{invalid}')).toBeNull();
  });

  it('should return null for non-object JSON values', () => {
    expect(parseGoogleTakeoutJson('"just a string"')).toBeNull();
    expect(parseGoogleTakeoutJson('42')).toBeNull();
    expect(parseGoogleTakeoutJson('true')).toBeNull();
    expect(parseGoogleTakeoutJson('null')).toBeNull();
    expect(parseGoogleTakeoutJson('[1, 2, 3]')).toBeNull();
  });

  it('should handle empty object', () => {
    const result = parseGoogleTakeoutJson('{}');
    expect(result).toEqual({});
  });

  it('should handle JSON with only some fields populated', () => {
    const json = JSON.stringify({ title: 'photo.jpg', favorited: true });
    const result = parseGoogleTakeoutJson(json);
    expect(result).not.toBeNull();
    expect(result!.title).toBe('photo.jpg');
    expect(result!.favorited).toBe(true);
    expect(result!.description).toBeUndefined();
  });

  it('should parse a real-world Google Takeout JSON', () => {
    const json = JSON.stringify({
      title: 'PXL_20210315_143022345.jpg',
      description: '',
      imageViews: '0',
      creationTime: { timestamp: '1615818622', formatted: 'Mar 15, 2021, 2:30:22 PM UTC' },
      photoTakenTime: { timestamp: '1615818622', formatted: 'Mar 15, 2021, 2:30:22 PM UTC' },
      geoData: { latitude: 37.7749, longitude: -122.4194, altitude: 0 },
      geoDataExif: { latitude: 37.7749, longitude: -122.4194, altitude: 0 },
      photoLastModifiedTime: { timestamp: '1615820000', formatted: 'Mar 15, 2021, 2:53:20 PM UTC' },
      url: 'https://photos.google.com/photo/some-id',
      googlePhotosOrigin: { mobileUpload: { deviceType: 'ANDROID_PHONE' } },
      favorited: false,
      people: [{ name: 'John Doe' }],
    });

    const result = parseGoogleTakeoutJson(json);
    expect(result).not.toBeNull();
    expect(result!.photoTakenTime?.timestamp).toBe('1615818622');
    expect(result!.geoData?.latitude).toBe(37.7749);
    expect(result!.people).toHaveLength(1);
    expect(result!.people![0].name).toBe('John Doe');
  });
});

describe('googleTakeoutToImmichTags', () => {
  it('should convert photoTakenTime to DateTimeOriginal', () => {
    const metadata: GoogleTakeoutMetadata = {
      photoTakenTime: { timestamp: '1609459200' }, // 2021-01-01T00:00:00Z
    };

    const tags = googleTakeoutToImmichTags(metadata);
    expect(tags.DateTimeOriginal).toBeDefined();
    expect(tags.DateTimeOriginal).toBeInstanceOf(ExifDateTime);
    const exifDate = tags.DateTimeOriginal as ExifDateTime;
    expect(exifDate.year).toBe(2021);
    expect(exifDate.month).toBe(1);
    expect(exifDate.day).toBe(1);
  });

  it('should fall back to creationTime when photoTakenTime is missing', () => {
    const metadata: GoogleTakeoutMetadata = {
      creationTime: { timestamp: '1609459200' },
    };

    const tags = googleTakeoutToImmichTags(metadata);
    expect(tags.DateTimeOriginal).toBeDefined();
    expect(tags.DateTimeOriginal).toBeInstanceOf(ExifDateTime);
  });

  it('should prefer photoTakenTime over creationTime', () => {
    const metadata: GoogleTakeoutMetadata = {
      photoTakenTime: { timestamp: '1609459200' }, // 2021-01-01
      creationTime: { timestamp: '1577836800' }, // 2020-01-01
    };

    const tags = googleTakeoutToImmichTags(metadata);
    const exifDate = tags.DateTimeOriginal as ExifDateTime;
    expect(exifDate.year).toBe(2021);
  });

  it('should not set DateTimeOriginal for invalid timestamps', () => {
    expect(googleTakeoutToImmichTags({ photoTakenTime: { timestamp: 'abc' } }).DateTimeOriginal).toBeUndefined();
    expect(googleTakeoutToImmichTags({ photoTakenTime: { timestamp: '0' } }).DateTimeOriginal).toBeUndefined();
    expect(googleTakeoutToImmichTags({ photoTakenTime: { timestamp: '-1' } }).DateTimeOriginal).toBeUndefined();
    expect(googleTakeoutToImmichTags({ photoTakenTime: {} }).DateTimeOriginal).toBeUndefined();
  });

  it('should convert GPS coordinates from geoData', () => {
    const metadata: GoogleTakeoutMetadata = {
      geoData: { latitude: 40.7128, longitude: -74.006, altitude: 10 },
    };

    const tags = googleTakeoutToImmichTags(metadata);
    expect(tags.GPSLatitude).toBe(40.7128);
    expect(tags.GPSLongitude).toBe(-74.006);
    expect(tags.GPSAltitude).toBe(10);
  });

  it('should fall back to geoDataExif when geoData is missing', () => {
    const metadata: GoogleTakeoutMetadata = {
      geoDataExif: { latitude: 51.5074, longitude: -0.1278 },
    };

    const tags = googleTakeoutToImmichTags(metadata);
    expect(tags.GPSLatitude).toBe(51.5074);
    expect(tags.GPSLongitude).toBe(-0.1278);
  });

  it('should ignore GPS coordinates of (0, 0) as Google uses this for missing data', () => {
    const metadata: GoogleTakeoutMetadata = {
      geoData: { latitude: 0, longitude: 0, altitude: 0 },
    };

    const tags = googleTakeoutToImmichTags(metadata);
    expect(tags.GPSLatitude).toBeUndefined();
    expect(tags.GPSLongitude).toBeUndefined();
  });

  it('should ignore GPS with only latitude of 0', () => {
    const metadata: GoogleTakeoutMetadata = {
      geoData: { latitude: 0, longitude: 10 },
    };

    // Latitude 0, longitude 10 is a valid coordinate (Gulf of Guinea)
    const tags = googleTakeoutToImmichTags(metadata);
    expect(tags.GPSLatitude).toBe(0);
    expect(tags.GPSLongitude).toBe(10);
  });

  it('should reject out-of-range GPS coordinates', () => {
    expect(googleTakeoutToImmichTags({ geoData: { latitude: 91, longitude: 0 } }).GPSLatitude).toBeUndefined();
    expect(googleTakeoutToImmichTags({ geoData: { latitude: 0, longitude: 181 } }).GPSLongitude).toBeUndefined();
    expect(googleTakeoutToImmichTags({ geoData: { latitude: -91, longitude: 0 } }).GPSLatitude).toBeUndefined();
  });

  it('should not set GPSAltitude when altitude is 0', () => {
    const metadata: GoogleTakeoutMetadata = {
      geoData: { latitude: 40.7128, longitude: -74.006, altitude: 0 },
    };

    const tags = googleTakeoutToImmichTags(metadata);
    expect(tags.GPSAltitude).toBeUndefined();
  });

  it('should convert description', () => {
    const metadata: GoogleTakeoutMetadata = {
      description: 'Beautiful sunset over the ocean',
    };

    const tags = googleTakeoutToImmichTags(metadata);
    expect(tags.ImageDescription).toBe('Beautiful sunset over the ocean');
    expect(tags.Description).toBe('Beautiful sunset over the ocean');
  });

  it('should ignore empty or whitespace-only descriptions', () => {
    expect(googleTakeoutToImmichTags({ description: '' }).ImageDescription).toBeUndefined();
    expect(googleTakeoutToImmichTags({ description: '   ' }).ImageDescription).toBeUndefined();
  });

  it('should trim description whitespace', () => {
    const tags = googleTakeoutToImmichTags({ description: '  hello world  ' });
    expect(tags.ImageDescription).toBe('hello world');
  });

  it('should return empty tags for empty metadata', () => {
    const tags = googleTakeoutToImmichTags({});
    expect(Object.keys(tags)).toHaveLength(0);
  });

  it('should handle a complete metadata object', () => {
    const metadata: GoogleTakeoutMetadata = {
      title: 'IMG_1234.jpg',
      description: 'Family photo',
      photoTakenTime: { timestamp: '1609459200' },
      geoData: { latitude: 48.8566, longitude: 2.3522, altitude: 35 },
      favorited: true,
      archived: false,
    };

    const tags = googleTakeoutToImmichTags(metadata);
    expect(tags.DateTimeOriginal).toBeInstanceOf(ExifDateTime);
    expect(tags.GPSLatitude).toBe(48.8566);
    expect(tags.GPSLongitude).toBe(2.3522);
    expect(tags.GPSAltitude).toBe(35);
    expect(tags.ImageDescription).toBe('Family photo');
  });

  it('should handle negative altitude', () => {
    const metadata: GoogleTakeoutMetadata = {
      geoData: { latitude: 31.5, longitude: 35.5, altitude: -430 }, // Dead Sea
    };

    const tags = googleTakeoutToImmichTags(metadata);
    expect(tags.GPSAltitude).toBe(-430);
  });
});

describe('getGoogleTakeoutJsonCandidates', () => {
  it('should generate both old and new format candidates', () => {
    const candidates = getGoogleTakeoutJsonCandidates('/path/to/IMG_1234.jpg');
    expect(candidates).toEqual(['/path/to/IMG_1234.jpg.json', '/path/to/IMG_1234.jpg.supplemental-metadata.json']);
  });

  it('should work with various file extensions', () => {
    for (const ext of ['png', 'mp4', 'heic']) {
      const candidates = getGoogleTakeoutJsonCandidates(`/path/photo.${ext}`);
      expect(candidates).toContain(`/path/photo.${ext}.json`);
      expect(candidates).toContain(`/path/photo.${ext}.supplemental-metadata.json`);
    }
  });

  it('should handle paths with spaces', () => {
    const candidates = getGoogleTakeoutJsonCandidates('/path/to/My Photo Album/IMG 1234.jpg');
    expect(candidates).toContain('/path/to/My Photo Album/IMG 1234.jpg.json');
    expect(candidates).toContain('/path/to/My Photo Album/IMG 1234.jpg.supplemental-metadata.json');
  });

  it('should handle paths with special characters', () => {
    const candidates = getGoogleTakeoutJsonCandidates('/path/to/photo (1).jpg');
    expect(candidates).toContain('/path/to/photo (1).jpg.json');
    expect(candidates).toContain('/path/to/photo (1).jpg.supplemental-metadata.json');
  });

  it('should list old format before new format (prefer old)', () => {
    const candidates = getGoogleTakeoutJsonCandidates('/path/to/photo.jpg');
    expect(candidates[0]).toBe('/path/to/photo.jpg.json');
    expect(candidates[1]).toBe('/path/to/photo.jpg.supplemental-metadata.json');
  });
});

describe('isGoogleTakeoutJsonSidecar', () => {
  it('should detect old format .json sidecar', () => {
    expect(isGoogleTakeoutJsonSidecar('/path/to/IMG_1234.jpg.json')).toBe(true);
  });

  it('should detect new format .supplemental-metadata.json sidecar', () => {
    expect(isGoogleTakeoutJsonSidecar('/path/to/IMG_1234.jpg.supplemental-metadata.json')).toBe(true);
  });

  it('should not match XMP sidecars', () => {
    expect(isGoogleTakeoutJsonSidecar('/path/to/IMG_1234.jpg.xmp')).toBe(false);
    expect(isGoogleTakeoutJsonSidecar('/path/to/IMG_1234.xmp')).toBe(false);
  });
});
