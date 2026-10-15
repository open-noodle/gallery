import { Controller, Get, Param } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Endpoint, HistoryBuilder } from 'src/decorators.js';
import { UserResponseDto } from 'src/dtos/user.dto.js';
import { ApiTag, Permission } from 'src/enum.js';
import { Authenticated } from 'src/middleware/auth.guard.js';
import { UUIDParamDto } from 'src/validation.js';

// Gallery does not mount upstream's ClusterGroupController (see src/controllers/index.ts). Stock Immich web
// still asks for the caller's cluster group users every time the People page opens, so this one route answers
// with nobody instead of a 404 that the page reports as an error. The other cluster-group routes stay unmounted.
@ApiTags(ApiTag.ClusterGroups)
@Controller('cluster-groups')
export class GalleryClusterGroupController {
  @Get(':id/users')
  @Authenticated({ permission: Permission.ClusterGroupRead })
  @Endpoint({
    summary: 'Retrieve the users of a cluster group',
    description: 'Retrieve the users that are a member of the cluster group.',
    history: new HistoryBuilder().added('v3.2.0'),
  })
  getClusterGroupUsers(@Param() _: UUIDParamDto): UserResponseDto[] {
    return [];
  }
}
