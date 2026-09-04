import { Injectable } from '@nestjs/common';
import { AssetResponseDto, mapAsset } from 'src/dtos/asset-response.dto';
import { AuthDto } from 'src/dtos/auth.dto';
import { BaseService } from 'src/services/base.service';

@Injectable()
export class ViewService extends BaseService {
  async getUniqueOriginalPaths(auth: AuthDto): Promise<string[]> {
    // #1041 §6.2: resolved once per request, same as timeline.service.ts.
    const [hiddenScope, visibleSpaceIds] = await this.resolveHiddenScopeAndVisibleSpaces(auth.user.id);
    return this.viewRepository.getUniqueOriginalPaths(auth.user.id, hiddenScope, visibleSpaceIds);
  }

  async getAssetsByOriginalPath(auth: AuthDto, path: string): Promise<AssetResponseDto[]> {
    const [hiddenScope, visibleSpaceIds] = await this.resolveHiddenScopeAndVisibleSpaces(auth.user.id);
    const assets = await this.viewRepository.getAssetsByOriginalPath(auth.user.id, path, hiddenScope, visibleSpaceIds);
    return assets.map((asset) => mapAsset(asset, { auth }));
  }

  // #1041: `visibleSpaceIds` mirrors timeline.service.ts's `timelineSpaceIds` — the space arm must
  // be restricted to spaces where the viewer's OWN `shared_space_member.showInTimeline` is true, or
  // a member who hid a whole space would still see their own directly-added assets resurface via
  // that arm (it is OR'd with the owner term, which correctly subtracts on its own).
  private async resolveHiddenScopeAndVisibleSpaces(userId: string) {
    const [hiddenScope, spaceRows] = await Promise.all([
      this.sharedSpaceRepository.getTimelineHiddenScope(userId),
      this.sharedSpaceRepository.getSpaceIdsForTimeline(userId),
    ]);
    return [hiddenScope, spaceRows.map((row) => row.spaceId)] as const;
  }
}
