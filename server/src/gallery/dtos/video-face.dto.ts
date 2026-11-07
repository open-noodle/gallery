import { createZodDto } from 'nestjs-zod';
import z from 'zod';

// Sightings of a video face sampled across the whole video (specs/2026-10-31-video-face-frames-design.md, Phase 2).

const playerSeconds = (description: string) => z.number().meta({ format: 'double' }).min(0).describe(description);

const frameFraction = (description: string) =>
  z.number().meta({ format: 'double' }).min(0).max(1).describe(description);

const VideoFaceSightingBoxSchema = z
  .object({
    x1: frameFraction('Left edge, as a fraction of the frame width'),
    y1: frameFraction('Top edge, as a fraction of the frame height'),
    x2: frameFraction('Right edge, as a fraction of the frame width'),
    y2: frameFraction('Bottom edge, as a fraction of the frame height'),
  })
  .meta({ id: 'VideoFaceSightingBoxDto' });

const VideoFaceSightingSchema = z
  .object({
    time: playerSeconds(
      "When the face was seen, in seconds on the player's timeline: from the trim start for a trimmed video",
    ),
    score: z.number().meta({ format: 'double' }).describe('Detector confidence for this sighting'),
    isBest: z.boolean().describe('Whether this is the best view, the one the face crop is cut from'),
    box: VideoFaceSightingBoxSchema.describe('Where the face was in the frame at that moment'),
  })
  .meta({ id: 'VideoFaceSightingDto' });

const VideoFaceSightingsResponseSchema = z
  .object({
    sightings: z
      .array(VideoFaceSightingSchema)
      .describe('Every sighting inside the current trim, in time order; empty for a face not sampled from a video'),
  })
  .meta({ id: 'VideoFaceSightingsResponseDto' });

const VideoFaceSightingThumbnailSchema = z
  .object({
    time: z.coerce
      .number()
      .min(0)
      .meta({ format: 'double' })
      .describe("The sighting's time, as GET /faces/{id}/sightings returned it"),
  })
  .meta({ id: 'VideoFaceSightingThumbnailDto' });

export class VideoFaceSightingsResponseDto extends createZodDto(VideoFaceSightingsResponseSchema) {}
export class VideoFaceSightingThumbnailDto extends createZodDto(VideoFaceSightingThumbnailSchema) {}
