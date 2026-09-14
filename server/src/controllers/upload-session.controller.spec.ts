import { APP_FILTER, APP_GUARD, APP_INTERCEPTOR, APP_PIPE } from '@nestjs/core';
import { Test } from '@nestjs/testing';
import { ClsService } from 'nestjs-cls';
import { ZodSerializerInterceptor, ZodValidationPipe } from 'nestjs-zod';
import { AssetController } from 'src/controllers/asset.controller';
import { UploadSessionController } from 'src/controllers/upload-session.controller';
import { AssetMediaStatus } from 'src/dtos/asset-media-response.dto';
import { AuthGuard } from 'src/middleware/auth.guard';
import { GlobalExceptionFilter } from 'src/middleware/global-exception.filter';
import { LoggingRepository } from 'src/repositories/logging.repository';
import { AssetService } from 'src/services/asset.service';
import { AuthService } from 'src/services/auth.service';
import { UploadSessionService } from 'src/services/upload-session.service';
import request from 'supertest';
import { factory } from 'test/small.factory';
import { AutoMocked, ControllerContext, controllerSetup, mockBaseService } from 'test/utils';
import { Mock, vi } from 'vitest';

const CHUNK_CONTENT_TYPE = 'application/offset+octet-stream';

const makeCreateDto = (overrides: Record<string, unknown> = {}) => ({
  filename: 'example.mov',
  size: 100,
  fileCreatedAt: new Date().toISOString(),
  fileModifiedAt: new Date().toISOString(),
  ...overrides,
});

describe(UploadSessionController.name, () => {
  let ctx: ControllerContext;
  const service = mockBaseService(UploadSessionService);

  beforeAll(async () => {
    ctx = await controllerSetup(UploadSessionController, [{ provide: UploadSessionService, useValue: service }]);
    return () => ctx.close();
  });

  beforeEach(() => {
    service.resetAllMocks();
    ctx.reset();
  });

  describe('POST /assets/upload-session', () => {
    it('should be an authenticated route', async () => {
      await request(ctx.getHttpServer()).post('/assets/upload-session');
      expect(ctx.authenticate).toHaveBeenCalled();
    });

    it('rejects isFavorite as a string, unlike the multipart create endpoint', async () => {
      const { status, body } = await request(ctx.getHttpServer())
        .post('/assets/upload-session')
        .send(makeCreateDto({ isFavorite: 'false' }));

      expect(status).toBe(400);
      expect(body).toEqual(
        factory.responses.validationError([
          { path: ['isFavorite'], message: 'Invalid input: expected boolean, received string' },
        ]),
      );
      expect(service.create).not.toHaveBeenCalled();
    });

    it('rejects metadata as a JSON string, unlike the multipart create endpoint', async () => {
      const { status, body } = await request(ctx.getHttpServer())
        .post('/assets/upload-session')
        .send(makeCreateDto({ metadata: '[]' }));

      expect(status).toBe(400);
      expect(body).toEqual(
        factory.responses.validationError([
          { path: ['metadata'], message: 'Invalid input: expected array, received string' },
        ]),
      );
      expect(service.create).not.toHaveBeenCalled();
    });

    it('returns 201 with the session body when a session is created', async () => {
      const sessionResponse = { id: factory.uuid(), offset: 0, expiresAt: new Date().toISOString() };
      service.create.mockResolvedValue(sessionResponse);

      const { status, body } = await request(ctx.getHttpServer()).post('/assets/upload-session').send(makeCreateDto());

      expect(status).toBe(201);
      expect(body).toEqual(sessionResponse);
    });

    it('returns 200 with the asset body when the checksum is already a duplicate', async () => {
      const duplicateResponse = { status: AssetMediaStatus.DUPLICATE, id: factory.uuid() };
      service.create.mockResolvedValue(duplicateResponse);

      const { status, body } = await request(ctx.getHttpServer()).post('/assets/upload-session').send(makeCreateDto());

      expect(status).toBe(200);
      expect(body).toEqual(duplicateResponse);
    });
  });

  describe('HEAD /assets/upload-session/:id', () => {
    it('should be an authenticated route', async () => {
      await request(ctx.getHttpServer()).head(`/assets/upload-session/${factory.uuid()}`);
      expect(ctx.authenticate).toHaveBeenCalled();
    });

    it('reports the committed offset and declared length as headers', async () => {
      service.getOffset.mockResolvedValue({ offset: 42, size: 100 });

      const { status, headers } = await request(ctx.getHttpServer()).head(`/assets/upload-session/${factory.uuid()}`);

      expect(status).toBe(200);
      expect(headers['upload-offset']).toBe('42');
      expect(headers['upload-length']).toBe('100');
    });
  });

  describe('PATCH /assets/upload-session/:id', () => {
    it('should be an authenticated route', async () => {
      await request(ctx.getHttpServer())
        .patch(`/assets/upload-session/${factory.uuid()}`)
        .set('Content-Type', CHUNK_CONTENT_TYPE)
        .set('Upload-Offset', '0')
        .send(Buffer.from('x'));
      expect(ctx.authenticate).toHaveBeenCalled();
    });

    it('rejects a Content-Type other than application/offset+octet-stream with 415', async () => {
      const { status } = await request(ctx.getHttpServer())
        .patch(`/assets/upload-session/${factory.uuid()}`)
        .set('Content-Type', 'application/json')
        .set('Upload-Offset', '0')
        .send({});

      expect(status).toBe(415);
      expect(service.appendChunk).not.toHaveBeenCalled();
    });

    it('rejects a missing Upload-Offset header with 400', async () => {
      const { status } = await request(ctx.getHttpServer())
        .patch(`/assets/upload-session/${factory.uuid()}`)
        .set('Content-Type', CHUNK_CONTENT_TYPE)
        .send(Buffer.from('x'));

      expect(status).toBe(400);
      expect(service.getOffset).not.toHaveBeenCalled();
      expect(service.appendChunk).not.toHaveBeenCalled();
    });

    it.each(['-1', '1.5', 'abc'])('rejects a non-integer Upload-Offset header (%s) with 400', async (offset) => {
      const { status } = await request(ctx.getHttpServer())
        .patch(`/assets/upload-session/${factory.uuid()}`)
        .set('Content-Type', CHUNK_CONTENT_TYPE)
        .set('Upload-Offset', offset)
        .send(Buffer.from('x'));

      expect(status).toBe(400);
      expect(service.getOffset).not.toHaveBeenCalled();
      expect(service.appendChunk).not.toHaveBeenCalled();
    });

    it('rejects a body longer than the declared remaining length without appending it', async () => {
      service.getOffset.mockResolvedValue({ offset: 0, size: 3 });

      const { status } = await request(ctx.getHttpServer())
        .patch(`/assets/upload-session/${factory.uuid()}`)
        .set('Content-Type', CHUNK_CONTENT_TYPE)
        .set('Upload-Offset', '0')
        .send(Buffer.from('abcdef'));

      expect(status).toBe(400);
      expect(service.appendChunk).not.toHaveBeenCalled();
    });

    it('returns 204 with Upload-Offset when more chunks are expected', async () => {
      service.getOffset.mockResolvedValue({ offset: 0, size: 10 });
      service.appendChunk.mockResolvedValue({ offset: 5 });

      const sessionId = factory.uuid();
      const { status, headers, body } = await request(ctx.getHttpServer())
        .patch(`/assets/upload-session/${sessionId}`)
        .set('Content-Type', CHUNK_CONTENT_TYPE)
        .set('Upload-Offset', '0')
        .send(Buffer.from('hello'));

      expect(status).toBe(204);
      expect(headers['upload-offset']).toBe('5');
      expect(body).toEqual({});
      expect(service.appendChunk).toHaveBeenCalledWith(undefined, sessionId, 0, Buffer.from('hello'));
    });

    it('returns 201 with the asset body when the final chunk creates the asset', async () => {
      service.getOffset.mockResolvedValue({ offset: 0, size: 5 });
      const created = { status: AssetMediaStatus.CREATED, id: factory.uuid() };
      service.appendChunk.mockResolvedValue(created);

      const { status, body } = await request(ctx.getHttpServer())
        .patch(`/assets/upload-session/${factory.uuid()}`)
        .set('Content-Type', CHUNK_CONTENT_TYPE)
        .set('Upload-Offset', '0')
        .send(Buffer.from('hello'));

      expect(status).toBe(201);
      expect(body).toEqual(created);
    });

    it('returns 200 with the asset body when the final chunk is a duplicate', async () => {
      service.getOffset.mockResolvedValue({ offset: 0, size: 5 });
      const duplicate = { status: AssetMediaStatus.DUPLICATE, id: factory.uuid() };
      service.appendChunk.mockResolvedValue(duplicate);

      const { status, body } = await request(ctx.getHttpServer())
        .patch(`/assets/upload-session/${factory.uuid()}`)
        .set('Content-Type', CHUNK_CONTENT_TYPE)
        .set('Upload-Offset', '0')
        .send(Buffer.from('hello'));

      expect(status).toBe(200);
      expect(body).toEqual(duplicate);
    });
  });

  describe('DELETE /assets/upload-session/:id', () => {
    it('should be an authenticated route', async () => {
      await request(ctx.getHttpServer()).delete(`/assets/upload-session/${factory.uuid()}`);
      expect(ctx.authenticate).toHaveBeenCalled();
    });

    it('returns 204 on success', async () => {
      service.abort.mockResolvedValue(undefined);

      const { status } = await request(ctx.getHttpServer()).delete(`/assets/upload-session/${factory.uuid()}`);

      expect(status).toBe(204);
    });
  });

  // Registers AssetController alongside UploadSessionController, in the same order production
  // uses (server/src/controllers/index.ts), to prove the 3-segment routes here are never
  // shadowed by AssetController's 2-segment `:id` routes — spec §5.2. This matters specifically
  // for HEAD, which Express resolves against GET handlers when no HEAD handler is registered on
  // a matching route.
  describe('route collision with AssetController (spec §5.2)', () => {
    let app: Awaited<ReturnType<typeof setupRoutingModule>>['app'];
    let assetService: AutoMocked<AssetService>;
    let uploadSessionService: AutoMocked<UploadSessionService>;
    let authenticate: Mock;

    const setupRoutingModule = async () => {
      const mockedAssetService = mockBaseService(AssetService);
      const mockedUploadSessionService = mockBaseService(UploadSessionService);
      const mockedAuthenticate = vi.fn().mockResolvedValue(factory.auth());

      const moduleRef = await Test.createTestingModule({
        controllers: [AssetController, UploadSessionController],
        providers: [
          { provide: APP_FILTER, useClass: GlobalExceptionFilter },
          { provide: APP_PIPE, useClass: ZodValidationPipe },
          { provide: APP_INTERCEPTOR, useClass: ZodSerializerInterceptor },
          { provide: APP_GUARD, useClass: AuthGuard },
          { provide: LoggingRepository, useValue: LoggingRepository.create() },
          { provide: ClsService, useValue: { getId: vi.fn() } },
          { provide: AuthService, useValue: { authenticate: mockedAuthenticate } },
          { provide: AssetService, useValue: mockedAssetService },
          { provide: UploadSessionService, useValue: mockedUploadSessionService },
        ],
      }).compile();

      const testApp = moduleRef.createNestApplication();
      await testApp.init();

      return {
        app: testApp,
        assetService: mockedAssetService,
        uploadSessionService: mockedUploadSessionService,
        authenticate: mockedAuthenticate,
      };
    };

    beforeEach(async () => {
      ({ app, assetService, uploadSessionService, authenticate } = await setupRoutingModule());
    });

    afterEach(async () => {
      await app.close();
    });

    it('resolves HEAD to UploadSessionController, not AssetController.getAssetInfo', async () => {
      uploadSessionService.getOffset.mockResolvedValue({ offset: 1, size: 2 });

      const { status } = await request(app.getHttpServer()).head(`/assets/upload-session/${factory.uuid()}`);

      expect(status).toBe(200);
      expect(uploadSessionService.getOffset).toHaveBeenCalled();
      expect(assetService.get).not.toHaveBeenCalled();
      expect(authenticate).toHaveBeenCalled();
    });

    it('resolves PATCH to UploadSessionController, not AssetController.updateAsset', async () => {
      uploadSessionService.getOffset.mockResolvedValue({ offset: 0, size: 5 });
      uploadSessionService.appendChunk.mockResolvedValue({ offset: 5 });

      const { status } = await request(app.getHttpServer())
        .patch(`/assets/upload-session/${factory.uuid()}`)
        .set('Content-Type', CHUNK_CONTENT_TYPE)
        .set('Upload-Offset', '0')
        .send(Buffer.from('hello'));

      expect(status).toBe(204);
      expect(uploadSessionService.appendChunk).toHaveBeenCalled();
    });

    it('resolves DELETE to UploadSessionController, not AssetController.deleteAssets', async () => {
      uploadSessionService.abort.mockResolvedValue(undefined);

      const { status } = await request(app.getHttpServer()).delete(`/assets/upload-session/${factory.uuid()}`);

      expect(status).toBe(204);
      expect(uploadSessionService.abort).toHaveBeenCalled();
    });

    it('resolves POST to UploadSessionController, not AssetController', async () => {
      uploadSessionService.create.mockResolvedValue({
        id: factory.uuid(),
        offset: 0,
        expiresAt: new Date().toISOString(),
      });

      const { status } = await request(app.getHttpServer()).post('/assets/upload-session').send(makeCreateDto());

      expect(status).toBe(201);
      expect(uploadSessionService.create).toHaveBeenCalled();
    });
  });
});
