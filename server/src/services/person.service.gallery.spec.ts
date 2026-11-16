import { PersonService } from 'src/services/person.service.js';
import { AssetFaceFactory } from 'test/factories/asset-face.factory.js';
import { AssetFactory } from 'test/factories/asset.factory.js';
import { PersonGroupFactory } from 'test/factories/person-group.factory.js';
import { PersonFactory } from 'test/factories/person.factory.js';
import { getForFaceSearch, getForFacialRecognitionJob } from 'test/mappers.js';
import { ServiceMocks, newTestService } from 'test/utils.js';

// Gallery hooks in PersonService, tested beside upstream's person.service.spec.ts.
describe(PersonService.name, () => {
  let sut: PersonService;
  let mocks: ServiceMocks;

  beforeEach(() => {
    ({ sut, mocks } = newTestService(PersonService));
    mocks.sharedSpace.getSpaceIdsForAsset.mockResolvedValue([]);
    mocks.faceIdentity.ensurePersonIdentity.mockResolvedValue({ id: 'identity-1' } as any);
  });

  /** Recognises one face, with video face detection on and `createPeople` as given. */
  const recognise = async ({ createPeople, isVideo }: { createPeople: boolean; isVideo: boolean }) => {
    const asset = AssetFactory.create();
    const face = AssetFaceFactory.create({ assetId: asset.id });
    const group = PersonGroupFactory.create();
    mocks.systemMetadata.get.mockResolvedValue({
      machineLearning: { facialRecognition: { minFaces: 1, video: { enabled: true, createPeople } } },
    });
    mocks.person.getFaceForFacialRecognitionJob.mockResolvedValue(getForFacialRecognitionJob(face, asset));
    mocks.search.searchFaces.mockResolvedValueOnce([getForFaceSearch(face, 0)]).mockResolvedValueOnce([]);
    mocks.videoFace.isVideoFace.mockResolvedValue(isVideo);
    mocks.person.createGroup.mockResolvedValue(group);
    mocks.person.create.mockResolvedValue(PersonFactory.create({ personGroupId: group.id }));

    await sut.handleRecognizeFaces({ id: face.id, deferred: true });
  };

  describe('handleRecognizeFaces', () => {
    it('leaves the other faces of the same video out of both recognition searches (issue 1306)', async () => {
      const asset = AssetFactory.create();
      const face = AssetFaceFactory.create({ assetId: asset.id });
      const group = PersonGroupFactory.create();
      mocks.systemMetadata.get.mockResolvedValue({ machineLearning: { facialRecognition: { minFaces: 1 } } });
      mocks.person.getFaceForFacialRecognitionJob.mockResolvedValue(getForFacialRecognitionJob(face, asset));
      mocks.search.searchFaces.mockResolvedValueOnce([getForFaceSearch(face, 0)]).mockResolvedValueOnce([]);
      mocks.person.createGroup.mockResolvedValue(group);
      mocks.person.create.mockResolvedValue(PersonFactory.create({ personGroupId: group.id }));

      await sut.handleRecognizeFaces({ id: face.id });

      expect(mocks.search.searchFaces).toHaveBeenCalledTimes(2);
      expect(mocks.search.searchFaces).toHaveBeenNthCalledWith(
        1,
        expect.objectContaining({ excludeOtherFacesOfVideo: face.id }),
      );
      expect(mocks.search.searchFaces).toHaveBeenNthCalledWith(
        2,
        expect.objectContaining({ hasPerson: true, excludeOtherFacesOfVideo: face.id }),
      );
    });

    describe('createPeople', () => {
      it('lets a video face start a new person by default', async () => {
        await recognise({ createPeople: true, isVideo: true });

        expect(mocks.person.createGroup).toHaveBeenCalled();
      });

      it('never starts a person from a video face when off', async () => {
        await recognise({ createPeople: false, isVideo: true });

        expect(mocks.person.createGroup).not.toHaveBeenCalled();
      });

      it('still starts people from photo faces when off', async () => {
        await recognise({ createPeople: false, isVideo: false });

        expect(mocks.person.createGroup).toHaveBeenCalled();
      });
    });
  });
});
