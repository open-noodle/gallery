import { Injectable, NotFoundException } from '@nestjs/common';
import { extname } from 'node:path';
import { JOBS_ASSET_PAGINATION_SIZE } from 'src/constants.js';
import { OnEvent, OnJob } from 'src/decorators.js';
import { isMetadataHidden, type AuthDto } from 'src/dtos/auth.dto.js';
import {
  AssetFileType,
  AssetVisibility,
  CacheControl,
  ImmichWorker,
  JobName,
  JobStatus,
  Permission,
  QueueName,
} from 'src/enum.js';
import { AssetVersionResponseDto, AssetVersionsResponseDto } from 'src/gallery/dtos/asset-version.dto.js';
import { NAME_SEARCH_LIMIT, type StoredRead } from 'src/gallery/repositories/asset-version.repository.js';
import { applyVisibilityTransitionSideEffects } from 'src/gallery/services/asset-visibility-transition.service.js';
import { readOf, shouldLook, toLinkInput, usableTimeMatches } from 'src/gallery/utils/asset-version-candidates.js';
import { desiredLook, isLookCurrent, photoKind } from 'src/gallery/utils/asset-version-look.js';
import { searchNames } from 'src/gallery/utils/asset-version-names.js';
import {
  NAME_WINDOW_SECONDS,
  SAME_TIME_LIMIT,
  kindOf,
  linkFile,
  namesOfMissingCameraFile,
  type LinkOutcome,
  type VersionCandidate,
  type VersionKind,
} from 'src/gallery/utils/asset-version-rules.js';
import {
  READ_PARSER_VERSION,
  hasTags,
  instructionsOf,
  toCaptureSignature,
  type FileRead,
} from 'src/gallery/utils/asset-version-signature.js';
import type { ArgOf } from 'src/repositories/event.repository.js';
import { BaseService } from 'src/services/base.service.js';
import type { JobItem, JobOf } from 'src/types.js';
import type { ImmichMediaResponse } from 'src/utils/file.js';
import { mimeTypes } from 'src/utils/mime-types.js';

/** Jobs that delete assets without an AssetDelete event per asset, after which the cleanup runs. */
const CLEANUP_AFTER = new Set<JobName>([JobName.LibraryRemoveAsset, JobName.LibraryDelete, JobName.AssetDeleteCheck]);

/** How many photos the undo takes at a time, checking between batches that versions are still off. */
const UNDO_BATCH = 100;

/** Files of the same name whose metadata Immich has not read yet: at most this many are read by a job itself. */
const NOT_YET_READ_LIMIT = 10;

/** What a source looks like in a version's card: the editor that made an edit; the camera for its own files. */
const sourceOf = (kind: VersionKind, signature: { software: string | null }) => {
  if (kind !== 'edit') {
    return 'camera';
  }
  const software = signature.software?.toLowerCase() ?? '';
  for (const [needle, name] of [
    ['lightroom', 'lightroom'],
    ['camera raw', 'camera-raw'],
    ['photoshop', 'photoshop'],
    ['darktable', 'darktable'],
    ['rawtherapee', 'rawtherapee'],
    ['capture one', 'capture-one'],
    ['dxo', 'dxo'],
    ['gimp', 'gimp'],
    ['digikam', 'digikam'],
  ] as const) {
    if (software.includes(needle)) {
      return name;
    }
  }
  return signature.software ? 'editor' : null;
};

/** Why two files were combined, in words, by how the file was found for its shot (see asset-version-rules.ts). */
const RULE_WORDS: Record<string, string> = {
  name: `same file name, taken within ${NAME_WINDOW_SECONDS} seconds`,
  time: 'the edit names the file it was made from, taken at exactly the same time',
  paired: 'it belongs to a shot that was combined before',
};

/** Why two files of one shot were left apart, in words. */
const REASON_WORDS: Record<string, string> = {
  'ambiguous-camera-file': 'more than one camera file matches this RAW',
  'ambiguous-raw': 'more than one RAW matches the same camera file',
  'ambiguous-source': 'it could have been made from more than one shot',
  'unreadable-file': 'a file of the same name could not be read',
  'has-own-attachments':
    'it is in an album, a Space, a shared link or the favourites, or has comments, edits or faces marked by hand, that the photo does not have',
  'not-eligible': 'one of them is in the trash, offline or locked',
  'two-photos': 'both already have versions behind them',
  'contradicting-files': 'files of this shot name different cameras, shot numbers or time zones',
  'version-of-another-photo': 'it is already behind another photo',
  'different-owners': 'they belong to different users',
  'not-found': 'one of them is gone',
};

const words = (decision: 'combined' | 'not-combined', reason: string) =>
  decision === 'combined'
    ? (RULE_WORDS[reason.slice(reason.indexOf(':') + 1)] ?? reason)
    : (REASON_WORDS[reason] ?? reason);

/**
Asset versions (specs/2026-11-07-asset-versions-design.md): the files of one shot are one photo. One of them is the
photo and keeps its id for good; the others (the RAW, the original, edits) are hidden assets behind it; the photo's
picture is its newest edit, rendered onto it by the edit job. Once the admin enables them, Gallery does this itself
from the files' metadata: nothing is paired, separated or chosen by hand. Everyone who can see the photo sees its
versions.
*/
/** How far the search by name looks either side of a file's capture time (see `around`). */
const NAME_SEARCH_SECONDS = 2 * NAME_WINDOW_SECONDS;
/** How many times the files to be paired are searched around before the job gives up (`findAroundPairings`). */
const MAX_SEARCH_ROUNDS = 3;

@Injectable()
export class AssetVersionService extends BaseService {
  private async getSettings() {
    const { server } = await this.getConfig({ withCache: true });
    return server.assetVersions;
  }

  private async isEnabled() {
    const settings = await this.getSettings();
    return settings.enabled;
  }

  /**
  The files of the photo's shot: the ones behind it and, when there are any, its own file, each with what it is and
  whether it is the one shown. Edits first, newest on top, then the original, then the RAW. None while versions
  are switched off: what was combined stays as it is, and is not shown (so neither client shows the section). None
  either for a shared link that hides metadata: the list is file names and dates.
  */
  async getVersions(auth: AuthDto, id: string): Promise<AssetVersionsResponseDto> {
    await this.requireAccess({ auth, permission: Permission.AssetRead, ids: [id] });
    if (!(await this.isEnabled()) || isMetadataHidden(auth)) {
      return { assetId: id, versions: [] };
    }
    const rows = await this.assetVersionRepository.getVersions(id);
    const photo = rows.length > 0 ? await this.assetVersionRepository.getPhoto(id) : undefined;
    if (!photo) {
      return { assetId: id, versions: [] };
    }
    // Gallery's own editor applies to the photo's own file, and wins while it has edits
    const shownId = photo.lookSourceId && !photo.hasEditorEdits ? photo.lookSourceId : photo.id;
    const kind = photoKind(photo);
    // with a look, the asset's size and thumbhash are the shown edit's: the row is about the photo's own file
    const sideways = [5, 6, 7, 8].includes(Number(photo.orientation));
    const own = photo.hasLook
      ? {
          width: sideways ? photo.exifImageHeight : photo.exifImageWidth,
          height: sideways ? photo.exifImageWidth : photo.exifImageHeight,
          thumbhash: null,
        }
      : { width: photo.width, height: photo.height, thumbhash: photo.thumbhash };
    const files = [
      { ...photo, ...own, kind, source: photo.source ?? sourceOf(kind, { software: null }), rule: 'photo' },
      ...rows.map((row) => ({ ...row, thumbhash: row.thumbhash })),
    ];
    const order: Record<VersionKind, number> = { edit: 0, original: 1, raw: 2 };
    const sorted = files.toSorted(
      (a, b) =>
        order[a.kind] - order[b.kind] ||
        new Date(b.fileModifiedAt).getTime() - new Date(a.fileModifiedAt).getTime() ||
        a.id.localeCompare(b.id),
    );
    return {
      assetId: id,
      versions: sorted.map((row): AssetVersionResponseDto => ({
        id: row.id,
        kind: row.kind,
        source: row.source,
        rule: row.rule,
        shown: row.id === shownId,
        originalFileName: row.originalFileName,
        originalMimeType: mimeTypes.lookup(row.originalFileName),
        fileSizeInByte: row.fileSizeInByte === null ? null : Number(row.fileSizeInByte),
        width: row.width,
        height: row.height,
        thumbhash: row.thumbhash ? row.thumbhash.toString('base64') : null,
        fileCreatedAt: new Date(row.fileCreatedAt).toISOString(),
        fileModifiedAt: new Date(row.fileModifiedAt).toISOString(),
        isOffline: row.isOffline,
      })),
    };
  }

  /** A version's thumbnail or preview, for whoever may see the photo. */
  async viewImage(auth: AuthDto, id: string, versionId: string, size?: 'thumbnail' | 'preview') {
    await this.requireAccess({ auth, permission: Permission.AssetView, ids: [id] });
    await this.requireVersionOf(id, versionId);
    const type = size === 'preview' ? AssetFileType.Preview : AssetFileType.Thumbnail;
    const file = await this.assetVersionRepository.getVersionFile(versionId, type);
    if (!file) {
      throw new NotFoundException('Version image not found');
    }
    return this.backendMedia.serveFromBackend(file.path, mimeTypes.lookup(file.path), CacheControl.PrivateWithCache);
  }

  /** A version's file, for whoever may download the photo. */
  async downloadOriginal(auth: AuthDto, id: string, versionId: string, download: boolean, range?: string) {
    await this.requireAccess({ auth, permission: Permission.AssetDownload, ids: [id] });
    await this.requireVersionOf(id, versionId);
    const [version] = await this.assetRepository.getByIds([versionId]);
    if (!version) {
      throw new NotFoundException('Version not found');
    }
    return this.backendMedia.serveFromBackend(
      version.originalPath,
      mimeTypes.lookup(version.originalPath),
      CacheControl.PrivateWithCache,
      // a shared link that hides metadata sees no file names: named by its id, as Immich names a thumbnail there
      isMetadataHidden(auth) ? `${versionId}${extname(version.originalFileName)}` : version.originalFileName,
      download ? 'attachment' : 'inline',
      { range, acceptsRanges: true },
    ) as Promise<ImmichMediaResponse>;
  }

  // New and re-read files are detected once their metadata is in (any order of arrival: each side's job sees the
  // other once it exists). A sidecar write by Gallery itself changes nothing detection reads.
  @OnEvent({ name: 'AssetMetadataExtracted' })
  async onAssetMetadataExtracted({ assetId, source }: ArgOf<'AssetMetadataExtracted'>) {
    if (source === 'sidecar-write' || !(await this.isEnabled())) {
      return;
    }
    await this.jobRepository.queue({ name: JobName.AssetVersionDetect, data: { id: assetId, force: true } });
  }

  // The cleanup deletes the versions of deleted photos and finishes pairings whose follow-up did not complete. It is
  // queued (deduplicated: one waiting at a time) whenever photos may have been deleted, including by paths that emit
  // no event (a library's file watcher), and at start-up, whether versions are enabled or not.
  @OnEvent({ name: 'AssetDelete' })
  async onAssetDelete() {
    await this.queueCleanup();
  }

  @OnEvent({ name: 'AppBootstrap', workers: [ImmichWorker.Microservices] })
  async onBootstrap() {
    await this.queueCleanup();
  }

  @OnEvent({ name: 'JobSuccess' })
  async onJobSuccess({ job, response }: ArgOf<'JobSuccess'>) {
    if (CLEANUP_AFTER.has(job.name)) {
      await this.queueCleanup();
    }
    // a newer edit may have gone behind the photo while its picture was being rendered from the one before, or two
    // renders ran at once and the older one wrote last. A job that reports failure is not chased: it would be
    // queued again for ever; the next detection of the shot, or the cleanup, tries again
    if (job.name === JobName.AssetEditThumbnailGeneration && response !== JobStatus.Failed) {
      await this.refreshLook(job.data.id, true);
    }
  }

  /**
  Has the photo's picture rendered again when its edited files were not made from the file they should be, as that
  file is now. After a render (`rendered`), only a look that exists counts: one the job could not make is not
  retried here, or it would be retried for ever.
  */
  private async refreshLook(photoId: string, rendered = false) {
    const photo = await this.assetVersionRepository.getPhoto(photoId);
    if (!photo || photo.hasEditorEdits || (rendered && !photo.hasLook)) {
      return;
    }
    const desired = await desiredLook(this.assetVersionRepository, photoId);
    if (!isLookCurrent(photo, desired) || (!desired && photo.hasLook)) {
      await this.jobRepository.queue({ name: JobName.AssetEditThumbnailGeneration, data: { id: photoId } });
    }
  }

  private queueCleanup() {
    return this.jobRepository.queue({ name: JobName.AssetVersionCleanup, data: {} });
  }

  @OnJob({ name: JobName.AssetVersionCleanup, queue: QueueName.AssetVersions })
  async handleCleanup(): Promise<JobStatus> {
    // until a pass finds nothing: a deletion while this job runs cannot queue another one (one at a time), so this
    // one picks it up; what still slips past is caught by the next start-up or the nightly AssetDeleteCheck
    for (let pass = 0; pass < 100; pass++) {
      const orphans = await this.assetVersionRepository.getOrphans();
      if (orphans.length === 0) {
        break;
      }
      await this.jobRepository.queueAll(
        orphans.map(({ id, libraryId }) => ({
          name: JobName.AssetDelete,
          // an external library's file is the user's: only Gallery's own copy of an upload is deleted from disk
          data: { id, deleteOnDisk: libraryId === null },
        })),
      );
      await this.assetVersionRepository.markCleanupQueued(orphans.map(({ id }) => id));
    }
    // a photo whose picture is not the one it should be is rendered again: from its newest edit as things are now,
    // or back to its own file. A page at a time, so that renders that keep failing do not hold up the others
    let afterLook: string | undefined;
    for (;;) {
      const stale = await this.assetVersionRepository.getOutdatedLooks(afterLook);
      // stamped before the jobs exist: a render that finishes at once clears the stamp, and nothing writes it back
      await this.assetVersionRepository.markLookQueued(stale.map(({ assetId }) => assetId));
      await this.jobRepository.queueAll(
        stale.map(({ assetId }) => ({ name: JobName.AssetEditThumbnailGeneration as const, data: { id: assetId } })),
      );
      if (stale.length < 1000) {
        break;
      }
      afterLook = stale.at(-1)!.assetId;
    }
    // what is left of a shot with no file behind its base photo and no picture from another (the reset of a picture
    // removes the row itself; this catches one that slipped past)
    for (const { assetId } of await this.assetVersionRepository.getEmptyBasePhotos()) {
      await this.assetVersionRepository.removeEmptyBasePhoto(assetId);
    }
    // every pending follow-up, a page at a time; one that fails again stays pending for the next run
    let after: string | undefined;
    for (;;) {
      const page = await this.assetVersionRepository.getUnsynced(after);
      for (const { versionAssetId } of page) {
        try {
          await this.afterPaired([{ versionId: versionAssetId, priorVisibility: undefined }]);
        } catch (error) {
          this.logger.warn(`Could not finish pairing version ${versionAssetId}: ${error}`);
        }
      }
      if (page.length < 1000) {
        break;
      }
      after = page.at(-1)!.versionAssetId;
    }
    return JobStatus.Success;
  }

  @OnJob({ name: JobName.AssetVersionDetectQueueAll, queue: QueueName.AssetVersions })
  async handleQueueAll({ force }: JobOf<JobName.AssetVersionDetectQueueAll>): Promise<JobStatus> {
    await this.handleCleanup();
    // versions hidden before their first thumbnail job, or every version with "All"; the thumbnail queue's own
    // Missing/All skip hidden assets
    let thumbnails: JobItem[] = [];
    for await (const version of this.assetVersionRepository.streamForThumbnails(force)) {
      thumbnails.push({ name: JobName.AssetGenerateThumbnails, data: { id: version.id } });
      if (thumbnails.length < JOBS_ASSET_PAGINATION_SIZE) {
        continue;
      }
      await this.jobRepository.queueAll(thumbnails);
      thumbnails = [];
    }
    await this.jobRepository.queueAll(thumbnails);
    if (!(await this.isEnabled())) {
      return JobStatus.Success;
    }
    // an "All" run reads every file again, once: a file another job of the run has read since is not read again
    const runStartedAt = force ? new Date().toISOString() : undefined;
    let jobs: JobItem[] = [];
    for await (const asset of this.assetVersionRepository.streamForQueue(force)) {
      jobs.push({ name: JobName.AssetVersionDetect, data: { id: asset.id, force, runStartedAt } });
      if (!(jobs.length >= JOBS_ASSET_PAGINATION_SIZE)) {
        continue;
      }

      await this.jobRepository.queueAll(jobs);
      jobs = [];
    }
    await this.jobRepository.queueAll(jobs);
    return JobStatus.Success;
  }

  /**
  Undoes versions: every version becomes a photo of its own again, shown and stacked the way it was before it went
  behind its photo (asset-version-undo.ts). Started by an administrator, and only while versions are switched
  off: with them on, the files would be combined again right away. Nothing is deleted, and switching versions on
  and running the Versions job combines the same files again. The steps, in order:
  1. only while versions are off (checked again before every photo); 2. the versions of deleted photos go the way
  the cleanup sends them; 3. photo by photo, its versions are shown again and what was decided about its files is
  forgotten; 4. Spaces and the owner's apps learn that they are back; 5. a photo that showed an edit shows its own
  file again; 6. the files that were hidden are analysed like any other photo (search, faces, text, duplicates).
  
  A run that stops half way is finished by running it again: the photos done are done, a photo's stale picture is
  marked in the same transaction that undoes it (the cleanup, which every run starts with, has it rendered), and
  the analysis is queued by every run, whatever it found to undo.
  */
  @OnJob({ name: JobName.AssetVersionUndo, queue: QueueName.AssetVersions })
  async handleUndo(): Promise<JobStatus> {
    if (await this.isEnabled()) {
      this.logger.warn('Versions are switched on: they are undone only while they are off');
      return JobStatus.Skipped;
    }
    await this.handleCleanup();

    let photos = 0;
    let versions = 0;
    let stopped = false;
    while (!stopped) {
      const batch = await this.assetVersionRepository.getPhotosWithVersions(UNDO_BATCH);
      if (batch.length === 0) {
        break;
      }
      for (const { assetId } of batch) {
        if (await this.isEnabled()) {
          this.logger.warn('Versions were switched on while they were being undone: stopped');
          stopped = true;
          break;
        }
        const { ownerId, restored } = await this.assetVersionRepository.undo(assetId);
        const shown = restored.filter(({ visibility }) => visibility !== AssetVisibility.Locked).map(({ id }) => id);
        if (ownerId && shown.length > 0) {
          await applyVisibilityTransitionSideEffects(
            { albumRepository: this.albumRepository, sharedSpaceRepository: this.sharedSpaceRepository },
            shown,
            AssetVisibility.Timeline,
            new Map(shown.map((id) => [id, AssetVisibility.Hidden])),
          );
          // the owner's open apps sync on this, as after a restore from the trash
          this.websocketRepository.clientSend('on_asset_restore', ownerId, shown);
        }
        await this.refreshLook(assetId);
        photos++;
        versions += restored.length;
      }
    }
    // hidden files were skipped by these, and a photo with an edit behind it by duplicate detection: their "missing"
    // runs take exactly the files that were never analysed. Queued by every run, so a run that stopped half way is
    // made good by the next one. (Duplicate detection needs the search data first: a file it comes to too early
    // stays missing for its next run.)
    await this.jobRepository.queueAll([
      { name: JobName.SmartSearchQueueAll, data: { force: false } },
      { name: JobName.AssetDetectFacesQueueAll, data: { force: false } },
      { name: JobName.OcrQueueAll, data: { force: false } },
      { name: JobName.AssetDetectDuplicatesQueueAll, data: { force: false } },
    ]);
    this.logger.log(`Versions undone: ${versions} files of ${photos} photos are photos of their own again`);
    return JobStatus.Success;
  }

  /**
  One job per file: after its metadata was read, or from the Versions job. The steps, in order:
  1. should we look at all; 2. read the file; 3. find the candidates, by name and by time; 4. read the candidates
  not read yet; 5. link (pure: asset-version-rules.ts); 6. apply; 7. finish.

  What is read during a job is held for the whole job (`reads`), failures too. A file that is part of a combined
  shot keeps its read on its row, so the next job that finds it does not read it again; one that is not is read
  again by the next job that finds it. The "All" run reads each file's own file again, unless another job of the
  same run has just read it (only a file of a combined shot keeps that read).
  */
  @OnJob({ name: JobName.AssetVersionDetect, queue: QueueName.AssetVersions })
  async handleDetect({ id, force, runStartedAt }: JobOf<JobName.AssetVersionDetect>): Promise<JobStatus> {
    const settings = await this.getSettings();
    const file = await this.assetVersionRepository.getForDetection(id);
    if (!file || !shouldLook(settings, file)) {
      return JobStatus.Skipped;
    }
    const reads = new Map<string, FileRead>();
    const kept = readOf(file, reads, READ_PARSER_VERSION);
    const readThisRun = !!kept && !!runStartedAt && new Date(kept.readAt) >= new Date(runStartedAt);
    if (!kept || (force && !readThisRun)) {
      await this.readFiles([file], reads);
    }

    const found = await this.findCandidates(file);
    if (!found) {
      // the search by name was cut off, so which files it holds is arbitrary: nothing is decided on a part of them
      this.logger.debug(
        `Versions: ${file.originalFileName} (${id}) left as it is: ${NAME_SEARCH_LIMIT} or more files of its name ` +
          `were taken within ${NAME_SEARCH_SECONDS} seconds of it`,
      );
      return JobStatus.Skipped;
    }
    let rows = await this.readCandidates(found.ids, reads, runStartedAt);
    const readFor = (id: string) => {
      const row = rows.find((candidate) => candidate.id === id);
      return row ? (readOf(row, reads, READ_PARSER_VERSION) ?? null) : null;
    };
    // a file at the same time that could not be read may be the one an edit was made from: the files that could be
    // read are then not taken for the only match, and the time finds nothing for this job
    const timeUnreadable = rows.some((row) => found.atTime.has(row.id) && readFor(row.id)?.status !== 'ok');
    const matchByTime = found.matchByTime && !timeUnreadable;
    const link = () => {
      const { candidates, attachments, unreadable } = toLinkInput(rows, reads, READ_PARSER_VERSION);
      const outcome = linkFile(id, candidates, attachments, {
        detectEdits: settings.detectEdits,
        matchByTime,
        unreadable,
      });
      return { outcome, byId: new Map(candidates.map((candidate) => [candidate.id, candidate])) };
    };
    let { outcome, byId } = link();

    // a RAW is about to become the photo with an edit behind it: is the camera's JPEG of the shot here, and was not
    // found? Then it is read now, and the linking is done again with it
    const cameraFiles = await this.findMissingCameraFile(file, outcome, rows);
    if (!cameraFiles) {
      this.logger.debug(
        `Versions: ${file.originalFileName} (${id}) left as it is: ${NAME_SEARCH_LIMIT} or more files of its shot's ` +
          `names were taken within ${NAME_SEARCH_SECONDS} seconds of it`,
      );
      return JobStatus.Skipped;
    }
    if (cameraFiles.length > 0) {
      rows = await this.readCandidates([...found.ids, ...cameraFiles], reads, runStartedAt);
      ({ outcome, byId } = link());
    }

    // the files about to be paired come with every file they could go with, also beyond this job's own search
    let known = new Set([...found.ids, ...cameraFiles]);
    for (let round = 1; ; round++) {
      const more = await this.findAroundPairings(file, outcome, rows, known);
      if (more === null || (more.length > 0 && round > MAX_SEARCH_ROUNDS)) {
        this.logger.debug(
          `Versions: ${file.originalFileName} (${id}) left as it is: the files of its shot's names reach too far`,
        );
        return JobStatus.Skipped;
      }
      if (more.length === 0) {
        break;
      }
      known = new Set([...known, ...more]);
      rows = await this.readCandidates([...known], reads, runStartedAt);
      ({ outcome, byId } = link());
    }

    const paired = await this.apply(outcome, byId, readFor);
    await this.finish(outcome.photoId, paired);
    return JobStatus.Success;
  }

  /**
  Step 3: the files that could be of the job's file's shot, from the database alone. By name: the owner's files in
  the same library whose name contains the file's base name (asset-version-names.ts), taken within twenty seconds (`around`). By
  time: those taken at exactly the same time, unless ten or more share it (a camera whose clock was never set). By
  folder: those stored beside it under the same name, whenever they were taken (the folder rule).
  */
  private async findCandidates(file: {
    id: string;
    ownerId: string;
    libraryId: string | null;
    originalFileName: string;
    originalPath: string;
    localDateTime: Date;
  }): Promise<{ ids: string[]; atTime: Set<string>; matchByTime: boolean } | null> {
    const { from, to } = this.around(file.localDateTime);
    const byName = await this.assetVersionRepository.getCandidatesByName(
      file.ownerId,
      file.libraryId,
      searchNames(file.originalFileName),
      from,
      to,
    );
    if (byName.length >= NAME_SEARCH_LIMIT) {
      return null;
    }
    const atTime = usableTimeMatches(
      await this.assetVersionRepository.getCandidatesAtTime(
        file.ownerId,
        file.libraryId,
        new Date(file.localDateTime as unknown as string | Date),
        SAME_TIME_LIMIT,
      ),
      SAME_TIME_LIMIT,
    );
    const inFolder = await this.assetVersionRepository.getCandidatesInFolder(
      file.ownerId,
      file.libraryId,
      file.originalPath,
      file.originalFileName,
    );
    const ids = new Set([
      file.id,
      ...byName.map((row) => row.id),
      ...atTime.rows.map((row) => row.id),
      ...inFolder.map((row) => row.id),
    ]);
    return { ids: [...ids], atTime: new Set(atTime.rows.map((row) => row.id)), matchByTime: atTime.matchByTime };
  }

  /**
  Step 5, again: the rules pair two files only when each is the other's only match, and a file to be paired may have
  a match this job's search did not reach (an edit finds a RAW whose second JPEG of the same name is further on, or a
  RAW of another name taken at the edit's exact time). So the files of each pairing are searched around too, the
  same ways as the job's own file (by name, at exactly its time, and in its folder): the ids found that the job did
  not have yet, or null when a search by name was cut off (the job then decides nothing).
  */
  private async findAroundPairings(
    file: { id: string; ownerId: string; libraryId: string | null },
    outcome: LinkOutcome,
    rows: Array<{ id: string; originalFileName: string; originalPath: string; localDateTime: Date }>,
    known: Set<string>,
  ): Promise<string[] | null> {
    const paired = new Set(outcome.pairings.flatMap(({ photoId, versionId }) => [photoId, versionId]));
    paired.delete(file.id);
    const more = new Set<string>();
    for (const row of rows) {
      if (!paired.has(row.id)) {
        continue;
      }
      const { from, to } = this.around(row.localDateTime);
      const found = await this.assetVersionRepository.getIdsAround(
        file.ownerId,
        file.libraryId,
        searchNames(row.originalFileName),
        from,
        to,
        new Date(row.localDateTime as unknown as string | Date),
      );
      if (found.byName.length >= NAME_SEARCH_LIMIT) {
        return null;
      }
      const inFolder = await this.assetVersionRepository.getCandidatesInFolder(
        file.ownerId,
        file.libraryId,
        row.originalPath,
        row.originalFileName,
      );
      for (const id of [...found.byName, ...found.atTime, ...inFolder.map((candidate) => candidate.id)]) {
        if (!known.has(id)) {
          more.add(id);
        }
      }
    }
    return [...more];
  }

  /**
  Twenty seconds either side of a capture time: twice the window the rules allow between two files of a shot, so
  that a file found within it comes with the other files it could go with too. Without them, a file could be taken
  for the only match of another (the JPEG for the RAW taken nine seconds before it) when a second one is there (a
  RAW of the same name nine seconds after the JPEG), and the choice would depend on which job ran first.
  */
  private around(localDateTime: Date) {
    const taken = new Date(localDateTime as unknown as string | Date).getTime();
    return { from: new Date(taken - NAME_SEARCH_SECONDS * 1000), to: new Date(taken + NAME_SEARCH_SECONDS * 1000) };
  }

  /**
  Step 4: the candidates, reading with ExifTool those not read yet (by this job, or kept on their row). They come
  with the photo they are behind and the other files behind it: what is combined already stays together. In an
  "All" run (`runStartedAt`) a read kept from before the run is read again too: a file may have been given an
  instruction since, and the job must not decide on what it said before.
  */
  private async readCandidates(ids: string[], reads: Map<string, FileRead>, runStartedAt?: string) {
    const rows = await this.assetVersionRepository.getCandidatesWithTheirShots(ids);
    const toRead = (row: (typeof rows)[number]) => {
      const read = readOf(row, reads, READ_PARSER_VERSION);
      return !read || (!!runStartedAt && !reads.has(row.id) && new Date(read.readAt) < new Date(runStartedAt));
    };
    await this.readFiles(
      rows.filter((row) => toRead(row)),
      reads,
    );
    return rows;
  }

  /**
  The guard against the one choice that cannot be put right later (see `namesOfMissingCameraFile`): the files, not
  RAW, that go by a name of the shot and were not found for the job's own file. Two kinds: one taken near it (`around`)
  under a name the job's file does not have (a renamed export found its RAW by the time, and the JPEG
  carries the RAW's name, at another fraction of the second); and one whose date is still provisional, because
  Immich has not read its metadata yet. They are read by the next step like any candidate, and their own capture
  time then says whether they are of this shot. Null when the search by name was cut off: the camera's file may be
  among the files it left out, and the job then decides nothing.
  */
  private async findMissingCameraFile(
    file: { ownerId: string; libraryId: string | null; localDateTime: Date },
    outcome: LinkOutcome,
    rows: Array<{ id: string }>,
  ): Promise<string[] | null> {
    const shotNames = namesOfMissingCameraFile(outcome);
    if (!shotNames) {
      return [];
    }
    const names = [...new Set(shotNames.flatMap((name) => searchNames(name)))];
    const known = rows.map((row) => row.id);
    const { from, to } = this.around(file.localDateTime);
    const [taken, notYetRead] = await Promise.all([
      this.assetVersionRepository.getCandidatesByName(file.ownerId, file.libraryId, names, from, to),
      this.assetVersionRepository.getNotYetReadByName(file.ownerId, file.libraryId, names, known, NOT_YET_READ_LIMIT),
    ]);
    if (taken.length >= NAME_SEARCH_LIMIT) {
      return null;
    }
    const found = [...taken, ...notYetRead].filter(
      (row) => !known.includes(row.id) && !mimeTypes.isRaw(row.originalFileName),
    );
    return [...new Set(found.map((row) => row.id))];
  }

  /**
  Step 6: puts each file behind its photo and stores what was decided. `pair` decides again under its lock, with
  the state as it is then. The setting is read again before each pair, so turning versions off stops a job between
  two of them; what was left apart is still stored, and what was done is still finished.
  */
  private async apply(
    { pairings, notCombined }: LinkOutcome,
    byId: Map<string, VersionCandidate>,
    readFor: (id: string) => FileRead | null,
  ) {
    const paired: Array<{ versionId: string; priorVisibility: AssetVisibility }> = [];
    const leftApart = [...notCombined];
    let enabled = true;
    for (const pairing of pairings) {
      enabled &&= await this.isEnabled();
      if (!enabled) {
        break;
      }
      const version = byId.get(pairing.versionId)!;
      const photo = byId.get(pairing.photoId)!;
      const photoKind = kindOf(photo.signature);
      // asked again under the pairing's lock: an undo may have held it, and versions are off by then
      const result = await this.assetVersionRepository.pair(
        {
          ...pairing,
          source: sourceOf(pairing.kind, version.signature),
          read: readFor(pairing.versionId),
          photo: { kind: photoKind, source: sourceOf(photoKind, photo.signature), read: readFor(pairing.photoId) },
        },
        () => this.isEnabled(),
      );
      if (result.paired) {
        paired.push({ versionId: pairing.versionId, priorVisibility: result.priorVisibility });
        this.decide(byId, pairing.versionId, 'combined', pairing.rule, pairing.photoId);
      } else if (result.reason === 'switched-off') {
        break;
      } else if (result.reason !== 'already-paired') {
        // the rules proposed it from what was read; the state changed before the pair took its lock
        leftApart.push({ assetId: pairing.versionId, reason: result.reason, otherId: pairing.photoId });
      }
    }
    for (const { assetId, reason, otherId } of leftApart) {
      this.decide(byId, assetId, 'not-combined', reason, otherId ?? null);
    }
    return paired;
  }

  /**
  Step 7: what follows a job for its shot's photo, also when nothing new went behind it: the job of a file that is
  behind a photo already runs after every read of that file's metadata.
  */
  private async finish(
    photoId: string | null,
    paired: Array<{ versionId: string; priorVisibility: AssetVisibility | undefined }>,
  ) {
    await this.afterPaired(paired);
    if (!photoId) {
      return;
    }
    // the keywords of the files behind it are the photo's too; a metadata read of the photo drops them, and this
    // job follows every such read
    await this.assetVersionRepository.copyTags(photoId);
    // a shot with an edit is no duplicate of anything (asset-version-duplicates.ts)
    await this.assetVersionRepository.leaveDuplicates(photoId);
    await this.refreshLook(photoId);
  }

  /**
  Logs a decision worth knowing about a file: it went behind a photo (once, when it did), or it has a candidate and
  was left apart (each time a job decides so). A file with nothing to combine with never gets here, so the log is
  not filled with them. "Combined, and by which rule" is also kept on the file's row.
  */
  private decide(
    byId: Map<string, VersionCandidate>,
    assetId: string,
    decision: 'combined' | 'not-combined',
    reason: string,
    otherId: string | null,
  ) {
    const name = (id: string) => `${byId.get(id)?.originalFileName ?? 'a file'} (${id})`;
    const other = otherId ? name(otherId) : null;
    this.logger.log(
      decision === 'combined'
        ? `Versions: ${name(assetId)} is now behind ${other}: ${words(decision, reason)}`
        : `Versions: ${name(assetId)} not combined${other ? ` with ${other}` : ''}: ${words(decision, reason)}`,
    );
  }

  /**
  Reads these files with ExifTool, into `reads` (held for the job), and keeps each read: as the file's "read" stamp,
  and on its row if it is part of a combined shot. A file that cannot be read is held as such too: it is not taken
  for the only match of anything in this job.
  */
  private async readFiles(
    files: Array<{ id: string; originalPath: string; originalFileName: string }>,
    reads: Map<string, FileRead>,
  ) {
    const stored: StoredRead[] = [];
    const sidecars = await this.assetVersionRepository.getSidecarPaths(files.map((file) => file.id));
    for (const file of files) {
      let tags: Record<string, unknown> = {};
      let failed = false;
      try {
        await using local = await this.backendMedia.ensureLocalFile(file.originalPath);
        tags = (await this.metadataRepository.readTags(local.localPath)) as Record<string, unknown>;
      } catch (error) {
        failed = true;
        this.logger.warn(`Versions: could not read asset ${file.id} with ExifTool: ${error}`);
      }
      const status = failed ? 'failed' : hasTags(tags) ? 'ok' : 'no-tags';
      const signature =
        status === 'ok'
          ? toCaptureSignature(tags, file.originalFileName, await this.readSidecarInstructions(file.id, sidecars))
          : null;
      const read: FileRead = {
        status,
        parserVersion: READ_PARSER_VERSION,
        readAt: new Date().toISOString(),
        signature,
      };
      reads.set(file.id, read);
      const kind = kindOf(signature ?? { isRaw: mimeTypes.isRaw(file.originalFileName), isEdit: false });
      stored.push({ assetId: file.id, read, kind, source: sourceOf(kind, signature ?? { software: null }) });
    }
    await this.assetVersionRepository.storeReads(stored);
  }

  /**
  The instructions in a file's XMP sidecar, if it has one. A sidecar that cannot be read gives none: the file's own
  read stands.
  */
  private async readSidecarInstructions(assetId: string, sidecars: Map<string, string>): Promise<string[]> {
    const path = sidecars.get(assetId);
    if (!path) {
      return [];
    }
    try {
      await using local = await this.backendMedia.ensureLocalFile(path);
      return instructionsOf((await this.metadataRepository.readTags(local.localPath)) as Record<string, unknown>);
    } catch (error) {
      this.logger.warn(`Versions: could not read the sidecar of asset ${assetId} with ExifTool: ${error}`);
      return [];
    }
  }

  /** Phones and Space members drop the rows of assets that just went behind their photo (hidden). */
  private async afterPaired(paired: Array<{ versionId: string; priorVisibility: AssetVisibility | undefined }>) {
    if (paired.length === 0) {
      return;
    }
    // until each one is marked done, the cleanup replays it (a crash or a failed emit after the pairing committed);
    // re-running the purge is idempotent (asset-visibility-transition.service.ts)
    for (const { versionId, priorVisibility } of paired) {
      const done = await this.assetVersionRepository.syncPending(versionId, () =>
        applyVisibilityTransitionSideEffects(
          { albumRepository: this.albumRepository, sharedSpaceRepository: this.sharedSpaceRepository },
          [versionId],
          AssetVisibility.Hidden,
          new Map([[versionId, priorVisibility]]),
        ),
      );
      if (!done) {
        continue;
      }
      // the owner's app drops it from its timeline (it syncs on this event)
      const version = await this.assetRepository.getById(versionId);
      if (version) {
        this.websocketRepository.clientSend('on_asset_hidden', version.ownerId, versionId);
      }
    }
  }

  private async requireVersionOf(photoId: string, versionId: string) {
    // versions are not shown while they are switched off: the list is empty, and so nothing of them is served
    if (!(await this.isEnabled())) {
      throw new NotFoundException('Version not found');
    }
    // the photo's own file is a row of its Versions list too: its unedited image and its original file. Only for a
    // photo that has versions: for any other, this would hand a shared link the unedited image of a photo cropped in
    // Gallery's editor, which Immich never shows to shared links
    if (versionId === photoId) {
      if (!(await this.assetVersionRepository.hasVersions(photoId))) {
        throw new NotFoundException('Version not found');
      }
      return;
    }
    const row = await this.assetVersionRepository.getPhotoOf(versionId);
    if (row?.assetId !== photoId) {
      throw new NotFoundException('Version not found');
    }
  }
}
