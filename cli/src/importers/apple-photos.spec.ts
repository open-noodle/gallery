import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

import {
  findOsxphotosSidecar,
  getAlbumNameFromAppleExport,
  pairAppleLivePhoto,
  parseOsxphotosMetadata,
} from 'src/importers/apple-photos';

describe('parseOsxphotosMetadata', () => {
  let testDir: string;

  beforeEach(() => {
    testDir = fs.mkdtempSync(path.join(os.tmpdir(), 'test-apple-'));
  });

  afterEach(() => {
    fs.rmSync(testDir, { recursive: true, force: true });
  });

  it('should parse a complete osxphotos JSON sidecar', async () => {
    const jsonPath = path.join(testDir, 'IMG_1234.json');
    fs.writeFileSync(
      jsonPath,
      JSON.stringify({
        title: 'Sunset Photo',
        description: 'Beautiful sunset at the beach',
        favorite: true,
        date: '2023-07-15T18:30:00',
        latitude: 34.0195,
        longitude: -118.4912,
        keywords: ['vacation', 'sunset'],
        albums: ['Summer Trip'],
        persons: ['John'],
      }),
    );

    const metadata = await parseOsxphotosMetadata(jsonPath);
    expect(metadata).toEqual({
      title: 'Sunset Photo',
      description: 'Beautiful sunset at the beach',
      isFavorite: true,
      dateTimeOriginal: new Date('2023-07-15T18:30:00'),
      latitude: 34.0195,
      longitude: -118.4912,
      keywords: ['vacation', 'sunset'],
      albums: ['Summer Trip'],
      persons: ['John'],
    });
  });

  it('should handle missing optional fields', async () => {
    const jsonPath = path.join(testDir, 'IMG_1234.json');
    fs.writeFileSync(
      jsonPath,
      JSON.stringify({
        title: 'Photo',
        date: '2023-07-15T18:30:00',
      }),
    );

    const metadata = await parseOsxphotosMetadata(jsonPath);
    expect(metadata).toEqual({
      title: 'Photo',
      description: undefined,
      isFavorite: false,
      dateTimeOriginal: new Date('2023-07-15T18:30:00'),
      latitude: undefined,
      longitude: undefined,
      keywords: [],
      albums: [],
      persons: [],
    });
  });

  it('should return undefined for non-existent file', async () => {
    const metadata = await parseOsxphotosMetadata(path.join(testDir, 'nonexistent.json'));
    expect(metadata).toBeUndefined();
  });

  it('should return undefined for invalid JSON', async () => {
    const jsonPath = path.join(testDir, 'invalid.json');
    fs.writeFileSync(jsonPath, 'not valid json');

    const metadata = await parseOsxphotosMetadata(jsonPath);
    expect(metadata).toBeUndefined();
  });

  it('should handle zero GPS coordinates as no location', async () => {
    const jsonPath = path.join(testDir, 'IMG_1234.json');
    fs.writeFileSync(
      jsonPath,
      JSON.stringify({
        title: 'Photo',
        date: '2023-07-15T18:30:00',
        latitude: 0,
        longitude: 0,
      }),
    );

    const metadata = await parseOsxphotosMetadata(jsonPath);
    expect(metadata!.latitude).toBeUndefined();
    expect(metadata!.longitude).toBeUndefined();
  });

  it('should handle favorite as false', async () => {
    const jsonPath = path.join(testDir, 'IMG_1234.json');
    fs.writeFileSync(
      jsonPath,
      JSON.stringify({
        title: 'Photo',
        date: '2023-07-15T18:30:00',
        favorite: false,
      }),
    );

    const metadata = await parseOsxphotosMetadata(jsonPath);
    expect(metadata!.isFavorite).toBe(false);
  });
});

describe('findOsxphotosSidecar', () => {
  let testDir: string;

  beforeEach(() => {
    testDir = fs.mkdtempSync(path.join(os.tmpdir(), 'test-apple-sidecar-'));
  });

  afterEach(() => {
    fs.rmSync(testDir, { recursive: true, force: true });
  });

  it('should find .json sidecar with same base name', () => {
    const mediaPath = path.join(testDir, 'IMG_1234.HEIC');
    const sidecarPath = path.join(testDir, 'IMG_1234.json');
    fs.writeFileSync(mediaPath, 'media');
    fs.writeFileSync(sidecarPath, '{}');

    expect(findOsxphotosSidecar(mediaPath)).toBe(sidecarPath);
  });

  it('should find .ext.json sidecar', () => {
    const mediaPath = path.join(testDir, 'IMG_1234.HEIC');
    const sidecarPath = path.join(testDir, 'IMG_1234.HEIC.json');
    fs.writeFileSync(mediaPath, 'media');
    fs.writeFileSync(sidecarPath, '{}');

    expect(findOsxphotosSidecar(mediaPath)).toBe(sidecarPath);
  });

  it('should prefer .ext.json over .json when both exist', () => {
    const mediaPath = path.join(testDir, 'IMG_1234.HEIC');
    const sidecar1 = path.join(testDir, 'IMG_1234.HEIC.json');
    const sidecar2 = path.join(testDir, 'IMG_1234.json');
    fs.writeFileSync(mediaPath, 'media');
    fs.writeFileSync(sidecar1, '{"preferred": true}');
    fs.writeFileSync(sidecar2, '{"preferred": false}');

    expect(findOsxphotosSidecar(mediaPath)).toBe(sidecar1);
  });

  it('should return undefined when no sidecar exists', () => {
    const mediaPath = path.join(testDir, 'IMG_1234.HEIC');
    fs.writeFileSync(mediaPath, 'media');

    expect(findOsxphotosSidecar(mediaPath)).toBeUndefined();
  });
});

describe('getAlbumNameFromAppleExport', () => {
  it('should extract album name from parent folder', () => {
    const filepath = '/export/Summer Trip/IMG_1234.HEIC';
    expect(getAlbumNameFromAppleExport(filepath)).toBe('Summer Trip');
  });

  it('should handle nested folders by returning immediate parent', () => {
    const filepath = '/export/Albums/Summer Trip/IMG_1234.HEIC';
    expect(getAlbumNameFromAppleExport(filepath)).toBe('Summer Trip');
  });

  it('should handle album names with special characters', () => {
    const filepath = "/export/Mom's Birthday (2023)/IMG_1234.HEIC";
    expect(getAlbumNameFromAppleExport(filepath)).toBe("Mom's Birthday (2023)");
  });
});

describe('pairAppleLivePhoto', () => {
  let testDir: string;

  beforeEach(() => {
    testDir = fs.mkdtempSync(path.join(os.tmpdir(), 'test-apple-live-'));
  });

  afterEach(() => {
    fs.rmSync(testDir, { recursive: true, force: true });
  });

  it('should pair HEIC with MOV live photo', () => {
    const photoPath = path.join(testDir, 'IMG_1234.HEIC');
    const videoPath = path.join(testDir, 'IMG_1234.MOV');
    fs.writeFileSync(photoPath, 'photo');
    fs.writeFileSync(videoPath, 'video');

    const allFiles = [photoPath, videoPath];
    expect(pairAppleLivePhoto(photoPath, allFiles)).toBe(videoPath);
  });

  it('should pair JPG with MOV live photo', () => {
    const photoPath = path.join(testDir, 'IMG_1234.JPG');
    const videoPath = path.join(testDir, 'IMG_1234.MOV');
    fs.writeFileSync(photoPath, 'photo');
    fs.writeFileSync(videoPath, 'video');

    const allFiles = [photoPath, videoPath];
    expect(pairAppleLivePhoto(photoPath, allFiles)).toBe(videoPath);
  });

  it('should return undefined for photos without a video pair', () => {
    const photoPath = path.join(testDir, 'IMG_1234.HEIC');
    fs.writeFileSync(photoPath, 'photo');

    expect(pairAppleLivePhoto(photoPath, [photoPath])).toBeUndefined();
  });

  it('should not pair video files (only photos to videos)', () => {
    const photoPath = path.join(testDir, 'IMG_1234.HEIC');
    const videoPath = path.join(testDir, 'IMG_1234.MOV');
    fs.writeFileSync(photoPath, 'photo');
    fs.writeFileSync(videoPath, 'video');

    const allFiles = [photoPath, videoPath];
    expect(pairAppleLivePhoto(videoPath, allFiles)).toBeUndefined();
  });

  it('should handle case-insensitive matching', () => {
    const photoPath = path.join(testDir, 'img_1234.heic');
    const videoPath = path.join(testDir, 'img_1234.mov');
    fs.writeFileSync(photoPath, 'photo');
    fs.writeFileSync(videoPath, 'video');

    const allFiles = [photoPath, videoPath];
    expect(pairAppleLivePhoto(photoPath, allFiles)).toBe(videoPath);
  });

  it('should also pair with MP4 extension', () => {
    const photoPath = path.join(testDir, 'IMG_1234.HEIC');
    const videoPath = path.join(testDir, 'IMG_1234.mp4');
    fs.writeFileSync(photoPath, 'photo');
    fs.writeFileSync(videoPath, 'video');

    const allFiles = [photoPath, videoPath];
    expect(pairAppleLivePhoto(photoPath, allFiles)).toBe(videoPath);
  });

  it('should not pair files from different directories', () => {
    const subDir = path.join(testDir, 'sub');
    fs.mkdirSync(subDir);
    const photoPath = path.join(testDir, 'IMG_1234.HEIC');
    const videoPath = path.join(subDir, 'IMG_1234.MOV');
    fs.writeFileSync(photoPath, 'photo');
    fs.writeFileSync(videoPath, 'video');

    const allFiles = [photoPath, videoPath];
    expect(pairAppleLivePhoto(photoPath, allFiles)).toBeUndefined();
  });

  it('should prefer MOV over MP4 when both exist', () => {
    const photoPath = path.join(testDir, 'IMG_1234.HEIC');
    const movPath = path.join(testDir, 'IMG_1234.MOV');
    const mp4Path = path.join(testDir, 'IMG_1234.mp4');
    fs.writeFileSync(photoPath, 'photo');
    fs.writeFileSync(movPath, 'video-mov');
    fs.writeFileSync(mp4Path, 'video-mp4');

    const allFiles = [photoPath, movPath, mp4Path];
    expect(pairAppleLivePhoto(photoPath, allFiles)).toBe(movPath);
  });
});
