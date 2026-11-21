import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { VideoFrameReader } from 'src/gallery/utils/video-frames.js';
import { VideoSampleCache, videoSampleCache, videoSampleKey } from 'src/gallery/utils/video-sample-cache.js';

type VideoSampleSource = {
  id: string;
  ownerId: string;
  checksum: Uint8Array;
  trimStart: number | null;
  trimEnd: number | null;
};

/** Shares source pixels and scene analysis, never detector outputs, tracks or embeddings. */
export class CachedVideoFrames {
  private source?: string;
  reusedFrames = 0;

  constructor(
    private frames: VideoFrameReader,
    source: VideoSampleSource,
    private cache: VideoSampleCache = videoSampleCache,
  ) {
    // Missing checksums (e.g. incomplete inputs) must not accidentally reuse another source's frames.
    if (source.checksum?.length) {
      this.source = videoSampleKey({
        id: source.id,
        ownerId: source.ownerId,
        checksum: Buffer.from(source.checksum).toString('hex'),
        trimStart: source.trimStart,
        trimEnd: source.trimEnd,
      });
    }
  }

  async findSceneCuts(input: string): Promise<number[]> {
    if (!this.source) {
      return this.frames.findSceneCuts(input);
    }
    const dir = await mkdtemp(join(tmpdir(), 'gallery-video-scenes-'));
    const output = join(dir, 'cuts.json');
    try {
      await this.cache.materialize(`${this.source}:scenes`, output, async () => {
        await writeFile(output, JSON.stringify(await this.frames.findSceneCuts(input)));
      });
      try {
        const cuts: unknown = JSON.parse(await readFile(output, 'utf8'));
        if (
          Array.isArray(cuts) &&
          cuts.every((cut: unknown) => typeof cut === 'number' && Number.isFinite(cut) && cut >= 0)
        ) {
          return cuts;
        }
      } catch {
        // A corrupt cache entry falls back to fresh scene analysis.
      }
      return this.frames.findSceneCuts(input);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  }

  async extractFrame(...args: Parameters<VideoFrameReader['extractFrame']>): Promise<void> {
    if (!this.source) {
      return this.frames.extractFrame(...args);
    }
    const [input, output, timeSeconds, options] = args;
    // ffmpeg seeks to millisecond precision. Model names and sampling intervals do not change these pixels.
    const key = videoSampleKey({ source: this.source, time: timeSeconds.toFixed(3), ...options });
    if (
      await this.cache.materialize(key, output, () => this.frames.extractFrame(input, output, timeSeconds, options))
    ) {
      this.reusedFrames++;
    }
  }
}
