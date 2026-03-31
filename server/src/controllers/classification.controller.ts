import { Controller, HttpCode, HttpStatus, Post } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Endpoint, HistoryBuilder } from 'src/decorators';
import { AuthDto } from 'src/dtos/auth.dto';
import { ApiTag } from 'src/enum';
import { Auth, Authenticated } from 'src/middleware/auth.guard';
import { ClassificationService } from 'src/services/classification.service';

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
