import { Injectable } from '@nestjs/common';
import ffmpeg from 'fluent-ffmpeg';
import { Kysely } from 'kysely';
import { InjectKysely } from 'nestjs-kysely';
import path from 'node:path';
import { DummyValue, GenerateSql } from 'src/decorators.js';
import { LoggingRepository } from 'src/repositories/logging.repository.js';
import { DB } from 'src/schema/index.js';
import { asUuid } from 'src/utils/database.js';

@Injectable()
export class VideoTrimRepository {
  constructor(
    @InjectKysely() private db: Kysely<DB>,
    private logger: LoggingRepository,
  ) {
    this.logger.setContext(VideoTrimRepository.name);
  }

  /** The asset fields trimming validates against, with its current trim (null fields when untrimmed). */
  @GenerateSql({ params: [DummyValue.UUID] })
  getForTrim(assetId: string) {
    return this.db
      .selectFrom('asset')
      .leftJoin('asset_video_trim', 'asset_video_trim.assetId', 'asset.id')
      .select([
        'asset.type',
        'asset.livePhotoVideoId',
        'asset.originalPath',
        'asset.duration',
        'asset_video_trim.startTime',
        'asset_video_trim.endTime',
      ])
      .where('asset.id', '=', asUuid(assetId))
      .executeTakeFirst();
  }

  @GenerateSql({ params: [DummyValue.UUID] })
  get(assetId: string) {
    return this.db
      .selectFrom('asset_video_trim')
      .select(['asset_video_trim.startTime', 'asset_video_trim.endTime'])
      .where('asset_video_trim.assetId', '=', asUuid(assetId))
      .executeTakeFirst();
  }

  @GenerateSql({ params: [DummyValue.UUID, 1, 3] })
  async upsert(assetId: string, startTime: number, endTime: number) {
    await this.db
      .insertInto('asset_video_trim')
      .values({ assetId, startTime, endTime })
      .onConflict((oc) => oc.column('assetId').doUpdateSet({ startTime, endTime }))
      .execute();
  }

  @GenerateSql({ params: [DummyValue.UUID] })
  async delete(assetId: string): Promise<boolean> {
    const deleted = await this.db
      .deleteFrom('asset_video_trim')
      .where('assetId', '=', asUuid(assetId))
      .returning('assetId')
      .executeTakeFirst();
    return !!deleted;
  }

  /** Records the trimmed file's length and bumps asset.updateId, so clients re-sync the projected duration. */
  @GenerateSql({ params: [DummyValue.UUID, 2000] })
  async setDuration(assetId: string, duration: number) {
    await this.db
      .with('trim', (qb) =>
        qb
          .updateTable('asset_video_trim')
          .set({ duration })
          .where('assetId', '=', asUuid(assetId))
          .returning('assetId'),
      )
      .updateTable('asset')
      .set({ isEdited: true })
      .where('id', 'in', (eb) => eb.selectFrom('trim').select('trim.assetId'))
      .execute();
  }

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

  trim(input: string, output: string, startTime: number, duration: number): Promise<void> {
    return new Promise((resolve, reject) => {
      ffmpeg(input, { niceness: 10 })
        .inputOptions(['-ss', String(startTime)])
        .outputOptions(['-t', String(duration), '-c', 'copy', '-avoid_negative_ts', 'make_zero'])
        .output(output)
        .on('start', (command: string) => this.logger.debug(command))
        .on('error', (error, _, stderr) => {
          this.logger.error(stderr || error);
          reject(error);
        })
        .on('end', () => resolve())
        .run();
    });
  }

  extractFrame(input: string, output: string, timeSeconds: number, streamIndex?: number): Promise<void> {
    return new Promise((resolve, reject) => {
      const outputOptions = streamIndex === undefined ? [] : ['-map', `0:${streamIndex}`];
      ffmpeg(input, { niceness: 10 })
        .inputOptions(['-ss', String(timeSeconds)])
        .outputOptions([...outputOptions, '-frames:v', '1', '-q:v', '2'])
        .output(output)
        .on('start', (command: string) => this.logger.debug(command))
        .on('error', (error, _, stderr) => {
          this.logger.error(stderr || error);
          reject(error);
        })
        .on('end', () => resolve())
        .run();
    });
  }
}
