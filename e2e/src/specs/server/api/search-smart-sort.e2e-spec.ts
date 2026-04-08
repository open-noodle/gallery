import { type LoginResponseDto } from '@immich/sdk';
import { type Actor, authHeaders } from 'src/actors';
import { createUserDto } from 'src/fixtures';
import { app, asBearerAuth, utils } from 'src/utils';
import request from 'supertest';
import { beforeAll, describe, expect, it } from 'vitest';

// T33 — coverage for the SmartSearchDto sort/validation surface introduced by
// PR #254 (two-phase CTE smart-search ordering).
//
// IMPORTANT scope note: the e2e Docker stack disables machine learning
// (`IMMICH_MACHINE_LEARNING_ENABLED: 'false'` in e2e/docker-compose.yml). This
// means /search/smart always trips the `if (!isSmartSearchEnabled(...))` gate
// at search.service.ts:135 and returns 400 'Smart search is not enabled'
// REGARDLESS of the request shape. The actual two-phase CTE sort logic at
// search.repository.ts:370-382 cannot be exercised end-to-end without:
//   1. enabling ML in system config (PUT /system-config)
//   2. seeding embeddings via direct DB INSERT into smart_search
//   3. providing a way for the searchSmart query to skip the ML encode call
//      (the queryAssetId path does this — it reads an existing embedding from
//      the DB instead of calling encodeText)
//
// That setup is more complex than T33's scope justifies. Sort-logic-level
// coverage is therefore deferred. T33 pins what is actually testable at the
// e2e layer with ML disabled:
//   - Auth + DTO validation surface around smart search
//   - The 'Smart search is not enabled' gating message (so an accidental
//     change to the gate or its message gets caught)
//   - The 'Either query or queryAssetId must be set' branch
//   - The 'spacePersonIds requires spaceId' branch (already covered in
//     search.e2e-spec.ts but pinned again here as a sanity reference)
//
// A future task should add the embedding-seeding helper and a real sort test
// once the e2e stack supports it. Filed as T-cleanup-03 in the backlog.

describe('POST /search/smart — sort + validation surface', () => {
  let admin: LoginResponseDto;
  let user: LoginResponseDto;
  const anonActor: Actor = { id: 'anon' };

  beforeAll(async () => {
    await utils.resetDatabase();
    admin = await utils.adminSetup({ onboarding: false });
    user = await utils.userSetup(admin.accessToken, createUserDto.create('t33-user'));
  });

  it('requires authentication', async () => {
    const { status } = await request(app).post('/search/smart').set(authHeaders(anonActor)).send({ query: 'test' });
    expect(status).toBe(401);
  });

  it('with empty body, ML gate fires before the missing-body branch (ordering pin)', async () => {
    // search.service.ts ordering: visibility check → spaceId check → ML-enabled
    // check → 'Either query or queryAssetId must be set' branch. With ML
    // disabled in the e2e stack, the gate at line 135 always fires first, so
    // an empty body still surfaces the gate message — NOT the missing-body
    // message at line 159. This test pins that ordering: if upstream reorders
    // the checks (e.g. moves the body check before the ML gate so the missing-
    // body case surfaces a clearer error), this test fails and forces a
    // deliberate update.
    const { status, body } = await request(app).post('/search/smart').set(asBearerAuth(user.accessToken)).send({});
    expect(status).toBe(400);
    expect((body as { message: string }).message).toBe('Smart search is not enabled');
  });

  it('returns 400 with order=asc when ML is disabled (gating message)', async () => {
    const { status, body } = await request(app)
      .post('/search/smart')
      .set(asBearerAuth(user.accessToken))
      .send({ query: 'test', order: 'asc' });
    expect(status).toBe(400);
    expect((body as { message: string }).message).toBe('Smart search is not enabled');
  });

  it('returns 400 with order=desc when ML is disabled (gating message)', async () => {
    const { status, body } = await request(app)
      .post('/search/smart')
      .set(asBearerAuth(user.accessToken))
      .send({ query: 'test', order: 'desc' });
    expect(status).toBe(400);
    expect((body as { message: string }).message).toBe('Smart search is not enabled');
  });

  it('rejects an invalid order enum value at the DTO layer (not the ML gate)', async () => {
    // The ValidateEnum decorator on `order` (search.dto.ts:255) fires at the
    // global ValidationPipe before search.service.ts is even invoked. So the
    // failure mode is DTO validation, NOT 'Smart search is not enabled'.
    // This pin distinguishes the two failure modes.
    const { status, body } = await request(app)
      .post('/search/smart')
      .set(asBearerAuth(user.accessToken))
      .send({ query: 'test', order: 'NOPE' });
    expect(status).toBe(400);
    // Whatever message it produces, it must NOT be the ML gate message.
    expect((body as { message: string | string[] }).message).not.toBe('Smart search is not enabled');
  });

  it('returns 400 for spacePersonIds without spaceId BEFORE the ML gate fires', async () => {
    // search.service.ts:130-132 — 'spacePersonIds requires spaceId'. This
    // check is at line 130, BEFORE the ML gate at line 135. With ML disabled,
    // we should still see the spacePersonIds-specific message because the
    // checks run in order.
    //
    // (This is the only check that fires before the ML gate. T33 pins the
    // ordering so a future refactor that moves the ML gate earlier breaks
    // this test deliberately.)
    const { status, body } = await request(app)
      .post('/search/smart')
      .set(asBearerAuth(admin.accessToken))
      .send({ query: 'test', spacePersonIds: [admin.userId] });
    expect(status).toBe(400);
    expect((body as { message: string }).message).toBe('spacePersonIds requires spaceId');
  });
});
