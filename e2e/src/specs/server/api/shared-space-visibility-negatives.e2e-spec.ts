/**
 * Slice 11 — e2e RBAC negatives for space visibility gate.
 *
 * As a non-owner member, asserts that Hidden/Locked assets:
 *   1. Return 400 on GET /assets/:id
 *   2. Return 400 on GET /assets/:id/original
 *   3. Are absent from POST /download/info (spaceId) zip manifest
 *   4. Are absent from POST /download/info (albumId) zip manifest (via AlbumDownload space grant)
 *
 * Each test creates a fresh space + assets to avoid cross-test state contamination.
 *
 * Timeline and Archive assets are verified accessible (positive control) so that
 * 400 responses on Hidden/Locked are confirmed to be gate failures, not setup bugs.
 */

import {
  AlbumUserRole,
  AssetVisibility,
  LoginResponseDto,
  SharedSpaceRole,
  SyncRequestType,
  updateAsset,
  updateAssets,
} from '@immich/sdk';
import { readFile } from 'node:fs/promises';
import { basename, join } from 'node:path';
import { createUserDto } from 'src/fixtures';
import { app, asBearerAuth, testAssetDir, utils } from 'src/utils';
import request from 'supertest';
import { beforeAll, describe, expect, it } from 'vitest';

interface SyncLine {
  type: string;
  ack: string;
  data: Record<string, unknown>;
}

const parseSyncStream = (text: string): SyncLine[] =>
  text
    .split('\n')
    .filter((line) => line.trim().length > 0)
    .map((line) => JSON.parse(line) as SyncLine);

/** POST /sync/stream and return the parsed NDJSON lines, for the given access token. */
const syncStream = async (accessToken: string, types: SyncRequestType[], reset = false): Promise<SyncLine[]> => {
  const response = await request(app)
    .post('/sync/stream')
    .set('Authorization', `Bearer ${accessToken}`)
    .send({ types, reset })
    .buffer(true)
    .parse((res, callback) => {
      let data = '';
      res.setEncoding('utf8');
      res.on('data', (chunk: string) => {
        data += chunk;
      });
      res.on('end', () => {
        callback(null, data);
      });
    });
  expect(response.status).toBe(200);
  return parseSyncStream(response.body as unknown as string);
};

const syncAckAll = async (accessToken: string, lines: SyncLine[]): Promise<void> => {
  const acks = lines.filter((l) => l.type !== 'SyncCompleteV1' && l.ack).map((l) => l.ack);
  if (acks.length === 0) {
    return;
  }
  await request(app).post('/sync/ack').set('Authorization', `Bearer ${accessToken}`).send({ acks }).expect(204);
};

const mapMarkerIds = async (albumId: string, token: string): Promise<string[]> => {
  const { status, body } = await request(app)
    .get(`/albums/${albumId}/map-markers`)
    .set('Authorization', `Bearer ${token}`);
  expect(status).toBe(200);
  return (body as Array<{ id: string }>).map((m) => m.id);
};

describe('shared-space visibility negatives (Slice 11)', () => {
  let admin: LoginResponseDto;
  let owner: LoginResponseDto;
  let member: LoginResponseDto;

  beforeAll(async () => {
    await utils.resetDatabase();
    admin = await utils.adminSetup();
    [owner, member] = await Promise.all([
      utils.userSetup(admin.accessToken, createUserDto.create('vis-neg-owner')),
      utils.userSetup(admin.accessToken, createUserDto.create('vis-neg-member')),
    ]);
  });

  // ─── helpers ─────────────────────────────────────────────────────────────────

  /** Set visibility on an asset owned by `owner`. */
  const setVisibility = (assetId: string, visibility: AssetVisibility) =>
    updateAssets({ assetBulkUpdateDto: { ids: [assetId], visibility } }, { headers: asBearerAuth(owner.accessToken) });

  /** Create a fresh space, add owner as owner and member as viewer, return the space id. */
  const freshSpace = async (name: string) => {
    const space = await utils.createSpace(owner.accessToken, { name });
    await utils.addSpaceMember(owner.accessToken, space.id, { userId: member.userId });
    return space.id;
  };

  /**
   * Call POST /download/info with the given body as member.
   * Returns the flat list of assetIds from all archives.
   */
  const downloadInfoIds = async (body: Record<string, unknown>): Promise<string[]> => {
    const { status, body: resBody } = await request(app)
      .post('/download/info')
      .set('Authorization', `Bearer ${member.accessToken}`)
      .send(body);
    expect(status).toBe(201);
    return (resBody.archives as Array<{ assetIds: string[] }>).flatMap((a) => a.assetIds);
  };

  /** Fresh space with owner=Owner, member=Viewer; returns the space id. */
  const freshSpaceWithViewer = async (name: string) => {
    const space = await utils.createSpace(owner.accessToken, { name });
    await utils.addSpaceMember(owner.accessToken, space.id, {
      userId: member.userId,
      role: SharedSpaceRole.Viewer,
    });
    return space.id;
  };

  const linkAlbum = (spaceId: string, albumId: string) =>
    request(app).put(`/shared-spaces/${spaceId}/albums/${albumId}`).set('Authorization', `Bearer ${owner.accessToken}`);

  /** Upload a GPS-tagged fixture (thompson-springs.jpg — see reference_test_asset_exif_content) as owner. */
  const uploadGpsAsset = async (rel = 'metadata/gps-position/thompson-springs.jpg') => {
    const filepath = join(testAssetDir, rel);
    return utils.createAsset(owner.accessToken, {
      assetData: { bytes: await readFile(filepath), filename: basename(filepath) },
    });
  };

  const searchAlbumIds = async (body: Record<string, unknown>): Promise<string[]> => {
    const { status, body: resBody } = await request(app)
      .post('/search/metadata')
      .set('Authorization', `Bearer ${member.accessToken}`)
      .send(body);
    expect(status).toBe(200);
    return (resBody.assets.items as Array<{ id: string }>).map((item) => item.id);
  };

  // Resolve a real bucket for the album's assets so the positive controls query a populated bucket.
  const firstAlbumBucket = async (albumId: string): Promise<string> => {
    const { status, body } = await request(app)
      .get(`/timeline/buckets?bucketSize=month&albumId=${albumId}`)
      .set('Authorization', `Bearer ${member.accessToken}`);
    expect(status).toBe(200);
    return (body as Array<{ timeBucket: string }>)[0].timeBucket;
  };

  /** Owner-created album with a Timeline + a Hidden asset, linked into a fresh space with a Viewer. */
  const setupLinkedAlbum = async (name: string) => {
    const timelineAsset = await utils.createAsset(owner.accessToken);
    const hiddenAsset = await utils.createAsset(owner.accessToken);
    const album = await utils.createAlbum(owner.accessToken, {
      albumName: name,
      assetIds: [timelineAsset.id, hiddenAsset.id],
    });
    await setVisibility(hiddenAsset.id, AssetVisibility.Hidden);
    const spaceId = await freshSpaceWithViewer(name);
    await linkAlbum(spaceId, album.id);
    return { album, timelineAsset, hiddenAsset };
  };

  /** Owner-created album with two Timeline assets, linked into a fresh space with a Viewer (H1). */
  const setupLinkedAlbumForTrash = async (name: string) => {
    const toTrashAsset = await utils.createAsset(owner.accessToken);
    const liveAsset = await utils.createAsset(owner.accessToken);
    const album = await utils.createAlbum(owner.accessToken, {
      albumName: name,
      assetIds: [toTrashAsset.id, liveAsset.id],
    });
    const spaceId = await freshSpaceWithViewer(name);
    await linkAlbum(spaceId, album.id);
    return { album, toTrashAsset, liveAsset };
  };

  // ─────────────────────────────────────────────────────────────────────────────
  // GET /assets/:id — Hidden / Locked → 400; Timeline / Archive → 200
  // ─────────────────────────────────────────────────────────────────────────────

  describe('GET /assets/:id — Hidden/Locked blocked; Timeline/Archive allowed', () => {
    it('Hidden direct-space asset → 400 for member', async () => {
      const asset = await utils.createAsset(owner.accessToken);
      const spaceId = await freshSpace('hidden-read-neg');
      await utils.addSpaceAssets(owner.accessToken, spaceId, [asset.id]);
      await setVisibility(asset.id, AssetVisibility.Hidden);

      const { status } = await request(app)
        .get(`/assets/${asset.id}`)
        .set('Authorization', `Bearer ${member.accessToken}`);
      expect(status).toBe(400);
    });

    it('Locked direct-space asset → 400 for member', async () => {
      const asset = await utils.createAsset(owner.accessToken);
      const spaceId = await freshSpace('locked-read-neg');
      await utils.addSpaceAssets(owner.accessToken, spaceId, [asset.id]);
      await setVisibility(asset.id, AssetVisibility.Locked);

      const { status } = await request(app)
        .get(`/assets/${asset.id}`)
        .set('Authorization', `Bearer ${member.accessToken}`);
      expect(status).toBe(400);
    });

    it('Timeline direct-space asset → 200 for member (positive control)', async () => {
      const asset = await utils.createAsset(owner.accessToken);
      // default visibility is Timeline
      const spaceId = await freshSpace('timeline-read-pos');
      await utils.addSpaceAssets(owner.accessToken, spaceId, [asset.id]);

      const { status } = await request(app)
        .get(`/assets/${asset.id}`)
        .set('Authorization', `Bearer ${member.accessToken}`);
      expect(status).toBe(200);
    });

    it('Archive direct-space asset → 200 for member (positive control)', async () => {
      const asset = await utils.createAsset(owner.accessToken);
      await setVisibility(asset.id, AssetVisibility.Archive);
      const spaceId = await freshSpace('archive-read-pos');
      await utils.addSpaceAssets(owner.accessToken, spaceId, [asset.id]);

      const { status } = await request(app)
        .get(`/assets/${asset.id}`)
        .set('Authorization', `Bearer ${member.accessToken}`);
      expect(status).toBe(200);
    });
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // GET /assets/:id/original — Hidden / Locked → 400
  // ─────────────────────────────────────────────────────────────────────────────

  describe('GET /assets/:id/original — Hidden/Locked blocked', () => {
    it('Hidden direct-space asset → 400', async () => {
      const asset = await utils.createAsset(owner.accessToken);
      const spaceId = await freshSpace('hidden-original-neg');
      await utils.addSpaceAssets(owner.accessToken, spaceId, [asset.id]);
      await setVisibility(asset.id, AssetVisibility.Hidden);

      const { status } = await request(app)
        .get(`/assets/${asset.id}/original`)
        .set('Authorization', `Bearer ${member.accessToken}`);
      expect(status).toBe(400);
    });

    it('Locked direct-space asset → 400', async () => {
      const asset = await utils.createAsset(owner.accessToken);
      const spaceId = await freshSpace('locked-original-neg');
      await utils.addSpaceAssets(owner.accessToken, spaceId, [asset.id]);
      await setVisibility(asset.id, AssetVisibility.Locked);

      const { status } = await request(app)
        .get(`/assets/${asset.id}/original`)
        .set('Authorization', `Bearer ${member.accessToken}`);
      expect(status).toBe(400);
    });

    it('Timeline direct-space asset → 200 (positive control)', async () => {
      const asset = await utils.createAsset(owner.accessToken);
      const spaceId = await freshSpace('timeline-original-pos');
      await utils.addSpaceAssets(owner.accessToken, spaceId, [asset.id]);

      const { status } = await request(app)
        .get(`/assets/${asset.id}/original`)
        .set('Authorization', `Bearer ${member.accessToken}`);
      expect(status).toBe(200);
    });
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // POST /download/info (spaceId) — Hidden / Locked absent from zip manifest
  // ─────────────────────────────────────────────────────────────────────────────

  describe('POST /download/info (spaceId) — Hidden/Locked absent; Timeline/Archive present', () => {
    it('Hidden direct-space asset absent from download manifest', async () => {
      const timelineAsset = await utils.createAsset(owner.accessToken);
      const hiddenAsset = await utils.createAsset(owner.accessToken);
      await setVisibility(hiddenAsset.id, AssetVisibility.Hidden);

      const spaceId = await freshSpace('download-hidden-neg');
      await utils.addSpaceAssets(owner.accessToken, spaceId, [timelineAsset.id, hiddenAsset.id]);

      const assetIds = await downloadInfoIds({ spaceId });

      expect(assetIds).toContain(timelineAsset.id); // Timeline present ✓
      expect(assetIds).not.toContain(hiddenAsset.id); // Hidden absent ✓
    });

    it('Locked direct-space asset absent from download manifest', async () => {
      const timelineAsset = await utils.createAsset(owner.accessToken);
      const lockedAsset = await utils.createAsset(owner.accessToken);

      const spaceId = await freshSpace('download-locked-neg');
      // add both while Timeline (the batch add rejects a pre-Locked asset), THEN lock
      await utils.addSpaceAssets(owner.accessToken, spaceId, [timelineAsset.id, lockedAsset.id]);
      await setVisibility(lockedAsset.id, AssetVisibility.Locked);

      const assetIds = await downloadInfoIds({ spaceId });

      expect(assetIds).toContain(timelineAsset.id);
      expect(assetIds).not.toContain(lockedAsset.id);
    });

    it('Archive direct-space asset present in download manifest', async () => {
      const archiveAsset = await utils.createAsset(owner.accessToken);
      await setVisibility(archiveAsset.id, AssetVisibility.Archive);

      const spaceId = await freshSpace('download-archive-pos');
      await utils.addSpaceAssets(owner.accessToken, spaceId, [archiveAsset.id]);

      const assetIds = await downloadInfoIds({ spaceId });

      expect(assetIds).toContain(archiveAsset.id);
    });
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // POST /download/info (albumId) — Hidden / Locked absent from zip manifest
  // (AlbumDownload grant via shared_space_album_user)
  // ─────────────────────────────────────────────────────────────────────────────

  describe('POST /download/info (albumId via space AlbumDownload grant) — Hidden/Locked absent', () => {
    it('Hidden album-linked asset absent from album download manifest', async () => {
      const timelineAsset = await utils.createAsset(owner.accessToken);
      const hiddenAsset = await utils.createAsset(owner.accessToken);
      await setVisibility(hiddenAsset.id, AssetVisibility.Hidden);

      const spaceId = await freshSpace('album-download-hidden-neg');

      const album = await utils.createAlbum(owner.accessToken, {
        albumName: 'AlbumHiddenNeg',
        assetIds: [timelineAsset.id, hiddenAsset.id],
      });

      // Link the album to the space so member gets AlbumDownload via space grant
      await request(app)
        .put(`/shared-spaces/${spaceId}/albums/${album.id}`)
        .set('Authorization', `Bearer ${owner.accessToken}`);

      const assetIds = await downloadInfoIds({ albumId: album.id });

      expect(assetIds).toContain(timelineAsset.id);
      expect(assetIds).not.toContain(hiddenAsset.id);
    });

    it('Locked album-linked asset absent from album download manifest', async () => {
      const timelineAsset = await utils.createAsset(owner.accessToken);
      const lockedAsset = await utils.createAsset(owner.accessToken);
      await setVisibility(lockedAsset.id, AssetVisibility.Locked);

      const spaceId = await freshSpace('album-download-locked-neg');

      const album = await utils.createAlbum(owner.accessToken, {
        albumName: 'AlbumLockedNeg',
        assetIds: [timelineAsset.id, lockedAsset.id],
      });

      await request(app)
        .put(`/shared-spaces/${spaceId}/albums/${album.id}`)
        .set('Authorization', `Bearer ${owner.accessToken}`);

      const assetIds = await downloadInfoIds({ albumId: album.id });

      expect(assetIds).toContain(timelineAsset.id);
      expect(assetIds).not.toContain(lockedAsset.id);
    });

    it("owner's own Hidden album asset is omitted from the album download manifest (rbac-8, flat gate)", async () => {
      const timelineAsset = await utils.createAsset(owner.accessToken);
      const hiddenAsset = await utils.createAsset(owner.accessToken);
      const album = await utils.createAlbum(owner.accessToken, {
        albumName: 'Rbac8 OwnerDownload',
        assetIds: [timelineAsset.id, hiddenAsset.id],
      });
      await setVisibility(hiddenAsset.id, AssetVisibility.Hidden);

      const { status, body } = await request(app)
        .post('/download/info')
        .set('Authorization', `Bearer ${owner.accessToken}`)
        .send({ albumId: album.id });
      expect(status).toBe(201);
      const ids = (body.archives as Array<{ assetIds: string[] }>).flatMap((a) => a.assetIds);
      expect(ids).toContain(timelineAsset.id);
      expect(ids).not.toContain(hiddenAsset.id); // matches the grid — owner's Hidden omitted
    });
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // POST /search/metadata (albumId via space AlbumRead grant) — Hidden/Locked absent
  // ─────────────────────────────────────────────────────────────────────────────

  describe('POST /search/metadata (albumIds via space AlbumRead grant) — Hidden/Locked absent (security-1)', () => {
    it('Hidden album-linked asset absent for a Viewer (default visibility); Timeline+Archive present', async () => {
      const timelineAsset = await utils.createAsset(owner.accessToken);
      const archiveAsset = await utils.createAsset(owner.accessToken);
      await setVisibility(archiveAsset.id, AssetVisibility.Archive);
      const hiddenAsset = await utils.createAsset(owner.accessToken);

      const album = await utils.createAlbum(owner.accessToken, {
        albumName: 'SearchAlbumHiddenNeg',
        assetIds: [timelineAsset.id, archiveAsset.id, hiddenAsset.id],
      });
      // hide AFTER album-add (a pre-Hidden asset would be rejected / auto-removed from the album)
      await setVisibility(hiddenAsset.id, AssetVisibility.Hidden);

      const spaceId = await freshSpaceWithViewer('search-album-hidden-neg');
      await linkAlbum(spaceId, album.id);

      const ids = await searchAlbumIds({ albumIds: [album.id] });

      expect(ids).toContain(timelineAsset.id);
      expect(ids).toContain(archiveAsset.id);
      expect(ids).not.toContain(hiddenAsset.id);
    });

    it('Hidden album-linked asset absent even with an explicit visibility=hidden request', async () => {
      const timelineAsset = await utils.createAsset(owner.accessToken);
      const hiddenAsset = await utils.createAsset(owner.accessToken);

      const album = await utils.createAlbum(owner.accessToken, {
        albumName: 'SearchAlbumHiddenExplicit',
        assetIds: [timelineAsset.id, hiddenAsset.id],
      });
      await setVisibility(hiddenAsset.id, AssetVisibility.Hidden);

      const spaceId = await freshSpaceWithViewer('search-album-hidden-explicit');
      await linkAlbum(spaceId, album.id);

      const ids = await searchAlbumIds({ albumIds: [album.id], visibility: AssetVisibility.Hidden });

      expect(ids).not.toContain(hiddenAsset.id);
    });
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // GET /timeline/bucket (albumId) — Hidden/Locked → 400; Timeline/Archive → 200
  // ─────────────────────────────────────────────────────────────────────────────

  describe('GET /timeline/bucket (albumId via space AlbumRead grant) — Hidden/Locked rejected (security-3)', () => {
    it('albumId + visibility=hidden → 400 for a Viewer member', async () => {
      const { album } = await setupLinkedAlbum('bucket-album-hidden-neg');

      const { status } = await request(app)
        .get(`/timeline/bucket?bucketSize=month&timeBucket=1970-01-01&albumId=${album.id}&visibility=hidden`)
        .set('Authorization', `Bearer ${member.accessToken}`);

      expect(status).toBe(400);
    });

    it('albumId + visibility=locked → 401 for a Viewer member (elevated permission required first)', async () => {
      const { album } = await setupLinkedAlbum('bucket-album-locked-neg');

      const { status } = await request(app)
        .get(`/timeline/bucket?bucketSize=month&timeBucket=1970-01-01&albumId=${album.id}&visibility=locked`)
        .set('Authorization', `Bearer ${member.accessToken}`);

      // Locked visibility hits requireElevatedPermission (401) before the albumId reject (400) — a
      // non-elevated Viewer is refused either way; the leak is blocked. (Hidden → 400, see above.)
      expect(status).toBe(401);
    });

    it('albumId (default visibility) → 200 with the Timeline asset present, Hidden absent', async () => {
      const { album, timelineAsset, hiddenAsset } = await setupLinkedAlbum('bucket-album-default-pos');
      const timeBucket = await firstAlbumBucket(album.id);

      const { status, body } = await request(app)
        .get(`/timeline/bucket?bucketSize=month&timeBucket=${timeBucket}&albumId=${album.id}`)
        .set('Authorization', `Bearer ${member.accessToken}`);

      expect(status).toBe(200);
      const returnedIds = (body.id ?? []) as string[];
      expect(returnedIds).toContain(timelineAsset.id);
      expect(returnedIds).not.toContain(hiddenAsset.id);
    });
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // POST /search/metadata + GET /timeline/bucket(s) (albumId) — trashed asset absent (H1)
  //
  // A space Viewer must never read the owner's TRASHED album assets, via either the
  // withDeleted/trashedBefore/trashedAfter search params or an isTrashed=true timeline browse.
  // ─────────────────────────────────────────────────────────────────────────────

  describe('POST /search/metadata + GET /timeline/bucket(s) (albumId via space AlbumRead grant) — trashed asset absent (H1)', () => {
    it('positive control: before trashing, the asset is visible via both the timeline bucket and search', async () => {
      const { album, toTrashAsset } = await setupLinkedAlbumForTrash('h1-positive-control');
      const timeBucket = await firstAlbumBucket(album.id);

      const { status, body } = await request(app)
        .get(`/timeline/bucket?bucketSize=month&timeBucket=${timeBucket}&albumId=${album.id}&isTrashed=false`)
        .set('Authorization', `Bearer ${member.accessToken}`);
      expect(status).toBe(200);
      expect((body.id ?? []) as string[]).toContain(toTrashAsset.id);

      const ids = await searchAlbumIds({ albumIds: [album.id] });
      expect(ids).toContain(toTrashAsset.id);
    });

    it('POST /search/metadata: trashed album asset absent even with withDeleted=true; live sibling present', async () => {
      const { album, toTrashAsset, liveAsset } = await setupLinkedAlbumForTrash('h1-search-neg');
      await utils.deleteAssets(owner.accessToken, [toTrashAsset.id]);

      const ids = await searchAlbumIds({ albumIds: [album.id], withDeleted: true });

      // Absence from the response is the strongest assertion here: if the id isn't in the item
      // array, none of its fields (checksum/originalPath/thumbhash/EXIF/people) can leak either.
      expect(ids).not.toContain(toTrashAsset.id);
      expect(ids).toContain(liveAsset.id);
    });

    it('GET /timeline/bucket: albumId + isTrashed=true → 400 for a Viewer member', async () => {
      const { album, toTrashAsset } = await setupLinkedAlbumForTrash('h1-bucket-neg');
      await utils.deleteAssets(owner.accessToken, [toTrashAsset.id]);

      const { status } = await request(app)
        .get(`/timeline/bucket?bucketSize=month&timeBucket=1970-01-01&albumId=${album.id}&isTrashed=true`)
        .set('Authorization', `Bearer ${member.accessToken}`);

      expect(status).toBe(400);
    });

    it('GET /timeline/buckets: albumId + isTrashed=true → 400 for a Viewer member', async () => {
      const { album, toTrashAsset } = await setupLinkedAlbumForTrash('h1-buckets-neg');
      await utils.deleteAssets(owner.accessToken, [toTrashAsset.id]);

      const { status } = await request(app)
        .get(`/timeline/buckets?bucketSize=month&albumId=${album.id}&isTrashed=true`)
        .set('Authorization', `Bearer ${member.accessToken}`);

      expect(status).toBe(400);
    });

    it('GET /timeline/bucket: albumId + isTrashed=false still returns the live sibling (no over-block)', async () => {
      const { album, toTrashAsset, liveAsset } = await setupLinkedAlbumForTrash('h1-bucket-pos');
      await utils.deleteAssets(owner.accessToken, [toTrashAsset.id]);
      // Resolved AFTER trashing so the returned bucket reflects the still-live sibling.
      const timeBucket = await firstAlbumBucket(album.id);

      const { status, body } = await request(app)
        .get(`/timeline/bucket?bucketSize=month&timeBucket=${timeBucket}&albumId=${album.id}&isTrashed=false`)
        .set('Authorization', `Bearer ${member.accessToken}`);

      expect(status).toBe(200);
      const returnedIds = (body.id ?? []) as string[];
      expect(returnedIds).toContain(liveAsset.id);
      expect(returnedIds).not.toContain(toTrashAsset.id);
    });
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // GET /albums/:id/map-markers (space-linked) — Hidden/Locked coordinates absent (security-2)
  // ─────────────────────────────────────────────────────────────────────────────

  describe('GET /albums/:id/map-markers (space-linked) — Hidden/Locked coordinates absent (security-2)', () => {
    it('Hidden album asset has no map marker for a Viewer member OR the owner (flat gate)', async () => {
      // Two DISTINCT GPS files: uploading the same file twice would dedup into one asset (shared
      // checksum), so flipping `hidden` to Hidden would also hide `gps`. Different files keep them
      // separate — `gps` stays Timeline (marker present) while `hidden` is stripped by the gate.
      const gps = await uploadGpsAsset('metadata/gps-position/thompson-springs.jpg');
      const hidden = await uploadGpsAsset('metadata/dates/datetimeoriginal-gps.jpg');
      const album = await utils.createAlbum(owner.accessToken, {
        albumName: 'MapMarkerHiddenNeg',
        assetIds: [gps.id, hidden.id],
      });
      const spaceId = await freshSpaceWithViewer('map-marker-hidden-neg');
      await linkAlbum(spaceId, album.id);

      // testq-5 positive control: drain metadataExtraction and confirm `hidden` produces a marker
      // WHILE STILL TIMELINE, before ever hiding it. Without this, the "not present" assertions below
      // would pass just as well if GPS extraction had silently failed for `hidden` (a fixture/timing
      // bug) or if some unrelated bug dropped its marker — neither of which is the visibility gate this
      // test is meant to pin. Map markers only surface assets whose EXIF (GPS lat/lon) has been
      // extracted — drain the metadataExtraction queue (admin token has queue-read access) first.
      await utils.waitForQueueFinish(admin.accessToken, 'metadataExtraction');
      const beforeHideIds = await mapMarkerIds(album.id, owner.accessToken);
      expect(beforeHideIds, '`hidden` must have a marker before hiding, or the negatives below are vacuous').toContain(
        hidden.id,
      );

      await setVisibility(hidden.id, AssetVisibility.Hidden);

      const memberIds = await mapMarkerIds(album.id, member.accessToken);
      expect(memberIds).toContain(gps.id);
      expect(memberIds).not.toContain(hidden.id);

      const ownerIds = await mapMarkerIds(album.id, owner.accessToken);
      expect(ownerIds).not.toContain(hidden.id); // flat gate: no owner exception
    });
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // GET /albums/:id (space-linked) — participants stripped for space-only readers (security-8)
  // ─────────────────────────────────────────────────────────────────────────────

  describe('GET /albums/:id (space-linked) — participants stripped for space-only readers (security-8)', () => {
    it('space Viewer sees albumUsers reduced to the owner; a participant sees the full list', async () => {
      const participant = await utils.userSetup(admin.accessToken, createUserDto.create('sec8-participant'));
      const asset = await utils.createAsset(owner.accessToken);
      const album = await utils.createAlbum(owner.accessToken, { albumName: 'Sec8 Album', assetIds: [asset.id] });
      await request(app)
        .put(`/albums/${album.id}/users`)
        .set('Authorization', `Bearer ${owner.accessToken}`)
        .send({ albumUsers: [{ userId: participant.userId, role: AlbumUserRole.Viewer }] });

      const spaceId = await freshSpaceWithViewer('sec8-space');
      await linkAlbum(spaceId, album.id);

      const asMember = await request(app)
        .get(`/albums/${album.id}`)
        .set('Authorization', `Bearer ${member.accessToken}`);
      expect(asMember.status).toBe(200);
      expect(asMember.body.albumUsers).toHaveLength(1);
      expect(asMember.body.albumUsers.map((u: { user: { id: string } }) => u.user.id)).not.toContain(
        participant.userId,
      );

      const asParticipant = await request(app)
        .get(`/albums/${album.id}`)
        .set('Authorization', `Bearer ${participant.accessToken}`);
      expect(asParticipant.body.albumUsers.length).toBeGreaterThan(1); // participant path wins
    });
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // PUT /assets/:id visibility — single endpoint emits the same purge as bulk (security-4)
  // ─────────────────────────────────────────────────────────────────────────────

  describe('PUT /assets/:id visibility — single endpoint emits the same purge as bulk (security-4)', () => {
    it('single PUT {visibility:hidden} tombstones an album-linked asset for a synced member, same as bulk', async () => {
      // owner uploads A (single-PUT target) and B (bulk-PUT sibling), links an album containing both into a
      // space with a synced Viewer member, syncs once to simulate an already-synced device.
      const assetA = await utils.createAsset(owner.accessToken);
      const assetB = await utils.createAsset(owner.accessToken);
      const album = await utils.createAlbum(owner.accessToken, {
        albumName: 'Security4 SingleVsBulk',
        assetIds: [assetA.id, assetB.id],
      });
      const spaceId = await freshSpaceWithViewer('security4-single-vs-bulk');
      await linkAlbum(spaceId, album.id);

      const initial = await syncStream(member.accessToken, [SyncRequestType.SharedSpaceAlbumToAssetsV1]);
      await syncAckAll(member.accessToken, initial);

      // Single-asset PUT for A, bulk PUT for B — both flip Timeline -> Hidden.
      const singleRes = await updateAsset(
        { id: assetA.id, updateAssetDto: { visibility: AssetVisibility.Hidden } },
        { headers: asBearerAuth(owner.accessToken) },
      );
      expect(singleRes.visibility).toBe(AssetVisibility.Hidden);
      await updateAssets(
        { assetBulkUpdateDto: { ids: [assetB.id], visibility: AssetVisibility.Hidden } },
        { headers: asBearerAuth(owner.accessToken) },
      );

      const next = await syncStream(member.accessToken, [SyncRequestType.SharedSpaceAlbumToAssetsV1]);
      const deletes = next.filter((l) => l.type === 'SharedSpaceAlbumToAssetDeleteV1');
      const pairs = deletes.map((d) => ({ albumId: d.data.albumId, assetId: d.data.assetId }));

      // Byte-for-byte: the single-endpoint tombstone for A has the same shape as the bulk tombstone for B.
      expect(pairs).toContainEqual({ albumId: album.id, assetId: assetA.id });
      expect(pairs).toContainEqual({ albumId: album.id, assetId: assetB.id });
    });

    it('single PUT {visibility:locked} removes A from ALL the owner albums AND tombstones it (security-4)', async () => {
      const assetA = await utils.createAsset(owner.accessToken);
      const album = await utils.createAlbum(owner.accessToken, {
        albumName: 'Security4 SingleLocked',
        assetIds: [assetA.id],
      });
      const spaceId = await freshSpaceWithViewer('security4-single-locked');
      await linkAlbum(spaceId, album.id);

      const initial = await syncStream(member.accessToken, [SyncRequestType.SharedSpaceAlbumToAssetsV1]);
      await syncAckAll(member.accessToken, initial);

      await updateAsset(
        { id: assetA.id, updateAssetDto: { visibility: AssetVisibility.Locked } },
        { headers: asBearerAuth(owner.accessToken) },
      );

      // GET /albums/:id's `assets`/`assetCount` are visibility-filtered (withDefaultVisibility, an INNER
      // JOIN on album_asset) — assetCount reading 0 right after locking is true even if
      // removeAssetsFromAll never deleted the album_asset row, purely because Locked is excluded from
      // the join. That alone does NOT prove the row was deleted (testq-2). Assert it as a sanity
      // check; the real, non-vacuous proof is the member-sync delete below.
      const { status, body } = await request(app)
        .get(`/albums/${album.id}`)
        .set('Authorization', `Bearer ${owner.accessToken}`);
      expect(status).toBe(200);
      expect(body.assetCount).toBe(0);

      // The real (non-vacuous) proof that removeAssetsFromAll DELETED the album_asset row: the member's
      // sync receives a SharedSpaceAlbumToAssetDeleteV1 fired by the album_asset_audit trigger, which
      // only fires on an actual row DELETE — a visibility filter alone would emit no delete. (Un-locking
      // A back to Timeline to re-check resurrection is not possible over e2e: modifying a Locked asset
      // requires elevated auth. The row-delete side of removeAssetsFromAll is covered at the
      // unit/medium level by the #757 transition tests.)
      const next = await syncStream(member.accessToken, [SyncRequestType.SharedSpaceAlbumToAssetsV1]);
      const deletes = next.filter((l) => l.type === 'SharedSpaceAlbumToAssetDeleteV1');
      expect(deletes.some((d) => d.data.albumId === album.id && d.data.assetId === assetA.id)).toBe(true);
    });
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // H-1 — the DIRECT space arm + withSharedSpaces arm of searchAssetBuilder. A member
  // (incl. a read-only Viewer) must not reach another member's TRASHED asset by flipping
  // withDeleted / trashedAfter / trashedBefore / isOffline (each of which flips withDeleted
  // in the builder, database.ts:676). The service rejects the whole class with 400 (mirrors
  // timeBucketChecks); the caller-proof SQL gate is proven in the search-space-trash-gate
  // medium spec. The album arm is covered above (H1); this covers the two non-album space arms.
  // ─────────────────────────────────────────────────────────────────────────────
  describe('POST /search/{metadata,statistics,random} — trash/offline params rejected under a space scope (H-1)', () => {
    const bodyEndpoints = ['/search/metadata', '/search/statistics', '/search/random'] as const;
    const trashParams: Array<[string, Record<string, unknown>, boolean]> = [
      ['withDeleted', { withDeleted: true }, true],
      ['trashedAfter', { trashedAfter: '1970-01-01T00:00:00.000Z' }, false],
      ['trashedBefore', { trashedBefore: '2999-01-01T00:00:00.000Z' }, false],
      ['isOffline', { isOffline: true }, false],
    ];

    for (const endpoint of bodyEndpoints) {
      for (const [label, param, needsWithDeleted] of trashParams) {
        // StatisticsSearchDto has no withDeleted field (zod strips it) — only reachable via implicit-flip params.
        if (endpoint === '/search/statistics' && needsWithDeleted) {
          continue;
        }
        it(`${endpoint} rejects ${label} with spaceId → 400`, async () => {
          const spaceId = await freshSpaceWithViewer(`h1-${basename(endpoint)}-${label}`);
          const { status } = await request(app)
            .post(endpoint)
            .set('Authorization', `Bearer ${member.accessToken}`)
            .send({ spaceId, ...param });
          expect(status).toBe(400);
        });
      }
    }

    it('POST /search/metadata rejects withDeleted with withSharedSpaces → 400', async () => {
      await freshSpaceWithViewer('h1-metadata-withSharedSpaces');
      const { status } = await request(app)
        .post('/search/metadata')
        .set('Authorization', `Bearer ${member.accessToken}`)
        .send({ withSharedSpaces: true, withDeleted: true });
      expect(status).toBe(400);
    });

    it('POST /search/smart rejects withDeleted with spaceId → 400 (guard fires before the ML-enabled check)', async () => {
      const spaceId = await freshSpaceWithViewer('h1-smart-spaceId');
      const { status, body } = await request(app)
        .post('/search/smart')
        .set('Authorization', `Bearer ${member.accessToken}`)
        .send({ query: 'noodle', spaceId, withDeleted: true });
      expect(status).toBe(400);
      // Distinguish the trash-scope guard from a "smart search not enabled" 400.
      expect(String(body.message)).toContain('shared space');
    });

    it('positive control: a plain spaceId search (no trash params) returns the live direct asset, not the trashed sibling', async () => {
      const spaceId = await freshSpaceWithViewer('h1-space-positive');
      const liveAsset = await utils.createAsset(owner.accessToken);
      const trashedAsset = await utils.createAsset(owner.accessToken);
      await utils.addSpaceAssets(owner.accessToken, spaceId, [liveAsset.id, trashedAsset.id]);
      await utils.deleteAssets(owner.accessToken, [trashedAsset.id]);

      const ids = await searchAlbumIds({ spaceId });
      expect(ids).toContain(liveAsset.id);
      expect(ids).not.toContain(trashedAsset.id);
    });
  });
});
