// Contract-faithful fake MCP client for strict-workflow L2 tests.
//
// It enforces the SAME shape constraints the real Gallery server tools enforce
// (mirroring server/src/dtos/agent-tool.dto.ts + agent-operation.dto.ts), so a
// call the live server would reject also throws here. This exists because the
// `add_photos_to_album` recency bug shipped past a fixture that ignored call
// args — the workflow sent a free-text `query` to tools that reject it and never
// planned live. Every strict-workflow `run()` test drives its workflow against
// this client so that class of bug fails in unit tests, not only on L3.

// Reviewable operation types accepted by proposeAlbumOperations (the full
// AgentGalleryOperationInput union: album.* + space.* + asset.*).
export const KNOWN_OPERATION_TYPES = new Set([
  'album.create',
  'album.addAssets',
  'album.removeAssets',
  'album.updateDetails',
  'album.setCover',
  'album.addUsers',
  'album.removeUsers',
  'album.updateUserRole',
  'album.delete',
  'space.create',
  'space.addAssets',
  'space.removeAssets',
  'space.updateDetails',
  'space.addMembers',
  'space.removeMembers',
  'space.updateMemberRole',
  'space.delete',
  'asset.rotate',
  'asset.crop',
  'asset.setFavorite',
  'asset.setArchive',
  'asset.updateMetadata',
  'asset.addTag',
  'asset.removeTag',
  'asset.trash',
  'asset.restore',
  'asset.stack',
  'asset.unstack',
  'shareLink.create',
  'shareLink.createAlbum',
  'person.update',
  'person.merge',
]);

// Action types accepted by proposeAssetBatchFromSelection's discriminated union.
export const KNOWN_BATCH_ACTION_TYPES = new Set([
  'asset.setFavorite',
  'asset.setArchive',
  'asset.setVisibility',
  'asset.addTag',
  'asset.rotate',
  'asset.crop',
  'asset.updateMetadata',
  'asset.stack',
  'asset.unstack',
  'asset.adjust',
  'asset.flip',
]);

const KNOWN_SPACE_FROM_SEARCH_KEYS = new Set(['summary', 'spaceName', 'description', 'color', 'assetSource']);
const KNOWN_AVATAR_COLORS = new Set(['primary', 'pink', 'red', 'yellow', 'blue', 'green', 'purple', 'orange', 'gray', 'amber']);
const KNOWN_ASSET_SOURCE_KINDS = new Set(['search', 'previousSearch', 'selectionHandle']);

const SEARCH_DETAILS = new Set(['ids', 'handle', 'summary', 'metadata']);
const SEARCH_TEXT_MODES = new Set(['smart', 'description', 'ocr', 'filename']);

// metadata searchAssets.filters is a strictObject (server rejects unknown keys);
// `type` is the AssetType enum. Mirror both so a wrong-shape filter throws here too.
const KNOWN_ASSET_TYPES = new Set(['IMAGE', 'VIDEO', 'AUDIO', 'OTHER']);
const KNOWN_VISIBILITY = new Set(['archive', 'timeline', 'hidden', 'locked']);
const KNOWN_SEARCH_FILTER_KEYS = new Set([
  'takenAfter', 'takenBefore', 'createdAfter', 'createdBefore', 'updatedAfter', 'updatedBefore',
  'city', 'state', 'country', 'make', 'model', 'lensModel', 'isFavorite', 'isNotInAlbum', 'type',
  'rating', 'tagIds', 'tagMatchAny', 'albumIds', 'albumMatchAny', 'personIds', 'personMatchAny',
  'spaceId', 'spacePersonIds', 'withSharedSpaces', 'visibility', 'maxSharpness', 'maxBrightness', 'maxQuality',
  'isTrashed',
]);
const QUALITY_FILTER_KEYS = ['maxSharpness', 'maxBrightness', 'maxQuality'];

const fail = (message) => {
  throw new Error(message);
};

const KNOWN_RESOLVE_FILTER_KEYS = new Set([
  'people', 'tags', 'albums', 'spaces', 'cameraMakes', 'cameraModels', 'lensModels', 'scope', 'toolCallId',
]);
const RESOLVE_NAME_LIST_KEYS = new Set([
  'people', 'tags', 'albums', 'spaces', 'cameraMakes', 'cameraModels', 'lensModels',
]);

// Mirror the real strictObject request: reject unknown keys (incl. `query`) and the
// resolverNameList caps (≤20 names/kind, ≤120 chars, non-empty strings).
const validateResolveRequest = (args) => {
  if (!args || typeof args !== 'object') fail('resolveAssetSearchFilters requires an object');
  for (const key of Object.keys(args)) {
    if (!KNOWN_RESOLVE_FILTER_KEYS.has(key)) fail(`resolveAssetSearchFilters: unrecognized key "${key}"`);
  }
  for (const key of RESOLVE_NAME_LIST_KEYS) {
    if (args[key] === undefined) continue;
    if (!Array.isArray(args[key]) || args[key].length === 0) fail(`resolveAssetSearchFilters: ${key} must be a non-empty array`);
    if (args[key].length > 20) fail(`resolveAssetSearchFilters: ${key} exceeds 20 names`);
    for (const name of args[key]) {
      if (typeof name !== 'string' || name.trim().length === 0) fail(`resolveAssetSearchFilters: ${key} names must be non-empty strings`);
      if (name.length > 120) fail(`resolveAssetSearchFilters: ${key} name exceeds 120 chars`);
    }
  }
};

const UPDATE_METADATA_FIELDS = new Set([
  'description', 'rating', 'dateTimeOriginal', 'dateTimeRelative', 'timeZone', 'latitude', 'longitude',
]);

// Mirror AgentAssetBatch asset.updateMetadata: flat strictObject + the 4 cross-field
// rules + per-field bounds, so a wrong-shape live call also throws here.
const validateUpdateMetadataAction = (action) => {
  for (const key of Object.keys(action)) {
    if (key !== 'type' && !UPDATE_METADATA_FIELDS.has(key)) {
      fail(`unknown asset.updateMetadata field "${key}"`);
    }
  }
  const supplied = [...UPDATE_METADATA_FIELDS].filter((field) => action[field] !== undefined);
  if (supplied.length === 0) fail('asset.updateMetadata requires at least one metadata field');
  if (action.description !== undefined && (typeof action.description !== 'string' || action.description.length > 1000)) {
    fail('asset.updateMetadata description must be a string of at most 1000 chars');
  }
  if (action.rating !== undefined && action.rating !== null) {
    const r = action.rating;
    if (typeof r !== 'number' || !Number.isInteger(r) || r < 1 || r > 5) {
      fail('asset.updateMetadata rating must be an integer 1..5 or null');
    }
  }
  if (action.dateTimeRelative !== undefined && (typeof action.dateTimeRelative !== 'number' || !Number.isInteger(action.dateTimeRelative))) {
    fail('asset.updateMetadata dateTimeRelative must be an integer');
  }
  if (action.timeZone !== undefined && (typeof action.timeZone !== 'string' || action.timeZone.trim().length === 0)) {
    fail('asset.updateMetadata timeZone must be a non-empty IANA time zone');
  }
  if (action.latitude !== undefined && (typeof action.latitude !== 'number' || action.latitude < -90 || action.latitude > 90)) {
    fail('asset.updateMetadata latitude must be between -90 and 90');
  }
  if (action.longitude !== undefined && (typeof action.longitude !== 'number' || action.longitude < -180 || action.longitude > 180)) {
    fail('asset.updateMetadata longitude must be between -180 and 180');
  }
  if (action.dateTimeOriginal !== undefined && action.dateTimeRelative !== undefined) {
    fail('asset.updateMetadata: choose dateTimeOriginal or dateTimeRelative, not both');
  }
  if (action.dateTimeRelative === 0 && supplied.length === 1) {
    fail('asset.updateMetadata dateTimeRelative: 0 is a no-op unless another field changes');
  }
  if (Number(action.latitude !== undefined) + Number(action.longitude !== undefined) === 1) {
    fail('asset.updateMetadata requires both latitude and longitude');
  }
};

// Validate proposeAssetBatchFromSelection.action against the real union shape.
const validateBatchAction = (action) => {
  if (!action || typeof action !== 'object') fail('action is required');
  const { type } = action;
  if (!KNOWN_BATCH_ACTION_TYPES.has(type)) fail(`unknown batch action type "${type}"`);
  if (type === 'asset.setFavorite' && typeof action.favorite !== 'boolean') fail('setFavorite requires favorite:boolean');
  if (type === 'asset.setArchive' && typeof action.archived !== 'boolean') fail('setArchive requires archived:boolean');
  if (type === 'asset.setVisibility' && action.visibility !== 'locked') fail('setVisibility requires visibility:"locked"');
  if (type === 'asset.addTag') {
    const provided = Number(action.tagName !== undefined) + Number(action.tagId !== undefined);
    if (provided !== 1) fail('asset.addTag requires exactly one of tagName or tagId');
  }
  if (type === 'asset.updateMetadata') {
    validateUpdateMetadataAction(action);
  }
  if (type === 'asset.rotate') {
    if (![90, 180, 270].includes(action.angle)) fail('asset.rotate angle must be 90, 180, or 270');
  }
  if (type === 'asset.crop') {
    validateAssetCropAction(action);
  }
  if (type === 'asset.adjust') {
    const ADJUST_LEVELS = new Set([
      'strong_decrease', 'moderate_decrease', 'slight_decrease',
      'slight_increase', 'moderate_increase', 'strong_increase',
    ]);
    const fields = ['brightness', 'contrast', 'saturation'];
    const hasManual = fields.some((f) => action[f] !== undefined);
    const hasAuto = action.autoEnhance !== undefined;
    if (!hasManual && !hasAuto) fail('asset.adjust requires at least one adjustment field');
    for (const f of fields) {
      if (action[f] !== undefined && !ADJUST_LEVELS.has(action[f])) fail(`asset.adjust ${f} level "${action[f]}" is invalid`);
    }
    if (hasAuto && typeof action.autoEnhance !== 'boolean') fail('asset.adjust autoEnhance must be boolean');
  }
  if (type === 'asset.flip') {
    if (action.axis !== 'horizontal' && action.axis !== 'vertical') fail('asset.flip axis must be horizontal or vertical');
  }
};

// Mirror CropParametersSchema: x/y >= 0, width/height >= 1, all integers.
export const validateAssetCropAction = (action) => {
  const { x, y, width, height } = action;
  if (typeof x !== 'number' || !Number.isInteger(x) || x < 0) fail('asset.crop x must be an integer >= 0');
  if (typeof y !== 'number' || !Number.isInteger(y) || y < 0) fail('asset.crop y must be an integer >= 0');
  if (typeof width !== 'number' || !Number.isInteger(width) || width < 1) fail('asset.crop width must be an integer >= 1');
  if (typeof height !== 'number' || !Number.isInteger(height) || height < 1) fail('asset.crop height must be an integer >= 1');
};

// space.updateDetails payload is a strictObject with ≥1 of these (mirrors the DTO).
const KNOWN_SPACE_DETAILS_KEYS = new Set(['spaceName', 'description', 'color']);
// Only editor/viewer are assignable to a member (owner is not).
const ASSIGNABLE_SPACE_ROLES = new Set(['editor', 'viewer']);

const requireExistingSpaceTarget = (op) => {
  if (op.targetKind !== 'existing_space') fail(`${op.type} requires targetKind "existing_space"`);
  if (!op.targetId) fail(`${op.type} requires targetId`);
};

const validateSpaceUpdateDetails = (op) => {
  requireExistingSpaceTarget(op);
  if (!op.payload || typeof op.payload !== 'object') fail('space.updateDetails requires a payload object');
  const keys = Object.keys(op.payload);
  for (const key of keys) {
    if (!KNOWN_SPACE_DETAILS_KEYS.has(key)) fail(`unknown space.updateDetails payload key "${key}"`);
  }
  if (keys.length === 0) fail('space.updateDetails requires spaceName, description, or color');
};

const validateSpaceAddMembers = (op) => {
  requireExistingSpaceTarget(op);
  const members = op.payload?.members;
  if (!Array.isArray(members) || members.length === 0) fail('space.addMembers requires a non-empty payload.members');
  for (const member of members) {
    if (!member?.userId) fail('space.addMembers member requires userId');
    if (!ASSIGNABLE_SPACE_ROLES.has(member.role)) fail(`space.addMembers member role must be editor or viewer`);
  }
};

const validateSpaceRemoveMembers = (op) => {
  requireExistingSpaceTarget(op);
  const userIds = op.payload?.userIds;
  if (!Array.isArray(userIds) || userIds.length === 0) fail('space.removeMembers requires a non-empty payload.userIds');
};

const validateSpaceUpdateMemberRole = (op) => {
  requireExistingSpaceTarget(op);
  const userIds = op.payload?.userIds;
  if (!Array.isArray(userIds) || userIds.length === 0)
    fail('space.updateMemberRole requires a non-empty payload.userIds');
  if (!ASSIGNABLE_SPACE_ROLES.has(op.payload?.role)) fail('space.updateMemberRole role must be editor or viewer');
};

const validateSpaceRemoveAssets = (op) => {
  if (op.targetKind !== 'existing_space') fail('space.removeAssets requires targetKind "existing_space"');
  if (!op.targetId) fail('space.removeAssets requires targetId');
  if (op.payload !== undefined && Object.keys(op.payload).length > 0) fail('space.removeAssets payload must be empty');
  const source = op.assetSource;
  if (!source || source.kind !== 'selectionHandle' || !source.selectionHandleId) {
    fail('space.removeAssets requires an assetSource selectionHandle');
  }
};

const SPACE_OP_VALIDATORS = {
  'space.updateDetails': validateSpaceUpdateDetails,
  'space.addMembers': validateSpaceAddMembers,
  'space.removeMembers': validateSpaceRemoveMembers,
  'space.updateMemberRole': validateSpaceUpdateMemberRole,
  'space.removeAssets': validateSpaceRemoveAssets,
};

// Relaxed validateAssetTrash: accepts EXACTLY ONE of:
//   - assetSource { kind: 'selectionHandle', selectionHandleId }
//   - assetIds (non-empty array)
//   - assetSelectionHandleId (string)
// Zero mechanisms → error; multiple mechanisms → error.
const validateAssetTrash = (op) => {
  if (op.targetKind !== 'asset_batch') fail('asset.trash requires targetKind "asset_batch"');
  if (op.targetId !== undefined) fail('asset.trash must not set targetId');
  if (op.temporaryTargetId !== undefined) fail('asset.trash must not set temporaryTargetId');
  if (op.payload !== undefined && Object.keys(op.payload).length > 0) fail('asset.trash must not set a payload');

  // Count how many selection mechanisms are present.
  const hasSource = op.assetSource !== undefined;
  const hasIds = op.assetIds !== undefined;
  const hasHandleId = op.assetSelectionHandleId !== undefined;
  const mechanismCount = Number(hasSource) + Number(hasIds) + Number(hasHandleId);

  if (mechanismCount === 0) {
    fail('asset.trash requires exactly one selection mechanism: assetSource (selectionHandle), assetIds, or assetSelectionHandleId');
  }
  if (mechanismCount > 1) {
    fail('asset.trash requires exactly one selection mechanism; multiple mechanisms are not allowed');
  }

  if (hasSource) {
    if (!op.assetSource || op.assetSource.kind !== 'selectionHandle' || !op.assetSource.selectionHandleId) {
      fail('asset.trash assetSource must be a selectionHandle with a selectionHandleId');
    }
  }
  if (hasIds) {
    if (!Array.isArray(op.assetIds) || op.assetIds.length === 0) {
      fail('asset.trash assetIds must be a non-empty array');
    }
  }
};

// Mirror asset.restore: same selection constraints as asset.trash but riskLevel low.
const validateAssetRestore = (op) => {
  if (op.targetKind !== 'asset_batch') fail('asset.restore requires targetKind "asset_batch"');
  if (op.targetId !== undefined) fail('asset.restore must not set targetId');
  if (op.temporaryTargetId !== undefined) fail('asset.restore must not set temporaryTargetId');
  if (op.payload !== undefined && Object.keys(op.payload).length > 0) fail('asset.restore must not set a payload');

  const hasSource = op.assetSource !== undefined;
  const hasIds = op.assetIds !== undefined;
  const hasHandleId = op.assetSelectionHandleId !== undefined;
  const mechanismCount = Number(hasSource) + Number(hasIds) + Number(hasHandleId);

  if (mechanismCount === 0) {
    fail('asset.restore requires exactly one selection mechanism: assetSource (selectionHandle), assetIds, or assetSelectionHandleId');
  }
  if (mechanismCount > 1) {
    fail('asset.restore requires exactly one selection mechanism; multiple mechanisms are not allowed');
  }

  if (hasSource) {
    if (!op.assetSource || op.assetSource.kind !== 'selectionHandle' || !op.assetSource.selectionHandleId) {
      fail('asset.restore assetSource must be a selectionHandle with a selectionHandleId');
    }
  }
  if (hasIds) {
    if (!Array.isArray(op.assetIds) || op.assetIds.length === 0) {
      fail('asset.restore assetIds must be a non-empty array');
    }
  }
};

// Mirror shareLink.createAlbum: album-targeted (existing_album + targetId required).
// No asset source/ids. Optional payload with same known keys.
export const validateShareLinkCreateAlbum = (op) => {
  if (op.targetKind !== 'existing_album') fail('shareLink.createAlbum requires targetKind "existing_album"');
  if (!op.targetId || typeof op.targetId !== 'string') fail('shareLink.createAlbum requires targetId (album id)');
  if (op.assetSource !== undefined) fail('shareLink.createAlbum must not set assetSource');
  if (op.assetIds !== undefined) fail('shareLink.createAlbum must not set assetIds');
  if (op.assetSelectionHandleId !== undefined) fail('shareLink.createAlbum must not set assetSelectionHandleId');
  if (op.payload !== undefined) {
    const p = op.payload;
    if (typeof p !== 'object' || p === null) fail('shareLink.createAlbum payload must be an object');
    const KNOWN_PAYLOAD_KEYS = new Set(['password', 'expiresAt', 'showMetadata', 'allowDownload']);
    for (const key of Object.keys(p)) {
      if (!KNOWN_PAYLOAD_KEYS.has(key)) fail(`shareLink.createAlbum: unknown payload key "${key}"`);
    }
    if (p.password !== undefined && (typeof p.password !== 'string' || !p.password)) {
      fail('shareLink.createAlbum payload.password must be a non-empty string');
    }
    if (p.expiresAt !== undefined) {
      if (typeof p.expiresAt !== 'string') fail('shareLink.createAlbum payload.expiresAt must be an ISO string');
      if (isNaN(new Date(p.expiresAt).getTime())) fail('shareLink.createAlbum payload.expiresAt must be a valid date');
    }
    if (p.showMetadata !== undefined && typeof p.showMetadata !== 'boolean') {
      fail('shareLink.createAlbum payload.showMetadata must be a boolean');
    }
    if (p.allowDownload !== undefined && typeof p.allowDownload !== 'boolean') {
      fail('shareLink.createAlbum payload.allowDownload must be a boolean');
    }
  }
};

// Mirror shareLinkCreatePayloadSchema: optional password, expiresAt (future ISO),
// showMetadata bool, allowDownload bool. targetKind must be asset_batch.
// assetSource selectionHandle required.
export const validateShareLinkCreate = (op) => {
  if (op.targetKind !== 'asset_batch') fail('shareLink.create requires targetKind "asset_batch"');
  if (op.targetId !== undefined) fail('shareLink.create must not set targetId');
  if (op.temporaryTargetId !== undefined) fail('shareLink.create must not set temporaryTargetId');
  const source = op.assetSource;
  if (!source || source.kind !== 'selectionHandle' || !source.selectionHandleId) {
    fail('shareLink.create requires an assetSource selectionHandle with selectionHandleId');
  }
  if (op.payload !== undefined) {
    const p = op.payload;
    if (typeof p !== 'object' || p === null) fail('shareLink.create payload must be an object');
    const KNOWN_PAYLOAD_KEYS = new Set(['password', 'expiresAt', 'showMetadata', 'allowDownload']);
    for (const key of Object.keys(p)) {
      if (!KNOWN_PAYLOAD_KEYS.has(key)) fail(`shareLink.create: unknown payload key "${key}"`);
    }
    if (p.password !== undefined && (typeof p.password !== 'string' || !p.password)) {
      fail('shareLink.create payload.password must be a non-empty string');
    }
    if (p.expiresAt !== undefined) {
      if (typeof p.expiresAt !== 'string') fail('shareLink.create payload.expiresAt must be an ISO string');
      if (isNaN(new Date(p.expiresAt).getTime())) fail('shareLink.create payload.expiresAt must be a valid date');
    }
    if (p.showMetadata !== undefined && typeof p.showMetadata !== 'boolean') {
      fail('shareLink.create payload.showMetadata must be a boolean');
    }
    if (p.allowDownload !== undefined && typeof p.allowDownload !== 'boolean') {
      fail('shareLink.create payload.allowDownload must be a boolean');
    }
  }
};

const validateAssetRemoveTag = (op) => {
  if (op.targetKind !== 'asset_batch') fail('asset.removeTag requires targetKind "asset_batch"');
  if (op.targetId !== undefined) fail('asset.removeTag must not set targetId');
  if (op.temporaryTargetId !== undefined) fail('asset.removeTag must not set temporaryTargetId');
  if (!op.payload || typeof op.payload.tagId !== 'string' || !op.payload.tagId) {
    fail('asset.removeTag requires payload.tagId (uuid)');
  }
  const source = op.assetSource;
  if (!source || source.kind !== 'selectionHandle' || !source.selectionHandleId) {
    fail('asset.removeTag requires an assetSource selectionHandle');
  }
};

const validateAlbumRemoveAssets = (op) => {
  if (op.targetKind !== 'existing_album') fail('album.removeAssets requires targetKind "existing_album"');
  if (!op.targetId) fail('album.removeAssets requires targetId');
  if (op.temporaryTargetId !== undefined) fail('album.removeAssets must not set temporaryTargetId');
  const source = op.assetSource;
  if (!source || source.kind !== 'selectionHandle' || !source.selectionHandleId) {
    fail('album.removeAssets requires an assetSource selectionHandle');
  }
};

const validateAlbumSetCover = (op) => {
  if (op.targetKind !== 'existing_album') fail('album.setCover requires targetKind "existing_album"');
  if (!op.targetId) fail('album.setCover requires targetId');
  if (op.payload !== undefined && Object.keys(op.payload).length > 0) fail('album.setCover payload must be empty');
  if (!Array.isArray(op.assetIds) || op.assetIds.length === 0) fail('album.setCover requires a non-empty cover assetIds');
  if (op.assetIds.length > 500) fail('album.setCover assetIds exceeds 500');
};

// Only editor/viewer are assignable to an album user (owner is not assignable).
const ASSIGNABLE_ALBUM_ROLES = new Set(['editor', 'viewer']);

const requireExistingAlbumTarget = (op) => {
  if (op.targetKind !== 'existing_album') fail(`${op.type} requires targetKind "existing_album"`);
  if (!op.targetId) fail(`${op.type} requires targetId`);
};

const validateAlbumAddUsers = (op) => {
  requireExistingAlbumTarget(op);
  const albumUsers = op.payload?.albumUsers;
  if (!Array.isArray(albumUsers) || albumUsers.length === 0)
    fail('album.addUsers requires a non-empty payload.albumUsers');
  for (const u of albumUsers) {
    if (!u?.userId) fail('album.addUsers albumUser requires userId');
    if (!ASSIGNABLE_ALBUM_ROLES.has(u.role)) fail('album.addUsers albumUser role must be editor or viewer');
  }
};

const validateAlbumRemoveUsers = (op) => {
  requireExistingAlbumTarget(op);
  const userIds = op.payload?.userIds;
  if (!Array.isArray(userIds) || userIds.length === 0) fail('album.removeUsers requires a non-empty payload.userIds');
};

const validateAlbumUpdateUserRole = (op) => {
  requireExistingAlbumTarget(op);
  if (!op.payload?.userId) fail('album.updateUserRole requires payload.userId');
  if (!ASSIGNABLE_ALBUM_ROLES.has(op.payload?.role)) fail('album.updateUserRole role must be editor or viewer');
};

// album.delete: requires existing_album + targetId, no payload (photos preserved).
const validateAlbumDelete = (op) => {
  requireExistingAlbumTarget(op);
  if (op.payload !== undefined && Object.keys(op.payload).length > 0)
    fail('album.delete must not set a payload (photos are kept in the library)');
};

// space.delete: requires existing_space + targetId, no payload (photos preserved).
const validateSpaceDelete = (op) => {
  requireExistingSpaceTarget(op);
  if (op.payload !== undefined && Object.keys(op.payload).length > 0)
    fail('space.delete must not set a payload (photos stay in members\' libraries)');
};

const ALBUM_OP_VALIDATORS = {
  'album.removeAssets': validateAlbumRemoveAssets,
  'album.setCover': validateAlbumSetCover,
  'album.addUsers': validateAlbumAddUsers,
  'album.removeUsers': validateAlbumRemoveUsers,
  'album.updateUserRole': validateAlbumUpdateUserRole,
  'album.delete': validateAlbumDelete,
  'space.delete': validateSpaceDelete,
  'asset.removeTag': validateAssetRemoveTag,
  'asset.trash': validateAssetTrash,
  'asset.restore': validateAssetRestore,
  'shareLink.create': validateShareLinkCreate,
  'shareLink.createAlbum': validateShareLinkCreateAlbum,
};

const validateOperations = (operations) => {
  if (!Array.isArray(operations) || operations.length === 0) fail('operations must be a non-empty array');
  for (const op of operations) {
    if (!op || !KNOWN_OPERATION_TYPES.has(op.type)) fail(`unknown operation type "${op?.type}"`);
    SPACE_OP_VALIDATORS[op.type]?.(op);
    ALBUM_OP_VALIDATORS[op.type]?.(op);
  }
};

const validateSearchAssets = (args) => {
  const mode = args.mode ?? 'metadata';
  if (!SEARCH_TEXT_MODES.has(mode) && args.query !== undefined) {
    fail(`query is only supported for smart/description/ocr/filename modes (mode=${mode}, e.g. metadata)`);
  }
  if (args.detail !== undefined && !SEARCH_DETAILS.has(args.detail)) fail(`invalid searchAssets detail "${args.detail}"`);
  if (args.filters !== undefined) {
    if (typeof args.filters !== 'object' || args.filters === null) fail('searchAssets filters must be an object');
    for (const key of Object.keys(args.filters)) {
      if (!KNOWN_SEARCH_FILTER_KEYS.has(key)) fail(`unknown searchAssets filter key "${key}"`);
    }
    if (args.filters.type !== undefined && !KNOWN_ASSET_TYPES.has(args.filters.type)) {
      fail(`invalid searchAssets filter type "${args.filters.type}"`);
    }
    if (args.filters.rating !== undefined && args.filters.rating !== null) {
      const r = args.filters.rating;
      if (typeof r !== 'number' || !Number.isInteger(r) || r < 1 || r > 5) {
        fail(`invalid searchAssets filter rating "${r}"`);
      }
    }
    if (args.filters.visibility !== undefined && !KNOWN_VISIBILITY.has(args.filters.visibility)) {
      fail(`invalid searchAssets filter visibility "${args.filters.visibility}"`);
    }
    if (Array.isArray(args.filters.spacePersonIds) && args.filters.spacePersonIds.length > 0 && !args.filters.spaceId) {
      fail('spacePersonIds requires spaceId');
    }
    if (args.filters.spaceId && args.filters.withSharedSpaces === true) {
      fail('Cannot use both spaceId and withSharedSpaces');
    }
    for (const key of QUALITY_FILTER_KEYS) {
      const value = args.filters[key];
      if (value === undefined) continue;
      if (typeof value !== 'number' || !Number.isInteger(value) || value < 0 || value > 100) {
        fail(`invalid searchAssets filter ${key} "${value}"`);
      }
    }
  }
};

const ok = (config) => config.planResult ?? { status: 'success', plan: { id: 'plan-1' } };

// Validate listDuplicateGroups request shape: optional maxGroups must be int 1..500.
const validateListDuplicateGroupsRequest = (args) => {
  if (!args || typeof args !== 'object') return; // empty {} is valid
  const keys = Object.keys(args).filter((k) => k !== 'toolCallId');
  for (const key of keys) {
    if (key !== 'maxGroups') fail(`listDuplicateGroups: unrecognized key "${key}"`);
  }
  if (args.maxGroups !== undefined) {
    if (typeof args.maxGroups !== 'number' || !Number.isInteger(args.maxGroups) || args.maxGroups < 1) {
      fail('listDuplicateGroups: maxGroups must be an integer >= 1');
    }
    if (args.maxGroups > 500) {
      fail('listDuplicateGroups: maxGroups must be <= 500');
    }
  }
};

/**
 * Build a contract-faithful fake MCP client.
 * @param config.albums            albums returned by listAlbums
 * @param config.spaces            spaces (each may carry `members`) for listSpaces/readSpace
 * @param config.users            users returned by searchUsers
 * @param config.people            people returned by searchPeople (array of {id, name, faceAssetId?})
 * @param config.peopleResult      explicit override for the searchPeople tool result (bypasses name matching)
 * @param config.handleAssetCount  assetCount on the searchAssets selection handle
 * @param config.handleAssetCounts assetCounts for successive derived handles
 * @param config.planResult        override for the propose* tool results
 * @param config.duplicateGroups   groups returned by listDuplicateGroups
 */
export const makeContractClient = (config = {}) => {
  const {
    albums = [{ id: 'alb-1', albumName: 'Family' }],
    spaces = [{ id: 'spc-1', name: 'Family', members: [] }],
    users = [{ userId: 'usr-1', name: 'Alex', email: 'alex@example.com' }],
    people = [],
    peopleResult,
    handleAssetCount = 20,
    handleAssetCounts,
    resolvedFilters,
    resolveResults,
    duplicateGroups = [],
  } = config;
  const calls = [];
  const nextHandleAssetCount = () =>
    Array.isArray(handleAssetCounts) && handleAssetCounts.length > 0
      ? handleAssetCounts[Math.min(calls.filter((c) => c.name === 'searchAssets' || c.name === 'curateSelection').length - 1, handleAssetCounts.length - 1)]
      : handleAssetCount;

  const handlers = {
    listAlbums: () => ({ albums }),
    readAlbum: (args) => {
      const album = albums.find((candidate) => candidate.id === args?.albumId);
      if (!album) fail(`album not found: ${args?.albumId}`);
      // The real readAlbum success response NESTS the detail under `album`
      // (AgentReadAlbumToolResponse { …, album: AgentAlbumDetail }). Mirror that so a
      // workflow reading the wrong field (e.g. top-level `assetIds`) fails in L2 too.
      return {
        album: {
          id: album.id,
          albumName: album.albumName,
          ownerId: album.ownerId ?? null,
          assetIds: album.assetIds ?? [],
          albumThumbnailAssetId: album.albumThumbnailAssetId ?? null,
          albumUsers: album.albumUsers ?? [],
        },
      };
    },
    listSpaces: () => ({ spaces: spaces.map(({ members, ...summary }) => summary) }),
    readSpace: (args) => {
      const space = spaces.find((candidate) => candidate.id === args?.spaceId);
      if (!space) fail(`space not found: ${args?.spaceId}`);
      return { ...space, members: space.members ?? [] };
    },
    // Mirror the real searchUsers: filter by query (substring on name/email) so
    // distinct queries resolve distinct users, and ambiguity/not-found are testable.
    searchUsers: (args) => {
      const q = String(args?.query ?? '').trim().toLowerCase();
      if (!q) return { users };
      return { users: users.filter((u) => `${u.name ?? ''} ${u.email ?? ''}`.toLowerCase().includes(q)) };
    },
    resolveAssetSearchFilters: (args) => {
      validateResolveRequest(args);
      // Config-gated rich return for entity-resolution tests; default stays the legacy
      // `{ resolvedFilters: {} }` so existing assertions and non-entity callers are unchanged.
      if (resolvedFilters !== undefined || resolveResults !== undefined) {
        return { resolvedFilters: resolvedFilters ?? {}, results: resolveResults ?? [] };
      }
      return { resolvedFilters: {} };
    },
    searchAssets: (args) => {
      validateSearchAssets(args ?? {});
      return { selectionHandle: { id: 'handle-1', assetCount: nextHandleAssetCount() } };
    },
    curateSelection: (args) => {
      if (!args?.selectionHandleId) fail('curateSelection requires selectionHandleId');
      if (!Number.isInteger(args?.targetCount) || args.targetCount < 1) fail('curateSelection requires targetCount');
      const constraints = args.constraints ?? {};
      if (constraints.types !== undefined) {
        if (!Array.isArray(constraints.types) || constraints.types.some((type) => !KNOWN_ASSET_TYPES.has(type))) {
          fail('curateSelection constraints.types must be valid asset types');
        }
      }
      for (const key of QUALITY_FILTER_KEYS) {
        const value = constraints[key];
        if (value === undefined) continue;
        if (typeof value !== 'number' || !Number.isInteger(value) || value < 0 || value > 100) {
          fail(`invalid curateSelection constraint ${key} "${value}"`);
        }
      }
      return { selectionHandle: { id: 'handle-2', assetCount: nextHandleAssetCount() } };
    },
    proposeAssetBatchFromSelection: (args) => {
      validateBatchAction(args?.action);
      if (!args?.selectionHandleId) fail('proposeAssetBatchFromSelection requires selectionHandleId');
      return ok(config);
    },
    proposeAddAssetsToSpaceFromSearch: (args) => {
      if (Boolean(args?.spaceId) === Boolean(args?.spaceName)) {
        fail('proposeAddAssetsToSpaceFromSearch requires exactly one of spaceId or spaceName');
      }
      const source = args?.assetSource;
      if (!source || typeof source !== 'object') fail('proposeAddAssetsToSpaceFromSearch requires an assetSource');
      if (source.kind === 'selectionHandle' && !source.selectionHandleId) {
        fail('selectionHandle assetSource requires selectionHandleId');
      }
      return ok(config);
    },
    searchPeople: (args) => {
      const name = String(args?.name ?? '').trim();
      if (peopleResult !== undefined) return { people: peopleResult };
      if (!name) return { people: { status: 'not_found' } };
      const matches = people.filter((p) => p.name.toLowerCase() === name.toLowerCase());
      if (matches.length === 1) return { people: { status: 'matched', personId: matches[0].id, name: matches[0].name, thumbnailAssetId: matches[0].faceAssetId ?? null } };
      if (matches.length > 1) return { people: { status: 'ambiguous', choices: matches.map((p) => ({ personId: p.id, name: p.name, thumbnailAssetId: p.faceAssetId ?? null })) } };
      return { people: { status: 'not_found' } };
    },
    listDuplicateGroups: (args) => {
      validateListDuplicateGroupsRequest(args);
      const maxGroups = args?.maxGroups ?? 50;
      return { groups: duplicateGroups.slice(0, maxGroups) };
    },
    proposeAlbumOperations: (args) => {
      validateOperations(args?.operations);
      return ok(config);
    },
    proposeAlbumFromSelection: (args) => {
      if (!args?.albumName) fail('proposeAlbumFromSelection requires albumName');
      if (!args?.selectionHandleId) fail('proposeAlbumFromSelection requires selectionHandleId');
      return ok(config);
    },
    proposeSpaceFromSearch: (args) => {
      if (!args || typeof args !== 'object') fail('proposeSpaceFromSearch requires an object');
      for (const key of Object.keys(args)) {
        if (!KNOWN_SPACE_FROM_SEARCH_KEYS.has(key)) fail(`proposeSpaceFromSearch: unknown key "${key}"`);
      }
      if (typeof args.spaceName !== 'string' || args.spaceName.trim().length === 0) {
        fail('proposeSpaceFromSearch requires a non-empty spaceName');
      }
      const source = args.assetSource;
      if (!source || typeof source !== 'object') fail('proposeSpaceFromSearch requires an assetSource');
      if (!KNOWN_ASSET_SOURCE_KINDS.has(source.kind)) fail(`proposeSpaceFromSearch assetSource kind "${source.kind}" is invalid`);
      if (source.kind === 'selectionHandle' && !source.selectionHandleId) {
        fail('selectionHandle assetSource requires selectionHandleId');
      }
      if (args.color !== undefined && !KNOWN_AVATAR_COLORS.has(args.color)) {
        fail(`proposeSpaceFromSearch color "${args.color}" is invalid`);
      }
      return ok(config);
    },
  };

  return {
    calls,
    async call(name, args) {
      calls.push({ name, args });
      const handler = handlers[name];
      if (!handler) fail(`unexpected tool call: ${name}`);
      return handler(args);
    },
  };
};
