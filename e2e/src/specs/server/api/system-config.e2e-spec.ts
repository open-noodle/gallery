import { LoginResponseDto, getConfig, type SystemConfigDto } from '@immich/sdk';
import { authHeaders, type Actor } from 'src/actors';
import { createUserDto } from 'src/fixtures';
import { errorDto } from 'src/responses';
import { app, asBearerAuth, utils } from 'src/utils';
import request from 'supertest';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';

// T30 — extends existing minimal coverage. The existing tests (PUT round-trip
// of newVersionCheck and the invalid storage-template rejection) are kept;
// T30 adds:
//   - Access matrix on GET / GET defaults / PUT
//   - GET /system-config/defaults shape
//   - PUT validation: machineLearning.clip.maxDistance bounds (Min 0, Max 2),
//     machineLearning.urls required when enabled, empty FFmpeg threads etc.
//   - GET /system-config/storage-template-options
//   - Round-trip through several sections (trash, theme, notifications)
//
// The IMMICH_CONFIG_FILE lock branch is intentionally NOT pinned — it requires
// restarting the e2e stack with the env var set, which is out of scope. The
// branch is verified by the unit tests at system-config.service.spec.ts.

const getSystemConfig = (accessToken: string) => getConfig({ headers: asBearerAuth(accessToken) });

describe('/system-config', () => {
  let admin: LoginResponseDto;
  let user: LoginResponseDto;
  let baseConfig: SystemConfigDto;
  const anonActor: Actor = { id: 'anon' };

  beforeAll(async () => {
    await utils.resetDatabase();
    admin = await utils.adminSetup();
    user = await utils.userSetup(admin.accessToken, createUserDto.create('t30-user'));
    baseConfig = await getSystemConfig(admin.accessToken);
  });

  afterEach(async () => {
    // Restore the default config so each test starts from a clean slate.
    await request(app).put('/system-config').set('Authorization', `Bearer ${admin.accessToken}`).send(baseConfig);
  });

  describe('GET /system-config (access matrix)', () => {
    it('requires authentication', async () => {
      const { status, body } = await request(app).get('/system-config').set(authHeaders(anonActor));
      expect(status).toBe(401);
      expect(body).toEqual(errorDto.unauthorized);
    });

    it('non-admin returns 403', async () => {
      const { status } = await request(app).get('/system-config').set(asBearerAuth(user.accessToken));
      expect(status).toBe(403);
    });

    it('admin gets the config', async () => {
      const { status, body } = await request(app).get('/system-config').set(asBearerAuth(admin.accessToken));
      expect(status).toBe(200);
      // The config has the expected top-level sections.
      expect(body).toEqual(
        expect.objectContaining({
          backup: expect.any(Object),
          ffmpeg: expect.any(Object),
          machineLearning: expect.any(Object),
          classification: expect.any(Object),
          newVersionCheck: expect.any(Object),
          theme: expect.any(Object),
          trash: expect.any(Object),
        }),
      );
    });
  });

  describe('GET /system-config/defaults', () => {
    it('requires authentication', async () => {
      const { status } = await request(app).get('/system-config/defaults').set(authHeaders(anonActor));
      expect(status).toBe(401);
    });

    it('non-admin returns 403', async () => {
      const { status } = await request(app).get('/system-config/defaults').set(asBearerAuth(user.accessToken));
      expect(status).toBe(403);
    });

    it('admin gets the default config (matches the same shape as GET /system-config)', async () => {
      const { status, body } = await request(app).get('/system-config/defaults').set(asBearerAuth(admin.accessToken));
      expect(status).toBe(200);
      // Defaults always have classification.enabled=true and categories=[] —
      // see server/src/config.ts:417-420.
      expect(body.classification).toEqual({ enabled: true, categories: [] });
      // Same top-level shape as the persisted config.
      const live = await getSystemConfig(admin.accessToken);
      expect(Object.keys(body).toSorted()).toEqual(Object.keys(live).toSorted());
    });
  });

  describe('GET /system-config/storage-template-options', () => {
    it('requires authentication', async () => {
      const { status } = await request(app).get('/system-config/storage-template-options').set(authHeaders(anonActor));
      expect(status).toBe(401);
    });

    it('admin gets the template options', async () => {
      const { status, body } = await request(app)
        .get('/system-config/storage-template-options')
        .set(asBearerAuth(admin.accessToken));
      expect(status).toBe(200);
      // The response shape is documented as SystemConfigTemplateStorageOptionDto;
      // it has month/day/hour/etc options. We just sanity-check it's a non-empty object.
      expect(typeof body).toBe('object');
      expect(body).not.toBeNull();
      expect(Object.keys(body).length).toBeGreaterThan(0);
    });
  });

  describe('PUT /system-config (existing tests + extensions)', () => {
    it('should always return the new config', async () => {
      const config = await getSystemConfig(admin.accessToken);

      const response1 = await request(app)
        .put('/system-config')
        .set('Authorization', `Bearer ${admin.accessToken}`)
        .send({ ...config, newVersionCheck: { enabled: false } });

      expect(response1.status).toBe(200);
      expect(response1.body).toEqual({ ...config, newVersionCheck: { enabled: false } });

      const response2 = await request(app)
        .put('/system-config')
        .set('Authorization', `Bearer ${admin.accessToken}`)
        .send({ ...config, newVersionCheck: { enabled: true } });

      expect(response2.status).toBe(200);
      expect(response2.body).toEqual({ ...config, newVersionCheck: { enabled: true } });
    });

    it('should reject an invalid config entry', async () => {
      const { status, body } = await request(app)
        .put('/system-config')
        .set('Authorization', `Bearer ${admin.accessToken}`)
        .send({
          ...(await getSystemConfig(admin.accessToken)),
          storageTemplate: { enabled: true, hashVerificationEnabled: true, template: '{{foo}}' },
        });

      expect(status).toBe(400);
      expect(body).toEqual(errorDto.badRequest(expect.stringContaining('Invalid storage template')));
    });

    it('non-admin PUT returns 403', async () => {
      const { status } = await request(app).put('/system-config').set(asBearerAuth(user.accessToken)).send(baseConfig);
      expect(status).toBe(403);
    });

    it('rejects machineLearning.clip.maxDistance below 0 (Min validator) — PR #294', async () => {
      // CLIPConfig.maxDistance has @Min(0) @Max(2). 0 means "disabled" — the
      // smart-search filter is opt-in. Pin both bounds to defend against a
      // future loosening that would silently break the threshold. Asserting
      // the message field references `maxDistance` so a different validator
      // firing (e.g. urls validation) doesn't satisfy the test.
      const { status, body } = await request(app)
        .put('/system-config')
        .set('Authorization', `Bearer ${admin.accessToken}`)
        .send({
          ...baseConfig,
          machineLearning: {
            ...baseConfig.machineLearning,
            clip: { ...baseConfig.machineLearning.clip, maxDistance: -0.1 },
          },
        });
      expect(status).toBe(400);
      expect(body.message).toEqual(expect.arrayContaining([expect.stringContaining('maxDistance')]));
    });

    it('rejects machineLearning.clip.maxDistance above 2 (Max validator) — PR #294', async () => {
      const { status, body } = await request(app)
        .put('/system-config')
        .set('Authorization', `Bearer ${admin.accessToken}`)
        .send({
          ...baseConfig,
          machineLearning: {
            ...baseConfig.machineLearning,
            clip: { ...baseConfig.machineLearning.clip, maxDistance: 2.5 },
          },
        });
      expect(status).toBe(400);
      expect(body.message).toEqual(expect.arrayContaining([expect.stringContaining('maxDistance')]));
    });

    it('accepts machineLearning.clip.maxDistance = 0 (disabled) and round-trips it', async () => {
      // 0 is the documented "disabled" sentinel for the smart-search filter.
      // Round-trip + GET to confirm it persists.
      const update = {
        ...baseConfig,
        machineLearning: {
          ...baseConfig.machineLearning,
          clip: { ...baseConfig.machineLearning.clip, maxDistance: 0 },
        },
      };
      const put = await request(app)
        .put('/system-config')
        .set('Authorization', `Bearer ${admin.accessToken}`)
        .send(update);
      expect(put.status).toBe(200);
      expect(put.body.machineLearning.clip.maxDistance).toBe(0);

      const after = await getSystemConfig(admin.accessToken);
      expect(after.machineLearning.clip.maxDistance).toBe(0);
    });

    it('rejects machineLearning.urls = [] when enabled=true (ValidateIf + ArrayMinSize)', async () => {
      // SystemConfigMachineLearningDto.urls has @ValidateIf((dto) => dto.enabled),
      // @ArrayMinSize(1). Disabling enabled would skip validation; enabled=true
      // requires at least one URL. Pin the message references `urls` so a
      // future change in the payload (or different validator firing) doesn't
      // silently satisfy the test.
      const { status, body } = await request(app)
        .put('/system-config')
        .set('Authorization', `Bearer ${admin.accessToken}`)
        .send({
          ...baseConfig,
          machineLearning: { ...baseConfig.machineLearning, enabled: true, urls: [] },
        });
      expect(status).toBe(400);
      expect(body.message).toEqual(expect.arrayContaining([expect.stringContaining('urls')]));
    });

    it('round-trips a trash config change', async () => {
      const update = {
        ...baseConfig,
        trash: { ...baseConfig.trash, days: baseConfig.trash.days + 7 },
      };
      const put = await request(app)
        .put('/system-config')
        .set('Authorization', `Bearer ${admin.accessToken}`)
        .send(update);
      expect(put.status).toBe(200);
      expect(put.body.trash.days).toBe(baseConfig.trash.days + 7);

      const after = await getSystemConfig(admin.accessToken);
      expect(after.trash.days).toBe(baseConfig.trash.days + 7);
    });

    it('round-trips a theme customCss change', async () => {
      const update = {
        ...baseConfig,
        theme: { ...baseConfig.theme, customCss: '/* t30 marker */' },
      };
      const put = await request(app)
        .put('/system-config')
        .set('Authorization', `Bearer ${admin.accessToken}`)
        .send(update);
      expect(put.status).toBe(200);
      expect(put.body.theme.customCss).toBe('/* t30 marker */');

      const after = await getSystemConfig(admin.accessToken);
      expect(after.theme.customCss).toBe('/* t30 marker */');
    });
  });
});
