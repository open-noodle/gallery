import { UnauthorizedException } from '@nestjs/common';
import { AgentRunnerMcpController } from 'src/controllers/agent-runner-mcp.controller';
import { AgentRunnerTokenGuard } from 'src/controllers/agent-runner-token.guard';
import {
  AgentOperationRiskLevel,
  AgentOperationTargetKind,
  AgentOperationType,
  AgentPermissionPreset,
  AgentToolName,
} from 'src/enum';
import { AgentSessionRepository } from 'src/repositories/agent-session.repository';
import { AgentMcpToolContractService } from 'src/services/agent-mcp-tool-contract.service';
import { AgentMcpToolRegistryService } from 'src/services/agent-mcp-tool-registry.service';
import { AgentMcpService } from 'src/services/agent-mcp.service';
import { AgentOperationPlanService } from 'src/services/agent-operation-plan.service';
import { AgentRunnerToolTokenService } from 'src/services/agent-runner-tool-token.service';
import { AgentSessionService } from 'src/services/agent-session.service';
import { AgentToolService } from 'src/services/agent-tool.service';
import type { AgentMcpHandleResponse } from 'src/types/agent-mcp.types';
import request from 'supertest';
import { factory } from 'test/small.factory';
import type { ControllerContext } from 'test/utils';
import { automock, controllerSetup } from 'test/utils';

describe(AgentRunnerMcpController.name, () => {
  let ctx: ControllerContext;

  const service = automock(AgentMcpService, { strict: false });
  const tokenService = automock(AgentRunnerToolTokenService, {
    args: [{} as never],
    strict: false,
  });

  const sessionId = factory.uuid();
  const userId = factory.uuid();
  const token = 'runner-mcp-token';
  const authorization = `Bearer ${token}`;
  const initializeRequest = {
    jsonrpc: '2.0',
    id: 'init-1',
    method: 'initialize',
    params: {
      protocolVersion: '2025-11-25',
      capabilities: {},
      clientInfo: { name: 'pi-agent-runner', version: '0.1.0' },
    },
  };
  const initializeResponse = {
    jsonrpc: '2.0',
    id: 'init-1',
    result: {
      protocolVersion: '2025-11-25',
      serverInfo: { name: 'gallery-agent-mcp', version: '2.7.5' },
      capabilities: {},
    },
  } satisfies AgentMcpHandleResponse;

  beforeAll(async () => {
    ctx = await controllerSetup(AgentRunnerMcpController, [
      AgentRunnerTokenGuard,
      { provide: AgentRunnerToolTokenService, useValue: tokenService },
      { provide: AgentMcpService, useValue: service },
    ]);
    return () => ctx.close();
  });

  beforeEach(() => {
    service.resetAllMocks();
    tokenService.resetAllMocks();
    ctx.reset();
    tokenService.verify.mockReturnValue({
      sessionId,
      userId,
      expiresAt: new Date('2026-05-16T12:00:00.000Z'),
    });
    service.handle.mockResolvedValue(initializeResponse);
  });

  it('verifies the bearer token and returns the MCP response without normal Gallery auth', async () => {
    const { status, body } = await request(ctx.getHttpServer())
      .post(`/agent/internal/mcp/sessions/${sessionId}`)
      .set('Authorization', authorization)
      .set('Accept', 'application/json, text/event-stream')
      .send(initializeRequest);

    expect(status).toBe(200);
    expect(tokenService.verify).toHaveBeenCalledWith(token);
    expect(service.handle).toHaveBeenCalledWith(
      expect.objectContaining({ user: { id: userId } }),
      sessionId,
      initializeRequest,
    );
    expect(ctx.authenticate).not.toHaveBeenCalled();
    expect(body).toEqual(initializeResponse);
  });

  it('allows repeated requests with the same valid session token', async () => {
    const secondRequest = { ...initializeRequest, id: 'init-2' };
    const secondResponse = {
      jsonrpc: '2.0',
      id: 'init-2',
      result: {
        protocolVersion: '2025-11-25',
        serverInfo: { name: 'gallery-agent-mcp', version: '2.7.5' },
        capabilities: {},
      },
    } satisfies AgentMcpHandleResponse;
    service.handle.mockResolvedValueOnce(initializeResponse).mockResolvedValueOnce(secondResponse);

    const first = await request(ctx.getHttpServer())
      .post(`/agent/internal/mcp/sessions/${sessionId}`)
      .set('Authorization', authorization)
      .send(initializeRequest);
    const second = await request(ctx.getHttpServer())
      .post(`/agent/internal/mcp/sessions/${sessionId}`)
      .set('Authorization', authorization)
      .send(secondRequest);

    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    expect(tokenService.verify).toHaveBeenCalledTimes(2);
    expect(service.handle).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({ user: { id: userId } }),
      sessionId,
      initializeRequest,
    );
    expect(service.handle).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ user: { id: userId } }),
      sessionId,
      secondRequest,
    );
    expect(ctx.authenticate).not.toHaveBeenCalled();
  });

  it('returns 202 with no body for MCP notifications', async () => {
    const notification = {
      jsonrpc: '2.0',
      method: 'notifications/initialized',
    };
    service.handle.mockResolvedValue(void 0);

    const { status, body, text } = await request(ctx.getHttpServer())
      .post(`/agent/internal/mcp/sessions/${sessionId}`)
      .set('Authorization', authorization)
      .send(notification);

    expect(status).toBe(202);
    expect(tokenService.verify).toHaveBeenCalledWith(token);
    expect(service.handle).toHaveBeenCalledWith(
      expect.objectContaining({ user: { id: userId } }),
      sessionId,
      notification,
    );
    expect(ctx.authenticate).not.toHaveBeenCalled();
    expect(body).toEqual({});
    expect(text).toBe('');
  });

  it('rejects a valid token for a different session without calling the MCP service', async () => {
    tokenService.verify.mockReturnValue({
      sessionId: factory.uuid(),
      userId,
      expiresAt: new Date('2026-05-16T12:00:00.000Z'),
    });

    const { status, body } = await request(ctx.getHttpServer())
      .post(`/agent/internal/mcp/sessions/${sessionId}`)
      .set('Authorization', authorization)
      .send(initializeRequest);

    expect(status).toBe(401);
    expect(body).toMatchObject({
      message: 'Invalid agent runner token',
    });
    expect(service.handle).not.toHaveBeenCalled();
  });

  it.each([undefined, '', 'Basic abc', 'Bearer ', 'Bearer token extra'])(
    'rejects missing or invalid bearer auth %s without verifying the token',
    async (header) => {
      const requestBuilder = request(ctx.getHttpServer())
        .post(`/agent/internal/mcp/sessions/${sessionId}`)
        .send(initializeRequest);
      if (header !== undefined) {
        requestBuilder.set('Authorization', header);
      }

      const { status } = await requestBuilder;

      expect(status).toBe(401);
      expect(tokenService.verify).not.toHaveBeenCalled();
      expect(service.handle).not.toHaveBeenCalled();
    },
  );

  it('returns 401 when token verification fails', async () => {
    tokenService.verify.mockImplementation(() => {
      throw new UnauthorizedException('Agent runner token expired');
    });

    const { status, body } = await request(ctx.getHttpServer())
      .post(`/agent/internal/mcp/sessions/${sessionId}`)
      .set('Authorization', authorization)
      .send(initializeRequest);

    expect(status).toBe(401);
    expect(body).toMatchObject({
      message: 'Agent runner token expired',
    });
    expect(service.handle).not.toHaveBeenCalled();
  });

  it('rejects syntactically invalid JSON before the MCP service runs', async () => {
    const { status } = await request(ctx.getHttpServer())
      .post(`/agent/internal/mcp/sessions/${sessionId}`)
      .set('Authorization', authorization)
      .set('Content-Type', 'application/json')
      .send('{"jsonrpc":');

    expect(status).toBe(400);
    expect(service.handle).not.toHaveBeenCalled();
  });

  describe('with the real MCP service', () => {
    let realCtx: ControllerContext;
    const realOperationPlanService = automock(AgentOperationPlanService, { strict: false });
    const realToolService = automock(AgentToolService, { strict: false });
    const realSessionRepository = automock(AgentSessionRepository, { strict: false });

    // Provide a full-access session so tools/list returns all 26 tools unchanged.
    const fullAccessSnapshot = AgentSessionService.permissionPresets[AgentPermissionPreset.LocalPowerUser];
    realSessionRepository.getById.mockResolvedValue({ permissionPlanSnapshot: fullAccessSnapshot } as never);

    beforeAll(async () => {
      realCtx = await controllerSetup(AgentRunnerMcpController, [
        AgentRunnerTokenGuard,
        { provide: AgentRunnerToolTokenService, useValue: tokenService },
        AgentMcpToolContractService,
        AgentMcpToolRegistryService,
        { provide: AgentToolService, useValue: realToolService },
        { provide: AgentOperationPlanService, useValue: realOperationPlanService },
        { provide: AgentSessionRepository, useValue: realSessionRepository },
        AgentMcpService,
      ]);
      return () => realCtx.close();
    });

    beforeEach(() => {
      tokenService.resetAllMocks();
      realToolService.resetAllMocks();
      realOperationPlanService.resetAllMocks();
      realCtx.reset();
      tokenService.verify.mockReturnValue({
        sessionId,
        userId,
        expiresAt: new Date('2026-05-16T12:00:00.000Z'),
      });
    });

    it('requires a valid runner token and returns tools/list from the real MCP service', async () => {
      const toolsListRequest = {
        jsonrpc: '2.0',
        id: 'tools-1',
        method: 'tools/list',
      };

      const { status, body } = await request(realCtx.getHttpServer())
        .post(`/agent/internal/mcp/sessions/${sessionId}`)
        .set('Authorization', authorization)
        .send(toolsListRequest);

      expect(status).toBe(200);
      expect(tokenService.verify).toHaveBeenCalledWith(token);
      expect(realCtx.authenticate).not.toHaveBeenCalled();
      expect(body).toMatchObject({
        jsonrpc: '2.0',
        id: 'tools-1',
        result: {
          tools: expect.any(Array),
        },
      });
      expect(body.result.tools.map((tool: { name: string }) => tool.name)).toEqual([
        AgentToolName.ResolveLocation,
        AgentToolName.SearchPeople,
        AgentToolName.ResolveAssetSearchFilters,
        AgentToolName.SearchAssets,
        AgentToolName.FindTripCandidates,
        AgentToolName.ReadSelectionMetadata,
        AgentToolName.CurateSelection,
        AgentToolName.ReadAssetMetadata,
        AgentToolName.ReadAssetPreviews,
        AgentToolName.ReadAssetOriginals,
        AgentToolName.ListAlbums,
        AgentToolName.ReadAlbum,
        AgentToolName.ListSpaces,
        AgentToolName.ReadSpace,
        AgentToolName.SearchUsers,
        AgentToolName.ListDuplicateGroups,
        AgentToolName.ProposeAlbumFromSearch,
        AgentToolName.ProposeAddAssetsToAlbumFromSearch,
        AgentToolName.ProposeSpaceFromSearch,
        AgentToolName.ProposeAddAssetsToSpaceFromSearch,
        AgentToolName.ProposeAssetBatchFromSearch,
        AgentToolName.ProposeAlbumFromSelection,
        AgentToolName.ProposeAssetBatchFromSelection,
        AgentToolName.ProposeAlbumOperations,
        AgentToolName.ReviseProposedOperations,
        AgentToolName.SummarizePlan,
      ]);
      const listSpaces = body.result.tools.find((tool: { name: string }) => tool.name === AgentToolName.ListSpaces);
      const readSpace = body.result.tools.find((tool: { name: string }) => tool.name === AgentToolName.ReadSpace);
      expect(listSpaces.inputSchema).toMatchObject({ type: 'object' });
      expect(readSpace.inputSchema).toMatchObject({ type: 'object' });
    });

    it('passes runner auth and session id through for read tools/call', async () => {
      const assetId = factory.uuid();
      const serviceResult = { status: 'success', toolCall: null, assets: [], nextPage: null };
      realToolService.searchAssets.mockResolvedValue(serviceResult as never);

      const { status, body } = await request(realCtx.getHttpServer())
        .post(`/agent/internal/mcp/sessions/${sessionId}`)
        .set('Authorization', authorization)
        .send({
          jsonrpc: '2.0',
          id: 'call-1',
          method: 'tools/call',
          params: {
            name: AgentToolName.SearchAssets,
            arguments: { filters: { tagIds: [assetId] }, limit: 10 },
          },
        });

      expect(status).toBe(200);
      expect(tokenService.verify).toHaveBeenCalledWith(token);
      expect(realCtx.authenticate).not.toHaveBeenCalled();
      expect(realToolService.searchAssets).toHaveBeenCalledWith(
        expect.objectContaining({ user: { id: userId } }),
        sessionId,
        {
          mode: 'metadata',
          filters: { tagIds: [assetId] },
          limit: 10,
          page: 1,
          order: 'desc',
          detail: 'handle',
          fields: [],
        },
      );
      expect(body).toEqual({
        jsonrpc: '2.0',
        id: 'call-1',
        result: {
          content: [{ type: 'text', text: 'Tool result returned.' }],
          structuredContent: serviceResult,
        },
      });
    });

    it('passes runner auth and session id through for planning tools/call', async () => {
      const serviceResult = {
        status: 'success',
        plan: { id: factory.uuid(), revision: 1, operations: [] },
        toolCall: null,
        summary: 'Plan revision 1 is ready for review.',
      };
      const body = {
        summary: 'Create Portugal highlights.',
        operations: [
          {
            type: AgentOperationType.AlbumCreate,
            summary: 'Create Portugal highlights.',
            targetKind: AgentOperationTargetKind.NewAlbum,
            temporaryTargetId: 'tmp-portugal',
            riskLevel: AgentOperationRiskLevel.Low,
            enabled: true,
            payload: { albumName: 'Portugal highlights', description: '' },
          },
        ],
      };
      realOperationPlanService.proposeAlbumOperations.mockResolvedValue(serviceResult as never);

      const { status, body: responseBody } = await request(realCtx.getHttpServer())
        .post(`/agent/internal/mcp/sessions/${sessionId}`)
        .set('Authorization', authorization)
        .send({
          jsonrpc: '2.0',
          id: 'planning-call-1',
          method: 'tools/call',
          params: {
            name: AgentToolName.ProposeAlbumOperations,
            arguments: body,
          },
        });

      expect(status).toBe(200);
      expect(tokenService.verify).toHaveBeenCalledWith(token);
      expect(realCtx.authenticate).not.toHaveBeenCalled();
      expect(realOperationPlanService.proposeAlbumOperations).toHaveBeenCalledWith(
        expect.objectContaining({ user: { id: userId } }),
        sessionId,
        body,
      );
      expect(responseBody).toEqual({
        jsonrpc: '2.0',
        id: 'planning-call-1',
        result: {
          content: [{ type: 'text', text: 'Plan revision 1 is ready for review.' }],
          structuredContent: serviceResult,
        },
      });
    });
  });
});
