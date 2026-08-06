import { BadRequestException, Injectable } from '@nestjs/common';
import { serverVersion } from 'src/constants';
import { AgentOperationPlanToolRequestSchemas } from 'src/dtos/agent-operation.dto';
import type {
  AgentCurateSelectionToolRequestDto,
  AgentFindTripCandidatesToolRequestDto,
  AgentListAlbumsToolRequestDto,
  AgentListDuplicateGroupsToolRequestDto,
  AgentListSpacesToolRequestDto,
  AgentReadAlbumToolRequestDto,
  AgentReadAssetMetadataToolRequestDto,
  AgentReadAssetOriginalsToolRequestDto,
  AgentReadAssetPreviewsToolRequestDto,
  AgentReadSelectionMetadataToolRequestDto,
  AgentReadSpaceToolRequestDto,
  AgentResolveAssetSearchFiltersToolRequestDto,
  AgentResolveLocationToolRequestDto,
  AgentSearchAssetsToolRequestDto,
  AgentSearchPeopleToolRequestDto,
  AgentSearchUsersToolRequestDto,
} from 'src/dtos/agent-tool.dto';
import { AgentReadToolRequestSchemas } from 'src/dtos/agent-tool.dto';
import type { AuthDto } from 'src/dtos/auth.dto';
import { AgentToolName } from 'src/enum';
import { AgentSessionRepository } from 'src/repositories/agent-session.repository';
import { isAgentMcpRecoverableToolError } from 'src/services/agent-mcp-recoverable-tool-error';
import { AgentMcpToolContractService } from 'src/services/agent-mcp-tool-contract.service';
import { AgentMcpToolRegistryService } from 'src/services/agent-mcp-tool-registry.service';
import { AgentOperationPlanService } from 'src/services/agent-operation-plan.service';
import { AgentToolService } from 'src/services/agent-tool.service';
import type { AgentMcpPlanningToolName } from 'src/types/agent-mcp-contract.types';
import type {
  AgentMcpErrorResponse,
  AgentMcpHandleResponse,
  AgentMcpInitializeResult,
  AgentMcpRecoverableToolErrorContent,
  AgentMcpRequestId,
  AgentMcpSuccessResponse,
  AgentMcpToolCallResult,
  AgentMcpToolValidationErrorContent,
} from 'src/types/agent-mcp.types';
import type { z } from 'zod';

const MCP_PROTOCOL_VERSION = '2025-11-25';
const MCP_TOOL_TEXT_MAX_CHARS = 500;

type AgentMcpRequest = {
  jsonrpc: '2.0';
  id: AgentMcpRequestId;
  method: string;
  params?: unknown;
};

type AgentMcpValidationIssue = { path: string; message: string };

type AgentMcpInvokeToolOptions<TDto> = {
  preValidate?: (args: Record<string, unknown>) => AgentMcpValidationIssue[];
  mapResult?: (result: unknown, dto: TDto) => unknown;
};

type AgentPlanningToolDto<TToolName extends keyof typeof AgentOperationPlanToolRequestSchemas> = z.output<
  (typeof AgentOperationPlanToolRequestSchemas)[TToolName]
>;

@Injectable()
export class AgentMcpService {
  private readonly readToolNames = new Set<AgentToolName>([
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
    AgentToolName.SearchPeople,
  ]);

  private readonly planningToolNames = new Set<AgentToolName>([
    AgentToolName.ProposeAlbumOperations,
    AgentToolName.ProposeAlbumFromSearch,
    AgentToolName.ProposeAlbumFromSelection,
    AgentToolName.ProposeAddAssetsToAlbumFromSearch,
    AgentToolName.ProposeSpaceFromSearch,
    AgentToolName.ProposeAddAssetsToSpaceFromSearch,
    AgentToolName.ProposeAssetBatchFromSearch,
    AgentToolName.ProposeAssetBatchFromSelection,
    AgentToolName.ReviseProposedOperations,
    AgentToolName.SummarizePlan,
  ]);

  constructor(
    private readonly toolRegistry: AgentMcpToolRegistryService,
    private readonly toolContractService: AgentMcpToolContractService,
    private readonly toolService: AgentToolService,
    private readonly operationPlanService: AgentOperationPlanService,
    private readonly sessionRepository: AgentSessionRepository,
  ) {}

  async handle(auth: AuthDto, sessionId: string, request: unknown): Promise<AgentMcpHandleResponse> {
    if (Array.isArray(request)) {
      return this.error(null, -32_600, 'Batch requests are not supported');
    }

    if (this.isInitializedNotification(request)) {
      return;
    }

    if (!this.isRequest(request)) {
      return this.error(null, -32_600, 'Invalid Request');
    }

    if (request.method === 'initialize') {
      return this.success(request.id, this.initializeResult());
    }

    if (request.method === 'tools/list') {
      const session = await this.sessionRepository.getById(auth.user.id, sessionId);
      if (!session) {
        throw new BadRequestException('Agent session not found');
      }
      return this.success(request.id, {
        tools: this.toolRegistry.listTools(session.permissionPlanSnapshot),
      });
    }

    if (request.method === 'tools/call') {
      return this.handleToolCall(auth, sessionId, request);
    }

    return this.error(request.id, -32_601, 'Method not found', { method: request.method });
  }

  private isInitializedNotification(request: unknown): boolean {
    if (!request || typeof request !== 'object') {
      return false;
    }

    const { jsonrpc, id, method } = request as Record<string, unknown>;
    return jsonrpc === '2.0' && id === undefined && method === 'notifications/initialized';
  }

  private isRequest(request: unknown): request is AgentMcpRequest {
    if (!request || typeof request !== 'object') {
      return false;
    }

    const { jsonrpc, id, method } = request as Record<string, unknown>;
    return jsonrpc === '2.0' && (typeof id === 'string' || typeof id === 'number') && typeof method === 'string';
  }

  private async handleToolCall(
    auth: AuthDto,
    sessionId: string,
    request: AgentMcpRequest,
  ): Promise<AgentMcpSuccessResponse | AgentMcpErrorResponse> {
    const params = request.params;
    if (!params || typeof params !== 'object' || Array.isArray(params)) {
      return this.error(request.id, -32_602, 'Invalid params');
    }

    const { name, arguments: args } = params as Record<string, unknown>;
    if (typeof name !== 'string') {
      return this.error(request.id, -32_602, 'Invalid params');
    }

    if (!this.isKnownToolName(name)) {
      return this.error(request.id, -32_602, 'Unknown tool', { toolName: name });
    }

    if (this.isPlanningToolName(name)) {
      return this.handlePlanningToolCall(auth, sessionId, request.id, name, args);
    }

    if (!this.isReadToolName(name)) {
      return this.error(request.id, -32_602, 'Unknown tool', { toolName: name });
    }

    return this.invokeTool(request.id, name, args, AgentReadToolRequestSchemas[name], (dto) =>
      this.callReadTool(auth, sessionId, name, dto),
    );
  }

  private isKnownToolName(name: string): name is AgentToolName {
    return Object.values(AgentToolName).includes(name as AgentToolName);
  }

  private isReadToolName(name: AgentToolName): name is keyof typeof AgentReadToolRequestSchemas {
    return this.readToolNames.has(name);
  }

  private isPlanningToolName(name: AgentToolName): name is keyof typeof AgentOperationPlanToolRequestSchemas {
    return this.planningToolNames.has(name);
  }

  private isPlanningCorrectionToolName(name: AgentToolName): name is AgentMcpPlanningToolName {
    return (
      name === AgentToolName.ProposeAlbumOperations ||
      name === AgentToolName.ProposeAlbumFromSearch ||
      name === AgentToolName.ProposeAddAssetsToAlbumFromSearch ||
      name === AgentToolName.ProposeSpaceFromSearch ||
      name === AgentToolName.ProposeAddAssetsToSpaceFromSearch ||
      name === AgentToolName.ProposeAssetBatchFromSearch ||
      name === AgentToolName.ReviseProposedOperations ||
      name === AgentToolName.SummarizePlan
    );
  }

  private async invokeTool<TDto>(
    id: AgentMcpRequestId,
    toolName: AgentToolName,
    args: unknown,
    schema: z.ZodType<TDto>,
    delegate: (dto: TDto) => Promise<unknown>,
    options: AgentMcpInvokeToolOptions<TDto> = {},
  ): Promise<AgentMcpSuccessResponse | AgentMcpErrorResponse> {
    const argumentValidation = this.validateToolArguments(args);
    if (!argumentValidation.valid) {
      return this.success(id, this.argumentErrorResult(toolName, argumentValidation.path, argumentValidation.message));
    }

    const preValidationIssues = options.preValidate?.(argumentValidation.value) ?? [];
    if (preValidationIssues.length > 0) {
      return this.success(id, this.validationIssuesResult(toolName, preValidationIssues, 'tool-arguments'));
    }

    const parseResult = schema.safeParse(argumentValidation.value);
    if (!parseResult.success) {
      return this.success(id, this.validationErrorResult(toolName, parseResult.error));
    }

    try {
      const result = await delegate(parseResult.data);
      return this.success(
        id,
        this.toolResult(options.mapResult ? options.mapResult(result, parseResult.data) : result),
      );
    } catch (error) {
      if (isAgentMcpRecoverableToolError(error)) {
        return this.success(id, this.recoverableToolErrorResult(error.content));
      }

      return this.error(id, -32_603, 'Internal error');
    }
  }

  private invokePlanningTool<TDto>(
    id: AgentMcpRequestId,
    toolName: keyof typeof AgentOperationPlanToolRequestSchemas,
    args: unknown,
    delegate: (dto: TDto) => Promise<unknown>,
  ) {
    return this.invokeTool(
      id,
      toolName,
      args,
      AgentOperationPlanToolRequestSchemas[toolName] as unknown as z.ZodType<TDto>,
      delegate,
      {
        preValidate: (value) => this.providerFacingPlanningArgumentIssues(value),
        mapResult: (result) => this.redactProviderFacingPlanningResult(result),
      },
    );
  }

  private async handlePlanningToolCall(
    auth: AuthDto,
    sessionId: string,
    id: AgentMcpRequestId,
    toolName: keyof typeof AgentOperationPlanToolRequestSchemas,
    args: unknown,
  ): Promise<AgentMcpSuccessResponse | AgentMcpErrorResponse> {
    switch (toolName) {
      case AgentToolName.ProposeAlbumOperations: {
        return this.invokePlanningTool<AgentPlanningToolDto<AgentToolName.ProposeAlbumOperations>>(
          id,
          toolName,
          args,
          (dto) => this.operationPlanService.proposeAlbumOperations(auth, sessionId, dto),
        );
      }
      case AgentToolName.ProposeAlbumFromSearch: {
        return this.invokePlanningTool<AgentPlanningToolDto<AgentToolName.ProposeAlbumFromSearch>>(
          id,
          toolName,
          args,
          (dto) => this.operationPlanService.proposeAlbumFromSearch(auth, sessionId, dto),
        );
      }
      case AgentToolName.ProposeAlbumFromSelection: {
        return this.invokePlanningTool<AgentPlanningToolDto<AgentToolName.ProposeAlbumFromSelection>>(
          id,
          toolName,
          args,
          (dto) => this.operationPlanService.proposeAlbumFromSelection(auth, sessionId, dto),
        );
      }
      case AgentToolName.ProposeAddAssetsToAlbumFromSearch: {
        return this.invokePlanningTool<AgentPlanningToolDto<AgentToolName.ProposeAddAssetsToAlbumFromSearch>>(
          id,
          toolName,
          args,
          (dto) => this.operationPlanService.proposeAddAssetsToAlbumFromSearch(auth, sessionId, dto),
        );
      }
      case AgentToolName.ProposeSpaceFromSearch: {
        return this.invokePlanningTool<AgentPlanningToolDto<AgentToolName.ProposeSpaceFromSearch>>(
          id,
          toolName,
          args,
          (dto) => this.operationPlanService.proposeSpaceFromSearch(auth, sessionId, dto),
        );
      }
      case AgentToolName.ProposeAddAssetsToSpaceFromSearch: {
        return this.invokePlanningTool<AgentPlanningToolDto<AgentToolName.ProposeAddAssetsToSpaceFromSearch>>(
          id,
          toolName,
          args,
          (dto) => this.operationPlanService.proposeAddAssetsToSpaceFromSearch(auth, sessionId, dto),
        );
      }
      case AgentToolName.ProposeAssetBatchFromSearch: {
        return this.invokePlanningTool<AgentPlanningToolDto<AgentToolName.ProposeAssetBatchFromSearch>>(
          id,
          toolName,
          args,
          (dto) => this.operationPlanService.proposeAssetBatchFromSearch(auth, sessionId, dto),
        );
      }
      case AgentToolName.ProposeAssetBatchFromSelection: {
        return this.invokePlanningTool<AgentPlanningToolDto<AgentToolName.ProposeAssetBatchFromSelection>>(
          id,
          toolName,
          args,
          (dto) => this.operationPlanService.proposeAssetBatchFromSelection(auth, sessionId, dto),
        );
      }
      case AgentToolName.ReviseProposedOperations: {
        return this.invokePlanningTool<AgentPlanningToolDto<AgentToolName.ReviseProposedOperations>>(
          id,
          toolName,
          args,
          (dto) => {
            const { planId, ...body } = dto;
            return this.operationPlanService.reviseProposedOperations(auth, sessionId, planId, body);
          },
        );
      }
      case AgentToolName.SummarizePlan: {
        return this.invokePlanningTool<AgentPlanningToolDto<AgentToolName.SummarizePlan>>(id, toolName, args, (dto) => {
          const { planId, ...body } = dto;
          return this.operationPlanService.summarizePlan(auth, sessionId, planId, body);
        });
      }
    }
  }

  private providerFacingPlanningArgumentIssues(args: Record<string, unknown>): AgentMcpValidationIssue[] {
    const operations = Array.isArray(args.operations) ? args.operations : [];
    const topLevelIssues = this.providerFacingExplicitAssetSourceIssue(args.assetSource, 'assetSource');
    const operationIssues = operations.flatMap((operation, index) => {
      const record = this.recordValue(operation);
      if (!record) {
        return [];
      }

      const issues: AgentMcpValidationIssue[] = [];
      if (Array.isArray(record.assetIds)) {
        issues.push({
          path: `operations.${index}.assetIds`,
          message:
            'Provider-facing planning calls must use selection handles or declarative asset sources instead of raw assetIds. Use assetSelectionHandleId, assetSource.selectionHandle, assetSource.previousSearch, or assetSource.search.',
        });
      }

      issues.push(
        ...this.providerFacingExplicitAssetSourceIssue(record.assetSource, `operations.${index}.assetSource`),
      );

      return issues;
    });

    return [...topLevelIssues, ...operationIssues];
  }

  private providerFacingExplicitAssetSourceIssue(value: unknown, path: string): AgentMcpValidationIssue[] {
    const assetSource = this.recordValue(value);
    if (assetSource?.kind !== 'explicitAssets') {
      return [];
    }

    return [
      {
        path,
        message:
          'assetSource.explicitAssets is not available in provider-facing planning. Use assetSelectionHandleId, assetSource.selectionHandle, assetSource.previousSearch, or assetSource.search.',
      },
    ];
  }

  private redactProviderFacingPlanningResult(result: unknown): unknown {
    const content = this.recordValue(result);
    const plan = this.recordValue(content?.plan);
    if (!content || !plan || !Array.isArray(plan.operations)) {
      return result;
    }

    let redacted = false;
    const operations = plan.operations.map((operation) => {
      const redactedOperation = this.redactProviderFacingPlanningOperation(operation);
      redacted ||= redactedOperation !== operation;
      return redactedOperation;
    });
    if (!redacted) {
      return result;
    }

    return {
      ...content,
      plan: {
        ...plan,
        operations,
      },
    };
  }

  private redactProviderFacingPlanningOperation(operation: unknown): unknown {
    const record = this.recordValue(operation);
    if (!record) {
      return operation;
    }

    const { assetIds, result, reviewMetadata, ...rest } = record;
    const redactedResult = this.redactProviderFacingPlanningOperationResult(result);
    const redactedReviewMetadata = this.redactProviderFacingPlanningReviewMetadata(reviewMetadata);
    if (!Array.isArray(assetIds) && redactedResult === result && redactedReviewMetadata === reviewMetadata) {
      return operation;
    }

    return {
      ...rest,
      ...(redactedReviewMetadata === undefined ? {} : { reviewMetadata: redactedReviewMetadata }),
      ...(Array.isArray(assetIds) ? { assetCount: assetIds.length } : {}),
      result: redactedResult,
    };
  }

  private redactProviderFacingPlanningOperationResult(result: unknown): unknown {
    const record = this.recordValue(result);
    if (!record) {
      return result;
    }

    const { assetIds, assetId, assetResults, reviewMetadata, ...rest } = record;
    const assetCount = Array.isArray(assetIds) ? assetIds.length : typeof assetId === 'string' ? 1 : undefined;
    const assetResultsCount = Array.isArray(assetResults) ? assetResults.length : undefined;
    const redactedReviewMetadata = this.redactProviderFacingPlanningReviewMetadata(reviewMetadata);
    if (assetCount === undefined && assetResultsCount === undefined && redactedReviewMetadata === reviewMetadata) {
      return result;
    }

    return {
      ...rest,
      ...(redactedReviewMetadata === undefined ? {} : { reviewMetadata: redactedReviewMetadata }),
      ...(assetCount === undefined ? {} : { assetCount }),
      ...(assetResultsCount === undefined ? {} : { assetResultsCount }),
    };
  }

  private redactProviderFacingPlanningReviewMetadata(reviewMetadata: unknown): unknown {
    const record = this.recordValue(reviewMetadata);
    if (!record) {
      return reviewMetadata;
    }

    const assetMetadata = this.recordValue(record.assetMetadata);
    if (!assetMetadata) {
      return reviewMetadata;
    }

    const redactedAssetMetadata = this.redactProviderFacingPlanningAssetMetadata(assetMetadata);
    if (redactedAssetMetadata === assetMetadata) {
      return reviewMetadata;
    }

    return {
      ...record,
      assetMetadata: redactedAssetMetadata,
    };
  }

  private redactProviderFacingPlanningAssetMetadata(assetMetadata: Record<string, unknown>): Record<string, unknown> {
    const { sampleAssetIds, fields, ...rest } = assetMetadata;
    let redacted = false;

    const redactedFields = Array.isArray(fields)
      ? fields.map((field) => {
          const redactedField = this.redactProviderFacingPlanningReviewField(field);
          redacted ||= redactedField !== field;
          return redactedField;
        })
      : fields;
    if (Array.isArray(sampleAssetIds)) {
      redacted = true;
    }

    if (!redacted) {
      return assetMetadata;
    }

    return {
      ...rest,
      ...(Array.isArray(sampleAssetIds) ? { sampleAssetCount: sampleAssetIds.length } : {}),
      ...(fields === undefined ? {} : { fields: redactedFields }),
    };
  }

  private redactProviderFacingPlanningReviewField(field: unknown): unknown {
    const record = this.recordValue(field);
    if (!record || !Array.isArray(record.previousValues)) {
      return field;
    }

    let redacted = false;
    const previousValues = record.previousValues.map((previousValue) => {
      const previousValueRecord = this.recordValue(previousValue);
      if (!previousValueRecord || !('assetId' in previousValueRecord)) {
        return previousValue;
      }

      const { assetId: _assetId, ...rest } = previousValueRecord;
      redacted = true;
      return rest;
    });

    if (!redacted) {
      return field;
    }

    return {
      ...record,
      previousValues,
    };
  }

  private async callReadTool(
    auth: AuthDto,
    sessionId: string,
    toolName: keyof typeof AgentReadToolRequestSchemas,
    dto: z.output<(typeof AgentReadToolRequestSchemas)[keyof typeof AgentReadToolRequestSchemas]>,
  ): Promise<unknown> {
    switch (toolName) {
      case AgentToolName.ResolveAssetSearchFilters: {
        return this.toolService.resolveAssetSearchFilters(
          auth,
          sessionId,
          dto as AgentResolveAssetSearchFiltersToolRequestDto,
        );
      }
      case AgentToolName.ResolveLocation: {
        return this.toolService.resolveLocation(auth, sessionId, dto as AgentResolveLocationToolRequestDto);
      }
      case AgentToolName.SearchAssets: {
        return this.toolService.searchAssets(auth, sessionId, dto as AgentSearchAssetsToolRequestDto);
      }
      case AgentToolName.FindTripCandidates: {
        return this.toolService.findTripCandidates(auth, sessionId, dto as AgentFindTripCandidatesToolRequestDto);
      }
      case AgentToolName.ReadSelectionMetadata: {
        return this.toolService.readSelectionMetadata(auth, sessionId, dto as AgentReadSelectionMetadataToolRequestDto);
      }
      case AgentToolName.CurateSelection: {
        return this.toolService.curateSelection(auth, sessionId, dto as AgentCurateSelectionToolRequestDto);
      }
      case AgentToolName.ReadAssetMetadata: {
        return this.toolService.readAssetMetadata(auth, sessionId, dto as AgentReadAssetMetadataToolRequestDto);
      }
      case AgentToolName.ReadAssetPreviews: {
        return this.toolService.readAssetPreviews(auth, sessionId, dto as AgentReadAssetPreviewsToolRequestDto);
      }
      case AgentToolName.ReadAssetOriginals: {
        return this.toolService.readAssetOriginals(auth, sessionId, dto as AgentReadAssetOriginalsToolRequestDto);
      }
      case AgentToolName.ListAlbums: {
        return this.toolService.listAlbums(auth, sessionId, dto as AgentListAlbumsToolRequestDto);
      }
      case AgentToolName.ReadAlbum: {
        return this.toolService.readAlbum(auth, sessionId, dto as AgentReadAlbumToolRequestDto);
      }
      case AgentToolName.ListSpaces: {
        return this.toolService.listSpaces(auth, sessionId, dto as AgentListSpacesToolRequestDto);
      }
      case AgentToolName.ReadSpace: {
        return this.toolService.readSpace(auth, sessionId, dto as AgentReadSpaceToolRequestDto);
      }
      case AgentToolName.SearchUsers: {
        return this.toolService.searchUsers(auth, sessionId, dto as AgentSearchUsersToolRequestDto);
      }
      case AgentToolName.ListDuplicateGroups: {
        return this.toolService.listDuplicateGroups(auth, sessionId, dto as AgentListDuplicateGroupsToolRequestDto);
      }
      case AgentToolName.SearchPeople: {
        return this.toolService.searchPeople(auth, sessionId, dto as AgentSearchPeopleToolRequestDto);
      }
    }
  }

  private toolResult(structuredContent: unknown): AgentMcpToolCallResult {
    return {
      content: [{ type: 'text', text: this.toolResultText(structuredContent) }],
      structuredContent,
    };
  }

  private toolResultText(structuredContent: unknown): string {
    const content = this.recordValue(structuredContent);
    const summary = this.nonEmptyString(content?.summary);
    if (summary) {
      return this.compactToolText(summary);
    }

    if (content?.status === 'approval-required') {
      const requestSummary = this.nonEmptyString(this.recordValue(content.toolCall)?.requestSummary);
      return this.compactToolText(requestSummary ? `Approval required: ${requestSummary}` : 'Approval required.');
    }

    if (content?.status === 'denied') {
      const reason = this.nonEmptyString(content.reason);
      return this.compactToolText(reason ? `Tool call denied: ${reason}` : 'Tool call denied.');
    }

    if (content?.status === 'error') {
      const error = this.nonEmptyString(content.error) ?? 'Tool error';
      const firstIssue = this.firstValidationIssueText(content);
      const hint = this.nonEmptyString(content.hint);
      return this.compactToolText(firstIssue ? `${error}: ${firstIssue}` : hint ? `${error}: ${hint}` : error);
    }

    return 'Tool result returned.';
  }

  private firstValidationIssueText(content: Record<string, unknown>): string | undefined {
    const issues = content.issues;
    if (!Array.isArray(issues)) {
      return;
    }

    const firstIssue = this.recordValue(issues[0]);
    if (!firstIssue) {
      return;
    }

    const path = this.nonEmptyString(firstIssue.path);
    const message = this.nonEmptyString(firstIssue.message);
    return [path, message].filter((value): value is string => value !== undefined).join(': ') || undefined;
  }

  private recordValue(value: unknown): Record<string, unknown> | undefined {
    return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : undefined;
  }

  private nonEmptyString(value: unknown): string | undefined {
    return typeof value === 'string' && value.trim().length > 0 ? value : undefined;
  }

  private compactToolText(text: string): string {
    if (text.length <= MCP_TOOL_TEXT_MAX_CHARS) {
      return text;
    }

    return `${text.slice(0, MCP_TOOL_TEXT_MAX_CHARS - 3)}...`;
  }

  private validateToolArguments(
    args: unknown,
  ): { valid: true; value: Record<string, unknown> } | { valid: false; path: string; message: string } {
    if (args === undefined) {
      return { valid: false, path: 'arguments', message: 'arguments is required' };
    }

    if (!args || typeof args !== 'object' || Array.isArray(args)) {
      return { valid: false, path: 'arguments', message: 'arguments must be an object' };
    }

    return { valid: true, value: args as Record<string, unknown> };
  }

  private normalizeValidationIssues(
    issues: readonly { path: readonly unknown[]; message: string }[],
  ): { path: string; message: string }[] {
    return issues.map((issue) => ({
      path: issue.path.join('.'),
      message: issue.message,
    }));
  }

  private sanitizeIssueMessage(message: string): string {
    if (/unrecognized key/i.test(message)) {
      return 'Unexpected field in arguments';
    }

    return message
      .replaceAll(/bearer\s+[a-z0-9._-]+/gi, 'bearer [redacted]')
      .replaceAll(/\/(?:api|srv)\/[^\s"']+/gi, '[redacted-path]')
      .replaceAll(/provider-key/gi, '[redacted-secret]');
  }

  private validationErrorResult(toolName: AgentToolName, error: z.ZodError): AgentMcpToolCallResult {
    return this.validationIssuesResult(toolName, this.normalizeValidationIssues(error.issues), 'tool-arguments');
  }

  private recoverableToolErrorResult(content: AgentMcpRecoverableToolErrorContent): AgentMcpToolCallResult {
    return {
      ...this.toolResult(content),
      isError: true,
    };
  }

  private validationCorrectionFor(
    toolName: AgentToolName,
    issues: readonly { path: string; message: string }[],
    requestShape: 'json-rpc' | 'tool-arguments',
  ) {
    const request = {
      requestShape,
      issues: issues.map((issue) => ({ path: issue.path, message: issue.message })),
    };

    if (this.isReadToolName(toolName)) {
      return this.toolContractService.getReadToolValidationCorrection(toolName, request);
    }

    if (this.isPlanningCorrectionToolName(toolName)) {
      return this.toolContractService.getPlanningToolValidationCorrection(toolName, request);
    }

    return;
  }

  private validationIssuesResult(
    toolName: AgentToolName,
    issues: readonly { path: string; message: string }[],
    requestShape: 'json-rpc' | 'tool-arguments',
  ): AgentMcpToolCallResult {
    const correction = this.validationCorrectionFor(toolName, issues, requestShape);
    const structuredContent: AgentMcpToolValidationErrorContent = {
      status: 'error',
      error: 'Invalid tool arguments',
      toolName,
      retryable: true,
      issues: issues.map((issue) => ({
        path: issue.path,
        message: this.sanitizeIssueMessage(issue.message),
        ...(correction?.hint && correction.issuePath === issue.path ? { hint: correction.hint } : {}),
      })),
      ...(correction?.expected ? { expected: correction.expected } : {}),
      ...(correction?.hint ? { hint: correction.hint } : {}),
      ...(correction?.exampleArguments ? { exampleArguments: correction.exampleArguments } : {}),
    };

    return {
      ...this.toolResult(structuredContent),
      isError: true,
    };
  }

  private argumentErrorResult(toolName: AgentToolName, path: string, message: string): AgentMcpToolCallResult {
    return this.validationIssuesResult(toolName, [{ path, message }], 'json-rpc');
  }

  private initializeResult(): AgentMcpInitializeResult {
    return {
      protocolVersion: MCP_PROTOCOL_VERSION,
      serverInfo: {
        name: 'gallery-agent-mcp',
        version: serverVersion.toString(),
      },
      capabilities: {
        tools: {},
      },
    };
  }

  private success(id: AgentMcpRequestId, result: unknown): AgentMcpSuccessResponse {
    return {
      jsonrpc: '2.0',
      id,
      result,
    };
  }

  private error(id: AgentMcpRequestId | null, code: number, message: string, data?: unknown): AgentMcpErrorResponse {
    return {
      jsonrpc: '2.0',
      id,
      error: {
        code,
        message,
        ...(data === undefined ? {} : { data }),
      },
    };
  }
}
