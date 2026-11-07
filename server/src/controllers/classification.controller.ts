import { Controller, HttpCode, HttpStatus, Post } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Endpoint, HistoryBuilder } from 'src/decorators.js';
import type { AuthDto } from 'src/dtos/auth.dto.js';
import { ApiTag } from 'src/enum.js';
import { Auth, Authenticated } from 'src/middleware/auth.guard.js';
import { ClassificationService } from 'src/services/classification.service.js';

@ApiTags(ApiTag.Classification)
@Controller('classification')
export class ClassificationController {
  constructor(private service: ClassificationService) {}

  @Post('scan')
  @Authenticated({ admin: true })
  @HttpCode(HttpStatus.NO_CONTENT)
  @Endpoint({
    summary: 'Scan all libraries for classification',
    history: new HistoryBuilder().added('v1'),
  })
  scanClassification(@Auth() auth: AuthDto): Promise<void> {
    return this.service.scanLibrary(auth);
  }
}
