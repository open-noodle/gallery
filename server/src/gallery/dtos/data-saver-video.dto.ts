import z from 'zod';
import { VideoCodec } from 'src/enum.js';
import { galleryConfigBool } from 'src/gallery/dtos/config.dto.js';

// Data Saver video (specs/2026-11-01-data-saver-video-design.md). A leaf module: it must not import from src/dtos.

// Added to AdminConfigFFmpegSchema. Only what differs from the normal transcode lives here: acceleration, preset,
// CRF, tone-mapping and audio come from the main FFmpeg settings.
export const GalleryDataSaverVideoSchema = z
  .object({
    enabled: galleryConfigBool.describe('Store a small extra copy of each video for the mobile app on mobile data'),
    targetVideoCodec: z
      .enum([VideoCodec.H264, VideoCodec.Hevc, VideoCodec.Av1])
      .describe('Video codec of the Data Saver copy')
      .meta({ id: 'DataSaverVideoCodec' }),
    targetResolution: z
      .enum(['480', '720', '1080'])
      .describe('Resolution of the Data Saver copy')
      .meta({ id: 'DataSaverVideoResolution' }),
    maxBitrate: z
      .string()
      .regex(/^\d+[km]?$/i)
      .describe('Bitrate cap of the Data Saver copy, in ffmpeg notation (for example 1500k)'),
  })
  .meta({ id: 'AdminConfigFFmpegDataSaverDto' });

export type DataSaverVideoConfig = z.infer<typeof GalleryDataSaverVideoSchema>;

export const galleryDataSaverVideoDefaults: DataSaverVideoConfig = {
  // off out of the box, so a fresh install behaves exactly like upstream Immich
  enabled: false,
  // decoded in hardware by every iPhone since the 7 and practically every Android phone since 2017, at about half
  // the bitrate H.264 needs for the same picture
  targetVideoCodec: VideoCodec.Hevc,
  targetResolution: '720',
  maxBitrate: '1500k',
};

// Spread into ServerFeaturesSchema. Optional: absent on servers that predate it, which a client reads as off.
export const DataSaverVideoServerFeatures = {
  dataSaverVideo: z
    .boolean()
    .optional()
    .describe('Whether videos may have a Data Saver copy at /assets/{id}/video/data-saver. Absent on older servers.'),
};
