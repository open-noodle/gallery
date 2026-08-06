/**
 * Immich
 * 3.1.0
 * DO NOT MODIFY - This file has been generated using oazapfts.
 * See https://www.npmjs.com/package/oazapfts
 */
import * as Oazapfts from "@oazapfts/runtime";
import * as QS from "@oazapfts/runtime/query";
export const defaults: Oazapfts.Defaults<Oazapfts.CustomHeaders> = {
    headers: {},
    baseUrl: "/api"
};
const oazapfts = Oazapfts.runtime(defaults);
export const servers = {
    server1: "/api"
};
export type UserResponseDto = {
    avatarColor: UserAvatarColor;
    /** User email */
    email: string;
    /** User ID */
    id: string;
    /** User name */
    name: string;
    /** Profile change date */
    profileChangedAt: string;
    /** Profile image path */
    profileImagePath: string;
};
export type ActivityResponseDto = {
    /** Asset ID (if activity is for an asset) */
    assetId: string | null;
    /** Comment text (for comment activities) */
    comment?: string | null;
    /** Creation date */
    createdAt: string;
    /** Activity ID */
    id: string;
    "type": ReactionType;
    user: UserResponseDto;
};
export type ActivityCreateDto = {
    /** Album ID */
    albumId: string;
    /** Asset ID (if activity is for an asset) */
    assetId?: string;
    /** Comment text (required if type is comment) */
    comment?: string;
    "type": ReactionType;
};
export type ActivityStatisticsResponseDto = {
    /** Number of comments */
    comments: number;
    /** Number of likes */
    likes: number;
};
export type DatabaseBackupDeleteDto = {
    /** Backup filenames to delete */
    backups: string[];
};
export type DatabaseBackupDto = {
    /** Backup filename */
    filename: string;
    /** Backup file size */
    filesize: number;
    /** Backup timezone */
    timezone: string;
};
export type DatabaseBackupListResponseDto = {
    /** List of backups */
    backups: DatabaseBackupDto[];
};
export type DatabaseBackupUploadDto = {
    /** Database backup file */
    file?: Blob;
};
export type FaceRepairRequestDto = {
    dryRun?: boolean;
    maxAttributionDistance?: number;
    maxDistance?: number;
    maxFlaggedFraction?: number;
    minFaces?: number;
    ownerId?: string;
    personId?: string;
    voteMargin?: number;
    voteWindow?: number;
};
export type FaceRepairResponseDto = {
    dryRun: boolean;
    executed?: {
        moved: number;
        skipped: number;
    };
    mutated: boolean;
    report: {
        persons: {
            eligible: number;
            flagged: number;
            flaggedFraction: number;
            personId: string;
            reviewOnly: boolean;
            suspectedOwners: {
                count: number;
                ownerPersonId: string;
            }[];
        }[];
        totals: {
            affectedPersons: number;
            eligibleFaces: number;
            flaggedFaces: number;
            reviewOnlyByReason: {
                badTarget: number;
                overCap: number;
                unAttributable: number;
            };
            reviewOnlyFaces: number;
            reviewOnlyPersons: number;
            toRepair: number;
        };
    };
};
export type FaceRepairDeclineRemoveRequestDto = {
    faces?: {
        assetFaceId: string;
        suspectedOwnerId: string;
    }[];
    ids?: string[];
};
export type FaceRepairDeclineRemovedDto = {
    removed: number;
};
export type FaceRepairDeclineListDto = {
    declines: {
        assetFaceId: string | null;
        createdAt: string;
        id: string;
        personId: string | null;
        personName: string | null;
        personThumbnailFaceId: string | null;
        suspectedOwnerId: string | null;
        suspectedOwnerName: string | null;
        suspectedOwnerThumbnailFaceId: string | null;
        "type": string;
    }[];
};
export type FaceRepairDeclineRequestDto = {
    faces?: {
        assetFaceId: string;
        suspectedOwnerId: string;
    }[];
    persons?: {
        personId: string;
        suspectedOwnerIds: string[];
    }[];
};
export type FaceRepairDeclineCreatedDto = {
    created: number;
};
export type FaceRepairOwnerPeopleResponseDto = {
    hasMore: boolean;
    people: {
        faceCount: number;
        id: string;
        name: string;
        thumbnailFaceId: string | null;
    }[];
    total: number;
};
export type FaceRepairOwnerPersonCreateRequestDto = {
    name: string;
};
export type FaceRepairOwnerPersonCreatedResponseDto = {
    id: string;
};
export type FaceRepairPersonMetadataResponseDto = {
    faceCount: number;
    id: string;
    name: string;
    ownerId: string;
    thumbnailFaceId: string | null;
};
export type FaceRepairResolutionsListDto = {
    resolutions: {
        actorId: string | null;
        actorName: string | null;
        assetFaceId: string;
        createdAt: string;
        id: string;
        personId: string | null;
        personName: string | null;
        personThumbnailFaceId: string | null;
        source: string;
        spaceName: string | null;
        spacePersonId: string | null;
        spacePersonName: string | null;
        spacePersonThumbnailFaceId: string | null;
        status: string;
    }[];
    total: number;
};
export type FaceRepairResolutionsRemoveRequestDto = {
    clusterMuteIds?: string[];
    verdictIds?: string[];
};
export type FaceRepairResolutionsRemovedDto = {
    removed: number;
};
export type FaceRepairResolveRequestDto = {
    detach?: string[];
    entireCluster?: {
        destinationPersonId: string;
    };
    lock?: string[];
    moveToPerson?: {
        destinationPersonId: string;
        faceIds: string[];
        lock?: boolean;
    }[];
    personId: string;
    stay?: string[];
    "unknown"?: string[];
};
export type FaceRepairResolveResponseDto = {
    declined: number;
    detached: number;
    locked: number;
    moved: number;
    skipped: number;
    "unknown": number;
};
export type FaceRepairScanTriggerRequestDto = {
    params?: {
        largeClusterThreshold?: number;
        maxAttributionDistance?: number;
        maxDistance?: number;
        maxFlaggedFraction?: number;
        minFaces?: number;
        voteMargin?: number;
        voteWindow?: number;
    };
};
export type FaceRepairScanTriggerResponseDto = {
    scanId: string;
};
export type FaceRepairScanDefaultsDto = {
    maxDistance: number;
    maxFlaggedFraction: number;
    minFaces: number;
};
export type FaceRepairPersonFacesDto = {
    flaggedFaces: {
        assetFaceId: string;
        suspectedOwnerId: string;
    }[];
    personId: string;
};
export type FaceRepairClusterFacesRequestDto = {
    excludeFaceIds?: string[];
    page: number;
    size: number;
};
export type FaceRepairClusterFacesResponseDto = {
    faces: {
        assetFaceId: string;
    }[];
    hasMore: boolean;
    total: number;
};
export type FaceRepairUnconfirmRequestDto = {
    assetFaceIds: string[];
};
export type IntegrityReportResponseDto = {
    items: {
        /** Integrity report item id */
        id: string;
        /** Integrity report item path */
        path: string;
        "type": IntegrityReport;
    }[];
    nextCursor?: string;
};
export type IntegrityReportSummaryResponseDto = {
    checksum_mismatch: number;
    missing_file: number;
    untracked_file: number;
};
export type SetMaintenanceModeDto = {
    action: MaintenanceAction;
    /** Restore backup filename */
    restoreBackupFilename?: string;
};
export type MaintenanceDetectInstallStorageFolderDto = {
    /** Number of files in the folder */
    files: number;
    folder: StorageFolder;
    /** Whether the folder is readable */
    readable: boolean;
    /** Whether the folder is writable */
    writable: boolean;
};
export type MaintenanceDetectInstallResponseDto = {
    storage: MaintenanceDetectInstallStorageFolderDto[];
};
export type MaintenanceLoginDto = {
    /** Maintenance token */
    token?: string;
};
export type MaintenanceAuthDto = {
    /** Maintenance username */
    username: string;
};
export type MaintenanceStatusResponseDto = {
    action: MaintenanceAction;
    active: boolean;
    error?: string;
    progress?: number;
    task?: string;
};
export type NotificationCreateDto = {
    /** Additional notification data */
    data?: {
        [key: string]: any;
    };
    /** Notification description */
    description?: string | null;
    level?: NotificationLevel;
    /** Date when notification was read */
    readAt?: string | null;
    /** Notification title */
    title: string;
    "type"?: NotificationType;
    /** User ID to send notification to */
    userId: string;
};
export type NotificationDto = {
    /** Creation date */
    createdAt: string;
    /** Additional notification data */
    data?: {
        [key: string]: any;
    };
    /** Notification description */
    description?: string;
    /** Notification ID */
    id: string;
    level: NotificationLevel;
    /** Date when notification was read */
    readAt?: string;
    /** Notification title */
    title: string;
    "type": NotificationType;
};
export type TemplateDto = {
    /** Template name */
    template: string;
};
export type TemplateResponseDto = {
    /** Template HTML content */
    html: string;
    /** Template name */
    name: string;
};
export type SystemConfigSmtpTransportDto = {
    /** SMTP server hostname */
    host: string;
    /** Whether to ignore SSL certificate errors */
    ignoreCert: boolean;
    /** SMTP password */
    password: string;
    /** SMTP server port */
    port: number;
    /** Whether to use secure connection (TLS/SSL) */
    secure: boolean;
    /** SMTP username */
    username: string;
};
export type SystemConfigSmtpDto = {
    /** Whether SMTP email notifications are enabled */
    enabled: boolean;
    /** Email address to send from */
    "from": string;
    /** Email address for replies */
    replyTo: string;
    transport: SystemConfigSmtpTransportDto;
};
export type TestEmailResponseDto = {
    /** Email message ID */
    messageId: string;
};
export type UserLicense = {
    /** Activation date */
    activatedAt: string;
    /** Activation key */
    activationKey: string;
    /** License key (format: /^IM(SV|CL)(-[\dA-Za-z]{4}){8}$/) */
    licenseKey: string;
};
export type UserAdminResponseDto = {
    avatarColor: UserAvatarColor;
    /** Creation date */
    createdAt: string;
    /** Deletion date */
    deletedAt: string | null;
    /** User email */
    email: string;
    /** User ID */
    id: string;
    /** Is admin user */
    isAdmin: boolean;
    license: (UserLicense) | null;
    /** User name */
    name: string;
    /** OAuth ID */
    oauthId: string;
    /** Profile change date */
    profileChangedAt: string;
    /** Profile image path */
    profileImagePath: string;
    /** Storage quota in bytes */
    quotaSizeInBytes: number | null;
    /** Storage usage in bytes */
    quotaUsageInBytes: number | null;
    /** Require password change on next login */
    shouldChangePassword: boolean;
    status: UserStatus;
    /** Storage label */
    storageLabel: string | null;
    /** Last update date */
    updatedAt: string;
};
export type UserAdminCreateDto = {
    avatarColor?: (UserAvatarColor) | null;
    /** User email */
    email: string;
    /** Grant admin privileges */
    isAdmin?: boolean;
    /** User name */
    name: string;
    /** Send notification email */
    notify?: boolean;
    /** User password */
    password: string;
    /** PIN code */
    pinCode?: string | null;
    /** Storage quota in bytes */
    quotaSizeInBytes?: number | null;
    /** Require password change on next login */
    shouldChangePassword?: boolean;
    /** Storage label */
    storageLabel?: string | null;
};
export type UserAdminDeleteDto = {
    /** Force delete even if user has assets */
    force?: boolean;
};
export type UserAdminUpdateDto = {
    avatarColor?: (UserAvatarColor) | null;
    /** User email */
    email?: string;
    /** Grant admin privileges */
    isAdmin?: boolean;
    /** User name */
    name?: string;
    /** User password */
    password?: string;
    /** PIN code */
    pinCode?: string | null;
    /** Storage quota in bytes */
    quotaSizeInBytes?: number | null;
    /** Require password change on next login */
    shouldChangePassword?: boolean;
    /** Storage label */
    storageLabel?: string | null;
};
export type CalendarHeatmapResponseDto = {
    /** Start date in UTC */
    "from": string;
    series: {
        /** Activity count */
        count: number;
        /** Date in UTC */
        date: string;
    }[];
    /** End date in UTC */
    to: string;
    /** Total activity count over the period */
    totalCount: number;
};
export type LibraryManifestAlbumDto = {
    /** Album ID */
    id: string;
    /** Album name */
    name: string;
};
export type LibraryManifestAssetDto = {
    /** IDs of the owner-owned albums this asset belongs to */
    albumIds: string[];
    /** Asset ID */
    assetId: string;
    /** Base64 encoded SHA1 hash */
    checksum: string;
    /** Checksum algorithm */
    checksumAlgorithm: ChecksumAlgorithm;
    /** File creation time */
    fileCreatedAt: string | null;
    /** File modification time */
    fileModifiedAt: string | null;
    /** Object-storage key (asset.originalPath) */
    objectKey: string;
    /** Original file name */
    originalFileName: string;
    /** Original file size in bytes; null if unknown */
    size: number | null;
    "type": AssetTypeEnum;
};
export type LibraryManifestOwnerDto = {
    /** Owner email */
    email: string;
    /** Owner user ID */
    id: string;
};
export type LibraryManifestResponseDto = {
    /** All albums owned by the target user */
    albums: LibraryManifestAlbumDto[];
    assets: LibraryManifestAssetDto[];
    /** When this page was generated */
    generatedAt: string;
    /** Manifest schema version; consumers must guard */
    manifestSchemaVersion: number;
    /** Pass as ?cursor for the next page; null when exhausted */
    nextCursor: string | null;
    owner: LibraryManifestOwnerDto;
};
export type AlbumsResponse = {
    defaultAssetOrder: AssetOrder;
};
export type CastResponse = {
    /** Whether Google Cast is enabled */
    gCastEnabled: boolean;
};
export type DownloadResponse = {
    /** Maximum archive size in bytes */
    archiveSize: number;
    /** Whether to include embedded videos in downloads */
    includeEmbeddedVideos: boolean;
};
export type EmailNotificationsResponse = {
    /** Whether to receive email notifications for album invites */
    albumInvite: boolean;
    /** Whether to receive email notifications for album updates */
    albumUpdate: boolean;
    /** Whether email notifications are enabled */
    enabled: boolean;
};
export type FoldersResponse = {
    /** Whether folders are enabled */
    enabled: boolean;
    /** Whether folders appear in web sidebar */
    sidebarWeb: boolean;
};
export type MemoriesResponse = {
    /** Memory duration in seconds */
    duration: number;
    /** Whether memories are enabled */
    enabled: boolean;
    /** Per-memory-type enable map, keyed by memory type */
    types: {
        [key: string]: boolean;
    };
};
export type PeopleResponse = {
    /** Whether people are enabled */
    enabled: boolean;
    /** People face threshold */
    minimumFaces?: number;
    /** Whether people appear in web sidebar */
    sidebarWeb: boolean;
};
export type PurchaseResponse = {
    /** Date until which to hide buy button */
    hideBuyButtonUntil: string;
    /** Whether to show support badge */
    showSupportBadge: boolean;
};
export type RatingsResponse = {
    /** Whether ratings are enabled */
    enabled: boolean;
};
export type RecentlyAddedResponse = {
    /** Whether the recently added page appears in the web sidebar */
    sidebarWeb: boolean;
};
export type SharedLinksResponse = {
    /** Whether shared links are enabled */
    enabled: boolean;
    /** Whether shared links appear in web sidebar */
    sidebarWeb: boolean;
};
export type TagsResponse = {
    /** Whether tags are enabled */
    enabled: boolean;
    /** Whether tags appear in web sidebar */
    sidebarWeb: boolean;
};
export type UserPreferencesResponseDto = {
    albums: AlbumsResponse;
    cast: CastResponse;
    download: DownloadResponse;
    emailNotifications: EmailNotificationsResponse;
    folders: FoldersResponse;
    memories: MemoriesResponse;
    people: PeopleResponse;
    purchase: PurchaseResponse;
    ratings: RatingsResponse;
    recentlyAdded: RecentlyAddedResponse;
    sharedLinks: SharedLinksResponse;
    tags: TagsResponse;
};
export type AlbumsUpdate = {
    defaultAssetOrder?: AssetOrder;
};
export type AvatarUpdate = {
    color?: UserAvatarColor;
};
export type CastUpdate = {
    /** Whether Google Cast is enabled */
    gCastEnabled?: boolean;
};
export type DownloadUpdate = {
    /** Maximum archive size in bytes */
    archiveSize?: number;
    /** Whether to include embedded videos in downloads */
    includeEmbeddedVideos?: boolean;
};
export type EmailNotificationsUpdate = {
    /** Whether to receive email notifications for album invites */
    albumInvite?: boolean;
    /** Whether to receive email notifications for album updates */
    albumUpdate?: boolean;
    /** Whether email notifications are enabled */
    enabled?: boolean;
};
export type FoldersUpdate = {
    /** Whether folders are enabled */
    enabled?: boolean;
    /** Whether folders appear in web sidebar */
    sidebarWeb?: boolean;
};
export type MemoriesUpdate = {
    /** Memory duration in seconds */
    duration?: number;
    /** Whether memories are enabled */
    enabled?: boolean;
    /** Per-memory-type enable overrides, keyed by memory type */
    types?: {
        [key: string]: boolean;
    };
};
export type PeopleUpdate = {
    /** Whether people are enabled */
    enabled?: boolean;
    /** People face threshold */
    minimumFaces?: number;
    /** Whether people appear in web sidebar */
    sidebarWeb?: boolean;
};
export type PurchaseUpdate = {
    /** Date until which to hide buy button */
    hideBuyButtonUntil?: string;
    /** Whether to show support badge */
    showSupportBadge?: boolean;
};
export type RatingsUpdate = {
    /** Whether ratings are enabled */
    enabled?: boolean;
};
export type RecentlyAddedUpdate = {
    /** Whether the recently added page appears in the web sidebar */
    sidebarWeb?: boolean;
};
export type SharedLinksUpdate = {
    /** Whether shared links are enabled */
    enabled?: boolean;
    /** Whether shared links appear in web sidebar */
    sidebarWeb?: boolean;
};
export type TagsUpdate = {
    /** Whether tags are enabled */
    enabled?: boolean;
    /** Whether tags appear in web sidebar */
    sidebarWeb?: boolean;
};
export type UserPreferencesUpdateDto = {
    albums?: AlbumsUpdate;
    avatar?: AvatarUpdate;
    cast?: CastUpdate;
    download?: DownloadUpdate;
    emailNotifications?: EmailNotificationsUpdate;
    folders?: FoldersUpdate;
    memories?: MemoriesUpdate;
    people?: PeopleUpdate;
    purchase?: PurchaseUpdate;
    ratings?: RatingsUpdate;
    recentlyAdded?: RecentlyAddedUpdate;
    sharedLinks?: SharedLinksUpdate;
    tags?: TagsUpdate;
};
export type SessionResponseDto = {
    /** App version */
    appVersion: string | null;
    /** Creation date */
    createdAt: string;
    /** Is current session */
    current: boolean;
    /** Device OS */
    deviceOS: string;
    /** Device type */
    deviceType: string;
    /** Expiration date */
    expiresAt?: string;
    /** Session ID */
    id: string;
    /** Is pending sync reset */
    isPendingSyncReset: boolean;
    /** Last update date */
    updatedAt: string;
};
export type AssetStatsResponseDto = {
    /** Number of images */
    images: number;
    /** Total number of assets */
    total: number;
    /** Number of videos */
    videos: number;
};
export type AgentProviderCredentialResponseDto = {
    baseUrl: string | null;
    createdAt: string;
    defaultModel: string | null;
    id: string;
    label: string;
    lastUsedAt: string | null;
    models: string[];
    providerType: ProviderType;
    updatedAt: string;
};
export type AgentProviderCredentialCreateDto = {
    baseUrl?: string;
    defaultModel?: string;
    label: string;
    models?: string[];
    providerType: ProviderType;
    secret: string;
};
export type AgentProviderCredentialUpdateDto = {
    baseUrl?: string | null;
    defaultModel?: string | null;
    label?: string;
    models?: string[];
    providerType?: ProviderType;
    secret?: string;
};
export type AgentRunnerCapabilitiesDto = {
    /** Model IDs reported by the runner */
    models: string[];
    /** Runner protocol version */
    protocolVersion: string | null;
    /** Whether the runner can stream events */
    streaming: boolean;
    /** MCP tool or capability identifiers reported by the runner */
    tools: string[];
};
export type AgentRunnerStatusDto = {
    /** Normalized runner capabilities */
    capabilities: (AgentRunnerCapabilitiesDto) | null;
    /** When this status was checked */
    checkedAt: string;
    /** Whether a runner endpoint is configured */
    configured: boolean;
    /** Whether the configured runner is reachable and healthy */
    healthy: boolean;
    reason: AgentRunnerStatusReason;
    /** Runner version when reported */
    version: string | null;
};
export type AgentCredentialSnapshot = {
    baseUrl: string | null;
    defaultModel: string | null;
    id: string;
    label: string;
    models: string[];
    providerType: AgentProviderType;
};
export type AgentInitialContext = {
    [key: string]: any;
};
export type AgentModelSnapshot = {
    model: string;
    providerCredentialId: string;
};
export type AgentPermissionPlan = {
    assetScope: {
        locked: boolean;
        owned: boolean;
        sharedSpaces: boolean;
    };
    limits: {
        expiresInMinutes: number | null;
        maxAssetsPerSession: number;
        maxAssetsPerToolCall: number;
        maxOriginalsPerSession?: number;
        maxOriginalsPerToolCall: number;
        maxPreviewsPerSession?: number;
        maxPreviewsPerToolCall: number;
    };
    providerExposure: {
        allowOriginalsForExternalProviders: boolean;
        metadata: boolean;
        originals: boolean;
        previews: boolean;
    };
    read: {
        metadata: boolean;
        originals: boolean;
        previews: boolean;
    };
    writeScope: {
        addAssets: boolean;
        addAssetsToSpaces: boolean;
        addMembersToSpaces: boolean;
        archiveAssets: boolean;
        createAlbum: boolean;
        createSharedLinks: boolean;
        createSpace: boolean;
        deleteContainers: boolean;
        editAssets: boolean;
        favoriteAssets: boolean;
        lockAssets: boolean;
        managePeople: boolean;
        manageStacks: boolean;
        removeAssets: boolean;
        removeAssetsFromSpaces: boolean;
        removeMembersFromSpaces: boolean;
        setCover: boolean;
        shareAlbums: boolean;
        tagAssets: boolean;
        trashAssets: boolean;
        updateAssetMetadata: boolean;
        updateDetails: boolean;
        updateSpaceDetails: boolean;
        updateSpaceMemberRoles: boolean;
    };
};
export type AgentRunnerCapabilitiesSnapshot = {
    [key: string]: any;
} | null;
export type AgentSessionResponseDto = {
    approvalMode: AgentApprovalMode;
    createdAt: string;
    credentialSnapshot: AgentCredentialSnapshot;
    endedAt: string | null;
    id: string;
    initialContextSnapshot: AgentInitialContext;
    modelSnapshot: AgentModelSnapshot;
    permissionPlanSnapshot: AgentPermissionPlan;
    permissionPreset: AgentPermissionPreset;
    providerCredentialId: string | null;
    runnerCapabilitiesSnapshot: AgentRunnerCapabilitiesSnapshot;
    runnerEndpoint: string | null;
    runnerSessionId: string | null;
    status: AgentSessionStatus;
    title?: string | null;
    updatedAt: string;
};
export type AgentSessionCreateDto = {
    approvalMode: AgentApprovalMode;
    initialContext?: AgentInitialContext;
    model: string;
    permissionPlan?: AgentPermissionPlan;
    permissionPreset: AgentPermissionPreset;
    providerCredentialId: string;
    runnerEndpoint?: string | null;
};
export type AgentSessionUpdateDto = {
    title: string | null;
};
export type AgentSessionActivityEventCounts = {
    applied?: number;
    failed?: number;
    skipped?: number;
    total?: number;
};
export type AgentSessionActivityEventResponseDto = {
    counts: (AgentSessionActivityEventCounts) | null;
    createdAt: string;
    id: string;
    kind: Kind;
    sessionId: string;
    source: AgentSessionActivityEventSource;
    status: AgentSessionActivityEventStatus;
    summary: string | null;
};
export type AgentMessageTextBlock = {
    text: string;
    "type": AgentMessageTextBlockType;
};
export type AgentMessageToolCallBlock = {
    summary?: string;
    toolCallId: string;
    "type": AgentMessageToolCallBlockType;
};
export type AgentMessageAssetBlock = {
    assetId: string;
    label?: string;
    "type": AgentMessageAssetBlockType;
};
export type AgentMessagePlanBlock = {
    label?: string;
    planId: string;
    "type": AgentMessagePlanBlockType;
};
export type AgentChoiceRef = string;
export type AgentMessageClarificationChoice = {
    choiceRef: AgentChoiceRef;
    description?: string;
    label: string;
    thumbnailAssetId?: string | null;
};
export type AgentMessageClarificationBlock = {
    choices: AgentMessageClarificationChoice[];
    kind: Kind2;
    query: string;
    summary: string;
    textFallback: string;
    "type": AgentMessageClarificationBlockType;
};
export type AgentMessageBlock = AgentMessageTextBlock | AgentMessageToolCallBlock | AgentMessageAssetBlock | AgentMessagePlanBlock | AgentMessageClarificationBlock;
export type AgentMessageContent = {
    blocks: AgentMessageBlock[];
};
export type AgentMessageResponseDto = {
    content: AgentMessageContent;
    createdAt: string;
    id: string;
    providerMessageId: string | null;
    role: AgentMessageRole;
    sessionId: string;
    toolCallId: string | null;
};
export type AgentUserMessageContent = {
    blocks: AgentMessageTextBlock[];
};
export type AgentMessageCreateDto = {
    content: AgentUserMessageContent;
};
export type AgentOperationResponseDto = {
    assetIds: string[];
    createdAt: string;
    dependencyIds: string[];
    enabled: boolean;
    error: string | null;
    id: string;
    payload: {
        [key: string]: any;
    };
    planId: string;
    result: {
        [key: string]: any;
    } | null;
    reviewMetadata?: {
        assetMetadata?: {
            fields: {
                key: string;
                label: string;
                previousValues: {
                    assetId: string;
                    value: string | null;
                    valueKind: AgentOperationReviewMetadataValueKind;
                }[];
                proposedValue: string | null;
                proposedValueKind: AgentOperationReviewMetadataValueKind;
            }[];
            sampleAssetIds: string[];
            warnings: string[];
        };
    };
    riskLevel: AgentOperationRiskLevel;
    status: AgentOperationStatus;
    summary: string;
    targetId: string | null;
    targetKind: AgentOperationTargetKind;
    temporaryTargetId: string | null;
    "type": AgentOperationType;
    updatedAt: string;
};
export type AgentOperationPlanResponseDto = {
    createdAt: string;
    id: string;
    operations: AgentOperationResponseDto[];
    revision: number;
    sessionId: string;
    status: AgentOperationPlanStatus;
    summary: string;
    updatedAt: string;
};
export type AgentDeclarativeNamedFilter = {
    choiceRefs?: AgentChoiceRef[];
    match: AgentDeclarativeNameMatch;
    names: string[];
};
export type AgentDeclarativeCameraFilter = {
    lensModel?: string;
    make?: string;
    model?: string;
};
export type AgentDeclarativeSpaceFilter = {
    name: string;
};
export type AgentDeclarativeAssetFilters = {
    albums?: AgentDeclarativeNamedFilter;
    camera?: AgentDeclarativeCameraFilter;
    city?: string | null;
    country?: string | null;
    isFavorite?: boolean;
    isNotInAlbum?: boolean;
    people?: AgentDeclarativeNamedFilter;
    rating?: number | null;
    space?: AgentDeclarativeSpaceFilter;
    state?: string | null;
    tags?: AgentDeclarativeNamedFilter;
    takenAfter?: string;
    takenBefore?: string;
    "type"?: AssetTypeEnum;
    visibility?: AssetVisibility;
    withSharedSpaces?: boolean;
};
export type AgentSearchAssetSourceInput = {
    filters?: AgentDeclarativeAssetFilters;
    kind: Kind3;
    limit?: number;
    materialization?: Materialization;
    mode?: Mode;
    order?: Order;
    page?: number;
    query?: string;
};
export type AgentSearchSourceRef = string;
export type AgentPreviousSearchAssetSourceInput = {
    kind: Kind4;
    sourceRef: AgentSearchSourceRef;
};
export type AgentSelectionHandleAssetSourceInput = {
    kind: Kind5;
    selectionHandleId: string;
};
export type AgentExplicitAssetsAssetSourceInput = {
    assetIds: string[];
    kind: Kind6;
};
export type AgentAssetSourceInput = AgentSearchAssetSourceInput | AgentPreviousSearchAssetSourceInput | AgentSelectionHandleAssetSourceInput | AgentExplicitAssetsAssetSourceInput;
export type AgentOperationPlanningAssetSourceInput = AgentAssetSourceInput;
export type AgentProposeAlbumOperationsDto = {
    operations: ({
        "type": AgentAlbumCreateOperationType;
        summary: string;
        targetKind: AgentOperationNewAlbumTargetKind;
        temporaryTargetId?: string;
        riskLevel?: AgentOperationRiskLevel;
        enabled?: boolean;
        payload: {
            albumName: string;
            description?: string;
        };
    } | {
        "type": AgentAlbumAddAssetsOperationType;
        summary: string;
        targetKind: AgentOperationTargetKind;
        targetId?: string;
        temporaryTargetId?: string;
        assetSource?: AgentOperationPlanningAssetSourceInput;
        assetIds?: string[];
        assetSelectionHandleId?: string;
        riskLevel?: AgentOperationRiskLevel;
        enabled?: boolean;
        payload?: {};
    } | {
        "type": AgentAlbumRemoveAssetsOperationType;
        summary: string;
        targetKind: AgentOperationTargetKind;
        targetId?: string;
        temporaryTargetId?: string;
        assetSource?: AgentOperationPlanningAssetSourceInput;
        assetIds?: string[];
        assetSelectionHandleId?: string;
        riskLevel?: AgentOperationRiskLevel;
        enabled?: boolean;
        payload?: {};
    } | {
        "type": AgentAlbumUpdateDetailsOperationType;
        summary: string;
        targetKind: AgentOperationExistingAlbumTargetKind;
        targetId?: string;
        riskLevel?: AgentOperationRiskLevel;
        enabled?: boolean;
        payload: {
            albumName?: string;
            description?: string;
        };
    } | {
        "type": AgentAlbumSetCoverOperationType;
        summary: string;
        targetKind: AgentOperationTargetKind;
        targetId?: string;
        temporaryTargetId?: string;
        assetSource?: AgentOperationPlanningAssetSourceInput;
        assetIds?: string[];
        assetSelectionHandleId?: string;
        riskLevel?: AgentOperationRiskLevel;
        enabled?: boolean;
        payload?: {};
    } | {
        "type": AgentSpaceCreateOperationType;
        summary: string;
        targetKind: AgentOperationNewSpaceTargetKind;
        temporaryTargetId?: string;
        riskLevel?: AgentOperationRiskLevel;
        enabled?: boolean;
        payload: {
            spaceName: string;
            description?: string;
            color?: UserAvatarColor;
        };
    } | {
        "type": Type;
        summary: string;
        targetKind: AgentOperationTargetKind;
        targetId?: string;
        temporaryTargetId?: string;
        assetSource?: AgentOperationPlanningAssetSourceInput;
        assetIds?: string[];
        assetSelectionHandleId?: string;
        riskLevel?: AgentOperationRiskLevel;
        enabled?: boolean;
        payload?: {};
    } | {
        "type": Type2;
        summary: string;
        targetKind: AgentOperationTargetKind;
        targetId?: string;
        temporaryTargetId?: string;
        assetSource?: AgentOperationPlanningAssetSourceInput;
        assetIds?: string[];
        assetSelectionHandleId?: string;
        riskLevel?: AgentOperationRiskLevel;
        enabled?: boolean;
        payload?: {};
    } | {
        "type": AgentSpaceUpdateDetailsOperationType;
        summary: string;
        targetKind: AgentOperationExistingSpaceTargetKind;
        targetId?: string;
        riskLevel?: AgentOperationRiskLevel;
        enabled?: boolean;
        payload: {
            spaceName?: string;
            description?: string;
            color?: UserAvatarColor;
        };
    } | {
        "type": AgentSpaceAddMembersOperationType;
        summary: string;
        targetKind: AgentOperationExistingSpaceTargetKind;
        targetId?: string;
        temporaryTargetId?: string;
        riskLevel?: AgentOperationRiskLevel;
        enabled?: boolean;
        payload: {
            members: {
                userId: string;
                role: AgentAssignableSharedSpaceMemberRole;
            }[];
        };
    } | {
        "type": AgentSpaceRemoveMembersOperationType;
        summary: string;
        targetKind: AgentOperationExistingSpaceTargetKind;
        targetId?: string;
        temporaryTargetId?: string;
        riskLevel?: AgentOperationRiskLevel;
        enabled?: boolean;
        payload: {
            userIds: string[];
        };
    } | {
        "type": AgentSpaceUpdateMemberRoleOperationType;
        summary: string;
        targetKind: AgentOperationExistingSpaceTargetKind;
        targetId?: string;
        temporaryTargetId?: string;
        riskLevel?: AgentOperationRiskLevel;
        enabled?: boolean;
        payload: {
            userIds: string[];
            role: AgentAssignableSharedSpaceMemberRole;
        };
    } | {
        "type": AgentAlbumAddUsersOperationType;
        summary: string;
        targetKind: AgentOperationExistingAlbumTargetKind;
        targetId?: string;
        temporaryTargetId?: string;
        riskLevel?: AgentOperationRiskLevel;
        enabled?: boolean;
        payload: {
            albumUsers: {
                userId: string;
                role: AgentAssignableAlbumUserRole;
            }[];
        };
    } | {
        "type": AgentAlbumRemoveUsersOperationType;
        summary: string;
        targetKind: AgentOperationExistingAlbumTargetKind;
        targetId?: string;
        temporaryTargetId?: string;
        riskLevel?: AgentOperationRiskLevel;
        enabled?: boolean;
        payload: {
            userIds: string[];
        };
    } | {
        "type": AgentAlbumUpdateUserRoleOperationType;
        summary: string;
        targetKind: AgentOperationExistingAlbumTargetKind;
        targetId?: string;
        temporaryTargetId?: string;
        riskLevel?: AgentOperationRiskLevel;
        enabled?: boolean;
        payload: {
            userId: string;
            role: AgentAssignableAlbumUserRole;
        };
    } | {
        "type": AgentAlbumDeleteOperationType;
        summary: string;
        targetKind: AgentOperationExistingAlbumTargetKind;
        targetId?: string;
        temporaryTargetId?: string;
        riskLevel?: AgentOperationRiskLevel;
        enabled?: boolean;
        payload?: {};
    } | {
        "type": AgentSpaceDeleteOperationType;
        summary: string;
        targetKind: AgentOperationExistingSpaceTargetKind;
        targetId?: string;
        temporaryTargetId?: string;
        riskLevel?: AgentOperationRiskLevel;
        enabled?: boolean;
        payload?: {};
    } | {
        "type": AgentAssetRotateOperationType;
        summary: string;
        targetKind: AgentOperationTargetKind;
        targetId?: string;
        temporaryTargetId?: string;
        assetSource?: AgentOperationPlanningAssetSourceInput;
        assetIds?: string[];
        assetSelectionHandleId?: string;
        riskLevel?: AgentOperationRiskLevel;
        enabled?: boolean;
        payload: {
            angle: number;
        };
    } | {
        "type": AgentAssetCropOperationType;
        summary: string;
        targetKind: AgentOperationTargetKind;
        targetId?: string;
        temporaryTargetId?: string;
        assetSource?: AgentOperationPlanningAssetSourceInput;
        assetIds?: string[];
        assetSelectionHandleId?: string;
        riskLevel?: AgentOperationRiskLevel;
        enabled?: boolean;
        payload: {
            x: number;
            y: number;
            width: number;
            height: number;
        };
    } | {
        "type": AgentAssetAdjustOperationType;
        summary: string;
        targetKind: AgentOperationTargetKind;
        targetId?: string;
        temporaryTargetId?: string;
        assetSource?: AgentOperationPlanningAssetSourceInput;
        assetIds?: string[];
        assetSelectionHandleId?: string;
        riskLevel?: AgentOperationRiskLevel;
        enabled?: boolean;
        payload: {
            brightness?: Brightness;
            contrast?: Contrast;
            saturation?: Saturation;
            autoEnhance?: boolean;
        };
    } | {
        "type": AgentAssetFlipOperationType;
        summary: string;
        targetKind: AgentOperationTargetKind;
        targetId?: string;
        temporaryTargetId?: string;
        assetSource?: AgentOperationPlanningAssetSourceInput;
        assetIds?: string[];
        assetSelectionHandleId?: string;
        riskLevel?: AgentOperationRiskLevel;
        enabled?: boolean;
        payload: {
            axis: Axis;
        };
    } | {
        "type": AgentAssetSetFavoriteOperationType;
        summary: string;
        targetKind: AgentOperationTargetKind;
        targetId?: string;
        temporaryTargetId?: string;
        assetSource?: AgentOperationPlanningAssetSourceInput;
        assetIds?: string[];
        assetSelectionHandleId?: string;
        riskLevel?: AgentOperationRiskLevel;
        enabled?: boolean;
        payload: {
            favorite: boolean;
        };
    } | {
        "type": AgentAssetSetArchiveOperationType;
        summary: string;
        targetKind: AgentOperationTargetKind;
        targetId?: string;
        temporaryTargetId?: string;
        assetSource?: AgentOperationPlanningAssetSourceInput;
        assetIds?: string[];
        assetSelectionHandleId?: string;
        riskLevel?: AgentOperationRiskLevel;
        enabled?: boolean;
        payload: {
            archived: boolean;
        };
    } | {
        "type": AgentAssetSetVisibilityOperationType;
        summary: string;
        targetKind: AgentOperationTargetKind;
        targetId?: string;
        temporaryTargetId?: string;
        assetSource?: AgentOperationPlanningAssetSourceInput;
        assetIds?: string[];
        assetSelectionHandleId?: string;
        riskLevel?: AgentOperationRiskLevel;
        enabled?: boolean;
        payload: {
            visibility: Visibility;
        };
    } | {
        "type": AgentAssetUpdateMetadataOperationType;
        summary: string;
        targetKind: AgentAssetUpdateMetadataTargetKind;
        targetId?: string;
        temporaryTargetId?: string;
        assetSource?: AgentOperationPlanningAssetSourceInput;
        assetIds?: string[];
        assetSelectionHandleId?: string;
        riskLevel?: AgentOperationRiskLevel;
        enabled?: boolean;
        payload: {
            /** Asset description. Use an empty string to clear the description. */
            description?: string;
            /** Asset star rating from 1 to 5. Use null to clear the rating. */
            rating?: number | null;
            /** Absolute original capture date/time as an ISO datetime. */
            dateTimeOriginal?: string;
            /** Relative capture time shift as an integer minute offset. Cannot be combined with dateTimeOriginal. */
            dateTimeRelative?: number;
            /** IANA time zone such as Europe/Berlin. */
            timeZone?: string;
            /** Explicit latitude coordinate. Provide both latitude and longitude; place names are not accepted. */
            latitude?: number;
            /** Explicit longitude coordinate. Provide both latitude and longitude; place names are not accepted. */
            longitude?: number;
        };
    } | {
        "type": AgentAssetAddTagOperationType;
        summary: string;
        targetKind: AgentOperationTargetKind;
        targetId?: string;
        temporaryTargetId?: string;
        assetSource?: AgentOperationPlanningAssetSourceInput;
        assetIds?: string[];
        assetSelectionHandleId?: string;
        riskLevel?: AgentOperationRiskLevel;
        enabled?: boolean;
        payload: {
            tagId?: string;
            tagName?: string;
        };
    } | {
        "type": AgentAssetRemoveTagOperationType;
        summary: string;
        targetKind: AgentOperationTargetKind;
        targetId?: string;
        temporaryTargetId?: string;
        assetSource?: AgentOperationPlanningAssetSourceInput;
        assetIds?: string[];
        assetSelectionHandleId?: string;
        riskLevel?: AgentOperationRiskLevel;
        enabled?: boolean;
        payload: {
            tagId: string;
        };
    } | {
        "type": AgentAssetTrashOperationType;
        summary: string;
        targetKind: AgentOperationTargetKind;
        targetId?: string;
        temporaryTargetId?: string;
        assetSource?: AgentOperationPlanningAssetSourceInput;
        assetIds?: string[];
        assetSelectionHandleId?: string;
        riskLevel?: AgentOperationRiskLevel;
        enabled?: boolean;
    } | {
        "type": AgentAssetRestoreOperationType;
        summary: string;
        targetKind: AgentOperationTargetKind;
        targetId?: string;
        temporaryTargetId?: string;
        assetSource?: AgentOperationPlanningAssetSourceInput;
        assetIds?: string[];
        assetSelectionHandleId?: string;
        riskLevel?: AgentOperationRiskLevel;
        enabled?: boolean;
    } | {
        "type": AgentAssetStackOperationType;
        summary: string;
        targetKind: AgentOperationTargetKind;
        targetId?: string;
        temporaryTargetId?: string;
        assetSource?: AgentOperationPlanningAssetSourceInput;
        assetIds?: string[];
        assetSelectionHandleId?: string;
        riskLevel?: AgentOperationRiskLevel;
        enabled?: boolean;
    } | {
        "type": AgentAssetUnstackOperationType;
        summary: string;
        targetKind: AgentOperationTargetKind;
        targetId?: string;
        temporaryTargetId?: string;
        assetSource?: AgentOperationPlanningAssetSourceInput;
        assetIds?: string[];
        assetSelectionHandleId?: string;
        riskLevel?: AgentOperationRiskLevel;
        enabled?: boolean;
    } | {
        "type": AgentShareLinkCreateOperationType;
        summary: string;
        targetKind: AgentOperationTargetKind;
        targetId?: string;
        temporaryTargetId?: string;
        assetSource?: AgentOperationPlanningAssetSourceInput;
        assetIds?: string[];
        assetSelectionHandleId?: string;
        riskLevel?: AgentOperationRiskLevel;
        enabled?: boolean;
        payload: {
            password?: string;
            expiresAt?: string;
            showMetadata?: boolean;
            allowDownload?: boolean;
        };
    } | {
        "type": AgentShareLinkCreateAlbumOperationType;
        summary: string;
        targetKind: AgentOperationExistingAlbumTargetKind;
        targetId?: string;
        riskLevel?: AgentOperationRiskLevel;
        enabled?: boolean;
        payload: {
            password?: string;
            expiresAt?: string;
            showMetadata?: boolean;
            allowDownload?: boolean;
        };
    } | {
        "type": AgentPersonUpdateOperationType;
        summary: string;
        targetKind: AgentOperationPersonTargetKind;
        targetId?: string;
        riskLevel?: AgentOperationRiskLevel;
        enabled?: boolean;
        payload: {
            name?: string;
            birthDate?: string | null;
            isHidden?: boolean;
        };
    } | {
        "type": AgentPersonMergeOperationType;
        summary: string;
        targetKind: AgentOperationPersonTargetKind;
        targetId?: string;
        riskLevel?: AgentOperationRiskLevel;
        enabled?: boolean;
        payload: {
            sourcePersonIds: string[];
        };
    })[];
    summary: string;
};
export type AgentToolResultSize = {
    estimatedBytes: number | null;
    hasMore: boolean;
    nextPage: string | null;
    omittedFields: string[];
    returnedItems: number;
    truncated: boolean;
};
export type AgentToolCallResponseDto = {
    albumCount: number;
    approvalDecision: (AgentToolApprovalDecision) | null;
    assetCount: number;
    completedAt: string | null;
    dataClass: AgentToolDataClass;
    error: string | null;
    id: string;
    requestSummary: string;
    responseSummary: string | null;
    resultSize?: AgentToolResultSize;
    sessionId: string;
    startedAt: string;
    status: AgentToolCallStatus;
    toolName: AgentToolName;
};
export type AgentOperationPlanToolResponseDto = {
    plan: (AgentOperationPlanResponseDto) | null;
    status: Status;
    summary: string;
    toolCall: (AgentToolCallResponseDto) | null;
};
export type AgentOperationFieldOverride = {
    [key: string]: string;
};
export type AgentOperationItemSelection = {
    itemKind: AgentOperationItemKind;
    mode: Mode2;
    itemIds?: string[];
} | {
    itemKind: AgentOperationItemKind;
    mode: Mode3;
    itemIds: string[];
} | {
    itemKind: AgentOperationItemKind;
    mode: Mode4;
    itemIds: string[];
} | {
    itemKind: AgentOperationItemKind;
    mode: Mode5;
    itemIds?: string[];
};
export type AgentOperationPlanApplyRequestDto = {
    fieldOverrides?: {
        [key: string]: AgentOperationFieldOverride;
    };
    itemSelections?: {
        [key: string]: AgentOperationItemSelection;
    };
    operationIds: string[];
    planRevision?: number;
};
export type AgentOperationPlanApplyResponseDto = {
    appliedOperationIds: string[];
    failedOperationIds: string[];
    plan: AgentOperationPlanResponseDto;
    skippedOperationIds: string[];
    status: AgentOperationApplyStatus;
    summary: string;
};
export type AgentReviseAlbumOperationsDto = {
    feedback?: string;
    operations: ({
        "type": AgentAlbumCreateOperationType;
        summary: string;
        targetKind: AgentOperationNewAlbumTargetKind;
        temporaryTargetId?: string;
        riskLevel?: AgentOperationRiskLevel;
        enabled?: boolean;
        payload: {
            albumName: string;
            description?: string;
        };
    } | {
        "type": AgentAlbumAddAssetsOperationType;
        summary: string;
        targetKind: AgentOperationTargetKind;
        targetId?: string;
        temporaryTargetId?: string;
        assetSource?: AgentOperationPlanningAssetSourceInput;
        assetIds?: string[];
        assetSelectionHandleId?: string;
        riskLevel?: AgentOperationRiskLevel;
        enabled?: boolean;
        payload?: {};
    } | {
        "type": AgentAlbumRemoveAssetsOperationType;
        summary: string;
        targetKind: AgentOperationTargetKind;
        targetId?: string;
        temporaryTargetId?: string;
        assetSource?: AgentOperationPlanningAssetSourceInput;
        assetIds?: string[];
        assetSelectionHandleId?: string;
        riskLevel?: AgentOperationRiskLevel;
        enabled?: boolean;
        payload?: {};
    } | {
        "type": AgentAlbumUpdateDetailsOperationType;
        summary: string;
        targetKind: AgentOperationExistingAlbumTargetKind;
        targetId?: string;
        riskLevel?: AgentOperationRiskLevel;
        enabled?: boolean;
        payload: {
            albumName?: string;
            description?: string;
        };
    } | {
        "type": AgentAlbumSetCoverOperationType;
        summary: string;
        targetKind: AgentOperationTargetKind;
        targetId?: string;
        temporaryTargetId?: string;
        assetSource?: AgentOperationPlanningAssetSourceInput;
        assetIds?: string[];
        assetSelectionHandleId?: string;
        riskLevel?: AgentOperationRiskLevel;
        enabled?: boolean;
        payload?: {};
    } | {
        "type": AgentSpaceCreateOperationType;
        summary: string;
        targetKind: AgentOperationNewSpaceTargetKind;
        temporaryTargetId?: string;
        riskLevel?: AgentOperationRiskLevel;
        enabled?: boolean;
        payload: {
            spaceName: string;
            description?: string;
            color?: UserAvatarColor;
        };
    } | {
        "type": Type3;
        summary: string;
        targetKind: AgentOperationTargetKind;
        targetId?: string;
        temporaryTargetId?: string;
        assetSource?: AgentOperationPlanningAssetSourceInput;
        assetIds?: string[];
        assetSelectionHandleId?: string;
        riskLevel?: AgentOperationRiskLevel;
        enabled?: boolean;
        payload?: {};
    } | {
        "type": Type4;
        summary: string;
        targetKind: AgentOperationTargetKind;
        targetId?: string;
        temporaryTargetId?: string;
        assetSource?: AgentOperationPlanningAssetSourceInput;
        assetIds?: string[];
        assetSelectionHandleId?: string;
        riskLevel?: AgentOperationRiskLevel;
        enabled?: boolean;
        payload?: {};
    } | {
        "type": AgentSpaceUpdateDetailsOperationType;
        summary: string;
        targetKind: AgentOperationExistingSpaceTargetKind;
        targetId?: string;
        riskLevel?: AgentOperationRiskLevel;
        enabled?: boolean;
        payload: {
            spaceName?: string;
            description?: string;
            color?: UserAvatarColor;
        };
    } | {
        "type": AgentSpaceAddMembersOperationType;
        summary: string;
        targetKind: AgentOperationExistingSpaceTargetKind;
        targetId?: string;
        temporaryTargetId?: string;
        riskLevel?: AgentOperationRiskLevel;
        enabled?: boolean;
        payload: {
            members: {
                userId: string;
                role: AgentAssignableSharedSpaceMemberRole;
            }[];
        };
    } | {
        "type": AgentSpaceRemoveMembersOperationType;
        summary: string;
        targetKind: AgentOperationExistingSpaceTargetKind;
        targetId?: string;
        temporaryTargetId?: string;
        riskLevel?: AgentOperationRiskLevel;
        enabled?: boolean;
        payload: {
            userIds: string[];
        };
    } | {
        "type": AgentSpaceUpdateMemberRoleOperationType;
        summary: string;
        targetKind: AgentOperationExistingSpaceTargetKind;
        targetId?: string;
        temporaryTargetId?: string;
        riskLevel?: AgentOperationRiskLevel;
        enabled?: boolean;
        payload: {
            userIds: string[];
            role: AgentAssignableSharedSpaceMemberRole;
        };
    } | {
        "type": AgentAlbumAddUsersOperationType;
        summary: string;
        targetKind: AgentOperationExistingAlbumTargetKind;
        targetId?: string;
        temporaryTargetId?: string;
        riskLevel?: AgentOperationRiskLevel;
        enabled?: boolean;
        payload: {
            albumUsers: {
                userId: string;
                role: AgentAssignableAlbumUserRole;
            }[];
        };
    } | {
        "type": AgentAlbumRemoveUsersOperationType;
        summary: string;
        targetKind: AgentOperationExistingAlbumTargetKind;
        targetId?: string;
        temporaryTargetId?: string;
        riskLevel?: AgentOperationRiskLevel;
        enabled?: boolean;
        payload: {
            userIds: string[];
        };
    } | {
        "type": AgentAlbumUpdateUserRoleOperationType;
        summary: string;
        targetKind: AgentOperationExistingAlbumTargetKind;
        targetId?: string;
        temporaryTargetId?: string;
        riskLevel?: AgentOperationRiskLevel;
        enabled?: boolean;
        payload: {
            userId: string;
            role: AgentAssignableAlbumUserRole;
        };
    } | {
        "type": AgentAlbumDeleteOperationType;
        summary: string;
        targetKind: AgentOperationExistingAlbumTargetKind;
        targetId?: string;
        temporaryTargetId?: string;
        riskLevel?: AgentOperationRiskLevel;
        enabled?: boolean;
        payload?: {};
    } | {
        "type": AgentSpaceDeleteOperationType;
        summary: string;
        targetKind: AgentOperationExistingSpaceTargetKind;
        targetId?: string;
        temporaryTargetId?: string;
        riskLevel?: AgentOperationRiskLevel;
        enabled?: boolean;
        payload?: {};
    } | {
        "type": AgentAssetRotateOperationType;
        summary: string;
        targetKind: AgentOperationTargetKind;
        targetId?: string;
        temporaryTargetId?: string;
        assetSource?: AgentOperationPlanningAssetSourceInput;
        assetIds?: string[];
        assetSelectionHandleId?: string;
        riskLevel?: AgentOperationRiskLevel;
        enabled?: boolean;
        payload: {
            angle: number;
        };
    } | {
        "type": AgentAssetCropOperationType;
        summary: string;
        targetKind: AgentOperationTargetKind;
        targetId?: string;
        temporaryTargetId?: string;
        assetSource?: AgentOperationPlanningAssetSourceInput;
        assetIds?: string[];
        assetSelectionHandleId?: string;
        riskLevel?: AgentOperationRiskLevel;
        enabled?: boolean;
        payload: {
            x: number;
            y: number;
            width: number;
            height: number;
        };
    } | {
        "type": AgentAssetAdjustOperationType;
        summary: string;
        targetKind: AgentOperationTargetKind;
        targetId?: string;
        temporaryTargetId?: string;
        assetSource?: AgentOperationPlanningAssetSourceInput;
        assetIds?: string[];
        assetSelectionHandleId?: string;
        riskLevel?: AgentOperationRiskLevel;
        enabled?: boolean;
        payload: {
            brightness?: Brightness;
            contrast?: Contrast;
            saturation?: Saturation;
            autoEnhance?: boolean;
        };
    } | {
        "type": AgentAssetFlipOperationType;
        summary: string;
        targetKind: AgentOperationTargetKind;
        targetId?: string;
        temporaryTargetId?: string;
        assetSource?: AgentOperationPlanningAssetSourceInput;
        assetIds?: string[];
        assetSelectionHandleId?: string;
        riskLevel?: AgentOperationRiskLevel;
        enabled?: boolean;
        payload: {
            axis: Axis;
        };
    } | {
        "type": AgentAssetSetFavoriteOperationType;
        summary: string;
        targetKind: AgentOperationTargetKind;
        targetId?: string;
        temporaryTargetId?: string;
        assetSource?: AgentOperationPlanningAssetSourceInput;
        assetIds?: string[];
        assetSelectionHandleId?: string;
        riskLevel?: AgentOperationRiskLevel;
        enabled?: boolean;
        payload: {
            favorite: boolean;
        };
    } | {
        "type": AgentAssetSetArchiveOperationType;
        summary: string;
        targetKind: AgentOperationTargetKind;
        targetId?: string;
        temporaryTargetId?: string;
        assetSource?: AgentOperationPlanningAssetSourceInput;
        assetIds?: string[];
        assetSelectionHandleId?: string;
        riskLevel?: AgentOperationRiskLevel;
        enabled?: boolean;
        payload: {
            archived: boolean;
        };
    } | {
        "type": AgentAssetSetVisibilityOperationType;
        summary: string;
        targetKind: AgentOperationTargetKind;
        targetId?: string;
        temporaryTargetId?: string;
        assetSource?: AgentOperationPlanningAssetSourceInput;
        assetIds?: string[];
        assetSelectionHandleId?: string;
        riskLevel?: AgentOperationRiskLevel;
        enabled?: boolean;
        payload: {
            visibility: Visibility;
        };
    } | {
        "type": AgentAssetUpdateMetadataOperationType;
        summary: string;
        targetKind: AgentAssetUpdateMetadataTargetKind;
        targetId?: string;
        temporaryTargetId?: string;
        assetSource?: AgentOperationPlanningAssetSourceInput;
        assetIds?: string[];
        assetSelectionHandleId?: string;
        riskLevel?: AgentOperationRiskLevel;
        enabled?: boolean;
        payload: {
            /** Asset description. Use an empty string to clear the description. */
            description?: string;
            /** Asset star rating from 1 to 5. Use null to clear the rating. */
            rating?: number | null;
            /** Absolute original capture date/time as an ISO datetime. */
            dateTimeOriginal?: string;
            /** Relative capture time shift as an integer minute offset. Cannot be combined with dateTimeOriginal. */
            dateTimeRelative?: number;
            /** IANA time zone such as Europe/Berlin. */
            timeZone?: string;
            /** Explicit latitude coordinate. Provide both latitude and longitude; place names are not accepted. */
            latitude?: number;
            /** Explicit longitude coordinate. Provide both latitude and longitude; place names are not accepted. */
            longitude?: number;
        };
    } | {
        "type": AgentAssetAddTagOperationType;
        summary: string;
        targetKind: AgentOperationTargetKind;
        targetId?: string;
        temporaryTargetId?: string;
        assetSource?: AgentOperationPlanningAssetSourceInput;
        assetIds?: string[];
        assetSelectionHandleId?: string;
        riskLevel?: AgentOperationRiskLevel;
        enabled?: boolean;
        payload: {
            tagId?: string;
            tagName?: string;
        };
    } | {
        "type": AgentAssetRemoveTagOperationType;
        summary: string;
        targetKind: AgentOperationTargetKind;
        targetId?: string;
        temporaryTargetId?: string;
        assetSource?: AgentOperationPlanningAssetSourceInput;
        assetIds?: string[];
        assetSelectionHandleId?: string;
        riskLevel?: AgentOperationRiskLevel;
        enabled?: boolean;
        payload: {
            tagId: string;
        };
    } | {
        "type": AgentAssetTrashOperationType;
        summary: string;
        targetKind: AgentOperationTargetKind;
        targetId?: string;
        temporaryTargetId?: string;
        assetSource?: AgentOperationPlanningAssetSourceInput;
        assetIds?: string[];
        assetSelectionHandleId?: string;
        riskLevel?: AgentOperationRiskLevel;
        enabled?: boolean;
    } | {
        "type": AgentAssetRestoreOperationType;
        summary: string;
        targetKind: AgentOperationTargetKind;
        targetId?: string;
        temporaryTargetId?: string;
        assetSource?: AgentOperationPlanningAssetSourceInput;
        assetIds?: string[];
        assetSelectionHandleId?: string;
        riskLevel?: AgentOperationRiskLevel;
        enabled?: boolean;
    } | {
        "type": AgentAssetStackOperationType;
        summary: string;
        targetKind: AgentOperationTargetKind;
        targetId?: string;
        temporaryTargetId?: string;
        assetSource?: AgentOperationPlanningAssetSourceInput;
        assetIds?: string[];
        assetSelectionHandleId?: string;
        riskLevel?: AgentOperationRiskLevel;
        enabled?: boolean;
    } | {
        "type": AgentAssetUnstackOperationType;
        summary: string;
        targetKind: AgentOperationTargetKind;
        targetId?: string;
        temporaryTargetId?: string;
        assetSource?: AgentOperationPlanningAssetSourceInput;
        assetIds?: string[];
        assetSelectionHandleId?: string;
        riskLevel?: AgentOperationRiskLevel;
        enabled?: boolean;
    } | {
        "type": AgentShareLinkCreateOperationType;
        summary: string;
        targetKind: AgentOperationTargetKind;
        targetId?: string;
        temporaryTargetId?: string;
        assetSource?: AgentOperationPlanningAssetSourceInput;
        assetIds?: string[];
        assetSelectionHandleId?: string;
        riskLevel?: AgentOperationRiskLevel;
        enabled?: boolean;
        payload: {
            password?: string;
            expiresAt?: string;
            showMetadata?: boolean;
            allowDownload?: boolean;
        };
    } | {
        "type": AgentShareLinkCreateAlbumOperationType;
        summary: string;
        targetKind: AgentOperationExistingAlbumTargetKind;
        targetId?: string;
        riskLevel?: AgentOperationRiskLevel;
        enabled?: boolean;
        payload: {
            password?: string;
            expiresAt?: string;
            showMetadata?: boolean;
            allowDownload?: boolean;
        };
    } | {
        "type": AgentPersonUpdateOperationType;
        summary: string;
        targetKind: AgentOperationPersonTargetKind;
        targetId?: string;
        riskLevel?: AgentOperationRiskLevel;
        enabled?: boolean;
        payload: {
            name?: string;
            birthDate?: string | null;
            isHidden?: boolean;
        };
    } | {
        "type": AgentPersonMergeOperationType;
        summary: string;
        targetKind: AgentOperationPersonTargetKind;
        targetId?: string;
        riskLevel?: AgentOperationRiskLevel;
        enabled?: boolean;
        payload: {
            sourcePersonIds: string[];
        };
    })[];
    summary: string;
};
export type AgentOperationPlanSummaryRequestDto = {
    focus?: string;
};
export type AgentToolApprovalDto = {
    decision: AgentToolApprovalDecision;
    reason?: string;
};
export type AgentFindTripCandidatesToolRequestDto = {
    lookbackDays?: number;
    maxCandidates?: number;
    placeHint?: string;
    targetDate?: string;
    toolCallId?: string;
};
export type AgentFindTripCandidatesToolApprovalRequiredResponse = {
    status: Status2;
    toolCall: AgentToolCallResponseDto;
};
export type AgentFindTripCandidatesToolDeniedResponse = {
    reason: string;
    status: Status3;
    toolCall: AgentToolCallResponseDto;
};
export type AgentSearchAssetsSelectionHandle = {
    assetCount: number;
    expiresAt: string;
    id: string;
    sourceRef: AgentSearchSourceRef;
    sourceToolCallId: string | null;
};
export type AgentTripCandidateSummary = {
    albumAssetCount: number;
    assetCount: number;
    cities: string[];
    confidence: AgentTripCandidateConfidence;
    countries: string[];
    dayCount: number;
    dedupeKey: string;
    excludedDuplicateCount: number;
    excludedStackChildCount: number;
    placeLabels: string[];
    score: number;
    selectionHandle: AgentSearchAssetsSelectionHandle;
    states: string[];
    subtitle: string;
    takenAfter: string;
    takenBefore: string;
    title: string;
};
export type AgentTripCandidateUseTopRecommendation = {
    action: AgentTripCandidateUseTopRecommendationAction;
    candidateDedupeKey: string;
    reason: string;
};
export type AgentTripCandidateNonAutoRecommendation = {
    action: AgentTripCandidateNonAutoRecommendationAction;
    reason: string;
};
export type AgentTripCandidateRecommendation = AgentTripCandidateUseTopRecommendation | AgentTripCandidateNonAutoRecommendation;
export type AgentFindTripCandidatesToolSuccessResponse = {
    candidates: AgentTripCandidateSummary[];
    recommendation: AgentTripCandidateRecommendation;
    resultSize: AgentToolResultSize;
    status: Status4;
    summary: string;
    toolCall: AgentToolCallResponseDto;
};
export type AgentFindTripCandidatesToolResponseDto = AgentFindTripCandidatesToolApprovalRequiredResponse | AgentFindTripCandidatesToolDeniedResponse | AgentFindTripCandidatesToolSuccessResponse;
export type AgentListAlbumsToolRequestDto = {
    toolCallId?: string;
};
export type AgentListAlbumsToolApprovalRequiredResponse = {
    status: Status5;
    toolCall: AgentToolCallResponseDto;
};
export type AgentListAlbumsToolDeniedResponse = {
    reason: string;
    status: Status6;
    toolCall: AgentToolCallResponseDto;
};
export type AgentAlbumSummary = {
    albumName: string;
    albumThumbnailAssetId: string | null;
    assetCount: number;
    description: string;
    endDate: string | null;
    id: string;
    ownerId: string;
    startDate: string | null;
};
export type AgentListAlbumsToolSuccessResponse = {
    albums: AgentAlbumSummary[];
    resultSize: AgentToolResultSize;
    status: Status7;
    toolCall: AgentToolCallResponseDto;
};
export type AgentListAlbumsToolResponseDto = AgentListAlbumsToolApprovalRequiredResponse | AgentListAlbumsToolDeniedResponse | AgentListAlbumsToolSuccessResponse;
export type AgentListDuplicateGroupsToolRequestDto = {
    /** Maximum number of duplicate groups to return (default 50) */
    maxGroups?: number;
    /** Approved tool call id when retrying after user approval */
    toolCallId?: string;
};
export type AgentListDuplicateGroupsToolApprovalRequiredResponse = {
    status: Status8;
    toolCall: AgentToolCallResponseDto;
};
export type AgentListDuplicateGroupsToolDeniedResponse = {
    reason: string;
    status: Status9;
    toolCall: AgentToolCallResponseDto;
};
export type AgentDuplicateAsset = {
    fileCreatedAt: string;
    height: number | null;
    id: string;
    isFavorite: boolean;
    originalFileName: string;
    rating: number | null;
    sharpness: number | null;
    width: number | null;
};
export type AgentDuplicateGroup = {
    assets: AgentDuplicateAsset[];
    duplicateId: string;
};
export type AgentListDuplicateGroupsToolSuccessResponse = {
    groups: AgentDuplicateGroup[];
    resultSize: AgentToolResultSize;
    status: Status10;
    toolCall: AgentToolCallResponseDto;
};
export type AgentListDuplicateGroupsToolResponseDto = AgentListDuplicateGroupsToolApprovalRequiredResponse | AgentListDuplicateGroupsToolDeniedResponse | AgentListDuplicateGroupsToolSuccessResponse;
export type AgentListSpacesToolRequestDto = {
    /** Approved tool call id when retrying after user approval */
    toolCallId?: string;
};
export type AgentListSpacesToolApprovalRequiredResponse = {
    status: Status11;
    toolCall: AgentToolCallResponseDto;
};
export type AgentListSpacesToolDeniedResponse = {
    reason: string;
    status: Status12;
    toolCall: AgentToolCallResponseDto;
};
export type AgentSpaceSummary = {
    assetCount: number;
    color: string;
    createdById: string;
    description: string | null;
    id: string;
    memberCount: number;
    name: string;
    recentAssetIds: string[];
    thumbnailAssetId: string | null;
};
export type AgentListSpacesToolSuccessResponse = {
    resultSize: AgentToolResultSize;
    spaces: AgentSpaceSummary[];
    status: Status13;
    toolCall: AgentToolCallResponseDto;
};
export type AgentListSpacesToolResponseDto = AgentListSpacesToolApprovalRequiredResponse | AgentListSpacesToolDeniedResponse | AgentListSpacesToolSuccessResponse;
export type AgentReadAlbumToolRequestDto = {
    albumId?: string;
    toolCallId?: string;
};
export type AgentReadAlbumToolApprovalRequiredResponse = {
    status: Status14;
    toolCall: AgentToolCallResponseDto;
};
export type AgentReadAlbumToolDeniedResponse = {
    reason: string;
    status: Status15;
    toolCall: AgentToolCallResponseDto;
};
export type AgentAlbumUserSummary = {
    role: string;
    userId: string;
};
export type AgentAlbumDetail = {
    albumName: string;
    albumThumbnailAssetId: string | null;
    albumUsers: AgentAlbumUserSummary[];
    assetCount: number;
    assetIds: string[];
    description: string;
    endDate: string | null;
    id: string;
    ownerId: string;
    startDate: string | null;
};
export type AgentReadAlbumToolSuccessResponse = {
    album: AgentAlbumDetail;
    resultSize: AgentToolResultSize;
    status: Status16;
    toolCall: AgentToolCallResponseDto;
};
export type AgentReadAlbumToolResponseDto = AgentReadAlbumToolApprovalRequiredResponse | AgentReadAlbumToolDeniedResponse | AgentReadAlbumToolSuccessResponse;
export type AgentReadAssetMetadataToolRequestDto = {
    assetIds?: string[];
    detail?: AgentAssetMetadataDetail;
    fields?: AgentAssetMetadataField[];
    toolCallId?: string;
};
export type AgentReadAssetMetadataToolApprovalRequiredResponse = {
    status: Status17;
    toolCall: AgentToolCallResponseDto;
};
export type AgentReadAssetMetadataToolDeniedResponse = {
    reason: string;
    status: Status18;
    toolCall: AgentToolCallResponseDto;
};
export type AgentAssetMetadataQuality = {
    brightness: number | null;
    exposure: number | null;
    quality: number | null;
    sharpness: number | null;
};
export type AgentAssetMetadataTag = {
    color: string | null;
    id: string;
    value: string;
};
export type AgentAssetMetadataResult = {
    exifInfo?: {
        city?: string | null;
        country?: string | null;
        dateTimeOriginal?: string | null;
        latitude?: number | null;
        lensModel?: string | null;
        longitude?: number | null;
        make?: string | null;
        model?: string | null;
        rating?: number | null;
        state?: string | null;
    } | null;
    fileCreatedAt?: string;
    fileModifiedAt?: string;
    id: string;
    isFavorite?: boolean;
    localDateTime?: string;
    originalFileName?: string;
    qualityInfo?: (AgentAssetMetadataQuality) | null;
    tags?: AgentAssetMetadataTag[];
    "type"?: AssetTypeEnum;
    visibility?: AssetVisibility;
};
export type AgentReadAssetMetadataToolSuccessResponse = {
    assets: AgentAssetMetadataResult[];
    detail?: AgentAssetMetadataDetail;
    fields: AgentAssetMetadataField[];
    resultSize: AgentToolResultSize;
    status: Status19;
    summary: string;
    toolCall: AgentToolCallResponseDto;
};
export type AgentReadAssetMetadataToolResponseDto = AgentReadAssetMetadataToolApprovalRequiredResponse | AgentReadAssetMetadataToolDeniedResponse | AgentReadAssetMetadataToolSuccessResponse;
export type AgentReadAssetOriginalsToolRequestDto = {
    assetIds?: string[];
    toolCallId?: string;
};
export type AgentReadAssetOriginalsToolApprovalRequiredResponse = {
    status: Status20;
    toolCall: AgentToolCallResponseDto;
};
export type AgentReadAssetOriginalsToolDeniedResponse = {
    reason: string;
    status: Status21;
    toolCall: AgentToolCallResponseDto;
};
export type AgentAssetMediaReference = {
    assetId: string;
    fileName: string;
    height: number | null;
    mediaUrl: string;
    mimeType: string;
    width: number | null;
};
export type AgentReadAssetOriginalsToolSuccessResponse = {
    originals: AgentAssetMediaReference[];
    resultSize: AgentToolResultSize;
    status: Status22;
    toolCall: AgentToolCallResponseDto;
};
export type AgentReadAssetOriginalsToolResponseDto = AgentReadAssetOriginalsToolApprovalRequiredResponse | AgentReadAssetOriginalsToolDeniedResponse | AgentReadAssetOriginalsToolSuccessResponse;
export type AgentReadAssetPreviewsToolRequestDto = {
    assetIds?: string[];
    toolCallId?: string;
};
export type AgentReadAssetPreviewsToolApprovalRequiredResponse = {
    status: Status23;
    toolCall: AgentToolCallResponseDto;
};
export type AgentReadAssetPreviewsToolDeniedResponse = {
    reason: string;
    status: Status24;
    toolCall: AgentToolCallResponseDto;
};
export type AgentReadAssetPreviewsToolSuccessResponse = {
    previews: AgentAssetMediaReference[];
    resultSize: AgentToolResultSize;
    status: Status25;
    toolCall: AgentToolCallResponseDto;
};
export type AgentReadAssetPreviewsToolResponseDto = AgentReadAssetPreviewsToolApprovalRequiredResponse | AgentReadAssetPreviewsToolDeniedResponse | AgentReadAssetPreviewsToolSuccessResponse;
export type AgentReadSpaceToolRequestDto = {
    /** Shared space id to inspect */
    spaceId?: string;
    /** Approved tool call id when retrying after user approval */
    toolCallId?: string;
};
export type AgentReadSpaceToolApprovalRequiredResponse = {
    status: Status26;
    toolCall: AgentToolCallResponseDto;
};
export type AgentReadSpaceToolDeniedResponse = {
    reason: string;
    status: Status27;
    toolCall: AgentToolCallResponseDto;
};
export type AgentSpaceMemberSummary = {
    avatarColor: string | null;
    name: string;
    profileImagePath: string | null;
    role: string;
    userId: string;
};
export type AgentSpaceDetail = {
    assetCount: number;
    assetIds: string[];
    assetIdsReturned: number;
    assetIdsTruncated: boolean;
    color: string;
    createdById: string;
    description: string | null;
    id: string;
    memberCount: number;
    members: AgentSpaceMemberSummary[];
    name: string;
    recentAssetIds: string[];
    thumbnailAssetId: string | null;
};
export type AgentReadSpaceToolSuccessResponse = {
    resultSize: AgentToolResultSize;
    space: AgentSpaceDetail;
    status: Status28;
    toolCall: AgentToolCallResponseDto;
};
export type AgentReadSpaceToolResponseDto = AgentReadSpaceToolApprovalRequiredResponse | AgentReadSpaceToolDeniedResponse | AgentReadSpaceToolSuccessResponse;
export type AgentSearchAssetsFilters = {
    albumIds?: string[];
    albumMatchAny?: boolean;
    city?: string | null;
    country?: string | null;
    createdAfter?: string;
    createdBefore?: string;
    isFavorite?: boolean;
    isNotInAlbum?: boolean;
    isTrashed?: boolean;
    lensModel?: string | null;
    make?: string | null;
    maxBrightness?: number;
    maxQuality?: number;
    maxSharpness?: number;
    model?: string | null;
    personIds?: string[];
    personMatchAny?: boolean;
    rating?: number | null;
    spaceId?: string;
    spacePersonIds?: string[];
    state?: string | null;
    tagIds?: string[];
    tagMatchAny?: boolean;
    takenAfter?: string;
    takenBefore?: string;
    "type"?: AssetTypeEnum;
    updatedAfter?: string;
    updatedBefore?: string;
    visibility?: AssetVisibility;
    withSharedSpaces?: boolean;
};
export type AgentSearchAssetsToolRequestDto = {
    createSelectionHandle?: boolean;
    detail?: AgentSearchAssetsRequestDetail;
    fields?: AgentSearchAssetsField[];
    filters?: AgentSearchAssetsFilters;
    limit?: number;
    mode?: AgentSearchAssetsMode;
    order?: AgentSearchAssetsOrder;
    page?: number;
    query?: string;
    sampleSize?: number;
    toolCallId?: string;
};
export type AgentSearchAssetsToolApprovalRequiredResponse = {
    status: Status29;
    toolCall: AgentToolCallResponseDto;
};
export type AgentSearchAssetsToolDeniedResponse = {
    reason: string;
    status: Status30;
    toolCall: AgentToolCallResponseDto;
};
export type AgentSearchAssetsSampleItem = {
    exifInfo?: {
        city?: string | null;
        country?: string | null;
        dateTimeOriginal?: string | null;
        latitude?: number | null;
        lensModel?: string | null;
        longitude?: number | null;
        make?: string | null;
        model?: string | null;
        rating?: number | null;
        state?: string | null;
    } | null;
    fileCreatedAt?: string;
    fileModifiedAt?: string;
    isFavorite?: boolean;
    itemRef: string;
    localDateTime?: string;
    originalFileName?: string;
    tags?: {
        color: string | null;
        value: string;
    }[];
    "type"?: AssetTypeEnum;
    visibility?: AssetVisibility;
};
export type AgentSearchAssetsSample = {
    items: AgentSearchAssetsSampleItem[];
    sampleSize: number;
};
export type AgentSearchAssetsToolSuccessResponse = {
    approximateTotal?: number;
    detail: AgentSearchAssetsDetail;
    hasMore: boolean;
    nextPage: string | null;
    resultSize: AgentToolResultSize;
    returnedCount: number;
    sample?: AgentSearchAssetsSample;
    selectionHandle: AgentSearchAssetsSelectionHandle;
    status: Status31;
    summary: string;
    toolCall: AgentToolCallResponseDto;
    totalCount?: number;
};
export type AgentSearchAssetsToolResponseDto = AgentSearchAssetsToolApprovalRequiredResponse | AgentSearchAssetsToolDeniedResponse | AgentSearchAssetsToolSuccessResponse;
export type AgentSearchPeopleToolRequestDto = {
    /** Set to true to include hidden people in results (for unhide flows) */
    includeHidden?: boolean;
    name?: string;
    toolCallId?: string;
};
export type AgentSearchPeopleToolApprovalRequiredResponse = {
    status: Status32;
    toolCall: AgentToolCallResponseDto;
};
export type AgentSearchPeopleToolDeniedResponse = {
    reason: string;
    status: Status33;
    toolCall: AgentToolCallResponseDto;
};
export type AgentSearchPeopleNotFoundResult = {
    status: Status34;
};
export type AgentSearchPeopleMatchedResult = {
    name: string;
    personId: string;
    status: Status35;
    thumbnailAssetId: string | null;
};
export type AgentSearchPeopleChoice = {
    name: string;
    personId: string;
    thumbnailAssetId: string | null;
};
export type AgentSearchPeopleAmbiguousResult = {
    choices: AgentSearchPeopleChoice[];
    status: Status36;
};
export type AgentSearchPeopleResult = AgentSearchPeopleNotFoundResult | AgentSearchPeopleMatchedResult | AgentSearchPeopleAmbiguousResult;
export type AgentSearchPeopleToolSuccessResponse = {
    people: AgentSearchPeopleResult;
    resultSize: AgentToolResultSize;
    status: Status37;
    toolCall: AgentToolCallResponseDto;
};
export type AgentSearchPeopleToolResponseDto = AgentSearchPeopleToolApprovalRequiredResponse | AgentSearchPeopleToolDeniedResponse | AgentSearchPeopleToolSuccessResponse;
export type AgentSearchUsersToolRequestDto = {
    limit?: number;
    query?: string;
    /** Approved tool call id when retrying after user approval */
    toolCallId?: string;
};
export type AgentSearchUsersToolApprovalRequiredResponse = {
    status: Status38;
    toolCall: AgentToolCallResponseDto;
};
export type AgentSearchUsersToolDeniedResponse = {
    reason: string;
    status: Status39;
    toolCall: AgentToolCallResponseDto;
};
export type AgentUserLookupResult = {
    avatarColor: string | null;
    email: string | null;
    name: string;
    profileImagePath: string | null;
    userId: string;
};
export type AgentSearchUsersToolSuccessResponse = {
    resultSize: AgentToolResultSize;
    status: Status40;
    toolCall: AgentToolCallResponseDto;
    users: AgentUserLookupResult[];
};
export type AgentSearchUsersToolResponseDto = AgentSearchUsersToolApprovalRequiredResponse | AgentSearchUsersToolDeniedResponse | AgentSearchUsersToolSuccessResponse;
export type AlbumUserResponseDto = {
    role: AlbumUserRole;
    user: UserResponseDto;
};
export type ContributorCountResponseDto = {
    /** Number of assets contributed */
    assetCount: number;
    /** User ID */
    userId: string;
};
export type AlbumSharedSpaceLinkResponseDto = {
    /** User who linked the album into the space */
    linkedById: string | null;
    /** Whether the album appears in the aggregated space timeline */
    showInTimeline: boolean;
    /** Shared space ID this album is linked into */
    spaceId: string;
    /** Shared space name */
    spaceName: string;
};
export type AlbumResponseDto = {
    /** Album name */
    albumName: string;
    /** Thumbnail asset ID */
    albumThumbnailAssetId: string | null;
    /** First entry is always the album owner. Second entry is the auth user, if it differs from the owner. The rest are ordered alphabetically. */
    albumUsers: AlbumUserResponseDto[];
    /** Number of assets */
    assetCount: number;
    contributorCounts?: ContributorCountResponseDto[];
    /** Creation date */
    createdAt: string;
    /** Album description */
    description: string;
    /** End date (latest asset) */
    endDate?: string;
    /** Has shared link */
    hasSharedLink: boolean;
    /** Album ID */
    id: string;
    /** Activity feed enabled */
    isActivityEnabled: boolean;
    /** Last modified asset timestamp */
    lastModifiedAssetTimestamp?: string;
    order?: AssetOrder;
    /** Is shared album */
    shared: boolean;
    sharedSpaceLinks?: AlbumSharedSpaceLinkResponseDto[];
    /** Start date (earliest asset) */
    startDate?: string;
    /** Last update date */
    updatedAt: string;
};
export type AlbumUserCreateDto = {
    role: AlbumUserRole;
    /** User ID */
    userId: string;
};
export type CreateAlbumDto = {
    /** Album name */
    albumName: string;
    /** Album users */
    albumUsers?: AlbumUserCreateDto[];
    /** Initial asset IDs */
    assetIds?: string[];
    /** Album description */
    description?: string;
};
export type AlbumsAddAssetsDto = {
    /** Album IDs */
    albumIds: string[];
    /** Asset IDs */
    assetIds: string[];
};
export type AlbumsAddAssetsResponseDto = {
    error?: BulkIdErrorReason;
    /** Operation success */
    success: boolean;
};
export type AlbumNameDto = {
    albumName: string;
    albumThumbnailAssetId: string | null;
    assetCount: number;
    endDate?: string;
    id: string;
    shared: boolean;
    startDate?: string;
};
export type AlbumStatisticsResponseDto = {
    /** Number of non-shared albums */
    notShared: number;
    /** Number of owned albums */
    owned: number;
    /** Number of shared albums */
    shared: number;
};
export type UpdateAlbumDto = {
    /** Album name */
    albumName?: string;
    /** Album thumbnail asset ID */
    albumThumbnailAssetId?: string;
    /** Album creation date. Must include a timezone designator (Z or ±HH:MM). */
    createdAt?: string;
    /** Album description */
    description?: string;
    /** Enable activity feed */
    isActivityEnabled?: boolean;
    order?: AssetOrder;
};
export type BulkIdsDto = {
    /** IDs to process */
    ids: string[];
};
export type BulkIdResponseDto = {
    error?: BulkIdErrorReason;
    errorMessage?: string;
    /** ID */
    id: string;
    /** Whether operation succeeded */
    success: boolean;
};
export type MapMarkerResponseDto = {
    /** City name */
    city: string | null;
    /** Country name */
    country: string | null;
    /** Asset ID */
    id: string;
    /** Latitude */
    lat: number;
    /** Longitude */
    lon: number;
    /** State/Province name */
    state: string | null;
};
export type UpdateAlbumUserDto = {
    role: AlbumUserRole;
};
export type AlbumUserAddDto = {
    /** Album user role */
    role?: AlbumUserRole;
    /** User ID */
    userId: string;
};
export type AddUsersDto = {
    /** Album users to add */
    albumUsers: AlbumUserAddDto[];
};
export type ApiKeyResponseDto = {
    /** Creation date */
    createdAt: string;
    /** API key ID */
    id: string;
    /** API key name */
    name: string;
    /** List of permissions */
    permissions: Permission[];
    /** Last update date */
    updatedAt: string;
};
export type ApiKeyCreateDto = {
    /** API key name */
    name?: string;
    /** List of permissions */
    permissions: Permission[];
};
export type ApiKeyCreateResponseDto = {
    apiKey: ApiKeyResponseDto;
    /** API key secret (only shown once) */
    secret: string;
};
export type ApiKeyUpdateDto = {
    /** API key name */
    name?: string;
    /** List of permissions */
    permissions?: Permission[];
};
export type AssetBulkDeleteDto = {
    /** Force delete even if in use */
    force?: boolean;
    /** IDs to process */
    ids: string[];
};
export type AssetMetadataUpsertItemDto = {
    /** Metadata key */
    key: string;
    /** Metadata value (object) */
    value: {
        [key: string]: any;
    };
};
export type AssetMediaCreateDto = {
    /** Asset file data */
    assetData: Blob;
    /** Duration in milliseconds (for videos) */
    duration?: number;
    /** File creation date */
    fileCreatedAt: string;
    /** File modification date */
    fileModifiedAt: string;
    /** Filename */
    filename?: string;
    /** Mark as favorite */
    isFavorite?: boolean;
    /** Live photo video ID */
    livePhotoVideoId?: string;
    /** Asset metadata items */
    metadata?: AssetMetadataUpsertItemDto[];
    /** Sidecar file data */
    sidecarData?: Blob;
    visibility?: AssetVisibility;
};
export type AssetMediaResponseDto = {
    /** Asset media ID */
    id: string;
    status: AssetMediaStatus;
};
export type AssetBulkUpdateDto = {
    /** Original date and time */
    dateTimeOriginal?: string;
    /** Relative time offset in minutes */
    dateTimeRelative?: number;
    /** Asset description */
    description?: string;
    /** Duplicate ID */
    duplicateId?: string | null;
    /** Asset IDs to update */
    ids: string[];
    /** Mark as favorite */
    isFavorite?: boolean;
    /** Latitude coordinate */
    latitude?: number;
    /** Longitude coordinate */
    longitude?: number;
    /** Rating in range [1-5] (starred), -1 (rejected), or null (unrated) */
    rating?: number | null;
    /** Time zone (IANA timezone) */
    timeZone?: string;
    visibility?: AssetVisibility;
};
export type AssetBulkUploadCheckItem = {
    /** Base64 or hex encoded SHA1 hash */
    checksum: string;
    /** Client-side identifier echoed in the response to match results to inputs (e.g. filename) */
    id: string;
};
export type AssetBulkUploadCheckDto = {
    /** Assets to check */
    assets: AssetBulkUploadCheckItem[];
};
export type AssetBulkUploadCheckResult = {
    action: AssetUploadAction;
    /** Existing asset ID if duplicate */
    assetId?: string;
    /** Client-side identifier echoed from the request to match results to inputs */
    id: string;
    /** Whether existing asset is trashed */
    isTrashed?: boolean;
    reason?: AssetRejectReason;
};
export type AssetBulkUploadCheckResponseDto = {
    /** Upload check results */
    results: AssetBulkUploadCheckResult[];
};
export type AssetCopyDto = {
    /** Copy album associations */
    albums?: boolean;
    /** Copy favorite status */
    favorite?: boolean;
    /** Copy shared links */
    sharedLinks?: boolean;
    /** Copy sidecar file */
    sidecar?: boolean;
    /** Source asset ID */
    sourceId: string;
    /** Copy stack association */
    stack?: boolean;
    /** Target asset ID */
    targetId: string;
};
export type AssetJobsDto = {
    /** Asset IDs */
    assetIds: string[];
    name: AssetJobName;
};
export type AssetMetadataBulkDeleteItemDto = {
    /** Asset ID */
    assetId: string;
    /** Metadata key */
    key: string;
};
export type AssetMetadataBulkDeleteDto = {
    /** Metadata items to delete */
    items: AssetMetadataBulkDeleteItemDto[];
};
export type AssetMetadataBulkUpsertItemDto = {
    /** Asset ID */
    assetId: string;
    /** Metadata key */
    key: string;
    /** Metadata value (object) */
    value: {
        [key: string]: any;
    };
};
export type AssetMetadataBulkUpsertDto = {
    /** Metadata items to upsert */
    items: AssetMetadataBulkUpsertItemDto[];
};
export type AssetMetadataBulkResponseDto = {
    /** Asset ID */
    assetId: string;
    /** Metadata key */
    key: string;
    /** Last update date */
    updatedAt: string;
    /** Metadata value (object) */
    value: {
        [key: string]: any;
    };
};
export type ExifResponseDto = {
    /** City name */
    city?: string | null;
    /** Country name */
    country?: string | null;
    /** Original date/time */
    dateTimeOriginal?: string | null;
    /** Image description */
    description?: string | null;
    /** Image height in pixels */
    exifImageHeight?: number | null;
    /** Image width in pixels */
    exifImageWidth?: number | null;
    /** Exposure time */
    exposureTime?: string | null;
    /** F-number (aperture) */
    fNumber?: number | null;
    /** File size in bytes */
    fileSizeInByte?: number | null;
    /** Focal length in mm */
    focalLength?: number | null;
    /** ISO sensitivity */
    iso?: number | null;
    /** GPS latitude */
    latitude?: number | null;
    /** Lens model */
    lensModel?: string | null;
    /** GPS longitude */
    longitude?: number | null;
    /** Camera make */
    make?: string | null;
    /** Camera model */
    model?: string | null;
    /** Modification date/time */
    modifyDate?: string | null;
    /** Image orientation */
    orientation?: string | null;
    /** Projection type */
    projectionType?: string | null;
    /** Rating */
    rating?: number | null;
    /** State/province name */
    state?: string | null;
    /** Time zone */
    timeZone?: string | null;
};
export type ScopedPrimaryProfile = {
    id: string;
    spaceId?: string;
    "type": Type5;
};
export type PersonResponseDto = {
    /** Person date of birth */
    birthDate: string | null;
    /** Person color (hex) */
    color?: string;
    /** Scoped identity filter token */
    filterId?: string;
    /** Person ID */
    id: string;
    /** Is favorite */
    isFavorite?: boolean;
    /** Is hidden */
    isHidden: boolean;
    /** Person name */
    name: string;
    /** Accessible asset count for this grouped person */
    numberOfAssets?: number;
    /** Accessible profile used for navigation */
    primaryProfile?: ScopedPrimaryProfile;
    /** Space person ID when viewed through a shared space */
    spacePersonId?: string;
    /** Pet species (e.g. dog, cat) */
    species?: string | null;
    /** Thumbnail path */
    thumbnailPath: string;
    /** Entity type (person or pet) */
    "type"?: string;
    /** Last update date */
    updatedAt?: string;
};
export type AssetStackResponseDto = {
    /** Number of assets in stack */
    assetCount: number;
    /** Stack ID */
    id: string;
    /** Primary asset ID */
    primaryAssetId: string;
};
export type TagResponseDto = {
    /** Tag color (hex) */
    color?: string;
    /** Creation date */
    createdAt: string;
    /** Tag ID */
    id: string;
    /** Tag name */
    name: string;
    /** Parent tag ID */
    parentId?: string;
    /** Last update date */
    updatedAt: string;
    /** Tag value (full path) */
    value: string;
};
export type AssetResponseDto = {
    /** Base64 encoded SHA1 hash */
    checksum: string;
    /** The UTC timestamp when the asset was originally uploaded to Immich. */
    createdAt: string;
    /** Duplicate group ID */
    duplicateId?: string | null;
    /** Video/gif duration in milliseconds (null for static images) */
    duration: number | null;
    exifInfo?: ExifResponseDto;
    /** The actual UTC timestamp when the file was created/captured, preserving timezone information. This is the authoritative timestamp for chronological sorting within timeline groups. Combined with timezone data, this can be used to determine the exact moment the photo was taken. */
    fileCreatedAt: string;
    /** The UTC timestamp when the file was last modified on the filesystem. This reflects the last time the physical file was changed, which may be different from when the photo was originally taken. */
    fileModifiedAt: string;
    /** Whether asset has metadata */
    hasMetadata: boolean;
    /** Asset height */
    height: number | null;
    /** Asset ID */
    id: string;
    /** Is archived */
    isArchived: boolean;
    /** Is edited */
    isEdited: boolean;
    /** Is favorite */
    isFavorite: boolean;
    /** Is offline */
    isOffline: boolean;
    /** Is trashed */
    isTrashed: boolean;
    /** Library ID */
    libraryId?: string | null;
    /** Live photo video ID */
    livePhotoVideoId?: string | null;
    /** The local date and time when the photo/video was taken, derived from EXIF metadata. This represents the photographer's local time regardless of timezone, stored as a timezone-agnostic timestamp. Used for timeline grouping by "local" days and months. */
    localDateTime: string;
    /** Original file name */
    originalFileName: string;
    /** Original MIME type */
    originalMimeType?: string;
    /** Original file path */
    originalPath: string;
    owner?: UserResponseDto;
    /** Owner user ID */
    ownerId: string;
    people?: PersonResponseDto[];
    /** Is resized */
    resized?: boolean;
    /** Resolved space ID (when server auto-detects space context) */
    resolvedSpaceId?: string;
    stack?: (AssetStackResponseDto) | null;
    tags?: TagResponseDto[];
    /** Thumbhash for thumbnail generation (base64) also used as the c query param for thumbnail cache busting. */
    thumbhash: string | null;
    "type": AssetTypeEnum;
    /** The UTC timestamp when the asset record was last updated in the database. This is automatically maintained by the database and reflects when any field in the asset was last modified. */
    updatedAt: string;
    visibility: AssetVisibility;
    /** Asset width */
    width: number | null;
};
export type UpdateAssetDto = {
    /** Original date and time */
    dateTimeOriginal?: string;
    /** Asset description */
    description?: string;
    /** Mark as favorite */
    isFavorite?: boolean;
    /** Latitude coordinate */
    latitude?: number;
    /** Live photo video ID */
    livePhotoVideoId?: string | null;
    /** Longitude coordinate */
    longitude?: number;
    /** Rating in range [1-5] (starred), -1 (rejected), or null (unrated) */
    rating?: number | null;
    visibility?: AssetVisibility;
};
export type CropParameters = {
    /** Height of the crop */
    height: number;
    /** Width of the crop */
    width: number;
    /** Top-Left X coordinate of crop */
    x: number;
    /** Top-Left Y coordinate of crop */
    y: number;
};
export type RotateParameters = {
    /** Rotation angle in degrees */
    angle: number;
};
export type MirrorParameters = {
    axis: MirrorAxis;
};
export type TrimParameters = {
    /** End time in seconds */
    endTime: number;
    /** Start time in seconds */
    startTime: number;
};
export type AdjustParameters = {
    /** Auto-enhance (contrast stretch) */
    autoEnhance?: boolean;
    /** Brightness adjustment level */
    brightness?: TonalLevel;
    /** Contrast adjustment level */
    contrast?: TonalLevel;
    /** Saturation adjustment level */
    saturation?: TonalLevel;
};
export type AssetEditActionItemResponseDto = {
    action: AssetEditAction;
    /** Asset edit ID */
    id: string;
    /** List of edit actions to apply (crop, rotate, mirror, trim, or adjust) */
    parameters: CropParameters | RotateParameters | MirrorParameters | TrimParameters | AdjustParameters;
};
export type AssetEditsResponseDto = {
    /** Asset ID these edits belong to */
    assetId: string;
    /** List of edit actions applied to the asset */
    edits: AssetEditActionItemResponseDto[];
};
export type AssetEditActionItemDto = {
    action: AssetEditAction;
    /** List of edit actions to apply (crop, rotate, mirror, trim, or adjust) */
    parameters: CropParameters | RotateParameters | MirrorParameters | TrimParameters | AdjustParameters;
};
export type AssetEditsCreateDto = {
    /** List of edit actions to apply (crop, rotate, mirror, or trim) */
    edits: AssetEditActionItemDto[];
};
export type AssetMetadataResponseDto = {
    /** Metadata key */
    key: string;
    /** Last update date */
    updatedAt: string;
    /** Metadata value (object) */
    value: {
        [key: string]: any;
    };
};
export type AssetMetadataUpsertDto = {
    /** Metadata items to upsert */
    items: AssetMetadataUpsertItemDto[];
};
export type AssetOcrResponseDto = {
    assetId: string;
    /** Confidence score for text detection box */
    boxScore: number;
    id: string;
    /** Recognized text */
    text: string;
    /** Confidence score for text recognition */
    textScore: number;
    /** Normalized x coordinate of box corner 1 (0-1) */
    x1: number;
    /** Normalized x coordinate of box corner 2 (0-1) */
    x2: number;
    /** Normalized x coordinate of box corner 3 (0-1) */
    x3: number;
    /** Normalized x coordinate of box corner 4 (0-1) */
    x4: number;
    /** Normalized y coordinate of box corner 1 (0-1) */
    y1: number;
    /** Normalized y coordinate of box corner 2 (0-1) */
    y2: number;
    /** Normalized y coordinate of box corner 3 (0-1) */
    y3: number;
    /** Normalized y coordinate of box corner 4 (0-1) */
    y4: number;
};
export type SignUpDto = {
    /** User email */
    email: string;
    /** User name */
    name: string;
    /** User password */
    password: string;
};
export type ChangePasswordDto = {
    /** Invalidate all other sessions */
    invalidateSessions?: boolean;
    /** New password (min 8 characters) */
    newPassword: string;
    /** Current password */
    password: string;
};
export type LoginCredentialDto = {
    /** User email */
    email: string;
    /** User password */
    password: string;
};
export type LoginResponseDto = {
    /** Access token */
    accessToken: string;
    /** Is admin user */
    isAdmin: boolean;
    /** Is onboarded */
    isOnboarded: boolean;
    /** User name */
    name: string;
    /** Profile image path */
    profileImagePath: string;
    /** Should change password */
    shouldChangePassword: boolean;
    /** User email */
    userEmail: string;
    /** User ID */
    userId: string;
};
export type LogoutResponseDto = {
    /** Redirect URI */
    redirectUri: string;
    /** Logout successful */
    successful: boolean;
};
export type PinCodeResetDto = {
    /** User password (required if PIN code is not provided) */
    password?: string;
    /** New PIN code (4-6 digits) */
    pinCode?: string;
};
export type PinCodeSetupDto = {
    /** PIN code (4-6 digits) */
    pinCode: string;
};
export type PinCodeChangeDto = {
    /** New PIN code (4-6 digits) */
    newPinCode: string;
    /** User password (required if PIN code is not provided) */
    password?: string;
    /** New PIN code (4-6 digits) */
    pinCode?: string;
};
export type SessionUnlockDto = {
    /** User password (required if PIN code is not provided) */
    password?: string;
    /** New PIN code (4-6 digits) */
    pinCode?: string;
};
export type AuthStatusResponseDto = {
    /** Session expiration date */
    expiresAt?: string;
    /** Is elevated session */
    isElevated: boolean;
    /** Has password set */
    password: boolean;
    /** Has PIN code set */
    pinCode: boolean;
    /** PIN expiration date */
    pinExpiresAt?: string;
};
export type ValidateAccessTokenResponseDto = {
    /** Authentication status */
    authStatus: boolean;
};
export type DownloadArchiveDto = {
    /** Asset IDs */
    assetIds: string[];
    /** Download edited asset if available */
    edited?: boolean;
};
export type DownloadInfoDto = {
    /** Album ID to download */
    albumId?: string;
    /** Archive size limit in bytes */
    archiveSize?: number;
    /** Asset IDs to download */
    assetIds?: string[];
    /** Shared space ID to download all assets from */
    spaceId?: string;
    /** User ID to download assets from */
    userId?: string;
};
export type DownloadArchiveInfo = {
    /** Asset IDs in this archive */
    assetIds: string[];
    /** Archive size in bytes */
    size: number;
};
export type DownloadResponseDto = {
    /** Archive information */
    archives: DownloadArchiveInfo[];
    /** Total size in bytes */
    totalSize: number;
};
export type DuplicateResponseDto = {
    /** Duplicate assets */
    assets: AssetResponseDto[];
    /** Duplicate group ID */
    duplicateId: string;
    /** Suggested asset IDs to keep based on file size and EXIF data */
    suggestedKeepAssetIds: string[];
};
export type DuplicateResolveGroupDto = {
    duplicateId: string;
    /** Asset IDs to keep */
    keepAssetIds: string[];
    /** Asset IDs to trash or delete */
    trashAssetIds: string[];
};
export type DuplicateResolveDto = {
    /** List of duplicate groups to resolve */
    groups: DuplicateResolveGroupDto[];
};
export type AssetFaceResponseDto = {
    /** Bounding box X1 coordinate */
    boundingBoxX1: number;
    /** Bounding box X2 coordinate */
    boundingBoxX2: number;
    /** Bounding box Y1 coordinate */
    boundingBoxY1: number;
    /** Bounding box Y2 coordinate */
    boundingBoxY2: number;
    /** Face ID */
    id: string;
    /** Image height in pixels */
    imageHeight: number;
    /** Image width in pixels */
    imageWidth: number;
    person: (PersonResponseDto) | null;
    sourceType?: SourceType;
};
export type AssetFaceCreateDto = {
    /** Asset ID */
    assetId: string;
    /** Face bounding box height */
    height: number;
    /** Image height in pixels */
    imageHeight: number;
    /** Image width in pixels */
    imageWidth: number;
    /** Person ID */
    personId: string;
    /** Face bounding box width */
    width: number;
    /** Face bounding box X coordinate */
    x: number;
    /** Face bounding box Y coordinate */
    y: number;
};
export type AssetFaceDeleteDto = {
    /** Force delete even if person has other faces */
    force: boolean;
};
export type FaceDto = {
    /** Face ID */
    id: string;
};
export type QueueStatisticsDto = {
    /** Number of active jobs */
    active: number;
    /** Number of completed jobs */
    completed: number;
    /** Number of delayed jobs */
    delayed: number;
    /** Number of failed jobs */
    failed: number;
    /** Number of paused jobs */
    paused: number;
    /** Number of waiting jobs */
    waiting: number;
};
export type QueueStatusLegacyDto = {
    /** Whether the queue is currently active (has running jobs) */
    isActive: boolean;
    /** Whether the queue is paused */
    isPaused: boolean;
};
export type QueueResponseLegacyDto = {
    jobCounts: QueueStatisticsDto;
    queueStatus: QueueStatusLegacyDto;
};
export type QueuesResponseLegacyDto = {
    backgroundTask: QueueResponseLegacyDto;
    backupDatabase: QueueResponseLegacyDto;
    classification: QueueResponseLegacyDto;
    duplicateDetection: QueueResponseLegacyDto;
    editor: QueueResponseLegacyDto;
    faceDetection: QueueResponseLegacyDto;
    facialRecognition: QueueResponseLegacyDto;
    imageQuality: QueueResponseLegacyDto;
    integrityCheck: QueueResponseLegacyDto;
    library: QueueResponseLegacyDto;
    metadataExtraction: QueueResponseLegacyDto;
    migration: QueueResponseLegacyDto;
    notifications: QueueResponseLegacyDto;
    ocr: QueueResponseLegacyDto;
    peopleBackfill: QueueResponseLegacyDto;
    petDetection: QueueResponseLegacyDto;
    search: QueueResponseLegacyDto;
    sidecar: QueueResponseLegacyDto;
    smartSearch: QueueResponseLegacyDto;
    storageBackendMigration: QueueResponseLegacyDto;
    storageTemplateMigration: QueueResponseLegacyDto;
    thumbnailGeneration: QueueResponseLegacyDto;
    videoConversion: QueueResponseLegacyDto;
    workflow: QueueResponseLegacyDto;
};
export type JobCreateDto = {
    name: ManualJobName;
};
export type QueueCommandDto = {
    command: QueueCommand;
    /** Force the command execution (if applicable) */
    force?: boolean;
};
export type LibraryResponseDto = {
    /** Number of assets */
    assetCount: number;
    /** Creation date */
    createdAt: string;
    /** Exclusion patterns */
    exclusionPatterns: string[];
    /** Library ID */
    id: string;
    /** Import paths */
    importPaths: string[];
    /** Library name */
    name: string;
    /** Owner user ID */
    ownerId: string;
    /** Last refresh date */
    refreshedAt: string | null;
    /** Last update date */
    updatedAt: string;
};
export type CreateLibraryDto = {
    /** Exclusion patterns (max 128) */
    exclusionPatterns?: string[];
    /** Import paths (max 128) */
    importPaths?: string[];
    /** Library name */
    name?: string;
    /** Owner user ID */
    ownerId: string;
};
export type UpdateLibraryDto = {
    /** Exclusion patterns (max 128) */
    exclusionPatterns?: string[];
    /** Import paths (max 128) */
    importPaths?: string[];
    /** Library name */
    name?: string;
};
export type LibraryStatsResponseDto = {
    /** Number of photos */
    photos: number;
    /** Total number of assets */
    total: number;
    /** Storage usage in bytes */
    usage: number;
    /** Number of videos */
    videos: number;
};
export type ValidateLibraryDto = {
    /** Exclusion patterns (max 128) */
    exclusionPatterns?: string[];
    /** Import paths to validate (max 128) */
    importPaths?: string[];
};
export type ValidateLibraryImportPathResponseDto = {
    /** Import path */
    importPath: string;
    /** Is valid */
    isValid: boolean;
    /** Validation message */
    message?: string;
};
export type ValidateLibraryResponseDto = {
    /** Validation results for import paths */
    importPaths?: ValidateLibraryImportPathResponseDto[];
};
export type MapReverseGeocodeResponseDto = {
    /** City name */
    city: string | null;
    /** Country name */
    country: string | null;
    /** State/Province name */
    state: string | null;
};
export type MemoryResponseDto = {
    assets: AssetResponseDto[];
    /** Creation date */
    createdAt: string;
    /** Memory data */
    data: {
        [key: string]: any;
    };
    /** Deletion date */
    deletedAt?: string;
    /** Date when memory should be hidden */
    hideAt?: string;
    /** Memory ID */
    id: string;
    /** Is memory saved */
    isSaved: boolean;
    /** Memory date */
    memoryAt: string;
    /** Owner user ID */
    ownerId: string;
    /** Date when memory was seen */
    seenAt?: string;
    /** Date when memory should be shown */
    showAt?: string;
    /** Server-defined display subtitle */
    subtitle?: string;
    /** Server-defined display title */
    title?: string;
    "type": MemoryType;
    /** Last update date */
    updatedAt: string;
};
export type MemoryCreateDto = {
    /** Asset IDs to associate with memory */
    assetIds?: string[];
    /** Memory data */
    data: {
        [key: string]: any;
    };
    /** Date when memory should be hidden */
    hideAt?: string;
    /** Is memory saved */
    isSaved?: boolean;
    /** Memory date */
    memoryAt: string;
    /** Date when memory was seen */
    seenAt?: string;
    /** Date when memory should be shown */
    showAt?: string;
    "type": MemoryType;
};
export type MemoryStatisticsResponseDto = {
    /** Total number of memories */
    total: number;
};
export type MemoryUpdateDto = {
    /** Is memory saved */
    isSaved?: boolean;
    /** Memory date */
    memoryAt?: string;
    /** Date when memory was seen */
    seenAt?: string;
};
export type NotificationDeleteAllDto = {
    /** Notification IDs to delete */
    ids: string[];
};
export type NotificationUpdateAllDto = {
    /** Notification IDs to update */
    ids: string[];
    /** Date when notifications were read */
    readAt?: string | null;
};
export type NotificationUpdateDto = {
    /** Date when notification was read */
    readAt?: string | null;
};
export type OAuthConfigDto = {
    /** OAuth code challenge (PKCE) */
    codeChallenge?: string;
    /** OAuth redirect URI */
    redirectUri: string;
    /** OAuth state parameter */
    state?: string;
};
export type OAuthAuthorizeResponseDto = {
    /** OAuth authorization URL */
    url: string;
};
export type OAuthBackchannelLogoutDto = {
    /** OAuth logout token */
    logout_token: string;
};
export type OAuthCallbackDto = {
    /** OAuth code verifier (PKCE) */
    codeVerifier?: string;
    /** OAuth state parameter */
    state?: string;
    /** OAuth callback URL */
    url: string;
};
export type PartnerResponseDto = {
    avatarColor: UserAvatarColor;
    /** User email */
    email: string;
    /** User ID */
    id: string;
    /** Show in timeline */
    inTimeline?: boolean;
    /** User name */
    name: string;
    /** Profile change date */
    profileChangedAt: string;
    /** Profile image path */
    profileImagePath: string;
};
export type PartnerCreateDto = {
    /** User ID to share with */
    sharedWithId: string;
};
export type PartnerUpdateDto = {
    /** Show partner assets in timeline */
    inTimeline: boolean;
};
export type PeopleResponseDto = {
    /** Whether there are more pages */
    hasNextPage?: boolean;
    /** Number of hidden people */
    hidden: number;
    people: PersonResponseDto[];
    /** Total number of people */
    total: number;
};
export type PersonCreateDto = {
    /** Person date of birth */
    birthDate?: string | null;
    /** Person color (hex) */
    color?: string | null;
    /** Mark as favorite */
    isFavorite?: boolean;
    /** Person visibility (hidden) */
    isHidden?: boolean;
    /** Person name */
    name?: string;
};
export type PeopleUpdateItem = {
    /** Person date of birth */
    birthDate?: string | null;
    /** Person color (hex) */
    color?: string | null;
    /** Asset ID used for feature face thumbnail */
    featureFaceAssetId?: string;
    /** Person ID */
    id: string;
    /** Mark as favorite */
    isFavorite?: boolean;
    /** Person visibility (hidden) */
    isHidden?: boolean;
    /** Person name */
    name?: string;
};
export type PeopleUpdateDto = {
    /** People to update */
    people: PeopleUpdateItem[];
};
export type ScopedPersonProfileRefDto = {
    /** Scoped profile ID */
    id: string;
    /** Space ID for Space Person refs */
    spaceId?: string;
    /** Scoped profile type */
    "type": Type6;
};
export type DetachScopedPersonDto = {
    /** Scoped profile to detach */
    profile: ScopedPersonProfileRefDto;
};
export type PeopleFaceStatisticsResponseDto = {
    /** Number of detected faces assigned to hidden people */
    assignedHiddenFaceCount: number;
    /** Number of detected faces assigned to visible people */
    assignedVisibleFaceCount: number;
    /** Number of detected faces in the accessible people scope */
    detectedFaceCount: number;
    /** Number of named visible people in the accessible people scope */
    namedVisiblePersonCount: number;
    /** Number of detected faces not assigned to people in this scope */
    unassignedFaceCount: number;
};
export type MergeScopedPeopleDto = {
    /** Acknowledgement that this merge will combine two people belonging to another user, which cannot be undone. Required to commit such a merge. */
    confirmCrossOwner?: boolean;
    /** Source scoped profiles */
    sources: ScopedPersonProfileRefDto[];
    /** Target scoped profile */
    target: ScopedPersonProfileRefDto;
};
export type PeopleStatisticsResponseDto = {
    /** Number of detected faces in the accessible people scope */
    detectedFaceCount: number;
    /** Number of hidden people */
    hidden: number;
    /** Total number of people */
    total: number;
};
export type PersonUpdateDto = {
    /** Person date of birth */
    birthDate?: string | null;
    /** Person color (hex) */
    color?: string | null;
    /** Asset ID used for feature face thumbnail */
    featureFaceAssetId?: string;
    /** Mark as favorite */
    isFavorite?: boolean;
    /** Person visibility (hidden) */
    isHidden?: boolean;
    /** Person name */
    name?: string;
};
export type PersonFaceSuggestionResponseDto = {
    /** Unassigned asset face ID */
    assetFaceId: string;
    /** Asset ID containing the candidate face */
    assetId: string;
    /** Bounding box X1 coordinate */
    boundingBoxX1: number;
    /** Bounding box X2 coordinate */
    boundingBoxX2: number;
    /** Bounding box Y1 coordinate */
    boundingBoxY1: number;
    /** Bounding box Y2 coordinate */
    boundingBoxY2: number;
    /** Embedding distance to the person */
    distance: number;
    /** Asset creation date */
    fileCreatedAt?: string;
    /** Image height in pixels */
    imageHeight: number;
    /** Image width in pixels */
    imageWidth: number;
};
export type PersonFaceSuggestionPageResponseDto = {
    items: PersonFaceSuggestionResponseDto[];
    /** Total in-band pending suggestions for this person */
    total: number;
};
export type FaceSuggestionActionResponseDto = {
    /** Whether the call changed anything. False when the suggestion was already resolved. */
    acted: boolean;
};
export type PersonFaceResponseDto = {
    /** Asset ID containing the face */
    assetId: string;
    /** Bounding box X1 coordinate */
    boundingBoxX1: number;
    /** Bounding box X2 coordinate */
    boundingBoxX2: number;
    /** Bounding box Y1 coordinate */
    boundingBoxY1: number;
    /** Bounding box Y2 coordinate */
    boundingBoxY2: number;
    /** Asset creation date */
    fileCreatedAt?: string;
    /** Face ID */
    id: string;
    /** Image height in pixels */
    imageHeight: number;
    /** Image width in pixels */
    imageWidth: number;
    /** Whether this face is the current representative face */
    isRepresentative: boolean;
    sourceType?: SourceType;
};
export type PersonFacePageResponseDto = {
    faces: PersonFaceResponseDto[];
    hasNextPage: boolean;
};
export type MergePersonDto = {
    /** Acknowledgement that this merge will combine two people belonging to another user, which cannot be undone. Required to commit such a merge. */
    confirmCrossOwner?: boolean;
    /** Person IDs to merge */
    ids: string[];
};
export type AssetFaceUpdateItem = {
    /** Asset ID */
    assetId: string;
    /** Person ID */
    personId: string;
};
export type AssetFaceUpdateDto = {
    /** Face update items */
    data: AssetFaceUpdateItem[];
};
export type RepresentativeFaceUpdateDto = {
    /** Asset face ID used as the representative face */
    assetFaceId: string;
};
export type PersonStatisticsResponseDto = {
    /** Number of assets */
    assets: number;
    /** Number of faces assigned to this person in the current accessible scope */
    faces: number;
};
export type PluginMethodResponseDto = {
    /** Description */
    description: string;
    hostFunctions: boolean;
    /** Key */
    key: string;
    /** Name */
    name: string;
    schema?: {};
    /** Title */
    title: string;
    /** Workflow types */
    types: WorkflowType[];
    /** Ui hints */
    uiHints: string[];
};
export type PluginResponseDto = {
    /** Plugin author */
    author: string;
    /** Creation date */
    createdAt: string;
    /** Plugin description */
    description: string;
    /** Plugin ID */
    id: string;
    /** Plugin methods */
    methods: PluginMethodResponseDto[];
    /** Plugin name */
    name: string;
    /** Plugin title */
    title: string;
    /** Last update date */
    updatedAt: string;
    /** Plugin version */
    version: string;
};
export type PluginTemplateStepResponseDto = {
    /** Step configuration */
    config: {
        [key: string]: any;
    } | null;
    /** Whether the step is enabled */
    enabled?: boolean;
    /** Step plugin method */
    method: string;
};
export type PluginTemplateResponseDto = {
    /** Template description */
    description: string;
    /** Template key (unique across all templates) */
    key: string;
    /** Workflow steps */
    steps: PluginTemplateStepResponseDto[];
    /** Template title */
    title: string;
    /** Workflow trigger */
    trigger: WorkflowTrigger;
    /** Ui hints, for example "smart-album" */
    uiHints: string[];
};
export type QueueJobTypeCountsDto = {
    /** Number of sampled active jobs with this name */
    active: number;
    /** Number of sampled delayed jobs with this name */
    delayed: number;
    name: JobName;
    /** Number of sampled paused jobs with this name */
    paused: number;
    /** Number of sampled waiting jobs with this name */
    waiting: number;
};
export type QueueResponseDto = {
    /** Whether the queue is paused */
    isPaused: boolean;
    /** Sampled job type counts for display purposes */
    jobTypes?: QueueJobTypeCountsDto[];
    name: QueueName;
    statistics: QueueStatisticsDto;
};
export type QueueUpdateDto = {
    /** Whether to pause the queue */
    isPaused?: boolean;
};
export type QueueDeleteDto = {
    /** If true, will also remove failed jobs from the queue. */
    failed?: boolean;
};
export type QueueJobResponseDto = {
    /** Job data payload */
    data: {
        [key: string]: any;
    };
    /** Job ID */
    id?: string;
    name: JobName;
    /** Job creation timestamp */
    timestamp: number;
};
export type SearchExploreItem = {
    data: AssetResponseDto;
    /** Explore value */
    value: string;
};
export type SearchExploreResponseDto = {
    /** Explore field name */
    fieldName: string;
    items: SearchExploreItem[];
};
export type MetadataSearchDto = {
    /** Filter by album IDs */
    albumIds?: string[];
    /** Filter by file checksum */
    checksum?: string;
    /** Filter by city name */
    city?: string | null;
    /** Filter by country name */
    country?: string | null;
    /** Filter by creation date (after) */
    createdAfter?: string;
    /** Filter by creation date (before) */
    createdBefore?: string;
    /** Filter by description text */
    description?: string;
    /** Filter by encoded video file path */
    encodedVideoPath?: string;
    /** Filter by asset ID */
    id?: string;
    /** Filter by encoded status */
    isEncoded?: boolean;
    /** Filter by favorite status */
    isFavorite?: boolean;
    /** Filter assets in at least one album */
    isInAlbum?: boolean;
    /** Filter by motion photo status */
    isMotion?: boolean;
    /** Filter assets not in any album */
    isNotInAlbum?: boolean;
    /** Filter by offline status */
    isOffline?: boolean;
    /** Filter by lens model */
    lensModel?: string | null;
    /** Library ID to filter by */
    libraryId?: string | null;
    /** Filter by camera make */
    make?: string | null;
    /** Filter by camera model */
    model?: string | null;
    /** Filter by OCR text content */
    ocr?: string;
    /** Sort order */
    order?: AssetOrder;
    /** Filter by original file name */
    originalFileName?: string;
    /** Filter by original file path */
    originalPath?: string;
    /** Filter by asset owner (contributor). Narrows within the current scope; never widens it. */
    ownerId?: string;
    /** Page number */
    page?: number;
    /** Filter by person IDs */
    personIds?: string[];
    /** Filter by preview file path */
    previewPath?: string;
    /** Filter by rating [1-5], or null for unrated */
    rating?: number | null;
    /** Number of results to return */
    size?: number;
    /** Shared space ID to filter by */
    spaceId?: string;
    /** Shared space person IDs to filter by */
    spacePersonIds?: string[];
    /** Filter by state/province name */
    state?: string | null;
    /** Filter by tag IDs */
    tagIds?: string[] | null;
    /** Filter by taken date (after) */
    takenAfter?: string;
    /** Filter by taken date (before) */
    takenBefore?: string;
    /** Filter by thumbnail file path */
    thumbnailPath?: string;
    /** Filter by trash date (after) */
    trashedAfter?: string;
    /** Filter by trash date (before) */
    trashedBefore?: string;
    "type"?: AssetTypeEnum;
    /** Filter by update date (after) */
    updatedAfter?: string;
    /** Filter by update date (before) */
    updatedBefore?: string;
    visibility?: AssetVisibility;
    /** Include deleted assets */
    withDeleted?: boolean;
    /** Include EXIF data in response */
    withExif?: boolean;
    /** Include people data in response */
    withPeople?: boolean;
    /** Include shared spaces the user is a member of */
    withSharedSpaces?: boolean;
    /** Include stacked assets */
    withStacked?: boolean;
};
export type SearchFacetCountResponseDto = {
    /** Number of assets with this facet value */
    count: number;
    /** Facet value */
    value: string;
};
export type SearchFacetResponseDto = {
    counts: SearchFacetCountResponseDto[];
    /** Facet field name */
    fieldName: string;
};
export type SearchAlbumResponseDto = {
    /** Number of albums in this page */
    count: number;
    facets: SearchFacetResponseDto[];
    items: AlbumResponseDto[];
    /** Total number of matching albums */
    total: number;
};
export type SearchAssetResponseDto = {
    /** Number of assets in this page */
    count: number;
    facets: SearchFacetResponseDto[];
    items: AssetResponseDto[];
    /** Next page token */
    nextPage: string | null;
    /** Total number of matching assets */
    total: number;
};
export type SearchResponseDto = {
    albums: SearchAlbumResponseDto;
    assets: SearchAssetResponseDto;
};
export type PlacesResponseDto = {
    /** Administrative level 1 name (state/province) */
    admin1name?: string;
    /** Administrative level 2 name (county/district) */
    admin2name?: string;
    /** Latitude coordinate */
    latitude: number;
    /** Longitude coordinate */
    longitude: number;
    /** Place name */
    name: string;
};
export type RandomSearchDto = {
    /** Filter by album IDs */
    albumIds?: string[];
    /** Filter by city name */
    city?: string | null;
    /** Filter by country name */
    country?: string | null;
    /** Filter by creation date (after) */
    createdAfter?: string;
    /** Filter by creation date (before) */
    createdBefore?: string;
    /** Filter by encoded status */
    isEncoded?: boolean;
    /** Filter by favorite status */
    isFavorite?: boolean;
    /** Filter assets in at least one album */
    isInAlbum?: boolean;
    /** Filter by motion photo status */
    isMotion?: boolean;
    /** Filter assets not in any album */
    isNotInAlbum?: boolean;
    /** Filter by offline status */
    isOffline?: boolean;
    /** Filter by lens model */
    lensModel?: string | null;
    /** Library ID to filter by */
    libraryId?: string | null;
    /** Filter by camera make */
    make?: string | null;
    /** Filter by camera model */
    model?: string | null;
    /** Filter by OCR text content */
    ocr?: string;
    /** Filter by asset owner (contributor). Narrows within the current scope; never widens it. */
    ownerId?: string;
    /** Filter by person IDs */
    personIds?: string[];
    /** Filter by rating [1-5], or null for unrated */
    rating?: number | null;
    /** Number of results to return */
    size?: number;
    /** Shared space ID to filter by */
    spaceId?: string;
    /** Shared space person IDs to filter by */
    spacePersonIds?: string[];
    /** Filter by state/province name */
    state?: string | null;
    /** Filter by tag IDs */
    tagIds?: string[] | null;
    /** Filter by taken date (after) */
    takenAfter?: string;
    /** Filter by taken date (before) */
    takenBefore?: string;
    /** Filter by trash date (after) */
    trashedAfter?: string;
    /** Filter by trash date (before) */
    trashedBefore?: string;
    "type"?: AssetTypeEnum;
    /** Filter by update date (after) */
    updatedAfter?: string;
    /** Filter by update date (before) */
    updatedBefore?: string;
    visibility?: AssetVisibility;
    /** Include deleted assets */
    withDeleted?: boolean;
    /** Include EXIF data in response */
    withExif?: boolean;
    /** Include people data in response */
    withPeople?: boolean;
    /** Include shared spaces the user is a member of */
    withSharedSpaces?: boolean;
    /** Include stacked assets */
    withStacked?: boolean;
};
export type SmartSearchDto = {
    /** Filter by album IDs */
    albumIds?: string[];
    /** Filter by city name */
    city?: string | null;
    /** Filter by country name */
    country?: string | null;
    /** Filter by creation date (after) */
    createdAfter?: string;
    /** Filter by creation date (before) */
    createdBefore?: string;
    /** Filter by encoded status */
    isEncoded?: boolean;
    /** Filter by favorite status */
    isFavorite?: boolean;
    /** Filter assets in at least one album */
    isInAlbum?: boolean;
    /** Filter by motion photo status */
    isMotion?: boolean;
    /** Filter assets not in any album */
    isNotInAlbum?: boolean;
    /** Filter by offline status */
    isOffline?: boolean;
    /** Search language code */
    language?: string;
    /** Filter by lens model */
    lensModel?: string | null;
    /** Library ID to filter by */
    libraryId?: string | null;
    /** Filter by camera make */
    make?: string | null;
    /** Filter by camera model */
    model?: string | null;
    /** Filter by OCR text content */
    ocr?: string;
    /** Sort order (omit for relevance) */
    order?: AssetOrder;
    /** Filter by asset owner (contributor). Narrows within the current scope; never widens it. */
    ownerId?: string;
    /** Page number */
    page?: number;
    /** Filter by person IDs */
    personIds?: string[];
    /** Natural language search query */
    query?: string;
    /** Asset ID to use as search reference */
    queryAssetId?: string;
    /** Filter by rating [1-5], or null for unrated */
    rating?: number | null;
    /** Number of results to return */
    size?: number;
    /** Shared space ID to filter by */
    spaceId?: string;
    /** Shared space person IDs to filter by */
    spacePersonIds?: string[];
    /** Filter by state/province name */
    state?: string | null;
    /** Filter by tag IDs */
    tagIds?: string[] | null;
    /** Filter by taken date (after) */
    takenAfter?: string;
    /** Filter by taken date (before) */
    takenBefore?: string;
    /** Filter by trash date (after) */
    trashedAfter?: string;
    /** Filter by trash date (before) */
    trashedBefore?: string;
    "type"?: AssetTypeEnum;
    /** Filter by update date (after) */
    updatedAfter?: string;
    /** Filter by update date (before) */
    updatedBefore?: string;
    visibility?: AssetVisibility;
    /** Include deleted assets */
    withDeleted?: boolean;
    /** Include EXIF data in response */
    withExif?: boolean;
    /** Include shared spaces the user is a member of */
    withSharedSpaces?: boolean;
};
export type SmartSearchFacetsDto = {
    /** Filter by album IDs */
    albumIds?: string[];
    /** Filter by city name */
    city?: string | null;
    /** Filter by country name */
    country?: string | null;
    /** Filter by favorite status */
    isFavorite?: boolean;
    /** Filter assets in at least one album */
    isInAlbum?: boolean;
    /** Filter assets not in any album */
    isNotInAlbum?: boolean;
    /** Search language code */
    language?: string;
    /** Filter by camera make */
    make?: string | null;
    /** Filter by camera model */
    model?: string | null;
    /** Filter by person IDs */
    personIds?: string[];
    /** Natural language search query */
    query?: string;
    /** Asset ID to use as search reference */
    queryAssetId?: string;
    /** Filter by rating [1-5], or null for unrated */
    rating?: number | null;
    /** Shared space ID to filter by */
    spaceId?: string;
    /** Shared space person IDs to filter by */
    spacePersonIds?: string[];
    /** Filter by tag IDs */
    tagIds?: string[] | null;
    /** Filter by taken date (after) */
    takenAfter?: string;
    /** Filter by taken date (before) */
    takenBefore?: string;
    "type"?: AssetTypeEnum;
    /** Include shared spaces the user is a member of */
    withSharedSpaces?: boolean;
};
export type FilterSuggestionsPersonDto = {
    /** Person ID */
    id: string;
    /** Person name */
    name: string;
    /** Accessible profile used for thumbnails */
    primaryProfile?: ScopedPrimaryProfile;
};
export type FilterSuggestionsTagDto = {
    /** Tag ID */
    id: string;
    /** Tag value/name */
    value: string;
};
export type TimeBucketsResponseDto = {
    /** Number of assets in this time bucket */
    count: number;
    /** Time bucket identifier in YYYY-MM-DD format representing the start of the time period */
    timeBucket: string;
};
export type SmartSearchFacetsResponseDto = {
    /** Available camera makes */
    cameraMakes: string[];
    /** Available camera models for the current smart-search make scope */
    cameraModels: string[];
    /** Available cities for the current smart-search country scope */
    cities: string[];
    /** Available countries */
    countries: string[];
    /** Whether any filtered asset belongs to an album */
    hasAssetsInAlbum: boolean;
    /** Whether any filtered asset belongs to no album */
    hasAssetsNotInAlbum: boolean;
    /** Whether any favourite exists in the filtered set, ignoring isFavorite */
    hasFavorites: boolean;
    /** Whether unnamed people exist in the filtered smart-search set */
    hasUnnamedPeople: boolean;
    /** Available media types */
    mediaTypes: AssetTypeEnum[];
    /** Available people */
    people: FilterSuggestionsPersonDto[];
    /** Available ratings */
    ratings: number[];
    /** Available tags */
    tags: FilterSuggestionsTagDto[];
    /** Available monthly buckets for the smart-search result set */
    timeBuckets: TimeBucketsResponseDto[];
    /** Exact count after applying all active smart-search filters */
    total: number;
};
export type StatisticsSearchDto = {
    /** Filter by album IDs */
    albumIds?: string[];
    /** Filter by city name */
    city?: string | null;
    /** Filter by country name */
    country?: string | null;
    /** Filter by creation date (after) */
    createdAfter?: string;
    /** Filter by creation date (before) */
    createdBefore?: string;
    /** Filter by description text */
    description?: string;
    /** Filter by encoded status */
    isEncoded?: boolean;
    /** Filter by favorite status */
    isFavorite?: boolean;
    /** Filter assets in at least one album */
    isInAlbum?: boolean;
    /** Filter by motion photo status */
    isMotion?: boolean;
    /** Filter assets not in any album */
    isNotInAlbum?: boolean;
    /** Filter by offline status */
    isOffline?: boolean;
    /** Filter by lens model */
    lensModel?: string | null;
    /** Library ID to filter by */
    libraryId?: string | null;
    /** Filter by camera make */
    make?: string | null;
    /** Filter by camera model */
    model?: string | null;
    /** Filter by OCR text content */
    ocr?: string;
    /** Filter by asset owner (contributor). Narrows within the current scope; never widens it. */
    ownerId?: string;
    /** Filter by person IDs */
    personIds?: string[];
    /** Filter by rating [1-5], or null for unrated */
    rating?: number | null;
    /** Shared space ID to filter by */
    spaceId?: string;
    /** Shared space person IDs to filter by */
    spacePersonIds?: string[];
    /** Filter by state/province name */
    state?: string | null;
    /** Filter by tag IDs */
    tagIds?: string[] | null;
    /** Filter by taken date (after) */
    takenAfter?: string;
    /** Filter by taken date (before) */
    takenBefore?: string;
    /** Filter by trash date (after) */
    trashedAfter?: string;
    /** Filter by trash date (before) */
    trashedBefore?: string;
    "type"?: AssetTypeEnum;
    /** Filter by update date (after) */
    updatedAfter?: string;
    /** Filter by update date (before) */
    updatedBefore?: string;
    visibility?: AssetVisibility;
    /** Include shared spaces the user is a member of */
    withSharedSpaces?: boolean;
};
export type SearchStatisticsResponseDto = {
    /** Total number of matching assets */
    total: number;
};
export type FilterSuggestionsResponseDto = {
    /** Available camera makes */
    cameraMakes: string[];
    /** Available countries */
    countries: string[];
    /** Whether any filtered asset belongs to an album */
    hasAssetsInAlbum: boolean;
    /** Whether any filtered asset belongs to no album */
    hasAssetsNotInAlbum: boolean;
    /** Whether any favourite exists in the filtered set, ignoring isFavorite */
    hasFavorites: boolean;
    /** Whether unnamed people exist in the filtered set */
    hasUnnamedPeople: boolean;
    /** Available media types */
    mediaTypes: string[];
    /** Available people (named, non-hidden, with thumbnails) */
    people: FilterSuggestionsPersonDto[];
    /** Available ratings */
    ratings: number[];
    /** Available tags */
    tags: FilterSuggestionsTagDto[];
};
export type TagSuggestionResponseDto = {
    /** Tag ID */
    id: string;
    /** Tag value/name */
    value: string;
};
export type ServerAboutResponseDto = {
    /** Build identifier */
    build?: string;
    /** Build image name */
    buildImage?: string;
    /** Build image URL */
    buildImageUrl?: string;
    /** Build URL */
    buildUrl?: string;
    /** ExifTool version */
    exiftool?: string;
    /** FFmpeg version */
    ffmpeg?: string;
    /** ImageMagick version */
    imagemagick?: string;
    /** libvips version */
    libvips?: string;
    /** Whether the server is licensed */
    licensed: boolean;
    /** Node.js version */
    nodejs?: string;
    /** Repository name */
    repository?: string;
    /** Repository URL */
    repositoryUrl?: string;
    /** Source commit hash */
    sourceCommit?: string;
    /** Source reference (branch/tag) */
    sourceRef?: string;
    /** Source URL */
    sourceUrl?: string;
    /** Third-party bug/feature URL */
    thirdPartyBugFeatureUrl?: string;
    /** Third-party documentation URL */
    thirdPartyDocumentationUrl?: string;
    /** Third-party source URL */
    thirdPartySourceUrl?: string;
    /** Third-party support URL */
    thirdPartySupportUrl?: string;
    /** Server version */
    version: string;
    /** URL to version information */
    versionUrl: string;
};
export type ServerApkLinksDto = {
    /** APK download link for ARM64 v8a architecture */
    arm64v8a: string;
    /** APK download link for ARM EABI v7a architecture */
    armeabiv7a: string;
    /** APK download link for universal architecture */
    universal: string;
    /** APK download link for x86_64 architecture */
    x86_64: string;
};
export type ServerConfigDto = {
    /** Globally-available memory type keys */
    availableMemoryTypes: string[];
    /** External domain URL */
    externalDomain: string;
    /** Whether the server has been initialized */
    isInitialized: boolean;
    /** Whether the admin has completed onboarding */
    isOnboarded: boolean;
    /** Login page message */
    loginPageMessage: string;
    /** Whether maintenance mode is active */
    maintenanceMode: boolean;
    /** Map dark style URL */
    mapDarkStyleUrl: string;
    /** Map light style URL */
    mapLightStyleUrl: string;
    /** People min faces server default */
    minFaces: number;
    /** OAuth button text */
    oauthButtonText: string;
    /** Whether public user registration is enabled */
    publicUsers: boolean;
    /** Number of days before trashed assets are permanently deleted */
    trashDays: number;
    /** Delay in days before deleted users are permanently removed */
    userDeleteDelay: number;
};
export type ServerFeaturesDto = {
    /** Whether config file is available */
    configFile: boolean;
    /** Whether duplicate detection is enabled */
    duplicateDetection: boolean;
    /** Whether email notifications are enabled */
    email: boolean;
    /** Whether facial recognition is enabled */
    facialRecognition: boolean;
    /** Whether face import is enabled */
    importFaces: boolean;
    /** Whether map feature is enabled */
    map: boolean;
    /** Whether OAuth is enabled */
    oauth: boolean;
    /** Whether OAuth auto-launch is enabled */
    oauthAutoLaunch: boolean;
    /** Whether OCR is enabled */
    ocr: boolean;
    /** Whether password login is enabled */
    passwordLogin: boolean;
    /** Whether the people face statistics UI is enabled */
    peopleStatistics: boolean;
    /** Whether real-time transcoding is enabled */
    realtimeTranscoding: boolean;
    /** Whether reverse geocoding is enabled */
    reverseGeocoding: boolean;
    /** Whether search is enabled */
    search: boolean;
    /** Whether sidecar files are supported */
    sidecar: boolean;
    /** Whether smart search is enabled */
    smartSearch: boolean;
    /** Whether smart search has an active relevance cutoff (clip.maxDistance) */
    smartSearchHasCutoff: boolean;
    /** Sync stream request types this server accepts. Absent on servers that predate capability signalling; clients fall back to version-based gating. */
    syncRequestTypes?: string[];
    /** Whether trash feature is enabled */
    trash: boolean;
};
export type LicenseKeyDto = {
    /** Activation key */
    activationKey: string;
    /** License key (format: /^IM(SV|CL)(-[\dA-Za-z]{4}){8}$/) */
    licenseKey: string;
};
export type ServerMediaTypesResponseDto = {
    /** Supported image MIME types */
    image: string[];
    /** Supported sidecar MIME types */
    sidecar: string[];
    /** Supported video MIME types */
    video: string[];
};
export type ServerMlHealthResponseDto = {
    /** Whether the ML server is currently reachable and healthy for smart search */
    smartSearchHealthy: boolean;
};
export type ServerPingResponse = {
    res: string;
};
export type UsageByUserDto = {
    /** Number of photos */
    photos: number;
    /** User quota size in bytes (null if unlimited) */
    quotaSizeInBytes: number | null;
    /** Total storage usage in bytes */
    usage: number;
    /** Storage usage for photos in bytes */
    usagePhotos: number;
    /** Storage usage for videos in bytes */
    usageVideos: number;
    /** User ID */
    userId: string;
    /** User name */
    userName: string;
    /** Number of videos */
    videos: number;
};
export type ServerStatsResponseDto = {
    /** Total number of photos */
    photos: number;
    /** Total storage usage in bytes */
    usage: number;
    /** Array of usage for each user */
    usageByUser: UsageByUserDto[];
    /** Storage usage for photos in bytes */
    usagePhotos: number;
    /** Storage usage for videos in bytes */
    usageVideos: number;
    /** Total number of videos */
    videos: number;
};
export type ServerStorageResponseDto = {
    /** Available disk space (human-readable format) */
    diskAvailable: string;
    /** Available disk space in bytes */
    diskAvailableRaw: number;
    /** Total disk size (human-readable format) */
    diskSize: string;
    /** Total disk size in bytes */
    diskSizeRaw: number;
    /** Disk usage percentage (0-100) */
    diskUsagePercentage: number;
    /** Used disk space (human-readable format) */
    diskUse: string;
    /** Used disk space in bytes */
    diskUseRaw: number;
};
export type ServerVersionResponseDto = {
    /** Major version number */
    major: number;
    /** Minor version number */
    minor: number;
    /** Patch version number */
    patch: number;
    /** Pre-release version number */
    prerelease: number | null;
};
export type VersionCheckStateResponseDto = {
    /** Last check timestamp */
    checkedAt: string | null;
    /** Release version */
    releaseVersion: string | null;
};
export type ServerVersionHistoryResponseDto = {
    /** When this version was first seen */
    createdAt: string;
    /** Version history entry ID */
    id: string;
    /** Version string */
    version: string;
};
export type SessionCreateDto = {
    /** Device OS */
    deviceOS?: string;
    /** Device type */
    deviceType?: string;
    /** Session duration in seconds */
    duration?: number;
};
export type SessionCreateResponseDto = {
    /** App version */
    appVersion: string | null;
    /** Creation date */
    createdAt: string;
    /** Is current session */
    current: boolean;
    /** Device OS */
    deviceOS: string;
    /** Device type */
    deviceType: string;
    /** Expiration date */
    expiresAt?: string;
    /** Session ID */
    id: string;
    /** Is pending sync reset */
    isPendingSyncReset: boolean;
    /** Session token */
    token: string;
    /** Last update date */
    updatedAt: string;
};
export type SessionUpdateDto = {
    /** Reset pending sync state */
    isPendingSyncReset?: boolean;
};
export type SharedLinkResponseDto = {
    album?: AlbumResponseDto;
    /** Allow downloads */
    allowDownload: boolean;
    /** Allow uploads */
    allowUpload: boolean;
    assets: AssetResponseDto[];
    /** Creation date */
    createdAt: string;
    /** Link description */
    description: string | null;
    /** Expiration date */
    expiresAt: string | null;
    /** Shared link ID */
    id: string;
    /** Encryption key (base64url) */
    key: string;
    /** Has password */
    password: string | null;
    /** Show metadata */
    showMetadata: boolean;
    /** Custom URL slug */
    slug: string | null;
    "type": SharedLinkType;
    /** Owner user ID */
    userId: string;
};
export type SharedLinkCreateDto = {
    /** Album ID (for album sharing) */
    albumId?: string;
    /** Allow downloads */
    allowDownload?: boolean;
    /** Allow uploads */
    allowUpload?: boolean;
    /** Asset IDs (for individual assets) */
    assetIds?: string[];
    /** Link description */
    description?: string | null;
    /** Expiration date */
    expiresAt?: string | null;
    /** Link password */
    password?: string | null;
    /** Show metadata */
    showMetadata?: boolean;
    /** Custom URL slug */
    slug?: string | null;
    /** Shared space this link is created from. Lets the link cover assets contributed by other members, which requires the caller to be an Owner or Editor of the space. */
    spaceId?: string;
    "type": SharedLinkType;
};
export type SharedLinkLoginDto = {
    /** Shared link password */
    password: string;
};
export type SharedLinkEditDto = {
    /** Allow downloads */
    allowDownload?: boolean;
    /** Allow uploads */
    allowUpload?: boolean;
    /** Link description */
    description?: string | null;
    /** Expiration date */
    expiresAt?: string | null;
    /** Link password */
    password?: string | null;
    /** Show metadata */
    showMetadata?: boolean;
    /** Custom URL slug */
    slug?: string | null;
};
export type AssetIdsDto = {
    /** Asset IDs */
    assetIds: string[];
};
export type AssetIdsResponseDto = {
    /** Asset ID */
    assetId: string;
    error?: AssetIdErrorReason;
    /** Whether operation succeeded */
    success: boolean;
};
export type SharedSpaceLinkedLibraryDto = {
    addedById: string | null;
    /** Link creation timestamp */
    createdAt: string;
    libraryId: string;
    libraryName: string;
};
export type SharedSpaceMemberResponseDto = {
    /** Avatar color */
    avatarColor?: string;
    /** Number of photos contributed by this member */
    contributionCount?: number;
    /** User email */
    email: string;
    /** Join date */
    joinedAt: string;
    /** Last time this member added a photo */
    lastActiveAt?: string | null;
    /** User name */
    name: string;
    /** Profile change date */
    profileChangedAt?: string;
    /** Profile image path */
    profileImagePath?: string;
    /** Most recently added asset ID by this member */
    recentAssetId?: string | null;
    /** Member role */
    role: SharedSpaceRole;
    /** Share person names and birth dates with this space */
    sharePersonMetadata: boolean;
    /** Show space assets in timeline */
    showInTimeline: boolean;
    /** User ID */
    userId: string;
};
export type SharedSpaceResponseDto = {
    /** Number of linked albums */
    albumCount?: number;
    /** Number of assets */
    assetCount?: number;
    /** Space color */
    color?: (UserAvatarColor) | null;
    /** Creation date */
    createdAt: string;
    /** Creator user ID */
    createdById: string;
    /** Space description */
    description?: string | null;
    /** Whether face recognition is enabled for this space */
    faceRecognitionEnabled?: boolean;
    /** Whether any pet-type persons exist in this space */
    hasPets?: boolean;
    /** Space ID */
    id: string;
    /** Last activity timestamp (most recent asset add) */
    lastActivityAt?: string | null;
    /** Last contributor since last viewed */
    lastContributor?: {
        id: string;
        name: string;
    } | null;
    /** When the current user last viewed this space */
    lastViewedAt?: string | null;
    linkedLibraries?: SharedSpaceLinkedLibraryDto[];
    /** Number of members */
    memberCount?: number;
    /** Space members (summary) */
    members?: SharedSpaceMemberResponseDto[];
    /** Space name */
    name: string;
    /** Number of new assets since last viewed */
    newAssetCount?: number;
    /** Whether pets are shown in space people list */
    petsEnabled?: boolean;
    /** Recent asset IDs for collage display (up to 4) */
    recentAssetIds?: string[];
    /** Thumbhashes for recent assets (parallel array) */
    recentAssetThumbhashes?: string[];
    /** Thumbnail asset ID */
    thumbnailAssetId?: string | null;
    /** Vertical crop position for cover photo (0-100) */
    thumbnailCropY?: number | null;
    /** Last update date */
    updatedAt: string;
};
export type SharedSpaceCreateDto = {
    /** Space color */
    color?: UserAvatarColor;
    /** Space description */
    description?: string;
    /** Space name */
    name: string;
};
export type SharedSpaceUpdateDto = {
    /** Space color */
    color?: UserAvatarColor;
    /** Space description */
    description?: string;
    /** Enable face recognition for this space */
    faceRecognitionEnabled?: boolean;
    /** Space name */
    name?: string;
    /** Show pets in space people list */
    petsEnabled?: boolean;
    /** Thumbnail asset ID */
    thumbnailAssetId?: string | null;
    /** Vertical crop position for cover photo (0-100) */
    thumbnailCropY?: number | null;
};
export type SharedSpaceActivityResponseDto = {
    /** When the event occurred */
    createdAt: string;
    /** Event-specific data */
    data: {
        [key: string]: any;
    };
    /** Activity ID */
    id: string;
    /** Activity type */
    "type": string;
    /** User avatar color */
    userAvatarColor?: string | null;
    /** User email */
    userEmail?: string | null;
    /** User ID who performed the action */
    userId?: string | null;
    /** User name */
    userName?: string | null;
    /** User profile image path */
    userProfileImagePath?: string | null;
};
export type SharedSpaceLinkedAlbumDto = {
    /** User who linked the album into the space */
    addedById: string | null;
    /** Album name */
    albumName: string;
    /** Thumbnail asset ID */
    albumThumbnailAssetId: string | null;
    /** Number of assets */
    assetCount: number;
    contributorCounts?: ContributorCountResponseDto[];
    /** Creation date */
    createdAt: string;
    /** Album description */
    description: string;
    /** End date (latest asset) */
    endDate?: string;
    /** Has shared link */
    hasSharedLink: boolean;
    /** Album ID */
    id: string;
    /** Activity feed enabled */
    isActivityEnabled: boolean;
    /** Last modified asset timestamp */
    lastModifiedAssetTimestamp?: string;
    /** Link creation timestamp */
    linkedAt: string;
    order?: AssetOrder;
    /** User ID of the album owner (non-PII UUID, for group-by-owner) */
    ownerId: string;
    /** Is shared album */
    shared: boolean;
    sharedSpaceLinks?: AlbumSharedSpaceLinkResponseDto[];
    /** Include this album in the space timeline */
    showInTimeline: boolean;
    /** Start date (earliest asset) */
    startDate?: string;
    /** Last update date */
    updatedAt: string;
};
export type SharedSpaceAlbumLinkUpdateDto = {
    /** Include this album in the space timeline */
    showInTimeline: boolean;
};
export type SharedSpaceAssetRemoveDto = {
    /** Asset IDs */
    assetIds: string[];
};
export type SharedSpaceAssetAddDto = {
    /** Asset IDs */
    assetIds: string[];
};
export type SharedSpaceAssetLinkedAlbumDto = {
    /** Album ID */
    albumId: string;
    /** Album name */
    albumName: string;
};
export type SharedSpaceLibraryLinkDto = {
    /** Library ID */
    libraryId: string;
};
export type SharedSpaceMemberCreateDto = {
    /** Member role */
    role?: SharedSpaceRole;
    /** User ID */
    userId: string;
};
export type SharedSpaceMemberPreferencesDto = {
    /** Share person names and birth dates with this space */
    sharePersonMetadata?: boolean;
    /** Show space assets in personal timeline */
    showInTimeline?: boolean;
};
export type SharedSpaceMemberTimelineDto = {
    /** Show space assets in personal timeline */
    showInTimeline: boolean;
};
export type SharedSpaceMemberUpdateDto = {
    /** Member role */
    role: SharedSpaceRole;
};
export type SharedSpaceMemberMetadataContributionDto = {
    /** Disable person metadata contribution for this member */
    sharePersonMetadata: false;
};
export type SharedSpacePersonResponseDto = {
    /** User-specific alias for this person */
    alias?: string | null;
    /** Number of unique assets with this person */
    assetCount: number;
    /** Person date of birth */
    birthDate?: string | null;
    /** Creation date */
    createdAt: string;
    /** Number of faces assigned to this person */
    faceCount: number;
    /** Person ID */
    id: string;
    /** Is hidden */
    isHidden: boolean;
    /** Person name */
    name: string;
    /** Representative face ID */
    representativeFaceId?: string | null;
    /** Representative face source */
    representativeFaceSource: RepresentativeFaceSource;
    /** Space ID */
    spaceId: string;
    /** Thumbnail path */
    thumbnailPath: string;
    /** Person type (person or pet) */
    "type"?: string;
    /** Last update date */
    updatedAt: string;
};
export type SharedSpacePeopleStatisticsResponseDto = {
    /** Number of detected faces in the shared-space people scope */
    detectedFaceCount: number;
    /** Number of hidden people */
    hidden: number;
    /** Total number of people */
    total: number;
};
export type SharedSpacePersonUpdateDto = {
    /** Person date of birth */
    birthDate?: string | null;
    /** Person visibility (hidden) */
    isHidden?: boolean;
    /** Person name */
    name?: string;
    /** Representative face ID */
    representativeFaceId?: string | null;
};
export type SharedSpacePersonAliasDto = {
    /** Alias name for this person */
    alias: string;
};
export type SharedSpacePersonMergeDto = {
    /** Acknowledgement that this merge will combine two people belonging to another user, which cannot be undone. Required to commit such a merge. */
    confirmCrossOwner?: boolean;
    /** Person IDs to merge into target */
    ids: string[];
};
export type SpaceRepresentativeFaceUpdateDto = {
    /** Asset face ID used as the space representative face */
    assetFaceId: string | null;
};
export type StackResponseDto = {
    assets: AssetResponseDto[];
    /** Stack ID */
    id: string;
    /** Primary asset ID */
    primaryAssetId: string;
};
export type StackCreateDto = {
    /** Asset IDs (first becomes primary, min 2) */
    assetIds: string[];
};
export type StackUpdateDto = {
    /** Primary asset ID */
    primaryAssetId?: string;
};
export type StorageMigrationFileTypesDto = {
    /** Include encoded video files */
    encodedVideos?: boolean;
    /** Include full-size files */
    fullsize?: boolean;
    /** Include original files */
    originals?: boolean;
    /** Include person thumbnail files */
    personThumbnails?: boolean;
    /** Include preview files */
    previews?: boolean;
    /** Include profile image files */
    profileImages?: boolean;
    /** Include sidecar files */
    sidecars?: boolean;
    /** Include thumbnail files */
    thumbnails?: boolean;
};
export type StorageMigrationStartDto = {
    /** Concurrency level */
    concurrency?: number;
    /** Delete source files after migration */
    deleteSource?: boolean;
    /** Migration direction */
    direction: StorageMigrationDirection;
    /** File types to migrate */
    fileTypes: StorageMigrationFileTypesDto;
};
export type SyncAckDeleteDto = {
    /** Sync entity types to delete acks for */
    types?: SyncEntityType[];
};
export type SyncAckDto = {
    /** Acknowledgment ID */
    ack: string;
    "type": SyncEntityType;
};
export type SyncAckSetDto = {
    /** Acknowledgment IDs (max 1000) */
    acks: string[];
};
export type SyncStreamDto = {
    /** Reset sync state */
    reset?: boolean;
    /** Sync request types */
    types: SyncRequestType[];
};
export type DatabaseBackupConfig = {
    /** Cron expression */
    cronExpression: string;
    /** Enabled */
    enabled: boolean;
    /** Keep last amount */
    keepLastAmount: number;
};
export type SystemConfigBackupsDto = {
    database: DatabaseBackupConfig;
};
export type SystemConfigClassificationCategoryDto = {
    /** Action to take when an asset matches */
    action: Action;
    /** Whether this category is enabled */
    enabled: boolean;
    faceExclusion?: ClassificationFaceExclusion;
    /** Category name */
    name: string;
    /** CLIP text prompts for this category */
    prompts: string[];
    /** Cosine similarity threshold for matching this category */
    similarity: number;
};
export type SystemConfigClassificationDto = {
    /** Classification categories */
    categories: SystemConfigClassificationCategoryDto[];
    /** Enable classification globally */
    enabled: boolean;
};
export type SystemConfigFFmpegRealtimeDto = {
    /** Enable real-time HLS transcoding (alpha) */
    enabled: boolean;
    /** Resolutions to use for real-time HLS transcoding */
    resolutions: HlsVideoResolution[];
    /** Video codecs to use for real-time HLS transcoding */
    videoCodecs: VideoCodec[];
};
export type SystemConfigFFmpegDto = {
    accel: TranscodeHWAccel;
    /** Accelerated decode */
    accelDecode: boolean;
    /** Accepted audio codecs */
    acceptedAudioCodecs: AudioCodec[];
    /** Accepted containers */
    acceptedContainers: VideoContainer[];
    /** Accepted video codecs */
    acceptedVideoCodecs: VideoCodec[];
    /** B-frames */
    bframes: number;
    cqMode: CQMode;
    /** CRF */
    crf: number;
    /** GOP size */
    gopSize: number;
    /** Max bitrate */
    maxBitrate: string;
    /** Preferred hardware device */
    preferredHwDevice: string;
    /** Preset */
    preset: string;
    realtime: SystemConfigFFmpegRealtimeDto;
    /** References */
    refs: number;
    targetAudioCodec: AudioCodec;
    /** Target resolution */
    targetResolution: string;
    targetVideoCodec: VideoCodec;
    /** Temporal AQ */
    temporalAQ: boolean;
    /** Threads */
    threads: number;
    tonemap: ToneMapping;
    transcode: TranscodePolicy;
    /** Two pass */
    twoPass: boolean;
};
export type SystemConfigGeneratedFullsizeImageDto = {
    /** Enabled */
    enabled: boolean;
    format: ImageFormat;
    /** Progressive */
    progressive?: boolean;
    /** Quality */
    quality: number;
};
export type SystemConfigGeneratedImageDto = {
    format: ImageFormat;
    /** Progressive */
    progressive?: boolean;
    /** Quality */
    quality: number;
    /** Size */
    size: number;
};
export type SystemConfigImageDto = {
    colorspace: Colorspace;
    /** Extract embedded */
    extractEmbedded: boolean;
    fullsize: SystemConfigGeneratedFullsizeImageDto;
    preview: SystemConfigGeneratedImageDto;
    thumbnail: SystemConfigGeneratedImageDto;
};
export type SystemConfigIntegrityChecksumJob = {
    /** Cron expression for when the integrity check should run */
    cronExpression: string;
    /** Enabled */
    enabled: boolean;
    /** Percentage limit of the integrity checksum job */
    percentageLimit: number;
    /** How long the integrity checksum job may run for */
    timeLimit: number;
};
export type SystemConfigIntegrityJob = {
    /** Cron expression for when the integrity check should run */
    cronExpression: string;
    /** Enabled */
    enabled: boolean;
};
export type SystemConfigIntegrityChecks = {
    checksumFiles: SystemConfigIntegrityChecksumJob;
    missingFiles: SystemConfigIntegrityJob;
    untrackedFiles: SystemConfigIntegrityJob;
};
export type JobSettingsDto = {
    /** Concurrency */
    concurrency: number;
};
export type SystemConfigJobDto = {
    backgroundTask: JobSettingsDto;
    classification: JobSettingsDto;
    editor: JobSettingsDto;
    faceDetection: JobSettingsDto;
    imageQuality: JobSettingsDto;
    integrityCheck: JobSettingsDto;
    library: JobSettingsDto;
    metadataExtraction: JobSettingsDto;
    migration: JobSettingsDto;
    notifications: JobSettingsDto;
    ocr: JobSettingsDto;
    peopleBackfill: JobSettingsDto;
    petDetection: JobSettingsDto;
    search: JobSettingsDto;
    sidecar: JobSettingsDto;
    smartSearch: JobSettingsDto;
    thumbnailGeneration: JobSettingsDto;
    videoConversion: JobSettingsDto;
    workflow: JobSettingsDto;
};
export type SystemConfigLibraryScanDto = {
    /** Cron expression */
    cronExpression: string;
    /** Enabled */
    enabled: boolean;
};
export type SystemConfigLibraryWatchDto = {
    /** Enabled */
    enabled: boolean;
};
export type SystemConfigLibraryDto = {
    scan: SystemConfigLibraryScanDto;
    watch: SystemConfigLibraryWatchDto;
};
export type SystemConfigLoggingDto = {
    /** Enabled */
    enabled: boolean;
    level: LogLevel;
};
export type MachineLearningAvailabilityChecksDto = {
    /** Enabled */
    enabled: boolean;
    interval: number;
    timeout: number;
};
export type ClipConfig = {
    /** Whether the task is enabled */
    enabled: boolean;
    /** Maximum cosine distance for smart search results. 0 = disabled. */
    maxDistance: number;
    /** Name of the model to use */
    modelName: string;
};
export type DuplicateDetectionConfig = {
    /** Whether the task is enabled */
    enabled: boolean;
    /** Maximum distance threshold for duplicate detection */
    maxDistance: number;
};
export type FaceSuggestionConfig = {
    /** Whether face suggestions are enabled */
    enabled: boolean;
    /** Maximum embedding distance for a face to be surfaced as a suggestion on a named person */
    maxDistance: number;
};
export type FacialRecognitionConfig = {
    /** Whether the task is enabled */
    enabled: boolean;
    /** Maximum distance threshold for face recognition */
    maxDistance: number;
    /** Minimum number of faces required for recognition */
    minFaces: number;
    /** Minimum confidence score for face detection */
    minScore: number;
    /** Name of the model to use */
    modelName: string;
    suggestions: FaceSuggestionConfig;
};
export type OcrConfig = {
    /** Whether the task is enabled */
    enabled: boolean;
    /** Maximum resolution for OCR processing */
    maxResolution: number;
    /** Minimum confidence score for text detection */
    minDetectionScore: number;
    /** Minimum confidence score for text recognition */
    minRecognitionScore: number;
    /** Name of the model to use */
    modelName: string;
};
export type PetDetectionConfig = {
    /** Whether the task is enabled */
    enabled: boolean;
    /** Minimum confidence score for pet detection */
    minScore: number;
    /** Name of the model to use */
    modelName: string;
};
export type SystemConfigMachineLearningDto = {
    availabilityChecks: MachineLearningAvailabilityChecksDto;
    clip: ClipConfig;
    duplicateDetection: DuplicateDetectionConfig;
    /** Enabled */
    enabled: boolean;
    facialRecognition: FacialRecognitionConfig;
    ocr: OcrConfig;
    petDetection: PetDetectionConfig;
    /** ML service URLs */
    urls: string[];
};
export type SystemConfigMapDto = {
    /** Dark map style URL */
    darkStyle: string;
    /** Enabled */
    enabled: boolean;
    /** Light map style URL */
    lightStyle: string;
};
export type SystemConfigMemoriesDto = {
    /** Birthday memories */
    birthday: boolean;
    /** Months a person must be absent from photos before person_throwback resurfaces them */
    personThrowbackDormancyMonths?: number;
    /** Recent trip memories */
    recentTrips: boolean;
    /** Retention days */
    retentionDays: number;
    /** Max CLIP cosine distance for themed memories */
    themeMaxDistance?: number;
    /** Per-type memory availability overrides */
    types?: {
        [key: string]: boolean;
    };
};
export type SystemConfigFacesDto = {
    /** Import */
    "import": boolean;
};
export type SystemConfigMetadataDto = {
    faces: SystemConfigFacesDto;
};
export type SystemConfigNewVersionCheckDto = {
    channel: ReleaseChannel;
    /** Enabled */
    enabled: boolean;
};
export type SystemConfigNightlyTasksDto = {
    /** Cluster new faces */
    clusterNewFaces: boolean;
    /** Database cleanup */
    databaseCleanup: boolean;
    /** Generate memories */
    generateMemories: boolean;
    /** Missing thumbnails */
    missingThumbnails: boolean;
    /** Start time (HH:MM) */
    startTime: string;
    /** Sync quota usage */
    syncQuotaUsage: boolean;
};
export type SystemConfigNotificationsDto = {
    smtp: SystemConfigSmtpDto;
};
export type SystemConfigOAuthDto = {
    /** Allow insecure requests */
    allowInsecureRequests: boolean;
    /** Auto launch */
    autoLaunch: boolean;
    /** Auto register */
    autoRegister: boolean;
    /** Button text */
    buttonText: string;
    /** Client ID */
    clientId: string;
    /** Client secret */
    clientSecret: string;
    /** Default storage quota */
    defaultStorageQuota: number | null;
    /** Enabled */
    enabled: boolean;
    /** End session endpoint */
    endSessionEndpoint: string;
    /** Issuer URL */
    issuerUrl: string;
    /** Mobile override enabled */
    mobileOverrideEnabled: boolean;
    /** Mobile redirect URI (set to empty string to disable) */
    mobileRedirectUri: string;
    /** Profile signing algorithm */
    profileSigningAlgorithm: string;
    /** OAuth prompt parameter (e.g. select_account, login, consent) */
    prompt: string;
    /** Role claim */
    roleClaim: string;
    /** Scope */
    scope: string;
    /** Signing algorithm */
    signingAlgorithm: string;
    /** Storage label claim */
    storageLabelClaim: string;
    /** Storage quota claim */
    storageQuotaClaim: string;
    /** Timeout */
    timeout: number;
    tokenEndpointAuthMethod: OAuthTokenEndpointAuthMethod;
};
export type SystemConfigPasswordLoginDto = {
    /** Enabled */
    enabled: boolean;
};
export type SystemConfigReverseGeocodingDto = {
    /** Enabled */
    enabled: boolean;
};
export type SystemConfigServerDto = {
    /** External domain */
    externalDomain: string;
    /** Login page message */
    loginPageMessage: string;
    /** Allow a people merge to combine two of another user's people, or two people in a shared space the actor cannot edit, into one (a destructive collapse). Re-points that only move a single person to another identity are always allowed. When off, such combining merges are blocked; when on, each still requires an explicit confirmation. */
    mergePeopleAcrossOwners: boolean;
    /** Public users */
    publicUsers: boolean;
};
export type SystemConfigStorageTemplateDto = {
    /** Enabled */
    enabled: boolean;
    /** Hash verification enabled */
    hashVerificationEnabled: boolean;
    /** Template */
    template: string;
};
export type SystemConfigStorageUsageDto = {
    /** Include thumbnails and transcoded videos in storage usage */
    includeDerivatives: boolean;
};
export type SystemConfigTemplateEmailsDto = {
    /** Album invite template */
    albumInviteTemplate: string;
    /** Album update template */
    albumUpdateTemplate: string;
    /** Welcome template */
    welcomeTemplate: string;
};
export type SystemConfigTemplatesDto = {
    email: SystemConfigTemplateEmailsDto;
};
export type SystemConfigThemeDto = {
    /** Custom CSS for theming */
    customCss: string;
};
export type SystemConfigTrashDto = {
    /** Days */
    days: number;
    /** Enabled */
    enabled: boolean;
};
export type SystemConfigUserDto = {
    /** Delete delay */
    deleteDelay: number;
};
export type SystemConfigDto = {
    backup: SystemConfigBackupsDto;
    classification: SystemConfigClassificationDto;
    ffmpeg: SystemConfigFFmpegDto;
    image: SystemConfigImageDto;
    integrityChecks: SystemConfigIntegrityChecks;
    job: SystemConfigJobDto;
    library: SystemConfigLibraryDto;
    logging: SystemConfigLoggingDto;
    machineLearning: SystemConfigMachineLearningDto;
    map: SystemConfigMapDto;
    memories: SystemConfigMemoriesDto;
    metadata: SystemConfigMetadataDto;
    newVersionCheck: SystemConfigNewVersionCheckDto;
    nightlyTasks: SystemConfigNightlyTasksDto;
    notifications: SystemConfigNotificationsDto;
    oauth: SystemConfigOAuthDto;
    passwordLogin: SystemConfigPasswordLoginDto;
    reverseGeocoding: SystemConfigReverseGeocodingDto;
    server: SystemConfigServerDto;
    storageTemplate: SystemConfigStorageTemplateDto;
    storageUsage: SystemConfigStorageUsageDto;
    templates: SystemConfigTemplatesDto;
    theme: SystemConfigThemeDto;
    trash: SystemConfigTrashDto;
    user: SystemConfigUserDto;
};
export type SystemConfigTemplateStorageOptionDto = {
    /** Available day format options for storage template */
    dayOptions: string[];
    /** Available hour format options for storage template */
    hourOptions: string[];
    /** Available minute format options for storage template */
    minuteOptions: string[];
    /** Available month format options for storage template */
    monthOptions: string[];
    /** Available preset template options */
    presetOptions: string[];
    /** Available second format options for storage template */
    secondOptions: string[];
    /** Available week format options for storage template */
    weekOptions: string[];
    /** Available year format options for storage template */
    yearOptions: string[];
};
export type AdminOnboardingUpdateDto = {
    /** Is admin onboarded */
    isOnboarded: boolean;
};
export type ReverseGeocodingStateResponseDto = {
    /** Last import file name */
    lastImportFileName: string | null;
    /** Last update timestamp */
    lastUpdate: string | null;
};
export type TagCreateDto = {
    /** Tag color (hex) */
    color?: string | null;
    /** Tag name */
    name: string;
    /** Parent tag ID */
    parentId?: string | null;
};
export type TagUpsertDto = {
    /** Tag names to upsert */
    tags: string[];
};
export type TagBulkAssetsDto = {
    /** Asset IDs */
    assetIds: string[];
    /** Tag IDs */
    tagIds: string[];
};
export type TagBulkAssetsResponseDto = {
    /** Number of assets tagged */
    count: number;
};
export type TagUpdateDto = {
    /** Tag color (hex) */
    color?: string | null;
};
export type TimeBucketAssetResponseDto = {
    /** Array of city names extracted from EXIF GPS data */
    city?: (string | null)[];
    /** Array of country names extracted from EXIF GPS data */
    country?: (string | null)[];
    /** Array of UTC timestamps when each asset was originally uploaded to Immich */
    createdAt: string[];
    /** Array of video/gif durations in milliseconds (null for static images) */
    duration: (number | null)[];
    /** Array of file creation timestamps in UTC */
    fileCreatedAt: string[];
    /** Array of asset IDs in the time bucket */
    id: string[];
    /** Array indicating whether each asset is favorited */
    isFavorite: boolean[];
    /** Array indicating whether each asset is an image (false for videos) */
    isImage: boolean[];
    /** Array indicating whether each asset is in the trash */
    isTrashed: boolean[];
    /** Array of latitude coordinates extracted from EXIF GPS data */
    latitude?: (number | null)[];
    /** Array of live photo video asset IDs (null for non-live photos) */
    livePhotoVideoId: (string | null)[];
    /** Array of UTC offset hours at the time each photo was taken. Positive values are east of UTC, negative values are west of UTC. Values may be fractional (e.g., 5.5 for +05:30, -9.75 for -09:45). Applying this offset to 'fileCreatedAt' will give you the time the photo was taken from the photographer's perspective. */
    localOffsetHours: number[];
    /** Array of longitude coordinates extracted from EXIF GPS data */
    longitude?: (number | null)[];
    /** Array of owner IDs for each asset */
    ownerId: string[];
    /** Array of projection types for 360° content (e.g., "EQUIRECTANGULAR", "CUBEFACE", "CYLINDRICAL") */
    projectionType: (string | null)[];
    /** Array of aspect ratios (width/height) for each asset */
    ratio: number[];
    /** Array of stack information as [stackId, assetCount] tuples (null for non-stacked assets) */
    stack?: (string[] | null)[];
    /** Array of BlurHash strings for generating asset previews (base64 encoded) */
    thumbhash: (string | null)[];
    /** Array of visibility statuses for each asset (e.g., ARCHIVE, TIMELINE, HIDDEN, LOCKED) */
    visibility: AssetVisibility[];
};
export type TimeBucketCoverResponseDto = {
    /** Representative asset ID for this bucket */
    representativeAssetId: string | null;
    /** Representative asset width/height ratio */
    representativeRatio: number | null;
    /** Representative asset thumbhash, base64 encoded */
    representativeThumbhash: string | null;
    timeBucket: string;
};
export type TrashResponseDto = {
    /** Number of items in trash */
    count: number;
};
export type UserGroupMemberResponseDto = {
    /** Avatar color */
    avatarColor?: string;
    /** User email */
    email: string;
    /** User name */
    name: string;
    /** Profile image path */
    profileImagePath?: string;
    /** User ID */
    userId: string;
};
export type UserGroupResponseDto = {
    /** Group color */
    color?: (UserAvatarColor) | null;
    /** Creation date */
    createdAt: string;
    /** Group ID */
    id: string;
    /** Members */
    members: UserGroupMemberResponseDto[];
    /** Group name */
    name: string;
    /** Group origin (manual or oidc) */
    origin: string;
};
export type UserGroupCreateDto = {
    /** Group color */
    color?: UserAvatarColor;
    /** Group name */
    name: string;
};
export type UserGroupUpdateDto = {
    /** Group color */
    color?: (UserAvatarColor) | null;
    /** Group name */
    name?: string;
};
export type UserGroupMemberSetDto = {
    /** User IDs */
    userIds: string[];
};
export type UserUpdateMeDto = {
    avatarColor?: (UserAvatarColor) | null;
    /** User email */
    email?: string;
    /** User name */
    name?: string;
    /** User password (deprecated, use change password endpoint) */
    password?: string;
};
export type OnboardingResponseDto = {
    /** Is user onboarded */
    isOnboarded: boolean;
};
export type OnboardingDto = {
    /** Is user onboarded */
    isOnboarded: boolean;
};
export type CreateProfileImageDto = {
    /** Profile image file */
    file: Blob;
};
export type CreateProfileImageResponseDto = {
    /** Profile image change date */
    profileChangedAt: string;
    /** Profile image file path */
    profileImagePath: string;
    /** User ID */
    userId: string;
};
export type WorkflowStepDto = {
    /** Step configuration */
    config: {
        [key: string]: any;
    } | null;
    /** Step is enabled */
    enabled?: boolean;
    /** Step plugin method */
    method: string;
};
export type WorkflowResponseDto = {
    /** Creation date */
    createdAt: string;
    /** Workflow description */
    description: string | null;
    /** Workflow enabled */
    enabled: boolean;
    /** Workflow ID */
    id: string;
    /** Workflow name */
    name: string | null;
    /** Workflow steps */
    steps: WorkflowStepDto[];
    /** Workflow trigger type */
    trigger: WorkflowTrigger;
    /** Update date */
    updatedAt: string;
};
export type WorkflowCreateDto = {
    /** Workflow description */
    description?: string | null;
    /** Workflow enabled */
    enabled?: boolean;
    /** Workflow name */
    name?: string | null;
    steps?: WorkflowStepDto[];
    /** Workflow trigger type */
    trigger: WorkflowTrigger;
};
export type WorkflowTriggerResponseDto = {
    /** Trigger type */
    trigger: WorkflowTrigger;
    /** Workflow types */
    types: WorkflowType[];
};
export type WorkflowUpdateDto = {
    /** Workflow description */
    description?: string | null;
    /** Workflow enabled */
    enabled?: boolean;
    /** Workflow name */
    name?: string | null;
    steps?: WorkflowStepDto[];
    /** Workflow trigger type */
    trigger?: WorkflowTrigger;
};
export type WorkflowShareStepDto = {
    /** Step configuration */
    config: {
        [key: string]: any;
    } | null;
    /** Step is enabled */
    enabled?: boolean;
    /** Step plugin method */
    method: string;
};
export type WorkflowShareResponseDto = {
    /** Workflow description */
    description: string | null;
    /** Workflow name */
    name: string | null;
    /** Workflow steps */
    steps: WorkflowShareStepDto[];
    /** Workflow trigger type */
    trigger: WorkflowTrigger;
};
export type LicenseResponseDto = UserLicense;
export type ReleaseEventV1 = {
    /** When the server last checked for a latest version. As an ISO timestamp */
    checkedAt: string;
    /** Whether a new version is available */
    isAvailable: boolean;
    releaseVersion: ServerVersionResponseDto;
    serverVersion: ServerVersionResponseDto;
    /** Release type */
    "type": ReleaseType;
};
export type SyncAckV1 = {};
export type SyncAlbumDeleteV1 = {
    /** Album ID */
    albumId: string;
};
export type SyncAlbumToAssetDeleteV1 = {
    /** Album ID */
    albumId: string;
    /** Asset ID */
    assetId: string;
};
export type SyncAlbumToAssetV1 = {
    /** Album ID */
    albumId: string;
    /** Asset ID */
    assetId: string;
};
export type SyncAlbumUserDeleteV1 = {
    /** Album ID */
    albumId: string;
    /** User ID */
    userId: string;
};
export type SyncAlbumUserV1 = {
    /** Album ID */
    albumId: string;
    role: AlbumUserRole;
    /** User ID */
    userId: string;
};
export type SyncAlbumV1 = {
    /** Created at */
    createdAt: string;
    /** Album description */
    description: string;
    /** Album ID */
    id: string;
    /** Is activity enabled */
    isActivityEnabled: boolean;
    /** Album name */
    name: string;
    order: AssetOrder;
    /** Owner ID */
    ownerId: string;
    /** Thumbnail asset ID */
    thumbnailAssetId: string | null;
    /** Updated at */
    updatedAt: string;
};
export type SyncAlbumV2 = {
    /** Created at */
    createdAt: string;
    /** Album description */
    description: string;
    /** Album ID */
    id: string;
    /** Is activity enabled */
    isActivityEnabled: boolean;
    /** Album name */
    name: string;
    order: AssetOrder;
    /** Thumbnail asset ID */
    thumbnailAssetId: string | null;
    /** Updated at */
    updatedAt: string;
};
export type SyncAssetDeleteV1 = {
    /** Asset ID */
    assetId: string;
};
export type SyncAssetEditDeleteV1 = {
    /** Edit ID */
    editId: string;
};
export type SyncAssetEditV1 = {
    action: AssetEditAction;
    /** Asset ID */
    assetId: string;
    /** Edit ID */
    id: string;
    /** Edit parameters */
    parameters: {
        [key: string]: any;
    };
    /** Edit sequence */
    sequence: number;
};
export type SyncAssetExifV1 = {
    /** Asset ID */
    assetId: string;
    /** City */
    city: string | null;
    /** Country */
    country: string | null;
    /** Date time original */
    dateTimeOriginal: string | null;
    /** Description */
    description: string | null;
    /** Exif image height */
    exifImageHeight: number | null;
    /** Exif image width */
    exifImageWidth: number | null;
    /** Exposure time */
    exposureTime: string | null;
    /** F number */
    fNumber: number | null;
    /** File size in byte */
    fileSizeInByte: number | null;
    /** Focal length */
    focalLength: number | null;
    /** FPS */
    fps: number | null;
    /** ISO */
    iso: number | null;
    /** Latitude */
    latitude: number | null;
    /** Lens model */
    lensModel: string | null;
    /** Longitude */
    longitude: number | null;
    /** Make */
    make: string | null;
    /** Model */
    model: string | null;
    /** Modify date */
    modifyDate: string | null;
    /** Orientation */
    orientation: string | null;
    /** Profile description */
    profileDescription: string | null;
    /** Projection type */
    projectionType: string | null;
    /** Rating */
    rating: number | null;
    /** State */
    state: string | null;
    /** Time zone */
    timeZone: string | null;
};
export type SyncAssetFaceDeleteV1 = {
    /** Asset face ID */
    assetFaceId: string;
};
export type SyncAssetFaceV1 = {
    /** Asset ID */
    assetId: string;
    /** Bounding box X1 */
    boundingBoxX1: number;
    /** Bounding box X2 */
    boundingBoxX2: number;
    /** Bounding box Y1 */
    boundingBoxY1: number;
    /** Bounding box Y2 */
    boundingBoxY2: number;
    /** Asset face ID */
    id: string;
    /** Image height */
    imageHeight: number;
    /** Image width */
    imageWidth: number;
    /** Person ID */
    personId: string | null;
    /** Source type */
    sourceType: string;
};
export type SyncAssetFaceV2 = {
    /** Asset ID */
    assetId: string;
    /** Bounding box X1 */
    boundingBoxX1: number;
    /** Bounding box X2 */
    boundingBoxX2: number;
    /** Bounding box Y1 */
    boundingBoxY1: number;
    /** Bounding box Y2 */
    boundingBoxY2: number;
    /** Face deleted at */
    deletedAt: string | null;
    /** Asset face ID */
    id: string;
    /** Image height */
    imageHeight: number;
    /** Image width */
    imageWidth: number;
    /** Is the face visible in the asset */
    isVisible: boolean;
    /** Person ID */
    personId: string | null;
    /** Source type */
    sourceType: string;
};
export type SyncAssetMetadataDeleteV1 = {
    /** Asset ID */
    assetId: string;
    /** Key */
    key: string;
};
export type SyncAssetMetadataV1 = {
    /** Asset ID */
    assetId: string;
    /** Key */
    key: string;
    /** Value */
    value: {
        [key: string]: any;
    };
};
export type SyncAssetOcrDeleteV1 = {
    /** Original asset ID of the deleted OCR entry */
    assetId: string;
    /** Timestamp when the OCR entry was deleted */
    deletedAt: string;
    /** Audit row ID of the deleted OCR entry */
    id: string;
};
export type SyncAssetOcrV1 = {
    /** Asset ID */
    assetId: string;
    /** Confidence score of the bounding box */
    boxScore: number;
    /** OCR entry ID */
    id: string;
    /** Whether the OCR entry is visible */
    isVisible: boolean;
    /** Recognized text content */
    text: string;
    /** Confidence score of the recognized text */
    textScore: number;
    /** Top-left X coordinate (normalized 0–1) */
    x1: number;
    /** Top-right X coordinate (normalized 0–1) */
    x2: number;
    /** Bottom-right X coordinate (normalized 0–1) */
    x3: number;
    /** Bottom-left X coordinate (normalized 0–1) */
    x4: number;
    /** Top-left Y coordinate (normalized 0–1) */
    y1: number;
    /** Top-right Y coordinate (normalized 0–1) */
    y2: number;
    /** Bottom-right Y coordinate (normalized 0–1) */
    y3: number;
    /** Bottom-left Y coordinate (normalized 0–1) */
    y4: number;
};
export type SyncAssetV1 = {
    /** Checksum */
    checksum: string;
    /** Uploaded to Immich at */
    createdAt: string | null;
    /** Deleted at */
    deletedAt: string | null;
    /** Duration */
    duration: string | null;
    /** File created at */
    fileCreatedAt: string | null;
    /** File modified at */
    fileModifiedAt: string | null;
    /** Asset height */
    height: number | null;
    /** Asset ID */
    id: string;
    /** Is edited */
    isEdited: boolean;
    /** Is favorite */
    isFavorite: boolean;
    /** Library ID */
    libraryId: string | null;
    /** Live photo video ID */
    livePhotoVideoId: string | null;
    /** Local date time */
    localDateTime: string | null;
    /** Original file name */
    originalFileName: string;
    /** Owner ID */
    ownerId: string;
    /** Stack ID */
    stackId: string | null;
    /** Thumbhash */
    thumbhash: string | null;
    "type": AssetTypeEnum;
    visibility: AssetVisibility;
    /** Asset width */
    width: number | null;
};
export type SyncAssetV2 = {
    /** Checksum */
    checksum: string;
    /** Uploaded to Immich at */
    createdAt: string | null;
    /** Deleted at */
    deletedAt: string | null;
    /** Duration */
    duration: number | null;
    /** File created at */
    fileCreatedAt: string | null;
    /** File modified at */
    fileModifiedAt: string | null;
    /** Asset height */
    height: number | null;
    /** Asset ID */
    id: string;
    /** Is edited */
    isEdited: boolean;
    /** Is favorite */
    isFavorite: boolean;
    /** Library ID */
    libraryId: string | null;
    /** Live photo video ID */
    livePhotoVideoId: string | null;
    /** Local date time */
    localDateTime: string | null;
    /** Original file name */
    originalFileName: string;
    /** Owner ID */
    ownerId: string;
    /** Stack ID */
    stackId: string | null;
    /** Thumbhash */
    thumbhash: string | null;
    "type": AssetTypeEnum;
    visibility: AssetVisibility;
    /** Asset width */
    width: number | null;
};
export type SyncAuthUserV1 = {
    avatarColor?: (UserAvatarColor) | null;
    /** User deleted at */
    deletedAt: string | null;
    /** User email */
    email: string;
    /** User has profile image */
    hasProfileImage: boolean;
    /** User ID */
    id: string;
    /** User is admin */
    isAdmin: boolean;
    /** User name */
    name: string;
    /** User OAuth ID */
    oauthId: string;
    /** User pin code */
    pinCode: string | null;
    /** User profile changed at */
    profileChangedAt: string;
    /** Quota size in bytes */
    quotaSizeInBytes: number | null;
    /** Quota usage in bytes */
    quotaUsageInBytes: number;
    /** User storage label */
    storageLabel: string | null;
};
export type SyncCompleteV1 = {};
export type SyncLibraryAssetDeleteV1 = {
    /** Asset ID */
    assetId: string;
};
export type SyncLibraryDeleteV1 = {
    /** Library ID */
    libraryId: string;
};
export type SyncLibraryV1 = {
    /** Created at */
    createdAt: string;
    /** Library ID */
    id: string;
    /** Library name */
    name: string;
    /** Owner user ID */
    ownerId: string;
    /** Updated at */
    updatedAt: string;
};
export type SyncMemoryAssetDeleteV1 = {
    /** Asset ID */
    assetId: string;
    /** Memory ID */
    memoryId: string;
};
export type SyncMemoryAssetV1 = {
    /** Asset ID */
    assetId: string;
    /** Memory ID */
    memoryId: string;
};
export type SyncMemoryDeleteV1 = {
    /** Memory ID */
    memoryId: string;
};
export type SyncMemoryV1 = {
    /** Created at */
    createdAt: string;
    /** Data */
    data: {
        [key: string]: any;
    };
    /** Deleted at */
    deletedAt: string | null;
    /** Hide at */
    hideAt: string | null;
    /** Memory ID */
    id: string;
    /** Is saved */
    isSaved: boolean;
    /** Memory at */
    memoryAt: string;
    /** Owner ID */
    ownerId: string;
    /** Seen at */
    seenAt: string | null;
    /** Show at */
    showAt: string | null;
    "type": MemoryType;
    /** Updated at */
    updatedAt: string;
};
export type SyncPartnerDeleteV1 = {
    /** Shared by ID */
    sharedById: string;
    /** Shared with ID */
    sharedWithId: string;
};
export type SyncPartnerV1 = {
    /** In timeline */
    inTimeline: boolean;
    /** Shared by ID */
    sharedById: string;
    /** Shared with ID */
    sharedWithId: string;
};
export type SyncPersonDeleteV1 = {
    /** Person ID */
    personId: string;
};
export type SyncPersonV1 = {
    /** Birth date */
    birthDate: string | null;
    /** Color */
    color: string | null;
    /** Created at */
    createdAt: string;
    /** Face asset ID */
    faceAssetId: string | null;
    /** Person ID */
    id: string;
    /** Is favorite */
    isFavorite: boolean;
    /** Is hidden */
    isHidden: boolean;
    /** Person name */
    name: string;
    /** Owner ID */
    ownerId: string;
    /** Updated at */
    updatedAt: string;
};
export type SyncResetV1 = {};
export type SyncSharedSpaceAlbumLinkDeleteV1 = {
    /** Album ID */
    albumId: string;
    /** Shared space ID */
    spaceId: string;
};
export type SyncSharedSpaceAlbumLinkV1 = {
    /** User who linked the album to the space */
    addedById: string | null;
    /** Album ID */
    albumId: string;
    /** Created at */
    createdAt: string;
    /** Whether this album appears in the space timeline */
    showInTimeline: boolean;
    /** Shared space ID */
    spaceId: string;
    /** Updated at */
    updatedAt: string;
};
export type SyncSharedSpaceDeleteV1 = {
    /** Shared space ID */
    spaceId: string;
};
export type SyncSharedSpaceLibraryDeleteV1 = {
    /** Library ID */
    libraryId: string;
    /** Shared space ID */
    spaceId: string;
};
export type SyncSharedSpaceLibraryV1 = {
    /** User who added the library to the space */
    addedById: string | null;
    /** Created at */
    createdAt: string;
    /** Library ID */
    libraryId: string;
    /** Shared space ID */
    spaceId: string;
    /** Updated at */
    updatedAt: string;
};
export type SyncSharedSpaceMemberDeleteV1 = {
    /** Shared space ID */
    spaceId: string;
    /** User ID */
    userId: string;
};
export type SyncSharedSpaceMemberV1 = {
    /** When the user joined the space */
    joinedAt: string;
    /** Member role */
    role: string;
    /** Whether the space contributes to the user timeline */
    showInTimeline: boolean;
    /** Shared space ID */
    spaceId: string;
    /** User ID */
    userId: string;
};
export type SyncSharedSpaceToAssetDeleteV1 = {
    /** Asset ID */
    assetId: string;
    /** Shared space ID */
    spaceId: string;
};
export type SyncSharedSpaceToAssetV1 = {
    /** Asset ID */
    assetId: string;
    /** Shared space ID */
    spaceId: string;
};
export type SyncSharedSpaceV1 = {
    /** Color */
    color: string | null;
    /** Created at */
    createdAt: string;
    /** Created by user ID */
    createdById: string;
    /** Space description */
    description: string | null;
    /** Face recognition enabled */
    faceRecognitionEnabled: boolean;
    /** Shared space ID */
    id: string;
    /** Last activity timestamp */
    lastActivityAt: string | null;
    /** Space name */
    name: string;
    /** Pets enabled */
    petsEnabled: boolean;
    /** Thumbnail asset ID */
    thumbnailAssetId: string | null;
    /** Thumbnail crop Y offset */
    thumbnailCropY: number | null;
    /** Updated at */
    updatedAt: string;
};
export type SyncStackDeleteV1 = {
    /** Stack ID */
    stackId: string;
};
export type SyncStackV1 = {
    /** Created at */
    createdAt: string;
    /** Stack ID */
    id: string;
    /** Owner ID */
    ownerId: string;
    /** Primary asset ID */
    primaryAssetId: string;
    /** Updated at */
    updatedAt: string;
};
export type SyncUserDeleteV1 = {
    /** User ID */
    userId: string;
};
export type SyncUserMetadataDeleteV1 = {
    key: UserMetadataKey;
    /** User ID */
    userId: string;
};
export type SyncUserMetadataV1 = {
    key: UserMetadataKey;
    /** User ID */
    userId: string;
    /** User metadata value */
    value: {
        [key: string]: any;
    };
};
export type SyncUserV1 = {
    avatarColor?: (UserAvatarColor) | null;
    /** User deleted at */
    deletedAt: string | null;
    /** User email */
    email: string;
    /** User has profile image */
    hasProfileImage: boolean;
    /** User ID */
    id: string;
    /** User name */
    name: string;
    /** User profile changed at */
    profileChangedAt: string;
};
/**
 * List all activities
 */
export function getActivities({ albumId, assetId, level, $type, userId }: {
    albumId: string;
    assetId?: string;
    level?: ReactionLevel;
    $type?: ReactionType;
    userId?: string;
}, opts?: Oazapfts.RequestOpts) {
    return oazapfts.ok(oazapfts.fetchJson<{
        status: 200;
        data: ActivityResponseDto[];
    }>(`/activities${QS.query(QS.explode({
        albumId,
        assetId,
        level,
        "type": $type,
        userId
    }))}`, {
        ...opts
    }));
}
/**
 * Create an activity
 */
export function createActivity({ activityCreateDto }: {
    activityCreateDto: ActivityCreateDto;
}, opts?: Oazapfts.RequestOpts) {
    return oazapfts.ok(oazapfts.fetchJson<{
        status: 201;
        data: ActivityResponseDto;
    }>("/activities", oazapfts.json({
        ...opts,
        method: "POST",
        body: activityCreateDto
    })));
}
/**
 * Retrieve activity statistics
 */
export function getActivityStatistics({ albumId, assetId }: {
    albumId: string;
    assetId?: string;
}, opts?: Oazapfts.RequestOpts) {
    return oazapfts.ok(oazapfts.fetchJson<{
        status: 200;
        data: ActivityStatisticsResponseDto;
    }>(`/activities/statistics${QS.query(QS.explode({
        albumId,
        assetId
    }))}`, {
        ...opts
    }));
}
/**
 * Delete an activity
 */
export function deleteActivity({ id }: {
    id: string;
}, opts?: Oazapfts.RequestOpts) {
    return oazapfts.ok(oazapfts.fetchText(`/activities/${encodeURIComponent(id)}`, {
        ...opts,
        method: "DELETE"
    }));
}
/**
 * Unlink all OAuth accounts
 */
export function unlinkAllOAuthAccountsAdmin(opts?: Oazapfts.RequestOpts) {
    return oazapfts.ok(oazapfts.fetchText("/admin/auth/unlink-all", {
        ...opts,
        method: "POST"
    }));
}
/**
 * Delete database backup
 */
export function deleteDatabaseBackup({ databaseBackupDeleteDto }: {
    databaseBackupDeleteDto: DatabaseBackupDeleteDto;
}, opts?: Oazapfts.RequestOpts) {
    return oazapfts.ok(oazapfts.fetchText("/admin/database-backups", oazapfts.json({
        ...opts,
        method: "DELETE",
        body: databaseBackupDeleteDto
    })));
}
/**
 * List database backups
 */
export function listDatabaseBackups(opts?: Oazapfts.RequestOpts) {
    return oazapfts.ok(oazapfts.fetchJson<{
        status: 200;
        data: DatabaseBackupListResponseDto;
    }>("/admin/database-backups", {
        ...opts
    }));
}
/**
 * Start database backup restore flow
 */
export function startDatabaseRestoreFlow(opts?: Oazapfts.RequestOpts) {
    return oazapfts.ok(oazapfts.fetchText("/admin/database-backups/start-restore", {
        ...opts,
        method: "POST"
    }));
}
/**
 * Upload database backup
 */
export function uploadDatabaseBackup({ databaseBackupUploadDto }: {
    databaseBackupUploadDto: DatabaseBackupUploadDto;
}, opts?: Oazapfts.RequestOpts) {
    return oazapfts.ok(oazapfts.fetchText("/admin/database-backups/upload", oazapfts.multipart({
        ...opts,
        method: "POST",
        body: databaseBackupUploadDto
    })));
}
/**
 * Download database backup
 */
export function downloadDatabaseBackup({ filename }: {
    filename: string;
}, opts?: Oazapfts.RequestOpts) {
    return oazapfts.ok(oazapfts.fetchBlob<{
        status: 200;
        data: Blob;
    }>(`/admin/database-backups/${encodeURIComponent(filename)}`, {
        ...opts
    }));
}
/**
 * Run face re-attribution repair
 */
export function runFaceRepair({ faceRepairRequestDto }: {
    faceRepairRequestDto: FaceRepairRequestDto;
}, opts?: Oazapfts.RequestOpts) {
    return oazapfts.ok(oazapfts.fetchJson<{
        status: 201;
        data: FaceRepairResponseDto;
    }>("/admin/face-repair", oazapfts.json({
        ...opts,
        method: "POST",
        body: faceRepairRequestDto
    })));
}
/**
 * Remove face-repair declines
 */
export function removeFaceRepairDeclines({ faceRepairDeclineRemoveRequestDto }: {
    faceRepairDeclineRemoveRequestDto: FaceRepairDeclineRemoveRequestDto;
}, opts?: Oazapfts.RequestOpts) {
    return oazapfts.ok(oazapfts.fetchJson<{
        status: 200;
        data: FaceRepairDeclineRemovedDto;
    }>("/admin/face-repair/decline", oazapfts.json({
        ...opts,
        method: "DELETE",
        body: faceRepairDeclineRemoveRequestDto
    })));
}
/**
 * List face-repair declines
 */
export function getFaceRepairDeclines(opts?: Oazapfts.RequestOpts) {
    return oazapfts.ok(oazapfts.fetchJson<{
        status: 200;
        data: FaceRepairDeclineListDto;
    }>("/admin/face-repair/decline", {
        ...opts
    }));
}
/**
 * Decline flagged faces / dismiss flagged persons
 */
export function declineFaceRepair({ faceRepairDeclineRequestDto }: {
    faceRepairDeclineRequestDto: FaceRepairDeclineRequestDto;
}, opts?: Oazapfts.RequestOpts) {
    return oazapfts.ok(oazapfts.fetchJson<{
        status: 201;
        data: FaceRepairDeclineCreatedDto;
    }>("/admin/face-repair/decline", oazapfts.json({
        ...opts,
        method: "POST",
        body: faceRepairDeclineRequestDto
    })));
}
/**
 * Get an admin face-repair face thumbnail
 */
export function getFaceRepairFaceThumbnail({ assetFaceId }: {
    assetFaceId: string;
}, opts?: Oazapfts.RequestOpts) {
    return oazapfts.ok(oazapfts.fetchBlob<{
        status: 200;
        data: Blob;
    }>(`/admin/face-repair/faces/${encodeURIComponent(assetFaceId)}/thumbnail`, {
        ...opts
    }));
}
/**
 * Search an owner's people for the move-to-chosen-person picker
 */
export function getFaceRepairOwnerPeople({ ownerId, page, query }: {
    ownerId: string;
    page?: number;
    query?: string;
}, opts?: Oazapfts.RequestOpts) {
    return oazapfts.ok(oazapfts.fetchJson<{
        status: 200;
        data: FaceRepairOwnerPeopleResponseDto;
    }>(`/admin/face-repair/owner/${encodeURIComponent(ownerId)}/people${QS.query(QS.explode({
        page,
        query
    }))}`, {
        ...opts
    }));
}
/**
 * Create a person under an owner for the move-to-chosen-person picker
 */
export function createFaceRepairOwnerPerson({ ownerId, faceRepairOwnerPersonCreateRequestDto }: {
    ownerId: string;
    faceRepairOwnerPersonCreateRequestDto: FaceRepairOwnerPersonCreateRequestDto;
}, opts?: Oazapfts.RequestOpts) {
    return oazapfts.ok(oazapfts.fetchJson<{
        status: 201;
        data: FaceRepairOwnerPersonCreatedResponseDto;
    }>(`/admin/face-repair/owner/${encodeURIComponent(ownerId)}/people`, oazapfts.json({
        ...opts,
        method: "POST",
        body: faceRepairOwnerPersonCreateRequestDto
    })));
}
/**
 * Get a person for manual review
 */
export function getFaceRepairPersonMetadata({ personId }: {
    personId: string;
}, opts?: Oazapfts.RequestOpts) {
    return oazapfts.ok(oazapfts.fetchJson<{
        status: 200;
        data: FaceRepairPersonMetadataResponseDto;
    }>(`/admin/face-repair/person/${encodeURIComponent(personId)}`, {
        ...opts
    }));
}
/**
 * List face-repair resolutions (negative verdicts from both engines)
 */
export function getFaceRepairResolutions({ page, size }: {
    page?: number;
    size?: number;
}, opts?: Oazapfts.RequestOpts) {
    return oazapfts.ok(oazapfts.fetchJson<{
        status: 200;
        data: FaceRepairResolutionsListDto;
    }>(`/admin/face-repair/resolutions${QS.query(QS.explode({
        page,
        size
    }))}`, {
        ...opts
    }));
}
/**
 * Remove face-repair resolutions (undo)
 */
export function removeFaceRepairResolutions({ faceRepairResolutionsRemoveRequestDto }: {
    faceRepairResolutionsRemoveRequestDto: FaceRepairResolutionsRemoveRequestDto;
}, opts?: Oazapfts.RequestOpts) {
    return oazapfts.ok(oazapfts.fetchJson<{
        status: 201;
        data: FaceRepairResolutionsRemovedDto;
    }>("/admin/face-repair/resolutions/remove", oazapfts.json({
        ...opts,
        method: "POST",
        body: faceRepairResolutionsRemoveRequestDto
    })));
}
/**
 * Resolve reviewed faces
 */
export function resolveFaces({ faceRepairResolveRequestDto }: {
    faceRepairResolveRequestDto: FaceRepairResolveRequestDto;
}, opts?: Oazapfts.RequestOpts) {
    return oazapfts.ok(oazapfts.fetchJson<{
        status: 201;
        data: FaceRepairResolveResponseDto;
    }>("/admin/face-repair/resolve", oazapfts.json({
        ...opts,
        method: "POST",
        body: faceRepairResolveRequestDto
    })));
}
/**
 * Trigger a face-repair scan
 */
export function triggerScan({ faceRepairScanTriggerRequestDto }: {
    faceRepairScanTriggerRequestDto: FaceRepairScanTriggerRequestDto;
}, opts?: Oazapfts.RequestOpts) {
    return oazapfts.ok(oazapfts.fetchJson<{
        status: 201;
        data: FaceRepairScanTriggerResponseDto;
    }>("/admin/face-repair/scan", oazapfts.json({
        ...opts,
        method: "POST",
        body: faceRepairScanTriggerRequestDto
    })));
}
/**
 * Get effective face-repair scan defaults
 */
export function getFaceRepairScanDefaults(opts?: Oazapfts.RequestOpts) {
    return oazapfts.ok(oazapfts.fetchJson<{
        status: 200;
        data: FaceRepairScanDefaultsDto;
    }>("/admin/face-repair/scan/defaults", {
        ...opts
    }));
}
/**
 * Get the latest face-repair scan
 */
export function getLatestScan(opts?: Oazapfts.RequestOpts) {
    return oazapfts.ok(oazapfts.fetchJson<{
        status: 200;
        data: object;
    }>("/admin/face-repair/scan/latest", {
        ...opts
    }));
}
/**
 * Get a person's flagged faces for review
 */
export function getFaceRepairPersonFaces({ personId }: {
    personId: string;
}, opts?: Oazapfts.RequestOpts) {
    return oazapfts.ok(oazapfts.fetchJson<{
        status: 200;
        data: FaceRepairPersonFacesDto;
    }>(`/admin/face-repair/scan/person/${encodeURIComponent(personId)}`, {
        ...opts
    }));
}
/**
 * List a person's cluster faces (paginated, excluding the supplied flagged ids)
 */
export function getFaceRepairClusterFaces({ personId, faceRepairClusterFacesRequestDto }: {
    personId: string;
    faceRepairClusterFacesRequestDto: FaceRepairClusterFacesRequestDto;
}, opts?: Oazapfts.RequestOpts) {
    return oazapfts.ok(oazapfts.fetchJson<{
        status: 201;
        data: FaceRepairClusterFacesResponseDto;
    }>(`/admin/face-repair/scan/person/${encodeURIComponent(personId)}/cluster-faces`, oazapfts.json({
        ...opts,
        method: "POST",
        body: faceRepairClusterFacesRequestDto
    })));
}
/**
 * Un-confirm human-placed faces so a re-scan may flag them again
 */
export function unconfirmFaceRepairFaces({ faceRepairUnconfirmRequestDto }: {
    faceRepairUnconfirmRequestDto: FaceRepairUnconfirmRequestDto;
}, opts?: Oazapfts.RequestOpts) {
    return oazapfts.ok(oazapfts.fetchJson<{
        status: 201;
        data: FaceRepairResolutionsRemovedDto;
    }>("/admin/face-repair/unconfirm", oazapfts.json({
        ...opts,
        method: "POST",
        body: faceRepairUnconfirmRequestDto
    })));
}
/**
 * Get integrity report by type
 */
export function getIntegrityReport({ cursor, limit, $type }: {
    cursor?: string;
    limit?: number;
    $type: IntegrityReport;
}, opts?: Oazapfts.RequestOpts) {
    return oazapfts.ok(oazapfts.fetchJson<{
        status: 200;
        data: IntegrityReportResponseDto;
    }>(`/admin/integrity/report${QS.query(QS.explode({
        cursor,
        limit,
        "type": $type
    }))}`, {
        ...opts
    }));
}
/**
 * Delete integrity report item
 */
export function deleteIntegrityReport({ id }: {
    id: string;
}, opts?: Oazapfts.RequestOpts) {
    return oazapfts.ok(oazapfts.fetchText(`/admin/integrity/report/${encodeURIComponent(id)}`, {
        ...opts,
        method: "DELETE"
    }));
}
/**
 * Download flagged file
 */
export function getIntegrityReportFile({ id }: {
    id: string;
}, opts?: Oazapfts.RequestOpts) {
    return oazapfts.ok(oazapfts.fetchBlob<{
        status: 200;
        data: Blob;
    }>(`/admin/integrity/report/${encodeURIComponent(id)}/file`, {
        ...opts
    }));
}
/**
 * Export integrity report by type as CSV
 */
export function getIntegrityReportCsv({ $type }: {
    $type: IntegrityReport;
}, opts?: Oazapfts.RequestOpts) {
    return oazapfts.ok(oazapfts.fetchBlob<{
        status: 200;
        data: Blob;
    }>(`/admin/integrity/report/${encodeURIComponent($type)}/csv`, {
        ...opts
    }));
}
/**
 * Get integrity report summary
 */
export function getIntegrityReportSummary(opts?: Oazapfts.RequestOpts) {
    return oazapfts.ok(oazapfts.fetchJson<{
        status: 200;
        data: IntegrityReportSummaryResponseDto;
    }>("/admin/integrity/summary", {
        ...opts
    }));
}
/**
 * Set maintenance mode
 */
export function setMaintenanceMode({ setMaintenanceModeDto }: {
    setMaintenanceModeDto: SetMaintenanceModeDto;
}, opts?: Oazapfts.RequestOpts) {
    return oazapfts.ok(oazapfts.fetchText("/admin/maintenance", oazapfts.json({
        ...opts,
        method: "POST",
        body: setMaintenanceModeDto
    })));
}
/**
 * Detect existing install
 */
export function detectPriorInstall(opts?: Oazapfts.RequestOpts) {
    return oazapfts.ok(oazapfts.fetchJson<{
        status: 200;
        data: MaintenanceDetectInstallResponseDto;
    }>("/admin/maintenance/detect-install", {
        ...opts
    }));
}
/**
 * Log into maintenance mode
 */
export function maintenanceLogin({ maintenanceLoginDto }: {
    maintenanceLoginDto: MaintenanceLoginDto;
}, opts?: Oazapfts.RequestOpts) {
    return oazapfts.ok(oazapfts.fetchJson<{
        status: 201;
        data: MaintenanceAuthDto;
    }>("/admin/maintenance/login", oazapfts.json({
        ...opts,
        method: "POST",
        body: maintenanceLoginDto
    })));
}
/**
 * Get maintenance mode status
 */
export function getMaintenanceStatus(opts?: Oazapfts.RequestOpts) {
    return oazapfts.ok(oazapfts.fetchJson<{
        status: 200;
        data: MaintenanceStatusResponseDto;
    }>("/admin/maintenance/status", {
        ...opts
    }));
}
/**
 * Create a notification
 */
export function createNotification({ notificationCreateDto }: {
    notificationCreateDto: NotificationCreateDto;
}, opts?: Oazapfts.RequestOpts) {
    return oazapfts.ok(oazapfts.fetchJson<{
        status: 201;
        data: NotificationDto;
    }>("/admin/notifications", oazapfts.json({
        ...opts,
        method: "POST",
        body: notificationCreateDto
    })));
}
/**
 * Render email template
 */
export function getNotificationTemplateAdmin({ name, templateDto }: {
    name: string;
    templateDto: TemplateDto;
}, opts?: Oazapfts.RequestOpts) {
    return oazapfts.ok(oazapfts.fetchJson<{
        status: 200;
        data: TemplateResponseDto;
    }>(`/admin/notifications/templates/${encodeURIComponent(name)}`, oazapfts.json({
        ...opts,
        method: "POST",
        body: templateDto
    })));
}
/**
 * Send test email
 */
export function sendTestEmailAdmin({ systemConfigSmtpDto }: {
    systemConfigSmtpDto: SystemConfigSmtpDto;
}, opts?: Oazapfts.RequestOpts) {
    return oazapfts.ok(oazapfts.fetchJson<{
        status: 200;
        data: TestEmailResponseDto;
    }>("/admin/notifications/test-email", oazapfts.json({
        ...opts,
        method: "POST",
        body: systemConfigSmtpDto
    })));
}
/**
 * Search users
 */
export function searchUsersAdmin({ id, withDeleted }: {
    id?: string;
    withDeleted?: boolean;
}, opts?: Oazapfts.RequestOpts) {
    return oazapfts.ok(oazapfts.fetchJson<{
        status: 200;
        data: UserAdminResponseDto[];
    }>(`/admin/users${QS.query(QS.explode({
        id,
        withDeleted
    }))}`, {
        ...opts
    }));
}
/**
 * Create a user
 */
export function createUserAdmin({ userAdminCreateDto }: {
    userAdminCreateDto: UserAdminCreateDto;
}, opts?: Oazapfts.RequestOpts) {
    return oazapfts.ok(oazapfts.fetchJson<{
        status: 201;
        data: UserAdminResponseDto;
    }>("/admin/users", oazapfts.json({
        ...opts,
        method: "POST",
        body: userAdminCreateDto
    })));
}
/**
 * Delete a user
 */
export function deleteUserAdmin({ id, userAdminDeleteDto }: {
    id: string;
    userAdminDeleteDto: UserAdminDeleteDto;
}, opts?: Oazapfts.RequestOpts) {
    return oazapfts.ok(oazapfts.fetchJson<{
        status: 200;
        data: UserAdminResponseDto;
    }>(`/admin/users/${encodeURIComponent(id)}`, oazapfts.json({
        ...opts,
        method: "DELETE",
        body: userAdminDeleteDto
    })));
}
/**
 * Retrieve a user
 */
export function getUserAdmin({ id }: {
    id: string;
}, opts?: Oazapfts.RequestOpts) {
    return oazapfts.ok(oazapfts.fetchJson<{
        status: 200;
        data: UserAdminResponseDto;
    }>(`/admin/users/${encodeURIComponent(id)}`, {
        ...opts
    }));
}
/**
 * Update a user
 */
export function updateUserAdmin({ id, userAdminUpdateDto }: {
    id: string;
    userAdminUpdateDto: UserAdminUpdateDto;
}, opts?: Oazapfts.RequestOpts) {
    return oazapfts.ok(oazapfts.fetchJson<{
        status: 200;
        data: UserAdminResponseDto;
    }>(`/admin/users/${encodeURIComponent(id)}`, oazapfts.json({
        ...opts,
        method: "PUT",
        body: userAdminUpdateDto
    })));
}
/**
 * Retrieve calendar heatmap activity
 */
export function getUserCalendarHeatmapAdmin({ $from, id, to, $type }: {
    $from?: string;
    id: string;
    to?: string;
    $type?: CalendarHeatmapType;
}, opts?: Oazapfts.RequestOpts) {
    return oazapfts.ok(oazapfts.fetchJson<{
        status: 200;
        data: CalendarHeatmapResponseDto;
    }>(`/admin/users/${encodeURIComponent(id)}/calendar-heatmap${QS.query(QS.explode({
        "from": $from,
        to,
        "type": $type
    }))}`, {
        ...opts
    }));
}
/**
 * Export a user library manifest
 */
export function getLibraryManifest({ cursor, id }: {
    cursor?: string;
    id: string;
}, opts?: Oazapfts.RequestOpts) {
    return oazapfts.ok(oazapfts.fetchJson<{
        status: 200;
        data: LibraryManifestResponseDto;
    }>(`/admin/users/${encodeURIComponent(id)}/library-manifest${QS.query(QS.explode({
        cursor
    }))}`, {
        ...opts
    }));
}
/**
 * Retrieve user preferences
 */
export function getUserPreferencesAdmin({ id }: {
    id: string;
}, opts?: Oazapfts.RequestOpts) {
    return oazapfts.ok(oazapfts.fetchJson<{
        status: 200;
        data: UserPreferencesResponseDto;
    }>(`/admin/users/${encodeURIComponent(id)}/preferences`, {
        ...opts
    }));
}
/**
 * Update user preferences
 */
export function updateUserPreferencesAdmin({ id, userPreferencesUpdateDto }: {
    id: string;
    userPreferencesUpdateDto: UserPreferencesUpdateDto;
}, opts?: Oazapfts.RequestOpts) {
    return oazapfts.ok(oazapfts.fetchJson<{
        status: 200;
        data: UserPreferencesResponseDto;
    }>(`/admin/users/${encodeURIComponent(id)}/preferences`, oazapfts.json({
        ...opts,
        method: "PUT",
        body: userPreferencesUpdateDto
    })));
}
/**
 * Restore a deleted user
 */
export function restoreUserAdmin({ id }: {
    id: string;
}, opts?: Oazapfts.RequestOpts) {
    return oazapfts.ok(oazapfts.fetchJson<{
        status: 200;
        data: UserAdminResponseDto;
    }>(`/admin/users/${encodeURIComponent(id)}/restore`, {
        ...opts,
        method: "POST"
    }));
}
/**
 * Retrieve user sessions
 */
export function getUserSessionsAdmin({ id }: {
    id: string;
}, opts?: Oazapfts.RequestOpts) {
    return oazapfts.ok(oazapfts.fetchJson<{
        status: 200;
        data: SessionResponseDto[];
    }>(`/admin/users/${encodeURIComponent(id)}/sessions`, {
        ...opts
    }));
}
/**
 * Retrieve user statistics
 */
export function getUserStatisticsAdmin({ id, isFavorite, isTrashed, visibility }: {
    id: string;
    isFavorite?: boolean;
    isTrashed?: boolean;
    visibility?: AssetVisibility;
}, opts?: Oazapfts.RequestOpts) {
    return oazapfts.ok(oazapfts.fetchJson<{
        status: 200;
        data: AssetStatsResponseDto;
    }>(`/admin/users/${encodeURIComponent(id)}/statistics${QS.query(QS.explode({
        isFavorite,
        isTrashed,
        visibility
    }))}`, {
        ...opts
    }));
}
/**
 * Handle the internal runner MCP endpoint
 */
export function handle({ id }: {
    id: string;
}, opts?: Oazapfts.RequestOpts) {
    return oazapfts.ok(oazapfts.fetchText(`/agent/internal/mcp/sessions/${encodeURIComponent(id)}`, {
        ...opts,
        method: "POST"
    }));
}
/**
 * List agent provider credentials
 */
export function getAgentProviderCredentials(opts?: Oazapfts.RequestOpts) {
    return oazapfts.ok(oazapfts.fetchJson<{
        status: 200;
        data: AgentProviderCredentialResponseDto[];
    }>("/agent/provider-credentials", {
        ...opts
    }));
}
/**
 * Create an agent provider credential
 */
export function createAgentProviderCredential({ agentProviderCredentialCreateDto }: {
    agentProviderCredentialCreateDto: AgentProviderCredentialCreateDto;
}, opts?: Oazapfts.RequestOpts) {
    return oazapfts.ok(oazapfts.fetchJson<{
        status: 201;
        data: AgentProviderCredentialResponseDto;
    }>("/agent/provider-credentials", oazapfts.json({
        ...opts,
        method: "POST",
        body: agentProviderCredentialCreateDto
    })));
}
/**
 * Delete an agent provider credential
 */
export function deleteAgentProviderCredential({ id }: {
    id: string;
}, opts?: Oazapfts.RequestOpts) {
    return oazapfts.ok(oazapfts.fetchText(`/agent/provider-credentials/${encodeURIComponent(id)}`, {
        ...opts,
        method: "DELETE"
    }));
}
/**
 * Retrieve an agent provider credential
 */
export function getAgentProviderCredential({ id }: {
    id: string;
}, opts?: Oazapfts.RequestOpts) {
    return oazapfts.ok(oazapfts.fetchJson<{
        status: 200;
        data: AgentProviderCredentialResponseDto;
    }>(`/agent/provider-credentials/${encodeURIComponent(id)}`, {
        ...opts
    }));
}
/**
 * Update an agent provider credential
 */
export function updateAgentProviderCredential({ id, agentProviderCredentialUpdateDto }: {
    id: string;
    agentProviderCredentialUpdateDto: AgentProviderCredentialUpdateDto;
}, opts?: Oazapfts.RequestOpts) {
    return oazapfts.ok(oazapfts.fetchJson<{
        status: 200;
        data: AgentProviderCredentialResponseDto;
    }>(`/agent/provider-credentials/${encodeURIComponent(id)}`, oazapfts.json({
        ...opts,
        method: "PUT",
        body: agentProviderCredentialUpdateDto
    })));
}
/**
 * Get agent runner status
 */
export function getAgentRunnerStatus(opts?: Oazapfts.RequestOpts) {
    return oazapfts.ok(oazapfts.fetchJson<{
        status: 200;
        data: AgentRunnerStatusDto;
    }>("/agent/runner/status", {
        ...opts
    }));
}
/**
 * List agent sessions
 */
export function getAgentSessions(opts?: Oazapfts.RequestOpts) {
    return oazapfts.ok(oazapfts.fetchJson<{
        status: 200;
        data: AgentSessionResponseDto[];
    }>("/agent/sessions", {
        ...opts
    }));
}
/**
 * Create an agent session
 */
export function createAgentSession({ agentSessionCreateDto }: {
    agentSessionCreateDto: AgentSessionCreateDto;
}, opts?: Oazapfts.RequestOpts) {
    return oazapfts.ok(oazapfts.fetchJson<{
        status: 201;
        data: AgentSessionResponseDto;
    }>("/agent/sessions", oazapfts.json({
        ...opts,
        method: "POST",
        body: agentSessionCreateDto
    })));
}
/**
 * Validate an agent session setup
 */
export function validateAgentSession({ agentSessionCreateDto }: {
    agentSessionCreateDto: AgentSessionCreateDto;
}, opts?: Oazapfts.RequestOpts) {
    return oazapfts.ok(oazapfts.fetchText("/agent/sessions/validate", oazapfts.json({
        ...opts,
        method: "POST",
        body: agentSessionCreateDto
    })));
}
/**
 * Delete an agent session
 */
export function deleteAgentSession({ id }: {
    id: string;
}, opts?: Oazapfts.RequestOpts) {
    return oazapfts.ok(oazapfts.fetchText(`/agent/sessions/${encodeURIComponent(id)}`, {
        ...opts,
        method: "DELETE"
    }));
}
/**
 * Retrieve an agent session
 */
export function getAgentSession({ id }: {
    id: string;
}, opts?: Oazapfts.RequestOpts) {
    return oazapfts.ok(oazapfts.fetchJson<{
        status: 200;
        data: AgentSessionResponseDto;
    }>(`/agent/sessions/${encodeURIComponent(id)}`, {
        ...opts
    }));
}
/**
 * Update an agent session
 */
export function updateAgentSession({ id, agentSessionUpdateDto }: {
    id: string;
    agentSessionUpdateDto: AgentSessionUpdateDto;
}, opts?: Oazapfts.RequestOpts) {
    return oazapfts.ok(oazapfts.fetchJson<{
        status: 200;
        data: AgentSessionResponseDto;
    }>(`/agent/sessions/${encodeURIComponent(id)}`, oazapfts.json({
        ...opts,
        method: "PUT",
        body: agentSessionUpdateDto
    })));
}
/**
 * List agent session activity events
 */
export function getAgentSessionActivityEvents({ id }: {
    id: string;
}, opts?: Oazapfts.RequestOpts) {
    return oazapfts.ok(oazapfts.fetchJson<{
        status: 200;
        data: AgentSessionActivityEventResponseDto[];
    }>(`/agent/sessions/${encodeURIComponent(id)}/activity-events`, {
        ...opts
    }));
}
/**
 * Cancel an agent session
 */
export function cancelAgentSession({ id }: {
    id: string;
}, opts?: Oazapfts.RequestOpts) {
    return oazapfts.ok(oazapfts.fetchJson<{
        status: 200;
        data: AgentSessionResponseDto;
    }>(`/agent/sessions/${encodeURIComponent(id)}/cancel`, {
        ...opts,
        method: "POST"
    }));
}
/**
 * List agent session messages
 */
export function getAgentSessionMessages({ id }: {
    id: string;
}, opts?: Oazapfts.RequestOpts) {
    return oazapfts.ok(oazapfts.fetchJson<{
        status: 200;
        data: AgentMessageResponseDto[];
    }>(`/agent/sessions/${encodeURIComponent(id)}/messages`, {
        ...opts
    }));
}
/**
 * Append an agent session message
 */
export function appendAgentSessionMessage({ id, agentMessageCreateDto }: {
    id: string;
    agentMessageCreateDto: AgentMessageCreateDto;
}, opts?: Oazapfts.RequestOpts) {
    return oazapfts.ok(oazapfts.fetchJson<{
        status: 201;
        data: AgentMessageResponseDto;
    }>(`/agent/sessions/${encodeURIComponent(id)}/messages`, oazapfts.json({
        ...opts,
        method: "POST",
        body: agentMessageCreateDto
    })));
}
/**
 * Get the current agent operation plan
 */
export function getCurrentOperationPlan({ id }: {
    id: string;
}, opts?: Oazapfts.RequestOpts) {
    return oazapfts.ok(oazapfts.fetchJson<{
        status: 200;
        data: AgentOperationPlanResponseDto | null;
    }>(`/agent/sessions/${encodeURIComponent(id)}/operation-plan`, {
        ...opts
    }));
}
/**
 * Get applied agent operation plans
 */
export function getAppliedOperationPlans({ id }: {
    id: string;
}, opts?: Oazapfts.RequestOpts) {
    return oazapfts.ok(oazapfts.fetchJson<{
        status: 200;
        data: AgentOperationPlanResponseDto[];
    }>(`/agent/sessions/${encodeURIComponent(id)}/operation-plan/applied`, {
        ...opts
    }));
}
/**
 * Propose agent album operations
 */
export function proposeAlbumOperations({ id, agentProposeAlbumOperationsDto }: {
    id: string;
    agentProposeAlbumOperationsDto: AgentProposeAlbumOperationsDto;
}, opts?: Oazapfts.RequestOpts) {
    return oazapfts.ok(oazapfts.fetchJson<{
        status: 201;
        data: AgentOperationPlanToolResponseDto;
    }>(`/agent/sessions/${encodeURIComponent(id)}/operation-plan/proposals`, oazapfts.json({
        ...opts,
        method: "POST",
        body: agentProposeAlbumOperationsDto
    })));
}
/**
 * Apply approved agent album operations
 */
export function applyApprovedOperations({ id, planId, agentOperationPlanApplyRequestDto }: {
    id: string;
    planId: string;
    agentOperationPlanApplyRequestDto: AgentOperationPlanApplyRequestDto;
}, opts?: Oazapfts.RequestOpts) {
    return oazapfts.ok(oazapfts.fetchJson<{
        status: 201;
        data: AgentOperationPlanApplyResponseDto;
    }>(`/agent/sessions/${encodeURIComponent(id)}/operation-plan/${encodeURIComponent(planId)}/apply`, oazapfts.json({
        ...opts,
        method: "POST",
        body: agentOperationPlanApplyRequestDto
    })));
}
/**
 * Revise agent album operations
 */
export function reviseProposedOperations({ id, planId, agentReviseAlbumOperationsDto }: {
    id: string;
    planId: string;
    agentReviseAlbumOperationsDto: AgentReviseAlbumOperationsDto;
}, opts?: Oazapfts.RequestOpts) {
    return oazapfts.ok(oazapfts.fetchJson<{
        status: 201;
        data: AgentOperationPlanToolResponseDto;
    }>(`/agent/sessions/${encodeURIComponent(id)}/operation-plan/${encodeURIComponent(planId)}/revisions`, oazapfts.json({
        ...opts,
        method: "POST",
        body: agentReviseAlbumOperationsDto
    })));
}
/**
 * Summarize an agent operation plan
 */
export function summarizePlan({ id, planId, agentOperationPlanSummaryRequestDto }: {
    id: string;
    planId: string;
    agentOperationPlanSummaryRequestDto: AgentOperationPlanSummaryRequestDto;
}, opts?: Oazapfts.RequestOpts) {
    return oazapfts.ok(oazapfts.fetchJson<{
        status: 201;
        data: AgentOperationPlanToolResponseDto;
    }>(`/agent/sessions/${encodeURIComponent(id)}/operation-plan/${encodeURIComponent(planId)}/summary`, oazapfts.json({
        ...opts,
        method: "POST",
        body: agentOperationPlanSummaryRequestDto
    })));
}
/**
 * List agent tool calls
 */
export function getToolCalls({ id }: {
    id: string;
}, opts?: Oazapfts.RequestOpts) {
    return oazapfts.ok(oazapfts.fetchJson<{
        status: 200;
        data: AgentToolCallResponseDto[];
    }>(`/agent/sessions/${encodeURIComponent(id)}/tool-calls`, {
        ...opts
    }));
}
/**
 * Approve or deny an agent tool call
 */
export function approveToolCall({ id, toolCallId, agentToolApprovalDto }: {
    id: string;
    toolCallId: string;
    agentToolApprovalDto: AgentToolApprovalDto;
}, opts?: Oazapfts.RequestOpts) {
    return oazapfts.ok(oazapfts.fetchJson<{
        status: 201;
        data: AgentToolCallResponseDto;
    }>(`/agent/sessions/${encodeURIComponent(id)}/tool-calls/${encodeURIComponent(toolCallId)}/approval`, oazapfts.json({
        ...opts,
        method: "POST",
        body: agentToolApprovalDto
    })));
}
/**
 * Execute the internal findTripCandidates agent tool
 */
export function findTripCandidates({ id, agentFindTripCandidatesToolRequestDto }: {
    id: string;
    agentFindTripCandidatesToolRequestDto: AgentFindTripCandidatesToolRequestDto;
}, opts?: Oazapfts.RequestOpts) {
    return oazapfts.ok(oazapfts.fetchJson<{
        status: 201;
        data: AgentFindTripCandidatesToolResponseDto;
    }>(`/agent/sessions/${encodeURIComponent(id)}/tools/find-trip-candidates`, oazapfts.json({
        ...opts,
        method: "POST",
        body: agentFindTripCandidatesToolRequestDto
    })));
}
/**
 * Execute the internal listAlbums agent tool
 */
export function listAlbums({ id, agentListAlbumsToolRequestDto }: {
    id: string;
    agentListAlbumsToolRequestDto: AgentListAlbumsToolRequestDto;
}, opts?: Oazapfts.RequestOpts) {
    return oazapfts.ok(oazapfts.fetchJson<{
        status: 201;
        data: AgentListAlbumsToolResponseDto;
    }>(`/agent/sessions/${encodeURIComponent(id)}/tools/list-albums`, oazapfts.json({
        ...opts,
        method: "POST",
        body: agentListAlbumsToolRequestDto
    })));
}
/**
 * Execute the internal listDuplicateGroups agent tool
 */
export function listDuplicateGroups({ id, agentListDuplicateGroupsToolRequestDto }: {
    id: string;
    agentListDuplicateGroupsToolRequestDto: AgentListDuplicateGroupsToolRequestDto;
}, opts?: Oazapfts.RequestOpts) {
    return oazapfts.ok(oazapfts.fetchJson<{
        status: 201;
        data: AgentListDuplicateGroupsToolResponseDto;
    }>(`/agent/sessions/${encodeURIComponent(id)}/tools/list-duplicate-groups`, oazapfts.json({
        ...opts,
        method: "POST",
        body: agentListDuplicateGroupsToolRequestDto
    })));
}
/**
 * Execute the internal listSpaces agent tool
 */
export function listSpaces({ id, agentListSpacesToolRequestDto }: {
    id: string;
    agentListSpacesToolRequestDto: AgentListSpacesToolRequestDto;
}, opts?: Oazapfts.RequestOpts) {
    return oazapfts.ok(oazapfts.fetchJson<{
        status: 201;
        data: AgentListSpacesToolResponseDto;
    }>(`/agent/sessions/${encodeURIComponent(id)}/tools/list-spaces`, oazapfts.json({
        ...opts,
        method: "POST",
        body: agentListSpacesToolRequestDto
    })));
}
/**
 * Execute the internal readAlbum agent tool
 */
export function readAlbum({ id, agentReadAlbumToolRequestDto }: {
    id: string;
    agentReadAlbumToolRequestDto: AgentReadAlbumToolRequestDto;
}, opts?: Oazapfts.RequestOpts) {
    return oazapfts.ok(oazapfts.fetchJson<{
        status: 201;
        data: AgentReadAlbumToolResponseDto;
    }>(`/agent/sessions/${encodeURIComponent(id)}/tools/read-album`, oazapfts.json({
        ...opts,
        method: "POST",
        body: agentReadAlbumToolRequestDto
    })));
}
/**
 * Execute the internal readAssetMetadata agent tool
 */
export function readAssetMetadata({ id, agentReadAssetMetadataToolRequestDto }: {
    id: string;
    agentReadAssetMetadataToolRequestDto: AgentReadAssetMetadataToolRequestDto;
}, opts?: Oazapfts.RequestOpts) {
    return oazapfts.ok(oazapfts.fetchJson<{
        status: 201;
        data: AgentReadAssetMetadataToolResponseDto;
    }>(`/agent/sessions/${encodeURIComponent(id)}/tools/read-asset-metadata`, oazapfts.json({
        ...opts,
        method: "POST",
        body: agentReadAssetMetadataToolRequestDto
    })));
}
/**
 * Execute the internal readAssetOriginals agent tool
 */
export function readAssetOriginals({ id, agentReadAssetOriginalsToolRequestDto }: {
    id: string;
    agentReadAssetOriginalsToolRequestDto: AgentReadAssetOriginalsToolRequestDto;
}, opts?: Oazapfts.RequestOpts) {
    return oazapfts.ok(oazapfts.fetchJson<{
        status: 201;
        data: AgentReadAssetOriginalsToolResponseDto;
    }>(`/agent/sessions/${encodeURIComponent(id)}/tools/read-asset-originals`, oazapfts.json({
        ...opts,
        method: "POST",
        body: agentReadAssetOriginalsToolRequestDto
    })));
}
/**
 * Execute the internal readAssetPreviews agent tool
 */
export function readAssetPreviews({ id, agentReadAssetPreviewsToolRequestDto }: {
    id: string;
    agentReadAssetPreviewsToolRequestDto: AgentReadAssetPreviewsToolRequestDto;
}, opts?: Oazapfts.RequestOpts) {
    return oazapfts.ok(oazapfts.fetchJson<{
        status: 201;
        data: AgentReadAssetPreviewsToolResponseDto;
    }>(`/agent/sessions/${encodeURIComponent(id)}/tools/read-asset-previews`, oazapfts.json({
        ...opts,
        method: "POST",
        body: agentReadAssetPreviewsToolRequestDto
    })));
}
/**
 * Execute the internal readSpace agent tool
 */
export function readSpace({ id, agentReadSpaceToolRequestDto }: {
    id: string;
    agentReadSpaceToolRequestDto: AgentReadSpaceToolRequestDto;
}, opts?: Oazapfts.RequestOpts) {
    return oazapfts.ok(oazapfts.fetchJson<{
        status: 201;
        data: AgentReadSpaceToolResponseDto;
    }>(`/agent/sessions/${encodeURIComponent(id)}/tools/read-space`, oazapfts.json({
        ...opts,
        method: "POST",
        body: agentReadSpaceToolRequestDto
    })));
}
/**
 * Execute the internal searchAssets agent tool
 */
export function executeAgentSearchAssets({ id, agentSearchAssetsToolRequestDto }: {
    id: string;
    agentSearchAssetsToolRequestDto: AgentSearchAssetsToolRequestDto;
}, opts?: Oazapfts.RequestOpts) {
    return oazapfts.ok(oazapfts.fetchJson<{
        status: 201;
        data: AgentSearchAssetsToolResponseDto;
    }>(`/agent/sessions/${encodeURIComponent(id)}/tools/search-assets`, oazapfts.json({
        ...opts,
        method: "POST",
        body: agentSearchAssetsToolRequestDto
    })));
}
/**
 * Execute the internal searchPeople agent tool
 */
export function searchAgentPeople({ id, agentSearchPeopleToolRequestDto }: {
    id: string;
    agentSearchPeopleToolRequestDto: AgentSearchPeopleToolRequestDto;
}, opts?: Oazapfts.RequestOpts) {
    return oazapfts.ok(oazapfts.fetchJson<{
        status: 201;
        data: AgentSearchPeopleToolResponseDto;
    }>(`/agent/sessions/${encodeURIComponent(id)}/tools/search-people`, oazapfts.json({
        ...opts,
        method: "POST",
        body: agentSearchPeopleToolRequestDto
    })));
}
/**
 * Execute the internal searchUsers agent tool
 */
export function searchAgentUsers({ id, agentSearchUsersToolRequestDto }: {
    id: string;
    agentSearchUsersToolRequestDto: AgentSearchUsersToolRequestDto;
}, opts?: Oazapfts.RequestOpts) {
    return oazapfts.ok(oazapfts.fetchJson<{
        status: 201;
        data: AgentSearchUsersToolResponseDto;
    }>(`/agent/sessions/${encodeURIComponent(id)}/tools/search-users`, oazapfts.json({
        ...opts,
        method: "POST",
        body: agentSearchUsersToolRequestDto
    })));
}
/**
 * List all albums
 */
export function getAllAlbums({ assetId, id, isOwned, isShared, name }: {
    assetId?: string;
    id?: string;
    isOwned?: boolean;
    isShared?: boolean;
    name?: string;
}, opts?: Oazapfts.RequestOpts) {
    return oazapfts.ok(oazapfts.fetchJson<{
        status: 200;
        data: AlbumResponseDto[];
    }>(`/albums${QS.query(QS.explode({
        assetId,
        id,
        isOwned,
        isShared,
        name
    }))}`, {
        ...opts
    }));
}
/**
 * Create an album
 */
export function createAlbum({ createAlbumDto }: {
    createAlbumDto: CreateAlbumDto;
}, opts?: Oazapfts.RequestOpts) {
    return oazapfts.ok(oazapfts.fetchJson<{
        status: 201;
        data: AlbumResponseDto;
    }>("/albums", oazapfts.json({
        ...opts,
        method: "POST",
        body: createAlbumDto
    })));
}
/**
 * Add assets to albums
 */
export function addAssetsToAlbums({ albumsAddAssetsDto }: {
    albumsAddAssetsDto: AlbumsAddAssetsDto;
}, opts?: Oazapfts.RequestOpts) {
    return oazapfts.ok(oazapfts.fetchJson<{
        status: 200;
        data: AlbumsAddAssetsResponseDto;
    }>("/albums/assets", oazapfts.json({
        ...opts,
        method: "PUT",
        body: albumsAddAssetsDto
    })));
}
/**
 * Retrieve album names
 */
export function getAlbumNames(opts?: Oazapfts.RequestOpts) {
    return oazapfts.ok(oazapfts.fetchJson<{
        status: 200;
        data: AlbumNameDto[];
    }>("/albums/names", {
        ...opts
    }));
}
/**
 * Retrieve album statistics
 */
export function getAlbumStatistics(opts?: Oazapfts.RequestOpts) {
    return oazapfts.ok(oazapfts.fetchJson<{
        status: 200;
        data: AlbumStatisticsResponseDto;
    }>("/albums/statistics", {
        ...opts
    }));
}
/**
 * Delete an album
 */
export function deleteAlbum({ id }: {
    id: string;
}, opts?: Oazapfts.RequestOpts) {
    return oazapfts.ok(oazapfts.fetchText(`/albums/${encodeURIComponent(id)}`, {
        ...opts,
        method: "DELETE"
    }));
}
/**
 * Retrieve an album
 */
export function getAlbumInfo({ id, key, slug }: {
    id: string;
    key?: string;
    slug?: string;
}, opts?: Oazapfts.RequestOpts) {
    return oazapfts.ok(oazapfts.fetchJson<{
        status: 200;
        data: AlbumResponseDto;
    }>(`/albums/${encodeURIComponent(id)}${QS.query(QS.explode({
        key,
        slug
    }))}`, {
        ...opts
    }));
}
/**
 * Update an album
 */
export function updateAlbumInfo({ id, updateAlbumDto }: {
    id: string;
    updateAlbumDto: UpdateAlbumDto;
}, opts?: Oazapfts.RequestOpts) {
    return oazapfts.ok(oazapfts.fetchJson<{
        status: 200;
        data: AlbumResponseDto;
    }>(`/albums/${encodeURIComponent(id)}`, oazapfts.json({
        ...opts,
        method: "PATCH",
        body: updateAlbumDto
    })));
}
/**
 * Remove assets from an album
 */
export function removeAssetFromAlbum({ id, bulkIdsDto }: {
    id: string;
    bulkIdsDto: BulkIdsDto;
}, opts?: Oazapfts.RequestOpts) {
    return oazapfts.ok(oazapfts.fetchJson<{
        status: 200;
        data: BulkIdResponseDto[];
    }>(`/albums/${encodeURIComponent(id)}/assets`, oazapfts.json({
        ...opts,
        method: "DELETE",
        body: bulkIdsDto
    })));
}
/**
 * Add assets to an album
 */
export function addAssetsToAlbum({ id, bulkIdsDto }: {
    id: string;
    bulkIdsDto: BulkIdsDto;
}, opts?: Oazapfts.RequestOpts) {
    return oazapfts.ok(oazapfts.fetchJson<{
        status: 200;
        data: BulkIdResponseDto[];
    }>(`/albums/${encodeURIComponent(id)}/assets`, oazapfts.json({
        ...opts,
        method: "PUT",
        body: bulkIdsDto
    })));
}
/**
 * Retrieve album map markers
 */
export function getAlbumMapMarkers({ id, key, slug }: {
    id: string;
    key?: string;
    slug?: string;
}, opts?: Oazapfts.RequestOpts) {
    return oazapfts.ok(oazapfts.fetchJson<{
        status: 200;
        data: MapMarkerResponseDto[];
    }>(`/albums/${encodeURIComponent(id)}/map-markers${QS.query(QS.explode({
        key,
        slug
    }))}`, {
        ...opts
    }));
}
/**
 * Remove user from album
 */
export function removeUserFromAlbum({ id, userId }: {
    id: string;
    userId: string;
}, opts?: Oazapfts.RequestOpts) {
    return oazapfts.ok(oazapfts.fetchText(`/albums/${encodeURIComponent(id)}/user/${encodeURIComponent(userId)}`, {
        ...opts,
        method: "DELETE"
    }));
}
/**
 * Update user role
 */
export function updateAlbumUser({ id, userId, updateAlbumUserDto }: {
    id: string;
    userId: string;
    updateAlbumUserDto: UpdateAlbumUserDto;
}, opts?: Oazapfts.RequestOpts) {
    return oazapfts.ok(oazapfts.fetchText(`/albums/${encodeURIComponent(id)}/user/${encodeURIComponent(userId)}`, oazapfts.json({
        ...opts,
        method: "PUT",
        body: updateAlbumUserDto
    })));
}
/**
 * Share album with users
 */
export function addUsersToAlbum({ id, addUsersDto }: {
    id: string;
    addUsersDto: AddUsersDto;
}, opts?: Oazapfts.RequestOpts) {
    return oazapfts.ok(oazapfts.fetchJson<{
        status: 200;
        data: AlbumResponseDto;
    }>(`/albums/${encodeURIComponent(id)}/users`, oazapfts.json({
        ...opts,
        method: "PUT",
        body: addUsersDto
    })));
}
/**
 * List all API keys
 */
export function getApiKeys(opts?: Oazapfts.RequestOpts) {
    return oazapfts.ok(oazapfts.fetchJson<{
        status: 200;
        data: ApiKeyResponseDto[];
    }>("/api-keys", {
        ...opts
    }));
}
/**
 * Create an API key
 */
export function createApiKey({ apiKeyCreateDto }: {
    apiKeyCreateDto: ApiKeyCreateDto;
}, opts?: Oazapfts.RequestOpts) {
    return oazapfts.ok(oazapfts.fetchJson<{
        status: 201;
        data: ApiKeyCreateResponseDto;
    }>("/api-keys", oazapfts.json({
        ...opts,
        method: "POST",
        body: apiKeyCreateDto
    })));
}
/**
 * Retrieve the current API key
 */
export function getMyApiKey(opts?: Oazapfts.RequestOpts) {
    return oazapfts.ok(oazapfts.fetchJson<{
        status: 200;
        data: ApiKeyResponseDto;
    }>("/api-keys/me", {
        ...opts
    }));
}
/**
 * Delete an API key
 */
export function deleteApiKey({ id }: {
    id: string;
}, opts?: Oazapfts.RequestOpts) {
    return oazapfts.ok(oazapfts.fetchText(`/api-keys/${encodeURIComponent(id)}`, {
        ...opts,
        method: "DELETE"
    }));
}
/**
 * Retrieve an API key
 */
export function getApiKey({ id }: {
    id: string;
}, opts?: Oazapfts.RequestOpts) {
    return oazapfts.ok(oazapfts.fetchJson<{
        status: 200;
        data: ApiKeyResponseDto;
    }>(`/api-keys/${encodeURIComponent(id)}`, {
        ...opts
    }));
}
/**
 * Update an API key
 */
export function updateApiKey({ id, apiKeyUpdateDto }: {
    id: string;
    apiKeyUpdateDto: ApiKeyUpdateDto;
}, opts?: Oazapfts.RequestOpts) {
    return oazapfts.ok(oazapfts.fetchJson<{
        status: 200;
        data: ApiKeyResponseDto;
    }>(`/api-keys/${encodeURIComponent(id)}`, oazapfts.json({
        ...opts,
        method: "PUT",
        body: apiKeyUpdateDto
    })));
}
/**
 * Delete assets
 */
export function deleteAssets({ assetBulkDeleteDto }: {
    assetBulkDeleteDto: AssetBulkDeleteDto;
}, opts?: Oazapfts.RequestOpts) {
    return oazapfts.ok(oazapfts.fetchText("/assets", oazapfts.json({
        ...opts,
        method: "DELETE",
        body: assetBulkDeleteDto
    })));
}
/**
 * Upload asset
 */
export function uploadAsset({ key, slug, xImmichChecksum, assetMediaCreateDto }: {
    key?: string;
    slug?: string;
    xImmichChecksum?: string;
    assetMediaCreateDto: AssetMediaCreateDto;
}, opts?: Oazapfts.RequestOpts) {
    return oazapfts.ok(oazapfts.fetchJson<{
        status: 200;
        data: AssetMediaResponseDto;
    } | {
        status: 201;
        data: AssetMediaResponseDto;
    }>(`/assets${QS.query(QS.explode({
        key,
        slug
    }))}`, oazapfts.multipart({
        ...opts,
        method: "POST",
        body: assetMediaCreateDto,
        headers: oazapfts.mergeHeaders(opts?.headers, {
            "x-immich-checksum": xImmichChecksum
        })
    })));
}
/**
 * Update assets
 */
export function updateAssets({ assetBulkUpdateDto }: {
    assetBulkUpdateDto: AssetBulkUpdateDto;
}, opts?: Oazapfts.RequestOpts) {
    return oazapfts.ok(oazapfts.fetchText("/assets", oazapfts.json({
        ...opts,
        method: "PUT",
        body: assetBulkUpdateDto
    })));
}
/**
 * Check bulk upload
 */
export function checkBulkUpload({ assetBulkUploadCheckDto }: {
    assetBulkUploadCheckDto: AssetBulkUploadCheckDto;
}, opts?: Oazapfts.RequestOpts) {
    return oazapfts.ok(oazapfts.fetchJson<{
        status: 200;
        data: AssetBulkUploadCheckResponseDto;
    }>("/assets/bulk-upload-check", oazapfts.json({
        ...opts,
        method: "POST",
        body: assetBulkUploadCheckDto
    })));
}
/**
 * Copy asset
 */
export function copyAsset({ assetCopyDto }: {
    assetCopyDto: AssetCopyDto;
}, opts?: Oazapfts.RequestOpts) {
    return oazapfts.ok(oazapfts.fetchText("/assets/copy", oazapfts.json({
        ...opts,
        method: "PUT",
        body: assetCopyDto
    })));
}
/**
 * Run an asset job
 */
export function runAssetJobs({ assetJobsDto }: {
    assetJobsDto: AssetJobsDto;
}, opts?: Oazapfts.RequestOpts) {
    return oazapfts.ok(oazapfts.fetchText("/assets/jobs", oazapfts.json({
        ...opts,
        method: "POST",
        body: assetJobsDto
    })));
}
/**
 * Delete asset metadata
 */
export function deleteBulkAssetMetadata({ assetMetadataBulkDeleteDto }: {
    assetMetadataBulkDeleteDto: AssetMetadataBulkDeleteDto;
}, opts?: Oazapfts.RequestOpts) {
    return oazapfts.ok(oazapfts.fetchText("/assets/metadata", oazapfts.json({
        ...opts,
        method: "DELETE",
        body: assetMetadataBulkDeleteDto
    })));
}
/**
 * Upsert asset metadata
 */
export function updateBulkAssetMetadata({ assetMetadataBulkUpsertDto }: {
    assetMetadataBulkUpsertDto: AssetMetadataBulkUpsertDto;
}, opts?: Oazapfts.RequestOpts) {
    return oazapfts.ok(oazapfts.fetchJson<{
        status: 200;
        data: AssetMetadataBulkResponseDto[];
    }>("/assets/metadata", oazapfts.json({
        ...opts,
        method: "PUT",
        body: assetMetadataBulkUpsertDto
    })));
}
/**
 * Get asset statistics
 */
export function getAssetStatistics({ isFavorite, isTrashed, visibility }: {
    isFavorite?: boolean;
    isTrashed?: boolean;
    visibility?: AssetVisibility;
}, opts?: Oazapfts.RequestOpts) {
    return oazapfts.ok(oazapfts.fetchJson<{
        status: 200;
        data: AssetStatsResponseDto;
    }>(`/assets/statistics${QS.query(QS.explode({
        isFavorite,
        isTrashed,
        visibility
    }))}`, {
        ...opts
    }));
}
/**
 * Retrieve an asset
 */
export function getAssetInfo({ id, key, slug, spaceId }: {
    id: string;
    key?: string;
    slug?: string;
    spaceId?: string;
}, opts?: Oazapfts.RequestOpts) {
    return oazapfts.ok(oazapfts.fetchJson<{
        status: 200;
        data: AssetResponseDto;
    }>(`/assets/${encodeURIComponent(id)}${QS.query(QS.explode({
        key,
        slug,
        spaceId
    }))}`, {
        ...opts
    }));
}
/**
 * Update an asset
 */
export function updateAsset({ id, updateAssetDto }: {
    id: string;
    updateAssetDto: UpdateAssetDto;
}, opts?: Oazapfts.RequestOpts) {
    return oazapfts.ok(oazapfts.fetchJson<{
        status: 200;
        data: AssetResponseDto;
    }>(`/assets/${encodeURIComponent(id)}`, oazapfts.json({
        ...opts,
        method: "PUT",
        body: updateAssetDto
    })));
}
/**
 * Remove edits from an existing asset
 */
export function removeAssetEdits({ id }: {
    id: string;
}, opts?: Oazapfts.RequestOpts) {
    return oazapfts.ok(oazapfts.fetchText(`/assets/${encodeURIComponent(id)}/edits`, {
        ...opts,
        method: "DELETE"
    }));
}
/**
 * Retrieve edits for an existing asset
 */
export function getAssetEdits({ id }: {
    id: string;
}, opts?: Oazapfts.RequestOpts) {
    return oazapfts.ok(oazapfts.fetchJson<{
        status: 200;
        data: AssetEditsResponseDto;
    }>(`/assets/${encodeURIComponent(id)}/edits`, {
        ...opts
    }));
}
/**
 * Apply edits to an existing asset
 */
export function editAsset({ id, assetEditsCreateDto }: {
    id: string;
    assetEditsCreateDto: AssetEditsCreateDto;
}, opts?: Oazapfts.RequestOpts) {
    return oazapfts.ok(oazapfts.fetchJson<{
        status: 200;
        data: AssetEditsResponseDto;
    }>(`/assets/${encodeURIComponent(id)}/edits`, oazapfts.json({
        ...opts,
        method: "PUT",
        body: assetEditsCreateDto
    })));
}
/**
 * Preview edits without saving
 */
export function previewAssetEdits({ id, size, assetEditsCreateDto }: {
    id: string;
    size?: "thumbnail" | "preview";
    assetEditsCreateDto: AssetEditsCreateDto;
}, opts?: Oazapfts.RequestOpts) {
    return oazapfts.ok(oazapfts.fetchJson<{
        status: 200;
        data: Blob;
    } | {
        status: 201;
        data: object;
    }>(`/assets/${encodeURIComponent(id)}/edits/preview${QS.query(QS.explode({
        size
    }))}`, oazapfts.json({
        ...opts,
        method: "POST",
        body: assetEditsCreateDto
    })));
}
/**
 * Get asset metadata
 */
export function getAssetMetadata({ id }: {
    id: string;
}, opts?: Oazapfts.RequestOpts) {
    return oazapfts.ok(oazapfts.fetchJson<{
        status: 200;
        data: AssetMetadataResponseDto[];
    }>(`/assets/${encodeURIComponent(id)}/metadata`, {
        ...opts
    }));
}
/**
 * Update asset metadata
 */
export function updateAssetMetadata({ id, assetMetadataUpsertDto }: {
    id: string;
    assetMetadataUpsertDto: AssetMetadataUpsertDto;
}, opts?: Oazapfts.RequestOpts) {
    return oazapfts.ok(oazapfts.fetchJson<{
        status: 200;
        data: AssetMetadataResponseDto[];
    }>(`/assets/${encodeURIComponent(id)}/metadata`, oazapfts.json({
        ...opts,
        method: "PUT",
        body: assetMetadataUpsertDto
    })));
}
/**
 * Delete asset metadata by key
 */
export function deleteAssetMetadata({ id, key }: {
    id: string;
    key: string;
}, opts?: Oazapfts.RequestOpts) {
    return oazapfts.ok(oazapfts.fetchText(`/assets/${encodeURIComponent(id)}/metadata/${encodeURIComponent(key)}`, {
        ...opts,
        method: "DELETE"
    }));
}
/**
 * Retrieve asset metadata by key
 */
export function getAssetMetadataByKey({ id, key }: {
    id: string;
    key: string;
}, opts?: Oazapfts.RequestOpts) {
    return oazapfts.ok(oazapfts.fetchJson<{
        status: 200;
        data: AssetMetadataResponseDto;
    }>(`/assets/${encodeURIComponent(id)}/metadata/${encodeURIComponent(key)}`, {
        ...opts
    }));
}
/**
 * Retrieve asset OCR data
 */
export function getAssetOcr({ id }: {
    id: string;
}, opts?: Oazapfts.RequestOpts) {
    return oazapfts.ok(oazapfts.fetchJson<{
        status: 200;
        data: AssetOcrResponseDto[];
    }>(`/assets/${encodeURIComponent(id)}/ocr`, {
        ...opts
    }));
}
/**
 * Download original asset
 */
export function downloadAsset({ download, edited, id, key, slug }: {
    download?: boolean;
    edited?: boolean;
    id: string;
    key?: string;
    slug?: string;
}, opts?: Oazapfts.RequestOpts) {
    return oazapfts.ok(oazapfts.fetchBlob<{
        status: 200;
        data: Blob;
    }>(`/assets/${encodeURIComponent(id)}/original${QS.query(QS.explode({
        download,
        edited,
        key,
        slug
    }))}`, {
        ...opts
    }));
}
/**
 * View asset thumbnail
 */
export function viewAsset({ edited, id, key, size, slug }: {
    edited?: boolean;
    id: string;
    key?: string;
    size?: AssetMediaSize;
    slug?: string;
}, opts?: Oazapfts.RequestOpts) {
    return oazapfts.ok(oazapfts.fetchBlob<{
        status: 200;
        data: Blob;
    }>(`/assets/${encodeURIComponent(id)}/thumbnail${QS.query(QS.explode({
        edited,
        key,
        size,
        slug
    }))}`, {
        ...opts
    }));
}
/**
 * Play asset video
 */
export function playAssetVideo({ id, key, slug }: {
    id: string;
    key?: string;
    slug?: string;
}, opts?: Oazapfts.RequestOpts) {
    return oazapfts.ok(oazapfts.fetchBlob<{
        status: 200;
        data: Blob;
    }>(`/assets/${encodeURIComponent(id)}/video/playback${QS.query(QS.explode({
        key,
        slug
    }))}`, {
        ...opts
    }));
}
/**
 * Get HLS main playlist
 */
export function getMainPlaylist({ id, key, slug }: {
    id: string;
    key?: string;
    slug?: string;
}, opts?: Oazapfts.RequestOpts) {
    return oazapfts.ok(oazapfts.fetchBlob<{
        status: 200;
        data: string;
    }>(`/assets/${encodeURIComponent(id)}/video/stream/main.m3u8${QS.query(QS.explode({
        key,
        slug
    }))}`, {
        ...opts
    }));
}
/**
 * End HLS streaming session
 */
export function endSession({ id, key, sessionId, slug }: {
    id: string;
    key?: string;
    sessionId: string;
    slug?: string;
}, opts?: Oazapfts.RequestOpts) {
    return oazapfts.ok(oazapfts.fetchText(`/assets/${encodeURIComponent(id)}/video/stream/${encodeURIComponent(sessionId)}${QS.query(QS.explode({
        key,
        slug
    }))}`, {
        ...opts,
        method: "DELETE"
    }));
}
/**
 * Get HLS media playlist
 */
export function getMediaPlaylist({ id, key, sessionId, slug, variantIndex, xImmichHlsPos }: {
    id: string;
    key?: string;
    sessionId: string;
    slug?: string;
    variantIndex: number;
    xImmichHlsPos?: number;
}, opts?: Oazapfts.RequestOpts) {
    return oazapfts.ok(oazapfts.fetchBlob<{
        status: 200;
        data: string;
    }>(`/assets/${encodeURIComponent(id)}/video/stream/${encodeURIComponent(sessionId)}/${encodeURIComponent(variantIndex)}/playlist.m3u8${QS.query(QS.explode({
        key,
        slug
    }))}`, {
        ...opts,
        headers: oazapfts.mergeHeaders(opts?.headers, {
            "x-immich-hls-pos": xImmichHlsPos
        })
    }));
}
/**
 * Get HLS segment or init file
 */
export function getSegment({ filename, id, key, sessionId, slug, variantIndex, xImmichHlsMsn }: {
    filename: string;
    id: string;
    key?: string;
    sessionId: string;
    slug?: string;
    variantIndex: number;
    xImmichHlsMsn?: number;
}, opts?: Oazapfts.RequestOpts) {
    return oazapfts.ok(oazapfts.fetchBlob<{
        status: 200;
        data: Blob;
    }>(`/assets/${encodeURIComponent(id)}/video/stream/${encodeURIComponent(sessionId)}/${encodeURIComponent(variantIndex)}/${encodeURIComponent(filename)}${QS.query(QS.explode({
        key,
        slug
    }))}`, {
        ...opts,
        headers: oazapfts.mergeHeaders(opts?.headers, {
            "x-immich-hls-msn": xImmichHlsMsn
        })
    }));
}
/**
 * Register admin
 */
export function signUpAdmin({ signUpDto }: {
    signUpDto: SignUpDto;
}, opts?: Oazapfts.RequestOpts) {
    return oazapfts.ok(oazapfts.fetchJson<{
        status: 201;
        data: UserAdminResponseDto;
    }>("/auth/admin-sign-up", oazapfts.json({
        ...opts,
        method: "POST",
        body: signUpDto
    })));
}
/**
 * Change password
 */
export function changePassword({ changePasswordDto }: {
    changePasswordDto: ChangePasswordDto;
}, opts?: Oazapfts.RequestOpts) {
    return oazapfts.ok(oazapfts.fetchJson<{
        status: 200;
        data: UserAdminResponseDto;
    }>("/auth/change-password", oazapfts.json({
        ...opts,
        method: "POST",
        body: changePasswordDto
    })));
}
/**
 * Login
 */
export function login({ loginCredentialDto }: {
    loginCredentialDto: LoginCredentialDto;
}, opts?: Oazapfts.RequestOpts) {
    return oazapfts.ok(oazapfts.fetchJson<{
        status: 201;
        data: LoginResponseDto;
    }>("/auth/login", oazapfts.json({
        ...opts,
        method: "POST",
        body: loginCredentialDto
    })));
}
/**
 * Logout
 */
export function logout(opts?: Oazapfts.RequestOpts) {
    return oazapfts.ok(oazapfts.fetchJson<{
        status: 200;
        data: LogoutResponseDto;
    }>("/auth/logout", {
        ...opts,
        method: "POST"
    }));
}
/**
 * Reset pin code
 */
export function resetPinCode({ pinCodeResetDto }: {
    pinCodeResetDto: PinCodeResetDto;
}, opts?: Oazapfts.RequestOpts) {
    return oazapfts.ok(oazapfts.fetchText("/auth/pin-code", oazapfts.json({
        ...opts,
        method: "DELETE",
        body: pinCodeResetDto
    })));
}
/**
 * Setup pin code
 */
export function setupPinCode({ pinCodeSetupDto }: {
    pinCodeSetupDto: PinCodeSetupDto;
}, opts?: Oazapfts.RequestOpts) {
    return oazapfts.ok(oazapfts.fetchText("/auth/pin-code", oazapfts.json({
        ...opts,
        method: "POST",
        body: pinCodeSetupDto
    })));
}
/**
 * Change pin code
 */
export function changePinCode({ pinCodeChangeDto }: {
    pinCodeChangeDto: PinCodeChangeDto;
}, opts?: Oazapfts.RequestOpts) {
    return oazapfts.ok(oazapfts.fetchText("/auth/pin-code", oazapfts.json({
        ...opts,
        method: "PUT",
        body: pinCodeChangeDto
    })));
}
/**
 * Lock auth session
 */
export function lockAuthSession(opts?: Oazapfts.RequestOpts) {
    return oazapfts.ok(oazapfts.fetchText("/auth/session/lock", {
        ...opts,
        method: "POST"
    }));
}
/**
 * Unlock auth session
 */
export function unlockAuthSession({ sessionUnlockDto }: {
    sessionUnlockDto: SessionUnlockDto;
}, opts?: Oazapfts.RequestOpts) {
    return oazapfts.ok(oazapfts.fetchText("/auth/session/unlock", oazapfts.json({
        ...opts,
        method: "POST",
        body: sessionUnlockDto
    })));
}
/**
 * Retrieve auth status
 */
export function getAuthStatus(opts?: Oazapfts.RequestOpts) {
    return oazapfts.ok(oazapfts.fetchJson<{
        status: 200;
        data: AuthStatusResponseDto;
    }>("/auth/status", {
        ...opts
    }));
}
/**
 * Validate access token
 */
export function validateAccessToken(opts?: Oazapfts.RequestOpts) {
    return oazapfts.ok(oazapfts.fetchJson<{
        status: 200;
        data: ValidateAccessTokenResponseDto;
    }>("/auth/validateToken", {
        ...opts,
        method: "POST"
    }));
}
/**
 * Scan all libraries for classification
 */
export function scanClassification(opts?: Oazapfts.RequestOpts) {
    return oazapfts.ok(oazapfts.fetchText("/classification/scan", {
        ...opts,
        method: "POST"
    }));
}
/**
 * Download asset archive
 */
export function downloadArchive({ key, slug, downloadArchiveDto }: {
    key?: string;
    slug?: string;
    downloadArchiveDto: DownloadArchiveDto;
}, opts?: Oazapfts.RequestOpts) {
    return oazapfts.ok(oazapfts.fetchBlob<{
        status: 200;
        data: Blob;
    }>(`/download/archive${QS.query(QS.explode({
        key,
        slug
    }))}`, oazapfts.json({
        ...opts,
        method: "POST",
        body: downloadArchiveDto
    })));
}
/**
 * Retrieve download information
 */
export function getDownloadInfo({ key, slug, downloadInfoDto }: {
    key?: string;
    slug?: string;
    downloadInfoDto: DownloadInfoDto;
}, opts?: Oazapfts.RequestOpts) {
    return oazapfts.ok(oazapfts.fetchJson<{
        status: 201;
        data: DownloadResponseDto;
    }>(`/download/info${QS.query(QS.explode({
        key,
        slug
    }))}`, oazapfts.json({
        ...opts,
        method: "POST",
        body: downloadInfoDto
    })));
}
/**
 * Delete duplicates
 */
export function deleteDuplicates({ bulkIdsDto }: {
    bulkIdsDto: BulkIdsDto;
}, opts?: Oazapfts.RequestOpts) {
    return oazapfts.ok(oazapfts.fetchText("/duplicates", oazapfts.json({
        ...opts,
        method: "DELETE",
        body: bulkIdsDto
    })));
}
/**
 * Retrieve duplicates
 */
export function getAssetDuplicates(opts?: Oazapfts.RequestOpts) {
    return oazapfts.ok(oazapfts.fetchJson<{
        status: 200;
        data: DuplicateResponseDto[];
    }>("/duplicates", {
        ...opts
    }));
}
/**
 * Resolve duplicate groups
 */
export function resolveDuplicates({ duplicateResolveDto }: {
    duplicateResolveDto: DuplicateResolveDto;
}, opts?: Oazapfts.RequestOpts) {
    return oazapfts.ok(oazapfts.fetchJson<{
        status: 200;
        data: BulkIdResponseDto[];
    }>("/duplicates/resolve", oazapfts.json({
        ...opts,
        method: "POST",
        body: duplicateResolveDto
    })));
}
/**
 * Dismiss a duplicate group
 */
export function deleteDuplicate({ id }: {
    id: string;
}, opts?: Oazapfts.RequestOpts) {
    return oazapfts.ok(oazapfts.fetchText(`/duplicates/${encodeURIComponent(id)}`, {
        ...opts,
        method: "DELETE"
    }));
}
/**
 * Retrieve faces for asset
 */
export function getFaces({ id }: {
    id: string;
}, opts?: Oazapfts.RequestOpts) {
    return oazapfts.ok(oazapfts.fetchJson<{
        status: 200;
        data: AssetFaceResponseDto[];
    }>(`/faces${QS.query(QS.explode({
        id
    }))}`, {
        ...opts
    }));
}
/**
 * Create a face
 */
export function createFace({ assetFaceCreateDto }: {
    assetFaceCreateDto: AssetFaceCreateDto;
}, opts?: Oazapfts.RequestOpts) {
    return oazapfts.ok(oazapfts.fetchText("/faces", oazapfts.json({
        ...opts,
        method: "POST",
        body: assetFaceCreateDto
    })));
}
/**
 * Delete a face
 */
export function deleteFace({ id, assetFaceDeleteDto }: {
    id: string;
    assetFaceDeleteDto: AssetFaceDeleteDto;
}, opts?: Oazapfts.RequestOpts) {
    return oazapfts.ok(oazapfts.fetchText(`/faces/${encodeURIComponent(id)}`, oazapfts.json({
        ...opts,
        method: "DELETE",
        body: assetFaceDeleteDto
    })));
}
/**
 * Re-assign a face to another person
 */
export function reassignFacesById({ id, faceDto }: {
    id: string;
    faceDto: FaceDto;
}, opts?: Oazapfts.RequestOpts) {
    return oazapfts.ok(oazapfts.fetchJson<{
        status: 200;
        data: PersonResponseDto;
    }>(`/faces/${encodeURIComponent(id)}`, oazapfts.json({
        ...opts,
        method: "PUT",
        body: faceDto
    })));
}
/**
 * Get filtered map markers
 */
export function getFilteredMapMarkers({ albumId, city, country, description, isFavorite, isInAlbum, isNotInAlbum, lensModel, make, model, ocr, originalFileName, ownerId, personIds, rating, spaceId, state, tagIds, takenAfter, takenBefore, $type, withSharedSpaces }: {
    albumId?: string;
    city?: string;
    country?: string;
    description?: string;
    isFavorite?: boolean;
    isInAlbum?: boolean;
    isNotInAlbum?: boolean;
    lensModel?: string;
    make?: string;
    model?: string;
    ocr?: string;
    originalFileName?: string;
    ownerId?: string;
    personIds?: string[];
    rating?: number;
    spaceId?: string;
    state?: string;
    tagIds?: string[];
    takenAfter?: string;
    takenBefore?: string;
    $type?: MapMediaType;
    withSharedSpaces?: boolean;
}, opts?: Oazapfts.RequestOpts) {
    return oazapfts.ok(oazapfts.fetchJson<{
        status: 200;
        data: MapMarkerResponseDto[];
    }>(`/gallery/map/markers${QS.query(QS.explode({
        albumId,
        city,
        country,
        description,
        isFavorite,
        isInAlbum,
        isNotInAlbum,
        lensModel,
        make,
        model,
        ocr,
        originalFileName,
        ownerId,
        personIds,
        rating,
        spaceId,
        state,
        tagIds,
        takenAfter,
        takenBefore,
        "type": $type,
        withSharedSpaces
    }))}`, {
        ...opts
    }));
}
/**
 * Retrieve queue counts and status
 */
export function getQueuesLegacy(opts?: Oazapfts.RequestOpts) {
    return oazapfts.ok(oazapfts.fetchJson<{
        status: 200;
        data: QueuesResponseLegacyDto;
    }>("/jobs", {
        ...opts
    }));
}
/**
 * Create a manual job
 */
export function createJob({ jobCreateDto }: {
    jobCreateDto: JobCreateDto;
}, opts?: Oazapfts.RequestOpts) {
    return oazapfts.ok(oazapfts.fetchText("/jobs", oazapfts.json({
        ...opts,
        method: "POST",
        body: jobCreateDto
    })));
}
/**
 * Run jobs
 */
export function runQueueCommandLegacy({ name, queueCommandDto }: {
    name: QueueName;
    queueCommandDto: QueueCommandDto;
}, opts?: Oazapfts.RequestOpts) {
    return oazapfts.ok(oazapfts.fetchJson<{
        status: 200;
        data: QueueResponseLegacyDto;
    }>(`/jobs/${encodeURIComponent(name)}`, oazapfts.json({
        ...opts,
        method: "PUT",
        body: queueCommandDto
    })));
}
/**
 * Retrieve libraries
 */
export function getAllLibraries(opts?: Oazapfts.RequestOpts) {
    return oazapfts.ok(oazapfts.fetchJson<{
        status: 200;
        data: LibraryResponseDto[];
    }>("/libraries", {
        ...opts
    }));
}
/**
 * Create a library
 */
export function createLibrary({ createLibraryDto }: {
    createLibraryDto: CreateLibraryDto;
}, opts?: Oazapfts.RequestOpts) {
    return oazapfts.ok(oazapfts.fetchJson<{
        status: 201;
        data: LibraryResponseDto;
    }>("/libraries", oazapfts.json({
        ...opts,
        method: "POST",
        body: createLibraryDto
    })));
}
/**
 * Delete a library
 */
export function deleteLibrary({ id }: {
    id: string;
}, opts?: Oazapfts.RequestOpts) {
    return oazapfts.ok(oazapfts.fetchText(`/libraries/${encodeURIComponent(id)}`, {
        ...opts,
        method: "DELETE"
    }));
}
/**
 * Retrieve a library
 */
export function getLibrary({ id }: {
    id: string;
}, opts?: Oazapfts.RequestOpts) {
    return oazapfts.ok(oazapfts.fetchJson<{
        status: 200;
        data: LibraryResponseDto;
    }>(`/libraries/${encodeURIComponent(id)}`, {
        ...opts
    }));
}
/**
 * Update a library
 */
export function updateLibrary({ id, updateLibraryDto }: {
    id: string;
    updateLibraryDto: UpdateLibraryDto;
}, opts?: Oazapfts.RequestOpts) {
    return oazapfts.ok(oazapfts.fetchJson<{
        status: 200;
        data: LibraryResponseDto;
    }>(`/libraries/${encodeURIComponent(id)}`, oazapfts.json({
        ...opts,
        method: "PUT",
        body: updateLibraryDto
    })));
}
/**
 * Scan a library
 */
export function scanLibrary({ id }: {
    id: string;
}, opts?: Oazapfts.RequestOpts) {
    return oazapfts.ok(oazapfts.fetchText(`/libraries/${encodeURIComponent(id)}/scan`, {
        ...opts,
        method: "POST"
    }));
}
/**
 * Retrieve library statistics
 */
export function getLibraryStatistics({ id }: {
    id: string;
}, opts?: Oazapfts.RequestOpts) {
    return oazapfts.ok(oazapfts.fetchJson<{
        status: 200;
        data: LibraryStatsResponseDto;
    }>(`/libraries/${encodeURIComponent(id)}/statistics`, {
        ...opts
    }));
}
/**
 * Validate library settings
 */
export function validate({ id, validateLibraryDto }: {
    id: string;
    validateLibraryDto: ValidateLibraryDto;
}, opts?: Oazapfts.RequestOpts) {
    return oazapfts.ok(oazapfts.fetchJson<{
        status: 200;
        data: ValidateLibraryResponseDto;
    }>(`/libraries/${encodeURIComponent(id)}/validate`, oazapfts.json({
        ...opts,
        method: "POST",
        body: validateLibraryDto
    })));
}
/**
 * Retrieve map markers
 */
export function getMapMarkers({ fileCreatedAfter, fileCreatedBefore, isArchived, isFavorite, withPartners, withSharedAlbums, withSharedSpaces }: {
    fileCreatedAfter?: string;
    fileCreatedBefore?: string;
    isArchived?: boolean;
    isFavorite?: boolean;
    withPartners?: boolean;
    withSharedAlbums?: boolean;
    withSharedSpaces?: boolean;
}, opts?: Oazapfts.RequestOpts) {
    return oazapfts.ok(oazapfts.fetchJson<{
        status: 200;
        data: MapMarkerResponseDto[];
    }>(`/map/markers${QS.query(QS.explode({
        fileCreatedAfter,
        fileCreatedBefore,
        isArchived,
        isFavorite,
        withPartners,
        withSharedAlbums,
        withSharedSpaces
    }))}`, {
        ...opts
    }));
}
/**
 * Reverse geocode coordinates
 */
export function reverseGeocode({ lat, lon }: {
    lat: number;
    lon: number;
}, opts?: Oazapfts.RequestOpts) {
    return oazapfts.ok(oazapfts.fetchJson<{
        status: 200;
        data: MapReverseGeocodeResponseDto[];
    }>(`/map/reverse-geocode${QS.query(QS.explode({
        lat,
        lon
    }))}`, {
        ...opts
    }));
}
/**
 * Retrieve memories
 */
export function searchMemories({ $for, isSaved, isTrashed, order, size, $type }: {
    $for?: string;
    isSaved?: boolean;
    isTrashed?: boolean;
    order?: MemorySearchOrder;
    size?: number;
    $type?: MemoryType;
}, opts?: Oazapfts.RequestOpts) {
    return oazapfts.ok(oazapfts.fetchJson<{
        status: 200;
        data: MemoryResponseDto[];
    }>(`/memories${QS.query(QS.explode({
        "for": $for,
        isSaved,
        isTrashed,
        order,
        size,
        "type": $type
    }))}`, {
        ...opts
    }));
}
/**
 * Create a memory
 */
export function createMemory({ memoryCreateDto }: {
    memoryCreateDto: MemoryCreateDto;
}, opts?: Oazapfts.RequestOpts) {
    return oazapfts.ok(oazapfts.fetchJson<{
        status: 201;
        data: MemoryResponseDto;
    }>("/memories", oazapfts.json({
        ...opts,
        method: "POST",
        body: memoryCreateDto
    })));
}
/**
 * Retrieve memories statistics
 */
export function memoriesStatistics({ $for, isSaved, isTrashed, order, size, $type }: {
    $for?: string;
    isSaved?: boolean;
    isTrashed?: boolean;
    order?: MemorySearchOrder;
    size?: number;
    $type?: MemoryType;
}, opts?: Oazapfts.RequestOpts) {
    return oazapfts.ok(oazapfts.fetchJson<{
        status: 200;
        data: MemoryStatisticsResponseDto;
    }>(`/memories/statistics${QS.query(QS.explode({
        "for": $for,
        isSaved,
        isTrashed,
        order,
        size,
        "type": $type
    }))}`, {
        ...opts
    }));
}
/**
 * Delete a memory
 */
export function deleteMemory({ id }: {
    id: string;
}, opts?: Oazapfts.RequestOpts) {
    return oazapfts.ok(oazapfts.fetchText(`/memories/${encodeURIComponent(id)}`, {
        ...opts,
        method: "DELETE"
    }));
}
/**
 * Retrieve a memory
 */
export function getMemory({ id }: {
    id: string;
}, opts?: Oazapfts.RequestOpts) {
    return oazapfts.ok(oazapfts.fetchJson<{
        status: 200;
        data: MemoryResponseDto;
    }>(`/memories/${encodeURIComponent(id)}`, {
        ...opts
    }));
}
/**
 * Update a memory
 */
export function updateMemory({ id, memoryUpdateDto }: {
    id: string;
    memoryUpdateDto: MemoryUpdateDto;
}, opts?: Oazapfts.RequestOpts) {
    return oazapfts.ok(oazapfts.fetchJson<{
        status: 200;
        data: MemoryResponseDto;
    }>(`/memories/${encodeURIComponent(id)}`, oazapfts.json({
        ...opts,
        method: "PUT",
        body: memoryUpdateDto
    })));
}
/**
 * Remove assets from a memory
 */
export function removeMemoryAssets({ id, bulkIdsDto }: {
    id: string;
    bulkIdsDto: BulkIdsDto;
}, opts?: Oazapfts.RequestOpts) {
    return oazapfts.ok(oazapfts.fetchJson<{
        status: 200;
        data: BulkIdResponseDto[];
    }>(`/memories/${encodeURIComponent(id)}/assets`, oazapfts.json({
        ...opts,
        method: "DELETE",
        body: bulkIdsDto
    })));
}
/**
 * Add assets to a memory
 */
export function addMemoryAssets({ id, bulkIdsDto }: {
    id: string;
    bulkIdsDto: BulkIdsDto;
}, opts?: Oazapfts.RequestOpts) {
    return oazapfts.ok(oazapfts.fetchJson<{
        status: 200;
        data: BulkIdResponseDto[];
    }>(`/memories/${encodeURIComponent(id)}/assets`, oazapfts.json({
        ...opts,
        method: "PUT",
        body: bulkIdsDto
    })));
}
/**
 * Delete notifications
 */
export function deleteNotifications({ notificationDeleteAllDto }: {
    notificationDeleteAllDto: NotificationDeleteAllDto;
}, opts?: Oazapfts.RequestOpts) {
    return oazapfts.ok(oazapfts.fetchText("/notifications", oazapfts.json({
        ...opts,
        method: "DELETE",
        body: notificationDeleteAllDto
    })));
}
/**
 * Retrieve notifications
 */
export function getNotifications({ id, level, $type, unread }: {
    id?: string;
    level?: NotificationLevel;
    $type?: NotificationType;
    unread?: boolean;
}, opts?: Oazapfts.RequestOpts) {
    return oazapfts.ok(oazapfts.fetchJson<{
        status: 200;
        data: NotificationDto[];
    }>(`/notifications${QS.query(QS.explode({
        id,
        level,
        "type": $type,
        unread
    }))}`, {
        ...opts
    }));
}
/**
 * Update notifications
 */
export function updateNotifications({ notificationUpdateAllDto }: {
    notificationUpdateAllDto: NotificationUpdateAllDto;
}, opts?: Oazapfts.RequestOpts) {
    return oazapfts.ok(oazapfts.fetchText("/notifications", oazapfts.json({
        ...opts,
        method: "PUT",
        body: notificationUpdateAllDto
    })));
}
/**
 * Delete a notification
 */
export function deleteNotification({ id }: {
    id: string;
}, opts?: Oazapfts.RequestOpts) {
    return oazapfts.ok(oazapfts.fetchText(`/notifications/${encodeURIComponent(id)}`, {
        ...opts,
        method: "DELETE"
    }));
}
/**
 * Get a notification
 */
export function getNotification({ id }: {
    id: string;
}, opts?: Oazapfts.RequestOpts) {
    return oazapfts.ok(oazapfts.fetchJson<{
        status: 200;
        data: NotificationDto;
    }>(`/notifications/${encodeURIComponent(id)}`, {
        ...opts
    }));
}
/**
 * Update a notification
 */
export function updateNotification({ id, notificationUpdateDto }: {
    id: string;
    notificationUpdateDto: NotificationUpdateDto;
}, opts?: Oazapfts.RequestOpts) {
    return oazapfts.ok(oazapfts.fetchJson<{
        status: 200;
        data: NotificationDto;
    }>(`/notifications/${encodeURIComponent(id)}`, oazapfts.json({
        ...opts,
        method: "PUT",
        body: notificationUpdateDto
    })));
}
/**
 * Start OAuth
 */
export function startOAuth({ oAuthConfigDto }: {
    oAuthConfigDto: OAuthConfigDto;
}, opts?: Oazapfts.RequestOpts) {
    return oazapfts.ok(oazapfts.fetchJson<{
        status: 201;
        data: OAuthAuthorizeResponseDto;
    }>("/oauth/authorize", oazapfts.json({
        ...opts,
        method: "POST",
        body: oAuthConfigDto
    })));
}
/**
 * Backchannel OAuth logout
 */
export function logoutOAuth({ oAuthBackchannelLogoutDto }: {
    oAuthBackchannelLogoutDto: OAuthBackchannelLogoutDto;
}, opts?: Oazapfts.RequestOpts) {
    return oazapfts.ok(oazapfts.fetchText("/oauth/backchannel-logout", oazapfts.form({
        ...opts,
        method: "POST",
        body: oAuthBackchannelLogoutDto
    })));
}
/**
 * Finish OAuth
 */
export function finishOAuth({ oAuthCallbackDto }: {
    oAuthCallbackDto: OAuthCallbackDto;
}, opts?: Oazapfts.RequestOpts) {
    return oazapfts.ok(oazapfts.fetchJson<{
        status: 201;
        data: LoginResponseDto;
    }>("/oauth/callback", oazapfts.json({
        ...opts,
        method: "POST",
        body: oAuthCallbackDto
    })));
}
/**
 * Link OAuth account
 */
export function linkOAuthAccount({ oAuthCallbackDto }: {
    oAuthCallbackDto: OAuthCallbackDto;
}, opts?: Oazapfts.RequestOpts) {
    return oazapfts.ok(oazapfts.fetchJson<{
        status: 200;
        data: UserAdminResponseDto;
    }>("/oauth/link", oazapfts.json({
        ...opts,
        method: "POST",
        body: oAuthCallbackDto
    })));
}
/**
 * Redirect OAuth to mobile
 */
export function redirectOAuthToMobile(opts?: Oazapfts.RequestOpts) {
    return oazapfts.ok(oazapfts.fetchText("/oauth/mobile-redirect", {
        ...opts
    }));
}
/**
 * Unlink OAuth account
 */
export function unlinkOAuthAccount(opts?: Oazapfts.RequestOpts) {
    return oazapfts.ok(oazapfts.fetchJson<{
        status: 200;
        data: UserAdminResponseDto;
    }>("/oauth/unlink", {
        ...opts,
        method: "POST"
    }));
}
/**
 * Retrieve partners
 */
export function getPartners({ direction }: {
    direction: PartnerDirection;
}, opts?: Oazapfts.RequestOpts) {
    return oazapfts.ok(oazapfts.fetchJson<{
        status: 200;
        data: PartnerResponseDto[];
    }>(`/partners${QS.query(QS.explode({
        direction
    }))}`, {
        ...opts
    }));
}
/**
 * Create a partner
 */
export function createPartner({ partnerCreateDto }: {
    partnerCreateDto: PartnerCreateDto;
}, opts?: Oazapfts.RequestOpts) {
    return oazapfts.ok(oazapfts.fetchJson<{
        status: 201;
        data: PartnerResponseDto;
    }>("/partners", oazapfts.json({
        ...opts,
        method: "POST",
        body: partnerCreateDto
    })));
}
/**
 * Remove a partner
 */
export function removePartner({ id }: {
    id: string;
}, opts?: Oazapfts.RequestOpts) {
    return oazapfts.ok(oazapfts.fetchText(`/partners/${encodeURIComponent(id)}`, {
        ...opts,
        method: "DELETE"
    }));
}
/**
 * Create a partner
 */
export function createPartnerDeprecated({ id }: {
    id: string;
}, opts?: Oazapfts.RequestOpts) {
    return oazapfts.ok(oazapfts.fetchJson<{
        status: 201;
        data: PartnerResponseDto;
    }>(`/partners/${encodeURIComponent(id)}`, {
        ...opts,
        method: "POST"
    }));
}
/**
 * Update a partner
 */
export function updatePartner({ id, partnerUpdateDto }: {
    id: string;
    partnerUpdateDto: PartnerUpdateDto;
}, opts?: Oazapfts.RequestOpts) {
    return oazapfts.ok(oazapfts.fetchJson<{
        status: 200;
        data: PartnerResponseDto;
    }>(`/partners/${encodeURIComponent(id)}`, oazapfts.json({
        ...opts,
        method: "PUT",
        body: partnerUpdateDto
    })));
}
/**
 * Delete people
 */
export function deletePeople({ bulkIdsDto }: {
    bulkIdsDto: BulkIdsDto;
}, opts?: Oazapfts.RequestOpts) {
    return oazapfts.ok(oazapfts.fetchText("/people", oazapfts.json({
        ...opts,
        method: "DELETE",
        body: bulkIdsDto
    })));
}
/**
 * Get all people
 */
export function getAllPeople({ closestAssetId, closestPersonId, page, size, withHidden, withSharedSpaces }: {
    closestAssetId?: string;
    closestPersonId?: string;
    page?: number;
    size?: number;
    withHidden?: boolean;
    withSharedSpaces?: boolean;
}, opts?: Oazapfts.RequestOpts) {
    return oazapfts.ok(oazapfts.fetchJson<{
        status: 200;
        data: PeopleResponseDto;
    }>(`/people${QS.query(QS.explode({
        closestAssetId,
        closestPersonId,
        page,
        size,
        withHidden,
        withSharedSpaces
    }))}`, {
        ...opts
    }));
}
/**
 * Create a person
 */
export function createPerson({ personCreateDto }: {
    personCreateDto: PersonCreateDto;
}, opts?: Oazapfts.RequestOpts) {
    return oazapfts.ok(oazapfts.fetchJson<{
        status: 201;
        data: PersonResponseDto;
    }>("/people", oazapfts.json({
        ...opts,
        method: "POST",
        body: personCreateDto
    })));
}
/**
 * Update people
 */
export function updatePeople({ peopleUpdateDto }: {
    peopleUpdateDto: PeopleUpdateDto;
}, opts?: Oazapfts.RequestOpts) {
    return oazapfts.ok(oazapfts.fetchJson<{
        status: 200;
        data: BulkIdResponseDto[];
    }>("/people", oazapfts.json({
        ...opts,
        method: "PUT",
        body: peopleUpdateDto
    })));
}
/**
 * Detach a scoped person profile
 */
export function detachScopedPerson({ detachScopedPersonDto }: {
    detachScopedPersonDto: DetachScopedPersonDto;
}, opts?: Oazapfts.RequestOpts) {
    return oazapfts.ok(oazapfts.fetchText("/people/detach-profile", oazapfts.json({
        ...opts,
        method: "POST",
        body: detachScopedPersonDto
    })));
}
/**
 * Get people face statistics
 */
export function getPeopleFaceStatistics({ closestAssetId, closestPersonId, page, size, withHidden, withSharedSpaces }: {
    closestAssetId?: string;
    closestPersonId?: string;
    page?: number;
    size?: number;
    withHidden?: boolean;
    withSharedSpaces?: boolean;
}, opts?: Oazapfts.RequestOpts) {
    return oazapfts.ok(oazapfts.fetchJson<{
        status: 200;
        data: PeopleFaceStatisticsResponseDto;
    }>(`/people/face-statistics${QS.query(QS.explode({
        closestAssetId,
        closestPersonId,
        page,
        size,
        withHidden,
        withSharedSpaces
    }))}`, {
        ...opts
    }));
}
/**
 * Merge scoped people by identity
 */
export function mergeScopedPeople({ mergeScopedPeopleDto }: {
    mergeScopedPeopleDto: MergeScopedPeopleDto;
}, opts?: Oazapfts.RequestOpts) {
    return oazapfts.ok(oazapfts.fetchText("/people/same-person", oazapfts.json({
        ...opts,
        method: "POST",
        body: mergeScopedPeopleDto
    })));
}
/**
 * Get people statistics
 */
export function getPeopleStatistics({ closestAssetId, closestPersonId, page, size, withHidden, withSharedSpaces }: {
    closestAssetId?: string;
    closestPersonId?: string;
    page?: number;
    size?: number;
    withHidden?: boolean;
    withSharedSpaces?: boolean;
}, opts?: Oazapfts.RequestOpts) {
    return oazapfts.ok(oazapfts.fetchJson<{
        status: 200;
        data: PeopleStatisticsResponseDto;
    }>(`/people/statistics${QS.query(QS.explode({
        closestAssetId,
        closestPersonId,
        page,
        size,
        withHidden,
        withSharedSpaces
    }))}`, {
        ...opts
    }));
}
/**
 * Delete person
 */
export function deletePerson({ id }: {
    id: string;
}, opts?: Oazapfts.RequestOpts) {
    return oazapfts.ok(oazapfts.fetchText(`/people/${encodeURIComponent(id)}`, {
        ...opts,
        method: "DELETE"
    }));
}
/**
 * Get a person
 */
export function getPerson({ id }: {
    id: string;
}, opts?: Oazapfts.RequestOpts) {
    return oazapfts.ok(oazapfts.fetchJson<{
        status: 200;
        data: PersonResponseDto;
    }>(`/people/${encodeURIComponent(id)}`, {
        ...opts
    }));
}
/**
 * Update person
 */
export function updatePerson({ id, personUpdateDto }: {
    id: string;
    personUpdateDto: PersonUpdateDto;
}, opts?: Oazapfts.RequestOpts) {
    return oazapfts.ok(oazapfts.fetchJson<{
        status: 200;
        data: PersonResponseDto;
    }>(`/people/${encodeURIComponent(id)}`, oazapfts.json({
        ...opts,
        method: "PUT",
        body: personUpdateDto
    })));
}
/**
 * Get face suggestions for a person
 */
export function getPersonFaceSuggestions({ id, page, size }: {
    id: string;
    page?: number;
    size?: number;
}, opts?: Oazapfts.RequestOpts) {
    return oazapfts.ok(oazapfts.fetchJson<{
        status: 200;
        data: PersonFaceSuggestionPageResponseDto;
    }>(`/people/${encodeURIComponent(id)}/face-suggestions${QS.query(QS.explode({
        page,
        size
    }))}`, {
        ...opts
    }));
}
/**
 * Confirm a face suggestion
 */
export function confirmPersonFaceSuggestion({ assetFaceId, id }: {
    assetFaceId: string;
    id: string;
}, opts?: Oazapfts.RequestOpts) {
    return oazapfts.ok(oazapfts.fetchJson<{
        status: 200;
        data: FaceSuggestionActionResponseDto;
    }>(`/people/${encodeURIComponent(id)}/face-suggestions/${encodeURIComponent(assetFaceId)}/confirm`, {
        ...opts,
        method: "POST"
    }));
}
/**
 * Dismiss a face suggestion
 */
export function dismissPersonFaceSuggestion({ assetFaceId, id }: {
    assetFaceId: string;
    id: string;
}, opts?: Oazapfts.RequestOpts) {
    return oazapfts.ok(oazapfts.fetchJson<{
        status: 200;
        data: FaceSuggestionActionResponseDto;
    }>(`/people/${encodeURIComponent(id)}/face-suggestions/${encodeURIComponent(assetFaceId)}/dismiss`, {
        ...opts,
        method: "POST"
    }));
}
/**
 * Ignore a face suggestion
 */
export function ignorePersonFaceSuggestion({ assetFaceId, id }: {
    assetFaceId: string;
    id: string;
}, opts?: Oazapfts.RequestOpts) {
    return oazapfts.ok(oazapfts.fetchJson<{
        status: 200;
        data: FaceSuggestionActionResponseDto;
    }>(`/people/${encodeURIComponent(id)}/face-suggestions/${encodeURIComponent(assetFaceId)}/ignore`, {
        ...opts,
        method: "POST"
    }));
}
/**
 * Reject a face suggestion
 */
export function rejectPersonFaceSuggestion({ assetFaceId, id }: {
    assetFaceId: string;
    id: string;
}, opts?: Oazapfts.RequestOpts) {
    return oazapfts.ok(oazapfts.fetchJson<{
        status: 200;
        data: FaceSuggestionActionResponseDto;
    }>(`/people/${encodeURIComponent(id)}/face-suggestions/${encodeURIComponent(assetFaceId)}/reject`, {
        ...opts,
        method: "POST"
    }));
}
/**
 * Get person faces
 */
export function getPersonFaces({ id, page, size }: {
    id: string;
    page?: number;
    size?: number;
}, opts?: Oazapfts.RequestOpts) {
    return oazapfts.ok(oazapfts.fetchJson<{
        status: 200;
        data: PersonFacePageResponseDto;
    }>(`/people/${encodeURIComponent(id)}/faces${QS.query(QS.explode({
        page,
        size
    }))}`, {
        ...opts
    }));
}
/**
 * Get person face thumbnail
 */
export function getPersonFaceThumbnail({ faceId, id }: {
    faceId: string;
    id: string;
}, opts?: Oazapfts.RequestOpts) {
    return oazapfts.ok(oazapfts.fetchBlob<{
        status: 200;
        data: Blob;
    }>(`/people/${encodeURIComponent(id)}/faces/${encodeURIComponent(faceId)}/thumbnail`, {
        ...opts
    }));
}
/**
 * Merge people
 */
export function mergePerson({ id, mergePersonDto }: {
    id: string;
    mergePersonDto: MergePersonDto;
}, opts?: Oazapfts.RequestOpts) {
    return oazapfts.ok(oazapfts.fetchJson<{
        status: 200;
        data: BulkIdResponseDto[];
    }>(`/people/${encodeURIComponent(id)}/merge`, oazapfts.json({
        ...opts,
        method: "POST",
        body: mergePersonDto
    })));
}
/**
 * Reassign faces
 */
export function reassignFaces({ id, assetFaceUpdateDto }: {
    id: string;
    assetFaceUpdateDto: AssetFaceUpdateDto;
}, opts?: Oazapfts.RequestOpts) {
    return oazapfts.ok(oazapfts.fetchJson<{
        status: 200;
        data: PersonResponseDto[];
    }>(`/people/${encodeURIComponent(id)}/reassign`, oazapfts.json({
        ...opts,
        method: "PUT",
        body: assetFaceUpdateDto
    })));
}
/**
 * Update representative face
 */
export function updateRepresentativeFace({ id, representativeFaceUpdateDto }: {
    id: string;
    representativeFaceUpdateDto: RepresentativeFaceUpdateDto;
}, opts?: Oazapfts.RequestOpts) {
    return oazapfts.ok(oazapfts.fetchJson<{
        status: 200;
        data: PersonResponseDto;
    }>(`/people/${encodeURIComponent(id)}/representative-face`, oazapfts.json({
        ...opts,
        method: "PUT",
        body: representativeFaceUpdateDto
    })));
}
/**
 * Get person statistics
 */
export function getPersonStatistics({ id }: {
    id: string;
}, opts?: Oazapfts.RequestOpts) {
    return oazapfts.ok(oazapfts.fetchJson<{
        status: 200;
        data: PersonStatisticsResponseDto;
    }>(`/people/${encodeURIComponent(id)}/statistics`, {
        ...opts
    }));
}
/**
 * Get person thumbnail
 */
export function getPersonThumbnail({ id }: {
    id: string;
}, opts?: Oazapfts.RequestOpts) {
    return oazapfts.ok(oazapfts.fetchBlob<{
        status: 200;
        data: Blob;
    }>(`/people/${encodeURIComponent(id)}/thumbnail`, {
        ...opts
    }));
}
/**
 * List all plugins
 */
export function searchPlugins({ description, enabled, id, name, title, version }: {
    description?: string;
    enabled?: boolean;
    id?: string;
    name?: string;
    title?: string;
    version?: string;
}, opts?: Oazapfts.RequestOpts) {
    return oazapfts.ok(oazapfts.fetchJson<{
        status: 200;
        data: PluginResponseDto[];
    }>(`/plugins${QS.query(QS.explode({
        description,
        enabled,
        id,
        name,
        title,
        version
    }))}`, {
        ...opts
    }));
}
/**
 * Retrieve plugin methods
 */
export function searchPluginMethods({ description, enabled, id, name, pluginName, pluginVersion, title, trigger, $type }: {
    description?: string;
    enabled?: boolean;
    id?: string;
    name?: string;
    pluginName?: string;
    pluginVersion?: string;
    title?: string;
    trigger?: WorkflowTrigger;
    $type?: WorkflowType;
}, opts?: Oazapfts.RequestOpts) {
    return oazapfts.ok(oazapfts.fetchJson<{
        status: 200;
        data: PluginMethodResponseDto[];
    }>(`/plugins/methods${QS.query(QS.explode({
        description,
        enabled,
        id,
        name,
        pluginName,
        pluginVersion,
        title,
        trigger,
        "type": $type
    }))}`, {
        ...opts
    }));
}
/**
 * Retrieve workflow templates
 */
export function searchPluginTemplates(opts?: Oazapfts.RequestOpts) {
    return oazapfts.ok(oazapfts.fetchJson<{
        status: 200;
        data: PluginTemplateResponseDto[];
    }>("/plugins/templates", {
        ...opts
    }));
}
/**
 * Retrieve a plugin
 */
export function getPlugin({ id }: {
    id: string;
}, opts?: Oazapfts.RequestOpts) {
    return oazapfts.ok(oazapfts.fetchJson<{
        status: 200;
        data: PluginResponseDto;
    }>(`/plugins/${encodeURIComponent(id)}`, {
        ...opts
    }));
}
/**
 * List all queues
 */
export function getQueues(opts?: Oazapfts.RequestOpts) {
    return oazapfts.ok(oazapfts.fetchJson<{
        status: 200;
        data: QueueResponseDto[];
    }>("/queues", {
        ...opts
    }));
}
/**
 * Retrieve a queue
 */
export function getQueue({ name }: {
    name: QueueName;
}, opts?: Oazapfts.RequestOpts) {
    return oazapfts.ok(oazapfts.fetchJson<{
        status: 200;
        data: QueueResponseDto;
    }>(`/queues/${encodeURIComponent(name)}`, {
        ...opts
    }));
}
/**
 * Update a queue
 */
export function updateQueue({ name, queueUpdateDto }: {
    name: QueueName;
    queueUpdateDto: QueueUpdateDto;
}, opts?: Oazapfts.RequestOpts) {
    return oazapfts.ok(oazapfts.fetchJson<{
        status: 200;
        data: QueueResponseDto;
    }>(`/queues/${encodeURIComponent(name)}`, oazapfts.json({
        ...opts,
        method: "PUT",
        body: queueUpdateDto
    })));
}
/**
 * Empty a queue
 */
export function emptyQueue({ name, queueDeleteDto }: {
    name: QueueName;
    queueDeleteDto: QueueDeleteDto;
}, opts?: Oazapfts.RequestOpts) {
    return oazapfts.ok(oazapfts.fetchText(`/queues/${encodeURIComponent(name)}/jobs`, oazapfts.json({
        ...opts,
        method: "DELETE",
        body: queueDeleteDto
    })));
}
/**
 * Retrieve queue jobs
 */
export function getQueueJobs({ name, status }: {
    name: QueueName;
    status?: QueueJobStatus[];
}, opts?: Oazapfts.RequestOpts) {
    return oazapfts.ok(oazapfts.fetchJson<{
        status: 200;
        data: QueueJobResponseDto[];
    }>(`/queues/${encodeURIComponent(name)}/jobs${QS.query(QS.explode({
        status
    }))}`, {
        ...opts
    }));
}
/**
 * Retrieve assets by city
 */
export function getAssetsByCity(opts?: Oazapfts.RequestOpts) {
    return oazapfts.ok(oazapfts.fetchJson<{
        status: 200;
        data: AssetResponseDto[];
    }>("/search/cities", {
        ...opts
    }));
}
/**
 * Retrieve explore data
 */
export function getExploreData(opts?: Oazapfts.RequestOpts) {
    return oazapfts.ok(oazapfts.fetchJson<{
        status: 200;
        data: SearchExploreResponseDto[];
    }>("/search/explore", {
        ...opts
    }));
}
/**
 * Search large assets
 */
export function searchLargeAssets({ albumIds, city, country, createdAfter, createdBefore, isEncoded, isFavorite, isInAlbum, isMotion, isNotInAlbum, isOffline, lensModel, libraryId, make, minFileSize, model, ocr, ownerId, personIds, rating, size, spaceId, spacePersonIds, state, tagIds, takenAfter, takenBefore, trashedAfter, trashedBefore, $type, updatedAfter, updatedBefore, visibility, withDeleted, withExif, withSharedSpaces }: {
    albumIds?: string[];
    city?: string | null;
    country?: string | null;
    createdAfter?: string;
    createdBefore?: string;
    isEncoded?: boolean;
    isFavorite?: boolean;
    isInAlbum?: boolean;
    isMotion?: boolean;
    isNotInAlbum?: boolean;
    isOffline?: boolean;
    lensModel?: string | null;
    libraryId?: string | null;
    make?: string | null;
    minFileSize?: number;
    model?: string | null;
    ocr?: string;
    ownerId?: string;
    personIds?: string[];
    rating?: number | null;
    size?: number;
    spaceId?: string;
    spacePersonIds?: string[];
    state?: string | null;
    tagIds?: string[] | null;
    takenAfter?: string;
    takenBefore?: string;
    trashedAfter?: string;
    trashedBefore?: string;
    $type?: AssetTypeEnum;
    updatedAfter?: string;
    updatedBefore?: string;
    visibility?: AssetVisibility;
    withDeleted?: boolean;
    withExif?: boolean;
    withSharedSpaces?: boolean;
}, opts?: Oazapfts.RequestOpts) {
    return oazapfts.ok(oazapfts.fetchJson<{
        status: 200;
        data: AssetResponseDto[];
    }>(`/search/large-assets${QS.query(QS.explode({
        albumIds,
        city,
        country,
        createdAfter,
        createdBefore,
        isEncoded,
        isFavorite,
        isInAlbum,
        isMotion,
        isNotInAlbum,
        isOffline,
        lensModel,
        libraryId,
        make,
        minFileSize,
        model,
        ocr,
        ownerId,
        personIds,
        rating,
        size,
        spaceId,
        spacePersonIds,
        state,
        tagIds,
        takenAfter,
        takenBefore,
        trashedAfter,
        trashedBefore,
        "type": $type,
        updatedAfter,
        updatedBefore,
        visibility,
        withDeleted,
        withExif,
        withSharedSpaces
    }))}`, {
        ...opts,
        method: "POST"
    }));
}
/**
 * Search assets by metadata
 */
export function searchAssets({ key, slug, metadataSearchDto }: {
    key?: string;
    slug?: string;
    metadataSearchDto: MetadataSearchDto;
}, opts?: Oazapfts.RequestOpts) {
    return oazapfts.ok(oazapfts.fetchJson<{
        status: 200;
        data: SearchResponseDto;
    }>(`/search/metadata${QS.query(QS.explode({
        key,
        slug
    }))}`, oazapfts.json({
        ...opts,
        method: "POST",
        body: metadataSearchDto
    })));
}
/**
 * Search people
 */
export function searchPerson({ name, withHidden, withSharedSpaces }: {
    name: string;
    withHidden?: boolean;
    withSharedSpaces?: boolean;
}, opts?: Oazapfts.RequestOpts) {
    return oazapfts.ok(oazapfts.fetchJson<{
        status: 200;
        data: PersonResponseDto[];
    }>(`/search/person${QS.query(QS.explode({
        name,
        withHidden,
        withSharedSpaces
    }))}`, {
        ...opts
    }));
}
/**
 * Search places
 */
export function searchPlaces({ name }: {
    name: string;
}, opts?: Oazapfts.RequestOpts) {
    return oazapfts.ok(oazapfts.fetchJson<{
        status: 200;
        data: PlacesResponseDto[];
    }>(`/search/places${QS.query(QS.explode({
        name
    }))}`, {
        ...opts
    }));
}
/**
 * Search random assets
 */
export function searchRandom({ randomSearchDto }: {
    randomSearchDto: RandomSearchDto;
}, opts?: Oazapfts.RequestOpts) {
    return oazapfts.ok(oazapfts.fetchJson<{
        status: 200;
        data: AssetResponseDto[];
    }>("/search/random", oazapfts.json({
        ...opts,
        method: "POST",
        body: randomSearchDto
    })));
}
/**
 * Smart asset search
 */
export function searchSmart({ smartSearchDto }: {
    smartSearchDto: SmartSearchDto;
}, opts?: Oazapfts.RequestOpts) {
    return oazapfts.ok(oazapfts.fetchJson<{
        status: 200;
        data: SearchResponseDto;
    }>("/search/smart", oazapfts.json({
        ...opts,
        method: "POST",
        body: smartSearchDto
    })));
}
/**
 * Smart asset search facets
 */
export function searchSmartFacets({ smartSearchFacetsDto }: {
    smartSearchFacetsDto: SmartSearchFacetsDto;
}, opts?: Oazapfts.RequestOpts) {
    return oazapfts.ok(oazapfts.fetchJson<{
        status: 200;
        data: SmartSearchFacetsResponseDto;
    }>("/search/smart/facets", oazapfts.json({
        ...opts,
        method: "POST",
        body: smartSearchFacetsDto
    })));
}
/**
 * Search asset statistics
 */
export function searchAssetStatistics({ statisticsSearchDto }: {
    statisticsSearchDto: StatisticsSearchDto;
}, opts?: Oazapfts.RequestOpts) {
    return oazapfts.ok(oazapfts.fetchJson<{
        status: 200;
        data: SearchStatisticsResponseDto;
    }>("/search/statistics", oazapfts.json({
        ...opts,
        method: "POST",
        body: statisticsSearchDto
    })));
}
/**
 * Retrieve search suggestions
 */
export function getSearchSuggestions({ albumId, city, country, includeNull, isFavorite, isInAlbum, isNotInAlbum, lensModel, make, mediaType, model, ownerId, personIds, rating, spaceId, state, tagIds, takenAfter, takenBefore, $type, withSharedSpaces }: {
    albumId?: string;
    city?: string;
    country?: string;
    includeNull?: boolean;
    isFavorite?: boolean;
    isInAlbum?: boolean;
    isNotInAlbum?: boolean;
    lensModel?: string;
    make?: string;
    mediaType?: AssetTypeEnum;
    model?: string;
    ownerId?: string;
    personIds?: string[];
    rating?: number;
    spaceId?: string;
    state?: string;
    tagIds?: string[];
    takenAfter?: string;
    takenBefore?: string;
    $type: SearchSuggestionType;
    withSharedSpaces?: boolean;
}, opts?: Oazapfts.RequestOpts) {
    return oazapfts.ok(oazapfts.fetchJson<{
        status: 200;
        data: string[];
    }>(`/search/suggestions${QS.query(QS.explode({
        albumId,
        city,
        country,
        includeNull,
        isFavorite,
        isInAlbum,
        isNotInAlbum,
        lensModel,
        make,
        mediaType,
        model,
        ownerId,
        personIds,
        rating,
        spaceId,
        state,
        tagIds,
        takenAfter,
        takenBefore,
        "type": $type,
        withSharedSpaces
    }))}`, {
        ...opts
    }));
}
/**
 * Retrieve dynamic filter suggestions
 */
export function getFilterSuggestions({ albumId, city, country, isFavorite, isInAlbum, isNotInAlbum, lensModel, make, mediaType, model, ownerId, personIds, rating, spaceId, state, tagIds, takenAfter, takenBefore, withSharedSpaces }: {
    albumId?: string;
    city?: string;
    country?: string;
    isFavorite?: boolean;
    isInAlbum?: boolean;
    isNotInAlbum?: boolean;
    lensModel?: string;
    make?: string;
    mediaType?: AssetTypeEnum;
    model?: string;
    ownerId?: string;
    personIds?: string[];
    rating?: number;
    spaceId?: string;
    state?: string;
    tagIds?: string[];
    takenAfter?: string;
    takenBefore?: string;
    withSharedSpaces?: boolean;
}, opts?: Oazapfts.RequestOpts) {
    return oazapfts.ok(oazapfts.fetchJson<{
        status: 200;
        data: FilterSuggestionsResponseDto;
    }>(`/search/suggestions/filters${QS.query(QS.explode({
        albumId,
        city,
        country,
        isFavorite,
        isInAlbum,
        isNotInAlbum,
        lensModel,
        make,
        mediaType,
        model,
        ownerId,
        personIds,
        rating,
        spaceId,
        state,
        tagIds,
        takenAfter,
        takenBefore,
        withSharedSpaces
    }))}`, {
        ...opts
    }));
}
/**
 * Retrieve tag suggestions
 */
export function getTagSuggestions({ spaceId, takenAfter, takenBefore, withSharedSpaces }: {
    spaceId?: string;
    takenAfter?: string;
    takenBefore?: string;
    withSharedSpaces?: boolean;
}, opts?: Oazapfts.RequestOpts) {
    return oazapfts.ok(oazapfts.fetchJson<{
        status: 200;
        data: TagSuggestionResponseDto[];
    }>(`/search/suggestions/tags${QS.query(QS.explode({
        spaceId,
        takenAfter,
        takenBefore,
        withSharedSpaces
    }))}`, {
        ...opts
    }));
}
/**
 * Get server information
 */
export function getAboutInfo(opts?: Oazapfts.RequestOpts) {
    return oazapfts.ok(oazapfts.fetchJson<{
        status: 200;
        data: ServerAboutResponseDto;
    }>("/server/about", {
        ...opts
    }));
}
/**
 * Get APK links
 */
export function getApkLinks(opts?: Oazapfts.RequestOpts) {
    return oazapfts.ok(oazapfts.fetchJson<{
        status: 200;
        data: ServerApkLinksDto;
    }>("/server/apk-links", {
        ...opts
    }));
}
/**
 * Get config
 */
export function getServerConfig(opts?: Oazapfts.RequestOpts) {
    return oazapfts.ok(oazapfts.fetchJson<{
        status: 200;
        data: ServerConfigDto;
    }>("/server/config", {
        ...opts
    }));
}
/**
 * Get features
 */
export function getServerFeatures(opts?: Oazapfts.RequestOpts) {
    return oazapfts.ok(oazapfts.fetchJson<{
        status: 200;
        data: ServerFeaturesDto;
    }>("/server/features", {
        ...opts
    }));
}
/**
 * Delete server product key
 */
export function deleteServerLicense(opts?: Oazapfts.RequestOpts) {
    return oazapfts.ok(oazapfts.fetchText("/server/license", {
        ...opts,
        method: "DELETE"
    }));
}
/**
 * Get product key
 */
export function getServerLicense(opts?: Oazapfts.RequestOpts) {
    return oazapfts.ok(oazapfts.fetchJson<{
        status: 200;
        data: UserLicense;
    } | {
        status: 404;
    }>("/server/license", {
        ...opts
    }));
}
/**
 * Set server product key
 */
export function setServerLicense({ licenseKeyDto }: {
    licenseKeyDto: LicenseKeyDto;
}, opts?: Oazapfts.RequestOpts) {
    return oazapfts.ok(oazapfts.fetchJson<{
        status: 200;
        data: UserLicense;
    }>("/server/license", oazapfts.json({
        ...opts,
        method: "PUT",
        body: licenseKeyDto
    })));
}
/**
 * Get supported media types
 */
export function getSupportedMediaTypes(opts?: Oazapfts.RequestOpts) {
    return oazapfts.ok(oazapfts.fetchJson<{
        status: 200;
        data: ServerMediaTypesResponseDto;
    }>("/server/media-types", {
        ...opts
    }));
}
/**
 * Smart search health
 */
export function getMlHealth(opts?: Oazapfts.RequestOpts) {
    return oazapfts.ok(oazapfts.fetchJson<{
        status: 200;
        data: ServerMlHealthResponseDto;
    }>("/server/ml-health", {
        ...opts
    }));
}
/**
 * Ping
 */
export function pingServer(opts?: Oazapfts.RequestOpts) {
    return oazapfts.ok(oazapfts.fetchJson<{
        status: 200;
        data: ServerPingResponse;
    }>("/server/ping", {
        ...opts
    }));
}
/**
 * Get statistics
 */
export function getServerStatistics(opts?: Oazapfts.RequestOpts) {
    return oazapfts.ok(oazapfts.fetchJson<{
        status: 200;
        data: ServerStatsResponseDto;
    }>("/server/statistics", {
        ...opts
    }));
}
/**
 * Get storage
 */
export function getStorage(opts?: Oazapfts.RequestOpts) {
    return oazapfts.ok(oazapfts.fetchJson<{
        status: 200;
        data: ServerStorageResponseDto;
    }>("/server/storage", {
        ...opts
    }));
}
/**
 * Get server version
 */
export function getServerVersion(opts?: Oazapfts.RequestOpts) {
    return oazapfts.ok(oazapfts.fetchJson<{
        status: 200;
        data: ServerVersionResponseDto;
    }>("/server/version", {
        ...opts
    }));
}
/**
 * Get version check status
 */
export function getVersionCheck(opts?: Oazapfts.RequestOpts) {
    return oazapfts.ok(oazapfts.fetchJson<{
        status: 200;
        data: VersionCheckStateResponseDto;
    }>("/server/version-check", {
        ...opts
    }));
}
/**
 * Get version history
 */
export function getVersionHistory(opts?: Oazapfts.RequestOpts) {
    return oazapfts.ok(oazapfts.fetchJson<{
        status: 200;
        data: ServerVersionHistoryResponseDto[];
    }>("/server/version-history", {
        ...opts
    }));
}
/**
 * Delete all sessions
 */
export function deleteAllSessions(opts?: Oazapfts.RequestOpts) {
    return oazapfts.ok(oazapfts.fetchText("/sessions", {
        ...opts,
        method: "DELETE"
    }));
}
/**
 * Retrieve sessions
 */
export function getSessions(opts?: Oazapfts.RequestOpts) {
    return oazapfts.ok(oazapfts.fetchJson<{
        status: 200;
        data: SessionResponseDto[];
    }>("/sessions", {
        ...opts
    }));
}
/**
 * Create a session
 */
export function createSession({ sessionCreateDto }: {
    sessionCreateDto: SessionCreateDto;
}, opts?: Oazapfts.RequestOpts) {
    return oazapfts.ok(oazapfts.fetchJson<{
        status: 201;
        data: SessionCreateResponseDto;
    }>("/sessions", oazapfts.json({
        ...opts,
        method: "POST",
        body: sessionCreateDto
    })));
}
/**
 * Delete a session
 */
export function deleteSession({ id }: {
    id: string;
}, opts?: Oazapfts.RequestOpts) {
    return oazapfts.ok(oazapfts.fetchText(`/sessions/${encodeURIComponent(id)}`, {
        ...opts,
        method: "DELETE"
    }));
}
/**
 * Update a session
 */
export function updateSession({ id, sessionUpdateDto }: {
    id: string;
    sessionUpdateDto: SessionUpdateDto;
}, opts?: Oazapfts.RequestOpts) {
    return oazapfts.ok(oazapfts.fetchJson<{
        status: 200;
        data: SessionResponseDto;
    }>(`/sessions/${encodeURIComponent(id)}`, oazapfts.json({
        ...opts,
        method: "PUT",
        body: sessionUpdateDto
    })));
}
/**
 * Lock a session
 */
export function lockSession({ id }: {
    id: string;
}, opts?: Oazapfts.RequestOpts) {
    return oazapfts.ok(oazapfts.fetchText(`/sessions/${encodeURIComponent(id)}/lock`, {
        ...opts,
        method: "POST"
    }));
}
/**
 * Retrieve all shared links
 */
export function getAllSharedLinks({ albumId, id }: {
    albumId?: string;
    id?: string;
}, opts?: Oazapfts.RequestOpts) {
    return oazapfts.ok(oazapfts.fetchJson<{
        status: 200;
        data: SharedLinkResponseDto[];
    }>(`/shared-links${QS.query(QS.explode({
        albumId,
        id
    }))}`, {
        ...opts
    }));
}
/**
 * Create a shared link
 */
export function createSharedLink({ sharedLinkCreateDto }: {
    sharedLinkCreateDto: SharedLinkCreateDto;
}, opts?: Oazapfts.RequestOpts) {
    return oazapfts.ok(oazapfts.fetchJson<{
        status: 201;
        data: SharedLinkResponseDto;
    }>("/shared-links", oazapfts.json({
        ...opts,
        method: "POST",
        body: sharedLinkCreateDto
    })));
}
/**
 * Shared link login
 */
export function sharedLinkLogin({ key, slug, sharedLinkLoginDto }: {
    key?: string;
    slug?: string;
    sharedLinkLoginDto: SharedLinkLoginDto;
}, opts?: Oazapfts.RequestOpts) {
    return oazapfts.ok(oazapfts.fetchJson<{
        status: 201;
        data: SharedLinkResponseDto;
    }>(`/shared-links/login${QS.query(QS.explode({
        key,
        slug
    }))}`, oazapfts.json({
        ...opts,
        method: "POST",
        body: sharedLinkLoginDto
    })));
}
/**
 * Retrieve current shared link
 */
export function getMySharedLink({ key, slug }: {
    key?: string;
    slug?: string;
}, opts?: Oazapfts.RequestOpts) {
    return oazapfts.ok(oazapfts.fetchJson<{
        status: 200;
        data: SharedLinkResponseDto;
    }>(`/shared-links/me${QS.query(QS.explode({
        key,
        slug
    }))}`, {
        ...opts
    }));
}
/**
 * Delete a shared link
 */
export function removeSharedLink({ id }: {
    id: string;
}, opts?: Oazapfts.RequestOpts) {
    return oazapfts.ok(oazapfts.fetchText(`/shared-links/${encodeURIComponent(id)}`, {
        ...opts,
        method: "DELETE"
    }));
}
/**
 * Retrieve a shared link
 */
export function getSharedLinkById({ id }: {
    id: string;
}, opts?: Oazapfts.RequestOpts) {
    return oazapfts.ok(oazapfts.fetchJson<{
        status: 200;
        data: SharedLinkResponseDto;
    }>(`/shared-links/${encodeURIComponent(id)}`, {
        ...opts
    }));
}
/**
 * Update a shared link
 */
export function updateSharedLink({ id, sharedLinkEditDto }: {
    id: string;
    sharedLinkEditDto: SharedLinkEditDto;
}, opts?: Oazapfts.RequestOpts) {
    return oazapfts.ok(oazapfts.fetchJson<{
        status: 200;
        data: SharedLinkResponseDto;
    }>(`/shared-links/${encodeURIComponent(id)}`, oazapfts.json({
        ...opts,
        method: "PATCH",
        body: sharedLinkEditDto
    })));
}
/**
 * Remove assets from a shared link
 */
export function removeSharedLinkAssets({ id, assetIdsDto }: {
    id: string;
    assetIdsDto: AssetIdsDto;
}, opts?: Oazapfts.RequestOpts) {
    return oazapfts.ok(oazapfts.fetchJson<{
        status: 200;
        data: AssetIdsResponseDto[];
    }>(`/shared-links/${encodeURIComponent(id)}/assets`, oazapfts.json({
        ...opts,
        method: "DELETE",
        body: assetIdsDto
    })));
}
/**
 * Add assets to a shared link
 */
export function addSharedLinkAssets({ id, assetIdsDto }: {
    id: string;
    assetIdsDto: AssetIdsDto;
}, opts?: Oazapfts.RequestOpts) {
    return oazapfts.ok(oazapfts.fetchJson<{
        status: 200;
        data: AssetIdsResponseDto[];
    }>(`/shared-links/${encodeURIComponent(id)}/assets`, oazapfts.json({
        ...opts,
        method: "PUT",
        body: assetIdsDto
    })));
}
/**
 * Get all shared spaces
 */
export function getAllSpaces(opts?: Oazapfts.RequestOpts) {
    return oazapfts.ok(oazapfts.fetchJson<{
        status: 200;
        data: SharedSpaceResponseDto[];
    }>("/shared-spaces", {
        ...opts
    }));
}
/**
 * Create a shared space
 */
export function createSpace({ sharedSpaceCreateDto }: {
    sharedSpaceCreateDto: SharedSpaceCreateDto;
}, opts?: Oazapfts.RequestOpts) {
    return oazapfts.ok(oazapfts.fetchJson<{
        status: 201;
        data: SharedSpaceResponseDto;
    }>("/shared-spaces", oazapfts.json({
        ...opts,
        method: "POST",
        body: sharedSpaceCreateDto
    })));
}
/**
 * Delete a shared space
 */
export function removeSpace({ id }: {
    id: string;
}, opts?: Oazapfts.RequestOpts) {
    return oazapfts.ok(oazapfts.fetchText(`/shared-spaces/${encodeURIComponent(id)}`, {
        ...opts,
        method: "DELETE"
    }));
}
/**
 * Get a shared space
 */
export function getSpace({ id }: {
    id: string;
}, opts?: Oazapfts.RequestOpts) {
    return oazapfts.ok(oazapfts.fetchJson<{
        status: 200;
        data: SharedSpaceResponseDto;
    }>(`/shared-spaces/${encodeURIComponent(id)}`, {
        ...opts
    }));
}
/**
 * Update a shared space
 */
export function updateSpace({ id, sharedSpaceUpdateDto }: {
    id: string;
    sharedSpaceUpdateDto: SharedSpaceUpdateDto;
}, opts?: Oazapfts.RequestOpts) {
    return oazapfts.ok(oazapfts.fetchJson<{
        status: 200;
        data: SharedSpaceResponseDto;
    }>(`/shared-spaces/${encodeURIComponent(id)}`, oazapfts.json({
        ...opts,
        method: "PATCH",
        body: sharedSpaceUpdateDto
    })));
}
/**
 * Get space activity feed
 */
export function getSpaceActivities({ id, limit, offset }: {
    id: string;
    limit?: number;
    offset?: number;
}, opts?: Oazapfts.RequestOpts) {
    return oazapfts.ok(oazapfts.fetchJson<{
        status: 200;
        data: SharedSpaceActivityResponseDto[];
    }>(`/shared-spaces/${encodeURIComponent(id)}/activities${QS.query(QS.explode({
        limit,
        offset
    }))}`, {
        ...opts
    }));
}
/**
 * List albums linked to a shared space
 */
export function getSharedSpaceAlbums({ id }: {
    id: string;
}, opts?: Oazapfts.RequestOpts) {
    return oazapfts.ok(oazapfts.fetchJson<{
        status: 200;
        data: SharedSpaceLinkedAlbumDto[];
    }>(`/shared-spaces/${encodeURIComponent(id)}/albums`, {
        ...opts
    }));
}
/**
 * Unlink an album from a shared space
 */
export function unlinkAlbum({ albumId, id }: {
    albumId: string;
    id: string;
}, opts?: Oazapfts.RequestOpts) {
    return oazapfts.ok(oazapfts.fetchText(`/shared-spaces/${encodeURIComponent(id)}/albums/${encodeURIComponent(albumId)}`, {
        ...opts,
        method: "DELETE"
    }));
}
/**
 * Update a space-album link (showInTimeline)
 */
export function updateSharedSpaceAlbum({ albumId, id, sharedSpaceAlbumLinkUpdateDto }: {
    albumId: string;
    id: string;
    sharedSpaceAlbumLinkUpdateDto: SharedSpaceAlbumLinkUpdateDto;
}, opts?: Oazapfts.RequestOpts) {
    return oazapfts.ok(oazapfts.fetchText(`/shared-spaces/${encodeURIComponent(id)}/albums/${encodeURIComponent(albumId)}`, oazapfts.json({
        ...opts,
        method: "PATCH",
        body: sharedSpaceAlbumLinkUpdateDto
    })));
}
/**
 * Link an album to a shared space
 */
export function linkAlbum({ albumId, id }: {
    albumId: string;
    id: string;
}, opts?: Oazapfts.RequestOpts) {
    return oazapfts.ok(oazapfts.fetchText(`/shared-spaces/${encodeURIComponent(id)}/albums/${encodeURIComponent(albumId)}`, {
        ...opts,
        method: "PUT"
    }));
}
/**
 * Remove assets from a shared space
 */
export function removeAssets({ id, sharedSpaceAssetRemoveDto }: {
    id: string;
    sharedSpaceAssetRemoveDto: SharedSpaceAssetRemoveDto;
}, opts?: Oazapfts.RequestOpts) {
    return oazapfts.ok(oazapfts.fetchJson<{
        status: 200;
        data: string[];
    }>(`/shared-spaces/${encodeURIComponent(id)}/assets`, oazapfts.json({
        ...opts,
        method: "DELETE",
        body: sharedSpaceAssetRemoveDto
    })));
}
/**
 * Add assets to a shared space
 */
export function addAssets({ id, sharedSpaceAssetAddDto }: {
    id: string;
    sharedSpaceAssetAddDto: SharedSpaceAssetAddDto;
}, opts?: Oazapfts.RequestOpts) {
    return oazapfts.ok(oazapfts.fetchText(`/shared-spaces/${encodeURIComponent(id)}/assets`, oazapfts.json({
        ...opts,
        method: "POST",
        body: sharedSpaceAssetAddDto
    })));
}
/**
 * Add all user assets to a shared space
 */
export function bulkAddAssets({ id }: {
    id: string;
}, opts?: Oazapfts.RequestOpts) {
    return oazapfts.ok(oazapfts.fetchText(`/shared-spaces/${encodeURIComponent(id)}/assets/bulk-add`, {
        ...opts,
        method: "POST"
    }));
}
/**
 * List linked albums that contain the given assets
 */
export function getSharedSpaceAssetLinkedAlbums({ id, sharedSpaceAssetRemoveDto }: {
    id: string;
    sharedSpaceAssetRemoveDto: SharedSpaceAssetRemoveDto;
}, opts?: Oazapfts.RequestOpts) {
    return oazapfts.ok(oazapfts.fetchJson<{
        status: 201;
        data: SharedSpaceAssetLinkedAlbumDto[];
    }>(`/shared-spaces/${encodeURIComponent(id)}/assets/linked-albums`, oazapfts.json({
        ...opts,
        method: "POST",
        body: sharedSpaceAssetRemoveDto
    })));
}
/**
 * Link a library to a shared space
 */
export function linkLibrary({ id, sharedSpaceLibraryLinkDto }: {
    id: string;
    sharedSpaceLibraryLinkDto: SharedSpaceLibraryLinkDto;
}, opts?: Oazapfts.RequestOpts) {
    return oazapfts.ok(oazapfts.fetchText(`/shared-spaces/${encodeURIComponent(id)}/libraries`, oazapfts.json({
        ...opts,
        method: "PUT",
        body: sharedSpaceLibraryLinkDto
    })));
}
/**
 * Unlink a library from a shared space
 */
export function unlinkLibrary({ id, libraryId }: {
    id: string;
    libraryId: string;
}, opts?: Oazapfts.RequestOpts) {
    return oazapfts.ok(oazapfts.fetchText(`/shared-spaces/${encodeURIComponent(id)}/libraries/${encodeURIComponent(libraryId)}`, {
        ...opts,
        method: "DELETE"
    }));
}
/**
 * Get map markers for a shared space
 */
export function getSpaceMapMarkers({ id }: {
    id: string;
}, opts?: Oazapfts.RequestOpts) {
    return oazapfts.ok(oazapfts.fetchJson<{
        status: 200;
        data: MapMarkerResponseDto[];
    }>(`/shared-spaces/${encodeURIComponent(id)}/map-markers`, {
        ...opts
    }));
}
/**
 * Get members of a shared space
 */
export function getMembers({ id }: {
    id: string;
}, opts?: Oazapfts.RequestOpts) {
    return oazapfts.ok(oazapfts.fetchJson<{
        status: 200;
        data: SharedSpaceMemberResponseDto[];
    }>(`/shared-spaces/${encodeURIComponent(id)}/members`, {
        ...opts
    }));
}
/**
 * Add a member to a shared space
 */
export function addMember({ id, sharedSpaceMemberCreateDto }: {
    id: string;
    sharedSpaceMemberCreateDto: SharedSpaceMemberCreateDto;
}, opts?: Oazapfts.RequestOpts) {
    return oazapfts.ok(oazapfts.fetchJson<{
        status: 201;
        data: SharedSpaceMemberResponseDto;
    }>(`/shared-spaces/${encodeURIComponent(id)}/members`, oazapfts.json({
        ...opts,
        method: "POST",
        body: sharedSpaceMemberCreateDto
    })));
}
/**
 * Update current member preferences
 */
export function updateMemberPreferences({ id, sharedSpaceMemberPreferencesDto }: {
    id: string;
    sharedSpaceMemberPreferencesDto: SharedSpaceMemberPreferencesDto;
}, opts?: Oazapfts.RequestOpts) {
    return oazapfts.ok(oazapfts.fetchJson<{
        status: 200;
        data: SharedSpaceMemberResponseDto;
    }>(`/shared-spaces/${encodeURIComponent(id)}/members/me/preferences`, oazapfts.json({
        ...opts,
        method: "PATCH",
        body: sharedSpaceMemberPreferencesDto
    })));
}
/**
 * Update timeline visibility for current member
 */
export function updateMemberTimeline({ id, sharedSpaceMemberTimelineDto }: {
    id: string;
    sharedSpaceMemberTimelineDto: SharedSpaceMemberTimelineDto;
}, opts?: Oazapfts.RequestOpts) {
    return oazapfts.ok(oazapfts.fetchJson<{
        status: 200;
        data: SharedSpaceMemberResponseDto;
    }>(`/shared-spaces/${encodeURIComponent(id)}/members/me/timeline`, oazapfts.json({
        ...opts,
        method: "PATCH",
        body: sharedSpaceMemberTimelineDto
    })));
}
/**
 * Remove a member from a shared space
 */
export function removeMember({ id, userId }: {
    id: string;
    userId: string;
}, opts?: Oazapfts.RequestOpts) {
    return oazapfts.ok(oazapfts.fetchText(`/shared-spaces/${encodeURIComponent(id)}/members/${encodeURIComponent(userId)}`, {
        ...opts,
        method: "DELETE"
    }));
}
/**
 * Update a member in a shared space
 */
export function updateMember({ id, userId, sharedSpaceMemberUpdateDto }: {
    id: string;
    userId: string;
    sharedSpaceMemberUpdateDto: SharedSpaceMemberUpdateDto;
}, opts?: Oazapfts.RequestOpts) {
    return oazapfts.ok(oazapfts.fetchJson<{
        status: 200;
        data: SharedSpaceMemberResponseDto;
    }>(`/shared-spaces/${encodeURIComponent(id)}/members/${encodeURIComponent(userId)}`, oazapfts.json({
        ...opts,
        method: "PATCH",
        body: sharedSpaceMemberUpdateDto
    })));
}
/**
 * Disable member person metadata contribution
 */
export function updateMemberMetadataContribution({ id, userId, sharedSpaceMemberMetadataContributionDto }: {
    id: string;
    userId: string;
    sharedSpaceMemberMetadataContributionDto: SharedSpaceMemberMetadataContributionDto;
}, opts?: Oazapfts.RequestOpts) {
    return oazapfts.ok(oazapfts.fetchJson<{
        status: 200;
        data: SharedSpaceMemberResponseDto;
    }>(`/shared-spaces/${encodeURIComponent(id)}/members/${encodeURIComponent(userId)}/metadata-contribution`, oazapfts.json({
        ...opts,
        method: "PATCH",
        body: sharedSpaceMemberMetadataContributionDto
    })));
}
/**
 * Get people in a shared space
 */
export function getSpacePeople({ id, limit, name, named, offset, takenAfter, takenBefore, withHidden }: {
    id: string;
    limit?: number;
    name?: string;
    named?: boolean;
    offset?: number;
    takenAfter?: string;
    takenBefore?: string;
    withHidden?: boolean;
}, opts?: Oazapfts.RequestOpts) {
    return oazapfts.ok(oazapfts.fetchJson<{
        status: 200;
        data: SharedSpacePersonResponseDto[];
    }>(`/shared-spaces/${encodeURIComponent(id)}/people${QS.query(QS.explode({
        limit,
        name,
        named,
        offset,
        takenAfter,
        takenBefore,
        withHidden
    }))}`, {
        ...opts
    }));
}
/**
 * Deduplicate people in a shared space
 */
export function deduplicateSpacePeople({ id }: {
    id: string;
}, opts?: Oazapfts.RequestOpts) {
    return oazapfts.ok(oazapfts.fetchText(`/shared-spaces/${encodeURIComponent(id)}/people/deduplicate`, {
        ...opts,
        method: "POST"
    }));
}
/**
 * Get people face statistics in a shared space
 */
export function getSpacePeopleFaceStatistics({ id, limit, name, named, offset, takenAfter, takenBefore, withHidden }: {
    id: string;
    limit?: number;
    name?: string;
    named?: boolean;
    offset?: number;
    takenAfter?: string;
    takenBefore?: string;
    withHidden?: boolean;
}, opts?: Oazapfts.RequestOpts) {
    return oazapfts.ok(oazapfts.fetchJson<{
        status: 200;
        data: PeopleFaceStatisticsResponseDto;
    }>(`/shared-spaces/${encodeURIComponent(id)}/people/face-statistics${QS.query(QS.explode({
        limit,
        name,
        named,
        offset,
        takenAfter,
        takenBefore,
        withHidden
    }))}`, {
        ...opts
    }));
}
/**
 * Get people statistics in a shared space
 */
export function getSpacePeopleStatistics({ id, limit, name, named, offset, takenAfter, takenBefore, withHidden }: {
    id: string;
    limit?: number;
    name?: string;
    named?: boolean;
    offset?: number;
    takenAfter?: string;
    takenBefore?: string;
    withHidden?: boolean;
}, opts?: Oazapfts.RequestOpts) {
    return oazapfts.ok(oazapfts.fetchJson<{
        status: 200;
        data: SharedSpacePeopleStatisticsResponseDto;
    }>(`/shared-spaces/${encodeURIComponent(id)}/people/statistics${QS.query(QS.explode({
        limit,
        name,
        named,
        offset,
        takenAfter,
        takenBefore,
        withHidden
    }))}`, {
        ...opts
    }));
}
/**
 * Delete a person from a shared space
 */
export function deleteSpacePerson({ id, personId }: {
    id: string;
    personId: string;
}, opts?: Oazapfts.RequestOpts) {
    return oazapfts.ok(oazapfts.fetchText(`/shared-spaces/${encodeURIComponent(id)}/people/${encodeURIComponent(personId)}`, {
        ...opts,
        method: "DELETE"
    }));
}
/**
 * Get a person in a shared space
 */
export function getSpacePerson({ id, personId }: {
    id: string;
    personId: string;
}, opts?: Oazapfts.RequestOpts) {
    return oazapfts.ok(oazapfts.fetchJson<{
        status: 200;
        data: SharedSpacePersonResponseDto;
    }>(`/shared-spaces/${encodeURIComponent(id)}/people/${encodeURIComponent(personId)}`, {
        ...opts
    }));
}
/**
 * Update a person in a shared space
 */
export function updateSpacePerson({ id, personId, sharedSpacePersonUpdateDto }: {
    id: string;
    personId: string;
    sharedSpacePersonUpdateDto: SharedSpacePersonUpdateDto;
}, opts?: Oazapfts.RequestOpts) {
    return oazapfts.ok(oazapfts.fetchJson<{
        status: 200;
        data: SharedSpacePersonResponseDto;
    }>(`/shared-spaces/${encodeURIComponent(id)}/people/${encodeURIComponent(personId)}`, oazapfts.json({
        ...opts,
        method: "PUT",
        body: sharedSpacePersonUpdateDto
    })));
}
/**
 * Delete a person alias in a shared space
 */
export function deleteSpacePersonAlias({ id, personId }: {
    id: string;
    personId: string;
}, opts?: Oazapfts.RequestOpts) {
    return oazapfts.ok(oazapfts.fetchText(`/shared-spaces/${encodeURIComponent(id)}/people/${encodeURIComponent(personId)}/alias`, {
        ...opts,
        method: "DELETE"
    }));
}
/**
 * Set a person alias in a shared space
 */
export function setSpacePersonAlias({ id, personId, sharedSpacePersonAliasDto }: {
    id: string;
    personId: string;
    sharedSpacePersonAliasDto: SharedSpacePersonAliasDto;
}, opts?: Oazapfts.RequestOpts) {
    return oazapfts.ok(oazapfts.fetchText(`/shared-spaces/${encodeURIComponent(id)}/people/${encodeURIComponent(personId)}/alias`, oazapfts.json({
        ...opts,
        method: "PUT",
        body: sharedSpacePersonAliasDto
    })));
}
/**
 * Get assets for a person in a shared space
 */
export function getSpacePersonAssets({ id, personId }: {
    id: string;
    personId: string;
}, opts?: Oazapfts.RequestOpts) {
    return oazapfts.ok(oazapfts.fetchJson<{
        status: 200;
        data: string[];
    }>(`/shared-spaces/${encodeURIComponent(id)}/people/${encodeURIComponent(personId)}/assets`, {
        ...opts
    }));
}
/**
 * Get face suggestions for a person in a shared space
 */
export function getSpacePersonFaceSuggestions({ id, page, personId, size }: {
    id: string;
    page?: number;
    personId: string;
    size?: number;
}, opts?: Oazapfts.RequestOpts) {
    return oazapfts.ok(oazapfts.fetchJson<{
        status: 200;
        data: PersonFaceSuggestionPageResponseDto;
    }>(`/shared-spaces/${encodeURIComponent(id)}/people/${encodeURIComponent(personId)}/face-suggestions${QS.query(QS.explode({
        page,
        size
    }))}`, {
        ...opts
    }));
}
/**
 * Confirm a face suggestion for a person in a shared space
 */
export function confirmSpacePersonFaceSuggestion({ assetFaceId, id, personId }: {
    assetFaceId: string;
    id: string;
    personId: string;
}, opts?: Oazapfts.RequestOpts) {
    return oazapfts.ok(oazapfts.fetchJson<{
        status: 200;
        data: FaceSuggestionActionResponseDto;
    }>(`/shared-spaces/${encodeURIComponent(id)}/people/${encodeURIComponent(personId)}/face-suggestions/${encodeURIComponent(assetFaceId)}/confirm`, {
        ...opts,
        method: "POST"
    }));
}
/**
 * Dismiss a face suggestion for a person in a shared space
 */
export function dismissSpacePersonFaceSuggestion({ assetFaceId, id, personId }: {
    assetFaceId: string;
    id: string;
    personId: string;
}, opts?: Oazapfts.RequestOpts) {
    return oazapfts.ok(oazapfts.fetchJson<{
        status: 200;
        data: FaceSuggestionActionResponseDto;
    }>(`/shared-spaces/${encodeURIComponent(id)}/people/${encodeURIComponent(personId)}/face-suggestions/${encodeURIComponent(assetFaceId)}/dismiss`, {
        ...opts,
        method: "POST"
    }));
}
/**
 * Ignore a face suggestion for a person in a shared space
 */
export function ignoreSpacePersonFaceSuggestion({ assetFaceId, id, personId }: {
    assetFaceId: string;
    id: string;
    personId: string;
}, opts?: Oazapfts.RequestOpts) {
    return oazapfts.ok(oazapfts.fetchJson<{
        status: 200;
        data: FaceSuggestionActionResponseDto;
    }>(`/shared-spaces/${encodeURIComponent(id)}/people/${encodeURIComponent(personId)}/face-suggestions/${encodeURIComponent(assetFaceId)}/ignore`, {
        ...opts,
        method: "POST"
    }));
}
/**
 * Reject a face suggestion for a person in a shared space
 */
export function rejectSpacePersonFaceSuggestion({ assetFaceId, id, personId }: {
    assetFaceId: string;
    id: string;
    personId: string;
}, opts?: Oazapfts.RequestOpts) {
    return oazapfts.ok(oazapfts.fetchJson<{
        status: 200;
        data: FaceSuggestionActionResponseDto;
    }>(`/shared-spaces/${encodeURIComponent(id)}/people/${encodeURIComponent(personId)}/face-suggestions/${encodeURIComponent(assetFaceId)}/reject`, {
        ...opts,
        method: "POST"
    }));
}
/**
 * Get space person faces
 */
export function getSpacePersonFaces({ id, page, personId, size }: {
    id: string;
    page?: number;
    personId: string;
    size?: number;
}, opts?: Oazapfts.RequestOpts) {
    return oazapfts.ok(oazapfts.fetchJson<{
        status: 200;
        data: PersonFacePageResponseDto;
    }>(`/shared-spaces/${encodeURIComponent(id)}/people/${encodeURIComponent(personId)}/faces${QS.query(QS.explode({
        page,
        size
    }))}`, {
        ...opts
    }));
}
/**
 * Get space person face thumbnail
 */
export function getSpacePersonFaceThumbnail({ faceId, id, personId }: {
    faceId: string;
    id: string;
    personId: string;
}, opts?: Oazapfts.RequestOpts) {
    return oazapfts.ok(oazapfts.fetchBlob<{
        status: 200;
        data: Blob;
    }>(`/shared-spaces/${encodeURIComponent(id)}/people/${encodeURIComponent(personId)}/faces/${encodeURIComponent(faceId)}/thumbnail`, {
        ...opts
    }));
}
/**
 * Merge people in a shared space
 */
export function mergeSpacePeople({ id, personId, sharedSpacePersonMergeDto }: {
    id: string;
    personId: string;
    sharedSpacePersonMergeDto: SharedSpacePersonMergeDto;
}, opts?: Oazapfts.RequestOpts) {
    return oazapfts.ok(oazapfts.fetchText(`/shared-spaces/${encodeURIComponent(id)}/people/${encodeURIComponent(personId)}/merge`, oazapfts.json({
        ...opts,
        method: "POST",
        body: sharedSpacePersonMergeDto
    })));
}
/**
 * Update space person representative face
 */
export function updateSpacePersonRepresentativeFace({ id, personId, spaceRepresentativeFaceUpdateDto }: {
    id: string;
    personId: string;
    spaceRepresentativeFaceUpdateDto: SpaceRepresentativeFaceUpdateDto;
}, opts?: Oazapfts.RequestOpts) {
    return oazapfts.ok(oazapfts.fetchJson<{
        status: 200;
        data: SharedSpacePersonResponseDto;
    }>(`/shared-spaces/${encodeURIComponent(id)}/people/${encodeURIComponent(personId)}/representative-face`, oazapfts.json({
        ...opts,
        method: "PUT",
        body: spaceRepresentativeFaceUpdateDto
    })));
}
/**
 * Get space person statistics
 */
export function getSpacePersonStatistics({ id, personId }: {
    id: string;
    personId: string;
}, opts?: Oazapfts.RequestOpts) {
    return oazapfts.ok(oazapfts.fetchJson<{
        status: 200;
        data: PersonStatisticsResponseDto;
    }>(`/shared-spaces/${encodeURIComponent(id)}/people/${encodeURIComponent(personId)}/statistics`, {
        ...opts
    }));
}
/**
 * Get a space person thumbnail
 */
export function getSpacePersonThumbnail({ id, personId }: {
    id: string;
    personId: string;
}, opts?: Oazapfts.RequestOpts) {
    return oazapfts.ok(oazapfts.fetchBlob<{
        status: 200;
        data: Blob;
    }>(`/shared-spaces/${encodeURIComponent(id)}/people/${encodeURIComponent(personId)}/thumbnail`, {
        ...opts
    }));
}
/**
 * Mark space as viewed
 */
export function markSpaceViewed({ id }: {
    id: string;
}, opts?: Oazapfts.RequestOpts) {
    return oazapfts.ok(oazapfts.fetchText(`/shared-spaces/${encodeURIComponent(id)}/view`, {
        ...opts,
        method: "PATCH"
    }));
}
/**
 * Delete stacks
 */
export function deleteStacks({ bulkIdsDto }: {
    bulkIdsDto: BulkIdsDto;
}, opts?: Oazapfts.RequestOpts) {
    return oazapfts.ok(oazapfts.fetchText("/stacks", oazapfts.json({
        ...opts,
        method: "DELETE",
        body: bulkIdsDto
    })));
}
/**
 * Retrieve stacks
 */
export function searchStacks({ primaryAssetId }: {
    primaryAssetId?: string;
}, opts?: Oazapfts.RequestOpts) {
    return oazapfts.ok(oazapfts.fetchJson<{
        status: 200;
        data: StackResponseDto[];
    }>(`/stacks${QS.query(QS.explode({
        primaryAssetId
    }))}`, {
        ...opts
    }));
}
/**
 * Create a stack
 */
export function createStack({ stackCreateDto }: {
    stackCreateDto: StackCreateDto;
}, opts?: Oazapfts.RequestOpts) {
    return oazapfts.ok(oazapfts.fetchJson<{
        status: 201;
        data: StackResponseDto;
    }>("/stacks", oazapfts.json({
        ...opts,
        method: "POST",
        body: stackCreateDto
    })));
}
/**
 * Delete a stack
 */
export function deleteStack({ id }: {
    id: string;
}, opts?: Oazapfts.RequestOpts) {
    return oazapfts.ok(oazapfts.fetchText(`/stacks/${encodeURIComponent(id)}`, {
        ...opts,
        method: "DELETE"
    }));
}
/**
 * Retrieve a stack
 */
export function getStack({ id }: {
    id: string;
}, opts?: Oazapfts.RequestOpts) {
    return oazapfts.ok(oazapfts.fetchJson<{
        status: 200;
        data: StackResponseDto;
    }>(`/stacks/${encodeURIComponent(id)}`, {
        ...opts
    }));
}
/**
 * Update a stack
 */
export function updateStack({ id, stackUpdateDto }: {
    id: string;
    stackUpdateDto: StackUpdateDto;
}, opts?: Oazapfts.RequestOpts) {
    return oazapfts.ok(oazapfts.fetchJson<{
        status: 200;
        data: StackResponseDto;
    }>(`/stacks/${encodeURIComponent(id)}`, oazapfts.json({
        ...opts,
        method: "PUT",
        body: stackUpdateDto
    })));
}
/**
 * Remove an asset from a stack
 */
export function removeAssetFromStack({ assetId, id }: {
    assetId: string;
    id: string;
}, opts?: Oazapfts.RequestOpts) {
    return oazapfts.ok(oazapfts.fetchText(`/stacks/${encodeURIComponent(id)}/assets/${encodeURIComponent(assetId)}`, {
        ...opts,
        method: "DELETE"
    }));
}
/**
 * Get storage migration estimate
 */
export function getEstimate({ direction }: {
    direction: StorageMigrationDirection;
}, opts?: Oazapfts.RequestOpts) {
    return oazapfts.ok(oazapfts.fetchText(`/storage-migration/estimate${QS.query(QS.explode({
        direction
    }))}`, {
        ...opts
    }));
}
/**
 * Rollback a storage migration batch
 */
export function rollback({ batchId }: {
    batchId: string;
}, opts?: Oazapfts.RequestOpts) {
    return oazapfts.ok(oazapfts.fetchText(`/storage-migration/rollback/${encodeURIComponent(batchId)}`, {
        ...opts,
        method: "POST"
    }));
}
/**
 * Start storage migration
 */
export function start({ storageMigrationStartDto }: {
    storageMigrationStartDto: StorageMigrationStartDto;
}, opts?: Oazapfts.RequestOpts) {
    return oazapfts.ok(oazapfts.fetchText("/storage-migration/start", oazapfts.json({
        ...opts,
        method: "POST",
        body: storageMigrationStartDto
    })));
}
/**
 * Get storage migration status
 */
export function getStatus(opts?: Oazapfts.RequestOpts) {
    return oazapfts.ok(oazapfts.fetchText("/storage-migration/status", {
        ...opts
    }));
}
/**
 * Delete acknowledgements
 */
export function deleteSyncAck({ syncAckDeleteDto }: {
    syncAckDeleteDto: SyncAckDeleteDto;
}, opts?: Oazapfts.RequestOpts) {
    return oazapfts.ok(oazapfts.fetchText("/sync/ack", oazapfts.json({
        ...opts,
        method: "DELETE",
        body: syncAckDeleteDto
    })));
}
/**
 * Retrieve acknowledgements
 */
export function getSyncAck(opts?: Oazapfts.RequestOpts) {
    return oazapfts.ok(oazapfts.fetchJson<{
        status: 200;
        data: SyncAckDto[];
    }>("/sync/ack", {
        ...opts
    }));
}
/**
 * Acknowledge changes
 */
export function sendSyncAck({ syncAckSetDto }: {
    syncAckSetDto: SyncAckSetDto;
}, opts?: Oazapfts.RequestOpts) {
    return oazapfts.ok(oazapfts.fetchText("/sync/ack", oazapfts.json({
        ...opts,
        method: "POST",
        body: syncAckSetDto
    })));
}
/**
 * Stream sync changes
 */
export function getSyncStream({ syncStreamDto }: {
    syncStreamDto: SyncStreamDto;
}, opts?: Oazapfts.RequestOpts) {
    return oazapfts.ok(oazapfts.fetchText("/sync/stream", oazapfts.json({
        ...opts,
        method: "POST",
        body: syncStreamDto
    })));
}
/**
 * Get system configuration
 */
export function getConfig(opts?: Oazapfts.RequestOpts) {
    return oazapfts.ok(oazapfts.fetchJson<{
        status: 200;
        data: SystemConfigDto;
    }>("/system-config", {
        ...opts
    }));
}
/**
 * Update system configuration
 */
export function updateConfig({ systemConfigDto }: {
    systemConfigDto: SystemConfigDto;
}, opts?: Oazapfts.RequestOpts) {
    return oazapfts.ok(oazapfts.fetchJson<{
        status: 200;
        data: SystemConfigDto;
    }>("/system-config", oazapfts.json({
        ...opts,
        method: "PUT",
        body: systemConfigDto
    })));
}
/**
 * Get system configuration defaults
 */
export function getConfigDefaults(opts?: Oazapfts.RequestOpts) {
    return oazapfts.ok(oazapfts.fetchJson<{
        status: 200;
        data: SystemConfigDto;
    }>("/system-config/defaults", {
        ...opts
    }));
}
/**
 * Get storage template options
 */
export function getStorageTemplateOptions(opts?: Oazapfts.RequestOpts) {
    return oazapfts.ok(oazapfts.fetchJson<{
        status: 200;
        data: SystemConfigTemplateStorageOptionDto;
    }>("/system-config/storage-template-options", {
        ...opts
    }));
}
/**
 * Retrieve admin onboarding
 */
export function getAdminOnboarding(opts?: Oazapfts.RequestOpts) {
    return oazapfts.ok(oazapfts.fetchJson<{
        status: 200;
        data: AdminOnboardingUpdateDto;
    }>("/system-metadata/admin-onboarding", {
        ...opts
    }));
}
/**
 * Update admin onboarding
 */
export function updateAdminOnboarding({ adminOnboardingUpdateDto }: {
    adminOnboardingUpdateDto: AdminOnboardingUpdateDto;
}, opts?: Oazapfts.RequestOpts) {
    return oazapfts.ok(oazapfts.fetchText("/system-metadata/admin-onboarding", oazapfts.json({
        ...opts,
        method: "POST",
        body: adminOnboardingUpdateDto
    })));
}
/**
 * Retrieve reverse geocoding state
 */
export function getReverseGeocodingState(opts?: Oazapfts.RequestOpts) {
    return oazapfts.ok(oazapfts.fetchJson<{
        status: 200;
        data: ReverseGeocodingStateResponseDto;
    }>("/system-metadata/reverse-geocoding-state", {
        ...opts
    }));
}
/**
 * Retrieve version check state
 */
export function getVersionCheckState(opts?: Oazapfts.RequestOpts) {
    return oazapfts.ok(oazapfts.fetchJson<{
        status: 200;
        data: VersionCheckStateResponseDto;
    }>("/system-metadata/version-check-state", {
        ...opts
    }));
}
/**
 * Retrieve tags
 */
export function getAllTags(opts?: Oazapfts.RequestOpts) {
    return oazapfts.ok(oazapfts.fetchJson<{
        status: 200;
        data: TagResponseDto[];
    }>("/tags", {
        ...opts
    }));
}
/**
 * Create a tag
 */
export function createTag({ tagCreateDto }: {
    tagCreateDto: TagCreateDto;
}, opts?: Oazapfts.RequestOpts) {
    return oazapfts.ok(oazapfts.fetchJson<{
        status: 201;
        data: TagResponseDto;
    }>("/tags", oazapfts.json({
        ...opts,
        method: "POST",
        body: tagCreateDto
    })));
}
/**
 * Upsert tags
 */
export function upsertTags({ tagUpsertDto }: {
    tagUpsertDto: TagUpsertDto;
}, opts?: Oazapfts.RequestOpts) {
    return oazapfts.ok(oazapfts.fetchJson<{
        status: 200;
        data: TagResponseDto[];
    }>("/tags", oazapfts.json({
        ...opts,
        method: "PUT",
        body: tagUpsertDto
    })));
}
/**
 * Tag assets
 */
export function bulkTagAssets({ tagBulkAssetsDto }: {
    tagBulkAssetsDto: TagBulkAssetsDto;
}, opts?: Oazapfts.RequestOpts) {
    return oazapfts.ok(oazapfts.fetchJson<{
        status: 200;
        data: TagBulkAssetsResponseDto;
    }>("/tags/assets", oazapfts.json({
        ...opts,
        method: "PUT",
        body: tagBulkAssetsDto
    })));
}
/**
 * Delete a tag
 */
export function deleteTag({ id }: {
    id: string;
}, opts?: Oazapfts.RequestOpts) {
    return oazapfts.ok(oazapfts.fetchText(`/tags/${encodeURIComponent(id)}`, {
        ...opts,
        method: "DELETE"
    }));
}
/**
 * Retrieve a tag
 */
export function getTagById({ id }: {
    id: string;
}, opts?: Oazapfts.RequestOpts) {
    return oazapfts.ok(oazapfts.fetchJson<{
        status: 200;
        data: TagResponseDto;
    }>(`/tags/${encodeURIComponent(id)}`, {
        ...opts
    }));
}
/**
 * Update a tag
 */
export function updateTag({ id, tagUpdateDto }: {
    id: string;
    tagUpdateDto: TagUpdateDto;
}, opts?: Oazapfts.RequestOpts) {
    return oazapfts.ok(oazapfts.fetchJson<{
        status: 200;
        data: TagResponseDto;
    }>(`/tags/${encodeURIComponent(id)}`, oazapfts.json({
        ...opts,
        method: "PUT",
        body: tagUpdateDto
    })));
}
/**
 * Untag assets
 */
export function untagAssets({ id, bulkIdsDto }: {
    id: string;
    bulkIdsDto: BulkIdsDto;
}, opts?: Oazapfts.RequestOpts) {
    return oazapfts.ok(oazapfts.fetchJson<{
        status: 200;
        data: BulkIdResponseDto[];
    }>(`/tags/${encodeURIComponent(id)}/assets`, oazapfts.json({
        ...opts,
        method: "DELETE",
        body: bulkIdsDto
    })));
}
/**
 * Tag assets
 */
export function tagAssets({ id, bulkIdsDto }: {
    id: string;
    bulkIdsDto: BulkIdsDto;
}, opts?: Oazapfts.RequestOpts) {
    return oazapfts.ok(oazapfts.fetchJson<{
        status: 200;
        data: BulkIdResponseDto[];
    }>(`/tags/${encodeURIComponent(id)}/assets`, oazapfts.json({
        ...opts,
        method: "PUT",
        body: bulkIdsDto
    })));
}
/**
 * Get time bucket
 */
export function getTimeBucket({ albumId, bbox, bucketSize, city, country, description, isFavorite, isInAlbum, isNotInAlbum, isTrashed, key, lensModel, make, model, ocr, order, orderBy, originalFileName, ownerId, personId, personIds, rating, slug, spaceId, spacePersonId, spacePersonIds, state, tagId, tagIds, takenAfter, takenBefore, timeBucket, $type, userId, visibility, withCoordinates, withPartners, withSharedSpaces, withStacked }: {
    albumId?: string;
    bbox?: string;
    bucketSize?: TimeBucketSize;
    city?: string;
    country?: string;
    description?: string;
    isFavorite?: boolean;
    isInAlbum?: boolean;
    isNotInAlbum?: boolean;
    isTrashed?: boolean;
    key?: string;
    lensModel?: string;
    make?: string;
    model?: string;
    ocr?: string;
    order?: AssetOrder;
    orderBy?: AssetOrderBy;
    originalFileName?: string;
    ownerId?: string;
    personId?: string;
    personIds?: string[];
    rating?: number;
    slug?: string;
    spaceId?: string;
    spacePersonId?: string;
    spacePersonIds?: string[];
    state?: string;
    tagId?: string;
    tagIds?: string[];
    takenAfter?: string;
    takenBefore?: string;
    timeBucket: string;
    $type?: AssetTypeEnum;
    userId?: string;
    visibility?: AssetVisibility;
    withCoordinates?: boolean;
    withPartners?: boolean;
    withSharedSpaces?: boolean;
    withStacked?: boolean;
}, opts?: Oazapfts.RequestOpts) {
    return oazapfts.ok(oazapfts.fetchJson<{
        status: 200;
        data: TimeBucketAssetResponseDto;
    }>(`/timeline/bucket${QS.query(QS.explode({
        albumId,
        bbox,
        bucketSize,
        city,
        country,
        description,
        isFavorite,
        isInAlbum,
        isNotInAlbum,
        isTrashed,
        key,
        lensModel,
        make,
        model,
        ocr,
        order,
        orderBy,
        originalFileName,
        ownerId,
        personId,
        personIds,
        rating,
        slug,
        spaceId,
        spacePersonId,
        spacePersonIds,
        state,
        tagId,
        tagIds,
        takenAfter,
        takenBefore,
        timeBucket,
        "type": $type,
        userId,
        visibility,
        withCoordinates,
        withPartners,
        withSharedSpaces,
        withStacked
    }))}`, {
        ...opts
    }));
}
/**
 * Get time bucket covers
 */
export function getTimeBucketCovers({ albumId, bbox, bucketSize, city, country, description, isFavorite, isInAlbum, isNotInAlbum, isTrashed, key, lensModel, make, model, ocr, order, orderBy, originalFileName, ownerId, personId, personIds, rating, slug, spaceId, spacePersonId, spacePersonIds, state, tagId, tagIds, takenAfter, takenBefore, timeBuckets, $type, userId, visibility, withCoordinates, withPartners, withSharedSpaces, withStacked }: {
    albumId?: string;
    bbox?: string;
    bucketSize?: TimeBucketSize;
    city?: string;
    country?: string;
    description?: string;
    isFavorite?: boolean;
    isInAlbum?: boolean;
    isNotInAlbum?: boolean;
    isTrashed?: boolean;
    key?: string;
    lensModel?: string;
    make?: string;
    model?: string;
    ocr?: string;
    order?: AssetOrder;
    orderBy?: AssetOrderBy;
    originalFileName?: string;
    ownerId?: string;
    personId?: string;
    personIds?: string[];
    rating?: number;
    slug?: string;
    spaceId?: string;
    spacePersonId?: string;
    spacePersonIds?: string[];
    state?: string;
    tagId?: string;
    tagIds?: string[];
    takenAfter?: string;
    takenBefore?: string;
    timeBuckets: string[];
    $type?: AssetTypeEnum;
    userId?: string;
    visibility?: AssetVisibility;
    withCoordinates?: boolean;
    withPartners?: boolean;
    withSharedSpaces?: boolean;
    withStacked?: boolean;
}, opts?: Oazapfts.RequestOpts) {
    return oazapfts.ok(oazapfts.fetchJson<{
        status: 200;
        data: TimeBucketCoverResponseDto[];
    }>(`/timeline/bucket-covers${QS.query(QS.explode({
        albumId,
        bbox,
        bucketSize,
        city,
        country,
        description,
        isFavorite,
        isInAlbum,
        isNotInAlbum,
        isTrashed,
        key,
        lensModel,
        make,
        model,
        ocr,
        order,
        orderBy,
        originalFileName,
        ownerId,
        personId,
        personIds,
        rating,
        slug,
        spaceId,
        spacePersonId,
        spacePersonIds,
        state,
        tagId,
        tagIds,
        takenAfter,
        takenBefore,
        timeBuckets,
        "type": $type,
        userId,
        visibility,
        withCoordinates,
        withPartners,
        withSharedSpaces,
        withStacked
    }))}`, {
        ...opts
    }));
}
/**
 * Get time buckets
 */
export function getTimeBuckets({ albumId, bbox, bucketSize, city, country, description, isFavorite, isInAlbum, isNotInAlbum, isTrashed, key, lensModel, make, model, ocr, order, orderBy, originalFileName, ownerId, personId, personIds, rating, slug, spaceId, spacePersonId, spacePersonIds, state, tagId, tagIds, takenAfter, takenBefore, $type, userId, visibility, withCoordinates, withPartners, withSharedSpaces, withStacked }: {
    albumId?: string;
    bbox?: string;
    bucketSize?: TimeBucketSize;
    city?: string;
    country?: string;
    description?: string;
    isFavorite?: boolean;
    isInAlbum?: boolean;
    isNotInAlbum?: boolean;
    isTrashed?: boolean;
    key?: string;
    lensModel?: string;
    make?: string;
    model?: string;
    ocr?: string;
    order?: AssetOrder;
    orderBy?: AssetOrderBy;
    originalFileName?: string;
    ownerId?: string;
    personId?: string;
    personIds?: string[];
    rating?: number;
    slug?: string;
    spaceId?: string;
    spacePersonId?: string;
    spacePersonIds?: string[];
    state?: string;
    tagId?: string;
    tagIds?: string[];
    takenAfter?: string;
    takenBefore?: string;
    $type?: AssetTypeEnum;
    userId?: string;
    visibility?: AssetVisibility;
    withCoordinates?: boolean;
    withPartners?: boolean;
    withSharedSpaces?: boolean;
    withStacked?: boolean;
}, opts?: Oazapfts.RequestOpts) {
    return oazapfts.ok(oazapfts.fetchJson<{
        status: 200;
        data: TimeBucketsResponseDto[];
    }>(`/timeline/buckets${QS.query(QS.explode({
        albumId,
        bbox,
        bucketSize,
        city,
        country,
        description,
        isFavorite,
        isInAlbum,
        isNotInAlbum,
        isTrashed,
        key,
        lensModel,
        make,
        model,
        ocr,
        order,
        orderBy,
        originalFileName,
        ownerId,
        personId,
        personIds,
        rating,
        slug,
        spaceId,
        spacePersonId,
        spacePersonIds,
        state,
        tagId,
        tagIds,
        takenAfter,
        takenBefore,
        "type": $type,
        userId,
        visibility,
        withCoordinates,
        withPartners,
        withSharedSpaces,
        withStacked
    }))}`, {
        ...opts
    }));
}
/**
 * Empty trash
 */
export function emptyTrash(opts?: Oazapfts.RequestOpts) {
    return oazapfts.ok(oazapfts.fetchJson<{
        status: 200;
        data: TrashResponseDto;
    }>("/trash/empty", {
        ...opts,
        method: "POST"
    }));
}
/**
 * Restore trash
 */
export function restoreTrash(opts?: Oazapfts.RequestOpts) {
    return oazapfts.ok(oazapfts.fetchJson<{
        status: 200;
        data: TrashResponseDto;
    }>("/trash/restore", {
        ...opts,
        method: "POST"
    }));
}
/**
 * Restore assets
 */
export function restoreAssets({ bulkIdsDto }: {
    bulkIdsDto: BulkIdsDto;
}, opts?: Oazapfts.RequestOpts) {
    return oazapfts.ok(oazapfts.fetchJson<{
        status: 200;
        data: TrashResponseDto;
    }>("/trash/restore/assets", oazapfts.json({
        ...opts,
        method: "POST",
        body: bulkIdsDto
    })));
}
/**
 * Get all user groups
 */
export function getAllGroups(opts?: Oazapfts.RequestOpts) {
    return oazapfts.ok(oazapfts.fetchJson<{
        status: 200;
        data: UserGroupResponseDto[];
    }>("/user-groups", {
        ...opts
    }));
}
/**
 * Create a user group
 */
export function createGroup({ userGroupCreateDto }: {
    userGroupCreateDto: UserGroupCreateDto;
}, opts?: Oazapfts.RequestOpts) {
    return oazapfts.ok(oazapfts.fetchJson<{
        status: 201;
        data: UserGroupResponseDto;
    }>("/user-groups", oazapfts.json({
        ...opts,
        method: "POST",
        body: userGroupCreateDto
    })));
}
/**
 * Delete a user group
 */
export function removeGroup({ id }: {
    id: string;
}, opts?: Oazapfts.RequestOpts) {
    return oazapfts.ok(oazapfts.fetchText(`/user-groups/${encodeURIComponent(id)}`, {
        ...opts,
        method: "DELETE"
    }));
}
/**
 * Get a user group
 */
export function getGroup({ id }: {
    id: string;
}, opts?: Oazapfts.RequestOpts) {
    return oazapfts.ok(oazapfts.fetchJson<{
        status: 200;
        data: UserGroupResponseDto;
    }>(`/user-groups/${encodeURIComponent(id)}`, {
        ...opts
    }));
}
/**
 * Update a user group
 */
export function updateGroup({ id, userGroupUpdateDto }: {
    id: string;
    userGroupUpdateDto: UserGroupUpdateDto;
}, opts?: Oazapfts.RequestOpts) {
    return oazapfts.ok(oazapfts.fetchJson<{
        status: 200;
        data: UserGroupResponseDto;
    }>(`/user-groups/${encodeURIComponent(id)}`, oazapfts.json({
        ...opts,
        method: "PATCH",
        body: userGroupUpdateDto
    })));
}
/**
 * Set group members
 */
export function setMembers({ id, userGroupMemberSetDto }: {
    id: string;
    userGroupMemberSetDto: UserGroupMemberSetDto;
}, opts?: Oazapfts.RequestOpts) {
    return oazapfts.ok(oazapfts.fetchJson<{
        status: 200;
        data: UserGroupMemberResponseDto[];
    }>(`/user-groups/${encodeURIComponent(id)}/members`, oazapfts.json({
        ...opts,
        method: "PUT",
        body: userGroupMemberSetDto
    })));
}
/**
 * Get all users
 */
export function searchUsers(opts?: Oazapfts.RequestOpts) {
    return oazapfts.ok(oazapfts.fetchJson<{
        status: 200;
        data: UserResponseDto[];
    }>("/users", {
        ...opts
    }));
}
/**
 * Get current user
 */
export function getMyUser(opts?: Oazapfts.RequestOpts) {
    return oazapfts.ok(oazapfts.fetchJson<{
        status: 200;
        data: UserAdminResponseDto;
    }>("/users/me", {
        ...opts
    }));
}
/**
 * Update current user
 */
export function updateMyUser({ userUpdateMeDto }: {
    userUpdateMeDto: UserUpdateMeDto;
}, opts?: Oazapfts.RequestOpts) {
    return oazapfts.ok(oazapfts.fetchJson<{
        status: 200;
        data: UserAdminResponseDto;
    }>("/users/me", oazapfts.json({
        ...opts,
        method: "PUT",
        body: userUpdateMeDto
    })));
}
/**
 * Retrieve calendar heatmap activity
 */
export function getMyCalendarHeatmap({ $from, to, $type }: {
    $from?: string;
    to?: string;
    $type?: CalendarHeatmapType;
}, opts?: Oazapfts.RequestOpts) {
    return oazapfts.ok(oazapfts.fetchJson<{
        status: 200;
        data: CalendarHeatmapResponseDto;
    }>(`/users/me/calendar-heatmap${QS.query(QS.explode({
        "from": $from,
        to,
        "type": $type
    }))}`, {
        ...opts
    }));
}
/**
 * Delete user product key
 */
export function deleteUserLicense(opts?: Oazapfts.RequestOpts) {
    return oazapfts.ok(oazapfts.fetchText("/users/me/license", {
        ...opts,
        method: "DELETE"
    }));
}
/**
 * Retrieve user product key
 */
export function getUserLicense(opts?: Oazapfts.RequestOpts) {
    return oazapfts.ok(oazapfts.fetchJson<{
        status: 200;
        data: UserLicense;
    }>("/users/me/license", {
        ...opts
    }));
}
/**
 * Set user product key
 */
export function setUserLicense({ licenseKeyDto }: {
    licenseKeyDto: LicenseKeyDto;
}, opts?: Oazapfts.RequestOpts) {
    return oazapfts.ok(oazapfts.fetchJson<{
        status: 200;
        data: UserLicense;
    }>("/users/me/license", oazapfts.json({
        ...opts,
        method: "PUT",
        body: licenseKeyDto
    })));
}
/**
 * Delete user onboarding
 */
export function deleteUserOnboarding(opts?: Oazapfts.RequestOpts) {
    return oazapfts.ok(oazapfts.fetchText("/users/me/onboarding", {
        ...opts,
        method: "DELETE"
    }));
}
/**
 * Retrieve user onboarding
 */
export function getUserOnboarding(opts?: Oazapfts.RequestOpts) {
    return oazapfts.ok(oazapfts.fetchJson<{
        status: 200;
        data: OnboardingResponseDto;
    }>("/users/me/onboarding", {
        ...opts
    }));
}
/**
 * Update user onboarding
 */
export function setUserOnboarding({ onboardingDto }: {
    onboardingDto: OnboardingDto;
}, opts?: Oazapfts.RequestOpts) {
    return oazapfts.ok(oazapfts.fetchJson<{
        status: 200;
        data: OnboardingResponseDto;
    }>("/users/me/onboarding", oazapfts.json({
        ...opts,
        method: "PUT",
        body: onboardingDto
    })));
}
/**
 * Get my preferences
 */
export function getMyPreferences(opts?: Oazapfts.RequestOpts) {
    return oazapfts.ok(oazapfts.fetchJson<{
        status: 200;
        data: UserPreferencesResponseDto;
    }>("/users/me/preferences", {
        ...opts
    }));
}
/**
 * Update my preferences
 */
export function updateMyPreferences({ userPreferencesUpdateDto }: {
    userPreferencesUpdateDto: UserPreferencesUpdateDto;
}, opts?: Oazapfts.RequestOpts) {
    return oazapfts.ok(oazapfts.fetchJson<{
        status: 200;
        data: UserPreferencesResponseDto;
    }>("/users/me/preferences", oazapfts.json({
        ...opts,
        method: "PUT",
        body: userPreferencesUpdateDto
    })));
}
/**
 * Delete user profile image
 */
export function deleteProfileImage(opts?: Oazapfts.RequestOpts) {
    return oazapfts.ok(oazapfts.fetchText("/users/profile-image", {
        ...opts,
        method: "DELETE"
    }));
}
/**
 * Create user profile image
 */
export function createProfileImage({ createProfileImageDto }: {
    createProfileImageDto: CreateProfileImageDto;
}, opts?: Oazapfts.RequestOpts) {
    return oazapfts.ok(oazapfts.fetchJson<{
        status: 201;
        data: CreateProfileImageResponseDto;
    }>("/users/profile-image", oazapfts.multipart({
        ...opts,
        method: "POST",
        body: createProfileImageDto
    })));
}
/**
 * Retrieve a user
 */
export function getUser({ id }: {
    id: string;
}, opts?: Oazapfts.RequestOpts) {
    return oazapfts.ok(oazapfts.fetchJson<{
        status: 200;
        data: UserResponseDto;
    }>(`/users/${encodeURIComponent(id)}`, {
        ...opts
    }));
}
/**
 * Retrieve user profile image
 */
export function getProfileImage({ id }: {
    id: string;
}, opts?: Oazapfts.RequestOpts) {
    return oazapfts.ok(oazapfts.fetchBlob<{
        status: 200;
        data: Blob;
    }>(`/users/${encodeURIComponent(id)}/profile-image`, {
        ...opts
    }));
}
/**
 * Retrieve assets by original path
 */
export function getAssetsByOriginalPath({ path }: {
    path: string;
}, opts?: Oazapfts.RequestOpts) {
    return oazapfts.ok(oazapfts.fetchJson<{
        status: 200;
        data: AssetResponseDto[];
    }>(`/view/folder${QS.query(QS.explode({
        path
    }))}`, {
        ...opts
    }));
}
/**
 * Retrieve unique paths
 */
export function getUniqueOriginalPaths(opts?: Oazapfts.RequestOpts) {
    return oazapfts.ok(oazapfts.fetchJson<{
        status: 200;
        data: string[];
    }>("/view/folder/unique-paths", {
        ...opts
    }));
}
/**
 * List all workflows
 */
export function searchWorkflows({ description, enabled, id, name, trigger }: {
    description?: string;
    enabled?: boolean;
    id?: string;
    name?: string;
    trigger?: WorkflowTrigger;
}, opts?: Oazapfts.RequestOpts) {
    return oazapfts.ok(oazapfts.fetchJson<{
        status: 200;
        data: WorkflowResponseDto[];
    }>(`/workflows${QS.query(QS.explode({
        description,
        enabled,
        id,
        name,
        trigger
    }))}`, {
        ...opts
    }));
}
/**
 * Create a workflow
 */
export function createWorkflow({ workflowCreateDto }: {
    workflowCreateDto: WorkflowCreateDto;
}, opts?: Oazapfts.RequestOpts) {
    return oazapfts.ok(oazapfts.fetchJson<{
        status: 201;
        data: WorkflowResponseDto;
    }>("/workflows", oazapfts.json({
        ...opts,
        method: "POST",
        body: workflowCreateDto
    })));
}
/**
 * List all workflow triggers
 */
export function getWorkflowTriggers(opts?: Oazapfts.RequestOpts) {
    return oazapfts.ok(oazapfts.fetchJson<{
        status: 200;
        data: WorkflowTriggerResponseDto[];
    }>("/workflows/triggers", {
        ...opts
    }));
}
/**
 * Delete a workflow
 */
export function deleteWorkflow({ id }: {
    id: string;
}, opts?: Oazapfts.RequestOpts) {
    return oazapfts.ok(oazapfts.fetchText(`/workflows/${encodeURIComponent(id)}`, {
        ...opts,
        method: "DELETE"
    }));
}
/**
 * Retrieve a workflow
 */
export function getWorkflow({ id }: {
    id: string;
}, opts?: Oazapfts.RequestOpts) {
    return oazapfts.ok(oazapfts.fetchJson<{
        status: 200;
        data: WorkflowResponseDto;
    }>(`/workflows/${encodeURIComponent(id)}`, {
        ...opts
    }));
}
/**
 * Update a workflow
 */
export function updateWorkflow({ id, workflowUpdateDto }: {
    id: string;
    workflowUpdateDto: WorkflowUpdateDto;
}, opts?: Oazapfts.RequestOpts) {
    return oazapfts.ok(oazapfts.fetchJson<{
        status: 200;
        data: WorkflowResponseDto;
    }>(`/workflows/${encodeURIComponent(id)}`, oazapfts.json({
        ...opts,
        method: "PUT",
        body: workflowUpdateDto
    })));
}
/**
 * Retrieve a workflow
 */
export function getWorkflowForShare({ id }: {
    id: string;
}, opts?: Oazapfts.RequestOpts) {
    return oazapfts.ok(oazapfts.fetchJson<{
        status: 200;
        data: WorkflowShareResponseDto;
    }>(`/workflows/${encodeURIComponent(id)}/share`, {
        ...opts
    }));
}
export enum ReactionLevel {
    Album = "album",
    Asset = "asset"
}
export enum ReactionType {
    Comment = "comment",
    Like = "like"
}
export enum UserAvatarColor {
    Primary = "primary",
    Pink = "pink",
    Red = "red",
    Yellow = "yellow",
    Blue = "blue",
    Green = "green",
    Purple = "purple",
    Orange = "orange",
    Gray = "gray",
    Amber = "amber"
}
export enum IntegrityReport {
    UntrackedFile = "untracked_file",
    MissingFile = "missing_file",
    ChecksumMismatch = "checksum_mismatch"
}
export enum MaintenanceAction {
    Start = "start",
    End = "end",
    SelectDatabaseRestore = "select_database_restore",
    RestoreDatabase = "restore_database"
}
export enum StorageFolder {
    EncodedVideo = "encoded-video",
    Library = "library",
    Upload = "upload",
    Profile = "profile",
    Thumbs = "thumbs",
    Backups = "backups"
}
export enum NotificationLevel {
    Success = "success",
    Error = "error",
    Warning = "warning",
    Info = "info"
}
export enum NotificationType {
    JobFailed = "JobFailed",
    BackupFailed = "BackupFailed",
    SystemMessage = "SystemMessage",
    AlbumInvite = "AlbumInvite",
    AlbumUpdate = "AlbumUpdate",
    Custom = "Custom"
}
export enum UserStatus {
    Active = "active",
    Removing = "removing",
    Deleted = "deleted"
}
export enum CalendarHeatmapType {
    Upload = "Upload",
    Taken = "Taken"
}
export enum ChecksumAlgorithm {
    Sha1 = "sha1",
    Sha1Path = "sha1-path"
}
export enum AssetTypeEnum {
    Image = "IMAGE",
    Video = "VIDEO",
    Audio = "AUDIO",
    Other = "OTHER"
}
export enum AssetOrder {
    Asc = "asc",
    Desc = "desc"
}
export enum AssetVisibility {
    Archive = "archive",
    Timeline = "timeline",
    Hidden = "hidden",
    Locked = "locked"
}
export enum ProviderType {
    Openai = "openai",
    Anthropic = "anthropic",
    OpenaiCompatible = "openai-compatible"
}
export enum AgentRunnerStatusReason {
    NotConfigured = "not-configured",
    Healthy = "healthy",
    Unhealthy = "unhealthy",
    Timeout = "timeout",
    InvalidResponse = "invalid-response"
}
export enum AgentApprovalMode {
    Strict = "strict",
    AskOnEscalation = "ask-on-escalation",
    PlanOnly = "plan-only",
    DangerouslySkipPermissions = "dangerously-skip-permissions"
}
export enum AgentProviderType {
    Openai = "openai",
    Anthropic = "anthropic",
    OpenaiCompatible = "openai-compatible"
}
export enum AgentPermissionPreset {
    Careful = "careful",
    VisualOrganizer = "visual-organizer",
    LocalPowerUser = "local-power-user",
    Custom = "custom"
}
export enum AgentSessionStatus {
    Created = "created",
    Running = "running",
    WaitingForToolApproval = "waiting_for_tool_approval",
    WaitingForPlanReview = "waiting_for_plan_review",
    Applying = "applying",
    Completed = "completed",
    Cancelled = "cancelled",
    Interrupted = "interrupted",
    Failed = "failed"
}
export enum Kind {
    StartProcessing = "start-processing",
    PlanComposing = "plan-composing",
    ApplyProgress = "apply-progress",
    RunnerRecovery = "runner-recovery",
    StrictRouterDecision = "strict_router_decision",
    StrictWorkflowOutcome = "strict_workflow_outcome",
    StrictSuccessGateBlock = "strict_success_gate_block",
    StrictContinuation = "strict_continuation",
    Unknown = "unknown"
}
export enum AgentSessionActivityEventSource {
    Server = "server",
    Runner = "runner"
}
export enum AgentSessionActivityEventStatus {
    Running = "running",
    Completed = "completed",
    Failed = "failed",
    Skipped = "skipped"
}
export enum AgentMessageTextBlockType {
    Text = "text"
}
export enum AgentMessageToolCallBlockType {
    ToolCall = "tool-call"
}
export enum AgentMessageAssetBlockType {
    Asset = "asset"
}
export enum AgentMessagePlanBlockType {
    Plan = "plan"
}
export enum Kind2 {
    Person = "person",
    Tag = "tag",
    Album = "album",
    Space = "space",
    CameraMake = "cameraMake",
    CameraModel = "cameraModel",
    LensModel = "lensModel"
}
export enum AgentMessageClarificationBlockType {
    Clarification = "clarification"
}
export enum AgentMessageRole {
    User = "user",
    Assistant = "assistant",
    System = "system",
    Tool = "tool"
}
export enum AgentOperationReviewMetadataValueKind {
    Known = "known",
    Empty = "empty",
    Clear = "clear",
    Relative = "relative",
    Unknown = "unknown"
}
export enum AgentOperationRiskLevel {
    Low = "low",
    Medium = "medium",
    High = "high"
}
export enum AgentOperationStatus {
    Proposed = "proposed",
    Applied = "applied",
    Skipped = "skipped",
    Failed = "failed"
}
export enum AgentOperationTargetKind {
    NewAlbum = "new_album",
    ExistingAlbum = "existing_album",
    NewSpace = "new_space",
    ExistingSpace = "existing_space",
    AssetBatch = "asset_batch",
    ImageEditBatch = "image_edit_batch",
    Person = "person"
}
export enum AgentOperationType {
    AlbumCreate = "album.create",
    AlbumAddAssets = "album.addAssets",
    AlbumRemoveAssets = "album.removeAssets",
    AlbumUpdateDetails = "album.updateDetails",
    AlbumSetCover = "album.setCover",
    AlbumAddUsers = "album.addUsers",
    AlbumRemoveUsers = "album.removeUsers",
    AlbumUpdateUserRole = "album.updateUserRole",
    AlbumDelete = "album.delete",
    SpaceCreate = "space.create",
    SpaceAddAssets = "space.addAssets",
    SpaceRemoveAssets = "space.removeAssets",
    SpaceUpdateDetails = "space.updateDetails",
    SpaceAddMembers = "space.addMembers",
    SpaceRemoveMembers = "space.removeMembers",
    SpaceUpdateMemberRole = "space.updateMemberRole",
    SpaceDelete = "space.delete",
    AssetRotate = "asset.rotate",
    AssetCrop = "asset.crop",
    AssetAdjust = "asset.adjust",
    AssetFlip = "asset.flip",
    AssetStack = "asset.stack",
    AssetUnstack = "asset.unstack",
    AssetSetFavorite = "asset.setFavorite",
    AssetSetArchive = "asset.setArchive",
    AssetSetVisibility = "asset.setVisibility",
    AssetUpdateMetadata = "asset.updateMetadata",
    AssetAddTag = "asset.addTag",
    AssetRemoveTag = "asset.removeTag",
    AssetTrash = "asset.trash",
    AssetRestore = "asset.restore",
    ShareLinkCreate = "shareLink.create",
    ShareLinkCreateAlbum = "shareLink.createAlbum",
    PersonUpdate = "person.update",
    PersonMerge = "person.merge"
}
export enum AgentOperationPlanStatus {
    Proposed = "proposed",
    Superseded = "superseded",
    Applied = "applied",
    Cancelled = "cancelled"
}
export enum AgentAlbumCreateOperationType {
    AlbumCreate = "album.create"
}
export enum AgentOperationNewAlbumTargetKind {
    NewAlbum = "new_album"
}
export enum AgentAlbumAddAssetsOperationType {
    AlbumAddAssets = "album.addAssets"
}
export enum AgentDeclarativeNameMatch {
    Any = "any",
    All = "all"
}
export enum Kind3 {
    Search = "search"
}
export enum Materialization {
    BoundedPage = "bounded-page",
    AllMatchesWithLimit = "all-matches-with-limit"
}
export enum Mode {
    Metadata = "metadata",
    Smart = "smart",
    Description = "description",
    Ocr = "ocr",
    Filename = "filename"
}
export enum Order {
    Asc = "asc",
    Desc = "desc",
    Relevance = "relevance"
}
export enum Kind4 {
    PreviousSearch = "previousSearch"
}
export enum Kind5 {
    SelectionHandle = "selectionHandle"
}
export enum Kind6 {
    ExplicitAssets = "explicitAssets"
}
export enum AgentAlbumRemoveAssetsOperationType {
    AlbumRemoveAssets = "album.removeAssets"
}
export enum AgentAlbumUpdateDetailsOperationType {
    AlbumUpdateDetails = "album.updateDetails"
}
export enum AgentOperationExistingAlbumTargetKind {
    ExistingAlbum = "existing_album"
}
export enum AgentAlbumSetCoverOperationType {
    AlbumSetCover = "album.setCover"
}
export enum AgentSpaceCreateOperationType {
    SpaceCreate = "space.create"
}
export enum AgentOperationNewSpaceTargetKind {
    NewSpace = "new_space"
}
export enum Type {
    SpaceAddAssets = "space.addAssets"
}
export enum Type2 {
    SpaceRemoveAssets = "space.removeAssets"
}
export enum AgentSpaceUpdateDetailsOperationType {
    SpaceUpdateDetails = "space.updateDetails"
}
export enum AgentOperationExistingSpaceTargetKind {
    ExistingSpace = "existing_space"
}
export enum AgentSpaceAddMembersOperationType {
    SpaceAddMembers = "space.addMembers"
}
export enum AgentAssignableSharedSpaceMemberRole {
    Editor = "editor",
    Viewer = "viewer"
}
export enum AgentSpaceRemoveMembersOperationType {
    SpaceRemoveMembers = "space.removeMembers"
}
export enum AgentSpaceUpdateMemberRoleOperationType {
    SpaceUpdateMemberRole = "space.updateMemberRole"
}
export enum AgentAlbumAddUsersOperationType {
    AlbumAddUsers = "album.addUsers"
}
export enum AgentAssignableAlbumUserRole {
    Editor = "editor",
    Viewer = "viewer"
}
export enum AgentAlbumRemoveUsersOperationType {
    AlbumRemoveUsers = "album.removeUsers"
}
export enum AgentAlbumUpdateUserRoleOperationType {
    AlbumUpdateUserRole = "album.updateUserRole"
}
export enum AgentAlbumDeleteOperationType {
    AlbumDelete = "album.delete"
}
export enum AgentSpaceDeleteOperationType {
    SpaceDelete = "space.delete"
}
export enum AgentAssetRotateOperationType {
    AssetRotate = "asset.rotate"
}
export enum AgentAssetCropOperationType {
    AssetCrop = "asset.crop"
}
export enum AgentAssetAdjustOperationType {
    AssetAdjust = "asset.adjust"
}
export enum Brightness {
    StrongDecrease = "strong_decrease",
    ModerateDecrease = "moderate_decrease",
    SlightDecrease = "slight_decrease",
    SlightIncrease = "slight_increase",
    ModerateIncrease = "moderate_increase",
    StrongIncrease = "strong_increase"
}
export enum Contrast {
    StrongDecrease = "strong_decrease",
    ModerateDecrease = "moderate_decrease",
    SlightDecrease = "slight_decrease",
    SlightIncrease = "slight_increase",
    ModerateIncrease = "moderate_increase",
    StrongIncrease = "strong_increase"
}
export enum Saturation {
    StrongDecrease = "strong_decrease",
    ModerateDecrease = "moderate_decrease",
    SlightDecrease = "slight_decrease",
    SlightIncrease = "slight_increase",
    ModerateIncrease = "moderate_increase",
    StrongIncrease = "strong_increase"
}
export enum AgentAssetFlipOperationType {
    AssetFlip = "asset.flip"
}
export enum Axis {
    Horizontal = "horizontal",
    Vertical = "vertical"
}
export enum AgentAssetSetFavoriteOperationType {
    AssetSetFavorite = "asset.setFavorite"
}
export enum AgentAssetSetArchiveOperationType {
    AssetSetArchive = "asset.setArchive"
}
export enum AgentAssetSetVisibilityOperationType {
    AssetSetVisibility = "asset.setVisibility"
}
export enum Visibility {
    Locked = "locked"
}
export enum AgentAssetUpdateMetadataOperationType {
    AssetUpdateMetadata = "asset.updateMetadata"
}
export enum AgentAssetUpdateMetadataTargetKind {
    AssetBatch = "asset_batch"
}
export enum AgentAssetAddTagOperationType {
    AssetAddTag = "asset.addTag"
}
export enum AgentAssetRemoveTagOperationType {
    AssetRemoveTag = "asset.removeTag"
}
export enum AgentAssetTrashOperationType {
    AssetTrash = "asset.trash"
}
export enum AgentAssetRestoreOperationType {
    AssetRestore = "asset.restore"
}
export enum AgentAssetStackOperationType {
    AssetStack = "asset.stack"
}
export enum AgentAssetUnstackOperationType {
    AssetUnstack = "asset.unstack"
}
export enum AgentShareLinkCreateOperationType {
    ShareLinkCreate = "shareLink.create"
}
export enum AgentShareLinkCreateAlbumOperationType {
    ShareLinkCreateAlbum = "shareLink.createAlbum"
}
export enum AgentPersonUpdateOperationType {
    PersonUpdate = "person.update"
}
export enum AgentOperationPersonTargetKind {
    Person = "person"
}
export enum AgentPersonMergeOperationType {
    PersonMerge = "person.merge"
}
export enum Status {
    Success = "success"
}
export enum AgentToolApprovalDecision {
    Approved = "approved",
    Denied = "denied"
}
export enum AgentToolDataClass {
    Metadata = "metadata",
    Previews = "previews",
    Originals = "originals",
    Plan = "plan"
}
export enum AgentToolCallStatus {
    PendingApproval = "pending_approval",
    Approved = "approved",
    Executing = "executing",
    Denied = "denied",
    Completed = "completed",
    Failed = "failed"
}
export enum AgentToolName {
    SearchAssets = "searchAssets",
    FindTripCandidates = "findTripCandidates",
    ReadSelectionMetadata = "readSelectionMetadata",
    CurateSelection = "curateSelection",
    ResolveAssetSearchFilters = "resolveAssetSearchFilters",
    ResolveLocation = "resolveLocation",
    SearchPeople = "searchPeople",
    ReadAssetMetadata = "readAssetMetadata",
    ReadAssetPreviews = "readAssetPreviews",
    ReadAssetOriginals = "readAssetOriginals",
    ListAlbums = "listAlbums",
    ReadAlbum = "readAlbum",
    ListSpaces = "listSpaces",
    ListDuplicateGroups = "listDuplicateGroups",
    ReadSpace = "readSpace",
    SearchUsers = "searchUsers",
    ProposeAlbumOperations = "proposeAlbumOperations",
    ProposeAlbumFromSearch = "proposeAlbumFromSearch",
    ProposeAlbumFromSelection = "proposeAlbumFromSelection",
    ProposeAddAssetsToAlbumFromSearch = "proposeAddAssetsToAlbumFromSearch",
    ProposeSpaceFromSearch = "proposeSpaceFromSearch",
    ProposeAddAssetsToSpaceFromSearch = "proposeAddAssetsToSpaceFromSearch",
    ProposeAssetBatchFromSearch = "proposeAssetBatchFromSearch",
    ProposeAssetBatchFromSelection = "proposeAssetBatchFromSelection",
    ReviseProposedOperations = "reviseProposedOperations",
    SummarizePlan = "summarizePlan"
}
export enum AgentOperationItemKind {
    Asset = "asset",
    Album = "album",
    Space = "space",
    Person = "person",
    Tag = "tag"
}
export enum Mode2 {
    All = "all"
}
export enum Mode3 {
    AllExcept = "allExcept"
}
export enum Mode4 {
    Only = "only"
}
export enum Mode5 {
    None = "none"
}
export enum AgentOperationApplyStatus {
    Applied = "applied",
    PartiallyApplied = "partially_applied",
    Failed = "failed"
}
export enum Type3 {
    SpaceAddAssets = "space.addAssets"
}
export enum Type4 {
    SpaceRemoveAssets = "space.removeAssets"
}
export enum Status2 {
    ApprovalRequired = "approval-required"
}
export enum Status3 {
    Denied = "denied"
}
export enum AgentTripCandidateConfidence {
    High = "high",
    Medium = "medium",
    Low = "low"
}
export enum AgentTripCandidateUseTopRecommendationAction {
    UseTopCandidate = "use_top_candidate"
}
export enum AgentTripCandidateNonAutoRecommendationAction {
    AskUser = "ask_user",
    None = "none"
}
export enum Status4 {
    Success = "success"
}
export enum Status5 {
    ApprovalRequired = "approval-required"
}
export enum Status6 {
    Denied = "denied"
}
export enum Status7 {
    Success = "success"
}
export enum Status8 {
    ApprovalRequired = "approval-required"
}
export enum Status9 {
    Denied = "denied"
}
export enum Status10 {
    Success = "success"
}
export enum Status11 {
    ApprovalRequired = "approval-required"
}
export enum Status12 {
    Denied = "denied"
}
export enum Status13 {
    Success = "success"
}
export enum Status14 {
    ApprovalRequired = "approval-required"
}
export enum Status15 {
    Denied = "denied"
}
export enum Status16 {
    Success = "success"
}
export enum AgentAssetMetadataDetail {
    Basic = "basic",
    Descriptive = "descriptive",
    Technical = "technical",
    AllSafe = "allSafe"
}
export enum AgentAssetMetadataField {
    Type = "type",
    Dates = "dates",
    Location = "location",
    Camera = "camera",
    Tags = "tags",
    Rating = "rating",
    Filename = "filename",
    Favorite = "favorite",
    Visibility = "visibility",
    Quality = "quality"
}
export enum Status17 {
    ApprovalRequired = "approval-required"
}
export enum Status18 {
    Denied = "denied"
}
export enum Status19 {
    Success = "success"
}
export enum Status20 {
    ApprovalRequired = "approval-required"
}
export enum Status21 {
    Denied = "denied"
}
export enum Status22 {
    Success = "success"
}
export enum Status23 {
    ApprovalRequired = "approval-required"
}
export enum Status24 {
    Denied = "denied"
}
export enum Status25 {
    Success = "success"
}
export enum Status26 {
    ApprovalRequired = "approval-required"
}
export enum Status27 {
    Denied = "denied"
}
export enum Status28 {
    Success = "success"
}
export enum AgentSearchAssetsRequestDetail {
    Ids = "ids",
    Handle = "handle",
    Summary = "summary",
    Metadata = "metadata"
}
export enum AgentSearchAssetsField {
    Type = "type",
    Dates = "dates",
    Location = "location",
    Camera = "camera",
    Tags = "tags",
    Rating = "rating",
    Filename = "filename",
    Favorite = "favorite",
    Visibility = "visibility"
}
export enum AgentSearchAssetsMode {
    Metadata = "metadata",
    Smart = "smart",
    Description = "description",
    Ocr = "ocr",
    Filename = "filename"
}
export enum AgentSearchAssetsOrder {
    Asc = "asc",
    Desc = "desc",
    Relevance = "relevance"
}
export enum Status29 {
    ApprovalRequired = "approval-required"
}
export enum Status30 {
    Denied = "denied"
}
export enum AgentSearchAssetsDetail {
    Handle = "handle",
    Summary = "summary",
    Metadata = "metadata"
}
export enum Status31 {
    Success = "success"
}
export enum Status32 {
    ApprovalRequired = "approval-required"
}
export enum Status33 {
    Denied = "denied"
}
export enum Status34 {
    NotFound = "not_found"
}
export enum Status35 {
    Matched = "matched"
}
export enum Status36 {
    Ambiguous = "ambiguous"
}
export enum Status37 {
    Success = "success"
}
export enum Status38 {
    ApprovalRequired = "approval-required"
}
export enum Status39 {
    Denied = "denied"
}
export enum Status40 {
    Success = "success"
}
export enum AlbumUserRole {
    Editor = "editor",
    Owner = "owner",
    Viewer = "viewer"
}
export enum BulkIdErrorReason {
    Duplicate = "duplicate",
    NoPermission = "no_permission",
    NotFound = "not_found",
    Unknown = "unknown",
    Validation = "validation"
}
export enum Permission {
    All = "all",
    ActivityCreate = "activity.create",
    ActivityRead = "activity.read",
    ActivityUpdate = "activity.update",
    ActivityDelete = "activity.delete",
    ActivityStatistics = "activity.statistics",
    ApiKeyCreate = "apiKey.create",
    ApiKeyRead = "apiKey.read",
    ApiKeyUpdate = "apiKey.update",
    ApiKeyDelete = "apiKey.delete",
    AgentCredentialCreate = "agentCredential.create",
    AgentCredentialRead = "agentCredential.read",
    AgentCredentialUpdate = "agentCredential.update",
    AgentCredentialDelete = "agentCredential.delete",
    AgentRunnerRead = "agentRunner.read",
    AgentSessionCreate = "agentSession.create",
    AgentSessionRead = "agentSession.read",
    AgentSessionUpdate = "agentSession.update",
    AssetRead = "asset.read",
    AssetUpdate = "asset.update",
    AssetDelete = "asset.delete",
    AssetStatistics = "asset.statistics",
    AssetShare = "asset.share",
    AssetView = "asset.view",
    AssetDownload = "asset.download",
    AssetUpload = "asset.upload",
    AssetCopy = "asset.copy",
    AssetDerive = "asset.derive",
    AssetEditGet = "asset.edit.get",
    AssetEditCreate = "asset.edit.create",
    AssetEditDelete = "asset.edit.delete",
    AlbumCreate = "album.create",
    AlbumRead = "album.read",
    AlbumUpdate = "album.update",
    AlbumDelete = "album.delete",
    AlbumStatistics = "album.statistics",
    AlbumShare = "album.share",
    AlbumDownload = "album.download",
    AlbumAssetCreate = "albumAsset.create",
    AlbumAssetDelete = "albumAsset.delete",
    AlbumUserCreate = "albumUser.create",
    AlbumUserUpdate = "albumUser.update",
    AlbumUserDelete = "albumUser.delete",
    AuthChangePassword = "auth.changePassword",
    AuthDeviceDelete = "authDevice.delete",
    ArchiveRead = "archive.read",
    BackupList = "backup.list",
    BackupDownload = "backup.download",
    BackupUpload = "backup.upload",
    BackupDelete = "backup.delete",
    DuplicateRead = "duplicate.read",
    DuplicateDelete = "duplicate.delete",
    FaceCreate = "face.create",
    FaceRead = "face.read",
    FaceUpdate = "face.update",
    FaceDelete = "face.delete",
    FolderRead = "folder.read",
    JobCreate = "job.create",
    JobRead = "job.read",
    LibraryCreate = "library.create",
    LibraryRead = "library.read",
    LibraryUpdate = "library.update",
    LibraryDelete = "library.delete",
    LibraryStatistics = "library.statistics",
    TimelineRead = "timeline.read",
    TimelineDownload = "timeline.download",
    Maintenance = "maintenance",
    MapRead = "map.read",
    MapSearch = "map.search",
    MemoryCreate = "memory.create",
    MemoryRead = "memory.read",
    MemoryUpdate = "memory.update",
    MemoryDelete = "memory.delete",
    MemoryStatistics = "memory.statistics",
    MemoryAssetCreate = "memoryAsset.create",
    MemoryAssetDelete = "memoryAsset.delete",
    NotificationCreate = "notification.create",
    NotificationRead = "notification.read",
    NotificationUpdate = "notification.update",
    NotificationDelete = "notification.delete",
    PartnerCreate = "partner.create",
    PartnerRead = "partner.read",
    PartnerUpdate = "partner.update",
    PartnerDelete = "partner.delete",
    SharedSpaceCreate = "sharedSpace.create",
    SharedSpaceRead = "sharedSpace.read",
    SharedSpaceUpdate = "sharedSpace.update",
    SharedSpaceDelete = "sharedSpace.delete",
    SharedSpaceMemberCreate = "sharedSpaceMember.create",
    SharedSpaceMemberUpdate = "sharedSpaceMember.update",
    SharedSpaceMemberDelete = "sharedSpaceMember.delete",
    SharedSpaceAssetCreate = "sharedSpaceAsset.create",
    SharedSpaceAssetRead = "sharedSpaceAsset.read",
    SharedSpaceAssetDelete = "sharedSpaceAsset.delete",
    SharedSpaceLibraryCreate = "sharedSpaceLibrary.create",
    SharedSpaceLibraryDelete = "sharedSpaceLibrary.delete",
    SharedSpaceAlbumCreate = "sharedSpaceAlbum.create",
    SharedSpaceAlbumUpdate = "sharedSpaceAlbum.update",
    SharedSpaceAlbumDelete = "sharedSpaceAlbum.delete",
    UserGroupCreate = "userGroup.create",
    UserGroupRead = "userGroup.read",
    UserGroupUpdate = "userGroup.update",
    UserGroupDelete = "userGroup.delete",
    PersonCreate = "person.create",
    PersonRead = "person.read",
    PersonUpdate = "person.update",
    PersonDelete = "person.delete",
    PersonStatistics = "person.statistics",
    PersonMerge = "person.merge",
    PersonReassign = "person.reassign",
    PinCodeCreate = "pinCode.create",
    PinCodeUpdate = "pinCode.update",
    PinCodeDelete = "pinCode.delete",
    PluginCreate = "plugin.create",
    PluginRead = "plugin.read",
    PluginUpdate = "plugin.update",
    PluginDelete = "plugin.delete",
    ServerAbout = "server.about",
    ServerApkLinks = "server.apkLinks",
    ServerStorage = "server.storage",
    ServerStatistics = "server.statistics",
    ServerVersionCheck = "server.versionCheck",
    ServerLicenseRead = "serverLicense.read",
    ServerLicenseUpdate = "serverLicense.update",
    ServerLicenseDelete = "serverLicense.delete",
    SessionCreate = "session.create",
    SessionRead = "session.read",
    SessionUpdate = "session.update",
    SessionDelete = "session.delete",
    SessionLock = "session.lock",
    SharedLinkCreate = "sharedLink.create",
    SharedLinkRead = "sharedLink.read",
    SharedLinkUpdate = "sharedLink.update",
    SharedLinkDelete = "sharedLink.delete",
    StackCreate = "stack.create",
    StackRead = "stack.read",
    StackUpdate = "stack.update",
    StackDelete = "stack.delete",
    SyncStream = "sync.stream",
    SyncCheckpointRead = "syncCheckpoint.read",
    SyncCheckpointUpdate = "syncCheckpoint.update",
    SyncCheckpointDelete = "syncCheckpoint.delete",
    SystemConfigRead = "systemConfig.read",
    SystemConfigUpdate = "systemConfig.update",
    SystemMetadataRead = "systemMetadata.read",
    SystemMetadataUpdate = "systemMetadata.update",
    TagCreate = "tag.create",
    TagRead = "tag.read",
    TagUpdate = "tag.update",
    TagDelete = "tag.delete",
    TagAsset = "tag.asset",
    UserRead = "user.read",
    UserUpdate = "user.update",
    UserLicenseCreate = "userLicense.create",
    UserLicenseRead = "userLicense.read",
    UserLicenseUpdate = "userLicense.update",
    UserLicenseDelete = "userLicense.delete",
    UserOnboardingRead = "userOnboarding.read",
    UserOnboardingUpdate = "userOnboarding.update",
    UserOnboardingDelete = "userOnboarding.delete",
    UserPreferenceRead = "userPreference.read",
    UserPreferenceUpdate = "userPreference.update",
    UserProfileImageCreate = "userProfileImage.create",
    UserProfileImageRead = "userProfileImage.read",
    UserProfileImageUpdate = "userProfileImage.update",
    UserProfileImageDelete = "userProfileImage.delete",
    QueueRead = "queue.read",
    QueueUpdate = "queue.update",
    QueueJobCreate = "queueJob.create",
    QueueJobRead = "queueJob.read",
    QueueJobUpdate = "queueJob.update",
    QueueJobDelete = "queueJob.delete",
    WorkflowCreate = "workflow.create",
    WorkflowRead = "workflow.read",
    WorkflowUpdate = "workflow.update",
    WorkflowDelete = "workflow.delete",
    AdminUserCreate = "adminUser.create",
    AdminUserRead = "adminUser.read",
    AdminUserUpdate = "adminUser.update",
    AdminUserDelete = "adminUser.delete",
    AdminSessionRead = "adminSession.read",
    AdminAuthUnlinkAll = "adminAuth.unlinkAll"
}
export enum AssetMediaStatus {
    Created = "created",
    Duplicate = "duplicate"
}
export enum AssetUploadAction {
    Accept = "accept",
    Reject = "reject"
}
export enum AssetRejectReason {
    Duplicate = "duplicate",
    UnsupportedFormat = "unsupported-format"
}
export enum AssetJobName {
    RefreshFaces = "refresh-faces",
    RefreshMetadata = "refresh-metadata",
    RegenerateThumbnail = "regenerate-thumbnail",
    TranscodeVideo = "transcode-video"
}
export enum Type5 {
    UserPerson = "user-person",
    SpacePerson = "space-person"
}
export enum AssetEditAction {
    Crop = "crop",
    Rotate = "rotate",
    Mirror = "mirror",
    Trim = "trim",
    Adjust = "adjust"
}
export enum MirrorAxis {
    Horizontal = "horizontal",
    Vertical = "vertical"
}
export enum TonalLevel {
    StrongDecrease = "strong_decrease",
    ModerateDecrease = "moderate_decrease",
    SlightDecrease = "slight_decrease",
    SlightIncrease = "slight_increase",
    ModerateIncrease = "moderate_increase",
    StrongIncrease = "strong_increase"
}
export enum AssetMediaSize {
    Original = "original",
    Fullsize = "fullsize",
    Preview = "preview",
    Thumbnail = "thumbnail"
}
export enum SourceType {
    MachineLearning = "machine-learning",
    Exif = "exif",
    Manual = "manual"
}
export enum MapMediaType {
    Image = "IMAGE",
    Video = "VIDEO"
}
export enum ManualJobName {
    PersonCleanup = "person-cleanup",
    TagCleanup = "tag-cleanup",
    UserCleanup = "user-cleanup",
    MemoryCleanup = "memory-cleanup",
    MemoryCreate = "memory-create",
    BackupDatabase = "backup-database",
    IntegrityMissingFiles = "integrity-missing-files",
    IntegrityUntrackedFiles = "integrity-untracked-files",
    IntegrityChecksumMismatch = "integrity-checksum-mismatch",
    IntegrityMissingFilesRefresh = "integrity-missing-files-refresh",
    IntegrityUntrackedFilesRefresh = "integrity-untracked-files-refresh",
    IntegrityChecksumMismatchRefresh = "integrity-checksum-mismatch-refresh",
    IntegrityMissingFilesDeleteAll = "integrity-missing-files-delete-all",
    IntegrityUntrackedFilesDeleteAll = "integrity-untracked-files-delete-all",
    IntegrityChecksumMismatchDeleteAll = "integrity-checksum-mismatch-delete-all",
    FaceIdentityBackfill = "face-identity-backfill",
    FaceSuggestionMaintenance = "face-suggestion-maintenance",
    SharedSpacePersonMetadataBackfill = "shared-space-person-metadata-backfill"
}
export enum QueueName {
    ThumbnailGeneration = "thumbnailGeneration",
    MetadataExtraction = "metadataExtraction",
    VideoConversion = "videoConversion",
    FaceDetection = "faceDetection",
    FacialRecognition = "facialRecognition",
    SmartSearch = "smartSearch",
    DuplicateDetection = "duplicateDetection",
    BackgroundTask = "backgroundTask",
    PeopleBackfill = "peopleBackfill",
    StorageTemplateMigration = "storageTemplateMigration",
    Migration = "migration",
    Search = "search",
    Sidecar = "sidecar",
    Library = "library",
    Notifications = "notifications",
    BackupDatabase = "backupDatabase",
    Ocr = "ocr",
    PetDetection = "petDetection",
    ImageQuality = "imageQuality",
    Workflow = "workflow",
    IntegrityCheck = "integrityCheck",
    Editor = "editor",
    StorageBackendMigration = "storageBackendMigration",
    Classification = "classification"
}
export enum QueueCommand {
    Start = "start",
    Pause = "pause",
    Resume = "resume",
    Empty = "empty",
    ClearFailed = "clear-failed"
}
export enum MemorySearchOrder {
    Asc = "asc",
    Desc = "desc",
    Random = "random"
}
export enum MemoryType {
    OnThisDay = "on_this_day",
    Rule = "rule"
}
export enum PartnerDirection {
    SharedBy = "shared-by",
    SharedWith = "shared-with"
}
export enum Type6 {
    Person = "person",
    SpacePerson = "space-person"
}
export enum WorkflowType {
    AssetV1 = "AssetV1"
}
export enum WorkflowTrigger {
    AssetCreate = "AssetCreate",
    AssetMetadataExtraction = "AssetMetadataExtraction"
}
export enum JobName {
    AssetDelete = "AssetDelete",
    AssetDeleteCheck = "AssetDeleteCheck",
    AssetDetectFacesQueueAll = "AssetDetectFacesQueueAll",
    AssetDetectFaces = "AssetDetectFaces",
    AssetDetectDuplicatesQueueAll = "AssetDetectDuplicatesQueueAll",
    AssetDetectDuplicates = "AssetDetectDuplicates",
    AssetEditThumbnailGeneration = "AssetEditThumbnailGeneration",
    AssetEncodeVideoQueueAll = "AssetEncodeVideoQueueAll",
    AssetEncodeVideo = "AssetEncodeVideo",
    AssetEmptyTrash = "AssetEmptyTrash",
    AssetExtractMetadataQueueAll = "AssetExtractMetadataQueueAll",
    AssetExtractMetadata = "AssetExtractMetadata",
    AssetFileMigration = "AssetFileMigration",
    AssetGenerateThumbnailsQueueAll = "AssetGenerateThumbnailsQueueAll",
    AssetGenerateThumbnails = "AssetGenerateThumbnails",
    AuditTableCleanup = "AuditTableCleanup",
    DatabaseBackup = "DatabaseBackup",
    FacialRecognitionQueueAll = "FacialRecognitionQueueAll",
    FacialRecognition = "FacialRecognition",
    FaceIdentityBackfill = "FaceIdentityBackfill",
    FaceIdentityMaintenanceAfterRecognition = "FaceIdentityMaintenanceAfterRecognition",
    FaceRepairScan = "FaceRepairScan",
    FaceSuggestionMaintenance = "FaceSuggestionMaintenance",
    PersonSuggestionScanQueueAll = "PersonSuggestionScanQueueAll",
    PersonSuggestionScan = "PersonSuggestionScan",
    SpacePersonSuggestionScanQueueAll = "SpacePersonSuggestionScanQueueAll",
    SpacePersonSuggestionScan = "SpacePersonSuggestionScan",
    FileDelete = "FileDelete",
    FileMigrationQueueAll = "FileMigrationQueueAll",
    LibraryDeleteCheck = "LibraryDeleteCheck",
    LibraryDelete = "LibraryDelete",
    LibraryRemoveAsset = "LibraryRemoveAsset",
    LibraryScanAssetsQueueAll = "LibraryScanAssetsQueueAll",
    LibrarySyncAssets = "LibrarySyncAssets",
    LibrarySyncFilesQueueAll = "LibrarySyncFilesQueueAll",
    LibrarySyncFiles = "LibrarySyncFiles",
    LibraryScanQueueAll = "LibraryScanQueueAll",
    HlsSessionCleanup = "HlsSessionCleanup",
    MemoryCleanup = "MemoryCleanup",
    MemoryGenerate = "MemoryGenerate",
    NotificationsCleanup = "NotificationsCleanup",
    NotifyUserSignup = "NotifyUserSignup",
    NotifyAlbumInvite = "NotifyAlbumInvite",
    NotifyAlbumUpdate = "NotifyAlbumUpdate",
    UserDelete = "UserDelete",
    UserDeleteCheck = "UserDeleteCheck",
    UserSyncUsage = "UserSyncUsage",
    PersonCleanup = "PersonCleanup",
    PersonFileMigration = "PersonFileMigration",
    PersonGenerateThumbnail = "PersonGenerateThumbnail",
    SessionCleanup = "SessionCleanup",
    SendMail = "SendMail",
    SidecarQueueAll = "SidecarQueueAll",
    SidecarCheck = "SidecarCheck",
    SidecarWrite = "SidecarWrite",
    SmartSearchQueueAll = "SmartSearchQueueAll",
    SmartSearch = "SmartSearch",
    StorageTemplateMigration = "StorageTemplateMigration",
    StorageTemplateMigrationSingle = "StorageTemplateMigrationSingle",
    TagCleanup = "TagCleanup",
    VersionCheck = "VersionCheck",
    OcrQueueAll = "OcrQueueAll",
    Ocr = "Ocr",
    PetDetectionQueueAll = "PetDetectionQueueAll",
    PetDetection = "PetDetection",
    ImageQualityQueueAll = "ImageQualityQueueAll",
    ImageQuality = "ImageQuality",
    WorkflowAssetTrigger = "WorkflowAssetTrigger",
    IntegrityUntrackedFilesQueueAll = "IntegrityUntrackedFilesQueueAll",
    IntegrityUntrackedFiles = "IntegrityUntrackedFiles",
    IntegrityUntrackedRefresh = "IntegrityUntrackedRefresh",
    IntegrityMissingFilesQueueAll = "IntegrityMissingFilesQueueAll",
    IntegrityMissingFiles = "IntegrityMissingFiles",
    IntegrityMissingFilesRefresh = "IntegrityMissingFilesRefresh",
    IntegrityChecksumFiles = "IntegrityChecksumFiles",
    IntegrityChecksumFilesRefresh = "IntegrityChecksumFilesRefresh",
    IntegrityDeleteReportType = "IntegrityDeleteReportType",
    IntegrityDeleteReports = "IntegrityDeleteReports",
    StorageBackendMigrationQueueAll = "StorageBackendMigrationQueueAll",
    StorageBackendMigrationSingle = "StorageBackendMigrationSingle",
    SharedSpaceFaceMatch = "SharedSpaceFaceMatch",
    SharedSpaceFaceMatchAll = "SharedSpaceFaceMatchAll",
    SharedSpaceFaceMatchPage = "SharedSpaceFaceMatchPage",
    SharedSpaceFaceMatchFromBackfill = "SharedSpaceFaceMatchFromBackfill",
    SharedSpaceLibraryFaceSync = "SharedSpaceLibraryFaceSync",
    SharedSpaceAlbumFaceSync = "SharedSpaceAlbumFaceSync",
    SharedSpaceIdentityReconciliation = "SharedSpaceIdentityReconciliation",
    SharedSpacePersonDedup = "SharedSpacePersonDedup",
    SharedSpacePersonMetadataBackfill = "SharedSpacePersonMetadataBackfill",
    SharedSpaceBulkAddAssets = "SharedSpaceBulkAddAssets",
    SharedSpaceAlbumGrantReconcile = "SharedSpaceAlbumGrantReconcile",
    SharedSpaceAlbumGrantReconcileSweep = "SharedSpaceAlbumGrantReconcileSweep",
    SharedSpaceIdentityReconciliationSweep = "SharedSpaceIdentityReconciliationSweep",
    AssetClassifyQueueAll = "AssetClassifyQueueAll",
    AssetClassify = "AssetClassify"
}
export enum QueueJobStatus {
    Active = "active",
    Failed = "failed",
    Completed = "completed",
    Delayed = "delayed",
    Waiting = "waiting",
    Paused = "paused"
}
export enum SearchSuggestionType {
    Country = "country",
    State = "state",
    City = "city",
    CameraMake = "camera-make",
    CameraModel = "camera-model",
    CameraLensModel = "camera-lens-model"
}
export enum SharedLinkType {
    Album = "ALBUM",
    Individual = "INDIVIDUAL"
}
export enum AssetIdErrorReason {
    Duplicate = "duplicate",
    NoPermission = "no_permission",
    NotFound = "not_found"
}
export enum SharedSpaceRole {
    Owner = "owner",
    Editor = "editor",
    Viewer = "viewer"
}
export enum RepresentativeFaceSource {
    Auto = "auto",
    Manual = "manual"
}
export enum StorageMigrationDirection {
    ToS3 = "toS3",
    ToDisk = "toDisk"
}
export enum SyncEntityType {
    AuthUserV1 = "AuthUserV1",
    UserV1 = "UserV1",
    UserDeleteV1 = "UserDeleteV1",
    AssetV1 = "AssetV1",
    AssetV2 = "AssetV2",
    AssetDeleteV1 = "AssetDeleteV1",
    AssetExifV1 = "AssetExifV1",
    AssetEditV1 = "AssetEditV1",
    AssetEditDeleteV1 = "AssetEditDeleteV1",
    AssetMetadataV1 = "AssetMetadataV1",
    AssetMetadataDeleteV1 = "AssetMetadataDeleteV1",
    AssetOcrV1 = "AssetOcrV1",
    AssetOcrDeleteV1 = "AssetOcrDeleteV1",
    PartnerV1 = "PartnerV1",
    PartnerDeleteV1 = "PartnerDeleteV1",
    PartnerAssetV1 = "PartnerAssetV1",
    PartnerAssetV2 = "PartnerAssetV2",
    PartnerAssetBackfillV1 = "PartnerAssetBackfillV1",
    PartnerAssetBackfillV2 = "PartnerAssetBackfillV2",
    PartnerAssetDeleteV1 = "PartnerAssetDeleteV1",
    PartnerAssetExifV1 = "PartnerAssetExifV1",
    PartnerAssetExifBackfillV1 = "PartnerAssetExifBackfillV1",
    PartnerStackBackfillV1 = "PartnerStackBackfillV1",
    PartnerStackDeleteV1 = "PartnerStackDeleteV1",
    PartnerStackV1 = "PartnerStackV1",
    AlbumV1 = "AlbumV1",
    AlbumV2 = "AlbumV2",
    AlbumDeleteV1 = "AlbumDeleteV1",
    AlbumUserV1 = "AlbumUserV1",
    AlbumUserBackfillV1 = "AlbumUserBackfillV1",
    AlbumUserDeleteV1 = "AlbumUserDeleteV1",
    AlbumAssetCreateV1 = "AlbumAssetCreateV1",
    AlbumAssetCreateV2 = "AlbumAssetCreateV2",
    AlbumAssetUpdateV1 = "AlbumAssetUpdateV1",
    AlbumAssetUpdateV2 = "AlbumAssetUpdateV2",
    AlbumAssetBackfillV1 = "AlbumAssetBackfillV1",
    AlbumAssetBackfillV2 = "AlbumAssetBackfillV2",
    AlbumAssetExifCreateV1 = "AlbumAssetExifCreateV1",
    AlbumAssetExifUpdateV1 = "AlbumAssetExifUpdateV1",
    AlbumAssetExifBackfillV1 = "AlbumAssetExifBackfillV1",
    AlbumToAssetV1 = "AlbumToAssetV1",
    AlbumToAssetDeleteV1 = "AlbumToAssetDeleteV1",
    AlbumToAssetBackfillV1 = "AlbumToAssetBackfillV1",
    MemoryV1 = "MemoryV1",
    MemoryDeleteV1 = "MemoryDeleteV1",
    MemoryToAssetV1 = "MemoryToAssetV1",
    MemoryToAssetDeleteV1 = "MemoryToAssetDeleteV1",
    StackV1 = "StackV1",
    StackDeleteV1 = "StackDeleteV1",
    PersonV1 = "PersonV1",
    PersonDeleteV1 = "PersonDeleteV1",
    AssetFaceV1 = "AssetFaceV1",
    AssetFaceV2 = "AssetFaceV2",
    AssetFaceDeleteV1 = "AssetFaceDeleteV1",
    UserMetadataV1 = "UserMetadataV1",
    UserMetadataDeleteV1 = "UserMetadataDeleteV1",
    SharedSpaceV1 = "SharedSpaceV1",
    SharedSpaceDeleteV1 = "SharedSpaceDeleteV1",
    SharedSpaceMemberV1 = "SharedSpaceMemberV1",
    SharedSpaceMemberDeleteV1 = "SharedSpaceMemberDeleteV1",
    SharedSpaceMemberBackfillV1 = "SharedSpaceMemberBackfillV1",
    SharedSpaceAssetCreateV1 = "SharedSpaceAssetCreateV1",
    SharedSpaceAssetUpdateV1 = "SharedSpaceAssetUpdateV1",
    SharedSpaceAssetBackfillV1 = "SharedSpaceAssetBackfillV1",
    SharedSpaceAssetExifCreateV1 = "SharedSpaceAssetExifCreateV1",
    SharedSpaceAssetExifUpdateV1 = "SharedSpaceAssetExifUpdateV1",
    SharedSpaceAssetExifBackfillV1 = "SharedSpaceAssetExifBackfillV1",
    SharedSpaceToAssetV1 = "SharedSpaceToAssetV1",
    SharedSpaceToAssetDeleteV1 = "SharedSpaceToAssetDeleteV1",
    SharedSpaceToAssetBackfillV1 = "SharedSpaceToAssetBackfillV1",
    LibraryV1 = "LibraryV1",
    LibraryDeleteV1 = "LibraryDeleteV1",
    LibraryAssetCreateV1 = "LibraryAssetCreateV1",
    LibraryAssetDeleteV1 = "LibraryAssetDeleteV1",
    LibraryAssetBackfillV1 = "LibraryAssetBackfillV1",
    LibraryAssetExifCreateV1 = "LibraryAssetExifCreateV1",
    LibraryAssetExifBackfillV1 = "LibraryAssetExifBackfillV1",
    SharedSpaceLibraryV1 = "SharedSpaceLibraryV1",
    SharedSpaceLibraryDeleteV1 = "SharedSpaceLibraryDeleteV1",
    SharedSpaceLibraryBackfillV1 = "SharedSpaceLibraryBackfillV1",
    SharedSpaceAlbumV1 = "SharedSpaceAlbumV1",
    SharedSpaceAlbumDeleteV1 = "SharedSpaceAlbumDeleteV1",
    SharedSpaceAlbumBackfillV1 = "SharedSpaceAlbumBackfillV1",
    SharedSpaceAlbumLinkV1 = "SharedSpaceAlbumLinkV1",
    SharedSpaceAlbumLinkDeleteV1 = "SharedSpaceAlbumLinkDeleteV1",
    SharedSpaceAlbumLinkBackfillV1 = "SharedSpaceAlbumLinkBackfillV1",
    SharedSpaceAlbumToAssetV1 = "SharedSpaceAlbumToAssetV1",
    SharedSpaceAlbumToAssetDeleteV1 = "SharedSpaceAlbumToAssetDeleteV1",
    SharedSpaceAlbumToAssetBackfillV1 = "SharedSpaceAlbumToAssetBackfillV1",
    SharedSpaceAlbumAssetCreateV1 = "SharedSpaceAlbumAssetCreateV1",
    SharedSpaceAlbumAssetUpdateV1 = "SharedSpaceAlbumAssetUpdateV1",
    SharedSpaceAlbumAssetBackfillV1 = "SharedSpaceAlbumAssetBackfillV1",
    SharedSpaceAlbumAssetExifCreateV1 = "SharedSpaceAlbumAssetExifCreateV1",
    SharedSpaceAlbumAssetExifUpdateV1 = "SharedSpaceAlbumAssetExifUpdateV1",
    SharedSpaceAlbumAssetExifBackfillV1 = "SharedSpaceAlbumAssetExifBackfillV1",
    SyncAckV1 = "SyncAckV1",
    SyncResetV1 = "SyncResetV1",
    SyncCompleteV1 = "SyncCompleteV1"
}
export enum SyncRequestType {
    AlbumsV1 = "AlbumsV1",
    AlbumsV2 = "AlbumsV2",
    AlbumUsersV1 = "AlbumUsersV1",
    AlbumToAssetsV1 = "AlbumToAssetsV1",
    AlbumAssetsV1 = "AlbumAssetsV1",
    AlbumAssetsV2 = "AlbumAssetsV2",
    AlbumAssetExifsV1 = "AlbumAssetExifsV1",
    AssetsV1 = "AssetsV1",
    AssetsV2 = "AssetsV2",
    AssetExifsV1 = "AssetExifsV1",
    AssetEditsV1 = "AssetEditsV1",
    AssetMetadataV1 = "AssetMetadataV1",
    AssetOcrV1 = "AssetOcrV1",
    AuthUsersV1 = "AuthUsersV1",
    MemoriesV1 = "MemoriesV1",
    MemoryToAssetsV1 = "MemoryToAssetsV1",
    PartnersV1 = "PartnersV1",
    PartnerAssetsV1 = "PartnerAssetsV1",
    PartnerAssetsV2 = "PartnerAssetsV2",
    PartnerAssetExifsV1 = "PartnerAssetExifsV1",
    PartnerStacksV1 = "PartnerStacksV1",
    StacksV1 = "StacksV1",
    UsersV1 = "UsersV1",
    PeopleV1 = "PeopleV1",
    AssetFacesV1 = "AssetFacesV1",
    AssetFacesV2 = "AssetFacesV2",
    UserMetadataV1 = "UserMetadataV1",
    SharedSpacesV1 = "SharedSpacesV1",
    SharedSpaceMembersV1 = "SharedSpaceMembersV1",
    SharedSpaceAssetsV1 = "SharedSpaceAssetsV1",
    SharedSpaceAssetExifsV1 = "SharedSpaceAssetExifsV1",
    SharedSpaceToAssetsV1 = "SharedSpaceToAssetsV1",
    LibrariesV1 = "LibrariesV1",
    LibraryAssetsV1 = "LibraryAssetsV1",
    LibraryAssetExifsV1 = "LibraryAssetExifsV1",
    SharedSpaceLibrariesV1 = "SharedSpaceLibrariesV1",
    SharedSpaceAlbumsV1 = "SharedSpaceAlbumsV1",
    SharedSpaceAlbumLinksV1 = "SharedSpaceAlbumLinksV1",
    SharedSpaceAlbumToAssetsV1 = "SharedSpaceAlbumToAssetsV1",
    SharedSpaceAlbumAssetsV1 = "SharedSpaceAlbumAssetsV1",
    SharedSpaceAlbumAssetExifsV1 = "SharedSpaceAlbumAssetExifsV1"
}
export enum Action {
    Tag = "tag",
    TagAndArchive = "tag_and_archive"
}
export enum ClassificationFaceExclusion {
    Off = "off",
    AnyAssignedFace = "any_assigned_face",
    NamedPeople = "named_people",
    NamedVisiblePeople = "named_visible_people"
}
export enum TranscodeHWAccel {
    Nvenc = "nvenc",
    Qsv = "qsv",
    Vaapi = "vaapi",
    Rkmpp = "rkmpp",
    Disabled = "disabled"
}
export enum AudioCodec {
    Mp3 = "mp3",
    Aac = "aac",
    Opus = "opus",
    PcmS16Le = "pcm_s16le"
}
export enum VideoContainer {
    Mov = "mov",
    Mp4 = "mp4",
    Ogg = "ogg",
    Webm = "webm"
}
export enum VideoCodec {
    H264 = "h264",
    Hevc = "hevc",
    Vp9 = "vp9",
    Av1 = "av1"
}
export enum CQMode {
    Auto = "auto",
    Cqp = "cqp",
    Icq = "icq"
}
export enum HlsVideoResolution {
    $480 = 480,
    $720 = 720,
    $1080 = 1080,
    $1440 = 1440,
    $2160 = 2160
}
export enum ToneMapping {
    Hable = "hable",
    Mobius = "mobius",
    Reinhard = "reinhard",
    Disabled = "disabled"
}
export enum TranscodePolicy {
    All = "all",
    Optimal = "optimal",
    Bitrate = "bitrate",
    Required = "required",
    Disabled = "disabled"
}
export enum Colorspace {
    Srgb = "srgb",
    P3 = "p3"
}
export enum ImageFormat {
    Jpeg = "jpeg",
    Webp = "webp"
}
export enum LogLevel {
    Verbose = "verbose",
    Debug = "debug",
    Log = "log",
    Warn = "warn",
    Error = "error",
    Fatal = "fatal"
}
export enum ReleaseChannel {
    Stable = "stable",
    ReleaseCandidate = "releaseCandidate"
}
export enum OAuthTokenEndpointAuthMethod {
    ClientSecretPost = "client_secret_post",
    ClientSecretBasic = "client_secret_basic"
}
export enum TimeBucketSize {
    Year = "year",
    Month = "month",
    Day = "day"
}
export enum AssetOrderBy {
    TakenAt = "takenAt",
    CreatedAt = "createdAt"
}
export enum ReleaseType {
    Major = "major",
    Premajor = "premajor",
    Minor = "minor",
    Preminor = "preminor",
    Patch = "patch",
    Prepatch = "prepatch",
    Prerelease = "prerelease"
}
export enum UserMetadataKey {
    Preferences = "preferences",
    License = "license",
    Onboarding = "onboarding"
}
