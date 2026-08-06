import { AgentPermissionPreset, AgentProviderType } from 'src/enum';

export type AgentCredentialSnapshot = {
  id: string;
  providerType: AgentProviderType;
  label: string;
  baseUrl: string | null;
  models: string[];
  defaultModel: string | null;
};

export type AgentModelSnapshot = {
  providerCredentialId: string;
  model: string;
};

export type AgentRunnerCapabilitiesSnapshot = Record<string, unknown> | null;

export type AgentWorkflowStateSnapshot = object | null;

export type AgentPermissionPlanSnapshot = {
  read: {
    metadata: boolean;
    previews: boolean;
    originals: boolean;
  };
  providerExposure: {
    metadata: boolean;
    previews: boolean;
    originals: boolean;
    allowOriginalsForExternalProviders: boolean;
  };
  assetScope: {
    owned: boolean;
    sharedSpaces: boolean;
    locked: boolean;
  };
  writeScope: {
    createAlbum: boolean;
    addAssets: boolean;
    removeAssets?: boolean;
    updateDetails: boolean;
    setCover: boolean;
    createSpace?: boolean;
    addAssetsToSpaces?: boolean;
    removeAssetsFromSpaces?: boolean;
    updateSpaceDetails?: boolean;
    addMembersToSpaces?: boolean;
    removeMembersFromSpaces?: boolean;
    updateSpaceMemberRoles?: boolean;
    editAssets?: boolean;
    favoriteAssets?: boolean;
    archiveAssets?: boolean;
    tagAssets?: boolean;
    updateAssetMetadata?: boolean;
    trashAssets?: boolean;
    createSharedLinks?: boolean;
    shareAlbums?: boolean;
    lockAssets?: boolean;
    deleteContainers?: boolean;
    manageStacks?: boolean;
    managePeople?: boolean;
  };
  limits: {
    maxAssetsPerToolCall: number;
    maxAssetsPerSession: number;
    maxPreviewsPerToolCall: number;
    maxPreviewsPerSession?: number;
    maxOriginalsPerToolCall: number;
    maxOriginalsPerSession?: number;
    expiresInMinutes: number | null;
  };
};

export type AgentNormalizedPermissionPlanSnapshot = Omit<AgentPermissionPlanSnapshot, 'writeScope'> & {
  writeScope: {
    createAlbum: boolean;
    addAssets: boolean;
    removeAssets: boolean;
    updateDetails: boolean;
    setCover: boolean;
    createSpace: boolean;
    addAssetsToSpaces: boolean;
    removeAssetsFromSpaces: boolean;
    updateSpaceDetails: boolean;
    addMembersToSpaces: boolean;
    removeMembersFromSpaces: boolean;
    updateSpaceMemberRoles: boolean;
    editAssets: boolean;
    favoriteAssets: boolean;
    archiveAssets: boolean;
    tagAssets: boolean;
    updateAssetMetadata: boolean;
    trashAssets: boolean;
    createSharedLinks: boolean;
    shareAlbums: boolean;
    lockAssets: boolean;
    deleteContainers: boolean;
    manageStacks: boolean;
    managePeople: boolean;
  };
};

export type AgentInitialContextSnapshot = Record<string, unknown>;

export type AgentPermissionPresetMap = Record<
  Exclude<AgentPermissionPreset, AgentPermissionPreset.Custom>,
  AgentPermissionPlanSnapshot
>;
