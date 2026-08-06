// @nestjs/swagger 11.4+ no longer exports ./dist/constants; the metadata key is stable.
const DECORATORS = { API_RESPONSE: 'swagger/apiResponse' } as const;
import { AgentToolController } from 'src/controllers/agent-tool.controller';
import {
  AgentFindTripCandidatesToolRequestDto,
  AgentFindTripCandidatesToolResponseDto,
  AgentListAlbumsToolRequestDto,
  AgentListAlbumsToolResponseDto,
  AgentListSpacesToolRequestDto,
  AgentListSpacesToolResponseDto,
  AgentReadAlbumToolRequestDto,
  AgentReadAlbumToolResponseDto,
  AgentReadAssetMetadataToolRequestDto,
  AgentReadAssetMetadataToolResponseDto,
  AgentReadAssetOriginalsToolRequestDto,
  AgentReadAssetOriginalsToolResponseDto,
  AgentReadAssetPreviewsToolRequestDto,
  AgentReadAssetPreviewsToolResponseDto,
  AgentReadSpaceToolRequestDto,
  AgentReadSpaceToolResponseDto,
  AgentSearchAssetsToolRequestDto,
  AgentSearchAssetsToolResponseDto,
  AgentSearchUsersToolRequestDto,
  AgentSearchUsersToolResponseDto,
  AgentToolApprovalDto,
  AgentToolCallResponseDto,
} from 'src/dtos/agent-tool.dto';
import {
  AgentToolApprovalDecision,
  AgentToolCallStatus,
  AgentToolDataClass,
  AgentToolName,
  Permission,
} from 'src/enum';
import { AgentToolService } from 'src/services/agent-tool.service';
import request from 'supertest';
import { AuthFactory } from 'test/factories/auth.factory';
import { factory } from 'test/small.factory';
import { automock, ControllerContext, controllerSetup } from 'test/utils';

describe(AgentToolController.name, () => {
  let ctx: ControllerContext;
  const service = automock(AgentToolService, {
    args: [{} as never, {} as never, {} as never, {} as never],
    strict: false,
  });
  const auth = AuthFactory.create();
  const sessionId = factory.uuid();
  const toolCallId = factory.uuid();
  const assetId = factory.uuid();
  const startedAt = new Date('2026-05-14T12:00:00.000Z');
  const completedAt = new Date('2026-05-14T12:01:00.000Z');
  const metadataBody: AgentReadAssetMetadataToolRequestDto = {
    assetIds: [assetId],
  };
  const albumId = factory.uuid();
  const toolCall: AgentToolCallResponseDto = {
    id: toolCallId,
    sessionId,
    toolName: AgentToolName.ReadAssetMetadata,
    status: AgentToolCallStatus.PendingApproval,
    approvalDecision: null,
    requestSummary: 'Read metadata for 1 asset',
    responseSummary: null,
    dataClass: AgentToolDataClass.Metadata,
    assetCount: 1,
    albumCount: 0,
    startedAt,
    completedAt: null,
    error: null,
  };

  beforeAll(async () => {
    ctx = await controllerSetup(AgentToolController, [{ provide: AgentToolService, useValue: service }]);
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

  it('should use a unique operation method name for agent search assets', () => {
    expect(AgentToolController.prototype).not.toHaveProperty('searchAssets');
    expect(AgentToolController.prototype).toHaveProperty('executeAgentSearchAssets');
  });

  it.each([
    ['executeAgentSearchAssets', AgentSearchAssetsToolResponseDto, 'AgentSearchAssetsToolResponseDto'],
    ['findTripCandidates', AgentFindTripCandidatesToolResponseDto, 'AgentFindTripCandidatesToolResponseDto'],
    ['readAssetMetadata', AgentReadAssetMetadataToolResponseDto, 'AgentReadAssetMetadataToolResponseDto'],
    ['readAssetPreviews', AgentReadAssetPreviewsToolResponseDto, 'AgentReadAssetPreviewsToolResponseDto'],
    ['readAssetOriginals', AgentReadAssetOriginalsToolResponseDto, 'AgentReadAssetOriginalsToolResponseDto'],
    ['listAlbums', AgentListAlbumsToolResponseDto, 'AgentListAlbumsToolResponseDto'],
    ['readAlbum', AgentReadAlbumToolResponseDto, 'AgentReadAlbumToolResponseDto'],
    ['listSpaces', AgentListSpacesToolResponseDto, 'AgentListSpacesToolResponseDto'],
    ['readSpace', AgentReadSpaceToolResponseDto, 'AgentReadSpaceToolResponseDto'],
    ['searchAgentUsers', AgentSearchUsersToolResponseDto, 'AgentSearchUsersToolResponseDto'],
  ] as const)('documents %s with its typed tool response DTO', (methodName, responseDto, schemaName) => {
    const responses = Reflect.getMetadata(DECORATORS.API_RESPONSE, AgentToolController.prototype[methodName]) as
      | Record<number, { type?: unknown }>
      | undefined;

    expect(responses?.[201]?.type).toBe(responseDto);
    expect(responseDto.name).toBe(schemaName);
  });

  describe('POST /agent/sessions/:id/tools/read-asset-metadata', () => {
    it('should be an authenticated route with update permission', async () => {
      service.readAssetMetadata.mockResolvedValue({ status: 'approval-required', toolCall });

      await request(ctx.getHttpServer())
        .post(`/agent/sessions/${sessionId}/tools/read-asset-metadata`)
        .send(metadataBody);

      expect(ctx.authenticate).toHaveBeenCalled();
      expectPermission(Permission.AgentSessionUpdate);
    });

    it('should call the service and serialize tool call dates', async () => {
      service.readAssetMetadata.mockResolvedValue({ status: 'approval-required', toolCall });

      const { status, body: result } = await request(ctx.getHttpServer())
        .post(`/agent/sessions/${sessionId}/tools/read-asset-metadata`)
        .send(metadataBody);

      expect(status).toBe(201);
      expect(service.readAssetMetadata).toHaveBeenCalledWith(auth, sessionId, { ...metadataBody, detail: 'basic' });
      expect(result).toEqual({
        status: 'approval-required',
        toolCall: {
          ...toolCall,
          startedAt: startedAt.toISOString(),
          completedAt: null,
        },
      });
    });

    it('should validate body and require assetIds or toolCallId', async () => {
      const { status, body: result } = await request(ctx.getHttpServer())
        .post(`/agent/sessions/${sessionId}/tools/read-asset-metadata`)
        .send({});

      expect(status).toBe(400);
      expect(result).toEqual(
        factory.responses.validationError([
          { path: expect.any(Array) as never, message: expect.stringContaining('Provide assetIds') as string },
        ]),
      );
    });
  });

  describe.each([
    {
      path: 'search-assets',
      serviceMethod: 'searchAssets' as const,
      body: { filters: { takenAfter: '2026-05-13T00:00:00.000Z' }, limit: 5 },
      expectedDto: {
        mode: 'metadata',
        filters: { takenAfter: new Date('2026-05-13T00:00:00.000Z') },
        limit: 5,
        page: 1,
        order: 'desc',
        detail: 'handle',
        fields: [],
      } satisfies AgentSearchAssetsToolRequestDto,
      invalidBody: { limit: 0 },
    },
    {
      path: 'find-trip-candidates',
      serviceMethod: 'findTripCandidates' as const,
      body: { placeHint: 'USA', maxCandidates: 2 },
      expectedDto: {
        placeHint: 'USA',
        lookbackDays: 180,
        maxCandidates: 2,
      } satisfies AgentFindTripCandidatesToolRequestDto,
      invalidBody: { maxCandidates: 0 },
    },
    {
      path: 'read-asset-previews',
      serviceMethod: 'readAssetPreviews' as const,
      body: { assetIds: [assetId] },
      expectedDto: { assetIds: [assetId] } satisfies AgentReadAssetPreviewsToolRequestDto,
      invalidBody: {},
    },
    {
      path: 'read-asset-originals',
      serviceMethod: 'readAssetOriginals' as const,
      body: { assetIds: [assetId] },
      expectedDto: { assetIds: [assetId] } satisfies AgentReadAssetOriginalsToolRequestDto,
      invalidBody: {},
    },
    {
      path: 'list-albums',
      serviceMethod: 'listAlbums' as const,
      body: {},
      expectedDto: {} satisfies AgentListAlbumsToolRequestDto,
      invalidBody: { unexpected: true },
    },
    {
      path: 'read-album',
      serviceMethod: 'readAlbum' as const,
      body: { albumId },
      expectedDto: { albumId } satisfies AgentReadAlbumToolRequestDto,
      invalidBody: {},
    },
    {
      path: 'list-spaces',
      serviceMethod: 'listSpaces' as const,
      body: {},
      expectedDto: {} satisfies AgentListSpacesToolRequestDto,
      invalidBody: { spaceId: factory.uuid() },
    },
    {
      path: 'read-space',
      serviceMethod: 'readSpace' as const,
      body: { spaceId: albumId },
      expectedDto: { spaceId: albumId } satisfies AgentReadSpaceToolRequestDto,
      invalidBody: {},
    },
    {
      path: 'search-users',
      serviceMethod: 'searchUsers' as const,
      body: { query: 'sam', limit: 5 },
      expectedDto: { query: 'sam', limit: 5 } satisfies AgentSearchUsersToolRequestDto,
      invalidBody: { limit: 0 },
    },
  ])('POST /agent/sessions/:id/tools/$path', ({ path, serviceMethod, body, expectedDto, invalidBody }) => {
    it('should be an authenticated route with update permission', async () => {
      service[serviceMethod].mockResolvedValue({ status: 'approval-required', toolCall } as never);

      await request(ctx.getHttpServer()).post(`/agent/sessions/${sessionId}/tools/${path}`).send(body);

      expect(ctx.authenticate).toHaveBeenCalled();
      expectPermission(Permission.AgentSessionUpdate);
    });

    it('should call the service and serialize tool call dates', async () => {
      service[serviceMethod].mockResolvedValue({ status: 'approval-required', toolCall } as never);

      const { status, body: result } = await request(ctx.getHttpServer())
        .post(`/agent/sessions/${sessionId}/tools/${path}`)
        .send(body);

      expect(status).toBe(201);
      expect(service[serviceMethod]).toHaveBeenCalledWith(auth, sessionId, expectedDto);
      expect(result).toEqual({
        status: 'approval-required',
        toolCall: {
          ...toolCall,
          startedAt: startedAt.toISOString(),
          completedAt: null,
        },
      });
    });

    it('should validate body DTOs before calling the service', async () => {
      const { status } = await request(ctx.getHttpServer())
        .post(`/agent/sessions/${sessionId}/tools/${path}`)
        .send(invalidBody);

      expect(status).toBe(400);
      expect(service[serviceMethod]).not.toHaveBeenCalled();
    });
  });

  describe('GET /agent/sessions/:id/tool-calls', () => {
    it('should be an authenticated route with read permission', async () => {
      service.getToolCalls.mockResolvedValue([]);

      await request(ctx.getHttpServer()).get(`/agent/sessions/${sessionId}/tool-calls`);

      expect(ctx.authenticate).toHaveBeenCalled();
      expectPermission(Permission.AgentSessionRead);
    });

    it('should call getToolCalls with auth and session id', async () => {
      service.getToolCalls.mockResolvedValue([{ ...toolCall, completedAt }]);

      const { status, body: result } = await request(ctx.getHttpServer()).get(
        `/agent/sessions/${sessionId}/tool-calls`,
      );

      expect(status).toBe(200);
      expect(service.getToolCalls).toHaveBeenCalledWith(auth, sessionId);
      expect(result).toEqual([
        {
          ...toolCall,
          startedAt: startedAt.toISOString(),
          completedAt: completedAt.toISOString(),
        },
      ]);
    });
  });

  describe('POST /agent/sessions/:id/tool-calls/:toolCallId/approval', () => {
    it('should be an authenticated route with update permission', async () => {
      service.approveToolCall.mockResolvedValue({
        ...toolCall,
        status: AgentToolCallStatus.Approved,
        approvalDecision: AgentToolApprovalDecision.Approved,
      });

      await request(ctx.getHttpServer())
        .post(`/agent/sessions/${sessionId}/tool-calls/${toolCallId}/approval`)
        .send({ decision: AgentToolApprovalDecision.Approved });

      expect(ctx.authenticate).toHaveBeenCalled();
      expectPermission(Permission.AgentSessionUpdate);
    });

    it('should call approveToolCall with an approved decision', async () => {
      const body: AgentToolApprovalDto = { decision: AgentToolApprovalDecision.Approved };
      service.approveToolCall.mockResolvedValue({
        ...toolCall,
        status: AgentToolCallStatus.Approved,
        approvalDecision: AgentToolApprovalDecision.Approved,
      });

      const { status } = await request(ctx.getHttpServer())
        .post(`/agent/sessions/${sessionId}/tool-calls/${toolCallId}/approval`)
        .send(body);

      expect(status).toBe(201);
      expect(service.approveToolCall).toHaveBeenCalledWith(auth, sessionId, toolCallId, body);
    });

    it('should pass through denied decisions with a reason', async () => {
      const reason = 'Too broad.';
      const body: AgentToolApprovalDto = { decision: AgentToolApprovalDecision.Denied, reason };
      service.approveToolCall.mockResolvedValue({
        ...toolCall,
        status: AgentToolCallStatus.Denied,
        approvalDecision: AgentToolApprovalDecision.Denied,
        error: reason,
        completedAt,
      });

      const { status } = await request(ctx.getHttpServer())
        .post(`/agent/sessions/${sessionId}/tool-calls/${toolCallId}/approval`)
        .send(body);

      expect(status).toBe(201);
      expect(service.approveToolCall).toHaveBeenCalledWith(auth, sessionId, toolCallId, body);
    });
  });
});
