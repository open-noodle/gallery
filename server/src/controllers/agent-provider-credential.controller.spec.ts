import { AgentProviderCredentialController } from 'src/controllers/agent-provider-credential.controller';
import { AgentProviderType, Permission } from 'src/enum';
import { AgentProviderCredentialService } from 'src/services/agent-provider-credential.service';
import request from 'supertest';
import { AuthFactory } from 'test/factories/auth.factory';
import { factory } from 'test/small.factory';
import { automock, ControllerContext, controllerSetup } from 'test/utils';

describe(AgentProviderCredentialController.name, () => {
  let ctx: ControllerContext;
  const service = automock(AgentProviderCredentialService, { args: [{} as never, {} as never], strict: false });
  const auth = AuthFactory.create();
  const id = factory.uuid();
  const now = new Date('2026-05-14T00:00:00.000Z');
  const response = {
    id,
    providerType: AgentProviderType.OpenAI,
    label: 'OpenAI personal',
    baseUrl: null,
    models: ['gpt-5.1'],
    defaultModel: 'gpt-5.1',
    createdAt: now,
    updatedAt: now,
    lastUsedAt: null,
    secret: 'sk-test',
    encryptedSecret: 'encrypted',
    secretVersion: 1,
  };

  beforeAll(async () => {
    ctx = await controllerSetup(AgentProviderCredentialController, [
      { provide: AgentProviderCredentialService, useValue: service },
    ]);
    return () => ctx.close();
  });

  beforeEach(() => {
    service.resetAllMocks();
    ctx.reset();
    ctx.authenticate.mockResolvedValue(auth);
  });

  const expectRedacted = (body: Record<string, unknown>) => {
    expect(body).toEqual({
      id,
      providerType: AgentProviderType.OpenAI,
      label: 'OpenAI personal',
      baseUrl: null,
      models: ['gpt-5.1'],
      defaultModel: 'gpt-5.1',
      createdAt: now.toISOString(),
      updatedAt: now.toISOString(),
      lastUsedAt: null,
    });
    expect(body).not.toHaveProperty('secret');
    expect(body).not.toHaveProperty('encryptedSecret');
    expect(body).not.toHaveProperty('secretVersion');
  };

  const expectPermission = (permission: Permission) => {
    expect(ctx.authenticate).toHaveBeenCalledWith(
      expect.objectContaining({
        metadata: expect.objectContaining({ permission }),
      }),
    );
  };

  describe('POST /agent/provider-credentials', () => {
    const body = {
      providerType: AgentProviderType.OpenAI,
      label: 'OpenAI personal',
      secret: 'sk-test',
      models: ['gpt-5.1'],
      defaultModel: 'gpt-5.1',
    };

    it('should be an authenticated route', async () => {
      service.create.mockResolvedValue(response);

      await request(ctx.getHttpServer()).post('/agent/provider-credentials').send(body);

      expect(ctx.authenticate).toHaveBeenCalled();
      expectPermission(Permission.AgentCredentialCreate);
    });

    it('should call the service with auth and body, redact the response, and return 201', async () => {
      service.create.mockResolvedValue(response);

      const { status, body: result } = await request(ctx.getHttpServer())
        .post('/agent/provider-credentials')
        .send(body);

      expect(status).toBe(201);
      expect(service.create).toHaveBeenCalledWith(auth, body);
      expectRedacted(result);
    });

    it('should require a baseUrl for openai-compatible providers', async () => {
      const { status, body: result } = await request(ctx.getHttpServer()).post('/agent/provider-credentials').send({
        providerType: AgentProviderType.OpenAICompatible,
        label: 'Local gateway',
        secret: 'local-key',
      });

      expect(status).toBe(400);
      expect(result).toEqual(
        factory.responses.validationError([
          {
            path: expect.any(Array) as never,
            message: expect.stringContaining('baseUrl is required for openai-compatible providers') as string,
          },
        ]),
      );
    });

    it('should require a secret', async () => {
      const { status, body: result } = await request(ctx.getHttpServer()).post('/agent/provider-credentials').send({
        providerType: AgentProviderType.OpenAI,
        label: 'OpenAI personal',
      });

      expect(status).toBe(400);
      expect(result).toEqual(
        factory.responses.validationError([
          { path: ['secret'], message: expect.stringContaining('Invalid input') as string },
        ]),
      );
    });

    it('should require a non-empty label', async () => {
      const { status, body: result } = await request(ctx.getHttpServer()).post('/agent/provider-credentials').send({
        providerType: AgentProviderType.OpenAI,
        label: '',
        secret: 'sk-test',
      });

      expect(status).toBe(400);
      expect(result).toEqual(
        factory.responses.validationError([
          { path: ['label'], message: expect.stringContaining('Too small') as string },
        ]),
      );
    });
  });

  describe('GET /agent/provider-credentials', () => {
    it('should be an authenticated route', async () => {
      service.getAll.mockResolvedValue([]);

      await request(ctx.getHttpServer()).get('/agent/provider-credentials');

      expect(ctx.authenticate).toHaveBeenCalled();
      expectPermission(Permission.AgentCredentialRead);
    });

    it('should call the service with auth and redact the response', async () => {
      service.getAll.mockResolvedValue([response]);

      const { status, body: result } = await request(ctx.getHttpServer()).get('/agent/provider-credentials');

      expect(status).toBe(200);
      expect(service.getAll).toHaveBeenCalledWith(auth);
      expect(result).toHaveLength(1);
      expectRedacted(result[0]);
    });
  });

  describe('GET /agent/provider-credentials/:id', () => {
    it('should be an authenticated route', async () => {
      service.getById.mockResolvedValue(response);

      await request(ctx.getHttpServer()).get(`/agent/provider-credentials/${id}`);

      expect(ctx.authenticate).toHaveBeenCalled();
      expectPermission(Permission.AgentCredentialRead);
    });

    it('should require a valid uuid', async () => {
      const { status, body: result } = await request(ctx.getHttpServer()).get('/agent/provider-credentials/123');

      expect(status).toBe(400);
      expect(result).toEqual(factory.responses.validationError([{ path: ['id'], message: 'Invalid UUID' }]));
    });

    it('should call the service with auth and id, and redact the response', async () => {
      service.getById.mockResolvedValue(response);

      const { status, body: result } = await request(ctx.getHttpServer()).get(`/agent/provider-credentials/${id}`);

      expect(status).toBe(200);
      expect(service.getById).toHaveBeenCalledWith(auth, id);
      expectRedacted(result);
    });
  });

  describe('PUT /agent/provider-credentials/:id', () => {
    const body = { label: 'Updated label', secret: 'sk-new' };

    it('should be an authenticated route', async () => {
      service.update.mockResolvedValue(response);

      await request(ctx.getHttpServer()).put(`/agent/provider-credentials/${id}`).send(body);

      expect(ctx.authenticate).toHaveBeenCalled();
      expectPermission(Permission.AgentCredentialUpdate);
    });

    it('should require a valid uuid', async () => {
      const { status, body: result } = await request(ctx.getHttpServer())
        .put('/agent/provider-credentials/123')
        .send(body);

      expect(status).toBe(400);
      expect(result).toEqual(factory.responses.validationError([{ path: ['id'], message: 'Invalid UUID' }]));
    });

    it('should call the service with auth, id, and body, and redact the response', async () => {
      service.update.mockResolvedValue(response);

      const { status, body: result } = await request(ctx.getHttpServer())
        .put(`/agent/provider-credentials/${id}`)
        .send(body);

      expect(status).toBe(200);
      expect(service.update).toHaveBeenCalledWith(auth, id, body);
      expectRedacted(result);
    });
  });

  describe('DELETE /agent/provider-credentials/:id', () => {
    it('should be an authenticated route', async () => {
      service.delete.mockResolvedValue();

      await request(ctx.getHttpServer()).delete(`/agent/provider-credentials/${id}`);

      expect(ctx.authenticate).toHaveBeenCalled();
      expectPermission(Permission.AgentCredentialDelete);
    });

    it('should require a valid uuid', async () => {
      const { status, body: result } = await request(ctx.getHttpServer()).delete('/agent/provider-credentials/123');

      expect(status).toBe(400);
      expect(result).toEqual(factory.responses.validationError([{ path: ['id'], message: 'Invalid UUID' }]));
    });

    it('should call the service with auth and id, and return 204 with an empty body', async () => {
      service.delete.mockResolvedValue();

      const {
        status,
        body: result,
        text,
      } = await request(ctx.getHttpServer()).delete(`/agent/provider-credentials/${id}`);

      expect(status).toBe(204);
      expect(result).toEqual({});
      expect(text).toBe('');
      expect(service.delete).toHaveBeenCalledWith(auth, id);
    });
  });
});
