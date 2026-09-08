import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { join } from 'node:path';
import { UPLOAD_SESSION_MAX_OPEN, UPLOAD_SESSION_TTL_MS } from 'src/constants';
import { StorageCore } from 'src/cores/storage.core';
import { AssetMediaResponseDto } from 'src/dtos/asset-media-response.dto';
import { UploadFieldName } from 'src/dtos/asset-media.dto';
import { AuthDto } from 'src/dtos/auth.dto';
import { UploadSessionCreateDto, UploadSessionResponseDto } from 'src/dtos/upload-session.dto';
import { StorageFolder } from 'src/enum';
import { AssetMediaService } from 'src/services/asset-media.service';
import { BaseService } from 'src/services/base.service';
import { requireUploadAccess } from 'src/utils/access';
import { getFilenameExtension } from 'src/utils/file';
import {
  committedOffset,
  readState,
  sessionPaths,
  UploadSessionState,
  writeChunkAt,
  writeState,
} from 'src/utils/upload-session-store';

/**
 * A JS string can hold a lone surrogate (e.g. `\uD800` unpaired), which has no lossless UTF-8
 * encoding. `Buffer.from(value, 'utf8')` silently substitutes the replacement character for such
 * a code unit, so a round trip that changes the string proves the original was not valid UTF-8
 * text (spec §8 row 43 — XMP sidecars are XML text, and binary content must be rejected).
 */
const isValidUtf8Text = (value: string): boolean => Buffer.from(value, 'utf8').toString('utf8') === value;

@Injectable()
export class UploadSessionService extends BaseService {
  private get assetMedia(): AssetMediaService {
    return BaseService.create(AssetMediaService, this);
  }

  async create(auth: AuthDto, dto: UploadSessionCreateDto): Promise<UploadSessionResponseDto | AssetMediaResponseDto> {
    const assetMedia = this.assetMedia;

    requireUploadAccess(auth);

    assetMedia.canUploadFile(this.asProbeUploadRequest(auth, dto, ''));

    this.requireQuota(auth, dto.size);

    await this.requireOpenSessionCapacity(auth);

    const duplicate = await assetMedia.getUploadAssetIdByChecksum(auth, dto.checksum);
    if (duplicate) {
      return duplicate;
    }

    if (dto.sidecar !== undefined && !isValidUtf8Text(dto.sidecar)) {
      throw new BadRequestException('Sidecar content must be valid UTF-8 text');
    }

    const uuid = this.cryptoRepository.randomUUID();
    const folder = assetMedia.getUploadFolder(this.asProbeUploadRequest(auth, dto, uuid));
    const { state: statePath } = sessionPaths(folder, uuid, getFilenameExtension(dto.filename));

    const state: UploadSessionState = {
      userId: auth.user.id,
      sharedLinkId: auth.sharedLink?.id ?? null,
      size: dto.size,
      originalName: dto.filename,
      checksum: dto.checksum,
      createdAt: new Date().toISOString(),
      dto: dto as unknown as Record<string, unknown>,
    };

    await writeState(statePath, state);

    return {
      id: uuid,
      offset: 0,
      expiresAt: new Date(Date.now() + UPLOAD_SESSION_TTL_MS).toISOString(),
    };
  }

  async getOffset(auth: AuthDto, id: string): Promise<{ offset: number; size: number }> {
    const { state, dataPath } = await this.loadOwnedSession(auth, id);
    const offset = await committedOffset(dataPath);
    return { offset, size: state.size };
  }

  /**
   * Appends a chunk at `offset`. Returns `{ offset }` when more chunks are expected, or the
   * `AssetMediaResponseDto` produced by `uploadAsset` when this chunk completes the upload
   * (spec §5.4, §5.5). The two return shapes are deliberate — Task 7's controller branches on
   * which one came back to choose 204 vs 201/200 — so this method must not narrow the union.
   */
  async appendChunk(
    auth: AuthDto,
    id: string,
    offset: number,
    chunk: Buffer,
  ): Promise<AssetMediaResponseDto | { offset: number }> {
    if (!Number.isSafeInteger(offset) || offset < 0) {
      throw new BadRequestException('Upload-Offset must be a non-negative integer');
    }

    const { state, dataPath } = await this.loadOwnedSession(auth, id);

    // Rule: the declared offset MUST equal the true on-disk size, or 409 with the real offset.
    // This is the only thing preventing a sparse file (spec §5.4 invariant) — a client ahead of
    // the committed offset and a client replaying an already-committed chunk both 409, because
    // the server cannot verify replayed bytes are identical to what is already on disk.
    const actualOffset = await committedOffset(dataPath);
    if (offset !== actualOffset) {
      throw new ConflictException({ offset: actualOffset });
    }

    if (chunk.length === 0) {
      throw new BadRequestException('Chunk must not be empty');
    }

    if (offset + chunk.length > state.size) {
      throw new BadRequestException('Chunk exceeds the declared Upload-Length');
    }

    await writeChunkAt(dataPath, offset, chunk);

    const newOffset = offset + chunk.length;
    if (newOffset === state.size) {
      // Finalize is implemented in the next commit (Task 6).
      throw new NotFoundException('Upload session not found');
    }

    return { offset: newOffset };
  }

  async abort(auth: AuthDto, id: string): Promise<void> {
    const { dataPath, statePath } = await this.loadOwnedSession(auth, id);
    await this.storageRepository.unlink(dataPath);
    await this.storageRepository.unlink(statePath);
  }

  /**
   * Loads the session state for `id` and confirms it belongs to `auth`. Ownership requires BOTH
   * the user id and the shared-link id to match (both null, or both equal) — a user-token
   * session may not be continued with a shared link, or vice versa (spec §8 row 44). An unknown
   * or foreign session is reported as 404, never 403, so a caller cannot enumerate other users'
   * session ids.
   */
  private async loadOwnedSession(
    auth: AuthDto,
    id: string,
  ): Promise<{ state: UploadSessionState; dataPath: string; statePath: string }> {
    const folder = StorageCore.getNestedFolder(StorageFolder.Upload, auth.user.id, id);
    const { state: statePath } = sessionPaths(folder, id, '');

    const state = await readState(statePath);
    const sharedLinkId = auth.sharedLink?.id ?? null;
    if (!state || state.userId !== auth.user.id || state.sharedLinkId !== sharedLinkId) {
      throw new NotFoundException('Upload session not found');
    }

    const { data: dataPath } = sessionPaths(folder, id, getFilenameExtension(state.originalName));

    return { state, dataPath, statePath };
  }

  /** Duplicated from `AssetMediaService.requireQuota` (private, spec §5.6) rather than exported. */
  private requireQuota(auth: AuthDto, size: number): void {
    if (auth.user.quotaSizeInBytes !== null && auth.user.quotaSizeInBytes < auth.user.quotaUsageInBytes + size) {
      throw new BadRequestException('Quota has been exceeded!');
    }
  }

  /** Per-user cap on simultaneously open chunked-upload sessions (spec §5.6). */
  private async requireOpenSessionCapacity(auth: AuthDto): Promise<void> {
    const userFolder = StorageCore.getFolderLocation(StorageFolder.Upload, auth.user.id);
    const openSessions = await this.countSessionFiles(userFolder);
    if (openSessions >= UPLOAD_SESSION_MAX_OPEN) {
      throw new BadRequestException('Too many open upload sessions');
    }
  }

  private async countSessionFiles(folder: string): Promise<number> {
    let entries: Awaited<ReturnType<typeof this.storageRepository.readdirWithTypes>>;
    try {
      entries = await this.storageRepository.readdirWithTypes(folder);
    } catch (error) {
      if ((error as NodeJS.ErrnoException)?.code === 'ENOENT') {
        return 0;
      }
      throw error;
    }

    let count = 0;
    for (const entry of entries ?? []) {
      if (entry.isDirectory()) {
        count += await this.countSessionFiles(join(folder, entry.name));
      } else if (entry.name.endsWith('.session.json')) {
        count++;
      }
    }
    return count;
  }

  /**
   * `AssetMediaService.canUploadFile` / `.getUploadFolder` accept the multipart-upload
   * `UploadRequest` shape. This builds a stand-in from the create DTO: `uuid` is `''` for the
   * mime-only probe (unused by `canUploadFile`) and the real generated uuid once one exists.
   */
  private asProbeUploadRequest(auth: AuthDto, dto: UploadSessionCreateDto, uuid: string) {
    return {
      auth,
      fieldName: UploadFieldName.ASSET_DATA,
      file: {
        uuid,
        checksum: Buffer.alloc(0),
        originalPath: '',
        originalName: dto.filename,
        size: dto.size,
      },
      body: { filename: dto.filename },
    };
  }
}
