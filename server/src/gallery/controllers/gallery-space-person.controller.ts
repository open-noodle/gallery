import { Controller, Delete, HttpCode, HttpStatus, Param, Put } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Endpoint, HistoryBuilder } from 'src/decorators.js';
import type { AuthDto } from 'src/dtos/auth.dto.js';
import { SharedSpacePersonParamDto } from 'src/dtos/shared-space.dto.js';
import { ApiTag, Permission } from 'src/enum.js';
import { GalleryPeopleService } from 'src/gallery/services/gallery-people.service.js';
import { Auth, Authenticated } from 'src/middleware/auth.guard.js';

// Read-level like the alias routes beside it: a favorite is the caller's own ordering preference, so any member may set one.
@ApiTags(ApiTag.SharedSpaces)
@Controller('shared-spaces')
export class GallerySpacePersonController {
  constructor(private service: GalleryPeopleService) {}

  @Put(':id/people/:personId/favorite')
  @Authenticated({ permission: Permission.SharedSpaceRead })
  @HttpCode(HttpStatus.NO_CONTENT)
  @Endpoint({
    summary: 'Favorite a person in a shared space',
    description:
      'Favorite a person for the current user. Favorites are personal and pin the person to the top of lists.',
    history: new HistoryBuilder().added('v2').stable('v2'),
  })
  favoriteSpacePerson(@Auth() auth: AuthDto, @Param() { id, personId }: SharedSpacePersonParamDto): Promise<void> {
    return this.service.setSpacePersonFavorite(auth, id, personId, true);
  }

  @Delete(':id/people/:personId/favorite')
  @Authenticated({ permission: Permission.SharedSpaceRead })
  @HttpCode(HttpStatus.NO_CONTENT)
  @Endpoint({
    summary: 'Unfavorite a person in a shared space',
    description: "Remove a person from the current user's favorites.",
    history: new HistoryBuilder().added('v2').stable('v2'),
  })
  unfavoriteSpacePerson(@Auth() auth: AuthDto, @Param() { id, personId }: SharedSpacePersonParamDto): Promise<void> {
    return this.service.setSpacePersonFavorite(auth, id, personId, false);
  }
}
