import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import path from 'node:path';

const PHOTO_EXTENSIONS = new Set(['.jpg', '.jpeg', '.png', '.heic', '.heif', '.webp', '.gif', '.tiff', '.tif', '.bmp']);

export interface ApplePhotosMetadata {
  title?: string;
  description?: string;
  isFavorite: boolean;
  dateTimeOriginal?: Date;
  latitude?: number;
  longitude?: number;
  keywords: string[];
  albums: string[];
  persons: string[];
}

interface OsxphotosJson {
  title?: string;
  description?: string;
  favorite?: boolean;
  date?: string;
  latitude?: number;
  longitude?: number;
  keywords?: string[];
  albums?: string[];
  persons?: string[];
}

export const parseOsxphotosMetadata = async (jsonPath: string): Promise<ApplePhotosMetadata | undefined> => {
  try {
    const content = await readFile(jsonPath, 'utf8');
    const json: OsxphotosJson = JSON.parse(content);

    const hasLocation =
      json.latitude !== undefined && json.longitude !== undefined && (json.latitude !== 0 || json.longitude !== 0);

    return {
      title: json.title,
      description: json.description || undefined,
      isFavorite: json.favorite === true,
      dateTimeOriginal: json.date ? new Date(json.date) : undefined,
      latitude: hasLocation ? json.latitude : undefined,
      longitude: hasLocation ? json.longitude : undefined,
      keywords: json.keywords ?? [],
      albums: json.albums ?? [],
      persons: json.persons ?? [],
    };
  } catch {
    return undefined;
  }
};

export const findOsxphotosSidecar = (mediaPath: string): string | undefined => {
  const parsed = path.parse(mediaPath);

  // Try exact match first: photo.HEIC.json
  const exactSidecar = `${mediaPath}.json`;
  if (existsSync(exactSidecar)) {
    return exactSidecar;
  }

  // Try replacing extension: photo.json
  const noExtSidecar = path.join(parsed.dir, `${parsed.name}.json`);
  if (existsSync(noExtSidecar)) {
    return noExtSidecar;
  }

  return undefined;
};

export const getAlbumNameFromAppleExport = (filepath: string): string => {
  return path.basename(path.dirname(filepath));
};

export const pairAppleLivePhoto = (mediaPath: string, allFiles: string[]): string | undefined => {
  const parsed = path.parse(mediaPath);
  const ext = parsed.ext.toLowerCase();

  // Only pair photo files to their video counterparts
  if (!PHOTO_EXTENSIONS.has(ext)) {
    return undefined;
  }

  const baseName = parsed.name;
  const dir = parsed.dir;

  // Prefer MOV, then MP4
  for (const videoExt of ['.mov', '.mp4']) {
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
