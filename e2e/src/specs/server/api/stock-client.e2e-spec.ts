import { LoginResponseDto, MemoryType, createMemory } from '@immich/sdk';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { GALLERY_APP_HEADER } from 'src/gallery-client.js';
import { app, asBearerAuth, utils } from 'src/utils.js';
import request from 'supertest';
import { beforeAll, describe, expect, it } from 'vitest';

// The Immich release Gallery is based on, which the server reports to stock clients.
const brandingConfig = resolve(import.meta.dirname, '../../../../../branding/config.json');
const { version: base } = JSON.parse(readFileSync(brandingConfig, 'utf8')).upstream as { version: string };

/**
 * A stock Immich client (no `x-gallery-app`, no Gallery app User-Agent) gets only what upstream at the base
 * version can decode. Everything else in the e2e suite is a Gallery client (src/gallery-client.ts).
 */
describe('stock Immich clients', () => {
  let admin: LoginResponseDto;

  const stock = (url: string) =>
    request(app).get(url).set('Authorization', `Bearer ${admin.accessToken}`).unset(GALLERY_APP_HEADER);
  const gallery = (url: string) => request(app).get(url).set('Authorization', `Bearer ${admin.accessToken}`);

  beforeAll(async () => {
    await utils.resetDatabase();
    admin = await utils.adminSetup();
    await utils.connectDatabase();
  });

  describe('server version', () => {
    it('reports the Immich base on GET /server/version', async () => {
      const { status, body } = await request(app).get('/server/version').unset(GALLERY_APP_HEADER);
      expect(status).toBe(200);
      expect(`${body.major}.${body.minor}.${body.patch}`).toBe(base);
    });

    it('reports the Immich base and its release page on GET /server/about', async () => {
      const { status, body } = await stock('/server/about');
      expect(status).toBe(200);
      expect(body.version).toBe(`v${base}`);
      expect(body.versionUrl).toBe(`https://github.com/immich-app/immich/releases/tag/v${base}`);
    });
  });

  describe('cluster groups', () => {
    it('answers the users of any cluster group with nobody', async () => {
      const { status, body } = await stock('/cluster-groups/00000000-0000-4000-a000-000000000000/users');
      expect(status).toBe(200);
      expect(body).toEqual([]);
    });
  });

  describe('people', () => {
    let petId: string;
    let personId: string;

    beforeAll(async () => {
      const asset = await utils.createAsset(admin.accessToken);
      ({ personGroupId: petId } = await utils.createPetWithEmbedding(admin.userId, 'cat', asset.id, 'Whiskers'));
      const person = await utils.createPerson(admin.accessToken, { name: 'John' });
      personId = person.id;
      await utils.createFace({ assetId: asset.id, personGroupId: personId });
      const other = await utils.createPerson(admin.accessToken, { name: 'Maria' });
      await utils.createFace({ assetId: asset.id, personGroupId: other.id });
    });

    it('lists people only when no type is named', async () => {
      const { status, body } = await stock('/people').query({ withHidden: true });
      expect(status).toBe(200);
      const ids = body.people.map(({ id }: { id: string }) => id);
      expect(ids).toContain(personId);
      expect(ids).not.toContain(petId);

      const { body: galleryBody } = await gallery('/people').query({ withHidden: true });
      expect(galleryBody.people.map(({ id }: { id: string }) => id)).toContain(petId);
    });

    it('honours the name filter', async () => {
      const { status, body } = await stock('/people').query({ withHidden: true, name: 'john' });
      expect(status).toBe(200);
      expect(body.people.map(({ id }: { id: string }) => id)).toEqual([personId]);
    });
  });

  describe('memories', () => {
    let ruleMemoryId: string;
    let memoryId: string;

    beforeAll(async () => {
      const asset = await utils.createAsset(admin.accessToken);
      const headers = asBearerAuth(admin.accessToken);
      const memoryAt = new Date().toISOString();
      ({ id: memoryId } = await createMemory(
        { memoryCreateDto: { type: MemoryType.OnThisDay, data: { year: 2020 }, memoryAt, assetIds: [asset.id] } },
        { headers },
      ));
      ({ id: ruleMemoryId } = await createMemory(
        {
          memoryCreateDto: {
            type: MemoryType.Rule,
            data: { ruleId: 'season_recap', dedupeKey: 'stock-client-e2e' },
            memoryAt,
            assetIds: [asset.id],
          },
        },
        { headers },
      ));
    });

    it('leaves rule memories out of GET /memories', async () => {
      const { status, body } = await stock('/memories');
      expect(status).toBe(200);
      const ids = body.map(({ id }: { id: string }) => id);
      expect(ids).toContain(memoryId);
      expect(ids).not.toContain(ruleMemoryId);

      const { body: galleryBody } = await gallery('/memories');
      expect(galleryBody.map(({ id }: { id: string }) => id)).toContain(ruleMemoryId);
    });

    it('leaves rule memories out of GET /memories/statistics', async () => {
      const { body } = await stock('/memories/statistics');
      const { body: galleryBody } = await gallery('/memories/statistics');
      expect(body.total).toBe(galleryBody.total - 1);
    });

    it('rejects GET /memories/{id} for a rule memory', async () => {
      const { status } = await stock(`/memories/${ruleMemoryId}`);
      expect(status).toBe(400);

      const { status: galleryStatus } = await gallery(`/memories/${ruleMemoryId}`);
      expect(galleryStatus).toBe(200);
    });
  });
});
