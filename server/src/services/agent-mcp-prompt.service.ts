import { Injectable } from '@nestjs/common';
import { AgentOperationPlanToolRequestSchemas } from 'src/dtos/agent-operation.dto';
import { AgentReadToolRequestSchemas } from 'src/dtos/agent-tool.dto';
import { AgentToolName } from 'src/enum';
import { renderAgentMcpPromptPlaceholders } from 'src/services/agent-mcp-prompt-placeholders';
import { AgentMcpToolContractService } from 'src/services/agent-mcp-tool-contract.service';
import type {
  AgentMcpPlanningToolName,
  AgentMcpReadToolName,
  AgentMcpToolContract,
} from 'src/types/agent-mcp-contract.types';

export const AGENT_MCP_GENERATED_PROMPT_RELATIVE_PATH = 'agent-runner/src/generated/gallery-mcp-prompt-cheat-sheet.mjs';

export type AgentMcpPromptExample = {
  toolName: AgentToolName;
  piToolName: `mcp_gallery_${string}`;
  exampleName: string;
  arguments: Record<string, unknown>;
};

const promptExampleSelections = [
  { toolName: AgentToolName.ProposeAlbumFromSearch, exampleName: 'create-south-africa-pierre-aurelia-album' },
  { toolName: AgentToolName.ProposeAlbumFromSearch, exampleName: 'create-album-from-previous-search' },
  { toolName: AgentToolName.ProposeSpaceFromSearch, exampleName: 'create-space-from-declarative-search' },
  { toolName: AgentToolName.ProposeAssetBatchFromSearch, exampleName: 'favorite-search-results' },
  { toolName: AgentToolName.ResolveAssetSearchFilters, exampleName: 'resolve-named-filters' },
  { toolName: AgentToolName.SearchAssets, exampleName: 'empty-search' },
  { toolName: AgentToolName.SearchAssets, exampleName: 'bounded-date-location-search' },
  { toolName: AgentToolName.ReadSelectionMetadata, exampleName: 'read-selection-metadata-sample' },
  { toolName: AgentToolName.CurateSelection, exampleName: 'curate-metadata-highlights' },
  { toolName: AgentToolName.ReadAssetPreviews, exampleName: 'read-selected-assets' },
  { toolName: AgentToolName.ReadAssetMetadata, exampleName: 'read-selected-assets' },
  { toolName: AgentToolName.ReadAssetMetadata, exampleName: 'approved-retry' },
  { toolName: AgentToolName.ListSpaces, exampleName: 'list-visible-spaces' },
  { toolName: AgentToolName.ReadSpace, exampleName: 'read-space-details' },
  { toolName: AgentToolName.ProposeAlbumOperations, exampleName: 'create-album-and-add-assets' },
  { toolName: AgentToolName.ProposeAlbumOperations, exampleName: 'add-assets-to-existing-album' },
] as const;

@Injectable()
export class AgentMcpPromptService {
  constructor(private readonly contractService: AgentMcpToolContractService) {}

  generatePromptCheatSheet(): string {
    const examples = this.listPromptExamples();
    const contracts = this.contractService.listToolContracts();
    const toolList = contracts.map((contract) => this.toPiToolName(contract.name)).join(',');
    const albumSourceSearch = this.getPromptExample(
      examples,
      AgentToolName.ProposeAlbumFromSearch,
      'create-south-africa-pierre-aurelia-album',
    );
    const albumPreviousSearch = this.getPromptExample(
      examples,
      AgentToolName.ProposeAlbumFromSearch,
      'create-album-from-previous-search',
    );
    const spaceSourceSearch = this.getPromptExample(
      examples,
      AgentToolName.ProposeSpaceFromSearch,
      'create-space-from-declarative-search',
    );
    const batchSourceSearch = this.getPromptExample(
      examples,
      AgentToolName.ProposeAssetBatchFromSearch,
      'favorite-search-results',
    );
    const metadataContract = this.getContract(AgentToolName.ReadAssetMetadata);
    const planContract = this.getContract(AgentToolName.ProposeAlbumOperations);
    const retryMode = metadataContract.argumentModes.find((mode) => mode.name === 'approved-retry');
    const validationMistake = planContract.commonMistakes.find((mistake) => mistake.exampleName);

    return this.sanitizePrompt(
      [
        'Gallery MCP tool-use cheat sheet',
        `Tool: ${toolList}`,
        `R: Known ID filters: people, spaces, visibility, dates, albums, tags, camera fields, ratings, and media types. Use returned personIds or spaceId plus spacePersonIds; if hasMore, use nextPage as page.`,
        'Patterns: unalbumed=isNotInAlbum; 5-star videos=rating 5+type VIDEO; OCR invoice=mode ocr+query invoice; names=resolve names first.',
        'Text search: smart/ocr/description/filename require query',
        `Default write: ${albumSourceSearch.piToolName},${this.toPiToolName(AgentToolName.ProposeAddAssetsToAlbumFromSearch)},${spaceSourceSearch.piToolName},${this.toPiToolName(AgentToolName.ProposeAddAssetsToSpaceFromSearch)},${batchSourceSearch.piToolName},${this.toPiToolName(AgentToolName.ProposeAlbumFromSelection)},${this.toPiToolName(AgentToolName.ProposeAssetBatchFromSelection)}`,
        `Metadata edits reviewable: asset.updateMetadata; coordinates latitude+longitude; place names ask.`,
        `assetSource.search: ${albumSourceSearch.piToolName} ${this.formatJson({ ...albumSourceSearch.arguments, albumName: 'SA P&A' })}`,
        `previousSearch.sourceRef after inspect: ${albumPreviousSearch.piToolName} ${this.formatJson({ ...albumPreviousSearch.arguments, albumName: 'F' })}`,
        `Recoverable: wrong_id_domain needs_clarification choiceRefs.`,
        this.renderSafetyGuidance(contracts),
        this.renderApprovalRetryGuidance(metadataContract, retryMode),
        'Progressive: resolve names -> search handle {"detail":"handle"}; samples {"detail":"summary","fields":["dates","location"]}; readSelectionMetadata itemRef; readAssetMetadata legacy exact non-search IDs only; limit up to 1000; if truncated/hasMore, page/ask.',
        'Curation: handle->curateSelection targetCount strategy->selectionHandle.id/sourceRef.',
        'After curateSelection: selection tools, or proposeAlbumOperations for asset.trash, with selectionHandle.id; no asset IDs.',
        'Trip albums: findTripCandidates first;recommendation.action use_top_candidate ask_user none;generic handle->proposeAlbumFromSelection;highlights default 10->curateSelection;dup/stack excl;never asset IDs.',
        'provider planning rejects raw assetIds; assetSelectionHandleId/assetSource.selectionHandle. Gallery materializes IDs server-side; assetSource.explicitAssets rejected.',
        'Resolve names before searchAssets{"tags":["Travel"]}',
        'Resolver fidelity: copy resolvedFilters. Missing/ambiguous: ask.',
        `Shared-space people: {"filters":{"spaceId":"<space.id from listSpaces/readSpace>","spacePersonIds":["<spacePersonIds value from resolveAssetSearchFilters>"]}}`,
        'Best/highlights require bounded album/space/date/search/selection; use curateSelection for metadata-only suggested narrowing. Quality cleanup can use stored quality constraints; no preview inspection; handle->planning.',
        'Technical metadata: search handle, then readSelectionMetadata fields camera/dates/filename; readAssetMetadata legacy exact non-search IDs only.',
        `Space lookup:${this.toPiToolName(AgentToolName.ListSpaces)}->${this.toPiToolName(AgentToolName.ReadSpace)}.`,
        'Space: no matching space ask. No matching assets/no photos/none in space explain. assetIdsTruncated false exclude already in space; only remove already in space; true narrow.',
        'Details: space.updateDetails spaceName/description/color. Same name/description/color: no-op. Never update thumbnails/pets/faces/linked libraries/delete spaces.',
        `Low-level planning uses handles/sources album.create temporaryTargetId album.addAssets space.addAssets/removeAssets {"targetKind":"existing_space"}`,
        this.renderValidationRecoveryGuidance(validationMistake),
      ].join('\n'),
    );
  }

  generateAgentRunnerModule(): string {
    return [
      '// Generated by server/src/bin/sync-agent-mcp-prompt.ts; do not edit by hand.',
      `export const galleryMcpPromptCheatSheet = ${JSON.stringify(this.generatePromptCheatSheet())};`,
      '',
    ].join('\n');
  }

  listPromptExamples(): AgentMcpPromptExample[] {
    const examples = promptExampleSelections.map(({ toolName, exampleName }) => {
      const contract = this.getContract(toolName);
      const example = contract.examples.find((candidate) => candidate.name === exampleName);
      if (!example) {
        throw new Error(`Missing MCP prompt example ${exampleName} for ${toolName}`);
      }

      const promptExample = {
        toolName,
        piToolName: this.toPiToolName(toolName),
        exampleName,
        arguments: structuredClone(example.arguments),
      };

      this.validatePromptExample(promptExample);
      return promptExample;
    });

    return examples;
  }

  private getContract(toolName: AgentToolName): AgentMcpToolContract {
    const contract = this.contractService.listToolContracts().find((candidate) => candidate.name === toolName);
    if (!contract) {
      throw new Error(`Missing MCP tool contract for ${toolName}`);
    }

    return contract;
  }

  private getPromptExample(
    examples: AgentMcpPromptExample[],
    toolName: AgentToolName,
    exampleName: string,
  ): AgentMcpPromptExample {
    const example = examples.find(
      (candidate) => candidate.toolName === toolName && candidate.exampleName === exampleName,
    );
    if (!example) {
      throw new Error(`Missing selected MCP prompt example ${exampleName} for ${toolName}`);
    }

    return example;
  }

  private validatePromptExample(example: AgentMcpPromptExample) {
    if (example.toolName in AgentReadToolRequestSchemas) {
      AgentReadToolRequestSchemas[example.toolName as AgentMcpReadToolName].parse(example.arguments);
      return;
    }

    AgentOperationPlanToolRequestSchemas[example.toolName as AgentMcpPlanningToolName].parse(example.arguments);
  }

  private toPiToolName(toolName: AgentToolName): `mcp_gallery_${string}` {
    return `mcp_gallery_${toolName}`;
  }

  private formatJson(value: unknown): string {
    return JSON.stringify(renderAgentMcpPromptPlaceholders(this.compactPromptValue(value)));
  }

  private compactPromptValue(value: unknown): unknown {
    if (value && typeof value === 'object' && !Array.isArray(value) && 'assetSource' in value) {
      const { albumName, spaceName, albumId, spaceId, action, assetSource } = value as Record<string, unknown>;
      const compactAssetSource =
        assetSource && typeof assetSource === 'object' && !Array.isArray(assetSource)
          ? Object.fromEntries(Object.entries(assetSource).filter(([fieldName]) => fieldName !== 'materialization'))
          : assetSource;

      return Object.fromEntries(
        Object.entries({
          albumName,
          spaceName,
          albumId,
          spaceId,
          action,
          assetSource: compactAssetSource,
        }).filter(([, fieldValue]) => fieldValue !== undefined),
      );
    }

    if (!value || typeof value !== 'object' || !('operations' in value)) {
      return value;
    }

    const plan = value as { operations?: unknown[] };
    if (!Array.isArray(plan.operations)) {
      return value;
    }

    return {
      operations: plan.operations.map((operation) => {
        if (!operation || typeof operation !== 'object') {
          return operation;
        }

        const { type, targetKind, targetId, temporaryTargetId, assetIds, assetSelectionHandleId, payload } =
          operation as Record<string, unknown>;

        return Object.fromEntries(
          Object.entries({
            type,
            targetKind,
            targetId,
            temporaryTargetId,
            assetIds,
            assetSelectionHandleId,
            payload:
              payload && typeof payload === 'object' && !Array.isArray(payload) && Object.keys(payload).length > 0
                ? payload
                : undefined,
          }).filter(([, fieldValue]) => fieldValue !== undefined),
        );
      }),
    };
  }

  private renderApprovalRetryGuidance(
    contract: AgentMcpToolContract,
    retryMode: AgentMcpToolContract['argumentModes'][number] | undefined,
  ): string {
    if (!contract.approvalRetry || !retryMode) {
      throw new Error(`Missing MCP prompt approval retry contract for ${contract.name}`);
    }

    return `${contract.approvalRetry.instruction} Retry uses only <approved-toolCallId>; omit old request fields: ${retryMode.forbiddenFields.join(', ')}.`;
  }

  private renderSafetyGuidance(contracts: AgentMcpToolContract[]): string {
    const unsafeContract = contracts.find(
      (contract) => contract.safety.allowsDirectMutation || !contract.safety.requiresGalleryApplyForWrites,
    );
    if (unsafeContract) {
      throw new Error(`MCP prompt cannot render direct-mutation tool ${unsafeContract.name}`);
    }

    return 'No direct apply/write; Gallery applies after review.';
  }

  private renderValidationRecoveryGuidance(
    mistake: AgentMcpToolContract['commonMistakes'][number] | undefined,
  ): string {
    if (!mistake?.exampleName) {
      throw new Error('Missing MCP prompt validation recovery mistake with example guidance');
    }

    return `retry once if correction is obvious; exampleArguments; retry with corrected arguments. Retry mcp_gallery_proposeAlbumOperations with exact <selectionHandle.id from searchAssets>. approval-required pauses. Not an internal Gallery issue on first failure; if corrected retry fails again, explain missing/blocked. ${mistake.hint}`;
  }

  private sanitizePrompt(prompt: string): string {
    const unsafePatterns = [
      /bearer\s+[a-z0-9._~+/-]+=*/i,
      /provider-key/i,
      /stack trace/i,
      /(^|\s)\/(?:home|tmp|var|usr|etc)\//,
      /\/agent\/internal\/mcp/i,
    ];

    const matchedPattern = unsafePatterns.find((pattern) => pattern.test(prompt));
    if (matchedPattern) {
      throw new Error(`Generated MCP prompt contains unsafe content matching ${matchedPattern}`);
    }

    return prompt;
  }
}
