import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Head,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  Req,
  Res,
  UnsupportedMediaTypeException,
} from '@nestjs/common';
import { ApiConsumes, ApiHeader, ApiResponse, ApiTags } from '@nestjs/swagger';
import { Request, Response } from 'express';
import { Endpoint, HistoryBuilder } from 'src/decorators';
import { AssetMediaResponseDto, AssetMediaStatus } from 'src/dtos/asset-media-response.dto';
import { AuthDto } from 'src/dtos/auth.dto';
import { UploadSessionCreateDto, UploadSessionResponseDto } from 'src/dtos/upload-session.dto';
import { ApiTag, Permission } from 'src/enum';
import { Auth, Authenticated } from 'src/middleware/auth.guard';
import { UploadSessionService } from 'src/services/upload-session.service';
import { UUIDParamDto } from 'src/validation';

/** The only Content-Type a chunk PATCH may carry (spec §4.1, §4.2 — tus-identical on purpose). */
const CHUNK_CONTENT_TYPE = 'application/offset+octet-stream';

const isChunkContentType = (contentType: string | undefined): boolean =>
  !!contentType && contentType.split(';', 1)[0].trim().toLowerCase() === CHUNK_CONTENT_TYPE;

/**
 * Parses the `Upload-Offset` request header. Express lower-cases header names and may hand back
 * an array if the header was repeated, so anything other than a single numeric string is
 * rejected (spec §8 row 12, row 13).
 */
const parseUploadOffset = (header: string | string[] | undefined): number => {
  if (typeof header !== 'string' || !/^\d+$/.test(header)) {
    throw new BadRequestException('Upload-Offset header must be a non-negative integer');
  }

  const offset = Number(header);
  if (!Number.isSafeInteger(offset)) {
    throw new BadRequestException('Upload-Offset header must be a non-negative integer');
  }

  return offset;
};

/**
 * Reads the raw chunk body off `req`, deleteUploadSessioning the request with 400 the moment more than `cap`
 * bytes have arrived rather than buffering an unbounded body first (spec §8 row 19). `cap` is
 * `declared size - Upload-Offset`, computed by the caller from the session's declared length.
 */
const readCappedBody = (req: Request, cap: number): Promise<Buffer> =>
  new Promise<Buffer>((resolve, reject) => {
    const parts: Buffer[] = [];
    let total = 0;
    let settled = false;

    const onData = (chunk: Buffer) => {
      total += chunk.length;
      if (total > cap) {
        // Stop buffering immediately rather than accumulating an over-long body (spec §8 row
        // 19). The listeners are removed so the rest of the body is discarded as it arrives
        // instead of destroying the socket outright, which would risk tearing down the
        // in-flight HTTP response before the 400 can be written.
        settle(() => reject(new BadRequestException('Chunk exceeds the declared Upload-Length')));
        return;
      }
      parts.push(chunk);
    };

    const onEnd = () => settle(() => resolve(Buffer.concat(parts)));
    const onError = (error: Error) => settle(() => reject(error));

    function settle(run: () => void) {
      if (settled) {
        return;
      }
      settled = true;
      req.removeListener('data', onData);
      req.removeListener('end', onEnd);
      req.removeListener('error', onError);
      run();
    }

    req.on('data', onData);
    req.on('end', onEnd);
    req.on('error', onError);
  });

/**
 * Resumable-upload session endpoints (spec §4.1). Registered under the literal multi-segment
 * prefix `assets/upload-session` — see spec §5.2 for why this cannot collide with
 * `AssetController`'s `:id` routes (`assets/:id` is 2 segments; every route here is 2 or 3).
 */
@ApiTags(ApiTag.Assets)
@Controller('assets/upload-session')
export class UploadSessionController {
  constructor(private service: UploadSessionService) {}

  @Post()
  @Authenticated({ permission: Permission.AssetUpload, sharedLink: true })
  @ApiResponse({
    status: 200,
    description: 'The declared checksum is already known; the asset is a duplicate and no session was created',
    type: AssetMediaResponseDto,
  })
  @ApiResponse({
    status: 201,
    description: 'Upload session created',
    type: UploadSessionResponseDto,
  })
  @Endpoint({
    summary: 'Create an upload session',
    description: 'Creates a resumable upload session for a large asset, or returns a duplicate immediately.',
    history: new HistoryBuilder().added('v1').beta('v1'),
  })
  async createUploadSession(
    @Auth() auth: AuthDto,
    @Body() dto: UploadSessionCreateDto,
    @Res({ passthrough: true }) res: Response,
  ): Promise<UploadSessionResponseDto | AssetMediaResponseDto> {
    const result = await this.service.create(auth, dto);

    res.status('status' in result ? HttpStatus.OK : HttpStatus.CREATED);

    return result;
  }

  @Head(':id')
  @Authenticated({ permission: Permission.AssetUpload, sharedLink: true })
  @ApiResponse({ status: 200, description: 'Upload-Offset and Upload-Length headers describe session progress' })
  @Endpoint({
    summary: 'Get upload session offset',
    description: 'Reports the number of bytes committed so far and the declared total length.',
    history: new HistoryBuilder().added('v1').beta('v1'),
  })
  async getUploadSessionOffset(
    @Auth() auth: AuthDto,
    @Param() { id }: UUIDParamDto,
    @Res({ passthrough: true }) res: Response,
  ): Promise<void> {
    const { offset, size } = await this.service.getOffset(auth, id);

    res.set('Upload-Offset', String(offset));
    res.set('Upload-Length', String(size));
  }

  @Patch(':id')
  @Authenticated({ permission: Permission.AssetUpload, sharedLink: true })
  @ApiConsumes(CHUNK_CONTENT_TYPE)
  @ApiHeader({ name: 'Upload-Offset', description: 'Byte offset at which this chunk starts', required: true })
  @ApiResponse({ status: 204, description: 'Chunk committed; more chunks expected' })
  @ApiResponse({
    status: 200,
    description: 'Final chunk committed; the asset is a duplicate',
    type: AssetMediaResponseDto,
  })
  @ApiResponse({
    status: 201,
    description: 'Final chunk committed; the asset was created',
    type: AssetMediaResponseDto,
  })
  @Endpoint({
    summary: 'Append an upload session chunk',
    description: 'Appends a raw chunk at the given offset. The final chunk creates the asset.',
    history: new HistoryBuilder().added('v1').beta('v1'),
  })
  async appendUploadSessionChunk(
    @Auth() auth: AuthDto,
    @Param() { id }: UUIDParamDto,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<AssetMediaResponseDto | undefined> {
    if (!isChunkContentType(req.headers['content-type'])) {
      throw new UnsupportedMediaTypeException(`Content-Type must be ${CHUNK_CONTENT_TYPE}`);
    }

    const offset = parseUploadOffset(req.headers['upload-offset']);

    const { size } = await this.service.getOffset(auth, id);
    const cap = size - offset;
    if (cap < 0) {
      throw new BadRequestException('Upload-Offset exceeds the declared Upload-Length');
    }

    const chunk = await readCappedBody(req, cap);
    const result = await this.service.appendChunk(auth, id, offset, chunk);

    if ('status' in result) {
      res.status(result.status === AssetMediaStatus.DUPLICATE ? HttpStatus.OK : HttpStatus.CREATED);
      return result;
    }

    res.status(HttpStatus.NO_CONTENT);
    res.set('Upload-Offset', String(result.offset));
    return undefined;
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @Authenticated({ permission: Permission.AssetUpload, sharedLink: true })
  @Endpoint({
    summary: 'Abort an upload session',
    description: 'Deletes an in-progress upload session and its partial data.',
    history: new HistoryBuilder().added('v1').beta('v1'),
  })
  async deleteUploadSession(@Auth() auth: AuthDto, @Param() { id }: UUIDParamDto): Promise<void> {
    await this.service.abort(auth, id);
  }
}
