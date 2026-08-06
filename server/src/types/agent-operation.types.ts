import {
  AgentOperationPlanStatus,
  AgentOperationRiskLevel,
  AgentOperationStatus,
  AgentOperationTargetKind,
  AgentOperationType,
} from 'src/enum';
import { AgentAssetSourceInput } from 'src/types/agent-asset-source.types';

export type AgentOperationPayload = Record<string, unknown>;

export type AgentOperationAssetResult = {
  id: string;
  success: boolean;
  error?: string;
  errorMessage?: string;
};

export type AgentOperationReviewMetadataValueKind = 'known' | 'empty' | 'clear' | 'relative' | 'unknown';

export type AgentOperationReviewMetadata = {
  assetMetadata?: {
    fields: Array<{
      key: string;
      label: string;
      previousValues: Array<{
        assetId: string;
        value: string | null;
        valueKind: AgentOperationReviewMetadataValueKind;
      }>;
      proposedValue: string | null;
      proposedValueKind: AgentOperationReviewMetadataValueKind;
    }>;
    sampleAssetIds: string[];
    warnings: string[];
  };
};

export type AgentOperationResult = {
  albumId?: string;
  spaceId?: string;
  tagId?: string;
  personId?: string;
  assetIds?: string[];
  userIds?: string[];
  skippedUserIds?: string[];
  assetResults?: AgentOperationAssetResult[];
  skippedReason?: string;
  reviewMetadata?: AgentOperationReviewMetadata;
};

export type AgentAlbumOperationInput = {
  type: AgentOperationType;
  summary: string;
  targetKind: AgentOperationTargetKind;
  targetId?: string;
  temporaryTargetId?: string;
  assetSource?: AgentAssetSourceInput;
  assetIds?: string[];
  assetSelectionHandleId?: string;
  payload?: AgentOperationPayload;
  dependencyIds?: string[];
  riskLevel: AgentOperationRiskLevel;
  enabled: boolean;
};

export type AgentOperationPlanCreate = {
  sessionId: string;
  revision: number;
  status: AgentOperationPlanStatus;
  summary: string;
};

export type AgentOperationCreate = {
  planId: string;
  type: AgentOperationType;
  summary: string;
  targetKind: AgentOperationTargetKind;
  targetId: string | null;
  temporaryTargetId: string | null;
  assetIds: string[];
  payload: AgentOperationPayload;
  dependencyIds: string[];
  riskLevel: AgentOperationRiskLevel;
  enabled: boolean;
  status: AgentOperationStatus;
  result: AgentOperationResult | null;
  error: string | null;
};
