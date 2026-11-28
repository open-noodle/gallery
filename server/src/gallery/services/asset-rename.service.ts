import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import path from 'node:path';
import type { AuthDto } from 'src/dtos/auth.dto.js';
import { AssetRenameTargetState, AssetStatus, ChecksumAlgorithm, JobName, Permission } from 'src/enum.js';
import {
  AssetRenameCheckDto,
  AssetRenameCheckResponseDto,
  AssetRenameDto,
  AssetRenameResponseDto,
} from 'src/gallery/dtos/asset-rename.dto.js';
import type { FileOperationRepository } from 'src/gallery/repositories/file-operation.repository.js';
import { getNormalizedDotExtension, getRenameNameError } from 'src/gallery/utils/rename.js';
import { BaseService } from 'src/services/base.service.js';
import { createLibraryMatcher } from 'src/utils/misc.js';

type Subject = Awaited<ReturnType<FileOperationRepository['getRenameSubjects']>>[number];

type Move = { from: string; to: string };

type FilePlan = {
  subject: Subject;
  newPath: string;
  newFileName: string;
  /** Sidecars on disk that follow the file. */
  sidecars: Move[];
};

type Ghost = { id: string; originalPath: string; checksum: Buffer };

const STATE_ORDER = [
  AssetRenameTargetState.Free,
  AssetRenameTargetState.Offline,
  AssetRenameTargetState.Trashed,
  AssetRenameTargetState.Exists,
];

const worst = (a: AssetRenameTargetState, b: AssetRenameTargetState) =>
  STATE_ORDER.indexOf(a) >= STATE_ORDER.indexOf(b) ? a : b;

const FS_ERROR_MESSAGES: Record<string, string> = {
  EROFS: 'The folder is on a read-only filesystem',
  EACCES: 'Gallery has no permission to write to the folder',
  EPERM: 'Gallery has no permission to write to the folder',
  ENOSPC: 'There is no space left on the device',
};

const describeFsError = (error: unknown) => {
  const code = (error as NodeJS.ErrnoException)?.code;
  return (code && FS_ERROR_MESSAGES[code]) || `The file could not be renamed (${code ?? 'unknown error'})`;
};

const fileMoves = ({ subject, newPath, sidecars }: FilePlan): Move[] => [
  { from: subject.originalPath, to: newPath },
  ...sidecars,
];

/**
In-app rename of a file, mockup stages 2 to 7 of specs/2026-11-10-external-library-move-rename-design.md. A rename that
also renames on disk only runs for an external library asset, holds the file-operation lock, and changes the row, the
file and its sidecars together.
*/
@Injectable()
export class AssetRenameService extends BaseService {
  /** What a rename on disk to this name would meet; always `free` for a file that is not on disk to begin with. */
  async check(auth: AuthDto, id: string, dto: AssetRenameCheckDto): Promise<AssetRenameCheckResponseDto> {
    const { still, motion } = await this.loadOwned(auth, id);
    if (!still.isExternal || !still.libraryId) {
      return { state: AssetRenameTargetState.Free };
    }

    const plans = await this.plan(still, motion, this.requireValidName(still, dto.fileName));
    const { state } = await this.classify(still.libraryId, plans);
    return { state };
  }

  async rename(auth: AuthDto, id: string, dto: AssetRenameDto): Promise<AssetRenameResponseDto> {
    const { still, motion } = await this.loadOwned(auth, id);
    const name = this.requireValidName(still, dto.fileName);

    if (!dto.renameOnDisk) {
      return this.renameDisplayName(still, motion, name);
    }

    if (!still.isExternal || !still.libraryId) {
      throw new BadRequestException('Only a file in an external library can be renamed on disk');
    }

    const libraryId = still.libraryId;
    const library = await this.libraryRepository.get(libraryId);
    if (!library) {
      throw new BadRequestException('The library of this asset was not found');
    }

    const plans = await this.plan(still, motion, name);
    const isIncluded = createLibraryMatcher(library);
    const excluded = plans.find(({ newPath }) => !isIncluded(newPath));
    if (excluded) {
      throw new BadRequestException(`${path.basename(excluded.newPath)} would be excluded from the library`);
    }

    const outcome = await this.fileOperationRepository.tryRun(() => this.renameFiles(libraryId, plans, dto));
    if (!outcome.acquired) {
      throw new ConflictException('Another file operation is running. Try again in a moment.');
    }

    await this.jobRepository.queueAll(
      outcome.result.map(({ id }) => ({ name: JobName.AssetDelete, data: { id, deleteOnDisk: false } })),
    );

    return { originalFileName: plans[0].newFileName, originalPath: plans[0].newPath };
  }

  /** The still, and its motion video when it is a live photo. Only the owner may rename. */
  private async loadOwned(auth: AuthDto, id: string) {
    await this.requireAccess({ auth, permission: Permission.AssetUpdate, ids: [id] });

    const [still] = await this.fileOperationRepository.getRenameSubjects([id]);
    if (!still) {
      throw new NotFoundException('Asset not found');
    }

    // AssetUpdate is owner-only today; keep the check so a widened grant can never let someone else rename a file.
    if (still.ownerId !== auth.user.id) {
      throw new ForbiddenException('Only the owner can rename a file');
    }

    const [motion] = still.livePhotoVideoId
      ? await this.fileOperationRepository.getRenameSubjects([still.livePhotoVideoId])
      : [];
    return { still, motion };
  }

  private requireValidName(still: Subject, name: string) {
    const error = getRenameNameError(name, getNormalizedDotExtension(still.originalFileName));
    if (error) {
      throw new BadRequestException(error);
    }
    return name;
  }

  private async renameDisplayName(still: Subject, motion: Subject | undefined, name: string) {
    const originalFileName = name + getNormalizedDotExtension(still.originalFileName);
    const items = [{ id: still.id, originalFileName }];
    if (motion) {
      items.push({ id: motion.id, originalFileName: name + getNormalizedDotExtension(motion.originalFileName) });
    }

    await this.fileOperationRepository.setFileNames(items);
    return { originalFileName, originalPath: still.originalPath };
  }

  /** The new paths of the still and its motion video, and the sidecars that follow each. */
  private async plan(still: Subject, motion: Subject | undefined, name: string): Promise<FilePlan[]> {
    const subjects = motion ? [still, motion] : [still];
    const registered = await this.fileOperationRepository.getSidecarPaths(subjects.map(({ id }) => id));
    const claimed = new Set<string>();

    const plans: FilePlan[] = [];
    for (const subject of subjects) {
      const newFileName = name + getNormalizedDotExtension(subject.originalFileName);
      const folder = path.dirname(subject.originalPath);
      const newPath = path.join(folder, name + getNormalizedDotExtension(subject.originalPath));

      const candidates: Move[] = [
        // IMG_123.jpg.xmp
        { from: `${subject.originalPath}.xmp`, to: `${newPath}.xmp` },
        // IMG_123.xmp
        {
          from: `${path.join(folder, path.parse(subject.originalPath).name)}.xmp`,
          to: `${path.join(folder, name)}.xmp`,
        },
      ];
      const own = new Set(registered.filter(({ assetId }) => assetId === subject.id).map((file) => file.path));

      const sidecars: Move[] = [];
      for (const candidate of candidates) {
        // A live photo's two files may share IMG_123.xmp; the first one takes it.
        if (claimed.has(candidate.from) || candidate.from === candidate.to) {
          continue;
        }

        if (!(own.has(candidate.from) || (await this.storageRepository.checkFileExists(candidate.from)))) {
          continue;
        }

        claimed.add(candidate.from);
        sidecars.push(candidate);
      }

      plans.push({ subject, newPath, newFileName, sidecars });
    }

    return plans;
  }

  /** Whether a different file sits at the target; a case-only rename on a case-insensitive disk meets itself. */
  private async isOtherFile({ from, to }: Move) {
    if (from === to || !(await this.storageRepository.checkFileExists(to))) {
      return false;
    }

    try {
      const [source, target] = await Promise.all([this.storageRepository.stat(from), this.storageRepository.stat(to)]);
      return source.ino !== target.ino || source.dev !== target.dev;
    } catch {
      return true;
    }
  }

  private async classify(
    libraryId: string,
    plans: FilePlan[],
  ): Promise<{ state: AssetRenameTargetState; ghosts: Ghost[] }> {
    for (const move of plans.flatMap((plan) => fileMoves(plan))) {
      if (await this.isOtherFile(move)) {
        return { state: AssetRenameTargetState.Exists, ghosts: [] };
      }
    }

    const moving = plans.filter(({ subject, newPath }) => newPath !== subject.originalPath);
    if (moving.length === 0) {
      return { state: AssetRenameTargetState.Free, ghosts: [] };
    }

    const own = new Set(plans.map(({ subject }) => subject.id));
    const rows = await this.fileOperationRepository.getAtPaths(
      libraryId,
      moving.map(({ newPath }) => newPath),
      moving.map(({ newPath }) => this.pathChecksum(newPath)),
    );

    let state = AssetRenameTargetState.Free;
    const ghosts: Ghost[] = [];
    for (const row of rows) {
      if (own.has(row.id)) {
        continue;
      }

      if (row.status === AssetStatus.Trashed) {
        state = worst(state, AssetRenameTargetState.Trashed);
      } else if (row.isOffline || row.status === AssetStatus.Deleted) {
        state = worst(state, AssetRenameTargetState.Offline);
      } else {
        return { state: AssetRenameTargetState.Exists, ghosts: [] };
      }

      ghosts.push({ id: row.id, originalPath: row.originalPath, checksum: row.checksum });
    }

    return { state, ghosts };
  }

  private pathChecksum(filePath: string) {
    return this.cryptoRepository.hashSha1(`path:${filePath}`);
  }

  /** Runs under the file-operation lock. Returns the rows the rename replaced, for deletion once it committed. */
  private async renameFiles(libraryId: string, plans: FilePlan[], dto: AssetRenameDto): Promise<Ghost[]> {
    const { state, ghosts } = await this.classify(libraryId, plans);
    if (state === AssetRenameTargetState.Exists) {
      throw new ConflictException({ message: 'A file already exists at the new name', state });
    }

    if (state === AssetRenameTargetState.Trashed && !dto.deleteTrashed) {
      throw new ConflictException({ message: 'An item in the trash holds the new name', state });
    }

    const moves = plans.flatMap((plan) => fileMoves(plan)).filter(({ from, to }) => from !== to);
    if (moves.length === 0) {
      return [];
    }

    for (const { subject } of plans) {
      if (!(await this.storageRepository.checkFileExists(subject.originalPath))) {
        throw new ConflictException('The file is missing on disk');
      }
    }

    await this.probeWritable(path.dirname(plans[0].subject.originalPath));

    const done: Move[] = [];
    const rollBack = async () => {
      for (const { from, to } of done.toReversed()) {
        try {
          await this.storageRepository.rename(to, from);
        } catch (error) {
          this.logger.error(`Could not move ${to} back to ${from} after a failed rename: ${error}`);
        }
      }
    };

    try {
      for (const move of moves) {
        await this.storageRepository.rename(move.from, move.to);
        done.push(move);
      }
    } catch (error) {
      await rollBack();
      throw new ConflictException(describeFsError(error));
    }

    let committed: boolean;
    try {
      committed = await this.fileOperationRepository.applyRename({
        replaced: ghosts.map(({ id, originalPath, checksum }) => ({
          id,
          originalPath: `${originalPath}.replaced-${id}`,
          checksum: this.cryptoRepository.hashSha1(`replaced:${id}:${checksum.toString('hex')}`),
        })),
        renames: plans.map(({ subject, newPath, newFileName }) => ({
          id: subject.id,
          oldPath: subject.originalPath,
          originalPath: newPath,
          originalFileName: newFileName,
          // Only a path checksum follows the path; any other kind describes the content.
          checksum: subject.checksumAlgorithm === ChecksumAlgorithm.sha1Path ? this.pathChecksum(newPath) : undefined,
        })),
        sidecars: plans.flatMap(({ subject, sidecars }) =>
          sidecars.map(({ from, to }) => ({ assetId: subject.id, oldPath: from, newPath: to })),
        ),
      });
    } catch (error) {
      await rollBack();
      throw error;
    }

    if (!committed) {
      await rollBack();
      throw new ConflictException('The asset changed while it was renamed. Nothing was renamed.');
    }

    return ghosts;
  }

  /** A real write, since access(W_OK) can claim a read-only bind mount is writable. */
  private async probeWritable(folder: string) {
    const probe = path.join(folder, `.gallery-write-probe-${this.cryptoRepository.randomUUID()}.xmp`);
    try {
      await this.storageRepository.createFile(probe, Buffer.alloc(0));
    } catch (error) {
      throw new ConflictException(describeFsError(error));
    }

    try {
      await this.storageRepository.unlink(probe);
    } catch (error) {
      this.logger.warn(`Could not remove the write probe ${probe}: ${error}`);
    }
  }
}
