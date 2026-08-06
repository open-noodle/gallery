import { AgentRunnerController } from 'src/controllers/agent-runner.controller';
import { Permission } from 'src/enum';
import { AgentRunnerService } from 'src/services/agent-runner.service';
import request from 'supertest';
import { AuthFactory } from 'test/factories/auth.factory';
import { automock, ControllerContext, controllerSetup } from 'test/utils';

describe(AgentRunnerController.name, () => {
  let ctx: ControllerContext;
  const service = automock(AgentRunnerService, { args: [{} as never, {} as never], strict: false });
  const auth = AuthFactory.create();
  const response = {
    configured: false,
    healthy: false,
    reason: 'not-configured' as const,
    version: null,
    capabilities: null,
    checkedAt: new Date('2026-05-14T00:00:00.000Z'),
  };

  beforeAll(async () => {
    ctx = await controllerSetup(AgentRunnerController, [{ provide: AgentRunnerService, useValue: service }]);
    return () => ctx.close();
  });

  beforeEach(() => {
    service.resetAllMocks();
    ctx.reset();
    ctx.authenticate.mockResolvedValue(auth);
  });

  it('should be an authenticated route with agent runner read permission', async () => {
    service.getStatus.mockResolvedValue(response);

    await request(ctx.getHttpServer()).get('/agent/runner/status');

    expect(ctx.authenticate).toHaveBeenCalledWith(
      expect.objectContaining({
        metadata: expect.objectContaining({ permission: Permission.AgentRunnerRead }),
      }),
    );
  });

  it('should return runner status', async () => {
    service.getStatus.mockResolvedValue({
      configured: true,
      healthy: true,
      reason: 'healthy',
      version: '0.1.0',
      capabilities: {
        protocolVersion: '2026-05-14',
        streaming: true,
        tools: ['echo'],
        models: [],
      },
      checkedAt: new Date('2026-05-14T00:00:00.000Z'),
    });

    const { status, body } = await request(ctx.getHttpServer()).get('/agent/runner/status');

    expect(status).toBe(200);
    expect(service.getStatus).toHaveBeenCalledWith();
    expect(body).toEqual({
      configured: true,
      healthy: true,
      reason: 'healthy',
      version: '0.1.0',
      capabilities: {
        protocolVersion: '2026-05-14',
        streaming: true,
        tools: ['echo'],
        models: [],
      },
      checkedAt: '2026-05-14T00:00:00.000Z',
    });
  });
});
