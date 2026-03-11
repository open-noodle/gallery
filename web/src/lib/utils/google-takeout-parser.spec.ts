import { parseGoogleTakeoutSidecar } from '$lib/utils/google-takeout-parser';

describe('parseGoogleTakeoutSidecar', () => {
  it('should parse a complete sidecar with all fields', () => {
    const json = JSON.stringify({
      title: 'IMG_1234.jpg',
      description: 'A beautiful sunset',
      photoTakenTime: { timestamp: '1609459200' },
      geoData: { latitude: 48.8566, longitude: 2.3522, altitude: 35.0 },
      favorited: true,
      archived: true,
    });

    const result = parseGoogleTakeoutSidecar(json);

    expect(result).not.toBeNull();
    expect(result!.title).toBe('IMG_1234.jpg');
    expect(result!.description).toBe('A beautiful sunset');
    expect(result!.dateTaken).toEqual(new Date(1_609_459_200_000));
    expect(result!.latitude).toBe(48.8566);
    expect(result!.longitude).toBe(2.3522);
    expect(result!.isFavorite).toBe(true);
    expect(result!.isArchived).toBe(true);
  });

  it('should return null for non-Takeout JSON', () => {
    const json = JSON.stringify({ name: 'not a takeout file', size: 1234 });
    expect(parseGoogleTakeoutSidecar(json)).toBeNull();
  });

  it('should return null for malformed JSON', () => {
    expect(parseGoogleTakeoutSidecar('{not valid json}')).toBeNull();
  });

  it('should return null for empty string', () => {
    expect(parseGoogleTakeoutSidecar('')).toBeNull();
  });

  it('should handle missing optional fields', () => {
    const json = JSON.stringify({
      title: 'IMG_5678.jpg',
      photoTakenTime: { timestamp: '1609459200' },
    });

    const result = parseGoogleTakeoutSidecar(json);

    expect(result).not.toBeNull();
    expect(result!.title).toBe('IMG_5678.jpg');
    expect(result!.description).toBeUndefined();
    expect(result!.dateTaken).toEqual(new Date(1_609_459_200_000));
    expect(result!.latitude).toBeUndefined();
    expect(result!.longitude).toBeUndefined();
    expect(result!.isFavorite).toBe(false);
    expect(result!.isArchived).toBe(false);
  });

  it('should filter GPS (0,0) as no-location', () => {
    const json = JSON.stringify({
      title: 'IMG_9999.jpg',
      photoTakenTime: { timestamp: '1609459200' },
      geoData: { latitude: 0, longitude: 0 },
    });

    const result = parseGoogleTakeoutSidecar(json);

    expect(result).not.toBeNull();
    expect(result!.latitude).toBeUndefined();
    expect(result!.longitude).toBeUndefined();
  });

  it('should fall back to creationTime when photoTakenTime is missing', () => {
    const json = JSON.stringify({
      title: 'IMG_0001.jpg',
      creationTime: { timestamp: '1609545600' },
    });

    const result = parseGoogleTakeoutSidecar(json);

    expect(result).not.toBeNull();
    expect(result!.dateTaken).toEqual(new Date(1_609_545_600_000));
  });

  it('should fall back to geoDataExif when geoData is missing', () => {
    const json = JSON.stringify({
      title: 'IMG_0002.jpg',
      photoTakenTime: { timestamp: '1609459200' },
      geoDataExif: { latitude: 40.7128, longitude: -74.006 },
    });

    const result = parseGoogleTakeoutSidecar(json);

    expect(result).not.toBeNull();
    expect(result!.latitude).toBe(40.7128);
    expect(result!.longitude).toBe(-74.006);
  });

  it('should filter invalid GPS ranges', () => {
    const json = JSON.stringify({
      title: 'IMG_0003.jpg',
      photoTakenTime: { timestamp: '1609459200' },
      geoData: { latitude: 100, longitude: 200 },
    });

    const result = parseGoogleTakeoutSidecar(json);

    expect(result).not.toBeNull();
    expect(result!.latitude).toBeUndefined();
    expect(result!.longitude).toBeUndefined();
  });

  it('should trim whitespace-only descriptions to undefined', () => {
    const json = JSON.stringify({
      title: 'IMG_0004.jpg',
      description: '   \n\t  ',
      photoTakenTime: { timestamp: '1609459200' },
    });

    const result = parseGoogleTakeoutSidecar(json);

    expect(result).not.toBeNull();
    expect(result!.description).toBeUndefined();
  });
});
