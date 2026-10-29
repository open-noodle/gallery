import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Param, Post, Put } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import type { AuthDto } from 'src/dtos/auth.dto.js';
import { Endpoint, HistoryBuilder } from 'src/decorators.js';
import { AssetEditableDto, AssetEditableResponseDto, AssetFavoriteUpdateDto } from 'src/dtos/asset.dto.js';
import { ApiTag, Permission, RouteKey } from 'src/enum.js';
import { AssetSpacesDto, AssetSpacesResponseDto } from 'src/gallery/dtos/asset-spaces.dto.js';
import { AssetImageAdjustDto, AssetImageAdjustResponseDto } from 'src/gallery/dtos/image-adjust.dto.js';
import { AssetVideoTrimDto, AssetVideoTrimResponseDto } from 'src/gallery/dtos/video-trim.dto.js';
import { GalleryAssetService } from 'src/gallery/services/gallery-asset.service.js';
import { Auth, Authenticated } from 'src/middleware/auth.guard.js';
import { UUIDParamDto } from 'src/validation.js';

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

  @Post('spaces')
  @Authenticated({ permission: Permission.AssetRead })
  @HttpCode(HttpStatus.OK)
  @Endpoint({
    summary: "Resolve which of the caller's spaces show the given assets",
    description:
      "For each given asset the caller can read, the IDs of the caller's spaces that show it by any path: added " +
      'to the space, in an album linked to it, or in a library linked to it, hidden from the timeline or not. ' +
      'Assets in none of them are left out, and hidden, locked and trashed assets are in none.',
    history: new HistoryBuilder().added('v1').beta('v1'),
  })
  getAssetSpaces(@Auth() auth: AuthDto, @Body() dto: AssetSpacesDto): Promise<AssetSpacesResponseDto> {
    return this.service.getSpaces(auth, dto);
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

  @Get(':id/trim')
  @Authenticated({ permission: Permission.AssetEditGet })
  @Endpoint({
    summary: 'Retrieve the trim of a video',
    description:
      'Returns the kept part of a trimmed video and the length of the original. Responds 404 when the video is not trimmed.',
    history: new HistoryBuilder().added('v1').beta('v1'),
  })
  getAssetTrim(@Auth() auth: AuthDto, @Param() { id }: UUIDParamDto): Promise<AssetVideoTrimResponseDto> {
    return this.service.getTrim(auth, id);
  }

  @Put(':id/trim')
  @Authenticated({ permission: Permission.AssetEditCreate })
  @Endpoint({
    summary: 'Trim a video',
    description:
      'Keeps only the part of the video between startTime and endTime, replacing any earlier trim. The full range removes an earlier trim. The original file is not changed.',
    history: new HistoryBuilder().added('v1').beta('v1'),
  })
  updateAssetTrim(
    @Auth() auth: AuthDto,
    @Param() { id }: UUIDParamDto,
    @Body() dto: AssetVideoTrimDto,
  ): Promise<AssetVideoTrimResponseDto> {
    return this.service.setTrim(auth, id, dto);
  }

  @Delete(':id/trim')
  @Authenticated({ permission: Permission.AssetEditDelete })
  @HttpCode(HttpStatus.NO_CONTENT)
  @Endpoint({
    summary: 'Remove the trim of a video',
    description: 'Restores the full-length video.',
    history: new HistoryBuilder().added('v1').beta('v1'),
  })
  removeAssetTrim(@Auth() auth: AuthDto, @Param() { id }: UUIDParamDto): Promise<void> {
    return this.service.removeTrim(auth, id);
  }

  @Get(':id/adjust')
  @Authenticated({ permission: Permission.AssetEditGet })
  @Endpoint({
    summary: 'Retrieve the colour adjustment of an image',
    description: 'Returns the exposure, contrast, saturation and invert applied to the image; all zero when none is.',
    history: new HistoryBuilder().added('v1').beta('v1'),
  })
  getAssetAdjust(@Auth() auth: AuthDto, @Param() { id }: UUIDParamDto): Promise<AssetImageAdjustResponseDto> {
    return this.service.getAdjust(auth, id);
  }

  @Put(':id/adjust')
  @Authenticated({ permission: Permission.AssetEditCreate })
  @Endpoint({
    summary: 'Adjust the colours of an image',
    description:
      'Sets the exposure, contrast, saturation and invert applied after any crop, rotate or mirror, replacing an earlier adjustment. All-neutral values remove it. The original file is not changed.',
    history: new HistoryBuilder().added('v1').beta('v1'),
  })
  updateAssetAdjust(
    @Auth() auth: AuthDto,
    @Param() { id }: UUIDParamDto,
    @Body() dto: AssetImageAdjustDto,
  ): Promise<AssetImageAdjustResponseDto> {
    return this.service.setAdjust(auth, id, dto);
  }

  @Delete(':id/adjust')
  @Authenticated({ permission: Permission.AssetEditDelete })
  @HttpCode(HttpStatus.NO_CONTENT)
  @Endpoint({
    summary: 'Remove the colour adjustment of an image',
    description: 'Restores the image colours; any crop, rotate or mirror stays.',
    history: new HistoryBuilder().added('v1').beta('v1'),
  })
  removeAssetAdjust(@Auth() auth: AuthDto, @Param() { id }: UUIDParamDto): Promise<void> {
    return this.service.removeAdjust(auth, id);
  }
}
