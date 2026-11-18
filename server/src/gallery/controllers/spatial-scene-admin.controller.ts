import { Controller, Delete, Get } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Endpoint, HistoryBuilder } from 'src/decorators.js';
import type { AuthDto } from 'src/dtos/auth.dto.js';
import { ApiTag, Permission } from 'src/enum.js';
import { SpatialSceneChoicesResponseDto } from 'src/gallery/dtos/spatial-scene.dto.js';
import { SpatialSceneService } from 'src/gallery/services/spatial-scene.service.js';
import { Auth, Authenticated } from 'src/middleware/auth.guard.js';

// The admin's view of the Spatial Scene per-photo choices (specs/2026-10-29-spatial-scene-design.md,
// "Per-photo actions"), shown in the Spatial Scene section of the machine learning settings.
@ApiTags(ApiTag.SystemConfig)
@Controller('admin/spatial-scene')
export class SpatialSceneAdminController {
  constructor(private service: SpatialSceneService) {}

  @Get('choices')
  @Authenticated({ permission: Permission.SystemConfigRead, admin: true })
  @Endpoint({
    summary: 'Count Spatial Scene per-photo choices',
    description: 'Returns how many photos have a per-photo choice of whether Spatial Scene is offered on them.',
    history: new HistoryBuilder().added('v1').beta('v1'),
  })
  getSpatialSceneChoices(): Promise<SpatialSceneChoicesResponseDto> {
    return this.service.getChoices();
  }

  @Delete('choices')
  @Authenticated({ permission: Permission.SystemConfigUpdate, admin: true })
  @Endpoint({
    summary: 'Clear Spatial Scene per-photo choices',
    description:
      'Removes every per-photo choice of whether Spatial Scene is offered, so every photo follows the offer mode and thresholds again. Depth maps are kept. Returns how many choices were removed.',
    history: new HistoryBuilder().added('v1').beta('v1'),
  })
  clearSpatialSceneChoices(@Auth() auth: AuthDto): Promise<SpatialSceneChoicesResponseDto> {
    return this.service.clearChoices(auth);
  }
}
