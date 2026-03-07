import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import path from 'node:path';

const PHOTO_EXTENSIONS = new Set(['.jpg', '.jpeg', '.png', '.heic', '.heif', '.webp', '.gif', '.tiff', '.tif', '.bmp']);
const PHOTOS_FROM_PATTERN = /^Photos from \d{4}$/;

export interface GoogleTakeoutMetadata {
  title: string;
  description?: string;
  dateTimeOriginal?: Date;
  latitude?: number;
  longitude?: number;
  isFavorite: boolean;
  isArchived: boolean;
}

interface GoogleTakeoutJson {
  title?: string;
  description?: string;
  photoTakenTime?: { timestamp?: string };
  creationTime?: { timestamp?: string };
  geoData?: { latitude?: number; longitude?: number; altitude?: number };
  geoDataExif?: { latitude?: number; longitude?: number; altitude?: number };
  favorited?: boolean;
  archived?: boolean;
}

export const parseGoogleTakeoutMetadata = async (jsonPath: string): Promise<GoogleTakeoutMetadata | undefined> => {
  try {
    const content = await readFile(jsonPath, 'utf8');
    const json: GoogleTakeoutJson = JSON.parse(content);

    const timestamp = json.photoTakenTime?.timestamp ?? json.creationTime?.timestamp;
    const geo = json.geoData ?? json.geoDataExif;
    const hasLocation = geo && (geo.latitude !== 0 || geo.longitude !== 0);

    return {
      title: json.title ?? path.basename(jsonPath, '.json'),
      description: json.description || undefined,
      dateTimeOriginal: timestamp ? new Date(Number(timestamp) * 1000) : undefined,
      latitude: hasLocation ? geo.latitude : undefined,
      longitude: hasLocation ? geo.longitude : undefined,
      isFavorite: json.favorited === true,
      isArchived: json.archived === true,
    };
  } catch {
    return undefined;
  }
};

export const findGoogleTakeoutSidecar = (mediaPath: string): string | undefined => {
  const parsed = path.parse(mediaPath);

  // Try exact match first: photo.jpg.json
  const exactSidecar = `${mediaPath}.json`;
  if (existsSync(exactSidecar)) {
    return exactSidecar;
  }

  // Try replacing extension: photo.json
  const noExtSidecar = path.join(parsed.dir, `${parsed.name}.json`);
  if (existsSync(noExtSidecar)) {
    return noExtSidecar;
  }

  // Try truncated filename matching (Google Takeout truncates at 47 chars)
  if (parsed.base.length > 47) {
    const truncatedBase = parsed.base.slice(0, 47);
    const truncatedSidecar = path.join(parsed.dir, `${truncatedBase}.json`);
    if (existsSync(truncatedSidecar)) {
      return truncatedSidecar;
    }
  }

  return undefined;
};

export const getAlbumNameFromTakeout = (filepath: string, takeoutRoot?: string): string | undefined => {
  if (takeoutRoot) {
    const relative = path.relative(takeoutRoot, filepath);
    const parts = relative.split(path.sep);

    // If the file is directly in the root, no album
    if (parts.length <= 1) {
      return undefined;
    }

    const albumName = parts[0];

    // Filter out "Photos from YYYY" auto-generated folders
    if (PHOTOS_FROM_PATTERN.test(albumName)) {
      return undefined;
    }

    return albumName;
  }

  // Fall back to parent folder name
  return path.basename(path.dirname(filepath));
};

export const pairLivePhoto = (mediaPath: string, allFiles: string[]): string | undefined => {
  const parsed = path.parse(mediaPath);
  const ext = parsed.ext.toLowerCase();

  // Only pair photo files to their video counterparts
  if (!PHOTO_EXTENSIONS.has(ext)) {
    return undefined;
  }

  const baseName = parsed.name;
  const dir = parsed.dir;

  // Look for matching video file in the same directory
  for (const videoExt of ['.mp4', '.mov']) {
    const match = allFiles.find((f) => {
      const fParsed = path.parse(f);
      return fParsed.dir === dir && fParsed.name === baseName && fParsed.ext.toLowerCase() === videoExt;
    });
    if (match) {
      return match;
    }
  }

  return undefined;
};
