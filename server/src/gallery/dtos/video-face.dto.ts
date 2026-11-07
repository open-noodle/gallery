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

const VideoFaceSightingSplitResponseSchema = z
  .object({
    faceId: z.uuidv4().describe('The new face the sighting moved to: unassigned, made by hand'),
    sightings: z
      .array(VideoFaceSightingSchema)
      .describe('The sightings the original face has left, as GET /faces/{id}/sightings lists them'),
  })
  .meta({ id: 'VideoFaceSightingSplitResponseDto' });

const VideoFaceSightingMoveSchema = z
  .object({
    time: z.coerce
      .number()
      .min(0)
      .meta({ format: 'double' })
      .describe("The sighting's time, as GET /faces/{id}/sightings returned it"),
    toFaceId: z.uuidv4().describe('The face of the same video the sighting moves into'),
  })
  .meta({ id: 'VideoFaceSightingMoveDto' });

const VideoFaceSightingMoveResponseSchema = z
  .object({
    sightings: z
      .array(VideoFaceSightingSchema)
      .describe('The sightings the face has left; empty when its last one moved and the face was deleted'),
    targetSightings: z.array(VideoFaceSightingSchema).describe('The sightings of the face the sighting moved into'),
  })
  .meta({ id: 'VideoFaceSightingMoveResponseDto' });

const VideoFaceMergeSchema = z
  .object({
    faceIds: z
      .array(z.uuidv4())
      .min(2)
      .describe('Faces of one video to combine into one; faces not sampled from the video are left as they are'),
  })
  .meta({ id: 'VideoFaceMergeDto' });

const VideoFaceMergeResponseSchema = z
  .object({
    faceId: z.uuidv4().describe('The face that was kept: the one with the most sightings'),
    sightings: z.array(VideoFaceSightingSchema).describe('Its sightings, now including those of the merged faces'),
  })
  .meta({ id: 'VideoFaceMergeResponseDto' });

const VideoFaceSightingThumbnailSchema = z
  .object({
    time: z.coerce
      .number()
      .min(0)
      .meta({ format: 'double' })
      .describe("The sighting's time, as GET /faces/{id}/sightings returned it"),
  })
  .meta({ id: 'VideoFaceSightingThumbnailDto' });

const VideoFaceSightingTimeSchema = z
  .object({
    time: z.coerce
      .number()
      .min(0)
      .meta({ format: 'double' })
      .describe("The sighting's time, as GET /faces/{id}/sightings returned it, or as it was when removed"),
  })
  .meta({ id: 'VideoFaceSightingTimeDto' });

export class VideoFaceSightingsResponseDto extends createZodDto(VideoFaceSightingsResponseSchema) {}
export class VideoFaceSightingTimeDto extends createZodDto(VideoFaceSightingTimeSchema) {}
export class VideoFaceSightingSplitResponseDto extends createZodDto(VideoFaceSightingSplitResponseSchema) {}
export class VideoFaceSightingMoveDto extends createZodDto(VideoFaceSightingMoveSchema) {}
export class VideoFaceSightingMoveResponseDto extends createZodDto(VideoFaceSightingMoveResponseSchema) {}
export class VideoFaceMergeDto extends createZodDto(VideoFaceMergeSchema) {}
export class VideoFaceMergeResponseDto extends createZodDto(VideoFaceMergeResponseSchema) {}
export class VideoFaceSightingThumbnailDto extends createZodDto(VideoFaceSightingThumbnailSchema) {}
