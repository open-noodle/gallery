import request from 'supertest';
import { controllers } from 'src/controllers/index.js';
import { PersonController } from 'src/controllers/person.controller.js';
import { GalleryPeopleController } from 'src/gallery/gallery-people.controller.js';
import { GalleryPeopleService } from 'src/gallery/gallery-people.service.js';
import { LoggingRepository } from 'src/repositories/logging.repository.js';
import { errorDto } from 'test/medium/responses.js';
import { factory } from 'test/small.factory.js';
import { ControllerContext, automock, controllerSetup, mockBaseService } from 'test/utils.js';

describe(GalleryPeopleController.name, () => {
  let ctx: ControllerContext;
  const service = mockBaseService(GalleryPeopleService);

  beforeAll(async () => {
    ctx = await controllerSetup(GalleryPeopleController, [
      { provide: GalleryPeopleService, useValue: service },
      { provide: LoggingRepository, useValue: automock(LoggingRepository, { strict: false }) },
    ]);
    return () => ctx.close();
  });

  beforeEach(() => {
    service.resetAllMocks();
    ctx.reset();
  });

  it('is mounted before PersonController so its literal routes win over /people/:id', () => {
    expect(controllers.indexOf(GalleryPeopleController)).toBeLessThan(controllers.indexOf(PersonController));
  });

  describe('GET /people/statistics', () => {
    it('should be an authenticated route', async () => {
      await request(ctx.getHttpServer()).get('/people/statistics');
      expect(ctx.authenticate).toHaveBeenCalled();
    });

    it('should return people overview statistics', async () => {
      service.getPeopleStatistics.mockResolvedValue({
        total: 7,
        hidden: 2,
        detectedFaceCount: 23,
      });

      const { status, body } = await request(ctx.getHttpServer())
        .get('/people/statistics')
        .query({ withSharedSpaces: true })
        .set('Authorization', `Bearer token`);

      expect(status).toBe(200);
      expect(service.getPeopleStatistics).toHaveBeenCalledWith(
        undefined,
        expect.objectContaining({ withSharedSpaces: true }),
      );
      expect(body).toEqual({
        total: 7,
        hidden: 2,
        detectedFaceCount: 23,
      });
    });
  });

  describe('GET /people/face-statistics', () => {
    it('should be an authenticated route', async () => {
      await request(ctx.getHttpServer()).get('/people/face-statistics');
      expect(ctx.authenticate).toHaveBeenCalled();
    });

    it('should return lazy people face statistics', async () => {
      service.getPeopleFaceStatistics.mockResolvedValue({
        detectedFaceCount: 23,
        assignedVisibleFaceCount: 18,
        namedVisiblePersonCount: 9,
        assignedHiddenFaceCount: 3,
        unassignedFaceCount: 2,
      });

      const { status, body } = await request(ctx.getHttpServer())
        .get('/people/face-statistics')
        .query({ withSharedSpaces: true })
        .set('Authorization', `Bearer token`);

      expect(status).toBe(200);
      expect(service.getPeopleFaceStatistics).toHaveBeenCalledWith(
        undefined,
        expect.objectContaining({ withSharedSpaces: true }),
      );
      expect(body).toEqual({
        detectedFaceCount: 23,
        assignedVisibleFaceCount: 18,
        namedVisiblePersonCount: 9,
        assignedHiddenFaceCount: 3,
        unassignedFaceCount: 2,
      });
    });
  });
  describe('POST /people/same-person', () => {
    it('should merge scoped personal and space people', async () => {
      const targetId = factory.uuid();
      const sourceId = factory.uuid();
      const spaceId = factory.uuid();

      const { status } = await request(ctx.getHttpServer())
        .post('/people/same-person')
        .send({
          target: { type: 'person', id: targetId },
          sources: [{ type: 'space-person', id: sourceId, spaceId }],
        })
        .set('Authorization', `Bearer token`);

      expect(status).toBe(204);
      expect(service.mergeScopedPeople).toHaveBeenCalledWith(undefined, {
        target: { type: 'person', id: targetId },
        sources: [{ type: 'space-person', id: sourceId, spaceId }],
      });
    });

    it('should reject raw identity refs', async () => {
      const { status, body } = await request(ctx.getHttpServer())
        .post('/people/same-person')
        .send({
          target: { type: 'face-identity', id: factory.uuid() },
          sources: [],
        })
        .set('Authorization', `Bearer token`);

      expect(status).toBe(400);
      expect(body).toEqual(
        errorDto.validationError([
          { path: ['target', 'type'], message: 'Invalid option: expected one of "person"|"space-person"' },
          { path: ['sources'], message: 'Too small: expected array to have >=1 items' },
        ]),
      );
    });

    it('should require spaceId for space-person refs', async () => {
      const { status, body } = await request(ctx.getHttpServer())
        .post('/people/same-person')
        .send({
          target: { type: 'person', id: factory.uuid() },
          sources: [{ type: 'space-person', id: factory.uuid() }],
        })
        .set('Authorization', `Bearer token`);

      expect(status).toBe(400);
      expect(body).toEqual(
        errorDto.validationError([
          { path: ['sources', 0, 'spaceId'], message: 'spaceId is required for space-person refs' },
        ]),
      );
    });
  });

  describe('POST /people/detach-profile', () => {
    it('should detach a scoped profile', async () => {
      const profile = { type: 'person' as const, id: factory.uuid() };

      const { status } = await request(ctx.getHttpServer())
        .post('/people/detach-profile')
        .send({ profile })
        .set('Authorization', `Bearer token`);

      expect(status).toBe(204);
      expect(service.detachScopedPerson).toHaveBeenCalledWith(undefined, { profile });
    });
  });

  describe('representative face routes', () => {
    it('should require representative assetFaceId to be a uuid', async () => {
      const { status, body } = await request(ctx.getHttpServer())
        .put('/people/00000000-0000-4000-8000-000000000001/representative-face')
        .send({ assetFaceId: 'invalid' })
        .set('Authorization', `Bearer token`);

      expect(status).toBe(400);
      expect(body).toEqual(errorDto.validationError([{ path: ['assetFaceId'], message: 'Invalid UUID' }]));
    });

    it('should parse person face page query values', async () => {
      service.getFacesForPicker.mockResolvedValue({ faces: [], hasNextPage: false });

      const { status } = await request(ctx.getHttpServer())
        .get('/people/00000000-0000-4000-8000-000000000001/faces?page=1&size=25')
        .set('Authorization', `Bearer token`);

      expect(status).toBe(200);
      expect(service.getFacesForPicker).toHaveBeenCalledWith(undefined, '00000000-0000-4000-8000-000000000001', {
        page: 1,
        size: 25,
      });
    });
  });
});
