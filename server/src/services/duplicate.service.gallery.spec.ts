import { AssetType, AssetVisibility, JobStatus } from 'src/enum.js';
import { DuplicateService } from 'src/services/duplicate.service.js';
import { newUuid } from 'test/small.factory.js';
import { ServiceMocks, newTestService } from 'test/utils.js';

// Gallery's hook in duplicate detection (rule 8: fork tests of upstream code sit beside it): asset versions
// (src/gallery/utils/asset-version-duplicates.ts). A photo whose shot includes an edit is no duplicate of anything;
// a camera file with only its RAW behind it is checked like any other photo.
describe('DuplicateService (Gallery: asset versions)', () => {
  let sut: DuplicateService;
  let mocks: ServiceMocks;

  const photo = {
    id: 'photo-1',
    ownerId: 'user-id',
    stackId: null,
    type: AssetType.Image,
    duplicateId: null as string | null,
    embedding: '[1, 2, 3, 4]',
    visibility: AssetVisibility.Timeline,
  };

  beforeEach(() => {
    ({ sut, mocks } = newTestService(DuplicateService));
    mocks.systemMetadata.get.mockResolvedValue({
      machineLearning: { enabled: true, duplicateDetection: { enabled: true } },
    });
    mocks.duplicateRepository.merge.mockResolvedValue();
  });

  it('checks a camera file with only its RAW behind it like any other photo', async () => {
    const lookAlike = newUuid();
    mocks.assetJob.getForSearchDuplicatesJob.mockResolvedValue(photo);
    mocks.duplicateRepository.search.mockResolvedValue([{ assetId: lookAlike, distance: 0.01, duplicateId: null }]);
    mocks.assetVersion.getPhotosWithEdits.mockResolvedValue([]);

    expect(await sut.handleSearchDuplicates({ id: photo.id })).toBe(JobStatus.Success);

    expect(mocks.assetVersion.getPhotosWithEdits).toHaveBeenCalledWith([photo.id, lookAlike]);
    expect(mocks.duplicateRepository.merge).toHaveBeenCalledWith(
      expect.objectContaining({ assetIds: [lookAlike, photo.id] }),
    );
  });

  it('does not make a photo whose shot includes an edit a duplicate, and takes it out of the group it was in', async () => {
    const lookAlike = newUuid();
    mocks.assetJob.getForSearchDuplicatesJob.mockResolvedValue({ ...photo, duplicateId: 'group-1' });
    mocks.duplicateRepository.search.mockResolvedValue([{ assetId: lookAlike, distance: 0.01, duplicateId: null }]);
    mocks.assetVersion.getPhotosWithEdits.mockResolvedValue([photo.id]);

    expect(await sut.handleSearchDuplicates({ id: photo.id })).toBe(JobStatus.Success);

    expect(mocks.duplicateRepository.merge).not.toHaveBeenCalled();
    expect(mocks.asset.update).toHaveBeenCalledWith({ id: photo.id, duplicateId: null });
  });

  it('does not find a photo whose shot includes an edit as the duplicate of another photo', async () => {
    const withEdit = newUuid();
    const plain = newUuid();
    mocks.assetJob.getForSearchDuplicatesJob.mockResolvedValue(photo);
    mocks.duplicateRepository.search.mockResolvedValue([
      { assetId: withEdit, distance: 0.005, duplicateId: null },
      { assetId: plain, distance: 0.01, duplicateId: null },
    ]);
    mocks.assetVersion.getPhotosWithEdits.mockResolvedValue([withEdit]);

    await sut.handleSearchDuplicates({ id: photo.id });

    expect(mocks.duplicateRepository.merge).toHaveBeenCalledWith(
      expect.objectContaining({ assetIds: [plain, photo.id] }),
    );
  });
});
