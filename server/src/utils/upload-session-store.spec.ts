import { mkdtemp, readFile, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  claimFinalize,
  committedOffset,
  finalizeClaimPath,
  readState,
  UploadSessionState,
  writeChunkAt,
  writeState,
} from 'src/utils/upload-session-store';

const state: UploadSessionState = {
  userId: 'user-1',
  sharedLinkId: null,
  size: 10,
  originalName: 'a.jpg',
  createdAt: '2026-09-08T10:00:00.000Z',
  dto: {},
};

describe('upload-session-store', () => {
  let dir: string;
  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'upload-session-'));
  });

  it('round-trips session state', async () => {
    const path = join(dir, 's.session.json');
    await writeState(path, state);
    await expect(readState(path)).resolves.toEqual(state);
  });

  it('returns undefined for a missing state file', async () => {
    await expect(readState(join(dir, 'missing.session.json'))).resolves.toBeUndefined();
  });

  it('reports offset 0 for a file that does not exist yet', async () => {
    await expect(committedOffset(join(dir, 'nope.jpg'))).resolves.toBe(0);
  });

  it('writes chunks positionally and reports the committed offset', async () => {
    const data = join(dir, 'a.jpg');
    await writeFile(data, '');
    await writeChunkAt(data, 0, Buffer.from('hello'));
    expect(await committedOffset(data)).toBe(5);
    await writeChunkAt(data, 5, Buffer.from('world'));
    expect(await committedOffset(data)).toBe(10);
    const written = await readFile(data);
    expect(written.toString()).toBe('helloworld');
  });

  // Spec §5.4 — a replayed chunk rewrites identical bytes at the same position.
  it('is idempotent when the same chunk is written twice', async () => {
    const data = join(dir, 'a.jpg');
    await writeFile(data, '');
    await writeChunkAt(data, 0, Buffer.from('hello'));
    await writeChunkAt(data, 0, Buffer.from('hello'));
    expect(await committedOffset(data)).toBe(5);
    const written = await readFile(data);
    expect(written.toString()).toBe('hello');
  });

  // Spec §5.4 — exactly one caller may finalize.
  it('lets exactly one caller claim finalization', async () => {
    const path = join(dir, 's.session.json');
    await writeState(path, state);
    const results = await Promise.all([claimFinalize(path), claimFinalize(path), claimFinalize(path)]);
    expect(results.filter(Boolean)).toHaveLength(1);
    await expect(stat(path)).rejects.toThrow();
  });

  it('returns false when claiming a session that is already gone', async () => {
    await expect(claimFinalize(join(dir, 'gone.session.json'))).resolves.toBe(false);
  });

  it('renames the state file aside on a successful claim, leaving nothing at the original path', async () => {
    const path = join(dir, 's.session.json');
    await writeState(path, state);
    await expect(claimFinalize(path)).resolves.toBe(true);
    await expect(stat(path)).rejects.toThrow();
    await expect(readState(finalizeClaimPath(path))).resolves.toEqual(state);
  });
});
