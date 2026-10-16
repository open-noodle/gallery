import { Controller, Get } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Endpoint, HistoryBuilder } from 'src/decorators.js';
import { ServerMlHealthResponseDto } from 'src/dtos/server.dto.js';
import { ApiTag, Permission } from 'src/enum.js';
import { Authenticated } from 'src/middleware/auth.guard.js';
import { ServerService } from 'src/services/server.service.js';

@ApiTags(ApiTag.Server)
@Controller('server')
export class GalleryServerController {
  constructor(private service: ServerService) {}

  @Get('ml-health')
  @Authenticated({ permission: Permission.ServerAbout })
  @Endpoint({
    summary: 'Smart search health',
    description: 'Reports whether the ML server is currently reachable and healthy for smart search.',
    history: new HistoryBuilder().added('v2'),
  })
  getMlHealth(): Promise<ServerMlHealthResponseDto> {
    return this.service.getMlHealth();
  }
}
