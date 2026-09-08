import { constants } from 'node:fs';
import { open, readFile, rename, stat, writeFile } from 'node:fs/promises';
import { join, resolve, sep } from 'node:path';
import sanitize from 'sanitize-filename';

export type UploadSessionState = {
  userId: string;
  /** Non-null only when the session was created through a shared link (spec §8 row 44). */
  sharedLinkId: string | null;
  size: number;
  originalName: string;
  checksum?: string;
  createdAt: string;
  dto: Record<string, unknown>;
};

const isNotFound = (error: unknown): boolean =>
  !!error && typeof error === 'object' && (error as NodeJS.ErrnoException).code === 'ENOENT';

/**
 * Joins a single filename onto `folder` and proves the result stayed inside it.
 *
 * Two independent guards, because each covers what the other misses:
 *  - `sanitize` strips traversal segments from the name, matching what
 *    `AssetMediaService.getUploadFilename` already does on the single-shot path;
 *  - the containment check then *proves* the resolved path is still under `folder`, so a future
 *    edit that reintroduces an unsanitized component fails loudly instead of writing outside the
 *    upload directory.
 *
 * The uuid is server-generated, but `extension` derives from the client-supplied filename, so an
 * untrusted value does reach a filesystem path here.
 */
const withinFolder = (folder: string, name: string): string => {
  const path = join(folder, sanitize(name));
  const root = resolve(folder);
  const resolved = resolve(path);
  if (resolved !== root && !resolved.startsWith(root + sep)) {
    throw new Error('Refusing to build an upload-session path outside its folder');
  }
  return resolved;
};

export const sessionPaths = (folder: string, uuid: string, extension: string) => ({
  data: withinFolder(folder, `${uuid}${extension}`),
  state: withinFolder(folder, `${uuid}.session.json`),
});

export const writeState = async (statePath: string, state: UploadSessionState): Promise<void> => {
  await writeFile(statePath, JSON.stringify(state), 'utf8');
};

export const readState = async (statePath: string): Promise<UploadSessionState | undefined> => {
  try {
    return JSON.parse(await readFile(statePath, 'utf8')) as UploadSessionState;
  } catch (error) {
    if (isNotFound(error)) {
      return undefined;
    }
    throw error;
  }
};

export const finalizeClaimPath = (statePath: string): string => `${statePath}.finalizing`;

/**
 * Claim the right to finalize by renaming the state file aside. `rename` is exclusive under
 * concurrency where `unlink` is not (verified empirically on Node 24 / darwin: concurrent
 * `unlink` on the same path returns success for every caller, while concurrent `rename` returns
 * success for exactly one and `ENOENT` for the rest). This is the cross-replica mutual exclusion
 * described in spec §5.4. The winner owns the `.finalizing` file and is responsible for removing
 * it once finalize completes.
 */
export const claimFinalize = async (statePath: string): Promise<boolean> => {
  try {
    await rename(statePath, finalizeClaimPath(statePath));
    return true;
  } catch (error) {
    if (isNotFound(error)) {
      return false;
    }
    throw error;
  }
};

/**
 * Positional write, never append: a replayed chunk rewrites identical bytes at the same offset,
 * which is what makes a duplicated request harmless (spec §5.4).
 */
export const writeChunkAt = async (dataPath: string, offset: number, chunk: Buffer): Promise<void> => {
  const handle = await open(dataPath, constants.O_RDWR | constants.O_CREAT);
  try {
    await handle.write(chunk, 0, chunk.length, offset);
  } finally {
    await handle.close();
  }
};

export const committedOffset = async (dataPath: string): Promise<number> => {
  try {
    const stats = await stat(dataPath);
    return stats.size;
  } catch (error) {
    if (isNotFound(error)) {
      return 0;
    }
    throw error;
  }
};
