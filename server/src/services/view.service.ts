import { Injectable } from '@nestjs/common';
import { AssetResponseDto, mapAsset } from 'src/dtos/asset-response.dto.js';
import { AuthDto } from 'src/dtos/auth.dto.js';
import { BaseService } from 'src/services/base.service.js';

@Injectable()
export class ViewService extends BaseService {
  async getUniqueOriginalPaths(auth: AuthDto): Promise<string[]> {
    const { hiddenScope, visibleSpaceIds } = await this.resolveViewerScope(auth, 'folders');
    return this.viewRepository.getUniqueOriginalPaths(auth.user.id, hiddenScope, visibleSpaceIds);
  }

  async getAssetsByOriginalPath(auth: AuthDto, path: string): Promise<AssetResponseDto[]> {
    const { hiddenScope, visibleSpaceIds } = await this.resolveViewerScope(auth, 'folders');
    const assets = await this.viewRepository.getAssetsByOriginalPath(auth.user.id, path, hiddenScope, visibleSpaceIds);
    return assets.map((asset) => mapAsset(asset, { auth }));
  }
}
