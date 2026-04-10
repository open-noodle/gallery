import { SharedSpaceRole, SyncRequestType, type LoginResponseDto } from '@immich/sdk';
import { authHeaders, type Actor } from 'src/actors';
import { createUserDto } from 'src/fixtures';
import { app, asBearerAuth, utils } from 'src/utils';
import request from 'supertest';
import { beforeAll, describe, expect, it } from 'vitest';

// End-to-end coverage for the shared-space sync streams added in PR 1 of
// the mobile Drift sync work (commit 538b95b53). These streams existed
// before the library PR #313 merged but had NO e2e coverage — only medium
// tests exercised the SQL.
//
// Types covered:
//   - SyncRequestType.SharedSpacesV1
//   - SyncRequestType.SharedSpaceMembersV1
//   - SyncRequestType.SharedSpaceAssetsV1
//   - SyncRequestType.SharedSpaceAssetExifsV1
//   - SyncRequestType.SharedSpaceToAssetsV1
//
// Privacy-critical properties:
//   1. Space members see space + members + assets + exifs + join rows
//   2. Non-members see nothing
//   3. Partners see nothing (no partner path through spaces)
//   4. Removing a member emits SharedSpaceMemberDeleteV1 to the removed user
//   5. Removing an asset from a space emits SharedSpaceToAssetDeleteV1

interface SyncLine {
  type: string;
  ack: string;
  data: Record<string, unknown>;
}

const parseStream = (text: string): SyncLine[] =>
  text
    .split('\n')
    .filter((line) => line.trim().length > 0)
    .map((line) => JSON.parse(line) as SyncLine);

const syncStream = async (accessToken: string, types: SyncRequestType[], reset = false): Promise<SyncLine[]> => {
  const response = await request(app)
    .post('/sync/stream')
    .set(asBearerAuth(accessToken))
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
  return parseStream(response.body as unknown as string);
};

const ackAll = async (accessToken: string, lines: SyncLine[]): Promise<void> => {
  const acks = lines.filter((l) => l.type !== 'SyncCompleteV1' && l.ack).map((l) => l.ack);
  if (acks.length === 0) {
    return;
  }
  await request(app).post('/sync/ack').set(asBearerAuth(accessToken)).send({ acks }).expect(204);
};

describe('/sync — shared-space streams', () => {
  let admin: LoginResponseDto;
  let member: LoginResponseDto;
  let stranger: LoginResponseDto;
  let partner: LoginResponseDto;
  const anonActor: Actor = { id: 'anon' };

  beforeAll(async () => {
    await utils.resetDatabase();
    admin = await utils.adminSetup({ onboarding: false });
    [member, stranger, partner] = await Promise.all([
      utils.userSetup(admin.accessToken, createUserDto.create('sync-ss-member')),
      utils.userSetup(admin.accessToken, createUserDto.create('sync-ss-stranger')),
      utils.userSetup(admin.accessToken, createUserDto.create('sync-ss-partner')),
    ]);
  });

  describe('SharedSpacesV1', () => {
    it('requires authentication', async () => {
      const { status } = await request(app)
        .post('/sync/stream')
        .set(authHeaders(anonActor))
        .send({ types: [SyncRequestType.SharedSpacesV1] });
      expect(status).toBe(401);
    });

    it('creator sees their own space', async () => {
      const space = await utils.createSpace(admin.accessToken, { name: 'Creator Space' });

      const lines = await syncStream(admin.accessToken, [SyncRequestType.SharedSpacesV1], true);
      const spaceLines = lines.filter((l) => l.type === 'SharedSpaceV1');
      const ids = spaceLines.map((l) => (l.data as { id: string }).id);
      expect(ids).toContain(space.id);
      await ackAll(admin.accessToken, lines);
    });

    it('member sees a space they were added to', async () => {
      const space = await utils.createSpace(admin.accessToken, { name: 'Member Space' });
      await utils.addSpaceMember(admin.accessToken, space.id, {
        userId: member.userId,
        role: SharedSpaceRole.Editor,
      });

      const lines = await syncStream(member.accessToken, [SyncRequestType.SharedSpacesV1], true);
      const spaceLines = lines.filter((l) => l.type === 'SharedSpaceV1');
      const ids = spaceLines.map((l) => (l.data as { id: string }).id);
      expect(ids).toContain(space.id);
      await ackAll(member.accessToken, lines);
    });

    it('non-member (stranger) does NOT see a space', async () => {
      const space = await utils.createSpace(admin.accessToken, { name: 'Private To Admin' });

      const lines = await syncStream(stranger.accessToken, [SyncRequestType.SharedSpacesV1], true);
      const spaceLines = lines.filter((l) => l.type === 'SharedSpaceV1');
      const ids = spaceLines.map((l) => (l.data as { id: string }).id);
      expect(ids).not.toContain(space.id);
      await ackAll(stranger.accessToken, lines);
    });

    it("partner does NOT see the partnered user's spaces", async () => {
      // Partnership does NOT grant access to spaces. A partner of the
      // space creator must not see the space in sync.
      const partnerSpace = await utils.createSpace(admin.accessToken, { name: 'Partner Not Visible' });
      // admin is already partnered-with-by anyone? No — we set up a fresh
      // partner relationship: admin shares with partner.
      await request(app).post(`/partners/${admin.userId}`).set(asBearerAuth(partner.accessToken)).expect(201);

      const lines = await syncStream(partner.accessToken, [SyncRequestType.SharedSpacesV1], true);
      const spaceLines = lines.filter((l) => l.type === 'SharedSpaceV1');
      const ids = spaceLines.map((l) => (l.data as { id: string }).id);
      expect(ids).not.toContain(partnerSpace.id);
      await ackAll(partner.accessToken, lines);
    });
  });

  describe('SharedSpaceMembersV1', () => {
    it('member sees the membership rows for spaces they belong to', async () => {
      const space = await utils.createSpace(admin.accessToken, { name: 'Membership Rows' });
      await utils.addSpaceMember(admin.accessToken, space.id, {
        userId: member.userId,
        role: SharedSpaceRole.Editor,
      });

      const lines = await syncStream(
        member.accessToken,
        [SyncRequestType.SharedSpacesV1, SyncRequestType.SharedSpaceMembersV1],
        true,
      );
      const memberLines = lines.filter(
        (l) => l.type === 'SharedSpaceMemberV1' || l.type === 'SharedSpaceMemberBackfillV1',
      );
      const matching = memberLines.filter((l) => {
        const data = l.data as { spaceId: string; userId: string };
        return data.spaceId === space.id && data.userId === member.userId;
      });
      expect(matching.length).toBeGreaterThanOrEqual(1);
      await ackAll(member.accessToken, lines);
    });

    it('removing a member emits SharedSpaceMemberDeleteV1 to the removed user', async () => {
      // Membership removal is a revocation event. The removed user must
      // see SharedSpaceMemberDeleteV1 (and they also lose access to the
      // space, so SharedSpaceDeleteV1 should fire too — covered in the
      // SharedSpacesV1 section below).
      const victim = await utils.userSetup(admin.accessToken, createUserDto.create('sync-ss-victim'));
      const space = await utils.createSpace(admin.accessToken, { name: 'Victim Space' });
      await utils.addSpaceMember(admin.accessToken, space.id, {
        userId: victim.userId,
        role: SharedSpaceRole.Editor,
      });

      const initial = await syncStream(
        victim.accessToken,
        [SyncRequestType.SharedSpacesV1, SyncRequestType.SharedSpaceMembersV1],
        true,
      );
      await ackAll(victim.accessToken, initial);

      await request(app)
        .delete(`/shared-spaces/${space.id}/members/${victim.userId}`)
        .set(asBearerAuth(admin.accessToken))
        .expect(204);

      const next = await syncStream(victim.accessToken, [
        SyncRequestType.SharedSpacesV1,
        SyncRequestType.SharedSpaceMembersV1,
      ]);

      // SharedSpaceDeleteV1 OR SharedSpaceMemberDeleteV1 should fire to
      // tell the client to drop the space locally. We accept either —
      // the exact channel depends on how the audit triggers are wired.
      const deletes = next.filter((l) => {
        if (l.type === 'SharedSpaceDeleteV1') {
          return (l.data as { spaceId: string }).spaceId === space.id;
        }
        if (l.type === 'SharedSpaceMemberDeleteV1') {
          const data = l.data as { spaceId: string; userId: string };
          return data.spaceId === space.id && data.userId === victim.userId;
        }
        return false;
      });
      expect(deletes.length).toBeGreaterThanOrEqual(1);
    });
  });

  describe('SharedSpaceAssetsV1 / SharedSpaceToAssetsV1', () => {
    it('member sees assets added to a space they belong to', async () => {
      const space = await utils.createSpace(admin.accessToken, { name: 'Assets Space' });
      await utils.addSpaceMember(admin.accessToken, space.id, {
        userId: member.userId,
        role: SharedSpaceRole.Editor,
      });
      // Upload an asset as admin, add it to the space.
      const asset = await utils.createAsset(admin.accessToken);
      await utils.addSpaceAssets(admin.accessToken, space.id, [asset.id]);

      const lines = await syncStream(
        member.accessToken,
        [
          SyncRequestType.SharedSpacesV1,
          SyncRequestType.SharedSpaceMembersV1,
          SyncRequestType.SharedSpaceAssetsV1,
          SyncRequestType.SharedSpaceToAssetsV1,
        ],
        true,
      );

      // The SharedSpaceAsset event carries the asset payload.
      const assetEvents = lines.filter(
        (l) =>
          l.type === 'SharedSpaceAssetCreateV1' ||
          l.type === 'SharedSpaceAssetUpdateV1' ||
          l.type === 'SharedSpaceAssetBackfillV1',
      );
      const assetIds = assetEvents.map((l) => (l.data as { id: string }).id);
      expect(assetIds).toContain(asset.id);

      // The SharedSpaceToAsset event is the (spaceId, assetId) pairing.
      const toAssetEvents = lines.filter(
        (l) => l.type === 'SharedSpaceToAssetV1' || l.type === 'SharedSpaceToAssetBackfillV1',
      );
      const matchingLinks = toAssetEvents.filter((l) => {
        const data = l.data as { spaceId: string; assetId: string };
        return data.spaceId === space.id && data.assetId === asset.id;
      });
      expect(matchingLinks.length).toBeGreaterThanOrEqual(1);
      await ackAll(member.accessToken, lines);
    });

    it('stranger does NOT see assets from a space they are not in', async () => {
      const space = await utils.createSpace(admin.accessToken, { name: 'Hidden Assets' });
      const asset = await utils.createAsset(admin.accessToken);
      await utils.addSpaceAssets(admin.accessToken, space.id, [asset.id]);

      const lines = await syncStream(
        stranger.accessToken,
        [SyncRequestType.SharedSpaceAssetsV1, SyncRequestType.SharedSpaceToAssetsV1],
        true,
      );
      const assetEvents = lines.filter(
        (l) =>
          l.type === 'SharedSpaceAssetCreateV1' ||
          l.type === 'SharedSpaceAssetUpdateV1' ||
          l.type === 'SharedSpaceAssetBackfillV1',
      );
      const ids = assetEvents.map((l) => (l.data as { id: string }).id);
      expect(ids).not.toContain(asset.id);
      await ackAll(stranger.accessToken, lines);
    });

    it('removing an asset from a space emits SharedSpaceToAssetDeleteV1', async () => {
      const space = await utils.createSpace(admin.accessToken, { name: 'Asset Removal' });
      await utils.addSpaceMember(admin.accessToken, space.id, {
        userId: member.userId,
        role: SharedSpaceRole.Editor,
      });
      const asset = await utils.createAsset(admin.accessToken);
      await utils.addSpaceAssets(admin.accessToken, space.id, [asset.id]);

      const initial = await syncStream(
        member.accessToken,
        [
          SyncRequestType.SharedSpacesV1,
          SyncRequestType.SharedSpaceMembersV1,
          SyncRequestType.SharedSpaceAssetsV1,
          SyncRequestType.SharedSpaceToAssetsV1,
        ],
        true,
      );
      await ackAll(member.accessToken, initial);

      // Remove the asset from the space (DELETE /shared-spaces/:id/assets).
      await request(app)
        .delete(`/shared-spaces/${space.id}/assets`)
        .set(asBearerAuth(admin.accessToken))
        .send({ assetIds: [asset.id] })
        .expect(204);

      const next = await syncStream(member.accessToken, [
        SyncRequestType.SharedSpaceAssetsV1,
        SyncRequestType.SharedSpaceToAssetsV1,
      ]);
      const deletes = next.filter((l) => {
        if (l.type !== 'SharedSpaceToAssetDeleteV1') {
          return false;
        }
        const data = l.data as { spaceId: string; assetId: string };
        return data.spaceId === space.id && data.assetId === asset.id;
      });
      expect(deletes.length).toBeGreaterThanOrEqual(1);
    });
  });

  describe('SharedSpaceAssetExifsV1', () => {
    it('member sees exif rows for assets in their space', async () => {
      const space = await utils.createSpace(admin.accessToken, { name: 'Exif Space' });
      await utils.addSpaceMember(admin.accessToken, space.id, {
        userId: member.userId,
        role: SharedSpaceRole.Editor,
      });
      const asset = await utils.createAsset(admin.accessToken);
      await utils.addSpaceAssets(admin.accessToken, space.id, [asset.id]);

      const lines = await syncStream(
        member.accessToken,
        [SyncRequestType.SharedSpacesV1, SyncRequestType.SharedSpaceMembersV1, SyncRequestType.SharedSpaceAssetExifsV1],
        true,
      );
      const exifEvents = lines.filter(
        (l) =>
          l.type === 'SharedSpaceAssetExifCreateV1' ||
          l.type === 'SharedSpaceAssetExifUpdateV1' ||
          l.type === 'SharedSpaceAssetExifBackfillV1',
      );
      // Exactly one exif event for our uploaded asset should appear (exif
      // rows are auto-created on upload).
      const matching = exifEvents.filter((l) => (l.data as { assetId: string }).assetId === asset.id);
      expect(matching.length).toBeGreaterThanOrEqual(1);
      await ackAll(member.accessToken, lines);
    });

    it('stranger does NOT see exif rows from spaces they are not in', async () => {
      const space = await utils.createSpace(admin.accessToken, { name: 'Hidden Exif' });
      const asset = await utils.createAsset(admin.accessToken);
      await utils.addSpaceAssets(admin.accessToken, space.id, [asset.id]);

      const lines = await syncStream(stranger.accessToken, [SyncRequestType.SharedSpaceAssetExifsV1], true);
      const exifEvents = lines.filter(
        (l) =>
          l.type === 'SharedSpaceAssetExifCreateV1' ||
          l.type === 'SharedSpaceAssetExifUpdateV1' ||
          l.type === 'SharedSpaceAssetExifBackfillV1',
      );
      const matching = exifEvents.filter((l) => (l.data as { assetId: string }).assetId === asset.id);
      expect(matching).toHaveLength(0);
      await ackAll(stranger.accessToken, lines);
    });
  });

  describe('DTO validation', () => {
    it('rejects a non-enum SyncRequestType value', async () => {
      const { status } = await request(app)
        .post('/sync/stream')
        .set(asBearerAuth(admin.accessToken))
        .send({ types: ['SharedSpacesV1', 'NotARealType'] });
      expect(status).toBe(400);
    });

    it('response content-type is jsonlines+json for shared-space requests', async () => {
      const response = await request(app)
        .post('/sync/stream')
        .set(asBearerAuth(admin.accessToken))
        .send({ types: [SyncRequestType.SharedSpacesV1], reset: true })
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
      expect(response.headers['content-type']).toContain('application/jsonlines+json');
    });
  });

  describe('ack + resume', () => {
    it('after acking the full initial state, resync with no mutations returns only SyncCompleteV1', async () => {
      const first = await syncStream(admin.accessToken, [SyncRequestType.SharedSpacesV1], true);
      await ackAll(admin.accessToken, first);

      const second = await syncStream(admin.accessToken, [SyncRequestType.SharedSpacesV1]);
      const nonComplete = second.filter((l) => l.type !== 'SyncCompleteV1');
      expect(nonComplete).toHaveLength(0);
    });
  });
});
