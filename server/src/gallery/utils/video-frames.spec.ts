import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { defaults } from 'src/dtos/config.dto.js';

/** What the stubbed ffmpeg run does before it reports `end`: write the frame, or write nothing as past the stream's end. */
let writeOutput: (path: string) => Promise<void>;

vi.mock('fluent-ffmpeg', () => ({
  default: vi.fn(() => {
    const handlers: Record<string, (...args: unknown[]) => void> = {};
    let output = '';
    const command = {
      inputOptions: () => command,
      outputOptions: () => command,
      output: (path: string) => {
        output = path;
        return command;
      },
      on: (event: string, handler: (...args: unknown[]) => void) => {
        handlers[event] = handler;
        return command;
      },
      run: () => {
        void writeOutput(output).then(() => handlers.end?.());
      },
    };
    return command;
  }),
}));

const { VideoFrameReader } = await import('src/gallery/utils/video-frames.js');

describe('VideoFrameReader.extractFrame', () => {
  let dir: string;
  const options = {
    ffmpeg: defaults.ffmpeg,
    videoStream: { index: 0, width: 1920, height: 1080, rotation: 0, pixelFormat: 'yuv420p' } as never,
  };

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'video-frames-spec-'));
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it('resolves once ffmpeg wrote the frame', async () => {
    writeOutput = (path) => writeFile(path, 'jpeg');

    await expect(
      new VideoFrameReader().extractFrame('in.mp4', join(dir, 'f.jpeg'), 3, options),
    ).resolves.toBeUndefined();
  });

  it('rejects when ffmpeg exits cleanly without a frame, past the end of the video stream (issue 1306)', async () => {
    writeOutput = () => Promise.resolve();

    await expect(new VideoFrameReader().extractFrame('in.mp4', join(dir, 'f.jpeg'), 493.25, options)).rejects.toThrow(
      'No frame at 493.25s',
    );
  });

  it('rejects an empty frame file', async () => {
    writeOutput = (path) => writeFile(path, '');

    await expect(new VideoFrameReader().extractFrame('in.mp4', join(dir, 'f.jpeg'), 1, options)).rejects.toThrow(
      'No frame at 1s',
    );
  });
});
