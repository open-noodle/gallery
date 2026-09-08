import { constants } from 'node:fs';
import { open, readFile, rename, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

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

export const sessionPaths = (folder: string, uuid: string, extension: string) => ({
  data: join(folder, `${uuid}${extension}`),
  state: join(folder, `${uuid}.session.json`),
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
    return (await stat(dataPath)).size;
  } catch (error) {
    if (isNotFound(error)) {
      return 0;
    }
    throw error;
  }
};
