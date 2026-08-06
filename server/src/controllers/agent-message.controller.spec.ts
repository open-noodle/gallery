import { AgentMessageController } from 'src/controllers/agent-message.controller';
import { AgentMessageCreateDto, AgentMessageResponseDto } from 'src/dtos/agent-message.dto';
import { AgentMessageRole, Permission } from 'src/enum';
import { AgentMessageService } from 'src/services/agent-message.service';
import request from 'supertest';
import { AuthFactory } from 'test/factories/auth.factory';
import { factory } from 'test/small.factory';
import { automock, ControllerContext, controllerSetup } from 'test/utils';

describe(AgentMessageController.name, () => {
  let ctx: ControllerContext;
  const service = automock(AgentMessageService, { args: [{} as never, {} as never], strict: false });
  const auth = AuthFactory.create();
  const sessionId = factory.uuid();
  const messageId = factory.uuid();
  const now = new Date('2026-05-14T12:00:00.000Z');
  const body: AgentMessageCreateDto = {
    content: {
      blocks: [{ type: 'text', text: 'Organize my Portugal photos.' }],
    },
  };
  const response: AgentMessageResponseDto = {
    id: messageId,
    sessionId,
    role: AgentMessageRole.User,
    content: body.content,
    providerMessageId: null,
    toolCallId: null,
    createdAt: now,
  };

  beforeAll(async () => {
    ctx = await controllerSetup(AgentMessageController, [{ provide: AgentMessageService, useValue: service }]);
    return () => ctx.close();
  });

  beforeEach(() => {
    service.resetAllMocks();
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

  describe('POST /agent/sessions/:id/messages', () => {
    it('should be an authenticated route with update permission', async () => {
      service.appendUserMessage.mockResolvedValue(response);

      await request(ctx.getHttpServer()).post(`/agent/sessions/${sessionId}/messages`).send(body);

      expect(ctx.authenticate).toHaveBeenCalled();
      expectPermission(Permission.AgentSessionUpdate);
    });

    it('should call the service with auth, session id, and body', async () => {
      service.appendUserMessage.mockResolvedValue(response);

      const { status, body: result } = await request(ctx.getHttpServer())
        .post(`/agent/sessions/${sessionId}/messages`)
        .send(body);

      expect(status).toBe(201);
      expect(service.appendUserMessage).toHaveBeenCalledWith(auth, sessionId, body);
      expect(result).toEqual({ ...response, createdAt: now.toISOString() });
    });

    it('should strip server-owned fields from append requests', async () => {
      service.appendUserMessage.mockResolvedValue(response);

      await request(ctx.getHttpServer())
        .post(`/agent/sessions/${sessionId}/messages`)
        .send({
          ...body,
          role: AgentMessageRole.Assistant,
          providerMessageId: 'provider-message-1',
          toolCallId: factory.uuid(),
        });

      expect(service.appendUserMessage).toHaveBeenCalledWith(auth, sessionId, body);
    });

    it('should require a valid session uuid', async () => {
      const { status, body: result } = await request(ctx.getHttpServer())
        .post('/agent/sessions/not-a-uuid/messages')
        .send(body);

      expect(status).toBe(400);
      expect(result).toEqual(factory.responses.validationError([{ path: ['id'], message: 'Invalid UUID' }]));
    });

    it('should reject empty message blocks', async () => {
      const { status, body: result } = await request(ctx.getHttpServer())
        .post(`/agent/sessions/${sessionId}/messages`)
        .send({ content: { blocks: [] } });

      expect(status).toBe(400);
      expect(result).toEqual(
        factory.responses.validationError([
          { path: ['content', 'blocks'], message: expect.stringContaining('Too small') as string },
        ]),
      );
    });

    it('should reject blank text blocks', async () => {
      const { status, body: result } = await request(ctx.getHttpServer())
        .post(`/agent/sessions/${sessionId}/messages`)
        .send({ content: { blocks: [{ type: 'text', text: '   ' }] } });

      expect(status).toBe(400);
      expect(result).toEqual(
        factory.responses.validationError([
          { path: ['content', 'blocks', 0, 'text'], message: expect.stringContaining('Too small') as string },
        ]),
      );
    });

    it('should reject unknown block types', async () => {
      const { status, body: result } = await request(ctx.getHttpServer())
        .post(`/agent/sessions/${sessionId}/messages`)
        .send({ content: { blocks: [{ type: 'html', html: '<b>no</b>' }] } });

      expect(status).toBe(400);
      expect(result).toEqual(
        factory.responses.validationError([
          { path: expect.arrayContaining(['content', 'blocks', 0]) as never, message: expect.any(String) as string },
        ]),
      );
    });

    it('should reject non-text reference blocks from the public append endpoint', async () => {
      const { status, body: result } = await request(ctx.getHttpServer())
        .post(`/agent/sessions/${sessionId}/messages`)
        .send({ content: { blocks: [{ type: 'asset', assetId: factory.uuid() }] } });

      expect(status).toBe(400);
      expect(result).toEqual(
        factory.responses.validationError([
          { path: expect.arrayContaining(['content', 'blocks', 0]) as never, message: expect.any(String) as string },
        ]),
      );
    });

    it('should reject oversized content payloads', async () => {
      const { status, body: result } = await request(ctx.getHttpServer())
        .post(`/agent/sessions/${sessionId}/messages`)
        .send({
          content: {
            blocks: Array.from({ length: 5 }, (_, index) => ({
              type: 'text',
              text: `${index}${'x'.repeat(7999)}`,
            })),
          },
        });

      expect(status).toBe(400);
      expect(result).toEqual(
        factory.responses.validationError([
          { path: ['content'], message: expect.stringContaining('32 KiB') as string },
        ]),
      );
    });
  });

  describe('GET /agent/sessions/:id/messages', () => {
    it('should be an authenticated route with read permission', async () => {
      service.getMessages.mockResolvedValue([]);

      await request(ctx.getHttpServer()).get(`/agent/sessions/${sessionId}/messages`);

      expect(ctx.authenticate).toHaveBeenCalled();
      expectPermission(Permission.AgentSessionRead);
    });

    it('should call the service with auth and session id', async () => {
      service.getMessages.mockResolvedValue([response]);

      const { status, body: result } = await request(ctx.getHttpServer()).get(`/agent/sessions/${sessionId}/messages`);

      expect(status).toBe(200);
      expect(service.getMessages).toHaveBeenCalledWith(auth, sessionId);
      expect(result).toEqual([{ ...response, createdAt: now.toISOString() }]);
    });

    it('should require a valid session uuid', async () => {
      const { status, body: result } = await request(ctx.getHttpServer()).get('/agent/sessions/not-a-uuid/messages');

      expect(status).toBe(400);
      expect(result).toEqual(factory.responses.validationError([{ path: ['id'], message: 'Invalid UUID' }]));
    });
  });
});
