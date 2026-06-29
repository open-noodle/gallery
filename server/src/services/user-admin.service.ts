import { BadRequestException, ForbiddenException, Injectable } from '@nestjs/common';
import { SALT_ROUNDS } from 'src/constants';
import { AssetStatsDto, AssetStatsResponseDto, mapStats } from 'src/dtos/asset.dto';
import { AuthDto } from 'src/dtos/auth.dto';
import { CalendarHeatmapDto, CalendarHeatmapResponseDto } from 'src/dtos/calendar-heatmap.dto';
import { SessionResponseDto, mapSession } from 'src/dtos/session.dto';
import { UserPreferencesResponseDto, UserPreferencesUpdateDto, mapPreferences } from 'src/dtos/user-preferences.dto';
import {
  UserAdminCreateDto,
  UserAdminDeleteDto,
  UserAdminResponseDto,
  UserAdminSearchDto,
  UserAdminUpdateDto,
  mapUserAdmin,
} from 'src/dtos/user.dto';
import { JobName, UserMetadataKey, UserStatus } from 'src/enum';
import { UserFindOptions } from 'src/repositories/user.repository';
import { BaseService } from 'src/services/base.service';
import { getCalendarHeatmap } from 'src/services/shared/user-methods';
import { getPreferences, getPreferencesPartial, mergePreferences } from 'src/utils/preferences';

@Injectable()
export class UserAdminService extends BaseService {
  async search(auth: AuthDto, dto: UserAdminSearchDto): Promise<UserAdminResponseDto[]> {
    const users = await this.userRepository.getList({
      id: dto.id,
      withDeleted: dto.withDeleted,
    });
    return users.map((user) => mapUserAdmin(user));
  }

  async create(dto: UserAdminCreateDto): Promise<UserAdminResponseDto> {
    const { notify, ...userDto } = dto;
    const config = await this.getConfig({ withCache: false });
    if (!config.oauth.enabled && !userDto.password) {
      throw new BadRequestException('password is required');
    }

    const user = await this.createUser(userDto);

    await this.eventRepository.emit('UserSignup', {
      notify: !!notify,
      id: user.id,
      password: userDto.password,
    });

    return mapUserAdmin(user);
  }

  async get(auth: AuthDto, id: string): Promise<UserAdminResponseDto> {
    const user = await this.findOrFail(id, { withDeleted: true });
    return mapUserAdmin(user);
  }

  async update(auth: AuthDto, id: string, dto: UserAdminUpdateDto): Promise<UserAdminResponseDto> {
    const user = await this.findOrFail(id, {});

    if (dto.isAdmin !== undefined && dto.isAdmin !== auth.user.isAdmin && auth.user.id === id) {
      throw new BadRequestException('Admin status can only be changed by another admin');
    }

    if (dto.quotaSizeInBytes && user.quotaSizeInBytes !== dto.quotaSizeInBytes) {
      await this.syncUsage(id);
    }

    if (dto.email) {
      const duplicate = await this.userRepository.getByEmail(dto.email);
      if (duplicate && duplicate.id !== id) {
        this.logger.debug('Email already in use by another account');
        throw new BadRequestException('Email is not available');
      }
    }

    if (dto.storageLabel) {
      const duplicate = await this.userRepository.getByStorageLabel(dto.storageLabel);
      if (duplicate && duplicate.id !== id) {
        throw new BadRequestException('Storage label already in use by another account');
      }
    }

    if (dto.password) {
      dto.password = await this.cryptoRepository.hashBcrypt(dto.password, SALT_ROUNDS);
    }

    if (dto.pinCode) {
      dto.pinCode = await this.cryptoRepository.hashBcrypt(dto.pinCode, SALT_ROUNDS);
    }

    if (dto.storageLabel === '') {
      dto.storageLabel = null;
    }

    const updatedUser = await this.userRepository.update(id, { ...dto, updatedAt: new Date() });

    return mapUserAdmin(updatedUser);
  }

  async delete(auth: AuthDto, id: string, dto: UserAdminDeleteDto): Promise<UserAdminResponseDto> {
    const { force } = dto;
    await this.findOrFail(id, {});
    if (auth.user.id === id) {
      throw new ForbiddenException('Cannot delete your own account');
    }

    // Enumerate owned album ids BEFORE soft-deleting them: getAllIds filters out
    // soft-deleted albums, so capturing them after softDeleteAll would return nothing.
    const ownedAlbumIds = await this.albumRepository.getAllIds(id, { isOwned: true });

    await this.albumRepository.softDeleteAll(id);

    // Eagerly clean the space-face projection for each soft-deleted owned album so
    // album-sourced space people disappear immediately (and getSpacePersonThumbnail stops
    // serving trashed crops). Reuses onAlbumDelete — the only AlbumDelete handler — which
    // reads album_asset directly and so still works after the album row is soft-deleted.
    // Runs for both force and non-force, since softDeleteAll always runs; on force the later
    // UserDelete hard-delete is a harmless no-op because the faces are already cleaned.
    for (const albumId of ownedAlbumIds) {
      await this.eventRepository.emit('AlbumDelete', { albumId });
    }

    const status = force ? UserStatus.Removing : UserStatus.Deleted;
    const user = await this.userRepository.update(id, { status, deletedAt: new Date() });

    await this.eventRepository.emit('UserTrash', user);

    if (force) {
      await this.jobRepository.queue({ name: JobName.UserDelete, data: { id: user.id, force } });
    }

    return mapUserAdmin(user);
  }

  async restore(auth: AuthDto, id: string): Promise<UserAdminResponseDto> {
    await this.findOrFail(id, { withDeleted: true });
    await this.albumRepository.restoreAll(id);

    // Re-queue face matching for every face-enabled space linked to a restored album so the
    // album-sourced space people re-converge (mirrors addMember). Albums are non-deleted again
    // after restoreAll, so getAllIds now surfaces them.
    const restoredAlbumIds = await this.albumRepository.getAllIds(id, { isOwned: true });
    let anyFaceEnabledSpace = false;
    for (const albumId of restoredAlbumIds) {
      const spaces = await this.sharedSpaceRepository.getSpacesLinkedToAlbum(albumId);
      for (const space of spaces) {
        if (!space.faceRecognitionEnabled) {
          continue;
        }
        await this.jobRepository.queue({ name: JobName.SharedSpaceFaceMatchAll, data: { spaceId: space.spaceId } });
        anyFaceEnabledSpace = true;
      }
    }
    if (anyFaceEnabledSpace) {
      await this.jobRepository.queue({ name: JobName.SharedSpacePersonMetadataBackfill, data: {} });
    }

    const user = await this.userRepository.restore(id);
    await this.eventRepository.emit('UserRestore', user);
    return mapUserAdmin(user);
  }

  async getCalendarHeatmap(auth: AuthDto, id: string, dto: CalendarHeatmapDto): Promise<CalendarHeatmapResponseDto> {
    await this.findOrFail(id, { withDeleted: false });
    return getCalendarHeatmap(id, dto, { asset: this.assetRepository });
  }

  async getSessions(auth: AuthDto, id: string): Promise<SessionResponseDto[]> {
    const sessions = await this.sessionRepository.getByUserId(id);
    return sessions.map((session) => mapSession(session));
  }

  async getStatistics(auth: AuthDto, id: string, dto: AssetStatsDto): Promise<AssetStatsResponseDto> {
    const stats = await this.assetRepository.getStatistics(id, dto);
    return mapStats(stats);
  }

  async getPreferences(auth: AuthDto, id: string): Promise<UserPreferencesResponseDto> {
    await this.findOrFail(id, { withDeleted: true });
    const metadata = await this.userRepository.getMetadata(id);
    return mapPreferences(getPreferences(metadata));
  }

  async updatePreferences(auth: AuthDto, id: string, dto: UserPreferencesUpdateDto) {
    await this.findOrFail(id, { withDeleted: false });
    const metadata = await this.userRepository.getMetadata(id);
    const newPreferences = mergePreferences(getPreferences(metadata), dto);

    await this.userRepository.upsertMetadata(id, {
      key: UserMetadataKey.Preferences,
      value: getPreferencesPartial(newPreferences),
    });

    return mapPreferences(newPreferences);
  }

  private async findOrFail(id: string, options: UserFindOptions) {
    const user = await this.userRepository.get(id, options);
    if (!user) {
      throw new BadRequestException('User not found');
    }
    return user;
  }
}
