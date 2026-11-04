import request from 'supertest';
import { GalleryTimelineController } from 'src/gallery/controllers/gallery-timeline.controller.js';
import { TimelineService } from 'src/services/timeline.service.js';
import { ControllerContext, controllerSetup, mockBaseService } from 'test/utils.js';

describe(GalleryTimelineController.name, () => {
  let ctx: ControllerContext;
  const service = mockBaseService(TimelineService);

  beforeAll(async () => {
    ctx = await controllerSetup(GalleryTimelineController, [{ provide: TimelineService, useValue: service }]);
    return () => ctx.close();
  });

  beforeEach(() => {
    service.resetAllMocks();
    ctx.reset();
  });

  describe('GET /timeline/bucket-covers', () => {
    it('should be an authenticated route', async () => {
      await request(ctx.getHttpServer()).get('/timeline/bucket-covers');
      expect(ctx.authenticate).toHaveBeenCalled();
    });

    it('passes timeBuckets array to the service', async () => {
      const { status } = await request(ctx.getHttpServer())
        .get('/timeline/bucket-covers')
        .query({ timeBuckets: ['2024-01-01', '2024-02-01'] });

      expect(status).toBe(200);
      expect(service.getTimeBucketCovers).toHaveBeenCalledWith(
        undefined,
        expect.objectContaining({ timeBuckets: ['2024-01-01', '2024-02-01'] }),
      );
    });

    it('wraps a single timeBuckets value in an array', async () => {
      const { status } = await request(ctx.getHttpServer())
        .get('/timeline/bucket-covers')
        .query({ timeBuckets: '2024-01-01' });

      expect(status).toBe(200);
      expect(service.getTimeBucketCovers).toHaveBeenCalledWith(
        undefined,
        expect.objectContaining({ timeBuckets: ['2024-01-01'] }),
      );
    });
  });
});
