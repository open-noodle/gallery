import { Injectable } from '@nestjs/common';
import { AgentOperationPlanToolRequestSchemas } from 'src/dtos/agent-operation.dto';
import { AgentReadToolRequestSchemas } from 'src/dtos/agent-tool.dto';
import { AgentToolName } from 'src/enum';
import { AgentMcpToolContractService } from 'src/services/agent-mcp-tool-contract.service';
import type { AgentMcpArgumentMode, AgentMcpToolContract } from 'src/types/agent-mcp-contract.types';
import type { AgentMcpToolAnnotations, AgentMcpToolDefinition } from 'src/types/agent-mcp.types';
import type { AgentPermissionPlanSnapshot } from 'src/types/agent-session.types';
import z, { type ZodType } from 'zod';

const readToolAnnotations = {
  readOnlyHint: true,
  destructiveHint: false,
  idempotentHint: false,
  openWorldHint: false,
} as const satisfies AgentMcpToolAnnotations;

const planningToolAnnotations = {
  readOnlyHint: false,
  destructiveHint: false,
  idempotentHint: false,
  openWorldHint: false,
} as const satisfies AgentMcpToolAnnotations;

type AgentMcpToolDefinitionInput = Omit<AgentMcpToolDefinition, 'inputSchema'> & {
  schema: ZodType;
};

const isJsonObject = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === 'object' && !Array.isArray(value);

const stripSchemaDescriptions = (value: unknown): void => {
  if (Array.isArray(value)) {
    for (const item of value) {
      stripSchemaDescriptions(item);
    }
    return;
  }
  if (!isJsonObject(value)) {
    return;
  }
  const record = value as Record<string, unknown>;
  // Only delete description annotations (strings). Property schemas that happen
  // to have a key named "description" (e.g. asset updateMetadata payload) are objects
  // and must not be removed.
  if (typeof record.description === 'string') {
    delete record.description;
  }
  for (const nested of Object.values(record)) {
    stripSchemaDescriptions(nested);
  }
};

const toInputSchema = (schema: ZodType): Record<string, unknown> => {
  const inputSchema = {
    ...(z.toJSONSchema(schema, { target: 'draft-2020-12', io: 'input' }) as Record<string, unknown>),
  };
  delete inputSchema['~standard'];
  stripSchemaDescriptions(inputSchema);

  if (inputSchema.type !== 'object') {
    throw new Error('MCP tool inputSchema must be a JSON object schema');
  }

  return inputSchema;
};

const defineTool = ({ schema, ...tool }: AgentMcpToolDefinitionInput): AgentMcpToolDefinition => ({
  ...tool,
  inputSchema: toInputSchema(schema),
});

const providerForbiddenAssetSourceRefs = new Set(['#/$defs/AgentExplicitAssetsAssetSourceInput']);

const isProviderForbiddenRef = (value: unknown) =>
  isJsonObject(value) && typeof value.$ref === 'string' && providerForbiddenAssetSourceRefs.has(value.$ref);

const pruneProviderPlanningSchemaValue = (value: unknown): void => {
  if (Array.isArray(value)) {
    for (let index = value.length - 1; index >= 0; index--) {
      if (isProviderForbiddenRef(value[index])) {
        value.splice(index, 1);
      } else {
        pruneProviderPlanningSchemaValue(value[index]);
      }
    }
    return;
  }

  if (!isJsonObject(value)) {
    return;
  }

  const properties = value.properties;
  if (isJsonObject(properties)) {
    delete properties.assetIds;
  }

  if (Array.isArray(value.required)) {
    value.required = value.required.filter((field) => field !== 'assetIds');
  }

  for (const nestedValue of Object.values(value)) {
    pruneProviderPlanningSchemaValue(nestedValue);
  }
};

const toProviderFacingPlanningInputSchema = (inputSchema: Record<string, unknown>): Record<string, unknown> => {
  const providerSchema = structuredClone(inputSchema);
  pruneProviderPlanningSchemaValue(providerSchema);

  if (isJsonObject(providerSchema.$defs)) {
    delete providerSchema.$defs.AgentExplicitAssetsAssetSourceInput;
  }

  return providerSchema;
};

const cloneTool = (tool: AgentMcpToolDefinition): AgentMcpToolDefinition => structuredClone(tool);
const approvedRequestInstruction =
  ' If approval is required, Gallery may ask the user; after approval, continue the approved request by calling this tool with toolCallId.';

const propertyDescriptions = {
  assetIds:
    'legacy exact non-search asset IDs for read tools. For provider-facing planning, raw assetIds are internal materialized plan fields and rejected as inputs. Use assetSelectionHandleId, assetSource.selectionHandle, assetSource.previousSearch, or assetSource.search so Gallery materializes IDs server-side.',
  assetSelectionHandleId:
    'Provider-facing planning handle input. Pass selectionHandle.id returned by searchAssets or curateSelection; Gallery materializes IDs server-side instead of the provider sending raw assetIds.',
  selectionHandleId:
    'The selectionHandle.id returned by searchAssets or curateSelection. Use this for readSelectionMetadata, curateSelection, and handle-backed planning instead of copying search asset IDs.',
  targetCount: 'Number of assets to select into a derived selection handle. Use 1 to 1000.',
  strategy:
    'Curation strategy: metadata-highlights, date-spread, favorites-first, or cover-candidate. Metadata-only; quality constraints use stored objective scores only.',
  criteria: 'Optional user-facing criteria text to record in criteriaSummary for selection curation.',
  constraints:
    'Optional metadata-only curation constraints for media types, favorites, minimum rating, video exclusion, stored quality thresholds (maxSharpness/maxBrightness/maxQuality), and date/location/tag diversification.',
  albumId: 'Existing album id returned by listAlbums/readAlbum.',
  albumName: 'Album name to create or exact visible album name to resolve.',
  spaceId: 'Existing shared space id returned by listSpaces/readSpace.',
  spaceName: 'Shared space name to create or exact visible shared space name to resolve.',
  description: 'Optional album or shared space description.',
  color: 'Optional shared space color.',
  people: 'Visible person names to resolve into searchAssets personIds.',
  tags: 'Visible tag names to resolve into searchAssets tagIds.',
  albums: 'Visible album names to resolve into searchAssets albumIds.',
  spaces: 'Visible shared space names to resolve into searchAssets spaceId.',
  cameraMakes: 'Visible camera make names to resolve into the canonical searchAssets make value.',
  cameraModels: 'Visible camera model names to resolve into the canonical searchAssets model value.',
  lensModels: 'Visible lens names to resolve into the canonical searchAssets lensModel value.',
  scope: 'Optional search scope for resolving names, such as a visible space or shared-space inclusion.',
  mode: 'Search mode. Use metadata for structured filters, or smart, description, ocr, or filename with query.',
  query:
    'Query text. For searchAssets, use this with smart, description, ocr, or filename modes; for searchUsers use a name or email.',
  filters:
    'Currently executable filters include taken date, place, camera, favorite, rating, album, tag, media, people, space, visibility, and shared-space person fields.',
  limit: 'Maximum number of results to return. Defaults to 100 and accepts a positive integer up to 10000.',
  page: 'One-based result page. Use the returned nextPage value as page to continue the same search with the same mode, query, filters, order, and limit.',
  order: 'Result order. Only desc is currently executable.',
  detail:
    'Result detail level. For searchAssets, handle returns selectionHandle/sourceRef and compact counts, summary adds a compact sample, and metadata returns metadata rows for bounded inspection; legacy ids requests still parse but are not the advertised search path. For readAssetMetadata, use basic, descriptive, technical, or allSafe metadata presets.',
  fields:
    'Optional metadata field groups for summary samples, metadata rows, itemRef samples, or legacy readAssetMetadata custom reads: type, dates, location, camera, tags, rating, filename, favorite, visibility.',
  sampleSize: 'Maximum summary or selection metadata sample rows from 0 to 25. Use 0 to disable samples.',
  placeHint:
    'Optional place label such as a country, state, or city. Matching is metadata-only; no geocoding is performed.',
  targetDate: 'Optional ISO date-time used as the recent-trip lookback anchor. Defaults to now.',
  lookbackDays: 'How far back to search for trip candidates. Defaults to 180 and accepts 1 to 365.',
  maxCandidates: 'Maximum trip candidates to return. Defaults to 3 and accepts 1 to 10.',
  toolCallId: 'Use only for an approved retry after Gallery approves a pending read request.',
  summary: 'A human-readable plan summary describing what Gallery should review.',
  operations: 'The reviewable Gallery operations to propose or revise. Do not apply changes directly.',
  assetSource:
    'Preferred provider-facing planning source object. Use assetSource.selectionHandle, assetSource.search, or assetSource.previousSearch; assetSource.explicitAssets is internal-only and rejected for provider-facing planning.',
  action: 'One constrained asset batch action to propose from a search source.',
  planId: 'The id of an existing proposed plan returned by Gallery.',
  feedback: 'Optional user feedback explaining how to revise the existing plan.',
  focus: 'An optional summary focus, such as risks, selected changes, or skipped operations.',
} as const satisfies Record<string, string>;

const toArgumentModeMetadata = (mode: AgentMcpArgumentMode, omitProviderRejectedRawIds = false) => ({
  name: mode.name,
  description: mode.description,
  requiredFields: mode.requiredFields,
  forbiddenFields: omitProviderRejectedRawIds
    ? mode.forbiddenFields.filter((field) => field !== 'assetIds')
    : mode.forbiddenFields,
  whenToUse: mode.whenToUse,
});

const enrichToolFromContract = (
  tool: AgentMcpToolDefinition,
  contract: AgentMcpToolContract,
): AgentMcpToolDefinition => {
  const inputSchema = structuredClone(tool.inputSchema);
  inputSchema.description = `${contract.description} ${contract.usage}`;
  const properties = inputSchema.properties;

  if (properties && typeof properties === 'object' && !Array.isArray(properties)) {
    for (const [field, description] of Object.entries(propertyDescriptions)) {
      const property = (properties as Record<string, unknown>)[field];

      if (property && typeof property === 'object' && !Array.isArray(property)) {
        (property as Record<string, unknown>).description = description;
      }
    }
  }

  inputSchema.examples = contract.examples.map((example) => structuredClone(example.arguments));
  const omitProviderRejectedRawIds =
    tool.name === AgentToolName.ProposeAlbumFromSelection || tool.name === AgentToolName.ProposeAssetBatchFromSelection;
  inputSchema['x-gallery-argumentModes'] = contract.argumentModes.map((mode) =>
    toArgumentModeMetadata(mode, omitProviderRejectedRawIds),
  );

  return {
    ...tool,
    title: contract.title,
    description: `${contract.description} ${contract.usage} Modes: ${contract.argumentModes
      .map((mode) => `${mode.name}: ${mode.whenToUse}`)
      .join(' ')}${contract.approvalRetry ? approvedRequestInstruction : ''}`,
    inputSchema,
  };
};

const getToolContract = (
  contractsByName: ReadonlyMap<AgentToolName, AgentMcpToolContract>,
  toolName: AgentToolName,
): AgentMcpToolContract => {
  const contract = contractsByName.get(toolName);

  if (!contract) {
    throw new Error(`Missing MCP tool contract for ${toolName}`);
  }

  return contract;
};

const buildTools = (contractsByName: ReadonlyMap<AgentToolName, AgentMcpToolContract>): AgentMcpToolDefinition[] =>
  [
    defineTool({
      name: AgentToolName.ResolveLocation,
      title: 'Resolve location',
      description: `Forward-geocode a place name to coordinates using the geodata_places database.${approvedRequestInstruction}`,
      schema: AgentReadToolRequestSchemas[AgentToolName.ResolveLocation],
      annotations: readToolAnnotations,
    }),
    defineTool({
      name: AgentToolName.SearchPeople,
      title: 'Search people',
      description: `Resolve a person by name to an id; returns matched / ambiguous (candidate list) / not_found. Scrubbed: id, name, thumbnail asset id — no face data.${approvedRequestInstruction}`,
      schema: AgentReadToolRequestSchemas[AgentToolName.SearchPeople],
      annotations: readToolAnnotations,
    }),
    defineTool({
      name: AgentToolName.ResolveAssetSearchFilters,
      title: 'Resolve asset search filters',
      description: `Resolve user-facing names into searchAssets-compatible filter ids and values.${approvedRequestInstruction}`,
      schema: AgentReadToolRequestSchemas[AgentToolName.ResolveAssetSearchFilters],
      annotations: readToolAnnotations,
    }),
    defineTool({
      name: AgentToolName.SearchAssets,
      title: 'Search assets',
      description: `Search the photo library by mode, metadata filters, text query, page, order, and result limit.${approvedRequestInstruction}`,
      schema: AgentReadToolRequestSchemas[AgentToolName.SearchAssets],
      annotations: readToolAnnotations,
    }),
    defineTool({
      name: AgentToolName.FindTripCandidates,
      title: 'Find trip candidates',
      description: `Find likely recent trip candidates and return album-ready selection handles.${approvedRequestInstruction}`,
      schema: AgentReadToolRequestSchemas[AgentToolName.FindTripCandidates],
      annotations: readToolAnnotations,
    }),
    defineTool({
      name: AgentToolName.ReadSelectionMetadata,
      title: 'Read selection metadata',
      description: `Read aggregate counts and bounded itemRef metadata samples for a search selection handle.${approvedRequestInstruction}`,
      schema: AgentReadToolRequestSchemas[AgentToolName.ReadSelectionMetadata],
      annotations: readToolAnnotations,
    }),
    defineTool({
      name: AgentToolName.CurateSelection,
      title: 'Curate selection',
      description: `Create a derived selection handle from metadata-only ranking and diversification.${approvedRequestInstruction}`,
      schema: AgentReadToolRequestSchemas[AgentToolName.CurateSelection],
      annotations: readToolAnnotations,
    }),
    defineTool({
      name: AgentToolName.ReadAssetMetadata,
      title: 'Read asset metadata',
      description: `Read metadata for selected assets, including timestamps, location labels, camera fields, rating, favorites, visibility, and tags.${approvedRequestInstruction}`,
      schema: AgentReadToolRequestSchemas[AgentToolName.ReadAssetMetadata],
      annotations: readToolAnnotations,
    }),
    defineTool({
      name: AgentToolName.ReadAssetPreviews,
      title: 'Read asset previews',
      description: `Read preview media references for selected assets after Gallery approval when approval is required.${approvedRequestInstruction}`,
      schema: AgentReadToolRequestSchemas[AgentToolName.ReadAssetPreviews],
      annotations: readToolAnnotations,
    }),
    defineTool({
      name: AgentToolName.ReadAssetOriginals,
      title: 'Read asset originals',
      description: `Read original media references for selected assets after Gallery approval when approval is required.${approvedRequestInstruction}`,
      schema: AgentReadToolRequestSchemas[AgentToolName.ReadAssetOriginals],
      annotations: readToolAnnotations,
    }),
    defineTool({
      name: AgentToolName.ListAlbums,
      title: 'List albums',
      description: `List albums visible to the authenticated session user.${approvedRequestInstruction}`,
      schema: AgentReadToolRequestSchemas[AgentToolName.ListAlbums],
      annotations: readToolAnnotations,
    }),
    defineTool({
      name: AgentToolName.ReadAlbum,
      title: 'Read album',
      description: `Read one visible album with its summary fields and asset identifiers.${approvedRequestInstruction}`,
      schema: AgentReadToolRequestSchemas[AgentToolName.ReadAlbum],
      annotations: readToolAnnotations,
    }),
    defineTool({
      name: AgentToolName.ListSpaces,
      title: 'List spaces',
      description: `List shared spaces visible to the authenticated session user.${approvedRequestInstruction}`,
      schema: AgentReadToolRequestSchemas[AgentToolName.ListSpaces],
      annotations: readToolAnnotations,
    }),
    defineTool({
      name: AgentToolName.ReadSpace,
      title: 'Read space',
      description: `Read one visible shared space with summary fields, member summaries, and bounded asset identifiers.${approvedRequestInstruction}`,
      schema: AgentReadToolRequestSchemas[AgentToolName.ReadSpace],
      annotations: readToolAnnotations,
    }),
    defineTool({
      name: AgentToolName.SearchUsers,
      title: 'Search users',
      description: `Search Gallery users visible to the authenticated session user before proposing shared-space member changes.${approvedRequestInstruction}`,
      schema: AgentReadToolRequestSchemas[AgentToolName.SearchUsers],
      annotations: readToolAnnotations,
    }),
    defineTool({
      name: AgentToolName.ListDuplicateGroups,
      title: 'List duplicate groups',
      description: `List near-duplicate photo groups (CLIP-embedding detection) with the fields needed to choose a keeper; read-only.${approvedRequestInstruction}`,
      schema: AgentReadToolRequestSchemas[AgentToolName.ListDuplicateGroups],
      annotations: readToolAnnotations,
    }),
    defineTool({
      name: AgentToolName.ProposeAlbumFromSearch,
      title: 'Propose album from search',
      description: 'Preferred album-from-search workflow that creates a reviewable plan.',
      schema: AgentOperationPlanToolRequestSchemas[AgentToolName.ProposeAlbumFromSearch],
      annotations: planningToolAnnotations,
    }),
    defineTool({
      name: AgentToolName.ProposeAddAssetsToAlbumFromSearch,
      title: 'Propose add assets to album from search',
      description: 'Preferred workflow for adding search matches to an existing album as a reviewable plan.',
      schema: AgentOperationPlanToolRequestSchemas[AgentToolName.ProposeAddAssetsToAlbumFromSearch],
      annotations: planningToolAnnotations,
    }),
    defineTool({
      name: AgentToolName.ProposeSpaceFromSearch,
      title: 'Propose space from search',
      description: 'Preferred space-from-search workflow that creates a reviewable plan.',
      schema: AgentOperationPlanToolRequestSchemas[AgentToolName.ProposeSpaceFromSearch],
      annotations: planningToolAnnotations,
    }),
    defineTool({
      name: AgentToolName.ProposeAddAssetsToSpaceFromSearch,
      title: 'Propose add assets to space from search',
      description: 'Preferred workflow for adding search matches to an existing shared space as a reviewable plan.',
      schema: AgentOperationPlanToolRequestSchemas[AgentToolName.ProposeAddAssetsToSpaceFromSearch],
      annotations: planningToolAnnotations,
    }),
    defineTool({
      name: AgentToolName.ProposeAssetBatchFromSearch,
      title: 'Propose asset batch from search',
      description: 'Preferred workflow for favorite, archive, tag, or rotate actions on matching photos.',
      schema: AgentOperationPlanToolRequestSchemas[AgentToolName.ProposeAssetBatchFromSearch],
      annotations: planningToolAnnotations,
    }),
    defineTool({
      name: AgentToolName.ProposeAlbumFromSelection,
      title: 'Propose album from selection',
      description: 'Preferred workflow for creating an album from an existing selection handle as a reviewable plan.',
      schema: AgentOperationPlanToolRequestSchemas[AgentToolName.ProposeAlbumFromSelection],
      annotations: planningToolAnnotations,
    }),
    defineTool({
      name: AgentToolName.ProposeAssetBatchFromSelection,
      title: 'Propose asset batch from selection',
      description: 'Preferred workflow for favorite, archive, tag, metadata, or rotate actions on a selection handle.',
      schema: AgentOperationPlanToolRequestSchemas[AgentToolName.ProposeAssetBatchFromSelection],
      annotations: planningToolAnnotations,
    }),
    defineTool({
      name: AgentToolName.ProposeAlbumOperations,
      title: 'Propose album operations',
      description: 'Create a proposed album operation plan for user review without applying gallery changes.',
      schema: AgentOperationPlanToolRequestSchemas[AgentToolName.ProposeAlbumOperations],
      annotations: planningToolAnnotations,
    }),
    defineTool({
      name: AgentToolName.ReviseProposedOperations,
      title: 'Revise proposed operations',
      description: 'Create a revised album operation plan from feedback without applying gallery changes.',
      schema: AgentOperationPlanToolRequestSchemas[AgentToolName.ReviseProposedOperations],
      annotations: planningToolAnnotations,
    }),
    defineTool({
      name: AgentToolName.SummarizePlan,
      title: 'Summarize plan',
      description: 'Summarize the current proposed album operation plan for user review.',
      schema: AgentOperationPlanToolRequestSchemas[AgentToolName.SummarizePlan],
      annotations: planningToolAnnotations,
    }),
  ].map((tool) => {
    const planningTool = Object.hasOwn(AgentOperationPlanToolRequestSchemas, tool.name);
    const providerTool = planningTool
      ? { ...tool, inputSchema: toProviderFacingPlanningInputSchema(tool.inputSchema) }
      : tool;

    return Object.hasOwn(AgentReadToolRequestSchemas, tool.name) || planningTool
      ? enrichToolFromContract(providerTool, getToolContract(contractsByName, tool.name))
      : providerTool;
  });

@Injectable()
export class AgentMcpToolRegistryService {
  private readonly tools: AgentMcpToolDefinition[];

  constructor(private readonly contractService: AgentMcpToolContractService) {
    const contractsByName = new Map(
      this.contractService.listToolContracts().map((contract) => [contract.name, contract]),
    );
    this.tools = buildTools(contractsByName);
  }

  listTools(snapshot?: AgentPermissionPlanSnapshot): AgentMcpToolDefinition[] {
    const cloned = this.tools.map((tool) => cloneTool(tool));
    if (!snapshot) {
      return cloned;
    }
    const drop = new Set<AgentToolName>();
    if (!snapshot.read.originals) {
      drop.add(AgentToolName.ReadAssetOriginals);
    }
    if (!snapshot.read.previews) {
      drop.add(AgentToolName.ReadAssetPreviews);
    }
    if (!snapshot.assetScope.sharedSpaces) {
      drop.add(AgentToolName.ListSpaces);
      drop.add(AgentToolName.ReadSpace);
      drop.add(AgentToolName.SearchUsers);
    }
    return cloned.filter((tool) => !drop.has(tool.name));
  }
}
