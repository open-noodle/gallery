import { ExifDateTime } from 'exiftool-vendored';
import { ImmichTags } from 'src/repositories/metadata.repository';

/**
 * Represents the JSON metadata structure from a Google Takeout export.
 * Each media file has a companion `.json` file with this structure.
 */
export interface GoogleTakeoutMetadata {
  title?: string;
  description?: string;
  photoTakenTime?: {
    timestamp?: string;
    formatted?: string;
  };
  geoData?: {
    latitude?: number;
    longitude?: number;
    altitude?: number;
  };
  geoDataExif?: {
    latitude?: number;
    longitude?: number;
    altitude?: number;
  };
  favorited?: boolean;
  archived?: boolean;
  trashed?: boolean;
  creationTime?: {
    timestamp?: string;
    formatted?: string;
  };
  modificationTime?: {
    timestamp?: string;
    formatted?: string;
  };
  photoLastModifiedTime?: {
    timestamp?: string;
    formatted?: string;
  };
  url?: string;
  googlePhotosOrigin?: {
    mobileUpload?: {
      deviceType?: string;
    };
  };
  imageViews?: string;
  people?: Array<{
    name?: string;
  }>;
}

/**
 * Parses a Google Takeout JSON string into the structured metadata format.
 * Returns null if the JSON is invalid or not a Google Takeout metadata file.
 */
export function parseGoogleTakeoutJson(jsonString: string): GoogleTakeoutMetadata | null {
  try {
    const parsed = JSON.parse(jsonString);

    // Basic validation: must be an object
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
      return null;
    }

    return parsed as GoogleTakeoutMetadata;
  } catch {
    return null;
  }
}

/**
 * Converts Google Takeout metadata into ImmichTags format for merging
 * with the existing metadata extraction pipeline.
 */
export function googleTakeoutToImmichTags(metadata: GoogleTakeoutMetadata): Partial<ImmichTags> {
  const tags: Partial<ImmichTags> = {};

  // Date: prefer photoTakenTime, fall back to creationTime
  const timestamp = metadata.photoTakenTime?.timestamp ?? metadata.creationTime?.timestamp;
  if (timestamp) {
    const seconds = Number(timestamp);
    if (!Number.isNaN(seconds) && seconds > 0) {
      const date = new Date(seconds * 1000);
      const isoString = date.toISOString();
      // Convert to ExifDateTime format (YYYY:MM:DD HH:mm:ss)
      const exifDateStr = isoString.replace('T', ' ').replace(/\.\d+Z$/, '+00:00');
      const exifDateTime = ExifDateTime.fromEXIF(exifDateStr);
      if (exifDateTime) {
        tags.DateTimeOriginal = exifDateTime;
      }
    }
  }

  // GPS: prefer geoData, fall back to geoDataExif
  const geo = metadata.geoData ?? metadata.geoDataExif;
  if (geo) {
    if (isValidGps(geo.latitude, geo.longitude)) {
      tags.GPSLatitude = geo.latitude!;
      tags.GPSLongitude = geo.longitude!;
    }
    if (geo.altitude !== undefined && geo.altitude !== 0) {
      tags.GPSAltitude = geo.altitude;
    }
  }

  // Description
  if (metadata.description && metadata.description.trim()) {
    tags.ImageDescription = metadata.description.trim();
    tags.Description = metadata.description.trim() as any;
  }

  return tags;
}

/**
 * Checks if GPS coordinates are valid (non-zero and within bounds).
 * Google Takeout uses 0.0/0.0 to indicate no location data.
 */
function isValidGps(latitude?: number, longitude?: number): boolean {
  if (latitude === undefined || longitude === undefined) {
    return false;
  }

  // Google Takeout uses (0, 0) for missing GPS data
  if (latitude === 0 && longitude === 0) {
    return false;
  }

  // Validate ranges
  if (latitude < -90 || latitude > 90 || longitude < -180 || longitude > 180) {
    return false;
  }

  return true;
}

/**
 * Given an asset's original file path, generates candidate paths for
 * Google Takeout JSON sidecar files.
 *
 * Google Takeout naming conventions:
 * - Old format: `IMG_1234.jpg` → `IMG_1234.jpg.json`
 * - New format (since late 2024): `IMG_1234.jpg` → `IMG_1234.jpg.supplemental-metadata.json`
 * - For truncated filenames (>47 chars), the JSON name may not match exactly
 * - Edited photos: `IMG_1234-edited.jpg` → `IMG_1234.jpg.json` (shares original's JSON)
 * - Duplicate names in album: `IMG_1234.jpg(1).json`, `IMG_1234.jpg(2).json`
 */
export function getGoogleTakeoutJsonCandidates(originalPath: string): string[] {
  return [
    // Old format: IMG_1234.jpg.json
    `${originalPath}.json`,
    // New format (since late 2024): IMG_1234.jpg.supplemental-metadata.json
    `${originalPath}.supplemental-metadata.json`,
  ];
}

/**
 * Checks if a sidecar path looks like a Google Takeout JSON sidecar.
 * Matches both old format (.json) and new format (.supplemental-metadata.json).
 */
export function isGoogleTakeoutJsonSidecar(sidecarPath: string): boolean {
  return sidecarPath.endsWith('.json');
}
