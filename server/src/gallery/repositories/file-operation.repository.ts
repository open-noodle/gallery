import { Injectable } from '@nestjs/common';
import { Kysely, sql } from 'kysely';
import { InjectKysely } from 'nestjs-kysely';
import { setTimeout as sleep } from 'node:timers/promises';
import { AssetFileType, DatabaseLock } from 'src/enum.js';
import { LoggingRepository } from 'src/repositories/logging.repository.js';
import { DB } from 'src/schema/index.js';
import { anyUuid, asUuid } from 'src/utils/database.js';

export type FileOperationResult<T> = { acquired: true; result: T } | { acquired: false };

export type RenamePlan = {
  /** Rows that hold a new path and are removed once the rename commits: their checksum and path are set aside. */
  replaced: { id: string; checksum: Buffer; originalPath: string }[];
  renames: { id: string; oldPath: string; originalPath: string; originalFileName: string; checksum?: Buffer }[];
  sidecars: { assetId: string; oldPath: string; newPath: string }[];
};

class RenameRowChanged extends Error {}

/**
The file-operation lock (DatabaseLock.FileOperation) and the queries of the in-app file rename
(specs/2026-11-10-external-library-move-rename-design.md). It is a session advisory lock, so it holds across the API
and microservices processes.
*/
@Injectable()
export class FileOperationRepository {
  constructor(
    @InjectKysely() private db: Kysely<DB>,
    private logger: LoggingRepository,
  ) {
    this.logger.setContext(FileOperationRepository.name);
  }

  /** Runs the callback holding the lock, or reports `acquired: false` at once when another operation holds it. */
  tryRun<T>(callback: () => Promise<T>): Promise<FileOperationResult<T>> {
    return this.db.connection().execute(async (connection) => {
      const { rows } = await sql<{
        locked: boolean;
      }>`SELECT pg_try_advisory_lock(${DatabaseLock.FileOperation}) AS locked`.execute(connection);
      if (!rows[0].locked) {
        return { acquired: false } as const;
      }

      try {
        return { acquired: true, result: await callback() } as const;
      } finally {
        await sql`SELECT pg_advisory_unlock(${DatabaseLock.FileOperation})`.execute(connection);
      }
    });
  }

  async isHeld(): Promise<boolean> {
    const { rows } = await sql<{ held: boolean }>`
      SELECT EXISTS (
        SELECT 1 FROM pg_locks
        WHERE locktype = 'advisory' AND classid = 0 AND objsubid = 1 AND granted
          AND database = (SELECT oid FROM pg_database WHERE datname = current_database())
          AND objid = ${DatabaseLock.FileOperation}::oid
      ) AS held`.execute(this.db);
    return rows[0].held;
  }

  /** Polls until no file operation runs. Gives up after `timeoutMs` so a stuck holder cannot stall callers forever. */
  async waitUntilIdle({ timeoutMs = 30_000, intervalMs = 250 } = {}): Promise<void> {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline && (await this.isHeld())) {
      await sleep(intervalMs);
    }
  }

  getRenameSubjects(ids: string[]) {
    return this.db
      .selectFrom('asset')
      .select([
        'asset.id',
        'asset.ownerId',
        'asset.libraryId',
        'asset.isExternal',
        'asset.originalPath',
        'asset.originalFileName',
        'asset.checksum',
        'asset.checksumAlgorithm',
        'asset.livePhotoVideoId',
      ])
      .where('asset.id', '=', anyUuid(ids))
      .execute();
  }

  getSidecarPaths(assetIds: string[]) {
    return this.db
      .selectFrom('asset_file')
      .select(['asset_file.assetId', 'asset_file.path'])
      .where('asset_file.assetId', '=', anyUuid(assetIds))
      .where('asset_file.type', '=', AssetFileType.Sidecar)
      .where('asset_file.isEdited', '=', false)
      .execute();
  }

  /** Rows of a library that hold one of the paths, or the path checksum of one of them. */
  getAtPaths(libraryId: string, paths: string[], checksums: Buffer[]) {
    return this.db
      .selectFrom('asset')
      .select(['asset.id', 'asset.originalPath', 'asset.checksum', 'asset.status', 'asset.isOffline'])
      .where('asset.libraryId', '=', asUuid(libraryId))
      .where((eb) => eb.or([eb('asset.originalPath', 'in', paths), eb('asset.checksum', 'in', checksums)]))
      .execute();
  }

  async setFileNames(items: { id: string; originalFileName: string }[]): Promise<void> {
    await this.db.transaction().execute(async (tx) => {
      for (const { id, originalFileName } of items) {
        await tx.updateTable('asset').set({ originalFileName }).where('id', '=', id).execute();
      }
    });
  }

  /**
  Moves the rows to their new paths in one transaction. Returns false, with nothing changed, when a row is gone or no
  longer at its old path, e.g. a watcher removed it.
  */
  async applyRename(plan: RenamePlan): Promise<boolean> {
    try {
      await this.db.transaction().execute(async (tx) => {
        for (const { id, checksum, originalPath } of plan.replaced) {
          await tx.updateTable('asset').set({ checksum, originalPath }).where('id', '=', id).execute();
        }

        for (const { id, oldPath, ...changes } of plan.renames) {
          const updated = await tx
            .updateTable('asset')
            .set(changes)
            .where('id', '=', id)
            .where('originalPath', '=', oldPath)
            .returning('id')
            .executeTakeFirst();
          if (!updated) {
            throw new RenameRowChanged();
          }
        }

        for (const { assetId, oldPath, newPath } of plan.sidecars) {
          await tx
            .updateTable('asset_file')
            .set({ path: newPath })
            .where('assetId', '=', assetId)
            .where('type', '=', AssetFileType.Sidecar)
            .where('path', '=', oldPath)
            .execute();
        }
      });
      return true;
    } catch (error) {
      if (error instanceof RenameRowChanged) {
        return false;
      }
      throw error;
    }
  }
}
