import type { AgentToolName } from 'src/enum';

export type AgentMcpArgumentMode = {
  name: string;
  description: string;
  requiredFields: string[];
  forbiddenFields: string[];
  whenToUse: string;
};

export type AgentMcpToolExample = {
  name: string;
  description: string;
  arguments: Record<string, unknown>;
};

export type AgentMcpCommonMistake = {
  id: string;
  match: {
    issuePath?: string;
    messageIncludes?: string;
    missingField?: string;
    unexpectedField?: string;
    unexpectedFields?: string[];
    requestShape?: 'json-rpc' | 'tool-arguments';
  };
  hint: string;
  exampleName?: string;
};

export type AgentMcpApprovalRetryContract = {
  field: 'toolCallId';
  instruction: string;
};

export type AgentMcpToolSafetyContract = {
  allowsDirectMutation: false;
  exposesSecrets: false;
  requiresGalleryApplyForWrites: true;
};

export type AgentMcpToolContract<TName extends AgentToolName = AgentToolName> = {
  name: TName;
  title: string;
  description: string;
  usage: string;
  argumentModes: AgentMcpArgumentMode[];
  examples: AgentMcpToolExample[];
  commonMistakes: AgentMcpCommonMistake[];
  approvalRetry?: AgentMcpApprovalRetryContract;
  safety: AgentMcpToolSafetyContract;
};

export type AgentMcpReadToolName =
  | AgentToolName.ResolveLocation
  | AgentToolName.SearchPeople
  | AgentToolName.ResolveAssetSearchFilters
  | AgentToolName.SearchAssets
  | AgentToolName.FindTripCandidates
  | AgentToolName.ReadSelectionMetadata
  | AgentToolName.CurateSelection
  | AgentToolName.ReadAssetMetadata
  | AgentToolName.ReadAssetPreviews
  | AgentToolName.ReadAssetOriginals
  | AgentToolName.ListAlbums
  | AgentToolName.ReadAlbum
  | AgentToolName.ListSpaces
  | AgentToolName.ReadSpace
  | AgentToolName.SearchUsers
  | AgentToolName.ListDuplicateGroups;

export type AgentMcpReadToolContract = AgentMcpToolContract<AgentMcpReadToolName>;

export type AgentMcpPlanningToolName =
  | AgentToolName.ProposeAlbumOperations
  | AgentToolName.ProposeAlbumFromSearch
  | AgentToolName.ProposeAddAssetsToAlbumFromSearch
  | AgentToolName.ProposeSpaceFromSearch
  | AgentToolName.ProposeAddAssetsToSpaceFromSearch
  | AgentToolName.ProposeAssetBatchFromSearch
  | AgentToolName.ProposeAlbumFromSelection
  | AgentToolName.ProposeAssetBatchFromSelection
  | AgentToolName.ReviseProposedOperations
  | AgentToolName.SummarizePlan;

export type AgentMcpPlanningToolContract = AgentMcpToolContract<AgentMcpPlanningToolName>;

export type AgentMcpValidationIssue = {
  path: string;
  message: string;
};

export type AgentMcpValidationCorrectionRequest = {
  requestShape: 'json-rpc' | 'tool-arguments';
  issues: AgentMcpValidationIssue[];
};

export type AgentMcpValidationCorrection = {
  mistakeId?: string;
  issuePath?: string;
  expected: string;
  hint: string;
  exampleArguments?: Record<string, unknown>;
};

export type AgentMcpFailureMatrixExpectedResult =
  | {
      kind: 'tool-validation';
      expectedIssuePath: string;
    }
  | {
      kind: 'protocol-error';
      expectedErrorMessage: string;
    };

export type AgentMcpFailureMatrixCase = {
  id: string;
  category:
    | 'request-wrapper'
    | 'read-retry'
    | 'read-request'
    | 'album-read'
    | 'space-read'
    | 'search'
    | 'safety'
    | 'planning-wrapper'
    | 'planning-dependency'
    | 'planning-target'
    | 'planning-payload'
    | 'planning-safety';
  description: string;
  toolName?: AgentToolName;
  request: Record<string, unknown>;
  expectedResult: AgentMcpFailureMatrixExpectedResult;
  expectedContractMistakeId?: string;
};
