import { Body, Controller, Get, HttpCode, HttpStatus, Post } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { AlbumNameDto } from 'src/dtos/album-name.dto.js';
import type { AuthDto } from 'src/dtos/auth.dto.js';
import { Endpoint, HistoryBuilder } from 'src/decorators.js';
import { ApiTag, Permission } from 'src/enum.js';
import { AlbumAddTargetsDto, AlbumAddTargetsResponseDto } from 'src/gallery/dtos/album.dto.js';
import { GalleryAlbumService } from 'src/gallery/services/gallery-album.service.js';
import { Auth, Authenticated } from 'src/middleware/auth.guard.js';
import { AlbumService } from 'src/services/album.service.js';

// Mounted before AlbumController (see src/gallery/index.ts), so a literal segment here (`GET /albums/names`,
// `POST /albums/add-targets`) wins over any upstream `/albums/:id` route on the same method.
@ApiTags(ApiTag.Albums)
@Controller('albums')
export class GalleryAlbumController {
  constructor(
    private service: GalleryAlbumService,
    private albumService: AlbumService,
  ) {}

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

  @Get('names')
  @Authenticated()
  @Endpoint({
    summary: 'Retrieve album names',
    description: 'Returns a lightweight list of albums available to the authenticated user for quick palette lookups.',
    history: new HistoryBuilder().added('v2'),
  })
  getAlbumNames(@Auth() auth: AuthDto): Promise<AlbumNameDto[]> {
    return this.albumService.getNames(auth);
  }
}
