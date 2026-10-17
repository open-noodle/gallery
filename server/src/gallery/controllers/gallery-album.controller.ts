import { Controller, Get } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import type { AuthDto } from 'src/dtos/auth.dto.js';
import { Endpoint, HistoryBuilder } from 'src/decorators.js';
import { AlbumNameDto } from 'src/dtos/album-name.dto.js';
import { ApiTag } from 'src/enum.js';
import { Auth, Authenticated } from 'src/middleware/auth.guard.js';
import { AlbumService } from 'src/services/album.service.js';

// Mounted before AlbumController (see src/gallery/index.ts), so the literal `GET /albums/names` matches before
// its `GET /albums/:id`.
@ApiTags(ApiTag.Albums)
@Controller('albums')
export class GalleryAlbumController {
  constructor(private service: AlbumService) {}

  @Get('names')
  @Authenticated()
  @Endpoint({
    summary: 'Retrieve album names',
    description: 'Returns a lightweight list of albums available to the authenticated user for quick palette lookups.',
    history: new HistoryBuilder().added('v2'),
  })
  getAlbumNames(@Auth() auth: AuthDto): Promise<AlbumNameDto[]> {
    return this.service.getNames(auth);
  }
}
