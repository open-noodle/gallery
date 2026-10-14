import { Body, Controller, HttpCode, HttpStatus, Post, Put } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import type { AuthDto } from 'src/dtos/auth.dto.js';
import { Endpoint, HistoryBuilder } from 'src/decorators.js';
import { AssetEditableDto, AssetEditableResponseDto, AssetFavoriteUpdateDto } from 'src/dtos/asset.dto.js';
import { ApiTag, Permission, RouteKey } from 'src/enum.js';
import { GalleryAssetService } from 'src/gallery/services/gallery-asset.service.js';
import { Auth, Authenticated } from 'src/middleware/auth.guard.js';

// Mounted before AssetController (see src/gallery/index.ts), so the literal `PUT /assets/favorites` matches before
// its `PUT /assets/:id`, which would otherwise reject "favorites" as an invalid uuid (#763).
@ApiTags(ApiTag.Assets)
@Controller(RouteKey.Asset)
export class GalleryAssetController {
  constructor(private service: GalleryAssetService) {}

  @Post('editable')
  @Authenticated({ permission: Permission.AssetRead })
  @HttpCode(HttpStatus.OK)
  @Endpoint({
    summary: 'Resolve which of the given assets the caller may edit',
    description:
      'Returns the subset of the requested asset IDs the caller is allowed to edit — owned assets, plus assets belonging to a member of a space where the caller is Owner or Editor.',
    history: new HistoryBuilder().added('v2').stable('v2'),
  })
  getEditableAssets(@Auth() auth: AuthDto, @Body() dto: AssetEditableDto): Promise<AssetEditableResponseDto> {
    return this.service.getEditable(auth, dto);
  }

  @Put('favorites')
  @Authenticated({ permission: Permission.AssetRead })
  @HttpCode(HttpStatus.NO_CONTENT)
  @Endpoint({
    summary: 'Set favorite state for the requesting user',
    description:
      'Favorites are per-user. Requires only read access to the assets; a space viewer may favorite an asset ' +
      'they do not own. Never affects any other user.',
    history: new HistoryBuilder().added('v1').beta('v1'),
  })
  updateAssetFavorites(@Auth() auth: AuthDto, @Body() dto: AssetFavoriteUpdateDto): Promise<void> {
    return this.service.updateFavorites(auth, dto);
  }
}
