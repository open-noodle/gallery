import { SharedSpaceRole, type LoginResponseDto } from '@immich/sdk';
import { createUserDto } from 'src/fixtures';
import { app, utils } from 'src/utils';
import request from 'supertest';
import { beforeAll, describe, expect, it } from 'vitest';

/**
 * #986 — the album scope on smart search.
 *
 * An album detail page runs its page-aware search scoped to the album it is showing. Server-side
 * that made `albumIds` an ACCESS BOUNDARY on the smart path, matching what `/search/metadata` has
 * always done: check `AlbumRead` up front, then leave the owner-scoping `userIds` unset so
 * `albumSharedSpaceScope` re-gates the rows. Previously smart search kept `userIds`, so searching a
 * shared album returned only your own photos beside a grid that had just shown everyone's.
 *
 * WHAT IS TESTABLE HERE, and why these assertions look indirect:
 *
 * The e2e stack sets `IMMICH_MACHINE_LEARNING_ENABLED=false`, so smart search always ends in the
 * "Smart search is not enabled" gate and never reaches SQL. But the new `AlbumRead` check runs
 * BEFORE that gate, so the two 400s carry different messages — and which one comes back tells us
 * exactly whether the check ran and whether it passed:
 *
 *   "Not found or no album.read access"  → the check ran and REFUSED
 *   "Smart search is not enabled"        → the check ran and PASSED (or never ran)
 *
 * That distinction is what makes the DTO change observable too: if `albumIds` were still stripped
 * from `SmartSearchFacetsDto` by the zod pipe, the facets endpoint could not refuse an inaccessible
 * album at all — it would fall through to the ML gate. So the refusal below is an end-to-end proof
 * that the field survives validation.
 *
 * The row-level half (a shared album returning every member's matches) needs real embeddings and is
 * covered by unit tests over the resolved options; it cannot be reached while ML is off.
 */

const NO_ALBUM_ACCESS = 'Not found or no album.read access';
const ML_DISABLED = 'Smart search is not enabled';

const smartSearch = async (accessToken: string, body: Record<string, unknown>) =>
  request(app).post('/search/smart').set('Authorization', `Bearer ${accessToken}`).send(body);

const smartFacets = async (accessToken: string, body: Record<string, unknown>) =>
  request(app).post('/search/smart/facets').set('Authorization', `Bearer ${accessToken}`).send(body);

describe('smart search album scope (#986)', () => {
  let admin: LoginResponseDto;
  let owner: LoginResponseDto;
  let stranger: LoginResponseDto;
  let spaceMember: LoginResponseDto;

  /** Owned by `owner`, shared with nobody. */
  let privateAlbumId: string;
  /** Owned by `owner`, shared with `spaceMember` through a space link. */
  let spaceLinkedAlbumId: string;

  beforeAll(async () => {
    await utils.resetDatabase();
    admin = await utils.adminSetup({ onboarding: false });
    owner = await utils.userSetup(admin.accessToken, createUserDto.create('album-scope-owner'));
    stranger = await utils.userSetup(admin.accessToken, createUserDto.create('album-scope-stranger'));
    spaceMember = await utils.userSetup(admin.accessToken, createUserDto.create('album-scope-member'));

    const asset = await utils.createAsset(owner.accessToken);

    const privateAlbum = await utils.createAlbum(owner.accessToken, {
      albumName: 'Private Album',
      assetIds: [asset.id],
    });
    privateAlbumId = privateAlbum.id;

    // Deliberately NOT given `albumUsers`: an album-user role would grant AlbumRead on its own and
    // the space-grant tests below would pass without the space link doing anything.
    const spaceAlbum = await utils.createAlbum(owner.accessToken, {
      albumName: 'Space Linked Album',
      assetIds: [asset.id],
    });
    spaceLinkedAlbumId = spaceAlbum.id;

    const space = await utils.createSpace(owner.accessToken, { name: 'Album Scope Space' });
    await utils.addSpaceMember(owner.accessToken, space.id, {
      userId: spaceMember.userId,
      role: SharedSpaceRole.Editor,
    });
    await utils.linkSpaceAlbum(owner.accessToken, space.id, spaceLinkedAlbumId);
  });

  describe('POST /search/smart', () => {
    it('refuses an album the caller cannot read', async () => {
      const { status, body } = await smartSearch(stranger.accessToken, {
        query: 'beach',
        albumIds: [privateAlbumId],
      });

      expect(status).toBe(400);
      expect(body.message).toBe(NO_ALBUM_ACCESS);
    });

    it('accepts an album the caller owns', async () => {
      const { status, body } = await smartSearch(owner.accessToken, {
        query: 'beach',
        albumIds: [privateAlbumId],
      });

      // Past the access check; only the ML gate is left.
      expect(status).toBe(400);
      expect(body.message).toBe(ML_DISABLED);
    });

    it('accepts an album shared with the caller through a space', async () => {
      const { status, body } = await smartSearch(spaceMember.accessToken, {
        query: 'beach',
        albumIds: [spaceLinkedAlbumId],
      });

      expect(status).toBe(400);
      expect(body.message).toBe(ML_DISABLED);
    });

    it('refuses a non-existent album id rather than silently returning nothing', async () => {
      const { status, body } = await smartSearch(owner.accessToken, {
        query: 'beach',
        albumIds: ['00000000-0000-4000-8000-0000000000ff'],
      });

      expect(status).toBe(400);
      expect(body.message).toBe(NO_ALBUM_ACCESS);
    });

    it('leaves an unscoped smart search on the ML gate, with no album check in the way', async () => {
      const { status, body } = await smartSearch(stranger.accessToken, { query: 'beach' });

      expect(status).toBe(400);
      expect(body.message).toBe(ML_DISABLED);
    });

    it('rejects a malformed album id at the DTO boundary', async () => {
      const { status } = await smartSearch(owner.accessToken, { query: 'beach', albumIds: ['not-a-uuid'] });

      expect(status).toBe(400);
    });
  });

  describe('POST /search/smart/facets', () => {
    // The facets schema is a `.pick()` from the base search schema and did not carry `albumIds`, so
    // the zod pipe stripped it: the facet counts and time buckets silently described the whole
    // library beside a result grid showing one album. A refusal here can only happen if the field
    // now survives validation and reaches the access check.
    it('refuses an album the caller cannot read, proving albumIds survives validation', async () => {
      const { status, body } = await smartFacets(stranger.accessToken, {
        query: 'beach',
        albumIds: [privateAlbumId],
      });

      expect(status).toBe(400);
      expect(body.message).toBe(NO_ALBUM_ACCESS);
    });

    it('accepts an album the caller owns', async () => {
      const { status, body } = await smartFacets(owner.accessToken, {
        query: 'beach',
        albumIds: [privateAlbumId],
      });

      expect(status).toBe(400);
      expect(body.message).toBe(ML_DISABLED);
    });

    it('accepts an album shared with the caller through a space', async () => {
      const { status, body } = await smartFacets(spaceMember.accessToken, {
        query: 'beach',
        albumIds: [spaceLinkedAlbumId],
      });

      expect(status).toBe(400);
      expect(body.message).toBe(ML_DISABLED);
    });
  });

  // The reference behaviour the smart path was aligned to. Unlike smart search this one is not
  // behind the ML gate, so it can assert on real rows: a space member searching a linked album by
  // `albumIds` sees the OWNER's asset, not just their own.
  describe('POST /search/metadata (the shape smart search now matches)', () => {
    it('returns the owner’s asset to a space member searching the linked album', async () => {
      const { status, body } = await request(app)
        .post('/search/metadata')
        .set('Authorization', `Bearer ${spaceMember.accessToken}`)
        .send({ albumIds: [spaceLinkedAlbumId] });

      expect(status).toBe(200);
      const items = body.assets.items as Array<{ id: string; ownerId: string }>;
      expect(items.length).toBeGreaterThan(0);
      expect(items.some((item) => item.ownerId === owner.userId)).toBe(true);
    });

    it('refuses an album the caller cannot read', async () => {
      const { status, body } = await request(app)
        .post('/search/metadata')
        .set('Authorization', `Bearer ${stranger.accessToken}`)
        .send({ albumIds: [privateAlbumId] });

      expect(status).toBe(400);
      expect(body.message).toBe(NO_ALBUM_ACCESS);
    });
  });
});
