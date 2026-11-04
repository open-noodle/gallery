import { Injectable } from '@nestjs/common';
import { Kysely } from 'kysely';
import { InjectKysely } from 'nestjs-kysely';
import fs from 'node:fs/promises';
import path from 'node:path';
import { DummyValue, GenerateSql } from 'src/decorators.js';
import { DB } from 'src/schema/index.js';
import { asUuid } from 'src/utils/database.js';

@Injectable()
export class StorageUsageRepository {
  constructor(@InjectKysely() private db: Kysely<DB>) {}

  async getFolderSize(folder: string, shouldCount?: (filename: string) => boolean): Promise<number> {
    let total = 0;
    let dir;
    try {
      dir = await fs.opendir(folder);
    } catch (error: any) {
      if (error.code === 'ENOENT') {
        return 0;
      }
      throw error;
    }

    for await (const entry of dir) {
      const entryPath = path.join(folder, entry.name);
      if (entry.isDirectory()) {
        total += await this.getFolderSize(entryPath, shouldCount);
      } else if (entry.isFile() && (!shouldCount || shouldCount(entry.name))) {
        try {
          const entryStat = await fs.stat(entryPath);
          total += entryStat.size;
        } catch (error: any) {
          // The nightly scan walks a live tree that delete jobs are writing to; a file that
          // disappears mid-walk must not abort the whole user's sync.
          if (error.code !== 'ENOENT') {
            throw error;
          }
        }
      }
    }

    return total;
  }

  // Gallery-fork: writes an already-computed figure into the same column UserRepository.syncUsage fills,
  // so nothing downstream has to know which of the two produced it. Used when the admin has opted
  // into counting server-generated files, where the number comes from a disk/S3 walk rather than
  // from summing exif file sizes.
  @GenerateSql({ params: [DummyValue.UUID, DummyValue.NUMBER] })
  async setUsage(id: string, usage: number): Promise<void> {
    await this.db
      .updateTable('user')
      .set({ quotaUsageInBytes: usage, updatedAt: new Date() })
      .where('id', '=', asUuid(id))
      .where('user.deletedAt', 'is', null)
      .execute();
  }
}
