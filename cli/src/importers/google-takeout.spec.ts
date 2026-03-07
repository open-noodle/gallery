import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

import {
  findGoogleTakeoutSidecar,
  getAlbumNameFromTakeout,
  pairLivePhoto,
  parseGoogleTakeoutMetadata,
} from 'src/importers/google-takeout';

describe('parseGoogleTakeoutMetadata', () => {
  let testDir: string;

  beforeEach(() => {
    testDir = fs.mkdtempSync(path.join(os.tmpdir(), 'test-takeout-'));
  });

  afterEach(() => {
    fs.rmSync(testDir, { recursive: true, force: true });
  });

  it('should parse a complete Google Takeout JSON sidecar', async () => {
    const jsonPath = path.join(testDir, 'photo.jpg.json');
    fs.writeFileSync(
      jsonPath,
      JSON.stringify({
        title: 'photo.jpg',
        description: 'A beautiful sunset',
        photoTakenTime: {
          timestamp: '1609459200',
          formatted: 'Jan 1, 2021, 12:00:00 AM UTC',
        },
        geoData: {
          latitude: 37.7749,
          longitude: -122.4194,
          altitude: 10,
        },
        geoDataExif: {
          latitude: 37.7749,
          longitude: -122.4194,
          altitude: 10,
        },
        favorited: true,
        archived: false,
      }),
    );

    const metadata = await parseGoogleTakeoutMetadata(jsonPath);
    expect(metadata).toEqual({
      title: 'photo.jpg',
      description: 'A beautiful sunset',
      dateTimeOriginal: new Date(1_609_459_200_000),
      latitude: 37.7749,
      longitude: -122.4194,
      isFavorite: true,
      isArchived: false,
    });
  });

  it('should handle missing optional fields', async () => {
    const jsonPath = path.join(testDir, 'photo.jpg.json');
    fs.writeFileSync(
      jsonPath,
      JSON.stringify({
        title: 'photo.jpg',
        photoTakenTime: {
          timestamp: '1609459200',
        },
      }),
    );

    const metadata = await parseGoogleTakeoutMetadata(jsonPath);
    expect(metadata).toEqual({
      title: 'photo.jpg',
      description: undefined,
      dateTimeOriginal: new Date(1_609_459_200_000),
      latitude: undefined,
      longitude: undefined,
      isFavorite: false,
      isArchived: false,
    });
  });

  it('should handle zero GPS coordinates (valid location)', async () => {
    const jsonPath = path.join(testDir, 'photo.jpg.json');
    fs.writeFileSync(
      jsonPath,
      JSON.stringify({
        title: 'photo.jpg',
        photoTakenTime: { timestamp: '1609459200' },
        geoData: { latitude: 0, longitude: 0, altitude: 0 },
      }),
    );

    const metadata = await parseGoogleTakeoutMetadata(jsonPath);
    // (0,0) is in the ocean — Google Takeout uses 0,0 to mean "no location"
    expect(metadata!.latitude).toBeUndefined();
    expect(metadata!.longitude).toBeUndefined();
  });

  it('should handle non-zero GPS coordinates', async () => {
    const jsonPath = path.join(testDir, 'photo.jpg.json');
    fs.writeFileSync(
      jsonPath,
      JSON.stringify({
        title: 'photo.jpg',
        photoTakenTime: { timestamp: '1609459200' },
        geoData: { latitude: 51.5074, longitude: -0.1278, altitude: 0 },
      }),
    );

    const metadata = await parseGoogleTakeoutMetadata(jsonPath);
    expect(metadata!.latitude).toBe(51.5074);
    expect(metadata!.longitude).toBe(-0.1278);
  });

  it('should handle missing photoTakenTime', async () => {
    const jsonPath = path.join(testDir, 'photo.jpg.json');
    fs.writeFileSync(
      jsonPath,
      JSON.stringify({
        title: 'photo.jpg',
        creationTime: { timestamp: '1609459200' },
      }),
    );

    const metadata = await parseGoogleTakeoutMetadata(jsonPath);
    // Should fall back to creationTime
    expect(metadata!.dateTimeOriginal).toEqual(new Date(1_609_459_200_000));
  });

  it('should return undefined for non-existent file', async () => {
    const metadata = await parseGoogleTakeoutMetadata(path.join(testDir, 'nonexistent.json'));
    expect(metadata).toBeUndefined();
  });

  it('should return undefined for invalid JSON', async () => {
    const jsonPath = path.join(testDir, 'invalid.json');
    fs.writeFileSync(jsonPath, 'not valid json{{{');

    const metadata = await parseGoogleTakeoutMetadata(jsonPath);
    expect(metadata).toBeUndefined();
  });

  it('should handle favorited as boolean false', async () => {
    const jsonPath = path.join(testDir, 'photo.jpg.json');
    fs.writeFileSync(
      jsonPath,
      JSON.stringify({
        title: 'photo.jpg',
        photoTakenTime: { timestamp: '1609459200' },
        favorited: false,
      }),
    );

    const metadata = await parseGoogleTakeoutMetadata(jsonPath);
    expect(metadata!.isFavorite).toBe(false);
  });

  it('should handle archived as boolean true', async () => {
    const jsonPath = path.join(testDir, 'photo.jpg.json');
    fs.writeFileSync(
      jsonPath,
      JSON.stringify({
        title: 'photo.jpg',
        photoTakenTime: { timestamp: '1609459200' },
        archived: true,
      }),
    );

    const metadata = await parseGoogleTakeoutMetadata(jsonPath);
    expect(metadata!.isArchived).toBe(true);
  });
});

describe('findGoogleTakeoutSidecar', () => {
  let testDir: string;

  beforeEach(() => {
    testDir = fs.mkdtempSync(path.join(os.tmpdir(), 'test-takeout-sidecar-'));
  });

  afterEach(() => {
    fs.rmSync(testDir, { recursive: true, force: true });
  });

  it('should find sidecar with .json extension appended to filename', () => {
    const mediaPath = path.join(testDir, 'photo.jpg');
    const sidecarPath = path.join(testDir, 'photo.jpg.json');
    fs.writeFileSync(mediaPath, 'media');
    fs.writeFileSync(sidecarPath, '{}');

    expect(findGoogleTakeoutSidecar(mediaPath)).toBe(sidecarPath);
  });

  it('should return undefined when no sidecar exists', () => {
    const mediaPath = path.join(testDir, 'photo.jpg');
    fs.writeFileSync(mediaPath, 'media');

    expect(findGoogleTakeoutSidecar(mediaPath)).toBeUndefined();
  });

  it('should handle truncated filenames by matching prefix', () => {
    // Google Takeout truncates filenames at 47 characters
    const longName = 'a_very_long_filename_that_exceeds_the_limit_of_47_characters.jpg';
    const truncatedName = 'a_very_long_filename_that_exceeds_the_limit_of_';
    const mediaPath = path.join(testDir, longName);
    const sidecarPath = path.join(testDir, `${truncatedName}.json`);
    fs.writeFileSync(mediaPath, 'media');
    fs.writeFileSync(sidecarPath, '{}');

    expect(findGoogleTakeoutSidecar(mediaPath)).toBe(sidecarPath);
  });

  it('should find sidecar with .json replacing extension', () => {
    // Some Takeout exports use photo.json instead of photo.jpg.json
    const mediaPath = path.join(testDir, 'photo.jpg');
    const sidecarPath = path.join(testDir, 'photo.json');
    fs.writeFileSync(mediaPath, 'media');
    fs.writeFileSync(sidecarPath, '{}');

    expect(findGoogleTakeoutSidecar(mediaPath)).toBe(sidecarPath);
  });

  it('should prefer .ext.json over .json when both exist', () => {
    const mediaPath = path.join(testDir, 'photo.jpg');
    const sidecar1 = path.join(testDir, 'photo.jpg.json');
    const sidecar2 = path.join(testDir, 'photo.json');
    fs.writeFileSync(mediaPath, 'media');
    fs.writeFileSync(sidecar1, '{"preferred": true}');
    fs.writeFileSync(sidecar2, '{"preferred": false}');

    expect(findGoogleTakeoutSidecar(mediaPath)).toBe(sidecar1);
  });

  it('should handle files with multiple dots in name', () => {
    const mediaPath = path.join(testDir, 'photo.edit.final.jpg');
    const sidecarPath = path.join(testDir, 'photo.edit.final.jpg.json');
    fs.writeFileSync(mediaPath, 'media');
    fs.writeFileSync(sidecarPath, '{}');

    expect(findGoogleTakeoutSidecar(mediaPath)).toBe(sidecarPath);
  });

  it('should handle edited photo suffix pattern', () => {
    // Google Takeout adds "-edited" to edited versions but may share the same JSON
    const mediaPath = path.join(testDir, 'photo-edited.jpg');
    const sidecarPath = path.join(testDir, 'photo-edited.jpg.json');
    fs.writeFileSync(mediaPath, 'media');
    fs.writeFileSync(sidecarPath, '{}');

    expect(findGoogleTakeoutSidecar(mediaPath)).toBe(sidecarPath);
  });

  it('should handle numbered suffix pattern from Takeout dedup', () => {
    // Google Takeout adds (1), (2) etc. for duplicate filenames
    const mediaPath = path.join(testDir, 'photo(1).jpg');
    const sidecarPath = path.join(testDir, 'photo(1).jpg.json');
    fs.writeFileSync(mediaPath, 'media');
    fs.writeFileSync(sidecarPath, '{}');

    expect(findGoogleTakeoutSidecar(mediaPath)).toBe(sidecarPath);
  });
});

describe('getAlbumNameFromTakeout', () => {
  it('should extract album name from standard Takeout folder structure', () => {
    // Takeout/Google Photos/Album Name/photo.jpg
    const filepath = '/data/Takeout/Google Photos/Summer Vacation 2023/photo.jpg';
    const takeoutRoot = '/data/Takeout/Google Photos';

    expect(getAlbumNameFromTakeout(filepath, takeoutRoot)).toBe('Summer Vacation 2023');
  });

  it('should return undefined for files directly in Google Photos root', () => {
    const filepath = '/data/Takeout/Google Photos/photo.jpg';
    const takeoutRoot = '/data/Takeout/Google Photos';

    expect(getAlbumNameFromTakeout(filepath, takeoutRoot)).toBeUndefined();
  });

  it('should handle nested subfolders by returning top-level album', () => {
    // Files in nested subfolders should still map to the album folder
    const filepath = '/data/Takeout/Google Photos/Trip/subfolder/photo.jpg';
    const takeoutRoot = '/data/Takeout/Google Photos';

    expect(getAlbumNameFromTakeout(filepath, takeoutRoot)).toBe('Trip');
  });

  it('should handle Photos from YYYY pattern as no album', () => {
    // "Photos from 2023" is not a real album, it's the auto-generated date folder
    const filepath = '/data/Takeout/Google Photos/Photos from 2023/photo.jpg';
    const takeoutRoot = '/data/Takeout/Google Photos';

    expect(getAlbumNameFromTakeout(filepath, takeoutRoot)).toBeUndefined();
  });

  it('should handle album names with special characters', () => {
    const filepath = "/data/Takeout/Google Photos/Mom's Birthday (2023)/photo.jpg";
    const takeoutRoot = '/data/Takeout/Google Photos';

    expect(getAlbumNameFromTakeout(filepath, takeoutRoot)).toBe("Mom's Birthday (2023)");
  });

  it('should fall back to parent folder name when no takeoutRoot is provided', () => {
    const filepath = '/data/Takeout/Google Photos/Album Name/photo.jpg';

    expect(getAlbumNameFromTakeout(filepath)).toBe('Album Name');
  });
});

describe('pairLivePhoto', () => {
  let testDir: string;

  beforeEach(() => {
    testDir = fs.mkdtempSync(path.join(os.tmpdir(), 'test-livephoto-'));
  });

  afterEach(() => {
    fs.rmSync(testDir, { recursive: true, force: true });
  });

  it('should pair a JPG with its MP4 live photo video', () => {
    const photoPath = path.join(testDir, 'IMG_1234.jpg');
    const videoPath = path.join(testDir, 'IMG_1234.mp4');
    fs.writeFileSync(photoPath, 'photo');
    fs.writeFileSync(videoPath, 'video');

    const allFiles = [photoPath, videoPath];
    expect(pairLivePhoto(photoPath, allFiles)).toBe(videoPath);
  });

  it('should pair a HEIC with its MP4 live photo video', () => {
    const photoPath = path.join(testDir, 'IMG_1234.HEIC');
    const videoPath = path.join(testDir, 'IMG_1234.mp4');
    fs.writeFileSync(photoPath, 'photo');
    fs.writeFileSync(videoPath, 'video');

    const allFiles = [photoPath, videoPath];
    expect(pairLivePhoto(photoPath, allFiles)).toBe(videoPath);
  });

  it('should return undefined for a photo without a video pair', () => {
    const photoPath = path.join(testDir, 'IMG_1234.jpg');
    fs.writeFileSync(photoPath, 'photo');

    const allFiles = [photoPath];
    expect(pairLivePhoto(photoPath, allFiles)).toBeUndefined();
  });

  it('should not pair video files (only pairs photos to videos)', () => {
    const photoPath = path.join(testDir, 'IMG_1234.jpg');
    const videoPath = path.join(testDir, 'IMG_1234.mp4');
    fs.writeFileSync(photoPath, 'photo');
    fs.writeFileSync(videoPath, 'video');

    const allFiles = [photoPath, videoPath];
    // When called with the video file, should return undefined
    expect(pairLivePhoto(videoPath, allFiles)).toBeUndefined();
  });

  it('should handle case-insensitive extension matching', () => {
    const photoPath = path.join(testDir, 'IMG_1234.JPG');
    const videoPath = path.join(testDir, 'IMG_1234.MP4');
    fs.writeFileSync(photoPath, 'photo');
    fs.writeFileSync(videoPath, 'video');

    const allFiles = [photoPath, videoPath];
    expect(pairLivePhoto(photoPath, allFiles)).toBe(videoPath);
  });

  it('should pair with MOV extension as well', () => {
    const photoPath = path.join(testDir, 'IMG_1234.jpg');
    const videoPath = path.join(testDir, 'IMG_1234.mov');
    fs.writeFileSync(photoPath, 'photo');
    fs.writeFileSync(videoPath, 'video');

    const allFiles = [photoPath, videoPath];
    expect(pairLivePhoto(photoPath, allFiles)).toBe(videoPath);
  });

  it('should not pair files from different directories', () => {
    const subDir = path.join(testDir, 'sub');
    fs.mkdirSync(subDir);
    const photoPath = path.join(testDir, 'IMG_1234.jpg');
    const videoPath = path.join(subDir, 'IMG_1234.mp4');
    fs.writeFileSync(photoPath, 'photo');
    fs.writeFileSync(videoPath, 'video');

    const allFiles = [photoPath, videoPath];
    expect(pairLivePhoto(photoPath, allFiles)).toBeUndefined();
  });
});
