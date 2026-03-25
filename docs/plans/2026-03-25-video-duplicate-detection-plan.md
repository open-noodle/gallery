# Video Duplicate Detection Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Enable video duplicate detection by extracting multiple frames from videos,
encoding each via CLIP, and averaging the embeddings into one vector stored in
`smart_search`.

**Architecture:** The existing image CLIP pipeline is extended with a video branch in
`handleEncodeClip`. Videos are probed for duration, 8 evenly-spaced frames are
extracted via ffmpeg, each frame is CLIP-encoded, and the embeddings are averaged.
No schema, API, or frontend changes.

**Tech Stack:** NestJS, ffmpeg (fluent-ffmpeg), Vitest, existing CLIP ML service

**Design doc:** `docs/plans/2026-03-25-video-duplicate-detection-design.md`

---

### Task 1: Add `elementWiseMean` utility

**Files:**

- Create: `server/src/utils/vector.ts`
- Create: `server/src/utils/vector.spec.ts`

**Step 1: Write the failing tests**

In `server/src/utils/vector.spec.ts`:

```typescript
import { elementWiseMean } from 'src/utils/vector';

describe('elementWiseMean', () => {
  it('should average two vectors', () => {
    const result = elementWiseMean([
      [1, 2, 3],
      [3, 4, 5],
    ]);
    expect(result).toEqual([2, 3, 4]);
  });

  it('should return the vector unchanged for a single input', () => {
    const result = elementWiseMean([[1, 2, 3]]);
    expect(result).toEqual([1, 2, 3]);
  });

  it('should handle floating point values', () => {
    const result = elementWiseMean([
      [0.1, 0.2],
      [0.3, 0.4],
    ]);
    expect(result[0]).toBeCloseTo(0.2);
    expect(result[1]).toBeCloseTo(0.3);
  });
});
```

**Step 2: Run test to verify it fails**

Run: `cd server && npx vitest run src/utils/vector.spec.ts`
Expected: FAIL — module not found

**Step 3: Write the implementation**

In `server/src/utils/vector.ts`:

```typescript
export function elementWiseMean(vectors: number[][]): number[] {
  const dim = vectors[0].length;
  const mean = new Array<number>(dim).fill(0);
  for (const vec of vectors) {
    for (let i = 0; i < dim; i++) {
      mean[i] += vec[i];
    }
  }
  for (let i = 0; i < dim; i++) {
    mean[i] /= vectors.length;
  }
  return mean;
}
```

**Step 4: Run test to verify it passes**

Run: `cd server && npx vitest run src/utils/vector.spec.ts`
Expected: PASS — all 3 tests

**Step 5: Commit**

```
feat: add elementWiseMean vector utility
```

---

### Task 2: Add `extractVideoFrames` to media repository

**Files:**

- Modify: `server/src/repositories/media.repository.ts`
- Modify: `server/test/repositories/media.repository.mock.ts`

**Step 1: Add the mock first**

In `server/test/repositories/media.repository.mock.ts`, add to the returned object:

```typescript
extractVideoFrames: vitest.fn().mockResolvedValue([]),
```

**Step 2: Add the implementation**

In `server/src/repositories/media.repository.ts`, add this method to the
`MediaRepository` class. Place it after the existing `probe` method (~line 275):

```typescript
async extractVideoFrames(input: string, timestamps: number[], outputDir: string): Promise<string[]> {
  const results: string[] = [];
  for (const timestamp of timestamps) {
    const output = path.join(outputDir, `frame-${timestamp.toFixed(3)}.jpg`);
    try {
      await new Promise<void>((resolve, reject) => {
        ffmpeg(input)
          .inputOptions([`-ss ${timestamp}`])
          .outputOptions(['-frames:v 1', '-q:v 2'])
          .output(output)
          .on('error', reject)
          .on('end', () => resolve())
          .run();
      });
      results.push(output);
    } catch (error) {
      this.logger.warn(`Failed to extract frame at ${timestamp}s from ${input}: ${error}`);
    }
  }

  if (results.length === 0) {
    throw new Error(`Failed to extract any frames from ${input}`);
  }

  return results;
}
```

Also add `import path from 'node:path';` to the top if not already present.

**Step 3: Run existing media repository tests to verify no regression**

Run: `cd server && npx vitest run src/repositories/media.repository.spec.ts`
Expected: PASS — existing tests unaffected

**Step 4: Commit**

```
feat: add extractVideoFrames to media repository
```

---

### Task 3: Add `type` and `originalPath` to `getForClipEncoding` query

**Files:**

- Modify: `server/src/repositories/asset-job.repository.ts:217-224`

**Step 1: Modify the query**

Change the `getForClipEncoding` method at line 217:

```typescript
@GenerateSql({ params: [DummyValue.UUID] })
getForClipEncoding(id: string) {
  return this.db
    .selectFrom('asset')
    .select(['asset.id', 'asset.visibility', 'asset.type', 'asset.originalPath'])
    .select((eb) => withFiles(eb, AssetFileType.Preview))
    .where('asset.id', '=', id)
    .executeTakeFirst();
}
```

Only change: added `'asset.type', 'asset.originalPath'` to the select array.

**Step 2: Regenerate SQL documentation**

Run: `cd server && pnpm sync:sql`

If `make sql` requires a running DB, skip this and note it for later.

**Step 3: Run existing smart-info tests to verify no regression**

Run: `cd server && npx vitest run src/services/smart-info.service.spec.ts`
Expected: PASS — existing tests unaffected (they mock `getForClipEncoding`)

**Step 4: Commit**

```
feat: include asset type and originalPath in clip encoding query
```

---

### Task 4: Add video CLIP encoding to `handleEncodeClip`

**Files:**

- Modify: `server/src/services/smart-info.service.ts:96-127`
- Modify: `server/src/services/smart-info.service.spec.ts`

**Step 1: Write failing tests for the video branch**

Add these tests inside the existing `describe('handleEncodeClip', ...)` block in
`server/src/services/smart-info.service.spec.ts`:

```typescript
import { AssetType } from 'src/enum';
// ... (add to existing imports at top)

describe('video CLIP encoding', () => {
  it('should extract 8 frames for a normal video and average embeddings', async () => {
    const asset = AssetFactory.from({ type: AssetType.Video }).file({ type: AssetFileType.Preview }).build();
    mocks.assetJob.getForClipEncoding.mockResolvedValue(asset);
    mocks.media.probe.mockResolvedValue({ format: { duration: 10 } });
    mocks.media.extractVideoFrames.mockResolvedValue([
      '/tmp/f1.jpg',
      '/tmp/f2.jpg',
      '/tmp/f3.jpg',
      '/tmp/f4.jpg',
      '/tmp/f5.jpg',
      '/tmp/f6.jpg',
      '/tmp/f7.jpg',
      '/tmp/f8.jpg',
    ]);
    mocks.machineLearning.encodeImage.mockResolvedValue('[1,0,0]');

    expect(await sut.handleEncodeClip({ id: asset.id })).toEqual(JobStatus.Success);

    expect(mocks.media.probe).toHaveBeenCalledWith(asset.originalPath);
    expect(mocks.media.extractVideoFrames).toHaveBeenCalledWith(
      asset.originalPath,
      expect.arrayContaining([expect.any(Number)]),
      expect.any(String),
    );
    expect(mocks.machineLearning.encodeImage).toHaveBeenCalledTimes(8);
    expect(mocks.search.upsert).toHaveBeenCalledWith(asset.id, expect.any(String));
  });

  it('should extract 1 frame for a short video (< 2s)', async () => {
    const asset = AssetFactory.from({ type: AssetType.Video }).file({ type: AssetFileType.Preview }).build();
    mocks.assetJob.getForClipEncoding.mockResolvedValue(asset);
    mocks.media.probe.mockResolvedValue({ format: { duration: 1.5 } });
    mocks.media.extractVideoFrames.mockResolvedValue(['/tmp/f1.jpg']);
    mocks.machineLearning.encodeImage.mockResolvedValue('[1,0,0]');

    expect(await sut.handleEncodeClip({ id: asset.id })).toEqual(JobStatus.Success);

    expect(mocks.media.extractVideoFrames).toHaveBeenCalledWith(asset.originalPath, [0.75], expect.any(String));
    expect(mocks.machineLearning.encodeImage).toHaveBeenCalledTimes(1);
  });

  it('should extract 1 frame at t=0 when duration is missing', async () => {
    const asset = AssetFactory.from({ type: AssetType.Video }).file({ type: AssetFileType.Preview }).build();
    mocks.assetJob.getForClipEncoding.mockResolvedValue(asset);
    mocks.media.probe.mockResolvedValue({ format: { duration: 0 } });
    mocks.media.extractVideoFrames.mockResolvedValue(['/tmp/f1.jpg']);
    mocks.machineLearning.encodeImage.mockResolvedValue('[1,0,0]');

    expect(await sut.handleEncodeClip({ id: asset.id })).toEqual(JobStatus.Success);

    expect(mocks.media.extractVideoFrames).toHaveBeenCalledWith(asset.originalPath, [0], expect.any(String));
  });

  it('should average embeddings from partial frame extraction', async () => {
    const asset = AssetFactory.from({ type: AssetType.Video }).file({ type: AssetFileType.Preview }).build();
    mocks.assetJob.getForClipEncoding.mockResolvedValue(asset);
    mocks.media.probe.mockResolvedValue({ format: { duration: 10 } });
    // Only 3 frames succeeded (extractVideoFrames handles partial failure internally)
    mocks.media.extractVideoFrames.mockResolvedValue(['/tmp/f1.jpg', '/tmp/f2.jpg', '/tmp/f3.jpg']);
    mocks.machineLearning.encodeImage
      .mockResolvedValueOnce('[1,0,0]')
      .mockResolvedValueOnce('[0,1,0]')
      .mockResolvedValueOnce('[0,0,1]');

    expect(await sut.handleEncodeClip({ id: asset.id })).toEqual(JobStatus.Success);

    expect(mocks.machineLearning.encodeImage).toHaveBeenCalledTimes(3);
    // Averaged: [(1+0+0)/3, (0+1+0)/3, (0+0+1)/3]
    const storedEmbedding = JSON.parse(mocks.search.upsert.mock.calls[0][1]);
    expect(storedEmbedding[0]).toBeCloseTo(1 / 3);
    expect(storedEmbedding[1]).toBeCloseTo(1 / 3);
    expect(storedEmbedding[2]).toBeCloseTo(1 / 3);
  });

  it('should fail when probe fails', async () => {
    const asset = AssetFactory.from({ type: AssetType.Video }).file({ type: AssetFileType.Preview }).build();
    mocks.assetJob.getForClipEncoding.mockResolvedValue(asset);
    mocks.media.probe.mockRejectedValue(new Error('corrupt video'));

    expect(await sut.handleEncodeClip({ id: asset.id })).toEqual(JobStatus.Failed);

    expect(mocks.machineLearning.encodeImage).not.toHaveBeenCalled();
    expect(mocks.search.upsert).not.toHaveBeenCalled();
  });

  it('should fail when all frames fail to extract', async () => {
    const asset = AssetFactory.from({ type: AssetType.Video }).file({ type: AssetFileType.Preview }).build();
    mocks.assetJob.getForClipEncoding.mockResolvedValue(asset);
    mocks.media.probe.mockResolvedValue({ format: { duration: 10 } });
    mocks.media.extractVideoFrames.mockRejectedValue(new Error('Failed to extract any frames'));

    expect(await sut.handleEncodeClip({ id: asset.id })).toEqual(JobStatus.Failed);

    expect(mocks.search.upsert).not.toHaveBeenCalled();
  });

  it('should still encode images via preview file (no regression)', async () => {
    const asset = AssetFactory.from({ type: AssetType.Image }).file({ type: AssetFileType.Preview }).build();
    mocks.machineLearning.encodeImage.mockResolvedValue('[0.01, 0.02, 0.03]');
    mocks.assetJob.getForClipEncoding.mockResolvedValue(asset);

    expect(await sut.handleEncodeClip({ id: asset.id })).toEqual(JobStatus.Success);

    expect(mocks.media.probe).not.toHaveBeenCalled();
    expect(mocks.media.extractVideoFrames).not.toHaveBeenCalled();
    expect(mocks.machineLearning.encodeImage).toHaveBeenCalledWith(
      asset.files[0].path,
      expect.objectContaining({ modelName: 'ViT-B-32__openai' }),
    );
    expect(mocks.search.upsert).toHaveBeenCalledWith(asset.id, '[0.01, 0.02, 0.03]');
  });
});
```

**Step 2: Run tests to verify they fail**

Run: `cd server && npx vitest run src/services/smart-info.service.spec.ts`
Expected: FAIL — video tests fail because `handleEncodeClip` doesn't branch on type

**Step 3: Implement the video branch**

Replace `handleEncodeClip` in `server/src/services/smart-info.service.ts` (lines
95-127):

```typescript
import { AssetType } from 'src/enum';
import { elementWiseMean } from 'src/utils/vector';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
// (add these to the existing imports at top of file)

@OnJob({ name: JobName.SmartSearch, queue: QueueName.SmartSearch })
async handleEncodeClip({ id }: JobOf<JobName.SmartSearch>): Promise<JobStatus> {
  const { machineLearning } = await this.getConfig({ withCache: true });
  if (!isSmartSearchEnabled(machineLearning)) {
    return JobStatus.Skipped;
  }

  const asset = await this.assetJobRepository.getForClipEncoding(id);
  if (!asset || asset.files.length !== 1) {
    return JobStatus.Failed;
  }

  if (asset.visibility === AssetVisibility.Hidden) {
    return JobStatus.Skipped;
  }

  let embedding: string;
  if (asset.type === AssetType.Video) {
    const result = await this.encodeVideoClip(asset, machineLearning.clip);
    if (!result) {
      return JobStatus.Failed;
    }
    embedding = result;
  } else {
    embedding = await this.machineLearningRepository.encodeImage(asset.files[0].path, machineLearning.clip);
  }

  if (this.databaseRepository.isBusy(DatabaseLock.CLIPDimSize)) {
    this.logger.verbose(`Waiting for CLIP dimension size to be updated`);
    await this.databaseRepository.wait(DatabaseLock.CLIPDimSize);
  }

  const newConfig = await this.getConfig({ withCache: true });
  if (machineLearning.clip.modelName !== newConfig.machineLearning.clip.modelName) {
    return JobStatus.Skipped;
  }

  await this.searchRepository.upsert(asset.id, embedding);

  return JobStatus.Success;
}

private async encodeVideoClip(
  asset: { id: string; originalPath: string },
  clipConfig: { modelName: string },
): Promise<string | null> {
  let probeResult;
  try {
    probeResult = await this.mediaRepository.probe(asset.originalPath);
  } catch (error) {
    this.logger.error(`Failed to probe video ${asset.id}: ${error}`);
    return null;
  }

  const duration = probeResult.format.duration;
  let timestamps: number[];
  if (!duration || duration <= 0 || !Number.isFinite(duration)) {
    timestamps = [0];
  } else if (duration < 2) {
    timestamps = [duration / 2];
  } else {
    timestamps = Array.from({ length: 8 }, (_, i) => duration * (0.05 + (0.9 * i) / 7));
  }

  const outputDir = await fs.mkdtemp(path.join(os.tmpdir(), 'immich-clip-'));
  try {
    const framePaths = await this.mediaRepository.extractVideoFrames(
      asset.originalPath,
      timestamps,
      outputDir,
    );

    const embeddings: number[][] = [];
    for (const framePath of framePaths) {
      const embeddingStr = await this.machineLearningRepository.encodeImage(framePath, clipConfig);
      embeddings.push(JSON.parse(embeddingStr));
    }

    const averaged = elementWiseMean(embeddings);
    return JSON.stringify(averaged);
  } catch (error) {
    this.logger.error(`Failed to encode video ${asset.id}: ${error}`);
    return null;
  } finally {
    await fs.rm(outputDir, { recursive: true, force: true });
  }
}
```

**Step 4: Run tests to verify they pass**

Run: `cd server && npx vitest run src/services/smart-info.service.spec.ts`
Expected: PASS — all existing + new video tests

**Step 5: Commit**

```
feat: add video CLIP encoding with multi-frame extraction
```

---

### Task 5: Download test video fixtures

**Files:**

- Create: `server/test/fixtures/videos/normal.mp4`
- Create: `server/test/fixtures/videos/short.mp4`
- Create: `server/test/fixtures/videos/normal-reencoded.mp4`

**Step 1: Download a short royalty-free stock video**

Find a 5-10 second CC0/royalty-free clip from Pexels or Pixabay. Download it.

**Step 2: Create the test fixtures**

```bash
mkdir -p server/test/fixtures/videos

# Normal: 4 seconds, 720p, no audio, small file
ffmpeg -i source.mp4 -t 4 -vf scale=1280:720 -an -c:v libx264 -crf 28 \
  server/test/fixtures/videos/normal.mp4

# Short: 1 second, same source
ffmpeg -i source.mp4 -t 1 -vf scale=1280:720 -an -c:v libx264 -crf 28 \
  server/test/fixtures/videos/short.mp4

# Re-encoded: same content as normal, different resolution and bitrate
ffmpeg -i server/test/fixtures/videos/normal.mp4 -vf scale=640:360 -b:v 300k -an \
  server/test/fixtures/videos/normal-reencoded.mp4
```

**Step 3: Verify file sizes**

```bash
ls -lh server/test/fixtures/videos/
```

Each file should be under 500 KB. If too large, increase `-crf` or reduce duration.

**Step 4: Commit**

```
test: add stock video fixtures for duplicate detection tests
```

---

### Task 6: Run lint and type checks

**Step 1: Run server lint**

Run: `cd server && npx eslint --fix src/utils/vector.ts src/services/smart-info.service.ts src/repositories/media.repository.ts src/repositories/asset-job.repository.ts`

Fix any issues.

**Step 2: Run server type check**

Run: `cd server && npx tsc --noEmit`

Fix any type errors. Common issues:

- `probe` return type might not have `format.duration` as `number | undefined` — check
  the `VideoInfo` type and handle accordingly.
- `asset.type` and `asset.originalPath` might need type narrowing after the query
  change.

**Step 3: Run prettier**

Run: `cd server && npx prettier --write src/utils/vector.ts src/utils/vector.spec.ts src/services/smart-info.service.ts src/services/smart-info.service.spec.ts src/repositories/media.repository.ts src/repositories/asset-job.repository.ts`

**Step 4: Commit any fixes**

```
chore: fix lint and type errors
```

---

### Task 7: Run full server test suite

**Step 1: Run all server unit tests**

Run: `cd server && pnpm test`

Expected: PASS — no regressions.

**Step 2: Fix any failures**

If tests fail, investigate and fix. Common issues:

- Other tests that mock `getForClipEncoding` may need updating if they assert on
  the return shape (now includes `type` and `originalPath`).
- The `AssetFactory.create()` default type is `AssetType.Image`, so existing tests
  should still pass for the image path.

**Step 3: Commit any fixes**

```
fix: resolve test regressions from clip encoding query change
```

---

### Task 8: Regenerate SQL query documentation

**Step 1: Check if `make sql` can run**

Run: `make sql`

This requires a running database. If it fails, skip and note it for the PR
description.

**Step 2: If SQL files changed, commit**

```
chore: regenerate SQL query documentation
```
