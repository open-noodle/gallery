import { Body, Controller, Post } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Endpoint, HistoryBuilder } from 'src/decorators';
import { FaceRepairRequestDto, FaceRepairResponseDto } from 'src/dtos/face-repair.dto';
import { ApiTag } from 'src/enum';
import { Authenticated } from 'src/middleware/auth.guard';
import { FaceRepairService } from 'src/services/face-repair.service';

@ApiTags(ApiTag.Faces)
@Controller('admin/face-repair')
export class FaceRepairAdminController {
  constructor(private service: FaceRepairService) {}

  @Post()
  @Authenticated({ admin: true })
  @Endpoint({
    summary: 'Run face re-attribution repair',
    history: new HistoryBuilder().added('v1'),
  })
  runFaceRepair(@Body() dto: FaceRepairRequestDto): Promise<FaceRepairResponseDto> {
    return this.service.runRepair(dto) as Promise<FaceRepairResponseDto>;
  }
}
