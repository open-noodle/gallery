import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { MediaRepository } from 'src/repositories/media.repository';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const fixtureDir = path.resolve(__dirname, '../../test/fixtures/videos');
const normalMp4 = path.join(fixtureDir, 'normal.mp4');
const shortMp4 = path.join(fixtureDir, 'short.mp4');

describe('MediaRepository.extractVideoFrames (integration)', () => {
  let sut: MediaRepository;
  let tempDir: string;

  beforeEach(async () => {
    const mockLogger = {
      setContext: vi.fn(),
      warn: vi.fn(),
      debug: vi.fn(),
      log: vi.fn(),
      error: vi.fn(),
      verbose: vi.fn(),
    };
    sut = new MediaRepository(mockLogger as any);
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'extract-frames-'));
  });

  afterEach(async () => {
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  it('should extract 4 frames from normal.mp4', async () => {
    const timestamps = [0.5, 1.5, 2.5, 3.5];
    const results = await sut.extractVideoFrames(normalMp4, timestamps, tempDir);

    expect(results).toHaveLength(4);
    for (const filePath of results) {
      expect(filePath).toMatch(/\.jpg$/);
      const stat = await fs.stat(filePath);
      expect(stat.size).toBeGreaterThan(0);
    }
  });

  it('should extract 1 frame from short.mp4', async () => {
    const results = await sut.extractVideoFrames(shortMp4, [0.5], tempDir);

    expect(results).toHaveLength(1);
    expect(results[0]).toMatch(/\.jpg$/);
    const stat = await fs.stat(results[0]);
    expect(stat.size).toBeGreaterThan(0);
  });

  it('should return partial results when some timestamps are past end', async () => {
    const results = await sut.extractVideoFrames(shortMp4, [0.5, 999], tempDir);

    expect(results.length).toBeGreaterThanOrEqual(1);
    for (const filePath of results) {
      expect(filePath).toMatch(/\.jpg$/);
      const stat = await fs.stat(filePath);
      expect(stat.size).toBeGreaterThan(0);
    }
  });

  it('should throw when input file does not exist', async () => {
    await expect(sut.extractVideoFrames('/nonexistent/video.mp4', [0.5], tempDir)).rejects.toThrow(
      'Failed to extract any frames',
    );
  });
});
