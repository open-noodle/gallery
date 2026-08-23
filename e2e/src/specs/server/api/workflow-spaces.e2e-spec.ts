import { WorkflowTrigger, type LoginResponseDto } from '@immich/sdk';
import { createUserDto } from 'src/fixtures';
import { app, asBearerAuth, utils } from 'src/utils';
import request from 'supertest';
import { beforeAll, describe, expect, it } from 'vitest';

// Coverage for the fork-only gallery-core workflow plugin (packages/plugin-gallery) and the
// `gallery` host function it reaches through. If the host-function seam in onPluginLoad is ever
// removed, the wasm plugin fails to instantiate and every test here goes red — which is the point.

/** Polls until `check` returns truthy. waitForQueueFinish reports "done" while work remains. */
const until = async <T>(check: () => Promise<T>, timeoutMs = 30_000): Promise<T> => {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const result = await check();
    if (result) {
      return result;
    }

    if (Date.now() > deadline) {
      throw new Error('Timed out waiting for the workflow to run');
    }

    await new Promise((resolve) => setTimeout(resolve, 500));
  }
};

describe('/workflows (spaces)', () => {
  let admin: LoginResponseDto;
  let user: LoginResponseDto;

  beforeAll(async () => {
    await utils.resetDatabase();
    admin = await utils.adminSetup();
    user = await utils.userSetup(admin.accessToken, createUserDto.create('wf-spaces'));
  });

  const createSpace = async (name: string) => {
    const { body } = await request(app)
      .post('/shared-spaces')
      .set(asBearerAuth(user.accessToken))
      .send({ name })
      .expect(201);
    return body.id as string;
  };

  const createWorkflow = (steps: unknown[]) =>
    request(app)
      .post('/workflows')
      .set(asBearerAuth(user.accessToken))
      .send({ trigger: WorkflowTrigger.AssetCreate, name: 'spaces', steps })
      .expect(201);

  it('adds an uploaded asset to the configured space', async () => {
    // E1 — there is no GET /shared-spaces/:id/assets; the space detail endpoint computes
    // assetCount (shared-space.service.ts get()), which is what we poll.
    const spaceId = await createSpace('E1 space');
    await createWorkflow([{ method: 'gallery-core#addToSpace', config: { spaceIds: [spaceId] } }]);

    await utils.createAsset(user.accessToken);

    await until(async () => {
      const { body } = await request(app).get(`/shared-spaces/${spaceId}`).set(asBearerAuth(user.accessToken));
      return body?.assetCount === 1;
    });
  }, 35_000);

  it('creates, links and fills a space album that does not exist yet', async () => {
    // E2 — corrected from the brief draft: AlbumResponseDto has no `assets` field. album.service.ts's
    // get() (GET /albums/:id) calls findOrFail(..., { withAssets: false }), and the zod response
    // schema never declares an `assets` key at all, so `detail.assets` would be undefined. Both this
    // endpoint and GET /shared-spaces/:id/albums instead compute `assetCount` from a dedicated,
    // immediate getMetadataForIds() query (see shared-space.service.ts getLinkedAlbums()), so it's the
    // reliable signal that the uploaded asset actually landed in the album, not just that the album
    // exists and is linked.
    const spaceId = await createSpace('E2 space');
    await createWorkflow([{ method: 'gallery-core#addToSpaceAlbum', config: { spaceId, albumName: 'Auto album' } }]);

    await utils.createAsset(user.accessToken);

    const album = await until(async () => {
      const { body } = await request(app).get(`/shared-spaces/${spaceId}/albums`).set(asBearerAuth(user.accessToken));
      return body?.find?.(
        (item: { albumName: string; assetCount: number }) => item.albumName === 'Auto album' && item.assetCount === 1,
      );
    });

    const { body: detail } = await request(app)
      .get(`/albums/${album.id}`)
      .set(asBearerAuth(user.accessToken))
      .expect(200);
    expect(detail.assetCount).toBe(1);
  }, 35_000);

  it('reuses the same album for a second asset', async () => {
    // E3 — proves resolve-by-name, and that linkAlbum did not fire twice. Polls for assetCount === 2
    // on the single linked album rather than sleeping a fixed duration: if a bug caused a second album
    // to be created for the second asset, `body.length === 1` would never become true and this times
    // out (a clean failure) instead of racing a hardcoded delay.
    const spaceId = await createSpace('E3 space');
    await createWorkflow([{ method: 'gallery-core#addToSpaceAlbum', config: { spaceId, albumName: 'Shared album' } }]);

    await utils.createAsset(user.accessToken);
    await until(async () => {
      const { body } = await request(app).get(`/shared-spaces/${spaceId}/albums`).set(asBearerAuth(user.accessToken));
      return body?.length === 1 && body[0]?.assetCount === 1 ? body : undefined;
    });

    await utils.createAsset(user.accessToken);
    const albums = await until(async () => {
      const { body } = await request(app).get(`/shared-spaces/${spaceId}/albums`).set(asBearerAuth(user.accessToken));
      return body?.length === 1 && body[0]?.assetCount === 2 ? body : undefined;
    });

    expect(albums).toHaveLength(1);
    // 70s, not 60s: this test runs TWO sequential 30s-bounded polls, so 60s exactly equals the
    // worst-case polling time and leaves nothing for the two uploads and the setup requests, which
    // happen outside the polls. The single-poll tests above use the same bound-plus-margin shape.
  }, 70_000);

  it('keeps running the workflow when a space action is not permitted', async () => {
    // E4 — the §7 invariant, observed from outside: the second step must still take effect.
    // A well-formed but nonexistent space id is used rather than deleting a real one, so the
    // test does not depend on the delete endpoint's status code.
    //
    // Config corrected from the brief draft: assetFavorite's `inverse` flag is backwards from its
    // manifest description — the code is `target = config.inverse ? false : true`, so the DEFAULT
    // (no inverse, or inverse: false) favorites, and inverse: true unfavorites (confirmed against
    // server/test/medium/specs/workflow/workflow-core-plugin.spec.ts, which uses no config to
    // favorite and { inverse: true } only to unfavorite an already-favorited asset). A fresh asset
    // starts unfavorited, so `{ inverse: true }` would be a no-op and the poll below would never
    // observe isFavorite === true.
    const missingSpaceId = '00000000-0000-4000-8000-0000000000ff';

    await createWorkflow([
      { method: 'gallery-core#addToSpace', config: { spaceIds: [missingSpaceId] } },
      { method: 'immich-plugin-core#assetFavorite', config: {} },
    ]);

    const asset = await utils.createAsset(user.accessToken);

    await until(async () => {
      const { body } = await request(app).get(`/assets/${asset.id}`).set(asBearerAuth(user.accessToken));
      return body?.isFavorite === true;
    });
  }, 35_000);

  it('rejects a workflow that references an unknown gallery method', async () => {
    // E5
    await request(app)
      .post('/workflows')
      .set(asBearerAuth(user.accessToken))
      .send({
        trigger: WorkflowTrigger.AssetCreate,
        name: 'bad',
        steps: [{ method: 'gallery-core#noSuchMethod', config: {} }],
      })
      .expect(400);
  });
});
