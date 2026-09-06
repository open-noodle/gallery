import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { JobName } from 'src/enum';
import { FaceDissolveService } from 'src/services/face-dissolve.service';
import { DissolveScope } from 'src/utils/face-dissolve';
import { newTestService, ServiceMocks } from 'test/utils';
import { beforeEach, describe, expect, it } from 'vitest';

const dto = (over: Record<string, unknown> = {}) => ({
  scope: DissolveScope.Exif,
  outcome: 'delete-faces' as const,
  redetect: true,
  expectedFaceCount: 10,
  ...over,
});

describe(FaceDissolveService.name, () => {
  let sut: FaceDissolveService;
  let mocks: ServiceMocks;

  const person = { id: 'person-1', ownerId: 'owner-1', type: 'person', name: 'Target', thumbnailPath: '/t.jpg' };
  const counts = {
    faces: 10,
    exif: 10,
    mlWithEmbedding: 0,
    mlWithoutEmbedding: 0,
    softDeleted: 0,
    assets: 8,
    sharedAssets: 3,
    notRedetectable: 1,
    // Non-zero by default: the "this person will be cleaned up anyway" warning must NOT fire unless a test
    // explicitly says the dissolve leaves the person faceless.
    remainingLiveFaces: 4,
  };

  beforeEach(() => {
    ({ sut, mocks } = newTestService(FaceDissolveService));
    mocks.person.getById.mockResolvedValue(person as never);
    // The metadata-import warning asserts the CURRENT setting, so every warning test has to say what it is.
    mocks.systemMetadata.get.mockResolvedValue({ metadata: { faces: { import: true } } });
    mocks.faceDissolve.getCounts.mockResolvedValue(counts);
    mocks.faceDissolve.dissolve.mockResolvedValue({
      faces: 10,
      assetsCleared: 8,
      orphanedSpacePersonIds: [],
      deletedThumbnailPath: '/t.jpg',
    });
    mocks.job.isActive.mockResolvedValue(false);
  });

  it('rejects a pet person', async () => {
    mocks.person.getById.mockResolvedValue({ ...person, type: 'pet' } as never);
    await expect(sut.apply('person-1', dto())).rejects.toBeInstanceOf(BadRequestException);
    expect(mocks.faceDissolve.dissolve).not.toHaveBeenCalled();
  });

  it('rejects an unknown person', async () => {
    mocks.person.getById.mockResolvedValue(void 0 as never);
    await expect(sut.apply('nope', dto())).rejects.toBeInstanceOf(NotFoundException);
  });

  it('refuses while facial recognition is running', async () => {
    mocks.job.isActive.mockResolvedValue(true);
    await expect(sut.apply('person-1', dto())).rejects.toBeInstanceOf(ConflictException);
    expect(mocks.faceDissolve.dissolve).not.toHaveBeenCalled();
  });

  it('refuses when the face count drifted since the preview', async () => {
    await expect(sut.apply('person-1', dto({ expectedFaceCount: 9 }))).rejects.toBeInstanceOf(ConflictException);
    expect(mocks.faceDissolve.dissolve).not.toHaveBeenCalled();
  });

  it('rejects redetect:false on a delete outcome rather than silently overriding it', async () => {
    await expect(sut.apply('person-1', dto({ redetect: false }))).rejects.toBeInstanceOf(BadRequestException);
  });

  it('queues re-detection and the thumbnail delete, and never the unscoped cleanups', async () => {
    await sut.apply('person-1', dto({ outcome: 'delete-faces-and-person' }));

    expect(mocks.job.queue).toHaveBeenCalledWith({
      name: JobName.AssetDetectFacesQueueAll,
      data: { force: false },
    });
    expect(mocks.job.queue).toHaveBeenCalledWith({ name: JobName.FileDelete, data: { files: ['/t.jpg'] } });

    const queued = mocks.job.queue.mock.calls.map(([job]) => job.name);
    expect(queued).not.toContain(JobName.PersonCleanup);
    expect(mocks.faceIdentity.deleteUnreferencedIdentities).not.toHaveBeenCalled();
    expect(mocks.sharedSpace.deleteAllOrphanedPersons).not.toHaveBeenCalled();
  });

  it('regenerates the thumbnail only when the person survives', async () => {
    await sut.apply('person-1', dto());
    expect(mocks.job.queue).toHaveBeenCalledWith({
      name: JobName.PersonGenerateThumbnail,
      data: { id: 'person-1' },
    });
  });

  it('does not regenerate the thumbnail when the person is deleted', async () => {
    await sut.apply('person-1', dto({ outcome: 'delete-faces-and-person' }));
    const queued = mocks.job.queue.mock.calls.map(([job]) => job.name);
    expect(queued).not.toContain(JobName.PersonGenerateThumbnail);
  });

  it('does not queue a file delete for an empty thumbnail path', async () => {
    mocks.faceDissolve.dissolve.mockResolvedValue({
      faces: 10,
      assetsCleared: 8,
      orphanedSpacePersonIds: [],
      deletedThumbnailPath: null,
    });
    await sut.apply('person-1', dto({ outcome: 'delete-faces-and-person' }));
    const queued = mocks.job.queue.mock.calls.map(([job]) => job.name);
    expect(queued).not.toContain(JobName.FileDelete);
  });

  it('does not queue re-detection when unassigning without redetect', async () => {
    await sut.apply('person-1', dto({ outcome: 'unassign', redetect: false }));
    const queued = mocks.job.queue.mock.calls.map(([job]) => job.name);
    expect(queued).not.toContain(JobName.AssetDetectFacesQueueAll);
  });

  it('warns that detaching embedding-less faces strands them', async () => {
    const result = await sut.preview('person-1', dto({ outcome: 'unassign', redetect: false }));
    expect(result.warnings).toContainEqual({ code: 'strands-faces', count: 10 });
  });

  it('warns that some assets can never be re-detected', async () => {
    const result = await sut.preview('person-1', dto());
    expect(result.warnings).toContainEqual({ code: 'not-redetectable', count: 1 });
  });

  it('warns that unassigning may recluster faces with an embedding into someone else', async () => {
    mocks.faceDissolve.getCounts.mockResolvedValue({ ...counts, mlWithEmbedding: 5 });

    const unassigning = await sut.preview('person-1', dto({ outcome: 'unassign', redetect: false }));
    expect(unassigning.warnings).toContainEqual({ code: 'recluster-similar', count: 5 });

    const deleting = await sut.preview('person-1', dto({ outcome: 'delete-faces' }));
    expect(deleting.warnings).not.toContainEqual(expect.objectContaining({ code: 'recluster-similar' }));

    mocks.faceDissolve.getCounts.mockResolvedValue({ ...counts, mlWithEmbedding: 0 });
    const noEmbedding = await sut.preview('person-1', dto({ outcome: 'unassign', redetect: false }));
    expect(noEmbedding.warnings).not.toContainEqual(expect.objectContaining({ code: 'recluster-similar' }));
  });

  it('warns that re-detection touches assets shared by other people', async () => {
    const redetecting = await sut.preview('person-1', dto());
    expect(redetecting.warnings).toContainEqual({ code: 'shared-assets', count: 3 });

    const notRedetecting = await sut.preview('person-1', dto({ outcome: 'unassign', redetect: false }));
    expect(notRedetecting.warnings).not.toContainEqual(expect.objectContaining({ code: 'shared-assets' }));

    mocks.faceDissolve.getCounts.mockResolvedValue({ ...counts, sharedAssets: 0 });
    const noSharedAssets = await sut.preview('person-1', dto());
    expect(noSharedAssets.warnings).not.toContainEqual(expect.objectContaining({ code: 'shared-assets' }));
  });

  it('warns that metadata import will keep re-adding exif faces regardless of outcome', async () => {
    const unassigning = await sut.preview('person-1', dto({ outcome: 'unassign', redetect: false }));
    expect(unassigning.warnings).toContainEqual({ code: 'metadata-import-on', count: 10 });

    const deletingPerson = await sut.preview('person-1', dto({ outcome: 'delete-faces-and-person' }));
    expect(deletingPerson.warnings).toContainEqual({ code: 'metadata-import-on', count: 10 });

    mocks.faceDissolve.getCounts.mockResolvedValue({ ...counts, exif: 0 });
    const noExif = await sut.preview('person-1', dto({ outcome: 'unassign', redetect: false }));
    expect(noExif.warnings).not.toContainEqual(expect.objectContaining({ code: 'metadata-import-on' }));
  });

  // The copy is a factual claim about the CURRENT setting ("Import faces from metadata is on."). EXIF faces
  // only prove it was on at import time, so an admin who already turned it off must not be told otherwise.
  it('stays silent about metadata import when the setting is actually off', async () => {
    mocks.systemMetadata.get.mockResolvedValue({ metadata: { faces: { import: false } } });

    const result = await sut.preview('person-1', dto({ outcome: 'unassign', redetect: false }));
    expect(result.counts.exif).toBe(10);
    expect(result.warnings).not.toContainEqual(expect.objectContaining({ code: 'metadata-import-on' }));
    // The other warnings still fire, so this is the config gate and not a swallowed warning list.
    expect(result.warnings).toContainEqual({ code: 'strands-faces', count: 10 });
  });

  // "Unassign only" is presented as the least destructive outcome, but it leaves the person faceless and the
  // nightly PersonCleanup deletes a faceless person on its own schedule. We never queue that job (L2).
  it('warns that an unassign leaves the person for the nightly cleanup to delete', async () => {
    mocks.faceDissolve.getCounts.mockResolvedValue({ ...counts, remainingLiveFaces: 0 });
    const emptied = await sut.preview('person-1', dto({ outcome: 'unassign', redetect: false }));
    expect(emptied.warnings).toContainEqual({ code: 'person-will-be-cleaned-up', count: 0 });

    // A person keeping out-of-scope faces survives, so the warning would be a lie.
    mocks.faceDissolve.getCounts.mockResolvedValue({ ...counts, remainingLiveFaces: 2 });
    const survives = await sut.preview('person-1', dto({ outcome: 'unassign', redetect: false }));
    expect(survives.warnings).not.toContainEqual(expect.objectContaining({ code: 'person-will-be-cleaned-up' }));

    // The delete outcomes remove the faces outright; delete-faces-and-person removes the person itself, and
    // delete-faces has its own honest story. Neither is the "you think you kept it" trap.
    mocks.faceDissolve.getCounts.mockResolvedValue({ ...counts, remainingLiveFaces: 0 });
    const deleting = await sut.preview('person-1', dto({ outcome: 'delete-faces' }));
    expect(deleting.warnings).not.toContainEqual(expect.objectContaining({ code: 'person-will-be-cleaned-up' }));

    // Nothing in scope means we caused nothing; the warning must not claim a consequence we did not cause.
    mocks.faceDissolve.getCounts.mockResolvedValue({ ...counts, faces: 0, remainingLiveFaces: 0 });
    const noop = await sut.preview('person-1', dto({ outcome: 'unassign', redetect: false, expectedFaceCount: 0 }));
    expect(noop.warnings).not.toContainEqual(expect.objectContaining({ code: 'person-will-be-cleaned-up' }));
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
});
