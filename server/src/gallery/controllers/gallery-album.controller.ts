import { Body, Controller, HttpCode, HttpStatus, Post } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import type { AuthDto } from 'src/dtos/auth.dto.js';
import { Endpoint, HistoryBuilder } from 'src/decorators.js';
import { ApiTag, Permission } from 'src/enum.js';
import { AlbumAddTargetsDto, AlbumAddTargetsResponseDto } from 'src/gallery/dtos/album.dto.js';
import { GalleryAlbumService } from 'src/gallery/services/gallery-album.service.js';
import { Auth, Authenticated } from 'src/middleware/auth.guard.js';

// Mounted before AlbumController (see src/gallery/index.ts), so a literal segment here wins over any
// upstream `/albums/:id` route on the same method.
@ApiTags(ApiTag.Albums)
@Controller('albums')
export class GalleryAlbumController {
  constructor(private service: GalleryAlbumService) {}

  @Post('add-targets')
  @Authenticated({ permission: Permission.AlbumAssetCreate })
  @HttpCode(HttpStatus.OK)
  @Endpoint({
    summary: 'Resolve which albums accept the given assets',
    description:
      'For each candidate album the caller may add to, returns how many of the given assets it would accept — assets the caller may share, plus assets they may contribute to a space-linked album as a space Owner or Editor. Albums that accept nothing are omitted. Nothing is written.',
    history: new HistoryBuilder().added('v2').stable('v2'),
  })
  getAlbumAddTargets(@Auth() auth: AuthDto, @Body() dto: AlbumAddTargetsDto): Promise<AlbumAddTargetsResponseDto> {
    return this.service.getAddTargets(auth, dto);
  }
}
