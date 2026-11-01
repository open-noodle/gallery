import ffmpeg from 'fluent-ffmpeg';
import sharp from 'sharp';
import type { ConfigFFmpegDto } from 'src/dtos/config.dto.js';
import type { VideoStreamInfo } from 'src/types.js';
import { BaseConfig, ThumbnailConfig } from 'src/utils/media.js';

/** Short edge of a sampled frame. Well above what the detector uses, and enough for a sharp 250 px crop with room. */
export const VIDEO_FACE_FRAME_SHORT_EDGE = 1440;

/** ffmpeg's scene score above which a keyframe counts as a cut. */
const SCENE_CUT_THRESHOLD = 0.3;

/** Side of the square the face is resized to before measuring sharpness, so faces of any size score alike. */
const SHARPNESS_SIZE = 112;

const LAPLACIAN = { width: 3, height: 3, kernel: [0, 1, 0, 1, -4, 1, 0, 1, 0], scale: 1, offset: 128 };

/**
 * ffmpeg and sharp work for video face sampling (specs/2026-10-31-video-face-frames-design.md), behind one object so the
 * detector's logic can be tested without either.
 */
export class VideoFrameReader {
  /**
   * Times of hard cuts, from one pass over keyframes only, at a fraction of the cost of a full decode. It finds the
   * cuts an encoder marked with a keyframe, which x264 and x265 usually do; a cut it did not mark is left to the
   * interval samples.
   */
  findSceneCuts(input: string): Promise<number[]> {
    return new Promise((resolve, reject) => {
      const cuts: number[] = [];
      ffmpeg(input, { niceness: 10 })
        .inputOptions(['-skip_frame', 'nokey'])
        .outputOptions(['-an', '-vf', `select='gt(scene,${SCENE_CUT_THRESHOLD})',showinfo`, '-f', 'null'])
        .output('-')
        .on('stderr', (line: string) => {
          const match = /\bpts_time:\s*([\d.]+)/.exec(line);
          if (match && line.includes('Parsed_showinfo')) {
            cuts.push(Number(match[1]));
          }
        })
        .on('error', (error) => reject(error))
        .on('end', () => resolve(cuts))
        .run();
    });
  }

  /**
   * One frame at `timeSeconds`, rotated upright, scaled and tone-mapped with the same filters the video poster uses,
   * so an HDR phone video is not washed out.
   */
  extractFrame(
    input: string,
    output: string,
    timeSeconds: number,
    { ffmpeg: ffmpegConfig, videoStream }: { ffmpeg: ConfigFFmpegDto; videoStream: VideoStreamInfo },
  ): Promise<void> {
    const config = ThumbnailConfig.create({
      ...ffmpegConfig,
      targetResolution: VIDEO_FACE_FRAME_SHORT_EDGE.toString(),
    });
    // BaseConfig's filters are the scale and tone-map steps on their own; ThumbnailConfig's own override adds the
    // poster-picking filters in front of them, which a frame at a chosen time must not have.
    const filters = BaseConfig.prototype.getFilterOptions.call(config, videoStream);

    return new Promise((resolve, reject) => {
      ffmpeg(input, { niceness: 10 })
        .inputOptions(['-ss', timeSeconds.toFixed(3)])
        .outputOptions([
          '-map',
          `0:${videoStream.index}`,
          '-frames:v',
          '1',
          '-q:v',
          '2',
          ...(filters.length > 0 ? ['-vf', filters.join(',')] : []),
        ])
        .output(output)
        .on('error', (error) => reject(error))
        .on('end', () => resolve())
        .run();
    });
  }

  /** Variance of the Laplacian over the face, a standard focus measure: low for a blurred face, high for a sharp one. */
  async measureSharpness(
    framePath: string,
    box: { x1: number; y1: number; x2: number; y2: number },
    frame: { width: number; height: number },
  ): Promise<number> {
    const left = Math.max(0, Math.floor(box.x1));
    const top = Math.max(0, Math.floor(box.y1));
    const width = Math.min(frame.width, Math.ceil(box.x2)) - left;
    const height = Math.min(frame.height, Math.ceil(box.y2)) - top;
    if (width < 2 || height < 2) {
      return 0;
    }

    const { data } = await sharp(framePath, { failOn: 'error' })
      .extract({ left, top, width, height })
      .greyscale()
      .resize(SHARPNESS_SIZE, SHARPNESS_SIZE, { fit: 'fill' })
      .convolve(LAPLACIAN)
      .raw()
      .toBuffer({ resolveWithObject: true });

    let sum = 0;
    let sumOfSquares = 0;
    for (const value of data) {
      const centred = value - LAPLACIAN.offset;
      sum += centred;
      sumOfSquares += centred * centred;
    }
    const mean = sum / data.length;
    return sumOfSquares / data.length - mean * mean;
  }

  async getDimensions(framePath: string): Promise<{ width: number; height: number }> {
    const { width = 0, height = 0 } = await sharp(framePath).metadata();
    return { width, height };
  }
}
