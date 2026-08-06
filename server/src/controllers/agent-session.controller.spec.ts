import { AgentSessionController } from 'src/controllers/agent-session.controller';
import { AgentSessionActivityEventResponseDto } from 'src/dtos/agent-session-activity-event.dto';
import { AgentSessionCreateDto, AgentSessionResponseDto } from 'src/dtos/agent-session.dto';
import {
  AgentApprovalMode,
  AgentPermissionPreset,
  AgentProviderType,
  AgentSessionActivityEventKind,
  AgentSessionActivityEventSource,
  AgentSessionActivityEventStatus,
  AgentSessionStatus,
  Permission,
} from 'src/enum';
import { AgentSessionActivityEventService } from 'src/services/agent-session-activity-event.service';
import { AgentSessionService } from 'src/services/agent-session.service';
import type { AgentNormalizedPermissionPlanSnapshot } from 'src/types/agent-session.types';
import request from 'supertest';
import { AuthFactory } from 'test/factories/auth.factory';
import { factory } from 'test/small.factory';
import { automock, ControllerContext, controllerSetup } from 'test/utils';

const makePermissionPlan = (): AgentNormalizedPermissionPlanSnapshot => ({
  read: {
    metadata: true,
    previews: true,
    originals: true,
  },
  providerExposure: {
    metadata: true,
    previews: true,
    originals: true,
    allowOriginalsForExternalProviders: false,
  },
  assetScope: {
    owned: true,
    sharedSpaces: true,
    locked: false,
  },
  writeScope: {
    createAlbum: true,
    addAssets: true,
    removeAssets: true,
    updateDetails: true,
    setCover: true,
    createSpace: true,
    addAssetsToSpaces: true,
    addMembersToSpaces: true,
    removeAssetsFromSpaces: true,
    removeMembersFromSpaces: true,
    updateSpaceDetails: true,
    updateSpaceMemberRoles: true,
    editAssets: true,
    favoriteAssets: true,
    archiveAssets: true,
    tagAssets: true,
    updateAssetMetadata: true,
    trashAssets: true,
    createSharedLinks: false,
    shareAlbums: false,
    lockAssets: false,
    deleteContainers: false,
    manageStacks: false,
    managePeople: false,
  },
  limits: {
    maxAssetsPerToolCall: 20,
    maxAssetsPerSession: 100,
    maxPreviewsPerToolCall: 10,
    maxOriginalsPerToolCall: 5,
    expiresInMinutes: 60,
  },
});

const jsonByteLength = (value: unknown) => Buffer.byteLength(JSON.stringify(value), 'utf8');

const makeInitialContext = (targetBytes: number) => {
  const emptyContext = { payload: '' };
  const payloadLength = targetBytes - jsonByteLength(emptyContext);

  if (payloadLength < 0) {
    throw new Error('targetBytes is smaller than the empty initial context JSON');
  }

  const context = { payload: 'x'.repeat(payloadLength) };
  expect(jsonByteLength(context)).toBe(targetBytes);
  return context;
};

describe(AgentSessionController.name, () => {
  let ctx: ControllerContext;
  const service = automock(AgentSessionService, { args: [{} as never, {} as never, {} as never], strict: false });
  const activityEventService = automock(AgentSessionActivityEventService, {
    args: [{} as never, {} as never],
    strict: false,
  });
  const auth = AuthFactory.create();
  const id = factory.uuid();
  const providerCredentialId = factory.uuid();
  const now = new Date('2026-05-14T12:00:00.000Z');
  const endedAt = new Date('2026-05-14T12:30:00.000Z');
  const permissionPlan = makePermissionPlan();
  const initialContext = { albumId: factory.uuid() };
  const body: AgentSessionCreateDto = {
    providerCredentialId,
    model: 'gpt-5.1',
    permissionPreset: AgentPermissionPreset.Careful,
    approvalMode: AgentApprovalMode.Strict,
    runnerEndpoint: 'https://runner.example.com/sessions',
    initialContext,
  };
  const customBody: AgentSessionCreateDto = {
    ...body,
    permissionPreset: AgentPermissionPreset.Custom,
    permissionPlan,
  };
  const response: AgentSessionResponseDto = {
    id,
    status: AgentSessionStatus.Running,
    title: null,
    providerCredentialId,
    credentialSnapshot: {
      id: providerCredentialId,
      providerType: AgentProviderType.OpenAI,
      label: 'OpenAI personal',
      baseUrl: null,
      models: ['gpt-5.1'],
      defaultModel: 'gpt-5.1',
    },
    modelSnapshot: {
      providerCredentialId,
      model: 'gpt-5.1',
    },
    permissionPreset: AgentPermissionPreset.Careful,
    permissionPlanSnapshot: permissionPlan,
    approvalMode: AgentApprovalMode.Strict,
    runnerEndpoint: 'http://agent-runner:4477',
    runnerSessionId: 'stub-00000000-0000-4000-8000-000000000100',
    runnerCapabilitiesSnapshot: { protocolVersion: '2026-05-14', streaming: true, tools: ['echo'], models: [] },
    initialContextSnapshot: initialContext,
    createdAt: now,
    updatedAt: now,
    endedAt: null,
  };
  const activityEvent: AgentSessionActivityEventResponseDto = {
    id: factory.uuid(),
    sessionId: id,
    kind: AgentSessionActivityEventKind.StartProcessing,
    status: AgentSessionActivityEventStatus.Running,
    source: AgentSessionActivityEventSource.Server,
    summary: null,
    counts: null,
    createdAt: now,
  };

  beforeAll(async () => {
    ctx = await controllerSetup(AgentSessionController, [
      { provide: AgentSessionService, useValue: service },
      { provide: AgentSessionActivityEventService, useValue: activityEventService },
    ]);
    return () => ctx.close();
  });

  beforeEach(() => {
    service.resetAllMocks();
    activityEventService.resetAllMocks();
    ctx.reset();
    ctx.authenticate.mockResolvedValue(auth);
  });

  const expectPermission = (permission: Permission) => {
    expect(ctx.authenticate).toHaveBeenCalledWith(
      expect.objectContaining({
        metadata: expect.objectContaining({ permission }),
      }),
    );
  };

  const expectSerializedResponse = (result: Record<string, unknown>, overrides: Record<string, unknown> = {}) => {
    expect(result).toEqual({
      ...response,
      createdAt: now.toISOString(),
      updatedAt: now.toISOString(),
      endedAt: null,
      ...overrides,
    });
  };

  describe('POST /agent/sessions', () => {
    it('should be an authenticated route', async () => {
      service.create.mockResolvedValue(response);

      await request(ctx.getHttpServer()).post('/agent/sessions').send(body);

      expect(ctx.authenticate).toHaveBeenCalled();
      expectPermission(Permission.AgentSessionCreate);
    });

    it('should call the service with auth and body, serialize dates, and return 201', async () => {
      service.create.mockResolvedValue(response);

      const { status, body: result } = await request(ctx.getHttpServer()).post('/agent/sessions').send(body);

      expect(status).toBe(201);
      expect(service.create).toHaveBeenCalledWith(auth, body);
      expectSerializedResponse(result);
    });

    it('should validate providerCredentialId as a uuid', async () => {
      const { status, body: result } = await request(ctx.getHttpServer())
        .post('/agent/sessions')
        .send({ ...body, providerCredentialId: '123' });

      expect(status).toBe(400);
      expect(result).toEqual(
        factory.responses.validationError([{ path: ['providerCredentialId'], message: 'Invalid UUID' }]),
      );
    });

    it('should require permissionPlan for custom sessions', async () => {
      const { status, body: result } = await request(ctx.getHttpServer())
        .post('/agent/sessions')
        .send({ ...customBody, permissionPlan: undefined });

      expect(status).toBe(400);
      expect(result).toEqual(
        factory.responses.validationError([
          { path: ['permissionPlan'], message: expect.stringContaining('permissionPlan is required') as string },
        ]),
      );
    });

    it('should accept a valid custom permission plan', async () => {
      const customResponse = {
        ...response,
        permissionPreset: AgentPermissionPreset.Custom,
        permissionPlanSnapshot: permissionPlan,
      };
      service.create.mockResolvedValue(customResponse);

      const { status, body: result } = await request(ctx.getHttpServer()).post('/agent/sessions').send(customBody);

      expect(status).toBe(201);
      expect(service.create).toHaveBeenCalledWith(auth, customBody);
      expectSerializedResponse(result, {
        permissionPreset: AgentPermissionPreset.Custom,
        permissionPlanSnapshot: permissionPlan,
      });
    });

    it('should reject permissionPlan for preset sessions', async () => {
      const { status, body: result } = await request(ctx.getHttpServer())
        .post('/agent/sessions')
        .send({ ...body, permissionPlan });

      expect(status).toBe(400);
      expect(result).toEqual(
        factory.responses.validationError([
          { path: ['permissionPlan'], message: expect.stringContaining('permissionPlan is only accepted') as string },
        ]),
      );
    });

    it('should reject invalid approvalMode', async () => {
      const { status, body: result } = await request(ctx.getHttpServer())
        .post('/agent/sessions')
        .send({ ...body, approvalMode: 'sometimes' });

      expect(status).toBe(400);
      expect(result).toEqual(
        factory.responses.validationError([
          { path: ['approvalMode'], message: expect.stringContaining('Invalid option') as string },
        ]),
      );
    });

    it('should reject inconsistent custom permission plans', async () => {
      const inconsistentPermissionPlan = makePermissionPlan();
      inconsistentPermissionPlan.read.previews = false;

      const { status, body: result } = await request(ctx.getHttpServer())
        .post('/agent/sessions')
        .send({ ...customBody, permissionPlan: inconsistentPermissionPlan });

      expect(status).toBe(400);
      expect(result).toEqual(
        factory.responses.validationError([
          {
            path: ['permissionPlan', 'providerExposure', 'previews'],
            message: expect.stringContaining('preview exposure requires preview reads') as string,
          },
          {
            path: ['permissionPlan', 'limits', 'maxPreviewsPerToolCall'],
            message: expect.stringContaining('preview limits require preview reads') as string,
          },
        ]),
      );
    });

    it('should reject oversized initialContext', async () => {
      const { status, body: result } = await request(ctx.getHttpServer())
        .post('/agent/sessions')
        .send({ ...body, initialContext: makeInitialContext(16_385) });

      expect(status).toBe(400);
      expect(result).toEqual(
        factory.responses.validationError([
          { path: ['initialContext'], message: expect.stringContaining('16 KiB') as string },
        ]),
      );
    });
  });

  describe('GET /agent/sessions', () => {
    it('should be an authenticated route', async () => {
      service.getAll.mockResolvedValue([]);

      await request(ctx.getHttpServer()).get('/agent/sessions');

      expect(ctx.authenticate).toHaveBeenCalled();
      expectPermission(Permission.AgentSessionRead);
    });

    it('should call the service with auth and return sessions', async () => {
      service.getAll.mockResolvedValue([response]);

      const { status, body: result } = await request(ctx.getHttpServer()).get('/agent/sessions');

      expect(status).toBe(200);
      expect(service.getAll).toHaveBeenCalledWith(auth);
      expect(result).toHaveLength(1);
      expectSerializedResponse(result[0]);
    });
  });

  describe('GET /agent/sessions/:id', () => {
    it('should be an authenticated route', async () => {
      service.getById.mockResolvedValue(response);

      await request(ctx.getHttpServer()).get(`/agent/sessions/${id}`);

      expect(ctx.authenticate).toHaveBeenCalled();
      expectPermission(Permission.AgentSessionRead);
    });

    it('should require a valid uuid', async () => {
      const { status, body: result } = await request(ctx.getHttpServer()).get('/agent/sessions/123');

      expect(status).toBe(400);
      expect(result).toEqual(factory.responses.validationError([{ path: ['id'], message: 'Invalid UUID' }]));
    });

    it('should call the service with auth and id', async () => {
      service.getById.mockResolvedValue(response);

      const { status, body: result } = await request(ctx.getHttpServer()).get(`/agent/sessions/${id}`);

      expect(status).toBe(200);
      expect(service.getById).toHaveBeenCalledWith(auth, id);
      expectSerializedResponse(result);
    });
  });

  describe('GET /agent/sessions/:id/activity-events', () => {
    it('should be an authenticated route', async () => {
      activityEventService.getHistory.mockResolvedValue([]);

      await request(ctx.getHttpServer()).get(`/agent/sessions/${id}/activity-events`);

      expect(ctx.authenticate).toHaveBeenCalled();
      expectPermission(Permission.AgentSessionRead);
    });

    it('should require a valid uuid', async () => {
      const { status, body: result } = await request(ctx.getHttpServer()).get('/agent/sessions/123/activity-events');

      expect(status).toBe(400);
      expect(result).toEqual(factory.responses.validationError([{ path: ['id'], message: 'Invalid UUID' }]));
    });

    it('should call the activity event service with auth and id', async () => {
      activityEventService.getHistory.mockResolvedValue([activityEvent]);

      const { status, body: result } = await request(ctx.getHttpServer()).get(`/agent/sessions/${id}/activity-events`);

      expect(status).toBe(200);
      expect(activityEventService.getHistory).toHaveBeenCalledWith(auth, id);
      expect(result).toEqual([{ ...activityEvent, createdAt: now.toISOString() }]);
    });
  });

  describe('PUT /agent/sessions/:id', () => {
    it('should be an authenticated route', async () => {
      service.update.mockResolvedValue({ ...response, title: 'Renamed chat' });

      await request(ctx.getHttpServer()).put(`/agent/sessions/${id}`).send({ title: 'Renamed chat' });

      expect(ctx.authenticate).toHaveBeenCalled();
      expectPermission(Permission.AgentSessionUpdate);
    });

    it('should validate and update mutable session metadata', async () => {
      const updatedResponse = { ...response, title: 'Renamed chat' };
      service.update.mockResolvedValue(updatedResponse);

      const { status, body: result } = await request(ctx.getHttpServer())
        .put(`/agent/sessions/${id}`)
        .send({ title: '  Renamed chat  ' });

      expect(status).toBe(200);
      expect(service.update).toHaveBeenCalledWith(auth, id, { title: 'Renamed chat' });
      expectSerializedResponse(result, { title: 'Renamed chat' });
    });

    it('should allow clearing the custom title', async () => {
      service.update.mockResolvedValue(response);

      const { status } = await request(ctx.getHttpServer()).put(`/agent/sessions/${id}`).send({ title: null });

      expect(status).toBe(200);
      expect(service.update).toHaveBeenCalledWith(auth, id, { title: null });
    });

    it('should reject blank titles', async () => {
      const { status, body: result } = await request(ctx.getHttpServer())
        .put(`/agent/sessions/${id}`)
        .send({ title: '   ' });

      expect(status).toBe(400);
      expect(result).toEqual(
        factory.responses.validationError([
          { path: ['title'], message: expect.stringContaining('Too small') as string },
        ]),
      );
    });
  });

  describe('DELETE /agent/sessions/:id', () => {
    it('should be an authenticated route', async () => {
      service.delete.mockResolvedValue();

      await request(ctx.getHttpServer()).delete(`/agent/sessions/${id}`);

      expect(ctx.authenticate).toHaveBeenCalled();
      expectPermission(Permission.AgentSessionUpdate);
    });

    it('should call the service and return 204', async () => {
      service.delete.mockResolvedValue();

      const { status, text } = await request(ctx.getHttpServer()).delete(`/agent/sessions/${id}`);

      expect(status).toBe(204);
      expect(text).toBe('');
      expect(service.delete).toHaveBeenCalledWith(auth, id);
    });
  });

  describe('POST /agent/sessions/:id/cancel', () => {
    const cancelledResponse = {
      ...response,
      status: AgentSessionStatus.Cancelled,
      updatedAt: endedAt,
      endedAt,
    };

    it('should be an authenticated route', async () => {
      service.cancel.mockResolvedValue(cancelledResponse);

      await request(ctx.getHttpServer()).post(`/agent/sessions/${id}/cancel`);

      expect(ctx.authenticate).toHaveBeenCalled();
      expectPermission(Permission.AgentSessionUpdate);
    });

    it('should require a valid uuid', async () => {
      const { status, body: result } = await request(ctx.getHttpServer()).post('/agent/sessions/123/cancel');

      expect(status).toBe(400);
      expect(result).toEqual(factory.responses.validationError([{ path: ['id'], message: 'Invalid UUID' }]));
    });

    it('should call the service with auth and id, and return the cancelled response', async () => {
      service.cancel.mockResolvedValue(cancelledResponse);

      const { status, body: result } = await request(ctx.getHttpServer()).post(`/agent/sessions/${id}/cancel`);

      expect(status).toBe(200);
      expect(service.cancel).toHaveBeenCalledWith(auth, id);
      expectSerializedResponse(result, {
        status: AgentSessionStatus.Cancelled,
        updatedAt: endedAt.toISOString(),
        endedAt: endedAt.toISOString(),
      });
    });
  });
});
