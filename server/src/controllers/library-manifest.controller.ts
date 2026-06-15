import { Controller, Get, Param, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Endpoint, HistoryBuilder } from 'src/decorators';
import { AuthDto } from 'src/dtos/auth.dto';
import { LibraryManifestQueryDto, LibraryManifestResponseDto } from 'src/dtos/library-manifest.dto';
import { ApiTag, Permission } from 'src/enum';
import { Auth, Authenticated } from 'src/middleware/auth.guard';
import { LibraryManifestService } from 'src/services/library-manifest.service';
import { UUIDParamDto } from 'src/validation';

@ApiTags(ApiTag.UsersAdmin)
@Controller('admin/users')
export class LibraryManifestController {
  constructor(private service: LibraryManifestService) {}

  @Get(':id/library-manifest')
  @Authenticated({ permission: Permission.AdminUserRead, admin: true })
  @Endpoint({
    summary: 'Export a user library manifest',
    description: "Return a paginated manifest of a user's owned, non-trashed assets for data export.",
    history: new HistoryBuilder().added('v1').beta('v1'),
  })
  getLibraryManifest(
    @Auth() auth: AuthDto,
    @Param() { id }: UUIDParamDto,
    @Query() { cursor }: LibraryManifestQueryDto,
  ): Promise<LibraryManifestResponseDto> {
    return this.service.getManifest(auth, id, cursor);
  }
}
