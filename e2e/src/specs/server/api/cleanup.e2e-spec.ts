import {
  AssetMediaResponseDto,
  CleanupCountQueue,
  CleanupQueue,
  LoginResponseDto,
  getCleanupCalendar,
  getCleanupQueueCount,
} from '@immich/sdk';
import { randomUUID } from 'node:crypto';
import { createUserDto } from 'src/fixtures.js';
import { errorDto } from 'src/responses.js';
import { app, asBearerAuth, utils } from 'src/utils.js';
import request from 'supertest';
import { beforeAll, describe, expect, it } from 'vitest';

// Fixed calendar date used across the rewind/calendar/commit tests, so every test in this file that
// cares about "the seeded date" agrees on the same month/day. August 15th, mid-day UTC, to stay well
// away from any timezone's day boundary.
const SEEDED_MONTH_DAY = 815;
const SEEDED_YEAR = 2020;
const SEEDED_DATE = `${SEEDED_YEAR}-08-15T12:00:00.000Z`;

describe('/cleanup', () => {
  let admin: LoginResponseDto;
  let user1: LoginResponseDto;
  let user2: LoginResponseDto;

  // Two of user1's assets seeded on SEEDED_MONTH_DAY/SEEDED_YEAR, used by the calendar/rewind/commit
  // tests. One foreign asset (user2's), used to prove a foreign id never leaks existence.
  let user1Asset1: AssetMediaResponseDto;
  let user1Asset2: AssetMediaResponseDto;
  let user2Asset1: AssetMediaResponseDto;

  beforeAll(async () => {
    await utils.resetDatabase();

    admin = await utils.adminSetup();
    [user1, user2] = await Promise.all([
      utils.userSetup(admin.accessToken, createUserDto.user1),
      utils.userSetup(admin.accessToken, createUserDto.user2),
    ]);

    [user1Asset1, user1Asset2, user2Asset1] = await Promise.all([
      utils.createAsset(user1.accessToken, { fileCreatedAt: SEEDED_DATE }),
      utils.createAsset(user1.accessToken, { fileCreatedAt: SEEDED_DATE }),
      utils.createAsset(user2.accessToken),
    ]);
  });

  describe('authentication', () => {
    type Method = 'get' | 'post' | 'delete';
    const routes: Array<{ method: Method; url: string }> = [
      { method: 'get', url: '/cleanup/queues/space_hogs/count' },
      { method: 'get', url: '/cleanup/trash' },
      { method: 'get', url: '/cleanup/calendar?tz=UTC' },
      { method: 'get', url: `/cleanup/rewind/${SEEDED_MONTH_DAY}` },
      { method: 'get', url: `/cleanup/rewind/${SEEDED_MONTH_DAY}/${SEEDED_YEAR}` },
      { method: 'get', url: '/cleanup/queues/space_hogs' },
      { method: 'post', url: '/cleanup/commit' },
      { method: 'delete', url: '/cleanup/decisions' },
      { method: 'post', url: '/cleanup/in-spaces' },
    ];

    it.each(routes)('$method $url should require authentication', async ({ method, url }) => {
      const { status, body } = await request(app)[method](url);
      expect(status).toBe(401);
      expect(body).toEqual(errorDto.unauthorized);
    });
  });

  describe('GET /cleanup/calendar', () => {
    it('returns 366 days, with the seeded date carrying at least one asset', async () => {
      const { status, body } = await request(app)
        .get('/cleanup/calendar?tz=UTC')
        .set('Authorization', `Bearer ${user1.accessToken}`);

      expect(status).toBe(200);
      expect(body.days).toHaveLength(366);

      const seededDay = body.days.find((day: { monthDay: number }) => day.monthDay === SEEDED_MONTH_DAY);
      expect(seededDay).toBeDefined();
      expect(seededDay.assetCount).toBeGreaterThanOrEqual(2);
    });
  });

  describe('GET /cleanup/rewind/:monthDay and /:monthDay/:year', () => {
    it('lists the seeded year', async () => {
      const { status, body } = await request(app)
        .get(`/cleanup/rewind/${SEEDED_MONTH_DAY}`)
        .set('Authorization', `Bearer ${user1.accessToken}`);

      expect(status).toBe(200);
      expect(body.years).toEqual(expect.arrayContaining([expect.objectContaining({ year: SEEDED_YEAR, count: 2 })]));
    });

    it('returns the seeded assets for that date and year', async () => {
      const { status, body } = await request(app)
        .get(`/cleanup/rewind/${SEEDED_MONTH_DAY}/${SEEDED_YEAR}`)
        .set('Authorization', `Bearer ${user1.accessToken}`);

      expect(status).toBe(200);
      const ids = body.assets.map((asset: { id: string }) => asset.id);
      expect(ids).toEqual(expect.arrayContaining([user1Asset1.id, user1Asset2.id]));
    });
  });

  describe('POST /cleanup/commit', () => {
    it('trashes an owned asset', async () => {
      const { status, body } = await request(app)
        .post('/cleanup/commit')
        .set('Authorization', `Bearer ${user1.accessToken}`)
        .send({ queue: CleanupQueue.Rewind, trashIds: [user1Asset1.id] });

      expect(status).toBe(200);
      expect(body).toEqual(expect.objectContaining({ trashed: [user1Asset1.id], favorited: 0, kept: 0, skipped: [] }));

      const info = await utils.getAssetInfo(user1.accessToken, user1Asset1.id);
      expect(info.isTrashed).toBe(true);
    });

    it('skips a foreign asset id as not_found, and leaves it untouched', async () => {
      const { status, body } = await request(app)
        .post('/cleanup/commit')
        .set('Authorization', `Bearer ${user1.accessToken}`)
        .send({ queue: CleanupQueue.Rewind, trashIds: [user2Asset1.id] });

      expect(status).toBe(200);
      expect(body).toEqual(
        expect.objectContaining({ trashed: [], skipped: [{ id: user2Asset1.id, reason: 'not_found' }] }),
      );

      const info = await utils.getAssetInfo(user2.accessToken, user2Asset1.id);
      expect(info.isTrashed).toBe(false);
    });

    it('skips a re-commit of the same asset as already_trashed', async () => {
      const { status, body } = await request(app)
        .post('/cleanup/commit')
        .set('Authorization', `Bearer ${user1.accessToken}`)
        .send({ queue: CleanupQueue.Rewind, trashIds: [user1Asset1.id] });

      expect(status).toBe(200);
      expect(body).toEqual(
        expect.objectContaining({ trashed: [], skipped: [{ id: user1Asset1.id, reason: 'already_trashed' }] }),
      );
    });
  });

  describe('POST /trash/restore/assets', () => {
    it('restores the trashed asset, and it reappears in the rewind listing', async () => {
      const { status } = await request(app)
        .post('/trash/restore/assets')
        .set('Authorization', `Bearer ${user1.accessToken}`)
        .send({ ids: [user1Asset1.id] });
      expect(status).toBe(200);

      const info = await utils.getAssetInfo(user1.accessToken, user1Asset1.id);
      expect(info.isTrashed).toBe(false);

      const { body } = await request(app)
        .get(`/cleanup/rewind/${SEEDED_MONTH_DAY}/${SEEDED_YEAR}`)
        .set('Authorization', `Bearer ${user1.accessToken}`);
      const ids = body.assets.map((asset: { id: string }) => asset.id);
      expect(ids).toEqual(expect.arrayContaining([user1Asset1.id, user1Asset2.id]));
    });
  });

  describe('completeMonthDay', () => {
    it('marks the day reviewed and grows the streak', async () => {
      const { status, body } = await request(app)
        .post('/cleanup/commit')
        .set('Authorization', `Bearer ${user1.accessToken}`)
        .send({ queue: CleanupQueue.Rewind, completeMonthDay: SEEDED_MONTH_DAY });

      expect(status).toBe(200);
      expect(body).toEqual(expect.objectContaining({ trashed: [], skipped: [] }));

      const calendar = await getCleanupCalendar({ tz: 'UTC' }, { headers: asBearerAuth(user1.accessToken) });
      const day = calendar.days.find((d) => d.monthDay === SEEDED_MONTH_DAY);
      expect(day?.reviewedAt).not.toBeNull();
      expect(calendar.streak).toBeGreaterThanOrEqual(1);
    });
  });

  describe('GET /cleanup/queues/space_hogs', () => {
    // Space hogs sorts by the asset's own fileSizeInByte descending. Real uploaded test images are a
    // 1x1 PNG (well under a kilobyte), so setting fileSizeInByte directly in the DB and filtering with
    // minSize keeps this deterministic without needing 100MB+ uploads.
    let hogA: AssetMediaResponseDto;
    let hogB: AssetMediaResponseDto;
    let hogC: AssetMediaResponseDto;
    const MIN_SIZE = 1_000_000;

    beforeAll(async () => {
      [hogA, hogB, hogC] = await Promise.all([
        utils.createAsset(user1.accessToken),
        utils.createAsset(user1.accessToken),
        utils.createAsset(user1.accessToken),
      ]);
      await utils.waitForQueueFinish(admin.accessToken, 'metadataExtraction');

      const client = await utils.connectDatabase();
      await client.query('UPDATE asset_exif SET "fileSizeInByte" = $1 WHERE "assetId" = $2', [3_000_000, hogA.id]);
      await client.query('UPDATE asset_exif SET "fileSizeInByte" = $1 WHERE "assetId" = $2', [2_000_000, hogB.id]);
      await client.query('UPDATE asset_exif SET "fileSizeInByte" = $1 WHERE "assetId" = $2', [1_500_000, hogC.id]);
    });

    it('is sorted by size descending, and nextCursor round-trips the remainder', async () => {
      const page1 = await request(app)
        .get(`/cleanup/queues/space_hogs?minSize=${MIN_SIZE}&limit=2`)
        .set('Authorization', `Bearer ${user1.accessToken}`);

      expect(page1.status).toBe(200);
      expect(page1.body.items.map((item: { id: string }) => item.id)).toEqual([hogA.id, hogB.id]);
      expect(page1.body.nextCursor).toEqual(expect.any(String));

      const page2 = await request(app)
        .get(
          `/cleanup/queues/space_hogs?minSize=${MIN_SIZE}&limit=2&cursor=${encodeURIComponent(page1.body.nextCursor)}`,
        )
        .set('Authorization', `Bearer ${user1.accessToken}`);

      expect(page2.status).toBe(200);
      expect(page2.body.items.map((item: { id: string }) => item.id)).toEqual([hogC.id]);
      expect(page2.body.nextCursor).toBeNull();
    });

    it('rejects a bad cursor with 400', async () => {
      const { status } = await request(app)
        .get(`/cleanup/queues/space_hogs?minSize=${MIN_SIZE}&cursor=not-a-valid-cursor`)
        .set('Authorization', `Bearer ${user1.accessToken}`);

      expect(status).toBe(400);
    });
  });

  describe('POST /cleanup/in-spaces', () => {
    it('returns only the ids that belong to a shared space', async () => {
      const spaceAsset = await utils.createAsset(user1.accessToken);
      const outsideAsset = await utils.createAsset(user1.accessToken);

      const space = await utils.createSpace(user1.accessToken, { name: `Cleanup Space ${randomUUID()}` });
      await utils.addSpaceAssets(user1.accessToken, space.id, [spaceAsset.id]);

      const { status, body } = await request(app)
        .post('/cleanup/in-spaces')
        .set('Authorization', `Bearer ${user1.accessToken}`)
        .send({ assetIds: [spaceAsset.id, outsideAsset.id] });

      expect(status).toBe(200);
      expect(body.assetIds).toEqual([spaceAsset.id]);
    });
  });

  describe('GET /cleanup/queues/duplicates/count', () => {
    it('returns a count and bytes total', async () => {
      const duplicateId = randomUUID();
      const [first, second] = await Promise.all([
        utils.createAsset(user1.accessToken),
        utils.createAsset(user1.accessToken),
      ]);
      await utils.setAssetDuplicateId(user1.accessToken, first.id, duplicateId);
      await utils.setAssetDuplicateId(user1.accessToken, second.id, duplicateId);

      const result = await getCleanupQueueCount(
        { queue: CleanupCountQueue.Duplicates },
        { headers: asBearerAuth(user1.accessToken) },
      );

      expect(result).toEqual(expect.objectContaining({ count: expect.any(Number), bytes: expect.any(Number) }));
      expect(result.count).toBeGreaterThanOrEqual(1);
    });
  });
});
