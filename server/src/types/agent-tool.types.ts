import { AgentProviderType, AssetType, AssetVisibility } from 'src/enum';
import type {
  AgentDeclarativeAssetFilters,
  AgentIdDomain,
  AgentSearchSourceRef,
} from 'src/types/agent-asset-source.types';

export type AgentToolProviderSnapshot = {
  providerCredentialId: string | null;
  providerType: AgentProviderType;
  label: string;
  baseUrl: string | null;
  model: string;
};

export type AgentToolReadAssetMetadataRequestMetadata = AgentToolReadAssetIdsRequestMetadata & {
  detail?: AgentAssetMetadataDetail;
  fields?: AgentAssetMetadataField[];
};

export type AgentToolReadAssetMetadataResponseMetadata = AgentToolResponseIdsMetadata;

export type AgentToolReadSelectionMetadataRequestMetadata = {
  selectionHandleId: string;
  fields: AgentAssetMetadataField[];
  sampleSize: number;
};

export type AgentCurateSelectionStrategy =
  | 'metadata-highlights'
  | 'date-spread'
  | 'favorites-first'
  | 'cover-candidate';

export type AgentCurateSelectionDiversifyBy = 'date' | 'location' | 'people' | 'tags';

export type AgentCurateSelectionConstraints = {
  types?: Array<'IMAGE' | 'VIDEO'>;
  includeFavorites?: boolean;
  minRating?: number;
  excludeVideos?: boolean;
  diversifyBy?: AgentCurateSelectionDiversifyBy[];
  maxSharpness?: number;
  maxBrightness?: number;
  maxQuality?: number;
};

export type AgentToolCurateSelectionRequestMetadata = {
  selectionHandleId: string;
  targetCount: number;
  strategy: AgentCurateSelectionStrategy;
  criteria?: string;
  constraints: AgentCurateSelectionConstraints;
  sampleSize: number;
};

export type AgentReadSelectionMetadataCounts = {
  assets: number;
  sampled: number;
};

export type AgentSearchAssetsMode = 'metadata' | 'smart' | 'description' | 'ocr' | 'filename';

export type AgentSearchAssetsOrder = 'asc' | 'desc' | 'relevance';

export type AgentSearchAssetsRequestDetail = 'ids' | 'handle' | 'summary' | 'metadata';

export type AgentSearchAssetsDetail = 'handle' | 'summary' | 'metadata';

export type AgentSearchAssetsField =
  | 'type'
  | 'dates'
  | 'location'
  | 'camera'
  | 'tags'
  | 'rating'
  | 'filename'
  | 'favorite'
  | 'visibility';

export type AgentAssetMetadataDetail = 'basic' | 'descriptive' | 'technical' | 'allSafe';

export type AgentAssetMetadataField = AgentSearchAssetsField | 'quality';

export type AgentToolSearchAssetsRequestMetadata = {
  mode: AgentSearchAssetsMode;
  query?: string;
  filters: AgentSearchAssetsFilters;
  limit: number;
  page: number;
  order?: AgentSearchAssetsOrder;
  detail: AgentSearchAssetsRequestDetail;
  fields: AgentSearchAssetsField[];
  sampleSize?: number;
  createSelectionHandle?: boolean;
};

export type AgentToolFindTripCandidatesRequestMetadata = {
  placeHint?: string;
  targetDate?: Date;
  lookbackDays: number;
  maxCandidates: number;
};

export type AgentSearchAssetsSelectionHandle = {
  id: string;
  assetCount: number;
  sampleAssetIds: string[];
  sourceToolCallId: string | null;
  expiresAt: Date;
};

export type AgentSearchAssetsSelectionHandleResult = {
  id: string;
  sourceRef: AgentSearchSourceRef;
  assetCount: number;
  sourceToolCallId: string | null;
  expiresAt: Date;
};

export type AgentSearchAssetsSampleItem = {
  itemRef: string;
  type?: AssetType;
  originalFileName?: string;
  localDateTime?: Date;
  fileCreatedAt?: Date;
  fileModifiedAt?: Date;
  isFavorite?: boolean;
  visibility?: AssetVisibility;
  exifInfo?: AgentSearchAssetExif | null;
  tags?: Array<{ value: string; color: string | null }>;
};

export type AgentSearchAssetsSample = {
  sampleSize: number;
  items: AgentSearchAssetsSampleItem[];
};

export type AgentResolveAssetSearchFiltersScope = {
  spaceId?: string;
  withSharedSpaces?: boolean;
  takenAfter?: Date;
  takenBefore?: Date;
};

export type AgentToolResolveAssetSearchFiltersRequestMetadata = {
  people?: string[];
  tags?: string[];
  albums?: string[];
  spaces?: string[];
  cameraMakes?: string[];
  cameraModels?: string[];
  lensModels?: string[];
  scope?: AgentResolveAssetSearchFiltersScope;
};

export type AgentToolReadAssetIdsRequestMetadata = {
  assetIds: string[];
};

export type AgentToolReadAlbumRequestMetadata = {
  albumId: string;
};

export type AgentToolListAlbumsRequestMetadata = Record<string, never>;

export type AgentToolReadSpaceRequestMetadata = {
  spaceId: string;
};

export type AgentToolListSpacesRequestMetadata = Record<string, never>;

export type AgentToolListDuplicateGroupsRequestMetadata = Record<string, never>;

export type AgentDuplicateAsset = {
  id: string;
  originalFileName: string;
  fileCreatedAt: Date;
  isFavorite: boolean;
  rating: number | null;
  width: number | null;
  height: number | null;
  sharpness: number | null;
};

export type AgentDuplicateGroup = {
  duplicateId: string;
  assets: AgentDuplicateAsset[];
};

export type AgentToolSearchUsersRequestMetadata = {
  query: string;
  limit: number;
};

export type AgentToolResultSize = {
  returnedItems: number;
  hasMore: boolean;
  nextPage: string | null;
  estimatedBytes: number | null;
  truncated: boolean;
  omittedFields: string[];
};

export type AgentToolResponseIdsMetadata = {
  assetIds?: string[];
  albumIds?: string[];
  spaceIds?: string[];
  tagIds?: string[];
  personIds?: string[];
  spacePersonIds?: string[];
  userIds?: string[];
  selectionHandleIds?: string[];
  sourceRefs?: AgentSearchSourceRef[];
  selectionHandleAssetCount?: number;
  resultSize?: AgentToolResultSize;
};

export type AgentToolOperationPlanRequestMetadata = {
  planId?: string;
  operationCount: number;
  operationTypes: string[];
  albumIds: string[];
  spaceIds?: string[];
  tagIds?: string[];
  userIds?: string[];
  assetIds: string[];
  assetCount?: number;
  assetIdsSample?: string[];
  attemptedSelectionHandleIds?: string[];
  selectionHandles?: Array<{
    id?: string;
    assetCount: number;
    sampleAssetIds: string[];
    sourceKind?: 'selectionHandle' | 'previousSearch' | 'search';
    sourceRef?: AgentSearchSourceRef;
    declarativeFilters?: AgentDeclarativeAssetFilters;
    resolvedFilters?: AgentSearchAssetsFilters;
  }>;
  sourceSummaries?: Array<{
    sourceKind: 'selectionHandle' | 'previousSearch' | 'search';
    selectionHandleId?: string;
    sourceRef?: AgentSearchSourceRef;
    assetCount: number;
    sampleAssetCount: number;
    filterKeys?: string[];
    resolvedFilterKeys?: string[];
  }>;
};

export type AgentSelectionHandleRecoveryHint = {
  id: string;
  assetCount: number;
  sourceToolCallId: string | null;
  createdAt: string;
  expiresAt: string;
};

export type AgentSelectionHandleRecoveryMetadata = {
  kind: 'invalid-selection-handle';
  attemptedSelectionHandleId: string;
  looksLikeExamplePlaceholder: boolean;
  availableSelectionHandles: AgentSelectionHandleRecoveryHint[];
  expiredSelectionHandle?: AgentSelectionHandleRecoveryHint;
  instruction: string;
};

export type AgentWrongIdDomainRecoveryMetadata = {
  kind: 'wrong_id_domain';
  field: string;
  expectedDomain: AgentIdDomain;
  receivedDomain: AgentIdDomain;
  instruction: string;
};

export type AgentSourceRefRecoveryMetadata = {
  kind: 'invalid-source-ref';
  attemptedSourceRef: string;
  expectedSourceKind: 'search';
  instruction: string;
  expiredSourceRef?: string;
};

export type AgentToolOperationPlanResponseMetadata =
  | {
      planId: string | null;
      operationIds: string[];
    }
  | {
      selectionHandleRecovery: AgentSelectionHandleRecoveryMetadata;
    }
  | {
      wrongIdDomainRecovery: AgentWrongIdDomainRecoveryMetadata;
    }
  | {
      sourceRefRecovery: AgentSourceRefRecoveryMetadata;
    };

export type AgentSearchAssetsFilters = {
  takenAfter?: Date;
  takenBefore?: Date;
  createdAfter?: Date;
  createdBefore?: Date;
  updatedAfter?: Date;
  updatedBefore?: Date;
  city?: string | null;
  state?: string | null;
  country?: string | null;
  make?: string | null;
  model?: string | null;
  lensModel?: string | null;
  isFavorite?: boolean;
  isNotInAlbum?: boolean;
  type?: AssetType;
  rating?: number | null;
  maxSharpness?: number;
  maxBrightness?: number;
  maxQuality?: number;
  tagIds?: string[];
  tagMatchAny?: boolean;
  albumIds?: string[];
  albumMatchAny?: boolean;
  personIds?: string[];
  personMatchAny?: boolean;
  spaceId?: string;
  spacePersonIds?: string[];
  withSharedSpaces?: boolean;
  visibility?: AssetVisibility;
};

export type AgentResolvedAssetSearchFilterKind =
  | 'person'
  | 'tag'
  | 'album'
  | 'space'
  | 'cameraMake'
  | 'cameraModel'
  | 'lensModel';

export type AgentResolvedAssetSearchFilterStatus = 'matched' | 'ambiguous' | 'not_found';

export type AgentResolvedAssetSearchFilterChoice = {
  id?: string;
  choiceRef?: string;
  value: string;
  label: string;
  searchFilter?: Partial<AgentSearchAssetsFilters>;
};

export type AgentResolvedAssetSearchFilterResult = {
  kind: AgentResolvedAssetSearchFilterKind;
  query: string;
  status: AgentResolvedAssetSearchFilterStatus;
  value?: string;
  id?: string;
  searchFilter?: Partial<AgentSearchAssetsFilters>;
  choices: AgentResolvedAssetSearchFilterChoice[];
  message: string;
};

export type AgentAssetMediaReference = {
  assetId: string;
  mediaUrl: string;
  mimeType: string;
  fileName: string;
  width: number | null;
  height: number | null;
};

export type AgentAlbumSummary = {
  id: string;
  albumName: string;
  description: string;
  ownerId: string;
  assetCount: number;
  startDate: Date | null;
  endDate: Date | null;
  albumThumbnailAssetId: string | null;
};

export type AgentAlbumUserSummary = {
  userId: string;
  role: string;
};

export type AgentAlbumDetail = AgentAlbumSummary & {
  assetIds: string[];
  albumUsers: AgentAlbumUserSummary[];
};

export type AgentSpaceMemberSummary = {
  userId: string;
  name: string;
  role: string;
  avatarColor: string | null;
  profileImagePath: string | null;
};

export type AgentSpaceSummary = {
  id: string;
  name: string;
  description: string | null;
  color: string;
  createdById: string;
  assetCount: number;
  memberCount: number;
  thumbnailAssetId: string | null;
  recentAssetIds: string[];
};

export type AgentSpaceDetail = AgentSpaceSummary & {
  members: AgentSpaceMemberSummary[];
  assetIds: string[];
  assetIdsReturned: number;
  assetIdsTruncated: boolean;
};

export type AgentUserLookupResult = {
  userId: string;
  name: string;
  email: string | null;
  avatarColor: string | null;
  profileImagePath: string | null;
};

export type AgentResolveLocationChoice = {
  latitude: number;
  longitude: number;
  label: string;
  countryCode: string;
};

export type AgentResolveLocationResult =
  | { status: 'not_found' }
  | { status: 'matched'; latitude: number; longitude: number; label: string }
  | { status: 'ambiguous'; choices: AgentResolveLocationChoice[] };

export type AgentSearchPeopleChoice = { personId: string; name: string; thumbnailAssetId: string | null };
export type AgentSearchPeopleResult =
  | { status: 'not_found' }
  | { status: 'matched'; personId: string; name: string; thumbnailAssetId: string | null }
  | { status: 'ambiguous'; choices: AgentSearchPeopleChoice[] };

export type AgentToolRequestMetadata =
  | AgentToolSearchAssetsRequestMetadata
  | AgentToolFindTripCandidatesRequestMetadata
  | AgentToolResolveAssetSearchFiltersRequestMetadata
  | AgentToolReadSelectionMetadataRequestMetadata
  | AgentToolCurateSelectionRequestMetadata
  | AgentToolReadAssetMetadataRequestMetadata
  | AgentToolReadAssetIdsRequestMetadata
  | AgentToolReadAlbumRequestMetadata
  | AgentToolListAlbumsRequestMetadata
  | AgentToolReadSpaceRequestMetadata
  | AgentToolListSpacesRequestMetadata
  | AgentToolListDuplicateGroupsRequestMetadata
  | AgentToolSearchUsersRequestMetadata
  | AgentToolOperationPlanRequestMetadata;

export type AgentToolResponseMetadata = AgentToolResponseIdsMetadata | AgentToolOperationPlanResponseMetadata;

export type AgentAssetMetadataQuality = {
  sharpness: number | null;
  exposure: number | null;
  brightness: number | null;
  quality: number | null;
};

export type AgentAssetMetadata = {
  id: string;
  ownerId: string;
  type: AssetType;
  originalFileName: string;
  localDateTime: Date;
  fileCreatedAt: Date;
  fileModifiedAt: Date;
  isFavorite: boolean;
  visibility: AssetVisibility;
  exifInfo: {
    dateTimeOriginal: Date | null;
    city: string | null;
    state: string | null;
    country: string | null;
    make: string | null;
    model: string | null;
    lensModel: string | null;
    latitude: number | null;
    longitude: number | null;
    rating: number | null;
  } | null;
  tags: Array<{
    id: string;
    value: string;
    color: string | null;
  }>;
  qualityInfo: AgentAssetMetadataQuality | null;
};

export type AgentSearchAssetExif = Partial<NonNullable<AgentAssetMetadata['exifInfo']>>;

export type AgentSearchAssetResult = Omit<Partial<AgentAssetMetadata>, 'exifInfo'> &
  Pick<AgentAssetMetadata, 'id'> & {
    exifInfo?: AgentSearchAssetExif | null;
  };

export type AgentAssetMetadataExifResult = AgentSearchAssetExif;

export type AgentAssetMetadataResult = Omit<AgentSearchAssetResult, 'ownerId'> & {
  qualityInfo?: AgentAssetMetadataQuality | null;
};
