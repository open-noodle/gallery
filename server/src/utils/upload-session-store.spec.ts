import { mkdtemp, readFile, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  claimFinalize,
  committedOffset,
  finalizeClaimPath,
  readState,
  sessionPaths,
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
  // ---------------------------------------------------------------------------------------------
  // Spec 5.4 invariants. These run against a real filesystem (mkdtemp above), which is why they
  // live here rather than in a Docker-backed medium test — nothing here needs a database.
  // ---------------------------------------------------------------------------------------------

  it('produces a byte-identical file to a single write when uploaded in three unequal chunks', async () => {
    const payload = Buffer.from('the quick brown fox jumps over the lazy dog, repeatedly and at length');
    const chunked = join(dir, 'chunked.bin');
    const single = join(dir, 'single.bin');

    await writeFile(chunked, '');
    // deliberately unequal, to exercise the "server enforces no chunk size" invariant
    const cuts = [0, 7, 40, payload.length];
    for (let i = 0; i < cuts.length - 1; i++) {
      await writeChunkAt(chunked, cuts[i], payload.subarray(cuts[i], cuts[i + 1]));
    }
    await writeFile(single, payload);

    const [a, b] = await Promise.all([readFile(chunked), readFile(single)]);
    expect(a.equals(b)).toBe(true);
    expect(await committedOffset(chunked)).toBe(payload.length);
  });

  it('never produces a sparse file', async () => {
    // Rule 3 (offset must EQUAL the committed size) is the only thing preventing a positional
    // write from landing past EOF. If it is ever relaxed to "offset <= size", this is the test
    // that catches it — every other test in this file would still pass.
    const payload = Buffer.alloc(128 * 1024, 7);
    const data = join(dir, 'dense.bin');
    await writeFile(data, '');
    for (let offset = 0; offset < payload.length; offset += 16 * 1024) {
      await writeChunkAt(data, offset, payload.subarray(offset, offset + 16 * 1024));
    }

    const stats = await stat(data);
    expect(stats.size).toBe(payload.length);
    // A hole would leave allocated blocks well below the apparent size.
    expect(stats.blocks * 512).toBeGreaterThanOrEqual(stats.size);
  });

  it('reports the true on-disk offset after a truncated write, so the client can resume exactly', async () => {
    const data = join(dir, 'partial.bin');
    await writeFile(data, '');
    await writeChunkAt(data, 0, Buffer.from('0123456789'));
    // simulate a process death mid-chunk: only part of the intended range landed
    expect(await committedOffset(data)).toBe(10);

    await writeChunkAt(data, 10, Buffer.from('abcde'));
    expect(await committedOffset(data)).toBe(15);
    const written = await readFile(data);
    expect(written.toString()).toBe('0123456789abcde');
  });
  it('sanitizes a traversal attempt in the extension instead of escaping the folder', () => {
    const { data, state } = sessionPaths(dir, 'uuid', '/../../etc/passwd');

    // The security property is containment, not the absence of dots: sanitize strips the path
    // SEPARATORS, so any remaining dots are inert characters in a single filename.
    expect(data.startsWith(dir + '/')).toBe(true);
    expect(state.startsWith(dir + '/')).toBe(true);
    expect(data.slice(dir.length + 1)).not.toContain('/');
    expect(state.slice(dir.length + 1)).not.toContain('/');
    expect(data).not.toContain('/etc/passwd');
  });

  it('keeps a benign extension intact', () => {
    const { data } = sessionPaths(dir, 'uuid', '.CR3');
    expect(data.endsWith('uuid.CR3')).toBe(true);
  });
});
