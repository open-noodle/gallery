import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { defaults } from 'src/dtos/config.dto.js';
import { ToneMapping } from 'src/enum.js';
import { CachedVideoFrames } from 'src/gallery/utils/cached-video-frames.js';
import { VideoFrameReader } from 'src/gallery/utils/video-frames.js';
import { VideoSampleCache } from 'src/gallery/utils/video-sample-cache.js';

describe('CachedVideoFrames', () => {
  let dir: string;
  let cache: VideoSampleCache;
  const source = { id: 'asset', ownerId: 'owner', checksum: Buffer.from('video'), trimStart: null, trimEnd: null };
  const options = {
    ffmpeg: defaults.ffmpeg,
    videoStream: { index: 0, width: 1920, height: 1080, rotation: 0, pixelFormat: 'yuv420p' } as never,
  };
  let frames: VideoFrameReader;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'cached-frames-spec-'));
    cache = new VideoSampleCache({ root: join(dir, 'cache') });
    frames = new VideoFrameReader();
    vi.spyOn(frames, 'extractFrame').mockImplementation((_input, output, time) => writeFile(output, `frame ${time}`));
    vi.spyOn(frames, 'findSceneCuts').mockResolvedValue([1, 3]);
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    cache[Symbol.dispose]();
    await rm(dir, { recursive: true, force: true });
  });

  it('shares frames between human and pet consumers, including separately staged source paths', async () => {
    const human = new CachedVideoFrames(frames, source, cache);
    const pets = new CachedVideoFrames(frames, source, cache);
    await human.extractFrame('/tmp/staged-human.mp4', join(dir, 'human.jpeg'), 1, options);
    await pets.extractFrame('/tmp/staged-pet.mp4', join(dir, 'pet.jpeg'), 1, options);
    // A different sampling plan can ask for extra frames without invalidating common timestamps.
    await pets.extractFrame('/tmp/staged-pet.mp4', join(dir, 'extra.jpeg'), 2, options);
    expect(frames.extractFrame).toHaveBeenCalledTimes(2);
    expect(await readFile(join(dir, 'pet.jpeg'), 'utf8')).toBe('frame 1');
  });

  it('shares scene analysis and preserves an empty scene result', async () => {
    const human = new CachedVideoFrames(frames, source, cache);
    const pets = new CachedVideoFrames(frames, source, cache);
    expect(await human.findSceneCuts('human.mp4')).toEqual([1, 3]);
    expect(await pets.findSceneCuts('pet.mp4')).toEqual([1, 3]);
    expect(frames.findSceneCuts).toHaveBeenCalledTimes(1);
    vi.mocked(frames.findSceneCuts).mockResolvedValue([]);
    const changed = new CachedVideoFrames(frames, { ...source, checksum: Buffer.from('changed') }, cache);
    expect(await changed.findSceneCuts('changed.mp4')).toEqual([]);
    expect(await changed.findSceneCuts('changed.mp4')).toEqual([]);
    expect(frames.findSceneCuts).toHaveBeenCalledTimes(2);
  });

  it('invalidates source, owner, asset, trim and extraction setting changes', async () => {
    const output = join(dir, 'frame.jpeg');
    await new CachedVideoFrames(frames, source, cache).extractFrame('video.mp4', output, 1, options);
    for (const change of [
      { checksum: Buffer.from('new') },
      { ownerId: 'different' },
      { id: 'different' },
      { trimStart: 0 },
      { trimEnd: 5 },
    ]) {
      await new CachedVideoFrames(frames, { ...source, ...change }, cache).extractFrame(
        'video.mp4',
        output,
        1,
        options,
      );
    }
    await new CachedVideoFrames(frames, source, cache).extractFrame('video.mp4', output, 1, {
      ...options,
      ffmpeg: { ...options.ffmpeg, tonemap: ToneMapping.Reinhard },
    });
    expect(frames.extractFrame).toHaveBeenCalledTimes(7);
  });

  it('falls back to scene analysis when cached scene data is invalid', async () => {
    vi.spyOn(cache, 'materialize').mockImplementation(async (_key, output) => {
      await writeFile(output, 'not json');
      return true;
    });
    expect(await new CachedVideoFrames(frames, source, cache).findSceneCuts('video.mp4')).toEqual([1, 3]);
    expect(frames.findSceneCuts).toHaveBeenCalledTimes(1);
  });

  it('bypasses the cache without a source fingerprint', async () => {
    const reader = new CachedVideoFrames(frames, { ...source, checksum: Buffer.alloc(0) }, cache);
    await reader.extractFrame('video.mp4', join(dir, 'one.jpeg'), 1, options);
    await reader.extractFrame('video.mp4', join(dir, 'two.jpeg'), 1, options);
    expect(frames.extractFrame).toHaveBeenCalledTimes(2);
  });
});
