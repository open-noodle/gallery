import { BadRequestException, ForbiddenException, Injectable, UnauthorizedException } from '@nestjs/common';
import { PostgresError } from 'postgres';
import { AssetIdErrorReason, AssetIdsResponseDto } from 'src/dtos/asset-ids.response.dto';
import { AssetIdsDto } from 'src/dtos/asset.dto';
import { AuthDto } from 'src/dtos/auth.dto';
import {
  mapSharedLink,
  SharedLinkCreateDto,
  SharedLinkEditDto,
  SharedLinkLoginDto,
  SharedLinkResponseDto,
  SharedLinkSearchDto,
} from 'src/dtos/shared-link.dto';
import { Permission, SharedLinkType, SharedSpaceRole } from 'src/enum';
import { BaseService } from 'src/services/base.service';
import { findOrFail, getExternalDomain, OpenGraphTags } from 'src/utils/misc';
import { sharedLinkPublisherRoles } from 'src/utils/shared-link-space-tether';

@Injectable()
export class SharedLinkService extends BaseService {
  async getAll(auth: AuthDto, { id, albumId }: SharedLinkSearchDto): Promise<SharedLinkResponseDto[]> {
    return this.sharedLinkRepository
      .getAll({ userId: auth.user.id, id, albumId })

      .then((links) => links.map((link) => mapSharedLink(link, { stripAssetMetadata: false })));
  }

  async login(auth: AuthDto, dto: SharedLinkLoginDto) {
    if (!auth.sharedLink) {
      throw new ForbiddenException();
    }

    const sharedLink = await this.findOrFail(auth.user.id, auth.sharedLink.id);
    const { id, password } = sharedLink;

    if (!password) {
      throw new BadRequestException('Shared link is not password protected');
    }

    if (password !== dto.password) {
      throw new UnauthorizedException('Invalid password');
    }

    return {
      // Anonymous visitor path — redact who owns what (#1018).
      sharedLink: mapSharedLink(sharedLink, {
        stripAssetMetadata: !sharedLink.showExif,
        redactAssetOwners: true,
      }),
      token: this.asToken({ id, password }),
    };
  }

  async getMine(auth: AuthDto, authTokens: string[]) {
    if (!auth.sharedLink) {
      throw new ForbiddenException();
    }

    const sharedLink = await this.findOrFail(auth.user.id, auth.sharedLink.id);
    const { id, password } = sharedLink;

    if (password && !authTokens.includes(this.asToken({ id, password }))) {
      throw new UnauthorizedException('Password required');
    }

    // Anonymous visitor path — redact who owns what (#1018).
    return mapSharedLink(sharedLink, { stripAssetMetadata: !sharedLink.showExif, redactAssetOwners: true });
  }

  async get(auth: AuthDto, id: string): Promise<SharedLinkResponseDto> {
    const sharedLink = await this.findOrFail(auth.user.id, id);
    return mapSharedLink(sharedLink, { stripAssetMetadata: false });
  }

  async create(auth: AuthDto, dto: SharedLinkCreateDto): Promise<SharedLinkResponseDto> {
    // #1018: a link created from inside a space is authorized against the SPACE, not against
    // asset ownership, so it can cover what the space shows rather than only the creator's own
    // photos. Both branches below require the caller to be an Owner/Editor of the space first —
    // the same role that may already act on assets it does not own (#764 contributions).
    if (dto.spaceId) {
      await this.requireSpaceEditor(auth, dto.spaceId);
    }

    switch (dto.type) {
      case SharedLinkType.Album: {
        if (!dto.albumId) {
          throw new BadRequestException('Invalid albumId');
        }

        if (dto.spaceId) {
          // The album must be live-linked to this very space, and the caller must still be a
          // member of it. An album linked to some OTHER space grants nothing here.
          const spaceIds = await this.sharedSpaceRepository.getMemberSpaceIdsLinkingAlbum(dto.albumId, auth.user.id);
          if (!spaceIds.includes(dto.spaceId)) {
            throw new BadRequestException('Album is not linked to this space');
          }
        } else {
          await this.requireAccess({ auth, permission: Permission.AlbumShare, ids: [dto.albumId] });
        }
        break;
      }

      case SharedLinkType.Individual: {
        if (!dto.assetIds || dto.assetIds.length === 0) {
          throw new BadRequestException('Invalid assetIds');
        }

        if (dto.spaceId) {
          // Every asset must be visible in the space through one of its four paths (direct add,
          // linked library, linked album, cross-owner contribution). Deliberately NOT unioned
          // with `AssetShare`: a link that claims to come from a space must contain only that
          // space's assets, or the tether on the read side would have nothing to re-derive.
          const allowed = await this.accessRepository.asset.checkSpaceAccessForSpace(
            auth.user.id,
            dto.spaceId,
            new Set(dto.assetIds),
          );
          const denied = dto.assetIds.filter((assetId) => !allowed.has(assetId));
          if (denied.length > 0) {
            throw new BadRequestException('Not found or not visible in this space');
          }
        } else {
          await this.requireAccess({ auth, permission: Permission.AssetShare, ids: dto.assetIds });
        }

        break;
      }
    }

    try {
      const sharedLink = await this.sharedLinkRepository.create({
        key: this.cryptoRepository.randomBytes(50),
        userId: auth.user.id,
        type: dto.type,
        albumId: dto.albumId || null,
        assetIds: dto.assetIds,
        description: dto.description || null,
        password: dto.password,
        expiresAt: dto.expiresAt || null,
        allowUpload: dto.allowUpload ?? true,
        allowDownload: dto.showMetadata === false ? false : (dto.allowDownload ?? true),
        showExif: dto.showMetadata ?? true,
        slug: dto.slug || null,
        spaceId: dto.spaceId || null,
      });

      return mapSharedLink(sharedLink, { stripAssetMetadata: false });
    } catch (error) {
      this.handleError(error);
    }
  }

  /**
   * #1018: only a space Owner/Editor may publish a link that reaches other members' photos.
   * Rejects BEFORE any asset or album lookup, so a Viewer never learns what a space contains
   * from the shape of the error.
   */
  private async requireSpaceEditor(auth: AuthDto, spaceId: string): Promise<void> {
    const member = await this.sharedSpaceRepository.getMember(spaceId, auth.user.id);
    if (!member || !sharedLinkPublisherRoles.includes(member.role as SharedSpaceRole)) {
      throw new BadRequestException('Not found or no shared space editor access');
    }
  }

  private handleError(error: unknown): never {
    if ((error as PostgresError).constraint_name === 'shared_link_slug_uq') {
      this.logger.debug('Shared link with this slug already exists');
      throw new BadRequestException('Failed to save shared link');
    }
    throw error;
  }

  async update(auth: AuthDto, id: string, dto: SharedLinkEditDto) {
    await this.findOrFail(auth.user.id, id);
    try {
      const sharedLink = await this.sharedLinkRepository.update({
        id,
        userId: auth.user.id,
        description: dto.description,
        password: dto.password,
        expiresAt: dto.expiresAt,
        allowUpload: dto.allowUpload,
        allowDownload: dto.allowDownload,
        showExif: dto.showMetadata,
        slug: dto.slug || null,
      });
      return mapSharedLink(sharedLink, { stripAssetMetadata: false });
    } catch (error) {
      this.handleError(error);
    }
  }

  async remove(auth: AuthDto, id: string): Promise<void> {
    const sharedLink = await this.findOrFail(auth.user.id, id);
    await this.sharedLinkRepository.remove(sharedLink.id);
  }

  // TODO: replace `userId` with permissions and access control checks
  private findOrFail(userId: string, id: string) {
    return findOrFail(() => this.sharedLinkRepository.get(userId, id), 'Shared link');
  }

  async addAssets(auth: AuthDto, id: string, dto: AssetIdsDto): Promise<AssetIdsResponseDto[]> {
    const sharedLink = await this.findOrFail(auth.user.id, id);
    if (sharedLink.type !== SharedLinkType.Individual) {
      throw new BadRequestException('Invalid shared link type');
    }

    const existingAssetIds = new Set(sharedLink.assets.map((asset) => asset.id));
    const notPresentAssetIds = dto.assetIds.filter((assetId) => !existingAssetIds.has(assetId));
    const allowedAssetIds = await this.checkAccess({
      auth,
      permission: Permission.AssetShare,
      ids: notPresentAssetIds,
    });

    const results: AssetIdsResponseDto[] = [];
    for (const assetId of dto.assetIds) {
      const hasAsset = existingAssetIds.has(assetId);
      if (hasAsset) {
        results.push({ assetId, success: false, error: AssetIdErrorReason.DUPLICATE });
        continue;
      }

      const hasAccess = allowedAssetIds.has(assetId);
      if (!hasAccess) {
        results.push({ assetId, success: false, error: AssetIdErrorReason.NO_PERMISSION });
        continue;
      }

      results.push({ assetId, success: true });
    }

    await this.sharedLinkRepository.update({
      ...sharedLink,
      assetIds: results.filter(({ success }) => success).map(({ assetId }) => assetId),
    });

    return results;
  }

  async removeAssets(auth: AuthDto, id: string, dto: AssetIdsDto): Promise<AssetIdsResponseDto[]> {
    const sharedLink = await this.findOrFail(auth.user.id, id);

    if (sharedLink.type !== SharedLinkType.Individual) {
      throw new BadRequestException('Invalid shared link type');
    }

    const removedAssetIds = await this.sharedLinkAssetRepository.remove(id, dto.assetIds);

    const results: AssetIdsResponseDto[] = [];
    for (const assetId of dto.assetIds) {
      const wasRemoved = removedAssetIds.includes(assetId);
      if (!wasRemoved) {
        results.push({ assetId, success: false, error: AssetIdErrorReason.NOT_FOUND });
        continue;
      }

      results.push({ assetId, success: true });
      sharedLink.assets = sharedLink.assets.filter((asset) => asset.id !== assetId);
    }

    await this.sharedLinkRepository.update(sharedLink);

    return results;
  }

  async getMetadataTags(auth: AuthDto, defaultDomain?: string): Promise<null | OpenGraphTags> {
    if (!auth.sharedLink || auth.sharedLink.password) {
      return null;
    }

    const config = await this.getConfig({ withCache: true });
    const sharedLink = await this.findOrFail(auth.sharedLink.userId, auth.sharedLink.id);
    const assetId = sharedLink.album?.albumThumbnailAssetId || sharedLink.assets[0]?.id;
    const assetCount = sharedLink.assets.length > 0 ? sharedLink.assets.length : sharedLink.album?.assets?.length || 0;
    const imagePath = assetId
      ? `/api/assets/${assetId}/thumbnail?key=${sharedLink.key.toString('base64url')}`
      : '/feature-panel.png';

    return {
      title: sharedLink.album ? sharedLink.album.albumName : 'Public Share',
      description: sharedLink.description || `${assetCount} shared photos & videos`,
      imageUrl: new URL(imagePath, getExternalDomain(config.server, defaultDomain)).href,
    };
  }

  private asToken(sharedLink: { id: string; password: string }) {
    return this.cryptoRepository.hashSha256(`${sharedLink.id}-${sharedLink.password}`).toString('base64');
  }
}
