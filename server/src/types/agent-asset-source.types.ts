import { AssetType, AssetVisibility } from 'src/enum';
import type {
  AgentResolvedAssetSearchFilterResult,
  AgentSearchAssetsFilters,
  AgentSearchAssetsMode,
  AgentSearchAssetsOrder,
} from 'src/types/agent-tool.types';

export type AgentAssetSourceKind = 'search' | 'previousSearch' | 'selectionHandle' | 'explicitAssets';

export type AgentSourceRef = `asset-source:${'search' | 'selection'}:${string}`;
export type AgentSearchSourceRef = `asset-source:search:${string}`;

export type AgentSourceResolutionStatus = 'success' | 'needs_clarification' | 'recoverable_error' | 'denied';

export type AgentDeclarativeNameMatch = 'any' | 'all';

export type AgentAssetSourceMaterialization = 'bounded-page' | 'all-matches-with-limit';

export type AgentDeclarativeNamedFilter = {
  match: AgentDeclarativeNameMatch;
  names: string[];
  choiceRefs?: string[];
};

export type AgentDeclarativeAssetFilters = {
  takenAfter?: string;
  takenBefore?: string;
  country?: string | null;
  city?: string | null;
  state?: string | null;
  people?: AgentDeclarativeNamedFilter;
  tags?: AgentDeclarativeNamedFilter;
  albums?: AgentDeclarativeNamedFilter;
  space?: {
    name: string;
  };
  camera?: {
    make?: string;
    model?: string;
    lensModel?: string;
  };
  rating?: number | null;
  isFavorite?: boolean;
  isNotInAlbum?: boolean;
  type?: AssetType;
  visibility?: AssetVisibility;
  withSharedSpaces?: boolean;
};

export type AgentDeclarativeAssetFilterResolution =
  | {
      status: 'success';
      filters: AgentSearchAssetsFilters;
      results: AgentResolvedAssetSearchFilterResult[];
    }
  | {
      status: 'needs_clarification';
      filters: AgentSearchAssetsFilters;
      results: AgentResolvedAssetSearchFilterResult[];
      message: string;
    }
  | {
      status: 'denied';
      filters: AgentSearchAssetsFilters;
      results: AgentResolvedAssetSearchFilterResult[];
      reason: string;
    };

export type AgentAssetSourceInput =
  | {
      kind: 'search';
      mode?: AgentSearchAssetsMode;
      query?: string;
      filters?: AgentDeclarativeAssetFilters;
      order?: AgentSearchAssetsOrder;
      limit?: number;
      page?: number;
      materialization?: AgentAssetSourceMaterialization;
    }
  | {
      kind: 'previousSearch';
      sourceRef: AgentSearchSourceRef;
    }
  | {
      kind: 'selectionHandle';
      selectionHandleId: string;
    }
  | {
      kind: 'explicitAssets';
      assetIds: string[];
    };

export type AgentIdDomain =
  | 'asset'
  | 'person'
  | 'album'
  | 'space'
  | 'tag'
  | 'selectionHandle'
  | 'sourceRef'
  | 'unknown';

export type AgentIdDomainLookup = Partial<
  Record<Exclude<AgentIdDomain, 'unknown'>, ReadonlySet<string> | readonly string[]>
>;

export const AGENT_ID_DOMAIN_LOOKUP_FIELDS = [
  'asset',
  'person',
  'album',
  'space',
  'tag',
  'selectionHandle',
  'sourceRef',
] as const satisfies readonly Exclude<AgentIdDomain, 'unknown'>[];

export const classifyAgentIdDomainFromLookup = (
  id: string | null | undefined,
  lookup: AgentIdDomainLookup,
): AgentIdDomain => {
  if (!id) {
    return 'unknown';
  }

  const matches = AGENT_ID_DOMAIN_LOOKUP_FIELDS.filter((domain) => lookupContainsId(lookup[domain], id));

  return matches.length === 1 ? matches[0] : 'unknown';
};

export const AGENT_ASSET_SOURCE_MECHANISM_FIELDS = ['assetSource', 'assetIds', 'assetSelectionHandleId'] as const;

export type AgentAssetSourceMechanismField = (typeof AGENT_ASSET_SOURCE_MECHANISM_FIELDS)[number];

export type AgentAssetSourceMechanismInput = Partial<{
  assetSource: AgentAssetSourceInput;
  assetIds: readonly string[];
  assetSelectionHandleId: string;
}>;

export type AgentAssetSourceMechanismCountValidation =
  | {
      valid: true;
      mechanism: AgentAssetSourceMechanismField;
      fields: AgentAssetSourceMechanismField[];
    }
  | {
      valid: false;
      reason: 'missing_source_mechanism' | 'multiple_source_mechanisms';
      fields: AgentAssetSourceMechanismField[];
      message: 'Provide exactly one of assetSource, assetIds, or assetSelectionHandleId';
    };

export type AgentNoAssetSourceMechanismValidation =
  | {
      valid: true;
      fields: AgentAssetSourceMechanismField[];
    }
  | {
      valid: false;
      reason: 'unexpected_source_mechanism';
      fields: AgentAssetSourceMechanismField[];
      message: 'Omit assetSource, assetIds, and assetSelectionHandleId for operations that do not operate on assets';
    };

export const getAgentAssetSourceMechanismFields = (
  input: AgentAssetSourceMechanismInput,
): AgentAssetSourceMechanismField[] =>
  AGENT_ASSET_SOURCE_MECHANISM_FIELDS.filter((field) => input[field] !== undefined && input[field] !== null);

export const countAgentAssetSourceMechanisms = (input: AgentAssetSourceMechanismInput) =>
  getAgentAssetSourceMechanismFields(input).length;

export const validateAgentAssetSourceMechanismCount = (
  input: AgentAssetSourceMechanismInput,
): AgentAssetSourceMechanismCountValidation => {
  const fields = getAgentAssetSourceMechanismFields(input);

  if (fields.length === 1) {
    return { valid: true, mechanism: fields[0], fields };
  }

  return {
    valid: false,
    reason: fields.length === 0 ? 'missing_source_mechanism' : 'multiple_source_mechanisms',
    fields,
    message: 'Provide exactly one of assetSource, assetIds, or assetSelectionHandleId',
  };
};

export const validateNoAgentAssetSourceMechanisms = (
  input: AgentAssetSourceMechanismInput,
): AgentNoAssetSourceMechanismValidation => {
  const fields = getAgentAssetSourceMechanismFields(input);

  if (fields.length === 0) {
    return { valid: true, fields };
  }

  return {
    valid: false,
    reason: 'unexpected_source_mechanism',
    fields,
    message: 'Omit assetSource, assetIds, and assetSelectionHandleId for operations that do not operate on assets',
  };
};

const lookupContainsId = (values: ReadonlySet<string> | readonly string[] | undefined, id: string) => {
  if (!values) {
    return false;
  }

  if (Array.isArray(values)) {
    return values.includes(id);
  }

  return (values as ReadonlySet<string>).has(id);
};
