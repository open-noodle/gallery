import { TimelineController } from 'src/controllers/timeline.controller';
import { TimelineService } from 'src/services/timeline.service';
import request from 'supertest';
import { errorDto } from 'test/medium/responses';
import { ControllerContext, controllerSetup, mockBaseService } from 'test/utils';

describe(TimelineController.name, () => {
  let ctx: ControllerContext;
  const service = mockBaseService(TimelineService);

  beforeAll(async () => {
    ctx = await controllerSetup(TimelineController, [{ provide: TimelineService, useValue: service }]);
    return () => ctx.close();
  });

  beforeEach(() => {
    service.resetAllMocks();
    ctx.reset();
  });

  describe('GET /timeline/buckets', () => {
    it('should parse bbox query string into an object', async () => {
      const { status } = await request(ctx.getHttpServer())
        .get('/timeline/buckets')
        .query({ bbox: '11.075683,49.416711,11.117589,49.454875' });

      expect(status).toBe(200);
      expect(service.getTimeBuckets).toHaveBeenCalledWith(
        undefined,
        expect.objectContaining({
          bbox: { west: 11.075683, south: 49.416711, east: 11.117589, north: 49.454875 },
        }),
      );
    });

    it('passes bucketSize to the service', async () => {
      const { status } = await request(ctx.getHttpServer()).get('/timeline/buckets').query({ bucketSize: 'year' });

      expect(status).toBe(200);
      expect(service.getTimeBuckets).toHaveBeenCalledWith(undefined, expect.objectContaining({ bucketSize: 'year' }));
    });

    it('rejects invalid bucketSize', async () => {
      const { status, body } = await request(ctx.getHttpServer())
        .get('/timeline/buckets')
        .query({ bucketSize: 'week' });

      expect(status).toBe(400);
      expect(body).toEqual(
        errorDto.validationError([
          { path: ['bucketSize'], message: 'Invalid option: expected one of "year"|"month"|"day"' },
        ]),
      );
    });

    it('should reject incomplete bbox query string', async () => {
      const { status, body } = await request(ctx.getHttpServer()).get('/timeline/buckets').query({ bbox: '1,2,3' });
      expect(status).toBe(400);
      expect(body).toEqual(
        errorDto.validationError([
          { path: ['bbox'], message: 'bbox must have 4 comma-separated numbers: west,south,east,north' },
        ]),
      );
    });

    it('should reject invalid bbox query string', async () => {
      const { status, body } = await request(ctx.getHttpServer())
        .get('/timeline/buckets')
        .query({ bbox: '1,2,3,invalid' });
      expect(status).toBe(400);
      expect(body).toEqual(errorDto.validationError([{ path: ['bbox'], message: 'bbox parts must be valid numbers' }]));
    });
  });

  describe('GET /timeline/bucket', () => {
    it('should be an authenticated route', async () => {
      await request(ctx.getHttpServer()).get('/timeline/bucket?timeBucket=1900-01-01');
      expect(ctx.authenticate).toHaveBeenCalled();
    });

    it('passes bucketSize to the singular bucket service', async () => {
      const { status } = await request(ctx.getHttpServer())
        .get('/timeline/bucket')
        .query({ bucketSize: 'day', timeBucket: '2024-02-29' });

      expect(status).toBe(200);
      expect(service.getTimeBucket).toHaveBeenCalledWith(
        undefined,
        expect.objectContaining({ bucketSize: 'day', timeBucket: '2024-02-29' }),
      );
    });

    it('rejects invalid bucketSize', async () => {
      const { status, body } = await request(ctx.getHttpServer())
        .get('/timeline/bucket')
        .query({ bucketSize: 'week', timeBucket: '2024-01-01' });

      expect(status).toBe(400);
      expect(body).toEqual(
        errorDto.validationError([
          { path: ['bucketSize'], message: 'Invalid option: expected one of "year"|"month"|"day"' },
        ]),
      );
    });

    // TODO enable date string validation while still accepting 5 digit years
    it.fails('should fail if time bucket is invalid', async () => {
      const { status, body } = await request(ctx.getHttpServer()).get('/timeline/bucket').query({ timeBucket: 'foo' });
      expect(status).toBe(400);
      expect(body).toEqual(errorDto.badRequest('Invalid time bucket format'));
    });
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
