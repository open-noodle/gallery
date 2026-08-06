import { BadRequestException } from '@nestjs/common';
import { serverVersion } from 'src/constants';
import type { AuthDto } from 'src/dtos/auth.dto';
import {
  AgentOperationPlanStatus,
  AgentOperationRiskLevel,
  AgentOperationStatus,
  AgentOperationTargetKind,
  AgentOperationType,
  AgentPermissionPreset,
  AgentToolName,
} from 'src/enum';
import { AgentSessionRepository } from 'src/repositories/agent-session.repository';
import { AgentMcpDocsService } from 'src/services/agent-mcp-docs.service';
import { AgentMcpRecoverableToolError } from 'src/services/agent-mcp-recoverable-tool-error';
import { AgentMcpToolContractService } from 'src/services/agent-mcp-tool-contract.service';
import { AgentMcpToolRegistryService } from 'src/services/agent-mcp-tool-registry.service';
import { CATALOG_TOKENS_BASELINE, estimateCatalogTokens } from 'src/services/agent-mcp-tool-registry.test-helpers';
import { AgentMcpService } from 'src/services/agent-mcp.service';
import { AgentOperationPlanService } from 'src/services/agent-operation-plan.service';
import { AgentSessionService } from 'src/services/agent-session.service';
import { AgentToolService } from 'src/services/agent-tool.service';
import type { AgentMcpReadToolName } from 'src/types/agent-mcp-contract.types';
import type { AgentMcpErrorResponse, AgentMcpSuccessResponse, AgentMcpToolCallResult } from 'src/types/agent-mcp.types';
import { factory } from 'test/small.factory';
import { automock, type AutoMocked } from 'test/utils';

const MCP_TOOL_TEXT_MAX_CHARS = 500;

const makeAlbumCreateOperation = () => ({
  type: AgentOperationType.AlbumCreate,
  summary: 'Create Portugal highlights.',
  targetKind: AgentOperationTargetKind.NewAlbum,
  temporaryTargetId: 'tmp-portugal',
  payload: { albumName: 'Portugal highlights' },
});

const makeParsedAlbumCreateOperation = () => ({
  ...makeAlbumCreateOperation(),
  riskLevel: AgentOperationRiskLevel.Low,
  enabled: true,
  payload: { albumName: 'Portugal highlights', description: '' },
});

const makePlanningRequest = () => ({
  summary: 'Create a Portugal highlights album.',
  operations: [makeAlbumCreateOperation()],
});

const makeParsedPlanningRequest = () => ({
  summary: 'Create a Portugal highlights album.',
  operations: [makeParsedAlbumCreateOperation()],
});

const noTripCandidateRecommendation = {
  action: 'none' as const,
  reason: 'No readable trip candidates matched the request.',
};

const makePlanningServiceResult = (planId = factory.uuid()) => ({
  status: 'success',
  plan: {
    id: planId,
    revision: 1,
    operations: [],
  },
  toolCall: null,
  summary: 'Plan revision 1 is ready for review.',
});

const makeToolsListRequest = (id: string) => ({
  jsonrpc: '2.0',
  id,
  method: 'tools/list',
});

const makeToolCallRequest = (toolName: AgentToolName, args: unknown) => ({
  jsonrpc: '2.0',
  id: `${toolName}-call`,
  method: 'tools/call',
  params: {
    name: toolName,
    arguments: args,
  },
});

const expectToolResult = (
  response: AgentMcpSuccessResponse,
  requestId: AgentMcpSuccessResponse['id'],
  structuredContent: unknown,
  expectedText = expectedToolResultText(structuredContent),
) => {
  expect(response).toMatchObject({
    jsonrpc: '2.0',
    id: requestId,
  });
  const result = response.result as AgentMcpToolCallResult;
  expect(result.structuredContent).toBe(structuredContent);
  expect(result.content).toEqual([{ type: 'text', text: expectedText }]);
  expect(result.content[0].text.length).toBeLessThanOrEqual(MCP_TOOL_TEXT_MAX_CHARS);
  if (structuredContent && typeof structuredContent === 'object') {
    expect(result.content[0].text).not.toBe(JSON.stringify(structuredContent));
  }
};

const expectedToolResultText = (structuredContent: unknown): string => {
  if (!structuredContent || typeof structuredContent !== 'object' || Array.isArray(structuredContent)) {
    return 'Tool result returned.';
  }

  const content = structuredContent as Record<string, unknown>;
  if (typeof content.summary === 'string' && content.summary.trim().length > 0) {
    return content.summary;
  }

  if (content.status === 'approval-required') {
    const toolCall = content.toolCall;
    if (toolCall && typeof toolCall === 'object' && !Array.isArray(toolCall)) {
      const requestSummary = (toolCall as Record<string, unknown>).requestSummary;
      if (typeof requestSummary === 'string' && requestSummary.trim().length > 0) {
        return `Approval required: ${requestSummary}`;
      }
    }

    return 'Approval required.';
  }

  if (content.status === 'denied') {
    return typeof content.reason === 'string' && content.reason.trim().length > 0
      ? `Tool call denied: ${content.reason}`
      : 'Tool call denied.';
  }

  if (content.status === 'error') {
    const error = typeof content.error === 'string' && content.error.trim().length > 0 ? content.error : 'Tool error';
    const issues = content.issues;
    const firstIssue = Array.isArray(issues) ? issues[0] : undefined;
    if (firstIssue && typeof firstIssue === 'object' && !Array.isArray(firstIssue)) {
      const issue = firstIssue as Record<string, unknown>;
      const path = typeof issue.path === 'string' ? issue.path : '';
      const message = typeof issue.message === 'string' ? issue.message : '';
      const suffix = [path, message].filter((value) => value.trim().length > 0).join(': ');
      return suffix ? `${error}: ${suffix}` : error;
    }

    return error;
  }

  return 'Tool result returned.';
};

const expectEnrichedToolValidationError = (
  response: AgentMcpSuccessResponse,
  expected: {
    toolName: AgentToolName;
    path: string;
    hintIncludes?: string;
    expectedIncludes?: string;
    exampleArguments?: Record<string, unknown>;
  },
) => {
  const result = response.result as AgentMcpToolCallResult;
  const structuredContent = result.structuredContent as Record<string, unknown>;

  expect(result.isError).toBe(true);
  expect(structuredContent).toMatchObject({
    status: 'error',
    error: 'Invalid tool arguments',
    toolName: expected.toolName,
    retryable: true,
    issues: expect.arrayContaining([expect.objectContaining({ path: expected.path })]),
  });

  if (expected.hintIncludes) {
    expect(structuredContent.hint).toEqual(expect.stringContaining(expected.hintIncludes));
    expect(structuredContent.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          path: expected.path,
          hint: expect.stringContaining(expected.hintIncludes),
        }),
      ]),
    );
  }

  if (expected.expectedIncludes) {
    expect(structuredContent.expected).toEqual(expect.stringContaining(expected.expectedIncludes));
  }

  if (expected.exampleArguments) {
    expect(structuredContent.exampleArguments).toEqual(expected.exampleArguments);
  }

  expect(result.content[0].type).toBe('text');
  expect(result.content[0].text).toEqual(expect.stringContaining('Invalid tool arguments'));
  expect(result.content[0].text.length).toBeLessThanOrEqual(MCP_TOOL_TEXT_MAX_CHARS);
  expect(result.content[0].text).not.toBe(JSON.stringify(result.structuredContent));
};

const expectNoMcpDownstreamServicesCalled = (
  toolService: AutoMocked<AgentToolService>,
  operationPlanService: AutoMocked<AgentOperationPlanService>,
) => {
  expect(toolService.resolveAssetSearchFilters).not.toHaveBeenCalled();
  expect(toolService.searchAssets).not.toHaveBeenCalled();
  expect(toolService.findTripCandidates).not.toHaveBeenCalled();
  expect(toolService.readSelectionMetadata).not.toHaveBeenCalled();
  expect(toolService.readAssetMetadata).not.toHaveBeenCalled();
  expect(toolService.readAssetPreviews).not.toHaveBeenCalled();
  expect(toolService.readAssetOriginals).not.toHaveBeenCalled();
  expect(toolService.listAlbums).not.toHaveBeenCalled();
  expect(toolService.readAlbum).not.toHaveBeenCalled();
  expect(toolService.listSpaces).not.toHaveBeenCalled();
  expect(toolService.readSpace).not.toHaveBeenCalled();
  expect(operationPlanService.proposeAlbumOperations).not.toHaveBeenCalled();
  expect(operationPlanService.reviseProposedOperations).not.toHaveBeenCalled();
  expect(operationPlanService.summarizePlan).not.toHaveBeenCalled();
};

const secretLeakPattern =
  /bearer\s+[a-z0-9._-]{10,}|provider[- ]?key|stack trace|\/(?:srv|home|tmp|var|etc|opt|mnt|Users)\/|\/agent\/internal\/mcp|sk-[a-z0-9_-]+/i;

const getRuntimeFailureMatrixCases = () => new AgentMcpToolContractService().listRuntimeFailureMatrixCases();

const providerBoundaryAdjustedPlanningRequest = <T extends { id: string; request: unknown }>(
  failureCase: T,
): unknown => {
  if (failureCase.id === 'planning-duplicate-asset-ids') {
    return failureCase.request;
  }

  const request = JSON.parse(JSON.stringify(failureCase.request)) as Record<string, any>;
  const args = request.params?.arguments;
  const operations = args && typeof args === 'object' && Array.isArray(args.operations) ? args.operations : [];
  for (const operation of operations) {
    if (operation && typeof operation === 'object' && Array.isArray(operation.assetIds)) {
      delete operation.assetIds;
      operation.assetSelectionHandleId = '00000000-0000-4000-8000-000000000901';
    }
  }

  return request;
};

const providerBoundaryAdjustedPlanningIssuePath = (failureCase: {
  id: string;
  expectedResult: { kind: string; expectedIssuePath?: string };
}): string => {
  if (failureCase.id === 'planning-duplicate-asset-ids') {
    return 'operations.0.assetIds';
  }

  return failureCase.expectedResult.expectedIssuePath ?? '';
};

describe(AgentMcpService.name, () => {
  let registry: AgentMcpToolRegistryService;
  let contractService: AgentMcpToolContractService;
  let toolService: AutoMocked<AgentToolService>;
  let operationPlanService: AutoMocked<AgentOperationPlanService>;
  let sessionRepository: AutoMocked<AgentSessionRepository>;
  let sut: AgentMcpService;

  const sessionId = factory.uuid();
  const userId = factory.uuid();
  const auth = { user: { id: userId } } as AuthDto;

  // Full-access session returned by default — existing tools/list tests stay green.
  const fullAccessSnapshot = AgentSessionService.permissionPresets[AgentPermissionPreset.LocalPowerUser];
  const makeSession = (snapshot = fullAccessSnapshot) => ({ permissionPlanSnapshot: snapshot });

  beforeEach(() => {
    contractService = new AgentMcpToolContractService();
    registry = new AgentMcpToolRegistryService(contractService);
    toolService = automock(AgentToolService, { strict: false });
    operationPlanService = automock(AgentOperationPlanService, { strict: false });
    sessionRepository = automock(AgentSessionRepository, { strict: false });
    sessionRepository.getById.mockResolvedValue(makeSession() as never);
    sut = new AgentMcpService(registry, contractService, toolService, operationPlanService, sessionRepository);
  });

  it('returns the MCP initialize result and advertises tools once tools/list exists', async () => {
    await expect(
      sut.handle(auth, sessionId, {
        jsonrpc: '2.0',
        id: 'init-1',
        method: 'initialize',
        params: {
          protocolVersion: '2025-11-25',
          capabilities: {},
          clientInfo: { name: 'pi-agent-runner', version: '0.1.0' },
        },
      }),
    ).resolves.toEqual({
      jsonrpc: '2.0',
      id: 'init-1',
      result: {
        protocolVersion: '2025-11-25',
        serverInfo: {
          name: 'gallery-agent-mcp',
          version: serverVersion.toString(),
        },
        capabilities: {
          tools: {},
        },
      },
    });
  });

  it('preserves numeric JSON-RPC request ids for initialize', async () => {
    await expect(
      sut.handle(auth, sessionId, {
        jsonrpc: '2.0',
        id: 1,
        method: 'initialize',
      }),
    ).resolves.toEqual({
      jsonrpc: '2.0',
      id: 1,
      result: {
        protocolVersion: '2025-11-25',
        serverInfo: {
          name: 'gallery-agent-mcp',
          version: serverVersion.toString(),
        },
        capabilities: {
          tools: {},
        },
      },
    });
  });

  it('returns no response for the initialized notification', async () => {
    await expect(
      sut.handle(auth, sessionId, {
        jsonrpc: '2.0',
        method: 'notifications/initialized',
      }),
    ).resolves.toBeUndefined();
  });

  it.each([
    ['null body', null],
    ['primitive body', 'not-an-object'],
    ['missing jsonrpc', { id: '1', method: 'initialize' }],
    ['wrong jsonrpc version', { jsonrpc: '1.0', id: '1', method: 'initialize' }],
    ['missing id', { jsonrpc: '2.0', method: 'initialize' }],
    ['null id', { jsonrpc: '2.0', id: null, method: 'initialize' }],
    ['object id', { jsonrpc: '2.0', id: { nested: true }, method: 'initialize' }],
    ['missing method', { jsonrpc: '2.0', id: '1' }],
    ['non-string method', { jsonrpc: '2.0', id: '1', method: 123 }],
  ] as const)('returns invalid request for %s', async (_name, body) => {
    await expect(sut.handle(auth, sessionId, body)).resolves.toEqual({
      jsonrpc: '2.0',
      id: null,
      error: {
        code: -32_600,
        message: 'Invalid Request',
      },
    });
  });

  it('explicitly rejects batch requests in the first slice', async () => {
    await expect(
      sut.handle(auth, sessionId, [
        {
          jsonrpc: '2.0',
          id: 'init-1',
          method: 'initialize',
        },
      ]),
    ).resolves.toEqual({
      jsonrpc: '2.0',
      id: null,
      error: {
        code: -32_600,
        message: 'Batch requests are not supported',
      },
    });
  });

  it('returns the registered Gallery MCP tools for tools/list', async () => {
    const response = await sut.handle(auth, sessionId, {
      jsonrpc: '2.0',
      id: 'tools-1',
      method: 'tools/list',
    });

    expect(response).toEqual({
      jsonrpc: '2.0',
      id: 'tools-1',
      result: {
        tools: registry.listTools(),
      },
    });
  });

  it('preserves numeric JSON-RPC request ids for tools/list', async () => {
    await expect(
      sut.handle(auth, sessionId, {
        jsonrpc: '2.0',
        id: 9,
        method: 'tools/list',
      }),
    ).resolves.toEqual({
      jsonrpc: '2.0',
      id: 9,
      result: {
        tools: registry.listTools(),
      },
    });
  });

  it('returns enriched read tool metadata through tools/list', async () => {
    const response = (await sut.handle(auth, sessionId, {
      jsonrpc: '2.0',
      id: 'tools-enriched-read-metadata',
      method: 'tools/list',
    })) as AgentMcpSuccessResponse;
    const result = response.result as {
      tools: Array<{ name: AgentToolName; description: string; inputSchema: Record<string, unknown> }>;
    };
    const previews = result.tools.find((tool) => tool.name === AgentToolName.ReadAssetPreviews);

    expect(previews?.description).toContain('Use assetIds for a new request');
    expect(previews?.inputSchema.examples).toEqual([
      { assetIds: ['00000000-0000-4000-8000-000000000001'] },
      { toolCallId: '00000000-0000-4000-8000-000000000111' },
    ]);
    expect(previews?.inputSchema['x-gallery-argumentModes']).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: 'asset-ids', requiredFields: ['assetIds'], forbiddenFields: ['toolCallId'] }),
        expect.objectContaining({ name: 'approved-retry', requiredFields: ['toolCallId'] }),
      ]),
    );
    expect(previews?.inputSchema).toMatchObject({ type: 'object' });
    expect(previews?.inputSchema).not.toHaveProperty('oneOf');
  });

  it('returns enriched planning tool metadata through tools/list', async () => {
    const response = (await sut.handle(auth, sessionId, {
      jsonrpc: '2.0',
      id: 'tools-enriched-planning-metadata',
      method: 'tools/list',
    })) as AgentMcpSuccessResponse;
    const result = response.result as {
      tools: Array<{ name: AgentToolName; description: string; inputSchema: Record<string, unknown> }>;
    };
    const proposal = result.tools.find((tool) => tool.name === AgentToolName.ProposeAlbumOperations);

    expect(proposal?.description).toContain('reviewable Gallery operation plan');
    expect(proposal?.inputSchema.examples).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          summary: 'Create today test and add selected photos.',
          operations: expect.any(Array),
        }),
      ]),
    );
    expect(proposal?.inputSchema['x-gallery-argumentModes']).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: 'operation-plan', requiredFields: ['summary', 'operations'] }),
      ]),
    );
  });

  describe('generated docs JSON-RPC examples', () => {
    let docsService: AgentMcpDocsService;

    beforeEach(() => {
      docsService = new AgentMcpDocsService(contractService);
    });

    it.each(['initialize', 'tools-list'] as const)('handles the documented %s JSON-RPC example', async (name) => {
      const example = docsService.listJsonRpcExamples().find((candidate) => candidate.name === name)!;
      const response = await sut.handle(auth, sessionId, example.request);

      expect(response).toMatchObject({
        jsonrpc: '2.0',
        id: example.request.id,
      });
    });

    it('handles the documented read tools/call JSON-RPC example without wrapper errors', async () => {
      const serviceResult = { status: 'success', toolCall: null, assets: [] };
      toolService.readAssetMetadata.mockResolvedValue(serviceResult as never);
      const example = docsService.listJsonRpcExamples().find((candidate) => candidate.name === 'tools-call-read')!;

      const response = (await sut.handle(auth, sessionId, example.request)) as AgentMcpSuccessResponse;

      expect(toolService.readAssetMetadata).toHaveBeenCalledWith(auth, sessionId, {
        assetIds: ['00000000-0000-4000-8000-000000000001'],
        detail: 'basic',
      });
      expectToolResult(response, 'read-1', serviceResult);
    });

    it('handles the documented planning tools/call JSON-RPC example without wrapper errors', async () => {
      const serviceResult = makePlanningServiceResult();
      operationPlanService.proposeAlbumOperations.mockResolvedValue(serviceResult as never);
      const example = docsService.listJsonRpcExamples().find((candidate) => candidate.name === 'tools-call-plan')!;

      const response = (await sut.handle(auth, sessionId, example.request)) as AgentMcpSuccessResponse;

      expect(operationPlanService.proposeAlbumOperations).toHaveBeenCalledWith(
        auth,
        sessionId,
        expect.objectContaining({
          summary: 'Create today test and add selected photos.',
          operations: expect.any(Array),
        }),
      );
      expectToolResult(response, 'plan-1', serviceResult);
    });
  });

  it.each([
    {
      toolName: AgentToolName.ResolveAssetSearchFilters,
      args: { tags: ['Travel'], albums: ['Berlin'] },
      serviceMethod: 'resolveAssetSearchFilters' as const,
      serviceResult: { status: 'success', toolCall: null, resolvedFilters: {}, results: [] },
    },
    {
      toolName: AgentToolName.SearchAssets,
      args: { filters: { isFavorite: true }, limit: 5 },
      expectedArgs: {
        mode: 'metadata',
        filters: { isFavorite: true },
        limit: 5,
        page: 1,
        order: 'desc',
        detail: 'handle',
        fields: [],
      },
      serviceMethod: 'searchAssets' as const,
      serviceResult: { status: 'success', toolCall: null, assets: [], nextPage: null },
    },
    {
      toolName: AgentToolName.FindTripCandidates,
      args: { placeHint: 'USA', maxCandidates: 2 },
      expectedArgs: { placeHint: 'USA', lookbackDays: 180, maxCandidates: 2 },
      serviceMethod: 'findTripCandidates' as const,
      serviceResult: {
        status: 'success',
        toolCall: null,
        summary: 'No trip candidates found matching "USA".',
        recommendation: noTripCandidateRecommendation,
        candidates: [],
      },
    },
    {
      toolName: AgentToolName.ReadSelectionMetadata,
      args: { selectionHandleId: factory.uuid(), fields: ['dates'], sampleSize: 2 },
      serviceMethod: 'readSelectionMetadata' as const,
      serviceResult: {
        status: 'success',
        toolCall: null,
        summary: 'Read selection metadata for 3 assets with 2 samples',
      },
    },
    {
      toolName: AgentToolName.CurateSelection,
      args: { selectionHandleId: factory.uuid(), targetCount: 2, strategy: 'metadata-highlights' },
      expectedArgs: {
        selectionHandleId: expect.any(String),
        targetCount: 2,
        strategy: 'metadata-highlights',
        constraints: {},
        sampleSize: 10,
      },
      serviceMethod: 'curateSelection' as const,
      serviceResult: {
        status: 'success',
        toolCall: null,
        summary: 'Curated 2 metadata-only highlights from 4 source assets.',
      },
    },
    {
      toolName: AgentToolName.ReadAssetMetadata,
      args: { assetIds: [factory.uuid()] },
      expectedArgs: { assetIds: [expect.any(String)], detail: 'basic' },
      serviceMethod: 'readAssetMetadata' as const,
      serviceResult: { status: 'success', toolCall: null, assets: [] },
    },
    {
      toolName: AgentToolName.ReadAssetPreviews,
      args: { assetIds: [factory.uuid()] },
      serviceMethod: 'readAssetPreviews' as const,
      serviceResult: { status: 'success', toolCall: null, previews: [] },
    },
    {
      toolName: AgentToolName.ReadAssetOriginals,
      args: { assetIds: [factory.uuid()] },
      serviceMethod: 'readAssetOriginals' as const,
      serviceResult: { status: 'success', toolCall: null, originals: [] },
    },
    {
      toolName: AgentToolName.ListAlbums,
      args: {},
      serviceMethod: 'listAlbums' as const,
      serviceResult: { status: 'success', toolCall: null, albums: [] },
    },
    {
      toolName: AgentToolName.ReadAlbum,
      args: { albumId: factory.uuid() },
      serviceMethod: 'readAlbum' as const,
      serviceResult: { status: 'success', toolCall: null, album: { id: factory.uuid(), assetIds: [] } },
    },
    {
      toolName: AgentToolName.ListSpaces,
      args: {},
      serviceMethod: 'listSpaces' as const,
      serviceResult: { status: 'success', toolCall: null, spaces: [] },
    },
    {
      toolName: AgentToolName.ReadSpace,
      args: { spaceId: factory.uuid() },
      serviceMethod: 'readSpace' as const,
      serviceResult: { status: 'success', toolCall: null, space: { id: factory.uuid(), assetIds: [] } },
    },
  ])(
    'delegates $toolName to AgentToolService and wraps the result',
    async ({ toolName, args, expectedArgs, serviceMethod, serviceResult }) => {
      toolService[serviceMethod].mockResolvedValue(serviceResult as never);

      const response = (await sut.handle(
        auth,
        sessionId,
        makeToolCallRequest(toolName, args),
      )) as AgentMcpSuccessResponse;

      expect(toolService[serviceMethod]).toHaveBeenCalledTimes(1);
      expect(toolService[serviceMethod]).toHaveBeenCalledWith(auth, sessionId, expectedArgs ?? args);
      expectToolResult(response, `${toolName}-call`, serviceResult);
    },
  );

  it('delegates DTO-transformed search defaults instead of raw search arguments', async () => {
    const serviceResult = { status: 'success', toolCall: null, assets: [], nextPage: null };
    toolService.searchAssets.mockResolvedValue(serviceResult as never);

    const response = (await sut.handle(
      auth,
      sessionId,
      makeToolCallRequest(AgentToolName.SearchAssets, {}),
    )) as AgentMcpSuccessResponse;

    expect(toolService.searchAssets).toHaveBeenCalledWith(auth, sessionId, {
      mode: 'metadata',
      filters: {},
      limit: 100,
      page: 1,
      order: 'desc',
      detail: 'handle',
      fields: [],
    });
    expectToolResult(response, `${AgentToolName.SearchAssets}-call`, serviceResult);
  });

  it('delegates readSelectionMetadata and keeps MCP text compact', async () => {
    const selectionHandleId = factory.uuid();
    const serviceResult = {
      status: 'success',
      toolCall: null,
      summary: 'Read selection metadata for 3 assets with 2 samples',
      selectionHandle: {
        id: selectionHandleId,
        sourceRef: `asset-source:search:${selectionHandleId}`,
        assetCount: 3,
        sourceToolCallId: null,
        expiresAt: new Date('2026-05-27T12:00:00.000Z'),
      },
      fields: ['dates'],
      counts: { assets: 3, sampled: 2 },
      sample: { sampleSize: 2, items: [{ itemRef: 'item:001' }, { itemRef: 'item:002' }] },
      resultSize: {
        returnedItems: 2,
        hasMore: false,
        nextPage: null,
        estimatedBytes: 512,
        truncated: false,
        omittedFields: [],
      },
    };
    toolService.readSelectionMetadata.mockResolvedValue(serviceResult as never);

    const response = (await sut.handle(
      auth,
      sessionId,
      makeToolCallRequest(AgentToolName.ReadSelectionMetadata, { selectionHandleId, fields: ['dates'], sampleSize: 2 }),
    )) as AgentMcpSuccessResponse;

    expect(toolService.readSelectionMetadata).toHaveBeenCalledWith(auth, sessionId, {
      selectionHandleId,
      fields: ['dates'],
      sampleSize: 2,
    });
    expectToolResult(response, `${AgentToolName.ReadSelectionMetadata}-call`, serviceResult, serviceResult.summary);
  });

  it('delegates curateSelection and keeps MCP text compact', async () => {
    const selectionHandleId = factory.uuid();
    const serviceResult = {
      status: 'success',
      toolCall: null,
      summary: 'Curated 2 metadata-only highlights from 4 source assets.',
      strategy: 'metadata-highlights',
      selectionHandle: {
        id: factory.uuid(),
        sourceRef: `asset-source:search:${factory.uuid()}`,
        assetCount: 2,
        sourceToolCallId: null,
        expiresAt: new Date('2026-05-27T12:00:00.000Z'),
      },
      sourceAssetCount: 4,
      selectedAssetCount: 2,
      criteriaSummary: ['Metadata-only curation used favorites and ratings.'],
      resultSize: {
        returnedItems: 2,
        hasMore: false,
        nextPage: null,
        estimatedBytes: 512,
        truncated: false,
        omittedFields: [],
      },
    };
    toolService.curateSelection.mockResolvedValue(serviceResult as never);

    const response = (await sut.handle(
      auth,
      sessionId,
      makeToolCallRequest(AgentToolName.CurateSelection, {
        selectionHandleId,
        targetCount: 2,
        strategy: 'metadata-highlights',
      }),
    )) as AgentMcpSuccessResponse;

    expect(toolService.curateSelection).toHaveBeenCalledWith(auth, sessionId, {
      selectionHandleId,
      targetCount: 2,
      strategy: 'metadata-highlights',
      constraints: {},
      sampleSize: 10,
    });
    expectToolResult(response, `${AgentToolName.CurateSelection}-call`, serviceResult, serviceResult.summary);
  });

  it('uses result summary as compact MCP text while preserving structured content', async () => {
    const serviceResult = {
      status: 'success',
      toolCall: null,
      summary: 'Returned 2 albums.',
      albums: [
        { id: factory.uuid(), name: 'Portugal' },
        { id: factory.uuid(), name: 'Berlin' },
      ],
    };
    toolService.listAlbums.mockResolvedValue(serviceResult as never);

    const response = (await sut.handle(
      auth,
      sessionId,
      makeToolCallRequest(AgentToolName.ListAlbums, {}),
    )) as AgentMcpSuccessResponse;

    expectToolResult(response, `${AgentToolName.ListAlbums}-call`, serviceResult, 'Returned 2 albums.');
  });

  it('keeps MCP text compact for large nested structured results', async () => {
    const serviceResult = {
      status: 'success',
      toolCall: null,
      summary: 'Returned 250 compact asset IDs; more results available on page 2.',
      assets: Array.from({ length: 250 }, (_, index) => ({
        id: `asset-${index}`,
        nested: { values: Array.from({ length: 10 }, (__, valueIndex) => `value-${index}-${valueIndex}`) },
      })),
      nextPage: 2,
    };
    toolService.searchAssets.mockResolvedValue(serviceResult as never);

    const response = (await sut.handle(
      auth,
      sessionId,
      makeToolCallRequest(AgentToolName.SearchAssets, { filters: {}, limit: 250 }),
    )) as AgentMcpSuccessResponse;
    const result = response.result as AgentMcpToolCallResult;

    expectToolResult(
      response,
      `${AgentToolName.SearchAssets}-call`,
      serviceResult,
      'Returned 250 compact asset IDs; more results available on page 2.',
    );
    expect(result.content[0].text).not.toContain('asset-249');
    expect(result.content[0].text).not.toContain('"nested"');
  });

  it('uses compact fallback for results without summary', async () => {
    const serviceResult = {
      status: 'success',
      toolCall: null,
      albums: [
        {
          id: factory.uuid(),
          name: 'Large album',
          nested: Array.from({ length: 100 }, (_, index) => ({ assetId: `asset-${index}` })),
        },
      ],
    };
    toolService.listAlbums.mockResolvedValue(serviceResult as never);

    const response = (await sut.handle(
      auth,
      sessionId,
      makeToolCallRequest(AgentToolName.ListAlbums, {}),
    )) as AgentMcpSuccessResponse;
    const result = response.result as AgentMcpToolCallResult;

    expectToolResult(response, `${AgentToolName.ListAlbums}-call`, serviceResult, 'Tool result returned.');
    expect(result.content[0].text).not.toContain('asset-99');
    expect(result.content[0].text).not.toContain('nested');
  });

  it('returns a resolver hint and searchAssets-compatible example when search filter names are sent as ids', async () => {
    const response = (await sut.handle(
      auth,
      sessionId,
      makeToolCallRequest(AgentToolName.SearchAssets, { filters: { tagIds: ['Travel'] } }),
    )) as AgentMcpSuccessResponse;

    expectEnrichedToolValidationError(response, {
      toolName: AgentToolName.SearchAssets,
      path: 'filters.tagIds.0',
      hintIncludes: 'Use resolveAssetSearchFilters',
      exampleArguments: {
        filters: {
          takenAfter: '2026-05-01T00:00:00.000Z',
          takenBefore: '2026-05-18T23:59:59.999Z',
          city: 'Berlin',
          country: 'Germany',
        },
        limit: 50,
      },
    });
  });

  it('returns approval-required read responses as normal MCP tool results', async () => {
    const serviceResult = {
      status: 'approval-required',
      toolCall: { id: factory.uuid(), status: 'pending-approval', requestSummary: 'Read previews for 1 asset.' },
    };
    toolService.readAssetPreviews.mockResolvedValue(serviceResult as never);

    const response = (await sut.handle(
      auth,
      sessionId,
      makeToolCallRequest(AgentToolName.ReadAssetPreviews, { assetIds: [factory.uuid()] }),
    )) as AgentMcpSuccessResponse;

    expectToolResult(response, `${AgentToolName.ReadAssetPreviews}-call`, serviceResult);
    expect((response.result as AgentMcpToolCallResult).content).toEqual([
      { type: 'text', text: 'Approval required: Read previews for 1 asset.' },
    ]);
    expect((response.result as AgentMcpToolCallResult).isError).toBeUndefined();
  });

  it('returns denied read responses as normal MCP tool results', async () => {
    const serviceResult = {
      status: 'denied',
      reason: 'User denied access',
      toolCall: { id: factory.uuid(), status: 'completed' },
    };
    toolService.readAssetOriginals.mockResolvedValue(serviceResult as never);

    const response = (await sut.handle(
      auth,
      sessionId,
      makeToolCallRequest(AgentToolName.ReadAssetOriginals, { assetIds: [factory.uuid()] }),
    )) as AgentMcpSuccessResponse;

    expectToolResult(response, `${AgentToolName.ReadAssetOriginals}-call`, serviceResult);
    expect((response.result as AgentMcpToolCallResult).isError).toBeUndefined();
  });

  it('passes retry toolCallId arguments through to the read service', async () => {
    const toolCallId = factory.uuid();
    const serviceResult = { status: 'success', toolCall: { id: toolCallId }, previews: [] };
    toolService.readAssetPreviews.mockResolvedValue(serviceResult as never);

    const response = (await sut.handle(
      auth,
      sessionId,
      makeToolCallRequest(AgentToolName.ReadAssetPreviews, { toolCallId }),
    )) as AgentMcpSuccessResponse;

    expect(toolService.readAssetPreviews).toHaveBeenCalledWith(auth, sessionId, { toolCallId });
    expectToolResult(response, `${AgentToolName.ReadAssetPreviews}-call`, serviceResult);
  });

  it.each([
    {
      toolName: AgentToolName.ListSpaces,
      serviceMethod: 'listSpaces' as const,
      serviceResult: { status: 'success', toolCall: null, spaces: [] },
    },
    {
      toolName: AgentToolName.ReadSpace,
      serviceMethod: 'readSpace' as const,
      serviceResult: { status: 'success', toolCall: null, space: { id: factory.uuid(), assetIds: [] } },
    },
    {
      toolName: AgentToolName.FindTripCandidates,
      serviceMethod: 'findTripCandidates' as const,
      serviceResult: {
        status: 'success',
        toolCall: null,
        summary: 'No trip candidates found.',
        recommendation: noTripCandidateRecommendation,
        candidates: [],
      },
    },
  ])('passes approved retry toolCallId only for $toolName', async ({ toolName, serviceMethod, serviceResult }) => {
    const toolCallId = factory.uuid();
    toolService[serviceMethod].mockResolvedValue(serviceResult as never);

    const response = (await sut.handle(
      auth,
      sessionId,
      makeToolCallRequest(toolName, { toolCallId }),
    )) as AgentMcpSuccessResponse;

    expect(toolService[serviceMethod]).toHaveBeenCalledWith(auth, sessionId, { toolCallId });
    expectToolResult(response, `${toolName}-call`, serviceResult);
  });

  it('supports the first-party runner sequence for adding assets to an existing space', async () => {
    const familySpaceId = '00000000-0000-4000-8000-000000000401';
    const alreadyInSpaceAssetId = '00000000-0000-4000-8000-000000000501';
    const newCandidateAssetId = '00000000-0000-4000-8000-000000000502';
    const secondNewCandidateAssetId = '00000000-0000-4000-8000-000000000503';
    const selectionHandleId = factory.uuid();
    const serviceResult = makePlanningServiceResult('plan-space-add');

    toolService.listSpaces.mockResolvedValue({
      status: 'success',
      toolCall: null,
      spaces: [
        {
          id: familySpaceId,
          name: 'Family',
          description: null,
          color: 'blue',
          createdById: userId,
          assetCount: 1,
          memberCount: 1,
          thumbnailAssetId: null,
          recentAssetIds: [],
        },
      ],
    } as never);
    toolService.readSpace.mockResolvedValue({
      status: 'success',
      toolCall: null,
      space: {
        id: familySpaceId,
        name: 'Family',
        description: null,
        color: 'blue',
        createdById: userId,
        assetCount: 1,
        memberCount: 1,
        thumbnailAssetId: null,
        recentAssetIds: [],
        assetIds: [alreadyInSpaceAssetId],
        assetIdsReturned: 1,
        assetIdsTruncated: false,
        members: [{ userId, name: 'Pierre', role: 'owner', avatarColor: null, profileImagePath: null }],
      },
    } as never);
    toolService.searchAssets.mockResolvedValue({
      status: 'success',
      toolCall: null,
      assets: [{ id: alreadyInSpaceAssetId }, { id: newCandidateAssetId }, { id: secondNewCandidateAssetId }],
      total: 3,
    } as never);
    operationPlanService.proposeAlbumOperations.mockResolvedValue(serviceResult as never);

    await sut.handle(auth, sessionId, makeToolCallRequest(AgentToolName.ListSpaces, {}));
    await sut.handle(auth, sessionId, makeToolCallRequest(AgentToolName.ReadSpace, { spaceId: familySpaceId }));
    await sut.handle(
      auth,
      sessionId,
      makeToolCallRequest(AgentToolName.SearchAssets, { filters: { city: 'Berlin' }, limit: 50 }),
    );
    const response = (await sut.handle(
      auth,
      sessionId,
      makeToolCallRequest(AgentToolName.ProposeAlbumOperations, {
        summary: 'Add recent Berlin photos to Family space.',
        operations: [
          {
            type: AgentOperationType.SpaceAddAssets,
            summary: 'Add 2 Berlin photos to Family space.',
            targetKind: AgentOperationTargetKind.ExistingSpace,
            targetId: familySpaceId,
            assetSelectionHandleId: selectionHandleId,
            payload: {},
          },
        ],
      }),
    )) as AgentMcpSuccessResponse;

    expect(toolService.listSpaces).toHaveBeenCalledWith(auth, sessionId, {});
    expect(toolService.readSpace).toHaveBeenCalledWith(auth, sessionId, { spaceId: familySpaceId });
    expect(toolService.searchAssets).toHaveBeenCalledWith(auth, sessionId, {
      mode: 'metadata',
      filters: { city: 'Berlin' },
      limit: 50,
      page: 1,
      order: 'desc',
      detail: 'handle',
      fields: [],
    });
    expect(operationPlanService.proposeAlbumOperations).toHaveBeenCalledWith(auth, sessionId, {
      summary: 'Add recent Berlin photos to Family space.',
      operations: [
        expect.objectContaining({
          type: AgentOperationType.SpaceAddAssets,
          targetKind: AgentOperationTargetKind.ExistingSpace,
          targetId: familySpaceId,
          assetSelectionHandleId: selectionHandleId,
          payload: {},
        }),
      ],
    });
    expect(operationPlanService.proposeAlbumOperations).not.toHaveBeenCalledWith(
      auth,
      sessionId,
      expect.objectContaining({
        operations: [
          expect.objectContaining({
            assetIds: expect.arrayContaining([alreadyInSpaceAssetId]),
          }),
        ],
      }),
    );
    expectToolResult(response, `${AgentToolName.ProposeAlbumOperations}-call`, serviceResult);
  });

  it('supports the first-party runner sequence for removing assets from an existing space', async () => {
    const familySpaceId = '00000000-0000-4000-8000-000000000401';
    const inSpaceAssetId = '00000000-0000-4000-8000-000000000501';
    const absentAssetId = '00000000-0000-4000-8000-000000000502';
    const selectionHandleId = factory.uuid();
    const serviceResult = makePlanningServiceResult('plan-space-remove');

    toolService.listSpaces.mockResolvedValue({
      status: 'success',
      toolCall: null,
      spaces: [{ id: familySpaceId, name: 'Family' }],
    } as never);
    toolService.readSpace.mockResolvedValue({
      status: 'success',
      toolCall: null,
      space: {
        id: familySpaceId,
        name: 'Family',
        assetIds: [inSpaceAssetId],
        assetIdsReturned: 1,
        assetIdsTruncated: false,
      },
    } as never);
    toolService.searchAssets.mockResolvedValue({
      status: 'success',
      toolCall: null,
      assets: [{ id: inSpaceAssetId }, { id: absentAssetId }],
      total: 2,
    } as never);
    operationPlanService.proposeAlbumOperations.mockResolvedValue(serviceResult as never);

    await sut.handle(auth, sessionId, makeToolCallRequest(AgentToolName.ListSpaces, {}));
    await sut.handle(auth, sessionId, makeToolCallRequest(AgentToolName.ReadSpace, { spaceId: familySpaceId }));
    await sut.handle(
      auth,
      sessionId,
      makeToolCallRequest(AgentToolName.SearchAssets, { filters: { type: 'screenshot' }, limit: 50 }),
    );
    await sut.handle(
      auth,
      sessionId,
      makeToolCallRequest(AgentToolName.ProposeAlbumOperations, {
        summary: 'Remove screenshots from Family space.',
        operations: [
          {
            type: AgentOperationType.SpaceRemoveAssets,
            summary: 'Remove screenshots from Family space.',
            targetKind: AgentOperationTargetKind.ExistingSpace,
            targetId: familySpaceId,
            assetSelectionHandleId: selectionHandleId,
            payload: {},
          },
        ],
      }),
    );

    expect(operationPlanService.proposeAlbumOperations).toHaveBeenCalledWith(auth, sessionId, {
      summary: 'Remove screenshots from Family space.',
      operations: [
        expect.objectContaining({
          type: AgentOperationType.SpaceRemoveAssets,
          targetKind: AgentOperationTargetKind.ExistingSpace,
          targetId: familySpaceId,
          assetSelectionHandleId: selectionHandleId,
        }),
      ],
    });
    expect(operationPlanService.proposeAlbumOperations).not.toHaveBeenCalledWith(
      auth,
      sessionId,
      expect.objectContaining({
        operations: [
          expect.objectContaining({
            assetIds: expect.arrayContaining([absentAssetId]),
          }),
        ],
      }),
    );
  });

  it('supports the first-party runner sequence for updating existing space details', async () => {
    const familySpaceId = '00000000-0000-4000-8000-000000000401';
    const serviceResult = makePlanningServiceResult('plan-space-update');

    toolService.listSpaces.mockResolvedValue({
      status: 'success',
      toolCall: null,
      spaces: [{ id: familySpaceId, name: 'Family', description: 'Old notes', color: 'gray' }],
    } as never);
    toolService.readSpace.mockResolvedValue({
      status: 'success',
      toolCall: null,
      space: {
        id: familySpaceId,
        name: 'Family',
        description: 'Old notes',
        color: 'gray',
        assetIds: [],
        assetIdsReturned: 0,
        assetIdsTruncated: false,
      },
    } as never);
    operationPlanService.proposeAlbumOperations.mockResolvedValue(serviceResult as never);

    await sut.handle(auth, sessionId, makeToolCallRequest(AgentToolName.ListSpaces, {}));
    await sut.handle(auth, sessionId, makeToolCallRequest(AgentToolName.ReadSpace, { spaceId: familySpaceId }));
    const response = (await sut.handle(
      auth,
      sessionId,
      makeToolCallRequest(AgentToolName.ProposeAlbumOperations, {
        summary: 'Update Family space details.',
        operations: [
          {
            type: AgentOperationType.SpaceUpdateDetails,
            summary: 'Rename Family and update its description and color.',
            targetKind: AgentOperationTargetKind.ExistingSpace,
            targetId: familySpaceId,
            payload: { spaceName: 'Family 2026', description: 'Photos for everyone.', color: 'blue' },
          },
        ],
      }),
    )) as AgentMcpSuccessResponse;

    expect(toolService.listSpaces).toHaveBeenCalledWith(auth, sessionId, {});
    expect(toolService.readSpace).toHaveBeenCalledWith(auth, sessionId, { spaceId: familySpaceId });
    expect(operationPlanService.proposeAlbumOperations).toHaveBeenCalledWith(auth, sessionId, {
      summary: 'Update Family space details.',
      operations: [
        expect.objectContaining({
          type: AgentOperationType.SpaceUpdateDetails,
          targetKind: AgentOperationTargetKind.ExistingSpace,
          targetId: familySpaceId,
          payload: { spaceName: 'Family 2026', description: 'Photos for everyone.', color: 'blue' },
        }),
      ],
    });
    expectToolResult(response, `${AgentToolName.ProposeAlbumOperations}-call`, serviceResult);
  });

  it.each([
    {
      toolName: AgentToolName.ProposeAlbumOperations,
      args: makePlanningRequest(),
      serviceMethod: 'proposeAlbumOperations' as const,
      expectedArguments: (authValue: AuthDto, sessionIdValue: string) => [
        authValue,
        sessionIdValue,
        makeParsedPlanningRequest(),
      ],
    },
    {
      toolName: AgentToolName.ProposeAlbumFromSearch,
      args: {
        summary: 'Create South Africa album.',
        albumName: 'South Africa',
        assetSource: { kind: 'search', filters: { country: 'South Africa' } },
      },
      serviceMethod: 'proposeAlbumFromSearch' as const,
      expectedArguments: (authValue: AuthDto, sessionIdValue: string, args: Record<string, unknown>) => [
        authValue,
        sessionIdValue,
        { ...args, description: '' },
      ],
    },
    {
      toolName: AgentToolName.ProposeAddAssetsToAlbumFromSearch,
      args: {
        summary: 'Add South Africa photos.',
        albumId: factory.uuid(),
        assetSource: { kind: 'search', filters: { country: 'South Africa' } },
      },
      serviceMethod: 'proposeAddAssetsToAlbumFromSearch' as const,
      expectedArguments: (authValue: AuthDto, sessionIdValue: string, args: Record<string, unknown>) => [
        authValue,
        sessionIdValue,
        args,
      ],
    },
    {
      toolName: AgentToolName.ProposeSpaceFromSearch,
      args: {
        summary: 'Create family space.',
        spaceName: 'Family South Africa',
        assetSource: { kind: 'search', filters: { country: 'South Africa' } },
      },
      serviceMethod: 'proposeSpaceFromSearch' as const,
      expectedArguments: (authValue: AuthDto, sessionIdValue: string, args: Record<string, unknown>) => [
        authValue,
        sessionIdValue,
        args,
      ],
    },
    {
      toolName: AgentToolName.ProposeAddAssetsToSpaceFromSearch,
      args: {
        summary: 'Add South Africa photos.',
        spaceId: factory.uuid(),
        assetSource: { kind: 'search', filters: { country: 'South Africa' } },
      },
      serviceMethod: 'proposeAddAssetsToSpaceFromSearch' as const,
      expectedArguments: (authValue: AuthDto, sessionIdValue: string, args: Record<string, unknown>) => [
        authValue,
        sessionIdValue,
        args,
      ],
    },
    {
      toolName: AgentToolName.ProposeAssetBatchFromSearch,
      args: {
        summary: 'Favorite South Africa photos.',
        action: { type: AgentOperationType.AssetSetFavorite, favorite: true },
        assetSource: { kind: 'search', filters: { country: 'South Africa' } },
      },
      serviceMethod: 'proposeAssetBatchFromSearch' as const,
      expectedArguments: (authValue: AuthDto, sessionIdValue: string, args: Record<string, unknown>) => [
        authValue,
        sessionIdValue,
        args,
      ],
    },
    {
      toolName: AgentToolName.ReviseProposedOperations,
      args: {
        planId: factory.uuid(),
        feedback: 'Use a shorter title.',
        ...makePlanningRequest(),
      },
      serviceMethod: 'reviseProposedOperations' as const,
      expectedArguments: (authValue: AuthDto, sessionIdValue: string, args: Record<string, unknown>) => {
        const { planId } = args;
        return [
          authValue,
          sessionIdValue,
          planId,
          {
            feedback: 'Use a shorter title.',
            ...makeParsedPlanningRequest(),
          },
        ];
      },
    },
    {
      toolName: AgentToolName.SummarizePlan,
      args: {
        planId: factory.uuid(),
        focus: 'risk',
      },
      serviceMethod: 'summarizePlan' as const,
      expectedArguments: (authValue: AuthDto, sessionIdValue: string, args: Record<string, unknown>) => {
        const { planId, ...dto } = args;
        return [authValue, sessionIdValue, planId, dto];
      },
    },
  ])(
    'delegates planning tool $toolName to AgentOperationPlanService and wraps the result',
    async ({ toolName, args, serviceMethod, expectedArguments }) => {
      const serviceResult = makePlanningServiceResult();
      operationPlanService[serviceMethod].mockResolvedValue(serviceResult as never);

      const response = (await sut.handle(
        auth,
        sessionId,
        makeToolCallRequest(toolName, args),
      )) as AgentMcpSuccessResponse;

      expect(operationPlanService[serviceMethod]).toHaveBeenCalledTimes(1);
      expect(operationPlanService[serviceMethod]).toHaveBeenCalledWith(
        ...expectedArguments(auth, sessionId, args as Record<string, unknown>),
      );
      expectToolResult(response, `${toolName}-call`, serviceResult);
    },
  );

  it.each([
    {
      toolName: AgentToolName.ProposeAlbumOperations,
      args: makePlanningRequest(),
      serviceMethod: 'proposeAlbumOperations' as const,
    },
    {
      toolName: AgentToolName.ProposeAlbumFromSearch,
      args: {
        summary: 'Create South Africa album.',
        albumName: 'South Africa',
        assetSource: { kind: 'search', filters: { country: 'South Africa' } },
      },
      serviceMethod: 'proposeAlbumFromSearch' as const,
    },
    {
      toolName: AgentToolName.ProposeAddAssetsToAlbumFromSearch,
      args: {
        summary: 'Add South Africa photos.',
        albumId: factory.uuid(),
        assetSource: { kind: 'search', filters: { country: 'South Africa' } },
      },
      serviceMethod: 'proposeAddAssetsToAlbumFromSearch' as const,
    },
    {
      toolName: AgentToolName.ProposeSpaceFromSearch,
      args: {
        summary: 'Create family space.',
        spaceName: 'Family South Africa',
        assetSource: { kind: 'search', filters: { country: 'South Africa' } },
      },
      serviceMethod: 'proposeSpaceFromSearch' as const,
    },
    {
      toolName: AgentToolName.ProposeAddAssetsToSpaceFromSearch,
      args: {
        summary: 'Add South Africa photos.',
        spaceId: factory.uuid(),
        assetSource: { kind: 'search', filters: { country: 'South Africa' } },
      },
      serviceMethod: 'proposeAddAssetsToSpaceFromSearch' as const,
    },
    {
      toolName: AgentToolName.ProposeAssetBatchFromSearch,
      args: {
        action: { type: AgentOperationType.AssetSetFavorite, favorite: true },
        assetSource: { kind: 'search', filters: { country: 'South Africa' } },
      },
      serviceMethod: 'proposeAssetBatchFromSearch' as const,
    },
    {
      toolName: AgentToolName.ReviseProposedOperations,
      args: { planId: factory.uuid(), ...makePlanningRequest() },
      serviceMethod: 'reviseProposedOperations' as const,
    },
    {
      toolName: AgentToolName.SummarizePlan,
      args: { planId: factory.uuid(), focus: 'risk' },
      serviceMethod: 'summarizePlan' as const,
    },
  ])(
    'converts $toolName service failures to redacted JSON-RPC internal errors',
    async ({ toolName, args, serviceMethod }) => {
      operationPlanService[serviceMethod].mockRejectedValue(
        new Error('Agent operation plan not found /srv/gallery/provider-request.json bearer token abc'),
      );

      await expect(sut.handle(auth, sessionId, makeToolCallRequest(toolName, args))).resolves.toEqual({
        jsonrpc: '2.0',
        id: `${toolName}-call`,
        error: {
          code: -32_603,
          message: 'Internal error',
        },
      });
    },
  );

  it('does not expose an MCP apply tool call', async () => {
    await expect(
      sut.handle(auth, sessionId, {
        jsonrpc: '2.0',
        id: 'apply-tool',
        method: 'tools/call',
        params: { name: 'applyAlbumOperations', arguments: { planId: factory.uuid(), operationIds: [factory.uuid()] } },
      }),
    ).resolves.toEqual({
      jsonrpc: '2.0',
      id: 'apply-tool',
      error: {
        code: -32_602,
        message: 'Unknown tool',
        data: { toolName: 'applyAlbumOperations' },
      },
    });
    expect(operationPlanService.proposeAlbumOperations).not.toHaveBeenCalled();
    expect(operationPlanService.reviseProposedOperations).not.toHaveBeenCalled();
    expect(operationPlanService.summarizePlan).not.toHaveBeenCalled();
  });

  it.each([
    {
      name: 'missing arguments',
      args: undefined,
      expectedPath: 'arguments',
    },
    {
      name: 'arguments array',
      args: [factory.uuid()],
      expectedPath: 'arguments',
    },
    {
      name: 'arguments primitive',
      args: 'not-an-object',
      expectedPath: 'arguments',
    },
    {
      name: 'arguments null',
      args: null,
      expectedPath: 'arguments',
    },
    {
      name: 'unknown strict DTO field',
      args: { filters: {}, unexpected: true },
      expectedPath: '',
    },
    {
      name: 'missing metadata assetIds or toolCallId',
      args: {},
      expectedPath: '',
      toolName: AgentToolName.ReadAssetMetadata,
    },
    {
      name: 'empty asset id array',
      args: { assetIds: [] },
      expectedPath: 'assetIds',
      toolName: AgentToolName.ReadAssetMetadata,
    },
    {
      name: 'invalid asset id',
      args: { assetIds: ['not-a-uuid'] },
      expectedPath: 'assetIds.0',
      toolName: AgentToolName.ReadAssetMetadata,
    },
    {
      name: 'invalid album id',
      args: { albumId: 'not-a-uuid' },
      expectedPath: 'albumId',
      toolName: AgentToolName.ReadAlbum,
    },
    {
      name: 'missing readSpace spaceId or toolCallId',
      args: {},
      expectedPath: '',
      toolName: AgentToolName.ReadSpace,
    },
    {
      name: 'combined readSpace spaceId and toolCallId',
      args: { spaceId: factory.uuid(), toolCallId: factory.uuid() },
      expectedPath: '',
      toolName: AgentToolName.ReadSpace,
    },
    {
      name: 'readSpace wrong spaceName field',
      args: { spaceName: 'Family' },
      expectedPath: '',
      toolName: AgentToolName.ReadSpace,
    },
    {
      name: 'wrong primitive search limit',
      args: { limit: 'ten' },
      expectedPath: 'limit',
      toolName: AgentToolName.SearchAssets,
    },
    {
      name: 'excessive search limit',
      args: { limit: 10_001 },
      expectedPath: 'limit',
      toolName: AgentToolName.SearchAssets,
    },
    {
      name: 'invalid trip candidate maxCandidates',
      args: { maxCandidates: 0 },
      expectedPath: 'maxCandidates',
      toolName: AgentToolName.FindTripCandidates,
    },
  ])('returns isError tool result for malformed arguments: $name', async ({ args, expectedPath, toolName }) => {
    const response = (await sut.handle(
      auth,
      sessionId,
      makeToolCallRequest(toolName ?? AgentToolName.SearchAssets, args),
    )) as AgentMcpSuccessResponse;

    expectEnrichedToolValidationError(response, {
      toolName: toolName ?? AgentToolName.SearchAssets,
      path: expectedPath,
    });
    expect(toolService.searchAssets).not.toHaveBeenCalled();
    expect(toolService.findTripCandidates).not.toHaveBeenCalled();
    expect(toolService.readAssetMetadata).not.toHaveBeenCalled();
    expect(toolService.readAlbum).not.toHaveBeenCalled();
    expect(toolService.listSpaces).not.toHaveBeenCalled();
    expect(toolService.readSpace).not.toHaveBeenCalled();
  });

  it('returns enriched validation error and does not delegate unsupported proposeAssetBatchFromSearch actions', async () => {
    const response = (await sut.handle(
      auth,
      sessionId,
      makeToolCallRequest(AgentToolName.ProposeAssetBatchFromSearch, {
        action: { type: AgentOperationType.AssetRemoveTag, tagId: factory.uuid() },
        assetSource: { kind: 'search', filters: { city: 'Berlin' } },
      }),
    )) as AgentMcpSuccessResponse;

    expectEnrichedToolValidationError(response, {
      toolName: AgentToolName.ProposeAssetBatchFromSearch,
      path: 'action.type',
      hintIncludes:
        'Use only asset.setFavorite, asset.setArchive, asset.addTag, asset.updateMetadata, asset.rotate, asset.adjust, or asset.flip',
    });
    expect(operationPlanService.proposeAssetBatchFromSearch).not.toHaveBeenCalled();
  });

  it('does not serialize raw malformed argument values, secrets, routes, or filesystem paths in validation errors', async () => {
    const response = (await sut.handle(
      auth,
      sessionId,
      makeToolCallRequest(AgentToolName.SearchAssets, {
        token: 'bearer abc123',
        internalRoute: '/api/agent/internal/mcp',
        file: '/srv/gallery/provider-key.json',
        filters: { isFavorite: true },
      }),
    )) as AgentMcpSuccessResponse;
    const result = response.result as AgentMcpToolCallResult;
    const serialized = JSON.stringify(result.structuredContent);

    expect(serialized).not.toMatch(
      /token|internalRoute|"file"|bearer|abc123|\/api\/agent\/internal|\/srv\/gallery|provider-key/i,
    );
    expect(result.content[0].type).toBe('text');
    expect(result.content[0].text).toEqual(expect.stringContaining('Invalid tool arguments'));
    expect(result.content[0].text.length).toBeLessThanOrEqual(MCP_TOOL_TEXT_MAX_CHARS);
    expect(result.content[0].text).not.toBe(JSON.stringify(result.structuredContent));
  });

  describe('slice 1 small-model read failure matrix', () => {
    it.each(
      new AgentMcpToolContractService()
        .listSlice1RuntimeFailureMatrixCases()
        .filter((failureCase) => failureCase.expectedResult.kind === 'tool-validation'),
    )('keeps runtime validation baseline for $id', async (failureCase) => {
      const response = (await sut.handle(auth, sessionId, failureCase.request)) as AgentMcpSuccessResponse;

      if (failureCase.expectedResult.kind !== 'tool-validation') {
        throw new Error(`Expected tool-validation case for ${failureCase.id}`);
      }

      expectEnrichedToolValidationError(response, {
        toolName: failureCase.toolName!,
        path: failureCase.expectedResult.expectedIssuePath,
      });
      expect(toolService.searchAssets).not.toHaveBeenCalled();
      expect(toolService.readAssetMetadata).not.toHaveBeenCalled();
      expect(toolService.readAssetPreviews).not.toHaveBeenCalled();
      expect(toolService.readAssetOriginals).not.toHaveBeenCalled();
      expect(toolService.listAlbums).not.toHaveBeenCalled();
      expect(toolService.readAlbum).not.toHaveBeenCalled();
      expect(toolService.listSpaces).not.toHaveBeenCalled();
      expect(toolService.readSpace).not.toHaveBeenCalled();
    });

    it.each([
      {
        id: 'read-input-instead-of-arguments',
        hintIncludes: 'params.arguments',
        exampleArguments: { assetIds: ['00000000-0000-4000-8000-000000000001'] },
      },
      {
        id: 'read-arguments-array',
        hintIncludes: 'must be a JSON object',
        exampleArguments: { assetIds: ['00000000-0000-4000-8000-000000000001'] },
      },
      {
        id: 'asset-read-combined-asset-ids-and-tool-call-id',
        hintIncludes: 'not both',
        expectedIncludes: 'Use assetIds for a new request',
        exampleArguments: { toolCallId: '00000000-0000-4000-8000-000000000111' },
      },
      {
        id: 'asset-read-duplicate-asset-ids',
        hintIncludes: 'only once',
        exampleArguments: { assetIds: ['00000000-0000-4000-8000-000000000001'] },
      },
      {
        id: 'read-album-invalid-album-id',
        hintIncludes: 'Album ids must be UUID strings',
        exampleArguments: { albumId: '00000000-0000-4000-8000-000000000010' },
      },
      {
        id: 'search-filters-outside-filters',
        hintIncludes: 'inside the filters object',
        exampleArguments: {
          filters: {
            takenAfter: '2026-05-01T00:00:00.000Z',
            takenBefore: '2026-05-18T23:59:59.999Z',
            city: 'Berlin',
            country: 'Germany',
          },
          limit: 50,
        },
      },
      {
        id: 'search-limit-out-of-range',
        hintIncludes: 'no greater than 10000',
        exampleArguments: {},
      },
    ])('returns an actionable correction for $id', async (expectation) => {
      const failureCase = contractService
        .listSlice1RuntimeFailureMatrixCases()
        .find((candidate) => candidate.id === expectation.id)!;

      const response = (await sut.handle(auth, sessionId, failureCase.request)) as AgentMcpSuccessResponse;

      if (failureCase.expectedResult.kind !== 'tool-validation' || !failureCase.toolName) {
        throw new Error(`Expected tool-validation read case for ${failureCase.id}`);
      }

      expectEnrichedToolValidationError(response, {
        toolName: failureCase.toolName,
        path: failureCase.expectedResult.expectedIssuePath,
        hintIncludes: expectation.hintIncludes,
        expectedIncludes: expectation.expectedIncludes,
        exampleArguments: expectation.exampleArguments,
      });
    });

    it('adds correction fields for every read-tool failure matrix case', async () => {
      for (const failureCase of contractService
        .listSlice1RuntimeFailureMatrixCases()
        .filter((candidate) => candidate.expectedResult.kind === 'tool-validation')) {
        const response = (await sut.handle(auth, sessionId, failureCase.request)) as AgentMcpSuccessResponse;
        const result = response.result as AgentMcpToolCallResult;
        const structuredContent = result.structuredContent as Record<string, unknown>;

        expect(failureCase.toolName, failureCase.id).toBeDefined();
        expect(structuredContent.toolName, failureCase.id).toBe(failureCase.toolName);
        expect(structuredContent.retryable, failureCase.id).toBe(true);
        expect(typeof structuredContent.expected, failureCase.id).toBe('string');
        expect(typeof structuredContent.hint, failureCase.id).toBe('string');
        expect(structuredContent.exampleArguments, failureCase.id).toEqual(expect.any(Object));
        expect(result.content[0].type, failureCase.id).toBe('text');
        expect(result.content[0].text, failureCase.id).toEqual(expect.stringContaining('Invalid tool arguments'));
        expect(result.content[0].text.length, failureCase.id).toBeLessThanOrEqual(MCP_TOOL_TEXT_MAX_CHARS);
        expect(result.content[0].text, failureCase.id).not.toBe(JSON.stringify(result.structuredContent));
      }
    });

    it.each(
      new AgentMcpToolContractService()
        .listSlice1RuntimeFailureMatrixCases()
        .filter((failureCase) => failureCase.expectedResult.kind === 'protocol-error'),
    )('keeps runtime protocol-error baseline for $id', async (failureCase) => {
      const response = await sut.handle(auth, sessionId, failureCase.request);

      if (failureCase.expectedResult.kind !== 'protocol-error') {
        throw new Error(`Expected protocol-error case for ${failureCase.id}`);
      }

      expect(response).toMatchObject({
        jsonrpc: '2.0',
        id: failureCase.request.id,
        error: {
          message: failureCase.expectedResult.expectedErrorMessage,
        },
      });
      expect(toolService.searchAssets).not.toHaveBeenCalled();
      expect(operationPlanService.proposeAlbumOperations).not.toHaveBeenCalled();
      expect(operationPlanService.reviseProposedOperations).not.toHaveBeenCalled();
      expect(operationPlanService.summarizePlan).not.toHaveBeenCalled();
    });

    it('keeps all slice 1 failure cases unique and documented', () => {
      const cases = contractService.listSlice1RuntimeFailureMatrixCases();

      expect(new Set(cases.map((failureCase) => failureCase.id)).size).toBe(cases.length);
      for (const failureCase of cases) {
        expect(failureCase.description.trim().length).toBeGreaterThan(20);
        expect(failureCase.category).toEqual(expect.any(String));
      }
    });

    it('connects read-tool failure cases to contract common mistakes', () => {
      const expectedReadToolNames = new Set<AgentMcpReadToolName>([
        AgentToolName.SearchAssets,
        AgentToolName.ReadSelectionMetadata,
        AgentToolName.CurateSelection,
        AgentToolName.ReadAssetMetadata,
        AgentToolName.ReadAssetPreviews,
        AgentToolName.ReadAssetOriginals,
        AgentToolName.ListAlbums,
        AgentToolName.ReadAlbum,
        AgentToolName.ListSpaces,
        AgentToolName.ReadSpace,
      ]);
      const isExpectedReadToolName = (toolName: AgentToolName): toolName is AgentMcpReadToolName =>
        expectedReadToolNames.has(toolName as AgentMcpReadToolName);
      const contractsByName = new Map(
        contractService.listReadToolContracts().map((contract) => [contract.name, contract]),
      );

      for (const failureCase of contractService.listSlice1RuntimeFailureMatrixCases()) {
        if (!failureCase.toolName || !isExpectedReadToolName(failureCase.toolName)) {
          continue;
        }

        const mistakeIds = contractsByName.get(failureCase.toolName)?.commonMistakes.map((mistake) => mistake.id) ?? [];

        expect(mistakeIds, `${failureCase.id} should map to ${failureCase.toolName}`).toContain(
          failureCase.expectedContractMistakeId,
        );
      }
    });
  });

  describe('planning argument validation', () => {
    const assetId = factory.uuid();

    it.each(
      new AgentMcpToolContractService()
        .listSlice4PlanningFailureMatrixCases()
        .filter((failureCase) => failureCase.expectedResult.kind === 'tool-validation'),
    )('keeps runtime validation baseline for Slice 4 planning case $id', async (failureCase) => {
      const response = (await sut.handle(
        auth,
        sessionId,
        providerBoundaryAdjustedPlanningRequest(failureCase),
      )) as AgentMcpSuccessResponse;

      if (failureCase.expectedResult.kind !== 'tool-validation') {
        throw new Error(`Expected tool-validation case for ${failureCase.id}`);
      }

      expectEnrichedToolValidationError(response, {
        toolName: failureCase.toolName!,
        path: providerBoundaryAdjustedPlanningIssuePath(failureCase),
      });
      expect(operationPlanService.proposeAlbumOperations).not.toHaveBeenCalled();
      expect(operationPlanService.reviseProposedOperations).not.toHaveBeenCalled();
      expect(operationPlanService.summarizePlan).not.toHaveBeenCalled();
    });

    it.each([
      {
        id: 'planning-missing-arguments',
        hintIncludes: 'params.arguments',
        expectedIncludes: 'reviewable Gallery operation plan',
      },
      {
        id: 'planning-missing-new-album-dependency',
        hintIncludes: 'Create the new album or space first',
        expectedIncludes: 'reviewable Gallery operation plan',
      },
      {
        id: 'planning-wrong-album-target-kind',
        hintIncludes: 'existing_album',
        expectedIncludes: 'reviewable Gallery operation plan',
      },
      {
        id: 'planning-wrong-space-target-kind',
        hintIncludes: 'existing_space',
        expectedIncludes: 'reviewable Gallery operation plan',
      },
      {
        id: 'planning-wrong-asset-batch-target-kind',
        hintIncludes: 'asset_batch',
        expectedIncludes: 'reviewable Gallery operation plan',
      },
      {
        id: 'planning-wrong-image-edit-target-kind',
        hintIncludes: 'image_edit_batch',
        expectedIncludes: 'reviewable Gallery operation plan',
      },
      {
        id: 'planning-duplicate-asset-ids',
        expectedIncludes: 'reviewable Gallery operation plan',
      },
      {
        id: 'planning-invalid-rotate-angle',
        hintIncludes: '90, 180, or 270',
        expectedIncludes: 'reviewable Gallery operation plan',
      },
      {
        id: 'planning-invalid-tag-payload',
        hintIncludes: 'exactly one of tagId or tagName',
        expectedIncludes: 'reviewable Gallery operation plan',
      },
      {
        id: 'planning-space-update-empty-payload',
        hintIncludes: 'spaceName',
        expectedIncludes: 'reviewable Gallery operation plan',
      },
      {
        id: 'planning-space-update-unsupported-fields',
        hintIncludes: 'thumbnail',
        expectedIncludes: 'reviewable Gallery operation plan',
      },
      {
        id: 'planning-space-update-missing-target-id',
        hintIncludes: 'targetId',
        expectedIncludes: 'reviewable Gallery operation plan',
      },
    ])('returns an actionable planning correction for $id', async (expectation) => {
      const failureCase = contractService
        .listSlice4PlanningFailureMatrixCases()
        .find((candidate) => candidate.id === expectation.id)!;

      const response = (await sut.handle(
        auth,
        sessionId,
        providerBoundaryAdjustedPlanningRequest(failureCase),
      )) as AgentMcpSuccessResponse;

      if (failureCase.expectedResult.kind !== 'tool-validation' || !failureCase.toolName) {
        throw new Error(`Expected tool-validation planning case for ${failureCase.id}`);
      }

      expectEnrichedToolValidationError(response, {
        toolName: failureCase.toolName,
        path: providerBoundaryAdjustedPlanningIssuePath(failureCase),
        hintIncludes: expectation.hintIncludes,
        expectedIncludes: expectation.expectedIncludes,
      });

      const result = response.result as AgentMcpToolCallResult;
      expect((result.structuredContent as Record<string, unknown>).exampleArguments).toEqual(expect.any(Object));
    });

    it.each(
      new AgentMcpToolContractService()
        .listSlice4PlanningFailureMatrixCases()
        .filter((failureCase) => failureCase.expectedResult.kind === 'protocol-error'),
    )('keeps runtime protocol-error baseline for Slice 4 planning case $id', async (failureCase) => {
      const response = await sut.handle(auth, sessionId, failureCase.request);

      if (failureCase.expectedResult.kind !== 'protocol-error') {
        throw new Error(`Expected protocol-error case for ${failureCase.id}`);
      }

      expect(response).toMatchObject({
        jsonrpc: '2.0',
        id: failureCase.request.id,
        error: {
          message: failureCase.expectedResult.expectedErrorMessage,
        },
      });
      expect(operationPlanService.proposeAlbumOperations).not.toHaveBeenCalled();
      expect(operationPlanService.reviseProposedOperations).not.toHaveBeenCalled();
      expect(operationPlanService.summarizePlan).not.toHaveBeenCalled();
    });

    it.each([
      {
        name: 'planning missing arguments',
        toolName: AgentToolName.ProposeAlbumOperations,
        args: undefined,
        expectedPath: 'arguments',
      },
      {
        name: 'planning array arguments',
        toolName: AgentToolName.ProposeAlbumOperations,
        args: [makeAlbumCreateOperation()],
        expectedPath: 'arguments',
      },
      {
        name: 'proposal wrong primitive summary',
        toolName: AgentToolName.ProposeAlbumOperations,
        args: { summary: 12, operations: [makeAlbumCreateOperation()] },
        expectedPath: 'summary',
      },
      {
        name: 'proposal missing summary',
        toolName: AgentToolName.ProposeAlbumOperations,
        args: { operations: [makeAlbumCreateOperation()] },
        expectedPath: 'summary',
      },
      {
        name: 'proposal empty operations',
        toolName: AgentToolName.ProposeAlbumOperations,
        args: { summary: 'Empty operations.', operations: [] },
        expectedPath: 'operations',
      },
      {
        name: 'proposal too many operations',
        toolName: AgentToolName.ProposeAlbumOperations,
        args: {
          summary: 'Too many operations.',
          operations: Array.from({ length: 501 }, (_, index) => ({
            ...makeAlbumCreateOperation(),
            temporaryTargetId: `tmp-portugal-${index}`,
            payload: { albumName: `Portugal ${index}` },
          })),
        },
        expectedPath: 'operations',
      },
      {
        name: 'proposal duplicate asset ids',
        toolName: AgentToolName.ProposeAlbumOperations,
        args: {
          summary: 'Duplicate assets.',
          operations: [
            {
              type: AgentOperationType.AlbumAddAssets,
              summary: 'Add duplicate assets.',
              targetKind: AgentOperationTargetKind.ExistingAlbum,
              targetId: factory.uuid(),
              assetIds: [assetId, assetId],
            },
          ],
        },
        expectedPath: 'operations.0.assetIds',
      },
      {
        name: 'proposal missing new album temporary target',
        toolName: AgentToolName.ProposeAlbumOperations,
        args: {
          summary: 'Missing temp id.',
          operations: [
            {
              type: AgentOperationType.AlbumCreate,
              summary: 'Create missing temp id.',
              targetKind: AgentOperationTargetKind.NewAlbum,
              payload: { albumName: 'Portugal' },
            },
          ],
        },
        expectedPath: 'operations.0.temporaryTargetId',
      },
      {
        name: 'proposal excessive album name',
        toolName: AgentToolName.ProposeAlbumOperations,
        args: {
          summary: 'Album name too long.',
          operations: [
            {
              ...makeAlbumCreateOperation(),
              payload: { albumName: 'a'.repeat(201) },
            },
          ],
        },
        expectedPath: 'operations.0.payload.albumName',
      },
      {
        name: 'space detail update empty payload',
        toolName: AgentToolName.ProposeAlbumOperations,
        args: {
          summary: 'Update Family.',
          operations: [
            {
              type: AgentOperationType.SpaceUpdateDetails,
              summary: 'Update Family.',
              targetKind: AgentOperationTargetKind.ExistingSpace,
              targetId: factory.uuid(),
              payload: {},
            },
          ],
        },
        expectedPath: 'operations.0.payload',
      },
      {
        name: 'space detail update unsupported field',
        toolName: AgentToolName.ProposeAlbumOperations,
        args: {
          summary: 'Update Family thumbnail.',
          operations: [
            {
              type: AgentOperationType.SpaceUpdateDetails,
              summary: 'Update Family thumbnail.',
              targetKind: AgentOperationTargetKind.ExistingSpace,
              targetId: factory.uuid(),
              payload: { thumbnailAssetId: factory.uuid() },
            },
          ],
        },
        expectedPath: 'operations.0.payload',
      },
      {
        name: 'revision missing planId',
        toolName: AgentToolName.ReviseProposedOperations,
        args: makePlanningRequest(),
        expectedPath: 'planId',
      },
      {
        name: 'revision numeric planId',
        toolName: AgentToolName.ReviseProposedOperations,
        args: { planId: 12, ...makePlanningRequest() },
        expectedPath: 'planId',
      },
      {
        name: 'revision invalid planId',
        toolName: AgentToolName.ReviseProposedOperations,
        args: { planId: 'not-a-uuid', ...makePlanningRequest() },
        expectedPath: 'planId',
      },
      {
        name: 'revision excessive feedback',
        toolName: AgentToolName.ReviseProposedOperations,
        args: { planId: factory.uuid(), feedback: 'a'.repeat(2001), ...makePlanningRequest() },
        expectedPath: 'feedback',
      },
      {
        name: 'summary missing planId',
        toolName: AgentToolName.SummarizePlan,
        args: { focus: 'risk' },
        expectedPath: 'planId',
      },
      {
        name: 'summary numeric planId',
        toolName: AgentToolName.SummarizePlan,
        args: { planId: 12, focus: 'risk' },
        expectedPath: 'planId',
      },
      {
        name: 'summary wrong primitive focus',
        toolName: AgentToolName.SummarizePlan,
        args: { planId: factory.uuid(), focus: 12 },
        expectedPath: 'focus',
      },
      {
        name: 'summary invalid focus',
        toolName: AgentToolName.SummarizePlan,
        args: { planId: factory.uuid(), focus: '' },
        expectedPath: 'focus',
      },
      {
        name: 'summary excessive focus',
        toolName: AgentToolName.SummarizePlan,
        args: { planId: factory.uuid(), focus: 'a'.repeat(1001) },
        expectedPath: 'focus',
      },
      {
        name: 'summary unknown strict field',
        toolName: AgentToolName.SummarizePlan,
        args: { planId: factory.uuid(), focus: 'risk', unexpected: true },
        expectedPath: '',
      },
    ])(
      'returns isError tool result for malformed planning arguments: $name',
      async ({ toolName, args, expectedPath }) => {
        const response = (await sut.handle(
          auth,
          sessionId,
          makeToolCallRequest(toolName, args),
        )) as AgentMcpSuccessResponse;

        expectEnrichedToolValidationError(response, {
          toolName,
          path: expectedPath,
        });
        expect(operationPlanService.proposeAlbumOperations).not.toHaveBeenCalled();
        expect(operationPlanService.reviseProposedOperations).not.toHaveBeenCalled();
        expect(operationPlanService.summarizePlan).not.toHaveBeenCalled();
      },
    );

    it('adds contract-derived correction fields for planning tools', async () => {
      const response = (await sut.handle(auth, sessionId, {
        jsonrpc: '2.0',
        id: `${AgentToolName.ProposeAlbumOperations}-call`,
        method: 'tools/call',
        params: {
          name: AgentToolName.ProposeAlbumOperations,
        },
      })) as AgentMcpSuccessResponse;
      const result = response.result as AgentMcpToolCallResult;

      expect(result.isError).toBe(true);
      expect(result.structuredContent).toMatchObject({
        status: 'error',
        error: 'Invalid tool arguments',
        toolName: AgentToolName.ProposeAlbumOperations,
        retryable: true,
        issues: [
          { path: 'arguments', message: 'arguments is required', hint: expect.stringContaining('params.arguments') },
        ],
        expected: expect.stringContaining('reviewable Gallery operation plan'),
        hint: expect.stringContaining('params.arguments'),
        exampleArguments: expect.objectContaining({
          summary: 'Create today test and add selected photos.',
          operations: expect.any(Array),
        }),
      });
      expect(result.content[0].type).toBe('text');
      expect(result.content[0].text).toEqual(expect.stringContaining('Invalid tool arguments'));
      expect(result.content[0].text.length).toBeLessThanOrEqual(MCP_TOOL_TEXT_MAX_CHARS);
      expect(result.content[0].text).not.toBe(JSON.stringify(result.structuredContent));
    });

    it('rejects provider-facing raw planning assetIds before delegation', async () => {
      const rawAssetId = factory.uuid();

      const response = (await sut.handle(
        auth,
        sessionId,
        makeToolCallRequest(AgentToolName.ProposeAlbumOperations, {
          summary: 'Add copied IDs.',
          operations: [
            {
              type: AgentOperationType.AlbumAddAssets,
              summary: 'Add copied IDs.',
              targetKind: AgentOperationTargetKind.ExistingAlbum,
              targetId: factory.uuid(),
              assetIds: [rawAssetId],
              payload: {},
            },
          ],
        }),
      )) as AgentMcpSuccessResponse;

      const result = response.result as AgentMcpToolCallResult;
      const structuredContent = result.structuredContent as Record<string, unknown>;

      expect(result.isError).toBe(true);
      expect(structuredContent).toMatchObject({
        status: 'error',
        error: 'Invalid tool arguments',
        toolName: AgentToolName.ProposeAlbumOperations,
        retryable: true,
      });
      expect(structuredContent.issues).toEqual([
        expect.objectContaining({
          path: 'operations.0.assetIds',
          message: expect.stringContaining('Provider-facing planning calls must use selection handles'),
        }),
      ]);
      expect(JSON.stringify(response)).not.toContain(rawAssetId);
      expect(operationPlanService.proposeAlbumOperations).not.toHaveBeenCalled();
    });

    it('rejects provider-facing assetSource.explicitAssets before delegation', async () => {
      const rawAssetId = factory.uuid();

      const response = (await sut.handle(
        auth,
        sessionId,
        makeToolCallRequest(AgentToolName.ProposeAlbumOperations, {
          summary: 'Add explicit assets.',
          operations: [
            {
              type: AgentOperationType.AlbumAddAssets,
              summary: 'Add explicit assets.',
              targetKind: AgentOperationTargetKind.ExistingAlbum,
              targetId: factory.uuid(),
              assetSource: { kind: 'explicitAssets', assetIds: [rawAssetId] },
              payload: {},
            },
          ],
        }),
      )) as AgentMcpSuccessResponse;

      const result = response.result as AgentMcpToolCallResult;
      const structuredContent = result.structuredContent as Record<string, unknown>;

      expect(result.isError).toBe(true);
      expect(structuredContent.issues).toEqual([
        expect.objectContaining({
          path: 'operations.0.assetSource',
          message: expect.stringContaining('assetSource.explicitAssets is not available'),
        }),
      ]);
      expect(JSON.stringify(response)).not.toContain(rawAssetId);
      expect(operationPlanService.proposeAlbumOperations).not.toHaveBeenCalled();
    });

    it('rejects provider-facing top-level assetSource.explicitAssets before delegation', async () => {
      const rawAssetId = factory.uuid();

      const response = (await sut.handle(
        auth,
        sessionId,
        makeToolCallRequest(AgentToolName.ProposeAssetBatchFromSearch, {
          summary: 'Favorite explicit assets.',
          action: { type: AgentOperationType.AssetSetFavorite, favorite: true },
          assetSource: { kind: 'explicitAssets', assetIds: [rawAssetId] },
        }),
      )) as AgentMcpSuccessResponse;

      const result = response.result as AgentMcpToolCallResult;
      const structuredContent = result.structuredContent as Record<string, unknown>;

      expect(result.isError).toBe(true);
      expect(structuredContent.issues).toEqual([
        expect.objectContaining({
          path: 'assetSource',
          message: expect.stringContaining('assetSource.explicitAssets is not available'),
        }),
      ]);
      expect(JSON.stringify(response)).not.toContain(rawAssetId);
      expect(operationPlanService.proposeAssetBatchFromSearch).not.toHaveBeenCalled();
    });

    it('redacts materialized planning assetIds from MCP structured content', async () => {
      const rawAssetIds = [factory.uuid(), factory.uuid()];
      const serviceResult = {
        status: 'success',
        summary:
          'Plan revision 1: 0 album create, 1 asset add, 0 detail update, 0 cover change, 0 metadata update operation(s).',
        toolCall: null,
        plan: {
          id: factory.uuid(),
          sessionId,
          revision: 1,
          status: AgentOperationPlanStatus.Proposed,
          summary: 'Add handle assets.',
          operations: [
            {
              id: factory.uuid(),
              planId: factory.uuid(),
              type: AgentOperationType.AlbumAddAssets,
              summary: 'Add handle assets.',
              targetKind: AgentOperationTargetKind.ExistingAlbum,
              targetId: factory.uuid(),
              temporaryTargetId: null,
              assetIds: rawAssetIds,
              payload: {},
              dependencyIds: [],
              riskLevel: AgentOperationRiskLevel.Medium,
              enabled: true,
              status: AgentOperationStatus.Proposed,
              result: null,
              error: null,
              createdAt: new Date('2026-05-27T12:00:00.000Z'),
              updatedAt: new Date('2026-05-27T12:00:00.000Z'),
            },
          ],
          createdAt: new Date('2026-05-27T12:00:00.000Z'),
          updatedAt: new Date('2026-05-27T12:00:00.000Z'),
        },
      };
      operationPlanService.proposeAlbumOperations.mockResolvedValue(serviceResult as never);

      const response = (await sut.handle(
        auth,
        sessionId,
        makeToolCallRequest(AgentToolName.ProposeAlbumOperations, {
          summary: 'Add handle assets.',
          operations: [
            {
              type: AgentOperationType.AlbumAddAssets,
              summary: 'Add handle assets.',
              targetKind: AgentOperationTargetKind.ExistingAlbum,
              targetId: factory.uuid(),
              assetSelectionHandleId: factory.uuid(),
              payload: {},
            },
          ],
        }),
      )) as AgentMcpSuccessResponse;

      const result = response.result as AgentMcpToolCallResult;
      const structuredContent = result.structuredContent as Record<string, any>;
      const [operation] = structuredContent.plan.operations;

      expect(operation).not.toHaveProperty('assetIds');
      expect(operation.assetCount).toBe(2);
      expect(JSON.stringify(response)).not.toContain('"assetIds"');
      expect(JSON.stringify(response)).not.toContain(rawAssetIds[0]);
    });

    it('routes proposeAlbumFromSelection and redacts materialized operation ids', async () => {
      const rawAssetIds = [factory.uuid(), factory.uuid()];
      const selectionHandleId = factory.uuid();
      const serviceResult = {
        status: 'success',
        summary: 'Plan revision 1 is ready for review.',
        toolCall: null,
        plan: {
          id: factory.uuid(),
          sessionId,
          revision: 1,
          status: AgentOperationPlanStatus.Proposed,
          summary: 'Create curated album.',
          operations: [
            {
              id: factory.uuid(),
              planId: factory.uuid(),
              type: AgentOperationType.AlbumAddAssets,
              summary: 'Add selected photos.',
              targetKind: AgentOperationTargetKind.NewAlbum,
              targetId: null,
              temporaryTargetId: 'tmp-album-from-selection',
              assetIds: rawAssetIds,
              payload: {},
              dependencyIds: [],
              riskLevel: AgentOperationRiskLevel.Medium,
              enabled: true,
              status: AgentOperationStatus.Proposed,
              result: null,
              error: null,
              createdAt: new Date('2026-05-27T12:00:00.000Z'),
              updatedAt: new Date('2026-05-27T12:00:00.000Z'),
            },
          ],
          createdAt: new Date('2026-05-27T12:00:00.000Z'),
          updatedAt: new Date('2026-05-27T12:00:00.000Z'),
        },
      };
      operationPlanService.proposeAlbumFromSelection.mockResolvedValue(serviceResult as never);

      const response = (await sut.handle(
        auth,
        sessionId,
        makeToolCallRequest(AgentToolName.ProposeAlbumFromSelection, {
          summary: 'Create curated album.',
          albumName: 'Curated album',
          description: 'Selected photos.',
          selectionHandleId,
        }),
      )) as AgentMcpSuccessResponse;

      const result = response.result as AgentMcpToolCallResult;
      const structuredContent = result.structuredContent as Record<string, any>;
      const [operation] = structuredContent.plan.operations;

      expect(operationPlanService.proposeAlbumFromSelection).toHaveBeenCalledWith(auth, sessionId, {
        summary: 'Create curated album.',
        albumName: 'Curated album',
        description: 'Selected photos.',
        selectionHandleId,
      });
      expect(operation).not.toHaveProperty('assetIds');
      expect(operation.assetCount).toBe(2);
      expect(JSON.stringify(response)).not.toContain(rawAssetIds[0]);
      expect(JSON.stringify(response)).not.toContain(rawAssetIds[1]);
    });

    it('redacts nested planning result ids from MCP structured content', async () => {
      const rawAssetIds = [factory.uuid(), factory.uuid()];
      const rawResultAssetId = factory.uuid();
      const operationSampleAssetIds = [factory.uuid(), factory.uuid()];
      const operationPreviousValueAssetId = factory.uuid();
      const resultSampleAssetIds = [factory.uuid()];
      const resultPreviousValueAssetId = factory.uuid();
      const serviceResult = {
        status: 'success',
        summary: 'Plan applied.',
        toolCall: null,
        plan: {
          id: factory.uuid(),
          sessionId,
          revision: 1,
          status: AgentOperationPlanStatus.Proposed,
          summary: 'Favorite handle assets.',
          operations: [
            {
              id: factory.uuid(),
              planId: factory.uuid(),
              type: AgentOperationType.AssetSetFavorite,
              summary: 'Favorite handle assets.',
              targetKind: AgentOperationTargetKind.AssetBatch,
              targetId: null,
              temporaryTargetId: null,
              assetIds: rawAssetIds,
              payload: { favorite: true },
              dependencyIds: [],
              riskLevel: AgentOperationRiskLevel.Low,
              enabled: true,
              status: AgentOperationStatus.Proposed,
              reviewMetadata: {
                warnings: ['Will update selected assets.'],
                assetMetadata: {
                  sampleAssetIds: operationSampleAssetIds,
                  fields: [
                    {
                      key: 'rating',
                      label: 'Rating',
                      proposedValue: 5,
                      previousValues: [
                        {
                          assetId: operationPreviousValueAssetId,
                          value: 4,
                          valueKind: 'number',
                          observedAt: '2026-05-27T12:00:00.000Z',
                        },
                      ],
                    },
                  ],
                },
              },
              result: {
                assetIds: rawAssetIds,
                assetResults: [{ id: rawResultAssetId, success: true }],
                reviewMetadata: {
                  warnings: ['Result warning.'],
                  assetMetadata: {
                    sampleAssetIds: resultSampleAssetIds,
                    fields: [
                      {
                        key: 'favorite',
                        label: 'Favorite',
                        proposedValue: true,
                        previousValues: [
                          {
                            assetId: resultPreviousValueAssetId,
                            value: false,
                            valueKind: 'boolean',
                          },
                        ],
                      },
                    ],
                  },
                },
              },
              error: null,
              createdAt: new Date('2026-05-27T12:00:00.000Z'),
              updatedAt: new Date('2026-05-27T12:00:00.000Z'),
            },
          ],
          createdAt: new Date('2026-05-27T12:00:00.000Z'),
          updatedAt: new Date('2026-05-27T12:00:00.000Z'),
        },
      };
      operationPlanService.proposeAssetBatchFromSearch.mockResolvedValue(serviceResult as never);

      const response = (await sut.handle(
        auth,
        sessionId,
        makeToolCallRequest(AgentToolName.ProposeAssetBatchFromSearch, {
          summary: 'Favorite handle assets.',
          action: { type: AgentOperationType.AssetSetFavorite, favorite: true },
          assetSource: { kind: 'search', filters: { country: 'South Africa' } },
        }),
      )) as AgentMcpSuccessResponse;

      const result = response.result as AgentMcpToolCallResult;
      const structuredContent = result.structuredContent as Record<string, any>;
      const [operation] = structuredContent.plan.operations;

      expect(operation.assetCount).toBe(2);
      expect(operation.result.assetCount).toBe(2);
      expect(operation.result.assetResultsCount).toBe(1);
      expect(operation.reviewMetadata.assetMetadata.sampleAssetCount).toBe(2);
      expect(operation.reviewMetadata.assetMetadata.fields[0].previousValues).toEqual([
        { value: 4, valueKind: 'number', observedAt: '2026-05-27T12:00:00.000Z' },
      ]);
      expect(operation.reviewMetadata.warnings).toEqual(['Will update selected assets.']);
      expect(operation.result.reviewMetadata.assetMetadata.sampleAssetCount).toBe(1);
      expect(operation.result.reviewMetadata.assetMetadata.fields[0].previousValues).toEqual([
        { value: false, valueKind: 'boolean' },
      ]);
      expect(operation.result.reviewMetadata.warnings).toEqual(['Result warning.']);
      expect(operation.result).not.toHaveProperty('assetResults');
      expect(JSON.stringify(response)).not.toContain('"assetIds"');
      expect(JSON.stringify(response)).not.toContain('sampleAssetIds');
      expect(JSON.stringify(response)).not.toContain('"assetId"');
      expect(JSON.stringify(response)).not.toContain(rawAssetIds[0]);
      expect(JSON.stringify(response)).not.toContain(rawResultAssetId);
      expect(JSON.stringify(response)).not.toContain(operationSampleAssetIds[0]);
      expect(JSON.stringify(response)).not.toContain(operationPreviousValueAssetId);
      expect(JSON.stringify(response)).not.toContain(resultSampleAssetIds[0]);
      expect(JSON.stringify(response)).not.toContain(resultPreviousValueAssetId);
    });

    it('returns recoverable invalid selection handle tool errors as MCP tool results', async () => {
      const validHandleId = factory.uuid();
      const recoverableError = new AgentMcpRecoverableToolError({
        status: 'error',
        error: 'Selection handle is expired or not available for this session',
        toolName: AgentToolName.ProposeAlbumOperations,
        retryable: true,
        hint: `Retry proposeAlbumOperations with the exact handle ${validHandleId} if that is the intended search selection.`,
        recovery: {
          kind: 'invalid-selection-handle',
          attemptedSelectionHandleId: '00000000-0000-4000-8000-000000000333',
          looksLikeExamplePlaceholder: true,
          availableSelectionHandles: [
            {
              id: validHandleId,
              assetCount: 42,
              sourceToolCallId: null,
              createdAt: '2026-05-22T07:00:00.000Z',
              expiresAt: '2026-05-22T08:00:00.000Z',
            },
          ],
          instruction: 'Retry proposeAlbumOperations with a valid same-session selection handle.',
        },
      });
      operationPlanService.proposeAlbumOperations.mockRejectedValue(recoverableError);

      const response = (await sut.handle(
        auth,
        sessionId,
        makeToolCallRequest(AgentToolName.ProposeAlbumOperations, {
          summary: 'Add photos.',
          operations: [
            {
              type: AgentOperationType.AlbumAddAssets,
              summary: 'Add selected photos.',
              targetKind: AgentOperationTargetKind.ExistingAlbum,
              targetId: factory.uuid(),
              assetSelectionHandleId: '00000000-0000-4000-8000-000000000333',
              payload: {},
            },
          ],
        }),
      )) as AgentMcpSuccessResponse;

      expect(response).not.toHaveProperty('error');
      const result = response.result as AgentMcpToolCallResult;
      expect(result.isError).toBe(true);
      expect(result.structuredContent).toMatchObject({
        status: 'error',
        retryable: true,
        recovery: expect.objectContaining({
          kind: 'invalid-selection-handle',
          looksLikeExamplePlaceholder: true,
        }),
      });
      expect(result.content[0].text).toContain(recoverableError.content.hint);
      expect(JSON.stringify(response)).not.toContain('Internal error');
    });

    it('returns recoverable wrong-domain tool errors as MCP tool results', async () => {
      const recoverableError = new AgentMcpRecoverableToolError({
        status: 'error',
        error: 'That value is a person ID, not an asset ID.',
        toolName: AgentToolName.ReadAssetMetadata,
        retryable: true,
        hint: 'Use exact asset IDs from a small inspected asset set. For search-backed writes, use assetSource.search or previousSearch.sourceRef instead of assetIds.',
        recovery: {
          kind: 'wrong_id_domain',
          field: 'assetIds',
          expectedDomain: 'asset',
          receivedDomain: 'person',
          instruction:
            'Use exact asset IDs from a small inspected asset set. For search-backed writes, use assetSource.search or previousSearch.sourceRef instead of assetIds.',
        },
      });
      toolService.readAssetMetadata.mockRejectedValue(recoverableError);

      const response = (await sut.handle(
        auth,
        sessionId,
        makeToolCallRequest(AgentToolName.ReadAssetMetadata, {
          assetIds: [factory.uuid()],
        }),
      )) as AgentMcpSuccessResponse;

      expect(response).not.toHaveProperty('error');
      const result = response.result as AgentMcpToolCallResult;
      expect(result.isError).toBe(true);
      expect(result.structuredContent).toMatchObject({
        status: 'error',
        retryable: true,
        error: 'That value is a person ID, not an asset ID.',
        recovery: {
          kind: 'wrong_id_domain',
          field: 'assetIds',
          expectedDomain: 'asset',
          receivedDomain: 'person',
        },
      });
      expect(result.content[0].text).toContain(recoverableError.content.hint);
      expect(JSON.stringify(response)).not.toContain('Internal error');
    });

    it('returns recoverable invalid source ref tool errors as MCP tool results', async () => {
      const sourceRef = `asset-source:search:${factory.uuid()}`;
      const recoverableError = new AgentMcpRecoverableToolError({
        status: 'error',
        error: 'Source ref is expired or not available for this session',
        toolName: AgentToolName.ProposeAlbumOperations,
        retryable: true,
        hint: 'The attempted source ref is expired. Rerun searchAssets, then retry proposeAlbumOperations with the returned selectionHandle.sourceRef.',
        recovery: {
          kind: 'invalid-source-ref',
          attemptedSourceRef: sourceRef,
          expectedSourceKind: 'search',
          expiredSourceRef: sourceRef,
          instruction:
            'Rerun searchAssets, then retry proposeAlbumOperations with the returned selectionHandle.sourceRef.',
        },
      });
      operationPlanService.proposeAlbumOperations.mockRejectedValue(recoverableError);

      const response = (await sut.handle(
        auth,
        sessionId,
        makeToolCallRequest(AgentToolName.ProposeAlbumOperations, {
          summary: 'Add photos.',
          operations: [
            {
              type: AgentOperationType.AlbumAddAssets,
              summary: 'Add selected photos.',
              targetKind: AgentOperationTargetKind.ExistingAlbum,
              targetId: factory.uuid(),
              assetSource: { kind: 'previousSearch', sourceRef },
              payload: {},
            },
          ],
        }),
      )) as AgentMcpSuccessResponse;

      expect(response).not.toHaveProperty('error');
      const result = response.result as AgentMcpToolCallResult;
      expect(result.isError).toBe(true);
      expect(result.structuredContent).toMatchObject({
        status: 'error',
        retryable: true,
        error: 'Source ref is expired or not available for this session',
        recovery: {
          kind: 'invalid-source-ref',
          attemptedSourceRef: sourceRef,
          expectedSourceKind: 'search',
          expiredSourceRef: sourceRef,
        },
      });
      expect(result.content[0].text).toContain(recoverableError.content.hint);
      expect(JSON.stringify(response)).not.toContain('assetIds');
      expect(JSON.stringify(response)).not.toContain('sampleAssetIds');
      expect(JSON.stringify(response)).not.toContain('Internal error');
    });

    it('keeps invalid UUID selection handles as ordinary schema validation errors', async () => {
      const response = (await sut.handle(
        auth,
        sessionId,
        makeToolCallRequest(AgentToolName.ProposeAlbumOperations, {
          summary: 'Add photos.',
          operations: [
            {
              type: AgentOperationType.AlbumAddAssets,
              summary: 'Add selected photos.',
              targetKind: AgentOperationTargetKind.ExistingAlbum,
              targetId: factory.uuid(),
              assetSelectionHandleId: 'not-a-uuid',
              payload: {},
            },
          ],
        }),
      )) as AgentMcpSuccessResponse;
      const result = response.result as AgentMcpToolCallResult;
      const structuredContent = result.structuredContent as Record<string, unknown>;

      expect(result.isError).toBe(true);
      expect(structuredContent.error).toBe('Invalid tool arguments');
      expect(structuredContent).not.toHaveProperty('recovery');
      expect(operationPlanService.proposeAlbumOperations).not.toHaveBeenCalled();
    });

    it('returns a correction hint when a space asset operation uses an album target kind', async () => {
      const response = (await sut.handle(
        auth,
        sessionId,
        makeToolCallRequest(AgentToolName.ProposeAlbumOperations, {
          summary: 'Add photos to a space.',
          operations: [
            {
              type: AgentOperationType.SpaceAddAssets,
              summary: 'Add photos to Family.',
              targetKind: AgentOperationTargetKind.ExistingAlbum,
              targetId: '00000000-0000-4000-8000-000000000010',
              assetSelectionHandleId: '00000000-0000-4000-8000-000000000001',
              payload: {},
            },
          ],
        }),
      )) as AgentMcpSuccessResponse;

      expectEnrichedToolValidationError(response, {
        toolName: AgentToolName.ProposeAlbumOperations,
        path: 'operations.0.targetKind',
        hintIncludes: 'existing_space',
      });
    });
  });

  describe('slice 7 full small-model failure matrix', () => {
    it.each(
      getRuntimeFailureMatrixCases().filter((failureCase) => failureCase.expectedResult.kind === 'tool-validation'),
    )('returns compact actionable validation guidance for $id', async (failureCase) => {
      const isPlanningCase = failureCase.id.startsWith('planning-');
      const response = (await sut.handle(
        auth,
        sessionId,
        isPlanningCase ? providerBoundaryAdjustedPlanningRequest(failureCase) : failureCase.request,
      )) as AgentMcpSuccessResponse;

      if (failureCase.expectedResult.kind !== 'tool-validation' || !failureCase.toolName) {
        throw new Error(`Expected tool-validation case for ${failureCase.id}`);
      }

      const expectedResult = failureCase.expectedResult;
      const expectedIssuePath = isPlanningCase
        ? providerBoundaryAdjustedPlanningIssuePath(failureCase)
        : expectedResult.expectedIssuePath;
      const result = response.result as AgentMcpToolCallResult;
      const structuredContent = result.structuredContent as Record<string, unknown>;
      const issues = structuredContent.issues as Array<Record<string, unknown>>;
      const expectedPathIssue = issues.find((issue) => issue.path === expectedIssuePath);
      const serialized = JSON.stringify(structuredContent);

      expect(response).toMatchObject({
        jsonrpc: '2.0',
        id: failureCase.request.id,
      });
      expect(result.isError).toBe(true);
      expect(structuredContent).toMatchObject({
        status: 'error',
        error: 'Invalid tool arguments',
        toolName: failureCase.toolName,
        retryable: true,
        expected: expect.any(String),
        hint: expect.any(String),
        exampleArguments: expect.any(Object),
      });
      expect(issues).toEqual(expect.arrayContaining([expect.objectContaining({ path: expectedIssuePath })]));
      expect(expectedPathIssue?.hint ?? structuredContent.hint).toEqual(expect.any(String));
      expect((structuredContent.expected as string).trim()).not.toBe('');
      expect((structuredContent.hint as string).trim()).not.toBe('');
      expect((structuredContent.expected as string).length).toBeLessThanOrEqual(500);
      expect((structuredContent.hint as string).length).toBeLessThanOrEqual(500);
      expect(serialized.length).toBeLessThanOrEqual(5000);
      expect(serialized).not.toMatch(secretLeakPattern);
      expect(result.content[0].type).toBe('text');
      expect(result.content[0].text).toEqual(expect.stringContaining('Invalid tool arguments'));
      expect(result.content[0].text.length).toBeLessThanOrEqual(MCP_TOOL_TEXT_MAX_CHARS);
      expect(result.content[0].text).not.toBe(JSON.stringify(result.structuredContent));
      expectNoMcpDownstreamServicesCalled(toolService, operationPlanService);
    });

    it.each(
      getRuntimeFailureMatrixCases().filter((failureCase) => failureCase.expectedResult.kind === 'protocol-error'),
    )('keeps $id as a compact protocol error', async (failureCase) => {
      const response = await sut.handle(auth, sessionId, failureCase.request);

      if (failureCase.expectedResult.kind !== 'protocol-error') {
        throw new Error(`Expected protocol-error case for ${failureCase.id}`);
      }

      const errorResponse = response as AgentMcpErrorResponse;

      expect(errorResponse).toMatchObject({
        jsonrpc: '2.0',
        id: failureCase.request.id,
        error: {
          message: failureCase.expectedResult.expectedErrorMessage,
        },
      });
      expect(errorResponse).not.toHaveProperty('result');
      expect(JSON.stringify(errorResponse.error).length).toBeLessThanOrEqual(1000);
      expect(JSON.stringify(errorResponse.error)).not.toMatch(secretLeakPattern);
      expectNoMcpDownstreamServicesCalled(toolService, operationPlanService);
    });

    it.each([
      ['read-input-instead-of-arguments', 'params.arguments'],
      ['read-arguments-array', 'JSON object'],
      ['asset-read-combined-asset-ids-and-tool-call-id', 'not both'],
      ['search-root-taken-after-filter', 'inside the filters object'],
      ['planning-dependent-set-cover-missing-new-album', 'Create the new album or space first'],
      ['planning-dependent-add-assets-wrong-temporary-target-kind', 'Album dependencies require an album create'],
      ['planning-wrong-album-target-kind', 'existing_album'],
      ['planning-invalid-rotate-angle', '90, 180, or 270'],
      ['planning-invalid-tag-payload', 'tagId or tagName'],
    ])('returns category-specific guidance for %s', async (id, hintIncludes) => {
      const failureCase = getRuntimeFailureMatrixCases().find((candidate) => candidate.id === id);

      expect(failureCase).toBeDefined();
      if (!failureCase || failureCase.expectedResult.kind !== 'tool-validation') {
        throw new Error(`Expected tool-validation case for ${id}`);
      }

      const response = (await sut.handle(
        auth,
        sessionId,
        id.startsWith('planning-') ? providerBoundaryAdjustedPlanningRequest(failureCase) : failureCase.request,
      )) as AgentMcpSuccessResponse;
      const result = response.result as AgentMcpToolCallResult;
      const structuredContent = result.structuredContent as Record<string, unknown>;

      expect(structuredContent.hint).toEqual(expect.stringContaining(hintIncludes));
    });
  });

  it.each([
    ['missing params', undefined],
    ['params is not object', 'bad-params'],
    ['missing name', { arguments: {} }],
    ['non-string name', { name: 12, arguments: {} }],
  ] as const)('returns invalid params for tools/call when %s', async (_name, params) => {
    await expect(
      sut.handle(auth, sessionId, {
        jsonrpc: '2.0',
        id: 'bad-call',
        method: 'tools/call',
        params,
      }),
    ).resolves.toEqual({
      jsonrpc: '2.0',
      id: 'bad-call',
      error: {
        code: -32_602,
        message: 'Invalid params',
      },
    });
  });

  it('returns a protocol error for an unknown tool name', async () => {
    await expect(
      sut.handle(auth, sessionId, {
        jsonrpc: '2.0',
        id: 'unknown-tool',
        method: 'tools/call',
        params: { name: 'deleteEverything', arguments: {} },
      }),
    ).resolves.toEqual({
      jsonrpc: '2.0',
      id: 'unknown-tool',
      error: {
        code: -32_602,
        message: 'Unknown tool',
        data: { toolName: 'deleteEverything' },
      },
    });
  });

  it('keeps unknown tools as JSON-RPC protocol errors instead of tool validation results', async () => {
    const response = await sut.handle(auth, sessionId, {
      jsonrpc: '2.0',
      id: 'unknown-tool-protocol-error',
      method: 'tools/call',
      params: {
        name: 'mcp_gallery_applyAlbumOperations',
        arguments: { token: 'bearer abc' },
      },
    });

    expect(response).toEqual({
      jsonrpc: '2.0',
      id: 'unknown-tool-protocol-error',
      error: {
        code: -32_602,
        message: 'Unknown tool',
        data: { toolName: 'mcp_gallery_applyAlbumOperations' },
      },
    });
  });

  it('converts unexpected service failures to redacted JSON-RPC internal errors', async () => {
    toolService.readAssetMetadata.mockRejectedValue(
      new Error('secret bearer token abc /srv/gallery/provider-request.json stacktrace'),
    );

    await expect(
      sut.handle(auth, sessionId, makeToolCallRequest(AgentToolName.ReadAssetMetadata, { assetIds: [factory.uuid()] })),
    ).resolves.toEqual({
      jsonrpc: '2.0',
      id: `${AgentToolName.ReadAssetMetadata}-call`,
      error: {
        code: -32_603,
        message: 'Internal error',
      },
    });
  });

  it('keeps service exceptions as redacted JSON-RPC internal errors', async () => {
    toolService.searchAssets.mockRejectedValue(new Error('bearer token abc /srv/gallery/internal-route'));

    await expect(sut.handle(auth, sessionId, makeToolCallRequest(AgentToolName.SearchAssets, {}))).resolves.toEqual({
      jsonrpc: '2.0',
      id: `${AgentToolName.SearchAssets}-call`,
      error: {
        code: -32_603,
        message: 'Internal error',
      },
    });
  });

  it('converts rejected retry toolCallId failures to redacted JSON-RPC internal errors', async () => {
    const toolCallId = factory.uuid();
    toolService.readAssetMetadata.mockRejectedValue(new Error('Agent tool call not found for another session'));

    await expect(
      sut.handle(auth, sessionId, makeToolCallRequest(AgentToolName.ReadAssetMetadata, { toolCallId })),
    ).resolves.toEqual({
      jsonrpc: '2.0',
      id: `${AgentToolName.ReadAssetMetadata}-call`,
      error: {
        code: -32_603,
        message: 'Internal error',
      },
    });
    expect(toolService.readAssetMetadata).toHaveBeenCalledWith(auth, sessionId, { toolCallId });
  });

  it.each(['resources/list'] as const)('returns method-not-found for %s', async (method) => {
    await expect(
      sut.handle(auth, sessionId, {
        jsonrpc: '2.0',
        id: 7,
        method,
      }),
    ).resolves.toEqual({
      jsonrpc: '2.0',
      id: 7,
      error: {
        code: -32_601,
        message: 'Method not found',
        data: { method },
      },
    });
  });

  // ── Token-opt Slice 2: preset-gated tools/list ──────────────────────────────

  describe('preset-gated tools/list (token-opt Slice 2)', () => {
    const carefulSnapshot = AgentSessionService.permissionPresets[AgentPermissionPreset.Careful];
    const localPowerUserSnapshot = AgentSessionService.permissionPresets[AgentPermissionPreset.LocalPowerUser];

    const gatedUnderCareful = [
      AgentToolName.ReadAssetOriginals,
      AgentToolName.ReadAssetPreviews,
      AgentToolName.ListSpaces,
      AgentToolName.ReadSpace,
      AgentToolName.SearchUsers,
    ] as const;

    it('returns only non-gated tools for a Careful session (5 tools hidden)', async () => {
      sessionRepository.getById.mockResolvedValue(makeSession(carefulSnapshot) as never);

      const response = (await sut.handle(
        auth,
        sessionId,
        makeToolsListRequest('tools-careful'),
      )) as AgentMcpSuccessResponse;
      const result = response.result as { tools: Array<{ name: string }> };
      const toolNames = result.tools.map((t) => t.name);

      expect(result.tools).toHaveLength(26 - gatedUnderCareful.length);
      for (const gatedName of gatedUnderCareful) {
        expect(toolNames).not.toContain(gatedName);
      }
      // Serialized payload must not include any gated tool's name field.
      const payload = JSON.stringify(result.tools);
      for (const gatedName of gatedUnderCareful) {
        expect(payload).not.toContain(`"name":"${gatedName}"`);
      }
      // Token estimate is measurably below the 26-tool baseline.
      const { tokens } = estimateCatalogTokens(result.tools);
      expect(tokens).toBeLessThan(CATALOG_TOKENS_BASELINE);
    });

    it('returns all 26 tools for a LocalPowerUser session (nothing gated)', async () => {
      sessionRepository.getById.mockResolvedValue(makeSession(localPowerUserSnapshot) as never);

      const response = (await sut.handle(
        auth,
        sessionId,
        makeToolsListRequest('tools-lpu'),
      )) as AgentMcpSuccessResponse;
      const result = response.result as { tools: Array<{ name: string }> };

      expect(result.tools).toHaveLength(26);
    });

    it('resolves the session using auth.user.id and the route sessionId', async () => {
      sessionRepository.getById.mockResolvedValue(makeSession() as never);

      await sut.handle(auth, sessionId, makeToolsListRequest('tools-resolve'));

      expect(sessionRepository.getById).toHaveBeenCalledWith(userId, sessionId);
    });

    it('throws BadRequestException for tools/list when the session is not found', async () => {
      sessionRepository.getById.mockResolvedValue(undefined as never);

      await expect(sut.handle(auth, sessionId, makeToolsListRequest('tools-invalid'))).rejects.toThrow(
        BadRequestException,
      );
    });
  });
});
