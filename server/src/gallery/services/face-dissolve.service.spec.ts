import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { beforeEach, describe, expect, it } from 'vitest';
import { JobName, QueueName } from 'src/enum.js';
import { DissolveCounts, DissolveWriteResult } from 'src/gallery/repositories/face-dissolve.repository.js';
import { FaceDissolveService } from 'src/gallery/services/face-dissolve.service.js';
import { DissolveScope } from 'src/gallery/utils/face-dissolve.js';
import { factory } from 'test/small.factory.js';
import { ServiceMocks, newTestService } from 'test/utils.js';

const dto = (over: Record<string, unknown> = {}) => ({ scope: DissolveScope.All, expectedFaceCount: 10, ...over });

describe(FaceDissolveService.name, () => {
  let sut: FaceDissolveService;
  let mocks: ServiceMocks;
  const auth = factory.auth();

  // `personGroupId` is the person's public id since upstream repointed asset_face at person_group
  // and dropped person.id.
  const person = {
    personGroupId: 'person-1',
    ownerId: 'owner-1',
    type: 'person',
    name: 'Target',
    thumbnailPath: '/t.jpg',
  };
  // Every warning input is zero by default, so each warning test switches on exactly the one it is about.
  const counts: DissolveCounts = {
    faces: 10,
    hide: 10,
    delete: 0,
    keep: 0,
    softDeleted: 0,
    assets: 8,
    rescanAssets: 0,
    sharedAssets: 0,
    notRedetectable: 0,
    remainingFaces: 0,
    personRemoved: true,
    spacePersonsRemoved: 0,
    spacePersonsKept: 0,
    spacesKept: 0,
  };
  const written: DissolveWriteResult = {
    dissolveId: 'dissolve-1',
    hiddenFaceIds: ['face-1', 'face-2'],
    deleted: 0,
    unassigned: 0,
    assetsCleared: 0,
    personRemoved: true,
    deletedThumbnailPath: '/t.jpg',
    orphanedSpacePersonIds: [],
    keptSpacePersonIds: [],
  };

  const warningCodes = async (over: Partial<DissolveCounts>) => {
    mocks.faceDissolve.getCounts.mockResolvedValue({ ...counts, ...over });
    const { warnings } = await sut.preview('person-1', dto());
    return warnings.map((warning) => warning.code);
  };

  beforeEach(() => {
    ({ sut, mocks } = newTestService(FaceDissolveService));
    mocks.person.getByGroupIdOnly.mockResolvedValue(person as never);
    // The metadata-import warning asserts the CURRENT setting, so every warning test has to say what it is.
    mocks.systemMetadata.get.mockResolvedValue({ metadata: { faces: { import: true } } });
    mocks.faceDissolve.getCounts.mockResolvedValue(counts);
    mocks.faceDissolve.dissolve.mockResolvedValue(written);
    mocks.facePersonVerdict.drainPendingForFaces.mockResolvedValue(0);
    mocks.faceRepair.reconcileRepresentativeFaces.mockResolvedValue([]);
    mocks.sharedSpace.recountPersons.mockResolvedValue();
    mocks.job.isActive.mockResolvedValue(false);
  });

  it('rejects a pet person', async () => {
    mocks.person.getByGroupIdOnly.mockResolvedValue({ ...person, type: 'pet' } as never);
    await expect(sut.apply(auth, 'person-1', dto())).rejects.toBeInstanceOf(BadRequestException);
    expect(mocks.faceDissolve.dissolve).not.toHaveBeenCalled();
  });

  it('rejects an unknown person', async () => {
    mocks.person.getByGroupIdOnly.mockResolvedValue(void 0 as never);
    await expect(sut.apply(auth, 'nope', dto())).rejects.toBeInstanceOf(NotFoundException);
  });

  it.each([QueueName.FacialRecognition, QueueName.FaceDetection])('refuses while %s is running', async (queue) => {
    mocks.job.isActive.mockImplementation((name) => Promise.resolve(name === queue));
    await expect(sut.apply(auth, 'person-1', dto())).rejects.toBeInstanceOf(ConflictException);
    expect(mocks.faceDissolve.dissolve).not.toHaveBeenCalled();
  });

  it('refuses when the face count drifted since the preview', async () => {
    await expect(sut.apply(auth, 'person-1', dto({ expectedFaceCount: 9 }))).rejects.toBeInstanceOf(ConflictException);
    expect(mocks.faceDissolve.dissolve).not.toHaveBeenCalled();
  });

  it('passes the caller as the actor and the person as the record owner', async () => {
    await sut.apply(auth, 'person-1', dto());
    expect(mocks.faceDissolve.dissolve).toHaveBeenCalledWith(
      {
        personGroupId: 'person-1',
        scope: DissolveScope.All,
        ownerId: 'owner-1',
        personName: 'Target',
        actorId: auth.user.id,
      },
      expect.anything(),
    );
  });

  it('drains suggestions for the hidden faces in the same transaction', async () => {
    await sut.apply(auth, 'person-1', dto());
    expect(mocks.database.transaction).toHaveBeenCalledTimes(1);
    const trx = mocks.faceDissolve.dissolve.mock.calls[0][1];
    expect(mocks.facePersonVerdict.drainPendingForFaces).toHaveBeenCalledWith(['face-1', 'face-2'], trx);
  });

  it('recounts the surviving Space persons in the same transaction', async () => {
    mocks.faceDissolve.dissolve.mockResolvedValue({ ...written, keptSpacePersonIds: ['space-person-1'] });
    await sut.apply(auth, 'person-1', dto());
    const trx = mocks.faceDissolve.dissolve.mock.calls[0][1];
    expect(mocks.sharedSpace.recountPersons).toHaveBeenCalledWith(['space-person-1'], trx);
  });

  it('queues a re-scan only when imported faces were deleted', async () => {
    await sut.apply(auth, 'person-1', dto());
    expect(mocks.job.queue).not.toHaveBeenCalledWith(
      expect.objectContaining({ name: JobName.AssetDetectFacesQueueAll }),
    );

    mocks.faceDissolve.dissolve.mockResolvedValue({ ...written, deleted: 3, assetsCleared: 2 });
    await sut.apply(auth, 'person-1', dto());
    expect(mocks.job.queue).toHaveBeenCalledWith({ name: JobName.AssetDetectFacesQueueAll, data: { force: false } });
  });

  it('deletes the thumbnail and regenerates nothing when the person was removed', async () => {
    await sut.apply(auth, 'person-1', dto());
    expect(mocks.job.queue).toHaveBeenCalledWith({ name: JobName.FileDelete, data: { files: ['/t.jpg'] } });
    expect(mocks.faceRepair.reconcileRepresentativeFaces).not.toHaveBeenCalled();
    expect(mocks.job.queueAll).not.toHaveBeenCalled();
  });

  it('repoints and regenerates the thumbnail of a surviving person', async () => {
    mocks.faceDissolve.dissolve.mockResolvedValue({ ...written, personRemoved: false, deletedThumbnailPath: null });
    mocks.faceRepair.reconcileRepresentativeFaces.mockResolvedValue([
      { personGroupId: 'person-1', ownerId: 'owner-1' },
    ]);

    await sut.apply(auth, 'person-1', dto());

    expect(mocks.faceRepair.reconcileRepresentativeFaces).toHaveBeenCalledWith(['person-1']);
    expect(mocks.job.queueAll).toHaveBeenCalledWith([
      { name: JobName.PersonGenerateThumbnail, data: { ownerId: 'owner-1', personGroupId: 'person-1' } },
    ]);
    expect(mocks.job.queue).not.toHaveBeenCalledWith(expect.objectContaining({ name: JobName.FileDelete }));
  });

  it('never queues the unscoped cleanups', async () => {
    mocks.faceDissolve.dissolve.mockResolvedValue({ ...written, deleted: 3, assetsCleared: 2 });
    await sut.apply(auth, 'person-1', dto());
    const names = mocks.job.queue.mock.calls.map(([job]) => job.name);
    expect(names).not.toContain(JobName.PersonCleanup);
    expect(names).not.toContain(JobName.FacialRecognitionQueueAll);
  });

  it('returns the restore record id', async () => {
    await expect(sut.apply(auth, 'person-1', dto())).resolves.toMatchObject({ dissolveId: 'dissolve-1' });
  });

  it('raises no warning for a plain junk person', async () => {
    await expect(warningCodes({})).resolves.toEqual([]);
  });

  it('warns that hand-drawn and manual faces are kept', async () => {
    await expect(warningCodes({ keep: 2 })).resolves.toEqual(['hand-drawn-kept']);
  });

  it('warns about re-scanned photos shared with other people', async () => {
    await expect(warningCodes({ delete: 1, sharedAssets: 3 })).resolves.toContain('shared-assets');
  });

  it('warns about re-scanned photos that can never be re-detected', async () => {
    await expect(warningCodes({ delete: 1, notRedetectable: 1 })).resolves.toContain('not-redetectable');
  });

  it('warns that metadata import is on when imported faces are deleted and the setting is on now', async () => {
    await expect(warningCodes({ delete: 2 })).resolves.toEqual(['metadata-import-on']);
  });

  it('stays silent about metadata import when the setting is off now', async () => {
    mocks.systemMetadata.get.mockResolvedValue({ metadata: { faces: { import: false } } });
    await expect(warningCodes({ delete: 2 })).resolves.toEqual([]);
  });

  it('warns that some Space persons remain', async () => {
    await expect(warningCodes({ spacePersonsKept: 2, spacesKept: 1 })).resolves.toEqual(['space-persons-kept']);
  });

  it('preview never writes', async () => {
    await sut.preview('person-1', dto());
    expect(mocks.faceDissolve.dissolve).not.toHaveBeenCalled();
    expect(mocks.job.queue).not.toHaveBeenCalled();
  });

  it('getPeopleHealth passes through to the repository unchanged', async () => {
    const result = { people: [], total: 0, hasMore: false };
    mocks.faceDissolve.getPeopleHealth.mockResolvedValue(result);

    const query = { ownerId: 'owner-1', sort: 'exifFaces' as const, page: 2, size: 20 };
    await expect(sut.getPeopleHealth(query)).resolves.toBe(result);
    expect(mocks.faceDissolve.getPeopleHealth).toHaveBeenCalledWith(query);
  });

  describe('restore', () => {
    beforeEach(() => {
      mocks.faceDissolve.getDissolve.mockResolvedValue({ id: 'dissolve-1', restoredAt: null });
      mocks.faceDissolve.restore.mockResolvedValue({ restored: 4, skipped: 1 });
    });

    it('rejects an unknown dissolve', async () => {
      mocks.faceDissolve.getDissolve.mockResolvedValue(void 0);
      await expect(sut.restore('nope')).rejects.toBeInstanceOf(NotFoundException);
      expect(mocks.faceDissolve.restore).not.toHaveBeenCalled();
    });

    it('refuses a dissolve that was already restored', async () => {
      mocks.faceDissolve.getDissolve.mockResolvedValue({ id: 'dissolve-1', restoredAt: new Date() });
      await expect(sut.restore('dissolve-1')).rejects.toBeInstanceOf(ConflictException);
      expect(mocks.faceDissolve.restore).not.toHaveBeenCalled();
    });

    it('refuses when a concurrent restore got there first', async () => {
      mocks.faceDissolve.restore.mockResolvedValue('already-restored');
      await expect(sut.restore('dissolve-1')).rejects.toBeInstanceOf(ConflictException);
      expect(mocks.job.queue).not.toHaveBeenCalled();
    });

    it.each([QueueName.FacialRecognition, QueueName.FaceDetection])('refuses while %s is running', async (queue) => {
      mocks.job.isActive.mockImplementation((name) => Promise.resolve(name === queue));
      await expect(sut.restore('dissolve-1')).rejects.toBeInstanceOf(ConflictException);
      expect(mocks.faceDissolve.restore).not.toHaveBeenCalled();
    });

    it('restores in a transaction and queues recognition once, never a cleanup', async () => {
      await expect(sut.restore('dissolve-1')).resolves.toEqual({ restored: 4, skipped: 1 });
      expect(mocks.database.transaction).toHaveBeenCalledTimes(1);
      expect(mocks.job.queue).toHaveBeenCalledTimes(1);
      expect(mocks.job.queue).toHaveBeenCalledWith({
        name: JobName.FacialRecognitionQueueAll,
        data: { force: false },
      });
    });

    it('queues nothing when no face came back', async () => {
      mocks.faceDissolve.restore.mockResolvedValue({ restored: 0, skipped: 2 });
      await sut.restore('dissolve-1');
      expect(mocks.job.queue).not.toHaveBeenCalled();
    });
  });

  it('listDissolves passes paging through', async () => {
    mocks.faceDissolve.listDissolves.mockResolvedValue({ items: [], hasMore: false });
    await expect(sut.listDissolves({ page: 2, size: 20 })).resolves.toEqual({ items: [], hasMore: false });
    expect(mocks.faceDissolve.listDissolves).toHaveBeenCalledWith({ page: 2, size: 20 });
  });
});
