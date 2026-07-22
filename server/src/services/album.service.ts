import { BadRequestException, Injectable } from '@nestjs/common';
import { AlbumNameDto } from 'src/dtos/album-name.dto';
import {
  AddUsersDto,
  AlbumResponseDto,
  AlbumsAddAssetsDto,
  AlbumsAddAssetsResponseDto,
  AlbumStatisticsResponseDto,
  CreateAlbumDto,
  GetAlbumsDto,
  mapAlbum,
  UpdateAlbumDto,
  UpdateAlbumUserDto,
} from 'src/dtos/album.dto';
import { BulkIdErrorReason, BulkIdResponseDto, BulkIdsDto } from 'src/dtos/asset-ids.response.dto';
import { AuthDto } from 'src/dtos/auth.dto';
import { MapMarkerResponseDto } from 'src/dtos/map.dto';
import { AlbumUserRole, JobName, Permission } from 'src/enum';
import { AlbumAssetCount, AlbumInfoOptions } from 'src/repositories/album.repository';
import { BaseService } from 'src/services/base.service';
import { hasDirectAlbumReadAccess } from 'src/utils/access';
import { addAssets, removeAssets } from 'src/utils/asset.util';
import { asDateTimeString } from 'src/utils/date';
import { findOrFail } from 'src/utils/misc';
import { getPreferences } from 'src/utils/preferences';

@Injectable()
export class AlbumService extends BaseService {
  async getStatistics(auth: AuthDto): Promise<AlbumStatisticsResponseDto> {
    const [owned, shared, notShared] = await Promise.all([
      this.albumRepository.getAll(auth.user.id, { isOwned: true }),
      this.albumRepository.getAll(auth.user.id, { isShared: true }),
      this.albumRepository.getAll(auth.user.id, { isOwned: true, isShared: false }),
    ]);

    return {
      owned: owned.length,
      shared: shared.length,
      notShared: notShared.length,
    };
  }

  async getNames(auth: AuthDto): Promise<AlbumNameDto[]> {
    const [owned, shared] = await Promise.all([
      this.albumRepository.getOwnedNames(auth.user.id),
      this.albumRepository.getSharedNames(auth.user.id),
    ]);
    return [
      ...owned.map((r) => ({
        ...r,
        shared: false,
        startDate: asDateTimeString(r.startDate ?? undefined),
        endDate: asDateTimeString(r.endDate ?? undefined),
      })),
      ...shared.map((r) => ({
        ...r,
        shared: true,
        startDate: asDateTimeString(r.startDate ?? undefined),
        endDate: asDateTimeString(r.endDate ?? undefined),
      })),
    ];
  }

  async getAll(auth: AuthDto, { assetId, ...rest }: GetAlbumsDto): Promise<AlbumResponseDto[]> {
    const ownerId = auth.user.id;
    await this.albumRepository.updateThumbnails();

    const albums = assetId
      ? await this.albumRepository.getByAssetId(ownerId, assetId)
      : await this.albumRepository.getAll(ownerId, rest);

    if (albums.length === 0) {
      return [];
    }

    // Get asset count for each album. Then map the result to an object:
    // { [albumId]: assetCount }
    const results = await this.albumRepository.getMetadataForIds(
      albums.map((album) => album.id),
      { forUserId: auth.user.id },
    );
    const albumMetadata: Record<string, AlbumAssetCount> = {};
    for (const metadata of results) {
      albumMetadata[metadata.albumId] = metadata;
    }

    return albums.map((album) => ({
      ...mapAlbum(album),
      sharedLinks: undefined,
      startDate: asDateTimeString(albumMetadata[album.id]?.startDate ?? undefined),
      endDate: asDateTimeString(albumMetadata[album.id]?.endDate ?? undefined),
      assetCount: albumMetadata[album.id]?.assetCount ?? 0,
      // lastModifiedAssetTimestamp is only used in mobile app, please remove if not need
      lastModifiedAssetTimestamp: asDateTimeString(albumMetadata[album.id]?.lastModifiedAssetTimestamp ?? undefined),
    }));
  }

  async get(auth: AuthDto, id: string): Promise<AlbumResponseDto> {
    await this.requireAccess({ auth, permission: Permission.AlbumRead, ids: [id] });
    await this.albumRepository.updateThumbnails();
    const album = await this.findOrFail(id, auth.user.id, { withAssets: false });
    const [albumMetadataForIds] = await this.albumRepository.getMetadataForIds([album.id], {
      forUserId: auth.sharedLink ? undefined : auth.user.id,
    });

    const hasSharedUsers = album.albumUsers && album.albumUsers.length > 1;
    const hasSharedLink = album.sharedLinks && album.sharedLinks.length > 0;
    const isShared = hasSharedUsers || hasSharedLink;

    const mapped = mapAlbum(album);

    // security-8: a caller who reaches the album ONLY through shared-space membership (not the album owner
    // or a shared album_user) must not see other participants' PII (id / name / role / profile image /
    // email). Strip albumUsers down to the album owner (display name only, email redacted), matching
    // getLinkedAlbums; genuine participants and shared-link callers keep the full list.
    const hasDirectAccess =
      !!auth.sharedLink || (await hasDirectAlbumReadAccess(this.accessRepository, auth.user.id, id));
    if (!hasDirectAccess) {
      const ownerAlbumUser = mapped.albumUsers.find(({ role }) => role === AlbumUserRole.Owner);
      mapped.albumUsers = ownerAlbumUser ? [ownerAlbumUser] : mapped.albumUsers.slice(0, 1);
      for (const albumUser of mapped.albumUsers) {
        albumUser.user.email = '';
      }
    }

    // rbac-6: the album OWNER (and only the owner) sees the list of shared spaces this album is
    // linked into, so they can review + revoke links (a space editor can link an owner's album).
    // Non-owner callers — including album editors/viewers and space-only readers — get no list.
    // A shared-link visitor is explicitly excluded even though checkOwnerAccess would return true
    // for one (shared-link AuthDto.user.id resolves to the link creator/album owner for access
    // checks) — a public link is not an authenticated owner session and must never expose the
    // owner-only space-link list to whoever holds the link URL.
    let isAlbumOwner = false;
    if (!auth.sharedLink) {
      const ownerIds = await this.accessRepository.album.checkOwnerAccess(auth.user.id, new Set([id]));
      isAlbumOwner = ownerIds.has(id);
    }
    let sharedSpaceLinks: AlbumResponseDto['sharedSpaceLinks'];
    if (isAlbumOwner) {
      const links = await this.sharedSpaceRepository.getAlbumSpaceLinks(id);
      // Omit the field entirely when the album has no space links, so a plain album's response shape is
      // unchanged (the field only appears for the owner when there is at least one link to surface).
      if (links.length > 0) {
        sharedSpaceLinks = links.map((link) => ({
          spaceId: link.spaceId,
          spaceName: link.spaceName,
          linkedById: link.linkedById,
          showInTimeline: link.showInTimeline,
        }));
      }
    }

    return {
      ...mapped,
      startDate: asDateTimeString(albumMetadataForIds?.startDate ?? undefined),
      endDate: asDateTimeString(albumMetadataForIds?.endDate ?? undefined),
      assetCount: albumMetadataForIds?.assetCount ?? 0,
      lastModifiedAssetTimestamp: asDateTimeString(albumMetadataForIds?.lastModifiedAssetTimestamp ?? undefined),
      // L1: contributorCounts exposes contributor userIds + per-user asset counts — the same PII
      // security-8 already gated the rest of albumUsers behind. A space-only reader (hasDirectAccess
      // false) must not see it, matching the albumUsers redaction above.
      contributorCounts:
        isShared && hasDirectAccess ? await this.albumRepository.getContributorCounts(album.id) : undefined,
      sharedSpaceLinks,
    };
  }

  async getMapMarkers(auth: AuthDto, id: string): Promise<MapMarkerResponseDto[]> {
    await this.requireAccess({ auth, permission: Permission.AlbumRead, ids: [id] });

    if (auth.sharedLink && !auth.sharedLink.showExif) {
      return [];
    }

    // Album membership (verified above via AlbumRead) is the access boundary: every reader of the
    // album — owner, editor, or viewer — sees pins for all geotagged assets in it, just like the
    // album grid does. Do not scope by asset owner here; doing so hid the owner's pins from
    // viewers of a shared album (#656).
    return this.mapRepository.getAlbumMapMarkers(id);
  }

  async create(auth: AuthDto, dto: CreateAlbumDto): Promise<AlbumResponseDto> {
    const albumUsers = (dto.albumUsers || []).filter(({ userId }) => userId !== auth.user.id);

    for (const { userId } of albumUsers) {
      const exists = await this.userRepository.get(userId, {});
      if (!exists) {
        this.logger.debug('Album creation failed: user not found');
        throw new BadRequestException('Invalid user');
      }
    }

    const allowedAssetIdsSet = await this.checkAccess({
      auth,
      permission: Permission.AssetShare,
      ids: dto.assetIds || [],
    });
    const assetIds = [...allowedAssetIdsSet].map((id) => id);

    const userMetadata = await this.userRepository.getMetadata(auth.user.id);

    const album = await this.albumRepository.create(
      {
        albumName: dto.albumName,
        description: dto.description,
        albumThumbnailAssetId: assetIds[0] || null,
        order: getPreferences(userMetadata).albums.defaultAssetOrder,
      },
      assetIds,
      [{ userId: auth.user.id, role: AlbumUserRole.Owner }, ...albumUsers],
      auth.user.id,
    );

    for (const { userId } of albumUsers) {
      await this.eventRepository.emit('AlbumInvite', { id: album.id, userId, senderName: auth.user.name });
    }

    return mapAlbum(album);
  }

  async update(auth: AuthDto, id: string, dto: UpdateAlbumDto): Promise<AlbumResponseDto> {
    await this.requireAccess({ auth, permission: Permission.AlbumUpdate, ids: [id] });

    const album = await this.findOrFail(id, auth.user.id, { withAssets: true });

    if (dto.albumThumbnailAssetId) {
      const results = await this.albumRepository.getAssetIds(id, [dto.albumThumbnailAssetId]);
      if (results.size === 0) {
        throw new BadRequestException('Invalid album thumbnail');
      }
    }
    const updatedAlbum = await this.albumRepository.update(
      album.id,
      {
        id: album.id,
        albumName: dto.albumName,
        description: dto.description,
        albumThumbnailAssetId: dto.albumThumbnailAssetId,
        isActivityEnabled: dto.isActivityEnabled,
        order: dto.order,
      },
      auth.user.id,
    );

    return mapAlbum({ ...updatedAlbum, assets: album.assets });
  }

  async delete(auth: AuthDto, id: string): Promise<void> {
    await this.requireAccess({ auth, permission: Permission.AlbumDelete, ids: [id] });
    await this.eventRepository.emit('AlbumDelete', { albumId: id });
    await this.albumRepository.delete(id);
  }

  async addAssets(auth: AuthDto, id: string, dto: BulkIdsDto): Promise<BulkIdResponseDto[]> {
    const album = await this.findOrFail(id, auth.user.id, { withAssets: false });
    await this.requireAccess({ auth, permission: Permission.AlbumAssetCreate, ids: [id] });

    // Ordinary path: assets the caller owns / has AssetShare on land in `album_asset`.
    const results = await addAssets(
      auth,
      { access: this.accessRepository, bulk: this.albumRepository },
      { parentId: id, assetIds: dto.ids, permission: Permission.AssetShare },
    );

    // #764 cross-owner contributions: assets denied above (not owned / no partner share) may still be
    // added as space bookmarks when the album is space-linked and the caller is a space Editor of the
    // space the asset is visible through. These go to `album_space_asset`, never `album_asset`, so the
    // album owner never gains a permanent grant.
    const contributedIds = await this.tryContributeDeniedAssets(auth, id, results);

    // Only the caller's OWN newly-added assets (real `album_asset` rows) drive the thumbnail default
    // and the face/sync event — a contribution is a bookmark with no `album_asset` row.
    const ownedNewAssetIds = results
      .filter(({ success, id: assetId }) => success && !contributedIds.has(assetId))
      .map(({ id: assetId }) => assetId);
    const firstNewAssetId = ownedNewAssetIds[0];
    if (firstNewAssetId) {
      await this.albumRepository.update(
        id,
        {
          id,
          updatedAt: new Date(),
          albumThumbnailAssetId: album.albumThumbnailAssetId ?? firstNewAssetId,
        },
        auth.user.id,
      );

      const userIds = album.albumUsers.map(({ user }) => user.id);
      const recipientIds = userIds.filter((userId) => userId !== auth.user.id);
      await this.eventRepository.emit('AlbumUpdate', { id, userIds, recipientIds });

      await this.eventRepository.emit('AlbumAssetsAdd', { albumId: id, assetIds: ownedNewAssetIds });
    }

    return results;
  }

  /**
   * #764: upgrade `no_permission` results to cross-owner contributions where eligible. Mutates
   * `results` in place (denied → success, or → duplicate if already contributed) and returns the set
   * of asset ids that became contributions.
   */
  private async tryContributeDeniedAssets(
    auth: AuthDto,
    albumId: string,
    results: BulkIdResponseDto[],
  ): Promise<Set<string>> {
    const contributedIds = new Set<string>();
    const deniedIds = results
      .filter(({ success, error }) => !success && error === BulkIdErrorReason.NO_PERMISSION)
      .map(({ id }) => id);
    if (deniedIds.length === 0) {
      return contributedIds;
    }

    const [contributable, alreadyContributed] = await Promise.all([
      this.sharedSpaceRepository.getContributableAssetSpaces(auth.user.id, albumId, deniedIds),
      this.albumRepository.getContributedAssetIds(albumId, deniedIds),
    ]);
    const spaceByAsset = new Map(contributable.map(({ assetId, spaceId }) => [assetId, spaceId]));

    const toInsert: { albumId: string; assetId: string; spaceId: string; addedById: string }[] = [];
    for (const result of results) {
      if (result.success || result.error !== BulkIdErrorReason.NO_PERMISSION) {
        continue;
      }
      if (alreadyContributed.has(result.id)) {
        result.error = BulkIdErrorReason.DUPLICATE;
        continue;
      }
      const spaceId = spaceByAsset.get(result.id);
      if (spaceId) {
        toInsert.push({ albumId, assetId: result.id, spaceId, addedById: auth.user.id });
        result.success = true;
        delete result.error;
        contributedIds.add(result.id);
      }
    }

    if (toInsert.length > 0) {
      await this.albumRepository.addContributedAssets(toInsert);
      // D3 (#752 P1-7): a contribution's faces must reach space People without waiting for a coarse
      // reconcile trigger — enqueue the targeted per-asset match, mirroring the space-pool add path
      // (SharedSpaceService.addAssets). The handler re-guards on space + faceRecognitionEnabled.
      const spaceIds = [...new Set(toInsert.map(({ spaceId }) => spaceId))];
      const spaces = await Promise.all(spaceIds.map((spaceId) => this.sharedSpaceRepository.getById(spaceId)));
      const faceEnabled = new Set(spaces.filter((space) => space?.faceRecognitionEnabled).map((space) => space!.id));
      const jobs = toInsert
        .filter(({ spaceId }) => faceEnabled.has(spaceId))
        .map(({ spaceId, assetId }) => ({ name: JobName.SharedSpaceFaceMatch as const, data: { spaceId, assetId } }));
      if (jobs.length > 0) {
        await this.jobRepository.queueAll(jobs);
      }
    }
    return contributedIds;
  }

  async addAssetsToAlbums(auth: AuthDto, dto: AlbumsAddAssetsDto): Promise<AlbumsAddAssetsResponseDto> {
    const results: AlbumsAddAssetsResponseDto = {
      success: false,
      error: BulkIdErrorReason.DUPLICATE,
    };

    const allowedAlbumIds = await this.checkAccess({
      auth,
      permission: Permission.AlbumAssetCreate,
      ids: dto.albumIds,
    });
    if (allowedAlbumIds.size === 0) {
      results.error = BulkIdErrorReason.NO_PERMISSION;
      return results;
    }

    const allowedAssetIds = await this.checkAccess({ auth, permission: Permission.AssetShare, ids: dto.assetIds });
    if (allowedAssetIds.size === 0) {
      results.error = BulkIdErrorReason.NO_PERMISSION;
      return results;
    }

    const albumAssetValues: { albumId: string; assetId: string }[] = [];
    const events: { id: string; userIds: string[]; recipientIds: string[] }[] = [];
    for (const albumId of allowedAlbumIds) {
      const existingAssetIds = await this.albumRepository.getAssetIds(albumId, [...allowedAssetIds]);
      const notPresentAssetIds = [...allowedAssetIds.difference(existingAssetIds)];
      if (notPresentAssetIds.length === 0) {
        continue;
      }
      const album = await this.findOrFail(albumId, auth.user.id, { withAssets: false });
      results.error = undefined;
      results.success = true;

      for (const assetId of notPresentAssetIds) {
        albumAssetValues.push({ albumId, assetId });
      }
      await this.albumRepository.update(
        albumId,
        {
          id: albumId,
          updatedAt: new Date(),
          albumThumbnailAssetId: album.albumThumbnailAssetId ?? notPresentAssetIds[0],
        },
        auth.user.id,
      );
      const userIds = album.albumUsers.map(({ user }) => user.id);
      const recipientIds = userIds.filter((userId) => userId !== auth.user.id);
      events.push({ id: albumId, userIds, recipientIds });
    }

    await this.albumRepository.addAssetIdsToAlbums(albumAssetValues);
    for (const event of events) {
      await this.eventRepository.emit('AlbumUpdate', event);
    }

    // Best-effort space people sync: albumAssetValues already excludes assets present in the
    // album (the notPresentAssetIds filter above), so in the normal path these are exactly the
    // newly-inserted rows. A concurrent insert could make addAssetIdsToAlbums' onConflict-do-nothing
    // skip one; the downstream SharedSpaceFaceMatch is idempotent and guards on isAssetInSpace, so a
    // spurious id is harmless. We accept best-effort here rather than plumbing inserted ids back.
    const addedByAlbum = new Map<string, string[]>();
    for (const { albumId, assetId } of albumAssetValues) {
      const ids = addedByAlbum.get(albumId);
      if (ids) {
        ids.push(assetId);
      } else {
        addedByAlbum.set(albumId, [assetId]);
      }
    }
    for (const [albumId, assetIds] of addedByAlbum) {
      await this.eventRepository.emit('AlbumAssetsAdd', { albumId, assetIds });
    }

    return results;
  }

  async removeAssets(auth: AuthDto, id: string, dto: BulkIdsDto): Promise<BulkIdResponseDto[]> {
    // AlbumAssetDelete (#752) = album owner/editor OR space owner/editor of the linked space; a space
    // Viewer or non-member is refused here (403) before any row is touched — the remove RBAC gate.
    await this.requireAccess({ auth, permission: Permission.AlbumAssetDelete, ids: [id] });

    const album = await this.findOrFail(id, auth.user.id, { withAssets: false });
    const results = await removeAssets(
      auth,
      { access: this.accessRepository, bulk: this.albumRepository },
      { parentId: id, assetIds: dto.ids, canAlwaysRemove: Permission.AlbumDelete },
    );
    const albumAssetRemovedIds = results.filter(({ success }) => success).map(({ id }) => id);

    // #764: a contribution is never in `album_asset`, so the util reports it NOT_FOUND. The caller
    // already passed AlbumAssetDelete above, so removing it (deleting the `album_space_asset` row) is
    // authorized. The underlying asset is untouched.
    const notFoundIds = results
      .filter(({ success, error }) => !success && error === BulkIdErrorReason.NOT_FOUND)
      .map(({ id: assetId }) => assetId);
    if (notFoundIds.length > 0) {
      const contributed = await this.albumRepository.getContributedAssetIds(id, notFoundIds);
      if (contributed.size > 0) {
        await this.albumRepository.removeContributedAssetIds(id, [...contributed]);
        for (const result of results) {
          if (!contributed.has(result.id)) {
            continue;
          }

          result.success = true;
          delete result.error;
        }
      }
    }

    const removedIds = results.filter(({ success }) => success).map(({ id }) => id);
    if (removedIds.length > 0) {
      if (album.albumThumbnailAssetId && removedIds.includes(album.albumThumbnailAssetId)) {
        await this.albumRepository.updateThumbnails();
      }

      await this.eventRepository.emit('AlbumUpdate', {
        id,
        userIds: album.albumUsers.map(({ user }) => user.id),
        recipientIds: [],
      });
    }
    // Face/sync cleanup only applies to real album_asset rows, not contributions.
    if (albumAssetRemovedIds.length > 0) {
      await this.eventRepository.emit('AlbumAssetsRemove', { albumId: id, assetIds: albumAssetRemovedIds });
    }

    return results;
  }

  async addUsers(auth: AuthDto, id: string, { albumUsers }: AddUsersDto): Promise<AlbumResponseDto> {
    await this.requireAccess({ auth, permission: Permission.AlbumShare, ids: [id] });

    const album = await this.findOrFail(id, auth.user.id, { withAssets: false });

    for (const { userId, role } of albumUsers) {
      if (role === AlbumUserRole.Owner) {
        throw new BadRequestException('Cannot add another owner');
      }

      const exists = album.albumUsers.some(({ user: { id } }) => id === userId);
      if (exists) {
        continue;
      }

      const user = await this.userRepository.get(userId, {});
      if (!user) {
        this.logger.debug('Adding user to album failed: user not found');
        throw new BadRequestException('Invalid user');
      }

      await this.albumUserRepository.create({ userId, albumId: id, role });
      await this.eventRepository.emit('AlbumInvite', { id, userId, senderName: auth.user.name });
    }

    return mapAlbum(await this.findOrFail(id, auth.user.id, { withAssets: true }));
  }

  async removeUser(auth: AuthDto, id: string, userId: string | 'me'): Promise<void> {
    if (userId === 'me') {
      userId = auth.user.id;
    }

    const album = await this.findOrFail(id, auth.user.id, { withAssets: false });

    const exists = album.albumUsers.find(({ user: { id } }) => id === userId);
    if (!exists) {
      throw new BadRequestException('Album not shared with user');
    }

    if (
      exists.role === AlbumUserRole.Owner &&
      album.albumUsers.filter(({ role }) => role === AlbumUserRole.Owner).length === 1
    ) {
      throw new BadRequestException('Cannot remove the last album owner');
    }

    // non-admin can remove themselves
    if (auth.user.id !== userId) {
      await this.requireAccess({ auth, permission: Permission.AlbumShare, ids: [id] });
    }

    await this.albumUserRepository.delete({ albumId: id, userId });
  }

  async updateUser(auth: AuthDto, id: string, userId: string, dto: UpdateAlbumUserDto): Promise<void> {
    await this.requireAccess({ auth, permission: Permission.AlbumShare, ids: [id] });

    const album = await this.findOrFail(id, userId, { withAssets: false });
    const owner = album.albumUsers[0];

    if (owner.user.id === userId) {
      throw new BadRequestException('User is owner');
    }

    await this.albumUserRepository.update({ albumId: id, userId }, { role: dto.role });
  }

  private findOrFail(id: string, authUserId: string, options: AlbumInfoOptions) {
    return findOrFail(() => this.albumRepository.getById(id, options, authUserId), 'Album');
  }
}
