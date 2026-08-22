import { BadRequestException, Injectable } from '@nestjs/common';
import { AssetFileResponseDto, AssetFileSearchDto, mapAssetFile } from 'src/dtos/asset-file.dto';
import { AuthDto } from 'src/dtos/auth.dto';
import { AssetFileType, CacheControl, JobName, Permission } from 'src/enum';
import { BaseService } from 'src/services/base.service';
import { getFilenameExtension, getFileNameWithoutExtension, ImmichFileResponse } from 'src/utils/file';
import { mimeTypes } from 'src/utils/mime-types';
import { findOrFail } from 'src/utils/misc';

@Injectable()
export class AssetFileService extends BaseService {
  async search(auth: AuthDto, dto: AssetFileSearchDto): Promise<AssetFileResponseDto[]> {
    await this.requireAccess({ auth, permission: Permission.AssetRead, ids: [dto.assetId] });

    // Gallery: AssetRead also admits shared-space members (as well as upstream's album participants and
    // partners), while every per-file endpoint below is owner-only. Returning `path` unconditionally
    // would hand every viewer of a shared asset the owner's storage paths / S3 keys for files they
    // cannot fetch, so the path is projected out for non-owners.
    const owned = await this.accessRepository.asset.checkOwnerAccess(
      auth.user.id,
      new Set([dto.assetId]),
      auth.session?.hasElevatedPermission,
    );
    const includePath = owned.has(dto.assetId);

    const files = await this.assetFileRepository.search(dto);
    return files.map((file) => mapAssetFile(file, { includePath }));
  }

  async get(auth: AuthDto, id: string): Promise<AssetFileResponseDto> {
    await this.requireAccess({ auth, permission: Permission.AssetFileRead, ids: [id] });
    const file = await findOrFail(() => this.assetFileRepository.get(id), 'Asset file');
    return mapAssetFile(file);
  }

  async download(auth: AuthDto, id: string) {
    await this.requireAccess({ auth, permission: Permission.AssetFileDownload, ids: [id] });
    const file = await findOrFail(() => this.assetFileRepository.get(id), 'Asset file');

    return new ImmichFileResponse({
      path: file.path,
      fileName: getFileNameWithoutExtension(file.path) + getFilenameExtension(file.path),
      contentType: mimeTypes.lookup(file.path),
      cacheControl: CacheControl.PrivateWithCache,
    });
  }

  async delete(auth: AuthDto, id: string) {
    await this.requireAccess({ auth, permission: Permission.AssetFileDelete, ids: [id] });

    const file = await findOrFail(() => this.assetFileRepository.get(id), 'Asset file');
    // TODO consider implications of allowing sidecar files to be deleted
    if (file.type === AssetFileType.Sidecar) {
      throw new BadRequestException('Sidecar files cannot be deleted');
    }

    await this.assetFileRepository.delete(id);
    await this.jobRepository.queue({ name: JobName.FileDelete, data: { files: [file.path] } });
  }
}
